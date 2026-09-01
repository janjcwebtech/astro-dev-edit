import type { SourceLoc } from '../shared/protocol.ts';
import { icon } from './icons.ts';
import { isOwnUi } from './shadow.ts';
import { annotatedElements, pathFor, sourceFor } from './source-map.ts';
import { type TreeNode, buildTreeModel } from './tree-model.ts';
import { basename, isolateScroll, onChromeInset, styled } from './ui.ts';

/**
 * Element-tree panel: a left-docked, non-modal outline of the page's
 * source-annotated elements, two-way highlight-linked to the page.
 *
 *  - tree → page: hovering a row drives the existing hover outline + verdict
 *    pill (deps.highlight), so a row shows exactly what a page hover would;
 *    clicking a row LOCKS a persistent selection (this panel's own outline) and
 *    scrolls the element into view; double-click opens the editor.
 *  - page → tree: the composition root feeds hover's onTarget into syncActive,
 *    which mirrors the current page-hover onto a distinct, transient
 *    "hover-active" row style — never disturbing the locked selection.
 *
 * Deliberately modeled on hover.ts, NOT the drawer: it never claims the single
 * state.ts interaction slot and uses no backdrop, so it coexists with editing.
 * Every node is built through ui.ts::styled (router-exempt + atx-* theming), and
 * the scroll body goes through isolateScroll like every other overlay surface.
 *
 * The tree is derived from the live DOM (annotatedElements), keyed on element
 * objects — a source loc is NOT unique (elements in a `.map()` loop share one).
 * Collapse and selection persist across HMR by pathFor(), since the element
 * objects themselves are replaced on every save-triggered re-render.
 *
 * The pure nesting model lives in tree-model.ts (DOM-free, unit-tested).
 */

// --- View --------------------------------------------------------------------

export interface TreeDeps {
  isEditMode(): boolean;
  /** Drive the hover outline + verdict pill for a row (tree → page). */
  highlight(el: HTMLElement): void;
  /** Clear the hover outline + pill. */
  clearHighlight(): void;
  /** Open the editor for an element (row double-click). */
  openEditor(el: HTMLElement): void;
  /** Jump the user's editor straight to a source location (row loc click). */
  openSource(src: SourceLoc): void;
  /** The panel showed or hid itself (its ✕, or the restore tab), so the admin
   *  bar's Elements button can follow. Not called for show()/hide() driven from
   *  outside — the caller already knows. */
  onToggle?(open: boolean): void;
}

export interface TreeHandle {
  /** The panel root — appended to <body> at boot. */
  root: HTMLElement;
  /** The edge tab that brings a closed panel back — appended to <body> at boot. */
  tab: HTMLElement;
  /** The locked-selection outline — appended to <body> at boot. */
  selectionOutline: HTMLElement;
  /** Re-enumerate the DOM and rebuild rows (boot, edit-on, after HMR). */
  rebuild(): void;
  show(): void;
  hide(): void;
  isOpen(): boolean;
  /** Mirror the current page-hover element onto its row (page → tree). */
  syncActive(el: HTMLElement | null): void;
  clearSelection(): void;
  hasSelection(): boolean;
}


