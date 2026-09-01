import { describe, expect, it } from 'vitest';
import { COLOR, PAPER } from '../src/client/ui.ts';

/**
 * Contrast guard for the overlay's design tokens.
 *
 * Nothing but this test stops an ink from drifting below the legibility floor —
 * and the failure is silent, because unreadable text still renders.
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
 *
 * **Translucent tokens have no single contrast value.** `border`, `input` and
 * `inputBg` are white at a low alpha so that one value is right on every
 * surface — which means each has one ratio *per surface*, and the only way to
 * compute it is to flatten it onto that surface first. Hence `composite`.
 */

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Parse the two notations the tokens are written in: `#rgb` / `#rrggbb`, and
 * the `rgb(r g b / a)` space-separated form the translucent tokens use.
 *
 * Shorthand hex is expanded first — `#888` parses as 0x000888 otherwise, which
 * reads as near-black and would pass anything.
 */
function parse(color: string): Rgba {
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[/,]\s*([\d.]+%?))?\s*\)$/i.exec(
    color.trim(),
  );
  if (fn) {
    const alpha = fn[4] === undefined ? 1 : fn[4].endsWith('%')
      ? Number.parseFloat(fn[4]) / 100
      : Number.parseFloat(fn[4]);
    return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a: alpha };
  }
  const raw = color.replace('#', '');
  const hex = raw.length === 3 ? raw.replace(/./g, '$&$&') : raw;
  if (!/^[0-9a-f]{6}$/i.test(hex)) throw new Error(`unparseable colour: ${color}`);
  const n = Number.parseInt(hex, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
}

/** Flatten a (possibly translucent) colour onto an opaque ground. */
function composite(fg: string, bg: string): Rgba {
  const f = parse(fg);
  const b = parse(bg);
  const mix = (x: number, y: number): number => Math.round(x * f.a + y * (1 - f.a));
  return { r: mix(f.r, b.r), g: mix(f.g, b.g), b: mix(f.b, b.b), a: 1 };
}

