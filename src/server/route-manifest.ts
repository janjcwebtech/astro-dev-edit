import { existsSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import type { PageSourceRefusal } from '../shared/protocol.ts';
import { insideRoot, isPackageOwned } from './paths.ts';

/**
 * "Which file is this URL's page written in?" — answered from Astro's own route
 * manifest, captured by the `astro:routes:resolved` hook in `src/index.ts`.
 *
 * The DOM cannot answer this. Component tags are never annotated
 * (`annotate.ts`), so counting `data-astro-source-file` values makes a
 * markup-dense `Nav.astro` outrank a page that merely composes components —
 * which is exactly how *Open page source* used to pick the wrong file. Astro
 * already knows the answer, so we ask it.
 *
 * Impure only in `existsSync` (injected, so tests stay pure), and injected into
 * the middleware the way `content-config.ts` is: **every failure path is a
 * refusal, never a throw and never a guess.** A caller handed `ok: false` tells
 * the user why nothing opened.
 *
 * Three things about the matching are load-bearing, all verified against
 * Astro's own `dist/core/routing/`:
 *
 *   1. **`patternRegex` matches the base-*stripped* pathname.** `getPattern`
 *      takes `base` but only consumes it on a branch its own guard makes
 *      unreachable; Astro strips the base before matching. So we strip it here.
 *      `config.base` is not normalized by Astro's schema, so `docs`, `/docs`
 *      and `/docs/` all have to work.
 *   2. **`trailingSlash` is already baked into the regex** (`\/$`, `$`, `\/?$`)
 *      and Astro redirects to the canonical form, so we read no config for it —
 *      we try the pathname as given, then the slash-flipped form.
 *   3. **Astro sorts routes by priority before the hook fires,** and its own
 *      `matchRoute` takes the first pattern hit. We iterate in array order and
 *      the first `page` hit wins, so an index route beats the catch-all that
 *      also matches it.
 */

/**
 * The four fields of Astro's `IntegrationResolvedRoute` this module reads,
 * declared structurally rather than imported.
 *
 * Deliberate: `astro` is a peer over `>=5.0.0 <8`, and importing the real type
 * would turn any field rename in any of those majors into a `typecheck` failure
 * for a module that reads four fields. `type` is widened to `string` so Astro's
 * own `RouteType` union can grow without breaking the hook's assignability.
 */
export interface ResolvedRouteLike {
  /** The route pattern, e.g. "/articles/[...slug]". Reported, never parsed. */
  pattern: string;
  /** The regex Astro itself matches a base-stripped pathname with. */
  patternRegex: RegExp;
  /** Root-relative, forward-slashed component path, e.g. "src/pages/index.astro". */
  entrypoint: string;
  /** "page" | "endpoint" | "redirect" | "fallback", widened. */
  type: string;
}

export type RouteLookup =
  | { ok: true; file: string; pattern: string }
  | { ok: false; refusal: PageSourceRefusal };

export interface RouteManifest {
  /** The file the given browser pathname's page is written in, or a refusal. */
  forPathname(pathname: string): RouteLookup;
}

export interface RouteManifestConfig {
  /** Project root (fsPath). */
  root: string;
  /** `config.base`, verbatim — unnormalized, as Astro's schema leaves it. */
  base: string;
  /**
   * The routes, as a **thunk**. Astro re-fires `astro:routes:resolved` on every
   * add/unlink/change under `srcDir`, so a captured array would go stale the
   * first time a page is added — the same reason the schema provider takes its
   * options as a thunk rather than a value.
   */
  routes: () => readonly ResolvedRouteLike[];
  /** Seam for tests; defaults to `existsSync`. */
  exists?: (abs: string) => boolean;
}

export function createRouteManifest(cfg: RouteManifestConfig): RouteManifest {
  const exists = cfg.exists ?? existsSync;

  // "/" → "", and `docs` / `/docs` / `/docs/` all → "/docs".
  const trimmed = cfg.base.replace(/\/+$/, '');
  const basePrefix =
    trimmed === '' ? '' : trimmed.startsWith('/') ? trimmed : `/${trimmed}`;

  /** Browser pathname → the form Astro's own pattern regexes expect. */
  function normalize(pathname: string): string | null {
    let p = pathname;
    // Defence only: location.pathname carries neither.
    const cut = p.search(/[?#]/);
    if (cut !== -1) p = p.slice(0, cut);
    // Astro's dev handler decodes, and getPattern normalizes its literal
    // segments — without both, a non-ASCII route never matches.
    try {
      p = decodeURI(p);
    } catch {
      /* keep the raw form; a malformed escape simply won't match */
    }
    p = p.normalize().replace(/\/{2,}/g, '/');
    if (basePrefix) {
      if (p === basePrefix) p = '/';
      else if (p.startsWith(`${basePrefix}/`)) p = p.slice(basePrefix.length);
      // Outside the configured base — not a route of this site at all.
      else return null;
    }
    return p.startsWith('/') ? p : `/${p}`;
  }

  return {
    forPathname(pathname) {
      const routes = cfg.routes();
      if (routes.length === 0) return { ok: false, refusal: 'no-routes' };
      if (typeof pathname !== 'string' || pathname === '') {
        return { ok: false, refusal: 'no-match' };
      }
      const norm = normalize(pathname);
      if (norm === null) return { ok: false, refusal: 'no-match' };

      // Variants outer, routes inner: an exact hit on the canonical pathname
      // must beat a slash-flipped hit on a lower-priority route.
      const variants =
        norm === '/' ? [norm] : [norm, norm.endsWith('/') ? norm.slice(0, -1) : `${norm}/`];

      for (const variant of variants) {
        for (const route of routes) {
          // Only pages have a template you would open. Endpoints, redirects and
          // fallbacks are skipped rather than refused — a later route may match.
          if (route.type !== 'page') continue;
          // We don't own these regexes, and `.test` on a g/y one is stateful.
          if (route.patternRegex.global || route.patternRegex.sticky) {
            route.patternRegex.lastIndex = 0;
          }
          if (!route.patternRegex.test(variant)) continue;

          // First hit wins, mirroring Astro's own matchRoute — so when it is not
          // openable we say which way it failed rather than scanning on and
          // opening some other route's file.
          const abs = resolve(cfg.root, route.entrypoint.split('/').join(sep));
          if (!insideRoot(cfg.root, abs) || isPackageOwned(abs)) {
            return { ok: false, refusal: 'not-in-project' };
          }
          // Astro injects a default 404 page that has no file on disk.
          if (!exists(abs)) return { ok: false, refusal: 'missing' };
          return {
            ok: true,
            file: relative(cfg.root, abs).split(sep).join('/'),
            pattern: route.pattern,
          };
        }
      }
      return { ok: false, refusal: 'no-match' };
    },
  };
}
