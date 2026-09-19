import type { SourceLoc } from '../shared/protocol.ts';
import { createDock, type DockHandle } from './dock.ts';
import { openPeekPanel, takeOpenPeek } from './editors/peek.ts';
import {
  DOCK_DEFAULT_RATIO,
  DOCK_MAX_RATIO,
  DOCK_MIN,
  canDock,
  clampDockHeight,
  dockStrip,
} from './layout-model.ts';
import { requestReflow } from './reflow.ts';
import { setChromeInset, toast } from './ui.ts';

/**
 * Where the chrome sits, and how much of the window the page still gets.
 *
 * Two modes, one set of measurements:
 *
 *  - **overlay** — today's behaviour. The panels float over the page at the
 *    viewport edges; the page keeps the whole window and runs underneath them.
 *  - **docked** — the page is squeezed *between* the tree and the inspector,
 *    with the code dock across the bottom of the page column. Nothing renders
 *    under chrome.
 *
 * The geometry is the same geometry either way: every overlay surface is placed
 * in viewport coordinates from a live rect, so a reflow needs a *redraw*, never
 * a different formula. What the mode changes is **when a redraw is owed** —
 * docked, opening a panel moves the page — and that is reflow.ts's whole job.
 *
 * ## Touching the host page
 *
 * Docking is the one thing the overlay does that the host page can feel. It is
 * done the way `document.body.style.cursor` is done in overlay.ts: one owner,
 * the previous inline value saved before the first write, and put back verbatim
 * on switching to overlay and on teardown. The padding goes on `<html>` rather
 * than on `<body>` so it cannot fight a site's own `body { margin: 0 auto }`.
 *
 * The shadow host stays `display: contents` and never gains
 * `position`/`transform`/`filter`/`contain` — any of those would make it a
 * containing block and re-anchor every `position: fixed` panel to it.
 *
 * **Known limitation:** padding moves the page's flow, and a host page's own
 * `position: fixed` or `sticky` elements are not in it. A site's fixed header
 * still spans the whole viewport and runs under our panels. There is no general
 * fix short of rendering the site in an iframe — see
 * documentation/COMPOSITION-API.md.
 */

export type LayoutMode = 'overlay' | 'docked';

export interface LayoutDeps {
  /** Panels pinned to the left edge — their right edge is the page's left. */
  left: readonly HTMLElement[];
  /** Panels pinned to the right edge. */
  right: readonly HTMLElement[];
}

export interface LayoutHandle {
  /** The dock — appended to the shadow root at boot with the other chrome. */
  dock: HTMLElement;
  /** The effective mode: 'overlay' while the window is too narrow to dock. */
  mode(): LayoutMode;
  /** What the switch in the inspector's header is set to, narrow or not. */
  wanted(): LayoutMode;
  setMode(mode: LayoutMode): void;
  toggleMode(): void;
  /** Re-measure the panels and re-apply. Called whenever one opens or closes. */
  refresh(): void;
  /** The effective mode changed — including on its own, when a resize takes the
   *  page column below the width worth docking. */
  onChange(fn: () => void): void;
  /** The one "view code" door: a modal in overlay mode, the dock when docked.
   *  Asked for explicitly, so a folded dock unfolds to answer. */
  showCode(src: SourceLoc, openSource: (src: SourceLoc) => void): void;
  /** The selection changed: docked, the dock follows it onto that element's own
   *  source. Nothing in overlay mode — a selection is not a request for a
   *  modal — and never unfolds a dock the reader folded away. */
  followSelection(src: SourceLoc | null | undefined, openSource: (src: SourceLoc) => void): void;
  /** Put the host page back exactly as it was found. */
  dispose(): void;
}

// --- Persisted preferences ---------------------------------------------------

interface LayoutPrefs {
  mode: LayoutMode;
  /** The dragged height, or null while the dock has never been dragged — which
   *  is not the same as a height that happens to equal the default. */
  dockHeight: number | null;
  dockOpen: boolean;
}

const PREFS_KEY = 'astroDevEditLayout';
const DEFAULT_PREFS: LayoutPrefs = { mode: 'overlay', dockHeight: null, dockOpen: true };

