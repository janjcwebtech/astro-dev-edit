import type { AstroIntegrationLogger } from 'astro';
import { resolve } from 'node:path';
import type { EntryResolveRefusal, EntryResolveRequest, EntryResolveResponse } from '../shared/protocol.ts';
import { entryId, inContentRoots, listEntryFiles } from './collection-entries.ts';
import type { EntryCollectionInfo, EntrySchemaProvider } from './content-config.ts';
import type { DetailRoutes } from './entry-detect.ts';
import { ENTRY_EXTENSIONS } from './entry-routes.ts';
import type { OptionsResolver } from './options.ts';
import type { RouteManifest } from './route-manifest.ts';
import type { Route } from './router.ts';

/**
 * The entry-resolve route group (`/entry/resolve`) — "which content entry backs
 * the page I am looking at?", answered so a project need not emit the
 * `astro-dev-edit:page-source` meta tag by hand.
 *
 * Its own module rather than a corner of `entry-routes.ts`, for the reason
 * `page-source-routes.ts` is its own module: that group's routes all take a
 * **file** and write it, while this one takes a **pathname** and writes nothing.
 * It is resolve-only — the file it names is handed back to the client, which
 * POSTs it to `/entry` like any other, and passes that group's own path gate
 * there. Nothing here opens, reads or writes an entry.
 *
 * **A refusal is an answer.** Every failure path names why, and the client keeps
 * the entry button hidden — exactly the behaviour a page with no meta tag has
 * today. The one refusal that carries data is `not-enabled`: the entry was
 * found and its collection is switched off, so the refusal notice can name what
 * it is offering to switch on.
 *
 * ## Why three layers
 *
 * Matching a URL's tail against entry ids alone would answer, but not safely.
 * Two collections holding a `hello-world.md` are indistinguishable that way, and
 * a dynamic pattern matches far more paths than it generates — the bug behind
 * issue #8, where a dead URL resolved to a real route file. So:
 *
 *  1. **The route manifest** maps the pathname to a page file and a pattern, and
 *     a pattern with no dynamic segment is refused outright: a listing route
 *     renders a set of entries with no single backing file.
 *  2. **The page file is scanned** for `getCollection('x')`, which binds route
 *     to collection from the user's own source rather than by inference.
 *  3. **The pathname's tail is matched** against those collections' entry ids.
 *
 * Layer 3 is what makes a dead URL safe: the id of a path nobody wrote is not a
 * file on disk, so the answer is `no-entry` rather than someone else's entry.
 */

export interface EntryResolveRouteDeps {
  logger: AstroIntegrationLogger;
  /** Project root (fsPath). */
  root: string;
  /** Live options — `entryEditor` gates the group, `contentRoots` confines every
   *  directory read, `editableExtensions` narrows which files count as entries. */
  optionsResolver: OptionsResolver;
  /** Collection lookup. Null → nothing resolves, answered as a refusal. */
  schemaProvider: EntrySchemaProvider | null;
  /** Astro's route manifest, or null when there is none. */
  routeManifest: RouteManifest | null;
  /** The route→collection scan. Null → every enabled collection stays a
   *  candidate, and layer 3 alone has to be unique. */
  detailRoutes: DetailRoutes | null;
}

/** A refusal, as the wire carries it. */
function refuse(
  refusal: EntryResolveRefusal,
  extra: Partial<EntryResolveResponse> = {},
): { status: 200; body: EntryResolveResponse } {
  return {
    status: 200,
    body: {
      file: null,
      collection: null,
      entryFile: null,
      pageEditingLocked: false,
      pattern: null,
      refusal,
      ...extra,
    },
  };
}

/**
 * A browser pathname reduced to what an entry id could equal.
 *
 * Only the parts an id can carry: the base is already stripped by the route
 * manifest's own matching, so what is left is percent-decoding, collapsing
 * repeated slashes, and dropping the trailing one. An index route's pathname
 * ends `/`, and after this it is the parent path — which is correct, since an
 * entry named `index` sits at its parent's URL.
 */
