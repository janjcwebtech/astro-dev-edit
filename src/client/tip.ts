import { styled } from './ui.ts';

/**
 * The overlay's own tooltip — one element, shared by everything that needs to
 * say a little more than fits.
 *
 * Not the browser's `title`, for three reasons the element tree made
 * intolerable and the inspector inherits: a native tooltip waits about a
 * second, refuses to re-arm while the pointer sweeps between near-identical
 * siblings, and renders in the platform's chrome rather than the tool's.
 *
 * **Above the anchor, never below.** The pointer is on the anchor, and a
 * surface this dense would otherwise cover what the reader is moving towards.
 * Below is the fallback for an anchor too near the top of the viewport.
 *
 * A singleton because two tooltips can never be wanted at once: the pointer is
 * in one place. Whoever mounts the overlay mounts {@link tip}.root; it is
 * `position: fixed`, so no scroll container can clip it.
 */

/** Grace after a hide during which the next anchor shows instantly. Sweeping a
 *  list must not re-serve the opening delay on every row. */
const GRACE = 400;
/** Long enough that crossing an anchor on the way somewhere else shows nothing. */
const DELAY = 130;
const GAP = 6;
/** Keep-clear margin against the viewport edges. */
const EDGE = 4;

const root = styled('div', 'atx-tip');
const head = styled('div', 'atx-tip-head');
const note = styled('div', 'atx-tip-note');
root.append(head, note);

let timer: number | null = null;
let hiddenAt = 0;

function paint(anchor: HTMLElement, title: string, detail: string | null): void {
  head.textContent = title;
  head.hidden = !title;
  note.textContent = detail ?? '';
  note.hidden = !detail;
  root.setAttribute('data-on', '');
  // Measured after the content is in: the note is a second line on some
  // anchors and not on others, so the height is not knowable up front.
  const rect = anchor.getBoundingClientRect();
  const height = root.offsetHeight;
  const above = rect.top - height - GAP;
  root.style.top = `${above >= EDGE ? above
    : Math.min(rect.bottom + GAP, innerHeight - height - EDGE)}px`;
  root.style.left = `${Math.max(EDGE, Math.min(rect.left + 6, innerWidth - root.offsetWidth - EDGE))}px`;
}

export const tip = {
  /** Appended to the shadow root at boot, beside the other singletons. */
  root,

  /**
   * Show it against `anchor`. `title` is the strong first line — a file:line,
   * a verb — and `detail` the muted second, for the sentence that did not fit.
   */
  show(anchor: HTMLElement, title: string, detail: string | null = null): void {
    if (timer !== null) clearTimeout(timer);
    // Already open, or only just closed: moving between anchors is instant.
    if (root.hasAttribute('data-on') || Date.now() - hiddenAt < GRACE) {
      paint(anchor, title, detail);
      return;
    }
    timer = window.setTimeout(() => {
      timer = null;
      paint(anchor, title, detail);
    }, DELAY);
  },

  hide(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (!root.hasAttribute('data-on')) return;
    root.removeAttribute('data-on');
    hiddenAt = Date.now();
  },
};

/**
 * Wire an element to the tooltip for its whole life: hovering or focusing it
 * shows the words, leaving or blurring hides them.
 *
 * The one-line form for a label that is only ever describing itself — an info
 * icon, a chip. Anything whose words change per hover calls {@link tip} itself.
 */
export function describes(anchor: HTMLElement, title: string, detail: string | null = null): HTMLElement {
  anchor.addEventListener('mouseenter', () => tip.show(anchor, title, detail));
  anchor.addEventListener('mouseleave', () => tip.hide());
  anchor.addEventListener('focus', () => tip.show(anchor, title, detail));
  anchor.addEventListener('blur', () => tip.hide());
  return anchor;
}

/** The prose-only form: a sentence in the muted line, with no mono head above
 *  it. What an info icon beside a title is for. */
export function explains(anchor: HTMLElement, sentence: string): HTMLElement {
  return describes(anchor, '', sentence);
}