function loadPrefs(): LayoutPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<LayoutPrefs>;
    return {
      mode: parsed.mode === 'docked' ? 'docked' : 'overlay',
      dockHeight: typeof parsed.dockHeight === 'number' && Number.isFinite(parsed.dockHeight)
        ? parsed.dockHeight : null,
      dockOpen: parsed.dockOpen !== false,
    };
  } catch {
    // No localStorage (or junk in it) — overlay is the default for a reason.
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs(prefs: LayoutPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // The choice just won't outlive the page.
  }
}

// --- The host page's own inline styles ---------------------------------------

/** Exactly the properties docking writes, so restoring is total. */
const PUSHED = ['paddingLeft', 'paddingRight', 'paddingBottom', 'transition'] as const;
type Pushed = (typeof PUSHED)[number];

export function initLayout(deps: LayoutDeps): LayoutHandle {
  const prefs = loadPrefs();
  let strips = { left: 0, right: 0 };
  /** Null until the first push, and the proof there is something to restore. */
  let found: Record<Pushed, string> | null = null;
  let narrowWarned = false;
  const changeListeners = new Set<() => void>();

  const dock: DockHandle = createDock({
    resize(height, commit) {
      prefs.dockHeight = clampDockHeight(height, innerHeight);
      // Never animated: a drag is already the frame-by-frame animation.
      apply(false);
      if (commit) savePrefs(prefs);
    },
    reset() {
      prefs.dockHeight = null;
      savePrefs(prefs);
      apply(true);
    },
    toggleFold() {
      prefs.dockOpen = !prefs.dockOpen;
      savePrefs(prefs);
      apply(true);
    },
  });

  // --- Measuring -------------------------------------------------------------

  /** How far into the viewport a panel reaches from its edge, or 0 when it is
   *  not on screen. A `position: fixed` element has no `offsetParent`, so
   *  whether it renders at all is asked of its client rects. */
  function strip(el: HTMLElement, side: 'left' | 'right'): number {
    if (!el.getClientRects().length) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, side === 'left' ? rect.right : innerWidth - rect.left);
  }

  function measure(): { left: number; right: number } {
    return {
      left: Math.max(0, ...deps.left.map(el => strip(el, 'left'))),
      right: Math.max(0, ...deps.right.map(el => strip(el, 'right'))),
    };
  }

  function markPanels(mode: LayoutMode): void {
    for (const el of [...deps.left, ...deps.right]) el.dataset.layout = mode;
  }

  // --- Applying --------------------------------------------------------------

  /** The effective mode. A window too narrow to leave the page a page degrades
   *  to overlay rather than lying about the geometry. */
  let effective: LayoutMode = 'overlay';

  function pushHost(left: number, right: number, bottom: number, animate: boolean): void {
    const html = document.documentElement;
    found ??= Object.fromEntries(PUSHED.map(key => [key, html.style[key]])) as Record<Pushed, string>;
    // Set before the paddings, so the frame that changes them is the frame that
    // decides whether it animates.
    html.style.transition = animate ? 'padding 170ms ease' : 'none';
    html.style.paddingLeft = `${left}px`;
    html.style.paddingRight = `${right}px`;
    html.style.paddingBottom = `${bottom}px`;
  }

  function restoreHost(): void {
    if (!found) return;
    const html = document.documentElement;
    for (const key of PUSHED) html.style[key] = found[key];
    // Putting every property back still leaves `style=""` on a page that had no
    // style attribute at all. Only when nothing else is left in it — something
    // the page itself set while we were docked is not ours to throw away.
    if (!html.style.length) html.removeAttribute('style');
    found = null;
  }

  /**
   * Write the layout out: the panels' mode, the inset every other surface reads,
   * the dock's box, and the host page's padding.
   *
   * Measurement is deliberately *not* repeated here — a drag calls this on every
   * pointer move and the panels have not moved. {@link refresh} is the entry
   * point for "a panel opened".
   */
  function apply(animate: boolean): void {
    markPanels(prefs.mode);
    let docked = prefs.mode === 'docked' && canDock(innerWidth, strips.left, strips.right);
    if (prefs.mode === 'docked' && !docked) {
      // The panels claim their overlay geometry back, which also re-measures.
      markPanels('overlay');
      strips = measure();
      docked = canDock(innerWidth, strips.left, strips.right);
      if (docked) markPanels('docked');
    }
    const was = effective;
    effective = docked ? 'docked' : 'overlay';

    const height = clampDockHeight(prefs.dockHeight ?? innerHeight * DOCK_DEFAULT_RATIO, innerHeight);
    // Folded, the dock is its header bar and nothing else — and the dragged
    // height is kept, because it is what unfolding gives back.
    const standing = dockStrip(height, prefs.dockOpen);

    dock.setActive(docked);
    dock.setOpen(prefs.dockOpen);
    dock.setBounds(DOCK_MIN, Math.round(innerHeight * DOCK_MAX_RATIO));
    dock.setBox({ left: strips.left, right: strips.right, height: standing });

    // Everything positional reads this — the hover pill above all, which has to
    // clear the dock's top edge as well as the panels' inner edges.
    const bottom = docked ? standing : 0;
    setChromeInset('layout', { left: strips.left, right: strips.right, bottom });

    if (docked) pushHost(strips.left, strips.right, bottom, animate);
    else restoreHost();
    requestReflow();
    if (was !== effective) for (const fn of changeListeners) fn();
  }

  function refresh(): void {
    strips = measure();
    apply(true);
  }

  // A panel is shown by an attribute, and every path that shows one sets it —
  // its own ✕, the edge tab, a selection arriving from the page. One observer
  // on that attribute is one place to be right; a callback per path would be
  // four places to forget.
  const panels = new MutationObserver(refresh);
  for (const el of [...deps.left, ...deps.right]) {
    panels.observe(el, { attributes: true, attributeFilter: ['data-on'] });
  }
  // The window changing size changes both the clamp's ceiling and whether the
  // page column still has room at all.
  addEventListener('resize', () => { strips = measure(); apply(false); }, { passive: true });

  // --- Mode ------------------------------------------------------------------

  function setMode(mode: LayoutMode): void {
    if (prefs.mode !== mode) {
      prefs.mode = mode;
      savePrefs(prefs);
      narrowWarned = false;
    }
    refresh();
    // A modal peek and a docked peek are the same peek: carry it across rather
    // than leaving a modal over a page that has just moved out from under it.
    if (effective === 'docked') {
      const open = takeOpenPeek();
      if (open) dock.show(open.src, open.openSource);
    }
    if (mode === 'docked' && effective === 'overlay' && !narrowWarned) {
      narrowWarned = true;
      toast('Not enough width to dock — the panels stay over the page', 'warn');
    }
  }

  function showCode(src: SourceLoc, openSource: (src: SourceLoc) => void): void {
    if (effective !== 'docked') return openPeekPanel(src, openSource);
    dock.show(src, openSource);
    // Asked for by name: a dock folded to its bar would otherwise answer the
    // click by changing something nobody can see.
    if (!prefs.dockOpen) {
      prefs.dockOpen = true;
      savePrefs(prefs);
      apply(true);
    }
  }

  function followSelection(src: SourceLoc | null | undefined, openSource: (src: SourceLoc) => void): void {
    // An element with no annotation of its own has no source for the dock to
    // move to. Leaving it on the last file is honest — its header names that
    // file — and it keeps a reader's place rather than blanking the pane.
    if (effective !== 'docked' || !src?.file) return;
    dock.show(src, openSource);
  }

  // The client module being hot-replaced is the one teardown that really
  // happens: the next copy pushes the page itself, and this one must not leave
  // its padding behind on a page it no longer owns.
  import.meta.hot?.dispose(() => restoreHost());

  refresh();

  return {
    dock: dock.root,
    mode: () => effective,
    wanted: () => prefs.mode,
    setMode,
    toggleMode: () => setMode(prefs.mode === 'docked' ? 'overlay' : 'docked'),
    refresh,
    onChange: fn => changeListeners.add(fn),
    showCode,
    followSelection,
    dispose: restoreHost,
  };
}
