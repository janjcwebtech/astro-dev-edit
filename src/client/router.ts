import type { ClassifyResult, SourceLoc } from '../shared/protocol.ts';
import * as api from './api.ts';
import { beginExpressionEdit } from './editors/expression.ts';
import { beginImageEdit } from './editors/image.ts';
import { beginMarkupEdit } from './editors/markup.ts';
import { showDynamicNotice } from './editors/notice.ts';
import { beginTextEdit } from './editors/text.ts';
import { nearestSource, sourceFor } from './source-map.ts';
import * as state from './state.ts';
import { toast } from './ui.ts';

/**
 * Click routing: confirm the clicked target against the server's AST-truth
 * classification, then open the matching editor. Capture-phase listeners
 * swallow clicks on editable targets so wrapping links/buttons can't act.
 */

/** True when the event is inside our own overlay UI (toggle, panels, veils). */
export function isOwnUi(e: Event): boolean {
  return e
    .composedPath()
    .some((n) => n instanceof HTMLElement && n.dataset?.astroTextEditUi === '1');
}

export interface RouterDeps {
  isEditMode(): boolean;
  /** True while the navigate modifier (Ctrl / Alt) is held in edit mode. */
  isNavigating(): boolean;
  openSource(src: SourceLoc): void;
  /** Open the in-browser source-peek panel for a loc. */
  openPeek(src: SourceLoc): void;
}

const IS_MAC = /Mac|iP(hone|ad|od)/.test(navigator.platform);

/**
 * In navigate mode, give links plain-click behavior despite the held
 * modifier: natively Alt+click downloads the target and Ctrl+click opens a
 * new tab, so we swallow the event and navigate ourselves. Non-link targets
 * (buttons, form controls) pass through untouched.
 */
function navigateThrough(e: MouseEvent): void {
  const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
  if (!(a instanceof HTMLAnchorElement)) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  window.location.assign(a.href);
}

/** What initRouter hands back: a programmatic open so the element-tree panel can
 *  open the editor for a row (double-click) through the same classify → route
 *  path a page click takes. */
export interface RouterHandle {
  openElementAt(el: HTMLElement): void;
}

/** Register the capture-phase click/mousedown listeners. */
export function initRouter(deps: RouterDeps): RouterHandle {
  /**
   * Open the appropriate editor for a source-mapped element — after confirming
   * the target with the server's AST classification. The DOM can't distinguish
   * a resolved {expression} from literal text; the AST can. (spec §16.1)
   */
  async function openElement(el: HTMLElement, src: SourceLoc): Promise<void> {
    // Claim the interaction slot synchronously: /classify is async, and without
    // this a rapid second click during the round-trip could open a second editor.
    const busy = state.begin({ kind: 'busy' });
    let server: ClassifyResult;
    try {
      server = await api.classify({ file: src.file, loc: src.loc, tag: el.tagName.toLowerCase() });
    } catch (err) {
      state.releaseIf(busy);
      toast(`Could not check editability — ${err instanceof Error ? err.message : 'unknown error'}`, 'err');
      return;
    }

    if (server.kind === 'image' && el instanceof HTMLImageElement) {
      const attrs = server.attrs ?? { src: 'dynamic', alt: 'dynamic' };
      if (attrs.src !== 'static' && attrs.alt === 'dynamic') {
        showDynamicNotice(
          src,
          'Both the image file and its alt text are set from code, so they must be edited in the source.',
          deps.openSource,
          deps.openPeek,
        );
        return;
      }
      void beginImageEdit(el, src, attrs);
    } else if (server.kind === 'text') {
      beginTextEdit(el, src);
    } else if (server.kind === 'markup' && server.markup) {
      beginMarkupEdit(el, src, server.markup.html, deps.openSource);
    } else if (server.kind === 'expression' && server.expression) {
      beginExpressionEdit(el, src, server.expression, deps.openSource);
    } else {
      showDynamicNotice(
        src,
        server.reason ??
          'This content is generated from a template expression or a loop, so editing it here could change behaviour, not just words. Edit it at the source instead.',
        deps.openSource,
        deps.openPeek,
      );
    }
  }

  function onClick(e: MouseEvent): void {
    if (!deps.isEditMode()) return;
    if (isOwnUi(e)) return;

    // Navigate mode: don't intercept anything, but fix up link clicks whose
    // native modifier behavior isn't "navigate here".
    if (deps.isNavigating()) {
      navigateThrough(e);
      return;
    }

    const el = nearestSource(e.target);
    const src = el ? sourceFor(el) : undefined;

    // Case A: an inline text edit is open. A click elsewhere should commit it
    // and — if it landed on another editable target — open that one in the
    // SAME gesture, rather than only dismissing and forcing a second click. (#1)
    const interaction = state.get();
    if (interaction?.kind === 'text') {
      const active = document.querySelector('[data-astro-text-edit-active="1"]');
      if (el && el === active) return; // clicking within the edit: leave it be
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      interaction.finish(true); // commit the current edit now
      if (el && src) void openElement(el, src); // and open the new target immediately
      return;
    }

    // Case B: a modal interaction (image/dynamic panel) is open — its own
    // backdrop/buttons handle dismissal — or a classify/save is in flight.
    // Don't route background clicks.
    if (interaction) return;

    if (!el || !src) return;

    // Fully swallow the click so a wrapping <a>/<button> can't navigate or submit.
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    void openElement(el, src);
  }

  // In edit mode, also swallow mousedown on an editable target in capture
  // phase — some browsers begin navigation/focus on mousedown before click
  // fires. This stops a wrapping link from acting; our own UI is exempt.
  function onMouseDown(e: MouseEvent): void {
    if (!deps.isEditMode() || deps.isNavigating() || isOwnUi(e)) return;
    const el = nearestSource(e.target);
    if (el && sourceFor(el)) {
      // Don't preventDefault when the mousedown is inside the active edit, or
      // the caret won't move where the user clicked.
      if (el.dataset.astroTextEditActive === '1') return;
      e.preventDefault();
      e.stopPropagation();
    }
  }

  // macOS turns Ctrl+click into a right-click — no click event ever fires,
  // only contextmenu. In navigate mode, catch it on links and navigate
  // instead of showing the menu; anywhere else the menu opens as usual.
  function onContextMenu(e: MouseEvent): void {
    if (!IS_MAC || !e.ctrlKey) return;
    if (!deps.isEditMode() || !deps.isNavigating() || isOwnUi(e)) return;
    navigateThrough(e);
  }

  // Capture phase so we intercept before links/buttons act on their default.
  document.addEventListener('click', onClick, true);
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('contextmenu', onContextMenu, true);

  return {
    openElementAt(el: HTMLElement): void {
      const src = sourceFor(el);
      if (src) void openElement(el, src);
    },
  };
}
