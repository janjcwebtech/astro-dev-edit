import type { AstroIntegrationLogger } from 'astro';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, realpath, unlink } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import type { Connect } from 'vite';
import { applyEntryChanges, parseEntry, serializeEntry } from '../patcher/frontmatter.ts';
import { patcherFor } from '../patcher/registry.ts';
import type {
  ApplyRequestWire,
  ClassifyRequest,
  EntryApplyRequest,
  EntryCreateRequest,
  EntryDeleteRequest,
  EntryRequest,
  FieldDescriptor,
  OpenRequest,
  UploadRequest,
} from '../shared/protocol.ts';
import { listAssets, saveUpload } from './assets.ts';
import type { EntryCollectionInfo, EntrySchemaProvider } from './content-config.ts';
import { atomicWrite, insideRoot, validateEditablePath } from './paths.ts';
import { BASE, dispatch, json, type Route } from './router.ts';
import {
  inferFields,
  validateChanges,
  validateFull,
  zodToFields,
} from './schema-introspect.ts';

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
  /** Expose the entry-editor endpoints (/entry*). */
  entryEditorEnabled: boolean;
  /** Collection/schema lookup for the entry editor; null → inference only. */
  schemaProvider: EntrySchemaProvider | null;
}

const NO_PATCHER_REASON = 'Only .astro templates support in-place editing so far.';

/** Extensions the entry editor treats as collection entries. */
const ENTRY_EXTENSIONS = ['.md', '.mdx'];

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Assemble the panel's field list: schema-derived when possible (with
 *  presence marked and extra file keys appended as inferred), else inferred
 *  entirely from the entry's values; config overrides applied last. */
function assembleFields(
  info: EntryCollectionInfo | null,
  data: Record<string, unknown>,
): FieldDescriptor[] {
  let fields = info?.schema ? zodToFields(info.schema) : null;
  if (fields) {
    for (const f of fields) f.present = f.name in data;
    const extras = Object.fromEntries(
      Object.entries(data).filter(([k]) => !fields!.some((f) => f.name === k)),
    );
    fields = fields.concat(inferFields(extras));
  } else {
    fields = inferFields(data);
  }
  const overrides = info?.fieldConfig ?? {};
  return fields
    .filter((f) => !overrides[f.name]?.hidden)
    .map((f) => {
      const o = overrides[f.name];
      if (!o) return f;
      return { ...f, ...(o.widget ? { type: o.widget } : {}), ...(o.label ? { label: o.label } : {}) };
    });
}

/** Filename-safe slug: lowercase, ascii, hyphen-separated. */
function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
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

