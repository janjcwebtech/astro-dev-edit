import { renderOccurrences, type TraceEvent } from './render-occurrences.ts';

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
