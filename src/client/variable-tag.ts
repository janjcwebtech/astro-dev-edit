import type { SourceLoc, VariableTagRequest, VariableTagResponse } from '../shared/protocol.ts';
import { annotatedChildren } from './composition-dom.ts';

/**
 * The client's side of `/inspect/tag` (issue #82): an unannotated element
 * with no slot boundary, resolved once and shared by the hover pill and the
 * panel, so a dwell and the click that follows it ask once between them.
 *
 * Only the server proves anything. This module sends the annotated elements
 * directly inside the element and keeps the answer. It never picks an
 * ancestor, a child or a file on its own.
 */

/** A proven variable tag: `<Wrapper>`, a const bound only to string literals. */
export interface VariableTag {
  /** Where the element is written: the `<` of `<Wrapper`. */
  source: SourceLoc;
  /** The binding as the template spells it. */
  name: string;
  /** Every literal it can take. */
  tags: readonly string[];
  /**
   * The child that proved it. One template wrote both in one render, so its
   * chain, instance and ordinal annotations are the element's own.
   */
  carrier: Element;
}

export interface VariableTags {
  /** Null when nothing proves it: a refusal, or a request that failed. */
  resolve(el: HTMLElement): Promise<VariableTag | null>;
  /** The settled answer, without asking. `undefined` means not asked yet, or
   *  still in flight. */
  known(el: HTMLElement): VariableTag | null | undefined;
  /** Drop every answer, because the source or the page changed under it. */
  invalidate(): void;
}

export function createVariableTags(api: {
  resolveVariableTag(request: VariableTagRequest): Promise<VariableTagResponse>;
}): VariableTags {
  // Keyed by element: an HMR swap or a navigation replaces the node, and the
  // stale answer goes with it.
  let pending = new WeakMap<Element, Promise<VariableTag | null>>();
  let settled = new WeakMap<Element, VariableTag | null>();
  return {
    resolve(el) {
      const hit = pending.get(el);
      if (hit) return hit;
      const children = annotatedChildren(el);
      if (!children.length) return Promise.resolve(null);
      const asked = pending;
      const answer = api.resolveVariableTag({
        tag: el.tagName.toLowerCase(),
        children: children.map(child => ({ file: child.getAttribute('data-atx-file')!,
          loc: child.getAttribute('data-atx-loc')!, tag: child.tagName.toLowerCase() })),
      }).then(response => {
        const carrier = response.ok ? children[response.child] : undefined;
        const tag = response.ok && carrier
          ? { source: response.source, name: response.name, tags: response.tags, carrier } : null;
        if (asked === pending) settled.set(el, tag);
        return tag;
      }, () => {
        // A request that failed is not a refusal: the next dwell asks again.
        if (asked === pending) pending.delete(el);
        return null;
      });
      pending.set(el, answer);
      return answer;
    },
    known: el => settled.get(el),
    invalidate() {
      pending = new WeakMap();
      settled = new WeakMap();
    },
  };
}
