/**
 * Shared UI primitives for the overlay: design tokens, the element factory,
 * and the generic building blocks (toast, save veil, panel, backdrop, footer
 * buttons).
 *
 * The overlay draws inside a shadow root (shadow.ts), so host-page selectors
 * cannot reach these elements at all and specificity is no longer a defense we
 * have to win. Styling is moving to the single stylesheet in styles.ts; what
 * stays inline here is what cannot be known until runtime — geometry measured
 * off a host element, chrome insets, computed stacking layers, per-instance
 * size overrides — plus anything applied to a host-page element, which never
 * enters the root.
 *
 * The atx-* IDs and classes are internal hooks for DOM references and for that
 * stylesheet. They are *not* a theming API any more: user CSS cannot match
 * them across the boundary. Theming is `--atx-*` custom properties and
 * `::part()` — see docs/STYLING.md.
 *
 * The tokens below are the single source of truth for both: styles.ts
 * generates the custom-property block from them, and tests/contrast.test.ts
 * holds them to WCAG AA.
 */

import { mount } from './shadow.ts';

// Base layer for every overlay surface; individual layers sit at Z+1..Z+10
// (the deepest is the Unsplash settings panel). Deliberately *below* Astro's
// dev toolbar, which pins itself at 2000000010 — the toolbar is the source of
// the source annotations this whole feature reads, so it stays reachable.
export const Z = 1999999000;

/**
 * Design tokens, on the shadcn/ui semantic scheme.
 *
 * Names and roles follow shadcn's convention — a surface plus the ink that
 * goes on it (`card` + `foreground`, `primary` + `primaryFg`), then `muted`,
 * `destructive`, `border`, `input`, `ring` and a single `radius` knob — so the
 * vocabulary is one other people already know. Three deliberate departures:
 * shadcn's three interchangeable `secondary`/`muted`/`accent` surfaces are one
 * `elevated` here, because the overlay only ever needs one step up from
 * `card`; `mutedFg`/`faintFg` are two ink tiers where shadcn has one, because
 * the hover pill and peek gutter need a quieter grey that is still legible;
 * and `brand` has no shadcn counterpart at all, because shadcn's palette has
 * nowhere to put a colour that means something. Dark only: this overlay paints
 * over a live page and has one look, so there is no `.dark` counterpart to
 * keep in step.
 *
 * **One colour has a job, and the rest are furniture.** `brand` marks the
 * overlay pointing at *your content* — the editable outline, the hover pill,
 * the save veil, a tree row aimed at a live node. Everything the tool says
 * about *itself* is neutral, and its emphatic fill is a near-white `primary`.
 * A purple that is also the confirm button and the active tab is a purple that
 * means nothing, which is what this split exists to prevent. If a change makes
 * something `brand` that is not an editable affordance, it is wrong.
 *
 * **Authored in OKLCH, emitted as sRGB.** The OKLCH triple in each comment is
 * the source of truth — it is what makes the neutral ramp perceptually even and
 * provably untinted (chroma 0, so no hue creeps into the greys). Re-derive with
 * any OKLCH converter; do not hand-edit the values. Most are hex, which is what
 * `hexToRgba` and `lift` need; the three that separate surfaces from each other
 * are translucent white in `rgb(r g b / a)` form, so that one value composites
 * correctly on every surface it can land on.
 *
 * **Every pairing below is contrast-verified**, and that is a constraint on
 * changes, not a note about the past. Text tokens clear WCAG AA (4.5:1) against
 * all three surfaces they can land on — `card`, `elevated` and `background` —
 * and control outlines clear 1.4.11 non-text (3:1) against the same three.
 * shadcn's own dark defaults do *not* all clear these: its `--input` is white
 * at 15%, which reaches 1.6:1 on `card`. Where upstream and legibility
 * disagree, legibility wins; `tests/contrast.test.ts` is what enforces it.
 */
