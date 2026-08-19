import type { AstroIntegrationLogger } from 'astro';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { parseEntry } from '../patcher/frontmatter.ts';
import {
  addCollection,
  addField,
  readCollectionBlocks,
  removeField,
  updateField,
  type CollectionBlock,
  type SchemaField,
} from '../patcher/content-config.ts';
import type {
  CollectionApplyResponse,
  CollectionCreateRequest,
  CollectionEntriesRequest,
  CollectionEntryItem,
  CollectionOpenRequest,
  CollectionRefusal,
  CollectionSchemaApplyRequest,
  CollectionSummary,
  FieldDescriptor,
  FieldOverride,
  FieldType,
} from '../shared/protocol.ts';
import type {
  EntryCollectionInfo,
  EntryEditorOptions,
  EntrySchemaProvider,
} from './content-config.ts';
import { launchInEditor } from './editor.ts';
import { ENTRY_EXTENSIONS } from './entry-routes.ts';
import type { OptionsResolver, StoredOptions } from './options.ts';
import { atomicWrite, insideRoot } from './paths.ts';
import type { Route, RouteResult } from './router.ts';
import { FIELD_TYPES, inferFields, zodToFields } from './schema-introspect.ts';
import { readStoredOptions, saveStoredOptions } from './settings.ts';

/**
 * The collection-designer route group (`/collections`,
 * `/collection/schema/apply`, `/collection/create`) — the Collections tab's
 * server side. A feature route module: it exports a `Route[]` the middleware
 * concatenates, so everything collection-shaped lives here.
 *
 * **This is the third class of write in the codebase, and the widest.** The
 * others target content (confined by `paths.ts::validateEditablePath`) or a fixed
 * settings file. This one patches the project's own `src/content.config.ts` —
 * TypeScript the dev server executes. Four rules hold it in:
 *
 * 1. **The path is discovered server-side**, from `EntrySchemaProvider.configPath`
 *    (the conventional candidates, or `entryEditor.configPath` from the config).
 *    A request names a *collection*, never a path, so there is no path to
 *    smuggle. `configTarget` re-checks the resolved realpath is inside the
 *    project root and carries a config-shaped extension anyway — the same
 *    fixed-target reasoning `settings.ts` documents, plus a belt.
 * 2. **Every string that reaches generated source is validated**, not escaped:
 *    collection and field names must be plain identifiers, a directory and a glob
 *    pattern must match a conservative character class. A name that would need
 *    quoting is refused instead of quoted, which keeps every expression this
 *    module writes a shape it can read back.
 * 3. **Writes are etag-guarded and all-or-nothing.** Each field edit is applied
 *    to one in-memory copy and the file is written once at the end, so a refusal
 *    anywhere leaves the config untouched and a stale panel fails safe. Same
 *    property `/apply` has.
 * 4. **`schemaEditor: false` refuses before touching the filesystem**, so a
 *    project can keep the rest of the tool and forbid schema writes outright.
 *
 * The editor half of a field (widget, label, hidden) is not a schema write at
 * all: it goes to `.astro-text-edit.json` through `saveStoredOptions`. The two
 * stores are deliberately visible as two in the response, because one is
 * committed source and the other is local.
 */

export interface SchemaRouteDeps {
  logger: AstroIntegrationLogger;
  /** Project root (fsPath). */
  root: string;
  /** Live options — `entryEditor` gates the group, `schemaEditor` the writes,
   *  and `contentRoots` confines a new collection's directory. */
  optionsResolver: OptionsResolver;
  /** Collection/schema lookup. Null → the panel is told there is no config. */
  schemaProvider: EntrySchemaProvider | null;
}

/** Extensions a content config may have — the tail of `CONFIG_CANDIDATES`. */
const CONFIG_EXTENSIONS = ['.ts', '.mts', '.js', '.mjs'];

/** A repo-relative directory, conservatively. No quotes, no `..`, no backslash —
 *  it is written verbatim into a single-quoted string in generated source. */
const DIR_RE = /^[A-Za-z0-9_\-./]+$/;

