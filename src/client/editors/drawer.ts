import * as state from '../state.ts';
import { buildBackdrop, buildDrawer } from '../ui.ts';

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
  /** Dirty-checked close — backdrop click, Escape and Cancel all end up here. */
  close(): void;
  /** Remove the drawer unconditionally (after a successful save/create). */
  teardown(): void;
}

export function openDrawer(
  title: string,
  opts: {
    isDirty(): boolean;
    /** window.confirm prompt shown when closing dirty. */
    discardMessage: string;
  },
): DrawerShell {
  const drawer = buildDrawer(title);
  const body = drawer.querySelector('[data-body]') as HTMLElement;
  const foot = drawer.querySelector('[data-foot]') as HTMLElement;
  const actions = drawer.querySelector('[data-actions]') as HTMLElement;

  const teardown = (): void => {
    state.releaseIf(token);
    drawer.remove();
    backdrop.remove();
  };
  const close = (): void => {
    if (opts.isDirty() && !window.confirm(opts.discardMessage)) {
      // The slot may already be cleared (Escape path goes through dismiss);
      // re-claim it so the drawer stays the active interaction.
      token = state.begin({ kind: 'panel', close });
      return;
    }
    teardown();
  };
  const backdrop = buildBackdrop(close);
  let token = state.begin({ kind: 'panel', close });

  document.body.append(backdrop, drawer);
  return { body, foot, actions, close, teardown };
}
