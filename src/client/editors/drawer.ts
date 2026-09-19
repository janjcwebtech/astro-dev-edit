import { trapFocus } from '../focus.ts';
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
  /** Second line under the title; see `ui.ts::DrawerOptions`. */
  description?: string;
  /** Chip beside the title; see `ui.ts::DrawerOptions`. */
  badge?: HTMLElement;
  /** Run after the drawer is gone, however it closed — the admin bar
   *  refreshes, since a Settings save can change what it shows. */
  onClose?(): void;
}

export function openDrawer(title: string, opts: DrawerOpenOptions): DrawerShell {
  const drawer = buildDrawer(title, {
    ...(opts.width ? { width: opts.width } : {}),
    ...(opts.description ? { description: opts.description } : {}),
    ...(opts.badge ? { badge: opts.badge } : {}),
  });
  const body = drawer.querySelector('[data-body]') as HTMLElement;
  const foot = drawer.querySelector('[data-foot]') as HTMLElement;
  const actions = drawer.querySelector('[data-actions]') as HTMLElement;

  const teardown = (): void => {
    state.releaseIf(token);
    releaseFocus();
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
  const backdrop = buildBackdrop(close);
  let token = state.begin({ kind: 'panel', close });

  mount(backdrop, drawer);
  // After mounting: a trap focuses its first control, and nothing in a drawer
  // that is not in the document yet can take focus.
  const releaseFocus = trapFocus(drawer);
  return { body, foot, actions, close, teardown };
}