export const COLOR = {
  // --- Surfaces (achromatic: chroma 0, no tint) ----------------------------
  /** Deepest well — code blocks and the raw-markdown pane. oklch(0.145 0 0) */
  background: '#0a0a0a',
  /** The standard overlay surface: panels, drawers, popovers. oklch(0.205 0 0) */
  card: '#171717',
  /** Raised surface — list rows, secondary buttons, the admin bar's own
   *  chrome. shadcn's `secondary`/`muted`. oklch(0.269 0 0) */
  elevated: '#262626',
  /** The **hover** surface, one step above `elevated`. A separate token because
   *  hovering is a state, not a depth: a menu item at rest sits on `card` and a
   *  secondary button on `elevated`, and both go here when the pointer is over
   *  them. shadcn's `accent`. oklch(0.371 0 0) */
  accent: '#404040',

  // --- Lines and control edges ---------------------------------------------
  /** Divider and panel edge. **Translucent white, so one value is correct on
   *  every surface** — a hairline is the only thing separating a panel from the
   *  ground it sits on, and an opaque grey can only be right on one of them.
   *  Separators are decorative, so this sits below the 3:1 non-text floor
   *  deliberately — an outline a user must *see* to operate is `input`. */
  border: 'rgb(255 255 255 / 0.10)',
  /**
   * The material a control is made of. shadcn's `--input`, white at 15%.
   *
   * **A form control here has no visible border**: its boundary is the fill,
   * and the border stays transparent until focus or an error paints it. That
   * is the single biggest thing separating this look from a conventional dark
   * form, and it is worth stating plainly because a solid outline is the
   * obvious "fix" for it.
   *
   * The consequence is a deliberate deviation from WCAG 1.4.11, which asks 3:1
   * of a control boundary: a 7.5% fill reaches ~1.5:1 on `card`. What carries
   * the weight instead is `ring` — 3px, high contrast, and always painted on
   * keyboard focus. Text inside a field still clears AA, which is pinned.
   */
  input: 'rgb(255 255 255 / 0.15)',
  /** A field's resting interior — `input` at half strength, which is shadcn's
   *  `bg-input/50`. The small controls (checkbox, switch) use full-strength
   *  `input` instead: a 16px box needs more fill than a 300px one to read at
   *  all. */
  inputBg: 'rgb(255 255 255 / 0.075)',
  /** Focus ring. Neutral, because focus is chrome — the overlay talking about
   *  itself. Clears 3:1 on every surface (3.2–4.6), which matters more here
   *  than it would elsewhere: with control borders transparent at rest, this
   *  is the indicator that has to carry the weight. oklch(0.556 0 0) */
  ring: '#737373',

  // --- Ink ------------------------------------------------------------------
  /** Primary ink. 17.2:1 on `card`. oklch(0.985 0 0) */
  foreground: '#fafafa',
  /** Secondary ink: help text, hints, unknown classification — quieter than
   *  `foreground` while still being *read*. Worst case 5.9:1 on `elevated`.
   *  oklch(0.708 0 0) */
  mutedFg: '#a1a1a1',
  /** Tertiary ink, one step below `mutedFg`: peek line numbers, empty-state
   *  glyphs, the menu's status footer. Worst case 5.0:1 on `elevated` — quiet
   *  is not the same as unreadable. Nothing may go fainter than this.
   *  oklch(0.665 0 0) */
  faintFg: '#949494',

  // --- The loud colour ------------------------------------------------------
  /**
   * The overlay's one emphatic fill: the confirm button, a checked checkbox, an
   * active admin-bar chip. **Near-white, and achromatic** — on a near-black
   * overlay the loudest thing available is light, not hue, and spending a hue
   * here is what left the old palette with a purple that meant nothing in
   * particular. oklch(0.922 0 0)
   */
  primary: '#e5e5e5',
  /** Ink on `primary` — and on `destructive`, which is also a light fill.
   *  14.2:1 on `primary`. oklch(0.205 0 0) */
  primaryFg: '#171717',

  // --- Brand ----------------------------------------------------------------
  /**
   * The brand purple, with exactly one job: **this element on your page is
   * editable**. The hover outline and pill, the save veil, the element tree's
   * pointer at a live node, the launcher glyph.
   *
   * It is not a button colour, not an active-tab colour, not a selection
   * colour inside the tool's own pickers. When the overlay is talking about
   * itself it goes neutral; the purple is reserved for when it is pointing at
   * your content, which is the only way a colour can mean anything.
   * oklch(0.509 0.212 285)
   */
  brand: '#6144d7',
  /** The brand lightened enough to read as *text* on a panel — solid `brand` is
   *  a background colour and fails contrast as a foreground. Links inside
   *  panels, and the peek gutter's tag/attr tokens. 8.2:1 on `card`.
   *  oklch(0.760 0.110 285) */
  brandText: '#aaa7f4',

  // --- Status ---------------------------------------------------------------
  /**
   * Danger, in one token rather than three. A light red reads as *ink* at
   * 6.2:1 on `card`, as a *border* well above the 3:1 control floor, and as a
   * *fill* under `primaryFg` at 6.2:1 — so the error line, the Delete button's
   * outline and the failure toast are all the same colour instead of three
   * reds that drift apart. oklch(0.704 0.191 22.2)
   */
  destructive: '#ff6467',
  /** Success *background* — the saved state, the ok toast. `foreground` on it
   *  is 5.0:1. oklch(0.520 0.140 150) */
  success: '#0a7e3a',
  /** Success as text on a panel. 9.5:1 on `card`. oklch(0.780 0.150 150) */
  successText: '#67d283',
  /** Dynamic-content classification and warnings — a text colour, 8.8:1 on
   *  `card`. oklch(0.780 0.150 85) */
  warning: '#e3ae28',
  /** Image classification. 7.8:1 on `card`. oklch(0.720 0.150 160) */
  info: '#2fc183',

  // --- Categorical hues -----------------------------------------------------
  /** shadcn's `chart-1..5`: five hues chosen to stay apart from each other at a
   *  glance, all at the same lightness so none reads as louder than the rest.
   *  They are what the CSS inspector's syntax theme is built from — a code
   *  token needs more distinguishable colours than the semantic set has, and
   *  reusing `brandText` for two different token kinds would erase the
   *  distinction the highlighter exists to draw. All clear AA on `background`,
   *  `card` and `elevated` (6.7:1 worst case).
   *  oklch(0.76–0.78 0.11–0.15 · 285/150/85/25/220) */
  chart1: '#aaa7f4',
  chart2: '#67d283',
  chart3: '#e3ae28',
  chart4: '#f98f87',
  chart5: '#55c4e5',

  // --- Glass -----------------------------------------------------------------
  /**
   * The **one place chroma is allowed in a grey**, and it is allowed for a
   * reason rather than as a leftover.
   *
   * Three surfaces are translucent over the host page — the admin bar, its
   * menu, and the element tree. A hue shift is the cue the eye uses to decide
   * something is *showing through*: a tinted grey over a white page reads as
   * glass because the colour is evidence of a mixture, while a perfectly
   * neutral one at the same alpha and the same lightness reads as a flat scrim
   * painted on top. Chroma 0 here costs the transparency the alpha is paying
   * for.
   *
   * So these two carry chroma 0.012 at the **brand hue** — about half the cast
   * the old palette had everywhere, and deliberately the brand's hue so the
   * glass relates to something rather than being an arbitrary tint. Composited
   * over a white page the bar lands at chroma 0.013, against 0.022 before and
   * 0.000 without this.
   *
   * **Opaque surfaces stay achromatic.** `card`, `elevated`, `background` and
   * every ink are chroma 0 and the contrast test pins them there. If a surface
   * is not translucent it does not get to use these.
   */
  /** Bar and element tree, at the `card` lightness. oklch(0.205 0.012 285) */
  glass: '#16161d',
  /** The menu, one lightness step up so it separates from the bar it opens
   *  from — a step the flat neutral pass had collapsed. oklch(0.234 0.012 285) */
  glassRaised: '#1d1d23',
} as const;

