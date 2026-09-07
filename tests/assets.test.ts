import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listAssets } from '../src/server/assets.ts';

/**
 * `listAssets` returns metadata, not bare paths — the picker sorts by recency
 * and captions tiles with it. Pins the AssetInfo shape, the mtime the "Newest"
 * sort depends on, and the filter/dedup behaviour that predates it.
 */

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'dev-edit-assets-'));
  await mkdir(join(root, 'public/photos'), { recursive: true });
  await mkdir(join(root, 'src/assets'), { recursive: true });

  await writeFile(join(root, 'public/a.jpg'), 'a-bytes');
  await writeFile(join(root, 'public/photos/b.png'), 'bb-bytes');
  await writeFile(join(root, 'src/assets/c.webp'), 'ccc-bytes');
  // Not an image — must not appear.
  await writeFile(join(root, 'public/notes.txt'), 'text');

  // Deterministic mtimes: c is newest, a is oldest. Seconds apart so no
  // filesystem timestamp granularity can reorder them.
  const t = 1_700_000_000; // epoch seconds
  await utimes(join(root, 'public/a.jpg'), t, t);
  await utimes(join(root, 'public/photos/b.png'), t + 60, t + 60);
  await utimes(join(root, 'src/assets/c.webp'), t + 120, t + 120);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('listAssets', () => {
  it('returns path, size and mtime for every image', async () => {
    const files = await listAssets(root, ['public', 'src/assets']);
    expect(files.map((f) => f.path)).toEqual(['/a.jpg', '/photos/b.png', '/src/assets/c.webp']);
    for (const file of files) {
      expect(typeof file.size).toBe('number');
      expect(file.size).toBeGreaterThan(0);
      expect(typeof file.mtime).toBe('number');
      expect(file.mtime).toBeGreaterThan(0);
    }
    // Sizes are the real byte counts, not a placeholder.
    expect(files.find((f) => f.path === '/a.jpg')!.size).toBe('a-bytes'.length);
    expect(files.find((f) => f.path === '/src/assets/c.webp')!.size).toBe('ccc-bytes'.length);
  });

  it('sorts by path, leaving the recency sort to the client', async () => {
    const files = await listAssets(root, ['public', 'src/assets']);
    const paths = files.map((f) => f.path);
    expect(paths).toEqual([...paths].sort());
  });

  it('carries mtimes that put the newest file first when sorted descending', async () => {
    const files = await listAssets(root, ['public', 'src/assets']);
    const newestFirst = [...files].sort((a, b) => b.mtime - a.mtime).map((f) => f.path);
    expect(newestFirst).toEqual(['/src/assets/c.webp', '/photos/b.png', '/a.jpg']);
  });

  it('reflects a freshly written file as the newest', async () => {
    await writeFile(join(root, 'public/photos/fresh.png'), 'fresh');
    const files = await listAssets(root, ['public', 'src/assets']);
    const newest = [...files].sort((a, b) => b.mtime - a.mtime)[0];
    expect(newest.path).toBe('/photos/fresh.png');
    await rm(join(root, 'public/photos/fresh.png'));
  });

  it('filters out non-image extensions', async () => {
    const files = await listAssets(root, ['public']);
    expect(files.some((f) => f.path.endsWith('.txt'))).toBe(false);
  });

  it('de-duplicates a file reachable through two nested asset dirs', async () => {
    // public/photos sits inside public, so b.png is walked twice.
    const files = await listAssets(root, ['public', 'public/photos']);
    const b = files.filter((f) => f.path === '/photos/b.png');
    expect(b).toHaveLength(1);
  });

  it('skips asset dirs that escape the project root, and ones that do not exist', async () => {
    const files = await listAssets(root, ['../..', 'does/not/exist', 'public']);
    expect(files.map((f) => f.path)).toEqual(['/a.jpg', '/photos/b.png']);
  });

  // The asset dirs span two worlds on purpose — src/assets has to be listed so
  // image() fields have somewhere to browse — so each file has to say which one
  // it is in. Without it a web-path picker offers /src/assets/… , which the dev
  // server serves and a build never emits. (issue #9)
  it('flags a public/ file servable and a src/assets file not', async () => {
    const files = await listAssets(root, ['public', 'src/assets']);
    const servable = Object.fromEntries(files.map((f) => [f.path, f.servable]));
    expect(servable).toEqual({
      '/a.jpg': true,
      '/photos/b.png': true,
      '/src/assets/c.webp': false,
    });
  });

  it('honours a configured publicDir other than public/', async () => {
    // With publicDir: 'src/assets', c.webp is the one file a build copies —
    // and it is served from the site root, not from /src/assets/.
    const files = await listAssets(root, ['public', 'src/assets'], 'src/assets');
    const servable = Object.fromEntries(files.map((f) => [f.path, f.servable]));
    expect(servable).toEqual({
      '/public/a.jpg': false,
      '/public/photos/b.png': false,
      '/c.webp': true,
    });
  });
});
