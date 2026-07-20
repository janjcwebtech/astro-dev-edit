import { describe, expect, it } from 'vitest';
import { applyAstro } from '../src/patcher/astro.ts';
import { locOf } from './helpers.ts';

/** Characterization tests for the text-content patch path of applyAstro. */

function textReq(src: string, needle: string, tag: string, original: string, newText: string) {
  return { loc: locOf(src, needle), tag, targetType: 'text' as const, original, newText };
}

describe('applyAstro — text content', () => {
  it('replaces literal text and touches nothing else', async () => {
    const src = `<header>x</header>\n<p>Hello</p>\n<footer>y</footer>\n`;
    const res = await applyAstro(src, textReq(src, 'Hello', 'p', 'Hello', 'Goodbye'));
    expect(res).toEqual({ ok: true, newSource: `<header>x</header>\n<p>Goodbye</p>\n<footer>y</footer>\n` });
  });

  it('preserves the leading/trailing whitespace frame (indentation)', async () => {
    const src = `<div>\n  Hello there\n</div>\n`;
    const res = await applyAstro(src, textReq(src, '\n  Hello', 'div', 'Hello there', 'New text'));
    expect(res).toEqual({ ok: true, newSource: `<div>\n  New text\n</div>\n` });
  });

  it('decodes entities in the source when verifying against the rendered original', async () => {
    const src = `<p>Fish &amp; chips</p>\n`;
    const res = await applyAstro(src, textReq(src, 'Fish', 'p', 'Fish & chips', 'Plain fish'));
    expect(res).toEqual({ ok: true, newSource: `<p>Plain fish</p>\n` });
  });

  it('decodes common typographic entities (mdash, hellip, curly quotes) when verifying', async () => {
    const src = `<p>Wait &mdash; there&rsquo;s more&hellip;</p>\n`;
    const res = await applyAstro(src, textReq(src, 'Wait', 'p', 'Wait — there’s more…', 'Short.'));
    expect(res).toEqual({ ok: true, newSource: `<p>Short.</p>\n` });
  });

  it('still refuses with mismatch on an entity it does not know', async () => {
    const src = `<p>a &clubs; b</p>\n`;
    const res = await applyAstro(src, textReq(src, 'a &clubs;', 'p', 'a ♣ b', 'x'));
    expect(res).toMatchObject({ ok: false, code: 'mismatch' });
  });

  it('escapes <, { and & in the new text so content cannot become structure', async () => {
    const src = `<p>Safe</p>\n`;
    const res = await applyAstro(src, textReq(src, 'Safe', 'p', 'Safe', 'A & B < C {x}'));
    expect(res).toEqual({ ok: true, newSource: `<p>A &amp; B &lt; C &#123;x}</p>\n` });
  });

  it('trims the new text and re-applies the whitespace frame', async () => {
    const src = `<span> padded </span>\n`;
    const res = await applyAstro(src, textReq(src, ' padded ', 'span', 'padded', '  tidy  '));
    expect(res).toEqual({ ok: true, newSource: `<span> tidy </span>\n` });
  });

  it('verifies whitespace-insensitively: collapsed spaces in original still match', async () => {
    const src = `<p>Hello   world</p>\n`;
    const res = await applyAstro(src, textReq(src, 'Hello', 'p', 'Hello world', 'Bye'));
    expect(res.ok).toBe(true);
  });

  it('refuses with mismatch when the source no longer matches the original', async () => {
    const src = `<p>Hello</p>\n`;
    const res = await applyAstro(src, textReq(src, 'Hello', 'p', 'Something else', 'Bye'));
    expect(res).toMatchObject({ ok: false, code: 'mismatch' });
  });

  it('refuses with dynamic when the element children include an expression', async () => {
    const src = `---\nconst title = 'x';\n---\n<h1>{title}</h1>\n`;
    const res = await applyAstro(src, {
      loc: locOf(src, '{title'), // annotation loc lands on the `{` (see classify tests)
      tag: 'h1',
      targetType: 'text',
      original: 'x',
      newText: 'y',
    });
    expect(res).toMatchObject({ ok: false, code: 'dynamic' });
  });

  it('refuses with unresolved when the loc matches nothing', async () => {
    const src = `<p>Hello</p>\n`;
    const res = await applyAstro(src, { loc: '999:1', tag: 'p', targetType: 'text', original: 'Hello', newText: 'Bye' });
    expect(res).toMatchObject({ ok: false, code: 'unresolved' });
  });

  it('refuses with ambiguous when two elements share the annotation loc', async () => {
    const src = `<div><span><span></span></span></div>\n`;
    const res = await applyAstro(src, {
      loc: locOf(src, 'span></span>'),
      tag: 'span',
      targetType: 'text',
      original: '',
      newText: 'x',
    });
    expect(res).toMatchObject({ ok: false, code: 'ambiguous' });
  });
});
