import ts from 'typescript';
import { transform as goTransform } from '@astrojs/compiler';
import { describe, expect, it } from 'vitest';
import { begin, child, slot } from '../src/server/composition-runtime.ts';
import { parseUsages } from '../src/server/usage-parse.ts';
import { annotateAstroSource } from '../src/server/annotate.ts';
import { createUsageIndex } from '../src/server/usage-index.ts';
import { parseSlotMarker, renderOccurrences } from '../src/client/render-occurrences.ts';

it('captures an immutable context and removes the transport before application code', () => {
  const request = {};
  const root = begin({}, '/Page.astro', request);
  const props = { title: 'Preserved', ...child(root, 'abcdefgh', '/Card.astro') };
  const card = begin(props, '/Card.astro', request);
  expect(props).toEqual({ title: 'Preserved' });
  expect(Object.getOwnPropertySymbols(props)).toEqual([]);
  expect(card).toMatchObject({ parent: root.id, chain: '.abcdefgh' });
  expect(Object.isFrozen(card)).toBe(true);
  expect(begin({}, '/Page.astro', request).chain).toBe('?');
  expect(begin(child(card, 'ijklmnop', '/Elsewhere.astro'), '/Wrong.astro', request).chain).toBe('?');
  expect(begin({}, '/Page.astro', {}).chain).toBe('!');
});

it('counts a render ordinal per usage site and per parent, never globally', () => {
  const request = {};
  const page = begin({}, '/Page.astro', request);
  expect(page.ordinal).toBe(1); // the entry render happens exactly once

  // One usage site rendered three times — a .map() — counts 1, 2, 3.
  const mapped = [1, 2, 3].map(() =>
    begin(child(page, 'aaaaaaaa', '/Card.astro'), '/Card.astro', request).ordinal);
  expect(mapped).toEqual([1, 2, 3]);

  // A second usage site in the same parent has its own count.
  expect(begin(child(page, 'bbbbbbbb', '/Card.astro'), '/Card.astro', request).ordinal).toBe(1);

  // A second parent instance counts from 1 again, so an ordinal is only ever
  // read against the parent that produced it.
  const other = begin(child(page, 'cccccccc', '/Page.astro'), '/Page.astro', request);
  expect(begin(child(other, 'aaaaaaaa', '/Card.astro'), '/Card.astro', request).ordinal).toBe(1);

  // A break carries no ordinal: nothing counted that render.
  expect(begin({}, '/Page.astro', request).ordinal).toBe(0);
});

it('preserves a broken relationship through subsequent known usages', () => {
  const request = {};
  begin({}, '/Page.astro', request);
  const lost = begin({}, '/Page.astro', request);
  expect(begin(child(lost, 'abcdefgh', '/Child.astro'), '/Child.astro', request).chain).toBe('?');
});

it('allocates slot placement IDs per insertion, including rendering the same object twice', async () => {
  const root = begin({}, '/Page.astro', {});
  const value = slot(root, 'default', '1:1', false, { render(destination) { destination.write('words'); } });
  const outputs: string[] = [];
  for (let i = 0; i < 2; i++) {
    let html = '';
    await value.render({ write(chunk) { html += String(chunk); } });
    outputs.push(html);
  }
  expect(outputs[0]).not.toBe(outputs[1]);
  expect(outputs.every(out => out.includes('-->words<!--/atx-slot:'))).toBe(true);
});

it('rejects malformed, duplicate and incomplete slot boundaries', () => {
  expect(renderOccurrences([{ type: 'comment', text: 'atx-slot:%broken' }])).toEqual({ ok: false, reason: 'invalid-slot-marker' });
  expect(renderOccurrences([{ type: 'comment', text: '/atx-slot:missing' }])).toEqual({ ok: false, reason: 'unbalanced-slot-markers' });
  const marker = (over: Record<string, unknown> = {}) => 'atx-slot:' + encodeURIComponent(JSON.stringify({
    id: 'a'.repeat(24), receiver: 'b'.repeat(24), name: 'default', loc: '6:22',
    fallback: false, file: '/Heading.astro', chain: '.E4himsYp', parent: null, ...over }));
  // One parser, two readers: the stream and `composition-dom.ts::wrappedSlot`,
  // which reads a single marker off an element for the dynamic-tag refusal.
  expect(parseSlotMarker(marker())).toMatchObject({ name: 'default', loc: '6:22', file: '/Heading.astro' });
  expect(parseSlotMarker(marker({ loc: '0:1' }))).toBeNull();
  expect(parseSlotMarker(marker({ chain: 'nope' }))).toBeNull();
  expect(parseSlotMarker(marker({ file: '' }))).toBeNull();
  expect(parseSlotMarker('/atx-slot:' + 'a'.repeat(24))).toBeNull();
});

