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

import { BAR_CHIP, BAR_CHIP_HOVER, COLOR, FONT, RADIUS, Z, hexToRgba, lift } from './ui.ts';

const kebab = (k: string): string => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function vars(prefix: string, tokens: Record<string, string>): string {
  return Object.entries(tokens)
    .map(([k, v]) => `  --atx-${prefix}${kebab(k)}: ${v};`)
    .join('\n');
}

/** The admin bar's height. Mirrors BAR_H in admin-bar.ts, which reports the
 *  same number to setChromeInset so docked surfaces keep clear of it. */
const BAR_H = 36;

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

/* == Hover pill and outline ================================================
   hover.ts. The outline and the pill are shown by a [data-on] flag rather than
   an inline display, and everything the verdict colours -- the outline's border
   and fill, the pill's left edge -- stays inline, because that colour is chosen
   per element at hover time. */

.atx-outline {
  position: fixed;
  z-index: ${Z};
  display: none;
  border: 2px solid var(--atx-primary);
  border-radius: var(--atx-radius-sm);
  background: ${hexToRgba(COLOR.primary, 0.08)};
  pointer-events: none;
  transition: all 60ms ease-out;
}

.atx-outline[data-on] {
  display: block;
}

/* The pill is interactive: hovering it keeps it open, and its "open source"
   button jumps to the element's source in the editor. */
.atx-tooltip {
  position: fixed;
  z-index: ${Z + 1};
  display: none;
  /* Column so the loc line and the class/ID chips row stack; each row sizes
     to its own content (flex-start) rather than stretching to the widest. */
  flex-direction: column;
  align-items: flex-start;
  padding: 4px 4px 4px 8px;
  border-radius: var(--atx-radius-sm);
  background: var(--atx-card);
  color: var(--atx-foreground);
  font: 500 12px/1.4 var(--atx-font-mono);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
  white-space: nowrap;
  pointer-events: auto;
  cursor: default;
}

.atx-tooltip[data-on] {
  display: flex;
}

.atx-tooltip-row {
  display: flex;
  align-items: center;
}

/* The label is clickable too — the whole file:loc line opens the in-browser
   source peek (the "open" button next to it is the editor jump). */
.atx-tooltip-label {
  cursor: pointer;
}

.atx-tooltip-label:hover {
  text-decoration: underline;
}

/* The verdict sits in a fixed-width slot: the pill must not resize
   (distracting) when "loading…" upgrades to the real verdict. 8ch fits the
   longest words in the pill's monospace font; shorter verdicts leave a little
   slack instead of shrinking the pill. */
.atx-tooltip-verdict {
  display: inline-block;
  width: 8ch;
}

.atx-tooltip-chips {
  display: none;
  flex-wrap: wrap;
  gap: 4px;
  max-width: 340px;
  margin-top: 5px;
  padding-top: 5px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  white-space: normal;
}

.atx-tooltip-chips[data-on] {
  display: flex;
}

.atx-tooltip-chip {
  padding: 1px 6px;
  border: 1px solid transparent;
  border-radius: var(--atx-radius-sm);
  background: rgba(255, 255, 255, 0.09);
  color: var(--atx-muted-fg);
  font: 500 11px var(--atx-font-mono);
  cursor: default;
}

/* Hovering a chip also pops its rules card; that half stays in JS. */
.atx-tooltip-chip:hover {
  border-color: var(--atx-primary);
}

/* == Element tree ==========================================================
   tree.ts. Its panel, its edge tab and the locked-selection outline are all
   shown by [data-on]; what stays inline is the panel's top/bottom (the admin
   bar reserves a strip of one edge and reports it through onChromeInset), a
   row's indent, and the selection's measured rect. */

