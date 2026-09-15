import type { UsageLink } from '../shared/protocol.ts';

/** Pure lexical relationship; callers must validate both chains first.
 * Equal chains identify a shared usage site, not a unique rendered instance. */
export function compositionRelation(child: string, ancestor: string, links: readonly UsageLink[] = []): 'slot' | 'same-site' | 'component' | 'unrelated' {
  const parse = (chain: string): string[] | null => chain === '!' ? []
    : /^(?:\.[\w-]{8})+$/.test(chain) ? chain.slice(1).split('.') : null;
  const a = parse(child), b = parse(ancestor);
  if (!a || !b) return 'unrelated';
  const prefix = (x: string[], y: string[]) => x.every((id, i) => id === y[i]);
  if (a.length === b.length && prefix(a, b)) return 'same-site';
  if (a.length < b.length && prefix(a, b)) return 'slot';
  if (a.length > b.length && prefix(b, a)) return 'component';
  // A component supplied through a slot has a DIVERGENT chain: Page→Label
  // inside Page→Card. Only the caller's actual slot range proves this edge.
  const divergence = a.findIndex((id, i) => id !== b[i]);
  const supplied = links.find(link => link.id === a[divergence]);
  const receiver = links.find(link => link.id === b[divergence]);
  if (supplied && receiver && supplied.file === receiver.file &&
    receiver.slots.some(slot => supplied.offset >= slot.start && supplied.offset < slot.end)) return 'slot';
  return 'unrelated';
}
