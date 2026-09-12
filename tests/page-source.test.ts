import type { AstroIntegrationLogger } from 'astro';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Connect } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMiddleware } from '../src/server/middleware.ts';
import type { DevEditOptions } from '../src/server/options.ts';
import { createRouteManifest, type ResolvedRouteLike } from '../src/server/route-manifest.ts';
import { stubOptions } from './helpers.ts';

/**
 * "Which file is this page written in?" — the route manifest lookup behind the
 * admin bar's *Open page source*.
 *
 * The regexes in these fixtures are the shapes Astro's own
 * `dist/core/routing/pattern.js` builds, and they are the drift risk in this
 * suite: `getPattern` encodes `trailingSlash` into the pattern itself
 * (`\/$` / `$` / `\/?$`) and matches a **base-stripped** pathname. If those
 * rules ever change upstream, these fixtures are what has to move — the same
 * way `annotate.ts`'s locs must stay in step with the patcher's.
 *
 * The bug being pinned: the old implementation opened whichever source file
 * rendered the most annotated elements, so a markup-dense `Nav.astro` beat a
 * page that mostly composes components (component tags are never annotated).
 * The route manifest replaces that guess, and a miss now refuses instead of
 * guessing again.
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

/** In Astro's priority order, as the hook delivers them (sorted before firing). */
const ROUTES: ResolvedRouteLike[] = [
  page('/', /^\/$/, 'src/pages/index.astro'),
  page('/about', /^\/about\/?$/, 'src/pages/about.astro'),
  page('/404', /^\/404\/?$/, 'src/pages/404.astro'),
  page('/articles', /^\/articles\/?$/, 'src/pages/articles/index.astro'),
  page('/blog/[slug]', /^\/blog\/([^/]+?)\/?$/, 'src/pages/blog/[slug].astro'),
  page('/articles/[...slug]', /^\/articles(?:\/(.*?))?\/?$/, 'src/pages/articles/[...slug].astro'),
];

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'atx-page-source-'));
  await mkdir(join(root, 'src/pages/blog'), { recursive: true });
  await mkdir(join(root, 'src/pages/articles'), { recursive: true });
  await mkdir(join(root, 'src/components'), { recursive: true });
  for (const f of [
    'src/pages/index.astro',
    'src/pages/about.astro',
    'src/pages/404.astro',
    'src/pages/articles/index.astro',
    'src/pages/articles/[...slug].astro',
    'src/pages/blog/[slug].astro',
    'src/components/Nav.astro',
  ]) {
    await writeFile(join(root, f), '<p>x</p>\n');
  }
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function manifest(routes: readonly ResolvedRouteLike[] = ROUTES, base = '/') {
  return createRouteManifest({ root, base, routes: () => routes });
}

describe('createRouteManifest().dynamicPages', () => {
  // The reverse direction: not "which page serves this URL" but "which pages
  // render one of a set", which is the only kind worth scanning for a
  // getCollection() call. Static pages are left out because a listing route has
  // no single backing entry to find.
  it('lists dynamic page routes only, with their patterns', () => {
    expect(manifest().dynamicPages()).toEqual([
      { pattern: '/blog/[slug]', file: 'src/pages/blog/[slug].astro' },
      { pattern: '/articles/[...slug]', file: 'src/pages/articles/[...slug].astro' },
    ]);
  });

  it('skips endpoints, and entrypoints that are not files in this project', () => {
    const routes = [
      page('/api/[id]', /^\/api\/([^/]+?)$/, 'src/pages/api/[id].ts', 'endpoint'),
      page('/gone/[id]', /^\/gone\/([^/]+?)$/, 'src/pages/gone/[id].astro'),
      page('/ok/[id]', /^\/ok\/([^/]+?)$/, 'src/pages/blog/[slug].astro'),
    ];
    // /gone's entrypoint was never written to the temp root.
    expect(manifest(routes).dynamicPages()).toEqual([
      { pattern: '/ok/[id]', file: 'src/pages/blog/[slug].astro' },
    ]);
  });

  it('is empty before the routes hook has fired', () => {
    expect(manifest([]).dynamicPages()).toEqual([]);
  });
});

