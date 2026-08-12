/**
 * Shared UI primitives for the overlay: design tokens, the element factory,
 * and the generic building blocks (toast, save veil, panel, backdrop, footer
 * buttons).
 *
 * Styling is deliberately inline — inline styles win specificity against any
 * host-page CSS, so the overlay renders correctly on every site. The atx-*
 * IDs/classes exist as stable hooks for DOM references and user CSS overrides
 * (which need !important against the inline baseline), never as styling.
 */

export const Z = 2147483000; // above Astro's dev toolbar, below nothing that matters

export const COLOR = {
  /** Brand / editable-text accent. */
  accent: '#7c5cff',
  /** Image classification. */
  image: '#2bb673',
  /** Dynamic-content classification and warnings. */
  warn: '#e0a800',
  /** Unknown classification. */
  muted: '#888',
  /** Success toast. */
  ok: '#2b8a4a',
  /** Error toast. */
  err: '#c0392b',
  /** Toggle button when edit mode is off. */
  idle: '#4a4a6a',
  panelBg: '#1c1c2b',
  panelBorder: '#333',
  panelDivider: '#2c2c3d',
} as const;

export const FONT = {
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  ui: 'ui-sans-serif, system-ui, sans-serif',
} as const;

/** Baseline for text-ish form controls (inputs, textareas, selects).
 *  `colorScheme: dark` makes the browser render native chrome — the date
 *  input's calendar-picker icon and popup, number spinners — light against the
 *  dark background instead of as a near-invisible dark glyph. */
export const INPUT_STYLE: Partial<CSSStyleDeclaration> = {
  width: '100%', padding: '6px 8px', boxSizing: 'border-box',
  border: '1px solid #444', borderRadius: '5px', background: '#111', color: '#fff',
  font: '13px system-ui', colorScheme: 'dark',
};

/**
 * Create an overlay element: marks it as our own UI (so the click router
 * ignores it), stamps the atx-* class hook (and optional id for singletons),
 * and applies the inline baseline styles.
 */
export function styled<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  style: Partial<CSSStyleDeclaration>,
  id?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.dataset.astroTextEditUi = '1';
  if (className) el.className = className;
  if (id) el.id = id;
  Object.assign(el.style, style);
  return el;
}

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

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
    position: 'fixed', zIndex: String(Z + 3), pointerEvents: 'all',
    left: `${rect.left - 2}px`, top: `${rect.top - 2}px`,
    width: `${rect.width + 4}px`, height: `${rect.height + 4}px`,
    background: 'rgba(124, 92, 255, 0.12)', borderRadius: '3px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  });
  const chip = styled('div', 'atx-veil-chip', {
    font: '600 11px system-ui', color: '#fff', background: COLOR.accent,
    padding: '2px 8px', borderRadius: '999px', boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
  });
  chip.textContent = 'saving…';
  veil.append(chip);
  document.body.append(veil);
  return () => veil.remove();
}

/** Bottom-center toast, lifted clear of a bottom-docked admin bar. `kind` sets
 *  the accent. Auto-dismisses. */
