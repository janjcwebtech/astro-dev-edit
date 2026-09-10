import type { AstroIntegrationLogger } from 'astro';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Connect } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EntryCollectionInfo } from '../src/server/content-config.ts';
import { collectionsNamedIn } from '../src/server/entry-detect.ts';
import { createMiddleware } from '../src/server/middleware.ts';
import type { DevEditOptions } from '../src/server/options.ts';
import { createRouteManifest, type ResolvedRouteLike } from '../src/server/route-manifest.ts';
import { stubOptions, stubSchemaProvider } from './helpers.ts';

/**
 * `POST /entry/resolve` — "which content entry backs this URL?", the answer
 * that replaces hand-emitting the page-source meta tag.
 *
 * What this suite is really pinning is the **shape of its refusals**, because
 * the failure mode that matters is not "no answer" but "a confident wrong
 * answer": a dynamic pattern matches far more paths than it generates, so a
 * dead URL must come back `no-entry` rather than as some other entry's file.
 * That is issue #8's shape, one layer further down.
 *
 * The three layers are exercised separately and together — the route manifest,
 * the `getCollection('x')` scan that binds route to collection, and the id
 * match. Deliberately **not** covered here: the manifest's own matching rules
 * (`page-source.test.ts` owns those) and the entry drawer the resolved file is
 * handed to (`middleware-entry.test.ts` owns that).
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

const page = (
  pattern: string,
  patternRegex: RegExp,
  entrypoint: string,
  type = 'page',
): ResolvedRouteLike => ({ pattern, patternRegex, entrypoint, type });

const ROUTES: ResolvedRouteLike[] = [
  page('/', /^\/$/, 'src/pages/index.astro'),
  page('/articles', /^\/articles\/?$/, 'src/pages/articles/index.astro'),
  page('/articles/[...slug]', /^\/articles(?:\/(.*?))?\/?$/, 'src/pages/articles/[...slug].astro'),
  page('/works/[...slug]', /^\/works(?:\/(.*?))?\/?$/, 'src/pages/works/[...slug].astro'),
];

/** A collection as the provider reports it. `pageEditing` defaults **off**,
 *  which is the whole point of the switch: nothing resolves until asked. */
function collection(
  name: string,
  over: Partial<EntryCollectionInfo> = {},
): EntryCollectionInfo {
  return {
    collection: name,
    dir: `src/content/${name}`,
    schema: null,
    pageEditing: false,
    fieldConfig: {},
    ...over,
  };
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'atx-entry-resolve-'));
  await mkdir(join(root, 'src/pages/articles'), { recursive: true });
  await mkdir(join(root, 'src/pages/works'), { recursive: true });
  await mkdir(join(root, 'src/content/blog'), { recursive: true });
  await mkdir(join(root, 'src/content/works'), { recursive: true });
  await writeFile(join(root, 'src/pages/index.astro'), '<p>home</p>\n');
  await writeFile(join(root, 'src/pages/articles/index.astro'), '<p>list</p>\n');
  await writeFile(
    join(root, 'src/pages/articles/[...slug].astro'),
    "---\nimport { getCollection } from 'astro:content';\nconst posts = await getCollection('blog');\n---\n<p>x</p>\n",
  );
  await writeFile(
    join(root, 'src/pages/works/[...slug].astro'),
    "---\nconst items = await getCollection('works');\n---\n<p>x</p>\n",
  );
  await writeFile(join(root, 'src/content/blog/a-tour.md'), '---\ntitle: A tour\n---\nbody\n');
  await writeFile(join(root, 'src/content/blog/hello.md'), '---\ntitle: Hello\n---\nbody\n');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

interface MountOptions {
  collections?: EntryCollectionInfo[];
  routes?: readonly ResolvedRouteLike[] | null;
  options?: DevEditOptions;
}

function mount(o: MountOptions = {}): Connect.NextHandleFunction {
  const routes = o.routes === undefined ? ROUTES : o.routes;
  return createMiddleware({
    logger,
    root,
    optionsResolver: stubOptions(root, o.options ?? {}),
    schemaProvider: stubSchemaProvider({
      async listCollections() {
        return o.collections ?? [];
      },
    }),
    routeManifest:
      routes === null ? null : createRouteManifest({ root, base: '/', routes: () => routes }),
    unsplash: null,
  });
}

