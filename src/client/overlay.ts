/**
 * astro-text-edit overlay — injected browser client (composition root).
 *
 * Edit mode gives you a hover highlight, and clicking routes by classification.
 * The DOM-side guess is only a hover hint: every click is confirmed against the
 * server's AST-truth /classify before an editor opens (a resolved {expression}
 * looks identical to literal text in the DOM). (spec §7.3, §16.1)
 *   - literal text  → inline contenteditable (editors/text.ts)
 *   - image         → swap panel (editors/image.ts)
 *   - dynamic/other → a refusal notice with "Open source" (editors/notice.ts)
 * Commits POST /apply, which verifies the source still matches what the client
 * saw and patches the file atomically. Astro HMR then reloads the page from
 * disk; edit mode survives the reload via sessionStorage.
 *
 * This module only wires the pieces together: source-map capture, hover,
 * click routing, the admin bar, edit mode, and boot. Vanilla TS, no framework,
 * no dependencies. (spec §4.2)
 */

import type { PageSourceResponse, SourceLoc } from '../shared/protocol.ts';
import { initAdminBar } from './admin-bar.ts';
import * as api from './api.ts';
import { invalidateClassifications } from './classify-cache.ts';
import {
  clearPendingCollection,
  openCollectionsPanel,
  takePendingCollection,
} from './editors/collections-panel.ts';
import { openCopyPanel } from './editors/copy-panel.ts';
import { openEntryPanel } from './editors/entry.ts';
import { openPeekPanel } from './editors/peek.ts';
import { openSettingsPanel } from './editors/settings-panel.ts';
import { collectContext, formatContext } from './element-context.ts';
import { has, setFeatures } from './features.ts';
import { clearHighlight, initHover } from './hover.ts';
import { pageSource } from './page-source.ts';
import { initRouter } from './router.ts';
import { cacheSourceMappings, sourceFor, startCapture } from './source-map.ts';
import { initTree } from './tree.ts';
import * as state from './state.ts';
import { basename, toast } from './ui.ts';

// Begin capturing source annotations as early as possible. If the body isn't
// parsed yet, wait for it; the observer then catches every annotated node as
// it arrives. This must run synchronously at module evaluation to win the
// dev-toolbar attribute-strip race — see source-map.ts.
if (document.body) {
  startCapture();
} else {
  document.addEventListener('DOMContentLoaded', startCapture, { once: true });
}

// ---------------------------------------------------------------------------
// Edit mode
// ---------------------------------------------------------------------------

let editMode = false;
// Whether the element tree should be open while editing. The tree does NOT ride
// along with edit mode — it stays closed until asked for (the bar's Elements
// button or the panel's edge tab), so entering edit mode never covers the page
// you came to edit. The choice does survive the full-page reload that follows
// every save, like edit mode itself.
let treeWanted = false;
// From /health: the absolute project root, so copied source paths come out
// repo-relative (Astro's annotations are absolute). Null until boot completes.
let projectRoot: string | null = null;

// ---------------------------------------------------------------------------
// Navigate-while-held: holding Ctrl or Alt/Option suspends editing so clicks
// travel the site normally, without toggling edit mode off and back on.
// ---------------------------------------------------------------------------

const IS_MAC = /Mac|iP(hone|ad|od)/.test(navigator.platform);
const NAV_HINT = IS_MAC ? 'hold ⌃ or ⌥ to navigate' : 'hold Ctrl to navigate';

let navigating = false;

function refreshCursor(): void {
  document.body.style.cursor = editMode && !navigating ? 'crosshair' : '';
}

function setNavigating(on: boolean): void {
  const next = on && editMode;
  if (navigating === next) return;
  navigating = next;
  refreshCursor();
  // The bar carries the hint, so hold-to-navigate isn't completely hidden.
  bar.setHint(navigating ? 'release to edit' : NAV_HINT);
  if (navigating) clearHighlight();
}

