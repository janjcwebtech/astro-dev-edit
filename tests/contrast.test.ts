import { describe, expect, it } from 'vitest';
import { COLOR, PAPER } from '../src/client/ui.ts';

/**
 * Contrast guard for the overlay's design tokens.
 *
 * The overlay has no stylesheet, so nothing but this test stops an ink from
 * drifting below the legibility floor — and the failure is silent, because
 * unreadable text still renders.
 *
 * The token set is small enough that inks are held to *every* surface they can
 * land on rather than to a hand-listed subset. That is what `COLOR`'s three
 * surfaces buy: with `background`, `card` and `elevated` as the only opaque
 * grounds the overlay paints, "which surfaces does this ink appear on" stops
 * being a question a reader of this file has to answer correctly.
 *
 * `PAPER` is checked separately against its own ground, because the rich-text
 * editor is a light island and mixing the two sets is exactly the mistake these
 * assertions exist to catch.
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

/** Every opaque ground the overlay paints. Panels and drawers use `card`, list
 *  rows and the admin bar use `elevated`, field interiors and code wells use
 *  `background`. */
const SURFACES = ['background', 'card', 'elevated'] as const;

/** Tokens used as foreground text. */
const INKS = [
  'foreground',
  'mutedFg',
  'faintFg',
  'primaryText',
  'destructiveText',
  'successText',
  'warning',
  'info',
  'chart1',
  'chart2',
  'chart3',
  'chart4',
  'chart5',
] as const;

describe('overlay ink contrast', () => {
  for (const ink of INKS) {
    it(`${ink} clears AA on every overlay surface`, () => {
      for (const surface of SURFACES) {
        expect(
          contrast(COLOR[ink], COLOR[surface]),
          `${ink} (${COLOR[ink]}) on ${surface} (${COLOR[surface]})`,
        ).toBeGreaterThanOrEqual(AA_TEXT);
      }
    });
  }

  // `primary`, `destructive` and `success` are backgrounds. The lightened
  // `primaryText`/`destructiveText`/`successText` exist precisely because they
  // fail as foregrounds — assert that, so the split does not get "simplified"
  // away and the raw colours reused as ink.
  it('the filled tokens fail as text, which is what the *Text pair is for', () => {
    expect(contrast(COLOR.primary, COLOR.card)).toBeLessThan(AA_TEXT);
    expect(contrast(COLOR.destructive, COLOR.card)).toBeLessThan(AA_TEXT);
    expect(contrast(COLOR.success, COLOR.card)).toBeLessThan(AA_TEXT);
  });
});

describe('overlay colours that carry foreground text', () => {
  for (const bg of ['primary', 'destructive', 'success'] as const) {
    it(`foreground clears AA on ${bg}`, () => {
      expect(contrast(COLOR.foreground, COLOR[bg])).toBeGreaterThanOrEqual(AA_TEXT);
    });
  }

  it('primaryFg clears AA on primary', () => {
    expect(contrast(COLOR.primaryFg, COLOR.primary)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe('control boundaries', () => {
  it('input is visible against every overlay surface', () => {
    for (const surface of SURFACES) {
      expect(
        contrast(COLOR.input, COLOR[surface]),
        `input on ${surface}`,
      ).toBeGreaterThanOrEqual(AA_NON_TEXT);
    }
  });

  it('ring is visible against every overlay surface', () => {
    for (const surface of SURFACES) {
      expect(contrast(COLOR.ring, COLOR[surface]), `ring on ${surface}`).toBeGreaterThanOrEqual(
        AA_NON_TEXT,
      );
    }
  });

  it('destructiveBorder is visible on card', () => {
    expect(contrast(COLOR.destructiveBorder, COLOR.card)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  // `border` is a separator, not a control boundary, and sits below the
  // non-text floor on purpose. Pinned so nobody "fixes" it into a hard line
  // across every panel — an outline the user must see to operate is `input`.
  it('border stays quieter than a control boundary', () => {
    expect(contrast(COLOR.border, COLOR.card)).toBeLessThan(AA_NON_TEXT);
  });
});

describe('the rich-text editor is a light island', () => {
  for (const ground of ['bg', 'muted'] as const) {
    it(`paper ink and links clear AA on paper ${ground}`, () => {
      expect(contrast(PAPER.fg, PAPER[ground])).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrast(PAPER.link, PAPER[ground])).toBeGreaterThanOrEqual(AA_TEXT);
    });
  }

  // The hazard the two sets create is mixing them: paper ink on an overlay
  // surface is invisible (1.0:1), and it is a plausible mistake because both
  // tokens are called some kind of "foreground". Pinned so the failure is a
  // red test rather than a blank panel.
  it('paper ink is invisible on overlay surfaces, so the sets must not be mixed', () => {
    for (const surface of SURFACES) {
      expect(contrast(PAPER.fg, COLOR[surface])).toBeLessThan(AA_NON_TEXT);
    }
  });
});

describe('glass is the one tinted grey, and only where it is translucent', () => {
  // The inverse of the neutral-ramp guard below. These two exist *because*
  // chroma 0 costs the transparency their alpha pays for — a neutral grey over
  // a white page reads as a scrim, not as glass. Pinned so a later neutrality
  // sweep does not quietly flatten them back and take the depth with it.
  for (const token of ['glass', 'glassRaised'] as const) {
    it(`${token} carries a hue`, () => {
      const raw = COLOR[token].replace('#', '');
      const [r, g, b] = [raw.slice(0, 2), raw.slice(2, 4), raw.slice(4, 6)];
      expect(`${token}: ${r}/${g}/${b}`).not.toBe(`${token}: ${r}/${r}/${r}`);
      expect(parseInt(b, 16)).toBeGreaterThan(parseInt(r, 16));
    });
  }

  // ...but only just. The old palette sat every surface at ~0.029 chroma; these
  // are meant to read as glass, not as a violet cast returning by the back door.
  for (const token of ['glass', 'glassRaised'] as const) {
    it(`${token} stays far below the old violet cast`, () => {
      const raw = COLOR[token].replace('#', '');
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16));
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(10);
    });
  }
});

describe('the neutral ramp is actually neutral', () => {
  // The old palette's greys carried a violet tint (chroma ~0.03 at hue 284).
  // These are authored at chroma 0, which in sRGB means R === G === B.
  for (const token of ['background', 'card', 'elevated', 'border', 'input', 'foreground', 'mutedFg', 'faintFg'] as const) {
    it(`${token} has no hue`, () => {
      const raw = COLOR[token].replace('#', '');
      const [r, g, b] = [raw.slice(0, 2), raw.slice(2, 4), raw.slice(4, 6)];
      expect(`${token}: ${r}/${g}/${b}`).toBe(`${token}: ${r}/${r}/${r}`);
      expect(g).toBe(r);
      expect(b).toBe(r);
    });
  }
});
