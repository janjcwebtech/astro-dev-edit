/**
 * The overlay's one stylesheet, adopted by the shadow root (shadow.ts).
 *
 * Two jobs:
 *
 * 1. **Close the inheritance leak.** Selectors do not cross a shadow boundary,
 *    but inheritance does — a host page's `body { font-family }` and `color`
 *    reach every node in here unless stopped. `:host { all: initial }` stops
 *    them, once, and the declarations after it establish what the overlay
 *    inherits instead.
 *
 * 2. **Publish the tokens as custom properties.** Custom properties *do* cross
 *    the boundary, which makes them the overlay's theming API: a user writes
 *    `astro-dev-edit { --atx-card: #101014 }` in their own CSS and it lands.
 *    See docs/STYLING.md.
 *
 * **The variable block is generated from `ui.ts`'s tokens, never hand-written.**
 * `tests/contrast.test.ts` imports `COLOR` and is the only thing standing
 * between a token and an illegible panel; a hand-maintained CSS copy could
 * drift and the test would still pass while the UI was wrong. Naming rule:
 * camelCase to kebab, prefixed — `mutedFg` → `--atx-muted-fg`.
 *
 * `overlayCss()` is a **function**, not a constant, because ui.ts → shadow.ts →
 * styles.ts → ui.ts is an import cycle: reading `COLOR` at module-evaluation
 * time would hit the temporal dead zone. Reading it at first mount does not.
 */

import { COLOR, FONT, RADIUS } from './ui.ts';

const kebab = (k: string): string => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function vars(prefix: string, tokens: Record<string, string>): string {
  return Object.entries(tokens)
    .map(([k, v]) => `  --atx-${prefix}${kebab(k)}: ${v};`)
    .join('\n');
}

export function overlayCss(): string {
  return `
:host {
  /* The guard. Everything the host page could inherit into the overlay stops
     here; the declarations below are what the overlay inherits instead. */
  all: initial;

  /* No box at all — the host cannot shift the page's layout, and every
     absolutely-positioned child still resolves against the initial containing
     block, exactly as it did as a child of <body>. */
  display: contents;

${vars('', COLOR)}
${vars('radius-', RADIUS)}
${vars('font-', FONT)}

  font: 13px/1.4 var(--atx-font-ui);
  color: var(--atx-foreground);
  cursor: auto;
  -webkit-font-smoothing: antialiased;
  text-align: left;
  direction: ltr;
}

/* The rich-text editor's contenteditable is light-DOM and slotted in (see
   shadow.ts::mountLight), so it is styled by the document, not from here.
   ::slotted reaches only the parts that belong to the drawer rather than to
   the document. */
::slotted(.atx-rte-content) {
  box-sizing: border-box;
}
`;
}
