import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type {
  CompositionCoverage, CompositionLinksResponse, CompositionLookupResponse,
  CompositionRefusal, CompositionUsesResponse, RenderOrdinals, UsageApplyRequest, UsageApplyTarget,
} from '../shared/protocol.ts';
import { resolveComposition } from './composition.ts';
import { proveLink } from './usage-parse.ts';
import { applyUsageWrite } from './usage-write.ts';
import type { CompositionService } from './composition-service.ts';
import type { OptionsResolver } from './options.ts';
import { isPackageOwned, validateEditablePath } from './paths.ts';
import type { RouteManifest } from './route-manifest.ts';
import type { Route } from './router.ts';
import type { TextWriter } from './text-writes.ts';

export interface CompositionRouteDeps {
  root: string;
  optionsResolver: OptionsResolver;
  routeManifest: RouteManifest | null;
  composition: CompositionService | null;
  /** The one write seam (rule 3). Only `/composition/apply` uses it. */
  writeText: TextWriter;
  logger: { info(message: string): void; warn(message: string): void };
}

/** The group shares the editor's localhost dispatcher and source-path gate.
 * Payloads choose a pathname, never the route's source anchor — and never a
 * file: `/composition/apply` names a usage id, and the file it resolves to
 * still passes `validateEditablePath` before anything is read or written. */
/** The render ordinals as sent, or null when the payload is not one. Keys are
 *  usage ids and values are counts, so anything else is a malformed request
 *  rather than a value to coerce. */
function ordinalsOf(value: unknown): RenderOrdinals | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 128) return null;
  for (const [id, ordinal] of entries) {
    if (!/^[\w-]{8}$/.test(id)) return null;
    if (typeof ordinal !== 'number' || !Number.isInteger(ordinal) || ordinal < 0 || ordinal > 1e6) return null;
  }
  return Object.fromEntries(entries) as RenderOrdinals;
}

/** The value a write names, or null when the payload is not one. A usage id
 *  and a byte *selector*; nothing here can name a path or an offset to write
 *  into — see {@link UsageApplyTarget}. */
function applyTargetOf(value: unknown): UsageApplyTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const target = value as Record<string, unknown>;
  if (target.kind !== 'prop' && target.kind !== 'slot') return null;
  if (typeof target.name !== 'string' || target.name.length > 256) return null;
  if (typeof target.start !== 'number' || !Number.isInteger(target.start) || target.start < 0) return null;
  return { kind: target.kind, name: target.name, start: target.start };
}

export function createCompositionRoutes(deps: CompositionRouteDeps): Route[] {
  const read: Route[] = ['/composition', '/composition/links', '/composition/uses'].map((path): Route => ({
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
        if (req.ordinals !== undefined && !ordinalsOf(req.ordinals)) {
          throw new Error('ordinals must map at most 128 usage ids to render counts');
        }
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
      const resolved = stale
        ? { tier: 'none' as const, links: [], reason: 'stale-index' as const }
        : resolveComposition({ route, file, chain: req.chain as string | undefined,
          traceVersion: req.traceVersion as 2 | undefined }, graph.links, graph.coverage.complete);
      // Only a `proven` chain names the instance that rendered this element,
      // so only a proven chain may meet a render ordinal with its array. An
      // inferred path or a candidate set names a *possible* usage site, and a
      // render count aimed at one of those would be a guess wearing a proof.
      const ordinals = resolved.tier === 'proven' ? ordinalsOf(req.ordinals) : null;
      const response: CompositionLookupResponse = { ...common, ...resolved,
        ...(ordinals ? { links: resolved.links.map(link =>
          proveLink(link, graph.frontmatter.get(link.file) ?? '', ordinals[link.id] ?? 0)) } : {}) };
      return { status: 200, body: response };
    },
  }));

  /**
   * The one write in this group.
   *
   * The request names a **usage id**, never a path. The id is resolved through
   * the server's own route-scoped index, the file it names passes
   * `validateEditablePath` exactly as every other write does, and the bytes go
   * through the injected `writeText` with the `original` they were verified
   * against (rules 3 and 5). The client's `start` is a selector among the
   * server's freshly parsed values, not an offset to write into.
   */
  const apply: Route = {
    method: 'POST', path: '/composition/apply', label: 'composition/apply', maxBytes: 256 * 1024,
    async handler(body) {
      const { options } = await deps.optionsResolver.resolve();
      if (!options.composition || !deps.composition) {
        return { status: 422, body: { error: 'Component composition is disabled in settings.', code: 'unsupported' } };
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('object body is required');
      const req = body as unknown as UsageApplyRequest;
      if (typeof req.pathname !== 'string' || !req.pathname.startsWith('/') || req.pathname.length > 4096) {
        throw new Error('pathname must be a local path of at most 4096 characters');
      }
      if (typeof req.usageId !== 'string' || !/^[\w-]{8}$/.test(req.usageId)) throw new Error('usageId is required');
      const target = applyTargetOf(req.target);
      if (!target) throw new Error('target must name a prop or a slot at a byte offset');
      if (typeof req.original !== 'string' || typeof req.newText !== 'string') {
        throw new Error('original and newText must be strings');
      }
      const ordinal = req.ordinal ?? 0;
      if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > 1e6) throw new Error('ordinal must be a render count');

      const hit = deps.routeManifest?.forPathname(req.pathname);
      if (!hit?.ok) return { status: 422, body: { error: 'No Astro route answers this page.', code: 'unresolved' } };
      const allow = async (file: string) => {
        const abs = await validateEditablePath(deps.root, options.contentRoots, ['.astro'], file);
        if (isPackageOwned(abs)) throw new Error('package source is outside composition scope');
        return abs;
      };
      let route: string;
      try { route = await allow(hit.file); }
      catch { return { status: 422, body: { error: 'This route is outside the editable content roots.', code: 'unsupported' } }; }
      const graph = await deps.composition.snapshot(route, allow);
      const link = graph.links.find(candidate => candidate.id === req.usageId);
      if (!link) {
        return { status: 422, body: { error: 'That component usage is no longer on this route — the source may have changed. Reload and try again.', code: 'unresolved' } };
      }
      // The file comes from the index, and it still passes the gate: a link
      // resolved from a graph is not a licence to write outside the roots.
      let abs: string;
      try { abs = await allow(link.file); }
      catch { return { status: 422, body: { error: 'That usage site is outside the editable content roots.', code: 'unsupported' } }; }
      const source = await readFile(abs, 'utf8');
      const result = await applyUsageWrite(source, {
        loc: link.loc, name: link.name, target, ordinal,
        original: req.original, newText: req.newText,
      });
      if (!result.ok) {
        deps.logger.warn(`usage apply refused (${result.code}): ${basename(abs)}:${link.loc} — ${result.error}`);
        return { status: 422, body: { error: result.error, code: result.code } };
      }
      await deps.writeText(abs, result.newSource, source);
      deps.logger.info(`applied ${target.kind} “${target.name}” -> ${basename(abs)}:${link.loc}`);
      return { status: 200, body: { ok: true } };
    },
  };

  return [...read, apply];
}
