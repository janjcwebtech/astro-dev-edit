import type { AstroIntegrationLogger } from 'astro';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect } from 'vite';
import { mkdir, readdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { applyAstro, classifyAstro, type ApplyRequest } from './patcher/astro.ts';

/**
 * Dev-server middleware for astro-text-edit.
 *
 * Endpoints: health, read-only asset listing, image upload, open-in-editor,
 * and the real source-editing pair — /classify (AST-truth classification) and
 * /apply (verified, atomic source patch). Every endpoint rejects non-localhost
 * requests — this API is strictly for the developer's own machine. (spec §8)
 */

const BASE = '/__text-edit';

interface MiddlewareDeps {
  logger: AstroIntegrationLogger;
  /** Project root (fsPath). Every served path is confined to this. */
  root: string;
  /** Directories the asset listing may read from, relative to root. */
  assetDirs: string[];
  /** Directories writes are confined to, relative to root. (spec §8) */
  contentRoots: string[];
  /** Extensions the patcher may write. (spec §8) */
  editableExtensions: string[];
  /** Expose the open-in-editor endpoint. */
  openInEditor: boolean;
}

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.svg']);

/** List image files under the configured asset dirs, as web-servable paths.
 *  Read-only. Every directory is confined to the project root. (spec §6.3, §8) */
async function listAssets(root: string, assetDirs: string[]): Promise<string[]> {
  // A Set because asset dirs may nest (e.g. public/photos inside public).
  const out = new Set<string>();
  for (const dir of assetDirs) {
    const abs = resolve(root, dir);
    // Refuse anything that escaped the root (e.g. via `..`). (spec §8)
    const rel = relative(root, abs);
    if (rel.startsWith('..') || rel.startsWith(sep)) continue;
    let entries: string[];
    try {
      entries = await walk(abs);
    } catch {
      continue; // dir may not exist; skip quietly
    }
    for (const file of entries) {
      const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
      if (!IMAGE_EXT.has(ext)) continue;
      // `public/` maps to the site root; everything else keeps its project path.
      const relToRoot = relative(root, file).split(sep).join('/');
      const webPath = relToRoot.startsWith('public/')
        ? '/' + relToRoot.slice('public/'.length)
        : '/' + relToRoot;
      out.add(webPath);
    }
  }
  return [...out].sort();
}

async function walk(dir: string): Promise<string[]> {
  const found: string[] = [];
  const items = await readdir(dir, { withFileTypes: true });
  for (const item of items) {
    const full = join(dir, item.name);
    if (item.isDirectory()) found.push(...(await walk(full)));
    else if (item.isFile()) found.push(full);
  }
  return found;
}

/** Read a request body up to a size cap. */
function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        rej(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => res(Buffer.concat(chunks)));
    req.on('error', rej);
  });
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
};

/** Sanitise a user-supplied filename to a safe basename with an allowed ext. */
function safeFileName(name: string, fallbackExt: string): string {
  const base = basename(name).replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+/, '');
  let ext = extname(base).toLowerCase();
  let stem = base.slice(0, base.length - ext.length) || 'image';
  if (!IMAGE_EXT.has(ext)) ext = fallbackExt;
  return `${stem}${ext}`;
}

/**
 * Write an uploaded image into an asset directory. Accepts a data-URL. The
 * destination is confined to a configured asset dir inside the project root,
 * the extension must be an allowed image type, and the name is sanitised. On a
 * name clash a numeric suffix is added rather than overwriting. Returns the
 * web-servable path. (safe: writes a NEW asset file, never patches source)
 */
async function saveUpload(
  root: string,
  assetDirs: string[],
  payload: { dataUrl: string; filename: string },
): Promise<{ webPath: string }> {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(payload.dataUrl ?? '');
  if (!m) throw new Error('expected a data: URL');
  const mime = m[1].toLowerCase();
  const fallbackExt = EXT_BY_MIME[mime];
  if (!fallbackExt) throw new Error(`unsupported image type: ${mime}`);
  const data = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));

  // Target the first configured asset dir that lives inside the root.
  const dir = assetDirs
    .map((d) => resolve(root, d))
    .find((abs) => {
      const rel = relative(root, abs);
      return !rel.startsWith('..') && !rel.startsWith(sep);
    });
  if (!dir) throw new Error('no writable asset directory configured');

  const fileName = safeFileName(payload.filename || 'upload', fallbackExt);
  let target = join(dir, fileName);
  // Confirm the resolved target is still inside the asset dir. (spec §8)
  if (relative(dir, target).startsWith('..')) throw new Error('path escapes asset dir');

  // Avoid clobbering an existing file.
  const stem = fileName.slice(0, fileName.length - extname(fileName).length);
  const ext = extname(fileName);
  let n = 1;
  const existing = new Set(await walk(dir).catch(() => []));
  while (existing.has(target)) {
    target = join(dir, `${stem}-${n++}${ext}`);
  }

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data);

  const relToRoot = relative(root, target).split(sep).join('/');
  const webPath = relToRoot.startsWith('public/')
    ? '/' + relToRoot.slice('public/'.length)
    : '/' + relToRoot;
  return { webPath };
}

