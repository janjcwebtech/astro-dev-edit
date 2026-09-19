import type { ClassifyRequest, ClassifyResult, CompositionLookupRequest, CompositionLookupResponse, CompositionUsesResponse, SlotPlacement, UsageProp, UsageSlot } from '../shared/protocol.ts';
import type { RenderOccurrence } from './render-occurrences.ts';

/**
 * One row of a chain link's *What this usage passes* list, after
 * indistinguishable slot insertions have been folded together.
 *
 * A page that drops 29 children into its layout passes 29 default slot runs,
 * and rendered one per row they say nothing a reader can act on while pushing
 * the rows that do — a named slot, a prop — off the panel (issue #74). The
 * fold is a property of the values, not of the markup that draws them, so it
 * lives here with the other pure model code.
 */
export type PassedRow =
  | { kind: 'prop'; prop: UsageProp }
  | { kind: 'slot'; slot: UsageSlot }
  /** A run of slots that render identically: same name, same verdict. */
  | { kind: 'slots'; name: string; verdict: UsageSlot['verdict']; count: number };

/**
 * Props first, then slots with identical rows folded.
 *
 * Two rules keep the fold honest:
 *
 * - **An `editable` slot is never folded.** It is a write target with its own
 *   byte range, and folding two of them would hide a value the panel exists to
 *   offer. Only a row that can do nothing but repeat collapses.
 * - **A fold keeps its run's first position.** The list is in source order, and
 *   a summary that jumped to the end would misplace it against the props
 *   around it.
 *
 * `name` is kept rather than flattened to `default`, so the caller owns the
 * wording and a repeated *named* slot folds without losing what it is called.
 */
export function passedRows(link: {
  props: readonly UsageProp[];
  slots: readonly UsageSlot[];
}): PassedRow[] {
  const rows: PassedRow[] = link.props.map(prop => ({ kind: 'prop', prop }));
  const folded = new Map<string, Extract<PassedRow, { kind: 'slots' }>>();
  for (const slot of link.slots) {
    if (slot.verdict === 'editable') { rows.push({ kind: 'slot', slot }); continue; }
    // A refusal's `reason` is not rendered, so two rows differing only there
    // are indistinguishable to the reader and fold together.
    const key = JSON.stringify([slot.name, slot.verdict]);
    const seen = folded.get(key);
    if (seen) { seen.count++; continue; }
    const row: Extract<PassedRow, { kind: 'slots' }> =
      { kind: 'slots', name: slot.name, verdict: slot.verdict, count: 1 };
    folded.set(key, row);
    rows.push(row);
  }
  return rows;
}

/** The sentence a {@link PassedRow} shows. Pure, so the wording is pinned by a
 *  test rather than read off a rendered panel. */
export function passedLabel(row: PassedRow): string {
  if (row.kind === 'prop') return `${row.prop.name} · ${row.prop.kind} · ${row.prop.verdict}`;
  if (row.kind === 'slot') return `slot ${row.slot.name || 'default'} · ${row.slot.verdict}`;
  const name = row.name || 'default';
  return row.count === 1
    ? `slot ${name} · ${row.verdict}`
    : `${row.count} ${name} slot insertions · ${row.verdict}`;
}

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
