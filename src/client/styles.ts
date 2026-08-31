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

import { BAR_CHIP, BAR_CHIP_HOVER, CHECKER, COLOR, FONT, RADIUS, Z, hexToRgba, lift } from './ui.ts';

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

  font: 400 14px/1.45 var(--atx-font-ui);
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
  /* A hairline separates the surfaces; the shadow only lifts the panel off the
     page behind it. A heavy drop shadow doing the separating is the single
     most un-shadcn thing an overlay can do. */
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.32);
  font: 400 14px var(--atx-font-ui);
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
  padding: 16px 20px;
  border-bottom: 1px solid var(--atx-border);
  font: 500 14px var(--atx-font-ui);
}

.atx-panel-heading {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.atx-panel-body {
  padding: 20px;
}

/* A body whose content brings its own edges — the source peek's code pane
   runs to the panel's sides. */
.atx-panel-body[data-flush] {
  padding: 0;
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
  padding: 16px 20px;
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
  box-shadow: -4px 0 16px rgba(0, 0, 0, 0.32);
  font: 400 14px var(--atx-font-ui);
  cursor: auto;
}

.atx-drawer-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  padding: 16px 20px;
  border-bottom: 1px solid var(--atx-border);
  font: 500 14px var(--atx-font-ui);
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
  padding: 20px;
  overflow-y: auto;
}

.atx-drawer-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex: 0 0 auto;
  padding: 16px 20px;
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
/* A segmented control: the strip is the recessed track, and the selected tab
   is a raised card sitting in it. The alternative — a filled accent on the
   selected tab — reads as a call to action, which a tab is not. */
[role='tablist'] {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
  padding: 3px;
  border-radius: var(--atx-radius-lg);
  background: rgb(255 255 255 / 0.06);
}

[role='tab'] {
  height: 28px;
  padding: 0 12px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--atx-muted-fg);
  font: 500 14px var(--atx-font-ui);
  white-space: nowrap;
  cursor: pointer;
  transition: background 120ms, color 120ms;
}

[role='tab']:hover {
  color: var(--atx-foreground);
}

[role='tab'][aria-selected='true'] {
  background: var(--atx-card);
  color: var(--atx-foreground);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
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

/* Every button in the overlay, keyed off the five variant classes. A bare
   .atx-btn rule cannot be the base: four leaves borrow the atx-btn hook
   without a variant and carry their own box, and handing them this padding
   and radius would resize them. */
.atx-btn-default,
.atx-btn-secondary,
.atx-btn-outline,
.atx-btn-ghost,
.atx-btn-destructive {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 36px;
  padding: 0 16px;
  box-sizing: border-box;
  border-radius: var(--atx-radius-md);
  font: 500 14px/1 var(--atx-font-ui);
  white-space: nowrap;
  outline: none;
  transition: background 120ms, border-color 120ms, color 120ms, box-shadow 120ms;
  cursor: pointer;
}

/* An icon inside a button is sized to the type, not to the button. */
.atx-btn-default > svg,
.atx-btn-secondary > svg,
.atx-btn-outline > svg,
.atx-btn-ghost > svg,
.atx-btn-destructive > svg {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
}

/* The one emphatic fill. Near-white with dark ink, because on a near-black
   overlay the loudest thing available is light rather than hue. */
.atx-btn-default {
  border: 1px solid transparent;
  background: var(--atx-primary);
  color: var(--atx-primary-fg);
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
}

.atx-btn-default:hover:not(:disabled) {
  background: ${hexToRgba(COLOR.primary, 0.9)};
}

.atx-btn-secondary {
  border: 1px solid transparent;
  background: var(--atx-elevated);
  color: var(--atx-foreground);
}

.atx-btn-secondary:hover:not(:disabled) {
  background: ${lift(COLOR.elevated, 14)};
}

.atx-btn-outline {
  border: 1px solid var(--atx-input);
  background: transparent;
  color: var(--atx-foreground);
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
}

.atx-btn-outline:hover:not(:disabled) {
  background: var(--atx-elevated);
}

.atx-btn-ghost {
  border: 1px solid transparent;
  background: transparent;
  color: var(--atx-muted-fg);
}

.atx-btn-ghost:hover:not(:disabled) {
  background: rgb(255 255 255 / 0.06);
  color: var(--atx-foreground);
}

/* margin-right: auto pushes a destructive button to the far left of a flex
   footer, away from the safe actions.

   Deliberately an outline where shadcn fills it: a footer that puts a solid
   red beside the solid confirm button reads as two equal calls to action when
   only one of them is the thing the user came to do. */
.atx-btn-destructive {
  margin-right: auto;
  border: 1px solid var(--atx-destructive);
  background: transparent;
  color: var(--atx-destructive);
}

.atx-btn-destructive:hover:not(:disabled) {
  background: ${hexToRgba(COLOR.destructive, 0.12)};
}

/* One dimmed population, not two. setButtonEnabled dims through [data-dimmed]
   and a dozen callers set .disabled directly; a button that is off should look
   off however it got there, or it reads as broken rather than unavailable. */
[data-dimmed],
button:disabled,
[data-input]:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Focus ──────────────────────────────────────────────────────────────────
   :focus-visible, never :focus — the ring is for the keyboard, and painting it
   on every mouse click is what makes people turn focus indicators off. The
   overlay had no focus indicator at all; this is it, and it is the same ring
   on a button, a field and a tab so there is one thing to recognise. */
.atx-btn-default:focus-visible,
.atx-btn-secondary:focus-visible,
.atx-btn-outline:focus-visible,
.atx-btn-ghost:focus-visible,
.atx-btn-destructive:focus-visible,
[data-input]:focus-visible,
[role='tab']:focus-visible {
  border-color: var(--atx-ring);
  box-shadow: 0 0 0 3px ${hexToRgba(COLOR.ring, 0.5)};
}

.atx-btn-destructive:focus-visible {
  border-color: var(--atx-destructive);
  box-shadow: 0 0 0 3px ${hexToRgba(COLOR.destructive, 0.4)};
}

/* ── Form controls ──────────────────────────────────────────────────────────
   Inputs, textareas and selects, keyed off [data-input] rather than a class
   because every caller names its own (atx-field-input, atx-collections-input,
   atx-settings-key …) and there is no shared class to match.

   A field sits one step *lighter* than the panel it is on. Punching a darker
   hole in the surface reads as an absence; a lighter box reads as a container
   you can put something in. color-scheme: dark keeps the browser's own chrome
   — the date picker's calendar popup, number spinners — light rather than a
   near-invisible dark glyph on a dark field. */
[data-input] {
  width: 100%;
  min-height: 36px;
  padding: 0 12px;
  box-sizing: border-box;
  border: 1px solid var(--atx-input);
  border-radius: var(--atx-radius-md);
  background: var(--atx-input-bg);
  color: var(--atx-foreground);
  font: 400 14px/1.4 var(--atx-font-ui);
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  outline: none;
  transition: border-color 120ms, box-shadow 120ms;
  color-scheme: dark;
}

textarea[data-input] {
  min-height: 64px;
  padding: 8px 12px;
  line-height: 1.5;
  resize: vertical;
}

select[data-input] {
  height: 36px;
  cursor: pointer;
}

select[data-input]:hover:not(:disabled) {
  background: rgb(255 255 255 / 0.08);
}

[data-input]::placeholder {
  color: var(--atx-muted-fg);
}

/* The selection inside a field is the loud colour, so a selected run reads as
   selected against a surface that is itself already light. */
[data-input]::selection {
  background: var(--atx-primary);
  color: var(--atx-primary-fg);
}

/* Set by fields.ts alongside the error line, so the boundary and the message
   appear together — and so a screen reader is told, which the red border on
   its own never did. */
[data-input][aria-invalid='true'] {
  border-color: var(--atx-destructive);
}

[data-input][aria-invalid='true']:focus-visible {
  border-color: var(--atx-destructive);
  box-shadow: 0 0 0 3px ${hexToRgba(COLOR.destructive, 0.4)};
}

/* Native checkbox, restyled through accent-color rather than rebuilt: the
   browser draws a near-white box with a dark tick, which is exactly the
   shadcn checked state, and keeps every keyboard and assistive behaviour. */
input[type='checkbox'] {
  width: 16px;
  height: 16px;
  margin: 0;
  flex: 0 0 auto;
  /* accent-color paints the *checked* box; color-scheme is what makes the
     unchecked one dark. Without it the browser draws its light default and an
     unticked box is a white square sitting in a dark panel. */
  color-scheme: dark;
  accent-color: var(--atx-primary);
  outline-offset: 2px;
  cursor: pointer;
}

input[type='checkbox']:focus-visible {
  outline: 2px solid var(--atx-ring);
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
  font: 500 14px var(--atx-font-ui);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.32);
  opacity: 0;
  transition: opacity 120ms;
}