export function toast(message: string, kind: 'ok' | 'err'): void {
  const t = styled('div', `atx-toast atx-toast-${kind}`, {
    position: 'fixed', zIndex: String(Z + 5), left: '50%', bottom: `${24 + inset.bottom}px`,
    transform: 'translateX(-50%)', padding: '10px 16px', borderRadius: '8px',
    font: '500 13px system-ui', color: '#fff',
    background: kind === 'ok' ? COLOR.ok : COLOR.err,
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)', opacity: '0', transition: 'opacity 120ms',
  });
  t.textContent = message;
  document.body.append(t);
  requestAnimationFrame(() => (t.style.opacity = '1'));
  setTimeout(() => {
    t.style.opacity = '0';
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
 */
export function buildPanel(title: string, action?: HTMLElement): HTMLElement {
  const panel = styled('div', 'atx-panel', {
    position: 'fixed', zIndex: String(Z + 6), left: '50%', top: '50%',
    transform: 'translate(-50%, -50%)', width: 'min(420px, 92vw)',
    background: COLOR.panelBg, color: '#eee', borderRadius: '12px',
    boxShadow: '0 12px 48px rgba(0,0,0,0.5)', border: `1px solid ${COLOR.panelBorder}`,
    overflow: 'hidden', font: '13px system-ui',
    // Edit mode sets a crosshair cursor on the whole page; our UI is not a
    // click-to-edit surface, so restore normal per-element cursors.
    cursor: 'auto',
  });

  const bar = styled('div', 'atx-panel-title', {
    padding: '12px 16px', font: '600 13px system-ui', borderBottom: `1px solid ${COLOR.panelDivider}`,
    display: 'flex', alignItems: 'center', gap: '8px',
  });
  const heading = styled('span', 'atx-panel-heading', {
    flex: '1', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  });
  heading.textContent = title;
  bar.append(heading);
  if (action) bar.append(action);

  const body = styled('div', 'atx-panel-body', { padding: '16px' });
  body.dataset.body = '';
  isolateScroll(body);

  const foot = styled('div', 'atx-panel-foot', {
    padding: '12px 16px', display: 'flex', gap: '8px', justifyContent: 'flex-end',
    borderTop: `1px solid ${COLOR.panelDivider}`,
  });
  foot.dataset.foot = '';

  panel.append(bar, body, foot);
  return panel;
}

/** A right-side drawer shell (entry editor): title bar with an action slot,
 *  scrollable body, sticky footer. Same [data-body]/[data-foot] contract as
 *  buildPanel, so wirePanelButtons works unchanged. */
export function buildDrawer(title: string): HTMLElement {
  const drawer = styled('div', 'atx-drawer', {
    position: 'fixed', zIndex: String(Z + 6), right: '0', top: '0',
    // Half the screen, but never narrower than the classic 440px drawer and
    // never wider than the viewport allows on small screens.
    height: '100vh', width: 'min(max(440px, 50vw), 94vw)', display: 'flex', flexDirection: 'column',
    background: COLOR.panelBg, color: '#eee',
    boxShadow: '-8px 0 40px rgba(0,0,0,0.45)', borderLeft: `1px solid ${COLOR.panelBorder}`,
    font: '13px system-ui', boxSizing: 'border-box',
    // Edit mode sets a crosshair cursor on the whole page; our UI is not a
    // click-to-edit surface, so restore normal per-element cursors.
    cursor: 'auto',
  });

  const bar = styled('div', 'atx-drawer-title', {
    padding: '14px 16px', font: '600 13px system-ui', flex: '0 0 auto',
    borderBottom: `1px solid ${COLOR.panelDivider}`,
    display: 'flex', alignItems: 'center', gap: '8px',
  });
  const barText = styled('span', 'atx-drawer-title-text', {
    flex: '1 1 auto', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
  });
  barText.textContent = title;
  const barActions = styled('span', 'atx-drawer-actions', {
    flex: '0 0 auto', display: 'flex', gap: '6px',
  });
  barActions.dataset.actions = '';
  bar.append(barText, barActions);

  const body = styled('div', 'atx-drawer-body', {
    padding: '16px', flex: '1 1 auto', overflowY: 'auto',
  });
  body.dataset.body = '';
  isolateScroll(body);

  const foot = styled('div', 'atx-drawer-foot', {
    padding: '12px 16px', display: 'flex', gap: '8px', justifyContent: 'flex-end',
    borderTop: `1px solid ${COLOR.panelDivider}`, flex: '0 0 auto',
  });
  foot.dataset.foot = '';

  drawer.append(bar, body, foot);
  return drawer;
}

/** Dim backdrop that closes the panel when clicked. */
export function buildBackdrop(onClose: () => void): HTMLElement {
  const b = styled('div', 'atx-backdrop', {
    position: 'fixed', inset: '0', zIndex: String(Z + 5),
    background: 'rgba(0,0,0,0.4)',
  });
  b.addEventListener('click', onClose);
  return b;
}

/** Footer-button variants. `cancel` and `ghost` render identically; the class
 *  names differ because the README documents them as separate theming hooks. */
export type ButtonKind = 'primary' | 'secondary' | 'cancel' | 'ghost' | 'danger';

const BUTTON_STYLES: Record<ButtonKind, Partial<CSSStyleDeclaration>> = {
  primary: { border: 'none', background: COLOR.accent, color: '#fff' },
  secondary: { border: '1px solid #5a5a7a', background: 'transparent', color: '#cdd' },
  cancel: { border: '1px solid #3a3a4d', background: 'transparent', color: '#ccc' },
  ghost: { border: '1px solid #3a3a4d', background: 'transparent', color: '#ccc' },
  // marginRight:auto pushes a danger button to the far left of a flex footer,
  // away from the safe actions.
  danger: { border: '1px solid #7a3a3a', background: 'transparent', color: '#ff8a80', marginRight: 'auto' },
};

/** A panel/drawer footer button. The single source of button styling. */
export function footButton(label: string, kind: ButtonKind, onClick: () => void): HTMLButtonElement {
  const btn = styled('button', `atx-btn atx-btn-${kind}`, {
    padding: '7px 14px', borderRadius: '7px', cursor: 'pointer', font: '600 13px system-ui',
    ...BUTTON_STYLES[kind],
  });
  btn.type = 'button';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
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
  const btn = styled('button', className, {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
    marginLeft: '8px', padding: '2px 7px', font: `600 11px ${FONT.ui}`,
    color: '#fff', background: 'rgba(255,255,255,0.14)',
    border: 'none', borderRadius: '4px', cursor: 'pointer',
    ...extra,
  });
  btn.type = 'button';
  /**
   * Optical centring, which flexbox can't do for text. `align-items: center`
   * lines up the *boxes*, but a text box is asymmetric around its ink: on an
   * 11px label it reserves ~11px above the baseline for ascenders and 2px
   * below, while an all-lowercase word ("open", "copy") only paints the ~6px
   * x-height band. Centred by box, that band lands ~1.5px below the middle of
   * the pill and the label reads as sitting low. Lift it onto the pill's
   * centre; the icon, whose glyph does fill its box, needs no correction.
   *
   * Offset rather than margin (a margin would be half-absorbed by the centring
   * it is correcting) and `relative` rather than a transform (the spinner icon
   * animates the host's own transform).
   */
  const text = styled('span', 'atx-pill-label', { position: 'relative', top: '-1.5px' });
  text.dataset.label = '';
  text.textContent = label;
  if (iconEl) btn.append(iconEl);
  btn.append(text);
  btn.title = title;
  btn.addEventListener('mouseenter', () => (btn.style.background = 'rgba(255,255,255,0.28)'));
  btn.addEventListener('mouseleave', () => (btn.style.background = 'rgba(255,255,255,0.14)'));
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
  foot.append(footButton('Cancel', 'cancel', onCancel));
  if (opts.secondaryLabel && opts.onSecondary) {
    foot.append(footButton(opts.secondaryLabel, 'secondary', opts.onSecondary));
  }
  foot.append(footButton(opts.confirmLabel ?? 'Save', 'primary', onConfirm));
}
