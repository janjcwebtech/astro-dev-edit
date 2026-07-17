import { astroPatcher } from './astro.ts';
import type { Patcher } from './types.ts';

/** Every available patcher. A future markdown/MDX patcher is added here. */
const patchers: readonly Patcher[] = [astroPatcher];

/** The patcher registered for a file extension (lowercased, with the dot),
 *  or undefined when in-place editing of that type isn't supported. */
export function patcherFor(ext: string): Patcher | undefined {
  return patchers.find((p) => p.extensions.includes(ext));
}