.atx-toast[data-shown] {
  opacity: 1;
}

.atx-toast-ok {
  background: var(--atx-success);
  color: var(--atx-foreground);
}

.atx-toast-err {
  background: var(--atx-destructive);
  color: var(--atx-primary-fg);
}

/* The save veil's rect is measured off a host element, so its geometry is the
   one thing that stays inline. */
.atx-veil {
  position: fixed;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--atx-radius-sm);
  background: ${hexToRgba(COLOR.brand, 0.12)};
  pointer-events: all;
}

.atx-veil-chip {
  padding: 2px 8px;
  border-radius: var(--atx-radius-full);
  background: var(--atx-brand);
  color: var(--atx-foreground);
  font: 600 11px var(--atx-font-ui);
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
  border: 2px solid var(--atx-brand);
  border-radius: var(--atx-radius-sm);
  background: ${hexToRgba(COLOR.brand, 0.08)};
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
  border-color: var(--atx-brand);
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
  border: 1px solid var(--atx-border);
  border-radius: var(--atx-radius-lg);
  background: rgba(0, 0, 0, 0.9);
  color: var(--atx-muted-fg);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.32);
  font: 400 12px/1.5 var(--atx-font-mono);
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
  padding: 14px 16px;
  border-bottom: 1px solid var(--atx-border);
  color: var(--atx-foreground);
  font: 500 14px var(--atx-font-ui);
}

.atx-tree-title-text {
  flex: 1 1 auto;
}

.atx-tree-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: var(--atx-radius-sm);
  background: transparent;
  color: var(--atx-muted-fg);
  cursor: pointer;
}

.atx-tree-close:hover {
  background: rgb(255 255 255 / 0.08);
  color: var(--atx-foreground);
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
  color: var(--atx-brand-text);
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
  border: 2px solid var(--atx-brand);
  border-radius: var(--atx-radius-sm);
  box-shadow: 0 0 0 2px ${COLOR.brand}44, 0 0 12px ${COLOR.brand}66;
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
  padding: 3px 10px 3px 0;
  border-radius: var(--atx-radius-sm);
  background: transparent;
  color: var(--atx-muted-fg);
  outline: none;
  outline-offset: -1px;
  white-space: nowrap;
  cursor: pointer;
}

/* Surface shift, not a tint — every colour in the tree means "this is where
   your element is", so hover must not borrow one. */
.atx-tree-row:hover:not([data-state]) {
  background: rgb(255 255 255 / 0.06);
  color: var(--atx-foreground);
}

/* Hover-active reads as a dashed ring so it never looks like the solid locked
   selection, even when both land on the same row. The brand tint here is one
   of the places the purple keeps its meaning — it points at your page. */
.atx-tree-row[data-state='active'] {
  background: ${hexToRgba(COLOR.brand, 0.16)};
  color: var(--atx-brand-text);
  outline: 1px dashed var(--atx-brand);
}

.atx-tree-row[data-state='selected'] {
  background: var(--atx-brand);
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
  color: var(--atx-brand-text);
  text-decoration-color: var(--atx-brand-text);
}

.atx-tree-empty {
  padding: 14px;
  color: var(--atx-muted-fg);
  font: 400 13px var(--atx-font-ui);
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
  font: 500 13px var(--atx-font-ui);
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
  background: linear-gradient(90deg, transparent, ${COLOR.brand}88, transparent);
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
  background: var(--atx-brand);
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
  background: var(--atx-brand);
  color: var(--atx-foreground);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
  cursor: pointer;
}

.atx-bar-brand:hover {
  background: ${lift(COLOR.brand)};
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
  height: 26px;
  width: auto;
  padding: 0 11px;
  border: none;
  border-radius: var(--atx-radius-md);
  background: ${BAR_CHIP};
  color: var(--atx-foreground);
  font: 500 13px/1 var(--atx-font-ui);
  white-space: nowrap;
  outline: none;
  cursor: pointer;
  transition: background 120ms, color 120ms;
}

.atx-bar-btn-icon {
  width: 28px;
  padding: 0;
}

.atx-bar-btn:focus-visible,
.atx-menu-item:focus-visible {
  box-shadow: 0 0 0 2px ${hexToRgba(COLOR.ring, 0.7)};
}

.atx-bar-btn:hover:not(:disabled) {
  background: ${BAR_CHIP_HOVER};
}

.atx-menu-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: var(--atx-radius-sm);
  background: transparent;
  color: var(--atx-foreground);
  font: 500 13px var(--atx-font-ui);
  text-align: left;
  outline: none;
  cursor: pointer;
}

/* Hover shifts the surface; it does not tint it. A hue on hover competes with
   the one colour that is supposed to mean something. */
.atx-menu-item:hover:not(:disabled) {
  background: rgb(255 255 255 / 0.08);
}

/* An item whose feature is currently on. Near-white with dark ink — the same
   emphasis the confirm button gets, and for the same reason. */
