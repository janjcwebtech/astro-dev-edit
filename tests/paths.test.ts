import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { isServableAsset, toWebPath } from '../src/server/paths.ts';

/**
 * The public-directory rules. Both functions answer questions about a *built*
 * site from a path on disk, and both used to hardcode the literal `public/` —
 * which mis-served every project that configures `publicDir` and, worse, gave
 * `src/assets` files a URL only the dev server has. (issue #9)
 */

const root = '/tmp/project';

describe('toWebPath', () => {
  it('maps the public dir to the site root', () => {
    expect(toWebPath(root, join(root, 'public/hero.png'))).toBe('/hero.png');
    expect(toWebPath(root, join(root, 'public/photos/a.jpg'))).toBe('/photos/a.jpg');
  });

  it('strips the *configured* public dir, not the literal public/', () => {
    expect(toWebPath(root, join(root, 'static/hero.png'), 'static')).toBe('/hero.png');
    // …and with that config, public/ is just another project directory.
    expect(toWebPath(root, join(root, 'public/hero.png'), 'static')).toBe('/public/hero.png');
  });

  it('accepts an absolute public dir, as Astro’s resolved config gives it', () => {
    expect(toWebPath(root, join(root, 'static/hero.png'), join(root, 'static'))).toBe('/hero.png');
  });

  it('keeps the project path for anything outside the public dir', () => {
    expect(toWebPath(root, join(root, 'src/assets/hero.svg'))).toBe('/src/assets/hero.svg');
  });
});

describe('isServableAsset', () => {
  it('flags a public/ file servable and a src/assets file not', () => {
    expect(isServableAsset(root, join(root, 'public/hero.png'))).toBe(true);
    expect(isServableAsset(root, join(root, 'public/photos/a.jpg'))).toBe(true);
    expect(isServableAsset(root, join(root, 'src/assets/hero.svg'))).toBe(false);
  });

  it('honours a configured public dir other than public/', () => {
    expect(isServableAsset(root, join(root, 'static/hero.png'), 'static')).toBe(true);
    expect(isServableAsset(root, join(root, 'public/hero.png'), 'static')).toBe(false);
  });

  it('treats a public dir that is the root itself as serving everything', () => {
    expect(isServableAsset(root, join(root, 'hero.png'), '.')).toBe(true);
  });

  it('serves nothing when the file or the public dir escapes the root', () => {
    expect(isServableAsset(root, '/tmp/elsewhere/hero.png')).toBe(false);
    expect(isServableAsset(root, join(root, 'public/hero.png'), '../shared')).toBe(false);
  });
});