/**
 * The one light surface in a dark-only overlay: the rich-text editor's page,
 * which shows a Markdown body as it will look once published rather than as
 * overlay chrome. Its own token group instead of `COLOR` inverted, because the
 * two are not the same idea — `COLOR.foreground` is *ink*, and using it as this
 * surface's background would couple a piece of paper to the colour of text.
 *
 * Same OKLCH-authored, contrast-verified rules as `COLOR`: body ink is 18.1:1
 * on `bg` and 16.2:1 on `muted`. `link` is the brand hue darkened for paper
 * (7.2:1); the overlay's own `primary` would also clear AA here at 6.3:1, but
 * it is tuned to sit on a dark ground and reads thin as body-text link on
 * white, so paper gets its own.
 */
export const PAPER = {
  /** The page itself. oklch(1 0 0) */
  bg: '#ffffff',
  /** Body ink. oklch(0.200 0 0) */
  fg: '#161616',
  /** Inset blocks — code, pre, blockquote fill. oklch(0.960 0 0) */
  muted: '#f2f2f2',
  /** Rules and block edges. oklch(0.880 0 0) */
  border: '#d7d7d7',
  /** Links, the brand hue at paper contrast. oklch(0.480 0.200 285) */
  link: '#593ec7',
} as const;

/**
 * Corner radii, on shadcn's single-knob scheme: `lg` is the base `--radius`
 * (0.625rem = 10px) and the rest step ±4px from it.
 *
 * Pick by element, not by taste — the ladder only reads as one family if the
 * same kind of thing always takes the same rung. `sm` a tag or swatch, `md` a
 * checkbox or toolbar button, `xl` a menu item, `2xl` a form control, `3xl` a
 * panel, `full` a button or pill.
 *
 * The upper rungs are where the current shadcn look actually lives: a 32px
 * control at `2xl` reads as a capsule rather than a box, and that one choice
 * places the design more than any value in `COLOR` does.
 */
