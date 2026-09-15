import { describe, expect, it } from 'vitest';
import { annotateAstroSource } from '../src/server/annotate.ts';
import { parseUsages } from '../src/server/usage-parse.ts';
import { createUsageIndex } from '../src/server/usage-index.ts';
import { usageId } from '../src/shared/usage-id.ts';
import { resolveComposition } from '../src/server/composition.ts';
import { compositionRelation } from '../src/client/composition-model.ts';
import type { UsageLink } from '../src/shared/protocol.ts';

const link = (file: string, target: string, loc = '1:1', extra = {}): UsageLink => ({
  id: usageId(file, loc), file, target, loc, offset: 0, name: target, hasSpread: false, props: [], slots: [], ...extra,
});
const chain = (...links: UsageLink[]) => links.map(l => '.' + l.id).join('');

describe('usage parsing and resolution', () => {
  it('uses real imports; names every unsupported usage and preserves slot ranges', async () => {
    const source = `---
import Card from '@ui/Card.astro';
import Widget from './Widget.jsx';
const fake = 'import Fake from "./Fake.astro"';
// import Nope from './Nope.astro';
---
<Card title="Hi" {label} class:list={['x']} {...Astro.props}><Fragment slot="heading"><b>Hi</b></Fragment>Body</Card>
<Widget /><Fake /><Nope /><UI.Card /><Card client:only /><Card server:defer /><Card set:html={html} />
<Card data-atx-chain="fake" />
{cards.map(Card => <Card />)}
<Astro.self />`;
    const usages = await parseUsages(source);
    expect(usages[0].specifier).toBe('@ui/Card.astro');
    expect(usages[0].hasSpread).toBe(true);
    expect(usages[0].props.map(p => p.kind)).toEqual(['quoted', 'shorthand', 'expression', 'spread']);
    expect(usages[0].slots.map(s => s.name)).toEqual(['heading', 'default']);
    for (const slot of usages[0].slots) expect(source.slice(slot.start, slot.end)).toBe(slot.source);
    expect(usages.slice(2).map(u => u.refusal)).toEqual([
      'dynamic', 'dynamic', 'namespaced', 'chain-break', 'chain-break', 'chain-break',
      'reserved-attribute', 'dynamic', undefined,
    ]);
  });

  it('resolves aliases, refuses packages, frameworks, MDX, symlinks and missing targets', async () => {
    const index = createUsageIndex({ root: '/project', canonical: async f => f === '/project/link.astro' ? '/outside/Real.astro' : f,
      resolve: async spec => ({ alias: '/project/Card.astro', pkg: '/project/node_modules/P.astro',
        jsx: '/project/W.jsx', mdx: '/project/M.mdx', symlink: '/project/link.astro' }[spec] ?? null) });
    const specs = ['alias', 'pkg', 'jsx', 'mdx', 'symlink', 'missing'];
    const source = `---\n${specs.map((s, i) => `import C${i} from '${s}';`).join('\n')}\n---\n${specs.map((_, i) => `<C${i} />`).join('')}`;
    const links = await index.update(source, '/project/Page.astro');
    expect(links.map(l => l.refusal)).toEqual([undefined, 'package', 'not-astro', 'chain-break', 'outside-root', 'unresolved']);
    expect(index.usesOf('/project/Card.astro')).toHaveLength(1);
    const originalId = links[0].id;
    expect((await index.update(source, '/project/Page.astro'))[0].id).toBe(originalId);
    await index.update('<p>Gone</p>', '/project/Page.astro');
    expect(index.links()).toEqual([]);
  });

  it('handles Unicode slot ranges and a leading component without frontmatter', async () => {
    const source = `---\nimport Card from './Card.astro';\n---\n<p>🐈 café</p><Card><b>Žluťoučký 🐈</b></Card>`;
    const [usage] = await parseUsages(source);
    expect(source.slice(usage.offset, usage.offset + 5)).toBe('<Card');
    expect(usage.slots[0].source).toBe('<b>Žluťoučký 🐈</b>');
    const index = createUsageIndex({ root: '/project', canonical: async f => f, resolve: async () => null });
    const minimal = '<Astro.self depth={0} />';
    const links = await index.update(minimal, '/project/Page.astro');
    expect(links[0].loc).toBe('1:1');
    const out = await annotateAstroSource(minimal, '/project/Page.astro', { composition: links });
    expect(out).toContain('<Astro.self data-atx-chain=');
    expect(out).toContain('} depth={0} />');
  });

  it('keeps the newer index when an older transform finishes after HMR', async () => {
    let entered!: () => void, release!: (value: string) => void;
    const started = new Promise<void>(done => { entered = done; });
    const waiting = new Promise<string>(done => { release = done; });
    const index = createUsageIndex({ root: '/project', canonical: async f => f });
    const old = index.update(`---\nimport Card from './Old.astro';\n---\n<Card />`, '/project/Page.astro',
      async () => { entered(); return waiting; });
    await started;
    await index.update(`---\nimport Card from './New.astro';\n---\n<Card />`, '/project/Page.astro', async () => '/project/New.astro');
    release('/project/Old.astro');
    await old;
    expect(index.links()[0].target).toBe('/project/New.astro');
  });

  it('ids are portable across roots and distinguish usage sites', () => {
    expect(usageId('src\\Card.astro', '3:5')).toBe(usageId('src/Card.astro', '3:5'));
    expect(usageId('src/Card.astro', '3:5')).toMatch(/^[\w-]{8}$/);
    expect(usageId('src/Card.astro', '3:5')).not.toBe(usageId('src/Card.astro', '4:5'));
  });
});

