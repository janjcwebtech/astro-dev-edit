import { describe, expect, it } from 'vitest';
import { begin, child, slot } from '../src/server/composition-runtime.ts';
import { parseUsages } from '../src/server/usage-parse.ts';
import { annotateAstroSource } from '../src/server/annotate.ts';
import { createUsageIndex } from '../src/server/usage-index.ts';
import { renderOccurrences } from '../src/client/render-occurrences.ts';

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

it('instruments empty frontmatter and a leading slot without shifting source annotations', async () => {
  for (const source of ['<slot />', '---\n---\n<slot />']) {
    const out = await annotateAstroSource(source, '/project/Page.astro', { composition: [], runtime: '/trace.ts' });
    expect(out).toContain('const __atxRender=');
    expect(out).not.toContain('<{');
    expect(out).toContain('<><slot /></>)}');
  }
});