function request(
  h: Connect.NextHandleFunction,
  body: unknown,
  path = '/entry/resolve',
): Promise<{ status: number; body: any }> {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]) as any;
  req.method = 'POST';
  req.url = `/__dev-edit${path}`;
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

const resolveAt = (h: Connect.NextHandleFunction, pathname: string) => request(h, { pathname });

describe('collectionsNamedIn', () => {
  it('reads both call shapes and either quote', () => {
    expect(collectionsNamedIn("await getCollection('blog')")).toEqual(['blog']);
    expect(collectionsNamedIn('await getEntry("authors", id)')).toEqual(['authors']);
    expect(collectionsNamedIn('getCollection ( "blog" )')).toEqual(['blog']);
  });

  it('reports each name once, in first-seen order', () => {
    const src = "getCollection('works');getCollection('blog');getEntry('works')";
    expect(collectionsNamedIn(src)).toEqual(['works', 'blog']);
  });

  it('reports nothing for a name it cannot prove', () => {
    // A variable is exactly the case the caller must fall back on rather than
    // guess at — reporting `name` here would bind the route to a collection
    // that does not exist.
    expect(collectionsNamedIn('await getCollection(name)')).toEqual([]);
    expect(collectionsNamedIn('await fetchPosts()')).toEqual([]);
  });
});

