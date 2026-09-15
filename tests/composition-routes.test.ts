import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { AstroIntegrationLogger } from 'astro';
import type { Connect } from 'vite';
import { createMiddleware } from '../src/server/middleware.ts';
import { createCompositionService } from '../src/server/composition-service.ts';
import { createRouteManifest } from '../src/server/route-manifest.ts';
import { stubOptions } from './helpers.ts';
import { usageId } from '../src/shared/usage-id.ts';
import { locOf } from './helpers.ts';
import devEdit from '../src/index.ts';

const logger = { info() {}, warn() {}, debug() {}, error() {} } as unknown as AstroIntegrationLogger;
const source = `---\nimport Card from '../Card.astro';\n---\n<Card title="Hello" />`;
let root: string, middleware: Connect.NextHandleFunction;
const request = (path: string, body?: unknown, remote = '127.0.0.1', origin?: string): Promise<{status: number; body: any}> => {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as unknown as Connect.IncomingMessage;
  req.method = path === '/health' ? 'GET' : 'POST'; req.url = '/__dev-edit' + path;
  req.headers = origin ? { origin } : {};
  Object.defineProperty(req, 'socket', { value: { remoteAddress: remote } });
  return new Promise(done => {
    const res = { statusCode: 200, setHeader() {}, end(raw: string) { done({ status: this.statusCode, body: JSON.parse(raw) }); } };
    middleware(req, res as never, () => { throw new Error('unexpected next'); });
  });
};
function mount(composition = true) {
  middleware = createMiddleware({ root, logger, optionsResolver: stubOptions(root, { composition }),
    schemaProvider: null, unsplash: null,
    routeManifest: createRouteManifest({ root, base: '/docs', routes: () => [
      { pattern: '/', patternRegex: /^\/$/, type: 'page', entrypoint: 'src/pages/index.astro' },
    ] }),
    composition: createCompositionService({ root,
      resolve: async (specifier, importer) => resolve(dirname(importer), specifier) }),
  });
}
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'atx-composition-api-')));
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await writeFile(join(root, 'src/pages/index.astro'), source);
  await writeFile(join(root, 'src/Card.astro'), '<h1>Hello</h1>');
  mount();
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const id = () => usageId('src/pages/index.astro', locOf(source, '<Card'));
const query = () => ({ pathname: '/docs/', file: 'src/Card.astro', chain: '.' + id(), traceVersion: 2 });

describe('composition HTTP contract through real middleware', () => {
  it('anchors to Astro routes, proves chains, batches source links and scopes reverse usages', async () => {
    const before = await readFile(join(root, 'src/pages/index.astro'), 'utf8');
    expect((await request('/health')).body.composition).toBe(true);
    const answer = await request('/composition', query());
    expect(answer).toMatchObject({ status: 200, body: { tier: 'proven', route: join(root, 'src/pages/index.astro'), coverage: { complete: true, files: 2 } } });
    const batch = await request('/composition/links', { pathname: '/docs/', ids: [id(), id(), 'unknown1'] });
    expect(batch.body.links).toHaveLength(1);
    expect(batch.body.links[0].props[0]).toMatchObject({ name: 'title', source: '"Hello"' });
    expect(batch.body.missing).toEqual(['unknown1']);
    expect((await request('/composition/uses', { pathname: '/docs/', file: 'src/Card.astro' })).body.links).toHaveLength(1);
    expect(await readFile(join(root, 'src/pages/index.astro'), 'utf8')).toBe(before);
  });
  it('ignores client-provided route anchors and returns a named miss outside the base', async () => {
    expect((await request('/composition', { ...query(), route: 'src/Card.astro', chain: '!' })).body.tier).toBe('inferred');
    expect((await request('/composition', { ...query(), pathname: '/missing' })).body.reason).toBe('no-route');
  });
  it('discovers extra unrendered paths, and removes them on the next query', async () => {
    expect((await request('/composition', { ...query(), chain: undefined })).body.tier).toBe('inferred');
    await writeFile(join(root, 'src/pages/index.astro'), source + '{false && <Card />}');
    expect((await request('/composition', { ...query(), chain: undefined })).body.tier).toBe('candidates');
    await writeFile(join(root, 'src/pages/index.astro'), '<p>Removed</p>');
    expect((await request('/composition/links', { pathname: '/docs/', ids: [id()] })).body.missing).toEqual([id()]);
    expect((await request('/composition', query())).body.reason).toBe('no-path');
  });
  it('never recovers a version-2 broken runtime chain into a guessed answer', async () => {
    expect((await request('/composition', { ...query(), chain: '?' })).body).toMatchObject({ tier: 'none', reason: 'chain-break' });
  });
  it('confines client paths and follows live content-root settings', async () => {
    await writeFile(join(root, 'outside.astro'), '<p>Outside</p>');
    await symlink(join(root, 'outside.astro'), join(root, 'src/escape.astro'));
    for (const file of ['../escape.astro', 'outside.astro', 'src/escape.astro']) {
      expect((await request('/composition', { ...query(), file })).body.reason).toBe('path-refused');
    }
    await writeFile(join(root, '.astro-dev-edit.json'), JSON.stringify({ options: { contentRoots: ['public'] } }));
    expect((await request('/composition', query())).body.reason).toBe('path-refused');
  });
  it('answers disabled at every endpoint, and rejects remote requests through the existing gate', async () => {
    mount(false);
    expect((await request('/health')).body.composition).toBe(false);
    for (const path of ['/composition', '/composition/links', '/composition/uses']) {
      expect(await request(path, {})).toMatchObject({ status: 200, body: { reason: 'disabled' } });
      expect((await request(path, {}, '192.0.2.1')).status).toBe(403);
      expect((await request(path, {}, '127.0.0.1', 'https://example.com')).status).toBe(403);
    }
  });
  it.each([null, [], {}, { pathname: 3 }, { ...query(), file: {} }, { ...query(), chain: '.bad' }, { ...query(), traceVersion: 1 }])('rejects malformed requests: %j', async body => {
    expect((await request('/composition', body)).status).toBe(400);
  });
  it('caps batches and chain depth', async () => {
    expect((await request('/composition/links', { pathname: '/docs/', ids: Array(129).fill(id()) })).status).toBe(400);
    expect((await request('/composition', { ...query(), chain: ('.' + id()).repeat(129) })).status).toBe(400);
  });
  it('does not install tracing, scripts or API for builds', async () => {
    const integration = devEdit({ composition: true });
    const hook = integration.hooks['astro:config:setup']!;
    await hook({ command: 'build', updateConfig() { throw new Error('installed a plugin'); }, injectScript() { throw new Error('injected script'); } } as never);
    await integration.hooks['astro:server:setup']!({ server: { middlewares: { use() { throw new Error('installed middleware'); } } } } as never);
  });
});
