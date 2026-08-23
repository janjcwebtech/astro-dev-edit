import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { AstroIntegrationLogger } from 'astro';
import type { Connect } from 'vite';
import type { AssetInfo } from '../src/shared/protocol.ts';
import { createMiddleware } from '../src/server/middleware.ts';
import { locOf, stubOptions } from './helpers.ts';

/**
 * Characterization tests for the /__dev-edit middleware: every endpoint's
 * status codes, response shapes, and guards, pinned before the refactor.
 * The middleware is invoked directly with mocked req/res against a scaffolded
 * temp project tree — no HTTP server, no Vite.
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

const PAGE_ASTRO = `---
const title = 'Dynamic';
---
<main>
  <p>Editable text</p>
  <h1>{title}</h1>
  <img src="/photo.jpg" alt="A photo">
</main>
`;

/** Separate fixture so the markup tests can rewrite a file freely without
 *  moving the line numbers the /peek tests pin against PAGE_ASTRO. */
const MARKUP_ASTRO = `<main>\n  <h2>Two<br>lines</h2>\n</main>\n`;

let root: string;
let handler: Connect.NextHandleFunction;
// Same tree, but with open-in-editor enabled — used to pin /open's path
// validation (only its rejection paths, so launch-editor is never reached).
let openHandler: Connect.NextHandleFunction;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'atx-test-'));
  await mkdir(join(root, 'public/sub'), { recursive: true });
  await mkdir(join(root, 'src/assets'), { recursive: true });
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await mkdir(join(root, 'src/content'), { recursive: true });
  await writeFile(join(root, 'public/a.jpg'), 'jpg-bytes');
  await writeFile(join(root, 'public/sub/b.png'), 'png-bytes');
  await writeFile(join(root, 'public/readme.txt'), 'not an image');
  await writeFile(join(root, 'src/assets/c.webp'), 'webp-bytes');
  await writeFile(join(root, 'src/pages/index.astro'), PAGE_ASTRO);
  await writeFile(join(root, 'src/pages/markup.astro'), MARKUP_ASTRO);
  await writeFile(join(root, 'src/content/note.md'), '# Note\n\nBody.\n');
  await writeFile(join(root, 'outside.astro'), '<p>Outside content roots</p>\n');
  // Package-owned file: `astro:assets` annotates every <Image> to exactly this
  // path, so the read-only routes must answer *about* it without erroring —
  // while the writing routes must still refuse it.
  await mkdir(join(root, 'node_modules/astro/components'), { recursive: true });
  await writeFile(join(root, 'node_modules/astro/components/Image.astro'), '<img src="x.jpg">\n');
  // Symlink inside the content roots pointing outside them — string-space
  // confinement passes it, realpath confinement must reject it.
  await symlink(join(root, 'outside.astro'), join(root, 'src/pages/link.astro'));

  const deps = {
    logger,
    root,
    optionsResolver: stubOptions(root, { openInEditor: false }),
    schemaProvider: null,
    routeManifest: null,
    unsplash: null,
  };
  handler = createMiddleware(deps);
  openHandler = createMiddleware({
    ...deps,
    optionsResolver: stubOptions(root, { openInEditor: true }),
  });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

interface MockResult {
  status: number;
  body: any;
  nextCalled: boolean;
}

function request(opts: {
  method: string;
  url: string;
  body?: unknown;
  rawBody?: string | Buffer;
  remoteAddress?: string;
  origin?: string;
  /** Middleware instance to hit; defaults to the shared `handler`. */
  via?: Connect.NextHandleFunction;
}): Promise<MockResult> {
  const payload =
    opts.rawBody !== undefined
      ? Buffer.from(opts.rawBody)
      : opts.body !== undefined
        ? Buffer.from(JSON.stringify(opts.body))
        : undefined;
  const req = Readable.from(payload ? [payload] : []) as any;
  req.method = opts.method;
  req.url = opts.url;
  req.headers = opts.origin ? { origin: opts.origin } : {};
  req.socket = { remoteAddress: opts.remoteAddress ?? '127.0.0.1' };

  return new Promise((resolve, reject) => {
    const res: any = {
      statusCode: 200,
      setHeader() {},
      end(raw: string) {
        let body: any = raw;
        try {
          body = JSON.parse(raw);
        } catch {
          // leave as raw string
        }
        resolve({ status: res.statusCode, body, nextCalled: false });
      },
    };
    const next = () => resolve({ status: -1, body: null, nextCalled: true });
    try {
      (opts.via ?? handler)(req, res, next);
    } catch (err) {
      reject(err);
    }
  });
}

