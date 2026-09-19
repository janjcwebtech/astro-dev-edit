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
 *
 * ⚠️ **Never type a backtick into the CSS**, not even inside a comment. The
 * rules below are one template literal, so a stray backtick ends the string
 * mid-stylesheet. `tsc --noEmit` stays clean — the result is still valid
 * TypeScript — and the failure surfaces only as a Vite 500 in the browser,
 * with nothing in the terminal to point at this file.
 */

import { DOCK_BAR_H } from './layout-model.ts';
import { BAR_CHIP, BAR_CHIP_HOVER, CHECKER, COLOR, FONT, RADIUS, Z, Z_MODAL, hexToRgba, lift } from './ui.ts';

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
/* The same ground as the element tree on the other edge: the page shows
   faintly through the panel's own surface, while every card on it stays
   opaque — a translucent card would put the page behind the words. */
.atx-inspector {
  display: none; position: fixed; right: 0; top: 0; bottom: 0; margin: 8px;
  width: min(460px, calc(100vw - 16px)); z-index: ${Z + 4};
  color: var(--atx-foreground); background: rgba(0, 0, 0, 0.9);
  border: 1px solid var(--atx-border); border-radius: var(--atx-radius-xl);
  box-shadow: 0 8px 32px #0005; overflow: hidden;
}
.atx-inspector[data-on] { display: flex; flex-direction: column; }
/* Docked, the page is squeezed between the panels rather than running under
   them, so the panel goes flush to its edge: the float, the radius and the
   three borders that no longer face anything all come off, leaving the one
   edge the page is on. The panel stays full height — the code dock spans the
   page column between the panels, never under one. */
.atx-inspector[data-layout="docked"] {
  margin: 0; border-radius: 0; border-width: 0 0 0 1px; box-shadow: none;
}
/* Two bands. The title bar names the tool and the selection; the status row
   under it carries the selection's own answers and the one action scoped to
   it. Keeping them apart is what stops "which element" and "can I trust this"
   reading as the same line. */
.atx-inspector-header { display: flex; align-items: center; gap: 9px; padding: 11px 10px 11px 16px; border-bottom: 1px solid var(--atx-border); }
.atx-inspector-title { flex: 0 0 auto; font: 600 12.5px var(--atx-font-ui); }
.atx-inspector-tag { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 11px var(--atx-font-mono); color: var(--atx-faint-fg); }
.atx-inspector-status { display: flex; align-items: center; gap: 10px; padding: 10px 12px 10px 16px; border-bottom: 1px solid var(--atx-border); }
.atx-inspector-status > .atx-btn { margin-left: auto; flex: 0 0 auto; }
/* Opaque, unlike a plain outline button: the panel ground is translucent, so a
   see-through fill here would show the page through the control. */
