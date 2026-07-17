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

/** Bottom-center toast. `kind` sets the accent. Auto-dismisses. */
export function toast(message: string, kind: 'ok' | 'err'): void {
  const t = styled('div', `atx-toast atx-toast-${kind}`, {
    position: 'fixed', zIndex: String(Z + 5), left: '50%', bottom: '24px',
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

/** A centered modal panel shell with a title bar, body slot, and footer slot. */
export function buildPanel(title: string): HTMLElement {
  const panel = styled('div', 'atx-panel', {
    position: 'fixed', zIndex: String(Z + 6), left: '50%', top: '50%',
    transform: 'translate(-50%, -50%)', width: 'min(420px, 92vw)',
    background: COLOR.panelBg, color: '#eee', borderRadius: '12px',
    boxShadow: '0 12px 48px rgba(0,0,0,0.5)', border: `1px solid ${COLOR.panelBorder}`,
    overflow: 'hidden', font: '13px system-ui',
  });

  const bar = styled('div', 'atx-panel-title', {
    padding: '12px 16px', font: '600 13px system-ui', borderBottom: `1px solid ${COLOR.panelDivider}`,
  });
  bar.textContent = title;

  const body = styled('div', 'atx-panel-body', { padding: '16px' });
  body.dataset.body = '';

  const foot = styled('div', 'atx-panel-foot', {
    padding: '12px 16px', display: 'flex', gap: '8px', justifyContent: 'flex-end',
    borderTop: `1px solid ${COLOR.panelDivider}`,
  });
  foot.dataset.foot = '';

  panel.append(bar, body, foot);
  return panel;
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

/** Populate a panel's footer with cancel + confirm buttons, and optionally a
 *  secondary (outline) button between them for a second action. */
export function wirePanelButtons(
  panel: HTMLElement,
  onCancel: () => void,
  onConfirm: () => void,
  opts: { confirmLabel?: string; secondaryLabel?: string; onSecondary?: () => void } = {},
): void {
  const foot = panel.querySelector('[data-foot]') as HTMLElement;
  const cancel = styled('button', 'atx-btn atx-btn-cancel', {
    padding: '7px 14px', borderRadius: '7px', border: '1px solid #3a3a4d',
    background: 'transparent', color: '#ccc', cursor: 'pointer', font: '600 13px system-ui',
  });
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', onCancel);
  foot.append(cancel);

  if (opts.secondaryLabel && opts.onSecondary) {
    const secondary = styled('button', 'atx-btn atx-btn-secondary', {
      padding: '7px 14px', borderRadius: '7px', border: '1px solid #5a5a7a',
      background: 'transparent', color: '#cdd', cursor: 'pointer', font: '600 13px system-ui',
    });
    secondary.type = 'button';
    secondary.textContent = opts.secondaryLabel;
    secondary.addEventListener('click', opts.onSecondary);
    foot.append(secondary);
  }

  const confirm = styled('button', 'atx-btn atx-btn-primary', {
    padding: '7px 14px', borderRadius: '7px', border: 'none',
    background: COLOR.accent, color: '#fff', cursor: 'pointer', font: '600 13px system-ui',
  });
  confirm.type = 'button';
  confirm.textContent = opts.confirmLabel ?? 'Save';
  confirm.addEventListener('click', onConfirm);
  foot.append(confirm);
}
