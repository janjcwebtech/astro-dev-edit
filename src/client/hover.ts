import type { SourceLoc } from '../shared/protocol.ts';
import { nearestSource, sourceFor } from './source-map.ts';
import { COLOR, FONT, Z, basename, hexToRgba, styled } from './ui.ts';

/**
 * Hover behaviour: the outline that tracks the hovered source-mapped element
 * and the interactive tooltip pill (file:loc · kind, plus an "open ↗" button).
 * Hover state is self-contained here — it never interacts with the editing
 * slot in state.ts.
 */

/** DOM-side hover hint only — the server's ClassifyResult is authoritative. */
type Classification = 'editable' | 'image' | 'dynamic' | 'unknown';

/**
 * A cheap, purely-visual guess so the tooltip can say what will happen. The
 * server re-classifies from the AST at apply time regardless. (spec §7.3)
 */
function classify(el: HTMLElement): Classification {
  if (el.tagName === 'IMG') return 'image';

  const children = Array.from(el.childNodes);
  const hasElementChild = children.some((n) => n.nodeType === Node.ELEMENT_NODE);
  const hasText = children.some(
    (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0,
  );

  // Only-text content is the safe editable case. Anything with child elements
  // could be expression- or component-driven — treat as dynamic until the
  // server says otherwise. (spec §7.1 / §7.2)
  if (hasText && !hasElementChild) return 'editable';
  if (hasElementChild) return 'dynamic';
  return 'unknown';
}

const CLASS_COLOR: Record<Classification, string> = {
  editable: COLOR.accent,
  image: COLOR.image,
  dynamic: COLOR.warn,
  unknown: COLOR.muted,
};

// --- Elements (appended to the body by the composition root at boot) --------

const outline = styled('div', 'atx-outline', {
  position: 'fixed',
  pointerEvents: 'none',
  zIndex: String(Z),
  border: `2px solid ${COLOR.accent}`,
  borderRadius: '3px',
  background: 'rgba(124, 92, 255, 0.08)',
  display: 'none',
  transition: 'all 60ms ease-out',
}, 'atx-outline');

// The pill is interactive: hovering it keeps it open, and its "open source"
// button jumps to the element's source in the editor. (#3)
const tooltip = styled('div', 'atx-tooltip', {
  position: 'fixed',
  pointerEvents: 'auto',
  zIndex: String(Z + 1),
  padding: '4px 4px 4px 8px',
  font: `500 12px/1.4 ${FONT.mono}`,
  color: '#fff',
  background: '#1a1a2e',
  borderRadius: '5px',
  boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
  display: 'none',
  whiteSpace: 'nowrap',
  cursor: 'default',
}, 'atx-tooltip');

const tooltipLabel = styled('span', 'atx-tooltip-label', {});
const tooltipOpen = styled('button', 'atx-tooltip-open', {
  marginLeft: '8px',
  padding: '2px 7px',
  font: `600 11px ${FONT.ui}`,
  color: '#fff',
  background: 'rgba(255,255,255,0.14)',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
});
tooltipOpen.type = 'button';
tooltipOpen.textContent = 'open ↗';
tooltipOpen.title = 'Open this location in your editor';
tooltipOpen.addEventListener('mouseenter', () => (tooltipOpen.style.background = 'rgba(255,255,255,0.28)'));
tooltipOpen.addEventListener('mouseleave', () => (tooltipOpen.style.background = 'rgba(255,255,255,0.14)'));
tooltip.append(tooltipLabel, tooltipOpen);

// --- Hover state -------------------------------------------------------------

let highlighted: HTMLElement | null = null;
// Source of the currently-highlighted element, so the pill's "open" button
// knows what to open.
let highlightedSrc: SourceLoc | null = null;
// Grace timer: when the mouse leaves an element we wait briefly before hiding,
// so the user can travel up to the pill and click it without it vanishing. (#3)
let hideTimer: number | null = null;

function cancelHide(): void {
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function scheduleHide(): void {
  cancelHide();
  hideTimer = window.setTimeout(clearHighlight, 220);
}

export function clearHighlight(): void {
  cancelHide();
  highlighted = null;
  highlightedSrc = null;
  outline.style.display = 'none';
  tooltip.style.display = 'none';
}

// Keep the pill open while hovered. (#3)
tooltip.addEventListener('mouseenter', cancelHide);
tooltip.addEventListener('mouseleave', scheduleHide);

export interface HoverDeps {
  isEditMode(): boolean;
  openSource(src: SourceLoc): void;
}

/** Wire the hover listeners; returns the elements for the boot code to append
 *  once the server health check passes. */
export function initHover(deps: HoverDeps): HTMLElement[] {
  tooltipOpen.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (highlightedSrc) deps.openSource(highlightedSrc);
  });

  function onMouseMove(e: MouseEvent): void {
    if (!deps.isEditMode()) return;
    // Moving onto our own pill must NOT count as leaving the element.
    if (e.target instanceof Node && tooltip.contains(e.target)) {
      cancelHide();
      return;
    }
    const el = nearestSource(e.target);
    if (!el) {
      scheduleHide(); // grace period instead of instant hide
      return;
    }
    cancelHide();
    if (el === highlighted) return;
    highlighted = el;

    const kind = classify(el);
    const color = CLASS_COLOR[kind];
    const rect = el.getBoundingClientRect();

    Object.assign(outline.style, {
      display: 'block',
      left: `${rect.left - 2}px`,
      top: `${rect.top - 2}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      borderColor: color,
      background: hexToRgba(color, 0.08),
    } as Partial<CSSStyleDeclaration>);

    const src = sourceFor(el);
    highlightedSrc = src ?? null;
    const file = src?.file ?? '';
    const loc = src?.loc || '?';
    tooltipLabel.textContent = `${basename(file)}:${loc} · ${kind}`;
    tooltip.style.borderLeft = `3px solid ${color}`;
    tooltip.style.display = 'block';
    // Prefer above the element; if there's no room, sit just below it. Add a
    // little vertical overlap so travelling from element to pill doesn't cross
    // a dead gap that would trigger the hide.
    const top = rect.top - 28 < 4 ? rect.bottom + 4 : rect.top - 28;
    tooltip.style.left = `${Math.max(4, rect.left)}px`;
    tooltip.style.top = `${top}px`;
  }

  document.addEventListener('mousemove', onMouseMove, { passive: true });
  window.addEventListener('scroll', clearHighlight, { passive: true });

  return [outline, tooltip];
}