.atx-tree {
  position: fixed;
  left: 5px;
  /* Top/bottom rather than a height: the admin bar reserves a strip of one
     edge, and the panel must never sit under it. Both are overwritten inline
     as the inset changes. */
  top: 5px;
  bottom: 5px;
  z-index: ${Z + 3};
  display: none;
  flex-direction: column;
  width: min(320px, 90vw);
  box-sizing: border-box;
  border-right: 1px solid var(--atx-border);
  border-radius: var(--atx-radius-md);
  background: rgba(0, 0, 0, 0.9);
  color: var(--atx-muted-fg);
  box-shadow: 8px 0 40px rgba(0, 0, 0, 0.35);
  font: 12px var(--atx-font-mono);
  /* Edit mode sets a page-wide crosshair; the panel is not click-to-edit. */
  cursor: auto;
}

.atx-tree[data-on] {
  display: flex;
}

.atx-tree-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  padding: 12px 14px;
  border-bottom: 1px solid var(--atx-border);
  color: var(--atx-foreground);
  font: 600 12px var(--atx-font-ui);
}

.atx-tree-title-text {
  flex: 1 1 auto;
}

.atx-tree-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: var(--atx-radius-sm);
  background: rgba(255, 255, 255, 0.08);
  color: var(--atx-foreground);
  cursor: pointer;
}

/* The edge tab that reopens the tree. Only meaningful while editing — outside
   edit mode the tree has nothing live to point at. */
.atx-tree-tab {
  position: fixed;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: ${Z + 3};
  display: none;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 64px;
  padding: 0;
  border: none;
  border-right: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 0 7px 7px 0;
  background: ${hexToRgba(COLOR.glass, 0.88)};
  backdrop-filter: blur(10px);
  color: var(--atx-primary-text);
  box-shadow: 2px 0 14px rgba(0, 0, 0, 0.3);
  cursor: pointer;
}

.atx-tree-tab[data-on] {
  display: flex;
}

.atx-tree-tab:hover {
  color: var(--atx-foreground);
}

.atx-tree-body {
  flex: 1 1 auto;
  padding: 6px 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.atx-tree-selection {
  position: fixed;
  z-index: ${Z};
  display: none;
  border: 2px solid var(--atx-primary);
  border-radius: var(--atx-radius-sm);
  box-shadow: 0 0 0 2px ${COLOR.primary}44, 0 0 12px ${COLOR.primary}66;
  pointer-events: none;
}

.atx-tree-selection[data-on] {
  display: block;
}

/* A row's indent is its depth, so padding-left stays inline. */
.atx-tree-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 10px 2px 0;
  border-radius: var(--atx-radius-sm);
  background: transparent;
  color: var(--atx-muted-fg);
  outline: none;
  outline-offset: -1px;
  white-space: nowrap;
  cursor: pointer;
}

/* Hover-active reads as a dashed ring so it never looks like the solid locked
   selection, even when both land on the same row. The brand tint here is one
   of the places the purple keeps its meaning — it points at your page. */
.atx-tree-row[data-state='active'] {
  background: ${hexToRgba(COLOR.primary, 0.16)};
  color: var(--atx-primary-text);
  outline: 1px dashed var(--atx-primary);
}

.atx-tree-row[data-state='selected'] {
  background: var(--atx-primary);
  color: var(--atx-foreground);
  outline: none;
}

.atx-tree-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 12px;
  color: var(--atx-muted-fg);
  cursor: pointer;
}

.atx-tree-chevron[data-leaf] {
  cursor: default;
}

.atx-tree-tag {
  flex: 0 0 auto;
  font-weight: 600;
}

.atx-tree-preview {
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--atx-muted-fg);
}

.atx-tree-loc {
  flex: 0 0 auto;
  margin-left: auto;
  padding-left: 10px;
  color: var(--atx-muted-fg);
  font-size: 10px;
  text-decoration: underline dotted transparent;
  text-underline-offset: 2px;
  cursor: pointer;
}

.atx-tree-loc:hover {
  color: var(--atx-primary-text);
  text-decoration-color: var(--atx-primary-text);
}

