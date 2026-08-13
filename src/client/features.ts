import type { HealthResponse } from '../shared/protocol.ts';

/**
 * Server-derived feature flags, set once at boot from `/health`.
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
}

const features: Features = { unsplash: false };

/** Called once from `overlay.ts`'s boot, with the /health payload. */
export function setFeatures(info: HealthResponse): void {
  features.unsplash = info.unsplash === true;
}

/** Re-read a single flag — used after the Settings panel stores a key, so the
 *  Unsplash tab appears without a page reload. */
export function updateFeature<K extends keyof Features>(key: K, value: Features[K]): void {
  features[key] = value;
}

export function hasUnsplash(): boolean {
  return features.unsplash;
}
