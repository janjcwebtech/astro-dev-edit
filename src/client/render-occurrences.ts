import type { SlotPlacement } from '../shared/protocol.ts';

export type TraceEvent =
  | { type: 'comment'; text: string }
  | { type: 'element'; key: number; instance: string; parent: string; file: string; chain: string; opaque?: boolean };
export interface RenderOccurrence {
  key: number;
  instance: string;
  /** Source-render identity + actual insertion path. */
  group: string | null;
  slots: SlotPlacement[];
  reason?: 'untracked-html';
}
const id = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{24}$/.test(value);
const chain = (value: unknown) => typeof value === 'string' && /^(?:!|\?|(?:\.[\w-]{8})+)$/.test(value);

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
        occurrences.push({ key: event.key, instance: event.instance, group: null, slots: [], reason: 'untracked-html' });
        continue;
      }
      if (!id(event.instance) || (event.parent !== '' && !id(event.parent)) || !chain(event.chain) || !event.file) {
        return { ok: false, reason: 'invalid-instance' };
      }
      occurrences.push({ key: event.key, instance: event.instance,
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
