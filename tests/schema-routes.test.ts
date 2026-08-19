import type { AstroIntegrationLogger } from 'astro';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Connect } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createMiddleware } from '../src/server/middleware.ts';
import type { TextEditOptions } from '../src/server/options.ts';
import { stubOptions, stubSchemaProvider } from './helpers.ts';

/**
 * Endpoint tests for the collection designer (/collections,
 * /collection/schema/apply, /collection/create).
 *
 * The patcher itself is pinned in `content-config-patch.test.ts`; what matters
 * here is everything around it — the etag guard, the `schemaEditor` gate
 * refusing before any filesystem work, the two stores staying separate (schema →
 * `content.config.ts`, overrides → `.astro-text-edit.json`), and the fact that a
 * request can only ever name a *collection*, never a path.
 */

const logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  options: {},
  label: 'test',
  fork: () => logger,
} as unknown as AstroIntegrationLogger;

const CONFIG = `import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    // Shown on the index page.
    excerpt: z.string(),
  }),
});

export const collections = { blog };
`;

const blogSchema = z.object({ title: z.string(), excerpt: z.string() });

let root: string;

async function mount(
  options: TextEditOptions = {},
  provider = stubSchemaProvider({
    async listCollections() {
      return [
        { collection: 'blog', dir: 'src/content/blog', schema: blogSchema, fieldConfig: {} },
      ];
    },
    async configPath() {
      return 'src/content.config.ts';
    },
  }),
): Promise<Connect.NextHandleFunction> {
  return createMiddleware({
    logger,
    root,
    optionsResolver: stubOptions(root, options),
    schemaProvider: provider,
    routeManifest: null,
    unsplash: null,
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'atx-schema-'));
  await mkdir(join(root, 'src/content/blog'), { recursive: true });
  await writeFile(join(root, 'src/content.config.ts'), CONFIG);
  await writeFile(join(root, 'src/content/blog/one.md'), '---\ntitle: One\n---\n');
  await writeFile(join(root, 'src/content/blog/two.md'), '---\ntitle: Two\n---\n');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function request(
  h: Connect.NextHandleFunction,
  url: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const payload = Buffer.from(JSON.stringify(body ?? {}));
  const req = Readable.from([payload]) as any;
  req.method = 'POST';
  req.url = url;
  req.headers = {};
  req.socket = { remoteAddress: '127.0.0.1' };
  return new Promise((resolve, reject) => {
    const res: any = {
      statusCode: 200,
      setHeader() {},
      end(raw: string) {
        resolve({ status: res.statusCode, body: JSON.parse(raw) });
      },
    };
    try {
      h(req, res, () => resolve({ status: -1, body: null }));
    } catch (err) {
      reject(err);
    }
  });
}

const etagOf = (source: string) => createHash('sha256').update(source, 'utf8').digest('hex');
const readConfig = () => readFile(join(root, 'src/content.config.ts'), 'utf8');

describe('POST /collections', () => {
  it('lists collections with fields, entry counts and the config etag', async () => {
    const h = await mount();
    const r = await request(h, '/__text-edit/collections');
    expect(r.status).toBe(200);
    expect(r.body.configPath).toBe('src/content.config.ts');
    expect(r.body.etag).toBe(etagOf(CONFIG));
    expect(r.body.schemaEditor).toBe(true);

    const [blog] = r.body.collections;
    expect(blog.name).toBe('blog');
    expect(blog.dirExists).toBe(true);
    expect(blog.entryCount).toBe(2);
    expect(blog.schemaForm).toBe('object');
    expect(blog.registered).toBe(true);
    expect(blog.fields.map((f: any) => f.name)).toEqual(['title', 'excerpt']);
    // The source expression is reported beside the derived field, so the panel
    // can show what it can't model.
    expect(blog.expressions).toEqual({ title: 'z.string()', excerpt: 'z.string()' });
  });

  it('reports schemaEditor: false without refusing the read', async () => {
    const h = await mount({ schemaEditor: false });
    const r = await request(h, '/__text-edit/collections');
    expect(r.status).toBe(200);
    expect(r.body.schemaEditor).toBe(false);
    expect(r.body.collections).toHaveLength(1);
  });

  it('refuses when the entry editor is off', async () => {
    const h = await mount({ entryEditor: false });
    const r = await request(h, '/__text-edit/collections');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('disabled');
  });

  it('answers with a null config when the project has none', async () => {
    const h = await mount({}, stubSchemaProvider());
    const r = await request(h, '/__text-edit/collections');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ configPath: null, etag: null, collections: [] });
  });

  it('marks a field whose override the config owns as locked', async () => {
    // The provider reports the *effective* override (config merged over store).
    // With no settings file, an effective override can only have come from the
    // config — so the panel must render that field's editor half read-only.
    const h = await mount(
      {},
      stubSchemaProvider({
        async listCollections() {
          return [
            {
              collection: 'blog',
              dir: 'src/content/blog',
              schema: blogSchema,
              fieldConfig: { excerpt: { widget: 'textarea' } },
            },
          ];
        },
        async configPath() {
          return 'src/content.config.ts';
        },
      }),
    );
    const r = await request(h, '/__text-edit/collections');
    expect(r.body.collections[0].lockedFields).toEqual(['excerpt']);
  });

  it('does not lock an override the panel itself stored', async () => {
    await writeFile(
      join(root, '.astro-text-edit.json'),
      JSON.stringify({
        options: {
          entryEditor: { collections: { blog: { fields: { excerpt: { widget: 'textarea' } } } } },
        },
      }),
    );
    const h = await mount(
      {},
      stubSchemaProvider({
        async listCollections() {
          return [
            {
              collection: 'blog',
              dir: 'src/content/blog',
              schema: blogSchema,
              fieldConfig: { excerpt: { widget: 'textarea' } },
            },
          ];
        },
        async configPath() {
          return 'src/content.config.ts';
        },
      }),
    );
    const r = await request(h, '/__text-edit/collections');
    expect(r.body.collections[0].lockedFields).toEqual([]);
  });

  it('marks a collection whose directory is missing', async () => {
    const h = await mount(
      {},
      stubSchemaProvider({
        async listCollections() {
          return [
            { collection: 'notes', dir: 'src/content/notes', schema: null, fieldConfig: {} },
          ];
        },
        async configPath() {
          return 'src/content.config.ts';
        },
      }),
    );
    const r = await request(h, '/__text-edit/collections');
    expect(r.body.collections[0]).toMatchObject({
      dirExists: false,
      entryCount: 0,
      // Not in the config source at all — the panel says so rather than showing
      // an empty field table as if the schema were empty.
      schemaForm: null,
      registered: false,
    });
    expect(r.body.collections[0].unrecognized).toMatch(/not declared/);
  });
});