export function initTree(deps: TreeDeps): TreeHandle {
  // Panel shell: fixed to the left edge, full height. Below modal panels/drawer
  // (Z+5/6) so an open CMS drawer overlays it, above the hover pill so rows read
  // clearly. Non-modal — no backdrop, never touches state.ts.
  const root = styled('div', 'atx-tree', undefined, 'atx-tree');

  const bar = styled('div', 'atx-tree-title');
  const barText = styled('span', 'atx-tree-title-text');
  barText.textContent = 'Elements';
  const closeBtn = styled('button', 'atx-tree-close');
  closeBtn.type = 'button';
  closeBtn.append(icon('x', 16));
  closeBtn.title = 'Hide the element tree';
  closeBtn.addEventListener('click', () => {
    hide();
    deps.onToggle?.(false);
  });
  bar.append(barText, closeBtn);

  // What the panel leaves behind while edit mode is still on: a tab on the left
  // edge that brings it back, so closing the tree is never a one-way door (the
  // bar's Elements button does the same job from the other end).
  const tab = styled('button', 'atx-tree-tab', undefined, 'atx-tree-tab');
  tab.type = 'button';
  tab.title = 'Show the element tree';
  tab.append(icon('sidebar', 16));
  tab.addEventListener('click', () => {
    show();
    deps.onToggle?.(true);
  });

  const body = styled('div', 'atx-tree-body');
  isolateScroll(body);

  root.append(bar, body);

  // Keep clear of the admin bar, whichever edge it is docked to. Fires once on
  // subscribe, so the panel is correct however the two modules boot.
  onChromeInset(({ top, bottom }) => {
    root.style.top = `${top + 5}px`;
    root.style.bottom = `${bottom + 5}px`;
  });

  // The locked-selection outline — this panel's own, distinct from hover's
  // transient one: solid + glow, no fill, no transition (tracks scroll crisply).
  const selectionOutline = styled('div', 'atx-tree-selection');

  // --- State ---------------------------------------------------------------

  let model: TreeNode[] = [];
  const rowFor = new Map<HTMLElement, HTMLElement>();
  const collapsed = new Set<string>(); // element paths that are collapsed
  let selectedEl: HTMLElement | null = null;
  let activeEl: HTMLElement | null = null;
  let selectedPath: string | null = null; // to re-resolve selection across HMR

  // --- Row styling ---------------------------------------------------------

  function paintRow(el: HTMLElement | null): void {
    if (!el) return;
    const row = rowFor.get(el);
    if (!row) return;
    const selected = el === selectedEl;
    const active = el === activeEl;
    // Selected wins over active, which is what makes the dashed active ring
    // disappear when the same row is both — see .atx-tree-row in styles.ts.
    if (selected) row.dataset.state = 'selected';
    else if (active) row.dataset.state = 'active';
    else delete row.dataset.state;
  }

  // --- Selection (locked) --------------------------------------------------

  function positionSelection(): void {
    if (!selectedEl) return;
    if (!selectedEl.isConnected) {
      clearSelection();
      return;
    }
    const r = selectedEl.getBoundingClientRect();
    selectionOutline.toggleAttribute('data-on', true);
    Object.assign(selectionOutline.style, {
      left: `${r.left - 2}px`,
      top: `${r.top - 2}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    } as Partial<CSSStyleDeclaration>);
  }

  let repositionScheduled = false;
  function onReposition(): void {
    if (repositionScheduled) return;
    repositionScheduled = true;
    requestAnimationFrame(() => {
      repositionScheduled = false;
      positionSelection();
    });
  }

  function select(el: HTMLElement): void {
    const prev = selectedEl;
    selectedEl = el;
    selectedPath = pathFor(el);
    if (prev) paintRow(prev);
    paintRow(el);
    positionSelection();
    // Scroll the element into view. This scrolls the page (firing hover's own
    // scroll→clearHighlight), and our reposition listener keeps the locked
    // outline glued to the element as it moves.
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    window.addEventListener('scroll', onReposition, { passive: true });
    window.addEventListener('resize', onReposition, { passive: true });
  }

  function clearSelection(): void {
    const prev = selectedEl;
    selectedEl = null;
    selectedPath = null;
    selectionOutline.toggleAttribute('data-on', false);
    window.removeEventListener('scroll', onReposition);
    window.removeEventListener('resize', onReposition);
    if (prev) paintRow(prev);
  }

  function hasSelection(): boolean {
    return selectedEl !== null;
  }

  // A click anywhere on the page (not on our own UI) clears the locked
  // selection — "click elsewhere to deselect". Registered in capture phase and
  // BEFORE the router's own click listener (initTree runs before initRouter) so
  // the router's stopImmediatePropagation on editable targets can't pre-empt it.
  document.addEventListener(
    'click',
    (e) => {
      if (!deps.isEditMode() || !selectedEl) return;
      if (isOwnUi(e)) return; // clicks on the tree / pills / panels don't deselect
      clearSelection();
    },
    true,
  );

  // --- page → tree ---------------------------------------------------------

  function syncActive(el: HTMLElement | null): void {
    if (el === activeEl) return;
    const prev = activeEl;
    activeEl = el && rowFor.has(el) ? el : null;
    if (prev) paintRow(prev);
    if (activeEl) {
      paintRow(activeEl);
      scrollRowIntoView(rowFor.get(activeEl)!);
    }
  }

  /** Scroll the tree body just enough to reveal a row (never the page). */
  function scrollRowIntoView(row: HTMLElement): void {
    const rowRect = row.getBoundingClientRect();
    const boxRect = body.getBoundingClientRect();
    if (rowRect.top < boxRect.top) {
      body.scrollTop -= boxRect.top - rowRect.top + 8;
    } else if (rowRect.bottom > boxRect.bottom) {
      body.scrollTop += rowRect.bottom - boxRect.bottom + 8;
    }
  }

  // --- Rendering -----------------------------------------------------------

  function makeRow(node: TreeNode, depth: number): HTMLElement {
    const { el, source } = node;
    const row = styled('div', 'atx-tree-row', {
      // The indent is the row's depth, so this one is genuinely per-instance.
      paddingLeft: `${10 + depth * 14}px`,
    });

    const hasChildren = node.children.length > 0;
    const path = pathFor(el);
    const chevron = styled('span', 'atx-tree-chevron');
    // A leaf is not clickable, so it does not offer a pointer.
    chevron.toggleAttribute('data-leaf', !hasChildren);
    // A leaf's slot stays empty rather than carrying a mark of its own: the
    // chevron's fixed width is what keeps the tags column-aligned, and a dot
    // there read as a list bullet in front of every row that had no children.
    if (hasChildren) {
      chevron.append(icon(collapsed.has(path) ? 'chevronRight' : 'chevronDown', 12));
    }
    if (hasChildren) {
      chevron.addEventListener('click', (e) => {
        e.stopPropagation();
        if (collapsed.has(path)) collapsed.delete(path);
        else collapsed.add(path);
        renderRows();
      });
    }

    const tag = styled('span', 'atx-tree-tag');
    tag.textContent = `<${el.tagName.toLowerCase()}>`;

    row.append(chevron, tag);

    // A short text preview for leaf text elements aids scanning.
    if (!hasChildren) {
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text) {
        const preview = styled('span', 'atx-tree-preview');
        preview.textContent = text.length > 24 ? `${text.slice(0, 24)}…` : text;
        row.append(preview);
      }
    }

    // The loc doubles as an editor jump: clicking it opens the file at this line
    // in the user's editor (the same /open the hover pill's "open ↗" uses), so it
    // stops the click from also selecting the row.
    const loc = styled('span', 'atx-tree-loc');
    loc.textContent = source.loc || '?';
    loc.title = `Open ${basename(source.file)}:${source.loc} in your editor`;
    loc.addEventListener('click', (e) => {
      e.stopPropagation();
      deps.openSource(source);
    });
    row.append(loc);

    row.addEventListener('mouseenter', () => {
      if (deps.isEditMode()) deps.highlight(el);
    });
    row.addEventListener('mouseleave', () => deps.clearHighlight());
    row.addEventListener('click', () => select(el));
    row.addEventListener('dblclick', () => deps.openEditor(el));

    rowFor.set(el, row);
    paintRow(el);
    return row;
  }

  function renderNodes(nodes: TreeNode[], depth: number, into: HTMLElement): void {
    for (const node of nodes) {
      into.append(makeRow(node, depth));
      if (node.children.length && !collapsed.has(pathFor(node.el))) {
        renderNodes(node.children, depth + 1, into);
      }
    }
  }

  function renderRows(): void {
    rowFor.clear();
    body.replaceChildren();
    if (model.length === 0) {
      const empty = styled('div', 'atx-tree-empty');
      empty.textContent = 'No source-annotated elements on this page.';
      body.append(empty);
      return;
    }
    renderNodes(model, 0, body);
  }

  function rebuild(): void {
    model = buildTreeModel(annotatedElements(), sourceFor, (el) => el.parentElement);
    renderRows();
    // Re-resolve the locked selection onto the fresh DOM by its stable path.
    if (selectedPath) {
      const match = [...rowFor.keys()].find((el) => pathFor(el) === selectedPath);
      if (match) {
        selectedEl = match;
        paintRow(match);
        positionSelection();
      } else {
        clearSelection();
      }
    }
  }

  function show(): void {
    root.toggleAttribute('data-on', true);
    tab.toggleAttribute('data-on', false);
  }

  function hide(): void {
    root.toggleAttribute('data-on', false);
    // The tab only makes sense while editing — outside edit mode the tree has
    // nothing live to point at, and the bar's Elements button reopens both.
    tab.toggleAttribute('data-on', deps.isEditMode());
    syncActive(null);
    clearSelection();
  }

  function isOpen(): boolean {
    return root.hasAttribute('data-on');
  }

  return {
    root,
    tab,
    selectionOutline,
    rebuild,
    show,
    hide,
    isOpen,
    syncActive,
    clearSelection,
    hasSelection,
  };
}
