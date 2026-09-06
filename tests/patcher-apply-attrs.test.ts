import { describe, expect, it } from 'vitest';
import { applyAstro } from '../src/patcher/astro.ts';
import { locOf } from './helpers.ts';

/** Characterization tests for the src/alt attribute patch path of applyAstro. */

function imgReq(
  src: string,
  targetType: 'src' | 'alt',
  original: string,
  newText: string,
) {
  return { loc: locOf(src, 'img'), tag: 'img', targetType, original, newText };
}

describe('applyAstro — attributes', () => {
  it('replaces a double-quoted src value', async () => {
    const src = `<img src="/old.jpg" alt="x">\n`;
    const res = await applyAstro(src, imgReq(src, 'src', '/old.jpg', '/new.png'));
    expect(res).toEqual({ ok: true, newSource: `<img src="/new.png" alt="x">\n` });
  });

  it('replaces a single-quoted src and escapes single quotes in the new value', async () => {
    const src = `<img src='/old.jpg'>\n`;
    const res = await applyAstro(src, imgReq(src, 'src', '/old.jpg', "/it's.jpg"));
    expect(res).toEqual({ ok: true, newSource: `<img src='/it&#39;s.jpg'>\n` });
  });

  it('escapes double quotes when inserting into a double-quoted value', async () => {
    const src = `<img src="/a.jpg" alt="old">\n`;
    const res = await applyAstro(src, imgReq(src, 'alt', 'old', 'say "hi"'));
    expect(res).toEqual({ ok: true, newSource: `<img src="/a.jpg" alt="say &quot;hi&quot;">\n` });
  });

  it('replaces an alt value', async () => {
    const src = `<img src="/a.jpg" alt="old alt">\n`;
    const res = await applyAstro(src, imgReq(src, 'alt', 'old alt', 'new alt'));
    expect(res).toEqual({ ok: true, newSource: `<img src="/a.jpg" alt="new alt">\n` });
  });

  it('inserts a missing alt on <img> before >', async () => {
    const src = `<img src="/a.jpg">\n`;
    const res = await applyAstro(src, imgReq(src, 'alt', '', 'added'));
    expect(res).toEqual({ ok: true, newSource: `<img src="/a.jpg" alt="added">\n` });
  });

  it('inserts a missing alt on a self-closing <img ... /> before the slash', async () => {
    const src = `<img src="/a.jpg" />\n`;
    const res = await applyAstro(src, imgReq(src, 'alt', '', 'added'));
    expect(res).toEqual({ ok: true, newSource: `<img src="/a.jpg" alt="added" />\n` });
  });

  it('inserts alt correctly when other attrs contain expressions and quoted > chars', async () => {
    const src = `---\nconst w = 100;\n---\n<img src="/a.jpg" width={w} data-x="a>b" />\n`;
    const res = await applyAstro(src, imgReq(src, 'alt', '', 'added'));
    expect(res).toMatchObject({ ok: true });
    if (res.ok) {
      expect(res.newSource).toContain(`data-x="a>b" alt="added" />`);
    }
  });

  it('refuses alt insertion when the client claims a non-empty original', async () => {
    const src = `<img src="/a.jpg">\n`;
    const res = await applyAstro(src, imgReq(src, 'alt', 'phantom', 'added'));
    expect(res).toMatchObject({ ok: false, code: 'unsupported' });
  });

  it('never inserts a missing src', async () => {
    const src = `<img alt="x">\n`;
    const res = await applyAstro(src, imgReq(src, 'src', '', '/new.jpg'));
    expect(res).toMatchObject({ ok: false, code: 'unsupported' });
  });

  it('refuses an expression-valued attribute as dynamic', async () => {
    const src = `---\nconst foo = '/a.jpg';\n---\n<img src={foo}>\n`;
    const res = await applyAstro(src, imgReq(src, 'src', '/a.jpg', '/new.jpg'));
    expect(res).toMatchObject({ ok: false, code: 'dynamic' });
  });

  it('refuses with mismatch when the attr value differs from original', async () => {
    const src = `<img src="/a.jpg">\n`;
    const res = await applyAstro(src, imgReq(src, 'src', '/other.jpg', '/new.jpg'));
    expect(res).toMatchObject({ ok: false, code: 'mismatch' });
  });

  it('verifies attr values exactly — no whitespace normalization (unlike text)', async () => {
    const src = `<img src="/a.jpg">\n`;
    const res = await applyAstro(src, imgReq(src, 'src', ' /a.jpg ', '/new.jpg'));
    expect(res).toMatchObject({ ok: false, code: 'mismatch' });
  });

  it('decodes entities in the source attr value before comparing', async () => {
    const src = `<img src="/a.jpg" alt="Fish &amp; chips">\n`;
    const res = await applyAstro(src, imgReq(src, 'alt', 'Fish & chips', 'Plain'));
    expect(res).toEqual({ ok: true, newSource: `<img src="/a.jpg" alt="Plain">\n` });
  });

  // Astro's compiler decodes an attribute value while parsing the template and
  // emits the result without re-escaping, so a source `&amp;amp;` reaches the
  // DOM as a bare `&` — two decodes deep. Verifying at one depth refused that
  // as "edited elsewhere" and left the element permanently unsaveable, since a
  // reload produced the same mismatch every time.
  it('verifies an attr the renderer decoded twice, not only once', async () => {
    const src = `<img src="/a.jpg" alt="alt with &amp;amp; ampersand">\n`;
    const res = await applyAstro(src, imgReq(src, 'alt', 'alt with & ampersand', 'Plain'));
    expect(res).toEqual({ ok: true, newSource: `<img src="/a.jpg" alt="Plain">\n` });
  });

  it('accepts the shallower reading of the same value too', async () => {
    // A renderer that decodes once serves `&amp;` and the DOM shows the literal
    // five characters. Both depths are the same source, so both verify.
    const src = `<img src="/a.jpg" alt="alt with &amp;amp; ampersand">\n`;
    const res = await applyAstro(src, imgReq(src, 'alt', 'alt with &amp; ampersand', 'Plain'));
    expect(res).toEqual({ ok: true, newSource: `<img src="/a.jpg" alt="Plain">\n` });
  });

  it('still refuses a value that is not the source at any depth', async () => {
    const src = `<img src="/a.jpg" alt="alt with &amp;amp; ampersand">\n`;
    const res = await applyAstro(src, imgReq(src, 'alt', 'something else entirely', 'Plain'));
    expect(res).toMatchObject({ ok: false, code: 'mismatch' });
  });

  it('leaves a value with no entities on the one comparison it always had', async () => {
    const src = `<img src="/a.jpg" alt="plain words">\n`;
    expect(await applyAstro(src, imgReq(src, 'alt', 'plain words', 'Next')))
      .toEqual({ ok: true, newSource: `<img src="/a.jpg" alt="Next">\n` });
    expect(await applyAstro(src, imgReq(src, 'alt', 'plain word', 'Next')))
      .toMatchObject({ ok: false, code: 'mismatch' });
  });
});