/** A glob pattern, conservatively. Same reason as {@link DIR_RE}. */
const PATTERN_RE = /^[A-Za-z0-9_\-./*{}[\],!()]+$/;

/** Cap on one Items listing. Each entry costs a stat and a frontmatter parse, so
 *  a pathological directory can't turn a panel open into a long scan. Exceeding
 *  it is reported, never hidden. */
const MAX_ENTRIES_LISTED = 500;

/** Frontmatter keys tried, in order, for an entry's display title. */
const TITLE_KEYS = ['title', 'name', 'heading', 'label'];

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** HTTP status for a designer refusal. */
const STATUS: Record<CollectionRefusal, number> = {
  conflict: 409,
  disabled: 403,
  unrecognized: 422,
  missing: 422,
  exists: 409,
  unsupported: 422,
};

function refuse(code: CollectionRefusal, error: string): RouteResult {
  const body: CollectionApplyResponse = {
    ok: false,
    schemaWritten: false,
    overridesWritten: false,
    error,
    code,
  };
  return { status: STATUS[code], body };
}

export function createSchemaRoutes(deps: SchemaRouteDeps): Route[] {
  const { logger, root, optionsResolver, schemaProvider } = deps;

  /** The gate every route in this group starts at. */
  async function gate(): Promise<{
    enabled: boolean;
    schemaEditor: boolean;
    contentRoots: string[];
  }> {
    const { options } = await optionsResolver.resolve();
    return {
      enabled: options.entryEditor !== false,
      schemaEditor: options.schemaEditor,
      contentRoots: options.contentRoots,
    };
  }

  let rootRealCache: string | null = null;
  async function rootReal(): Promise<string> {
    rootRealCache ??= await realpath(root);
    return rootRealCache;
  }

  /**
   * The content config this group may read and write, or null when there isn't
   * one. Discovered server-side; the confinement check is defence in depth
   * against a hand-written `entryEditor.configPath` rather than against a
   * request, which never carries a path.
   */
  async function configTarget(): Promise<{ rel: string; abs: string } | null> {
    const rel = (await schemaProvider?.configPath()) ?? null;
    if (!rel) return null;
    const abs = resolve(root, rel);
    if (!CONFIG_EXTENSIONS.includes(extname(abs))) return null;
    try {
      const real = await realpath(abs);
      if (!insideRoot(await rootReal(), real)) return null;
      return { rel, abs: real };
    } catch {
      return null;
    }
  }

  /** Entry files in a collection's directory. Counting only — nothing here is
   *  ever opened. */
  async function countEntries(dir: string): Promise<{ exists: boolean; count: number }> {
    const abs = resolve(root, dir);
    if (!insideRoot(root, abs) || !existsSync(abs)) return { exists: false, count: 0 };
    try {
      const files = await readdir(abs, { recursive: true });
      return {
        exists: true,
        count: files.filter((f) => ENTRY_EXTENSIONS.some((e) => String(f).endsWith(e))).length,
      };
    } catch {
      return { exists: true, count: 0 };
    }
  }

  /** The panel's row for one collection: its live fields (schema-derived when the
   *  schema resolved) joined to what the config source actually says. */
  async function summarize(
    info: EntryCollectionInfo,
    block: CollectionBlock | undefined,
    /** The stored overrides for this collection, to tell apart what the panel
     *  wrote from what the project's config owns. */
    storedFields: Record<string, FieldOverride>,
  ): Promise<CollectionSummary> {
    const { exists, count } = await countEntries(info.dir);
    // No resolvable schema: fall back to the field names the *source* names, so
    // the row isn't empty. Types are unknown, which `json` is the honest answer
    // for — the same degradation the entry panel makes — and `fieldSource` tells
    // the panel to say where the list came from.
    const derived = info.schema ? zodToFields(info.schema) : null;
    const fields: FieldDescriptor[] =
      derived ?? inferFields(Object.fromEntries((block?.fields ?? []).map((f) => [f.name, null])));
    return {
      name: info.collection,
      dir: info.dir,
      dirExists: exists,
      entryCount: count,
      fields,
      fieldSource: derived ? 'schema' : 'source',
      expressions: Object.fromEntries((block?.fields ?? []).map((f) => [f.name, f.expr])),
      schemaForm: block?.schemaForm ?? null,
      ...(block?.unrecognized
        ? { unrecognized: block.unrecognized }
        : block
          ? {}
          : { unrecognized: 'this collection is not declared in the content config' }),
      registered: block?.registered ?? false,
      ...(block ? { configLine: block.line } : {}),
      overrides: info.fieldConfig,
      // The effective override merges config over store, config winning key by
      // key. Anything that doesn't match the store is therefore the config's, and
      // storing a value for it from the panel would do nothing.
      lockedFields: Object.entries(info.fieldConfig)
        .filter(([name, effective]) => !sameOverride(effective, storedFields[name]))
        .map(([name]) => name),
    };
  }

  /** Read the config source with its etag, or the refusal that stands in for it. */
  async function readConfig(): Promise<
    { ok: true; rel: string; abs: string; source: string; etag: string } | RouteResult
  > {
    const target = await configTarget();
    if (!target) {
      return refuse(
        'missing',
        'This project has no content config the designer can read. Create src/content.config.ts first.',
      );
    }
    const source = await readFile(target.abs, 'utf8');
    return { ok: true, ...target, source, etag: sha256(source) };
  }

  return [
    // The Collections tab's read: every collection, its fields, and whether the
    // designer can patch its schema.
    {
      method: 'POST',
      path: '/collections',
      maxBytes: 1024,
      label: 'collections list',
      handler: async () => {
        const { enabled, schemaEditor } = await gate();
        if (!enabled) {
          return {
            status: 403,
            body: { error: 'the entry editor is disabled by configuration', code: 'disabled' },
          };
        }
        const target = await configTarget();
        let source: string | null = null;
        if (target) {
          try {
            source = await readFile(target.abs, 'utf8');
          } catch {
            source = null;
          }
        }
        const blocks = source ? readCollectionBlocks(source) : [];
        const infos = (await schemaProvider?.listCollections()) ?? [];
        const storedOptions: StoredOptions = await readStoredOptions(root).catch(() => ({}));
        const stored: EntryEditorOptions = storedOptions.entryEditor || {};
        const collections: CollectionSummary[] = [];
        for (const info of infos) {
          collections.push(
            await summarize(
              info,
              blocks.find((b) => b.name === info.collection),
              stored.collections?.[info.collection]?.fields ?? {},
            ),
          );
        }
        // A collection the config *declares* but the provider couldn't report —
        // which is what happens when the config module fails to load at all, and
        // is exactly when the designer is most useful. Listing it from the source
        // alone beats letting it vanish from the panel with no explanation.
        const covered = new Set(collections.map((c) => c.name));
        for (const block of blocks) {
          if (covered.has(block.name)) continue;
          collections.push(
            await summarize(
              {
                collection: block.name,
                dir: `src/content/${block.name}`,
                schema: null,
                fieldConfig: {},
              },
              block,
              {},
            ),
          );
        }
        return {
          status: 200,
          body: {
            configPath: target?.rel ?? null,
            etag: source === null ? null : sha256(source),
            schemaEditor,
            collections,
          },
        };
      },
    },

    // Schema edits and/or editor overrides for one collection. Schema first, so a
    // refused patch never leaves overrides pointing at fields that don't exist.
    {
      method: 'POST',
      path: '/collection/schema/apply',
      maxBytes: 64 * 1024,
      label: 'collection schema apply',
      handler: async (body) => {
        const { enabled, schemaEditor } = await gate();
        if (!enabled) return refuse('disabled', 'The entry editor is disabled by configuration.');
        const req = (body ?? {}) as CollectionSchemaApplyRequest;
        if (!req.collection || typeof req.collection !== 'string') {
          throw new Error('collection is required');
        }

        const edits = req.schema ?? {};
        const hasSchemaEdits =
          (edits.add?.length ?? 0) + (edits.update?.length ?? 0) + (edits.remove?.length ?? 0) > 0;
        const hasOverrides = req.overrides && Object.keys(req.overrides).length > 0;
        if (!hasSchemaEdits && !hasOverrides) {
          return { status: 400, body: { error: 'nothing to save' } };
        }

        let schemaWritten = false;
        let etag: string | undefined;
        if (hasSchemaEdits) {
          if (!schemaEditor) {
            return refuse(
              'disabled',
              'Schema editing is off. Turn on "Schema editing" to let the designer write your content config.',
            );
          }
          const config = await readConfig();
          if (!('ok' in config)) return config;
          if (typeof req.etag !== 'string' || req.etag !== config.etag) {
            return refuse(
              'conflict',
              `${config.rel} changed on disk since this panel read it. Reopen the tab and try again.`,
            );
          }

          // One in-memory copy, verified all the way through, written once.
          let next = config.source;
          for (const name of edits.remove ?? []) {
            const step = removeField(next, req.collection, String(name));
            if (!step.ok) return refuse(step.code, step.error);
            next = step.newSource;
          }
          for (const raw of edits.update ?? []) {
            const field = coerceField(raw);
            if (!field.ok) return refuse('unsupported', field.error);
            const step = updateField(next, req.collection, field.field);
            if (!step.ok) return refuse(step.code, step.error);
            next = step.newSource;
          }
          for (const raw of edits.add ?? []) {
            const field = coerceField(raw);
            if (!field.ok) return refuse('unsupported', field.error);
            const step = addField(next, req.collection, field.field);
            if (!step.ok) return refuse(step.code, step.error);
            next = step.newSource;
          }

          if (next !== config.source) {
            await atomicWrite(config.abs, next);
            logger.info(`${req.collection} schema updated -> ${config.rel}`);
            etag = sha256(next);
          }
          schemaWritten = next !== config.source;
        }

        let overridesWritten = false;
        let error: string | undefined;
        if (hasOverrides) {
          const result = await writeOverrides(req.collection, req.overrides!);
          if (result.ok) overridesWritten = result.changed;
          else error = result.error;
        }

        const response: CollectionApplyResponse = {
          ok: !error,
          schemaWritten,
          overridesWritten,
          ...(etag ? { etag } : {}),
          ...(error ? { error, code: 'unsupported' as const } : {}),
        };
        return { status: error ? 422 : 200, body: response };
      },
    },

    // The Items view's read: one collection's entry files. Frontmatter only — a
    // listing never reads a body — and capped, with the cap reported rather than
    // silently truncating.
    {
      method: 'POST',
      path: '/collection/entries',
      maxBytes: 1024,
      label: 'collection entries',
      handler: async (body) => {
        const { enabled, contentRoots } = await gate();
        if (!enabled) return refuse('disabled', 'The entry editor is disabled by configuration.');
        const { collection } = (body ?? {}) as CollectionEntriesRequest;
        if (!collection || typeof collection !== 'string') {
          throw new Error('collection is required');
        }
        const info = await schemaProvider?.forCollection(collection);
        // A collection the config declares but the provider can't resolve (a
        // config that fails to load) still has entries on disk; fall back to the
        // conventional directory rather than answering "no such collection".
        const dir = info?.dir ?? `src/content/${collection}`;
        const dirAbs = resolve(root, dir);
        const relDir = relative(root, dirAbs);
        const inRoot = contentRoots.some(
          (cr) => relDir === cr || relDir.startsWith(cr.endsWith(sep) ? cr : cr + sep),
        );
        if (!insideRoot(root, dirAbs) || !inRoot) {
          return refuse('unsupported', `${dir} is outside the editable content roots.`);
        }
        if (!existsSync(dirAbs)) {
          return { status: 200, body: { collection, dir, entries: [] } };
        }

        const { options } = await optionsResolver.resolve();
        const extensions = ENTRY_EXTENSIONS.filter((e) => options.editableExtensions.includes(e));
        const names = (await readdir(dirAbs, { recursive: true }))
          .map(String)
          .filter((f) => extensions.some((e) => f.endsWith(e)))
          .sort();
        const truncated = names.length > MAX_ENTRIES_LISTED;
        const entries: CollectionEntryItem[] = [];
        for (const name of names.slice(0, MAX_ENTRIES_LISTED)) {
          entries.push(await describeEntry(dir, dirAbs, name));
        }
        entries.sort((a, b) => b.mtime - a.mtime);
        if (truncated) {
          logger.info(
            `${collection}: listing the first ${MAX_ENTRIES_LISTED} of ${names.length} entries`,
          );
        }
        return {
          status: 200,
          body: { collection, dir, entries, ...(truncated ? { truncated: true } : {}) },
        };
      },
    },

    // Launch the editor on the content config. Read-only, and the *only* path it
    // can reach is the one this group discovered — the request carries a
    // collection name at most, so there is nothing to confine beyond what
    // `configTarget` already did.
    {
      method: 'POST',
      path: '/collection/open',
      maxBytes: 1024,
      label: 'collection open',
      handler: async (body) => {
        const { enabled } = await gate();
        const { options } = await optionsResolver.resolve();
        if (!enabled || !options.openInEditor) {
          return refuse('disabled', 'Open-in-editor is disabled by configuration.');
        }
        const config = await readConfig();
        if (!('ok' in config)) return config;
        const { collection } = (body ?? {}) as CollectionOpenRequest;
        const block = collection
          ? readCollectionBlocks(config.source).find((b) => b.name === collection)
          : undefined;
        await launchInEditor(block ? `${config.abs}:${block.line}:1` : config.abs);
        return { status: 200, body: { ok: true } };
      },
    },

    // Append a collection: its defineCollection block, its registry entry, and
    // its entry directory.
    {
      method: 'POST',
      path: '/collection/create',
      maxBytes: 64 * 1024,
      label: 'collection create',
      handler: async (body) => {
        const { enabled, schemaEditor, contentRoots } = await gate();
        if (!enabled) return refuse('disabled', 'The entry editor is disabled by configuration.');
        if (!schemaEditor) {
          return refuse(
            'disabled',
            'Schema editing is off. Turn on "Schema editing" to create collections from here.',
          );
        }
        const req = (body ?? {}) as CollectionCreateRequest;
        const name = String(req.name ?? '');
        const dir = String(req.dir || `src/content/${name}`);
        const pattern = req.pattern ? String(req.pattern) : undefined;

        if (!DIR_RE.test(dir) || dir.includes('..')) {
          return refuse('unsupported', `"${dir}" is not a usable collection directory.`);
        }
        if (pattern && !PATTERN_RE.test(pattern)) {
          return refuse('unsupported', `"${pattern}" is not a usable glob pattern.`);
        }
        // The directory is client-supplied, so confine it exactly as an edit path
        // would be: inside the root, and inside a configured content root.
        const dirAbs = resolve(root, dir);
        const relDir = relative(root, dirAbs);
        const inRoot = contentRoots.some(
          (cr) => relDir === cr || relDir.startsWith(cr.endsWith(sep) ? cr : cr + sep),
        );
        if (!insideRoot(root, dirAbs) || !inRoot) {
          return refuse('unsupported', `${dir} is outside the editable content roots.`);
        }

        const config = await readConfig();
        if (!('ok' in config)) return config;
        if (typeof req.etag !== 'string' || req.etag !== config.etag) {
          return refuse(
            'conflict',
            `${config.rel} changed on disk since this panel read it. Reopen the tab and try again.`,
          );
        }

        const fields: SchemaField[] = [];
        for (const raw of req.fields ?? []) {
          const field = coerceField(raw);
          if (!field.ok) return refuse('unsupported', field.error);
          fields.push(field.field);
        }

        const patched = addCollection(config.source, {
          name,
          dir,
          ...(pattern ? { pattern } : {}),
          fields,
        });
        if (!patched.ok) return refuse(patched.code, patched.error);

        // Directory first: a registered collection whose directory is missing is
        // a build error, while a directory with no collection is inert.
        await mkdir(dirAbs, { recursive: true });
        await atomicWrite(config.abs, patched.newSource);
        logger.info(`collection created -> ${name} (${dir})`);
        return { status: 200, body: { name, dir, etag: sha256(patched.newSource) } };
      },
    },
  ];

  /**
   * Merge editor-only overrides into the settings file. Never touches the config:
   * these are widget/label/hidden, which only the entry drawer reads.
   *
   * An override that says nothing (no widget, no label, `hidden: false`) is
   * *removed* rather than stored, so reverting a row in the panel leaves the file
   * as it was instead of accumulating no-op entries.
   */
  async function writeOverrides(
    collection: string,
    patch: Record<string, FieldOverride | null>,
  ): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
    for (const [field, value] of Object.entries(patch)) {
      const widget = value?.widget;
      if (widget !== undefined && !FIELD_TYPES.includes(widget)) {
        return { ok: false, error: `"${widget}" is not a widget this editor knows (${field}).` };
      }
    }
    try {
      const stored = await readStoredOptions(root);
      // `false` here is the config-level kill switch, not a detail — the stored
      // document keeps the detail beside its own on/off flag (see StoredOptions).
      const detail: EntryEditorOptions = stored.entryEditor || {};
      const collections = { ...detail.collections };
      const one = { ...collections[collection] };
      const fields = { ...one.fields };
      for (const [field, value] of Object.entries(patch)) {
        const merged = normalizeOverride({ ...fields[field], ...(value ?? {}) });
        if (value === null || !merged) delete fields[field];
        else fields[field] = merged;
      }
      const before = JSON.stringify(one.fields ?? {});
      if (before === JSON.stringify(fields)) return { ok: true, changed: false };

      if (Object.keys(fields).length > 0) {
        collections[collection] = { ...one, fields };
      } else {
        // No overrides left. Keep the entry only if it carries something else
        // (a configured dir or extension); otherwise drop it, so reverting every
        // field in the panel leaves the file as it was rather than holding an
        // empty husk.
        const { fields: _drop, ...rest } = one;
        if (Object.keys(rest).length > 0) collections[collection] = rest;
        else delete collections[collection];
      }

      await saveStoredOptions(root, {
        ...stored,
        entryEditor: { ...detail, collections },
      });
      logger.info(`field overrides saved: ${collection}`);
      return { ok: true, changed: true };
    } catch (err) {
      return { ok: false, error: `could not save field overrides: ${String(err)}` };
    }
  }
}

