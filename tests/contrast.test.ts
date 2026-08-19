import { describe, expect, it } from 'vitest';
import { COLOR } from '../src/client/ui.ts';

/**
 * Contrast guard for the overlay's ink tokens.
 *
 * The overlay has no stylesheet, so nothing but this test stops an ink from
 * drifting back below the legibility floor — and the failure is silent, because
 * unreadable text still renders. `ui.ts` owns the inks; the surfaces they land
 * on are inline `background` values spread across the client, so the ones that
 * bound each ink are restated here by name.
 *
 * Pairings are per-ink rather than a blanket cross-product on purpose: the
 * lightest surface in the overlay (the asset picker's transparency
 * checkerboard) only ever carries `muted`, and holding every ink to it would
 * force inks lighter than their own worst case needs. When a new panel puts an
 * existing ink on a lighter background than the ones listed for it, add that
 * background to its row — that is the moment the ink needs rechecking.
 */

/** WCAG 2.1 relative luminance. Shorthand hex is expanded first — `#888` parses
 *  as 0x000888 otherwise, which reads as near-black and would pass anything. */
function luminance(hex: string): number {
  const raw = hex.replace('#', '');
  const n = parseInt(raw.length === 3 ? raw.replace(/./g, '$&$&') : raw, 16);
  const chan = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA for normal-size text. */
const AA_TEXT = 4.5;
/** WCAG 1.4.11, the boundary of a control. */
const AA_NON_TEXT = 3;

/** Opaque backgrounds the overlay paints on, by the module that owns each. */
const SURFACE = {
  peek: '#12121d', // editors/peek.ts CODE_BG — the darkest
  field: '#111111', // ui.ts INPUT_STYLE
  panel: COLOR.panelBg, // ui.ts buildPanel / buildDrawer
  menu: '#232230', // admin-bar.ts menu, over an opaque page
  row: '#20202e', // editors/media-grid.ts tile
  checker: '#2a2a3a', // editors/asset-picker.ts transparency checkerboard
} as const;

/** Each foreground ink against the surfaces it is actually painted on. */
const INK_ON: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  // Help text and hints, the overlay's most widespread secondary ink — and the
  // only one that lands on the checkerboard, which is what sets its floor.
  ['muted', COLOR.muted, [SURFACE.peek, SURFACE.panel, SURFACE.menu, SURFACE.row, SURFACE.checker]],
  // Peek line numbers, empty-state glyphs, the menu's status footer.
  ['faint', COLOR.faint, [SURFACE.peek, SURFACE.panel, SURFACE.menu, SURFACE.row]],
  ['accentText', COLOR.accentText, [SURFACE.panel, SURFACE.row]],
  ['errText', COLOR.errText, [SURFACE.peek, SURFACE.panel, SURFACE.row]],
  ['warn', COLOR.warn, [SURFACE.panel, SURFACE.row]],
  ['image', COLOR.image, [SURFACE.panel]],
];

describe('overlay ink contrast', () => {
  for (const [name, ink, surfaces] of INK_ON) {
    it(`${name} clears AA on every surface it is used on`, () => {
      for (const surface of surfaces) {
        expect(contrast(ink, surface), `${name} (${ink}) on ${surface}`).toBeGreaterThanOrEqual(
          AA_TEXT,
        );
      }
    });
  }

  // `accent` and `err` are backgrounds. The lightened `accentText`/`errText`
  // exist precisely because these two fail as foregrounds — assert that, so the
  // split does not get "simplified" away and the raw colours reused as ink.
  it('accent and err fail as text, which is what the *Text pair is for', () => {
    expect(contrast(COLOR.accent, COLOR.panelBg)).toBeLessThan(AA_TEXT);
    expect(contrast(COLOR.err, COLOR.panelBg)).toBeLessThan(AA_TEXT);
  });
});

describe('overlay colours that carry white text', () => {
  for (const [name, bg] of Object.entries({
    accent: COLOR.accent, // primary buttons, the veil chip, the bar's dirty state
    ok: COLOR.ok, // success toast, the bar's saved state
    err: COLOR.err, // error toast, the bar's failed state
    idle: COLOR.idle,
  })) {
    it(`white clears AA on ${name}`, () => {
      expect(contrast('#ffffff', bg)).toBeGreaterThanOrEqual(AA_TEXT);
    });
  }
});

describe('control boundaries', () => {
  it('control is visible against a field interior and every panel surface', () => {
    for (const surface of [SURFACE.field, SURFACE.panel, SURFACE.row]) {
      expect(contrast(COLOR.control, surface), `control on ${surface}`).toBeGreaterThanOrEqual(
        AA_NON_TEXT,
      );
    }
  });

  it('errBorder is visible on panelBg', () => {
    expect(contrast(COLOR.errBorder, COLOR.panelBg)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });
});
