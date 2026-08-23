import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { AstroIntegrationLogger } from 'astro';
import type { Connect } from 'vite';
import { createMiddleware } from '../src/server/middleware.ts';
import type { DevEditOptions } from '../src/server/options.ts';
import { SETTINGS_FILE } from '../src/server/settings.ts';
import type { UnsplashConfig } from '../src/server/unsplash-routes.ts';
import { stubOptions } from './helpers.ts';

/**
 * The **option** half of `GET`/`POST /settings` — the surface the Settings
 * drawer reads and writes.
 *
 * The access-key half stays in `tests/unsplash-routes.test.ts`: those cases
 * exercise the key through the injected `UnsplashConfig` seam, and one of them
 * asserts a stored key reaches the very next *search*, which needs that suite's
 * recording fetch fake. Splitting the key tests away from it would mean
 * duplicating ~80 lines of stub to test the same thing less well.
 *
 * What this file pins instead: that options round-trip through the settings
 * file with no dev-server restart, that a refused patch writes **nothing**, and
 * that an option `astro.config.mjs` owns cannot be overwritten from the browser.
 */

const logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  options: {} as never,
  label: 'test',
  fork: () => logger,
} as unknown as AstroIntegrationLogger;

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'atx-settings-routes-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A middleware whose options resolve for real against `root`, so a write is
 *  visible to the next read without a restart — the property the drawer needs. */
function mount(configOptions: DevEditOptions = {}): Connect.NextHandleFunction {
  const unsplash: UnsplashConfig = {
    resolve: async () => ({ key: '', source: null }),
    enabled: async () => true,
    appName: async () => 'test',
    perPage: async () => 20,
  };
  return createMiddleware({
    logger,
    root,
    optionsResolver: stubOptions(root, configOptions),
    schemaProvider: null,
    routeManifest: null,
    unsplash,
  });
}

function request(opts: {
  method?: string;
  url: string;
  body?: unknown;
  via: Connect.NextHandleFunction;
}): Promise<{ status: number; body: any; raw: string }> {
  const payload = opts.body !== undefined ? Buffer.from(JSON.stringify(opts.body)) : undefined;
  const req = Readable.from(payload ? [payload] : []) as any;
  req.method = opts.method ?? 'POST';
  req.url = opts.url;
  req.headers = {};
  req.socket = { remoteAddress: '127.0.0.1' };

  return new Promise((resolve) => {
    let raw = '';
    const res: any = {
      statusCode: 200,
      setHeader() {},
      end(chunk?: string) {
        raw = chunk ?? '';
        resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null, raw });
      },
    };
    opts.via(req, res, () => resolve({ status: 0, body: null, raw: '' }));
  });
}

const get = (via: Connect.NextHandleFunction) =>
  request({ method: 'GET', url: '/__dev-edit/settings', via });
const put = (options: Record<string, unknown>, via: Connect.NextHandleFunction) =>
  request({ url: '/__dev-edit/settings', body: { options }, via });

const opt = (body: any, key: string) =>
  (body.options as any[]).find((o) => o.key === key);

describe('GET /settings', () => {
  it('describes every option well enough to render a control', async () => {
    const r = await get(mount());
    expect(r.status).toBe(200);
    const cssInspector = opt(r.body, 'cssInspector');
    // The drawer builds its controls entirely from this shape, so each part of
    // it is load-bearing: no client-side table of options exists.
    expect(cssInspector).toMatchObject({
      key: 'cssInspector',
      type: 'boolean',
      group: 'editing',
      value: true,
      source: 'default',
      locked: false,
    });
    expect(cssInspector.label).toBeTruthy();
    expect(cssInspector.help).toBeTruthy();
  });

  it('carries the choice list for a select option', async () => {
    const r = await get(mount());
    expect(opt(r.body, 'sourceAnnotations').choices).toEqual(['auto', 'force', 'off']);
  });

  it('marks config-set options locked, and config-only ones restart-requiring', async () => {
    const r = await get(mount({ uploadDir: 'public/images' }));
    expect(opt(r.body, 'uploadDir')).toMatchObject({
      value: 'public/images',
      source: 'config',
      locked: true,
    });
    expect(opt(r.body, 'uploadDir').restartRequired).toBeUndefined();
    expect(opt(r.body, 'sourceAnnotations')).toMatchObject({
      locked: true,
      restartRequired: true,
    });
  });

  it('touches no filesystem state just by being read', async () => {
    await get(mount());
    expect(existsSync(join(root, SETTINGS_FILE))).toBe(false);
  });
});

