import type { PeekResponse, SourceLoc } from '../../shared/protocol.ts';
import * as api from '../api.ts';
import { tokenizeLines, type TokenKind } from '../highlight.ts';
import { clearHighlight } from '../hover.ts';
import * as state from '../state.ts';
import { COLOR, FONT, basename, buildBackdrop, buildPanel, footButton, hexToRgba, styled } from '../ui.ts';

/**
 * Source-peek panel: a read-only, syntax-tinted view of the source file,
 * scrolled to the element's line — "what does this element look like in the
 * file?" without leaving the browser. The /peek endpoint sends the whole file
 * (a "⋯ N more lines" marker appears only when its huge-file cap trimmed the
 * ends), so full context is a scroll away. Opened from the hover pill's
 * file:loc label and the refusal notice's location line; the "Open in editor"
 * button in its footer is the jump-out.
 */

/** Token colors on the panel's dark background. Chosen for contrast, not to
 *  mimic any one editor theme. */
const TOKEN_COLOR: Record<TokenKind, string> = {
  plain: '#e2e2ef',
  comment: '#8b94a7',
  string: '#a5d6a7',
  tag: '#82b1ff',
  attr: '#c9a7ff',
  keyword: '#ff8a9e',
  number: '#f5c27a',
  fence: '#8b94a7',
};

const CODE_BG = '#12121d';
const FOCUS_BG = hexToRgba(COLOR.accent, 0.16);

/** A muted "⋯ N more lines" marker row for content the huge-file cap cut. */
function moreRow(count: number, where: 'above' | 'below'): HTMLElement {
  const row = styled('div', 'atx-peek-more', {
    padding: '4px 12px 4px 15px',
    color: '#666',
    fontStyle: 'italic',
    userSelect: 'none',
  });
  row.textContent = `⋯ ${count} more line${count === 1 ? '' : 's'} ${where}`;
  return row;
}

/** Render the fetched lines as gutter-numbered, token-tinted rows. Returns
 *  the scroll container and the focused row (for centering). */
function renderCode(peeked: PeekResponse): { container: HTMLElement; focusRow: HTMLElement | null } {
  const container = styled('div', 'atx-peek-code', {
    maxHeight: '65vh',
    overflow: 'auto',
    background: CODE_BG,
    font: `12.5px/1.65 ${FONT.mono}`,
    padding: '8px 0',
  });

  const gutterWidth = `${String(peeked.startLine + peeked.lines.length - 1).length + 1}ch`;
  const tokenized = tokenizeLines(peeked.lines);
  let focusRow: HTMLElement | null = null;

  if (peeked.startLine > 1) container.append(moreRow(peeked.startLine - 1, 'above'));

  tokenized.forEach((tokens, idx) => {
    const lineNo = peeked.startLine + idx;
    const isFocus = lineNo === peeked.focusLine;
    const row = styled('div', `atx-peek-line${isFocus ? ' atx-peek-focus' : ''}`, {
      display: 'flex',
      // Every row carries the border so the gutter stays aligned; only the
      // focus row's is visible.
      borderLeft: `3px solid ${isFocus ? COLOR.accent : 'transparent'}`,
      background: isFocus ? FOCUS_BG : 'transparent',
    });
    const gutter = styled('span', 'atx-peek-gutter', {
      flex: '0 0 auto',
      width: gutterWidth,
      padding: '0 12px 0 0',
      textAlign: 'right',
      color: isFocus ? '#bda9ff' : '#5a5a72',
      userSelect: 'none',
    });
    gutter.textContent = String(lineNo);
    const code = styled('span', 'atx-peek-text', {
      flex: '1 1 auto',
      whiteSpace: 'pre',
      paddingRight: '16px',
      tabSize: '2',
    });
    for (const token of tokens) {
      const span = styled('span', '', { color: TOKEN_COLOR[token.kind] });
      if (token.kind === 'comment') span.style.fontStyle = 'italic';
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

/** Open the peek panel for a source loc. `openSource` powers the footer's
 *  "Open in editor" jump-out. */
export function openPeekPanel(src: SourceLoc, openSource: (src: SourceLoc) => void): void {
  clearHighlight();
  const panel = buildPanel(`${basename(src.file)}:${src.loc}`);
  // Code wants room: much wider than the default 420px panel, and the code
  // area runs edge-to-edge (its own padding) instead of the body's 16px.
  panel.style.width = 'min(780px, 94vw)';
  const body = panel.querySelector('[data-body]') as HTMLElement;
  body.style.padding = '0';

  const loading = styled('div', 'atx-peek-loading', {
    padding: '24px 16px',
    color: '#999',
    font: `12.5px ${FONT.mono}`,
    background: CODE_BG,
  });
  loading.textContent = 'Loading source…';
  body.append(loading);

  let closed = false;
  const close = (): void => {
    closed = true;
    state.releaseIf(token);
    panel.remove();
    backdrop.remove();
  };
  const backdrop = buildBackdrop(close);
  const token = state.begin({ kind: 'panel', close });

  const foot = panel.querySelector('[data-foot]') as HTMLElement;
  foot.append(
    footButton('Close', 'cancel', close),
    footButton('Open in editor', 'primary', () => {
      close();
      openSource(src);
    }),
  );

  document.body.append(backdrop, panel);

  void (async () => {
    try {
      const peeked = await api.peek({ file: src.file, loc: src.loc });
      if (closed) return;
      // Not an error: the file is real but package-owned or out of the content
      // roots, so the server explains instead of returning source. Show the
      // sentence rather than an empty code pane. (Reached by clicking the
      // hover pill on an `astro:assets` <Image>.)
      if (peeked.refused) {
        loading.textContent = peeked.refused;
        loading.style.color = COLOR.warn;
        loading.style.lineHeight = '1.6';
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
      if (closed) return;
      loading.textContent = `Could not load source — ${err instanceof Error ? err.message : 'unknown error'}`;
      loading.style.color = '#ff8a80';
    }
  })();
}