describe('POST /entry/resolve', () => {
  it('resolves a detail URL to its entry once the collection is switched on', async () => {
    const h = mount({ collections: [collection('blog', { pageEditing: true })] });
    const r = await resolveAt(h, '/articles/a-tour');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      file: 'src/content/blog/a-tour.md',
      collection: 'blog',
      entryFile: 'src/content/blog/a-tour.md',
      pageEditingLocked: false,
      pattern: '/articles/[...slug]',
      refusal: null,
    });
  });

  it('matches with a trailing slash the same way', async () => {
    const h = mount({ collections: [collection('blog', { pageEditing: true })] });
    expect((await resolveAt(h, '/articles/a-tour/')).body.file).toBe(
      'src/content/blog/a-tour.md',
    );
  });

  it('refuses not-enabled, naming the collection and the file it would open', async () => {
    // The refusal the notice's "Turn on for blog" offer is built from: the tool
    // knows exactly which entry backs the page and only lacks permission.
    const h = mount({ collections: [collection('blog')] });
    const r = await resolveAt(h, '/articles/a-tour');
    expect(r.body).toMatchObject({
      file: null,
      collection: 'blog',
      entryFile: 'src/content/blog/a-tour.md',
      pageEditingLocked: false,
      refusal: 'not-enabled',
    });
  });

  it('reports the switch as locked when astro.config.mjs owns it', async () => {
    const h = mount({
      collections: [collection('blog')],
      options: { entryEditor: { collections: { blog: { pageEditing: false } } } },
    });
    const r = await resolveAt(h, '/articles/a-tour');
    expect(r.body).toMatchObject({ refusal: 'not-enabled', pageEditingLocked: true });
  });

  it('refuses no-entry for a URL a dynamic pattern matched but nothing wrote', async () => {
    // Issue #8's shape, one layer down: `/articles/[...slug]` matches any path
    // under /articles, and a 404 must not come back as some other entry.
    const h = mount({ collections: [collection('blog', { pageEditing: true })] });
    const r = await resolveAt(h, '/articles/not-real');
    expect(r.body).toMatchObject({ file: null, refusal: 'no-entry' });
  });

  it('refuses not-detail on a static route, which renders a set', async () => {
    const h = mount({ collections: [collection('blog', { pageEditing: true })] });
    expect((await resolveAt(h, '/articles')).body).toMatchObject({
      refusal: 'not-detail',
      pattern: '/articles',
    });
    expect((await resolveAt(h, '/')).body).toMatchObject({ refusal: 'not-detail' });
  });

  it('refuses no-routes when the routes hook never fired', async () => {
    const h = mount({ collections: [collection('blog', { pageEditing: true })], routes: null });
    expect((await resolveAt(h, '/articles/a-tour')).body).toMatchObject({ refusal: 'no-routes' });
    const empty = mount({ collections: [collection('blog', { pageEditing: true })], routes: [] });
    expect((await resolveAt(empty, '/articles/a-tour')).body).toMatchObject({
      refusal: 'no-routes',
    });
  });

  it('refuses no-match for a pathname no route serves', async () => {
    const h = mount({ collections: [collection('blog', { pageEditing: true })] });
    expect((await resolveAt(h, '/nowhere/at/all')).body).toMatchObject({ refusal: 'no-match' });
  });

  it('lets the page’s own getCollection() choose between collections holding the same id', async () => {
    await writeFile(join(root, 'src/content/works/a-tour.md'), '---\ntitle: dup\n---\n');
    const h = mount({
      collections: [
        collection('blog', { pageEditing: true }),
        collection('works', { pageEditing: true }),
      ],
    });
    // Both directories hold a-tour.md; only the articles route names `blog`.
    expect((await resolveAt(h, '/articles/a-tour')).body).toMatchObject({
      collection: 'blog',
      file: 'src/content/blog/a-tour.md',
    });
    // …and the works route names `works`, from the same ambiguous id.
    await writeFile(join(root, 'src/content/works/only-here.md'), '---\ntitle: w\n---\n');
    expect((await resolveAt(h, '/works/a-tour')).body).toMatchObject({
      collection: 'works',
      file: 'src/content/works/a-tour.md',
    });
  });

  it('refuses ambiguous when nothing chooses between two equal ids', async () => {
    // The route fetches through a helper, so it names no collection and every
    // switched-on collection stays a candidate. Two hold `a-tour`.
    await writeFile(
      join(root, 'src/pages/articles/[...slug].astro'),
      '---\nconst posts = await loadPosts();\n---\n<p>x</p>\n',
    );
    await writeFile(join(root, 'src/content/works/a-tour.md'), '---\ntitle: dup\n---\n');
    const h = mount({
      collections: [
        collection('blog', { pageEditing: true }),
        collection('works', { pageEditing: true }),
      ],
    });
    expect((await resolveAt(h, '/articles/a-tour')).body).toMatchObject({
      file: null,
      refusal: 'ambiguous',
    });
  });

  it('still resolves through a helper-fetching route when only one collection matches', async () => {
    await writeFile(
      join(root, 'src/pages/articles/[...slug].astro'),
      '---\nconst posts = await loadPosts();\n---\n<p>x</p>\n',
    );
    const h = mount({
      collections: [
        collection('blog', { pageEditing: true }),
        collection('works', { pageEditing: true }),
      ],
    });
    expect((await resolveAt(h, '/articles/hello')).body).toMatchObject({
      collection: 'blog',
      file: 'src/content/blog/hello.md',
    });
  });

  it('matches a nested id, and the longest id wins the tail it shares', async () => {
    await mkdir(join(root, 'src/content/blog/2026'), { recursive: true });
    await writeFile(join(root, 'src/content/blog/2026/hello.md'), '---\ntitle: n\n---\n');
    const h = mount({ collections: [collection('blog', { pageEditing: true })] });
    // Both `hello` and `2026/hello` end the same way; the specific one wins.
    expect((await resolveAt(h, '/articles/2026/hello')).body).toMatchObject({
      file: 'src/content/blog/2026/hello.md',
    });
    expect((await resolveAt(h, '/articles/hello')).body).toMatchObject({
      file: 'src/content/blog/hello.md',
    });
  });

  it('skips a collection whose directory is outside the content roots', async () => {
    const h = mount({
      collections: [collection('blog', { dir: 'elsewhere/blog', pageEditing: true })],
      options: { contentRoots: ['src'] },
    });
    expect((await resolveAt(h, '/articles/a-tour')).body).toMatchObject({ refusal: 'no-entry' });
  });

  it('only counts files the editable extensions allow', async () => {
    const h = mount({
      collections: [collection('blog', { pageEditing: true })],
      options: { editableExtensions: ['.astro', '.mdx'] },
    });
    expect((await resolveAt(h, '/articles/a-tour')).body).toMatchObject({ refusal: 'no-entry' });
  });

  it('answers disabled, not 404, when the entry editor is off', async () => {
    const h = mount({
      collections: [collection('blog', { pageEditing: true })],
      options: { entryEditor: false },
    });
    const r = await resolveAt(h, '/articles/a-tour');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ file: null, refusal: 'disabled' });
  });

  it('rejects a request with no pathname', async () => {
    const r = await request(mount(), {});
    expect(r.status).toBe(400);
  });
});
