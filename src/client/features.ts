import type { HealthResponse } from '../shared/protocol.ts';

/**
 * Server-derived feature state, set at boot from `/health` (and refreshed by a
 * Settings save).
 *
 * A **leaf module** on purpose: a surface deep in the import graph needs to
 * read a flag, and reading it from `overlay.ts` would create an import cycle.
 * Anything that only needs to *read* a flag imports this instead.
 *
 * Flags default to off, so a server that predates a flag (or a failed health
 * check) degrades to the feature being absent rather than to a surface that
 * errors when touched.
 */

interface Features {
  /** The hover pill's class/ID chips and their CSS rules. */
  cssInspector: boolean;
  /** The "Open source" buttons and jump-to-file links. */
  openInEditor: boolean;
}

const features: Features = {
  cssInspector: false,
  openInEditor: false,
};

/** Called once from `overlay.ts`'s boot, with the /health payload. */
export function setFeatures(info: HealthResponse): void {
  features.cssInspector = info.cssInspector === true;
  features.openInEditor = info.openInEditor === true;
}

/** Re-read a single flag — used after a Settings save, so an affordance appears
 *  without a page reload. */
export function updateFeature<K extends keyof Features>(key: K, value: Features[K]): void {
  features[key] = value;
}

export function has(key: keyof Features): boolean {
  return features[key];
}
