import type { RenderOrdinals, SlotPlacement } from '../shared/protocol.ts';

export type TraceEvent =
  | { type: 'comment'; text: string }
  | { type: 'element'; key: number; instance: string; parent: string; file: string; chain: string; ordinal: string; opaque?: boolean };
export interface RenderOccurrence {
  key: number;
  instance: string;
  /** Source-render identity + actual insertion path. */
  group: string | null;
  slots: SlotPlacement[];
  /** {@link RenderTrace.ordinal} as counted on the server: which render of the
   *  owning usage site produced this element. `0` when the chain broke. It is
   *  a render count, not an array index — see the protocol shape. */
  ordinal: number;
  reason?: 'untracked-html';
}
const id = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{24}$/.test(value);
const chain = (value: unknown) => typeof value === 'string' && /^(?:!|\?|(?:\.[\w-]{8})+)$/.test(value);
/** A non-negative integer, or null for anything else — a malformed ordinal is
 *  a damaged trace, not a value to coerce. */
const ordinalOf = (value: string): number | null => (/^\d+$/.test(value) ? Number(value) : null);

/** Feed DOM-order comments and annotated elements. Fail closed on damaged
 * boundaries; never attach content to an invented or partially parsed slot. */
export function renderOccurrences(events: readonly TraceEvent[]): { ok: true; occurrences: RenderOccurrence[]; placements: SlotPlacement[] } | { ok: false; reason: string } {
  const stack: SlotPlacement[] = [];
  const seen = new Set<string>();
  const occurrences: RenderOccurrence[] = [];
  const placements: SlotPlacement[] = [];
  for (const event of events) {
    if (event.type === 'element') {
      if (event.opaque) {
        occurrences.push({ key: event.key, instance: event.instance, group: null, slots: [], ordinal: 0, reason: 'untracked-html' });
        continue;
      }
      const ordinal = ordinalOf(event.ordinal);
      if (!id(event.instance) || (event.parent !== '' && !id(event.parent)) || !chain(event.chain) || !event.file ||
        ordinal === null) {
        return { ok: false, reason: 'invalid-instance' };
      }
      occurrences.push({ key: event.key, instance: event.instance, ordinal,
        group: [event.instance, ...stack.map(slot => slot.id)].join('/'), slots: [...stack] });
    } else if (event.text.startsWith('atx-slot:')) {
      try {
        const slot = JSON.parse(decodeURIComponent(event.text.slice('atx-slot:'.length))) as SlotPlacement;
        if (!slot || !id(slot.id) || !id(slot.receiver) || seen.has(slot.id) ||
          typeof slot.name !== 'string' || typeof slot.file !== 'string' || !slot.file || !chain(slot.chain) ||
          (slot.parent !== null && !id(slot.parent)) || typeof slot.fallback !== 'boolean' ||
          typeof slot.loc !== 'string' || !/^[1-9]\d*:[1-9]\d*$/.test(slot.loc)) throw new Error('Invalid slot');
        seen.add(slot.id); stack.push(slot); placements.push(slot);
      } catch { return { ok: false, reason: 'invalid-slot-marker' }; }
    } else if (event.text.startsWith('/atx-slot:')) {
      if (stack.pop()?.id !== event.text.slice('/atx-slot:'.length)) return { ok: false, reason: 'unbalanced-slot-markers' };
    }
  }
  return stack.length ? { ok: false, reason: 'unbalanced-slot-markers' } : { ok: true, occurrences, placements };
}

/**
 * Which render of each usage site in an element's chain produced it — the live
 * half of a `.map()` proof, read off the annotations and nothing else.
 *
 * The element's own instance is the last id in its chain, its parent instance
 * is the one before, and so on, so walking `parent` pointers assigns a render
 * count to each chain position. A hop whose instance emitted no annotated
 * element of its own simply stops the walk: that usage site keeps its
 * `unproven-entry` refusal rather than borrowing a count from elsewhere.
 *
 * **Empty on any disagreement.** One usage id reached twice with two different
 * counts is recursion through a single source site, where "the Nth render"
 * no longer names one thing — and a wrong entry is the failure the whole
 * mechanism exists to prevent, so the answer is nothing rather than most of it.
 */
export function chainOrdinals(events: readonly TraceEvent[], key: number): RenderOrdinals {
  const instances = new Map<string, { parent: string; chain: string; ordinal: number }>();
  let self: string | null = null;
  for (const event of events) {
    if (event.type !== 'element' || event.opaque) continue;
    const ordinal = ordinalOf(event.ordinal);
    if (ordinal === null || !id(event.instance) || !chain(event.chain)) continue;
    if (!instances.has(event.instance)) {
      instances.set(event.instance, { parent: event.parent, chain: event.chain, ordinal });
    }
    if (event.key === key) self = event.instance;
  }
  const ordinals: RenderOrdinals = {};
  const seen = new Set<string>();
  for (let instance = self; instance && !seen.has(instance);) {
    seen.add(instance);
    const node = instances.get(instance);
    if (!node) break;
    // A root instance's chain is `!` or `?`: no usage site rendered it, so
    // there is nothing above this hop to count.
    const usage = node.chain.startsWith('.') ? node.chain.slice(1).split('.').at(-1) : undefined;
    if (!usage) break;
    if (ordinals[usage] !== undefined && ordinals[usage] !== node.ordinal) return {};
    ordinals[usage] = node.ordinal;
    instance = node.parent;
  }
  return ordinals;
}
