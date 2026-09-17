import type { CompositionLookupRequest, CompositionLookupResponse, CompositionUsesResponse, SlotPlacement } from '../shared/protocol.ts';
import type { RenderOccurrence } from './render-occurrences.ts';

/** Render groups are insertion identities, never records or write targets. */
export function occurrenceSummary(
  selected: RenderOccurrence,
  peers: readonly RenderOccurrence[],
): { index: number; total: number; slots: SlotPlacement[] } | null {
  if (!selected.group || selected.reason) return null;
  const groups = [...new Set(peers.filter(p => p.group && !p.reason).map(p => p.group))];
  const index = groups.indexOf(selected.group);
  return index < 0 ? null : { index: index + 1, total: groups.length, slots: selected.slots };
}

export interface Inspection {
  chain: CompositionLookupResponse;
  uses: CompositionUsesResponse;
}

/** One selection owns one request generation. A close, navigation, or render
 * invalidation also invalidates pending responses, even if the DOM survives. */
export function createInspectorLoader(api: {
  getComposition(request: CompositionLookupRequest): Promise<CompositionLookupResponse>;
  getCompositionUses(request: { pathname: string; file: string }): Promise<CompositionUsesResponse>;
}) {
  let generation = 0;
  return {
    invalidate() { generation++; },
    async load(request: CompositionLookupRequest): Promise<Inspection | null> {
      const current = ++generation;
      for (let attempt = 0; attempt < 2; attempt++) {
        const [chain, uses] = await Promise.all([
          api.getComposition(request),
          api.getCompositionUses({ pathname: request.pathname, file: request.file }),
        ]);
        if (current !== generation) return null;
        // Independently discovered graphs must describe the same generation.
        if (chain.reason === 'stale-index' || uses.reason === 'stale-index' ||
          chain.coverage.revision !== uses.coverage.revision || chain.route !== uses.route) {
          if (!attempt) continue;
          throw new Error('Source changed during inspection. Select the element again.');
        }
        return { chain, uses };
      }
      return null;
    },
  };
}
