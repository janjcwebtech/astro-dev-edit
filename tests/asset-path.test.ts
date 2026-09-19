import { describe, expect, it } from 'vitest';
import { webPathToUrl } from '../src/shared/asset-path.ts';

describe('webPathToUrl', () => {
  it('leaves an ordinary path exactly as it is', () => {
    expect(webPathToUrl('/images/hero.png')).toBe('/images/hero.png');
    expect(webPathToUrl('/photos/2026/a-b_c.jpg')).toBe('/photos/2026/a-b_c.jpg');
  });

  it('percent-encodes a space, without touching the separators', () => {
    expect(webPathToUrl('/brand/Logo Miramar horizontal.png')).toBe(
      '/brand/Logo%20Miramar%20horizontal.png',
    );
  });

  it('encodes the other characters a URL path cannot carry raw', () => {
    expect(webPathToUrl('/a/100%.png')).toBe('/a/100%25.png');
    expect(webPathToUrl('/a/q?.png')).toBe('/a/q%3F.png');
    expect(webPathToUrl('/a/x#1.png')).toBe('/a/x%231.png');
  });

  it('is not idempotent, which is why it is only for a path we composed', () => {
    // A value someone typed is already a URL; re-encoding it would double the
    // escape. The image panel keeps the two shapes apart for this reason.
    expect(webPathToUrl('/a/b%20c.png')).toBe('/a/b%2520c.png');
  });
});
