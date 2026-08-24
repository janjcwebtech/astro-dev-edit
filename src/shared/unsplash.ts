import type { UnsplashImportWidth } from './protocol.ts';

/**
 * The import widths an Unsplash photo may be fetched at — the safelist, plus
 * the parsing both sides do.
 *
 * Shared runtime code, for the same reason `slug.ts` is (and unlike
 * `protocol.ts`, which stays types-only): the picker renders the select from
 * this list and sends the chosen width, and the server re-runs `coerceWidth` as
 * the authority before it goes anywhere near the upstream URL. A width lands in
 * a URL the dev server fetches, so a value that is not one of these is
 * **refused, never clamped** — clamping a bad input would hide a client bug and
 * silently import the wrong size.
 *
 * `'original'` means "send no `w` at all": the raw file at full resolution,
 * bounded only by the import byte cap. `fit=max` never upscales, so every other
 * entry only ever shrinks.
 */
export const UNSPLASH_IMPORT_WIDTHS: readonly UnsplashImportWidth[] = [
  800,
  1600,
  2400,
  'original',
];

/** The default when neither the config nor the settings file says otherwise —
 *  the width every import used before it was choosable, so behaviour is
 *  unchanged for a project that never touches the option. */
export const UNSPLASH_DEFAULT_IMPORT_WIDTH: UnsplashImportWidth = 2400;

/**
 * The wire/settings form of a width: `'800'` … `'2400'`, `'original'`. The
 * option is a `select`, whose values are strings, and the settings file is JSON
 * a human may hand-edit — so a width is carried as text and parsed once, here.
 */
export const UNSPLASH_IMPORT_WIDTH_CHOICES: readonly string[] =
  UNSPLASH_IMPORT_WIDTHS.map(String);

/** Parse a width from anything — a wire field, a config value, a JSON string —
 *  returning `null` for everything not on the safelist. */
export function coerceImportWidth(raw: unknown): UnsplashImportWidth | null {
  if (raw === 'original') return 'original';
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return null;
  return (UNSPLASH_IMPORT_WIDTHS.find((w) => w === n) as UnsplashImportWidth | undefined) ?? null;
}

/** How a width reads in the UI — `2400 px`, or `Original size`. */
export function importWidthLabel(width: UnsplashImportWidth): string {
  return width === 'original' ? 'Original size' : `${width} px`;
}
