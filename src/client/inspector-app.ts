import * as api from './api.ts';
import { readRenderOccurrences } from './composition-dom.ts';
import { openPeekPanel } from './editors/peek.ts';
import { initInspector } from './inspector.ts';
import { pageSource, resolvePageSource } from './page-source.ts';
import { isOwnUi, mount } from './shadow.ts';
import { cacheSourceMappings, sourceFor } from './source-map.ts';
import * as state from './state.ts';
import { initTree } from './tree.ts';
import { basename, footButton, outlineRect, setChromeInset, styled, toast } from './ui.ts';

/** Opt-in read-only composition surface. Selection and Alt interception have
 * independent lifetimes; none of the legacy editor routes are entered. */
export function initInspectorApp() {
  // The editing toolbar is not mounted in this mode.
  setChromeInset({ top: 0, bottom: 0 });
  let held = false;
  let previousCursor = '';
  let hovered: HTMLElement | null = null;
  const descriptions = new Map<Element, string>();
  const hoverOutline = styled('div', 'atx-inspector-hover');
  const pill = styled('div', 'atx-inspector-pill');
  const header = styled('div', 'atx-inspector-tree-header');
  const route = styled('span', 'atx-inspector-note');
  route.textContent = location.pathname;
  const routeButton = footButton('View code', 'outline', () => {
    const pathname = location.pathname;
    void api.resolvePageSource({ pathname }).then(answer => {
      if (pathname !== location.pathname) return;
      if (answer.file) viewCode({ file: answer.file, loc: '1:1' });
      else toast(`Page source unavailable · ${answer.refusal ?? 'no-match'}`, 'warn');
    }).catch(error => toast(String(error), 'err'));
  });
  const hint = styled('p', 'atx-inspector-note');
  hint.textContent = 'Hold Alt / ⌥ and click to inspect. Release to use the page.';
  header.append(route, routeButton, hint);

  function viewCode(source: { file: string; loc: string }) {
    openPeekPanel(source, src => {
      void api.open(src).then(answer => {
        if (answer.refused) toast(answer.refused, 'warn');
      }).catch(error => toast(String(error), 'err'));
    });
  }

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
    readOnly: true, header, isEditMode: () => true,
    highlight, clearHighlight, openEditor: () => {},
    openSource: viewCode,
    onSelect: el => { clearHighlight(); void inspector.select(el); },
    describe: el => descriptions.get(el) ?? null,
  });

  function clearHighlight() {
    hovered = null;
    hoverOutline.removeAttribute('data-on');
    pill.removeAttribute('data-on');
    tree.syncActive(null);
  }
  function highlight(el: HTMLElement) {
    hovered = el;
    const rect = el.getBoundingClientRect();
    Object.assign(hoverOutline.style, outlineRect(rect));
    hoverOutline.setAttribute('data-on', '');
    const src = sourceFor(el);
    const opaque = !!el.parentElement?.closest('[data-atx-boundary="html"]');
    pill.textContent = src && !opaque ? `${basename(src.file)}:${src.loc} · inspect`
      : opaque ? 'Generated HTML · untracked' : `<${el.tagName.toLowerCase()}> · no source annotation`;
    pill.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - 340))}px`;
    pill.style.top = `${Math.max(8, Math.min(rect.top - 34, innerHeight - 40))}px`;
    pill.setAttribute('data-on', '');
    tree.syncActive(el);
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
  document.addEventListener('keydown', event => {
    if (event.key === 'Alt' && !isOwnUi(event) && !state.get()) {
      event.preventDefault(); setHeld(true);
    }
    if (event.key === 'Escape' && !state.get()) { inspector.close(); clearHighlight(); }
  }, true);
  document.addEventListener('keyup', event => { if (event.key === 'Alt') setHeld(false); }, true);
  window.addEventListener('blur', () => setHeld(false));
  document.addEventListener('mousemove', event => {
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
    route.textContent = location.pathname;
    tree.rebuild();
    void resolvePageSource();
  }
  function invalidate() {
    setHeld(false);
    clearHighlight();
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
  mount(hoverOutline, pill, tree.root, tree.tab, tree.selectionOutline, inspector.root);
  tree.tab.title = 'Open source inspector · hold Alt / ⌥ to select on the page';
  tree.tab.setAttribute('aria-label', 'Open source inspector');
  tree.hide();
  rebuild();
  return { invalidate, rebuild };
}
