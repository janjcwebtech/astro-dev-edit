import { describe, expect, it } from 'vitest';
import { applyAstro } from '../src/patcher/astro.ts';
import { locOf } from './helpers.ts';

/**
 * Characterization tests for the markup patch path of applyAstro — literal
 * text carrying safelisted inline tags, edited as raw source.
 *
 * Unlike the text path, `original` is the *source* region (what /classify
 * handed the popup), so verification compares source against source and no
 * entity decoding is involved on either side.
 */

function markupReq(src: string, needle: string, tag: string, original: string, newText: string) {
  return { loc: locOf(src, needle), tag, targetType: 'markup' as const, original, newText };
}

describe('applyAstro — inline markup', () => {
  it('replaces the inner source, keeping the tags intact', async () => {
    const src = `<h2>The page is the best<br>editor for the page</h2>\n`;
    const res = await applyAstro(
      src,
      markupReq(src, 'The page', 'h2', 'The page is the best<br>editor for the page', 'The page is<br>the editor'),
    );
    expect(res).toEqual({ ok: true, newSource: `<h2>The page is<br>the editor</h2>\n` });
  });

  it('lets a plain-text element gain its first inline tag', async () => {
    const src = `<p>one two</p>\n`;
    const res = await applyAstro(src, markupReq(src, 'one two', 'p', 'one two', 'one <strong>two</strong>'));
    expect(res).toEqual({ ok: true, newSource: `<p>one <strong>two</strong></p>\n` });
  });

  it('preserves the leading/trailing whitespace frame (indentation)', async () => {
    const src = `<div>\n  one <em>two</em>\n</div>\n`;
    const res = await applyAstro(src, markupReq(src, '\n  one', 'div', 'one <em>two</em>', 'one <em>three</em>'));
    expect(res).toEqual({ ok: true, newSource: `<div>\n  one <em>three</em>\n</div>\n` });
  });

  it('keeps entities the author typed rather than double-escaping them', async () => {
    const src = `<p>Fish &amp; <em>chips</em></p>\n`;
    const res = await applyAstro(
      src,
      markupReq(src, 'Fish', 'p', 'Fish &amp; <em>chips</em>', 'Fish &amp; <em>peas</em>'),
    );
    expect(res).toEqual({ ok: true, newSource: `<p>Fish &amp; <em>peas</em></p>\n` });
  });

  it('neutralises a `{` so an edit can never introduce an expression', async () => {
    const src = `<p>a <em>b</em></p>\n`;
    const res = await applyAstro(src, markupReq(src, 'a <em', 'p', 'a <em>b</em>', 'a {danger} <em>b</em>'));
    expect(res).toEqual({ ok: true, newSource: `<p>a &#123;danger} <em>b</em></p>\n` });
  });

  it('refuses with mismatch when the source moved on', async () => {
    const src = `<p>a <em>b</em></p>\n`;
    const res = await applyAstro(src, markupReq(src, 'a <em', 'p', 'something else', 'a <em>c</em>'));
    expect(res).toMatchObject({ ok: false, code: 'mismatch' });
  });

  it('refuses a tag outside the safelist', async () => {
    const src = `<p>a <em>b</em></p>\n`;
    const res = await applyAstro(src, markupReq(src, 'a <em', 'p', 'a <em>b</em>', 'a <div>b</div>'));
    expect(res).toMatchObject({ ok: false, code: 'unsupported' });
    expect((res as { error: string }).error).toContain('<div>');
  });

  it('refuses a script tag', async () => {
    const src = `<p>a <em>b</em></p>\n`;
    const res = await applyAstro(
      src,
      markupReq(src, 'a <em', 'p', 'a <em>b</em>', 'a <script>alert(1)</script>'),
    );
    expect(res).toMatchObject({ ok: false, code: 'unsupported' });
  });

  it('refuses an event-handler attribute', async () => {
    const src = `<p>a <em>b</em></p>\n`;
    const res = await applyAstro(
      src,
      markupReq(src, 'a <em', 'p', 'a <em>b</em>', 'a <span onclick="x()">b</span>'),
    );
    expect(res).toMatchObject({ ok: false, code: 'unsupported' });
    expect((res as { error: string }).error).toContain('onclick');
  });

  it('refuses a javascript: href', async () => {
    const src = `<p>a <em>b</em></p>\n`;
    const res = await applyAstro(
      src,
      markupReq(src, 'a <em', 'p', 'a <em>b</em>', 'a <a href="javascript:x()">b</a>'),
    );
    expect(res).toMatchObject({ ok: false, code: 'unsupported' });
  });

  it('accepts a link with href/target/rel and a class', async () => {
    const src = `<p>a <em>b</em></p>\n`;
    const res = await applyAstro(
      src,
      markupReq(src, 'a <em', 'p', 'a <em>b</em>', 'a <a class="x" href="/docs" target="_blank" rel="noopener">docs</a>'),
    );
    expect(res).toEqual({
      ok: true,
      newSource: `<p>a <a class="x" href="/docs" target="_blank" rel="noopener">docs</a></p>\n`,
    });
  });

  it('refuses unbalanced tags rather than writing broken markup', async () => {
    const src = `<p>a <em>b</em></p>\n`;
    const res = await applyAstro(src, markupReq(src, 'a <em', 'p', 'a <em>b</em>', 'a <strong>b'));
    expect(res).toMatchObject({ ok: false, code: 'unsupported' });
    expect((res as { error: string }).error).toContain('never closed');
  });

  it('refuses crossed tags', async () => {
    const src = `<p>a <em>b</em></p>\n`;
    const res = await applyAstro(
      src,
      markupReq(src, 'a <em', 'p', 'a <em>b</em>', '<strong>a <em>b</strong></em>'),
    );
    expect(res).toMatchObject({ ok: false, code: 'unsupported' });
  });

  it('accepts a self-closing <br /> and a bare <br>', async () => {
    const src = `<p>a <em>b</em></p>\n`;
    const res = await applyAstro(src, markupReq(src, 'a <em', 'p', 'a <em>b</em>', 'a<br />b<br>c'));
    expect(res).toEqual({ ok: true, newSource: `<p>a<br />b<br>c</p>\n` });
  });

  it('refuses when the element itself is not markup-editable', async () => {
    const src = `---\nconst t = 'x';\n---\n<p>{t}</p>\n`;
    const res = await applyAstro(src, markupReq(src, '{t}', 'p', 'x', 'y'));
    expect(res).toMatchObject({ ok: false, code: 'dynamic' });
  });
});
