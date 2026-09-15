import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transform as goTransform } from '@astrojs/compiler';
import { createRequire } from 'node:module';
import { annotateAstroSource } from '../src/server/annotate.ts';
import { createUsageIndex } from '../src/server/usage-index.ts';
import { resolveComposition } from '../src/server/composition.ts';
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
afterAll(async () => { await Promise.all(temporary.map(dir => rm(dir, { recursive: true, force: true }))); });

async function fixture(compiler: 'go' | 'rust') {
  const dir = await mkdtemp(join(tmpdir(), 'atx-composition-'));
  temporary.push(dir);
  const files = (await readdir(root, { withFileTypes: true })).filter(file => file.isFile() && file.name.endsWith('.astro')).map(file => file.name);
  const index = createUsageIndex({ root, canonical: async file => file,
    resolve: async (specifier, importer) => specifier.startsWith('@fixture/')
      ? join(root, specifier.slice('@fixture/'.length)) : resolve(dirname(importer), specifier) });
  const sources = new Map<string, string>();
  for (const name of files) {
    const file = join(root, name), source = await readFile(file, 'utf8');
    sources.set(file, source);
    await index.update(source, file);
  }
  const runtime = compiler === 'go' ? goRuntime : peer;
  const { experimental_AstroContainer: AstroContainer } = await import(/* @vite-ignore */ pathToFileURL(runtime.resolve('astro/container')).href);
  const transform = compiler === 'go' ? goTransform : (await nativeImport(import.meta.resolve('@astrojs/compiler-rs'))).transform;
  for (const [file, source] of sources) {
    const annotated = await annotateAstroSource(source, file, { composition: index.links().filter(l => l.file === file) });
    const plain = await annotateAstroSource(source, file);
    expect(annotated.split('\n')).toHaveLength(source.split('\n').length);
    const annotations = (text: string) => text.match(/data-astro-source-file="[^"]*" data-astro-source-loc="[^"]*"/g);
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
  const Page = (await nativeImport(pathToFileURL(join(dir, 'Page.mjs')).href)).default;
  const container = await AstroContainer.create();
  const html = await container.renderToString(Page);
  return { html, links: index.links(), sources };
}

// Go is a declared runtime dependency. Rust is installed by the current Astro 7
// peer; run the same assertions when that compiler is available.
let hasRust = false;
try { import.meta.resolve('@astrojs/compiler-rs'); hasRust = true; } catch { /* Astro 5/6 */ }
for (const compiler of [...(canRenderGo ? ['go'] : []), ...(hasRust && peerMajor >= 7 ? ['rust'] : [])] as ('go' | 'rust')[]) {
  describe(`rendered composition (${compiler})`, () => {
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
  });
}
