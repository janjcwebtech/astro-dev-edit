/**
 * One redraw, for everything the overlay draws in viewport coordinates.
 *
 * The hover outline, the hover pill and the element tree's locked selection are
 * all `position: fixed` boxes placed from a live `getBoundingClientRect()`. Any
 * of those rects can go stale without a single event that used to say so:
 *
 *  - the page scrolls or the window resizes — the two cases that always existed;
 *  - **a panel opens.** In docked mode the side panels push the host page, so
 *    opening the element tree moves every element on the page sideways. No
 *    scroll fires, no resize fires, and an outline drawn a frame earlier is
 *    simply wrong;
 *  - the page reflows on its own — an image lands, a font swaps, HMR replaces a
 *    section.
 *
 * A `ResizeObserver` on the document element catches all three of the last kind
 * for free, including **every frame of the docked push's transition**, which is
 * what lets that push animate at all rather than having to land instantly.
 *
 * One bus rather than a listener per surface: two surfaces drawing the same
 * element's box have to agree to the pixel, and the way they used to disagree
 * was by being redrawn from different events. Subscribers must be idempotent —
 * a redraw is fired far more often than anything actually moves — and are
 * coalesced onto one animation frame.
 */

const listeners = new Set<() => void>();
let scheduled = false;
let installed = false;

/** Ask for a redraw. Coalesced — many callers in one frame cost one pass. */
export function requestReflow(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    for (const fn of listeners) fn();
  });
}

function install(): void {
  if (installed) return;
  installed = true;
  addEventListener('scroll', requestReflow, { passive: true, capture: true });
  addEventListener('resize', requestReflow, { passive: true });
  const observer = new ResizeObserver(requestReflow);
  // Both, because either alone has a page shape that defeats it: `<html>` stops
  // tracking content once a site sets `height: 100%` on it, and `<body>` stops
  // tracking the docked push once a site gives it a fixed width.
  observer.observe(document.documentElement);
  observer.observe(document.body);
}

/**
 * Redraw `fn` whenever anything placed in viewport coordinates may have moved.
 * The first subscribe installs the listeners; nothing here runs at module
 * evaluation, so importing this file in Node is safe.
 */
export function onReflow(fn: () => void): () => void {
  install();
  listeners.add(fn);
  return () => listeners.delete(fn);
}
