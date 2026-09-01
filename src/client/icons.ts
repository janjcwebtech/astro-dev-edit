import { styled } from "./ui.ts";

/**
 * The overlay's icon set: stroke paths on a 24px grid, drawn with `currentColor`
 * so every icon inherits the colour of the control it sits in.
 *
 * The paths are adapted from **Lucide** (https://lucide.dev), ISC licensed:
 *
 *   Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as
 *   part of Feather (MIT). All other copyright (c) for Lucide are held by
 *   Lucide Contributors 2022. Licensed under the ISC License.
 *
 * Inlined as one table rather than installed as a package — the overlay has no
 * runtime dependencies and ships no font file, and copying the paths keeps it
 * that way. `svgMarkup` below writes Lucide's own wrapper (24-box, 2px stroke,
 * round caps and joins), so a path pastes in unchanged; four glyphs deviate and
 * each says why at its entry.
 *
 * `icon()` returns a `<span>` built through ui.ts::styled, so an icon is
 * router-exempt (never treated as an editable page element) and carries the
 * `atx-ico` theming hook like everything else in the overlay. Size is set by
 * the caller; 14px is the bar/pill default, 12px suits dense rows.
 */

export type IconName =
  | "cursor"
  | "pencil"
  | "file"
  | "pin"
  | "pinOff"
  | "panelTop"
  | "panelBottom"
  | "sidebar"
  | "check"
  | "dot"
  | "spinner"
  | "alert"
  | "x"
  | "plus"
  | "trash"
  | "quote"
  | "link"
  | "chevronRight"
  | "chevronDown"
  | "copy"
  | "code"
  | "external"
  | "settings"
  | "collections"
  | "lock"
  | "image"
  | "search"
  | "upload";

/** Path geometry only — the wrapper `<svg>` supplies stroke, width and caps. */
const PATHS: Record<IconName, string> = {
  // The overlay's own mark: a click-to-edit pointer. Lucide's `mouse-pointer-2`
  // filled — this one is an identity rather than a glyph in a row, and the
  // solid arrow holds up at the 14px the toggle draws it at.
  cursor:
    '<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" fill="currentColor"/>',
  pencil:
    '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  // file-text
  file: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  pinOff:
    '<path d="M12 17v5"/><path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89"/><path d="m2 2 20 20"/><path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11"/>',
  // panel-top / panel-bottom / panel-left, with the band filled. Lucide's three
  // differ only by where one divider line sits, which is not readable at the
  // 14px the bar draws them at — the fill is what says which edge is docked.
  panelTop:
    '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M5 3h14a2 2 0 0 1 2 2v4H3V5a2 2 0 0 1 2-2z" fill="currentColor" stroke="none"/>',
  panelBottom:
    '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 15h18v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="currentColor" stroke="none"/>',
  sidebar:
    '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M5 3h4v18H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="currentColor" stroke="none"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  // Lucide has no filled dot: `circle-small` is a ring at r=6, and filling that
  // gives a disc a third wider than the mark it replaces, out of weight with
  // every other glyph here. This one stays hand-drawn.
  dot: '<circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none"/>',
  // Two arcs of one ring rather than Lucide's single `loader-circle` sweep: the
  // dim half is what makes the rotation readable.
  spinner:
    '<path d="M12 3a9 9 0 1 0 9 9" opacity="0.9"/><path d="M12 3a9 9 0 0 1 9 9" opacity="0.25"/>',
  // triangle-alert
  alert:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  // trash-2
  trash:
    '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  quote:
    '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-1a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2H5a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>',
  // link-2
  link: '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  // code-xml — the slash is what reads as *source*, not as a pair of brackets.
  code: '<path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/>',
  // external-link
  external:
    '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  settings:
    '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
  // database: a collection *is* the content store behind the pages, so the
  // stacked-cylinder mark is the right one.
  collections:
    '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  // A closed padlock — marks a setting the project's own config owns.
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  image:
    '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  search: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
  upload:
    '<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
};

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function svgMarkup(name: IconName, size: number): string {
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    `stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`
  );
}

/** An icon element, ready to append into a button, row or label. */
export function icon(name: IconName, size = 16): HTMLElement {
  const host = styled("span", "atx-ico");
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
  if (name === "spinner" && !window.matchMedia(REDUCED_MOTION).matches) {
    host.animate(
      [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
      {
        duration: 850,
        iterations: Infinity,
      },
    );
  }
}
