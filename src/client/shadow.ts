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

function ensure(): ShadowRoot {
  if (root) return root;
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

/** The shadow root. Query it instead of `document` — `document.querySelector`
 *  does not cross the boundary. */
export function overlayRoot(): ShadowRoot {
  return ensure();
}

/** The host element. Needed for `composedPath().includes(host)` and as the
 *  parent for light-DOM content that is slotted back in (see `mountLight`). */
export function overlayHost(): HTMLElement {
  ensure();
  return host as HTMLElement;
}

/** Mount overlay chrome. The shadow-root replacement for `document.body.append`
 *  — every panel, drawer, bar and toast goes through here. */
export function mount(...nodes: Node[]): void {
  ensure().append(...nodes);
}

/**
 * Mount a node into the **light DOM**, as a child of the host, for `<slot>`-ing
 * back into the shadow tree.
 *
 * Exactly one thing needs this: the rich-text editor's `contenteditable`.
 * Safari's selection and `execCommand` APIs are inert against a node inside a
 * shadow root — `document.execCommand` silently does nothing and
 * `getSelection().anchorNode` retargets to `<body>` — which would kill the
 * markdown toolbar outright. A slotted node is composed into the shadow tree
 * for layout while remaining a light-DOM node, so selection keeps working in
 * every engine. Verified in Chrome, Firefox and WebKit.
 *
 * The cost is that host-page CSS *can* reach a slotted node. That is unchanged
 * from how the editor already worked (its `CONTENT_CSS` is a document-level
 * stylesheet), and it is the reason `content-visibility` of the RTE is styled
 * there rather than in `overlayCss()`.
 */
export function mountLight(node: Node): void {
  ensure();
  (host as HTMLElement).append(node);
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
