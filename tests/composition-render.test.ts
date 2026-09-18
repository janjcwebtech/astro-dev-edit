import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transform as goTransform } from '@astrojs/compiler';
import { createRequire } from 'node:module';
import { annotateAstroSource } from '../src/server/annotate.ts';
import { createUsageIndex } from '../src/server/usage-index.ts';
import { resolveComposition } from '../src/server/composition.ts';
import { renderOccurrences, type TraceEvent } from '../src/client/render-occurrences.ts';
import { compositionRelation } from '../src/client/composition-model.ts';
import { applyAstro, classifyAstro } from '../src/patcher/astro.ts';

const root = fileURLToPath(new URL('./fixtures/composition/', import.meta.url));
const temporary: string[] = [];
const peer = createRequire(import.meta.url);
const peerMajor = Number(peer('astro/package.json').version.split('.')[0]);
const goRuntime = process.env.ATX_ASTRO5_ROOT
  ? createRequire(resolve(process.env.ATX_ASTRO5_ROOT, 'package.json')) : peer;
const canRenderGo = Number(goRuntime('astro/package.json').version.split('.')[0]) < 7;
const nativeImport = (url: string) => import(/* @vite-ignore */ url);
const attr = (tag: string | undefined, name: string) => tag?.match(new RegExp(` ${name}="([^"]*)"`))?.[1] ?? '';
const tags = (html: string, tag: string) => html.match(new RegExp(`<${tag}(?:\\s[^>]*|)>`, 'g')) ?? [];
function occurrenceModel(html: string) {
  const events: TraceEvent[] = [], elements: string[] = [];
  for (const match of html.matchAll(/<!--([\s\S]*?)-->|<([a-z][\w-]*)(?:\s[^>]*|)>/g)) {
    if (match[1] !== undefined) events.push({ type: 'comment', text: match[1] });
    else if (attr(match[0], 'data-atx-version') === '2') {
      const key = elements.length;
      elements.push(match[0]);
      events.push({ type: 'element', key, instance: attr(match[0], 'data-atx-instance'),
        parent: attr(match[0], 'data-atx-parent'), file: attr(match[0], 'data-atx-file'),
        chain: attr(match[0], 'data-atx-chain'), ordinal: attr(match[0], 'data-atx-ordinal') });
    }
  }
  return { result: renderOccurrences(events), events, elements };
}

afterAll(async () => { await Promise.all(temporary.map(dir => rm(dir, { recursive: true, force: true }))); });