describe('routing & guards', () => {
  it('passes non-/__dev-edit requests through to next()', async () => {
    const r = await request({ method: 'GET', url: '/some/page' });
    expect(r.nextCalled).toBe(true);
  });

  it('rejects non-localhost remote addresses with 403', async () => {
    const r = await request({ method: 'GET', url: '/__dev-edit/health', remoteAddress: '192.168.1.50' });
    expect(r.status).toBe(403);
  });

  it('rejects a foreign Origin header with 403', async () => {
    const r = await request({ method: 'GET', url: '/__dev-edit/health', origin: 'https://evil.example' });
    expect(r.status).toBe(403);
  });

  it('accepts a localhost Origin header', async () => {
    const r = await request({ method: 'GET', url: '/__dev-edit/health', origin: 'http://localhost:4321' });
    expect(r.status).toBe(200);
  });

  it('GET /health returns ok', async () => {
    const r = await request({ method: 'GET', url: '/__dev-edit/health' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, name: 'astro-dev-edit' });
  });

  it('GET /health reports the project root, so the overlay can relativize the absolute source annotations', async () => {
    const r = await request({ method: 'GET', url: '/__dev-edit/health' });
    expect(r.body).toMatchObject({ root, cssInspector: true });
  });

  it('GET /healthX no longer matches /health — routes are exact-path (intentional tightening)', async () => {
    // Pre-refactor this returned 200 via prefix matching; the route table
    // matches exact pathnames. The client only ever calls exact paths.
    const r = await request({ method: 'GET', url: '/__dev-edit/healthX' });
    expect(r.status).toBe(404);
  });

  it('matches routes with a query string appended', async () => {
    const r = await request({ method: 'GET', url: '/__dev-edit/health?x=1' });
    expect(r.status).toBe(200);
  });

  it('unknown route under the base returns 404', async () => {
    const r = await request({ method: 'POST', url: '/__dev-edit/nope' });
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ error: 'not implemented' });
  });
});

describe('GET /assets', () => {
  it('lists images from asset dirs as sorted web paths, public/ mapped to /', async () => {
    const r = await request({ method: 'GET', url: '/__dev-edit/assets' });
    expect(r.status).toBe(200);
    expect(r.body.files.map((f: AssetInfo) => f.path)).toEqual([
      '/a.jpg',
      '/src/assets/c.webp',
      '/sub/b.png',
    ]);
  });
});

