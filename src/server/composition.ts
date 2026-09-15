import type { CompositionRequest, CompositionResponse, UsageLink } from '../shared/protocol.ts';

/** A spread can erase an entire recursive cycle and leave a valid-looking
 * prefix ending in the SAME file. The surviving chain cannot distinguish
 * that render from the outer instance, so all affected prefixes downgrade. */
function hasSpreadCycle(files: string[], links: readonly UsageLink[]): boolean {
  let budget = 4096;
  for (const start of new Set(files)) {
    const seen = new Set<string>();
    const walk = (file: string, spread: boolean): boolean => {
      if (--budget < 0) return true;
      const key = JSON.stringify([file, spread]);
      if (seen.has(key)) return false;
      seen.add(key);
      for (const link of links) {
        if (link.file !== file || link.refusal || !link.target) continue;
        const nextSpread = spread || link.hasSpread;
        if (link.target === start && nextSpread) return true;
        if (walk(link.target, nextSpread)) return true;
      }
      return false;
    };
    if (walk(start, false)) return true;
  }
  return false;
}

/** Every hop must agree with the next caller, and the root with the route.
 * Even a structurally valid chain through a spread is not a runtime proof:
 * recursive/same-target forwarding can overwrite a link without failing the
 * leaf equation. Static recovery requires an explicitly complete graph. */
export function resolveComposition(
  request: CompositionRequest, links: readonly UsageLink[], completeGraph = false,
): CompositionResponse {
  if (request.traceVersion === 2 && request.chain === '?') return { tier: 'none', links: [], reason: 'chain-break' };
  const byId = new Map(links.map(link => [link.id, link]));
  let reason: CompositionResponse['reason'] = 'invalid-chain';
  if (request.chain && /^(?:!|(?:\.[\w-]{8})+)$/.test(request.chain)) {
    const ids = request.chain === '!' ? [] : request.chain.slice(1).split('.');
    const chain = ids.map(id => byId.get(id));
    let file = request.route;
    let valid = ids.length <= 128;
    for (const link of chain) {
      if (!link || link.refusal || !link.target || link.file !== file) { valid = false; break; }
      file = link.target;
    }
    valid &&= file === request.file;
    const spread = request.traceVersion !== 2 && (chain.some(link => link?.hasSpread) ||
      (valid && hasSpreadCycle([request.route, ...chain.map(link => link!.target!)], links)));
    if (valid && !spread) {
      return { tier: 'proven', links: chain as UsageLink[] };
    }
    if (spread) reason = 'spread';
  }
  if (!completeGraph) return { tier: 'none', links: [], reason: reason === 'spread' ? reason : 'incomplete-index' };
  const paths: UsageLink[][] = [];
  // Prune unrelated branches; a cycle elsewhere on the page says nothing
  // about this target, while a cycle reaching it makes static depth unknown.
  const reachable = new Set([request.file]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const link of links) {
      if (!link.refusal && link.target && reachable.has(link.target) && !reachable.has(link.file)) {
        reachable.add(link.file); changed = true;
      }
    }
  }
  let exhausted = false;
  let recursive = false;
  let visits = 0;
  const walk = (file: string, path: UsageLink[], seen: Set<string>) => {
    if (++visits > 4096 || path.length > 128) { exhausted = true; return; }
    if (!reachable.has(file)) return;
    if (seen.has(file)) { recursive = true; return; }
    if (file === request.file) paths.push(path);
    if (paths.length > 8) return;
    for (const link of links) {
      if (link.file === file && link.target && !link.refusal) {
        walk(link.target, [...path, link], new Set([...seen, file]));
      }
    }
  };
  walk(request.route, [], new Set());
  if (recursive) return { tier: 'none', links: [], reason: reason === 'spread' ? reason : 'recursive' };
  if (exhausted || paths.length > 8) return { tier: 'none', links: [], reason: 'too-many-paths' };
  if (paths.length === 0) return { tier: 'none', links: [], reason: 'no-path' };
  if (paths.length === 1) return { tier: 'inferred', links: paths[0], reason };
  return { tier: 'candidates', links: [], candidates: paths, reason };
}
