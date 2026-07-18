import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ViteDevServer } from 'vite';
import type { FieldType } from '../shared/protocol.ts';
import { IMAGE_STUB_DESCRIPTION } from './schema-introspect.ts';

/**
 * Resolves "which collection backs this file, and what is its zod schema?" by
 * loading the project's own content config through the dev server's module
 * pipeline. Impure by design and injected into the middleware, so tests can
 * stub it. Every failure path returns null — the entry panel then falls back
 * to value-based field inference instead of erroring.
 */

export interface EntryFieldOverride {
  /** Force a widget for this field (e.g. 'textarea', 'image'). */
  widget?: FieldType;
  label?: string;
  /** Hide the field from the panel entirely. */
  hidden?: boolean;
}

export interface EntryEditorOptions {
  /** Repo-relative path to the content config; auto-detected when omitted. */
  configPath?: string;
  collections?: Record<
    string,
    {
      /** Repo-relative collection dir; defaults to src/content/<name>. */
      dir?: string;
      fields?: Record<string, EntryFieldOverride>;
    }
  >;
}

export interface EntryCollectionInfo {
  collection: string;
  /** Repo-relative directory holding the collection's entries. */
  dir: string;
  /** The collection's zod object schema, or null when not resolvable. */
  schema: unknown;
  fieldConfig: Record<string, EntryFieldOverride>;
}

export interface EntrySchemaProvider {
  /** Info for a repo-relative entry file path, or null when unmapped. */
  forFile(relFile: string): Promise<EntryCollectionInfo | null>;
  /** Info for a collection by name (create flow), or null when unknown. */
  forCollection(name: string): Promise<EntryCollectionInfo | null>;
}

const CONFIG_CANDIDATES = [
  'src/content.config.ts',
  'src/content.config.mts',
  'src/content.config.js',
  'src/content.config.mjs',
  'src/content/config.ts',
  'src/content/config.mts',
  'src/content/config.js',
  'src/content/config.mjs',
];

export function createSchemaProvider(
  server: ViteDevServer,
  root: string,
  options: EntryEditorOptions,
): EntrySchemaProvider {
  const explicit = options.collections ?? {};

  function collectionDir(name: string): string {
    return normalizeDir(explicit[name]?.dir ?? `src/content/${name}`);
  }

  /** Load `collections` from the project's content config; null on any failure.
   *  ssrLoadModule is cached by Vite and invalidated when the config changes,
   *  so calling per-request stays cheap and always fresh. */
  async function loadCollections(): Promise<Record<string, { schema?: unknown }> | null> {
    try {
      const candidates = options.configPath ? [options.configPath] : CONFIG_CANDIDATES;
      const rel = candidates.find((c) => existsSync(join(root, c)));
      if (!rel) return null;
      const mod = (await server.ssrLoadModule('/' + rel.replace(/\\/g, '/'))) as {
        collections?: Record<string, { schema?: unknown }>;
      };
      const collections = mod.collections;
      return collections && typeof collections === 'object' ? collections : null;
    } catch {
      return null;
    }
  }

  /** A schema may be a function of a context ({ image }) — call it with a stub
   *  whose image() is a plain string schema from the project's own zod, tagged
   *  so the introspector renders it as an image field. */
  async function resolveSchema(schema: unknown): Promise<unknown> {
    if (typeof schema !== 'function') return schema ?? null;
    try {
      const zmod = (await server.ssrLoadModule('astro/zod')) as {
        z?: { string(): { describe(d: string): unknown } };
      };
      const z = zmod.z;
      if (!z) return null;
      const image = () => z.string().describe(IMAGE_STUB_DESCRIPTION);
      return (schema as (ctx: { image: typeof image }) => unknown)({ image });
    } catch {
      return null;
    }
  }

  async function info(name: string): Promise<EntryCollectionInfo | null> {
    const collections = await loadCollections();
    const entry = collections?.[name];
    // A collection configured explicitly is usable even without a config module
    // (dir + overrides still apply; fields fall back to inference).
    if (!entry && !explicit[name]) return null;
    return {
      collection: name,
      dir: collectionDir(name),
      schema: entry ? await resolveSchema(entry.schema) : null,
      fieldConfig: explicit[name]?.fields ?? {},
    };
  }

  return {
    async forCollection(name) {
      return info(name);
    },

    async forFile(relFile) {
      const posix = relFile.replace(/\\/g, '/');
      // Explicit dirs win, then the src/content/<name>/ convention.
      for (const name of Object.keys(explicit)) {
        if (posix.startsWith(collectionDir(name) + '/')) return info(name);
      }
      const m = posix.match(/^src\/content\/([^/]+)\//);
      return m ? info(m[1]) : null;
    },
  };
}

function normalizeDir(dir: string): string {
  return dir.replace(/\\/g, '/').replace(/\/+$/, '');
}
