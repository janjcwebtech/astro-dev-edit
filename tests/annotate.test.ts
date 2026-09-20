import { describe, expect, it } from 'vitest';
import { annotateAstroSource } from '../src/server/annotate.ts';
import { applyAstro, classifyAstro } from '../src/patcher/astro.ts';
import { locOf } from './helpers.ts';

/**
 * The self-annotation transform (src/server/annotate.ts) runs on every
 * supported Astro version and must stamp exactly the locs the patcher expects
 * — the same rules locOf() mirrors. Two invariants pinned here:
 *
 * 1. Parity: the injected loc for an element equals the locOf()-derived loc
 *    the whole patcher test-suite is built on.
 * 2. Round-trip: a loc extracted from annotated output resolves through the
 *    real classify/apply against the ORIGINAL (on-disk) source — because
 *    injected locs reference pre-injection coordinates.
 */

const FILE = '/proj/src/pages/index.astro';

/** The full attribute run one annotated element carries. One namespace, on
 *  every Astro version — Astro's own is never emitted here (issue #76). */
function stamp(file: string, loc: string): string {
  return ` data-atx-file="${file}" data-atx-loc="${loc}"`;
}

/** Extract the injected loc for the first annotated occurrence of `tag`. */
function injectedLoc(annotated: string, tag: string): string {
  const re = new RegExp(
    `<${tag} data-atx-file="[^"]*" data-atx-loc="([0-9]+:[0-9]+)"`,
  );
  const m = annotated.match(re);
  if (!m) throw new Error(`no injected annotation found for <${tag}>`);
  return m[1];
}

