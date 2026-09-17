import { describe, expect, it } from 'vitest';
import { applyAstro, classifyAstro } from '../src/patcher/astro.ts';
import { locOf } from './helpers.ts';

/**
 * `set:html` on a plain element: one whole string, edited raw.
 *
 * The container owns a value and nothing below it. Angle brackets, braces and
 * quotes are what make the value HTML, so each has to survive the round trip
 * spelled the way the author wrote it — a tag turned into visible punctuation
 * is the one failure this path cannot be allowed to have. Every write is read
 * back through the same classify before it is returned.
 */

const CONST = `---\nconst intro = '<p>Hello <b>there</b></p>';\n---\n<div set:html={intro}></div>\n`;
const QUOTED = `---\n---\n<section set:html="<em>Quoted</em>"></section>\n`;

const at = (src: string, needle: string) => locOf(src, needle);
const write = (src: string, needle: string, tag: string, original: string, newText: string) =>
  applyAstro(src, { loc: at(src, needle), tag, targetType: 'html' as const, original, newText });

describe('classifyAstro — set:html', () => {
  it('gives the container the whole string the frontmatter holds', async () => {
    expect(await classifyAstro(CONST, at(CONST, 'div set:html'), 'div')).toMatchObject({
      kind: 'html', html: { value: '<p>Hello <b>there</b></p>' },
    });
  });

  it('reads a quoted one raw, because that is what Astro injects', async () => {
    // `set:html="&lt;em&gt;x"` puts the characters `<em>x` on the page rather
    // than an emphasis element, so the bytes between the quotes are the value.
    const entity = `---\n---\n<section set:html="&lt;em&gt;Not a tag"></section>\n`;
    expect(await classifyAstro(QUOTED, at(QUOTED, 'section set:html'), 'section')).toMatchObject({
      kind: 'html', html: { value: '<em>Quoted</em>' },
    });
    expect(await classifyAstro(entity, at(entity, 'section set:html'), 'section')).toMatchObject({
      kind: 'html', html: { value: '&lt;em&gt;Not a tag' },
    });
  });

  it('refuses an expression it cannot prove reaches a string, by name', async () => {
    // Each of these is one hop from *something* and none is one hop from a
    // string this file holds: a call, an array entry whose index is unproven,
    // and a name with no declaration at all.
    for (const [expr, extra] of [['{render()}', ''], ['{posts[i].body}', 'const posts = [];'], ['{missing}', '']]) {
      const src = `---\n${extra}\n---\n<div set:html=${expr}></div>\n`;
      expect((await classifyAstro(src, at(src, 'div set:html'), 'div')).kind, expr).toBe('dynamic');
    }
  });

  it('is read before the children are, because set:html replaces them', async () => {
    // Without the `set:html` branch this element classifies as `empty`.
    expect((await classifyAstro(CONST, at(CONST, 'div set:html'), 'div')).kind).not.toBe('empty');
  });
});

describe('applyAstro — set:html', () => {
  it('writes the frontmatter literal and keeps every tag a tag', async () => {
    const res = await write(CONST, 'div set:html', 'div', '<p>Hello <b>there</b></p>',
      '<p>Goodbye <i>now</i> &amp; thanks</p>');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.newSource).toBe(
      `---\nconst intro = '<p>Goodbye <i>now</i> &amp; thanks</p>';\n---\n<div set:html={intro}></div>\n`);
  });

  it('escapes only what the JavaScript literal needs', async () => {
    const res = await write(CONST, 'div set:html', 'div', '<p>Hello <b>there</b></p>',
      `<p data-x='y'>it's a back\\slash</p>`);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(await classifyAstro(res.newSource, at(res.newSource, 'div set:html'), 'div')).toMatchObject({
      html: { value: `<p data-x='y'>it's a back\\slash</p>` },
    });
  });

  it('splices a quoted one in verbatim, so its tags stay tags', async () => {
    for (const value of ['<strong>Bold &amp; brash</strong>', '<b>{x}</b>', "<a href='#x'>link</a>"]) {
      const res = await write(QUOTED, 'section set:html', 'section', '<em>Quoted</em>', value);
      expect(res.ok, value).toBe(true);
      if (!res.ok) continue;
      expect(res.newSource, value).toContain(`set:html="${value}"`);
      expect(await classifyAstro(res.newSource, at(res.newSource, 'section set:html'), 'section'), value)
        .toMatchObject({ kind: 'html', html: { value } });
    }
  });

  it('refuses the one character a quoted destination cannot spell', async () => {
    // Entities are not decoded here, so a `"` would simply end the attribute
    // and there is nothing else to write instead of it.
    expect(await write(QUOTED, 'section set:html', 'section', '<em>Quoted</em>', '<a href="#x">link</a>'))
      .toMatchObject({ ok: false, code: 'unsupported' });
  });

  it('refuses a stale original rather than overwriting it', async () => {
    expect(await write(CONST, 'div set:html', 'div', '<p>Something else</p>', '<p>New</p>'))
      .toMatchObject({ ok: false, code: 'mismatch' });
  });

  it('refuses an expression with no proven literal, writing nothing', async () => {
    const src = `---\n---\n<div set:html={render()}></div>\n`;
    expect(await write(src, 'div set:html', 'div', 'x', '<p>New</p>'))
      .toMatchObject({ ok: false, code: 'dynamic' });
  });
});
