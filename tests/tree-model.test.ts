import { describe, expect, it } from 'vitest';
import type { SourceLoc } from '../src/shared/protocol.ts';
import { buildTreeModel, type TreeNode } from '../src/client/tree-model.ts';

/**
 * Characterizes the element-tree's pure nesting: a flat, document-ordered list
 * of annotated elements is re-nested by DOM ancestry. Parent = nearest ancestor
 * ALSO in the set, so unannotated component gaps are skipped; loop siblings that
 * share one source loc stay distinct; sourceless elements are dropped.
 *
 * Elements are plain tagged objects — buildTreeModel only uses object identity
 * plus the injected sourceOf/parentOf, never the live DOM.
 */

type FakeEl = { name: string };
const el = (name: string): HTMLElement => ({ name }) as unknown as HTMLElement;

// A small page:  main > (h1, ul > (li, li), img) ; <Component> wraps a p ; footer
const main = el('main');
const h1 = el('h1');
const ul = el('ul');
const li1 = el('li1');
const li2 = el('li2');
const img = el('img');
const gap = el('gap'); // an unannotated wrapper (a component's root element)
const p = el('p');
const footer = el('footer');

const PARENT = new Map<HTMLElement, HTMLElement | null>([
  [main, null],
  [h1, main],
  [ul, main],
  [li1, ul],
  [li2, ul],
  [img, main],
  [gap, main],
  [p, gap],
  [footer, null],
]);

const LOC = new Map<HTMLElement, SourceLoc>([
  [main, { file: 'index.astro', loc: '2:1' }],
  [h1, { file: 'index.astro', loc: '3:3' }],
  [ul, { file: 'index.astro', loc: '4:3' }],
  [li1, { file: 'index.astro', loc: '7:5' }], // loop siblings share ONE loc
  [li2, { file: 'index.astro', loc: '7:5' }],
  [img, { file: 'index.astro', loc: '9:3' }],
  [p, { file: 'index.astro', loc: '12:3' }],
  [footer, { file: 'index.astro', loc: '15:1' }],
  // gap has no loc — it is not annotated
]);

const parentOf = (e: HTMLElement): HTMLElement | null => PARENT.get(e) ?? null;
const sourceOf = (e: HTMLElement): SourceLoc | undefined => LOC.get(e);

// Document order, gap included in the raw walk (it will be dropped for lack of a loc).
const ORDER = [main, h1, ul, li1, li2, img, gap, p, footer];

const names = (nodes: TreeNode[]): string[] =>
  nodes.map((n) => (n.el as unknown as FakeEl).name);

describe('buildTreeModel', () => {
  const roots = buildTreeModel(ORDER, sourceOf, parentOf);

  it('returns the top-level elements as roots, in document order', () => {
    expect(names(roots)).toEqual(['main', 'footer']);
  });

  it('nests direct children under their annotated parent', () => {
    const mainNode = roots[0];
    expect(names(mainNode.children)).toEqual(['h1', 'ul', 'img', 'p']);
  });

  it('keeps loop siblings that share one loc as distinct nodes', () => {
    const ulNode = roots[0].children.find((n) => (n.el as unknown as FakeEl).name === 'ul')!;
    expect(names(ulNode.children)).toEqual(['li1', 'li2']);
    expect(ulNode.children[0].source.loc).toBe('7:5');
    expect(ulNode.children[1].source.loc).toBe('7:5');
    expect(ulNode.children[0].el).not.toBe(ulNode.children[1].el);
  });

  it('reparents across an unannotated component gap (nearest annotated ancestor)', () => {
    // <p> sits inside `gap`, which has no loc; it must attach to `main`, not vanish.
    const mainNode = roots[0];
    expect(names(mainNode.children)).toContain('p');
  });

  it('drops elements that have no source loc', () => {
    // `gap` is walked but never appears anywhere in the tree.
    const all = new Set<string>();
    const visit = (ns: TreeNode[]): void => {
      for (const n of ns) {
        all.add((n.el as unknown as FakeEl).name);
        visit(n.children);
      }
    };
    visit(roots);
    expect(all.has('gap')).toBe(false);
    expect(all.size).toBe(8); // main, h1, ul, li1, li2, img, p, footer
  });

  it('returns an empty array for no elements', () => {
    expect(buildTreeModel([], sourceOf, parentOf)).toEqual([]);
  });
});