.atx-bar-btn[data-active],
.atx-menu-item[data-active] {
  background: var(--atx-primary);
  color: var(--atx-primary-fg);
}

.atx-bar-btn[data-active]:hover:not(:disabled),
.atx-menu-item[data-active]:hover:not(:disabled) {
  background: ${hexToRgba(COLOR.primary, 0.9)};
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
  min-width: 216px;
  padding: 6px;
  border: 1px solid var(--atx-border);
  border-radius: var(--atx-radius-lg);
  background: ${hexToRgba(COLOR.glassRaised, 0.97)};
  backdrop-filter: blur(14px);
  color: var(--atx-foreground);
  font: 500 13px var(--atx-font-ui);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.42);
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
  margin: 6px 4px 0;
  padding-top: 8px;
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

/* == Entry drawer fields ===================================================
   editors/fields.ts and editors/entry.ts. One control per FieldType, all
   wrapped in the same label/error/help chrome. Two states are attributes
   rather than inline writes: [data-locked] on a field whose option the
   project's config owns, and [data-on] on the error line, which is the only
   part of the stack that is conditionally present. */

.atx-field {
  margin-bottom: 16px;
}

/* A field the project's own config owns. The dim lands on the control, not on
   the whole stack: the label and the help text are what explain *why* it is
   locked, and dimming the explanation along with the thing it explains is the
   one part a reader still needs at full strength. */
.atx-field[data-locked] [data-input],
.atx-field[data-locked] .atx-field-check {
  opacity: 0.5;
}

.atx-field[data-locked] .atx-field-label {
  color: var(--atx-muted-fg);
}

/* Full opacity, not a dimmed foreground: a label is read, and dimming it was
   doing the job that a second ink tier does properly. */
.atx-field-label {
  display: block;
  margin-bottom: 6px;
  color: var(--atx-foreground);
  font: 500 14px/1 var(--atx-font-ui);
}

.atx-field-help {
  margin-top: 6px;
  color: var(--atx-muted-fg);
  font: 400 12px/1.45 var(--atx-font-ui);
}

.atx-field-error {
  display: none;
  margin-top: 6px;
  color: var(--atx-destructive);
  font: 400 12px/1.45 var(--atx-font-ui);
}

.atx-field-error[data-on] {
  display: block;
}

.atx-field-check {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  color: var(--atx-foreground);
  font: 400 14px var(--atx-font-ui);
  cursor: pointer;
}

.atx-field-check-hint {
  opacity: 0.7;
}

.atx-field-checkbox,
.atx-field-select {
  cursor: pointer;
}

/* field-sizing grows the box with the prose in it, which is what a excerpt or
   a description wants; min-height is the floor for browsers without it, so the
   fallback is a fixed textarea rather than a collapsed one. */
.atx-field-textarea {
  min-height: 64px;
  field-sizing: content;
  max-height: 40vh;
}

/* A shape the panel cannot edit: read-only, monospaced, and dimmed so it
   reads as a report of the file rather than as an input. */
.atx-field-json {
  min-height: 48px;
  font: 400 12px/1.5 var(--atx-font-mono);
  opacity: 0.6;
  resize: vertical;
}

/* "+ New" sits in the drawer's title bar rather than its footer, so it is a
   size down from a footer button. */
.atx-entry-new {
  height: 28px;
  padding: 0 12px;
  font: 500 13px var(--atx-font-ui);
}

/* The rule between groups of fields in the entry drawer. */
.atx-section-label {
  margin: 24px 0 12px;
  padding-top: 20px;
  border-top: 1px solid var(--atx-border);
  color: var(--atx-muted-fg);
  font: 500 12px/1 var(--atx-font-ui);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

/* == Settings drawer =======================================================
   editors/settings-panel.ts. The option controls themselves come from
   fields.ts; what is here is the drawer's own prose, the Unsplash key section
   and the three status lines. Four states are attributes: [data-off] on the
   key section while the photo source is switched off, [data-on] on the error
   and gitignore-warning lines, [data-hidden] on the clear-key button, and
   [data-tone] / [data-mono] on a status word. */

.atx-settings-pane {
  padding-top: 12px;
}

.atx-settings-status,
.atx-settings-key-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font: 13px var(--atx-font-ui);
}

.atx-settings-status {
  margin: 0 0 12px;
}

.atx-settings-key-status {
  margin: 0 0 10px;
  color: var(--atx-foreground);
}

.atx-settings-error {
  display: none;
  margin: 10px 0 0;
  color: var(--atx-warning);
  font: 13px/1.5 var(--atx-font-ui);
}

.atx-settings-warning {
  display: none;
  margin: 12px 0 0;
  color: var(--atx-warning);
  font: 12px/1.5 var(--atx-font-ui);
}

.atx-settings-error[data-on],
.atx-settings-warning[data-on] {
  display: block;
}

/* The access key is a secret with its own endpoint, not an option, so it sits
   below a rule rather than among the controls. It dims whole while the photo
   source it belongs to is off. */
.atx-settings-key-section {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--atx-border);
}

.atx-settings-key-section[data-off] {
  opacity: 0.55;
}

.atx-settings-heading {
  margin: 0 0 4px;
  color: var(--atx-foreground);
  font: 500 14px var(--atx-font-ui);
}

.atx-settings-blurb {
  margin: 0 0 12px;
  color: var(--atx-muted-fg);
  font: 13px/1.5 var(--atx-font-ui);
}

/* A tab's own opening line sits a little further from the first control than
   the key section's does from its field. */
.atx-settings-pane-blurb {
  margin: 0 0 14px;
}

.atx-settings-link {
  color: var(--atx-brand-text);
}

.atx-settings-hint {
  margin: 8px 0 0;
  color: var(--atx-muted-fg);
  font: 12px/1.5 var(--atx-font-ui);
}

.atx-settings-row {
  display: flex;
  gap: 6px;
}

.atx-settings-key {
  flex: 1 1 auto;
}

/* The reveal toggle keeps its own width beside the growing key field. */
.atx-settings-row > .atx-btn-outline {
  flex: 0 0 auto;
}

.atx-settings-key-actions {
  margin-top: 10px;
}

/* A destructive button pushes itself to the far left of a footer; here it is
   the only thing in its own row, so that margin has nothing to do. */
.atx-settings-key-actions > .atx-btn-destructive {
  margin-right: 0;
}

.atx-settings-key-actions > .atx-btn-destructive[data-hidden] {
  display: none;
}

.atx-settings-text {
  font: 13px var(--atx-font-ui);
}

.atx-settings-text[data-tone='muted'] {
  color: var(--atx-muted-fg);
}

/* successText, not success: the plain token is a *background* — a dark green
   that reaches 2.7:1 as ink on a panel, which is the mistake the two-token
   split exists to prevent. */
