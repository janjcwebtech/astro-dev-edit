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
  middleware = createMiddleware({ root, logger, optionsResolver: stubOptions(root, {}),

    routeManifest: createRouteManifest({ root, base: '/docs', routes: () => [
      { pattern: '/', patternRegex: /^\/$/, type: 'page', entrypoint: 'src/pages/index.astro' },
    ] }),
    composition: composition
      ? createCompositionService({ root,
        resolve: async (specifier, importer) => resolve(dirname(importer), specifier) })
      : null,
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
    const answer = await request('/composition', query());
    expect(answer).toMatchObject({ status: 200, body: { tier: 'proven', route: 'src/pages/index.astro', coverage: { complete: true, files: 2 } } });
    // Issue #72: the index keys modules by absolute path, but nothing absolute
    // may leave the server — the client compares these against `data-atx-file`.
    expect(JSON.stringify(answer.body)).not.toContain(root);
    const batch = await request('/composition/links', { pathname: '/docs/', ids: [id(), id(), 'unknown1'] });
    expect(batch.body.links).toHaveLength(1);
    expect(batch.body.links[0]).toMatchObject({ file: 'src/pages/index.astro', target: 'src/Card.astro' });
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
  /**
   * The one write in this group. It names a **usage id**, never a path — the
   * file is the server's own to resolve, and it still passes the same gate and
   * goes through the same write seam every other write does.
   */
  describe('writing a value at a usage site', () => {
    const mapped = `---\nimport Card from '../Card.astro';\nconst cards = [{ title: 'One' }, { title: 'Two' }];\n---\n{cards.map((c) => <Card title={c.title} />)}\n<Card label="Plain">Slot words</Card>`;
    const read = () => readFile(join(root, 'src/pages/index.astro'), 'utf8');
    const propAt = async (start: number, original: string, newText: string, ordinal?: number) =>
      request('/composition/apply', { pathname: '/docs/', usageId: usageId('src/pages/index.astro', locOf(mapped, '<Card')),
        target: { kind: 'prop', name: 'title', start }, ordinal, original, newText });

    beforeEach(async () => { await writeFile(join(root, 'src/pages/index.astro'), mapped); });

    it('writes the array entry the render ordinal names, and refuses without one', async () => {
      const start = mapped.indexOf('c.title');
      expect(await propAt(start, 'Two', 'Second card')).toMatchObject({ status: 422, body: { code: 'dynamic' } });
      expect(await read()).toBe(mapped);
      expect(await propAt(start, 'Two', 'Second card', 2)).toMatchObject({ status: 200, body: { ok: true } });
      expect(await read()).toBe(mapped.replace("{ title: 'Two' }", "{ title: 'Second card' }"));
    });

    it('writes a quoted prop and a run of slot text at their own ranges', async () => {
      const second = usageId('src/pages/index.astro', locOf(mapped, '<Card label'));
      const at = (target: unknown, original: string, newText: string) =>
        request('/composition/apply', { pathname: '/docs/', usageId: second, target, original, newText });
      expect(await at({ kind: 'prop', name: 'label', start: mapped.indexOf('"Plain"') }, 'Plain', 'Named'))
        .toMatchObject({ status: 200 });
      const afterProp = await read();
      expect(afterProp).toContain('label="Named"');
      expect(await at({ kind: 'slot', name: 'default', start: afterProp.indexOf('Slot words') }, 'Slot words', 'Other words'))
        .toMatchObject({ status: 200 });
      expect(await read()).toContain('>Other words<');
    });

    it('refuses a stale original, an unknown id and a malformed target, writing nothing', async () => {
      const start = mapped.indexOf('c.title');
      expect(await propAt(start, 'Moved on', 'x', 2)).toMatchObject({ status: 422, body: { code: 'mismatch' } });
      expect(await request('/composition/apply', { pathname: '/docs/', usageId: 'aaaaaaaa',
        target: { kind: 'prop', name: 'title', start }, original: 'Two', newText: 'x' }))
        .toMatchObject({ status: 422, body: { code: 'unresolved' } });
      for (const target of [undefined, { kind: 'attr', name: 'title', start }, { kind: 'prop', name: 'title', start: -1 }]) {
        expect((await request('/composition/apply', { pathname: '/docs/', usageId: 'aaaaaaaa', target, original: '', newText: '' })).status).toBe(400);
      }
      expect(await read()).toBe(mapped);
    });

    it('refuses when composition is off, and never answers a remote caller', async () => {
      expect((await request('/composition/apply', { pathname: '/docs/' }, '192.0.2.1')).status).toBe(403);
      mount(false);
      expect(await request('/composition/apply', { pathname: '/docs/', usageId: 'aaaaaaaa',
        target: { kind: 'prop', name: 'title', start: 0 }, original: '', newText: '' }))
        .toMatchObject({ status: 422, body: { code: 'unsupported' } });
      expect(await read()).toBe(mapped);
    });
  });

  it('answers disabled at every endpoint, and rejects remote requests through the existing gate', async () => {
    mount(false);
    for (const path of ['/composition', '/composition/links', '/composition/uses']) {
      expect(await request(path, {})).toMatchObject({ status: 200, body: { reason: 'disabled' } });
      expect((await request(path, {}, '192.0.2.1')).status).toBe(403);
      expect((await request(path, {}, '127.0.0.1', 'https://example.com')).status).toBe(403);
    }
  });
  /**
   * The static index and the live render meet here and nowhere else. The array
   * is the server's; the render count is the page's; neither is a write target
   * on its own, which is what `unproven-entry` protects.
   */
  it('lets a render ordinal name the array entry a mapped prop read', async () => {
    const mapped = `---\nimport Card from '../Card.astro';\nconst cards = [{ title: 'One' }, { title: 'Two' }];\n---\n{cards.map((c) => <Card title={c.title} />)}`;
    await writeFile(join(root, 'src/pages/index.astro'), mapped);
    const chain = '.' + usageId('src/pages/index.astro', locOf(mapped, '<Card'));
    const ask = (ordinals?: Record<string, number>) =>
      request('/composition', { pathname: '/docs/', file: 'src/Card.astro', chain, traceVersion: 2, ordinals });
    const prop = async (ordinals?: Record<string, number>) => (await ask(ordinals)).body.links[0].props[0];

    // Without the ordinal the trace resolves and the entry still does not.
    expect(await prop()).toMatchObject({ verdict: 'read-only', reason: 'unproven-entry' });
    expect(await prop({ [chain.slice(1)]: 2 })).toMatchObject({ verdict: 'editable', value: 'Two' });
    expect(await prop({ [chain.slice(1)]: 1 })).toMatchObject({ verdict: 'editable', value: 'One' });
    // `0` is what a broken chain reports, and 3 is past the end of the array.
    for (const ordinal of [0, 3]) {
      expect(await prop({ [chain.slice(1)]: ordinal }), String(ordinal))
        .toMatchObject({ verdict: 'read-only', reason: 'unproven-entry' });
    }
    // An inferred path names a possible usage site, never the instance that
    // rendered this element — so a render count may not be spent on it.
    const inferred = await request('/composition',
      { pathname: '/docs/', file: 'src/Card.astro', traceVersion: 2, ordinals: { [chain.slice(1)]: 2 } });
    expect(inferred.body.tier).toBe('inferred');
    expect(inferred.body.links[0].props[0]).toMatchObject({ verdict: 'read-only', reason: 'unproven-entry' });
  });

  it.each([null, [], {}, { pathname: 3 }, { ...query(), file: {} }, { ...query(), chain: '.bad' }, { ...query(), traceVersion: 1 },
    { ...query(), ordinals: [] }, { ...query(), ordinals: { bad: 1 } }, { ...query(), ordinals: { abcdefgh: -1 } },
    { ...query(), ordinals: { abcdefgh: 1.5 } }])('rejects malformed requests: %j', async body => {
    expect((await request('/composition', body)).status).toBe(400);
  });
  it('caps batches and chain depth', async () => {
    expect((await request('/composition/links', { pathname: '/docs/', ids: Array(129).fill(id()) })).status).toBe(400);
    expect((await request('/composition', { ...query(), chain: ('.' + id()).repeat(129) })).status).toBe(400);
  });
  it('does not install tracing, scripts or API for builds', async () => {
    const integration = devEdit({});
    const hook = integration.hooks['astro:config:setup']!;
    await hook({ command: 'build', updateConfig() { throw new Error('installed a plugin'); }, injectScript() { throw new Error('injected script'); } } as never);
    await integration.hooks['astro:server:setup']!({ server: { middlewares: { use() { throw new Error('installed middleware'); } } } } as never);
  });
});
