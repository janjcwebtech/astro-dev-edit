import type { UsageLink } from '../shared/protocol.ts';
import * as api from './api.ts';
import { chainIds, createChainLinks } from './composition.ts';
import { readRenderOccurrences } from './composition-dom.ts';
import { openPeekPanel } from './editors/peek.ts';
import { openSettingsPanel } from './editors/settings-panel.ts';
import { icon } from './icons.ts';
import { initInspector } from './inspector.ts';
import { createMenu } from './menu.ts';
import { pageSource, resolvePageSource } from './page-source.ts';
import { isOwnUi, mount } from './shadow.ts';
import { annotatedElements, cacheSourceMappings, sourceFor } from './source-map.ts';
import * as state from './state.ts';
import { initTree } from './tree.ts';
import { basename, footButton, outlineRect, setChromeInset, styled, toast } from './ui.ts';

/** Opt-in read-only composition surface. Selection and Alt interception have
 * independent lifetimes; none of the legacy editor routes are entered. */

/** How long the pointer must rest on one element before the pill grows its
 *  breadcrumb row. Long enough that sweeping the page costs no request, short
 *  enough that stopping on something reads as an answer rather than a delay. */
const DWELL = 400;
/** Gap between the hovered element and the pill. */
const PILL_GAP = 8;
/** Keep-clear margin against the viewport edges. */
const EDGE = 8;