describe('POST /collection/schema/apply', () => {
  it('adds a field, leaving every other byte alone', async () => {
    const h = await mount();
    const r = await request(h, '/__text-edit/collection/schema/apply', {
      collection: 'blog',
      etag: etagOf(CONFIG),
      schema: { add: [{ name: 'subtitle', type: 'text', required: false }] },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, schemaWritten: true, overridesWritten: false });

    const after = await readConfig();
    expect(after).toBe(CONFIG.replace('    excerpt: z.string(),\n', '    excerpt: z.string(),\n    subtitle: z.string().optional(),\n'));
    expect(r.body.etag).toBe(etagOf(after));
  });

  it('refuses a stale etag and writes nothing', async () => {
    const h = await mount();
    const r = await request(h, '/__text-edit/collection/schema/apply', {
      collection: 'blog',
      etag: 'stale',
      schema: { remove: ['excerpt'] },
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('conflict');
    expect(await readConfig()).toBe(CONFIG);
  });

  it('refuses a missing etag', async () => {
    const h = await mount();
    const r = await request(h, '/__text-edit/collection/schema/apply', {
      collection: 'blog',
      schema: { remove: ['excerpt'] },
    });
    expect(r.status).toBe(409);
    expect(await readConfig()).toBe(CONFIG);
  });

  it('refuses every schema edit when schemaEditor is off, touching no file', async () => {
    const h = await mount({ schemaEditor: false });
    const r = await request(h, '/__text-edit/collection/schema/apply', {
      collection: 'blog',
      etag: etagOf(CONFIG),
      schema: { add: [{ name: 'subtitle', type: 'text', required: false }] },
    });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('disabled');
    expect(await readConfig()).toBe(CONFIG);
  });

  it('is all-or-nothing: one bad edit in a batch writes none of them', async () => {
    const h = await mount();
    const r = await request(h, '/__text-edit/collection/schema/apply', {
      collection: 'blog',
      etag: etagOf(CONFIG),
      schema: {
        add: [
          { name: 'subtitle', type: 'text', required: false },
          // A plain object schema has no image() in scope.
          { name: 'hero', type: 'image', required: false },
        ],
      },
    });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('unsupported');
    expect(await readConfig()).toBe(CONFIG);
  });

  it('rejects a field name that is not an identifier', async () => {
    const h = await mount();
    const r = await request(h, '/__text-edit/collection/schema/apply', {
      collection: 'blog',
      etag: etagOf(CONFIG),
      schema: { add: [{ name: "x'); rm -rf /; ('", type: 'text', required: false }] },
    });
    expect(r.status).toBe(422);
    expect(await readConfig()).toBe(CONFIG);
  });

  it('rejects an unknown field type', async () => {
    const h = await mount();
    const r = await request(h, '/__text-edit/collection/schema/apply', {
      collection: 'blog',
      etag: etagOf(CONFIG),
      schema: { add: [{ name: 'x', type: 'colour', required: false }] },
    });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(/not a field type/);
  });

  it('applies removes, updates and adds in one write', async () => {
    const h = await mount();
    const r = await request(h, '/__text-edit/collection/schema/apply', {
      collection: 'blog',
      etag: etagOf(CONFIG),
      schema: {
        remove: ['excerpt'],
        update: [{ name: 'title', type: 'text', required: false }],
        add: [{ name: 'order', type: 'number', required: true }],
      },
    });
    expect(r.status).toBe(200);
    const after = await readConfig();
    expect(after).toContain('title: z.string().optional(),');
    expect(after).toContain('order: z.number(),');
    expect(after).not.toContain('excerpt:');
    // The comment that described the removed field stays, visible in git.
    expect(after).toContain('// Shown on the index page.');
  });

  it('writes editor overrides to the settings file, not to the config', async () => {
    const h = await mount();
    const r = await request(h, '/__text-edit/collection/schema/apply', {
      collection: 'blog',
      overrides: { excerpt: { widget: 'textarea' } },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, schemaWritten: false, overridesWritten: true });
    expect(await readConfig()).toBe(CONFIG);

    const stored = JSON.parse(await readFile(join(root, '.astro-text-edit.json'), 'utf8'));
    expect(stored.options.entryEditor.collections.blog.fields.excerpt).toEqual({
      widget: 'textarea',
    });
  });

  it('clears an override rather than storing a no-op', async () => {
    const h = await mount();
    await request(h, '/__text-edit/collection/schema/apply', {
      collection: 'blog',
      overrides: { excerpt: { widget: 'textarea', hidden: true } },
    });
    const r = await request(h, '/__text-edit/collection/schema/apply', {
      collection: 'blog',
      overrides: { excerpt: null },
    });
    expect(r.body.overridesWritten).toBe(true);
    const stored = JSON.parse(await readFile(join(root, '.astro-text-edit.json'), 'utf8'));
    expect(stored.options.entryEditor?.collections?.blog).toBeUndefined();
  });

  it('rejects an unknown widget', async () => {
    const h = await mount();
    const r = await request(h, '/__text-edit/collection/schema/apply', {
      collection: 'blog',
      overrides: { excerpt: { widget: 'colour' } },
    });
    expect(r.status).toBe(422);
    expect(existsSync(join(root, '.astro-text-edit.json'))).toBe(false);
  });

  it('saves overrides while schemaEditor is off', async () => {
    const h = await mount({ schemaEditor: false });
    const r = await request(h, '/__text-edit/collection/schema/apply', {
      collection: 'blog',
      overrides: { excerpt: { widget: 'textarea' } },
    });
    expect(r.status).toBe(200);
    expect(r.body.overridesWritten).toBe(true);
  });

  it('refuses an empty request', async () => {
    const h = await mount();
    const r = await request(h, '/__text-edit/collection/schema/apply', { collection: 'blog' });
    expect(r.status).toBe(400);
  });
});

describe('POST /collection/entries', () => {
  it('lists entries newest first, with titles and draft flags', async () => {
    await writeFile(
      join(root, 'src/content/blog/three.md'),
      '---\ntitle: Three\ndraft: true\n---\nBody.\n',
    );
    const h = await mount(
      {},
      stubSchemaProvider({
        async forCollection() {
          return { collection: 'blog', dir: 'src/content/blog', schema: blogSchema, fieldConfig: {} };
        },
      }),
    );
    const r = await request(h, '/__text-edit/collection/entries', { collection: 'blog' });
    expect(r.status).toBe(200);
    expect(r.body.dir).toBe('src/content/blog');
    const byFile = Object.fromEntries(r.body.entries.map((e: any) => [e.slug, e]));
    expect(Object.keys(byFile).sort()).toEqual(['one', 'three', 'two']);
    expect(byFile.three).toMatchObject({
      file: 'src/content/blog/three.md',
      title: 'Three',
      draft: true,
    });
    // Newest first — the file written last leads.
    expect(r.body.entries[0].slug).toBe('three');
  });

  it('answers empty for a directory that does not exist', async () => {
    const h = await mount();
    const r = await request(h, '/__text-edit/collection/entries', { collection: 'ghosts' });
    expect(r.status).toBe(200);
    expect(r.body.entries).toEqual([]);
  });

  it('refuses a collection directory outside the content roots', async () => {
    const h = await mount(
      { contentRoots: ['src'] },
      stubSchemaProvider({
        async forCollection() {
          return { collection: 'x', dir: 'public/x', schema: null, fieldConfig: {} };
        },
      }),
    );
    const r = await request(h, '/__text-edit/collection/entries', { collection: 'x' });
    expect(r.status).toBe(422);
  });

  it('refuses when the entry editor is off', async () => {
    const h = await mount({ entryEditor: false });
    const r = await request(h, '/__text-edit/collection/entries', { collection: 'blog' });
    expect(r.status).toBe(403);
  });

  it('honours editableExtensions', async () => {
    await writeFile(join(root, 'src/content/blog/mdx-one.mdx'), '---\ntitle: MDX\n---\n');
    const h = await mount(
      { editableExtensions: ['.astro', '.md'] },
      stubSchemaProvider({
        async forCollection() {
          return { collection: 'blog', dir: 'src/content/blog', schema: null, fieldConfig: {} };
        },
      }),
    );
    const r = await request(h, '/__text-edit/collection/entries', { collection: 'blog' });
    expect(r.body.entries.map((e: any) => e.slug).sort()).toEqual(['one', 'two']);
  });
});

describe('POST /collection/open', () => {
  it('refuses when open-in-editor is off, without naming a path', async () => {
    const h = await mount({ openInEditor: false });
    const r = await request(h, '/__text-edit/collection/open', { collection: 'blog' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('disabled');
  });
});

describe('POST /collection/create', () => {
  it('appends a block, registers the name and makes the directory', async () => {
    const h = await mount();
    const r = await request(h, '/__text-edit/collection/create', {
      name: 'notes',
      etag: etagOf(CONFIG),
      fields: [{ name: 'title', type: 'text', required: true }],
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: 'notes', dir: 'src/content/notes' });

    const after = await readConfig();
    expect(after).toContain("base: './src/content/notes'");
    expect(after).toContain('export const collections = { blog, notes };');
    expect(existsSync(join(root, 'src/content/notes'))).toBe(true);
  });

  it('refuses a directory outside the content roots, creating nothing', async () => {
    const h = await mount({ contentRoots: ['src'] });
    const r = await request(h, '/__text-edit/collection/create', {
      name: 'notes',
      dir: 'public/notes',
      etag: etagOf(CONFIG),
      fields: [],
    });
    expect(r.status).toBe(422);
    expect(await readConfig()).toBe(CONFIG);
    expect(existsSync(join(root, 'public/notes'))).toBe(false);
  });

  it('refuses a traversing directory', async () => {
    const h = await mount();
    const r = await request(h, '/__text-edit/collection/create', {
      name: 'notes',
      dir: 'src/content/../../../escape',
      etag: etagOf(CONFIG),
      fields: [],
    });
    expect(r.status).toBe(422);
    expect(await readConfig()).toBe(CONFIG);
  });

  it('refuses a glob pattern carrying a quote', async () => {
    const h = await mount();
    const r = await request(h, '/__text-edit/collection/create', {
      name: 'notes',
      pattern: "**/*.md', evil: '",
      etag: etagOf(CONFIG),
      fields: [],
    });
    expect(r.status).toBe(422);
    expect(await readConfig()).toBe(CONFIG);
  });

  it('refuses a duplicate collection', async () => {
    const h = await mount();
    const r = await request(h, '/__text-edit/collection/create', {
      name: 'blog',
      etag: etagOf(CONFIG),
      fields: [],
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('exists');
  });

  it('refuses when schemaEditor is off', async () => {
    const h = await mount({ schemaEditor: false });
    const r = await request(h, '/__text-edit/collection/create', {
      name: 'notes',
      etag: etagOf(CONFIG),
      fields: [],
    });
    expect(r.status).toBe(403);
    expect(existsSync(join(root, 'src/content/notes'))).toBe(false);
  });

  it('uses the function schema form when a field needs image()', async () => {
    const h = await mount();
    const r = await request(h, '/__text-edit/collection/create', {
      name: 'gallery',
      etag: etagOf(CONFIG),
      fields: [{ name: 'cover', type: 'image', required: true }],
    });
    expect(r.status).toBe(200);
    expect(await readConfig()).toContain('schema: ({ image }) =>');
  });
});
