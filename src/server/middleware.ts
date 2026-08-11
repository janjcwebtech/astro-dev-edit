import type { AstroIntegrationLogger } from 'astro';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { Connect } from 'vite';
import { patcherFor } from '../patcher/registry.ts';
import type {
  ApplyRequestWire,
  ClassifyRequest,
  OpenRequest,
  PeekRequest,
  UploadRequest,
} from '../shared/protocol.ts';
import { dataUrlMime, listAssets, saveUpload } from './assets.ts';
import type { EntrySchemaProvider } from './content-config.ts';
import { launchInEditor } from './editor.ts';
import { createEntryRoutes } from './entry-routes.ts';
import { createInspectRoutes } from './inspect-routes.ts';
import {
  atomicWrite,
  checkEditablePath,
  isPackageOwned,
  resolveUploadDir,
  validateEditablePath,
} from './paths.ts';
import { BASE, dispatch, json, type Route } from './router.ts';

/**
 * Dev-server middleware for astro-text-edit — the composition point for every
 * /__text-edit route group. This file owns the core loc-based editing routes
 * (health, assets, upload, open, peek, classify, apply) and the localhost gate;
 * feature route groups (the /entry* CMS endpoints in entry-routes.ts) export
 * their own `Route[]` and are concatenated here. Every endpoint rejects
 * non-localhost requests — this API is strictly for the developer's own
 * machine. (spec §8)
 */

interface MiddlewareDeps {
  logger: AstroIntegrationLogger;
  /** Project root (fsPath). Every served path is confined to this. */
  root: string;
  /** Directories the asset listing may read from, relative to root. */
  assetDirs: string[];
  /** Directory new uploads are written to, relative to root. */
  uploadDir: string;
  /** Directory uploads for `assetRef: 'relative'` image() fields fall back to,
   *  relative to root. Those assets are imported by Astro, so they belong under
   *  `src/`, not in the web-servable uploadDir. */
  imageUploadDir: string;
  /** Directories writes are confined to, relative to root. (spec §8) */
  contentRoots: string[];
  /** Extensions the patcher may write. (spec §8) */
  editableExtensions: string[];
  /** Expose the open-in-editor endpoint. */
  openInEditor: boolean;
  /** Expose the hover-pill CSS class/ID inspector (/inspect*). */
  cssInspector: boolean;
  /** Expose the entry-editor endpoints (/entry*). */
  entryEditorEnabled: boolean;
  /** Collection/schema lookup for the entry editor; null → inference only. */
  schemaProvider: EntrySchemaProvider | null;
}

const NO_PATCHER_REASON = 'Only .astro templates support in-place editing so far.';

/** Why an animated GIF can't back an `image()` field. */
const GIF_REFUSAL =
  'Astro optimises image() assets, which flattens an animated GIF to a single frame. ' +
  'Keep animated GIFs in public/ and reference them from a plain <img src> instead.';

/** Reasons for elements whose source file exists but isn't yours to edit.
 *  These are *verdicts*, not errors: /classify is advisory and runs on hover,
 *  so an out-of-root path must answer "not editable here" rather than throw —
 *  otherwise `astro:assets` <Image> (annotated to
 *  node_modules/astro/components/Image.astro) floods the log with warnings on
 *  any site using it. Widening contentRoots would be the wrong fix: it would
 *  make Astro's own internals writable. */
const PACKAGE_OWNED_REASON =
  'Rendered by a package component (e.g. the astro:assets <Image>), not your source. ' +
  'Edit where the component is used instead.';
const OUT_OF_ROOT_REASON =
  'This element comes from a file outside the editable content roots.';

/** Max lines of context on each side of the focus line in a /peek response.
 *  Deliberately generous — in practice the peek returns the whole file and
 *  the panel scrolls it; the cap only stops a pathological multi-thousand-line
 *  file from flooding the response and the panel's DOM. */
