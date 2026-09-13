import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ViteDevServer } from 'vite';
import { listEntryFiles } from '../src/server/collection-entries.ts';
import { createSchemaProvider, type EntryEditorOptions } from '../src/server/content-config.ts';
import { compilePattern } from '../src/server/entry-pattern.ts';
import { entryExtensionsFor } from '../src/server/entry-routes.ts';

/**
 * Where `createSchemaProvider` decides a collection's entries live.
 *
 * The directory was derived from the collection's **name** and never from the
 * glob loader's `base`, so a name and a folder that disagree silently broke the
 * collection everywhere downstream — the entry list, the drawer, entry
 * creation, and the `0 entries` count in the designer. Nothing announced it:
 * the collection listed, its fields rendered from the resolved schema, and the
 * row read as though the collection were simply empty.
 *
 * A camelCase name over a kebab-case folder is the ordinary way to hit it, and
 * Astro's own docs encourage exactly that shape.
 *
 * The provider loads the config *module* through Vite for schemas and reads the
 * config *text* for the base — `glob({ base })` captures the value in a
 * closure, so the exported Loader carries no trace of it. The stub below is
 * therefore two halves: a fake `ssrLoadModule` for the module, and a real file
 * on disk for the text.
 */

let root: string;

const CONFIG = `import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({ title: z.string() }),
});

const useCases = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/use-cases' }),
  schema: z.object({ title: z.string() }),
});

const plain = defineCollection({
  loader: glob({ pattern: '**/*.md' }),
  schema: z.object({ title: z.string() }),
});

export const collections = { blog, useCases, plain };
`;

/** Only `ssrLoadModule` is reached, and only for the collections map. */
function stubServer(names: string[]): ViteDevServer {
  return {
    async ssrLoadModule() {
      return { collections: Object.fromEntries(names.map((n) => [n, { schema: undefined }])) };
    },
  } as unknown as ViteDevServer;
}

async function provider(options: EntryEditorOptions = {}, config = CONFIG) {
  await writeFile(join(root, 'src/content.config.ts'), config);
  return createSchemaProvider(stubServer(['blog', 'useCases', 'plain']), root, async () => options);
}

