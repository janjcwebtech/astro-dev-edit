import { describe, expect, it } from 'vitest';
import { isPackagePath } from '../src/shared/package-path.ts';
import { isPackageOwned } from '../src/server/paths.ts';

/**
 * The predicate behind the `astro:assets` refusal, pinned on both sides.
 *
 * `<Image>` annotates to `node_modules/astro/components/Image.astro`, so this
 * is what decides that an element is rendered by a package: the server uses it
 * to name *why* a path is refused, the client to look past the element for the
 * markup that used the component. They must agree — the client would otherwise
 * offer a jump for a path the server opens happily, or stay silent on one it
 * refuses — which is why there is one implementation rather than a copy each.
 *
 * The server wrapper is asserted against it here. The client's
 * (`source-map.ts::isPackageSource`) is a one-line delegation to the same
 * function and cannot be imported without a DOM — the module installs a
 * MutationObserver at evaluation to win a race with Astro's toolbar — so it
 * follows the same rule as the rest of the DOM layer and is checked in the
 * playground; see VERIFICATION.md.
 */

const PACKAGE = [
  'node_modules/astro/components/Image.astro',
  '/Users/x/site/node_modules/astro/components/Image.astro',
  'node_modules/.pnpm/astro@7.3.2/node_modules/astro/components/Image.astro',
  'C:\\Users\\x\\site\\node_modules\\astro\\components\\Image.astro',
];

const OWN = [
  'src/pages/index.astro',
  '/Users/x/site/src/components/sections/Features.astro',
  // A segment test, not a substring one: these are the user's own files and
  // stay editable.
  'src/node_modules_notes/Thing.astro',
  'src/my_node_modules/Thing.astro',
  'src/notes/node_modules.md',
];

describe('isPackagePath', () => {
  for (const p of PACKAGE) {
    it(`treats ${p} as package-owned`, () => {
      expect(isPackagePath(p)).toBe(true);
    });
  }

  for (const p of OWN) {
    it(`treats ${p} as the user's own`, () => {
      expect(isPackagePath(p)).toBe(false);
    });
  }
});

// One implementation, two call sites. If the server wrapper grows a copy of
// its own, this fails on the next path the copy gets wrong rather than in
// production.
describe('the server wrapper reaches the shared predicate', () => {
  for (const p of [...PACKAGE, ...OWN]) {
    it(`agrees on ${p}`, () => {
      expect(isPackageOwned(p)).toBe(isPackagePath(p));
    });
  }
});