.atx-settings-text[data-tone='ok'] {
  color: var(--atx-success-text);
}

.atx-settings-text[data-tone='warn'] {
  color: var(--atx-warning);
}

.atx-settings-text[data-mono] {
  font: 12px var(--atx-font-mono);
}

/* Muted, not amber: an option the project set in its own config is a normal
   state, and the one warning colour is spent on the uncommitted-secret line. */
.atx-settings-lock {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 4px 0 0;
  color: var(--atx-muted-fg);
  font: 12px/1.45 var(--atx-font-ui);
}

/* == Collections drawer ====================================================
   editors/collections-panel.ts. A field row spans two stores, and the drawer's
   job is to keep saying which is which, so most of what is here is the chrome
   that does the saying: the legend, the two captioned groups, the badges.
   States are attributes: [data-removed] on a card whose removal is queued,
   [data-off] on the schema half of a field the project keeps read-only,
   [data-hidden] on the Options row, which only a select field has,
   [data-on] on the error line, and [data-tone] on a badge or a note. */

.atx-collections {
  padding-top: 12px;
}

/* Both list rows are whole-width buttons that read as cards. */
.atx-collections-row,
.atx-collections-item {
  display: block;
  width: 100%;
  border: 1px solid var(--atx-border);
  border-radius: var(--atx-radius-md);
  background: var(--atx-card);
  color: var(--atx-foreground);
  text-align: left;
  cursor: pointer;
}

.atx-collections-row {
  margin-bottom: 8px;
  padding: 10px 12px;
}

.atx-collections-item {
  margin-bottom: 6px;
  padding: 9px 12px;
}

.atx-collections-row-name,
.atx-collections-item-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.atx-collections-row-name {
  font: 500 14px var(--atx-font-ui);
}

.atx-collections-item-title {
  font: 500 13px var(--atx-font-ui);
}

.atx-collections-row-meta,
.atx-collections-item-meta,
.atx-collections-meta {
  color: var(--atx-muted-fg);
  font: 11px var(--atx-font-mono);
}

.atx-collections-row-meta {
  margin-top: 3px;
}

.atx-collections-item-meta {
  margin-top: 2px;
}

.atx-collections-meta {
  margin-bottom: 12px;
}

/* The one button on the collections list, under the rows. */
.atx-collections-list > .atx-btn-outline {
  margin-top: 4px;
}

.atx-collections-fieldspane,
.atx-collections-items {
  padding-top: 10px;
}

.atx-collections-head,
.atx-collections-itembar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.atx-collections-head {
  margin-bottom: 4px;
}

.atx-collections-head-create {
  margin-bottom: 10px;
}

.atx-collections-itembar {
  margin-bottom: 10px;
}

.atx-collections-title {
  color: var(--atx-foreground);
  font: 500 14px var(--atx-font-ui);
}

.atx-collections-spacer {
  flex: 1 1 auto;
}

.atx-collections-itemcount {
  flex: 1 1 auto;
  color: var(--atx-muted-fg);
  font: 13px var(--atx-font-ui);
}

.atx-collections-fields {
  margin-top: 10px;
}

.atx-collections-newfields {
  margin-top: 12px;
}

.atx-collections-error {
  display: none;
  margin: 10px 0 0;
  color: var(--atx-warning);
  font: 13px/1.5 var(--atx-font-ui);
}

.atx-collections-error[data-on] {
  display: block;
}

.atx-collections-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--atx-border);
}

/* The create form's one action stretches; the detail view's sits centred
   beside the text next to it. */
.atx-collections-actions-create {
  align-items: normal;
}

/* One field: its name and remove control, then the two stores side by side. */
.atx-collections-field {
  margin-bottom: 8px;
  padding: 10px 12px;
  border: 1px solid var(--atx-border);
  border-radius: var(--atx-radius-md);
  background: var(--atx-card);
}

/* Queued for removal, not removed: the card dims and the button offers the
   undo, and nothing is written until Save. */
.atx-collections-field[data-removed] {
  opacity: 0.45;
}

.atx-collections-field-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.atx-collections-field-name {
  color: var(--atx-foreground);
  font: 600 12px var(--atx-font-mono);
}

/* The zod expression this field currently compiles to, verbatim. */
.atx-collections-expr {
  display: block;
  margin-top: 8px;
  color: var(--atx-muted-fg);
  font: 11px var(--atx-font-mono);
  word-break: break-all;
}

.atx-collections-addfield {
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px dashed var(--atx-border);
  border-radius: var(--atx-radius-md);
}

.atx-collections-addfield > .atx-btn-outline {
  margin-top: 8px;
}

/* The two-store legend — the one piece of chrome that explains the drawer. */
.atx-collections-legend {
  padding: 9px 11px;
  border: 1px solid var(--atx-border);
  border-radius: var(--atx-radius-md);
  background: var(--atx-background);
  color: var(--atx-muted-fg);
  font: 12px/1.55 var(--atx-font-ui);
}

/* The colour is repeated from the wrapper rather than inherited: a host page's
   own paragraph colour rule outranks an inherited value, and silently
   repainted this legend in the page's body colour. */
.atx-collections-legend-line {
  margin: 0;
  color: var(--atx-muted-fg);
}

.atx-collections-legend-word {
  color: var(--atx-foreground);
}

.atx-collections-group {
  margin-top: 6px;
  padding-left: 8px;
  border-left: 2px solid var(--atx-border);
}

.atx-collections-group[data-off] {
  opacity: 0.6;
}

.atx-collections-caption {
  margin-bottom: 4px;
  color: var(--atx-muted-fg);
  font: 500 11px var(--atx-font-ui);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.atx-collections-control {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px;
  color: var(--atx-muted-fg);
  font: 13px var(--atx-font-ui);
}

/* Options belong to a select field and to nothing else. */
.atx-collections-control[data-hidden] {
  display: none;
}

.atx-collections-control-label {
  flex: 0 0 74px;
}

.atx-collections-input,
.atx-collections-select {
  flex: 1 1 auto;
}

.atx-collections-checkbox {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 6px;
}

.atx-collections-check {
  margin: 0;
  accent-color: var(--atx-primary);
}

.atx-collections-check-hint {
  color: var(--atx-muted-fg);
  font: 13px var(--atx-font-ui);
}

/* A field typed into the add form but not yet written. Outlined in the brand
   colour because it is the only thing on screen that is not yet in the file. */
.atx-collections-new {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 8px 12px;
  border: 1px solid var(--atx-brand);
  border-radius: var(--atx-radius-md);
  background: var(--atx-card);
}

.atx-collections-new-name {
  color: var(--atx-foreground);
  font: 600 12px var(--atx-font-mono);
}

.atx-collections-new-meta {
  flex: 1 1 auto;
  color: var(--atx-muted-fg);
  font: 12px var(--atx-font-ui);
}

.atx-collections-back {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--atx-brand-text);
  font: 13px var(--atx-font-ui);
  cursor: pointer;
}

