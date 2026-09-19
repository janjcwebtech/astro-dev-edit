/**
 * The layout's arithmetic, with no DOM in it.
 *
 * Two modes share one set of sums. In **overlay** the panels float over the
 * page and the numbers here only say where our own chrome may not be drawn; in
 * **docked** the same numbers also become the host page's padding, so the page
 * ends up in the strip between the panels with the code dock under it.
 *
 * Everything below is measured-in, measured-out: no constant here knows how
 * wide a panel is. That is what lets the caller answer "does the page still
 * have room to be docked?" from live rects rather than from a media query that
 * would have to be kept in step with three stylesheets.
 *
 * DOM-free on purpose, like tree-model.ts — the clamp and the pill's flip are
 * the two pieces most worth pinning in a test, and neither needs a browser.
 */

/** Strips of the viewport that fixed chrome occupies, per edge. */
export interface ChromeInset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface Size {
  width: number;
  height: number;
}

/** The four edges of a box in viewport coordinates — a DOMRect's own subset. */
export interface Edges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSET: ChromeInset = { top: 0, bottom: 0, left: 0, right: 0 };

/** The dock's floor. Below this the header and one line of code no longer both
 *  fit, so the dock would be a bar claiming to be a pane. */
export const DOCK_MIN = 110;
/** Its ceiling, as a share of the viewport. The page column has to stay a page:
 *  past this the dock is what the window is for, and the element being
 *  inspected is off screen. */
export const DOCK_MAX_RATIO = 0.82;
/** The height a dock that has never been dragged opens at. */
export const DOCK_DEFAULT_RATIO = 0.34;
/** The folded dock — its header bar, and nothing else. styles.ts gives
 *  `.atx-dock-head` this same constant, so the fold cannot end up a pixel off
 *  the bar it is folding to. */
export const DOCK_BAR_H = 38;

/** The narrowest the page column may get before docking stops being worth it.
 *  Measured against the *panels that are actually open*, so closing the tree
 *  can be what makes a window wide enough. */
export const MIN_PAGE_WIDTH = 420;

/** Add up what every owner claims. Two owners can claim the same edge — the
 *  admin bar docked to the bottom and the code dock above it — and the strip
 *  the page must keep clear of is both of them. */
export function addInsets(parts: Iterable<ChromeInset>): ChromeInset {
  const total = { ...NO_INSET };
  for (const part of parts) {
    total.top += part.top;
    total.bottom += part.bottom;
    total.left += part.left;
    total.right += part.right;
  }
  return total;
}

export function sameInset(a: ChromeInset, b: ChromeInset): boolean {
  return a.top === b.top && a.bottom === b.bottom && a.left === b.left && a.right === b.right;
}

/**
 * Where a dragged dock edge is allowed to land.
 *
 * The ceiling is clamped against the floor rather than the other way round, so
 * a window shorter than {@link DOCK_MIN} still yields a usable number instead
 * of an inverted range.
 */
export function clampDockHeight(px: number, viewportHeight: number): number {
  const ceiling = Math.max(DOCK_MIN, Math.round(viewportHeight * DOCK_MAX_RATIO));
  return Math.max(DOCK_MIN, Math.min(ceiling, Math.round(px)));
}

/** The height the dock takes up right now: its own when open, its header bar
 *  when folded. A fold never discards the dragged height — it is what unfolding
 *  gives back. */
export function dockStrip(height: number, open: boolean): number {
  return open ? height : DOCK_BAR_H;
}

/**
 * The rectangle of viewport nothing of ours is sitting on.
 *
 * Measured from the inset rather than assumed from the mode: docked mode moves
 * the page out from under the chrome, but the clamp is the same clamp — it just
 * finds more room.
 */
export function freeBox(inset: ChromeInset, viewport: Size, edge: number): Edges {
  return {
    top: inset.top + edge,
    left: inset.left + edge,
    right: viewport.width - inset.right - edge,
    bottom: viewport.height - inset.bottom - edge,
  };
}

/**
 * Where to put the hover pill for an element.
 *
 * Above the element whenever it fits there — a pill below the thing it names
 * covers the next line of the page, and on a heading that is the sentence you
 * were reading. Below is the fallback, and it is clamped into the free box on
 * both axes: that clamp is what keeps the pill off the code dock and out from
 * under a docked side panel.
 */
export function pillPlacement(
  rect: Edges,
  size: Size,
  free: Edges,
  gap: number,
): { top: number; left: number } {
  const above = rect.top - size.height - gap;
  const below = rect.bottom + gap;
  return {
    top: above >= free.top ? above : Math.max(free.top, Math.min(below, free.bottom - size.height)),
    left: Math.max(free.left, Math.min(rect.left, free.right - size.width)),
  };
}

/**
 * Whether the page column is still worth squeezing.
 *
 * Docking costs the width of every open panel before the page gets any, so the
 * answer changes with which panels are open, not only with the window. A
 * window too narrow to dock degrades to overlay rather than lying about the
 * geometry.
 */
export function canDock(viewportWidth: number, left: number, right: number): boolean {
  return viewportWidth - left - right >= MIN_PAGE_WIDTH;
}
