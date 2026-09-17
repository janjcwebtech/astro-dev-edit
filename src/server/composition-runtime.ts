import { randomBytes } from 'node:crypto';
import { markHTMLString } from 'astro/runtime/server/index.js';
import type { RenderTrace, SlotPlacement } from '../shared/protocol.ts';

// Removed before the user's frontmatter runs: ordinary prop spreads, images
// and framework components never receive this transport from Astro.props.
const transport = Symbol('astro-dev-edit:trace');
interface Incoming { parent: string; chain: string; target: string; ordinal: number }
const incoming = new WeakSet<object>();
const requests = new WeakSet<object>();
/** How many times each usage site has rendered under one parent instance.
 *  Keyed by the parent's own trace, so two parents rendering the same
 *  component each count from 1 and a `.map()` counts its entries in order.
 *  Weak, so a finished render's counters go with it. */
const renders = new WeakMap<RenderTrace, Map<string, number>>();
const id = () => randomBytes(12).toString('hex');

export function begin(props: Record<PropertyKey, unknown>, file: string, request: object): Readonly<RenderTrace> {
  const entry = !requests.has(request);
  requests.add(request);
  const value = props[transport];
  if (value && typeof value === 'object' && incoming.has(value)) {
    delete props[transport];
    const link = value as Incoming;
    if (link.target === file) {
      return Object.freeze({ id: id(), file, parent: link.parent, chain: link.chain, ordinal: link.ordinal });
    }
  }
  // A later invocation without a transport is a break, even if it renders the
  // route's own file (e.g. a dynamically bound Astro.self). Never call it root.
  // The entry render happens once, so 1 is truthful there; a break is unknown.
  return Object.freeze({ id: id(), file, parent: null, chain: entry ? '!' : '?', ordinal: entry ? 1 : 0 });
}

export function child(trace: RenderTrace, usage: string, target: string): Record<PropertyKey, unknown> {
  // Counted here, where the render actually happens, rather than inferred from
  // DOM order later: sibling position is not render order once a slot,
  // a conditional or a second parent is involved.
  let counts = renders.get(trace);
  if (!counts) renders.set(trace, counts = new Map());
  const ordinal = (counts.get(usage) ?? 0) + 1;
  counts.set(usage, ordinal);
  const value: Incoming = Object.freeze({ parent: trace.id,
    chain: trace.chain === '?' ? '?' : (trace.chain === '!' ? '' : trace.chain) + '.' + usage, target, ordinal });
  incoming.add(value);
  return { [transport]: value };
}

interface Destination { write(chunk: unknown): void }
interface Renderable { render(destination: Destination): unknown }

/** Called around a native <slot>, without replacing Astro's slot machinery.
 * Boundaries are emitted at insertion time, including reused/forwarded output.
 * Runtime comments survive compiler comment removal and add no layout boxes. */
export function slot(trace: RenderTrace, name: string, loc: string, fallback: boolean, content: Renderable): Renderable {
  return {
    async render(destination) {
      const placement: SlotPlacement = { id: id(), receiver: trace.id, name, loc, fallback,
        file: trace.file, chain: trace.chain, parent: trace.parent };
      destination.write(markHTMLString(`<!--atx-slot:${encodeURIComponent(JSON.stringify(placement))}-->`));
      await content.render(destination);
      destination.write(markHTMLString(`<!--/atx-slot:${placement.id}-->`));
    },
  };
}