describe('createRouteManifest().forPathname', () => {
  it('resolves static routes, with or without the trailing slash', () => {
    expect(manifest().forPathname('/')).toEqual({
      ok: true,
      file: 'src/pages/index.astro',
      pattern: '/',
    });
    expect(manifest().forPathname('/about/')).toMatchObject({
      ok: true,
      file: 'src/pages/about.astro',
    });
    expect(manifest().forPathname('/about')).toMatchObject({
      ok: true,
      file: 'src/pages/about.astro',
    });
  });

  it('resolves dynamic and rest routes', () => {
    expect(manifest().forPathname('/blog/hello/')).toMatchObject({
      ok: true,
      file: 'src/pages/blog/[slug].astro',
      pattern: '/blog/[slug]',
    });
    expect(manifest().forPathname('/articles/a-tour/')).toMatchObject({
      ok: true,
      file: 'src/pages/articles/[...slug].astro',
    });
  });

  it('takes the first match in Astro’s own priority order, so an index beats a catch-all', () => {
    // /articles/ matches both /articles and /articles/[...slug].
    expect(manifest().forPathname('/articles/')).toMatchObject({
      ok: true,
      file: 'src/pages/articles/index.astro',
      pattern: '/articles',
    });
  });

  it('resolves under a trailingSlash: "never" pattern set even when the URL has one', () => {
    const never = [page('/about', /^\/about$/, 'src/pages/about.astro')];
    expect(manifest(never).forPathname('/about/')).toMatchObject({
      ok: true,
      file: 'src/pages/about.astro',
    });
  });

  it('resolves under a trailingSlash: "always" pattern set even when the URL has none', () => {
    const always = [page('/about', /^\/about\/$/, 'src/pages/about.astro')];
    expect(manifest(always).forPathname('/about')).toMatchObject({
      ok: true,
      file: 'src/pages/about.astro',
    });
  });

  it('prefers an exact hit on the URL over a slash-flipped hit on a higher-priority route', () => {
    // Variants are the OUTER loop: the pathname as the browser has it is tried
    // against every route before the flipped form is tried against any. Routes
    // as the outer loop would open articles/index.astro here.
    const routes = [
      page('/articles', /^\/articles\/$/, 'src/pages/articles/index.astro'),
      page('/articles/[...slug]', /^\/articles$/, 'src/pages/articles/[...slug].astro'),
    ];
    expect(manifest(routes).forPathname('/articles')).toMatchObject({
      ok: true,
      file: 'src/pages/articles/[...slug].astro',
    });
  });

  it('strips a configured base, and tolerates it unnormalized', () => {
    for (const base of ['/docs', 'docs', '/docs/']) {
      expect(manifest(ROUTES, base).forPathname('/docs/about/')).toMatchObject({
        ok: true,
        file: 'src/pages/about.astro',
      });
      expect(manifest(ROUTES, base).forPathname('/docs')).toMatchObject({
        ok: true,
        file: 'src/pages/index.astro',
      });
      // Outside the base: not a route of this site.
      expect(manifest(ROUTES, base).forPathname('/about/')).toEqual({
        ok: false,
        refusal: 'no-match',
      });
      // A path that only looks like the base prefix.
      expect(manifest(ROUTES, base).forPathname('/docsy/about/')).toEqual({
        ok: false,
        refusal: 'no-match',
      });
    }
  });

  it('matches a percent-encoded non-ASCII pathname', () => {
    const routes = [page('/über', /^\/über\/?$/, 'src/pages/about.astro')];
    expect(manifest(routes).forPathname('/%C3%BCber/')).toMatchObject({
      ok: true,
      file: 'src/pages/about.astro',
    });
  });

  it('ignores routes that are not pages', () => {
    const routes = [
      page('/api/hello', /^\/api\/hello\/?$/, 'src/pages/api/hello.ts', 'endpoint'),
      page('/old', /^\/old\/?$/, 'src/pages/about.astro', 'redirect'),
    ];
    expect(manifest(routes).forPathname('/api/hello')).toEqual({
      ok: false,
      refusal: 'no-match',
    });
    expect(manifest(routes).forPathname('/old')).toEqual({ ok: false, refusal: 'no-match' });
  });

  it('refuses a match whose entrypoint is package-owned or outside the root', () => {
    const pkg = [page('/', /^\/$/, 'node_modules/@astrojs/starlight/index.astro')];
    expect(manifest(pkg).forPathname('/')).toEqual({ ok: false, refusal: 'not-in-project' });
    const outside = [page('/', /^\/$/, '../outside.astro')];
    expect(manifest(outside).forPathname('/')).toEqual({ ok: false, refusal: 'not-in-project' });
  });

  it('refuses a match with no file on disk (Astro’s injected default 404)', () => {
    const injected = [page('/404', /^\/404\/?$/, 'astro-default-404.astro')];
    expect(manifest(injected).forPathname('/404')).toEqual({ ok: false, refusal: 'missing' });
  });

  it('refuses an unmatched pathname, junk, and an empty route table', () => {
    expect(manifest().forPathname('/nope/')).toEqual({ ok: false, refusal: 'no-match' });
    expect(manifest().forPathname('')).toEqual({ ok: false, refusal: 'no-match' });
    expect(manifest([]).forPathname('/')).toEqual({ ok: false, refusal: 'no-routes' });
  });

  it('normalizes a pathname carrying a query, duplicate slashes, or no leading slash', () => {
    expect(manifest().forPathname('/about/?x=1')).toMatchObject({ ok: true });
    expect(manifest().forPathname('//about//')).toMatchObject({ ok: true });
    expect(manifest().forPathname('about')).toMatchObject({ ok: true });
  });

  it('reads the routes thunk live, so a page added mid-session resolves', () => {
    const live: ResolvedRouteLike[] = [...ROUTES];
    const m = createRouteManifest({ root, base: '/', routes: () => live });
    expect(m.forPathname('/contact/')).toEqual({ ok: false, refusal: 'no-match' });
    live.unshift(page('/contact', /^\/contact\/?$/, 'src/pages/about.astro'));
    expect(m.forPathname('/contact/')).toMatchObject({ ok: true, file: 'src/pages/about.astro' });
  });
});