describe('annotateAstroSource', () => {
  it('never stamps slots, and does stamp custom elements', async () => {
    const out = await annotateAstroSource('<slot><my-card>Fallback</my-card></slot>', FILE);
    expect(out).toContain('<slot>');
    expect(out).toContain('<my-card data-atx-file=');
    expect(out).not.toContain('<slot data-');
  });

  it('annotates a text-bearing element with its text start', async () => {
    const src = `<p>Hello world</p>\n`;
    const out = await annotateAstroSource(src, FILE);
    expect(out).toBe(`<p${stamp(FILE, locOf(src, 'Hello'))}>Hello world</p>\n`);
  });

  it('annotates every element in a nested template, matching locOf', async () => {
    const src = `---\nconst t = 'x';\n---\n<main>\n  <h1>Title</h1>\n  <p>Body text</p>\n</main>\n`;
    const out = await annotateAstroSource(src, FILE);
    expect(injectedLoc(out, 'h1')).toBe(locOf(src, 'Title'));
    expect(injectedLoc(out, 'p')).toBe(locOf(src, 'Body text'));
    // <main>'s first positioned child is whitespace text before <h1>
    expect(out).toContain('<main data-atx-file=');
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
    expect(out).toBe(`<img${stamp(FILE, '1:2')} src="/a.jpg" alt="A photo" />\n`);
  });

  it('skips components and fragments', async () => {
    const src = `---\nimport Card from './Card.astro';\n---\n<Card><p>inside</p></Card>\n`;
    const out = await annotateAstroSource(src, FILE);
    expect(out).not.toContain('<Card data-atx-file');
    // …but the plain element inside the component's slot IS annotated
    expect(injectedLoc(out, 'p')).toBe(locOf(src, 'inside'));
  });

  it('never stamps <script> or <style> — an unknown attribute makes Astro treat them as is:inline', async () => {
    const src =
      `<style>\n  p { color: red }\n</style>\n` +
      `<p>hi</p>\n` +
      `<script>\n  import './a.ts';\n</script>\n`;
    const out = await annotateAstroSource(src, FILE);
    expect(out).toContain('<script>');
    expect(out).toContain('<style>');
    expect(out).not.toMatch(/<(script|style) data-atx-/);
    // …the ordinary element between them is still annotated
    expect(injectedLoc(out, 'p')).toBe(locOf(src, 'hi'));
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
    expect(out).toContain('data-atx-file="/odd&quot;path.astro"');
  });

  /**
   * The tool-owned namespace is not conditional on the Astro version, on the
   * dev toolbar, or on composition: one transform stamps it everywhere, which
   * is what lets `client/source-map.ts` read that one channel and nothing
   * else.
   */
  it('stamps the tool-owned pair on a plain run, and nothing else', async () => {
    const src = `<main>\n  <h1>Title</h1>\n</main>\n`;
    const out = await annotateAstroSource(src, FILE);
    expect(out).toContain(`<h1${stamp(FILE, locOf(src, 'Title'))}>`);
    // No composition attributes leak into a plain annotation run.
    expect(out).not.toContain('data-atx-chain');
    expect(out).not.toContain('data-atx-version');
  });

  /**
   * Issue #72 — the leak and the weight, pinned together.
   *
   * `data-atx-file` was one absolute path repeated once per element: 16% of a
   * real page, and it named the developer's home directory into HTML that a
   * LAN dev server, a tunnel, a screen share or a screenshot all publish.
   * `root` is what the plugins pass; the attribute is root-relative from then
   * on, and the loc is untouched — locs are computed from the ORIGINAL source,
   * so shortening an attribute cannot move one (rule 9).
   *
   * With Astro's own pair gone (#76), `data-atx-file` is the only path-bearing
   * attribute left — so a root makes the served page carry no absolute path at
   * all.
   */
  it('emits data-atx-file root-relative, naming nothing above the root', async () => {
    const root = '/proj';
    const src = `<main>\n  <h1>Title</h1>\n</main>\n`;
    const loc = locOf(src, 'Title');
    const out = await annotateAstroSource(src, FILE, { root });
    expect(out).toContain(`data-atx-file="src/pages/index.astro" data-atx-loc="${loc}"`);
    expect(out).not.toContain('data-atx-file="/proj');
    // Nothing else carries a path, so nothing carries the absolute one.
    expect(out).not.toContain('/proj');
  });

  it('shortening the attribute moves no loc — the pair is identical either way', async () => {
    const src = `---\nconst t = 'x';\n---\n<article>\n  <h2>A heading</h2>\n  <p>Copy.</p>\n  <h3>{t}</h3>\n</article>\n`;
    const absolute = await annotateAstroSource(src, FILE);
    const relative = await annotateAstroSource(src, FILE, { root: '/proj' });
    expect(relative).toBe(absolute.replaceAll(`data-atx-file="${FILE}"`,
      'data-atx-file="src/pages/index.astro"'));
  });

  /**
   * The composition runtime is generated code, and generated code is served:
   * the module reaches the browser, and `RenderTrace.file` reaches it a second
   * time inside an `atx-slot` comment. `begin` compares the target `child`
   * threaded against the file it was handed, so both have to be in the same
   * spelling — and that spelling is the root-relative one.
   */
  it('generates the trace runtime with root-relative paths on both sides', async () => {
    const src = `---\nimport Card from '../Card.astro';\n---\n<Card title="Hi" />\n`;
    const links = [{ id: 'aaaaaaaa', file: FILE, loc: locOf(src, '<Card'), offset: src.indexOf('<Card'),
      injectionOffset: src.indexOf('<Card') + '<Card'.length, name: 'Card',
      target: '/proj/src/Card.astro', hasSpread: false, props: [], slots: [] }];
    const out = await annotateAstroSource(src, FILE,
      { composition: links, runtime: '/runtime.mjs', root: '/proj' });
    expect(out).toContain('begin(Astro.props,"src/pages/index.astro",Astro.request)');
    expect(out).toContain('"aaaaaaaa","src/Card.astro"');
    expect(out).not.toContain('"/proj/src');
  });

  it('keeps the node_modules segment, so package ownership still reads off the annotation', async () => {
    const out = await annotateAstroSource('<img src="/x.jpg" alt="x">\n',
      '/proj/node_modules/astro/components/Image.astro', { root: '/proj' });
    expect(out).toContain('data-atx-file="node_modules/astro/components/Image.astro"');
  });

  /**
   * Issue #76 — Astro's namespace is never emitted, under any options.
   *
   * Where Astro's own compiler emits the pair (5/6, toolbar on) a second one
   * is not a harmless duplicate: the Go printer splices its own
   * injection-shifted loc in ahead of ours and the HTML parser keeps the
   * first, so ours would lose. Where it emits nothing (7, or 5/6 with the
   * toolbar off) the pair served readers outside this tool only, and carried
   * the one absolute path left in a served page. Neither case survives, so
   * this holds for every option combination the plugins can pass.
   */
  it('never emits Astro’s namespace, whatever the options', async () => {
    const src = `<p>Hello world</p>\n`;
    const loc = locOf(src, 'Hello');
    expect(await annotateAstroSource(src, FILE))
      .toBe(`<p data-atx-file="${FILE}" data-atx-loc="${loc}">Hello world</p>\n`);
    for (const opts of [{}, { root: '/proj' }, { composition: [], root: '/proj' }]) {
      expect(await annotateAstroSource(src, FILE, opts)).not.toContain('data-astro-source');
    }
  });

  it('round-trips: injected locs classify against the ORIGINAL source', async () => {
    const src = `---\nconst t = 'x';\n---\n<article>\n  <h2>A heading</h2>\n  <p>Some literal copy.</p>\n  <img src="/pic.jpg" alt="A pic">\n  <h3>{t}</h3>\n</article>\n`;
    const out = await annotateAstroSource(src, FILE);

    const h2 = await classifyAstro(src, injectedLoc(out, 'h2'), 'h2');
    expect(h2.kind).toBe('text');

    const img = await classifyAstro(src, injectedLoc(out, 'img'), 'img');
    expect(img.kind).toBe('image');

    // {t} traces to the frontmatter const it renders, so it is editable by
    // value; an expression with nowhere to trace to still refuses.
    const h3 = await classifyAstro(src, injectedLoc(out, 'h3'), 'h3');
    expect(h3.kind).toBe('expression');
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
