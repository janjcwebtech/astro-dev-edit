import type { SourceLoc } from '../shared/protocol.ts';
import { icon } from './icons.ts';
import { isOwnUi } from './router.ts';
import { annotatedElements, pathFor, sourceFor } from './source-map.ts';
import { type TreeNode, buildTreeModel } from './tree-model.ts';
import { COLOR, FONT, Z, basename, isolateScroll, onChromeInset, styled } from './ui.ts';

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

const ROW_INK = '#c8c8e0';
const ACTIVE_BG = 'rgba(124, 92, 255, 0.16)';

export function initTree(deps: TreeDeps): TreeHandle {
  // Panel shell: fixed to the left edge, full height. Below modal panels/drawer
  // (Z+5/6) so an open CMS drawer overlays it, above the hover pill so rows read
  // clearly. Non-modal — no backdrop, never touches state.ts.
  const root = styled(
    'div',
    'atx-tree',
    {
      position: 'fixed',
      left: '5px',
      // Top/bottom rather than a height: the admin bar reserves a strip of one
      // edge (onChromeInset below), and the panel must never sit under it.
      top: '5px',
      bottom: '5px',
      borderRadius: '6px',
      width: 'min(320px, 90vw)',
      zIndex: String(Z + 3),
      display: 'none',
      flexDirection: 'column',
      background: 'rgba(0,0,0,0.90)',
      color: ROW_INK,
      borderRight: `1px solid ${COLOR.panelBorder}`,
      boxShadow: '8px 0 40px rgba(0,0,0,0.35)',
      font: `12px ${FONT.mono}`,
      boxSizing: 'border-box',
      // Edit mode sets a page-wide crosshair; the panel is not click-to-edit.
      cursor: 'auto',
    },
    'atx-tree',
  );

  const bar = styled('div', 'atx-tree-title', {
    flex: '0 0 auto',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 14px',
    font: `600 12px ${FONT.ui}`,
    color: '#fff',
    borderBottom: `1px solid ${COLOR.panelDivider}`,
  });
  const barText = styled('span', 'atx-tree-title-text', { flex: '1 1 auto' });
  barText.textContent = 'Elements';
  const closeBtn = styled('button', 'atx-tree-close', {
    flex: '0 0 auto',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    padding: '0',
    color: '#ddd',
    background: 'rgba(255,255,255,0.08)',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
  });
  closeBtn.type = 'button';
  closeBtn.append(icon('x', 13));
  closeBtn.title = 'Hide the element tree';
  closeBtn.addEventListener('click', () => {
    hide();
    deps.onToggle?.(false);
  });
  bar.append(barText, closeBtn);

  // What the panel leaves behind while edit mode is still on: a tab on the left
  // edge that brings it back, so closing the tree is never a one-way door (the
  // bar's Elements button does the same job from the other end).
  const tab = styled(
    'button',
    'atx-tree-tab',
    {
      position: 'fixed',
      left: '0',
      top: '50%',
      transform: 'translateY(-50%)',
      zIndex: String(Z + 3),
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      width: '24px',
      height: '64px',
      padding: '0',
      border: 'none',
      borderRight: '1px solid rgba(255,255,255,0.10)',
      borderRadius: '0 7px 7px 0',
      background: 'rgba(22, 21, 34, 0.88)',
      backdropFilter: 'blur(10px)',
      color: '#b9b0ff',
      boxShadow: '2px 0 14px rgba(0,0,0,0.3)',
      cursor: 'pointer',
    },
    'atx-tree-tab',
  );
  tab.type = 'button';
  tab.title = 'Show the element tree';
  tab.append(icon('sidebar', 15));
  tab.addEventListener('mouseenter', () => (tab.style.color = '#fff'));
  tab.addEventListener('mouseleave', () => (tab.style.color = '#b9b0ff'));
  tab.addEventListener('click', () => {
    show();
    deps.onToggle?.(true);
  });

  const body = styled('div', 'atx-tree-body', {
    flex: '1 1 auto',
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '6px 0',
  });
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
  const selectionOutline = styled('div', 'atx-tree-selection', {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: String(Z),
    border: `2px solid ${COLOR.accent}`,
    borderRadius: '3px',
    boxShadow: `0 0 0 2px ${COLOR.accent}44, 0 0 12px ${COLOR.accent}66`,
    display: 'none',
  });

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
    row.style.background = selected ? COLOR.accent : active ? ACTIVE_BG : 'transparent';
    row.style.color = selected ? '#fff' : active ? COLOR.accent : ROW_INK;
    // Hover-active reads as a dashed ring so it never looks like the solid
    // locked selection, even when both land on the same row.
    row.style.outline = active && !selected ? `1px dashed ${COLOR.accent}` : 'none';
    row.style.outlineOffset = '-1px';
  }

  // --- Selection (locked) --------------------------------------------------

  function positionSelection(): void {
    if (!selectedEl) return;
    if (!selectedEl.isConnected) {
      clearSelection();
      return;
    }
    const r = selectedEl.getBoundingClientRect();
    Object.assign(selectionOutline.style, {
      display: 'block',
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
    selectionOutline.style.display = 'none';
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
      display: 'flex',
      alignItems: 'center',
      gap: '5px',
      padding: '2px 10px 2px 0',
      paddingLeft: `${10 + depth * 14}px`,
      whiteSpace: 'nowrap',
      cursor: 'pointer',
      borderRadius: '3px',
      color: ROW_INK,
    });

    const hasChildren = node.children.length > 0;
    const path = pathFor(el);
    const chevron = styled('span', 'atx-tree-chevron', {
      flex: '0 0 auto',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '12px',
      color: COLOR.muted,
      cursor: hasChildren ? 'pointer' : 'default',
    });
    // A leaf gets a small dot in the same slot, so tags stay column-aligned.
    chevron.append(
      hasChildren ? icon(collapsed.has(path) ? 'chevronRight' : 'chevronDown', 12) : icon('dot', 7),
    );
    if (hasChildren) {
      chevron.addEventListener('click', (e) => {
        e.stopPropagation();
        if (collapsed.has(path)) collapsed.delete(path);
        else collapsed.add(path);
        renderRows();
      });
    }

    const tag = styled('span', 'atx-tree-tag', { flex: '0 0 auto', fontWeight: '600' });
    tag.textContent = `<${el.tagName.toLowerCase()}>`;

    row.append(chevron, tag);

    // A short text preview for leaf text elements aids scanning.
    if (!hasChildren) {
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text) {
        const preview = styled('span', 'atx-tree-preview', {
          flex: '0 1 auto',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          color: COLOR.muted,
        });
        preview.textContent = text.length > 24 ? `${text.slice(0, 24)}…` : text;
        row.append(preview);
      }
    }

    // The loc doubles as an editor jump: clicking it opens the file at this line
    // in the user's editor (the same /open the hover pill's "open ↗" uses), so it
    // stops the click from also selecting the row.
    const loc = styled('span', 'atx-tree-loc', {
      flex: '0 0 auto',
      marginLeft: 'auto',
      paddingLeft: '10px',
      color: COLOR.muted,
      fontSize: '10px',
      cursor: 'pointer',
      textDecoration: 'underline dotted transparent',
      textUnderlineOffset: '2px',
    });
    loc.textContent = source.loc || '?';
    loc.title = `Open ${basename(source.file)}:${source.loc} in your editor`;
    loc.addEventListener('mouseenter', () => {
      loc.style.color = COLOR.accent;
      loc.style.textDecorationColor = COLOR.accent;
    });
    loc.addEventListener('mouseleave', () => {
      loc.style.color = COLOR.muted;
      loc.style.textDecorationColor = 'transparent';
    });
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
      const empty = styled('div', 'atx-tree-empty', {
        padding: '14px',
        color: COLOR.muted,
        font: `12px ${FONT.ui}`,
      });
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
    root.style.display = 'flex';
    tab.style.display = 'none';
  }

  function hide(): void {
    root.style.display = 'none';
    // The tab only makes sense while editing — outside edit mode the tree has
    // nothing live to point at, and the bar's Elements button reopens both.
    tab.style.display = deps.isEditMode() ? 'flex' : 'none';
    syncActive(null);
    clearSelection();
  }

  function isOpen(): boolean {
    return root.style.display !== 'none';
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