const dirs = async (p: Awaited<ReturnType<typeof provider>>): Promise<Record<string, string>> =>
  Object.fromEntries((await p.listCollections()).map((c) => [c.collection, c.dir]));

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'atx-provider-'));
  await mkdir(join(root, 'src'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('collection directory resolution', () => {
  it("honours the loader's base where it disagrees with the collection name", async () => {
    expect(await dirs(await provider())).toEqual({
      // Name and folder coincide, which is why this one always worked.
      blog: 'src/content/blog',
      // The bug: derived as `src/content/useCases`, a directory that does not
      // exist, so every entry in it was unreachable.
      useCases: 'src/content/use-cases',
      // No base to read — the convention is still the answer.
      plain: 'src/content/plain',
    });
  });

  it('lets an explicit dir override outrank the loader base', async () => {
    const p = await provider({ collections: { useCases: { dir: 'content/cases' } } });
    // The documented workaround for this bug keeps working, and still wins.
    expect((await dirs(p)).useCases).toBe('content/cases');
  });

  it('falls back to the convention when the base is not provable', async () => {
    const p = await provider(
      {},
      CONFIG.replace("base: './src/content/use-cases'", 'base: CASES_DIR'),
    );
    // Refused rather than guessed: a wrong directory is worse than the
    // convention, which at least fails the same way it always has.
    expect((await dirs(p)).useCases).toBe('src/content/useCases');
  });

  // With no config there is no text to read a base from, and a collection
  // configured explicitly is still usable — that is the path that must not
  // throw on the missing file.
  it('falls back to the convention when there is no config file to read', async () => {
    await rm(join(root, 'src/content.config.ts'), { force: true });
    const p = createSchemaProvider(stubServer([]), root, async () => ({
      collections: { useCases: {} },
    }));
    expect((await dirs(p)).useCases).toBe('src/content/useCases');
  });

  it('reports the same directory through forCollection', async () => {
    const p = await provider();
    expect((await p.forCollection('useCases'))?.dir).toBe('src/content/use-cases');
  });
});

/**
 * The reverse lookup, which used the same wrong derivation — so mapping a file
 * back to its collection missed for exactly the collections the forward lookup
 * did.
 */
describe('forFile', () => {
  it('maps a file under the loader base back to its collection', async () => {
    const p = await provider();
    expect((await p.forFile('src/content/use-cases/code-generation.md'))?.collection).toBe(
      'useCases',
    );
  });

  it('still maps a conventional path', async () => {
    const p = await provider();
    expect((await p.forFile('src/content/blog/hello.md'))?.collection).toBe('blog');
  });

  it('returns null for a file under no collection', async () => {
    const p = await provider();
    expect(await p.forFile('src/pages/index.astro')).toBeNull();
  });

  // A base nested inside another collection's directory is ambiguous by prefix
  // alone, so the more specific directory has to win. Matching in declaration
  // order would hand the file to whichever came first.
  it('prefers the most specific directory when one nests inside another', async () => {
    const nested = `import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const docs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: 'src/content/docs' }),
  schema: z.object({ title: z.string() }),
});

const guides = defineCollection({
  loader: glob({ pattern: '**/*.md', base: 'src/content/docs/guides' }),
  schema: z.object({ title: z.string() }),
});

export const collections = { docs, guides };
`;
    await writeFile(join(root, 'src/content.config.ts'), nested);
    const p = createSchemaProvider(stubServer(['docs', 'guides']), root, async () => ({}));
    expect((await p.forFile('src/content/docs/guides/start.md'))?.collection).toBe('guides');
    expect((await p.forFile('src/content/docs/intro.md'))?.collection).toBe('docs');
  });
});

/**
 * The loader's `pattern`, which decides *what counts as an entry* — and is what
 * makes a `base` broader than the collection safe.
 *
 * Honouring the base while ignoring the pattern is not a smaller version of the
 * right answer, it is a worse bug than the one it fixes: a collection based at
 * `src/content` with `pattern: 'settings.yml'` claims every markdown file
 * belonging to every other collection beneath it, and entry resolution then
 * picks the wrong collection for a URL, because it sorts by id length and a
 * swallowed `blog/one` is longer than `blog`'s own `one`.
 */
describe('loader pattern', () => {
  const BROAD = `import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({ title: z.string() }),
});

const settings = defineCollection({
  loader: glob({ pattern: 'settings.yml', base: './src/content' }),
  schema: z.object({ title: z.string() }),
});

const faqs = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/faqs' }),
  schema: z.object({ q: z.string() }),
});

export const collections = { blog, settings, faqs };
`;

  async function broad() {
    await mkdir(join(root, 'src/content/blog'), { recursive: true });
    await mkdir(join(root, 'src/content/faqs'), { recursive: true });
    await writeFile(join(root, 'src/content.config.ts'), BROAD);
    await writeFile(join(root, 'src/content/settings.yml'), 'title: Site\n');
    for (const n of ['one', 'two', 'three']) {
      await writeFile(join(root, `src/content/blog/${n}.md`), '---\ntitle: X\n---\n');
    }
    await writeFile(join(root, 'src/content/faqs/a.json'), '{"q":"?"}');
    await writeFile(join(root, 'src/content/faqs/b.json'), '{"q":"?"}');
    const p = createSchemaProvider(
      stubServer(['blog', 'settings', 'faqs']),
      root,
      async () => ({}),
    );
    const infos = await p.listCollections();
    const ext = entryExtensionsFor(['.astro', '.md', '.mdx']);
    return Object.fromEntries(
      await Promise.all(
        infos.map(async (c) => [
          c.collection,
          (
            await listEntryFiles(join(root, c.dir), {
              extensions: ext,
              match: compilePattern(c.pattern),
            })
          ).names,
        ]),
      ),
    );
  }

  it('reports the pattern alongside the dir', async () => {
    await writeFile(join(root, 'src/content.config.ts'), BROAD);
    const p = createSchemaProvider(stubServer(['blog', 'settings', 'faqs']), root, async () => ({}));
    const byName = Object.fromEntries(
      (await p.listCollections()).map((c) => [c.collection, [c.dir, c.pattern]]),
    );
    expect(byName).toEqual({
      blog: ['src/content/blog', ['**/*.md']],
      // The broad base, which only the pattern makes correct.
      settings: ['src/content', ['settings.yml']],
      faqs: ['src/content/faqs', ['**/*.json']],
    });
  });

  it('stops a narrow pattern over a broad base from swallowing its siblings', async () => {
    const claimed = await broad();
    expect(claimed.settings).toEqual(['settings.yml']);
    expect(claimed.blog).toEqual(['one.md', 'three.md', 'two.md']);
  });

  // The bug in its own right: a data collection reported 0 entries while its
  // directory sat there full, and no `editableExtensions` value could admit it.
  it('lists .json entries, which no configuration used to reach', async () => {
    const claimed = await broad();
    expect(claimed.faqs).toEqual(['a.json', 'b.json']);
  });
});