.atx-collections-back > .atx-ico {
  transform: rotate(180deg);
}

.atx-collections-badge {
  padding: 1px 6px;
  border-radius: var(--atx-radius-full);
  font: 11px var(--atx-font-ui);
}

.atx-collections-blurb {
  margin: 0 0 12px;
  color: var(--atx-muted-fg);
  font: 13px/1.5 var(--atx-font-ui);
}

.atx-collections-note {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  margin: 0 0 10px;
  font: 12px/1.5 var(--atx-font-ui);
}

.atx-collections-badge[data-tone='warn'],
.atx-collections-note[data-tone='warn'] {
  color: var(--atx-warning);
}

.atx-collections-badge[data-tone='muted'],
.atx-collections-note[data-tone='muted'] {
  color: var(--atx-muted-fg);
}

.atx-collections-badge[data-tone='warn'] {
  border: 1px solid var(--atx-warning);
}

.atx-collections-badge[data-tone='muted'] {
  border: 1px solid var(--atx-muted-fg);
}

/* == Image panel and asset picker ==========================================
   editors/image.ts (the in-page <img> panel) and editors/asset-picker.ts (the
   entry drawer's image field). Both show a preview over a checkerboard, so a
   transparent PNG reads as transparent rather than as a hole. An <img> that
   fails to load takes [data-hidden] rather than showing a broken-image glyph;
   a retry that finally succeeds removes it again — see ui.ts::setFreshSrc. */

.atx-image-preview {
  width: 100%;
  height: 180px;
  max-height: 180px;
  margin-bottom: 10px;
  overflow: hidden;
  border: 1px solid var(--atx-border);
  border-radius: var(--atx-radius-md);
  background: ${CHECKER(14)};
}

/* No display of its own, deliberately: it inherits the inline default, which
   the 180px overflow-hidden box above clips to the same pixels a block would
   occupy. Plan 2 can settle it; a conversion may not. */
.atx-image-preview-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.atx-image-meta {
  margin: 0 0 12px;
  overflow: hidden;
  color: var(--atx-muted-fg);
  font: 11px var(--atx-font-mono);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.atx-note {
  margin: 0 0 12px;
  color: var(--atx-warning);
  font: 400 13px/1.5 var(--atx-font-ui);
}

.atx-alt-label {
  display: block;
  margin-bottom: 6px;
  color: var(--atx-foreground);
  font: 500 14px/1 var(--atx-font-ui);
}

/* Hand-built rather than via inputEl, so it carries the control baseline
   itself. Keep it in step with [data-input]. */
.atx-alt-input {
  width: 100%;
  min-height: 36px;
  box-sizing: border-box;
  margin-bottom: 16px;
  padding: 0 12px;
  border: 1px solid var(--atx-input);
  border-radius: var(--atx-radius-md);
  background: var(--atx-input-bg);
  color: var(--atx-foreground);
  font: 400 14px/1.4 var(--atx-font-ui);
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  outline: none;
  transition: border-color 120ms, box-shadow 120ms;
}

.atx-alt-input:focus-visible {
  border-color: var(--atx-ring);
  box-shadow: 0 0 0 3px ${hexToRgba(COLOR.ring, 0.5)};
}

/* Alt text that comes from an expression: readable, but not yours to type in. */
.atx-alt-input[data-off] {
  opacity: 0.5;
}

/* The six most recent assets. Mirrors RECENTS in editors/image.ts. */
.atx-image-recents {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 6px;
}

.atx-image-recents-label {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0 0 8px;
  color: var(--atx-foreground);
  font: 500 14px/1 var(--atx-font-ui);
}

/* The strip is a convenience; if its listing fails it goes away quietly and
   the modal's Browse all still works. */
.atx-image-recents-label[data-hidden] {
  display: none;
}

.atx-image-browse-all {
  margin-left: auto;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--atx-muted-fg);
  font: 500 13px var(--atx-font-ui);
  cursor: pointer;
}

.atx-image-browse-all:hover {
  color: var(--atx-foreground);
}

.atx-image-recent {
  width: 100%;
  padding: 0;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border: 1px solid var(--atx-border);
  border-radius: var(--atx-radius-md);
  outline: none;
  background: ${CHECKER(10)};
  cursor: pointer;
}

/* The one already on the page. */
.atx-image-recent[data-current] {
  border-color: var(--atx-primary);
  outline: 1px solid var(--atx-primary);
}

.atx-image-recent-thumb {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.atx-image-preview-img[data-hidden],
.atx-image-recent-thumb[data-hidden],
.atx-image-field-thumb[data-hidden],
.atx-image-field-empty[data-hidden],
.atx-media-thumb[data-hidden],
.atx-media-rail-img[data-hidden] {
  display: none;
}

.atx-image-field {
  display: grid;
  gap: 8px;
}

.atx-image-field-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 240px;
  height: 160px;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--atx-input);
  border-radius: var(--atx-radius-md);
  background: ${CHECKER(16)};
  cursor: pointer;
}

.atx-image-field-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.atx-image-field-empty {
  color: var(--atx-muted-fg);
  font: 400 13px var(--atx-font-ui);
  pointer-events: none;
}

.atx-image-field-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.atx-image-field-path {
  flex: 1 1 auto;
  min-width: 0;
  font: 12px var(--atx-font-mono);
}

/* Sits beside the path field in a flex row, so it takes the field's height
   rather than a button's own. */
.atx-image-field-browse {
  flex: 0 0 auto;
  height: 36px;
  padding: 0 14px;
  box-sizing: border-box;
  border: 1px solid var(--atx-input);
  border-radius: var(--atx-radius-md);
  background: transparent;
  color: var(--atx-foreground);
  font: 500 14px/1 var(--atx-font-ui);
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  outline: none;
  transition: background 120ms, border-color 120ms, box-shadow 120ms;
  cursor: pointer;
}

.atx-image-field-browse:hover {
  background: var(--atx-elevated);
}

.atx-image-field-browse:focus-visible {
  border-color: var(--atx-ring);
  box-shadow: 0 0 0 3px ${hexToRgba(COLOR.ring, 0.5)};
}

.atx-image-field-hint {
  color: var(--atx-muted-fg);
  font: 400 12px var(--atx-font-mono);
}

/* == Media grid ============================================================
   editors/media-grid.ts. One tile shape for both panes; the caption sits
   outside the pick button so a credit link is clickable. [data-selected] is
   the ring and the tick together, and [aria-busy] — which the tile already
   carries for assistive tech — is also what dims it during an import. */

.atx-media-pane {
  flex: 1 1 auto;
  min-height: 0;
  padding: 2px;
  overflow-y: auto;
}

/* 132px is the narrowest a tile can be and still read as a picture. */
.atx-media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  align-content: start;
  gap: 12px;
}