const PEEK_CONTEXT = 1000;

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
  const {
    logger,
    root,
    assetDirs,
    uploadDir,
    imageUploadDir,
    contentRoots,
    editableExtensions,
    openInEditor,
    cssInspector,
    entryEditorEnabled,
    schemaProvider,
  } = deps;

  // The only directories an upload may be steered into. Without this, a
  // client-supplied targetDir would be a "write a file anywhere in the project"
  // capability rather than "put this image beside its siblings". (spec §8)
  const uploadAllowedDirs = [...assetDirs, uploadDir, imageUploadDir];

  const coreRoutes: Route[] = [
    {
      method: 'GET',
      path: '/health',
      label: 'health',
      handler: async () => ({
        status: 200,
        body: { ok: true, name: 'astro-text-edit', milestone: 1, cssInspector, root },
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

    // Writes a NEW image file into the configured upload dir — a self-contained
    // asset write, never a source-file patch. (spec §11)
    {
      method: 'POST',
      path: '/upload',
      maxBytes: 25 * 1024 * 1024, // 25 MB cap
      label: 'upload',
      handler: async (body) => {
        const req = body as UploadRequest;
        const relative = req.assetRef === 'relative';
        // An image() asset is imported and optimised by Astro, which flattens
        // an animated GIF to a still frame. Refuse rather than write a value
        // that silently degrades the image — public/ + the swap panel is the
        // path that preserves animation.
        if (relative && (dataUrlMime(req.dataUrl) === 'image/gif' || /\.gif$/i.test(req.filename ?? ''))) {
          return {
            status: 422,
            body: { error: GIF_REFUSAL, code: 'unsupported' },
          };
        }
        // Relative fields fall back to the src-side dir; a requested target is
        // honoured only if it sits inside a configured asset directory.
        const fallback = relative ? imageUploadDir : uploadDir;
        const dir = resolveUploadDir(root, uploadAllowedDirs, fallback, req.targetDir);
        if (req.targetDir && dir !== req.targetDir) {
          logger.warn(
            `upload targetDir "${req.targetDir}" is not inside a configured asset ` +
              `directory — writing to "${dir}" instead`,
          );
        }
        const { webPath } = await saveUpload(root, dir, req);
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
        if (!file) throw new Error('file is required');
        // Same gate as /classify and /apply: realpath ∈ root ∈ contentRoots,
        // allowed extension. /open only spawns an editor, but it takes the
        // same client-supplied paths, and every legitimate caller targets a
        // file that already passed this gate. (spec §8)
        const abs = await validateEditablePath(root, contentRoots, editableExtensions, file);
        const [line, col] = (loc ?? '').split(':');
        const spec = line ? `${abs}:${line}${col ? ':' + col : ''}` : abs;
        await launchInEditor(spec);
        return { status: 200, body: { ok: true } };
      },
    },

    // Read-only source peek: the file's lines (windowed only past the huge-
    // file cap) plus focus metadata, so the overlay can show the code in the
    // browser without launching an editor. Same path gate as every
    // file-touching route; no writes.
    {
      method: 'POST',
      path: '/peek',
      maxBytes: 64 * 1024,
      label: 'peek',
      handler: async (body) => {
        const { file, loc } = body as PeekRequest;
        if (!file) throw new Error('file is required');
        // Clicking the hover pill's file:loc label on an <Image> lands here
        // with a package-owned path. Same call as /classify: explain rather
        // than 400, and return no source — the point is that it isn't ours.
        const check = await checkEditablePath(root, contentRoots, editableExtensions, file);
        if (!check.ok) {
          if (check.code !== 'outside-roots') throw new Error(check.reason);
          return {
            status: 200,
            body: {
              file,
              startLine: 1,
              focusLine: 1,
              totalLines: 0,
              lines: [],
              refused:
                check.abs && isPackageOwned(check.abs)
                  ? PACKAGE_OWNED_REASON
                  : OUT_OF_ROOT_REASON,
            },
          };
        }
        const abs = check.abs;
        const source = await readFile(abs, 'utf8');
        const all = source.split(/\r?\n/);
        // A trailing newline yields a phantom empty last line — drop it.
        if (all.length > 1 && all[all.length - 1] === '') all.pop();
        const line = parseInt((loc ?? '').split(':')[0] ?? '', 10);
        const focusLine = Math.min(Math.max(Number.isFinite(line) ? line : 1, 1), all.length);
        const startLine = Math.max(1, focusLine - PEEK_CONTEXT);
        const endLine = Math.min(all.length, focusLine + PEEK_CONTEXT);
        return {
          status: 200,
          body: {
            file,
            startLine,
            focusLine,
            totalLines: all.length,
            lines: all.slice(startLine - 1, endLine),
          },
        };
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
        // Advisory and read-only — the hover tooltip calls this too, so a file
        // that simply isn't ours to edit must answer with a verdict, not a
        // thrown 400. Genuine anomalies (missing, escaping the root, wrong
        // extension) still throw.
        const check = await checkEditablePath(root, contentRoots, editableExtensions, file);
        if (!check.ok) {
          if (check.code !== 'outside-roots') throw new Error(check.reason);
          return {
            status: 200,
            body: {
              kind: 'dynamic',
              reason:
                check.abs && isPackageOwned(check.abs)
                  ? PACKAGE_OWNED_REASON
                  : OUT_OF_ROOT_REASON,
            },
          };
        }
        const abs = check.abs;
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
        const { file, loc, tag, ops } = body as ApplyRequestWire;
        if (!file || !loc || !tag) throw new Error('file, loc and tag are required');
        if (!Array.isArray(ops) || ops.length === 0) {
          throw new Error('ops must be a non-empty array');
        }
        for (const op of ops) {
          if (!op || !['text', 'markup', 'src', 'alt'].includes(op.targetType)) {
            throw new Error('bad targetType');
          }
          if (typeof op.original !== 'string' || typeof op.newText !== 'string') {
            throw new Error('original and newText must be strings');
          }
        }
        const abs = await validateEditablePath(root, contentRoots, editableExtensions, file);
        const patcher = patcherFor(extname(abs).toLowerCase());
        if (!patcher) {
          return { status: 422, body: { error: NO_PATCHER_REASON, code: 'unsupported' } };
        }
        // Verify-all-then-write-once: apply each op to an in-memory copy of the
        // source (re-parsing each time, so a later op sees the earlier edit) and
        // write only after every op verifies. A single refusal writes nothing,
        // so a batch (e.g. an image's src+alt) can never half-update the file.
        const source = await readFile(abs, 'utf8');
        let working = source;
        for (const op of ops) {
          const result = await patcher.apply(working, {
            loc,
            tag,
            targetType: op.targetType,
            original: op.original,
            newText: op.newText,
          });
          if (!result.ok) {
            logger.warn(`apply refused (${result.code}): ${basename(abs)}:${loc} — ${result.error}`);
            return { status: 422, body: { error: result.error, code: result.code } };
          }
          working = result.newSource;
        }
        await atomicWrite(abs, working);
        logger.info(`applied ${ops.map((o) => o.targetType).join('+')} edit -> ${basename(abs)}:${loc}`);
        return { status: 200, body: { ok: true } };
      },
    },
  ];

  const routes: Route[] = [
    ...coreRoutes,
    ...createInspectRoutes({
      logger,
      root,
      contentRoots,
      editableExtensions,
      openInEditor,
      enabled: cssInspector,
    }),
    ...createEntryRoutes({
      logger,
      root,
      contentRoots,
      editableExtensions,
      enabled: entryEditorEnabled,
      schemaProvider,
    }),
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