describe('POST /upload', () => {
  const PNG_B64 = Buffer.from('fake-png-bytes').toString('base64');

  it('writes a base64 data-URL into the upload dir and returns its web path', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/upload',
      body: { dataUrl: `data:image/png;base64,${PNG_B64}`, filename: 'shot.png' },
    });
    expect(r.status).toBe(200);
    expect(r.body.webPath).toBe('/shot.png');
    expect(String(await readFile(join(root, 'public/shot.png')))).toBe('fake-png-bytes');
  });

  it('suffixes on a name clash instead of overwriting', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/upload',
      body: { dataUrl: `data:image/png;base64,${PNG_B64}`, filename: 'shot.png' },
    });
    expect(r.status).toBe(200);
    expect(r.body.webPath).toBe('/shot-1.png');
  });

  it('sanitises path-traversal filenames to a safe basename', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/upload',
      body: { dataUrl: `data:image/png;base64,${PNG_B64}`, filename: '../../etc/passwd' },
    });
    expect(r.status).toBe(200);
    expect(r.body.webPath).toBe('/passwd.png');
  });

  it('rejects unsupported mime types with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/upload',
      body: { dataUrl: 'data:text/plain;base64,aGk=', filename: 'x.txt' },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('unsupported image type');
  });

  it('rejects a non-data-URL payload with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/upload',
      body: { dataUrl: 'https://example.com/x.png', filename: 'x.png' },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('expected a data: URL');
  });

  // An image() field's asset is imported by Astro, so it belongs under src/ —
  // and lands beside the field's existing asset when one is known.
  describe('assetRef: relative', () => {
    it('falls back to imageUploadDir when no target is given', async () => {
      const r = await request({
        method: 'POST',
        url: '/__dev-edit/upload',
        body: {
          dataUrl: `data:image/png;base64,${PNG_B64}`,
          filename: 'cover.png',
          assetRef: 'relative',
        },
      });
      expect(r.status).toBe(200);
      expect(r.body.webPath).toBe('/src/assets/cover.png');
    });

    it('honours a target directory inside a configured asset dir', async () => {
      const r = await request({
        method: 'POST',
        url: '/__dev-edit/upload',
        body: {
          dataUrl: `data:image/png;base64,${PNG_B64}`,
          filename: 'hero.png',
          assetRef: 'relative',
          targetDir: 'src/assets/blog',
        },
      });
      expect(r.status).toBe(200);
      expect(r.body.webPath).toBe('/src/assets/blog/hero.png');
      expect(String(await readFile(join(root, 'src/assets/blog/hero.png')))).toBe('fake-png-bytes');
    });

    it('ignores a target outside the configured asset dirs', async () => {
      const r = await request({
        method: 'POST',
        url: '/__dev-edit/upload',
        body: {
          dataUrl: `data:image/png;base64,${PNG_B64}`,
          filename: 'sneaky.png',
          assetRef: 'relative',
          targetDir: 'src/pages',
        },
      });
      expect(r.status).toBe(200);
      // Written to the fallback, not the requested dir.
      expect(r.body.webPath).toBe('/src/assets/sneaky.png');
      await expect(readFile(join(root, 'src/pages/sneaky.png'))).rejects.toThrow();
    });

    it('ignores a target that escapes the project root', async () => {
      const r = await request({
        method: 'POST',
        url: '/__dev-edit/upload',
        body: {
          dataUrl: `data:image/png;base64,${PNG_B64}`,
          filename: 'escape.png',
          assetRef: 'relative',
          targetDir: '../../../tmp',
        },
      });
      expect(r.status).toBe(200);
      expect(r.body.webPath).toBe('/src/assets/escape.png');
    });

    it('refuses an animated GIF, which Astro would flatten', async () => {
      const gif = Buffer.from('fake-gif-bytes').toString('base64');
      const r = await request({
        method: 'POST',
        url: '/__dev-edit/upload',
        body: {
          dataUrl: `data:image/gif;base64,${gif}`,
          filename: 'spin.gif',
          assetRef: 'relative',
        },
      });
      expect(r.status).toBe(422);
      expect(r.body.code).toBe('unsupported');
      expect(r.body.error).toContain('public/');
    });

    it('still accepts a GIF for a plain web-path upload', async () => {
      const gif = Buffer.from('fake-gif-bytes').toString('base64');
      const r = await request({
        method: 'POST',
        url: '/__dev-edit/upload',
        body: { dataUrl: `data:image/gif;base64,${gif}`, filename: 'spin.gif' },
      });
      expect(r.status).toBe(200);
      expect(r.body.webPath).toBe('/spin.gif');
    });

    it('honours a target for a plain web-path upload too', async () => {
      const r = await request({
        method: 'POST',
        url: '/__dev-edit/upload',
        body: {
          dataUrl: `data:image/png;base64,${PNG_B64}`,
          filename: 'in-sub.png',
          targetDir: 'public/sub',
        },
      });
      expect(r.status).toBe(200);
      expect(r.body.webPath).toBe('/sub/in-sub.png');
    });
  });
});

