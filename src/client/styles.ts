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

import { COLOR, FONT, RADIUS, hexToRgba } from './ui.ts';

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

/* ── Shells ────────────────────────────────────────────────────────────────
   The panel, drawer, backdrop and tab strip built by ui.ts. What stays inline
   at those call sites is only what cannot be known here: the computed stacking
   layer (Z + n), a caller's width or height override, and the sized-panel
   branch, which is a [data-sized] flag rather than an inline display so the
   layout lives in one place. */

.atx-panel {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(420px, 92vw);
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid var(--atx-border);
  border-radius: var(--atx-radius-xl);
  background: var(--atx-card);
  color: var(--atx-foreground);
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
  font: 13px var(--atx-font-ui);
  /* Edit mode sets a crosshair cursor on the whole page; our UI is not a
     click-to-edit surface, so restore normal per-element cursors. */
  cursor: auto;
}

/* A sized panel lays its title/body/foot out as a column so the body is the
   only part that grows; the default auto-height panel is unaffected. */
.atx-panel[data-sized] {
  display: flex;
  flex-direction: column;
}

.atx-panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--atx-border);
  font: 600 13px var(--atx-font-ui);
}

.atx-panel-heading {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.atx-panel-body {
  padding: 16px;
}

/* In a sized panel the body absorbs the leftover height and scrolls;
   'min-height: 0' is what lets a flex child actually shrink to do that. */
.atx-panel[data-sized] .atx-panel-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.atx-panel-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--atx-border);
}

.atx-panel[data-sized] .atx-panel-foot {
  flex: 0 0 auto;
}

.atx-drawer {
  position: fixed;
  right: 0;
  top: 0;
  display: flex;
  flex-direction: column;
  /* Half the screen, but never narrower than the classic 440px drawer and
     never wider than the viewport allows on small screens. */
  height: 100vh;
  width: min(max(440px, 50vw), 94vw);
  box-sizing: border-box;
  border-left: 1px solid var(--atx-border);
  background: var(--atx-card);
  color: var(--atx-foreground);
  box-shadow: -8px 0 40px rgba(0, 0, 0, 0.45);
  font: 13px var(--atx-font-ui);
  cursor: auto;
}

.atx-drawer-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  padding: 14px 16px;
  border-bottom: 1px solid var(--atx-border);
  font: 600 13px var(--atx-font-ui);
}

.atx-drawer-title-text {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.atx-drawer-actions {
  display: flex;
  gap: 6px;
  flex: 0 0 auto;
}

.atx-drawer-body {
  flex: 1 1 auto;
  padding: 16px;
  overflow-y: auto;
}

.atx-drawer-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex: 0 0 auto;
  padding: 12px 16px;
  border-top: 1px solid var(--atx-border);
}

.atx-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
}

/* Tabs are keyed off their ARIA roles, not their classes: buildTabs names
   those per caller (atx-<prefix>-tab), so there is no single class to match,
   and the roles are already there and already correct. Selected state reads
   aria-selected for the same reason it is set at all — one source of truth
   for "this tab is active", instead of a class shadowing an attribute. */
[role='tablist'] {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}

[role='tab'] {
  padding: 6px 14px;
  border: 1px solid transparent;
  border-radius: var(--atx-radius-md);
  background: transparent;
  color: var(--atx-muted-fg);
  font: 600 12px var(--atx-font-ui);
  cursor: pointer;
}

[role='tab'][aria-selected='true'] {
  background: var(--atx-primary);
  color: var(--atx-primary-fg);
}

[data-tabhost] {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

/* == Controls ==============================================================
   Buttons, form controls, the toast, the save veil and the pill button. Three
   of these are keyed off a data attribute rather than a class, because the
   class is chosen by the caller and there is no shared one to match:
   [data-input] for anything built by inputEl(), [data-pill] for pillButton's
   translucent chrome, [data-dimmed] for a button switched off through
   setButtonEnabled. */

/* Keyed off the variant classes, not off .atx-btn alone. Four leaves
   (image.ts, media-modal.ts x2, asset-picker.ts) build their own buttons and
   borrow the atx-btn hook without a variant, and they carry their own box —
   a bare .atx-btn rule would hand them a radius and a padding they have never
   had. They join this rule when their own module is converted. */
.atx-btn-default,
.atx-btn-secondary,
.atx-btn-outline,
.atx-btn-ghost,
.atx-btn-destructive {
  padding: 7px 14px;
  border-radius: var(--atx-radius-md);
  font: 600 13px var(--atx-font-ui);
  cursor: pointer;
}

.atx-btn-default {
  border: 1px solid transparent;
  background: var(--atx-primary);
  color: var(--atx-primary-fg);
}

.atx-btn-secondary {
  border: 1px solid transparent;
  background: var(--atx-elevated);
  color: var(--atx-foreground);
}

.atx-btn-outline {
  border: 1px solid var(--atx-input);
  background: transparent;
  color: var(--atx-foreground);
}

.atx-btn-ghost {
  border: 1px solid transparent;
  background: transparent;
  color: var(--atx-muted-fg);
}

/* margin-right: auto pushes a destructive button to the far left of a flex
   footer, away from the safe actions. */
.atx-btn-destructive {
  margin-right: auto;
  border: 1px solid var(--atx-destructive-border);
  background: transparent;
  color: var(--atx-destructive-text);
}

/* Not :disabled. A button switched off through setButtonEnabled dims; the
   several places that set .disabled directly never did, and making them all
   dim here would be a visual change this conversion is not allowed to make.
   Whether those two populations should be one is a question for the restyle. */
[data-dimmed] {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Baseline for text-ish form controls (inputs, textareas, selects).
   color-scheme: dark makes the browser render native chrome — the date input's
   calendar-picker icon and popup, number spinners — light against the dark
   background instead of as a near-invisible dark glyph. */
[data-input] {
  width: 100%;
  padding: 6px 8px;
  box-sizing: border-box;
  border: 1px solid var(--atx-input);
  border-radius: var(--atx-radius-sm);
  background: var(--atx-background);
  color: var(--atx-foreground);
  font: 13px var(--atx-font-ui);
  color-scheme: dark;
}

[data-pill] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin-left: 8px;
  padding: 2px 7px;
  border: none;
  border-radius: var(--atx-radius-sm);
  background: rgba(255, 255, 255, 0.14);
  color: var(--atx-foreground);
  font: 600 11px var(--atx-font-ui);
  cursor: pointer;
}

[data-pill]:hover {
  background: rgba(255, 255, 255, 0.28);
}

/* Optical centring, which flexbox cannot do for text — see pillButton in
   ui.ts for why an 11px lowercase label reads as sitting low without it. */
.atx-pill-label {
  position: relative;
  top: -1.5px;
}

.atx-toast {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 16px;
  border-radius: var(--atx-radius-md);
  color: var(--atx-primary-fg);
  font: 500 13px var(--atx-font-ui);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  opacity: 0;
  transition: opacity 120ms;
}

.atx-toast[data-shown] {
  opacity: 1;
}

.atx-toast-ok {
  background: var(--atx-success);
}

.atx-toast-err {
  background: var(--atx-destructive);
}

/* The save veil's rect is measured off a host element, so its geometry is the
   one thing that stays inline. */
.atx-veil {
  position: fixed;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--atx-radius-sm);
  background: ${hexToRgba(COLOR.primary, 0.12)};
  pointer-events: all;
}

.atx-veil-chip {
  padding: 2px 8px;
  border-radius: var(--atx-radius-full);
  background: var(--atx-primary);
  color: var(--atx-primary-fg);
  font: 600 11px system-ui;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
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
