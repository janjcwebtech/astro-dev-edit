import type {
  CompositionCoverage, CompositionLinksResponse, CompositionLookupResponse,
  CompositionRefusal, CompositionUsesResponse,
} from '../shared/protocol.ts';
import { resolveComposition } from './composition.ts';
import type { CompositionService } from './composition-service.ts';
import type { OptionsResolver } from './options.ts';
import { isPackageOwned, validateEditablePath } from './paths.ts';
import type { RouteManifest } from './route-manifest.ts';
import type { Route } from './router.ts';

export interface CompositionRouteDeps {
  root: string;
  optionsResolver: OptionsResolver;
  routeManifest: RouteManifest | null;
  composition: CompositionService | null;
}

/** Read-only routes use the same localhost dispatcher and source-path gate as
 * the editor. Payloads choose a pathname, never the route's source anchor. */
export function createCompositionRoutes(deps: CompositionRouteDeps): Route[] {
  return ['/composition', '/composition/links', '/composition/uses'].map((path): Route => ({
    method: 'POST', path, label: path.slice(1), maxBytes: 32 * 1024,
    async handler(body) {
      const empty: CompositionCoverage = { complete: false, files: 0, revision: 0, issues: [] };
      const fail = (reason: CompositionRefusal) => ({ status: 200, body: path === '/composition'
        ? { tier: 'none', links: [], reason, route: null, coverage: empty } satisfies CompositionLookupResponse
        : { links: [], reason, route: null, coverage: empty, ...(path.endsWith('/links') ? { missing: [] } : {}) } });
      const { options } = await deps.optionsResolver.resolve();
      if (!options.composition || !deps.composition) return fail('disabled');
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('object body is required');
      const req = body as Record<string, unknown>;
      if (typeof req.pathname !== 'string' || !req.pathname.startsWith('/') || req.pathname.length > 4096) {
        throw new Error('pathname must be a local path of at most 4096 characters');
      }
      const batch = path.endsWith('/links');
      if (batch) {
        if (!Array.isArray(req.ids) || req.ids.length > 128 || req.ids.some(id => typeof id !== 'string' || !/^[\w-]{8}$/.test(id))) {
          throw new Error('ids must contain at most 128 usage ids');
        }
      } else if (typeof req.file !== 'string' || !req.file || req.file.length > 4096) throw new Error('file is required');
      if (path === '/composition') {
        if (req.chain !== undefined && (typeof req.chain !== 'string' || !/^(?:!|\?|(?:\.[\w-]{8}){1,128})$/.test(req.chain))) {
          throw new Error('chain must be a root, break, or at most 128 usage ids');
        }
        if (req.traceVersion !== undefined && req.traceVersion !== 2) throw new Error('unsupported traceVersion');
      }
      const hit = deps.routeManifest?.forPathname(req.pathname);
      if (!hit?.ok) return fail('no-route');
      const allow = async (file: string) => {
        const abs = await validateEditablePath(deps.root, options.contentRoots, ['.astro'], file);
        if (isPackageOwned(abs)) throw new Error('package source is outside composition scope');
        return abs;
      };
      let route: string, file = '';
      try { route = await allow(hit.file); if (!batch) file = await allow(req.file as string); }
      catch { return fail('path-refused'); }
      const graph = await deps.composition.snapshot(route, allow);
      const common = { route, coverage: graph.coverage };
      const stale = graph.coverage.issues.some(i => i.reason === 'stale-index');
      if (batch) {
        const ids = [...new Set(req.ids as string[])];
        const found = new Map(graph.links.map(link => [link.id, link]));
        const response: CompositionLinksResponse = { ...common,
          links: ids.flatMap(id => found.has(id) ? [found.get(id)!] : []),
          missing: ids.filter(id => !found.has(id)), ...(stale ? { reason: 'stale-index' } : {}) };
        return { status: 200, body: response };
      }
      if (path.endsWith('/uses')) {
        const response: CompositionUsesResponse = { ...common, links: graph.links.filter(link => link.target === file),
          ...(stale ? { reason: 'stale-index' } : {}) };
        return { status: 200, body: response };
      }
      const response: CompositionLookupResponse = { ...common, ...(stale
        ? { tier: 'none' as const, links: [], reason: 'stale-index' as const }
        : resolveComposition({ route, file, chain: req.chain as string | undefined,
          traceVersion: req.traceVersion as 2 | undefined }, graph.links, graph.coverage.complete)) };
      return { status: 200, body: response };
    },
  }));
}