.atx-tree-empty {
  padding: 14px;
  color: var(--atx-muted-fg);
  font: 12px var(--atx-font-ui);
}

/* == Admin bar =============================================================
   admin-bar.ts. Three state flags drive everything the bar does with itself:
   [data-edge] which edge it is docked to, [data-open] whether it is revealed,
   and [data-docked] whether it is in the mode that never retracts (pinned, or
   edit mode, where the bar carries the save state and the way out and so must
   never be off-screen). What stays inline is the menu's measured position and
   the save button's colours, which come from a caller-supplied paint hook
   rather than a fixed vocabulary. */

.atx-bar {
  position: fixed;
  left: 0;
  right: 0;
  height: ${BAR_H}px;
  z-index: ${Z + 4};
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  box-sizing: border-box;
  /* Opaque enough to guarantee the bar's own contrast. At 0.78 a white page
     showed through to an effective #494853, which dropped the hint and menu
     inks to ~3:1; the blur still reads as glass at 0.94, and over a dark page
     (the common case) the two are indistinguishable. */
  background: ${hexToRgba(COLOR.glass, 0.94)};
  backdrop-filter: blur(12px) saturate(1.3);
  color: var(--atx-foreground);
  font: 500 12px var(--atx-font-ui);
  transform: none;
  opacity: 1;
  pointer-events: auto;
  transition: opacity 140ms ease, transform 220ms cubic-bezier(0.4, 0, 0.2, 1);
  /* Edit mode sets a page-wide crosshair; the bar is not click-to-edit. */
  cursor: auto;
}

.atx-bar[data-edge='top'] {
  top: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.09);
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.26);
}

.atx-bar[data-edge='bottom'] {
  bottom: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.09);
  box-shadow: 0 -6px 22px rgba(0, 0, 0, 0.26);
}

/* Resting but never in the way — and still readable. At 0.5 the bar's own
   labels composited down to 2.8:1 against a white page, so the resting bar was
   the least legible thing the overlay drew. 0.72 keeps it recessive without
   going back there.

   The resting bar sits near the AA line, and only the resting bar. Over a
   near-white page a label straight on the bar surface computes to ~5.9:1, and
   the three that sit inside a chip to ~4.8:1 — the chip's white tint lifts the
   surface under the ink, which is what makes those three the worst case.
   Approaching the bar or entering edit mode takes it to opacity 1 and 11:1 or
   better, which is every state a user reads it in for longer than a glance.

   Those are computed figures: they model opacity as the group buffer it is,
   but not backdrop-filter's saturate pass, so treat them as ±0.3 and
   re-measure in the browser — docs/VERIFICATION.md carries that check.
   Recessive-until-touched is the point of the surface, so the number stays
   where it is. Tracked as a deferral on the roadmap board, not a bug, and it
   is why tests/contrast.test.ts pins the tokens rather than this composite,
   which depends on the host page. */
.atx-bar[data-docked]:not([data-open]) {
  opacity: 0.72;
}

/* Unpinned and unrevealed: off the edge entirely, and not swallowing clicks on
   the strip it used to cover. */
.atx-bar:not([data-docked]):not([data-open]) {
  opacity: 0;
  pointer-events: none;
}

.atx-bar:not([data-docked]):not([data-open])[data-edge='top'] {
  transform: translateY(-100%);
}

.atx-bar:not([data-docked]):not([data-open])[data-edge='bottom'] {
  transform: translateY(100%);
}

/* The sliver left behind by a retracted bar, so the edge is still findable. */
.atx-hairline {
  position: fixed;
  left: 0;
  right: 0;
  height: 3px;
  z-index: ${Z + 3};
  display: none;
  background: linear-gradient(90deg, transparent, ${COLOR.primary}88, transparent);
  pointer-events: none;
}

.atx-hairline[data-on] {
  display: block;
}

.atx-hairline[data-edge='top'] {
  top: 0;
}

.atx-hairline[data-edge='bottom'] {
  bottom: 0;
}