.atx-inspector-status > .atx-btn-outline { background: var(--atx-elevated); }
.atx-inspector-status > .atx-btn-outline:hover:not(:disabled) { background: var(--atx-accent); }
.atx-inspector-status > .atx-tier[hidden] { display: none; }
.atx-inspector-body { overflow: auto; min-height: 0; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
.atx-inspector-body > .atx-card { flex: 0 0 auto; }
.atx-inspector .atx-item { flex-wrap: wrap; }
.atx-inspector .atx-item-content { min-width: 0; flex-basis: 180px; }
.atx-inspector .atx-item-title { overflow-wrap: anywhere; }
/* A value the panel can only show, never write, reads as source: chart3 is
   the same ink the declaration tokenizer gives a number, and the peek gives
   a literal. */
.atx-inspector-code { font: 12px/1.6 var(--atx-font-mono); color: var(--atx-chart3); white-space: pre-wrap; overflow-wrap: anywhere; margin: 8px 0; max-height: 220px; overflow: auto; }
.atx-inspector-note { font: 12px/1.5 var(--atx-font-ui); color: var(--atx-muted-fg); overflow-wrap: anywhere; margin: 8px 0; }
.atx-inspector-details { font: 12px/1.5 var(--atx-font-ui); margin: 16px 0 8px; }
.atx-inspector-details > summary { cursor: pointer; color: var(--atx-muted-fg); }
/* Computed styles is a fixed list of thirteen declarations with nothing after
   it to scroll past — a scroller inside the disclosure it already sits in
   would be a second thing to open. */
.atx-inspector-details > .atx-inspector-code { max-height: none; }
/* A Values row is three bands — what it is (title, verdict, badges, caption) ·
   the value · where it goes — so the destination is named once instead of
   three times, and the mechanism vocabulary stays inside the Details
   disclosure the row already owns. */
.atx-inspector .atx-item-title { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
/* A value's name is source, not prose — the same chart5 the declaration
   tokenizer gives a CSS property, for the same reason. */
.atx-value-name { font: 500 12px var(--atx-font-mono); color: var(--atx-chart5); overflow-wrap: anywhere; }
.atx-value-chip { flex: 0 0 auto; border: 1px solid var(--atx-input); border-radius: var(--atx-radius-sm); padding: 1px 6px; font: 500 10.5px var(--atx-font-ui); color: var(--atx-muted-fg); text-transform: lowercase; }
.atx-value-chip[data-chip="editable"] { border-color: var(--atx-success-text); color: var(--atx-success-text); }
.atx-value-chip[data-chip="elsewhere"] { border-color: var(--atx-warning); color: var(--atx-warning); }
.atx-value-chip[data-chip="badge"] { border-style: dashed; color: var(--atx-faint-fg); }
/* Unsaved wears the amber the element wears, and deliberately not the
   selection colour: "this is what I picked" must never read as "this is on
   disk". */
.atx-value-chip[data-chip="unsaved"] { border-color: var(--atx-warning); color: var(--atx-warning); }
.atx-inspector-header > .atx-value-chip { margin-left: auto; }
/* The field, and the one Save/Revert pair under it. Nothing floats over the
   element: a second pair of buttons for the same value is what this design
   removes. What rides with the element is the amber outline, which reports
   state without acting. */
.atx-value-input { width: 100%; box-sizing: border-box; margin: 10px 0 0; font-family: var(--atx-font-mono); font-size: 12px; }
textarea.atx-value-input { min-height: 64px; resize: vertical; }
.atx-value-commit { display: flex; align-items: center; gap: 8px; margin: 9px 0 0; }
.atx-value-commit[hidden] { display: none; }
.atx-value-pending { font: 700 10px var(--atx-font-ui); letter-spacing: 0.06em; text-transform: uppercase; color: var(--atx-warning); }
.atx-value-error { font: 12px/1.5 var(--atx-font-ui); color: var(--atx-destructive); overflow-wrap: anywhere; margin: 7px 0 0; }
.atx-value-error[hidden] { display: none; }
/* One line: the button, then the destination named once, right-aligned and
   yielding first. The path must never push the button away from it. */
.atx-value-foot { display: flex; align-items: center; flex-wrap: nowrap; gap: 10px; margin: 14px 0 0; }
.atx-value-foot > .atx-btn { flex: 0 0 auto; }
.atx-value-where { flex: 1 1 auto; min-width: 0; text-align: right; font: 10.5px var(--atx-font-mono); color: var(--atx-faint-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* Values is a list of bands, not a stack of tiles: the hairline between rows
   is .atx-item-group's, and each row gets the room to be three things — what
   it is, what you type, where it goes — instead of one dense line. Rows hang
   off the group, which is bled to the card's edges, so the vertical rhythm is
   all this has to set. */
/* Flush with the card's gutter, so the hairline between two rows is exactly
   as wide as the content it separates. */
/* Square, because a band is not a tile: a rounded corner on a row separated
   only by a hairline reads as a card that failed to paint. */
.atx-inspector-values .atx-item {
  align-items: flex-start;
  padding: 15px 0 17px;
  border-radius: 0;
}

/* The row you clicked, marked without shouting: a bar, and nothing else. A
   tinted ground behind a field made the one row you are most likely to type
   into the one with the least contrast under the caret. */
.atx-inspector .atx-item[data-pinned] {
  border-left: 2px solid var(--atx-brand-text);
  padding-left: 14px;
}
/* The verdict is the row's answer, so it sits at the right edge in one column
   down the card rather than trailing whatever badges the row happens to have. */
.atx-value-verdict { margin-left: auto; }
/* Every value is a box. Dashed and unfilled where it cannot be typed into —
   the border is what says which is which, so a read-only value never has to
   be read twice to find out. */
.atx-value-readonly {
  margin: 12px 0 0;
  padding: 9px 12px;
  border: 1px dashed var(--atx-border);
  border-radius: var(--atx-radius-lg);
  color: var(--atx-chart3);
  font: 11.5px/1.6 var(--atx-font-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 220px;
  overflow: auto;
}
.atx-inspector .atx-item[data-verdict] > .atx-item-content > .atx-inspector-code { margin-top: 6px; }
/* The panel header's second row: which page the tool is pointed at, and the one
   door onto its source. The title bar above it carries the tool's own controls
   (menu, settings, close) — see .atx-tree-action. */
.atx-inspector-tree-header { padding: 8px 12px 10px; border-bottom: 1px solid var(--atx-border); }
.atx-inspector-route { display: flex; align-items: center; gap: 10px; }
.atx-inspector-route-labels { min-width: 0; flex: 1 1 auto; }
.atx-inspector-route-path { font: 600 12px var(--atx-font-mono); color: var(--atx-foreground); overflow-wrap: anywhere; }
.atx-inspector-route-file { font: 10.5px var(--atx-font-mono); color: var(--atx-faint-fg); overflow-wrap: anywhere; }
.atx-inspector-route-file[data-unresolved] { font-style: italic; }
.atx-inspector-route > .atx-btn { flex: 0 0 auto; }
/* == Component chain ======================================================
   The chain is a nesting, so it is drawn as one: depth as indent, an elbow
   back to the row above, and the file's own glyph. Everything a row can *do*
   stays folded until it is the selected row — a five-deep chain with two
   buttons on every row is a wall, and the question the panel is answering is
   "where did this come from", not "what can I open". */

/* One word on whether the chain can be trusted, in the card's header. The
   three tiers are three different answers, so they are three colours. */
.atx-tier {
  display: inline-flex; align-items: center; border-radius: var(--atx-radius-full);
  padding: 4px 9px; font: 700 10px var(--atx-font-ui); letter-spacing: 0.06em;
  text-transform: uppercase; white-space: nowrap;
}
.atx-tier[data-tier='proven'] { color: var(--atx-success-text); background: ${hexToRgba(COLOR.successText, 0.15)}; }
.atx-tier[data-tier='inferred'] { color: var(--atx-warning); background: ${hexToRgba(COLOR.warning, 0.15)}; }
.atx-tier[data-tier='candidates'],
.atx-tier[data-tier='none'] { color: var(--atx-chart5); background: ${hexToRgba(COLOR.chart5, 0.15)}; }

/* Full-bleed, because a row's indent is measured from the card's edge. Only
   the rows are: a note or a disclosure among them keeps the body's gutter. */
.atx-card-body.atx-chain { padding: 8px 0; }
.atx-chain > :not(.atx-chain-row) { padding-left: 16px; padding-right: 16px; }

.atx-chain-row {
  position: relative; display: flex; align-items: flex-start; gap: 9px;
  padding: 7px 16px 7px calc(16px + var(--atx-d) * 18px);
}
.atx-chain-row[data-usage] { cursor: pointer; }
.atx-chain-row[data-usage]:hover { background: rgba(255, 255, 255, 0.05); }
.atx-chain-row[data-focus] { background: ${hexToRgba(COLOR.brand, 0.2)}; }
.atx-chain-row:focus-visible { outline: 1px solid var(--atx-ring); outline-offset: -2px; }
/* The elbow into the row above. Drawn from the parent's indent, so it lands
   under that row's glyph however deep the chain runs. */
.atx-chain-row::before {
  content: ''; position: absolute; top: 0; height: 17px; width: 9px;
  left: calc(16px + (var(--atx-d) - 1) * 18px + 6px);
  border-left: 1px solid var(--atx-accent); border-bottom: 1px solid var(--atx-accent);
  border-bottom-left-radius: 5px;
}
.atx-chain-row[style*='--atx-d: 0']::before { display: none; }
/* Where the tree stops. Whatever follows the last row — the usages list — is
   a different kind of thing, and without this it reads as one more row that
   happens to have no glyph. Inset to the content, never edge to edge: a rule
   that reaches the card's rim reads as the end of the card. */
.atx-chain-row + :not(.atx-chain-row) {
  position: relative;
  margin-top: 8px;
  padding-top: 13px;
}

.atx-chain-row + :not(.atx-chain-row)::before {
  content: '';
  position: absolute;
  top: 0;
  left: 16px;
  right: 16px;
  border-top: 1px solid var(--atx-border);
}

.atx-chain-ic {
  display: flex; align-items: center; justify-content: center;
  flex: 0 0 auto; width: 13px; height: 18px; color: var(--atx-brand-text);
}
.atx-chain-main { min-width: 0; flex: 1 1 auto; }
.atx-chain-name {
  color: var(--atx-brand-text); font: 700 12px/18px var(--atx-font-mono);
  overflow-wrap: anywhere;
}
/* The element the chain ends at is not a component — it is the thing itself,
   so it wears the panel's own ink rather than the component colour. */
.atx-chain-row[data-kind='leaf'] > .atx-chain-ic { color: var(--atx-foreground); }
.atx-chain-row[data-kind='leaf'] .atx-chain-name { color: var(--atx-foreground); font-weight: 600; }
.atx-chain-row[data-kind='inferred'] > .atx-chain-ic,
.atx-chain-row[data-kind='inferred'] .atx-chain-name { color: var(--atx-warning); }

.atx-chain-sub {
  margin-top: 1px; color: var(--atx-faint-fg); font: 10.5px var(--atx-font-mono);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* Which question this component answers. Two roles, two hues, and a row can
   carry both — the file that draws the markup is often not the one that wrote
   the words, and that split is the whole point of the chain. */
.atx-chain-role {
  display: inline-flex; margin-left: 8px; border-radius: var(--atx-radius-full);
  padding: 2px 7px; font: 700 9.5px var(--atx-font-ui); letter-spacing: 0.04em;
  text-transform: uppercase; vertical-align: 1px;
}
.atx-chain-role[data-role='presentation'] { color: var(--atx-chart5); background: ${hexToRgba(COLOR.chart5, 0.16)}; }
.atx-chain-role[data-role='content'] { color: var(--atx-chart2); background: ${hexToRgba(COLOR.chart2, 0.16)}; }

.atx-chain-acts { display: none; gap: 7px; margin: 9px 0 2px; flex-wrap: wrap; }
.atx-chain-row[data-focus] .atx-chain-acts { display: flex; }
.atx-chain-acts > .atx-inspector-details { flex-basis: 100%; margin: 2px 0 0; }

/* == CSS group ============================================================
   The rule blocks are the hover pill's, shared through
   css-inspect.ts::buildRuleBlock. Inside the panel they become bounded cards
   with the source on a band of its own; the chips above them filter which
   rules are listed. */
.atx-rule-chips { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 12px; }
.atx-rule-chip {
  height: 26px; padding: 0 10px; border: 1px solid var(--atx-input);
  border-radius: var(--atx-radius-sm); background: var(--atx-control-bg);
  color: var(--atx-chart1); font: 11px var(--atx-font-mono); cursor: pointer;
}
.atx-rule-chip:hover { background: var(--atx-accent); }
.atx-rule-chip[data-open='true'] { background: var(--atx-accent); border-color: var(--atx-brand); }

.atx-rule-list { display: flex; flex-direction: column; gap: 10px; }
.atx-inspector .atx-tooltip-rule {
  padding: 0; border: 1px solid var(--atx-border);
  border-radius: var(--atx-radius-lg); overflow: hidden;
}
.atx-inspector .atx-tooltip-rule + .atx-tooltip-rule { padding: 0; border-top: 1px solid var(--atx-border); }
.atx-inspector .atx-tooltip-rule-sel { padding: 10px 13px 0; font: 11px var(--atx-font-mono); color: var(--atx-chart1); }
.atx-inspector .atx-tooltip-rule-decl { margin: 0; padding: 4px 13px 11px; font: 11px/1.7 var(--atx-font-mono); }
.atx-inspector .atx-tooltip-rule-foot {
  gap: 10px; padding: 6px 8px 6px 13px; border-top: 1px solid var(--atx-border);
  background: var(--atx-control-bg);
}
.atx-inspector .atx-tooltip-rule-src { flex: 1 1 auto; min-width: 0; }

/* The chain row a breadcrumb segment named. A ring, not a fill: the row keeps
   whatever it was already saying about itself. */
.atx-inspector [data-usage][data-focus] { box-shadow: inset 2px 0 0 var(--atx-brand-text); }
.atx-inspector-hover { display: none; position: fixed; pointer-events: none; border: 2px solid var(--atx-primary); box-sizing: border-box; z-index: ${Z}; }
.atx-inspector-hover[data-on] { display: block; }
/* The pill itself never takes the pointer — it sits over the page and must not
   eat a click meant for it. The breadcrumb row inside it does, because a
   segment is a button; the app's mousemove handler knows to leave the highlight
   alone while the pointer is travelling over the pill to reach one. */
.atx-inspector-pill { display: none; flex-direction: column; position: fixed; pointer-events: none; z-index: ${Z + 1}; max-width: min(460px, calc(100vw - 24px)); background: var(--atx-card); color: var(--atx-foreground); border: 1px solid var(--atx-border); border-radius: var(--atx-radius-md); font: 12px var(--atx-font-ui); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.36); }
.atx-inspector-pill[data-on] { display: flex; }
.atx-inspector-pill-row { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 5px 8px; }
.atx-inspector-crumbs { display: none; pointer-events: auto; flex-wrap: wrap; align-items: center; gap: 4px; padding: 7px 8px; border-top: 1px solid var(--atx-border); font: 11px var(--atx-font-mono); }
.atx-inspector-crumbs[data-on] { display: flex; }
.atx-crumb { border: 1px solid var(--atx-input); border-radius: var(--atx-radius-sm); background: var(--atx-control-bg); color: var(--atx-brand-text); font: inherit; padding: 2px 7px; }
button.atx-crumb { cursor: pointer; }
button.atx-crumb:hover { background: var(--atx-accent); color: var(--atx-foreground); }
.atx-crumb[data-refused] { border-style: dashed; border-color: var(--atx-warning); color: var(--atx-warning); }
.atx-crumb:last-child:not(button) { background: var(--atx-primary); border-color: var(--atx-primary); color: var(--atx-primary-fg); font-weight: 700; }
.atx-crumb-sep { color: var(--atx-faint-fg); }
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
   at those call sites is only what cannot be known here: the stacking layer
   (Z_MODAL + n, computed from ui.ts), a caller's width or height override, and the sized-panel
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
   list run edge to edge inside it.

   A band, not a floating line: the rule under it is what says where the card's
   name stops and its content starts, and the chevron beside it is what makes a
   stack of cards navigable rather than a single long scroll. */
.atx-card-head {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 2px 10px;
  padding: 0 16px 14px;
  border-bottom: 1px solid var(--atx-border);
}

.atx-card-head[data-action] {
  grid-template-columns: auto 1fr auto;
}

.atx-card-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  grid-row: 1 / span 2;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: var(--atx-radius-sm);
  background: transparent;
  color: var(--atx-faint-fg);
  cursor: pointer;
}

.atx-card-toggle:hover {
  color: var(--atx-foreground);
}

/* Rotated rather than swapped, so the chevron animates and the icon table
   keeps one glyph for one idea. */
.atx-card[data-open='false'] > .atx-card-head > .atx-card-toggle > .atx-ico {
  display: inline-flex;
  transform: rotate(-90deg);
}

/* Collapsed: the head is the whole card, so its rule would be a line under
   nothing. */
.atx-card[data-open='false'] > .atx-card-head {
  padding-bottom: 0;
  border-bottom: 0;
}

.atx-card[data-open='false'] > .atx-card-body,
.atx-card[data-open='false'] > .atx-card-foot {
  display: none;
}

/* The head's own bottom padding plus this gap is the whole of the space under
   the rule; the card's 16px gap would double it. */
.atx-card[data-open='true'] {
  gap: 14px;
}

/* The body's first child brings its own top margin (a note, a paragraph); the
   card's gap is already the space under the rule. */
.atx-card-body > :first-child {
  margin-top: 0;
}

/* Collapsed the head is the card, so it needs the bottom padding the card's
   own shorthand leaves to the body. */
.atx-card[data-open='false'] {
  gap: 0;
  padding-bottom: 16px;
}

.atx-card-title {
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  color: var(--atx-foreground);
  font: 500 16px/1.4 var(--atx-font-ui);
}

/* The card's caveat, folded onto an affordance. Quiet at rest — it is there
   for the reader who wants it, not prose every reader has to step over.

   Set like a footnote index: small, and raised to the title's cap line rather
   than centred on it, so it marks the title instead of sitting in the row as a
   second thing to read. The offset is measured from the 22.4px line box of the
   16px/1.4 title. No cursor of its own — the pointer says nothing the raised
   mark has not already said. */
.atx-card-info {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  align-self: flex-start;
  margin-top: 3px;
  color: var(--atx-faint-fg);
}

.atx-card-info:hover,
.atx-card-info:focus-visible {
  color: var(--atx-brand-text);
  outline: none;
}

.atx-card-desc {
  min-width: 0;
  color: var(--atx-muted-fg);
  font: 400 14px/1.45 var(--atx-font-ui);
}

/* Spans both rows and pins to the top-right, so a card with a description and
   one without put their action in the same place. */
.atx-card-action {
  grid-column: 3;
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

/* The display above beats the UA's [hidden] rule, so a button hidden by state
   would still be laid out -- and would still be read aloud. Every variant is
   listed, because the one that is missing is the one that shows. */
.atx-btn-default[hidden],
.atx-btn-secondary[hidden],
.atx-btn-outline[hidden],
.atx-btn-ghost[hidden],
.atx-btn-destructive[hidden] {
  display: none;
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
   because every caller names its own (atx-field-input, atx-media-filter ...)
   and there is no shared class to match.

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

/* == Switch =================================================================
   ui.ts::switchControl. The same input[type=checkbox] underneath, repainted as
   a track and a thumb — so every rule above has to be overridden here, and the
   selector carries the type and the attribute as well as the class to outrank
   it rather than relying on source order.

   Geometry is shadcn's, measured off the live reference: a 32x18 track and 14px
   of travel. The thumb is 14px inset 2px rather than the reference's 16px inset
   1px -- at this track height a 1px inset survives on the flat top and bottom
   but is eaten by the pill's corner curve at each end, so the checked thumb
   reads as touching the track. 2px is the smallest inset that still shows at
   the ends, and the travel is unchanged (32 - 14 - 2 - 2). The colours are this overlay's own: the
   unchecked track is the full-strength input fill every small control is made
   of, and the checked track is the near-white primary that the confirm button
   and a ticked checkbox already wear -- the brand purple the reference uses
   here is spoken for, and means "this element on your page is editable". */
.atx-switch-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  cursor: pointer;
}

.atx-switch-label {
  color: var(--atx-muted-fg);
  font: 500 12px/1.4 var(--atx-font-ui);
  user-select: none;
}

input[type='checkbox'].atx-switch {
  position: relative;
  display: inline-flex;
  place-content: unset;
  align-items: center;
  width: 32px;
  height: 18px;
  padding: 0;
  border-radius: var(--atx-radius-full);
  background: var(--atx-input);
}

/* The thumb. ::before is the checkbox's tick slot, reused — there is one
   pseudo-element to spend and a switch has one moving part. */
input[type='checkbox'].atx-switch::before {
  content: '';
  position: absolute;
  /* Against the padding box, inside the 1px transparent border the shared
     checkbox rule gives every box: 1px here is the 2px the thumb reads as. */
  left: 1px;
  width: 14px;
  height: 14px;
  border-radius: var(--atx-radius-full);
  background: var(--atx-foreground);
  transform: none;
  transition: transform 150ms ease-out, background 150ms;
  -webkit-mask: none;
  mask: none;
}

input[type='checkbox'].atx-switch:checked {
  border-color: transparent;
  background: var(--atx-primary);
}

/* Travel = track - thumb - both insets. Moving the thumb rather than animating
   left keeps it on the compositor. */
input[type='checkbox'].atx-switch:checked::before {
  background: var(--atx-primary-fg);
  transform: translateX(14px);
}

/* Disabled is handled here rather than inherited: the shared [data-input]
   baseline this control opts out of is what usually carries it. The label dims
   with the track, so the pair reads as one thing switched off. */
input[type='checkbox'].atx-switch:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.atx-switch-row:has(input:disabled) {
  cursor: not-allowed;
}

.atx-switch-row:has(input:disabled) .atx-switch-label {
  opacity: 0.5;
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

/* "Nothing happened, and here is why" — a refusal the user asked for, not a
   fault, so an untouchable package path does not read as the tool breaking.
   Panel surface with warning *ink*, not a warning fill: --atx-warning is an ink
   token, held to AA against the three surfaces and against nothing as a
   background. Same idiom as every other warn tone in this sheet. */
.atx-toast-warn {
  background: var(--atx-elevated);
  color: var(--atx-warning);
  border: 1px solid var(--atx-border);
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
  left: 0;
  /* Top/bottom rather than a height: the admin bar reserves a strip of one
     edge, and the panel must never sit under it. Both are overwritten inline
     as the inset changes — with the bar's strip only, never the code dock's.
     The float away from the edge is the margin below, so the docked variant
     can go flush by dropping it without JS having to know the difference. */
  top: 0;
  bottom: 0;
  margin: 5px;
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

/* Flush to its edge for the same reason the inspector is — see there. */
.atx-tree[data-layout="docked"] {
  margin: 0;
  border-radius: 0;
  border-width: 0 1px 0 0;
  box-shadow: none;
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

.atx-tree-close,
.atx-tree-action {
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

.atx-tree-close:hover,
.atx-tree-action:hover {
  background: var(--atx-accent);
  color: var(--atx-foreground);
}

/* A title-bar action that is a switch (the inspector's layout toggle) wears
   its on state as a brand fill and ring, so docked reads at a glance. */
.atx-tree-action[aria-pressed='true'] {
  background: ${hexToRgba(COLOR.brand, 0.3)};
  box-shadow: inset 0 0 0 1px ${hexToRgba(COLOR.brandText, 0.55)};
  color: var(--atx-brand-text);
}
.atx-tree-action[aria-pressed='true']:hover {
  background: ${hexToRgba(COLOR.brand, 0.45)};
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

/* Open, the tab rides the panel's right edge as its collapse handle. The
   offsets are .atx-tree's own width plus its margin (none when docked). */
.atx-tree[data-on] ~ .atx-tree-tab[data-panel-open] {
  left: calc(min(320px, 90vw) + 5px);
}
.atx-tree[data-on][data-layout="docked"] ~ .atx-tree-tab[data-panel-open] {
  left: min(320px, 90vw);
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

/* The leading mark: ❖ where a component's markup begins, an in-arrow where the
   content was passed in through a slot. Colour carries the distinction as much
   as the glyph does at 12px, and the legend under the body names both. */
.atx-tree-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 12px;
}

.atx-tree-mark[data-kind='component'] {
  color: var(--atx-brand-text);
}

.atx-tree-mark[data-kind='slot'] {
  color: var(--atx-warning);
}

/* A selected row paints itself brand-solid, so a brand-coloured mark on it
   would vanish; both kinds ride the row's own ink there instead. */
.atx-tree-row[data-state='selected'] .atx-tree-mark {
  color: inherit;
}

/* The tag is what the row *is*; the preview and the loc are what it happens to
   contain and where it happens to live. Full-strength ink on the tag against
   the row's muted default is what makes a long tree scannable by shape -- the
   angle brackets included, since they are what say "element" at a glance. */
.atx-tree-tag {
  /* Shrinkable only as a backstop: the note absorbs a cramped row first (see
     its rule), and the tag gives way only once the note is down to nothing —
     a very deep indent with no note to spend. */
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--atx-foreground);
  font-weight: 600;
}

/* The row's shock absorber: a cramped row gives up the note long before the
   tag, and never the code button, which is fixed-width. Its full text is in
   the row's own title, so an ellipsis here costs nothing.

   The factor is 1e5, not 2, for a sub-pixel reason. Flex splits a shortfall
   by shrink x basis, so a tag weighted 1 against a note weighted 999 still
   loses ~0.02px of a 112px shortfall — enough to trip text-overflow and eat a
   whole character off a row that had 80px of note still to give. 1e5 puts the
   tag's share below the layout quantum, and once the note freezes at zero the
   tag's own factor of 1 lets it absorb the rest in full (a sum below 1 would
   see CSS Flexbox §9.7 distribute only that fraction, leaving the overflow to
   run off the panel's clipped edge in silence). */
.atx-tree-preview {
  flex: 0 100000 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--atx-muted-fg);
}

/* Where the row was written, as one fixed-width button rather than a column of
   text. A file:line reading Component.astro:15:40 is wider than the tag and
   the indent together, and in a 320px panel it can only ever be shown
   truncated — so the row says it in a tooltip and spends the width on the
   markup instead. */
.atx-tree-loc {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  margin-left: auto;
  padding: 0;
  border: none;
  border-radius: var(--atx-radius-sm);
  background: transparent;
  color: var(--atx-faint-fg);
  cursor: pointer;
}

/* Faint at rest so a column of identical glyphs stays quiet, and lifted the
   moment the row is under the pointer — which is when it is reachable. */
.atx-tree-row:hover .atx-tree-loc {
  color: var(--atx-muted-fg);
}

/* A brand tint, not --atx-accent: the row's own hover already paints accent
   behind this button, so an accent surface here changed nothing at all. The
   selector repeats .atx-tree-row for weight — the rule above it is one class
   heavier and was winning the colour. */
.atx-tree-row .atx-tree-loc:hover,
.atx-tree-row .atx-tree-loc:focus-visible {
  background: ${hexToRgba(COLOR.brand, 0.28)};
  color: var(--atx-brand-text);
  outline: none;
}

/* On the brand-solid selected row the accent hover and the brand ink both
   disappear; the button rides the row's own ink and lifts on hover instead. */
.atx-tree-row[data-state='selected'] .atx-tree-loc {
  color: inherit;
  opacity: 0.75;
}

.atx-tree-row[data-state='selected'] .atx-tree-loc:hover {
  background: rgba(255, 255, 255, 0.18);
  color: inherit;
  opacity: 1;
}

.atx-tree-empty {
  padding: 14px;
  color: var(--atx-muted-fg);
  font: 400 13px var(--atx-font-ui);
}

/* The overlay's tooltip — one element, shared by the tree's rows and by every
   info icon. The tool's own rather than the browser's title attribute: it
   opens in ~130ms instead of a second, re-points instantly as the pointer
   sweeps, and sits above its anchor so it never covers what is being moved
   towards. See tip.ts. */
.atx-tip {
  position: fixed;
  /* Above everything that can anchor one, modal drawers included — a settings
     card's info icon lives inside one. At Z+4 it merely tied with the
     inspector and lost on document order, popping behind the panel it sits
     on. Nothing in the overlay may sit above this. */
  z-index: ${Z_MODAL + 11};
  display: none;
  max-width: min(340px, calc(100vw - 16px));
  padding: 6px 9px;
  border: 1px solid var(--atx-border);
  border-radius: var(--atx-radius-md);
  background: var(--atx-card);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.42);
  pointer-events: none;
}

.atx-tip[data-on] {
  display: block;
}

.atx-tip-head {
  color: var(--atx-foreground);
  font: 500 11.5px var(--atx-font-mono);
  overflow-wrap: anywhere;
}

.atx-tip-note {
  margin-top: 3px;
  color: var(--atx-muted-fg);
  font: 11px var(--atx-font-ui);
  overflow-wrap: anywhere;
}

/* The legend for the row marks, pinned under the scroll body. Supplied by the
   caller (inspector-app) because it is the caller that decides what a mark
   means; a tree with no marks passes no footer and shows none. */
.atx-tree-legend {
  display: flex;
  align-items: center;
  gap: 14px;
  flex: 0 0 auto;
  padding: 8px 12px;
  border-top: 1px solid var(--atx-border);
  color: var(--atx-faint-fg);
  font: 400 10.5px var(--atx-font-ui);
}

.atx-tree-legend-key {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.atx-tree-legend-key[data-kind='component'] > .atx-ico {
  color: var(--atx-brand-text);
}

.atx-tree-legend-key[data-kind='slot'] > .atx-ico {
  color: var(--atx-warning);
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

/* == Settings fields =======================================================
   editors/fields.ts. One control per OptionControl, all wrapped in the same
   label/error/help chrome. Two states are attributes rather than inline
   writes: [data-locked] on a field whose option the project's config owns,
   and [data-on] on the error line, which is the only part of the stack that
   is conditionally present. */

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
   fields.ts; what is here is the drawer's own prose and its three status
   lines. Two states are attributes: [data-on] on the error and
   gitignore-warning lines, and [data-tone] on a status word. */

/* A stack of cards under the tab strip. */
.atx-settings-pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 16px;
}

.atx-settings-status {
  margin: 0;
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

.atx-settings-text {
  font: 13px var(--atx-font-ui);
}

.atx-settings-text[data-tone='muted'] {
  color: var(--atx-muted-fg);
}

.atx-settings-text[data-tone='warn'] {
  color: var(--atx-warning);
}

/* Muted, not amber: an option the project set in its own config is a normal
   state, and the one warning colour is spent on the uncommitted-settings line. */
.atx-settings-lock {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 0 0;
  color: var(--atx-muted-fg);
  font: 12px/1.45 var(--atx-font-ui);
}

/* == Image picker =========================================================
   editors/image.ts, the picker card above Values. The grid itself is
   editors/media-grid.ts; what is here is the card's own furniture — the
   filter, the upload row and the sentence naming uploadDir. */

.atx-inspector-picker:empty {
  display: none;
}

.atx-asset-filter {
  width: 100%;
  box-sizing: border-box;
  margin-bottom: 10px;
  font: 12px var(--atx-font-mono);
}

.atx-picker-upload {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 10px;
}

/* A file input is driven by the button beside it and is never seen. */
.atx-media-file {
  display: none;
}

/* The one line that has to be read before a file is written: an uploadDir
   outside the public directory produces a src the built site cannot serve. */
.atx-inspector-note[data-warn] {
  color: var(--atx-warning);
}

.atx-media-thumb[data-hidden] {
  display: none;
}

/* == Media grid ============================================================
   editors/media-grid.ts. One tile shape; the caption sits outside the pick
   button, because the filename is not part of what you press. [data-selected]
   is the ring and the tick together. */

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

/* A tile that cannot be picked *here* -- a file the built site would not
   serve. It stays on screen and says why: the dimming is the shared
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

/* == Code dock =============================================================
   dock.ts. The docked layout's second destination for a peek: the same code,
   the same loader, in chrome instead of a modal. It spans the *page column* —
   left/right are written inline from the panels' measured edges, so the side
   panels stay full height beside it — and its height is the one number the
   page's own bottom padding is also derived from, which is what stops content
   ever ending up underneath it.

   [data-on] is the docked layout; [data-open] is the fold. Folded, the body
   goes and the header bar is all that stands, and the dragged height is kept
   rather than discarded — it is what unfolding gives back. */

.atx-dock {
  display: none;
  position: fixed;
  bottom: 0;
  z-index: ${Z + 4};
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden;
  border-top: 1px solid var(--atx-border);
  /* The page keeps scrolling behind the dock — padding at the end of the
     document is what stops content *finishing* underneath it, not what stops
     it passing through — so the ground is blurred as well as nearly opaque.
     Safe here and nowhere near the shadow host: a backdrop filter makes its
     own element a containing block for fixed descendants, and the dock has
     none. */
  background: rgba(0, 0, 0, 0.9);
  backdrop-filter: blur(14px);
  color: var(--atx-muted-fg);
  font: 400 12px/1.5 var(--atx-font-mono);
  transition: left 170ms ease, right 170ms ease, height 170ms ease;
}

.atx-dock[data-on] {
  display: flex;
}

/* A drag must land on the frame it was given, not 170ms later. */
.atx-dock[data-resizing] {
  transition: none;
}

/* The top edge is the handle, laid over the header's top few pixels — which
   hold nothing, because the header's controls are centred in their bar. */
.atx-dock-grip {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2;
  height: 7px;
  background: transparent;
  cursor: ns-resize;
  transition: background 120ms;
}

.atx-dock-grip::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 2px;
  transform: translateX(-50%);
  width: 46px;
  height: 3px;
  border-radius: var(--atx-radius-full);
  background: var(--atx-input);
  opacity: 0;
  transition: opacity 120ms;
}

.atx-dock-grip:hover::after,
.atx-dock-grip:focus-visible::after,
.atx-dock[data-resizing] .atx-dock-grip::after {
  opacity: 1;
}

.atx-dock-grip:hover,
.atx-dock-grip:focus-visible,
.atx-dock[data-resizing] .atx-dock-grip {
  background: ${hexToRgba(COLOR.brand, 0.3)};
}

/* The edge is its own focus ring — an outline on a 7px strip reads as a line
   across the dock rather than as a focused control. */
.atx-dock-grip:focus-visible {
  outline: none;
}

.atx-dock:not([data-open]) .atx-dock-grip {
  display: none;
}

.atx-dock-head {
  display: flex;
  align-items: center;
  gap: 9px;
  flex: 0 0 auto;
  height: ${DOCK_BAR_H}px;
  padding: 0 8px 0 14px;
  border-bottom: 1px solid var(--atx-border);
}

.atx-dock-title {
  color: var(--atx-foreground);
  font: 600 11.5px var(--atx-font-mono);
}

/* Always present, empty or not: its auto margin is what puts the controls on
   the other end of the bar, and a spacer that only sometimes exists is a bar
   that only sometimes lines up. */
.atx-dock-loc {
  margin-right: auto;
  color: var(--atx-faint-fg);
  font: 10.5px var(--atx-font-mono);
}

.atx-dock:not([data-open]) .atx-dock-body {
  display: none;
}

.atx-dock:not([data-open]) .atx-dock-fold .atx-ico {
  transform: rotate(180deg);
}

.atx-dock-body,
.atx-dock-pane {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}

/* The peek's own height cap is for a modal in the middle of the window. In the
   dock the pane is the height, and the drag is what sets it. */
.atx-dock .atx-peek-code {
  flex: 1 1 auto;
  min-height: 0;
  max-height: none;
}

.atx-dock .atx-peek-loading {
  flex: 1 1 auto;
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
`;
}