describe('POST /settings', () => {
  it('stores a sparse patch and answers with the full new state', async () => {
    const via = mount();
    const saved = await put({ cssInspector: false }, via);
    expect(saved.status).toBe(200);
    expect(opt(saved.body, 'cssInspector')).toMatchObject({ value: false, source: 'file' });
    // Untouched options stay at their defaults rather than being written out.
    expect(opt(saved.body, 'openInEditor')).toMatchObject({ value: true, source: 'default' });
    expect(JSON.parse(await readFile(join(root, SETTINGS_FILE), 'utf8'))).toEqual({
      options: { cssInspector: false },
    });
  });

  it('makes a change visible to the very next request, with no restart', async () => {
    const via = mount();
    await put({ cssInspector: false }, via);
    // /health is what the overlay reads to decide whether to render the chips.
    const health = await request({ method: 'GET', url: '/__dev-edit/health', via });
    expect(health.body.cssInspector).toBe(false);
  });

  it('takes effect on the gate it controls, not just on the report', async () => {
    const via = mount();
    const inspect = () =>
      request({
        url: '/__dev-edit/inspect/open',
        body: { file: 'src/x.css', selector: '.a' },
        via,
      });
    await put({ cssInspector: false }, via);
    expect((await inspect()).status).toBe(403);
    await put({ cssInspector: true, openInEditor: true }, via);
    // Past the feature gate now — it fails later, on the missing file.
    expect((await inspect()).status).not.toBe(403);
  });

  it('merges into the stored document rather than replacing it', async () => {
    const via = mount();
    await put({ cssInspector: false }, via);
    await put({ openInEditor: false }, via);
    expect(JSON.parse(await readFile(join(root, SETTINGS_FILE), 'utf8'))).toEqual({
      options: { cssInspector: false, openInEditor: false },
    });
  });

  it('writes the fixed root path owner-only, leaving no temp file', async () => {
    await put({ cssInspector: false }, mount());
    const target = join(root, SETTINGS_FILE);
    expect(existsSync(target)).toBe(true);
    if (process.platform !== 'win32') {
      expect((await stat(target)).mode & 0o777).toBe(0o600);
    }
    expect((await readdir(root)).filter((f) => f.includes('dev-edit-tmp'))).toEqual([]);
  });

  it('refuses a locked option and writes nothing', async () => {
    const via = mount({ cssInspector: true });
    const r = await put({ cssInspector: false }, via);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('validation');
    expect(r.body.fieldErrors.cssInspector).toContain('astro.config.mjs');
    expect(existsSync(join(root, SETTINGS_FILE))).toBe(false);
  });

  it('refuses a config-only option even when the config is silent about it', async () => {
    const r = await put({ sourceAnnotations: 'off' }, mount());
    expect(r.status).toBe(422);
    expect(r.body.fieldErrors.sourceAnnotations).toContain('astro.config.mjs');
  });

  it('refuses the whole patch when any one key is bad — never half-writes', async () => {
    const via = mount();
    const r = await put({ cssInspector: false, uploadDir: '' }, via);
    expect(r.status).toBe(422);
    expect(Object.keys(r.body.fieldErrors)).toEqual(['uploadDir']);
    // The valid half must not have landed.
    expect(existsSync(join(root, SETTINGS_FILE))).toBe(false);
    expect(opt((await get(via)).body, 'cssInspector').value).toBe(true);
  });

  it('names an unknown option rather than ignoring it', async () => {
    const r = await put({ nonsense: 1 }, mount());
    expect(r.status).toBe(422);
    expect(r.body.fieldErrors.nonsense).toBe('unknown option');
  });

  it('400s a body with nothing to save', async () => {
    const r = await request({ url: '/__dev-edit/settings', body: {}, via: mount() });
    expect(r.status).toBe(400);
  });

  it('narrows the write confinement it is given, immediately', async () => {
    // The security-relevant direction: an option that *restricts* the editor has
    // to bite on the next request, not after a restart.
    const via = mount();
    const apply = () =>
      request({
        url: '/__dev-edit/apply',
        body: {
          file: 'public/x.astro',
          loc: '1:1',
          tag: 'p',
          ops: [{ targetType: 'text', original: 'a', newText: 'b' }],
        },
        via,
      });
    await mkdir(join(root, 'public'), { recursive: true });
    await writeFile(join(root, 'public/x.astro'), '<p>a</p>\n');

    const before = await apply();
    expect(before.body.error).not.toMatch(/outside|content roots/i);

    await put({ contentRoots: ['src'] }, via);
    const after = await apply();
    expect(after.status).toBe(400);
    expect(after.body.error).toMatch(/outside|content roots/i);
  });
});

describe('the fresh-project case', () => {
  it('turns the Unsplash source on from the panel, with no config edit', async () => {
    // This is the whole point of the option editor: the panel used to say "add
    // `unsplash: {}` to astro.config.mjs, then restart the dev server".
    const via = mount();
    expect((await get(via)).body.unsplash.enabled).toBe(false);
    expect(opt((await get(via)).body, 'unsplashEnabled')).toMatchObject({
      value: false,
      locked: false,
    });

    const saved = await put({ unsplashEnabled: true }, via);
    expect(saved.status).toBe(200);
    expect(saved.body.unsplash.enabled).toBe(true);
    expect(opt(saved.body, 'unsplashEnabled').value).toBe(true);
  });
});