describe('POST /open', () => {
  it('returns 403 when open-in-editor is disabled by configuration', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/open',
      body: { file: 'src/pages/index.astro' },
    });
    expect(r.status).toBe(403);
  });

  // Path validation matches /classify and /apply (validateEditablePath):
  // realpath inside the project root and a content root, allowed extension.
  it('rejects files outside the content roots with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/open',
      body: { file: 'outside.astro' },
      via: openHandler,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('content roots');
  });

  it('rejects a symlink that resolves outside the content roots with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/open',
      body: { file: 'src/pages/link.astro' },
      via: openHandler,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('content roots');
  });

  // The read-only routes softened for node_modules paths; the gate on routes
  // that act on a file must NOT have. Package internals stay untouchable.
  it('still rejects a package-owned node_modules path with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/open',
      body: { file: 'node_modules/astro/components/Image.astro' },
      via: openHandler,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('content roots');
  });

  it('rejects disallowed extensions with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/open',
      body: { file: 'public/readme.txt' },
      via: openHandler,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('not editable');
  });

  it('rejects nonexistent files with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/open',
      body: { file: 'src/pages/missing.astro' },
      via: openHandler,
    });
    expect(r.status).toBe(400);
  });

  it('rejects a missing file field with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/open',
      body: {},
      via: openHandler,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('required');
  });
});

describe('POST /peek', () => {
  it('returns the line window around the focus line with metadata', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/peek',
      body: { file: 'src/pages/index.astro', loc: '5:3' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      file: 'src/pages/index.astro',
      startLine: 1,
      focusLine: 5,
      totalLines: 8,
    });
    expect(r.body.lines).toHaveLength(8);
    expect(r.body.lines[4]).toContain('Editable text');
  });

  it('returns the whole file for normally sized sources', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    await writeFile(join(root, 'src/content/long.md'), lines.join('\n') + '\n');
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/peek',
      body: { file: 'src/content/long.md', loc: '50:1' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ startLine: 1, focusLine: 50, totalLines: 100 });
    expect(r.body.lines).toHaveLength(100);
    expect(r.body.lines[0]).toBe('line 1');
    expect(r.body.lines[99]).toBe('line 100');
  });

  it('caps a pathological file to ±1000 lines around the focus', async () => {
    const lines = Array.from({ length: 2500 }, (_, i) => `line ${i + 1}`);
    await writeFile(join(root, 'src/content/huge.md'), lines.join('\n') + '\n');
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/peek',
      body: { file: 'src/content/huge.md', loc: '1500:1' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ startLine: 500, focusLine: 1500, totalLines: 2500 });
    expect(r.body.lines).toHaveLength(2001);
    expect(r.body.lines[0]).toBe('line 500');
    expect(r.body.lines[2000]).toBe('line 2500');
  });

  it('defaults to the top without a loc and clamps an out-of-range line', async () => {
    const top = await request({
      method: 'POST',
      url: '/__dev-edit/peek',
      body: { file: 'src/pages/index.astro' },
    });
    expect(top.status).toBe(200);
    expect(top.body.focusLine).toBe(1);
    const beyond = await request({
      method: 'POST',
      url: '/__dev-edit/peek',
      body: { file: 'src/pages/index.astro', loc: '999:1' },
    });
    expect(beyond.status).toBe(200);
    expect(beyond.body.focusLine).toBe(8);
  });

  // Out-of-root is a verdict, not an error: clicking the hover pill's file:loc
  // label on an `astro:assets` <Image> lands here with a node_modules path.
  it('refuses files outside the content roots with 200 and no source', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/peek',
      body: { file: 'outside.astro', loc: '1:1' },
    });
    expect(r.status).toBe(200);
    expect(r.body.refused).toBeTruthy();
    expect(r.body.lines).toEqual([]);
  });

  it('names the package when refusing a node_modules path', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/peek',
      body: { file: 'node_modules/astro/components/Image.astro', loc: '1:1' },
    });
    expect(r.status).toBe(200);
    expect(r.body.refused).toContain('package component');
    expect(r.body.lines).toEqual([]);
  });

  it('rejects nonexistent files with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/peek',
      body: { file: 'src/pages/missing.astro', loc: '1:1' },
    });
    expect(r.status).toBe(400);
  });

  it('rejects a missing file field with 400', async () => {
    const r = await request({ method: 'POST', url: '/__dev-edit/peek', body: {} });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('required');
  });
});