/** One entry's listing row. Reads the file's frontmatter only; a parse failure
 *  degrades to "no title" rather than dropping the entry, since an entry with
 *  broken YAML is exactly one the user needs to find. */
async function describeEntry(
  dir: string,
  dirAbs: string,
  name: string,
): Promise<CollectionEntryItem> {
  const abs = join(dirAbs, name);
  const posix = name.split(sep).join('/');
  const slug = posix.replace(/\.(md|mdx)$/i, '');
  let title: string | null = null;
  let draft = false;
  let mtime = 0;
  try {
    mtime = (await stat(abs)).mtimeMs;
    const parsed = parseEntry(await readFile(abs, 'utf8'));
    for (const key of TITLE_KEYS) {
      const v = parsed.data[key];
      if (typeof v === 'string' && v.trim()) {
        title = v.trim();
        break;
      }
    }
    draft = parsed.data.draft === true;
  } catch {
    // Unreadable or unparseable — still listed, just without its metadata.
  }
  return { file: `${dir}/${posix}`, slug, title, mtime, draft };
}

/** Whether two overrides say the same thing. Absent counts as empty. */
function sameOverride(a: FieldOverride, b: FieldOverride | undefined): boolean {
  const norm = (o: FieldOverride | undefined): string =>
    JSON.stringify(normalizeOverride(o ?? {}) ?? {});
  return norm(a) === norm(b);
}

