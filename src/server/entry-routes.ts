import { directWrite, type TextWriter } from './text-writes.ts';
import type { AstroIntegrationLogger } from 'astro';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, realpath, unlink } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { applyEntryChanges, parseEntry, serializeEntry } from '../patcher/frontmatter.ts';
import type {
  EntryApplyRequest,
  EntryCreateRequest,
  EntryDeleteRequest,
  EntryRequest,
  FieldDescriptor,
} from '../shared/protocol.ts';
import { slugify } from '../shared/slug.ts';
import type { EntryCollectionInfo, EntrySchemaProvider } from './content-config.ts';
import type { OptionsResolver } from './options.ts';
import { validateEditablePath } from './paths.ts';
import type { Route } from './router.ts';
import {
  inferFields,
  validateChanges,
  validateFull,
  zodToFields,
} from './schema-introspect.ts';

/**
 * The entry-editor route group (/entry, /entry/apply, /entry/create,
 * /entry/delete) — the CMS surface over content-collection entries. A feature
 * route module: it exports a `Route[]` that the middleware concatenates into
 * its table, so this file owns everything entry-specific (etag guards, schema
 * validation, field assembly) and the middleware stays a thin composition
 * point. Localhost rejection and dispatch plumbing stay with the middleware.
 */

export interface EntryRouteDeps {
  writeText?: TextWriter;
  logger: AstroIntegrationLogger;
  /** Project root (fsPath). Every served path is confined to this. */
  root: string;
  /** Live options — `entryEditor` gates the group, and `contentRoots` /
   *  `editableExtensions` are the confinement every path here passes through.
   *  Resolved per request so a change from the Settings panel applies without a
   *  dev-server restart. */
  optionsResolver: OptionsResolver;
  /** Collection/schema lookup; null → inference only. */
  schemaProvider: EntrySchemaProvider | null;
}

/** Extensions the entry editor treats as collection entries. */
export const ENTRY_EXTENSIONS = ['.md', '.mdx'];

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Extension for a newly created entry: the collection's configured one wins;
 *  otherwise, when every existing entry in the dir shares one extension, new
 *  entries follow it; mixed or empty collections fall back to .md. */
async function pickEntryExtension(info: EntryCollectionInfo, dirAbs: string): Promise<string> {
  if (info.extension) return info.extension;
  try {
    const files = await readdir(dirAbs, { recursive: true });
    const seen = new Set<string>();
    for (const f of files) {
      const ext = ENTRY_EXTENSIONS.find((e) => String(f).endsWith(e));
      if (ext) seen.add(ext);
    }
    if (seen.size === 1) return [...seen][0];
  } catch {
    // Unreadable dir — the create itself will surface the real error.
  }
  return '.md';
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

export function createEntryRoutes(deps: EntryRouteDeps): Route[] {
  const { logger, root, optionsResolver, schemaProvider } = deps;
  const writeText: TextWriter = deps.writeText ?? directWrite;

  /** The effective options, plus the entry-specific extension allowlist derived
   *  from them: same confinement as edits, but only markdown-family files are
   *  collection entries. */
  async function gate(): Promise<{
    contentRoots: string[];
    entryExtensions: string[];
    enabled: boolean;
  }> {
    const { options } = await optionsResolver.resolve();
    return {
      contentRoots: options.contentRoots,
      entryExtensions: ENTRY_EXTENSIONS.filter((e) => options.editableExtensions.includes(e)),
      enabled: options.entryEditor !== false,
    };
  }

  async function validateEntryPath(file: string): Promise<string> {
    const { contentRoots, entryExtensions, enabled } = await gate();
    if (!enabled) throw new Error('the entry editor is disabled by configuration');
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

  return [
    // Read a collection entry as fields + body.
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
            collectionDir: info?.dir ?? null,
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
        await writeText(abs, result.newSource, source);
        logger.info(`entry saved -> ${basename(abs)}`);
        return { status: 200, body: { ok: true } };
      },
    },

    // Create a new entry in a collection's directory. Full-object validation,
    // sanitized slug, never overwrites. Extension: configured per collection,
    // else inferred from existing entries, else .md.
    {
      method: 'POST',
      path: '/entry/create',
      maxBytes: 1024 * 1024,
      label: 'entry create',
      handler: async (body) => {
        const { contentRoots, entryExtensions, enabled } = await gate();
        if (!enabled) throw new Error('the entry editor is disabled by configuration');
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
        const ext = await pickEntryExtension(info, dirReal);
        if (!entryExtensions.includes(ext)) {
          return { status: 422, body: { error: `${ext} entries are not editable by configuration` } };
        }

        const abs = join(dirReal, `${cleanSlug}${ext}`);
        if (existsSync(abs)) {
          return { status: 409, body: { error: `${cleanSlug}${ext} already exists`, code: 'exists' } };
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
        await writeText(abs, serializeEntry(values, String(entryBody ?? '')), null);
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
}
