import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { toWirePath } from '../src/server/wire-path.ts';

/**
 * The one conversion between server space (absolute fs paths) and client space
 * (root-relative, forward-slashed). Two properties matter, and both are load-
 * bearing rather than cosmetic:
 *
 * 1. Nothing it returns for a project file names a directory above the root —
 *    that is the leak issue #72 is about.
 * 2. `resolve(root, toWirePath(root, abs)) === abs`, so the path gate still has
 *    an absolute path to confine, and the relative form stays a wire format
 *    rather than a filesystem input.
 */

const ROOT = '/Users/dev/projects/site';

describe('toWirePath', () => {
  it('strips the project root, naming nothing above it', () => {
    const wire = toWirePath(ROOT, `${ROOT}/src/pages/index.astro`);
    expect(wire).toBe('src/pages/index.astro');
    expect(wire).not.toContain('Users');
  });

  it('round-trips back to the absolute path the gate needs', () => {
    const abs = `${ROOT}/src/components/Hero.astro`;
    expect(resolve(ROOT, toWirePath(ROOT, abs))).toBe(abs);
  });

  it('keeps the node_modules segment, so package ownership still reads off it', () => {
    expect(toWirePath(ROOT, `${ROOT}/node_modules/astro/components/Image.astro`))
      .toBe('node_modules/astro/components/Image.astro');
  });

  it('spells an out-of-root file relatively too, and it still round-trips', () => {
    const abs = '/Users/dev/projects/other/src/X.astro';
    expect(toWirePath(ROOT, abs)).toBe('../other/src/X.astro');
    expect(resolve(ROOT, toWirePath(ROOT, abs))).toBe(abs);
  });

  it('tolerates a trailing slash on the root', () => {
    expect(toWirePath(`${ROOT}/`, `${ROOT}/src/x.astro`)).toBe('src/x.astro');
  });

  it('answers in posix form whatever separators came in', () => {
    // Vite hands ids with forward slashes even on Windows; node:path on POSIX
    // leaves a backslash in place. Either way the wire spelling is posix.
    expect(toWirePath(ROOT, `${ROOT}/src/a\\b.astro`)).toBe('src/a/b.astro');
  });
});