describe('composition truth', () => {
  const a = link('Page', 'Section'), b = link('Section', 'Card'), c = link('Card', 'Label');
  const links = [a, b, c];
  it('proves a route-anchored chain and root sentinel', () => {
    expect(resolveComposition({ route: 'Page', file: 'Label', chain: chain(a, b, c) }, links).tier).toBe('proven');
    expect(resolveComposition({ route: 'Page', file: 'Page', chain: '!' }, links).tier).toBe('proven');
  });
  it('validates the route and every hop, not just the leaf', () => {
    for (const runtime of [chain(b, c), chain(a, c), '.missing1', 'garbage', '!']) {
      expect(resolveComposition({ route: 'Page', file: 'Label', chain: runtime }, links).tier).toBe('none');
    }
  });
  it('never presents a partial static index as a unique answer', () => {
    expect(resolveComposition({ route: 'Page', file: 'Label' }, links).reason).toBe('incomplete-index');
    expect(resolveComposition({ route: 'Page', file: 'Label' }, links, true).tier).toBe('inferred');
  });
  it('refuses even a valid-looking recursive spread chain', () => {
    const recursive = link('Card', 'Card', '2:1', { hasSpread: true });
    const result = resolveComposition({ route: 'Page', file: 'Card', chain: chain(a, b, recursive) }, [...links, recursive]);
    expect(result).toMatchObject({ tier: 'none', reason: 'spread' });
  });
  it('detects a recursive spread even when its id was erased entirely', () => {
    const recursive = link('Card', 'Card', '2:1', { hasSpread: true });
    expect(resolveComposition({ route: 'Page', file: 'Card', chain: chain(a, b) }, [...links, recursive])).toMatchObject({ tier: 'none', reason: 'spread' });
    const back = link('Label', 'Card', '4:1', { hasSpread: true });
    expect(resolveComposition({ route: 'Page', file: 'Card', chain: chain(a, b) }, [...links, back])).toMatchObject({ tier: 'none', reason: 'spread' });
  });
  it('recovers truncated forwarding only as static inference', () => {
    const spread = { ...b, hasSpread: true };
    expect(resolveComposition({ route: 'Page', file: 'Card', chain: chain(a) }, [a, spread], true)).toMatchObject({ tier: 'inferred' });
    expect(resolveComposition({ route: 'Page', file: 'Card', chain: chain(a, spread) }, [a, spread], true)).toMatchObject({ tier: 'inferred', reason: 'spread' });
  });
  it('returns 2–8 candidates, refuses more, and terminates cycles', () => {
    for (const count of [2, 8, 9]) {
      const graph = Array.from({ length: count }, (_, i) => link('Page', 'Card', `${i + 1}:1`));
      const result = resolveComposition({ route: 'Page', file: 'Card' }, graph, true);
      expect(result.tier).toBe(count > 8 ? 'none' : 'candidates');
      if (count <= 8) expect(result.candidates).toHaveLength(count);
    }
    expect(resolveComposition({ route: 'Page', file: 'Missing' }, [...links, link('Card', 'Page')], true).reason).toBe('no-path');
  });
  it('uses strict lexical prefixes for slots and never treats equal sites as instance ids', () => {
    expect(compositionRelation(chain(a), chain(a, b))).toBe('slot');
    expect(compositionRelation('!', chain(a))).toBe('slot');
    expect(compositionRelation(chain(a, b), chain(a))).toBe('component');
    expect(compositionRelation(chain(a, b), chain(a, b))).toBe('same-site');
    expect(compositionRelation('', chain(a))).toBe('unrelated');
  });
});