/**
 * Resolve and validate a client-supplied source path for editing. The real
 * path (symlinks resolved) must live inside the project root AND inside one of
 * the configured content roots, with an allowed extension. Throws otherwise.
 * (spec §8)
 */
async function validateEditablePath(
  root: string,
  contentRoots: string[],
  editableExtensions: string[],
  file: string,
): Promise<string> {
  const abs = await realpath(resolve(root, file)); // throws if it doesn't exist
  const rootReal = await realpath(root);
  const rel = relative(rootReal, abs);
  if (!rel || rel.startsWith('..') || rel.startsWith(sep)) {
    throw new Error('path escapes the project root');
  }
  const inContentRoot = contentRoots.some(
    (cr) => rel === cr || rel.startsWith(cr.endsWith(sep) ? cr : cr + sep),
  );
  if (!inContentRoot) throw new Error('path is outside the editable content roots');
  if (!editableExtensions.includes(extname(abs).toLowerCase())) {
    throw new Error(`files of type ${extname(abs) || '(none)'} are not editable`);
  }
  return abs;
}

/** Write atomically: temp file in the same directory, then rename. (spec §10) */
async function atomicWrite(target: string, content: string): Promise<void> {
  const tmp = join(dirname(target), `.${basename(target)}.text-edit-tmp-${process.pid}`);
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, target);
}

