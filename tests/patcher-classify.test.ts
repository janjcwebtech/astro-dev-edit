import { describe, expect, it } from 'vitest';
import { classifyAstro } from '../src/patcher/astro.ts';
import { locOf } from './helpers.ts';

/**
 * Characterization tests: pin the classifier's current behavior exactly.
 * Locs are derived with locOf() per the annotation rules documented in
 * src/patcher/astro.ts (text child → its start; element/expression child →
 * start + 1; childless element → element start + 1).
 */

describe('classifyAstro', () => {
  it('classifies an element with only literal text as text', async () => {
    const src = `<p>Hello world</p>\n`;
    const res = await classifyAstro(src, locOf(src, 'Hello'), 'p');
    expect(res.kind).toBe('text');
    expect(res.reason).toBe('literal text');
  });

  it('classifies literal text inside frontmatter-bearing template', async () => {
    const src = `---\nconst x = 1;\n---\n<main>\n  <h2>A heading</h2>\n</main>\n`;
    const res = await classifyAstro(src, locOf(src, 'A heading'), 'h2');
    expect(res.kind).toBe('text');
  });

  it('classifies an expression child as dynamic with the frontmatter-field reason', async () => {
    const src = `---\nconst title = 'x';\n---\n<h1>{title}</h1>\n`;
    // The compiler reports an expression's start one char BEFORE the `{`, so
    // the annotation loc (start + 1) lands on the `{` itself.
    const res = await classifyAstro(src, locOf(src, '{title'), 'h1');
    expect(res.kind).toBe('dynamic');
    expect(res.reason).toBe(
      'This text comes from a template expression (e.g. a frontmatter field or a variable), so editing it here would change code, not copy.',
    );
  });

  it('classifies nested markup as dynamic', async () => {
    const src = `<p><strong>bold</strong> rest</p>\n`;
    // first child is the <strong> element → its start + 1 (the tag name)
    const res = await classifyAstro(src, locOf(src, 'strong>bold'), 'p');
    expect(res.kind).toBe('dynamic');
    expect(res.reason).toBe(
      'This element contains nested markup, so its text cannot be edited as one block.',
    );
  });

  it('classifies a childless element as empty', async () => {
    const src = `<div><span></span></div>\n<p>after</p>\n`;
    // childless <span> → its own start + 1 (the tag name)
    const res = await classifyAstro(src, locOf(src, 'span><'), 'span');
    expect(res.kind).toBe('empty');
  });

  it('classifies img with quoted src and alt as image with static attrs', async () => {
    const src = `<img src="/a.jpg" alt="A photo">\n`;
    const res = await classifyAstro(src, locOf(src, 'img'), 'img');
    expect(res.kind).toBe('image');
    expect(res.attrs).toEqual({ src: 'static', alt: 'static' });
  });

  it('classifies img with expression src and no alt as dynamic src / missing alt', async () => {
    const src = `---\nconst foo = '/a.jpg';\n---\n<img src={foo}>\n`;
    const res = await classifyAstro(src, locOf(src, 'img'), 'img');
    expect(res.kind).toBe('image');
    expect(res.attrs).toEqual({ src: 'dynamic', alt: 'missing' });
  });

  it('refuses nested empty same-tag elements as ambiguous', async () => {
    // Outer span's annotation = inner span's start + 1; inner (childless)
    // span's annotation = its own start + 1. Same loc, same tag → ambiguous.
    const src = `<div><span><span></span></span></div>\n`;
    const res = await classifyAstro(src, locOf(src, 'span></span>'), 'span');
    expect(res.kind).toBe('ambiguous');
  });

  it('returns unresolved when no element matches the loc', async () => {
    const src = `<p>Hello</p>\n`;
    const res = await classifyAstro(src, '999:1', 'p');
    expect(res.kind).toBe('unresolved');
  });

  it('returns unresolved for a malformed loc', async () => {
    const src = `<p>Hello</p>\n`;
    const res = await classifyAstro(src, 'abc', 'p');
    expect(res.kind).toBe('unresolved');
  });

  it('returns unresolved when the tag does not match the element at the loc', async () => {
    const src = `<p>Hello</p>\n`;
    const res = await classifyAstro(src, locOf(src, 'Hello'), 'div');
    expect(res.kind).toBe('unresolved');
  });
});