export function createMiddleware(deps: MiddlewareDeps): Connect.NextHandleFunction {
  const {
    logger,
    root,
    assetDirs,
    contentRoots,
    editableExtensions,
    openInEditor,
    entryEditorEnabled,
    schemaProvider,
  } = deps;

  /** Path validation for entry endpoints: same confinement as edits, but only
   *  markdown-family files are collection entries. */
  const entryExtensions = ENTRY_EXTENSIONS.filter((e) => editableExtensions.includes(e));

  async function validateEntryPath(file: string): Promise<string> {
    if (!entryEditorEnabled) throw new Error('the entry editor is disabled by configuration');
    if (typeof file !== 'string' || !file) throw new Error('file is required');
    return validateEditablePath(root, contentRoots, entryExtensions, file);
  }

  // Paths coming back from validation are realpath'd; compare against the
  // realpath'd root or symlinked roots (macOS /var → /private/var) mis-relativize.
  let rootRealCache: string | null = null;
  async function relToRoot(abs: string): Promise<string> {
    rootRealCache ??= await realpath(root);
    return relative(rootRealCache, abs).split(sep).join('/');
  }

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

    // --- Entry editor: read a collection entry as fields + body. -------------
    {
      method: 'POST',
      path: '/entry',
      maxBytes: 64 * 1024,
      label: 'entry read',
      handler: async (body) => {
        const { file } = body as EntryRequest;
        const abs = await validateEntryPath(file);
        const source = await readFile(abs, 'utf8');
        const parsed = parseEntry(source);
        const rel = await relToRoot(abs);
        const info = (await schemaProvider?.forFile(rel)) ?? null;
        return {
          status: 200,
          body: {
            file: rel,
            etag: sha256(source),
            collection: info?.collection ?? null,
            fields: assembleFields(info, parsed.data),
            values: parsed.data,
            body: parsed.body,
            bodyEditable: true,
          },
        };
      },
    },

    // Verified, atomic multi-field write: etag guards against a file that
    // changed since the panel read it; changed keys are validated against the
    // project's own zod schema before anything touches disk.
    {
      method: 'POST',
      path: '/entry/apply',
      maxBytes: 1024 * 1024,
      label: 'entry apply',
      handler: async (body) => {
        const { file, etag, changes } = body as EntryApplyRequest;
        const abs = await validateEntryPath(file);
        if (typeof etag !== 'string' || !etag) throw new Error('etag is required');
        if (!changes || typeof changes !== 'object') throw new Error('changes are required');

        const source = await readFile(abs, 'utf8');
        if (sha256(source) !== etag) {
          return {
            status: 409,
            body: { error: 'file changed on disk since it was loaded', code: 'conflict' },
          };
        }

        const fmChanges = changes.frontmatter ?? {};
        if (Object.keys(fmChanges).length > 0 && schemaProvider) {
          const rel = await relToRoot(abs);
          const info = await schemaProvider.forFile(rel);
          if (info?.schema) {
            const fieldErrors = validateChanges(info.schema, fmChanges);
            if (Object.keys(fieldErrors).length > 0) {
              return {
                status: 422,
                body: { error: 'validation failed', code: 'validation', fieldErrors },
              };
            }
          }
        }

        const result = applyEntryChanges(source, changes);
        if (!result.ok) {
          return { status: 422, body: { error: result.error, code: 'unsupported' } };
        }
        await atomicWrite(abs, result.newSource);
        logger.info(`entry saved -> ${basename(abs)}`);
        return { status: 200, body: { ok: true } };
      },
    },

    // Create a new entry in a collection's directory. Full-object validation,
    // sanitized slug, never overwrites.
    {
      method: 'POST',
      path: '/entry/create',
      maxBytes: 1024 * 1024,
      label: 'entry create',
      handler: async (body) => {
        if (!entryEditorEnabled) throw new Error('the entry editor is disabled by configuration');
        const { collection, slug, frontmatter, body: entryBody } = body as EntryCreateRequest;
        if (!collection || typeof collection !== 'string') throw new Error('collection is required');
        const cleanSlug = slugify(String(slug ?? ''));
        if (!cleanSlug) throw new Error('slug is required');
        if (!frontmatter || typeof frontmatter !== 'object') throw new Error('frontmatter is required');

        const info = (await schemaProvider?.forCollection(collection)) ?? null;
        if (!info) {
          return { status: 422, body: { error: `unknown collection "${collection}"` } };
        }

        // Confine the target dir exactly like an edit path would be.
        const dirAbs = resolve(root, info.dir);
        if (!existsSync(dirAbs)) {
          return { status: 422, body: { error: `collection directory ${info.dir} does not exist` } };
        }
        const dirReal = await realpath(dirAbs);
        const relDir = relative(await realpath(root), dirReal);
        const inContentRoot = contentRoots.some(
          (cr) => relDir === cr || relDir.startsWith(cr.endsWith(sep) ? cr : cr + sep),
        );
        if (relDir.startsWith('..') || !inContentRoot) {
          throw new Error('collection directory is outside the editable content roots');
        }
        if (!entryExtensions.includes('.md')) {
          return { status: 422, body: { error: '.md entries are not editable by configuration' } };
        }

        const abs = join(dirReal, `${cleanSlug}.md`);
        if (existsSync(abs)) {
          return { status: 409, body: { error: `${cleanSlug}.md already exists`, code: 'exists' } };
        }

        if (info.schema) {
          const fieldErrors = validateFull(info.schema, frontmatter);
          if (Object.keys(fieldErrors).length > 0) {
            return {
              status: 422,
              body: { error: 'validation failed', code: 'validation', fieldErrors },
            };
          }
        }

        // Drop empty-string values so schema defaults apply instead.
        const values = Object.fromEntries(
          Object.entries(frontmatter).filter(([, v]) => v !== '' && v !== null && v !== undefined),
        );
        await atomicWrite(abs, serializeEntry(values, String(entryBody ?? '')));
        const rel = await relToRoot(abs);
        logger.info(`entry created -> ${rel}`);
        return { status: 200, body: { file: rel } };
      },
    },

    // Delete an entry. Etag-guarded; undo is git.
    {
      method: 'POST',
      path: '/entry/delete',
      maxBytes: 64 * 1024,
      label: 'entry delete',
      handler: async (body) => {
        const { file, etag } = body as EntryDeleteRequest;
        const abs = await validateEntryPath(file);
        if (typeof etag !== 'string' || !etag) throw new Error('etag is required');
        const source = await readFile(abs, 'utf8');
        if (sha256(source) !== etag) {
          return {
            status: 409,
            body: { error: 'file changed on disk since it was loaded', code: 'conflict' },
          };
        }
        await unlink(abs);
        logger.info(`entry deleted -> ${basename(abs)}`);
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