/** WCAG 2.1 relative luminance. */
function luminance({ r, g, b }: Rgba): number {
  const chan = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

/** Contrast of `fg` against the opaque `bg` it lands on, flattening `fg` first
 *  if it is translucent. Order matters, unlike the opaque-only version. */
function contrast(fg: string, bg: string): number {
  const [hi, lo] = [luminance(composite(fg, bg)), luminance(parse(bg))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA for normal-size text. */
const AA_TEXT = 4.5;
/** WCAG 1.4.11, the boundary of a control. */
const AA_NON_TEXT = 3;

/** Every opaque ground the overlay paints. Panels and drawers use `card`, list
 *  rows and the admin bar use `elevated`, code wells use `background`. */
const SURFACES = ['background', 'card', 'elevated'] as const;

/** Tokens used as foreground text. */
const INKS = [
  'foreground',
  'mutedFg',
  'faintFg',
  'brandText',
  'destructive',
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

  // A field interior sits *lighter* than the panel it is on, not darker, so
  // every ink that lands in one is read against a surface that is not in
  // SURFACES. Flattening is the only way to see it.
  for (const ink of ['foreground', 'mutedFg'] as const) {
    it(`${ink} clears AA inside a field on every surface`, () => {
      for (const surface of SURFACES) {
        const interior = composite(COLOR.inputBg, COLOR[surface]);
        const hex = `#${[interior.r, interior.g, interior.b]
          .map((c) => c.toString(16).padStart(2, '0'))
          .join('')}`;
        expect(contrast(COLOR[ink], hex), `${ink} in a field on ${surface}`).toBeGreaterThanOrEqual(
          AA_TEXT,
        );
      }
    });
  }

  // `brand` and `success` are backgrounds. The lightened `brandText` and
  // `successText` exist precisely because they fail as foregrounds — assert
  // that, so the split does not get "simplified" away and the raw colours
  // reused as ink.
  it('the filled tokens fail as text, which is what the *Text pair is for', () => {
    expect(contrast(COLOR.brand, COLOR.card)).toBeLessThan(AA_TEXT);
    expect(contrast(COLOR.success, COLOR.card)).toBeLessThan(AA_TEXT);
  });
});

describe('overlay colours that carry foreground text', () => {
  for (const bg of ['brand', 'success'] as const) {
    it(`foreground clears AA on ${bg}`, () => {
      expect(contrast(COLOR.foreground, COLOR[bg])).toBeGreaterThanOrEqual(AA_TEXT);
    });
  }

  // `primary` is near-white and `destructive` is a light red: both are loud
  // fills that carry *dark* ink, which is the shadcn idiom and the opposite of
  // the brand fill above. Getting this backwards is invisible until it ships.
  for (const bg of ['primary', 'destructive'] as const) {
    it(`primaryFg clears AA on ${bg}`, () => {
      expect(contrast(COLOR.primaryFg, COLOR[bg])).toBeGreaterThanOrEqual(AA_TEXT);
    });
  }

  it('foreground would be illegible on primary, so primaryFg is not optional', () => {
    expect(contrast(COLOR.foreground, COLOR.primary)).toBeLessThan(AA_NON_TEXT);
  });
});

describe('control boundaries', () => {
  // `input` is a *fill*, not a border: a control's edge is transparent until
  // focus paints it. So it is not held to 1.4.11 — it could not clear it and
  // still look like the thing it is copying. What it must do is be *seen*,
  // which is the floor below.
  it('input reads as a control against every overlay surface', () => {
    for (const surface of SURFACES) {
      const ratio = contrast(COLOR.input, COLOR[surface]);
      expect(ratio, `input on ${surface}`).toBeGreaterThan(1.15);
      expect(ratio, `input on ${surface}`).toBeLessThan(AA_NON_TEXT);
    }
  });

  // The deviation above is only acceptable because this is not: with resting
  // borders transparent, the focus ring is the *whole* of the non-text
  // indication a keyboard user gets, so it carries the 3:1 on its own.
  it('ring carries 1.4.11 alone, since the resting border does not', () => {
    for (const surface of SURFACES) {
      expect(contrast(COLOR.ring, COLOR[surface]), `ring on ${surface}`).toBeGreaterThanOrEqual(
        AA_NON_TEXT,
      );
    }
  });

  // Danger is one token doing three jobs, so it has to clear the control floor
  // as well as the text floor — the Delete button's outline is this colour.
  it('destructive is visible as a control boundary on every surface', () => {
    for (const surface of SURFACES) {
      expect(
        contrast(COLOR.destructive, COLOR[surface]),
        `destructive on ${surface}`,
      ).toBeGreaterThanOrEqual(AA_NON_TEXT);
    }
  });

  // `border` is a separator, not a control boundary, and sits below the
  // non-text floor on purpose. Pinned so nobody "fixes" it into a hard line
  // across every panel — an outline the user must see to operate is `input`.
  it('border stays quieter than a control boundary', () => {
    expect(contrast(COLOR.border, COLOR.card)).toBeLessThan(AA_NON_TEXT);
  });

  // A field interior must read as a *container*, not as a second panel: it is
  // one step lighter than what it sits on and no more.
  it('inputBg lifts the surface without becoming one', () => {
    for (const surface of SURFACES) {
      const ratio = contrast(COLOR.inputBg, COLOR[surface]);
      expect(ratio, `inputBg on ${surface}`).toBeGreaterThan(1.05);
      expect(ratio, `inputBg on ${surface}`).toBeLessThan(AA_NON_TEXT);
    }
  });

  // The outline button's body. It has to be *present* — a transparent one
  // makes the button read as bare text beside a filled confirm — and it has to
  // stay under a field's interior, since a button is not a place to type.
  it('controlBg is a body, not a surface, and sits under inputBg', () => {
    for (const surface of SURFACES) {
      const ratio = contrast(COLOR.controlBg, COLOR[surface]);
      expect(ratio, `controlBg on ${surface}`).toBeGreaterThan(1.02);
      expect(ratio, `controlBg on ${surface}`).toBeLessThan(contrast(COLOR.inputBg, COLOR[surface]));
    }
  });

  // The label inside one still has to be readable, on every surface the button
  // can sit on.
  it('foreground clears AA inside an outline button on every surface', () => {
    for (const surface of SURFACES) {
      const body = composite(COLOR.controlBg, COLOR[surface]);
      const hex = `#${[body.r, body.g, body.b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
      expect(
        contrast(COLOR.foreground, hex),
        `foreground in an outline button on ${surface}`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
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
      const { r, g, b } = parse(COLOR[token]);
      expect(`${token}: ${r}/${g}/${b}`).not.toBe(`${token}: ${r}/${r}/${r}`);
      expect(b).toBeGreaterThan(r);
    });
  }

  // ...but only just. The old palette sat every surface at ~0.029 chroma; these
  // are meant to read as glass, not as a violet cast returning by the back door.
  for (const token of ['glass', 'glassRaised'] as const) {
    it(`${token} stays far below the old violet cast`, () => {
      const { r, g, b } = parse(COLOR[token]);
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(10);
    });
  }
});

describe('the neutral ramp is actually neutral', () => {
  // The old palette's greys carried a violet tint (chroma ~0.03 at hue 284).
  // These are authored at chroma 0, which in sRGB means R === G === B — true of
  // the translucent ones too, which is why the check is on parsed channels
  // rather than on the hex string.
  //
  // `primary` is in this list and `brand` is deliberately not: the loud colour
  // is now a near-white, and the purple is the one token allowed a hue.
  for (const token of [
    'background',
    'card',
    'elevated',
    'border',
    'input',
    'inputBg',
    'controlBg',
    'ring',
    'accent',
    'foreground',
    'mutedFg',
    'faintFg',
    'primary',
    'primaryFg',
  ] as const) {
    it(`${token} has no hue`, () => {
      const { r, g, b } = parse(COLOR[token]);
      expect(`${token}: ${r}/${g}/${b}`).toBe(`${token}: ${r}/${r}/${r}`);
    });
  }

  it('brand keeps its hue — it is the one colour with a job', () => {
    const { r, g, b } = parse(COLOR.brand);
    expect(`${r}/${g}/${b}`).not.toBe(`${r}/${r}/${r}`);
    expect(b).toBeGreaterThan(r);
  });
});
