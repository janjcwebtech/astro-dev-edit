import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWrite, isServableAsset, SECRET_MODE, toWebPath } from '../src/server/paths.ts';

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

/**
 * `atomicWrite`'s mode. The parameter exists because chmod-ing after the rename
 * leaves the content on disk at the process umask first — for `.env.local`,
 * that is the access key world-readable for the length of a write.
 */
describe('atomicWrite', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'atx-paths-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('writes the content and leaves no temp file behind', async () => {
    const target = join(dir, 'note.txt');
    await atomicWrite(target, 'hello\n');
    expect(await readFile(target, 'utf8')).toBe('hello\n');
    expect((await readdir(dir)).filter((f) => f.includes('dev-edit-tmp'))).toEqual([]);
  });

  it.runIf(process.platform !== 'win32')('applies the mode through the rename', async () => {
    const target = join(dir, 'secret.env');
    await atomicWrite(target, 'K=v\n', SECRET_MODE);
    expect((await stat(target)).mode & 0o777).toBe(SECRET_MODE);
  });

  it.runIf(process.platform !== 'win32')('tightens a file that already exists loosely', async () => {
    const target = join(dir, 'secret.env');
    await writeFile(target, 'K=old\n', { mode: 0o644 });
    await atomicWrite(target, 'K=new\n', SECRET_MODE);
    // rename carries the temp inode's mode onto the target, so the loose one goes.
    expect((await stat(target)).mode & 0o777).toBe(SECRET_MODE);
  });

  it.runIf(process.platform !== 'win32')('re-tightens a leftover temp from a crashed run', async () => {
    // writeFile's own `mode` is honoured only on create, so a temp file left
    // behind at a loose mode would otherwise carry that mode onto the target
    // through the rename. The explicit chmod is what covers it.
    const target = join(dir, '.env.local');
    const leftover = join(dir, `..env.local.dev-edit-tmp-${process.pid}`);
    await writeFile(leftover, 'stale\n', { mode: 0o666 });

    await atomicWrite(target, 'K=v\n', SECRET_MODE);

    // Proves the temp name too: if it were spelled differently, this leftover
    // would still be sitting in the directory. Both `.gitignore` files pin
    // `.*.dev-edit-tmp-*` and `private-files.ts` refuses the same shape, so a
    // rename here breaks two things silently.
    expect(await readdir(dir)).toEqual(['.env.local']);
    expect(await readFile(target, 'utf8')).toBe('K=v\n');
    expect((await stat(target)).mode & 0o777).toBe(SECRET_MODE);
  });
});
