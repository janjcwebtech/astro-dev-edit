import type { SourceLoc } from '../shared/protocol.ts';

/**
 * The element-tree's pure nesting model, kept in its own DOM-free module (like
 * server/inspect-locate.ts) so it unit-tests without a browser environment.
 * tree.ts owns everything that touches the live DOM.
 */

export interface TreeNode {
  el: HTMLElement;
  source: SourceLoc;
  children: TreeNode[];
}

/**
 * Nest a flat, document-ordered list of annotated elements by DOM ancestry.
 * Each element's parent is its nearest ancestor that is ALSO in the set; an
 * element with no such ancestor is a root. `sourceOf`/`parentOf` are injected
 * so this has no live-DOM dependency and is testable in isolation.
 *
 * Keyed on element objects, never on the source loc — a loc is not unique
 * (elements in a `.map()` loop share one), so loop siblings are distinct nodes.
 */
export function buildTreeModel(
  elements: HTMLElement[],
  sourceOf: (el: HTMLElement) => SourceLoc | undefined,
  parentOf: (el: HTMLElement) => HTMLElement | null,
): TreeNode[] {
  const nodeFor = new Map<HTMLElement, TreeNode>();
  for (const el of elements) {
    const source = sourceOf(el);
    if (source) nodeFor.set(el, { el, source, children: [] });
  }
  const roots: TreeNode[] = [];
  for (const el of elements) {
    const node = nodeFor.get(el);
    if (!node) continue;
    let anc = parentOf(el);
    while (anc && !nodeFor.has(anc)) anc = parentOf(anc);
    const parent = anc ? nodeFor.get(anc) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}
