import type { AstroIntegrationLogger } from 'astro';
import { readFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import type { Connect } from 'vite';
import { patcherFor } from '../patcher/registry.ts';
import type {
  ApplyRequestWire,
  ClassifyRequest,
  OpenRequest,
  UploadRequest,
} from '../shared/protocol.ts';
import { listAssets, saveUpload } from './assets.ts';
import { atomicWrite, insideRoot, validateEditablePath } from './paths.ts';
import { BASE, dispatch, json, type Route } from './router.ts';

/**
 * Dev-server middleware for astro-text-edit.
 *
 * Endpoints: health, read-only asset listing, image upload, open-in-editor,
 * and the real source-editing pair — /classify (AST-truth classification) and
 * /apply (verified, atomic source patch). Every endpoint rejects non-localhost
 * requests — this API is strictly for the developer's own machine. (spec §8)
 */

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

const NO_PATCHER_REASON = 'Only .astro templates support in-place editing so far.';

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

export function createMiddleware(deps: MiddlewareDeps): Connect.NextHandleFunction {
  const { logger, root, assetDirs, contentRoots, editableExtensions, openInEditor } = deps;

  const routes: Route[] = [
    {
      method: 'GET',
      path: '/health',
      label: 'health',
      handler: async () => ({
        status: 200,
        body: { ok: true, name: 'astro-text-edit', milestone: 1 },
      }),
    },

    // Read-only listing for the image-swap panel. No writes anywhere. (spec §6.3)
    {
      method: 'GET',
      path: '/assets',
      label: 'asset listing',
      handler: async () => ({
        status: 200,
        body: { files: await listAssets(root, assetDirs) },
      }),
      onError: () => ({ status: 500, body: { error: 'could not list assets' } }),
    },

    // Writes a NEW image file into an asset dir — a self-contained asset
    // write, never a source-file patch. (spec §11)
    {
      method: 'POST',
      path: '/upload',
      maxBytes: 25 * 1024 * 1024, // 25 MB cap
      label: 'upload',
      handler: async (body) => {
        const { webPath } = await saveUpload(root, assetDirs, body as UploadRequest);
        logger.info(`uploaded image -> ${webPath}`);
        return { status: 200, body: { webPath } };
      },
    },

    // Opens a source location in the user's editor via launch-editor — a
    // read-only side effect (spawns the editor).
    {
      method: 'POST',
      path: '/open',
      maxBytes: 64 * 1024,
      label: 'open-in-editor',
      fallback: 'open failed',
      handler: async (body) => {
        if (!openInEditor) {
          return { status: 403, body: { error: 'open-in-editor is disabled by configuration' } };
        }
        const { file, loc } = body as OpenRequest;
        // Confine to the project root before handing a path to the editor.
        const abs = resolve(root, file);
        if (!insideRoot(root, abs)) throw new Error('path escapes root');
        const [line, col] = (loc ?? '').split(':');
        const spec = line ? `${abs}:${line}${col ? ':' + col : ''}` : abs;
        // launch-editor is CommonJS: the module IS the function. Interop may
        // wrap it under .default depending on the loader, so handle both.
        const mod = (await import('launch-editor')) as unknown as
          | ((f: string) => void)
          | { default: (f: string) => void };
        const launch = typeof mod === 'function' ? mod : mod.default;
        launch(spec);
        return { status: 200, body: { ok: true } };
      },
    },

    // Source-truth classification from the source AST. The client confirms
    // with this on click before opening an editor — the DOM-side guess cannot
    // tell a resolved {expression} from literal text. (spec §7.3, §16.1)
    {
      method: 'POST',
      path: '/classify',
      maxBytes: 64 * 1024,
      label: 'classify',
      handler: async (body) => {
        const { file, loc, tag } = body as ClassifyRequest;
        if (!file || !loc || !tag) throw new Error('file, loc and tag are required');
        const abs = await validateEditablePath(root, contentRoots, editableExtensions, file);
        const patcher = patcherFor(extname(abs).toLowerCase());
        if (!patcher) {
          return { status: 200, body: { kind: 'dynamic', reason: NO_PATCHER_REASON } };
        }
        const source = await readFile(abs, 'utf8');
        return { status: 200, body: await patcher.classify(source, { loc, tag }) };
      },
    },

    // The real write path: resolve the element in the AST, verify the source
    // still matches what the client saw, patch, write atomically. HMR does the
    // visual refresh. (spec §5, §6.1, §7.5, §10)
    {
      method: 'POST',
      path: '/apply',
      maxBytes: 256 * 1024,
      label: 'apply',
      handler: async (body) => {
        const { file, loc, tag, targetType, original, newText } = body as ApplyRequestWire;
        if (!file || !loc || !tag) throw new Error('file, loc and tag are required');
        if (!['text', 'src', 'alt'].includes(targetType)) throw new Error('bad targetType');
        if (typeof original !== 'string' || typeof newText !== 'string') {
          throw new Error('original and newText must be strings');
        }
        const abs = await validateEditablePath(root, contentRoots, editableExtensions, file);
        const patcher = patcherFor(extname(abs).toLowerCase());
        if (!patcher) {
          return { status: 422, body: { error: NO_PATCHER_REASON, code: 'unsupported' } };
        }
        const source = await readFile(abs, 'utf8');
        const result = await patcher.apply(source, { loc, tag, targetType, original, newText });
        if (!result.ok) {
          logger.warn(`apply refused (${result.code}): ${basename(abs)}:${loc} — ${result.error}`);
          return { status: 422, body: { error: result.error, code: result.code } };
        }
        await atomicWrite(abs, result.newSource);
        logger.info(`applied ${targetType} edit -> ${basename(abs)}:${loc}`);
        return { status: 200, body: { ok: true } };
      },
    },
  ];

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
    void dispatch(routes, logger, req, res);
  };
}
