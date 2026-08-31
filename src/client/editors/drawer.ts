import * as state from '../state.ts';
import { buildBackdrop, buildDrawer } from '../ui.ts';
import { mount } from '../shadow.ts';

/**
 * Drawer lifecycle scaffold: shell + backdrop + interaction-state token +
 * dirty-checked close, owned once so every drawer behaves identically. Callers
 * fill `body`/`foot`/`actions` and wire their buttons to `close` (dirty check)
 * or `teardown` (unconditional). ui.ts stays pure DOM; the state coupling
 * lives here.
 */

export interface DrawerShell {
  /** Scrollable content slot. */
  body: HTMLElement;
  /** Sticky footer slot. */
  foot: HTMLElement;
  /** Title-bar action slot. */
  actions: HTMLElement;
  /**
   * Dirty-checked close — backdrop click, Escape and Cancel all end up here.
   * Returns false when the user kept the drawer open at the discard prompt, so a
   * caller that meant to *hand off* to another surface can stay put.
   */
  close(): boolean;
  /** Remove the drawer unconditionally (after a successful save/create). */
  teardown(): void;
}

export interface DrawerOpenOptions {
  isDirty(): boolean;
  /** window.confirm prompt shown when closing dirty. */
  discardMessage: string;
  /** CSS width override; see `ui.ts::DrawerOptions`. */
  width?: string;
  /** Stacking layer. Needed when a drawer opens above something already
   *  raised — the Settings drawer reached from the media modal's "no key
   *  configured" card. */
  layer?: number;
  /** Run after the drawer is gone, however it closed. Lets the caller that
   *  raised it resume — the Unsplash pane re-runs its search once a key
   *  exists. */
  onClose?(): void;
  /**
   * Hand the interaction slot back to whatever held it, instead of clearing it.
   * Required when this drawer opened above another modal surface, which would
   * otherwise stop owning the page's clicks once this one closes.
   */
  restoreState?: boolean;
}

export function openDrawer(title: string, opts: DrawerOpenOptions): DrawerShell {
  const drawer = buildDrawer(title, {
    ...(opts.width ? { width: opts.width } : {}),
    ...(opts.layer !== undefined ? { layer: opts.layer } : {}),
  });
  const body = drawer.querySelector('[data-body]') as HTMLElement;
  const foot = drawer.querySelector('[data-foot]') as HTMLElement;
  const actions = drawer.querySelector('[data-actions]') as HTMLElement;

  const heldBefore = opts.restoreState ? state.get() : null;
  const teardown = (): void => {
    if (heldBefore) state.releaseTo(token, heldBefore);
    else state.releaseIf(token);
    drawer.remove();
    backdrop.remove();
    opts.onClose?.();
  };
  const close = (): boolean => {
    if (opts.isDirty() && !window.confirm(opts.discardMessage)) {
      // The slot may already be cleared (Escape path goes through dismiss);
      // re-claim it so the drawer stays the active interaction.
      token = state.begin({ kind: 'panel', close });
      return false;
    }
    teardown();
    return true;
  };
  const backdrop = buildBackdrop(close, opts.layer !== undefined ? opts.layer - 1 : undefined);
  let token = state.begin({ kind: 'panel', close });

  mount(backdrop, drawer);
  return { body, foot, actions, close, teardown };
}
