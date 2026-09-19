import type { PeekResponse, SourceLoc } from '../../shared/protocol.ts';
import * as api from '../api.ts';
import { tokenizeLines } from '../highlight.ts';
import { clearHighlight } from '../hover.ts';
import { trapFocus } from '../focus.ts';
import * as state from '../state.ts';
import { basename, buildBackdrop, buildPanel, footButton, isolateScroll, styled } from '../ui.ts';
import { mount } from '../shadow.ts';
import { has } from '../features.ts';

/**
 * Source-peek panel: a read-only, syntax-tinted view of the source file,
 * scrolled to the element's line — "what does this element look like in the
 * file?" without leaving the browser. The /peek endpoint sends the whole file
 * (a "⋯ N more lines" marker appears only when its huge-file cap trimmed the
 * ends), so full context is a scroll away. Opened from the hover pill's
 * file:loc label and the refusal notice's location line; the "Open in editor"
 * button in its footer is the jump-out.
 *
 * One renderer, two destinations. {@link fillWithSource} is the whole of
 * "fetch a loc and draw it"; this file spends it on a centred modal, and
 * dock.ts spends it on the docked layout's bottom pane. Every "view code"
 * caller still just asks for a file and a line — the door is the same door,
 * and only the room behind it changes.
 */

/** A muted "⋯ N more lines" marker row for content the huge-file cap cut. */
function moreRow(count: number, where: 'above' | 'below'): HTMLElement {
  const row = styled('div', 'atx-peek-more');
  row.textContent = `⋯ ${count} more line${count === 1 ? '' : 's'} ${where}`;
  return row;
}

/** Render the fetched lines as gutter-numbered, token-tinted rows. Returns
 *  the scroll container and the focused row (for centering). */
function renderCode(peeked: PeekResponse): { container: HTMLElement; focusRow: HTMLElement | null } {
  const container = styled('div', 'atx-peek-code');
  // The peek is the tallest scroller in the overlay and the one most likely to
  // be opened on a page driving its own scroll (Lenis and friends).
  isolateScroll(container);

  const gutterWidth = `${String(peeked.startLine + peeked.lines.length - 1).length + 1}ch`;
  const tokenized = tokenizeLines(peeked.lines);
  let focusRow: HTMLElement | null = null;

  if (peeked.startLine > 1) container.append(moreRow(peeked.startLine - 1, 'above'));

  tokenized.forEach((tokens, idx) => {
    const lineNo = peeked.startLine + idx;
    const isFocus = lineNo === peeked.focusLine;
    const row = styled('div', `atx-peek-line${isFocus ? ' atx-peek-focus' : ''}`);
    // The gutter's width is the widest line number in this file, so it is the
    // one thing about a row a stylesheet cannot know.
    const gutter = styled('span', 'atx-peek-gutter', { width: gutterWidth });
    gutter.textContent = String(lineNo);
    const code = styled('span', 'atx-peek-text');
    for (const token of tokens) {
      const span = styled('span', 'atx-peek-token');
      span.dataset.token = token.kind;
      span.textContent = token.text;
      code.append(span);
    }
    if (tokens.length === 0) code.textContent = ' '; // keep empty lines their height
    row.append(gutter, code);
    container.append(row);
    if (isFocus) focusRow = row;
  });

  const below = peeked.totalLines - (peeked.startLine + peeked.lines.length - 1);
  if (below > 0) container.append(moreRow(below, 'below'));

  return { container, focusRow };
}

/**
 * Fetch `src` and render it into `host`, replacing whatever it holds.
 *
 * `alive` is asked before every paint: a peek outlives its request, and a
 * destination that has been closed, or moved on to another file, must not have
 * a late answer land in it.
 */
export function fillWithSource(host: HTMLElement, src: SourceLoc, alive: () => boolean): void {
  const loading = styled('div', 'atx-peek-loading');
  loading.textContent = 'Loading source…';
  host.replaceChildren(loading);

  void (async () => {
    try {
      const peeked = await api.peek({ file: src.file, loc: src.loc });
      if (!alive()) return;
      // Not an error: the file is real but package-owned or out of the content
      // roots, so the server explains instead of returning source. Show the
      // sentence rather than an empty code pane. (Reached by clicking the
      // hover pill on an `astro:assets` <Image>.)
      if (peeked.refused) {
        loading.textContent = peeked.refused;
        loading.dataset.tone = 'warn';
        return;
      }
      const { container, focusRow } = renderCode(peeked);
      loading.replaceWith(container);
      // Center the focused line in the scroll window once it has a layout.
      if (focusRow) {
        requestAnimationFrame(() => {
          container.scrollTop =
            focusRow.offsetTop - container.clientHeight / 2 + focusRow.clientHeight / 2;
        });
      }
    } catch (err) {
      if (!alive()) return;
      loading.textContent = `Could not load source — ${err instanceof Error ? err.message : 'unknown error'}`;
      loading.dataset.tone = 'err';
    }
  })();
}

/**
 * The modal peek on screen, if there is one.
 *
 * Switching to the docked layout carries an open peek into the dock rather
 * than leaving a modal floating over a page that has just moved out from under
 * it — so the switch needs to be able to both read it and close it.
 */
let openModal: { src: SourceLoc; openSource: (src: SourceLoc) => void; close(): void } | null = null;

/** Close the modal peek and report what it was showing. Null if the thing on
 *  screen is not a peek. */
export function takeOpenPeek(): { src: SourceLoc; openSource: (src: SourceLoc) => void } | null {
  const was = openModal;
  was?.close();
  return was;
}

/** Open the peek panel for a source loc. `openSource` powers the footer's
 *  "Open in editor" jump-out. */
export function openPeekPanel(src: SourceLoc, openSource: (src: SourceLoc) => void): void {
  clearHighlight();
  // Code wants room: much wider than the default 420px panel, and the code
  // area runs edge-to-edge (its own padding) instead of the body's 16px.
  const panel = buildPanel(`${basename(src.file)}:${src.loc}`, undefined, {
    width: 'min(780px, 94vw)',
  });
  const body = panel.querySelector('[data-body]') as HTMLElement;
  body.toggleAttribute('data-flush', true);

  let closed = false;
  const close = (): void => {
    closed = true;
    if (openModal?.close === close) openModal = null;
    state.releaseIf(token);
    releaseFocus();
    panel.remove();
    backdrop.remove();
  };
  const backdrop = buildBackdrop(close);
  const token = state.begin({ kind: 'panel', close });

  const foot = panel.querySelector('[data-foot]') as HTMLElement;
  foot.append(
    footButton('Close', 'outline', close),
    ...(has('openInEditor') ? [footButton('Open in editor', 'default', () => {
      close();
      openSource(src);
    })] : []),
  );

  mount(backdrop, panel);
  const releaseFocus = trapFocus(panel);
  openModal = { src, openSource, close };
  fillWithSource(body, src, () => !closed);
}
