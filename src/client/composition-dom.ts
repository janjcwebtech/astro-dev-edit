import type { SlotPlacement, SourceLoc } from '../shared/protocol.ts';
import { parseSlotMarker, renderOccurrences, type TraceEvent } from './render-occurrences.ts';

/** Read-only adapter. Comments inside set:html are serialized content, not
 * trusted live insertion boundaries; replayed annotations there stay opaque. */
export function readRenderOccurrences(root: Document | Element) {
  const document = root.nodeType === 9 ? root as Document : root.ownerDocument!;
  const walker = document.createTreeWalker(root, 1 | 128); // SHOW_ELEMENT | SHOW_COMMENT
  const elements: Element[] = [];
  const events: TraceEvent[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const opaque = !!node.parentElement?.closest('[data-atx-boundary="html"]');
    if (node.nodeType === 8) {
      if (!opaque) events.push({ type: 'comment', text: node.nodeValue ?? '' });
    } else {
      const element = node as Element;
      if (element.getAttribute('data-atx-version') !== '2') continue;
      const get = (name: string) => element.getAttribute(`data-atx-${name}`) ?? '';
      events.push({ type: 'element', key: elements.length, instance: get('instance'), parent: get('parent'),
        file: get('file'), chain: get('chain'), ordinal: get('ordinal'), opaque });
      elements.push(element);
    }
  }
  // `events` travels with the result: the ordinal walk needs the parent
  // pointers, which an occurrence list has deliberately flattened away.
  return { elements, events, result: renderOccurrences(events) };
}

/**
 * The slot boundary an **unannotated** element wraps directly, if any — the
 * evidence behind a polymorphic `<Tag>` (issue #71).
 *
 * `<Tag {...attributes}><slot /></Tag>` renders an element nobody annotates:
 * a capitalised tag parses as a component, so the transform skips it, and
 * Astro's compiler never stamped it either. The element is still identifiable,
 * because the `<slot />` inside it emitted its boundary markers *as its own
 * children*: the placement names the file and loc the `<slot />` is written
 * at, and only that component's template can have written the element around
 * it — an element it spelled statically would have been annotated.
 *
 * `content` is the first annotated element inside the boundary, which is where
 * the words on screen were actually written. Null when nothing inside carries
 * an annotation, which is said rather than guessed around.
 *
 * Direct children only. A marker further down belongs to some element between,
 * and attributing it to this one would name the wrong component.
 */
export function wrappedSlot(el: Element): { placement: SlotPlacement; content: SourceLoc | null } | null {
  for (const node of el.childNodes) {
    if (node.nodeType !== 8) continue;
    const placement = parseSlotMarker(node.nodeValue ?? '');
    if (!placement) continue;
    const inner = el.querySelector('[data-atx-file][data-atx-loc]');
    return {
      placement,
      content: inner
        ? { file: inner.getAttribute('data-atx-file')!, loc: inner.getAttribute('data-atx-loc')! }
        : null,
    };
  }
  return null;
}

/**
 * The annotated elements directly inside an unannotated one, in document
 * order — what `/inspect/tag` proves a variable tag from (issue #82).
 *
 * None of them is an owner on its own. Without a slot boundary nothing says
 * who wrote the outer element: in `<Wrapper><Inner /></Wrapper>` the child is
 * stamped by `Inner.astro`. The server decides which, if any, proves it.
 */
export function annotatedChildren(el: Element, max = 16): Element[] {
  const out: Element[] = [];
  for (const child of el.children) {
    if (out.length === max) break;
    if (child.hasAttribute('data-atx-file') && child.hasAttribute('data-atx-loc')) out.push(child);
  }
  return out;
}

/** The first of {@link annotatedChildren}, as the loc the refusal names. */
export function annotatedChild(el: Element): SourceLoc | null {
  const [child] = annotatedChildren(el, 1);
  return child ? { file: child.getAttribute('data-atx-file')!, loc: child.getAttribute('data-atx-loc')! } : null;
}
