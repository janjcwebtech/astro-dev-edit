import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { AstroIntegrationLogger } from 'astro';
import type { Connect } from 'vite';
import { createMiddleware } from '../src/server/middleware.ts';
import type { DevEditOptions } from '../src/server/options.ts';
import { stubOptions } from './helpers.ts';
import { ENV_TARGET, resolveUnsplashKey, SETTINGS_FILE } from '../src/server/settings.ts';
import type { UnsplashConfig } from '../src/server/unsplash-routes.ts';

/**
 * The /unsplash* and /settings routes, with Unsplash stubbed through an
 * **injected fetch** rather than a global — the approach the architecture rules
 * ask for, and unlike `vi.stubGlobal` it cannot leak between suites.
 *
 * The stub is a recording fake that routes on hostname + pathname and builds
 * real `Response` objects, so the code under test exercises real header,
 * status, streaming and JSON handling.
 */

const warnings: string[] = [];
const logger = {
  info() {},
  warn(msg: string) {
    warnings.push(msg);
  },
  error() {},
  debug() {},
  options: {},
  label: 'test',
  fork: () => logger,
} as unknown as AstroIntegrationLogger;

const JPEG = Buffer.from('fake-jpeg-bytes');

/** One entry as Unsplash actually sends it, with every field we ignore present
 *  so the reshape assertion means something. */
function rawPhoto(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    color: '#c0ffee',
    width: 4000,
    height: 3000,
    description: 'A misty forest',
    alt_description: 'trees in fog',
    urls: {
      raw: `https://images.unsplash.com/photo-${id}?ixid=abc123&ixlib=rb-4.0`,
      small: `https://images.unsplash.com/photo-${id}?w=400`,
      full: 'https://images.unsplash.com/full',
    },
    links: {
      html: `https://unsplash.com/photos/${id}`,
      download_location: `https://api.unsplash.com/photos/${id}/download?ixid=abc123`,
    },
    user: {
      name: 'Ada Lovelace',
      username: 'ada',
      links: { html: 'https://unsplash.com/@ada' },
      // Fields that must never reach the client:
      bio: 'secret bio',
      email: 'ada@example.com',
    },
    exif: { make: 'Canon' },
    tags: [{ title: 'forest' }],
    sponsorship: { sponsor: { name: 'BigCo' } },
    ...over,
  };
}

interface StubCall {
  url: string;
  headers: Record<string, string>;
}

interface Stub {
  calls: StubCall[];
  fetch: typeof fetch;
  /** Override the search response for the next call(s). */
  searchStatus: number;
  searchBody: unknown;
  searchHeaders: Record<string, string>;
  downloadStatus: number;
  downloadBody: Buffer | null;
  downloadHeaders: Record<string, string>;
  /** When set, the matching call rejects with this instead of responding. */
  throwOn: ((url: string) => unknown) | null;
}

