import { describe, expect, it } from 'vitest';
import {
  entryAssetDir,
  entryRelativeToWeb,
  webToEntryRelative,
} from '../src/shared/asset-path.ts';

const POST = 'src/content/blog/post.md';

describe('entryRelativeToWeb', () => {
  it('resolves an entry-relative value to the path the dev server serves', () => {
    expect(entryRelativeToWeb(POST, '../../assets/blog/hero.png')).toBe(
      '/src/assets/blog/hero.png',
    );
  });

  it('handles a nested asset directory', () => {
    expect(entryRelativeToWeb('src/content/works/onvero.md', '../../assets/works/onvero/header.jpg'))
      .toBe('/src/assets/works/onvero/header.jpg');
  });

  it('handles a sibling asset', () => {
    expect(entryRelativeToWeb(POST, './hero.png')).toBe('/src/content/blog/hero.png');
    expect(entryRelativeToWeb(POST, 'hero.png')).toBe('/src/content/blog/hero.png');
  });

  it('handles a deeper entry path', () => {
    expect(entryRelativeToWeb('src/content/notes/2026/a.md', '../../../assets/notes/x.jpg')).toBe(
      '/src/assets/notes/x.jpg',
    );
  });

  it('passes a root-relative value through, so a wrong-shape value still previews', () => {
    expect(entryRelativeToWeb(POST, '/images/hero.png')).toBe('/images/hero.png');
  });

  it('passes a URL through untouched', () => {
    expect(entryRelativeToWeb(POST, 'https://example.com/a.png')).toBe('https://example.com/a.png');
  });

  it('refuses a value that climbs out of the project root', () => {
    expect(entryRelativeToWeb(POST, '../../../../etc/passwd')).toBeNull();
  });

  it('returns null for an empty value', () => {
    expect(entryRelativeToWeb(POST, '')).toBeNull();
    expect(entryRelativeToWeb(POST, '   ')).toBeNull();
  });

  it('tolerates Windows separators in the entry path', () => {
    expect(entryRelativeToWeb('src\\content\\blog\\post.md', '../../assets/blog/hero.png')).toBe(
      '/src/assets/blog/hero.png',
    );
  });
});

describe('webToEntryRelative', () => {
  it('converts a served src asset to an entry-relative value', () => {
    expect(webToEntryRelative(POST, '/src/assets/blog/hero.png')).toBe(
      '../../assets/blog/hero.png',
    );
  });

  it('round-trips with entryRelativeToWeb', () => {
    for (const [file, value] of [
      [POST, '../../assets/blog/hero.png'],
      ['src/content/works/onvero.md', '../../assets/works/onvero/header.jpg'],
      ['src/content/notes/2026/a.md', '../../../assets/notes/x.jpg'],
    ] as const) {
      const web = entryRelativeToWeb(file, value);
      expect(web).not.toBeNull();
      expect(webToEntryRelative(file, web!)).toBe(value);
    }
  });

  it('emits an explicit ./ for a sibling file', () => {
    expect(webToEntryRelative(POST, '/src/content/blog/hero.png')).toBe('./hero.png');
  });

  it('refuses a public asset — Astro cannot import those for image()', () => {
    expect(webToEntryRelative(POST, '/images/logo.svg')).toBeNull();
    expect(webToEntryRelative(POST, '/hero.png')).toBeNull();
  });

  it('refuses a value that is not root-relative', () => {
    expect(webToEntryRelative(POST, 'src/assets/blog/hero.png')).toBeNull();
    expect(webToEntryRelative(POST, 'https://example.com/a.png')).toBeNull();
  });

  it('refuses a path that climbs out of the root', () => {
    expect(webToEntryRelative(POST, '/src/../../etc/passwd')).toBeNull();
  });
});

describe('entryAssetDir', () => {
  it('gives the directory the current value lives in', () => {
    expect(entryAssetDir(POST, '../../assets/blog/hero.png')).toBe('src/assets/blog');
  });

  it('gives a nested directory', () => {
    expect(entryAssetDir('src/content/works/onvero.md', '../../assets/works/onvero/header.jpg'))
      .toBe('src/assets/works/onvero');
  });

  it('returns null with no value, so the caller falls back to its configured dir', () => {
    expect(entryAssetDir(POST, '')).toBeNull();
  });

  it('returns null for a value outside src/', () => {
    expect(entryAssetDir(POST, '/images/hero.png')).toBeNull();
    expect(entryAssetDir(POST, 'https://example.com/a.png')).toBeNull();
  });
});
