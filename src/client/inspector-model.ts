import type { ClassifyRequest, ClassifyResult, CompositionLookupRequest, CompositionLookupResponse, CompositionUsesResponse, SlotPlacement } from '../shared/protocol.ts';
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
  /** Null when no chain was asked for — an element with no proven source, or
   *  one inside generated HTML. */
  chain: CompositionLookupResponse | null;
  uses: CompositionUsesResponse | null;
  /**
   * What the clicked element's own content is, settled against the AST.
   *
   * The Values card cannot be built without it: the DOM shows a resolved
   * `{expression}` and literal text as the same characters, so only
   * `/classify` can say which one a row is describing. Null when the element
   * has no source to classify, or when the request failed — `classifyError`
   * then carries the sentence the panel shows instead of a verdict.
   */
  classification: ClassifyResult | null;
  classifyError?: string;
}

/** One selection owns one request generation. A close, navigation, or render
 * invalidation also invalidates pending responses, even if the DOM survives. */
export function createInspectorLoader(api: {
  getComposition(request: CompositionLookupRequest): Promise<CompositionLookupResponse>;
  getCompositionUses(request: { pathname: string; file: string }): Promise<CompositionUsesResponse>;
  classify(request: ClassifyRequest): Promise<ClassifyResult>;
}) {
  let generation = 0;
  /** A failed classification is a caption, never a thrown selection: the chain
   *  half of the panel is still worth showing. */
  const classify = (element: ClassifyRequest | null) => element === null
    ? Promise.resolve({ classification: null } as Pick<Inspection, 'classification' | 'classifyError'>)
    : api.classify(element).then(
      classification => ({ classification }),
      (error: unknown) => ({ classification: null,
        classifyError: `Could not classify this element — ${error instanceof Error ? error.message : 'unknown error'}` }));
  return {
    invalidate() { generation++; },
    /** `request` is null for a selection with no chain to resolve; `element`
     *  is null for one with no source loc to classify. */
    async load(
      request: CompositionLookupRequest | null,
      element: ClassifyRequest | null,
    ): Promise<Inspection | null> {
      const current = ++generation;
      for (let attempt = 0; attempt < 2; attempt++) {
        const [chain, uses, classified] = await Promise.all([
          request && api.getComposition(request),
          request && api.getCompositionUses({ pathname: request.pathname, file: request.file }),
          classify(element),
        ]);
        if (current !== generation) return null;
        // Independently discovered graphs must describe the same generation.
        if (chain && uses && (chain.reason === 'stale-index' || uses.reason === 'stale-index' ||
          chain.coverage.revision !== uses.coverage.revision || chain.route !== uses.route)) {
          if (!attempt) continue;
          throw new Error('Source changed during inspection. Select the element again.');
        }
        return { chain, uses, ...classified };
      }
      return null;
    },
  };
}
