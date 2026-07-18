import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { AstroIntegrationLogger } from 'astro';
import type { Connect } from 'vite';
import { createMiddleware } from '../src/server/middleware.ts';
import { locOf } from './helpers.ts';

/**
 * Characterization tests for the /__text-edit middleware: every endpoint's
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
  await writeFile(join(root, 'src/content/note.md'), '# Note\n\nBody.\n');
  await writeFile(join(root, 'outside.astro'), '<p>Outside content roots</p>\n');
  // Symlink inside the content roots pointing outside them — string-space
  // confinement passes it, realpath confinement must reject it.
  await symlink(join(root, 'outside.astro'), join(root, 'src/pages/link.astro'));

  const deps = {
    logger,
    root,
    assetDirs: ['src/assets', 'public'],
    uploadDir: 'public',
    contentRoots: ['src', 'public'],
    editableExtensions: ['.astro', '.md', '.mdx'],
    openInEditor: false,
    entryEditorEnabled: true,
    schemaProvider: null,
  };
  handler = createMiddleware(deps);
  openHandler = createMiddleware({ ...deps, openInEditor: true });
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
  it('passes non-/__text-edit requests through to next()', async () => {
    const r = await request({ method: 'GET', url: '/some/page' });
    expect(r.nextCalled).toBe(true);
  });

  it('rejects non-localhost remote addresses with 403', async () => {
    const r = await request({ method: 'GET', url: '/__text-edit/health', remoteAddress: '192.168.1.50' });
    expect(r.status).toBe(403);
  });

  it('rejects a foreign Origin header with 403', async () => {
    const r = await request({ method: 'GET', url: '/__text-edit/health', origin: 'https://evil.example' });
    expect(r.status).toBe(403);
  });

  it('accepts a localhost Origin header', async () => {
    const r = await request({ method: 'GET', url: '/__text-edit/health', origin: 'http://localhost:4321' });
    expect(r.status).toBe(200);
  });

  it('GET /health returns ok', async () => {
    const r = await request({ method: 'GET', url: '/__text-edit/health' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, name: 'astro-text-edit' });
  });

  it('GET /healthX no longer matches /health — routes are exact-path (intentional tightening)', async () => {
    // Pre-refactor this returned 200 via prefix matching; the route table
    // matches exact pathnames. The client only ever calls exact paths.
    const r = await request({ method: 'GET', url: '/__text-edit/healthX' });
    expect(r.status).toBe(404);
  });

  it('matches routes with a query string appended', async () => {
    const r = await request({ method: 'GET', url: '/__text-edit/health?x=1' });
    expect(r.status).toBe(200);
  });

  it('unknown route under the base returns 404', async () => {
    const r = await request({ method: 'POST', url: '/__text-edit/nope' });
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ error: 'not implemented' });
  });
});

describe('GET /assets', () => {
  it('lists images from asset dirs as sorted web paths, public/ mapped to /', async () => {
    const r = await request({ method: 'GET', url: '/__text-edit/assets' });
    expect(r.status).toBe(200);
    expect(r.body.files).toEqual(['/a.jpg', '/src/assets/c.webp', '/sub/b.png']);
  });
});

describe('POST /upload', () => {
  const PNG_B64 = Buffer.from('fake-png-bytes').toString('base64');

  it('writes a base64 data-URL into the upload dir and returns its web path', async () => {
    const r = await request({
      method: 'POST',
      url: '/__text-edit/upload',
      body: { dataUrl: `data:image/png;base64,${PNG_B64}`, filename: 'shot.png' },
    });
    expect(r.status).toBe(200);
    expect(r.body.webPath).toBe('/shot.png');
    expect(String(await readFile(join(root, 'public/shot.png')))).toBe('fake-png-bytes');
  });

  it('suffixes on a name clash instead of overwriting', async () => {
    const r = await request({
      method: 'POST',
      url: '/__text-edit/upload',
      body: { dataUrl: `data:image/png;base64,${PNG_B64}`, filename: 'shot.png' },
    });
    expect(r.status).toBe(200);
    expect(r.body.webPath).toBe('/shot-1.png');
  });

  it('sanitises path-traversal filenames to a safe basename', async () => {
    const r = await request({
      method: 'POST',
      url: '/__text-edit/upload',
      body: { dataUrl: `data:image/png;base64,${PNG_B64}`, filename: '../../etc/passwd' },
    });
    expect(r.status).toBe(200);
    expect(r.body.webPath).toBe('/passwd.png');
  });

  it('rejects unsupported mime types with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__text-edit/upload',
      body: { dataUrl: 'data:text/plain;base64,aGk=', filename: 'x.txt' },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('unsupported image type');
  });

  it('rejects a non-data-URL payload with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__text-edit/upload',
      body: { dataUrl: 'https://example.com/x.png', filename: 'x.png' },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('expected a data: URL');
  });
});

describe('POST /open', () => {
  it('returns 403 when open-in-editor is disabled by configuration', async () => {
    const r = await request({
      method: 'POST',
      url: '/__text-edit/open',
      body: { file: 'src/pages/index.astro' },
    });
    expect(r.status).toBe(403);
  });

  // Path validation matches /classify and /apply (validateEditablePath):
  // realpath inside the project root and a content root, allowed extension.
  it('rejects files outside the content roots with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__text-edit/open',
      body: { file: 'outside.astro' },
      via: openHandler,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('content roots');
  });

  it('rejects a symlink that resolves outside the content roots with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__text-edit/open',
      body: { file: 'src/pages/link.astro' },
      via: openHandler,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('content roots');
  });

  it('rejects disallowed extensions with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__text-edit/open',
      body: { file: 'public/readme.txt' },
      via: openHandler,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('not editable');
  });

  it('rejects nonexistent files with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__text-edit/open',
      body: { file: 'src/pages/missing.astro' },
      via: openHandler,
    });
    expect(r.status).toBe(400);
  });

  it('rejects a missing file field with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__text-edit/open',
      body: {},
      via: openHandler,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('required');
  });
});

describe('POST /classify', () => {
  it('classifies literal text in a real .astro file', async () => {
    const r = await request({
      method: 'POST',
      url: '/__text-edit/classify',
      body: { file: 'src/pages/index.astro', loc: locOf(PAGE_ASTRO, 'Editable text'), tag: 'p' },
    });
    expect(r.status).toBe(200);
    expect(r.body.kind).toBe('text');
  });

  it('answers 200 dynamic for editable non-.astro files (.md)', async () => {
    const r = await request({
      method: 'POST',
      url: '/__text-edit/classify',
      body: { file: 'src/content/note.md', loc: '1:1', tag: 'h1' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      kind: 'dynamic',
      reason: 'Only .astro templates support in-place editing so far.',
    });
  });

  it('rejects files outside the content roots with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__text-edit/classify',
      body: { file: 'outside.astro', loc: '1:1', tag: 'p' },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('content roots');
  });

  it('rejects nonexistent files with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__text-edit/classify',
      body: { file: 'src/pages/missing.astro', loc: '1:1', tag: 'p' },
    });
    expect(r.status).toBe(400);
  });

  it('rejects missing fields with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__text-edit/classify',
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
      url: '/__text-edit/apply',
      body: {
        file: 'src/pages/index.astro',
        loc: locOf(PAGE_ASTRO, 'Editable text'),
        tag: 'p',
        targetType: 'text',
        original: 'Editable text',
        newText: 'Patched text',
      },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    const after = String(await readFile(join(root, 'src/pages/index.astro')));
    expect(after).toContain('<p>Patched text</p>');
    // atomic write leaves no temp file behind
    const leftovers = (await readdir(join(root, 'src/pages'))).filter((f) => f.includes('text-edit-tmp'));
    expect(leftovers).toEqual([]);
    // restore for other tests
    await writeFile(join(root, 'src/pages/index.astro'), PAGE_ASTRO);
  });

  it('answers 422 unsupported for editable non-.astro files (.md)', async () => {
    const r = await request({
      method: 'POST',
      url: '/__text-edit/apply',
      body: {
        file: 'src/content/note.md',
        loc: '1:1',
        tag: 'h1',
        targetType: 'text',
        original: 'Note',
        newText: 'New',
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
      url: '/__text-edit/apply',
      body: {
        file: 'src/pages/index.astro',
        loc: locOf(PAGE_ASTRO, 'Editable text'),
        tag: 'p',
        targetType: 'text',
        original: 'Stale text the page never showed',
        newText: 'X',
      },
    });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('mismatch');
  });

  it('rejects a bad targetType with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__text-edit/apply',
      body: {
        file: 'src/pages/index.astro',
        loc: '1:1',
        tag: 'p',
        targetType: 'href',
        original: '',
        newText: '',
      },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('bad targetType');
  });

  it('rejects non-string original/newText with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__text-edit/apply',
      body: {
        file: 'src/pages/index.astro',
        loc: '1:1',
        tag: 'p',
        targetType: 'text',
        original: 42,
        newText: 'x',
      },
    });
    expect(r.status).toBe(400);
  });

  it('rejects an oversized body with 400', async () => {
    const r = await request({
      method: 'POST',
      url: '/__text-edit/apply',
      rawBody: 'x'.repeat(256 * 1024 + 1),
    });
    expect(r.status).toBe(400);
  });

  it('rejects malformed JSON with 400', async () => {
    const r = await request({ method: 'POST', url: '/__text-edit/apply', rawBody: '{not json' });
    expect(r.status).toBe(400);
  });
});