function normalizePath(pathname: string): string {
  let p = pathname;
  const cut = p.search(/[?#]/);
  if (cut !== -1) p = p.slice(0, cut);
  try {
    p = decodeURI(p);
  } catch {
    /* a malformed escape simply won't match anything */
  }
  p = p.normalize().replace(/\/{2,}/g, '/');
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

/** Whether a route pattern renders one of a set rather than exactly one page. */
function isDynamic(pattern: string): boolean {
  return pattern.includes('[');
}

interface Candidate {
  collection: string;
  file: string;
  /** Length of the id that matched, so the most specific one can win. */
  idLength: number;
}

export function createEntryResolveRoutes(deps: EntryResolveRouteDeps): Route[] {
  const { logger, root, optionsResolver, schemaProvider, routeManifest, detailRoutes } = deps;

  return [
    {
      method: 'POST',
      path: '/entry/resolve',
      maxBytes: 4 * 1024,
      label: 'entry resolve',
      handler: async (body) => {
        const { options } = await optionsResolver.resolve();
        if (options.entryEditor === false) return refuse('disabled');

        const { pathname } = (body ?? {}) as EntryResolveRequest;
        if (typeof pathname !== 'string' || pathname === '') {
          throw new Error('pathname is required');
        }

        // --- layer 1: which page renders this URL --------------------------
        const hit = routeManifest?.forPathname(pathname);
        if (!hit) return refuse('no-routes');
        if (!hit.ok) return refuse(hit.refusal === 'no-routes' ? 'no-routes' : 'no-match');
        if (!isDynamic(hit.pattern)) return refuse('not-detail', { pattern: hit.pattern });

        const all = (await schemaProvider?.listCollections()) ?? [];
        if (all.length === 0) return refuse('no-entry', { pattern: hit.pattern });

        // --- layer 2: which collection that page renders --------------------
        // A name the scan reports but the project doesn't declare is dropped
        // rather than trusted; finding none leaves every collection a candidate,
        // which is the honest state for a route that fetches through a helper.
        const named = (await detailRoutes?.collectionsIn(hit.file)) ?? [];
        const declared = new Set(all.map((c) => c.collection));
        const scoped = named.filter((n) => declared.has(n));
        const candidates: EntryCollectionInfo[] =
          scoped.length > 0 ? all.filter((c) => scoped.includes(c.collection)) : all;

        // --- layer 3: which entry ------------------------------------------
        const target = normalizePath(pathname);
        const extensions = ENTRY_EXTENSIONS.filter((e) => options.editableExtensions.includes(e));
        const matches: Candidate[] = [];
        for (const info of candidates) {
          const dirAbs = resolve(root, info.dir);
          // The same confinement `/collection/entries` applies. A collection
          // pointed outside the content roots is not listed, not refused: another
          // collection may still answer.
          if (!inContentRoots(root, dirAbs, options.contentRoots)) continue;
          const { names } = await listEntryFiles(dirAbs, extensions);
          for (const name of names) {
            const id = entryId(name);
            if (target === `/${id}` || target.endsWith(`/${id}`)) {
              matches.push({ collection: info.collection, file: `${info.dir}/${name}`, idLength: id.length });
            }
          }
        }

        if (matches.length === 0) return refuse('no-entry', { pattern: hit.pattern });

        // The longest id wins, which is how a nested id (`2026/hello`) beats a
        // leaf of the same name (`hello`) on the URL they share a tail of. A tie
        // is a genuine ambiguity and refuses rather than picking.
        matches.sort((a, b) => b.idLength - a.idLength);
        if (matches.length > 1 && matches[1].idLength === matches[0].idLength) {
          logger.debug(
            `entry resolve: ${pathname} matches ${matches
              .filter((m) => m.idLength === matches[0].idLength)
              .map((m) => m.file)
              .join(', ')}`,
          );
          return refuse('ambiguous', { pattern: hit.pattern });
        }

        const best = matches[0];
        const info = candidates.find((c) => c.collection === best.collection);
        if (info?.pageEditing !== true) {
          // Found it, and the user hasn't switched this collection on. Both
          // names travel so the notice can offer exactly this, by name.
          return refuse('not-enabled', {
            collection: best.collection,
            entryFile: best.file,
            // Offering a switch whose write would be refused is worse than not
            // offering it, so the notice is told not to.
            pageEditingLocked:
              optionsResolver.entryEditorConfig()?.collections?.[best.collection]?.pageEditing !==
              undefined,
            pattern: hit.pattern,
          });
        }

        const found: EntryResolveResponse = {
          file: best.file,
          collection: best.collection,
          entryFile: best.file,
          pageEditingLocked: false,
          pattern: hit.pattern,
          refusal: null,
        };
        return { status: 200, body: found };
      },
    },
  ];
}
