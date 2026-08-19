import type { AstroIntegrationLogger } from 'astro';
import type { PageSourceRequest, PageSourceResponse } from '../shared/protocol.ts';
import type { OptionsResolver } from './options.ts';
import type { RouteManifest } from './route-manifest.ts';
import type { Route } from './router.ts';

/**
 * The page-source route group (/page-source) — "which file is the page I am
 * looking at written in?", for the admin bar's *Open page source*.
 *
 * Its own module rather than a core route because the core table is the
 * loc-based editing flow: every route there takes a `SourceLoc` or an asset,
 * while this one takes a **pathname** and carries its own injected capability
 * (`route-manifest.ts`). The shape is `/inspect/open`'s — one route, one
 * feature, sharing the `openInEditor` gate.
 *
 * **Resolve-only: it opens nothing.** `/open` stays the single editor-launch
 * path behind `validateEditablePath`, which keeps the matching algorithm
 * testable in vitest instead of spawning the developer's editor on every
 * assertion. Read-only — no writes ever pass through here.
 */

export interface PageSourceRouteDeps {
  logger: AstroIntegrationLogger;
  /** Live options — `openInEditor` gates the group and can change without a
   *  dev-server restart. */
  optionsResolver: OptionsResolver;
  /** Astro's route manifest, or null when there is none (a test, or an Astro
   *  that never fired the routes hook) — answered as a refusal, not a guess. */
  routeManifest: RouteManifest | null;
}

export function createPageSourceRoutes(deps: PageSourceRouteDeps): Route[] {
  const { logger, optionsResolver, routeManifest } = deps;

  return [
    // Resolve a browser pathname to the source file of the route serving it.
    {
      method: 'POST',
      path: '/page-source',
      maxBytes: 64 * 1024,
      label: 'page-source',
      handler: async (body) => {
        const { options } = await optionsResolver.resolve();
        if (!options.openInEditor) {
          return { status: 403, body: { error: 'open-in-editor is disabled by configuration' } };
        }
        const { pathname } = body as PageSourceRequest;
        if (typeof pathname !== 'string' || pathname === '') {
          throw new Error('pathname is required');
        }

        const hit = routeManifest?.forPathname(pathname) ?? {
          ok: false as const,
          refusal: 'no-routes' as const,
        };
        if (!hit.ok) {
          // The one diagnostic anyone wants when this misfires. debug, not
          // info: a menu click should not print to the dev server log.
          logger.debug(`page-source: ${pathname} → ${hit.refusal}`);
          const miss: PageSourceResponse = { file: null, pattern: null, refusal: hit.refusal };
          // A miss is an answer, not an error — the panel says why nothing
          // opened, the same way /classify reports a non-editable element.
          return { status: 200, body: miss };
        }
        const found: PageSourceResponse = { file: hit.file, pattern: hit.pattern, refusal: null };
        return { status: 200, body: found };
      },
    },
  ];
}