// Track the modifier via keydown/keyup, with two fallbacks: window blur
// (app switch mid-hold) releases the mode, and mousemove re-syncs from the
// event's own modifier flags in case the keydown fired while focus was
// elsewhere. Capture phase, so the sync runs before hover's own listener.
const NAV_KEYS = new Set(['Control', 'Alt']);
document.addEventListener('keydown', (e) => {
  if (!editMode || !NAV_KEYS.has(e.key)) return;
  // A bare Alt keydown would otherwise focus the browser menu bar on keyup
  // (Firefox/Windows).
  if (e.key === 'Alt') e.preventDefault();
  setNavigating(true);
}, true);
document.addEventListener('keyup', (e) => {
  // If both modifiers were held, the flags of the still-held one keep it on.
  if (NAV_KEYS.has(e.key)) setNavigating(e.ctrlKey || e.altKey);
}, true);
window.addEventListener('blur', () => setNavigating(false));
document.addEventListener('mousemove', (e) => {
  if (editMode) setNavigating(e.ctrlKey || e.altKey);
}, true);

/** Remember whether the tree is wanted, across the save-triggered reload. */
function rememberTree(open: boolean): void {
  treeWanted = open;
  try {
    sessionStorage.setItem('astroTextEditTree', open ? '1' : '0');
  } catch {
    // sessionStorage unavailable (rare) — the choice just won't persist.
  }
}

function setEditMode(on: boolean): void {
  editMode = on;
  if (!on) setNavigating(false);
  refreshCursor();
  // Survive the full-page reload that follows every successful save.
  try {
    sessionStorage.setItem('astroTextEditMode', on ? '1' : '0');
  } catch {
    // sessionStorage unavailable (rare) — edit mode just won't persist.
  }
  if (on) {
    tree.rebuild();
    // Closed by default: hide() is what puts the edge tab up now that editing
    // is on, so the tree is one click away without being in the way.
    if (treeWanted) tree.show();
    else tree.hide();
  } else {
    clearHighlight();
    tree.hide();
    // Only panels can still be open here: every exit path commits an inline
    // edit first (exitEditing), so this can no longer discard typing.
    state.dismiss();
  }
  bar.setHint(on ? NAV_HINT : null);
  bar.refresh();
  // Edit mode holds the bar out whether or not it is pinned — it carries the
  // save state and the way out — so the retract state has to be recomputed.
  bar.syncVisibility();
}

// The single way out of edit mode. Anything pending is written first and we
// only leave once the write has landed, so "am I done?" is answered by the
// bar's exit button rather than by hoping. A cancel (Escape) is the *other*
// path and stays deliberate — it is the only way to throw a change away.
let settleWatcher: (() => void) | null = null;

function exitEditing(): void {
  if (state.savePhase() === 'saving') {
    leaveWhenSettled();
    return;
  }
  if (state.get()) {
    state.commit(); // a text edit saves; a panel just closes
    if (state.savePhase() === 'saving') {
      leaveWhenSettled();
      return;
    }
  }
  setEditMode(false);
}

/** Hold edit mode open until the in-flight write settles, then leave — unless
 *  it failed, in which case stay so the red exit button is there to be read. */
function leaveWhenSettled(): void {
  if (settleWatcher) return;
  settleWatcher = state.onSavePhase((phase) => {
    if (phase === 'saving') return;
    settleWatcher?.();
    settleWatcher = null;
    if (phase !== 'error') setEditMode(false);
  });
}

// Global Escape closes any open modal interaction (image/dynamic panel) and
// guarantees state resets, then clears a locked element-tree selection if one
// is the only thing open. Inline text edits handle their own Escape (to restore
// original text) before this ever sees it.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (state.get()?.kind === 'panel') {
    e.preventDefault();
    state.dismiss();
  } else if (tree.hasSelection()) {
    e.preventDefault();
    tree.clearSelection();
  }
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/** Open a source location in the user's editor, reporting the result. */
async function openSource(src: SourceLoc): Promise<void> {
  try {
    await api.open({ file: src.file, loc: src.loc });
    toast(`Opened ${basename(src.file)}:${src.loc} in your editor`, 'ok');
  } catch (err) {
    toast(`Could not open source — ${err instanceof Error ? err.message : 'unknown'}`, 'err');
  }
}

/** What each refusal means in the one sentence the user sees. */
const PAGE_SOURCE_REFUSALS: Record<
  NonNullable<PageSourceResponse['refusal']>,
  (pathname: string) => string