export const RADIUS = {
  sm: '6px',
  md: '8px',
  lg: '10px',
  xl: '14px',
  '2xl': '18px',
  '3xl': '24px',
  full: '999px',
} as const;

export const FONT = {
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  ui: 'ui-sans-serif, system-ui, sans-serif',
} as const;


/**
 * The surfaces exposed to user CSS as `::part()`. Deliberately small: a part is
 * an API commitment, and everything expressible as a value is a custom property
 * instead. Buttons, fields and rows are *not* here on purpose — add one only
 * when someone needs to restructure a surface, not to recolour it.
 * Documented in docs/STYLING.md.
 */
const PARTS: Record<string, string> = {
  'atx-bar': 'bar',
  'atx-panel': 'panel',
  'atx-drawer': 'drawer',
  'atx-backdrop': 'backdrop',
  'atx-tooltip': 'pill',
  'atx-toast': 'toast',
};

/**
 * Create an overlay element: marks it as our own UI (so the click router
 * ignores it), stamps the atx-* class hook (and optional id for singletons),
 * and exposes it as a `::part()` if it is one of the named surfaces.
 *
 * `style` is optional and is for **runtime values only** — geometry measured
 * off a host element, a computed stacking layer, a per-instance size override.
 * Everything static is a rule in styles.ts keyed off the class, which is what
 * lets `:hover` and `:focus-visible` exist at all.
 */
export function styled<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  style?: Partial<CSSStyleDeclaration>,
  id?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  // The first class is the element's identity ('atx-toast atx-toast-ok' → the
  // toast); the modifiers after it are variants, not separate surfaces.
  const part = className ? PARTS[className.split(' ')[0]] : undefined;
  if (part) el.setAttribute('part', part);
  if (id) el.id = id;
  if (style) Object.assign(el.style, style);
  return el;
}

/**
 * A text-ish form control — input, textarea or select — carrying the shared
 * control baseline from styles.ts.
 *
 * The marker is `[data-input]`, not a class, because every caller already
 * names its own (`atx-field-input`, `atx-collections-input`, `atx-settings-key`
 * …) and there is no shared class to key a rule off. `style` is for the
 * per-caller trim a control genuinely needs — a monospace face on a path
 * field, `flex` inside a row — not for the baseline, which is not repeatable
 * from out here any more.
 */
export function inputEl<K extends 'input' | 'textarea' | 'select'>(
  tag: K,
  className: string,
  style?: Partial<CSSStyleDeclaration>,
): HTMLElementTagNameMap[K] {
  const el = styled(tag, className, style);
  el.dataset.input = '';
  return el;
}

/**
 * The transparency checkerboard behind an image preview, at `size` px per
 * square. One definition for the four surfaces that draw it (the image panel,
 * its recent strip, the media grid tile, the asset picker), which previously
 * each carried their own copy of the gradient and drifted apart in size.
 *
 * Built from `card` and `elevated` so the squares read as a *surface* rather
 * than as content — the contrast between them is deliberately low (1.4:1),
 * enough to say "this area is transparent" without competing with the image
 * sitting on top of it.
 */
export function CHECKER(size: number): string {
  return `repeating-conic-gradient(${COLOR.elevated} 0% 25%, ${COLOR.card} 0% 50%) 50% / ${size}px ${size}px`;
}

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Nudge a hex colour toward white for the hover state of a coloured button. */
export function lift(hex: string, by = 18): string {
  const v = Number.parseInt(hex.slice(1), 16);
  const channels = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => Math.min(255, c + by));
  return `rgb(${channels.join(', ')})`;
}