function makeStub(): Stub {
  const stub: Stub = {
    calls: [],
    searchStatus: 200,
    searchBody: { results: [rawPhoto('abc')], total: 1283, total_pages: 65 },
    searchHeaders: { 'x-ratelimit-limit': '50', 'x-ratelimit-remaining': '49' },
    downloadStatus: 200,
    downloadBody: JPEG,
    downloadHeaders: { 'content-type': 'image/jpeg' },
    throwOn: null,
    fetch: (async (input: any, init?: any) => {
      const url = String(input);
      stub.calls.push({ url, headers: { ...(init?.headers ?? {}) } });

      const thrown = stub.throwOn?.(url);
      if (thrown) throw thrown;

      const { hostname, pathname } = new URL(url);
      if (hostname === 'api.unsplash.com' && pathname === '/search/photos') {
        return new Response(JSON.stringify(stub.searchBody), {
          status: stub.searchStatus,
          headers: { 'content-type': 'application/json', ...stub.searchHeaders },
        });
      }
      if (hostname === 'api.unsplash.com' && pathname.endsWith('/download')) {
        return new Response(JSON.stringify({ url: 'https://images.unsplash.com/tracked' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (hostname === 'images.unsplash.com') {
        return new Response(stub.downloadBody as any, {
          status: stub.downloadStatus,
          headers: stub.downloadHeaders,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch,
  };
  return stub;
}

let root: string;
let stub: Stub;
let handler: Connect.NextHandleFunction;

/** Build a middleware over the temp project with the given Unsplash config. */
function mount(
  unsplash: UnsplashConfig | null,
  options: DevEditOptions = {},
): Connect.NextHandleFunction {
  return createMiddleware({
    logger,
    root,
    optionsResolver: stubOptions(root, {
      openInEditor: false,
      entryEditor: false,
      // Passing a config turns the option on, mirroring production: the config
      // object supplies the key resolver, the option decides on/off.
      unsplash: unsplash ? {} : false,
      ...options,
    }),
    schemaProvider: null,
    routeManifest: null,
    unsplash,
  });
}

function config(over: Partial<UnsplashConfig> = {}): UnsplashConfig {
  return {
    resolve: async () => ({ key: 'test-key', source: 'file' }),
    enabled: async () => true,
    appName: async () => 'my app',
    perPage: async () => 20,
    importWidth: async () => 2400,
    fetchImpl: stub.fetch,
    ...over,
  };
}

function request(opts: {
  method?: string;
  url: string;
  body?: unknown;
  via?: Connect.NextHandleFunction;
}): Promise<{ status: number; body: any; raw: string }> {
  const payload = opts.body !== undefined ? Buffer.from(JSON.stringify(opts.body)) : undefined;
  const req = Readable.from(payload ? [payload] : []) as any;
  req.method = opts.method ?? 'POST';
  req.url = opts.url;
  req.headers = {};
  req.socket = { remoteAddress: '127.0.0.1' };

  return new Promise((resolve, reject) => {
    const res: any = {
      statusCode: 200,
      setHeader() {},
      end(raw: string) {
        let body: any = raw;
        try {
          body = JSON.parse(raw);
        } catch {
          /* leave raw */
        }
        resolve({ status: res.statusCode, body, raw: String(raw) });
      },
    };
    try {
      (opts.via ?? handler)(req, res, () => resolve({ status: -1, body: null, raw: '' }));
    } catch (err) {
      reject(err);
    }
  });
}

const search = (body: unknown, via?: Connect.NextHandleFunction) =>
  request({ url: '/__dev-edit/unsplash/search', body, via });
const doImport = (body: unknown, via?: Connect.NextHandleFunction) =>
  request({ url: '/__dev-edit/unsplash/import', body, via });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'atx-unsplash-'));
  await mkdir(join(root, 'public'), { recursive: true });
  await mkdir(join(root, 'src/assets/blog'), { recursive: true });
  warnings.length = 0;
  stub = makeStub();
  handler = mount(config());
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// -----------------------------------------------------------------------------
describe('POST /unsplash/search', () => {
  it('sends the query, paging and auth headers Unsplash expects', async () => {
    const r = await search({ query: 'forest', page: 2, perPage: 12, orientation: 'landscape' });
    expect(r.status).toBe(200);
    const url = new URL(stub.calls[0].url);
    expect(url.origin + url.pathname).toBe('https://api.unsplash.com/search/photos');
    expect(url.searchParams.get('query')).toBe('forest');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('per_page')).toBe('12');
    expect(url.searchParams.get('orientation')).toBe('landscape');
    expect(stub.calls[0].headers.Authorization).toBe('Client-ID test-key');
    expect(stub.calls[0].headers['Accept-Version']).toBe('v1');
  });

  it('omits orientation when "any"', async () => {
    await search({ query: 'forest', orientation: 'any' });
    expect(new URL(stub.calls[0].url).searchParams.has('orientation')).toBe(false);
  });

  it('falls back to the configured perPage, and clamps page and perPage', async () => {
    await search({ query: 'a' });
    expect(new URL(stub.calls[0].url).searchParams.get('per_page')).toBe('20');

    await search({ query: 'b', perPage: 500, page: -3 });
    const url = new URL(stub.calls[1].url);
    expect(url.searchParams.get('per_page')).toBe('30');
    expect(url.searchParams.get('page')).toBe('1');
  });

  it('reshapes each photo, dropping every raw Unsplash field', async () => {
    const r = await search({ query: 'forest' });
    expect(r.body.photos).toHaveLength(1);
    const photo = r.body.photos[0];
    expect(Object.keys(photo).sort()).toEqual([
      'color',
      'description',
      'height',
      'id',
      'pageUrl',
      'photographer',
      'photographerUrl',
      'thumbUrl',
      'width',
    ]);
    expect(photo.photographer).toBe('Ada Lovelace');
    expect(photo.description).toBe('A misty forest');
    // Nothing sensitive or extraneous anywhere in the serialized body.
    for (const leaked of ['exif', 'sponsorship', 'secret bio', 'ada@example.com', 'download_location']) {
      expect(r.raw).not.toContain(leaked);
    }
  });

  it('never exposes the raw or download URLs the import path uses', async () => {
    const r = await search({ query: 'forest' });
    expect(r.raw).not.toContain('ixid');
    expect(r.raw).not.toContain('/download');
  });

  it('attaches the utm params to both credit links, keeping an existing query string', async () => {
    stub.searchBody = {
      results: [
        rawPhoto('q', {
          links: { html: 'https://unsplash.com/photos/q?foo=1', download_location: 'https://api.unsplash.com/photos/q/download' },
          user: { name: 'Ada', links: { html: 'https://unsplash.com/@ada' } },
        }),
      ],
      total: 1,
      total_pages: 1,
    };
    const r = await search({ query: 'forest' });
    const photo = r.body.photos[0];
    expect(photo.photographerUrl).toBe(
      'https://unsplash.com/@ada?utm_source=my%20app&utm_medium=referral',
    );
    // Already had `?foo=1`, so the params join with `&`.
    expect(photo.pageUrl).toBe(
      'https://unsplash.com/photos/q?foo=1&utm_source=my%20app&utm_medium=referral',
    );
  });

  it('passes through totals and the remaining-requests header', async () => {
    const r = await search({ query: 'forest' });
    expect(r.body.total).toBe(1283);
    expect(r.body.totalPages).toBe(65);
    expect(r.body.page).toBe(1);
    expect(r.body.remaining).toBe(49);
  });

  it('serves a repeated identical search from cache, without a second call', async () => {
    await search({ query: 'forest' });
    const again = await search({ query: 'forest' });
    expect(stub.calls).toHaveLength(1);
    expect(again.body.photos[0].id).toBe('abc');
    // A different page is a different key.
    await search({ query: 'forest', page: 2 });
    expect(stub.calls).toHaveLength(2);
  });

  it('400s a blank query without calling Unsplash', async () => {
    const r = await search({ query: '   ' });
    expect(r.status).toBe(400);
    expect(stub.calls).toHaveLength(0);
  });

  it('403s `disabled` when the feature is off', async () => {
    const r = await search({ query: 'forest' }, mount(null));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('disabled');
    expect(stub.calls).toHaveLength(0);
  });

  it('403s `unconfigured` with no key, and never calls fetch', async () => {
    const off = mount(config({ resolve: async () => ({ key: '', source: null }) }));
    const r = await search({ query: 'forest' }, off);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('unconfigured');
    expect(stub.calls).toHaveLength(0);
  });

  it('maps 401 to 502 unauthorized', async () => {
    stub.searchStatus = 401;
    const r = await search({ query: 'forest' });
    expect(r.status).toBe(502);
    expect(r.body.code).toBe('unauthorized');
  });

  it('maps 403 to 429 rate-limited', async () => {
    stub.searchStatus = 403;
    const r = await search({ query: 'forest' });
    expect(r.status).toBe(429);
    expect(r.body.code).toBe('rate-limited');
  });

  it('maps other non-2xx to 502 upstream', async () => {
    stub.searchStatus = 503;
    const r = await search({ query: 'forest' });
    expect(r.status).toBe(502);
    expect(r.body.code).toBe('upstream');
  });

  it('maps a network rejection to 502 upstream', async () => {
    stub.throwOn = () => new Error('ECONNREFUSED');
    const r = await search({ query: 'forest' });
    expect(r.status).toBe(502);
    expect(r.body.code).toBe('upstream');
  });

  it('maps a TimeoutError to 504', async () => {
    stub.throwOn = () => {
      const err = new Error('timed out');
      err.name = 'TimeoutError';
      return err;
    };
    const r = await search({ query: 'forest' });
    expect(r.status).toBe(504);
    expect(r.body.code).toBe('timeout');
  });

  it('maps malformed upstream JSON to 502 rather than crashing', async () => {
    stub.searchBody = undefined;
    stub.fetch = (async () => new Response('<html>nope', { status: 200 })) as any;
    const r = await search({ query: 'forest' }, mount(config({ fetchImpl: stub.fetch })));
    expect(r.status).toBe(502);
    expect(r.body.code).toBe('upstream');
  });
});

// -----------------------------------------------------------------------------
describe('POST /unsplash/import', () => {
  /** Search first: an id is only importable once the server has minted it. */
  async function seed(via?: Connect.NextHandleFunction): Promise<void> {
    await search({ query: 'forest' }, via);
  }

  it('downloads the bytes and writes them into uploadDir', async () => {
    await seed();
    const r = await doImport({ id: 'abc' });
    expect(r.status).toBe(200);
    expect(r.body.webPath).toBe('/unsplash-a-misty-forest-abc.jpg');
    expect(r.body.filename).toBe('unsplash-a-misty-forest-abc.jpg');
    const written = await readFile(join(root, 'public/unsplash-a-misty-forest-abc.jpg'));
    expect(written.equals(JPEG)).toBe(true);
  });

  it('requests a bounded JPEG and preserves the ixid on the byte URL', async () => {
    await seed();
    await doImport({ id: 'abc' });
    const byteCall = stub.calls.find((c) => c.url.startsWith('https://images.unsplash.com'))!;
    const url = new URL(byteCall.url);
    expect(url.searchParams.get('w')).toBe('2400');
    expect(url.searchParams.get('fit')).toBe('max');
    expect(url.searchParams.get('q')).toBe('80');
    expect(url.searchParams.get('fm')).toBe('jpg');
    expect(url.searchParams.get('ixid')).toBe('abc123');
  });

  it('honours a per-import width, and asks for nothing wider than requested', async () => {
    await seed();
    await doImport({ id: 'abc', width: 800 });
    const byteCall = stub.calls.find((c) => c.url.startsWith('https://images.unsplash.com'))!;
    expect(new URL(byteCall.url).searchParams.get('w')).toBe('800');
  });

  it("drops the width parameter entirely for 'original'", async () => {
    // The raw URL Unsplash hands back can carry sizing of its own, so
    // 'original' has to remove `w`, not merely decline to add one.
    await seed();
    await doImport({ id: 'abc', width: 'original' });
    const byteCall = stub.calls.find((c) => c.url.startsWith('https://images.unsplash.com'))!;
    const url = new URL(byteCall.url);
    expect(url.searchParams.has('w')).toBe(false);
    expect(url.searchParams.get('fit')).toBe('max');
    expect(url.searchParams.get('ixid')).toBe('abc123');
  });

  it('falls back to the resolved option when the request names no width', async () => {
    handler = mount(config({ importWidth: async () => 1600 }));
    await seed();
    await doImport({ id: 'abc' });
    const byteCall = stub.calls.find((c) => c.url.startsWith('https://images.unsplash.com'))!;
    expect(new URL(byteCall.url).searchParams.get('w')).toBe('1600');
  });

  it('refuses an off-safelist width rather than clamping it, and downloads nothing', async () => {
    // The width lands in a URL the dev server fetches. Clamping would hide a
    // client bug and quietly import the wrong size, so it is a 400.
    await seed();
    const before = stub.calls.length;
    const r = await doImport({ id: 'abc', width: 12000 });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('width must be one of');
    expect(stub.calls.length).toBe(before);
    expect(await readdir(join(root, 'public'))).toEqual([]);
  });

  it('refuses a width that is a string of something else', async () => {
    await seed();
    const r = await doImport({ id: 'abc', width: '2400&fm=png' });
    expect(r.status).toBe(400);
    expect(await readdir(join(root, 'public'))).toEqual([]);
  });

  it('fires the download_location ping, authenticated and with its ixid intact', async () => {
    await seed();
    await doImport({ id: 'abc' });
    const ping = stub.calls.find((c) => c.url.includes('/download'))!;
    expect(ping).toBeDefined();
    expect(new URL(ping.url).searchParams.get('ixid')).toBe('abc123');
    expect(ping.headers.Authorization).toBe('Client-ID test-key');
  });

  it('still succeeds when the ping fails', async () => {
    await seed();
    stub.throwOn = (url) => (url.includes('/download') ? new Error('ping down') : null);
    const r = await doImport({ id: 'abc' });
    expect(r.status).toBe(200);
    expect(existsSync(join(root, 'public/unsplash-a-misty-forest-abc.jpg'))).toBe(true);
    expect(warnings.some((w) => w.includes('ping failed'))).toBe(true);
  });

  it('writes an image() field’s asset into imageUploadDir', async () => {
    await seed();
    const r = await doImport({ id: 'abc', assetRef: 'relative' });
    expect(r.body.webPath).toBe('/src/assets/unsplash-a-misty-forest-abc.jpg');
  });

  it('honours a targetDir inside a configured asset dir', async () => {
    await seed();
    const r = await doImport({ id: 'abc', assetRef: 'relative', targetDir: 'src/assets/blog' });
    expect(r.body.webPath).toBe('/src/assets/blog/unsplash-a-misty-forest-abc.jpg');
  });

  it('ignores a targetDir outside the configured asset dirs', async () => {
    await seed();
    const r = await doImport({ id: 'abc', targetDir: 'src/pages' });
    expect(r.body.webPath).toBe('/unsplash-a-misty-forest-abc.jpg');
    expect(warnings.some((w) => w.includes('not inside a configured asset'))).toBe(true);
  });

  it('ignores a targetDir that escapes the project root', async () => {
    await seed();
    const r = await doImport({ id: 'abc', targetDir: '../../etc' });
    expect(r.body.webPath).toBe('/unsplash-a-misty-forest-abc.jpg');
  });

  it('produces a safe basename from a hostile description', async () => {
    stub.searchBody = {
      results: [rawPhoto('x', { description: '../../etc/passwd & <script>' })],
      total: 1,
      total_pages: 1,
    };
    await seed();
    const r = await doImport({ id: 'x' });
    expect(r.body.filename).toBe('unsplash-etc-passwd-script-x.jpg');
    expect(r.body.filename).not.toContain('/');
    expect(existsSync(join(root, 'public', r.body.filename))).toBe(true);
  });

  it('falls back to the photographer when a photo has no description', async () => {
    stub.searchBody = {
      results: [rawPhoto('y', { description: null, alt_description: null })],
      total: 1,
      total_pages: 1,
    };
    await seed();
    const r = await doImport({ id: 'y' });
    expect(r.body.filename).toBe('unsplash-ada-lovelace-y.jpg');
  });

  it('suffixes rather than overwriting on a re-import', async () => {
    await seed();
    await doImport({ id: 'abc' });
    const second = await doImport({ id: 'abc' });
    expect(second.body.filename).toBe('unsplash-a-misty-forest-abc-1.jpg');
    expect((await readdir(join(root, 'public'))).sort()).toEqual([
      'unsplash-a-misty-forest-abc-1.jpg',
      'unsplash-a-misty-forest-abc.jpg',
    ]);
  });

  it('409s `expired` for an unknown id, writing nothing', async () => {
    const r = await doImport({ id: 'never-searched' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('expired');
    expect(await readdir(join(root, 'public'))).toEqual([]);
  });

  it('400s a missing id', async () => {
    const r = await doImport({});
    expect(r.status).toBe(400);
  });

  it('502s and writes nothing when the byte fetch fails', async () => {
    await seed();
    stub.throwOn = (url) => (url.startsWith('https://images.') ? new Error('offline') : null);
    const r = await doImport({ id: 'abc' });
    expect(r.status).toBe(502);
    expect(r.body.code).toBe('upstream');
    expect(await readdir(join(root, 'public'))).toEqual([]);
  });

  it('502s and writes nothing on a non-image content type', async () => {
    await seed();
    stub.downloadHeaders = { 'content-type': 'text/html' };
    const r = await doImport({ id: 'abc' });
    expect(r.status).toBe(502);
    expect(await readdir(join(root, 'public'))).toEqual([]);
  });

  it('502s `too-large` on an oversized body, writing nothing', async () => {
    await seed();
    stub.downloadBody = Buffer.alloc(26 * 1024 * 1024, 1);
    const r = await doImport({ id: 'abc' });
    expect(r.status).toBe(502);
    expect(r.body.code).toBe('too-large');
    expect(await readdir(join(root, 'public'))).toEqual([]);
  });

  it('502s `too-large` on a lying content-length, before reading the body', async () => {
    await seed();
    stub.downloadHeaders = {
      'content-type': 'image/jpeg',
      'content-length': String(99 * 1024 * 1024),
    };
    const r = await doImport({ id: 'abc' });
    expect(r.status).toBe(502);
    expect(r.body.code).toBe('too-large');
  });

  it('409s the oldest id once the photo cache overflows', async () => {
    // 501 distinct ids across two pages evicts the first.
    stub.searchBody = {
      results: Array.from({ length: 300 }, (_, i) => rawPhoto(`p${i}`)),
      total: 600,
      total_pages: 2,
    };
    await search({ query: 'many', page: 1 });
    stub.searchBody = {
      results: Array.from({ length: 300 }, (_, i) => rawPhoto(`q${i}`)),
      total: 600,
      total_pages: 2,
    };
    await search({ query: 'many', page: 2 });

    const evicted = await doImport({ id: 'p0' });
    expect(evicted.status).toBe(409);
    expect(evicted.body.code).toBe('expired');
    // The newest id is still importable.
    const fresh = await doImport({ id: 'q299' });
    expect(fresh.status).toBe(200);
  });
});

// -----------------------------------------------------------------------------
describe('/settings', () => {
  const get = (via?: Connect.NextHandleFunction) =>
    request({ method: 'GET', url: '/__dev-edit/settings', via });
  const put = (accessKey: string, via?: Connect.NextHandleFunction) =>
    request({ url: '/__dev-edit/settings', body: { unsplash: { accessKey } }, via });

  /** A middleware whose key resolution is the real one, so a write is visible
   *  to the next read without a restart. */
  /** The hint format, restated here rather than imported: eight bullets and
   *  four hex characters of the key's SHA-256. Importing `maskKey` would make
   *  every assertion below agree with whatever it happened to return. */
  const fingerprint = (key: string): string =>
    '••••••••' + createHash('sha256').update(key).digest('hex').slice(0, 4);

  function live(configKey?: string): Connect.NextHandleFunction {
    return mount(config({ resolve: () => resolveUnsplashKey(root, configKey) }));
  }

  it('reports unconfigured before anything is stored', async () => {
    const r = await get(live());
    expect(r.status).toBe(200);
    expect(r.body.unsplash.enabled).toBe(true);
    expect(r.body.unsplash.configured).toBe(false);
    expect(r.body.unsplash.source).toBe(null);
    expect(r.body.unsplash.hint).toBeUndefined();
  });

  it('stores a key, then reports it fingerprinted and never returns it', async () => {
    const via = live();
    const KEY = 'SECRETKEY123456Ab3d';
    const saved = await put(KEY, via);
    expect(saved.status).toBe(200);
    expect(saved.body.unsplash.configured).toBe(true);
    expect(saved.body.unsplash.source).toBe('env-file');
    expect(saved.body.unsplash.sourceFile).toBe(ENV_TARGET);
    expect(saved.body.unsplash.hint).toBe(fingerprint(KEY));

    const read = await get(via);
    // Stable across reads — recognition is the whole job of the hint.
    expect(read.body.unsplash.hint).toBe(fingerprint(KEY));

    // The raw key appears nowhere in either response, and neither does any
    // four-character run of it: the hint used to carry the real tail.
    for (const raw of [saved.raw, read.raw]) {
      expect(raw).not.toContain('SECRETKEY123456');
      for (let i = 0; i + 4 <= KEY.length; i++) {
        expect(raw, `run "${KEY.slice(i, i + 4)}" at ${i}`).not.toContain(KEY.slice(i, i + 4));
      }
    }
  });

  it('fingerprints a config or shell key too — the tail of one never crossed the wire', async () => {
    const KEY = 'CONFIGKEY987654Zz9q';
    const r = await get(live(KEY));
    expect(r.body.unsplash.hint).toBe(fingerprint(KEY));
    for (let i = 0; i + 4 <= KEY.length; i++) {
      expect(r.raw).not.toContain(KEY.slice(i, i + 4));
    }
  });

  it('writes the key to .env.local at the fixed root path, owner-only', async () => {
    await put('abcd1234', live());
    const target = join(root, ENV_TARGET);
    expect(existsSync(target)).toBe(true);
    expect(await readFile(target, 'utf8')).toContain('UNSPLASH_ACCESS_KEY=abcd1234');
    if (process.platform !== 'win32') {
      expect((await stat(target)).mode & 0o777).toBe(0o600);
    }
    // The secret does not go anywhere near the file the dev server used to serve.
    expect(existsSync(join(root, SETTINGS_FILE))).toBe(false);
  });

  it('refuses a key that could not read back as written, touching nothing', async () => {
    const r = await put('abc 123 $HOME', live());
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('validation');
    expect(r.body.fieldErrors.accessKey).toMatch(/letters, digits/);
    expect(existsSync(join(root, ENV_TARGET))).toBe(false);
  });

  it('migrates a legacy stored key into .env.local, keeping the options', async () => {
    await writeFile(
      join(root, SETTINGS_FILE),
      JSON.stringify({ unsplash: { accessKey: 'legacy-key' }, options: { revealWrites: true } }),
    );
    const via = live();
    // It still resolves, so an existing project keeps working before any save…
    const before = await get(via);
    expect(before.body.unsplash.source).toBe('file');

    const saved = await put('brand-new-key', via);
    expect(saved.status).toBe(200);
    expect(saved.body.unsplash.source).toBe('env-file');
    expect(await readFile(join(root, ENV_TARGET), 'utf8')).toContain('UNSPLASH_ACCESS_KEY=brand-new-key');
    // …and the copy in the served file is gone, while the options survive.
    const settings = JSON.parse(await readFile(join(root, SETTINGS_FILE), 'utf8'));
    expect(settings.unsplash).toBeUndefined();
    expect(settings.options).toEqual({ revealWrites: true });
  });

  it('reports a legacy key that something else is shadowing', async () => {
    await writeFile(join(root, SETTINGS_FILE), JSON.stringify({ unsplash: { accessKey: 'legacy' } }));
    const r = await get(live('from-config-key'));
    expect(r.body.unsplash.source).toBe('config');
    expect(r.body.unsplash.staleStoredKey).toBe(true);
  });

  it('refuses to store a key an exported shell variable would override', async () => {
    process.env.UNSPLASH_ACCESS_KEY = 'exported';
    try {
      const via = live();
      const r = await get(via);
      expect(r.body.unsplash.source).toBe('env-shell');
      expect(r.body.unsplash.writable).toBe(false);

      const rejected = await put('would-be-ignored', via);
      expect(rejected.status).toBe(409);
      expect(rejected.body.error).toMatch(/exported/);
      expect(existsSync(join(root, ENV_TARGET))).toBe(false);
    } finally {
      delete process.env.UNSPLASH_ACCESS_KEY;
    }
  });

  it('refuses to store a key .env.development would override', async () => {
    await writeFile(join(root, '.env.development'), 'UNSPLASH_ACCESS_KEY=dev-key\n');
    const via = live();
    const r = await get(via);
    expect(r.body.unsplash.source).toBe('env-file');
    expect(r.body.unsplash.sourceFile).toBe('.env.development');
    expect(r.body.unsplash.writable).toBe(false);

    const rejected = await put('would-be-ignored', via);
    expect(rejected.status).toBe(409);
    expect(rejected.body.error).toMatch(/\.env\.development/);
  });

  it('saves over a .env key, but refuses to clear one', async () => {
    await writeFile(join(root, '.env'), 'UNSPLASH_ACCESS_KEY=team-key\n');
    const via = live();
    const r = await get(via);
    expect(r.body.unsplash.sourceFile).toBe('.env');
    expect(r.body.unsplash.writable).toBe(true);
    expect(r.body.unsplash.clearable).toBe(false);

    // Clearing cannot work: removing a line from .env.local cannot unset .env.
    expect((await put('', via)).status).toBe(409);

    // Saving does, because .env.local outranks .env.
    const saved = await put('mine-wins', via);
    expect(saved.status).toBe(200);
    expect(saved.body.unsplash.sourceFile).toBe(ENV_TARGET);
    expect(await readFile(join(root, ENV_TARGET), 'utf8')).toContain('UNSPLASH_ACCESS_KEY=mine-wins');
    // The team's .env is left exactly as it was.
    expect(await readFile(join(root, '.env'), 'utf8')).toBe('UNSPLASH_ACCESS_KEY=team-key\n');
  });

  it('leaves no temp file behind', async () => {
    await put('abcd1234', live());
    expect((await readdir(root)).filter((f) => f.includes('dev-edit-tmp'))).toEqual([]);
  });

  it('clears the key with an empty string', async () => {
    const via = live();
    await put('abcd1234', via);
    const cleared = await put('', via);
    expect(cleared.body.unsplash.configured).toBe(false);
    expect(cleared.body.unsplash.source).toBe(null);
  });

  it('degrades to unconfigured on a malformed settings file', async () => {
    await writeFile(join(root, SETTINGS_FILE), '{ not json');
    const r = await get(live());
    expect(r.status).toBe(200);
    expect(r.body.unsplash.configured).toBe(false);
  });

  it('reports source "config" and refuses to store a key that would do nothing', async () => {
    const via = live('from-config-key');
    const r = await get(via);
    expect(r.body.unsplash.source).toBe('config');
    expect(r.body.unsplash.configured).toBe(true);

    const rejected = await put('would-be-ignored', via);
    expect(rejected.status).toBe(409);
    expect(existsSync(join(root, ENV_TARGET))).toBe(false);
  });

  it('ranks config above a shell variable above a .env file above the legacy key', async () => {
    await writeFile(join(root, SETTINGS_FILE), JSON.stringify({ unsplash: { accessKey: 'legacy' } }));
    expect(await resolveUnsplashKey(root)).toEqual({
      key: 'legacy',
      source: 'file',
      file: SETTINGS_FILE,
    });

    await writeFile(join(root, ENV_TARGET), 'UNSPLASH_ACCESS_KEY=file-key\n');
    expect(await resolveUnsplashKey(root)).toEqual({
      key: 'file-key',
      source: 'env-file',
      file: ENV_TARGET,
    });

    process.env.UNSPLASH_ACCESS_KEY = 'env-key';
    try {
      // Vite's loadEnv copies process.env over everything it parsed from files,
      // so an exported variable really does outrank all four of them.
      expect(await resolveUnsplashKey(root)).toEqual({ key: 'env-key', source: 'env-shell' });
      expect(await resolveUnsplashKey(root, 'config-key')).toEqual({
        key: 'config-key',
        source: 'config',
      });
    } finally {
      delete process.env.UNSPLASH_ACCESS_KEY;
    }
  });

  it('names every uncovered secret file, and stops once they are ignored', async () => {
    const via = live();
    await put('abcd1234', live());
    expect((await get(via)).body.gitignoreWarning).toEqual([ENV_TARGET, SETTINGS_FILE]);

    // A literal line covers .env.local; the settings file is still uncovered.
    await writeFile(join(root, '.gitignore'), 'node_modules/\n.env.local\n');
    expect((await get(via)).body.gitignoreWarning).toEqual([SETTINGS_FILE]);

    await writeFile(join(root, '.gitignore'), 'node_modules/\n.env.local\n.astro-dev-edit.json\n');
    expect((await get(via)).body.gitignoreWarning).toBeUndefined();
  });

  it('accepts the .env* glob real projects actually ship', async () => {
    // Astro's own starters gitignore `.env*`. Reading that as "not covered"
    // would put a permanent, undismissable warning on nearly every project.
    await put('abcd1234', live());
    await writeFile(join(root, '.gitignore'), '.env*\n.astro-dev-edit.json\n');
    expect((await get(live())).body.gitignoreWarning).toBeUndefined();
  });

  it('does not nag about .env.local before one exists', async () => {
    await writeFile(join(root, '.gitignore'), '.astro-dev-edit.json\n');
    expect((await get(live())).body.gitignoreWarning).toBeUndefined();
  });

  it('reports the feature disabled without touching the filesystem', async () => {
    const r = await get(mount(null));
    expect(r.body.unsplash.enabled).toBe(false);
    expect(r.body.unsplash.configured).toBe(false);
    const write = await put('x', mount(null));
    expect(write.status).toBe(403);
    expect(write.body.code).toBe('disabled');
    expect(existsSync(join(root, SETTINGS_FILE))).toBe(false);
  });

  it('makes a key stored through the route usable by the very next search', async () => {
    const via = live();
    const before = await search({ query: 'forest' }, via);
    expect(before.status).toBe(403);
    expect(before.body.code).toBe('unconfigured');

    await put('now-configured', via);

    const after = await search({ query: 'forest' }, via);
    expect(after.status).toBe(200);
    expect(stub.calls[0].headers.Authorization).toBe('Client-ID now-configured');
  });
});

// -----------------------------------------------------------------------------
describe('GET /health', () => {
  const health = (via?: Connect.NextHandleFunction) =>
    request({ method: 'GET', url: '/__dev-edit/health', via });

  it('reports unsplash: true when enabled with a key', async () => {
    expect((await health()).body.unsplash).toBe(true);
  });

  it('reports false when the feature is disabled', async () => {
    expect((await health(mount(null))).body.unsplash).toBe(false);
  });

  it('reports the resolved import width, so the picker select starts there', async () => {
    const via = mount(config(), { unsplash: { importWidth: 800 } });
    expect((await health(via)).body.unsplashImportWidth).toBe(800);
  });

  it('omits the import width when the feature is off', async () => {
    expect((await health(mount(null))).body.unsplashImportWidth).toBeUndefined();
  });

  it('reports false when enabled but the key resolves empty', async () => {
    const via = mount(config({ resolve: async () => ({ key: '   ', source: null }) }));
    expect((await health(via)).body.unsplash).toBe(false);
  });

  it('reports false rather than 500ing when key resolution throws', async () => {
    const via = mount(
      config({
        resolve: async () => {
          throw new Error('settings unreadable');
        },
      }),
    );
    const r = await health(via);
    expect(r.status).toBe(200);
    expect(r.body.unsplash).toBe(false);
  });
});
