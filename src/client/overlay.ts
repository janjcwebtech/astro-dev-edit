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
 * click routing, the edit-mode toggle, and boot. Vanilla TS, no framework,
 * no dependencies. (spec §4.2)
 */

import type { SourceLoc } from '../shared/protocol.ts';
import * as api from './api.ts';
import { invalidateClassifications } from './classify-cache.ts';
import { openEntryPanel } from './editors/entry.ts';
import { pageSource } from './editors/notice.ts';
import { openPeekPanel } from './editors/peek.ts';
import { clearHighlight, initHover } from './hover.ts';
import { initRouter } from './router.ts';
import { cacheSourceMappings, startCapture } from './source-map.ts';
import { initTree } from './tree.ts';
import * as state from './state.ts';
import { COLOR, FONT, Z, basename, styled, toast } from './ui.ts';

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
// Edit-mode toggle
// ---------------------------------------------------------------------------

let editMode = false;
// Set from the server's /health payload at boot. Gates the hover-pill chips row.
let cssInspectorEnabled = false;

// The toggle and entry pills share a fixed width so the stacked buttons read
// as one aligned control group. They stay dimmed until the group is hovered.
const PILL_WIDTH = '120px';
const PILL_OPACITY = '0.6';
const pillStyle = (background: string): Partial<CSSStyleDeclaration> => ({
  width: PILL_WIDTH,
  boxSizing: 'border-box',
  // Left-aligned so the ✎ icon lands in the same spot on every pill,
  // regardless of label length.
  textAlign: 'left',
  padding: '8px 12px',
  font: `600 13px/1 ${FONT.ui}`,
  color: '#fff',
  background,
  border: 'none',
  borderRadius: '999px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
  cursor: 'pointer',
  opacity: PILL_OPACITY,
  transition: 'opacity 120ms',
});

// Wrapper that stacks the pills (and, on hover, the hide button) in the
// bottom-right corner. (spec §4.2)
const controls = styled('div', 'atx-controls', {
  position: 'fixed',
  right: '16px',
  bottom: '16px',
  zIndex: String(Z + 2),
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: '10px',
}, 'atx-controls');

const toggle = styled('button', 'atx-toggle', pillStyle(COLOR.idle), 'atx-toggle');
toggle.type = 'button';
toggle.textContent = '✎ Edit';
toggle.title = 'Toggle text-edit mode';

// On detail pages that declare a backing content file (the page-source meta
// tag), a second pill opens the CMS entry drawer. It shows whenever the page
// declares one — a one-click action, independent of edit mode.
const entryButton = styled('button', 'atx-entry', {
  ...pillStyle(COLOR.image),
  display: 'none',
}, 'atx-entry');
entryButton.type = 'button';
entryButton.textContent = '✎ Edit entry';
entryButton.title = 'Edit this page’s content entry';
entryButton.addEventListener('click', () => {
  const file = pageSource();
  if (file) void openEntryPanel(file);
});

// Small ✕ above the pills, revealed while the group is hovered: hides the
// whole control group (buttons + hint) until the next page reload.
const hideButton = styled('button', 'atx-hide', {
  width: '20px',
  height: '20px',
  padding: '0',
  font: `600 11px/1 ${FONT.ui}`,
  textAlign: 'center',
  color: '#ddd',
  background: 'rgba(28, 28, 43, 0.85)',
  border: 'none',
  borderRadius: '999px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
  cursor: 'pointer',
  alignSelf: 'flex-end',
  display: 'none',
}, 'atx-hide');
hideButton.type = 'button';
hideButton.textContent = '✕';
hideButton.title = 'Hide editing buttons until reload';
hideButton.addEventListener('click', () => {
  setEditMode(false);
  controls.style.display = 'none';
});

controls.addEventListener('mouseenter', () => {
  hideButton.style.display = '';
  toggle.style.opacity = '1';
  entryButton.style.opacity = '1';
});
controls.addEventListener('mouseleave', () => {
  hideButton.style.display = 'none';
  toggle.style.opacity = PILL_OPACITY;
  entryButton.style.opacity = PILL_OPACITY;
});

// ---------------------------------------------------------------------------
// Navigate-while-held: holding Ctrl or Alt/Option suspends editing so clicks
// travel the site normally, without toggling edit mode off and back on.
// ---------------------------------------------------------------------------

const IS_MAC = /Mac|iP(hone|ad|od)/.test(navigator.platform);
const NAV_HINT = IS_MAC ? 'hold ⌃ or ⌥ to navigate' : 'hold Ctrl to navigate';

let navigating = false;

// Small annotation beside the toggle so hold-to-navigate isn't completely
// hidden. Visible only while edit mode is on. Anchored 10px to the left of the
// button stack, bottom-aligned with the Edit pill (absolute, so showing it
// never shifts the pills). Sits left rather than below to stay on-screen now
// the controls hug the viewport bottom.
const hint = styled('div', 'atx-toggle-hint', {
  position: 'absolute',
  bottom: '0',
  right: 'calc(100% + 10px)',
  padding: '3px 8px',
  font: `500 10px/1.3 ${FONT.ui}`,
  textAlign: 'center',
  whiteSpace: 'nowrap',
  color: '#ddd',
  background: 'rgba(28, 28, 43, 0.85)',
  borderRadius: '999px',
  pointerEvents: 'none',
  display: 'none',
}, 'atx-toggle-hint');
hint.textContent = NAV_HINT;

function refreshCursor(): void {
  document.body.style.cursor = editMode && !navigating ? 'crosshair' : '';
}

function setNavigating(on: boolean): void {
  const next = on && editMode;
  if (navigating === next) return;
  navigating = next;
  refreshCursor();
  hint.textContent = navigating ? 'release to edit' : NAV_HINT;
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

function setEditMode(on: boolean): void {
  editMode = on;
  if (!on) setNavigating(false);
  toggle.style.background = on ? COLOR.accent : COLOR.idle;
  toggle.textContent = on ? '✎ Editing' : '✎ Edit';
  hint.style.display = on ? 'block' : 'none';
  refreshCursor();
  // Survive the full-page reload that follows every successful save.
  try {
    sessionStorage.setItem('astroTextEditMode', on ? '1' : '0');
  } catch {
    // sessionStorage unavailable (rare) — edit mode just won't persist.
  }
  if (on) {
    tree.rebuild();
    tree.show();
  } else {
    clearHighlight();
    tree.hide();
    state.dismiss(); // cancel any open inline edit (restores text) / close any panel
  }
}

toggle.addEventListener('click', () => setEditMode(!editMode));

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
  cssInspector: () => cssInspectorEnabled,
  openRule: (file, selector) => void openRule(file, selector),
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
});
const router = initRouter({
  isEditMode,
  isNavigating: () => navigating,
  openSource: (src) => void openSource(src),
  openPeek,
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
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  // Confirm the server side is alive before showing the button. If the health
  // check fails the overlay stays out of the way entirely.
  const info = await api.health();
  if (!info) return;
  cssInspectorEnabled = info.cssInspector;
  controls.append(hideButton, entryButton, toggle, hint);
  document.body.append(...hover.elements, tree.selectionOutline, tree.root, controls);

  // The entry pill is a one-click CMS action, useful outside edit mode too —
  // show it whenever the page declares a backing content file.
  entryButton.style.display = pageSource() ? 'block' : 'none';

  // Restore edit mode across the full-page reload that follows every save.
  try {
    if (sessionStorage.getItem('astroTextEditMode') === '1') setEditMode(true);
  } catch {
    // sessionStorage unavailable — start with edit mode off.
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  void boot();
}