.atx-media-more {
  display: flex;
  justify-content: center;
  padding: 14px 0 4px;
}

.atx-media-tile {
  position: relative;
  min-width: 0;
}

.atx-media-pick {
  display: block;
  width: 100%;
  padding: 0;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border: 1px solid var(--atx-border);
  border-radius: var(--atx-radius-md);
  background: ${CHECKER(12)};
  outline: 2px solid transparent;
  outline-offset: 2px;
  transition: outline-color 100ms;
  cursor: pointer;
}

.atx-media-pick[data-selected] {
  outline-color: var(--atx-primary);
}

.atx-media-pick[aria-busy='true'] {
  opacity: 0.45;
  pointer-events: none;
  cursor: progress;
}

.atx-media-thumb {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Shown in place of an image that could not load — blocked by a CSP, offline,
   or deleted. The tile stays usable: its caption reads and it still picks. */
.atx-media-fallback {
  display: none;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--atx-faint-fg);
  font: 18px var(--atx-font-ui);
}

.atx-media-fallback[data-on] {
  display: flex;
}

.atx-media-check {
  position: absolute;
  top: 6px;
  right: 6px;
  display: none;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--atx-primary);
  color: var(--atx-primary-fg);
  font: 700 13px var(--atx-font-ui);
  pointer-events: none;
}

.atx-media-pick[data-selected] .atx-media-check {
  display: flex;
}

.atx-media-current {
  position: absolute;
  top: 6px;
  left: 6px;
  padding: 2px 6px;
  border-radius: var(--atx-radius-sm);
  background: rgba(0, 0, 0, 0.7);
  color: var(--atx-foreground);
  font: 500 11px var(--atx-font-ui);
  pointer-events: none;
}

.atx-media-skeleton-thumb {
  width: 100%;
  aspect-ratio: 4 / 3;
  border: 1px solid var(--atx-border);
  border-radius: var(--atx-radius-md);
  background: var(--atx-elevated);
}

.atx-media-skeleton-cap {
  height: 10px;
  margin: 6px 0 0;
  border-radius: var(--atx-radius-sm);
  background: var(--atx-elevated);
}

/* A message is a full-width row inside the grid, never laid out as a tile. */
.atx-media-status {
  grid-column: 1 / -1;
  padding: 28px 12px;
  color: var(--atx-muted-fg);
  font: 14px/1.6 var(--atx-font-ui);
  text-align: center;
}

.atx-btn-retry {
  display: block;
  margin: 12px auto 0;
  padding: 5px 12px;
  border: 1px solid var(--atx-input);
  border-radius: var(--atx-radius-md);
  background: transparent;
  color: var(--atx-muted-fg);
  font: 500 13px var(--atx-font-ui);
  cursor: pointer;
}

.atx-media-cap {
  margin: 6px 2px 0;
  overflow: hidden;
  color: var(--atx-muted-fg);
  font: 11px/1.4 var(--atx-font-mono);
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* A credit is prose, not a filename. It is permanently visible rather than
   revealed on hover: that is what the API guidelines ask for. */
.atx-media-cap[data-credit] {
  font: 12px/1.4 var(--atx-font-ui);
}

.atx-unsplash-credit {
  color: var(--atx-brand-text);
}

/* == Media modal ===========================================================
   editors/media-modal.ts. The sized panel that holds both panes, the detail
   rail and the drop target. [data-on] opens the drag overlay and reveals the
   scope toggle, which only a scoped listing has anything to say with. */

/* Matched at the sized panel's own specificity: .atx-panel[data-sized]
   .atx-panel-body makes the body the scrolling region, and this body is the
   one that must not scroll — the grid inside it does. */
.atx-media-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.atx-panel[data-sized] .atx-media-body {
  overflow: hidden;
}

.atx-media-tabhost {
  flex: 0 0 auto;
}

.atx-media-upload {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  padding: 6px 12px;
  border: 1px solid var(--atx-input);
  border-radius: var(--atx-radius-md);
  background: transparent;
  color: var(--atx-muted-fg);
  font: 500 13px var(--atx-font-ui);
  cursor: pointer;
}

.atx-media-file {
  display: none;
}

.atx-media-content {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}

.atx-media-panes {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  min-height: 0;
}

.atx-media-rail {
  flex: 0 0 280px;
  width: 280px;
  margin-left: 14px;
  padding-left: 14px;
  border-left: 1px solid var(--atx-border);
  overflow-y: auto;
}

.atx-media-drop {
  flex: 0 0 auto;
  color: var(--atx-muted-fg);
  font: 11px var(--atx-font-mono);
  text-align: center;
}

.atx-media-foot-status {
  grid-column: auto;
  margin-right: auto;
  padding: 0;
  font: 13px var(--atx-font-ui);
  text-align: left;
}

/* A dedicated dashed box would eat grid height, so the modal itself is the
   drop target and this tints it while a file is over it. */
.atx-media-dropzone {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: none;
  border: 2px dashed var(--atx-primary);
  border-radius: var(--atx-radius-xl);
  background: ${hexToRgba(COLOR.primary, 0.18)};
  pointer-events: none;
}

.atx-media-dropzone[data-on] {
  display: block;
}

.atx-media-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
}

.atx-asset-filter {
  flex: 1 1 auto;
  min-width: 0;
  font: 12px var(--atx-font-mono);
}

.atx-asset-scope {
  flex: 0 0 auto;
  display: none;
  padding: 6px 10px;
  border: 1px solid var(--atx-input);
  border-radius: var(--atx-radius-md);
  background: transparent;
  color: var(--atx-muted-fg);
  font: 500 13px var(--atx-font-ui);
  white-space: nowrap;
  cursor: pointer;
}

.atx-asset-scope[data-on] {
  display: block;
}

.atx-media-sort,
.atx-unsplash-orient,
.atx-unsplash-width {
  flex: 0 0 auto;
  width: auto;
  font: 13px var(--atx-font-ui);
}

/* --- the detail rail --- */

.atx-media-rail-empty {
  margin: 0;
  color: var(--atx-muted-fg);
  font: 13px/1.6 var(--atx-font-ui);
}

.atx-media-rail-preview {
  width: 100%;
  aspect-ratio: 4 / 3;
  margin-bottom: 10px;
  overflow: hidden;
  border: 1px solid var(--atx-border);
  border-radius: var(--atx-radius-md);
  background: ${CHECKER(12)};
}

.atx-media-rail-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.atx-media-rail-title {
  margin: 0 0 8px;
  overflow: hidden;
  color: var(--atx-foreground);
  font: 500 14px var(--atx-font-ui);
  text-overflow: ellipsis;
}

.atx-media-rail-line {
  margin: 0 0 6px;
}

