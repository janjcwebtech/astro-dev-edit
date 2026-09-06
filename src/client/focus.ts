import { overlayActiveElement } from './shadow.ts';

/**
 * Modal focus containment — the keyboard half of what a backdrop does for the
 * pointer.
 *
 * Every panel and drawer here is a `<div>` over a click-swallowing backdrop.
 * That stops the pointer and nothing else: Tab walked straight out of the
 * open panel into the site's navigation, the page's own links, Astro's dev
 * toolbar and the admin bar behind it, with the panel still up. It reads as a
 * modal and behaves as an overlay.
 *
 * `trapFocus` gives a shell the semantics (`role="dialog"`, `aria-modal`) and
 * the behaviour (Tab cycles inside it; focus that lands outside is pulled
 * back; the opener gets focus again on release).
 *
 * Two things make it more than a `querySelectorAll` loop:
 *
 * - **The composed tree, not the shadow tree.** The rich-text editor's
 *   `contenteditable` is a light-DOM node `<slot>`-ed into the drawer (see
 *   `shadow.ts::mountLight`), so `shell.querySelectorAll` cannot see it and a
 *   trap built on that query would lock the user out of the body they came to
 *   write. Slots are followed, in slot order, so Tab order matches what the eye
 *   sees.
 * - **Traps stack.** The media modal opens over the CMS drawer, and the
 *   Settings drawer over the media modal. Only the innermost trap acts; the one
 *   underneath resumes when it is released, exactly like `state.releaseTo`.
 */

const FOCUSABLE =
  'a[href], button, input, select, textarea, [contenteditable], [tabindex]';

const stack: Trap[] = [];

interface Trap {
  shell: HTMLElement;
  opener: Element | null;
}

function focusable(el: Element): el is HTMLElement {
  if (!el.matches(FOCUSABLE)) return false;
  if ((el as HTMLInputElement).disabled) return false;
  if (el.getAttribute('tabindex') === '-1') return false;
  if (el.hasAttribute('contenteditable') && !(el as HTMLElement).isContentEditable) return false;
  // Hidden things are not in the tab order; a zero-size box is the only
  // reliable read of that from here (the panel itself is never display:none).
  return (el as HTMLElement).getClientRects().length > 0;
}

/** Focusable descendants in composed order, following `<slot>`s. */
function focusablesIn(node: Element, out: HTMLElement[] = []): HTMLElement[] {
  for (const child of Array.from(node.children)) {
    if (child instanceof HTMLSlotElement) {
      for (const assigned of child.assignedElements()) {
        if (focusable(assigned)) out.push(assigned);
        focusablesIn(assigned, out);
      }
      continue;
    }
    if (focusable(child)) out.push(child);
    focusablesIn(child, out);
  }
  return out;
}

/** Whether an event happened inside `shell`, slotted content included. */
function inShell(shell: HTMLElement, e: Event): boolean {
  return e.composedPath().includes(shell);
}

function top(): Trap | undefined {
  return stack[stack.length - 1];
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Tab') return;
  const trap = top();
  if (!trap) return;
  const items = focusablesIn(trap.shell);
  if (items.length === 0) {
    e.preventDefault();
    return;
  }
  const first = items[0] as HTMLElement;
  const last = items[items.length - 1] as HTMLElement;
  const active = e.composedPath()[0];
  const here = inShell(trap.shell, e);
  if (!here) {
    // Focus is already outside (a stray click on the page, say) — Tab brings
    // it back rather than continuing the page's own order.
    e.preventDefault();
    first.focus();
    return;
  }
  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

function onFocusIn(e: FocusEvent): void {
  const trap = top();
  if (!trap) return;
  if (inShell(trap.shell, e)) return;
  // Focus reached the page behind the backdrop — from the browser's own
  // address-bar cycle, or a script. Take it back.
  const items = focusablesIn(trap.shell);
  (items[0] ?? trap.shell).focus();
}

function listen(on: boolean): void {
  const fn = on ? document.addEventListener : document.removeEventListener;
  fn.call(document, 'keydown', onKeyDown as EventListener, true);
  fn.call(document, 'focusin', onFocusIn as EventListener, true);
}

export interface TrapOptions {
  /** Accessible name for the dialog. Defaults to the shell's own title text. */
  label?: string;
  /** Focus this instead of the first focusable when the trap opens. Pass null
   *  to leave focus where the caller already put it. */
  initial?: HTMLElement | null;
}

/**
 * Make `shell` a modal dialog and hold focus inside it. Returns the release,
 * which restores focus to whatever was focused when the trap opened.
 */
export function trapFocus(shell: HTMLElement, opts: TrapOptions = {}): () => void {
  shell.setAttribute('role', 'dialog');
  shell.setAttribute('aria-modal', 'true');
  const label =
    opts.label ??
    shell.querySelector('.atx-panel-heading, .atx-drawer-title-text')?.textContent ??
    '';
  if (label) shell.setAttribute('aria-label', label);
  // So focus has somewhere to land in a shell whose controls are all disabled
  // mid-save, without putting the panel itself in the tab order.
  if (!shell.hasAttribute('tabindex')) shell.tabIndex = -1;

  // `document.activeElement` reports the host for anything inside the overlay,
  // so the opener has to be read through the root to be restorable.
  const trap: Trap = { shell, opener: overlayActiveElement() ?? document.activeElement };
  stack.push(trap);
  if (stack.length === 1) listen(true);

  if (opts.initial !== null) {
    const target = opts.initial ?? focusablesIn(shell)[0] ?? shell;
    target.focus();
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const i = stack.indexOf(trap);
    if (i >= 0) stack.splice(i, 1);
    if (stack.length === 0) listen(false);
    const opener = trap.opener;
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  };
}

