import { type IconName, icon } from './icons.ts';
import { styled } from './ui.ts';

/**
 * The overflow menu a panel header opens: a floating list of actions anchored
 * under the button that owns it.
 *
 * It exists as its own factory because two headers want the same surface and
 * neither should own it. `admin-bar.ts` grew one inline, welded to the bar's
 * item registry, its edge preference and its retract timers; the inspector's
 * tree header needs the list without any of that. So the list is the module and
 * the anchor is an argument — adding a menu somewhere is `createMenu(...)` plus
 * an anchor button, not a second copy of the open/close/outside-click dance.
 *
 * Styling reuses `.atx-menu*` from `styles.ts`, unchanged: one menu look, so a
 * second menu cannot drift from the first.
 *
 * Positioning is deliberately below-then-flip rather than a preference: a
 * header is at the top of its panel in both modes, and a menu that opened
 * upward from there would leave the viewport.
 */

export interface MenuItemSpec {
  label: string;
  icon: IconName;
  /** Tooltip; defaults to the label. */
  title?: string;
  /** Hidden entirely when this returns false. Re-evaluated on every open. */
  visible?(): boolean;
  onSelect(): void;
}

export interface MenuHandle {
  /** Mounted by the composition root, alongside the panel that anchors it. */
  root: HTMLElement;
  /** Open under `anchor`, or close if this menu is already open. */
  toggle(anchor: HTMLElement): void;
  close(): void;
  isOpen(): boolean;
}

export interface MenuOptions {
  /** The line under the list. Omitted when there is nothing to say there. */
  foot?: string;
}

/** Gap between the anchor's bottom edge and the list. */
const ANCHOR_GAP = 7;
/** Keep-clear margin against the viewport edges. */
const EDGE = 6;

export function createMenu(items: readonly MenuItemSpec[], options: MenuOptions = {}): MenuHandle {
  const root = styled('div', 'atx-menu');
  root.setAttribute('role', 'menu');
  const list = styled('div', 'atx-menu-items');
  root.append(list);
  if (options.foot) {
    const foot = styled('div', 'atx-menu-foot');
    foot.append(styled('span', 'atx-menu-live'), document.createTextNode(options.foot));
    root.append(foot);
  }

  const buttons = items.map(spec => {
    const button = styled('button', 'atx-menu-item');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.append(icon(spec.icon, 15), document.createTextNode(spec.label));
    button.title = spec.title ?? spec.label;
    button.addEventListener('click', event => {
      event.stopPropagation();
      close();
      spec.onSelect();
    });
    list.append(button);
    return { spec, button };
  });

  let anchored: HTMLElement | null = null;

  function isOpen(): boolean {
    return root.hasAttribute('data-on');
  }

  function close(): void {
    root.removeAttribute('data-on');
    anchored?.setAttribute('aria-expanded', 'false');
    anchored = null;
  }

  function open(anchor: HTMLElement): void {
    for (const { spec, button } of buttons) {
      button.toggleAttribute('data-hidden', !(spec.visible?.() ?? true));
    }
    anchored = anchor;
    anchor.setAttribute('aria-expanded', 'true');
    root.setAttribute('data-on', '');
    // Measured after it is displayed: a hidden item changes the height, so a
    // width/height read taken before the paint would place last open's box.
    const box = anchor.getBoundingClientRect();
    const size = root.getBoundingClientRect();
    root.style.left = `${Math.max(EDGE, Math.min(box.left, innerWidth - size.width - EDGE))}px`;
    const below = box.bottom + ANCHOR_GAP;
    root.style.top = `${below + size.height + EDGE <= innerHeight ? below
      : Math.max(EDGE, box.top - ANCHOR_GAP - size.height)}px`;
  }

  function toggle(anchor: HTMLElement): void {
    if (isOpen() && anchored === anchor) close();
    else open(anchor);
  }

  // Outside-click and Escape close it. Capture phase with stopPropagation on
  // Escape, so an open menu consumes the key rather than also closing the
  // panel behind it — the same ordering the admin bar's menu relies on.
  document.addEventListener('click', event => {
    if (isOpen() && !event.composedPath().includes(root) && !(anchored && event.composedPath().includes(anchored))) close();
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !isOpen()) return;
    event.stopPropagation();
    close();
  }, true);
  // A menu anchored to a fixed panel would otherwise hang in mid-air.
  window.addEventListener('scroll', () => { if (isOpen()) close(); }, { passive: true });
  window.addEventListener('resize', () => { if (isOpen()) close(); }, { passive: true });

  close();
  return { root, toggle, close, isOpen };
}