describe('POST /classify', () => {
  it('classifies literal text in a real .astro file', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/classify',
      body: { file: 'src/pages/index.astro', loc: locOf(PAGE_ASTRO, 'Editable text'), tag: 'p' },
    });
    expect(r.status).toBe(200);
    expect(r.body.kind).toBe('text');
  });

  it('classifies text carrying an inline tag as markup, with the inner source', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/classify',
      body: { file: 'src/pages/markup.astro', loc: locOf(MARKUP_ASTRO, 'Two<br>'), tag: 'h2' },
    });
    expect(r.status).toBe(200);
    expect(r.body.kind).toBe('markup');
    expect(r.body.markup).toEqual({ html: 'Two<br>lines' });
  });

  it('answers 200 dynamic for editable non-.astro files (.md)', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/classify',
      body: { file: 'src/content/note.md', loc: '1:1', tag: 'h1' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      kind: 'dynamic',
      reason: 'Only .astro templates support in-place editing so far.',
    });
  });

  // The hover tooltip calls /classify too, so an out-of-root path must answer
  // "not editable" instead of throwing — otherwise every `astro:assets`
  // <Image> on the page logs a WARN just from being hovered.
  it('answers 200 dynamic for files outside the content roots', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/classify',
      body: { file: 'outside.astro', loc: '1:1', tag: 'p' },
    });
    expect(r.status).toBe(200);
    expect(r.body.kind).toBe('dynamic');
    expect(r.body.reason).toBeTruthy();
  });

  it('answers 200 dynamic naming the package for a node_modules path', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/classify',
      body: { file: 'node_modules/astro/components/Image.astro', loc: '1:1', tag: 'img' },
    });
    expect(r.status).toBe(200);
    expect(r.body.kind).toBe('dynamic');
    expect(r.body.reason).toContain('package component');
  });

  it('still answers 200 dynamic for a symlink resolving outside the roots', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/classify',
      body: { file: 'src/pages/link.astro', loc: '1:1', tag: 'p' },
    });
    expect(r.status).toBe(200);
    expect(r.body.kind).toBe('dynamic');
  });

  it('rejects nonexistent files with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/classify',
      body: { file: 'src/pages/missing.astro', loc: '1:1', tag: 'p' },
    });
    expect(r.status).toBe(400);
  });

  it('rejects missing fields with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/classify',
      body: { file: 'src/pages/index.astro' },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('required');
  });
});