describe('safe insertion after the final attribute', () => {
  for (const attr of ['title="quoted > value"', '{label}', '{...Astro.props}', 'value={/}/.test(value)}',
    'value={`outer ${`inner ${value}`} >`}', 'value={items.map(x => <b>{x}</b>)}', 'title=`literal > value`', 'disabled']) {
    it(attr, async () => {
      const source = `---\nimport Card from './Card.astro';\n---\n<Card ${attr} />`;
      const [usage] = await parseUsages(source);
      expect(source.slice(usage.injectionOffset)).toBe('/>');
      const index = createUsageIndex({ root: '/project', canonical: async file => file, resolve: async () => '/project/Card.astro' });
      const links = await index.update(source, '/project/Page.astro');
      const out = await annotateAstroSource(source, '/project/Page.astro', { composition: links, runtime: '/trace.ts' });
      expect(out).toContain(`<Card ${attr}  {...__atxRuntime.child(`);
    });
  }
});

it('keeps serialized HTML annotations explicitly ungrouped', () => {
  const result = renderOccurrences([{ type: 'element', key: 0, instance: 'replayed', parent: '', file: '', chain: '', ordinal: '', opaque: true }]);
  expect(result).toEqual({ ok: true, placements: [], occurrences: [{ key: 0, instance: 'replayed', group: null, slots: [], ordinal: 0, reason: 'untracked-html' }] });
});

/** The instrument's `{…}` wrapper is an Astro expression container, valid only
 *  in markup position. A slot reached through an expression is already inside
 *  one, so the braces would open a JS object literal and the compiled module
 *  would not parse — `Expected "}" but found "."`. */
describe('a slot reached through an expression container', () => {
  const compiles = async (annotated: string) => {
    const { code } = await goTransform(annotated, { filename: '/project/Page.astro' });
    return ts.transpileModule(code, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ESNext } })
      .diagnostics?.map(d => ts.flattenDiagnosticMessageText(d.messageText, ' ')) ?? [];
  };
  const annotate = (source: string) =>
    annotateAstroSource(source, '/project/Page.astro', { composition: [], runtime: '/trace.ts' });

  it('drops the braces inside a ternary, and the module still parses', async () => {
    const out = await annotate('---\n---\n<div>{flag ? <b>y</b> : <slot name="x" />}</div>');
    expect(out).toContain(': __atxRuntime.slot(');
    expect(out).not.toContain(': {__atxRuntime.slot(');
    expect(await compiles(out)).toEqual([]);
  });

  it('keeps the braces in markup position', async () => {
    const out = await annotate('---\n---\n<div><slot name="x" /></div>');
    expect(out).toContain('{__atxRuntime.slot(');
    expect(await compiles(out)).toEqual([]);
  });

  it('puts the braces back inside a forwarded-slot Fragment, which re-enters markup', async () => {
    const out = await annotate('---\n---\n<Card>{flag && <slot slot="head" name="x" />}</Card>');
    expect(out).toContain('<Fragment slot="head">{__atxRuntime.slot(');
    expect(await compiles(out)).toEqual([]);
  });
});

it('instruments empty frontmatter and a leading slot without shifting source annotations', async () => {
  for (const source of ['<slot />', '---\n---\n<slot />']) {
    const out = await annotateAstroSource(source, '/project/Page.astro', { composition: [], runtime: '/trace.ts' });
    expect(out).toContain('const __atxRender=');
    expect(out).not.toContain('<{');
    expect(out).toContain('<><slot /></>)}');
  }
});
