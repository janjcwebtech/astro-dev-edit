import { styled } from './ui.ts';

/**
 * The overlay's icon set: hand-authored stroke paths on a 24px grid, drawn with
 * `currentColor` so every icon inherits the colour of the control it sits in.
 *
 * Inline SVG rather than unicode glyphs (✎ ⌗ ▸ ✕ …), which render at wildly
 * different weights and baselines per platform font, and rather than an icon
 * package — the overlay has no runtime dependencies and ships no font file, and
 * one module of paths keeps it that way.
 *
 * `icon()` returns a `<span>` built through ui.ts::styled, so an icon is
 * router-exempt (never treated as an editable page element) and carries the
 * `atx-ico` theming hook like everything else in the overlay. Size is set by
 * the caller; 14px is the bar/pill default, 12px suits dense rows.
 */

export type IconName =
  | 'cursor'
  | 'pencil'
  | 'file'
  | 'pin'
  | 'pinOff'
  | 'panelTop'
  | 'panelBottom'
  | 'sidebar'
  | 'check'
  | 'dot'
  | 'spinner'
  | 'alert'
  | 'x'
  | 'chevronRight'
  | 'chevronDown'
  | 'copy'
  | 'code'
  | 'external'
  | 'settings'
  | 'collections'
  | 'lock'
  | 'image'
  | 'search'
  | 'upload';

/** Path geometry only — the wrapper `<svg>` supplies stroke, width and caps. */
const PATHS: Record<IconName, string> = {
  // The overlay's own mark: a click-to-edit pointer.
  cursor:
    '<path d="M5 3.5 11.2 20l2.1-6.2 6.2-2.1z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  pencil: '<path d="M4 20h4L19.2 8.8a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20z"/><path d="M14.8 6.2 18 9.4"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/>',
  pin: '<path d="M12 17.5V22"/><path d="M9 3h6v7.5l2.5 3.5h-11L9 10.5z"/>',
  pinOff: '<path d="M12 17.5V22"/><path d="M9 3h6v7.5l2.5 3.5h-11L9 10.5z"/><path d="M3.5 3.5 20.5 20.5"/>',
  panelTop:
    '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M5 4h14a2 2 0 0 1 2 2v3H3V6a2 2 0 0 1 2-2z" fill="currentColor" stroke="none"/>',
  panelBottom:
    '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 15h18v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3z" fill="currentColor" stroke="none"/>',
  sidebar:
    '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M5 4h4v16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="currentColor" stroke="none"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  dot: '<circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none"/>',
  // Two arcs of one ring: the dim half makes the rotation readable.
  spinner: '<path d="M12 3a9 9 0 1 0 9 9" opacity="0.9"/><path d="M12 3a9 9 0 0 1 9 9" opacity="0.25"/>',
  alert: '<path d="M12 3.5 21.5 20H2.5z"/><path d="M12 9.5v4.5"/><path d="M12 17.2h.01"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  chevronRight: '<path d="m9.5 6 6 6-6 6"/>',
  chevronDown: '<path d="m6 9.5 6 6 6-6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/>',
  code: '<path d="m8 6-6 6 6 6"/><path d="m16 6 6 6-6 6"/>',
  external:
    '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  // A cog: eight teeth as one path, plus the hub. Drawn rather than borrowed so
  // it matches the 24-box, 1.6-stroke geometry of everything above.
  settings:
    '<path d="M12 2.6l1.5 2.2 2.6-.6.6 2.6 2.2 1.5-1.2 2.4 1.2 2.4-2.2 1.5-.6 2.6-2.6-.6L12 21.4l-1.5-2.2-2.6.6-.6-2.6-2.2-1.5 1.2-2.4-1.2-2.4 2.2-1.5.6-2.6 2.6.6z"/><circle cx="12" cy="12" r="3.2"/>',
  // A closed padlock — marks a setting the project's own config owns.
  // Collections: the stacked-cylinder data-store mark. A collection *is* the
  // content store behind the pages, so the conventional glyph is the right one.
  collections:
    '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8v-13"/><path d="M4.5 12c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8"/>',
  lock:
    '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  // Picture frame with a sun and a hill — the media/asset glyph.
  image:
    '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="8.5" cy="10" r="1.8"/><path d="m3.5 17.5 5-5 4.5 4.5 3-2.5 4.5 4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
  upload: '<path d="M12 16V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
};

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function svgMarkup(name: IconName, size: number): string {
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    `stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`
  );
}

/** An icon element, ready to append into a button, row or label. */
export function icon(name: IconName, size = 16): HTMLElement {
  const host = styled('span', 'atx-ico');
  paint(host, name, size);
  return host;
}

/** Swap an existing icon element's glyph in place (same node, same styling). */
export function setIcon(host: HTMLElement, name: IconName, size = 16): void {
  if (host.dataset.icon === name) return;
  paint(host, name, size);
}

function paint(host: HTMLElement, name: IconName, size: number): void {
  host.dataset.icon = name;
  // Static, hand-authored markup from the table above — no interpolation of
  // anything the page or the server supplied.
  host.innerHTML = svgMarkup(name, size);
  for (const anim of host.getAnimations()) anim.cancel();
  if (name === 'spinner' && !window.matchMedia(REDUCED_MOTION).matches) {
    host.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
      duration: 850,
      iterations: Infinity,
    });
  }
}