/**
 * The admin bar's own chip surfaces — a button on the bar, and that button
 * hovered. Here rather than in admin-bar.ts because two modules need them:
 * styles.ts paints the chip, and admin-bar.ts reuses the resting one as the
 * save button's `saving` background, and the two must not drift.
 */
export const BAR_CHIP = 'rgba(255,255,255,0.09)';
export const BAR_CHIP_HOVER = 'rgba(255,255,255,0.20)';

export function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// --- Viewport chrome ---------------------------------------------------------

/** Strips of the viewport that the overlay's own fixed chrome occupies. */
export interface ChromeInset {
  top: number;
  bottom: number;
}

let inset: ChromeInset = { top: 0, bottom: 0 };
const insetListeners = new Set<(i: ChromeInset) => void>();

/** The current chrome inset — read it when placing anything against a viewport
 *  edge (the hover pill, a docked panel), so it can't hide under the admin bar. */
export function chromeInset(): ChromeInset {
  return inset;
}

/**
 * Declare how much of the viewport edge the admin bar occupies. One-directional
 * on purpose: the bar tells ui.ts, and the surfaces that must keep clear (toast,
 * element tree, hover pill) read it back or subscribe — so nothing here has to
 * import the bar.
 */
export function setChromeInset(next: ChromeInset): void {
  if (next.top === inset.top && next.bottom === inset.bottom) return;
  inset = next;
  for (const fn of insetListeners) fn(inset);
}

/** Subscribe to inset changes. Fires immediately with the current value, so a
 *  subscriber is correct whether it registers before or after the bar. */
export function onChromeInset(fn: (i: ChromeInset) => void): void {
  insetListeners.add(fn);
  fn(inset);
}

/** Lock an element during a save: dim + spinner overlay. Returns a release fn. */
export function lockElement(el: HTMLElement): () => void {
  const rect = el.getBoundingClientRect();
  const veil = styled('div', 'atx-veil', {
    zIndex: String(Z + 3),
    left: `${rect.left - 2}px`, top: `${rect.top - 2}px`,
    width: `${rect.width + 4}px`, height: `${rect.height + 4}px`,
  });
  const chip = styled('div', 'atx-veil-chip');
  chip.textContent = 'saving…';
  veil.append(chip);
  mount(veil);
  return () => veil.remove();
}

/** Bottom-center toast, lifted clear of a bottom-docked admin bar. `kind` sets
 *  the accent. Auto-dismisses. */
export function toast(message: string, kind: 'ok' | 'err'): void {
  const t = styled('div', `atx-toast atx-toast-${kind}`, {
    zIndex: String(Z + 5),
    // The one runtime value: how far a bottom-docked admin bar pushes it up.
    bottom: `${24 + inset.bottom}px`,
  });
  t.textContent = message;
  mount(t);
  requestAnimationFrame(() => t.toggleAttribute('data-shown', true));
  setTimeout(() => {
    t.toggleAttribute('data-shown', false);
    setTimeout(() => t.remove(), 200);
  }, 2400);
}

/**
 * Let `el` scroll on its own, even on host pages that hijack wheel events.
 *
 * Smooth-scroll libraries (Lenis, Locomotive, GSAP ScrollSmoother) listen for
 * `wheel` on window with `{passive:false}` and `preventDefault()` it, driving
 * the page from their own animation loop. A nested overflow container then
 * never scrolls natively — the page slides under our open panel instead. Every
 * scrollable surface in the overlay goes through this.
 *
 * Three layers, cheapest first:
 *  - `overscroll-behavior: contain` stops scroll *chaining* to the page when
 *    this element is already at its top or bottom. Useful even without a
 *    smooth-scroll library.
 *  - the `data-*-prevent` attributes are the documented opt-outs those
 *    libraries look for on the event target's ancestors (Lenis resolves them
 *    with `closest()`, so a token `<span>` deep inside still matches). Inert
 *    on pages that don't use them.
 *  - stopping propagation keeps the event from reaching a window-level
 *    listener at all, which also covers hand-rolled implementations. The
 *    listener stays passive — it never calls `preventDefault`, so the browser's
 *    own scrolling of this element is untouched.
 */
export function isolateScroll(el: HTMLElement): void {
  el.style.overscrollBehavior = 'contain';
  el.setAttribute('data-lenis-prevent', ''); // Lenis
  el.setAttribute('data-scroll-ignore', ''); // Locomotive Scroll
  el.addEventListener('wheel', stopScrollPropagation, { passive: true });
  el.addEventListener('touchmove', stopScrollPropagation, { passive: true });
}

