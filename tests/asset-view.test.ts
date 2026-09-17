import { describe, expect, it } from 'vitest';
import type { AssetInfo } from '../src/shared/protocol.ts';
import { assetRefusal, uploadNote, visibleAssets } from '../src/client/asset-view.ts';

/**
 * What the image picker offers, with no browser in sight.
 *
 * The rule being pinned is the one that survives a byte-perfect round trip and
 * is still wrong on the page: a `src` pointing outside the public directory
 * reads back exactly as written and 404s in the built site. So a file a build
 * would not serve has to be refused *at pick time* and named *before* an
 * upload lands next to it — neither of which the source can ever tell you.
 */

const asset = (path: string, over: Partial<AssetInfo> = {}): AssetInfo =>
  ({ path, size: 1024, mtime: 1, servable: path.startsWith('/images/'), ...over });

describe('a file the built site would not serve', () => {
  it('is refused by name, and the refusal names the project’s own public dir', () => {
    const refusal = assetRefusal(asset('/src/assets/hero.svg'), 'static');
    expect(refusal?.short).toBe('Dev only');
    expect(refusal?.full).toContain('static/');
    expect(refusal?.full).toContain('404');
  });

  it('is not refused when the server says a build serves it', () => {
    expect(assetRefusal(asset('/images/hero.png'), 'public')).toBeNull();
  });

  it('stays in the listing, sorted last — hidden, it reads as "you have no images"', () => {
    const files = [asset('/src/assets/a.svg', { mtime: 9 }), asset('/images/b.png', { mtime: 2 })];
    expect(visibleAssets(files, '', 'public').map(f => f.path))
      .toEqual(['/images/b.png', '/src/assets/a.svg']);
  });
});

describe('the listing', () => {
  const files = [
    asset('/images/coast.jpg', { mtime: 1 }),
    asset('/images/portrait.png', { mtime: 5 }),
    asset('/images/coast-02.jpg', { mtime: 9 }),
  ];

  it('is newest first, so a file uploaded a moment ago is the first tile', () => {
    expect(visibleAssets(files, '', 'public')[0].path).toBe('/images/coast-02.jpg');
  });

  it('filters on the whole path, case-insensitively', () => {
    expect(visibleAssets(files, 'COAST', 'public').map(f => f.path))
      .toEqual(['/images/coast-02.jpg', '/images/coast.jpg']);
  });

  it('never mutates what it was handed', () => {
    const order = files.map(f => f.path);
    visibleAssets(files, '', 'public');
    expect(files.map(f => f.path)).toEqual(order);
  });
});

describe('the uploadDir sentence', () => {
  it('names the directory even when it is fine, because a toast after the write is too late', () => {
    expect(uploadNote('public/images', 'public'))
      .toEqual({ text: expect.stringContaining('public/images/'), warn: false });
  });

  it('warns when uploads would land outside the public dir', () => {
    const note = uploadNote('src/assets', 'public');
    expect(note.warn).toBe(true);
    expect(note.text).toContain('404');
  });

  it('accepts the public dir itself, and refuses a mere prefix match', () => {
    expect(uploadNote('public', 'public').warn).toBe(false);
    // `publicfiles` is not inside `public`.
    expect(uploadNote('publicfiles', 'public').warn).toBe(true);
  });
});