/** Strip an override down to what it actually says; null when it says nothing. */
function normalizeOverride(o: FieldOverride): FieldOverride | null {
  const out: FieldOverride = {};
  if (o.widget) out.widget = o.widget;
  if (o.label) out.label = o.label;
  if (o.hidden) out.hidden = true;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Validate an incoming field spec. Names must be plain identifiers and types must
 * be known — the patcher refuses anything else anyway, but refusing here keeps the
 * message about the request rather than about the source.
 */
function coerceField(
  raw: unknown,
): { ok: true; field: SchemaField } | { ok: false; error: string } {
  const r = (raw ?? {}) as Partial<SchemaField>;
  const name = String(r.name ?? '');
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
    return { ok: false, error: `"${name}" is not a usable field name.` };
  }
  const type = r.type as FieldType;
  if (!FIELD_TYPES.includes(type)) {
    return { ok: false, error: `"${String(r.type)}" is not a field type this editor knows.` };
  }
  const options = Array.isArray(r.options) ? r.options.map((o) => String(o)).filter(Boolean) : undefined;
  return {
    ok: true,
    field: {
      name,
      type,
      required: r.required === true,
      ...(r.defaultValue !== undefined ? { defaultValue: r.defaultValue } : {}),
      ...(options ? { options } : {}),
    },
  };
}