function stopScrollPropagation(e: Event): void {
  e.stopPropagation();
}

/**
 * A centered modal panel shell with a title bar, body slot, and footer slot.
 * `action` is placed at the right of the title bar — a jump-to-editor button,
 * for panels whose title names a source location. It arrives built rather than
 * described because icons.ts imports this module, and reaching back for
 * `icon()` here would close a cycle.
 *
 * `opts` covers the panels that need a different size or stacking layer (the
 * media modal, the widened image panel). Sizing stays here rather than being
 * poked into `panel.style` by callers, so one module owns panel chrome.
 */
export interface PanelOptions {
  /** CSS width; defaults to `min(420px, 92vw)`. */
  width?: string;
  /** CSS height. Omitted means auto — the panel is as tall as its content.
   *  Setting it makes the body the scrolling region. */
  height?: string;
  /** Offset added to the base `Z`. Defaults to 6 (the standard panel layer);
   *  the media modal uses 8 so it can stack above the CMS drawer. */
  layer?: number;
}
export function buildPanel(
  title: string,
  action?: HTMLElement,
  opts: PanelOptions = {},
): HTMLElement {
  const panel = styled('div', 'atx-panel', {
    zIndex: String(Z + (opts.layer ?? 6)),
    ...(opts.width ? { width: opts.width } : {}),
    ...(opts.height ? { height: opts.height } : {}),
  });
  // A sized panel lays its title/body/foot out as a column so the body is the
  // only part that grows, and its body becomes the scrolling region. Both are
  // layout, so the flag is what crosses into CSS, not the declarations.
  if (opts.height) panel.dataset.sized = '';

  const bar = styled('div', 'atx-panel-title');
  const heading = styled('span', 'atx-panel-heading');
  heading.textContent = title;
  bar.append(heading);
  if (action) bar.append(action);

  const body = styled('div', 'atx-panel-body');
  body.dataset.body = '';
  isolateScroll(body);

  const foot = styled('div', 'atx-panel-foot');
  foot.dataset.foot = '';

  panel.append(bar, body, foot);
  return panel;
}

/** A right-side drawer shell (entry editor, settings): title bar with an action
 *  slot, scrollable body, sticky footer. Same [data-body]/[data-foot] contract
 *  as buildPanel, so wirePanelButtons works unchanged. */
export interface DrawerOptions {
  /** CSS width; defaults to `min(max(440px, 50vw), 94vw)`. */
  width?: string;
  /** Offset added to the base `Z`. Defaults to 6, the standard panel layer.
   *  The settings drawer can open *above* the media modal (which sits at 8),
   *  so it needs to ask for a higher one. */
  layer?: number;
}
export function buildDrawer(title: string, opts: DrawerOptions = {}): HTMLElement {
  const drawer = styled('div', 'atx-drawer', {
    zIndex: String(Z + (opts.layer ?? 6)),
    ...(opts.width ? { width: opts.width } : {}),
  });

  const bar = styled('div', 'atx-drawer-title');
  const barText = styled('span', 'atx-drawer-title-text');
  barText.textContent = title;
  const barActions = styled('span', 'atx-drawer-actions');
  barActions.dataset.actions = '';
  bar.append(barText, barActions);

  const body = styled('div', 'atx-drawer-body');
  body.dataset.body = '';
  isolateScroll(body);

  const foot = styled('div', 'atx-drawer-foot');
  foot.dataset.foot = '';

  drawer.append(bar, body, foot);
  return drawer;
}

/**
 * A tab strip and the single host its active pane is mounted into.
 *
 * Lifted out of the media modal, which grew the first one for its
 * Project/Unsplash sources, when the Settings drawer needed a second. The
 * behaviours worth keeping are both non-obvious:
 *
 * - **The strip is not rendered when there is only one tab.** A lone tab is not
 *   a choice, and drawing it implies there are others.
 * - **`onActivate` fires once per tab, the first time it is shown.** Panes whose
 *   setup costs something (a network search) should not pay it until the user
 *   asks for them, and should not pay it twice.
 *
 * Selected state is carried by `aria-selected` alone: styles.ts paints from
 * that attribute, so the thing a screen reader reads and the thing the eye
 * reads are the same fact rather than two that can disagree.
 */