describe('POST /apply', () => {
  it('patches the file on disk atomically and returns ok', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/apply',
      body: {
        file: 'src/pages/index.astro',
        loc: locOf(PAGE_ASTRO, 'Editable text'),
        tag: 'p',
        ops: [{ targetType: 'text', original: 'Editable text', newText: 'Patched text' }],
      },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    const after = String(await readFile(join(root, 'src/pages/index.astro')));
    expect(after).toContain('<p>Patched text</p>');
    // atomic write leaves no temp file behind
    const leftovers = (await readdir(join(root, 'src/pages'))).filter((f) => f.includes('dev-edit-tmp'));
    expect(leftovers).toEqual([]);
    // restore for other tests
    await writeFile(join(root, 'src/pages/index.astro'), PAGE_ASTRO);
  await writeFile(join(root, 'src/pages/markup.astro'), MARKUP_ASTRO);
  });

  it('accepts a markup op and writes the inline tags through unescaped', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/apply',
      body: {
        file: 'src/pages/markup.astro',
        loc: locOf(MARKUP_ASTRO, 'Two<br>'),
        tag: 'h2',
        ops: [{ targetType: 'markup', original: 'Two<br>lines', newText: 'Two<br><strong>lines</strong>' }],
      },
    });
    expect(r.status).toBe(200);
    const after = String(await readFile(join(root, 'src/pages/markup.astro')));
    expect(after).toContain('<h2>Two<br><strong>lines</strong></h2>');
    await writeFile(join(root, 'src/pages/markup.astro'), MARKUP_ASTRO);
  await writeFile(join(root, 'src/pages/markup.astro'), MARKUP_ASTRO);
  });

  it('answers 422 unsupported when a markup op carries a tag outside the safelist', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/apply',
      body: {
        file: 'src/pages/markup.astro',
        loc: locOf(MARKUP_ASTRO, 'Two<br>'),
        tag: 'h2',
        ops: [{ targetType: 'markup', original: 'Two<br>lines', newText: 'Two<script>x()</script>' }],
      },
    });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('unsupported');
    expect(String(await readFile(join(root, 'src/pages/markup.astro')))).toBe(MARKUP_ASTRO);
  });

  it('answers 422 unsupported for editable non-.astro files (.md)', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/apply',
      body: {
        file: 'src/content/note.md',
        loc: '1:1',
        tag: 'h1',
        ops: [{ targetType: 'text', original: 'Note', newText: 'New' }],
      },
    });
    expect(r.status).toBe(422);
    expect(r.body).toEqual({
      error: 'Only .astro templates support in-place editing so far.',
      code: 'unsupported',
    });
  });

  it('answers 422 with the refusal code when the patcher refuses (mismatch)', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/apply',
      body: {
        file: 'src/pages/index.astro',
        loc: locOf(PAGE_ASTRO, 'Editable text'),
        tag: 'p',
        ops: [{ targetType: 'text', original: 'Stale text the page never showed', newText: 'X' }],
      },
    });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('mismatch');
  });

  // /classify and /peek answer softly for package paths; the write path must
  // still refuse outright and leave the package file byte-identical.
  it('refuses to write to a package-owned node_modules path with 400', async () => {
    const target = join(root, 'node_modules/astro/components/Image.astro');
    const before = String(await readFile(target));
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/apply',
      body: {
        file: 'node_modules/astro/components/Image.astro',
        loc: '1:1',
        tag: 'img',
        ops: [{ targetType: 'src', original: 'x.jpg', newText: 'hacked.jpg' }],
      },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('content roots');
    expect(String(await readFile(target))).toBe(before);
  });

  it('batches multiple ops into a single atomic write (img src + alt)', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/apply',
      body: {
        file: 'src/pages/index.astro',
        loc: locOf(PAGE_ASTRO, 'img src='),
        tag: 'img',
        ops: [
          { targetType: 'src', original: '/photo.jpg', newText: '/new.jpg' },
          { targetType: 'alt', original: 'A photo', newText: 'A new photo' },
        ],
      },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    const after = String(await readFile(join(root, 'src/pages/index.astro')));
    // The second op re-parses the source the first op already changed, so both
    // edits land together.
    expect(after).toContain('src="/new.jpg"');
    expect(after).toContain('alt="A new photo"');
    await writeFile(join(root, 'src/pages/index.astro'), PAGE_ASTRO);
  await writeFile(join(root, 'src/pages/markup.astro'), MARKUP_ASTRO);
  });

  it('writes nothing when any op in a batch is refused (no partial write)', async () => {
    const before = String(await readFile(join(root, 'src/pages/index.astro')));
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/apply',
      body: {
        file: 'src/pages/index.astro',
        loc: locOf(PAGE_ASTRO, 'img src='),
        tag: 'img',
        ops: [
          // The first op would succeed on its own...
          { targetType: 'src', original: '/photo.jpg', newText: '/new.jpg' },
          // ...but the second fails to verify, so the whole batch is rolled back.
          { targetType: 'alt', original: 'Stale alt the page never showed', newText: 'X' },
        ],
      },
    });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('mismatch');
    const after = String(await readFile(join(root, 'src/pages/index.astro')));
    expect(after).toBe(before);
    expect(after).toContain('src="/photo.jpg"');
  });

  it('rejects an empty ops array with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/apply',
      body: { file: 'src/pages/index.astro', loc: '1:1', tag: 'p', ops: [] },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('ops');
  });

  it('rejects a bad targetType with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/apply',
      body: {
        file: 'src/pages/index.astro',
        loc: '1:1',
        tag: 'p',
        ops: [{ targetType: 'href', original: '', newText: '' }],
      },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('bad targetType');
  });

  it('rejects non-string original/newText with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/apply',
      body: {
        file: 'src/pages/index.astro',
        loc: '1:1',
        tag: 'p',
        ops: [{ targetType: 'text', original: 42, newText: 'x' }],
      },
    });
    expect(r.status).toBe(400);
  });

  it('rejects an oversized body with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__dev-edit/apply',
      rawBody: 'x'.repeat(256 * 1024 + 1),
    });
    expect(r.status).toBe(400);
  });

  it('rejects malformed JSON with 400', async () => {
    const r = await request({ method: 'POST', url: '/__dev-edit/apply', rawBody: '{not json' });
    expect(r.status).toBe(400);
  });
});
