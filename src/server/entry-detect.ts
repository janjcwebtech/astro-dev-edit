import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RouteManifest } from './route-manifest.ts';

/**
 * "Which collection does this page route render?" — the layer between a URL's
 * page file and an entry file.
 *
 * Matching a URL's last segment against entry ids alone is not enough to be
 * safe: two collections holding a `hello-world.md` are indistinguishable that
 * way, and the honest answer would be a refusal on a site where nothing is
 * actually ambiguous. Astro's own route file says which collection it renders —
 * `getCollection('blog')` is right there in the frontmatter — so we read it.
 *
 * **A scan, not a parse.** The same stance `patcher/content-config.ts` takes,
 * for the same reason: Vite's `parseAst` throws on `import type`, `satisfies`
 * and type annotations, all legitimate in a page's frontmatter, and a parser
 * that refuses real files is worse than a scanner that sometimes finds nothing.
 * Finding nothing is a supported outcome here — a route that fetches through a
 * helper names no collection, and the caller falls back to matching against
 * every collection the user has switched on.
 *
 * Nothing here decides anything. It reports what the source says; the resolver
 * decides, and refuses when the answer isn't unique.
 */

/**
 * Collection names a page's source names, in first-seen order.
 *
 * Deliberately narrow: only the two calls that take a collection name as a
 * string literal. `getCollection(name)` with a variable is not matched, and
 * should not be — a name this cannot prove is a name it must not report.
 */
export function collectionsNamedIn(source: string): string[] {
  const out: string[] = [];
  const re = /\bget(?:Collection|Entry)\s*\(\s*(['"])([A-Za-z0-9_$-]+)\1/g;
  for (const m of source.matchAll(re)) {
    if (!out.includes(m[2])) out.push(m[2]);
  }
  return out;
}

export interface DetailRoutes {
  /** Collections the page at this root-relative path names. Empty when it names
   *  none — a route that fetches through a helper, or a file we can't read. */
  collectionsIn(file: string): Promise<string[]>;
  /** The first dynamic page route naming this collection, or null. What the
   *  Collections panel shows beside a row so the binding is visible. */
  patternFor(collection: string): Promise<string | null>;
}

export interface DetailRoutesDeps {
  /** Project root (fsPath). */
  root: string;
  /** Astro's route manifest, or null when there is none — then nothing is
   *  detected and every answer is empty, never a guess. */
  routeManifest: RouteManifest | null;
  /** Seam for tests. Defaults to reading the file; a throw reads as "names
   *  nothing", since a page we cannot read cannot be said to name anything. */
  readSource?: (abs: string) => Promise<string>;
  /** Seam for tests; the mtime a cached scan is keyed on. */
  mtimeOf?: (abs: string) => Promise<number>;
}

/**
 * A scanner with a per-file cache keyed on mtime.
 *
 * The cache matters because both callers are on hot paths — the resolver runs
 * on every page load, the panel on every open — while page frontmatter changes
 * rarely. Keying on mtime rather than clearing on HMR keeps it correct without
 * this module having to know when Astro re-fires anything.
 */
export function createDetailRoutes(deps: DetailRoutesDeps): DetailRoutes {
  const { root, routeManifest } = deps;
  const readSource = deps.readSource ?? ((abs: string) => readFile(abs, 'utf8'));
  const mtimeOf = deps.mtimeOf ?? (async (abs: string) => (await stat(abs)).mtimeMs);

  const cache = new Map<string, { mtime: number; names: string[] }>();

  async function collectionsIn(file: string): Promise<string[]> {
    const abs = resolve(root, file);
    let mtime: number;
    try {
      mtime = await mtimeOf(abs);
    } catch {
      return [];
    }
    const hit = cache.get(abs);
    if (hit && hit.mtime === mtime) return hit.names;
    let names: string[];
    try {
      names = collectionsNamedIn(await readSource(abs));
    } catch {
      names = [];
    }
    cache.set(abs, { mtime, names });
    return names;
  }

  return {
    collectionsIn,

    async patternFor(collection) {
      for (const page of routeManifest?.dynamicPages() ?? []) {
        if ((await collectionsIn(page.file)).includes(collection)) return page.pattern;
      }
      return null;
    },
  };
}