export interface TabSpec {
  /** Stable id; also the `atx-<prefix>-tab-<id>` class suffix. */
  id: string;
  label: string;
  /** Shown in {@link TabStrip.host} while this tab is active. */
  pane: HTMLElement;
}

export interface TabStrip {
  /** The row of tab buttons. Empty when there is only one tab. */
  strip: HTMLElement;
  /** Where the active pane lives. Mount it wherever the content belongs. */
  host: HTMLElement;
  /** Switch tabs. A no-op for an unknown id or the current one. */
  show(id: string): void;
  activeId(): string;
  /** Retitle a tab in place — for a label that carries a live count. No-op
   *  when the strip is unrendered (a single tab). */
  setLabel(id: string, text: string): void;
}

export interface TabsOptions {
  /** `atx-<prefix>-tabs` / `atx-<prefix>-tab` class stem. Defaults to `tabs`. */
  classPrefix?: string;
  /** Once per tab, the first time it becomes active. */
  onActivate?(id: string): void;
  /** Every time the active tab changes, after the swap. */
  onChange?(id: string): void;
}

export function buildTabs(tabs: readonly TabSpec[], opts: TabsOptions = {}): TabStrip {
  const prefix = opts.classPrefix ?? 'tabs';
  const strip = styled('div', `atx-${prefix}-tabs`);
  strip.role = 'tablist';
  const host = styled('div', `atx-${prefix}-host`);
  host.dataset.tabhost = '';

  const buttons = new Map<string, HTMLButtonElement>();
  const activated = new Set<string>();
  let active = tabs[0];

  const paint = (): void => {
    for (const [id, btn] of buttons) {
      btn.setAttribute('aria-selected', id === active?.id ? 'true' : 'false');
    }
  };

  const show = (id: string): void => {
    const next = tabs.find((t) => t.id === id);
    if (!next || next === active) return;
    active = next;
    host.textContent = '';
    host.append(next.pane);
    paint();
    if (!activated.has(id)) {
      activated.add(id);
      opts.onActivate?.(id);
    }
    opts.onChange?.(id);
  };

  // Only render the strip when there is a choice to make.
  if (tabs.length > 1) {
    for (const { id, label } of tabs) {
      const btn = styled('button', `atx-${prefix}-tab atx-${prefix}-tab-${id}`);
      btn.type = 'button';
      btn.role = 'tab';
      btn.textContent = label;
      btn.addEventListener('click', () => show(id));
      buttons.set(id, btn);
      strip.append(btn);
    }
    paint();
  }

  if (active) {
    host.append(active.pane);
    // The first tab is active from the start, so it counts as activated without
    // firing the callback — its caller has already built it.
    activated.add(active.id);
  }

  return {
    strip,
    host,
    show,
    activeId: () => active?.id ?? '',
    setLabel: (id, text) => {
      const btn = buttons.get(id);
      if (btn) btn.textContent = text;
    },
  };
}

/**
 * Point an `<img>` at a file that was *just* written, retrying briefly.
 *
 * Vite's static middleware 404s a newly written file for a short window — long
 * enough that the load fired the instant an upload or import returns will fail,
 * leaving an empty box even though the same URL serves fine a moment later
 * (verified: 404 at write time, 200 immediately after). The browser also caches
 * that 404 for the life of the page, so each attempt carries a fresh query
 * string to defeat both.
 *
 * Display only — the value written into source is always the clean path.
 */
export function setFreshSrc(img: HTMLImageElement, path: string): void {
  const ATTEMPTS = 8;
  const DELAY_MS = 200;
  let left = ATTEMPTS;
  const bust = (): string => `${path}${path.includes('?') ? '&' : '?'}atx=${Date.now()}`;
  const onError = (): void => {
    if (--left <= 0) {
      img.removeEventListener('error', onError);
      return;
    }
    setTimeout(() => {
      img.src = bust();
    }, DELAY_MS);
  };
  img.addEventListener('error', onError);
  img.addEventListener('load', () => img.removeEventListener('error', onError), { once: true });
  img.src = bust();
}

/** Dim backdrop that closes the panel when clicked. `layer` matches the panel
 *  it sits under — the media modal's backdrop must land above the CMS drawer it
 *  can open over, not at the standard panel layer. */
export function buildBackdrop(onClose: () => void, layer = 5): HTMLElement {
  const b = styled('div', 'atx-backdrop', { zIndex: String(Z + layer) });
  b.addEventListener('click', onClose);
  return b;
}

