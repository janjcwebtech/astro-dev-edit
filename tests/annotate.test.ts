import { describe, expect, it } from 'vitest';
import { annotateAstroSource } from '../src/server/annotate.ts';
import { applyAstro, classifyAstro } from '../src/patcher/astro.ts';
import { locOf } from './helpers.ts';

/**
 * The self-annotation transform for Astro ≥7 (src/server/annotate.ts) must
 * stamp exactly the locs the patcher expects — the same rules locOf() mirrors.
 * Two invariants pinned here:
 *
 * 1. Parity: the injected loc for an element equals the locOf()-derived loc
 *    the whole patcher test-suite is built on.
 * 2. Round-trip: a loc extracted from annotated output resolves through the
 *    real classify/apply against the ORIGINAL (on-disk) source — because
 *    injected locs reference pre-injection coordinates.
 */

const FILE = '/proj/src/pages/index.astro';

/** Extract the injected loc for the first annotated occurrence of `tag`. */
function injectedLoc(annotated: string, tag: string): string {
  const re = new RegExp(
    `<${tag} data-astro-source-file="[^"]*" data-astro-source-loc="([0-9]+:[0-9]+)"`,
  );
  const m = annotated.match(re);
  if (!m) throw new Error(`no injected annotation found for <${tag}>`);
  return m[1];
}

describe('annotateAstroSource', () => {
  it('annotates a text-bearing element with its text start', async () => {
    const src = `<p>Hello world</p>\n`;
    const out = await annotateAstroSource(src, FILE);
    expect(out).toBe(
      `<p data-astro-source-file="${FILE}" data-astro-source-loc="${locOf(src, 'Hello')}">Hello world</p>\n`,
    );
  });

  it('annotates every element in a nested template, matching locOf', async () => {
    const src = `---\nconst t = 'x';\n---\n<main>\n  <h1>Title</h1>\n  <p>Body text</p>\n</main>\n`;
    const out = await annotateAstroSource(src, FILE);
    expect(injectedLoc(out, 'h1')).toBe(locOf(src, 'Title'));
    expect(injectedLoc(out, 'p')).toBe(locOf(src, 'Body text'));
    // <main>'s first positioned child is whitespace text before <h1>
    expect(out).toContain('<main data-astro-source-file=');
  });

  it('stamps an expression child at its `{` (start + 1)', async () => {
    const src = `---\nconst title = 'x';\n---\n<h1>{title}</h1>\n`;
    const out = await annotateAstroSource(src, FILE);
    expect(injectedLoc(out, 'h1')).toBe(locOf(src, '{title'));
  });

  it('stamps a childless element at its own tag name (start + 1)', async () => {
    const src = `<div><span></span></div>\n`;
    const out = await annotateAstroSource(src, FILE);
    expect(injectedLoc(out, 'span')).toBe(locOf(src, 'span><'));
  });

  it('annotates a self-closing img before its attributes', async () => {
    const src = `<img src="/a.jpg" alt="A photo" />\n`;
    const out = await annotateAstroSource(src, FILE);
    expect(out).toMatch(
      /^<img data-astro-source-file="[^"]*" data-astro-source-loc="1:2" src="\/a\.jpg" alt="A photo" \/>\n$/,
    );
  });

  it('skips components and fragments', async () => {
    const src = `---\nimport Card from './Card.astro';\n---\n<Card><p>inside</p></Card>\n`;
    const out = await annotateAstroSource(src, FILE);
    expect(out).not.toContain('<Card data-astro-source-file');
    // …but the plain element inside the component's slot IS annotated
    expect(injectedLoc(out, 'p')).toBe(locOf(src, 'inside'));
  });

  it('annotates elements inside expressions (e.g. .map loops)', async () => {
    const src = `---\nconst xs = ['a'];\n---\n<ul>\n  {xs.map((x) => (\n    <li>{x}</li>\n  ))}\n</ul>\n`;
    const out = await annotateAstroSource(src, FILE);
    expect(injectedLoc(out, 'li')).toBe(locOf(src, '{x}'));
  });

  it('adds no newlines — line count is preserved', async () => {
    const src = `<main>\n  <h1>Title</h1>\n  <p>One</p>\n  <p>Two</p>\n</main>\n`;
    const out = await annotateAstroSource(src, FILE);
    expect(out.split('\n').length).toBe(src.split('\n').length);
  });

  it('escapes quotes in the file path', async () => {
    const src = `<p>x</p>\n`;
    const out = await annotateAstroSource(src, `/odd"path.astro`);
    expect(out).toContain('data-astro-source-file="/odd&quot;path.astro"');
  });

  it('round-trips: injected locs classify against the ORIGINAL source', async () => {
    const src = `---\nconst t = 'x';\n---\n<article>\n  <h2>A heading</h2>\n  <p>Some literal copy.</p>\n  <img src="/pic.jpg" alt="A pic">\n  <h3>{t}</h3>\n</article>\n`;
    const out = await annotateAstroSource(src, FILE);

    const h2 = await classifyAstro(src, injectedLoc(out, 'h2'), 'h2');
    expect(h2.kind).toBe('text');

    const img = await classifyAstro(src, injectedLoc(out, 'img'), 'img');
    expect(img.kind).toBe('image');

    const h3 = await classifyAstro(src, injectedLoc(out, 'h3'), 'h3');
    expect(h3.kind).toBe('dynamic');
  });

  it('round-trips: an injected loc drives a successful apply on the original source', async () => {
    const src = `<p>Old copy here</p>\n`;
    const out = await annotateAstroSource(src, FILE);
    const res = await applyAstro(src, {
      loc: injectedLoc(out, 'p'),
      tag: 'p',
      targetType: 'text',
      original: 'Old copy here',
      newText: 'New copy here',
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.newSource).toBe(`<p>New copy here</p>\n`);
  });

  it('returns the source unchanged when there is nothing to annotate', async () => {
    const src = `---\nconst x = 1;\n---\n`;
    expect(await annotateAstroSource(src, FILE)).toBe(src);
  });
});