.atx-media-rail-key {
  display: block;
  color: var(--atx-muted-fg);
  font: 500 11px var(--atx-font-ui);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.atx-media-rail-value {
  display: block;
  color: var(--atx-muted-fg);
  font: 11px/1.5 var(--atx-font-mono);
  word-break: break-all;
}

.atx-media-rail-link {
  color: var(--atx-brand-text);
  font: 13px/1.5 var(--atx-font-ui);
  word-break: normal;
}

/* == Unsplash pane =========================================================
   editors/unsplash-pane.ts. The search box is a div wearing the control
   baseline, because the magnifier and the field share one bordered box. */

.atx-unsplash-search {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 4px 8px;
}

.atx-unsplash-search > .atx-ico {
  opacity: 0.6;
}

.atx-unsplash-input {
  flex: 1 1 auto;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--atx-foreground);
  font: 14px var(--atx-font-ui);
  outline: none;
}

.atx-media-error-more {
  margin-left: 10px;
  color: var(--atx-warning);
  font: 13px var(--atx-font-ui);
}

.atx-media-error-title {
  margin: 0 0 6px;
  color: var(--atx-foreground);
  font: 500 14px var(--atx-font-ui);
}

.atx-media-error-detail {
  margin: 0 0 12px;
  color: var(--atx-muted-fg);
  font: 13px/1.6 var(--atx-font-ui);
}

/* The only button inside a full-width grid message, so it centres itself. */
.atx-media-error-action {
  margin: 0 auto;
}

.atx-unsplash-rate {
  margin: 14px 0 0;
  color: var(--atx-muted-fg);
  font: 11px var(--atx-font-mono);
}

/* The last few requests of the hour are worth noticing. */
.atx-unsplash-rate[data-tone='warn'] {
  color: var(--atx-warning);
}

/* == Icons =================================================================
   icons.ts. One rule for every glyph in the overlay; the caller sets the size
   on the <svg> itself, so nothing about a size reaches this. */

.atx-ico {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  /* The spinner rotates the host, not the <svg> — an HTML element animates
     predictably where an SVG child would need transform-box juggling. */
  line-height: 0;
}

/* == Small panels ==========================================================
   copy-panel.ts, notice.ts, source-popup.ts, markup.ts — four leaves that put
   one message or one control in a plain panel. [data-on] shows the popup's
   error line; [data-mono] picks the source popup's face, since both faces are
   fixed and only the choice between them is the caller's. */

.atx-copy-note {
  margin: 0 0 10px;
  color: var(--atx-warning);
  font: 14px/1.5 var(--atx-font-ui);
}

.atx-copy-text {
  height: 300px;
  font: 12px/1.5 var(--atx-font-mono);
  white-space: pre;
  resize: vertical;
}

.atx-notice-reason {
  margin: 0 0 6px;
  color: var(--atx-foreground);
  font: 14px/1.5 var(--atx-font-ui);
}

/* The location line opens the source peek, so it reads as a link. */
.atx-notice-loc {
  margin: 0 0 12px;
  color: var(--atx-muted-fg);
  font: 12px var(--atx-font-mono);
  cursor: pointer;
}

.atx-notice-loc:hover {
  text-decoration: underline;
}

.atx-notice-hint {
  margin: 0 0 4px;
  color: var(--atx-brand-text);
  font: 14px/1.5 var(--atx-font-ui);
}

.atx-popup-label {
  display: block;
  margin-bottom: 4px;
  color: var(--atx-foreground);
  font: 500 13px var(--atx-font-ui);
  opacity: 0.8;
}

.atx-popup-input {
  width: 100%;
  min-height: 120px;
  box-sizing: border-box;
  font: 14px/1.6 var(--atx-font-ui);
  white-space: pre-wrap;
  resize: vertical;
}

.atx-popup-input[data-mono] {
  font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
}

.atx-popup-error {
  display: none;
  margin: 10px 0 0;
  color: var(--atx-destructive);
  font: 13px/1.5 var(--atx-font-ui);
}

.atx-popup-error[data-on] {
  display: block;
}

.atx-markup-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
}

.atx-markup-hint {
  margin-right: 2px;
  color: var(--atx-muted-fg);
  font: 12px/1.5 var(--atx-font-ui);
}

.atx-markup-tag {
  padding: 2px 6px;
  border: 1px solid var(--atx-border);
  border-radius: var(--atx-radius-sm);
  background: var(--atx-background);
  color: var(--atx-foreground);
  font: 11px ui-monospace, SFMono-Regular, Menlo, monospace;
  cursor: pointer;
}

/* == Source peek ===========================================================
   editors/peek.ts. A read-only, syntax-tinted view of the file, scrolled to
   the element's line. Every row carries the focus border so the gutter stays
   aligned; only .atx-peek-focus's is visible. [data-tone] is how the loading
   line becomes a refusal or an error, and [data-token] is one run of code. */

.atx-peek-code {
  max-height: 65vh;
  padding: 8px 0;
  overflow: auto;
  background: var(--atx-background);
  font: 12.5px/1.65 var(--atx-font-mono);
}

.atx-peek-more {
  padding: 4px 12px 4px 15px;
  color: var(--atx-faint-fg);
  font-style: italic;
  user-select: none;
}

.atx-peek-line {
  display: flex;
  border-left: 3px solid transparent;
  background: transparent;
}

.atx-peek-focus {
  border-left-color: var(--atx-brand);
  background: ${hexToRgba(COLOR.brand, 0.16)};
}

.atx-peek-gutter {
  flex: 0 0 auto;
  padding: 0 12px 0 0;
  color: var(--atx-faint-fg);
  text-align: right;
  user-select: none;
}

.atx-peek-focus .atx-peek-gutter {
  color: var(--atx-brand-text);
}

.atx-peek-text {
  flex: 1 1 auto;
  padding-right: 16px;
  white-space: pre;
  tab-size: 2;
}

.atx-peek-loading {
  padding: 24px 16px;
  background: var(--atx-background);
  color: var(--atx-muted-fg);
  font: 12.5px var(--atx-font-mono);
}

/* Not source but a sentence, so it wants the line-height source does not. */
.atx-peek-loading[data-tone='warn'] {
  color: var(--atx-warning);
  line-height: 1.6;
}

.atx-peek-loading[data-tone='err'] {
  color: var(--atx-destructive);
}

/* Code token colours on the panel's dark ground. Chosen for contrast, not to
   mimic any one editor theme. This is the only copy of the mapping — peek.ts
   emits the kind and nothing else. */
.atx-peek-token[data-token='plain'] { color: var(--atx-foreground); }
.atx-peek-token[data-token='comment'] { color: var(--atx-muted-fg); font-style: italic; }
.atx-peek-token[data-token='string'] { color: var(--atx-success-text); }
.atx-peek-token[data-token='tag'] { color: var(--atx-brand-text); }
.atx-peek-token[data-token='attr'] { color: var(--atx-brand-text); }
.atx-peek-token[data-token='keyword'] { color: var(--atx-destructive); }
.atx-peek-token[data-token='number'] { color: var(--atx-warning); }
.atx-peek-token[data-token='fence'] { color: var(--atx-muted-fg); }