> = {
  'no-routes': () => 'Astro reported no routes — cannot tell which file this page is',
  'no-match': (p) => `No route matches ${p} — cannot tell which file this page is`,
  'not-in-project': (p) => `The route for ${p} is not a file in this project`,
  missing: (p) => `The route for ${p} has no source file on disk`,
};

/**
 * Open the file this page is written in — the bar menu's "Open page source".
 *
 * The server answers from Astro's route manifest, because the DOM cannot: only
 * elements are annotated, never component tags, so the old approach of opening
 * whichever file rendered the most annotated elements landed on a markup-dense
 * Nav.astro instead of a page that mostly composes components. When no route
 * matches, we say so and open nothing rather than guess.
 */
async function openPageSource(): Promise<void> {
  const pathname = location.pathname;
  let answer: PageSourceResponse;
  try {
    answer = await api.resolvePageSource({ pathname });
  } catch (err) {
    toast(`Could not locate this page — ${err instanceof Error ? err.message : 'unknown'}`, 'err');
    return;
  }
  if (!answer.file) {
    toast(PAGE_SOURCE_REFUSALS[answer.refusal ?? 'no-match'](pathname), 'err');
    return;
  }
  try {
    await api.open({ file: answer.file, loc: '1:1' });
  } catch (err) {
    toast(`Could not open source — ${err instanceof Error ? err.message : 'unknown'}`, 'err');
    return;
  }
  // The whole root-relative path, not just the basename: half a project's pages
  // are called index.astro, and this is the one toast whose job is to say which.
  const where = answer.pattern ? ` — the template for ${answer.pattern}` : '';
  toast(`Opened ${answer.file}${where}`, 'ok');
}

/** Open a CSS rule's source in the editor (hover-pill inspector), reporting the
 *  result — the server jumps to the located line, or the file top on a miss. */
async function openRule(file: string, selector: string): Promise<void> {
  try {
    const { loc } = await api.inspectOpen({ file, selector });
    const where = loc ? `${basename(file)}:${loc}` : basename(file);
    toast(`Opened ${where} in your editor`, 'ok');
  } catch (err) {
    toast(`Could not open ${selector} — ${err instanceof Error ? err.message : 'unknown'}`, 'err');
  }
}

/** Human-readable size for the copy toast — the payload's bulk is the one thing
 *  you can't see from the button. */
function sizeLabel(text: string): string {
  return text.length < 1024 ? `${text.length} characters` : `${(text.length / 1024).toFixed(1)} KB`;
}

/**
 * The hover pill's "copy": gather the element's context and write it to the
 * clipboard. Resolves true only on a real clipboard write; when the API is
 * missing (a dev server reached over the network is not a secure context) or
 * refuses, the text goes to a panel the user can copy from by hand instead.
 */