async function fixture(compiler: 'go' | 'rust', enhanced = false, entry = 'Page') {
  const dir = await mkdtemp(join(tmpdir(), 'atx-composition-'));
  temporary.push(dir);
  const files = (await readdir(root, { withFileTypes: true })).filter(file => file.isFile() && file.name.endsWith('.astro')).map(file => file.name);
  const index = createUsageIndex({ root, canonical: async file => file,
    resolve: async (specifier, importer) => specifier.startsWith('@fixture/')
      ? join(root, specifier.slice('@fixture/'.length)) : resolve(dirname(importer), specifier) });
  // Plain value modules travel with the fixture: the `elsewhere` verdict needs
  // a real second module to name, and nothing compiles them.
  for (const name of (await readdir(root, { withFileTypes: true }))
    .filter(file => file.isFile() && file.name.endsWith('.mjs')).map(file => file.name)) {
    await writeFile(join(dir, name), await readFile(join(root, name), 'utf8'));
  }
  const sources = new Map<string, string>();
  for (const name of files) {
    const file = join(root, name), source = await readFile(file, 'utf8');
    sources.set(file, source);
    await index.update(source, file);
  }
  const runtime = compiler === 'go' ? goRuntime : peer;
  const { experimental_AstroContainer: AstroContainer } = await import(/* @vite-ignore */ pathToFileURL(runtime.resolve('astro/container')).href);
  const runtimePath = join(dir, 'trace-runtime.mjs');
  const runtimeSource = await readFile(new URL('../src/server/composition-runtime.ts', import.meta.url), 'utf8');
  const runtimeCode = ts.transpileModule(runtimeSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replace('astro/runtime/server/index.js', pathToFileURL(runtime.resolve('astro/runtime/server/index.js')).href);
  if (enhanced) await writeFile(runtimePath, runtimeCode);
  const transform = compiler === 'go' ? goTransform : (await nativeImport(import.meta.resolve('@astrojs/compiler-rs'))).transform;
  for (const [file, source] of sources) {
    const annotated = await annotateAstroSource(source, file, { composition: index.links().filter(l => l.file === file), runtime: enhanced ? pathToFileURL(runtimePath).href : undefined });
    const plain = await annotateAstroSource(source, file);
    if (!enhanced) expect(annotated.split('\n')).toHaveLength(source.split('\n').length);
    // Both namespaces, in one match: composition adds chain attributes, and
    // must not move a single byte of the file/loc run either namespace carries.
    const annotations = (text: string) => text.match(
      /data-astro-source-file="[^"]*" data-astro-source-loc="[^"]*" data-atx-file="[^"]*" data-atx-loc="[^"]*"/g);
    expect(annotations(annotated)).toEqual(annotations(plain));
    const compiled = await transform(annotated, {
      filename: file, internalURL: pathToFileURL(runtime.resolve('astro/runtime/server/index.js')).href,
      compact: false, annotateSourceFile: true,
      resolvePath: (specifier: string) => specifier.endsWith('.astro')
        ? pathToFileURL(join(dir, specifier.replace('@fixture/', './').replace('.astro', '.mjs'))).href : specifier,
    });
    // Both compilers keep user imports as written; rewrite only fixture imports.
    const code = compiled.code.replace(/(['"])((?:\.\/|@fixture\/)[\w]+)\.astro\1/g,
      (_: string, quote: string, name: string) => `${quote}${pathToFileURL(join(dir, name.replace('@fixture/', './') + '.mjs')).href}${quote}`);
    await writeFile(join(dir, file.split('/').at(-1)!.replace('.astro', '.mjs')), code);
  }
  const Page = (await nativeImport(pathToFileURL(join(dir, entry + '.mjs')).href)).default;
  const container = await AstroContainer.create();
  const html = await container.renderToString(Page);
  return { html, links: index.links(), sources, render: () => container.renderToString(Page) };
}

// Go is a declared runtime dependency. Rust is installed by the current Astro 7
// peer; run the same assertions when that compiler is available.
let hasRust = false;
try { import.meta.resolve('@astrojs/compiler-rs'); hasRust = true; } catch { /* Astro 5/6 */ }
for (const compiler of [...(canRenderGo ? ['go'] : []), ...(hasRust && peerMajor >= 7 ? ['rust'] : [])] as ('go' | 'rust')[]) {
  describe(`rendered composition (${compiler})`, () => {
    it('protects spreads and gives every render a distinct instance, including multiple roots', async () => {
      const { html, links, sources, render } = await fixture(compiler, true, 'Advanced');
      const route = join(root, 'Advanced.astro');
      const verdict = (tag: string | undefined) => resolveComposition({ route,
        file: attr(tag, 'data-atx-file'), chain: attr(tag, 'data-atx-chain'), traceVersion: 2 }, links, true);
      const rootless = tags(html, 'i').filter(t => ['1', '2'].includes(attr(t, 'data-rootless')));
      expect(rootless).toHaveLength(4);
      const ids = rootless.map(t => attr(t, 'data-atx-instance'));
      expect(ids[0]).toBe(ids[1]); expect(ids[2]).toBe(ids[3]); expect(ids[0]).not.toBe(ids[2]);
      expect(new Set(rootless.map(t => attr(t, 'data-atx-chain'))).size).toBe(1);
      expect(rootless.map(verdict).every(v => v.tier === 'proven')).toBe(true);
      const recursive = tags(html, 'div').filter(t => attr(t, 'data-spread-depth') !== '');
      expect(recursive).toHaveLength(3);
      expect(new Set(recursive.map(t => attr(t, 'data-atx-instance'))).size).toBe(3);
      expect(recursive.map(verdict).map(v => v.links.length)).toEqual([1, 2, 3]);
      expect(recursive.every(t => verdict(t).tier === 'proven')).toBe(true);
      for (let i = 1; i < recursive.length; i++) expect(attr(recursive[i], 'data-atx-parent')).toBe(attr(recursive[i - 1], 'data-atx-instance'));
      expect(tags(html, 'article').map(verdict).every(v => v.tier === 'proven')).toBe(true);
      expect(html).toContain('data-exposed-symbols="0"');
      expect(tags(html, 'div').filter(t => attr(t, 'data-exposed-symbols') !== '').map(verdict).every(v => v.tier === 'proven')).toBe(true);
      expect(tags(html, 'small').map(verdict).every(v => v.tier === 'proven')).toBe(true);
      const label = tags(html, 'small')[0];
      const file = attr(label, 'data-atx-file'), loc = attr(label, 'data-atx-loc');
      const patched = await applyAstro(sources.get(file)!, { loc, tag: 'small', targetType: 'text', original: 'Three links deep', newText: 'Verified' });
      expect(patched.ok).toBe(true);
      const more = await Promise.all([render(), render()]);
      const firstIds = new Set(tags(more[0], 'i').map(t => attr(t, 'data-atx-instance')));
      expect(tags(more[1], 'i').every(t => !firstIds.has(attr(t, 'data-atx-instance')))).toBe(true);
      expect(html).toContain('<!--atx-slot:');
    }, 30000);

    it('records actual repeated, named, fallback, forwarded and async slot placements', async () => {
      const { html } = await fixture(compiler, true, 'Advanced');
      const { result, events, elements } = occurrenceModel(html);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const placed = (attribute: string) => result.occurrences.filter(o => elements[o.key].includes(attribute));
      const repeated = placed('data-repeated-slot');
      expect(repeated).toHaveLength(2);
      expect(repeated[0].instance).toBe(repeated[1].instance);
      expect(repeated[0].group).not.toBe(repeated[1].group);
      expect(repeated.map(o => o.slots.length)).toEqual([1, 1]);
      expect(repeated[0].slots[0].receiver).toBe(repeated[1].slots[0].receiver);
      expect(repeated.every(o => o.slots[0].name === 'default' && !o.slots[0].fallback)).toBe(true);
      const forwarded = placed('data-forwarded-slot');
      expect(forwarded).toHaveLength(2);
      expect(forwarded.map(o => o.slots.length)).toEqual([2, 2]);
      expect(forwarded[0].group).not.toBe(forwarded[1].group);
      for (const occurrence of forwarded) {
        expect(occurrence.slots.map(s => s.file.split('/').at(-1))).toEqual(['RepeatSlots.astro', 'ForwardSlots.astro']);
      }
      const named = placed('data-rootless="forwarded"');
      expect(named).toHaveLength(2);
      expect(named[0].group).toBe(named[1].group);
      expect(named[0].slots.map(s => s.name)).toEqual(['detail', 'detail']);
      // The `<RepeatSlots />` fallbacks, plus one `<em>Fallback heading</em>`
      // per `<Card />` on this route that supplies no heading slot — the two
      // mapped cards and the one carrying literal slot text.
      const fallback = result.occurrences.filter(o => elements[o.key].startsWith('<em'));
      expect(fallback).toHaveLength(6);
      expect(fallback.every(o => o.slots.at(-1)?.fallback)).toBe(true);
      for (const speed of ['slow', 'fast']) {
        const [occurrence] = placed(`data-delayed-slot="${speed}"`);
        const owner = elements.find(t => attr(t, 'data-delay') === speed)!;
        expect(occurrence.slots.at(-1)?.receiver).toBe(attr(owner, 'data-atx-instance'));
      }
      const damaged = events.filter(event => event.type !== 'comment' || !event.text.startsWith('/atx-slot:'));
      expect(renderOccurrences(damaged).ok).toBe(false);
      const legacy = await fixture(compiler, false, 'Advanced');
      const visible = (text: string) => text.replace(/<!--(?:\/?atx-slot:)[\s\S]*?-->/g, '')
        .replace(/ data-(?:atx-[\w-]+|astro-source-(?:file|loc))(?:="[^"]*")?/g, '');
      expect(visible(html)).toBe(visible(legacy.html));
      if (process.env.ATX_TRACE_REPORT) { await mkdir('temp', { recursive: true }); await writeFile(resolve(`temp/composition-${compiler}-metrics.json`), JSON.stringify({ compiler, v1Bytes: Buffer.byteLength(legacy.html), v2Bytes: Buffer.byteLength(html), elements: elements.length, slotInsertions: events.filter(e => e.type === 'comment' && e.text.startsWith('atx-slot:')).length })); }
    }, 30000);

    it('refuses missing transports even when a dynamic recursive invocation renders the route itself', async () => {
      const { html, links } = await fixture(compiler, true, 'DynamicSelf');
      const route = join(root, 'DynamicSelf.astro');
      const depths = tags(html, 'div');
      expect(depths).toHaveLength(3);
      expect(depths.map(t => attr(t, 'data-atx-chain'))).toEqual(['!', '?', '?']);
      expect(depths.map(tag => resolveComposition({ route, file: route,
        chain: attr(tag, 'data-atx-chain'), traceVersion: 2 }, links, true).tier)).toEqual(['proven', 'none', 'none']);
    }, 30000);

    it('marks serialized slot HTML as opaque rather than grouping replayed instance ids', async () => {
      const { html } = await fixture(compiler, true, 'CachedPage');
      expect(tags(html, 'div').filter(t => attr(t, 'data-atx-boundary') === 'html')).toHaveLength(2);
      const copies = tags(html, 'i');
      expect(copies).toHaveLength(4);
      expect(new Set(copies.map(t => attr(t, 'data-atx-instance'))).size).toBe(1);
    }, 30000);

    it('proves chains, slots, repeated sites, recursion and honest forwarding refusals', async () => {
      const { html, links, sources } = await fixture(compiler);
      const route = join(root, 'Page.astro');
      const verdict = (tag: string | undefined) => resolveComposition({ route,
        file: attr(tag, 'data-atx-file'), chain: attr(tag, 'data-atx-chain') }, links, true);
      const cards = tags(html, 'article');
      expect(cards).toHaveLength(5);
      expect(cards.slice(0, 4).map(verdict).map(r => r.tier)).toEqual(['proven', 'proven', 'proven', 'proven']);
      const repeated = cards.slice(0, 3).map(t => attr(t, 'data-atx-chain'));
      expect(new Set(repeated).size).toBe(1);
      expect(attr(cards[3], 'data-atx-chain')).not.toBe(repeated[0]);
      // The DOM subtree distinguishes cards; duplicate text does not become an
      // instance key or authorization to write an array item.
      expect(cards.slice(0, 3).map(t => attr(t, 'data-card'))).toEqual(['0', '1', '2']);
      const slots = tags(html, 'p').filter(t => attr(t, 'data-slot') !== '');
      expect(slots).toHaveLength(3);
      for (let i = 0; i < 3; i++) {
        expect(verdict(slots[i]).tier).toBe('proven');
        expect(compositionRelation(attr(slots[i], 'data-atx-chain'), repeated[i])).toBe('slot');
      }
      const named = tags(html, 'b');
      expect(named).toHaveLength(3);
      expect(named.every(t => compositionRelation(attr(t, 'data-atx-chain'), repeated[0]) === 'slot')).toBe(true);
      const pageSlot = tags(html, 'p').find(t => attr(t, 'id') === 'page-slot')!;
      expect(attr(pageSlot, 'data-atx-chain')).toBe('!');
      const layout = tags(html, 'main')[0];
      expect(compositionRelation('!', attr(layout, 'data-atx-chain'))).toBe('slot');
      const label = tags(html, 'small').find(t => verdict(t).links.length === 3);
      const slottedLabels = tags(html, 'small').filter(t => verdict(t).links.length === 2);
      expect(slottedLabels).toHaveLength(3);
      for (const supplied of slottedLabels) {
        expect(compositionRelation(attr(supplied, 'data-atx-chain'), repeated[0])).toBe('unrelated');
        expect(compositionRelation(attr(supplied, 'data-atx-chain'), repeated[0], links)).toBe('slot');
      }
      expect(verdict(label)).toMatchObject({ tier: 'proven', links: expect.any(Array) });
      expect(verdict(label).links).toHaveLength(3);
      expect(tags(html, 'div').filter(t => attr(t, 'data-depth') !== '').map(verdict).map(r => r.tier)).toEqual(['proven', 'proven', 'proven']);
      const recursiveSpread = tags(html, 'div').filter(t => attr(t, 'data-spread-depth') !== '');
      expect(recursiveSpread).toHaveLength(3);
      expect(new Set(recursiveSpread.map(t => attr(t, 'data-atx-chain'))).size).toBe(1);
      expect(recursiveSpread.map(verdict).map(r => r.tier)).toEqual(['none', 'none', 'none']);
      // {...Astro.props} actually overwrites the injected link in rendered HTML.
      expect(verdict(cards[4]).tier).toBe('candidates');
      expect(verdict(cards[4]).links).toEqual([]);
      expect(html).not.toMatch(/<slot[^>]*data-atx/);
      expect(tags(html, 'em').map(verdict).map(r => r.tier)).toEqual(['proven', 'candidates']);
      // Rootless repeated output has no provable grouping: never manufacture
      // an instance number from sibling order or the shared chain.
      const rootless = tags(html, 'i');
      expect(rootless).toHaveLength(4);
      expect(new Set(rootless.map(t => attr(t, 'data-atx-chain'))).size).toBe(1);
      expect(compositionRelation(attr(rootless[0], 'data-atx-chain'), attr(rootless[1], 'data-atx-chain'))).toBe('same-site');
      // Existing verified writes still resolve against ORIGINAL coordinates.
      const file = attr(label, 'data-atx-file'), loc = attr(label, 'data-atx-loc');
      expect((await classifyAstro(sources.get(file)!, loc, 'small')).kind).toBe('text');
      const result = await applyAstro(sources.get(file)!, { loc, tag: 'small', targetType: 'text',
        original: 'Three links deep', newText: 'Updated label' });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.newSource).toContain('<small>Updated label</small>');
    }, 30000);

    /**
     * The site-shaped fixture, as opposed to the mechanism-shaped one above.
     *
     * `Marketing.astro` holds every word and renders none of them: they travel
     * SiteLayout → FeatureSection → FeatureCard and reach the page three files
     * below the one that wrote them. Nothing here is constructed to hit a
     * branch — it is the shape a layout, a section and a card produce on any
     * real site, which is exactly why it is worth committing. Without it the
     * three-deep guarantee is a memory of a browser session.
     */
    it('threads a three-deep chain on a site-shaped fixture, back to the file that holds the words', async () => {
      const { html, links } = await fixture(compiler, true, 'Marketing');
      const route = join(root, 'Marketing.astro');
      const verdict = (tag: string | undefined) => resolveComposition({ route,
        file: attr(tag, 'data-atx-file'), chain: attr(tag, 'data-atx-chain'), traceVersion: 2 }, links, true);
      const footnotes = tags(html, 'p').filter(t => attr(t, 'class') === 'feature-footnote');
      expect(footnotes).toHaveLength(2);
      for (const footnote of footnotes) {
        const resolved = verdict(footnote);
        expect(resolved.tier).toBe('proven');
        // Three links, in order, each one a file further from the words.
        expect(resolved.links.map(link => link.target?.split('/').at(-1)))
          .toEqual(['SiteLayout.astro', 'FeatureSection.astro', 'FeatureCard.astro']);
        expect(attr(footnote, 'data-atx-file').split('/').at(-1)).toBe('FeatureCard.astro');
        // The chain starts in the file that holds the words, not in the file
        // that renders them: a three-deep chain is only useful if its first
        // link is where someone would go to change the sentence.
        expect(resolved.links[0]?.file).toBe(route);
      }
      // Two cards, distinguished by their own instance rather than by their
      // identical footnote text.
      expect(new Set(footnotes.map(t => attr(t, 'data-atx-instance'))).size).toBe(2);

      // The value itself: `footnote` is a quoted literal at Marketing.astro's
      // one usage site, and that is where a write would land — three files up
      // from the element carrying it.
      const passed = links.find(link => link.file === route && link.name === 'SiteLayout')!;
      const prop = passed.props.find(p => p.name === 'footnote')!;
      expect(prop).toMatchObject({ verdict: 'editable',
        value: 'Written in Marketing.astro, rendered three files below it.' });

      // The words the cards differ by come from a literal array one hop below,
      // so each card's title is proven to its own entry rather than to entry 1.
      const titles = tags(html, 'h3').filter(t => attr(t, 'class') === 'feature-title');
      expect(titles).toHaveLength(2);
      expect(titles.map(t => verdict(t).tier)).toEqual(['proven', 'proven']);
      expect(new Set(titles.map(t => attr(t, 'data-atx-ordinal'))).size).toBe(2);

      // The other half of the guarantee, and the one a real site meets first: a
      // value FORWARDED through an intermediate component is `read-only` at
      // every hop that merely passes it on. `{footnote}` in SiteLayout,
      // `{section.heading}` and `{card.title}` in the map bodies are all names
      // whose literal lives in another file, and the trace does not cross a
      // component boundary — so it refuses by name instead of guessing which
      // caller wrote the string. Editable exactly once, where the words are.
      const sectionLink = links.find(l => l.file.endsWith('FeatureSection.astro') && l.name === 'FeatureCard')!;
      const layoutLink = links.find(l => l.file.endsWith('SiteLayout.astro') && l.name === 'FeatureSection')!;
      for (const forwarded of [sectionLink.props.find(p => p.name === 'title')!,
                               layoutLink.props.find(p => p.name === 'heading')!,
                               layoutLink.props.find(p => p.name === 'footnote')!]) {
        expect(forwarded).toMatchObject({ verdict: 'read-only', reason: 'untraced' });
      }

      // Page-owned slot content keeps the route's own empty chain, so a
      // three-deep page does not make everything on it three deep.
      const lede = tags(html, 'p').find(t => attr(t, 'id') === 'lede')!;
      expect(attr(lede, 'data-atx-chain')).toBe('!');
    }, 30000);
  });
}