export function initInspectorApp() {
  // The editing toolbar is not mounted in this mode.
  setChromeInset({ top: 0, bottom: 0 });
  let held = false;
  let previousCursor = '';
  let hovered: HTMLElement | null = null;
  let hoveredRect: DOMRect | null = null;
  let dwellTimer: number | null = null;
  /** Bumped on every highlight change, so a chain resolved late can tell it is
   *  describing an element the pointer has already left. */
  let hoverSeq = 0;
  /** The route's own source file, resolved once per page rather than per click
   *  — the header names it, the breadcrumb's first segment is it, and *View
   *  code* opens it. */
  let routeFile: string | null = null;
  const descriptions = new Map<Element, string>();
  const chainLinks = createChainLinks(api);

  const hoverOutline = styled('div', 'atx-inspector-hover');
  const pill = styled('div', 'atx-inspector-pill');
  const pillRow = styled('div', 'atx-inspector-pill-row');
  const pillCrumbs = styled('div', 'atx-inspector-crumbs');
  pill.append(pillRow, pillCrumbs);

  // --- Panel header ---------------------------------------------------------
  // Two rows, per the mockup: the tool's own controls sit in the title bar the
  // tree already owns, and the page the tool is pointed at gets a row of its
  // own underneath. Without an admin bar this is the only chrome there is, so
  // a tool-wide action that is not here is unreachable.

  const header = styled('div', 'atx-inspector-tree-header');
  const routeRow = styled('div', 'atx-inspector-route');
  const routeText = styled('div', 'atx-inspector-route-path');
  const routeFileText = styled('div', 'atx-inspector-route-file');
  const routeLabels = styled('div', 'atx-inspector-route-labels');
  routeLabels.append(routeText, routeFileText);
  const routeButton = footButton('View code', 'outline', () => openRouteSource());
  routeButton.classList.add('atx-btn-sm');
  routeRow.append(routeLabels, routeButton);
  const hint = styled('p', 'atx-inspector-note');
  hint.textContent = 'Hold Alt / ⌥ and click to inspect. Release to use the page.';
  header.append(routeRow, hint);

  function titleAction(label: string, name: 'menu' | 'settings', onClick: (button: HTMLElement) => void) {
    const button = styled('button', 'atx-tree-action');
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.append(icon(name, 16));
    button.addEventListener('click', event => {
      event.stopPropagation();
      onClick(button);
    });
    return button;
  }

  const menu = createMenu([
    {
      label: 'Copy page context',
      icon: 'copy',
      title: 'Copy this route, its source file and the components on it, as markdown',
      onSelect: () => void copyPageContext(),
    },
    {
      label: 'Re-scan the page',
      icon: 'sidebar',
      title: 'Re-read the page’s annotations and rebuild the tree',
      onSelect: () => rebuild(),
    },
  ], { foot: 'dev server connected' });

  const menuButton = titleAction('Menu', 'menu', button => menu.toggle(button));
  menuButton.setAttribute('aria-haspopup', 'menu');
  const settingsButton = titleAction('Settings', 'settings', () => {
    menu.close();
    openSettingsPanel();
  });

  // --- Source navigation ----------------------------------------------------

  function viewCode(source: { file: string; loc: string }) {
    openPeekPanel(source, src => {
      void api.open(src).then(answer => {
        if (answer.refused) toast(answer.refused, 'warn');
      }).catch(error => toast(String(error), 'err'));
    });
  }

  /** The route's template. One verb, one popup: *Open in editor* lives inside
   *  the peek, so this is the only door onto the page's own source. */
  function openRouteSource() {
    if (routeFile) return viewCode({ file: routeFile, loc: '1:1' });
    const pathname = location.pathname;
    void api.resolvePageSource({ pathname }).then(answer => {
      if (pathname !== location.pathname) return;
      if (answer.file) {
        routeFile = answer.file;
        paintRoute();
        viewCode({ file: answer.file, loc: '1:1' });
      } else toast(`Page source unavailable · ${answer.refusal ?? 'no-match'}`, 'warn');
    }).catch(error => toast(String(error), 'err'));
  }

  function paintRoute() {
    routeText.textContent = location.pathname;
    routeFileText.textContent = routeFile ? basename(routeFile) : 'route source unresolved';
    routeFileText.toggleAttribute('data-unresolved', !routeFile);
    routeButton.title = routeFile ?? 'Resolve and open the file this route is written in';
  }

  /** What the page is, as one paste: the route, its template, the backing
   *  content file it declares, and the components proven to be on it. Every
   *  line is something already resolved — the components come from the chain
   *  cache's own batch, so this costs one request at most and never guesses a
   *  file it has not been told about. */
  async function copyPageContext() {
    const pathname = location.pathname;
    const ids = new Set<string>();
    const elements = annotatedElements();
    let unannotated = 0;
    for (const el of elements) {
      const chain = chainIds(el);
      if (chain === null) unannotated++;
      else for (const id of chain) ids.add(id);
    }
    const lines = [`# Page context — ${pathname}`, '',
      `- **Route** ${pathname}`,
      `- **Route source** ${routeFile ?? 'unresolved'}`];
    const backing = pageSource();
    if (backing) lines.push(`- **Backing content file** ${backing}`);
    lines.push(`- **Annotated elements** ${elements.length}`);
    if (unannotated) lines.push(`- **Without a composition chain** ${unannotated}`);
    try {
      const links = await chainLinks.resolve(pathname, [...ids]);
      const files = [...new Set([...links.values()].flatMap(link => link.target ? [link.target] : []))].sort();
      lines.push('', `## Components on this route (${files.length})`,
        ...(files.length ? files.map(file => `- ${file}`) : ['_None resolved._']));
      const unresolved = ids.size - links.size;
      if (unresolved > 0) lines.push('', `_${unresolved} usage ${unresolved === 1 ? 'id' : 'ids'} did not resolve to a link._`);
    } catch (error) {
      lines.push('', `## Components on this route`, `_Unavailable — ${error instanceof Error ? error.message : 'request failed'}._`);
    }
    try {
      await navigator.clipboard.writeText(`${lines.join('\n')}\n`);
      toast('Page context copied', 'ok');
    } catch {
      toast('The browser refused clipboard access', 'warn');
    }
  }

  // --- Panels ---------------------------------------------------------------

  const inspector = initInspector({
    viewCode,
    backingFile: pageSource,
    openRule: (file, selector) => {
      void api.inspectOpen({ file, selector }).then(result => {
        if (!result.loc) toast('Selector location unavailable; opened the source file.', 'warn');
      }).catch(error => toast(String(error), 'err'));
    },
    onClose: () => tree.clearSelection(),
  });
  const tree = initTree({
    readOnly: true, header, titleActions: [menuButton, settingsButton], isEditMode: () => true,
    highlight, clearHighlight, openEditor: () => {},
    openSource: viewCode,
    onSelect: el => { clearHighlight(); void inspector.select(el); },
    describe: el => descriptions.get(el) ?? null,
  });

  // --- Hover pill -----------------------------------------------------------

  function cancelDwell() {
    if (dwellTimer !== null) {
      clearTimeout(dwellTimer);
      dwellTimer = null;
    }
  }

  function clearHighlight() {
    cancelDwell();
    hoverSeq++;
    hovered = null;
    hoveredRect = null;
    hoverOutline.removeAttribute('data-on');
    pill.removeAttribute('data-on');
    pillCrumbs.replaceChildren();
    pillCrumbs.removeAttribute('data-on');
    tree.syncActive(null);
  }

  /** Above the element when it fits there, below it otherwise. Measured after
   *  the content is in, because a breadcrumb row changes the height and the
   *  pill must not end up over what it is naming. */
  function placePill() {
    if (!hoveredRect) return;
    const height = pill.offsetHeight;
    const above = hoveredRect.top - height - PILL_GAP;
    pill.style.top = `${above >= EDGE ? above
      : Math.max(EDGE, Math.min(hoveredRect.bottom + PILL_GAP, innerHeight - height - EDGE))}px`;
    pill.style.left = `${Math.max(EDGE, Math.min(hoveredRect.left, innerWidth - pill.offsetWidth - EDGE))}px`;
  }

  function crumb(label: string, onSelect: (() => void) | null, refused = false) {
    const el = onSelect ? styled('button', 'atx-crumb') : styled('span', 'atx-crumb');
    el.textContent = label;
    el.toggleAttribute('data-refused', refused);
    if (el instanceof HTMLButtonElement && onSelect) {
      el.type = 'button';
      el.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        onSelect();
      });
    }
    return el;
  }

  /** Open the inspector on `el`, marking the chain row a segment names. The
   *  clicked row is never traded for the segment: `select` keeps the element it
   *  already shows and only moves the mark. */
  function openAt(el: HTMLElement, usageId: string) {
    tree.selectElement(el);
    void inspector.select(el, usageId);
  }

  /** The breadcrumb row, grown on dwell: route › each usage's resolved file ›
   *  the element itself. Ids resolve through one batched, per-page cache, so a
   *  dwell costs a request only for links this page has not shown before. */
  async function renderCrumbs(el: HTMLElement) {
    const seq = hoverSeq;
    const pathname = location.pathname;
    const ids = chainIds(el);
    const row = document.createDocumentFragment();
    if (routeFile) row.append(crumb(basename(routeFile), () => openAt(el, 'route')));
    if (ids === null) {
      row.append(crumb('no chain annotation', null, true));
    } else if (ids.length) {
      let links: ReadonlyMap<string, UsageLink>;
      try {
        links = await chainLinks.resolve(pathname, ids);
      } catch {
        if (seq !== hoverSeq) return;
        links = new Map();
      }
      if (seq !== hoverSeq || pathname !== location.pathname) return;
      for (const id of ids) {
        const link = links.get(id);
        if (row.childNodes.length) row.append(separator());
        if (!link) row.append(crumb('unresolved', null, true));
        else row.append(crumb(link.target ? basename(link.target) : link.name,
          () => openAt(el, id), !link.target));
      }
    }
    if (seq !== hoverSeq) return;
    if (row.childNodes.length) row.append(separator());
    row.append(crumb(`<${el.tagName.toLowerCase()}>`, null));
    pillCrumbs.replaceChildren(row);
    pillCrumbs.setAttribute('data-on', '');
    placePill();
  }

  function separator() {
    const el = styled('span', 'atx-crumb-sep');
    el.textContent = '›';
    el.setAttribute('aria-hidden', 'true');
    return el;
  }

  function highlight(el: HTMLElement) {
    cancelDwell();
    hoverSeq++;
    hovered = el;
    const rect = el.getBoundingClientRect();
    hoveredRect = rect;
    Object.assign(hoverOutline.style, outlineRect(rect));
    hoverOutline.setAttribute('data-on', '');
    const src = sourceFor(el);
    const opaque = !!el.parentElement?.closest('[data-atx-boundary="html"]');
    pillRow.textContent = src && !opaque ? `${basename(src.file)}:${src.loc} · inspect`
      : opaque ? 'Generated HTML · untracked' : `<${el.tagName.toLowerCase()}> · no source annotation`;
    pillCrumbs.replaceChildren();
    pillCrumbs.removeAttribute('data-on');
    pill.setAttribute('data-on', '');
    placePill();
    tree.syncActive(el);
    // Only an element with a source of its own has a chain worth naming;
    // untracked HTML has no proven inner relationship to show one for.
    if (src && !opaque) dwellTimer = window.setTimeout(() => { void renderCrumbs(el); }, DWELL);
  }

  function setHeld(on: boolean) {
    if (on === held) return;
    held = on;
    if (on) {
      previousCursor = document.body.style.cursor;
      document.body.style.cursor = 'crosshair';
    } else {
      document.body.style.cursor = previousCursor;
      clearHighlight();
    }
  }

  function target(event: MouseEvent): HTMLElement | null {
    if (isOwnUi(event) || state.get()) return null;
    const el = event.target;
    return el instanceof HTMLElement && el !== document.body && el !== document.documentElement ? el : null;
  }
  /** The pill is the one overlay surface the pointer may travel onto without
   *  the highlight it describes being dropped — a breadcrumb has to be
   *  reachable, and it names the element the pointer just left. */
  const onPill = (event: Event) => event.composedPath().includes(pill);

  document.addEventListener('keydown', event => {
    if (event.key === 'Alt' && !isOwnUi(event) && !state.get()) {
      event.preventDefault(); setHeld(true);
    }
    if (event.key === 'Escape' && !state.get()) { inspector.close(); clearHighlight(); }
  }, true);
  document.addEventListener('keyup', event => { if (event.key === 'Alt') setHeld(false); }, true);
  window.addEventListener('blur', () => setHeld(false));
  document.addEventListener('mousemove', event => {
    if (onPill(event)) return;
    setHeld(event.altKey && !state.get());
    const el = held ? target(event) : null;
    if (el && el !== hovered) highlight(el);
    else if (!el) clearHighlight();
  }, true);
  document.addEventListener('mousedown', event => {
    if (event.altKey && target(event)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  document.addEventListener('click', event => {
    const el = event.altKey ? target(event) : null;
    if (!el) return;
    event.preventDefault(); event.stopImmediatePropagation();
    clearHighlight();
    tree.selectElement(el);
    void inspector.select(el);
  }, true);
  window.addEventListener('scroll', clearHighlight, { passive: true });
  window.addEventListener('resize', clearHighlight, { passive: true });

  // --- Lifecycle ------------------------------------------------------------

  function rebuild() {
    cacheSourceMappings();
    descriptions.clear();
    const render = readRenderOccurrences(document);
    if (render.result.ok) {
      for (const occurrence of render.result.occurrences) {
        if (!occurrence.group || occurrence.reason) continue;
        const el = render.elements[occurrence.key];
        const parent = el.parentElement;
        const boundary = parent?.getAttribute('data-atx-instance') !== el.getAttribute('data-atx-instance');
        const slot = occurrence.slots.at(-1);
        if (boundary || slot) descriptions.set(el,
          `${basename(el.getAttribute('data-atx-file') ?? '')}${slot ? ` · slot ${slot.name || 'default'} in ${basename(slot.file)}` : ''}`);
      }
    }
    paintRoute();
    tree.rebuild();
    void resolvePageSource();
    // The route's own template, once per page: the header names it and the
    // breadcrumb leads with it, so neither has to ask per hover.
    const pathname = location.pathname;
    void api.resolvePageSource({ pathname }).then(answer => {
      if (pathname !== location.pathname) return;
      routeFile = answer.file ?? null;
      paintRoute();
    }).catch(() => { /* the header says "unresolved"; View code retries. */ });
  }
  function invalidate() {
    setHeld(false);
    clearHighlight();
    menu.close();
    // Usage ids are stable across a restart but not across an edit to the file
    // that mints them, and a navigation changes which route's graph they are
    // resolved against.
    chainLinks.invalidate();
    routeFile = null;
    inspector.invalidate();
    if (state.get()?.kind === 'panel') state.dismiss();
  }
  document.addEventListener('astro:before-swap', invalidate);
  document.addEventListener('astro:page-load', () => { invalidate(); rebuild(); });
  window.addEventListener('popstate', () => { invalidate(); rebuild(); });
  if (import.meta.hot) {
    import.meta.hot.on('vite:beforeUpdate', invalidate);
    import.meta.hot.on('vite:beforeFullReload', invalidate);
    import.meta.hot.on('vite:afterUpdate', rebuild);
  }
  mount(hoverOutline, pill, tree.root, tree.tab, tree.selectionOutline, menu.root, inspector.root);
  tree.tab.title = 'Open source inspector · hold Alt / ⌥ to select on the page';
  tree.tab.setAttribute('aria-label', 'Open source inspector');
  tree.hide();
  rebuild();
  return { invalidate, rebuild };
}
