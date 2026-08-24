import { describe, expect, it } from 'vitest';
import {
  UNSPLASH_DEFAULT_IMPORT_WIDTH,
  UNSPLASH_IMPORT_WIDTHS,
  UNSPLASH_IMPORT_WIDTH_CHOICES,
  coerceImportWidth,
  importWidthLabel,
} from '../src/shared/unsplash.ts';

/**
 * The import-width safelist — shared runtime code, like `slug.ts`: the picker
 * renders its select from this list and the import route re-parses whatever
 * comes back as the authority. The property that matters is that a value off
 * the list is **refused** (null), never coerced to something nearby: the width
 * reaches a URL the dev server fetches, and a silent clamp would import the
 * wrong size while looking like a success.
 */
describe('coerceImportWidth', () => {
  it('accepts every offered width, as a number or as its wire text', () => {
    for (const width of UNSPLASH_IMPORT_WIDTHS) {
      expect(coerceImportWidth(width)).toBe(width);
      expect(coerceImportWidth(String(width))).toBe(width);
    }
  });

  it('refuses a width that is merely near one on the list', () => {
    expect(coerceImportWidth(801)).toBeNull();
    expect(coerceImportWidth(2399)).toBeNull();
    expect(coerceImportWidth(12000)).toBeNull();
    expect(coerceImportWidth(0)).toBeNull();
    expect(coerceImportWidth(-800)).toBeNull();
  });

  it('refuses anything that is not a width at all', () => {
    // `Number('')` is 0 and `Number(null)` is 0 — both would sail through a
    // bare Number() check, which is why the safelist match comes after it.
    for (const raw of [undefined, null, '', '  ', 'Original', '2400px', '2400&fm=png', {}, []]) {
      expect(coerceImportWidth(raw)).toBeNull();
    }
  });

  it('offers the choices as text, in list order, for the option select', () => {
    expect(UNSPLASH_IMPORT_WIDTH_CHOICES).toEqual(['800', '1600', '2400', 'original']);
  });

  it('defaults to a width that is itself on the list', () => {
    expect(coerceImportWidth(UNSPLASH_DEFAULT_IMPORT_WIDTH)).toBe(UNSPLASH_DEFAULT_IMPORT_WIDTH);
  });

  it('labels a width for the UI', () => {
    expect(importWidthLabel(800)).toBe('800 px');
    expect(importWidthLabel('original')).toBe('Original size');
  });
});
