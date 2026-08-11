import type { SourceLoc } from '../../shared/protocol.ts';
import * as api from '../api.ts';
import { clearHighlight } from '../hover.ts';
import * as state from '../state.ts';
import { COLOR, basename, lockElement, styled, toast } from '../ui.ts';
import { TAGS, type TagSpec, tagInsertion } from './markup-insert.ts';
import { openSourcePopup } from './source-popup.ts';

/**
 * Markup popup: for text that carries inline formatting (`<br>`, `<strong>`,
 * a link). Inline contenteditable can't serve these — the literal-text path
 * escapes `<`, which would turn the tags into visible punctuation — so the
 * element's *source* is edited as raw text instead, in a deliberately
 * different affordance from inline editing.
 *
 * The value shown is the source region /classify returned, not the DOM's
 * innerHTML: only the source knows how entities and attribute quotes were
 * spelled, and sending it straight back as the apply op's `original` keeps
 * verify-then-patch comparing like with like. The server re-vets every tag and
 * attribute before writing — this panel is an editor, not the gate.
 */

/** The allowed tags are on screen anyway — the server refuses anything outside
 *  the list — so they double as the way to insert them. */
const HINT = 'Insert (wraps the selection):';

/** Replace a range of the textarea, preferring execCommand so the edit joins
 *  the browser's own undo stack; setRangeText is the fallback. */
function replaceRange(input: HTMLTextAreaElement, start: number, end: number, text: string): void {
  input.focus();
  input.setSelectionRange(start, end);
  let inserted = false;
  try {
    inserted = document.execCommand('insertText', false, text);
  } catch {
    inserted = false;
  }
  if (!inserted) input.setRangeText(text, start, end, 'end');
}

/** Insert a tag at the caret, wrapping the selection when there is one. */
function insertTag(input: HTMLTextAreaElement, spec: TagSpec): void {
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const { text, caretFrom, caretTo } = tagInsertion(input.value.slice(start, end), spec);
  replaceRange(input, start, end, text);
  input.setSelectionRange(start + caretFrom, start + caretTo);
}

/** The palette row: one button per allowed tag. */
function buildPalette(input: HTMLTextAreaElement, markDirty: () => void): HTMLElement {
  const tools = styled('div', 'atx-markup-tags', {
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px', marginTop: '8px',
  });
  const hint = styled('span', 'atx-markup-hint', {
    font: '11px/1.5 system-ui', color: COLOR.muted, marginRight: '2px',
  });
  hint.textContent = HINT;
  tools.append(hint);

  for (const spec of TAGS) {
    const btn = styled('button', 'atx-markup-tag', {
      padding: '2px 6px', borderRadius: '4px', cursor: 'pointer',
      border: `1px solid ${COLOR.panelDivider}`, background: '#111', color: '#ddd',
      font: '11px ui-monospace, SFMono-Regular, Menlo, monospace',
    });
    btn.type = 'button';
    btn.textContent = `<${spec.tag}>`;
    btn.title = spec.isVoid
      ? `Insert <${spec.tag}>`
      : `Wrap the selection in <${spec.tag}>…</${spec.tag}>`;
    // Buttons take focus on mousedown, which would collapse the textarea's
    // selection before the click lands — and the selection is what we wrap.
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      insertTag(input, spec);
      markDirty();
    });
    tools.append(btn);
  }
  return tools;
}

export function beginMarkupEdit(el: HTMLElement, src: SourceLoc, html: string): void {
  clearHighlight();
  openSourcePopup({
    title: `Markup · ${basename(src.file)}:${src.loc}`,
    label: `Source of <${el.tagName.toLowerCase()}>`,
    value: html,
    mono: true,
    tools: buildPalette,
    save: (value) => commitMarkupEdit(el, src, html, value),
  });
}

/** Writes the edit. Resolves to null on success, or the refusal message —
 *  which the popup shows in the panel it deliberately left open. */
async function commitMarkupEdit(
  el: HTMLElement,
  src: SourceLoc,
  original: string,
  newHtml: string,
): Promise<string | null> {
  const busy = state.begin({ kind: 'busy' });
  const release = lockElement(el);
  state.setSavePhase('saving');
  try {
    await api.apply({
      file: src.file,
      loc: src.loc,
      tag: el.tagName.toLowerCase(),
      ops: [{ targetType: 'markup', original, newText: newHtml }],
    });
    state.setSavePhase('saved');
    toast(`Saved — ${basename(src.file)}:${src.loc}`, 'ok');
    // The file is written; Astro HMR reloads the page from disk. Nothing is
    // patched into the live DOM here — a markup change can restructure the
    // element's children, and HMR is the one source of truth for that.
    return null;
  } catch (err) {
    state.setSavePhase('error');
    return err instanceof Error ? err.message : 'The edit could not be saved.';
  } finally {
    release();
    state.releaseIf(busy);
  }
}
