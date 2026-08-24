import type { HealthResponse, UnsplashImportWidth } from '../shared/protocol.ts';
import { UNSPLASH_DEFAULT_IMPORT_WIDTH, coerceImportWidth } from '../shared/unsplash.ts';

/**
 * Server-derived feature state, set at boot from `/health` (and refreshed by a
 * Settings save) — the on/off flags, plus the one resolved value a surface
 * needs before its own endpoint has answered.
 *
 * A **leaf module** on purpose: the media modal needs to know whether the
 * Unsplash source is available, and reading that from `overlay.ts` would create
 * an `overlay → router → image → media-modal → overlay` import cycle. Anything
 * that only needs to *read* a flag imports this instead.
 *
 * Flags default to off, so a server that predates a flag (or a failed health
 * check) degrades to the feature being absent rather than to a surface that
 * errors when touched.
 */

interface Features {
  /** The Unsplash photo source is enabled AND the server holds a usable key.
   *  False means the media modal renders single-source, with no tab strip. */
  unsplash: boolean;
  /** The resolved `unsplash.importWidth`, where the picker's size select starts.
   *  The one non-boolean here: it is server-derived and refreshed by the same
   *  two calls, so a separate channel for it would be a second thing to keep in
   *  step for no gain. */
  unsplashImportWidth: UnsplashImportWidth;
  /** The hover pill's class/ID chips and their CSS rules. */
  cssInspector: boolean;
  /** The "Open source" buttons and jump-to-file links. */
  openInEditor: boolean;
  /** The CMS entry drawer and the admin bar's entry button. */
  entryEditor: boolean;
}

const features: Features = {
  unsplash: false,
  unsplashImportWidth: UNSPLASH_DEFAULT_IMPORT_WIDTH,
  cssInspector: false,
  openInEditor: false,
  entryEditor: false,
};

/** Called once from `overlay.ts`'s boot, with the /health payload. */
export function setFeatures(info: HealthResponse): void {
  features.unsplash = info.unsplash === true;
  // A server that predates the option says nothing — keep the default rather
  // than resolving to a width it would not honour.
  features.unsplashImportWidth =
    coerceImportWidth(info.unsplashImportWidth) ?? UNSPLASH_DEFAULT_IMPORT_WIDTH;
  features.cssInspector = info.cssInspector === true;
  features.openInEditor = info.openInEditor === true;
  features.entryEditor = info.entryEditor === true;
}

/** Re-read a single flag — used after the Settings panel stores a key, so the
 *  Unsplash tab appears without a page reload. */
export function updateFeature<K extends keyof Features>(key: K, value: Features[K]): void {
  features[key] = value;
}

export function hasUnsplash(): boolean {
  return features.unsplash;
}

/** Where the picker's size select starts — `has()` is boolean-typed, so the one
 *  non-boolean gets its own reader. */
export function unsplashImportWidth(): UnsplashImportWidth {
  return features.unsplashImportWidth;
}

/** Keys of {@link Features} that are on/off. Narrowed rather than left as
 *  `keyof Features` so `has('unsplashImportWidth')` is a type error instead of
 *  a truthiness test on a width. */
type FeatureFlag = {
  [K in keyof Features]: Features[K] extends boolean ? K : never;
}[keyof Features];

export function has(key: FeatureFlag): boolean {
  return features[key];
}