async function copyContext(el: HTMLElement, src: SourceLoc): Promise<boolean> {
  let text: string;
  let label: string;
  try {
    const ctx = await collectContext(el, src, projectRoot);
    text = formatContext(ctx);
    label = ctx.label;
  } catch (err) {
    toast(`Could not gather context — ${err instanceof Error ? err.message : 'unknown'}`, 'err');
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied context for ${label} — ${sizeLabel(text)}`, 'ok');
    return true;
  } catch {
    openCopyPanel(`${basename(src.file)}:${src.loc}`, text);
    return false;
  }
}

const isEditMode = (): boolean => editMode;
/** Open the in-browser source-peek panel; its footer's "Open in editor" falls
 *  through to openSource. */
const openPeek = (src: SourceLoc): void => openPeekPanel(src, (s) => void openSource(s));
// Hover treats navigate-mode as "edit mode off": no outline, no tooltip.
// Its onTarget feeds page-hover into the element tree (page → tree sync).
const hover = initHover({
  isEditMode: () => editMode && !navigating,
  openSource: (src) => void openSource(src),
  openPeek,
  cssInspector: () => has('cssInspector'),
  openRule: (file, selector) => void openRule(file, selector),
  copyContext,
  onTarget: (el) => tree.syncActive(el),
});
// The tree is created BEFORE the router so its capture-phase "click to deselect"
// listener runs ahead of the router's (which stopImmediatePropagation()s clicks
// on editable targets). `router` is referenced lazily in openEditor, so the
// forward reference is safe — it only fires on a row double-click, long after
// boot. Highlights reuse hover's outline + verdict pill (tree → page sync).
const tree = initTree({
  isEditMode: () => editMode && !navigating,
  highlight: (el) => hover.highlight(el),
  clearHighlight,
  openEditor: (el) => router.openElementAt(el),
  openSource: (src) => void openSource(src),
  // The ✕ and the edge tab toggle the panel themselves; record the choice so a
  // save-triggered reload brings the tree back the way the user left it.
  onToggle: (open) => {
    rememberTree(open);
    bar.refresh();
  },
});
const router = initRouter({
  isEditMode,
  isNavigating: () => navigating,
  openSource: (src) => void openSource(src),
  openPeek,
});
// The admin bar is a view over everything above: it owns no editing state, it
// reads and drives it. Created last so its deps close over live references.
const bar = initAdminBar({
  isEditMode,
  enterEdit: () => setEditMode(true),
  exitEdit: exitEditing,
  // The tree's row hover only means anything in edit mode, so asking for the
  // tree from a cold page turns edit mode on with it.
  showTree: () => {
    rememberTree(true);
    if (!editMode) {
      setEditMode(true); // opens the tree with it, now that it is wanted
      return;
    }
    tree.rebuild();
    tree.show();
    bar.refresh();
  },
  hideTree: () => {
    rememberTree(false);
    tree.hide();
    bar.refresh();
  },
  isTreeOpen: () => tree.isOpen(),
  // Both halves are live: the page must declare a backing entry, *and* the
  // entry editor must be switched on — which the Settings drawer can change
  // without a reload.
  hasEntry: () => has('entryEditor') && pageSource() !== null,
  openEntry: () => {
    const file = pageSource();
    if (file) void openEntryPanel(file);
  },
  openPageSource: () => void openPageSource(),
  openCollections: () => openCollectionsPanel({ onClose: () => bar.refresh() }),
  // Saving settings changes what the bar should show (the entry button, the
  // page-source item, Collections itself), so the bar re-evaluates its specs
  // once the drawer is gone.
  openSettings: () => openSettingsPanel({ onClose: () => bar.refresh() }),
});

// After an HMR update: drop stale hover state, and re-snapshot source
// mappings from the freshly-rendered (re-annotated) DOM before the toolbar
// strips them again. (spec §4.2 / §7.4, adapted for attribute-stripping)
if (import.meta.hot) {
  import.meta.hot.on('vite:afterUpdate', () => {
    clearHighlight();
    invalidateClassifications(); // the source changed — cached verdicts are stale
    cacheSourceMappings();
    // The DOM (and every element object) was replaced — rebuild from the fresh
    // annotations, preserving collapse + selection by their stable paths.
    if (editMode) tree.rebuild();
    bar.refresh(); // a navigation may have gained or lost a content entry
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  // Confirm the server side is alive before showing the bar. If the health
  // check fails the overlay stays out of the way entirely.
  const info = await api.health();
  if (!info) return;
  projectRoot = info.root ?? null; // older servers don't send it — paths stay absolute
  // Every option-derived flag is read through features.ts rather than a local,
  // so the media modal can see them without importing the composition root and
  // so a Settings save updates them in place. (see features.ts)
  setFeatures(info);
  document.body.append(
    ...hover.elements,
    tree.selectionOutline,
    tree.root,
    tree.tab,
    ...bar.elements,
  );
  bar.refresh();

  // Restore edit mode — and whether the tree was open with it — across the
  // full-page reload that follows every save.
  try {
    treeWanted = sessionStorage.getItem('astroTextEditTree') === '1';
    if (sessionStorage.getItem('astroTextEditMode') === '1') setEditMode(true);
  } catch {
    // sessionStorage unavailable — start with edit mode off.
  }

  // A schema write reloads the page (Astro resyncs its content layer), which
  // would otherwise close the drawer the user was working in. Reopen it where
  // they were.
  const resumeCollection = takePendingCollection();
  if (resumeCollection) {
    openCollectionsPanel({
      collection: resumeCollection,
      onClose: () => {
        clearPendingCollection();
        bar.refresh();
      },
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  void boot();
}