describe('POST /page-source', () => {
  function mount(
    options: DevEditOptions = {},
    routes: readonly ResolvedRouteLike[] | null = ROUTES,
  ): Connect.NextHandleFunction {
    return createMiddleware({
      logger,
      root,
      optionsResolver: stubOptions(root, options),
      schemaProvider: null,
      routeManifest: routes === null ? null : manifest(routes),
      unsplash: null,
    });
  }

  function request(
    h: Connect.NextHandleFunction,
    body: unknown,
  ): Promise<{ status: number; body: any }> {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]) as any;
    req.method = 'POST';
    req.url = '/__dev-edit/page-source';
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

  it('answers the page’s own template, not the component that fills the DOM', async () => {
    // The regression: src/components/Nav.astro renders most of this page's
    // annotated elements, and the old implementation opened it. Nothing in the
    // request even mentions the DOM any more.
    const r = await request(mount(), { pathname: '/' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ file: 'src/pages/index.astro', pattern: '/', refusal: null });
  });

  it('answers a dynamic route’s template', async () => {
    const r = await request(mount(), { pathname: '/articles/a-tour/' });
    expect(r.body.file).toBe('src/pages/articles/[...slug].astro');
    expect(r.body.pattern).toBe('/articles/[...slug]');
  });

  it('refuses with 200 and a reason when no route matches', async () => {
    const r = await request(mount(), { pathname: '/nope/' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ file: null, pattern: null, refusal: 'no-match' });
  });

  it('reports no-routes when no manifest is available at all', async () => {
    const r = await request(mount({}, null), { pathname: '/' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ file: null, pattern: null, refusal: 'no-routes' });
  });

  it('refuses when openInEditor is off', async () => {
    const r = await request(mount({ openInEditor: false }), { pathname: '/' });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/open-in-editor is disabled/);
  });

  it('rejects a request with no pathname', async () => {
    expect((await request(mount(), {})).status).toBe(400);
    expect((await request(mount(), { pathname: '' })).body.error).toMatch(/pathname is required/);
  });
});
