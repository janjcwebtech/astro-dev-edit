/**
 * The overlay's shadow root — one host element, one stylesheet, one place that
 * knows the boundary exists.
 *
 * Every piece of chrome the overlay draws lives in here. Host-page CSS cannot
 * match a node inside a shadow root in either direction, which is the isolation
 * the overlay needs on an arbitrary site: a `*{color:red!important}` rule on the
 * page cannot reach us, because it cannot make the match in the first place.
 * Astro's own dev toolbar solves the same problem the same way, in the same
 * page.
 *
 * Inheritance is the one thing that *does* cross, so `overlayCss()` opens with
 * `:host { all: initial }` and re-declares what we want inherited. That is the
 * whole guard — see styles.ts.
 *
 * **Created lazily, never at module evaluation.** `ui.ts` imports this module,
 * and `tests/contrast.test.ts` imports `ui.ts` in Node where there is no
 * `document`. Nothing here may touch the DOM until something actually mounts.
 */

import { overlayCss } from './styles.ts';

/** The custom element name. Also the selector users write to theme the overlay
 *  (`astro-dev-edit { --atx-card: … }`), so it is a public name — see
 *  docs/STYLING.md. Never registered with `customElements.define`: it needs no
 *  behavior, and an unknown element is styleable all the same. */
const HOST_TAG = 'astro-dev-edit';

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;

/**
 * Whether a host that already exists has fallen out of the document.
 *
 * `<ClientRouter />` replaces `document.body` wholesale on a navigation,
 * keeping only nodes marked `transition:persist`. The host is created by
 * client JS *after* render, so it carries no such mark and leaves with the
 * outgoing body — while `root` stays non-null, so every later `mount()` goes
 * on appending chrome to a tree that is not in the document. No error, no UI
 * (issue #77).
 *
 * Exported and pure because it is the whole decision, and there is no jsdom in
 * this suite to pin the DOM half. A host that was never created is not
 * detached — there is nothing to put back, and `ensure()` builds one instead.
 */
export function isDetached(
  candidate: { isConnected: boolean } | null,
  attached: object | null,
): boolean {
  return attached !== null && candidate !== null && !candidate.isConnected;
}

/**
 * Put the host back in the current document if a swap took it away.
 *
 * The shadow root and its adopted stylesheet live on the host, not on the
 * body, so re-appending the *same* host restores every panel, bar, outline and
 * toast already inside it — nothing is rebuilt and no state is lost. Returns
 * whether it had to act, so a caller can tell a re-attach from a cold page.
 */
export function reattachOverlay(): boolean {
  if (!isDetached(host, root)) return false;
  document.body.append(host as HTMLElement);
  return true;
}

function ensure(): ShadowRoot {
  // A swap may have happened since the last call; anything reaching for the
  // root now expects it to be live.
  if (root) { reattachOverlay(); return root; }
  host = document.createElement(HOST_TAG);
  // `display: contents` (set in overlayCss) means the host generates no box at
  // all, so it cannot shift the page's layout by so much as a line box, and
  // every absolutely-positioned child still resolves against the initial
  // containing block exactly as it did when it was a child of <body>.
  // Deliberately *not* position/transform/filter/contain: any of those would
  // make the host a containing block and re-anchor our `position: fixed`
  // panels to it.
  document.body.append(host);
  root = host.attachShadow({ mode: 'open' });
  // `open` on purpose: a closed root buys no security — anything on the page can
  // already read our source — and costs the ability to debug the overlay in
  // DevTools.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(overlayCss());
  root.adoptedStyleSheets = [sheet];
  return root;
}

/** Mount overlay chrome. The shadow-root replacement for `document.body.append`
 *  — every panel, drawer, bar and toast goes through here. */
export function mount(...nodes: Node[]): void {
  ensure().append(...nodes);
}


/**
 * True when an event originated inside the overlay's own UI.
 *
 * `composedPath()` rather than `event.target`: a listener on `document` sees a
 * target retargeted to the host element, so any `target.closest(...)` test
 * silently starts answering wrong once the chrome moves in here. The composed
 * path is the real path, and it includes slotted light-DOM nodes — which
 * `root.contains()` would not.
 */
export function isOwnUi(e: Event): boolean {
  return host !== null && e.composedPath().includes(host);
}

/** The focused element *inside* the overlay, or null.
 *  `document.activeElement` reports the host for anything in here. */
export function overlayActiveElement(): Element | null {
  return root ? root.activeElement : null;
}
