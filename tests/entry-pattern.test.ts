import { describe, expect, it } from 'vitest';
import { compilePattern } from '../src/server/entry-pattern.ts';

/**
 * The glob loader's `pattern`, compiled to a predicate.
 *
 * What it must get right is not mainly the extensions — it is that a `base`
 * broader than the collection is only correct because the pattern narrows it.
 * `glob({ pattern: 'settings.yml', base: './src/content' })` names one file
 * while its base holds every other collection, so a matcher that over-matches
 * hands that collection everything beneath it, and entry resolution then picks
 * the wrong collection for a URL.
 *
 * Over-matching is the failure that costs. A pattern this compiler cannot prove
 * returns null and the caller falls back to matching on extension alone — the
 * behaviour every collection had before.
 */

const match = (patterns: string[], rel: string): boolean => {
  const m = compilePattern(patterns);
  if (!m) throw new Error(`expected ${JSON.stringify(patterns)} to compile`);
  return m(rel);
};

describe('compilePattern', () => {
  it('matches at any depth under a **/ prefix, including none', () => {
    expect(match(['**/*.md'], 'one.md')).toBe(true);
    expect(match(['**/*.md'], '2026/hello.md')).toBe(true);
    expect(match(['**/*.md'], 'a/b/c/deep.md')).toBe(true);
    expect(match(['**/*.md'], 'one.mdx')).toBe(false);
    expect(match(['**/*.md'], 'one.json')).toBe(false);
  });

  // The case that makes a broad base safe.
  it('matches exactly one file for a bare filename pattern', () => {
    expect(match(['settings.yml'], 'settings.yml')).toBe(true);
    expect(match(['settings.yml'], 'blog/one.md')).toBe(false);
    expect(match(['settings.yml'], 'nested/settings.yml')).toBe(false);
  });

  it('keeps * inside a single segment', () => {
    expect(match(['*.json'], 'admin.json')).toBe(true);
    expect(match(['*.json'], 'authors/admin.json')).toBe(false);
  });

  it('expands a brace group', () => {
    expect(match(['**/*.{md,mdx}'], 'one.md')).toBe(true);
    expect(match(['**/*.{md,mdx}'], 'one.mdx')).toBe(true);
    expect(match(['**/*.{md,mdx}'], 'one.markdown')).toBe(false);
    expect(match(['**/*.{yml,yaml}'], 'nested/data.yaml')).toBe(true);
  });

  it('takes a list as an alternation', () => {
    expect(match(['**/*.md', '**/*.json'], 'one.md')).toBe(true);
    expect(match(['**/*.md', '**/*.json'], 'one.json')).toBe(true);
    expect(match(['**/*.md', '**/*.json'], 'one.yml')).toBe(false);
  });

  it('matches ? against exactly one character, never a slash', () => {
    expect(match(['?.md'], 'a.md')).toBe(true);
    expect(match(['?.md'], 'ab.md')).toBe(false);
    expect(match(['a?c/*.md'], 'a/c/x.md')).toBe(false);
  });

  it('matches a trailing ** against everything below', () => {
    expect(match(['content/**'], 'content/a/b.md')).toBe(true);
    expect(match(['content/**'], 'other/a.md')).toBe(false);
  });

  it('is case-insensitive about the path, as the extension test it replaces was', () => {
    expect(match(['**/*.md'], 'One.MD')).toBe(true);
  });

  it('normalizes a leading ./ on both sides', () => {
    expect(match(['./**/*.md'], 'one.md')).toBe(true);
    expect(match(['**/*.md'], './one.md')).toBe(true);
  });

  it('treats a windows separator as a path separator', () => {
    expect(match(['**/*.md'], '2026\\hello.md')).toBe(true);
  });

  // Every one of these must yield null rather than a regex that happens to do
  // something. The caller reads null as "fall back to extensions".
  it('refuses the shapes it does not claim', () => {
    for (const p of [
      '[a-z].md', // character class
      '!(draft)/*.md', // extglob
      '+(a|b).md', // extglob
      '../outside/*.md', // escapes the base
      '/absolute/*.md', // absolute
      'a/**b/*.md', // ** not on a segment boundary
      '{a,{b,c}}.md', // nested braces
      '{}.md', // empty group
      '{a,}.md', // empty alternative
      '{unclosed.md', // unbalanced
      '', // empty
    ]) {
      expect(compilePattern([p]), p).toBeNull();
    }
  });

  // One unprovable member refuses the whole list: a pattern set missing a
  // member would silently narrow the collection.
  it('refuses a list whole when any member is unprovable', () => {
    expect(compilePattern(['**/*.md', '[a-z].json'])).toBeNull();
  });

  it('is null for an absent or empty pattern', () => {
    expect(compilePattern(undefined)).toBeNull();
    expect(compilePattern([])).toBeNull();
  });

  // A literal dot must not behave as a regex wildcard.
  it('escapes regex metacharacters in literal text', () => {
    expect(match(['a.md'], 'axmd')).toBe(false);
    expect(match(['a.md'], 'a.md')).toBe(true);
  });
});
