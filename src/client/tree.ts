import type { SourceLoc } from '../shared/protocol.ts';
import { icon } from './icons.ts';
import { isOwnUi } from './shadow.ts';
import { annotatedElements, pathFor, sourceFor } from './source-map.ts';
import { type TreeNode, buildTreeModel } from './tree-model.ts';
import { tip } from './tip.ts';
import { onReflow } from './reflow.ts';
import { basename, chromeInset, isolateScroll, onChromeInset, outlineRect, styled } from './ui.ts';

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

/**
 * The leading mark on a row, and the words that go with it.
 *
 * The tree itself proves nothing about composition — it nests annotated
 * elements by DOM ancestry and no more — so the *kind* is decided by whoever
 * owns that evidence (inspector-app, from the render-occurrence trace) and
 * arrives here already judged. The two kinds are the two the legend names.
 */
export interface TreeMark {
  kind: 'component' | 'slot';
  /** Shown after the tag — only what the loc column does not already say.
   *  Null for a plain component root, whose file the loc names in full. */
  note: string | null;
  /** The mark's tooltip, which always spells the whole claim out. */
  title: string;
}

export interface TreeDeps {
  /** Inspector mode keeps selection after releasing the interception key. */
  readOnly?: boolean;
  /** Icon buttons for the title bar, placed before the close button — the
   *  inspector's menu and settings. Without an admin bar there is nowhere else
   *  for a tool-wide action to live, and the title bar is the panel's own row
   *  of controls rather than a second place to put content. */
  titleActions?: readonly HTMLElement[];
  onSelect?(el: HTMLElement): void;
  describe?(el: HTMLElement): TreeMark | null;
  header?: HTMLElement;
  /** A strip pinned under the scroll body — the legend for whatever
   *  {@link describe} marks rows with. Omitted when nothing marks them. */
  footer?: HTMLElement;
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
  selectElement(el: HTMLElement): void;
}


export function initTree(deps: TreeDeps): TreeHandle {
  // Panel shell: fixed to the left edge, full height. Below modal panels and
  // drawers (Z_MODAL+5/6) so an open drawer overlays it, above the hover
  // pill so rows read clearly. Non-modal — no backdrop, never touches state.ts.
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
  bar.append(barText, ...(deps.titleActions ?? []), closeBtn);

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
  // Scrolling moves every row out from under the pointer, so whatever the
  // tooltip was naming is no longer where it is pointing.
  body.addEventListener('scroll', () => tip.hide(), { passive: true });

  root.append(bar);
  if (deps.header) root.append(deps.header);
  root.append(body);
  if (deps.footer) root.append(deps.footer);

  // Keep clear of the admin bar, whichever edge it is docked to. Fires once on
  // subscribe, so the panel is correct however the two modules boot.
  //
  // The *bar's* share, not the whole inset: this panel is full height by
  // definition, so the code dock's strip along the bottom is not its to avoid —
  // the dock spans the page column between the panels, never under one. The
  // float away from the edge is `margin` in styles.ts, which is what lets the
  // docked variant go flush by dropping it.
  onChromeInset(() => {
    const { top, bottom } = chromeInset('bar');
    root.style.top = `${top}px`;
    root.style.bottom = `${bottom}px`;
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
    Object.assign(selectionOutline.style, outlineRect(r) as Partial<CSSStyleDeclaration>);
  }

  // Scroll and resize are no longer the only ways the selected element moves:
  // docked, opening a panel pushes the page and neither event fires. One bus,
  // one idempotent redraw — a second path is how two outlines around one
  // element start disagreeing by a pixel.
  onReflow(positionSelection);

  function select(el: HTMLElement): void {
    const prev = selectedEl;
    selectedEl = el;
    selectedPath = pathFor(el);
    if (prev) paintRow(prev);
    paintRow(el);
    positionSelection();
    // Scroll the element into view. This scrolls the page (firing hover's own
    // scroll→clearHighlight), and the reflow bus keeps the locked outline glued
    // to the element as it moves.
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
  }

  function clearSelection(): void {
    const prev = selectedEl;
    selectedEl = null;
    selectedPath = null;
    selectionOutline.toggleAttribute('data-on', false);
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
      if (deps.readOnly || !deps.isEditMode() || !selectedEl) return;
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

    row.append(chevron);
    // The mark sits between the chevron and the tag, so the glyph column reads
    // straight down the tree the way the indent does.
    const described = deps.describe?.(el);
    if (described) {
      const mark = styled('span', 'atx-tree-mark');
      mark.dataset.kind = described.kind;
      mark.append(icon(described.kind === 'component' ? 'component' : 'slotIn', 13));
      row.append(mark);
    }
    row.append(tag);
    if (described?.note) {
      const note = styled('span', 'atx-tree-preview');
      note.textContent = described.note;
      row.append(note);
    }

    // A short text preview for leaf text elements aids scanning.
    if (!hasChildren) {
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text) {
        const preview = styled('span', 'atx-tree-preview');
        preview.textContent = text.length > 24 ? `${text.slice(0, 24)}…` : text;
        row.append(preview);
      }
    }

    // The code button doubles as an editor jump: it opens the file at this line
    // (the same /open the hover pill's "open ↗" uses), so it stops the click
    // from also selecting the row.
    // A tree crosses component files every few rows, so a bare `9:28` cannot
    // say which file it counts in — and the file:line that could is wider than
    // the tag and the indent together. So the row carries one fixed-width code
    // button and says where it is in its title, which nothing truncates.
    const where = `${basename(source.file)}:${source.loc || '?'}`;
    const loc = styled('button', 'atx-tree-loc');
    loc.type = 'button';
    loc.append(icon('code', 14));
    loc.setAttribute('aria-label', `View code for ${where}`);
    loc.addEventListener('click', (e) => {
      e.stopPropagation();
      tip.hide();
      deps.openSource(source);
    });
    // The button says what clicking it does; the row says where the element
    // is. Both go through the panel's own tooltip, so hovering from one to
    // the other swaps the words without the tooltip flickering out.
    loc.addEventListener('mouseenter', () => tip.show(loc, 'View code', where));
    // Back onto the row proper: the row's own mouseenter never fired, because
    // the pointer never left it.
    loc.addEventListener('mouseleave', () => tip.show(row, where, described?.title ?? null));
    row.append(loc);

    row.addEventListener('mouseenter', () => {
      if (deps.isEditMode()) deps.highlight(el);
      tip.show(row, where, described?.title ?? null);
    });
    // Moving onto the code button leaves the row in the eyes of `mouseenter`
    // but not of `mouseleave`, which does not fire for a descendant — so the
    // button's own enter is what re-points the tooltip, and this only runs
    // when the pointer has genuinely left the row.
    row.addEventListener('mouseleave', () => {
      deps.clearHighlight();
      tip.hide();
    });
    row.tabIndex = 0;
    const activate = () => { tip.hide(); select(el); deps.onSelect?.(el); };
    row.addEventListener('click', activate);
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
    });
    if (!deps.readOnly) row.addEventListener('dblclick', () => deps.openEditor(el));

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
    tip.hide();
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
    tip.hide();
    root.toggleAttribute('data-on', false);
    // The tab only makes sense while editing — outside edit mode the tree has
    // nothing live to point at, and the bar's Elements button reopens both.
    tab.toggleAttribute('data-on', deps.isEditMode());
    syncActive(null);
    if (!deps.readOnly) clearSelection();
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
    selectElement: select,
  };
}