/** Reject anything that isn't a same-machine request. (spec §8) */
function isLocalRequest(req: Connect.IncomingMessage): boolean {
  const remote = req.socket.remoteAddress ?? '';
  const localAddrs = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
  if (!localAddrs.includes(remote)) return false;

  // If an Origin header is present it must be a localhost origin — this blocks
  // a page on another site from POSTing to our dev endpoints via the browser.
  const origin = req.headers.origin;
  if (origin) {
    try {
      const host = new URL(origin).hostname;
      if (host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]') {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(payload);
}

export function createMiddleware({
  logger,
  root,
  assetDirs,
  contentRoots,
  editableExtensions,
  openInEditor,
}: MiddlewareDeps): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = req.url ?? '';
    if (!url.startsWith(BASE)) {
      next();
      return;
    }

    if (!isLocalRequest(req)) {
      json(res, 403, { error: 'text-edit endpoints accept localhost requests only' });
      return;
    }

    // GET /__text-edit/health -> { ok: true }
    if (req.method === 'GET' && url.startsWith(`${BASE}/health`)) {
      json(res, 200, { ok: true, name: 'astro-text-edit', milestone: 1 });
      return;
    }

    // GET /__text-edit/assets -> { files: [...] }
    // Read-only listing for the image-swap panel. No writes anywhere. (spec §6.3)
    if (req.method === 'GET' && url.startsWith(`${BASE}/assets`)) {
      listAssets(root, assetDirs)
        .then((files) => json(res, 200, { files }))
        .catch((err) => {
          logger.warn(`asset listing failed: ${String(err)}`);
          json(res, 500, { error: 'could not list assets' });
        });
      return;
    }

    // POST /__text-edit/upload  { dataUrl, filename } -> { webPath }
    // Writes a NEW image file into an asset dir. This is a self-contained asset
    // write (never a source-file patch), so it's safe to enable now. (spec §11)
    if (req.method === 'POST' && url.startsWith(`${BASE}/upload`)) {
      readBody(req, 25 * 1024 * 1024) // 25 MB cap
        .then((buf) => JSON.parse(buf.toString('utf8')) as { dataUrl: string; filename: string })
        .then((payload) => saveUpload(root, assetDirs, payload))
        .then(({ webPath }) => {
          logger.info(`uploaded image -> ${webPath}`);
          json(res, 200, { webPath });
        })
        .catch((err) => {
          logger.warn(`upload failed: ${String(err)}`);
          json(res, 400, { error: err instanceof Error ? err.message : 'upload failed' });
        });
      return;
    }

    // POST /__text-edit/open  { file, loc } -> { ok }
    // Opens a source location in the user's editor via launch-editor. This is a
    // read-only side effect (spawns the editor), so it's safe to enable now.
    if (req.method === 'POST' && url.startsWith(`${BASE}/open`)) {
      if (!openInEditor) {
        json(res, 403, { error: 'open-in-editor is disabled by configuration' });
        return;
      }
      readBody(req, 64 * 1024)
        .then((buf) => JSON.parse(buf.toString('utf8')) as { file: string; loc?: string })
        .then(async ({ file, loc }) => {
          // Confine to the project root before handing a path to the editor.
          const abs = resolve(root, file);
          if (relative(root, abs).startsWith('..')) throw new Error('path escapes root');
          const [line, col] = (loc ?? '').split(':');
          const spec = line ? `${abs}:${line}${col ? ':' + col : ''}` : abs;
          // launch-editor is CommonJS: the module IS the function. Interop may
          // wrap it under .default depending on the loader, so handle both.
          const mod = (await import('launch-editor')) as unknown as
            | ((f: string) => void)
            | { default: (f: string) => void };
          const launch = typeof mod === 'function' ? mod : mod.default;
          launch(spec);
          json(res, 200, { ok: true });
        })
        .catch((err) => {
          logger.warn(`open-in-editor failed: ${String(err)}`);
          json(res, 400, { error: err instanceof Error ? err.message : 'open failed' });
        });
      return;
    }

    // POST /__text-edit/classify  { file, loc, tag } -> { kind, reason, attrs? }
    // Source-truth classification from the .astro AST. The client confirms with
    // this on click before opening an editor — the DOM-side guess cannot tell a
    // resolved {expression} from literal text. (spec §7.3, §16.1)
    if (req.method === 'POST' && url.startsWith(`${BASE}/classify`)) {
      readBody(req, 64 * 1024)
        .then((buf) => JSON.parse(buf.toString('utf8')) as { file: string; loc: string; tag: string })
        .then(async ({ file, loc, tag }) => {
          if (!file || !loc || !tag) throw new Error('file, loc and tag are required');
          const abs = await validateEditablePath(root, contentRoots, editableExtensions, file);
          if (extname(abs).toLowerCase() !== '.astro') {
            json(res, 200, {
              kind: 'dynamic',
              reason: 'Only .astro templates support in-place editing so far.',
            });
            return;
          }
          const source = await readFile(abs, 'utf8');
          json(res, 200, await classifyAstro(source, loc, tag));
        })
        .catch((err) => {
          logger.warn(`classify failed: ${String(err)}`);
          json(res, 400, { error: err instanceof Error ? err.message : 'classify failed' });
        });
      return;
    }

    // POST /__text-edit/apply
    //   { file, loc, tag, targetType, original, newText } -> { ok } | { error }
    // The real write path: resolve the element in the AST, verify the source
    // still matches what the client saw, patch, write atomically. HMR does the
    // visual refresh. (spec §5, §6.1, §7.5, §10)
    if (req.method === 'POST' && url.startsWith(`${BASE}/apply`)) {
      readBody(req, 256 * 1024)
        .then((buf) => JSON.parse(buf.toString('utf8')) as ApplyRequest & { file: string })
        .then(async (payload) => {
          const { file, loc, tag, targetType, original, newText } = payload;
          if (!file || !loc || !tag) throw new Error('file, loc and tag are required');
          if (!['text', 'src', 'alt'].includes(targetType)) throw new Error('bad targetType');
          if (typeof original !== 'string' || typeof newText !== 'string') {
            throw new Error('original and newText must be strings');
          }
          const abs = await validateEditablePath(root, contentRoots, editableExtensions, file);
          if (extname(abs).toLowerCase() !== '.astro') {
            json(res, 422, {
              error: 'Only .astro templates support in-place editing so far.',
              code: 'unsupported',
            });
            return;
          }
          const source = await readFile(abs, 'utf8');
          const result = await applyAstro(source, { loc, tag, targetType, original, newText });
          if (!result.ok) {
            logger.warn(`apply refused (${result.code}): ${basename(abs)}:${loc} — ${result.error}`);
            json(res, 422, { error: result.error, code: result.code });
            return;
          }
          await atomicWrite(abs, result.newSource);
          logger.info(`applied ${targetType} edit -> ${basename(abs)}:${loc}`);
          json(res, 200, { ok: true });
        })
        .catch((err) => {
          logger.warn(`apply failed: ${String(err)}`);
          json(res, 400, { error: err instanceof Error ? err.message : 'apply failed' });
        });
      return;
    }

    logger.warn(`unhandled text-edit request: ${req.method} ${url}`);
    json(res, 404, { error: 'not implemented' });
  };
}
