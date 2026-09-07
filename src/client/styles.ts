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

/** The checkbox tick, as a mask rather than a glyph: the shape comes from here
 *  and the colour from whatever `background` the rule sets, so the tick tracks
 *  `primaryFg` without a second copy of the path living in CSS. Lucide's
 *  `check`, at the stroke weight a 12px box needs to stay crisp. */
const CHECK_MASK =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E\") center / contain no-repeat";

/** Lucide's `chevron-down` as a `background-image`, in a colour baked in at
 *  stylesheet-build time. A select cannot carry a pseudo-element and a mask
 *  would clip the control itself, so the arrow has to be a background — which
 *  means it cannot read a custom property, hence the argument. */
function chevronUrl(color: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' ` +
    `stroke='${color}' stroke-width='2' stroke-linecap='round' ` +
    `stroke-linejoin='round'><path d='m6 9.5 6 6 6-6'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
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

  font: 400 14px/1.45 var(--atx-font-ui);
  color: var(--atx-foreground);
  cursor: auto;
  /* Light type on a near-black ground blooms under subpixel rendering, which
     is what reads as fringed or crunchy. Grayscale antialiasing on both
     engines, plus kerning and the discretionary pairs, is the whole of it;
     everything inside the root inherits all four. */
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  font-kerning: normal;
  text-align: left;
  direction: ltr;
}

/* Form controls carry their own UA font reset, so the smoothing and kerning
   set on :host stop at their boundary and they render a shade crunchier than
   the prose beside them. Restating the four here is the only way across. */
input,
textarea,
select,
button {
  -webkit-font-smoothing: inherit;
  -moz-osx-font-smoothing: inherit;
  text-rendering: inherit;
  font-kerning: inherit;
}

/* ── Shells ────────────────────────────────────────────────────────────────
   The panel, drawer, backdrop and tab strip built by ui.ts. What stays inline
   at those call sites is only what cannot be known here: the computed stacking
   layer (Z_MODAL + n), a caller's width or height override, and the sized-panel
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
  border: 1px solid transparent;
  border-radius: var(--atx-radius-xl);
  background: var(--atx-card);
  color: var(--atx-foreground);
  /* A ring separates the surfaces; the shadow only lifts the panel off the
     page behind it. Two layers rather than one border, because this floats
     over content the overlay does not control and a hairline alone would
     disappear against a light page. */
  box-shadow: 0 0 0 1px var(--atx-border), 0 8px 28px rgba(0, 0, 0, 0.4);
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

/* Same band as the drawer's: a rule and a ground one step down from the panel,
   so the row that completes the modal is plainly not part of its content. */
.atx-panel-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 20px;
  border-top: 1px solid var(--atx-border);
  border-radius: 0 0 var(--atx-radius-xl) var(--atx-radius-xl);
  background: var(--atx-background);
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
  /* The scrolling body is the canvas, one step darker than the cards on it --
     which is the whole reason a card reads as a bounded thing here. The
     title bar and the footer band paint themselves back up to the card
     surface, so the drawer reads as chrome around content. */
  background: var(--atx-background);
  color: var(--atx-foreground);
  box-shadow: -4px 0 16px rgba(0, 0, 0, 0.32);
  font: 400 14px var(--atx-font-ui);
  cursor: auto;
}

/* The drawer's title bar is a card header: a grid so the name and the line
   under it both stop short of the corner action instead of running under it,
   and so the action stays pinned to the top-right however tall the text
   column grows. Two columns only when there is something to put in the
   second -- [data-action], set by group.ts::cardHead. */
.atx-drawer-title {
  display: grid;
  grid-template-columns: 1fr;
  align-items: start;
  gap: 2px 12px;
  flex: 0 0 auto;
  padding: 16px 20px;
  border-bottom: 1px solid var(--atx-border);
  background: var(--atx-card);
}

/* The second column appears only once a caller has actually put something in
   the action slot. :has() rather than a flag the caller has to remember to
   set: the slot is filled after the drawer is built, and a header that
   reserved the column unconditionally would pull the title short of an edge
   with nothing at it. */
.atx-drawer-title:has([data-actions] > *) {
  grid-template-columns: 1fr auto;
}

/* The name and anything qualifying it. min-width: 0 so the title inside can
   still ellipsize -- a grid item defaults to min-content, which would let the
   name push the header wider instead of shortening. */
.atx-drawer-name {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

/* 16px/500 is the only type at that size in a drawer, which is what makes it
   read as the name of the thing rather than as the first of the labels. */
.atx-drawer-title-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--atx-foreground);
  font: 500 16px/1.4 var(--atx-font-ui);
}

/* The line under the name: which file, which collection, what the caveat is.
   Muted ink at body size -- separated from the title by weight and colour,
   not by shrinking it into small print. */
.atx-drawer-subtitle {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--atx-muted-fg);
  font: 400 14px/1.4 var(--atx-font-ui);
}

/* Spans both rows and sits at the top of them, so a one-line and a two-line
   header put their action in the same place. */
.atx-drawer-actions {
  display: flex;
  gap: 6px;
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: start;
  justify-self: end;
}

/* A stack of cards, not a form. The gap is the only spacing the body owns;
   each card brings its own padding, which is what keeps a card's edge a real
   boundary rather than a line drawn through continuous content. */
.atx-drawer-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1 1 auto;
  padding: 16px;
  overflow-y: auto;
}

/* A band, not a strip of the body: a rule above it and a ground half a step
   off the drawer's own are what separate "the form" from "what you do with
   it", and are the reason the footer survives being scrolled up to. */
.atx-drawer-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex: 0 0 auto;
  padding: 16px 20px;
  border-top: 1px solid var(--atx-border);
  background: var(--atx-card);
}

/* The destructive action goes to the far end, away from the pair the user is
   actually choosing between. Cancel and Save are one decision; Delete is a
   different one, and putting all three in a row invites the wrong click. */
.atx-drawer-foot > .atx-btn-destructive:first-child,
.atx-panel-foot > .atx-btn-destructive:first-child {
  margin-right: auto;
}

.atx-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
}

/* == Grouping =============================================================
   group.ts. The structural vocabulary every panel builds its content from:
   a card is a bounded concern, a field group is a run of controls answering
   one question, an item is one row of a list, and a separator is the smaller
   claim a card makes about how far apart two things are.

   These carry no colour of their own beyond a surface and a rule. What they
   own is *distance* -- which is the part a flat run of controls gets wrong
   however well each control is styled. */

/* The edge is a 1px inset shadow rather than a border, so a card can sit
   flush inside a padded body without its own border-box changing the width
   its children get. Same trick shadcn uses, same reason. */
.atx-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px 0 0;
  border-radius: var(--atx-radius-xl);
  background: var(--atx-card);
  box-shadow: 0 0 0 1px var(--atx-border);
}

/* Horizontal padding lives on the header, the body and the footer rather
   than on the card, which is what lets the footer band and a full-bleed
   list run edge to edge inside it. */
.atx-card-head {
  display: grid;
  grid-template-columns: 1fr;
  align-items: start;
  gap: 2px 12px;
  padding: 0 16px;
}

.atx-card-head[data-action] {
  grid-template-columns: 1fr auto;
}

.atx-card-title {
  min-width: 0;
  color: var(--atx-foreground);
  font: 500 16px/1.4 var(--atx-font-ui);
}

.atx-card-desc {
  min-width: 0;
  color: var(--atx-muted-fg);
  font: 400 14px/1.45 var(--atx-font-ui);
}

/* Spans both rows and pins to the top-right, so a card with a description and
   one without put their action in the same place. */
.atx-card-action {
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: start;
  justify-self: end;
}

.atx-card-body {
  padding: 0 16px;
}

/* The card's own footer band. Matches the drawer's for the same reason: the
   action that completes a thing sits below a rule, on a ground half a step
   off the surface it completes. */
.atx-card-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  border-top: 1px solid var(--atx-border);
  border-radius: 0 0 var(--atx-radius-xl) var(--atx-radius-xl);
  background: var(--atx-background);
}

.atx-card-foot > .atx-btn-destructive:first-child {
  margin-right: auto;
}

/* Trailing padding on the last slot, so the card's bottom matches the 16px it
   opens with. A footer brings its own, hence the reset. */
.atx-card > :last-child {
  padding-bottom: 16px;
}

.atx-card > .atx-card-foot:last-child {
  padding-bottom: 16px;
}

/* One question's worth of controls. 20px between fields is wide enough that
   the label of the next one is plainly a new field rather than a second line
   of the last one's help text -- which is the whole job. */
.atx-field-group {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.atx-sep {
  height: 1px;
  flex: 0 0 auto;
  background: var(--atx-border);
}

/* A footnote to the title beside it, so it never takes the slack and never
   wraps: whatever it qualifies is the thing allowed to ellipsize.

   Borrowed from the outline button -- the same 1px input border over the same
   faint fill -- because a chip that reads as chrome sits quietly beside a name,
   where a tone-coloured outline shouted the qualifier louder than the thing it
   qualifies. Muted ink, not foreground: this is text being read, not pressed.
   Radius stays "full", which is the ladder's rule for a badge and the one thing
   keeping it from being mistaken for the button it is coloured like. */
.atx-badge {
  flex: 0 0 auto;
  padding: 2px 8px;
  border: 1px solid var(--atx-input);
  border-radius: var(--atx-radius-full);
  background: var(--atx-control-bg);
  color: var(--atx-muted-fg);
  font: 500 12px/1.4 var(--atx-font-ui);
  white-space: nowrap;
}

/* The one tone that departs from chrome: something the reader has to act on. */
.atx-badge[data-tone='warn'] {
  border-color: var(--atx-warning);
  color: var(--atx-warning);
}

/* == Items ================================================================
   One row: an optional 16px media slot, a text column that takes the slack,
   and actions pinned right. Every list in the overlay is built from this
   rather than each panel growing its own row. */

/* A list, not a stack of tiles. Rows sit flush and a 1px rule separates them:
   the row already carries a transparent 1px border, so the rule is a colour
   change and costs no layout shift. Gaps would make each row read as its own
   object, which is exactly what a list is not. */
.atx-item-group {
  display: flex;
  flex-direction: column;
}

.atx-item-group > .atx-item + .atx-item {
  border-top-color: var(--atx-border);
}

/* Edge to edge in the card body holding it, so the rules reach the card's own
   edges and a hover fill covers the whole row rather than an inset tile. The
   16px it cancels is .atx-card-body's, put back on each row. */
.atx-item-group[data-bleed] {
  margin: 0 -16px;
}

.atx-item-group[data-bleed] > .atx-item {
  padding-right: 16px;
  padding-left: 16px;
  border-right: 0;
  border-left: 0;
  border-radius: 0;
}

/* .atx-card carries no bottom padding, so a bleed list that ends the card
   also ends the card: its last row has to pick up the card's own corners or a
   square hover fill spills past them. Selector says exactly that condition --
   the card can't be given overflow:hidden instead, which would clip a row's
   focus ring. */
.atx-card-body:last-child > .atx-item-group[data-bleed]:last-child > .atx-item:last-child {
  border-bottom-right-radius: var(--atx-radius-xl);
  border-bottom-left-radius: var(--atx-radius-xl);
}

.atx-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: var(--atx-radius-lg);
  color: var(--atx-foreground);
  font: 400 14px var(--atx-font-ui);
}

/* A filled tile, for a row that stands alone. A row inside a list stays
   transparent: there, the list is the object and painting every row makes it
   read as a stack of separate cards. */
.atx-item[data-variant='muted'] {
  border-color: var(--atx-border);
  background: var(--atx-elevated);
}

.atx-item-media {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  color: var(--atx-muted-fg);
}

.atx-item-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 0;
}

.atx-item-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 500 14px/1.4 var(--atx-font-ui);
}

/* 12px here, unlike a field's help text at 14px. A description under a row
   title is an attribute of the row -- a count, a path, a date -- not prose
   the user has to read, and at 14px it competes with the title. */
.atx-item-desc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--atx-muted-fg);
  font: 500 12px/1.5 var(--atx-font-ui);
}

.atx-item-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
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
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 2px;
  width: fit-content;
  max-width: 100%;
  flex: 0 0 auto;
  padding: 3px;
  border-radius: var(--atx-radius-lg);
  background: var(--atx-input-bg);
}

[role='tab'] {
  height: 26px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: var(--atx-radius-md);
  background: transparent;
  color: var(--atx-muted-fg);
  font: 500 13px var(--atx-font-ui);
  white-space: nowrap;
  outline: none;
  cursor: pointer;
  transition: background 150ms, color 150ms;
}

[role='tab']:hover {
  color: var(--atx-foreground);
}

[role='tab'][aria-selected='true'] {
  background: var(--atx-accent);
  color: var(--atx-foreground);
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
   and radius would resize them.

   32px, and on the same radius rung as a form control, so a button beside a
   field lines up and reads as part of the same object rather than as a
   different kind of thing parked next to it. What separates the two is fill
   and weight, not shape. */
.atx-btn-default,
.atx-btn-secondary,
.atx-btn-outline,
.atx-btn-ghost,
.atx-btn-destructive {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  box-sizing: border-box;
  border-radius: var(--atx-radius-lg);
  font: 500 14px/1 var(--atx-font-ui);
  white-space: nowrap;
  outline: none;
  transition: background 150ms, border-color 150ms, color 150ms, box-shadow 150ms;
  cursor: pointer;
}

/* One size down, for a button that is not the point of the surface it sits on:
   a header's corner action, a row's own control. Smaller in every dimension
   at once -- height, type, gap and radius -- because a button that only loses
   height reads as a squashed full-size button rather than as a lesser one. */
.atx-btn-sm {
  height: 28px;
  padding: 0 10px;
  gap: 4px;
  border-radius: var(--atx-radius-md);
  font-size: 12.8px;
}

/* Icon-only: a square, so the glyph sits in the middle of it rather than in
   the middle of a label-shaped box that has no label. */
.atx-btn-icon {
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: var(--atx-radius-md);
}

/* An icon inside a button is sized to the type, not to the button, and sits
   6px from its label -- the gap above. */
.atx-btn-default > .atx-ico,
.atx-btn-secondary > .atx-ico,
.atx-btn-outline > .atx-ico,
.atx-btn-ghost > .atx-ico,
.atx-btn-destructive > .atx-ico {
  width: 16px;
  height: 16px;
}

/* The press. Cheap, and it is most of what makes a button feel like one. */
.atx-btn-default:active:not(:disabled),
.atx-btn-secondary:active:not(:disabled),
.atx-btn-outline:active:not(:disabled),
.atx-btn-ghost:active:not(:disabled),
.atx-btn-destructive:active:not(:disabled) {
  transform: translateY(1px);
}

/* The one emphatic fill. Near-white with dark ink, because on a near-black
   overlay the loudest thing available is light rather than hue. */
.atx-btn-default {
  border: 1px solid transparent;
  background: var(--atx-primary);
  color: var(--atx-primary-fg);
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
  background: ${lift(COLOR.elevated, 10)};
}

/* A body and an edge, which is what shadcn's dark outline button actually is:
   bg-input/30 inside border-input, not a line around nothing. Both halves
   matter and the fill matters more -- with a transparent body this read as
   bare text beside the filled confirm it is paired with, even though the two
   boxes measure the same 32px.

   The edge is the input token (15%), not border (10%): a separator may sit
   under the 3:1 non-text floor, and a control the user has to see to operate
   is not. Both earlier passes here were wrong in opposite directions -- 40%
   read as a boxed-in field, 10% read as a hairline. */
.atx-btn-outline {
  border: 1px solid var(--atx-input);
  background: var(--atx-control-bg);
  color: var(--atx-foreground);
}

.atx-btn-outline:hover:not(:disabled) {
  background: var(--atx-accent);
}

/* The quiet variant, and the only one with no boundary at rest -- so it is
   restricted to a control that sits *inside* another surface and is read as
   part of it: a header's corner action, a toolbar key, a back link. A footer
   action is never ghost. A footer is a band of decisions with nothing else in
   it, and a label floating in one with no box and no edge does not read as a
   button at all; that is what the outline variant is for.

   Full-strength ink, not muted. Muted is for text being *read*, and a control
   painted in it looks disabled before it looks quiet. */
.atx-btn-ghost {
  border: 1px solid transparent;
  background: transparent;
  color: var(--atx-foreground);
}

.atx-btn-ghost:hover:not(:disabled) {
  background: var(--atx-accent);
  color: var(--atx-foreground);
}

/* margin-right: auto pushes a destructive button to the far left of a flex
   footer, away from the safe actions.

   Deliberately an outline where shadcn fills it: a footer that puts a solid
   red beside the solid confirm button reads as two equal calls to action when
   only one of them is the thing the user came to do. The edge is the danger
   colour at 40%, so it states itself without shouting. */
.atx-btn-destructive {
  margin-right: auto;
  border: 1px solid ${hexToRgba(COLOR.destructive, 0.4)};
  background: transparent;
  color: var(--atx-destructive);
}

.atx-btn-destructive:hover:not(:disabled) {
  border-color: ${hexToRgba(COLOR.destructive, 0.7)};
  background: ${hexToRgba(COLOR.destructive, 0.1)};
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

/* -- Focus -----------------------------------------------------------------
   :focus-visible, never :focus -- the ring is for the keyboard, and painting
   it on every mouse click is what makes people turn focus indicators off.

   It carries more weight here than in most designs. A control's resting border
   is transparent, so the ring is not a nicety on top of an outline that is
   already there: it *is* the non-text indication. That is why it is 3px, why
   the ring token is held to 3:1 on every surface, and why the border it paints
   belongs to the same rule. */
.atx-btn-default:focus-visible,
.atx-btn-secondary:focus-visible,
.atx-btn-outline:focus-visible,
.atx-btn-ghost:focus-visible,
.atx-btn-destructive:focus-visible,
[data-input]:focus-visible,
[role='tab']:focus-visible {
  border-color: var(--atx-ring);
  box-shadow: 0 0 0 3px ${hexToRgba(COLOR.ring, 0.3)};
}

.atx-btn-destructive:focus-visible {
  border-color: var(--atx-destructive);
  box-shadow: 0 0 0 3px ${hexToRgba(COLOR.destructive, 0.4)};
}

/* -- Form controls ---------------------------------------------------------
   Inputs, textareas and selects, keyed off [data-input] rather than a class
   because every caller names its own (atx-field-input, atx-collections-input,
   atx-settings-key ...) and there is no shared class to match.

   **A control has no border at rest.** Its edge is where the fill stops, and
   the 1px border is transparent, held in reserve for focus and for an invalid
   value -- which is why those two states read as strongly as they do. Adding a
   solid resting outline is the obvious change to make here, and it is the one
   that would undo the look; see COLOR.input for the trade that buys.

   color-scheme: dark keeps the browser's own chrome -- the date picker's
   calendar popup, number spinners -- light rather than a near-invisible dark
   glyph on a dark field. */
[data-input] {
  width: 100%;
  min-height: 32px;
  padding: 4px 10px;
  box-sizing: border-box;
  border: 1px solid transparent;
  border-radius: var(--atx-radius-lg);
  background: var(--atx-input-bg);
  color: var(--atx-foreground);
  font: 400 14px/1.45 var(--atx-font-ui);
  outline: none;
  transition: color 200ms, background 200ms, border-color 200ms, box-shadow 200ms;
  color-scheme: dark;
}

/* field-sizing grows the box with the prose in it; min-height is the floor for
   browsers without it, so the fallback is a fixed textarea rather than a
   collapsed one. The extra horizontal padding keeps the text clear of the
   corner curve, which a 64px-tall box has plenty of. */
textarea[data-input] {
  min-height: 64px;
  padding: 8px 12px;
  line-height: 1.55;
  resize: vertical;
}

/* The browser's own dropdown arrow is drawn hard against the right edge, at
   whatever weight and size the platform picked, so it sits outside our padding
   and looks nothing like the 16px icons everywhere else in the overlay. We
   draw our own instead: appearance:none removes theirs, and the chevron is a
   background image inset 10px from the edge with the text padded clear of it.

   The glyph's colour is baked in from COLOR.mutedFg rather than read from
   --atx-muted-fg, because a data: URI cannot see a custom property. It is the
   one token a theme override will not move; it is chrome on a control, not
   content, so the trade is worth the alignment. */
select[data-input] {
  height: 32px;
  padding-right: 32px;
  appearance: none;
  -webkit-appearance: none;
  background-image: ${chevronUrl(COLOR.mutedFg)};
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 16px 16px;
  cursor: pointer;
}

select[data-input]:hover:not(:disabled) {
  background-image: ${chevronUrl(COLOR.foreground)};
}

/* The fill is the control, so the fill is what lifts under the pointer.
   background-color, not the shorthand: the shorthand would drop the chevron a
   select paints as its background-image. */
[data-input]:hover:not(:disabled):not(:focus) {
  background-color: rgb(255 255 255 / 0.11);
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
   appear together -- and so a screen reader is told, which the red border on
   its own never did. This is one of the two states the reserved border exists
   for. */
[data-input][aria-invalid='true'] {
  border-color: var(--atx-destructive);
}

[data-input][aria-invalid='true']:focus-visible {
  border-color: var(--atx-destructive);
  box-shadow: 0 0 0 3px ${hexToRgba(COLOR.destructive, 0.4)};
}

/* -- Checkbox --------------------------------------------------------------
   Drawn rather than tinted. accent-color can only recolour the browser's own
   box, and the browser's box is a 2px-radius outlined square: the wrong shape
   whatever colour it is. appearance:none takes the painting and leaves every
   keyboard and assistive behaviour exactly where it was.

   Unchecked it is the full-strength input fill with no border, matching the
   larger controls; checked it is the same near-white as the confirm button,
   with the tick masked out of it. */
input[type='checkbox'] {
  appearance: none;
  -webkit-appearance: none;
  display: inline-grid;
  place-content: center;
  width: 16px;
  height: 16px;
  margin: 0;
  flex: 0 0 auto;
  box-sizing: border-box;
  border: 1px solid transparent;
  border-radius: 4px;
  background: var(--atx-input);
  outline: none;
  transition: background 150ms, border-color 150ms, box-shadow 150ms;
  cursor: pointer;
}

input[type='checkbox']::before {
  content: '';
  width: 12px;
  height: 12px;
  background: var(--atx-primary-fg);
  transform: scale(0);
  transition: transform 120ms ease-out;
  -webkit-mask: ${CHECK_MASK};
  mask: ${CHECK_MASK};
}

input[type='checkbox']:checked {
  border-color: var(--atx-primary);
  background: var(--atx-primary);
}

input[type='checkbox']:checked::before {
  transform: scale(1);
}

input[type='checkbox']:focus-visible {
  border-color: var(--atx-ring);
  box-shadow: 0 0 0 3px ${hexToRgba(COLOR.ring, 0.3)};
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
  padding: 10px 18px;
  border-radius: var(--atx-radius-lg);
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
   an inline display. The verdict colours the outline alone -- its border and
   fill stay inline, because that colour is chosen per element at hover time.
   The pill carries no verdict colour: it says the word, the box round the
   element carries the hue. */

/* The measured rect is inset by OUTLINE_GAP in hover.ts so the border clears
   the element's own edge instead of sitting flush against its ink. */
.atx-outline {
  position: fixed;
  z-index: ${Z};
  display: none;
  border: 2px solid var(--atx-brand);
  border-radius: var(--atx-radius-md);
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
  /* Concentric with the pill buttons inside it: their 6px radius plus the 4px
     of padding around them is the 10px this curve needs to read as wrapping
     them rather than being clipped by them. The left padding is bigger because
     what sits there is a text label, which has no box of its own to inset. */
  padding: 4px 4px 4px 10px;
  border-radius: var(--atx-radius-lg);
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
  border-radius: var(--atx-radius-xl);
  background: rgba(0, 0, 0, 0.9);
  color: var(--atx-muted-fg);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4);
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
  border-radius: var(--atx-radius-md);
  background: transparent;
  color: var(--atx-muted-fg);
  cursor: pointer;
}

.atx-tree-close:hover {
  background: var(--atx-accent);
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
  border-radius: var(--atx-radius-md);
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
  border-radius: var(--atx-radius-md);
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
  background: var(--atx-accent);
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

/* The tag is what the row *is*; the preview and the loc are what it happens to
   contain and where it happens to live. Full-strength ink on the tag against
   the row's muted default is what makes a long tree scannable by shape -- the
   angle brackets included, since they are what say "element" at a glance. */
.atx-tree-tag {
  flex: 0 0 auto;
  color: var(--atx-foreground);
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
  color: var(--atx-faint-fg);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
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
  /* A bar spans its edge from corner to corner, so it has no corners of its
     own to round. Stated rather than left to the default, because every other
     surface in here carries a radius and this one must not pick one up. */
  border-radius: 0;
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
  width: 28px;
  height: 28px;
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
  /* 28px -- the small rung of the button ladder, shared with the launcher and
     the icon buttons so everything in the bar is one height, and the icon
     button (28px wide) is actually square. */
  height: 28px;
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
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 12px;
  border: none;
  border-radius: var(--atx-radius-md);
  background: transparent;
  color: var(--atx-foreground);
  font: 500 14px var(--atx-font-ui);
  text-align: left;
  outline: none;
  cursor: pointer;
}

/* Hover shifts the surface; it does not tint it. A hue on hover competes with
   the one colour that is supposed to mean something. */
.atx-menu-item:hover:not(:disabled) {
  background: var(--atx-accent);
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
  min-width: 220px;
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

/* No margin of its own: distance between fields belongs to the group that
   holds them (.atx-field-group), so a field is the same object wherever it is
   mounted and a lone one does not push a gap below itself. */
.atx-field {
  display: flex;
  flex-direction: column;
}

/* A field the project's own config owns. The dim lands on the control, not on
   the whole stack: the label and the help text are what explain *why* it is
   locked, and dimming the explanation along with the thing it explains is the
   one part a reader still needs at full strength. */
.atx-field[data-locked] [data-input],
.atx-field[data-locked] .atx-field-check {
  opacity: 0.5;
}

/* Full opacity, not a dimmed foreground: a label is read, and dimming it was
   doing the job that a second ink tier does properly. */
.atx-field-label {
  display: block;
  margin-bottom: 8px;
  color: var(--atx-foreground);
  font: 500 14px/1.4 var(--atx-font-ui);
}

/* 14px, not a size down. shadcn's field description is the same size as the
   label and separated by colour alone, which is what keeps a form of mostly
   help text readable rather than a wall of small print. */
.atx-field-help {
  margin-top: 6px;
  color: var(--atx-muted-fg);
  font: 400 14px/1.45 var(--atx-font-ui);
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



/* == Settings drawer =======================================================
   editors/settings-panel.ts. The option controls themselves come from
   fields.ts; what is here is the drawer's own prose, the Unsplash key section
   and the three status lines. Four states are attributes: [data-off] on the
   key section while the photo source is switched off, [data-on] on the error
   and gitignore-warning lines, [data-hidden] on the clear-key button, and
   [data-tone] / [data-mono] on a status word. */

/* A stack of cards under the tab strip, spaced like the entry drawer's. */
.atx-settings-pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 16px;
}

.atx-settings-status,
.atx-settings-key-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font: 13px var(--atx-font-ui);
}

.atx-settings-status {
  margin: 0;
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

/* The access key is a secret with its own endpoint, not an option, so it is a
   card of its own rather than a heading inside the options card. It dims
   whole while the photo source it belongs to is off. */

.atx-settings-key-section[data-off] {
  opacity: 0.55;
}

/* Body size, muted -- a card description that happens to carry a link, so it
   matches .atx-card-desc rather than being a size down from it. */
.atx-settings-blurb {
  margin: 0 0 12px;
  color: var(--atx-muted-fg);
  font: 400 14px/1.45 var(--atx-font-ui);
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
  display: flex;
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
  gap: 6px;
  margin: 8px 0 0;
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

/* The entry rows are whole-width buttons that read as rows in a list. The
   collection rows come from group.ts::item and only add the pointer -- these
   carry the same box as one, so both lists in the drawer are the same object. */
.atx-collections-item {
  display: block;
  width: 100%;
  margin-bottom: 8px;
  padding: 10px 12px;
  border: 1px solid var(--atx-border);
  border-radius: var(--atx-radius-lg);
  background: var(--atx-card);
  color: var(--atx-foreground);
  text-align: left;
  cursor: pointer;
}

.atx-collections-row {
  cursor: pointer;
}

/* Hover moves the surface, the way a menu item and a tree row do. The chevron
   is the affordance at rest; the fill is the confirmation under the pointer. */
.atx-collections-row:hover,
.atx-collections-row:focus-visible {
  background: var(--atx-accent);
  outline: none;
}

.atx-collections-row:focus-visible {
  box-shadow: 0 0 0 2px var(--atx-ring);
}

.atx-collections-item-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* The row's title comes from group.ts::item, which already sets the type; it
   only needs room for the badges that sit beside the name. */
.atx-collections-row .atx-item-title {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: visible;
}

.atx-collections-item-title {
  font: 500 14px var(--atx-font-ui);
}

.atx-collections-item-meta,
.atx-collections-meta {
  color: var(--atx-muted-fg);
  font: 12px var(--atx-font-mono);
}

/* Monospaced, because it is a path and two counts -- data about the row, not
   prose. Same size as any other item description. */
.atx-collections-row .atx-item-desc {
  font-family: var(--atx-font-mono);
}

/* The chevron is the row's affordance, not an action: muted at rest, and it
   steps up with the row under the pointer. */
.atx-collections-row .atx-item-actions {
  color: var(--atx-muted-fg);
}

.atx-collections-row:hover .atx-item-actions {
  color: var(--atx-foreground);
}

.atx-collections-item-meta {
  margin-top: 4px;
}

/* The line under a collection's name: which directory, how many entries, what
   kind of schema. 12px is the item-description size, not a size below it -- it
   is read, and shrinking it was the reason the header felt crowded. */
.atx-collections-meta {
  margin-top: 4px;
  margin-bottom: 16px;
  font-size: 12px;
}

/* The one button on the collections list, under the rows. */
.atx-collections-list > .atx-btn-outline {
  margin-top: 8px;
}

.atx-collections-fieldspane,
.atx-collections-items {
  padding-top: 16px;
}

.atx-collections-head,
.atx-collections-itembar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.atx-collections-head {
  margin-bottom: 8px;
}

.atx-collections-head-create {
  margin-bottom: 16px;
}

.atx-collections-itembar {
  margin-bottom: 16px;
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
  font: 14px var(--atx-font-ui);
}

/* A column with a gap rather than a margin on each card: the gap belongs to
   the list, so a card is the same object wherever it is mounted and the last
   one does not push a space below itself. 12px is the item-group rung. */
.atx-collections-fields,
.atx-collections-newfields {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
}

.atx-collections-error {
  display: none;
  margin: 16px 0 0;
  color: var(--atx-warning);
  font: 13px/1.5 var(--atx-font-ui);
}

.atx-collections-error[data-on] {
  display: block;
}

/* The footer band's action slot, filled by whichever view the pane is showing.
   display:contents so an empty slot takes no space in the band and a filled one
   lays its button out as if the slot were not there -- the list view leaves it
   empty, and a 0-width flex item would still collect the band's gap. */
.atx-collections-primary {
  display: contents;
}

/* One field: its name and remove control, then the two stores side by side.
   16px all round and on the item rung for radius -- this is a card in a list
   of cards, and the 10/12 it used to carry made a form of nine of them read as
   one dense block rather than nine things. */
.atx-collections-field {
  padding: 16px;
  border: 1px solid var(--atx-border);
  border-radius: var(--atx-radius-lg);
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
  margin-bottom: 14px;
}

.atx-collections-field-name {
  color: var(--atx-foreground);
  font: 600 12px var(--atx-font-mono);
}

/* The zod expression this field currently compiles to, verbatim. Set off by
   the card's own rule, so it reads as a footnote about the field rather than
   as one more line of it. */
.atx-collections-expr {
  display: block;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--atx-border);
  color: var(--atx-muted-fg);
  font: 12px var(--atx-font-mono);
  word-break: break-all;
}

.atx-collections-addfield {
  margin-top: 16px;
  padding: 16px;
  border: 1px dashed var(--atx-border);
  border-radius: var(--atx-radius-lg);
}

.atx-collections-addfield > .atx-btn-outline {
  margin-top: 12px;
}

/* The two-store legend — the one piece of chrome that explains the drawer. */
.atx-collections-legend {
  padding: 16px;
  border: 1px solid var(--atx-border);
  border-radius: var(--atx-radius-xl);
  background: var(--atx-background);
  color: var(--atx-muted-fg);
  font: 13px/1.6 var(--atx-font-ui);
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

/* The field's two stores, side by side: they describe the *same* field, and
   the card's whole job is letting you read one against the other. auto-fit
   rather than a fixed pair -- a drawer narrow enough that a control would be
   squeezed off its label stacks them again instead. */
.atx-collections-stores {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  align-items: start;
  gap: 16px 20px;
}

.atx-collections-group {
  min-width: 0;
  padding-left: 14px;
  border-left: 2px solid var(--atx-border);
}

.atx-collections-group[data-off] {
  opacity: 0.6;
}

.atx-collections-caption {
  margin-bottom: 12px;
  color: var(--atx-muted-fg);
  font: 500 12px var(--atx-font-ui);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

/* Muted sits on the label below, not here: colour set on the row is inherited
   by whatever the row holds, which quietly greys the value as well as the word
   naming it. */
.atx-collections-control {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 0 12px;
  color: var(--atx-foreground);
  font: 14px var(--atx-font-ui);
}

/* The last control in a store carries no gap of its own -- the card's padding
   is the space under it. */
.atx-collections-control:last-child {
  margin-bottom: 0;
}

/* Options belong to a select field and to nothing else. */
.atx-collections-control[data-hidden] {
  display: none;
}

.atx-collections-control-label {
  flex: 0 0 78px;
  color: var(--atx-muted-fg);
}

/* min-width:0 so a control shrinks with its column: side by side, a store
   is half the card wide, and an input's intrinsic width would otherwise push
   the row past it. */
.atx-collections-input,
.atx-collections-select {
  min-width: 0;
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
  font: 14px var(--atx-font-ui);
}

/* A field typed into the add form but not yet written. Outlined in the brand
   colour because it is the only thing on screen that is not yet in the file. */
.atx-collections-new {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--atx-brand);
  border-radius: var(--atx-radius-lg);
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

/* The way back out of a collection. It wears the corner-action shape from the
   button system and adds only the one thing that shape cannot know: the
   chevron points the other way, since it is the forward one turned around.

   Neutral, not brand: brandText means *this is on your page and editable*,
   and a back button is the tool talking about its own navigation. */
.atx-collections-back > .atx-ico:first-child {
  transform: rotate(180deg);
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

.atx-collections-note[data-tone='warn'] {
  color: var(--atx-warning);
}

.atx-collections-note[data-tone='muted'] {
  color: var(--atx-muted-fg);
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
  border-radius: var(--atx-radius-lg);
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
  min-height: 32px;
  box-sizing: border-box;
  margin-bottom: 16px;
  padding: 4px 10px;
  border: 1px solid transparent;
  border-radius: var(--atx-radius-lg);
  background: var(--atx-input-bg);
  color: var(--atx-foreground);
  font: 400 14px/1.45 var(--atx-font-ui);
  outline: none;
  transition: background 200ms, border-color 200ms, box-shadow 200ms;
}

.atx-alt-input:focus-visible {
  border-color: var(--atx-ring);
  box-shadow: 0 0 0 3px ${hexToRgba(COLOR.ring, 0.3)};
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

/* Wears the corner-action shape; the only thing left here is where it sits. */
.atx-image-browse-all {
  margin-left: auto;
}

.atx-image-recent {
  width: 100%;
  padding: 0;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border: 1px solid var(--atx-border);
  border-radius: var(--atx-radius-lg);
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
  border: 1px solid var(--atx-border);
  border-radius: var(--atx-radius-lg);
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
   and shape rather than a button's own. */
/* Wears the shared outline button; the flex basis is the only thing left that
   belongs to this row rather than to the button system. */
.atx-image-field-browse {
  flex: 0 0 auto;
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
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border: 1px solid var(--atx-border);
  border-radius: var(--atx-radius-lg);
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

/* A tile that cannot be picked *here* -- an image() asset in a web-path picker
   or the reverse. It stays on screen and says why: the dimming is the shared
   :disabled rule above, and this is only the band that carries the reason.
   Text over the thumbnail, so it needs its own scrim rather than a token. */
.atx-media-reason {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  padding: 3px 6px;
  background: rgba(0, 0, 0, 0.72);
  color: var(--atx-foreground);
  font: 500 11px/1.4 var(--atx-font-ui);
  text-align: center;
  pointer-events: none;
}

/* The caption belongs to the same tile, so it dims with it -- the :disabled
   rule above only reaches the button, and a full-strength filename under a
   greyed-out thumbnail reads as a rendering fault. */
.atx-media-tile[data-off] .atx-media-cap {
  opacity: 0.5;
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
  border-radius: var(--atx-radius-lg);
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

/* Three buttons that were each a hand-copied outline variant -- same border,
   radius, height, ink, hover and focus ring, written out three times and free
   to drift. They wear .atx-btn-outline now; what is left here is only what is
   theirs: where each one sits. */
.atx-btn-retry {
  margin: 12px auto 0;
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
  margin-left: auto;
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
  border-radius: var(--atx-radius-md);
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

/* Hidden until a listing has folders worth scoping to, so its display is a
   state rather than the shared inline-flex above. */
.atx-asset-scope {
  display: none;
  flex: 0 0 auto;
}

.atx-asset-scope[data-on] {
  display: inline-flex;
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
  border-radius: var(--atx-radius-lg);
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
  color: var(--atx-foreground);
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

/* Said before the reason, and about a different element than the reason is:
   muted, because it is context for what follows rather than the verdict. */
.atx-notice-lead {
  margin: 0 0 8px;
  color: var(--atx-muted-fg);
  font: 14px/1.5 var(--atx-font-ui);
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
  margin-bottom: 10px;
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
  border-radius: var(--atx-radius-lg);
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
  border-radius: var(--atx-radius-md);
  background: transparent;
  color: var(--atx-foreground);
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
  box-shadow: 0 0 0 1px var(--atx-border), 0 8px 28px rgba(0, 0, 0, 0.4);
}

.atx-rte-heading-menu[data-on] {
  display: block;
}

.atx-rte-heading-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: var(--atx-radius-md);
  background: transparent;
  color: var(--atx-foreground);
  font: 400 13px var(--atx-font-ui);
  text-align: left;
  cursor: pointer;
}

.atx-rte-btn:hover,
.atx-rte-heading-item:hover {
  background: var(--atx-accent);
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
  padding: 12px;
  border: 1px solid var(--atx-border);
  border-radius: var(--atx-radius-lg);
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