/**
 * Button variants, named as shadcn names them: `default` (the filled brand
 * action), `secondary` (a filled step up from the surface), `outline`, `ghost`
 * and `destructive`.
 *
 * One deliberate departure: shadcn's `destructive` is *filled* red. Here it is
 * an outline, because a footer that puts a filled red button beside the filled
 * brand button reads as two equally-weighted calls to action when only one of
 * them is the thing the user came to do.
 */
export type ButtonKind = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive';

/** A panel/drawer footer button. The single source of button styling — each
 *  kind is `.atx-btn-<kind>` in styles.ts, so a variant is a class rather than
 *  a lookup table copied onto the element. */
export function footButton(label: string, kind: ButtonKind, onClick: () => void): HTMLButtonElement {
  const btn = styled('button', `atx-btn atx-btn-${kind}`);
  btn.type = 'button';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

/**
 * Enable or disable a button *visibly*: a disabled primary button would
 * otherwise look identical to a live one and read as broken rather than as
 * unavailable. Every caller that sets `.disabled` on an overlay button should
 * go through this instead.
 *
 * The dimming is `[data-dimmed]` in styles.ts rather than `:disabled`, because
 * the two are not the same set — several places set `.disabled` directly and
 * have never dimmed. Widening that is a design decision, not a side effect of
 * moving a value into a stylesheet.
 */
export function setButtonEnabled(btn: HTMLButtonElement, enabled: boolean): void {
  btn.disabled = !enabled;
  btn.toggleAttribute('data-dimmed', !enabled);
}

/**
 * A small translucent button for the dark hover pill and its rules card — the
 * pill's "open" / "copy" and each rule's own "open". One primitive so the three
 * stay identical; `extra` covers the per-caller trim (font size, flex).
 *
 * The label always lives in its own `[data-label]` span so `setPillLabel` can
 * swap the text without disturbing the icon (icons come from icons.ts, passed
 * in as an element — ui.ts stays the leaf module nothing else here imports).
 */
export function pillButton(
  className: string,
  label: string,
  title: string,
  extra: Partial<CSSStyleDeclaration> = {},
  iconEl?: HTMLElement,
): HTMLButtonElement {
  const btn = styled('button', className, extra);
  // The caller names the class, so there is no shared one for the stylesheet
  // to match; this attribute is the pill's identity instead.
  btn.dataset.pill = '';
  btn.type = 'button';
  /**
   * `.atx-pill-label` lifts the text 1.5px — optical centring, which flexbox
   * can't do for text. `align-items: center` lines up the *boxes*, but a text
   * box is asymmetric around its ink: on an 11px label it reserves ~11px above
   * the baseline for ascenders and 2px below, while an all-lowercase word
   * ("open", "copy") only paints the ~6px x-height band. Centred by box, that
   * band lands ~1.5px below the middle of the pill and the label reads as
   * sitting low. The icon, whose glyph does fill its box, needs no correction.
   *
   * Offset rather than margin (a margin would be half-absorbed by the centring
   * it is correcting) and `relative` rather than a transform (the spinner icon
   * animates the host's own transform).
   */
  const text = styled('span', 'atx-pill-label');
  text.dataset.label = '';
  text.textContent = label;
  if (iconEl) btn.append(iconEl);
  btn.append(text);
  btn.title = title;
  return btn;
}

/** Retarget a pill button's label (its icon, if any, stays put). */
export function setPillLabel(btn: HTMLButtonElement, label: string): void {
  const text = btn.querySelector<HTMLElement>('[data-label]');
  if (text) text.textContent = label;
  else btn.textContent = label;
}

/** Populate a panel's footer with cancel + confirm buttons, and optionally a
 *  secondary (outline) button between them for a second action. */
export function wirePanelButtons(
  panel: HTMLElement,
  onCancel: () => void,
  onConfirm: () => void,
  opts: { confirmLabel?: string; secondaryLabel?: string; onSecondary?: () => void } = {},
): void {
  const foot = panel.querySelector('[data-foot]') as HTMLElement;
  foot.append(footButton('Cancel', 'ghost', onCancel));
  if (opts.secondaryLabel && opts.onSecondary) {
    foot.append(footButton(opts.secondaryLabel, 'outline', opts.onSecondary));
  }
  foot.append(footButton(opts.confirmLabel ?? 'Save', 'default', onConfirm));
}