.atx-hairline-nub {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  width: 54px;
  height: 3px;
  background: var(--atx-primary);
}

.atx-hairline[data-edge='top'] .atx-hairline-nub {
  top: 0;
  border-radius: 0 0 3px 3px;
}

.atx-hairline[data-edge='bottom'] .atx-hairline-nub {
  bottom: 0;
  border-radius: 3px 3px 0 0;
}

.atx-bar-group {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.atx-bar-group-right {
  margin-left: auto;
  min-width: auto;
}

/* The launcher glyph — the one piece of bar furniture that keeps the brand
   colour, because a product needs one place to be itself. */
.atx-bar-brand {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: var(--atx-radius-md);
  background: var(--atx-primary);
  color: var(--atx-foreground);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
  cursor: pointer;
}

.atx-bar-brand:hover {
  background: ${lift(COLOR.primary)};
}

.atx-bar-sep {
  flex: 0 0 auto;
  width: 1px;
  height: 18px;
  margin: 0 3px;
  background: rgba(255, 255, 255, 0.14);
}

/* The bar's primary ink rather than muted: the resting bar is already at
   reduced opacity, which dims whatever ink sits on it, and a hint is a message
   to be read. Its 10.5px size is what keeps it secondary. */
.atx-bar-hint {
  display: none;
  padding-right: 4px;
  color: var(--atx-foreground);
  font: 500 10.5px/1 var(--atx-font-ui);
  white-space: nowrap;
}

.atx-bar-hint[data-on] {
  display: inline;
}

.atx-bar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: 0 0 auto;
  height: 24px;
  width: auto;
  padding: 0 10px;
  border: none;
  border-radius: var(--atx-radius-md);
  background: ${BAR_CHIP};
  color: var(--atx-foreground);
  font: 600 12px/1 var(--atx-font-ui);
  white-space: nowrap;
  cursor: pointer;
  transition: background 120ms, color 120ms;
}

.atx-bar-btn-icon {
  width: 26px;
  padding: 0;
}

.atx-bar-btn:hover:not(:disabled) {
  background: ${BAR_CHIP_HOVER};
}

.atx-menu-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 9px;
  border: none;
  border-radius: var(--atx-radius-md);
  background: transparent;
  color: var(--atx-foreground);
  font: 500 12.5px var(--atx-font-ui);
  text-align: left;
  cursor: pointer;
}

.atx-menu-item:hover:not(:disabled) {
  background: ${COLOR.primary}38;
}

/* An item whose feature is currently on. */
.atx-bar-btn[data-active],
.atx-menu-item[data-active] {
  background: var(--atx-primary);
  color: var(--atx-foreground);
}

.atx-bar-btn[data-active]:hover:not(:disabled),
.atx-menu-item[data-active]:hover:not(:disabled) {
  background: ${lift(COLOR.primary)};
}

.atx-bar-btn[data-off],
.atx-menu-item[data-off] {
  cursor: default;
}

.atx-bar-btn[data-hidden],
.atx-menu-item[data-hidden] {
  display: none;
}

.atx-menu {
  position: fixed;
  z-index: ${Z + 4};
  display: none;
  flex-direction: column;
  min-width: 208px;
  padding: 5px;
  border: 1px solid var(--atx-border);
  border-radius: var(--atx-radius-md);
  background: ${hexToRgba(COLOR.glassRaised, 0.97)};
  backdrop-filter: blur(14px);
  color: var(--atx-foreground);
  font: 500 12.5px var(--atx-font-ui);
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.5);
  cursor: auto;
}

.atx-menu[data-on] {
  display: flex;
}

.atx-menu-items {
  display: flex;
  flex-direction: column;
}

.atx-menu-foot {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 5px 4px 0;
  padding-top: 7px;
  border-top: 1px solid var(--atx-border);
  color: var(--atx-faint-fg);
  font: 500 10.5px var(--atx-font-mono);
}

.atx-menu-live {
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--atx-info);
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