/* == Rules card ============================================================
   css-inspect.ts. The applied CSS rules behind one class or ID chip on the
   hover pill. Its position is measured, so only that stays inline. The
   declaration palette is deliberately the peek palette's sibling — same job,
   different vocabulary. */

.atx-tooltip-rules {
  position: fixed;
  max-width: 360px;
  max-height: 50vh;
  padding: 8px 10px;
  overflow-y: auto;
  border: 1px solid var(--atx-border);
  border-radius: var(--atx-radius-md);
  background: var(--atx-card);
  color: var(--atx-foreground);
  font: 12px var(--atx-font-mono);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  cursor: default;
}

.atx-tooltip-rules-empty {
  color: var(--atx-muted-fg);
}

/* The first rule sits flush against the top of the card; every one after it
   is separated from the one before, which is what the hairline is for. */
.atx-tooltip-rule {
  padding: 0 0 6px;
}

.atx-tooltip-rule + .atx-tooltip-rule {
  padding: 6px 0;
  border-top: 1px solid var(--atx-border);
}

.atx-tooltip-rule-sel {
  color: var(--atx-brand-text);
  word-break: break-all;
}

/* 10px of breathing room above and below the properties list. */
.atx-tooltip-rule-decl {
  margin: 10px 0;
  color: var(--atx-muted-fg);
  font: 12px var(--atx-font-mono);
  white-space: pre-wrap;
  word-break: break-word;
}

.atx-tooltip-rule-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.atx-tooltip-rule-src {
  overflow: hidden;
  color: var(--atx-muted-fg);
  font: 10.5px var(--atx-font-mono);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.atx-css-token[data-css='prop'] { color: var(--atx-chart5); }
.atx-css-token[data-css='value'] { color: var(--atx-muted-fg); }
.atx-css-token[data-css='string'] { color: var(--atx-chart2); }
.atx-css-token[data-css='number'] { color: var(--atx-chart3); }
.atx-css-token[data-css='variable'] { color: var(--atx-chart1); }
.atx-css-token[data-css='keyword'] { color: var(--atx-chart4); }
.atx-css-token[data-css='punct'] { color: var(--atx-muted-fg); }

/* == Markdown body editor ==================================================
   editors/body-editor.ts. Everything here is the editor's *chrome* — the
   toolbar, the heading menu, the image panel. The writing surface itself
   (.atx-rte-content) is deliberately absent: it stays in the light DOM so
   Safari's selection and execCommand APIs can see it, and ::slotted() loses
   to the document, so its whole box lives in that module's CONTENT_CSS.

   Three states: [data-on] on the heading menu and the image panel, which are
   both closed until asked for, and [data-hidden] on the format buttons, which
   are the half of the toolbar that means nothing in raw-markdown mode. */

.atx-rte-head {
  position: sticky;
  top: 0;
  z-index: 2;
  padding-bottom: 6px;
  background: var(--atx-card);
}

.atx-rte-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  padding: 5px;
  border: 1px solid var(--atx-border);
  border-radius: var(--atx-radius-md);
  background: var(--atx-card);
}

.atx-rte-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: var(--atx-radius-sm);
  background: transparent;
  color: var(--atx-muted-fg);
  font: 500 13px/1 var(--atx-font-ui);
  outline: none;
  transition: background 120ms, color 120ms;
  cursor: pointer;
}

.atx-rte-btn:focus-visible {
  box-shadow: 0 0 0 2px ${hexToRgba(COLOR.ring, 0.7)};
}

/* Each button wears what it does. */
.atx-rte-btn-bold {
  font-weight: 800;
}

.atx-rte-btn-italic {
  font-family: serif;
  font-style: italic;
}

.atx-rte-btn-strike {
  text-decoration: line-through;
}

.atx-rte-btn-pre {
  font: 700 10px var(--atx-font-mono);
}

.atx-rte-btn-code {
  font: 700 13px var(--atx-font-mono);
}

/* The MD/Rich toggle is the only thing on the right of the toolbar. It is the
   editor talking about itself, so it stays neutral. */
.atx-rte-mode {
  margin-left: auto;
  color: var(--atx-muted-fg);
  font: 600 11px var(--atx-font-mono);
  letter-spacing: 0.04em;
}

.atx-rte-divider {
  width: 1px;
  align-self: stretch;
  margin: 3px;
  background: var(--atx-border);
}

.atx-rte-btn[data-hidden],
.atx-rte-divider[data-hidden],
.atx-rte-heading[data-hidden] {
  display: none;
}

.atx-rte-heading {
  position: relative;
  display: inline-flex;
}

.atx-rte-heading-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 3;
  display: none;
  min-width: 150px;
  padding: 4px;
  border: 1px solid var(--atx-border);
  border-radius: var(--atx-radius-lg);
  background: var(--atx-card);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.32);
}

.atx-rte-heading-menu[data-on] {
  display: block;
}

.atx-rte-heading-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 5px 8px;
  border: none;
  border-radius: var(--atx-radius-sm);
  background: transparent;
  color: var(--atx-foreground);
  font: 12px var(--atx-font-ui);
  text-align: left;
  cursor: pointer;
}

.atx-rte-btn:hover,
.atx-rte-heading-item:hover {
  background: rgb(255 255 255 / 0.08);
  color: var(--atx-foreground);
}

.atx-rte-heading-chip {
  min-width: 20px;
  font: 700 11px var(--atx-font-mono);
  opacity: 0.7;
}

/* Each row previews its own level, so the size is the caller's. */
.atx-rte-heading-name {
  font: 600 12px var(--atx-font-ui);
}

/* Insert or replace an image, sharing the asset picker with the image field. */
.atx-rte-image-panel {
  display: none;
  margin: 6px 0 0;
  padding: 10px;
  border: 1px solid var(--atx-border);
  border-radius: var(--atx-radius-md);
  background: var(--atx-background);
}

.atx-rte-image-panel[data-on] {
  display: block;
}

.atx-rte-image-alt-label {
  display: block;
  margin: 10px 0 6px;
  color: var(--atx-foreground);
  font: 500 14px/1 var(--atx-font-ui);
}

.atx-rte-image-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

/* Smaller than a footer button: these sit inside a panel inside a toolbar. */
.atx-rte-image-btn {
  height: 30px;
  padding: 0 12px;
  font: 500 13px/1 var(--atx-font-ui);
}

.atx-rte-image-btn.atx-btn-outline {
  color: var(--atx-muted-fg);
}

/* The raw-markdown half of the MD/Rich toggle. */
.atx-body-input {
  display: none;
  min-height: 40vh;
  padding: 12px;
  font: 400 13px/1.6 var(--atx-font-mono);
  resize: vertical;
}

.atx-body-input[data-on] {
  display: block;
}
`;
}
