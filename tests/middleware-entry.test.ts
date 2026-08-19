import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { AstroIntegrationLogger } from 'astro';
import type { Connect } from 'vite';
import { z } from 'zod';
import type { EntrySchemaProvider } from '../src/server/content-config.ts';
import { createMiddleware } from '../src/server/middleware.ts';
import type { TextEditOptions } from '../src/server/options.ts';
import { stubOptions } from './helpers.ts';

/**
 * Endpoint tests for the entry editor (/entry, /entry/apply, /entry/create,
 * /entry/delete) against a scaffolded temp project and a STUBBED schema
 * provider — no Vite, no Astro. The provider stub is why the middleware takes
 * it as an injected dependency.
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

const blogSchema = z.object({
  title: z.string(),
  excerpt: z.string(),
  date: z.coerce.date(),
  author: z.string().default('Alex Sand'),
  category: z.string().default('Article'),
  image: z.string(),
});

const ENTRY = `---
title: Hello world
excerpt: A first post.
date: 2026-06-11
# keep author in sync
author: Alex Sand
category: Security
image: /images/hello.webp
---

Intro paragraph.

## Heading

Body text.
`;

let root: string;
let handler: Connect.NextHandleFunction;
const entryRel = 'src/content/blog/hello-world.md';

const provider: EntrySchemaProvider = {
  async forFile(rel) {
    if (!rel.startsWith('src/content/blog/')) return null;
    return {
      collection: 'blog',
      dir: 'src/content/blog',
      schema: blogSchema,
      fieldConfig: { excerpt: { widget: 'textarea' }, image: { widget: 'image' } },
    };
  },
  async forCollection(name) {
    if (name !== 'blog') return null;
    return {
      collection: 'blog',
      dir: 'src/content/blog',
      schema: blogSchema,
      fieldConfig: {},
    };
  },
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'atx-entry-test-'));
  await mkdir(join(root, 'src/content/blog'), { recursive: true });
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await writeFile(join(root, 'src/pages/index.astro'), '<p>hi</p>\n');
  await writeFile(join(root, 'src/content/loose.md'), '---\ntitle: Loose\nviews: 3\n---\nBody.\n');

  handler = createMiddleware({
    logger,
    root,
    optionsResolver: stubOptions(root, { assetDirs: ['public'], openInEditor: false }),
    schemaProvider: provider,
    unsplash: null,
  });
});

beforeEach(async () => {
  await writeFile(join(root, entryRel), ENTRY);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function request(
  opts: { url: string; body?: unknown },
  h: Connect.NextHandleFunction = handler,
): Promise<{ status: number; body: any }> {
  const payload = Buffer.from(JSON.stringify(opts.body ?? {}));
  const req = Readable.from([payload]) as any;
  req.method = 'POST';
  req.url = opts.url;
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

describe('POST /entry', () => {
  it('returns schema fields, values, body, and a matching etag', async () => {
    const r = await request({ url: '/__text-edit/entry', body: { file: entryRel } });
    expect(r.status).toBe(200);
    expect(r.body.collection).toBe('blog');
    expect(r.body.etag).toBe(etagOf(ENTRY));
    expect(r.body.values.title).toBe('Hello world');
    expect(r.body.body.startsWith('Intro paragraph.')).toBe(true);
    expect(r.body.bodyEditable).toBe(true);

    const names = r.body.fields.map((f: any) => f.name);
    expect(names).toEqual(['title', 'excerpt', 'date', 'author', 'category', 'image']);
    const byName = (n: string) => r.body.fields.find((f: any) => f.name === n);
    expect(byName('title')).toMatchObject({ type: 'text', required: true, present: true, source: 'schema' });
    // config overrides applied
    expect(byName('excerpt').type).toBe('textarea');
    expect(byName('image').type).toBe('image');
    expect(byName('author')).toMatchObject({ required: false, defaultValue: 'Alex Sand' });
  });

  it('falls back to inferred fields when no collection matches', async () => {
    const r = await request({ url: '/__text-edit/entry', body: { file: 'src/content/loose.md' } });
    expect(r.status).toBe(200);
    expect(r.body.collection).toBeNull();
    const byName = (n: string) => r.body.fields.find((f: any) => f.name === n);
    expect(byName('title')).toMatchObject({ type: 'text', source: 'inferred' });
    expect(byName('views').type).toBe('number');
  });

  it('rejects non-markdown and out-of-root paths', async () => {
    const astro = await request({ url: '/__text-edit/entry', body: { file: 'src/pages/index.astro' } });
    expect(astro.status).toBe(400);
    const escape = await request({ url: '/__text-edit/entry', body: { file: '../outside.md' } });
    expect(escape.status).toBe(400);
  });
});

describe('POST /entry/apply', () => {
  it('applies frontmatter + body changes atomically, preserving comments', async () => {
    const r = await request({
      url: '/__text-edit/entry/apply',
      body: {
        file: entryRel,
        etag: etagOf(ENTRY),
        changes: { frontmatter: { title: 'Updated title' }, body: 'New body.\n' },
      },
    });
    expect(r.status).toBe(200);
    const written = await readFile(join(root, entryRel), 'utf8');
    expect(written).toContain('title: Updated title');
    expect(written).toContain('# keep author in sync');
    expect(written).toContain('excerpt: A first post.');
    expect(written.endsWith('---\n\nNew body.\n')).toBe(true);
  });

  it('409s on a stale etag without touching the file', async () => {
    const r = await request({
      url: '/__text-edit/entry/apply',
      body: { file: entryRel, etag: 'stale', changes: { frontmatter: { title: 'X' } } },
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('conflict');
    expect(await readFile(join(root, entryRel), 'utf8')).toBe(ENTRY);
  });

  it('422s with fieldErrors on schema violations, file untouched', async () => {
    const r = await request({
      url: '/__text-edit/entry/apply',
      body: {
        file: entryRel,
        etag: etagOf(ENTRY),
        changes: { frontmatter: { title: 42, date: 'not-a-date' } },
      },
    });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('validation');
    expect(r.body.fieldErrors.title).toBeTruthy();
    expect(r.body.fieldErrors.date).toBeTruthy();
    expect(await readFile(join(root, entryRel), 'utf8')).toBe(ENTRY);
  });

  it('accepts a valid date string against z.coerce.date()', async () => {
    const r = await request({
      url: '/__text-edit/entry/apply',
      body: {
        file: entryRel,
        etag: etagOf(ENTRY),
        changes: { frontmatter: { date: '2026-07-18' } },
      },
    });
    expect(r.status).toBe(200);
    expect(await readFile(join(root, entryRel), 'utf8')).toContain('date: 2026-07-18');
  });
});

describe('POST /entry/create', () => {
  it('creates a new entry with valid frontmatter', async () => {
    const r = await request({
      url: '/__text-edit/entry/create',
      body: {
        collection: 'blog',
        slug: 'Fresh Post!',
        frontmatter: {
          title: 'Fresh post',
          excerpt: 'Brand new.',
          date: '2026-07-18',
          image: '/images/fresh.webp',
        },
        body: '# Fresh\n',
      },
    });
    expect(r.status).toBe(200);
    expect(r.body.file).toBe('src/content/blog/fresh-post.md');
    const written = await readFile(join(root, r.body.file), 'utf8');
    expect(written).toContain('title: Fresh post');
    expect(written).toContain('# Fresh');
  });

  it('409s when the slug already exists', async () => {
    const r = await request({
      url: '/__text-edit/entry/create',
      body: {
        collection: 'blog',
        slug: 'hello-world',
        frontmatter: { title: 'Dup', excerpt: 'x', date: '2026-01-01', image: '/i.png' },
        body: '',
      },
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('exists');
  });

  it('422s when required fields are missing', async () => {
    const r = await request({
      url: '/__text-edit/entry/create',
      body: { collection: 'blog', slug: 'incomplete', frontmatter: { title: 'Only title' }, body: '' },
    });
    expect(r.status).toBe(422);
    expect(r.body.fieldErrors.excerpt).toBe('required');
    expect(r.body.fieldErrors.image).toBe('required');
    // defaulted fields are NOT required
    expect(r.body.fieldErrors.author).toBeUndefined();
    expect(existsSync(join(root, 'src/content/blog/incomplete.md'))).toBe(false);
  });

  it('rejects unknown collections and empty slugs', async () => {
    const unknown = await request({
      url: '/__text-edit/entry/create',
      body: { collection: 'nope', slug: 'a', frontmatter: {}, body: '' },
    });
    expect(unknown.status).toBe(422);
    const empty = await request({
      url: '/__text-edit/entry/create',
      body: { collection: 'blog', slug: '///', frontmatter: {}, body: '' },
    });
    expect(empty.status).toBe(400);
  });
});

describe('POST /entry/create — extension choice', () => {
  let extRoot: string;
  let extHandler: Connect.NextHandleFunction;

  // Schemaless collections: 'docs' is all-.mdx (with a nested subdir), 'mixed'
  // holds both extensions, 'notes' is empty but configured extension: '.mdx'.
  const extProvider: EntrySchemaProvider = {
    async forFile() {
      return null;
    },
    async forCollection(name) {
      if (name === 'docs') {
        return { collection: 'docs', dir: 'src/content/docs', schema: null, fieldConfig: {} };
      }
      if (name === 'notes') {
        return {
          collection: 'notes',
          dir: 'src/content/notes',
          schema: null,
          extension: '.mdx',
          fieldConfig: {},
        };
      }
      if (name === 'mixed') {
        return { collection: 'mixed', dir: 'src/content/mixed', schema: null, fieldConfig: {} };
      }
      return null;
    },
  };

  const deps = (options: TextEditOptions = {}) => ({
    logger,
    root: extRoot,
    optionsResolver: stubOptions(extRoot, {
      assetDirs: ['public'],
      openInEditor: false,
      ...options,
    }),
    schemaProvider: extProvider,
    unsplash: null,
  });

  beforeAll(async () => {
    extRoot = await mkdtemp(join(tmpdir(), 'atx-entry-ext-test-'));
    await mkdir(join(extRoot, 'src/content/docs/guides'), { recursive: true });
    await mkdir(join(extRoot, 'src/content/notes'), { recursive: true });
    await mkdir(join(extRoot, 'src/content/mixed'), { recursive: true });
    await writeFile(join(extRoot, 'src/content/docs/a.mdx'), '---\ntitle: A\n---\n');
    await writeFile(join(extRoot, 'src/content/docs/guides/b.mdx'), '---\ntitle: B\n---\n');
    await writeFile(join(extRoot, 'src/content/mixed/a.md'), '---\ntitle: A\n---\n');
    await writeFile(join(extRoot, 'src/content/mixed/b.mdx'), '---\ntitle: B\n---\n');
    extHandler = createMiddleware(deps());
  });

  afterAll(async () => {
    await rm(extRoot, { recursive: true, force: true });
  });

  const create = (collection: string, slug: string, h?: Connect.NextHandleFunction) =>
    request(
      {
        url: '/__text-edit/entry/create',
        body: { collection, slug, frontmatter: { title: 'New' }, body: '' },
      },
      h ?? extHandler,
    );

  it('infers .mdx when every existing entry (nested included) is .mdx', async () => {
    const r = await create('docs', 'inferred');
    expect(r.status).toBe(200);
    expect(r.body.file).toBe('src/content/docs/inferred.mdx');
  });

  it('uses the configured extension even for an empty collection', async () => {
    const r = await create('notes', 'configured');
    expect(r.status).toBe(200);
    expect(r.body.file).toBe('src/content/notes/configured.mdx');
  });

  it('falls back to .md when the collection mixes extensions', async () => {
    const r = await create('mixed', 'fallback');
    expect(r.status).toBe(200);
    expect(r.body.file).toBe('src/content/mixed/fallback.md');
  });

  it('422s when the chosen extension is not editable by configuration', async () => {
    const noMdx = createMiddleware(deps({ editableExtensions: ['.astro', '.md'] }));
    const r = await create('notes', 'blocked', noMdx);
    expect(r.status).toBe(422);
    expect(r.body.error).toContain('.mdx');
    expect(existsSync(join(extRoot, 'src/content/notes/blocked.md'))).toBe(false);
    expect(existsSync(join(extRoot, 'src/content/notes/blocked.mdx'))).toBe(false);
  });
});

describe('POST /entry/delete', () => {
  it('deletes with a fresh etag', async () => {
    const r = await request({
      url: '/__text-edit/entry/delete',
      body: { file: entryRel, etag: etagOf(ENTRY) },
    });
    expect(r.status).toBe(200);
    expect(existsSync(join(root, entryRel))).toBe(false);
  });

  it('409s on a stale etag and keeps the file', async () => {
    const r = await request({
      url: '/__text-edit/entry/delete',
      body: { file: entryRel, etag: 'stale' },
    });
    expect(r.status).toBe(409);
    expect(existsSync(join(root, entryRel))).toBe(true);
  });
});

describe('disabled entry editor', () => {
  it('rejects every /entry* endpoint', async () => {
    const off = createMiddleware({
      logger,
      root,
      optionsResolver: stubOptions(root, { entryEditor: false }),
      schemaProvider: null,
      unsplash: null,
    });
    const r = await new Promise<{ status: number }>((resolve) => {
      const payload = Buffer.from(JSON.stringify({ file: entryRel }));
      const req = Readable.from([payload]) as any;
      req.method = 'POST';
      req.url = '/__text-edit/entry';
      req.headers = {};
      req.socket = { remoteAddress: '127.0.0.1' };
      const res: any = {
        statusCode: 200,
        setHeader() {},
        end() {
          resolve({ status: res.statusCode });
        },
      };
      off(req, res, () => resolve({ status: -1 }));
    });
    expect(r.status).toBe(400);
  });
});
