import type { SourceLoc } from '../../shared/protocol.ts';
import * as api from '../api.ts';
import { clearHighlight } from '../hover.ts';
import * as state from '../state.ts';
import {
  COLOR,
  INPUT_STYLE,
  basename,
  buildBackdrop,
  buildPanel,
  lockElement,
  styled,
  toast,
  wirePanelButtons,
} from '../ui.ts';
import { TAGS, type TagSpec, tagInsertion } from './markup-insert.ts';

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

export function beginMarkupEdit(el: HTMLElement, src: SourceLoc, html: string): void {
  clearHighlight();

  const panel = buildPanel(`Markup · ${basename(src.file)}:${src.loc}`);
  const body = panel.querySelector('[data-body]') as HTMLElement;

  const label = styled('label', 'atx-markup-label', {
    display: 'block', font: '600 12px system-ui', marginBottom: '4px', opacity: '0.8',
  });
  label.textContent = `Source of <${el.tagName.toLowerCase()}>`;

  const input = styled('textarea', 'atx-markup-input', {
    ...INPUT_STYLE,
    width: '100%', minHeight: '120px', boxSizing: 'border-box', resize: 'vertical',
    font: '12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'pre-wrap',
  });
  input.value = html;

  const tools = styled('div', 'atx-markup-tags', {
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px', marginTop: '8px',
  });
  const hint = styled('span', 'atx-markup-hint', {
    font: '11px/1.5 system-ui', color: COLOR.muted, marginRight: '2px',
  });
  hint.textContent = HINT;
  tools.append(hint);

  const markDirty = (): void => {
    state.setSavePhase(input.value.trim() === html.trim() ? 'clean' : 'dirty');
  };

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

  // A refusal is an ordinary outcome here — typing a `<div>` earns one — so it
  // is reported *in* the panel, next to the markup that caused it.
  const error = styled('p', 'atx-markup-error', {
    display: 'none', margin: '10px 0 0', font: '12px/1.5 system-ui', color: COLOR.err,
  });

  body.append(label, input, tools, error);

  let token = state.begin({ kind: 'panel', close: () => close(false) });
  let saving = false;

  const teardown = (): void => {
    state.releaseIf(token);
    panel.remove();
    backdrop.remove();
  };

  const setBusy = (busy: boolean): void => {
    for (const btn of panel.querySelectorAll('button')) btn.disabled = busy;
    input.readOnly = busy;
  };

  /**
   * Save without closing first. The panel only comes down once the write has
   * landed: a refusal (disallowed tag, unbalanced markup, stale source) is
   * something you fix and retry, and closing would take the markup you typed
   * with it.
   */
  const save = async (): Promise<void> => {
    saving = true;
    setBusy(true);
    error.style.display = 'none';

    const failure = await commitMarkupEdit(el, src, html, input.value);

    saving = false;
    if (!failure) {
      teardown();
      return;
    }
    // The in-flight `busy` interaction has released the slot; re-claim it so
    // the still-open panel keeps owning the page's clicks.
    token = state.begin({ kind: 'panel', close: () => close(false) });
    setBusy(false);
    error.textContent = failure;
    error.style.display = '';
    input.focus();
  };

  const close = (commit: boolean): void => {
    if (saving) return; // the write is in flight; let it settle
    if (!commit || input.value.trim() === html.trim()) {
      teardown();
      state.setSavePhase('clean');
      return;
    }
    void save();
  };

  const backdrop = buildBackdrop(() => close(false));
  wirePanelButtons(panel, () => close(false), () => close(true));

  // A panel owns its Save button, so Enter must stay a newline; Cmd/Ctrl+Enter
  // is the keyboard commit, matching the drawer's body editor.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      close(true);
    }
  });
  input.addEventListener('input', markDirty);

  document.body.append(backdrop, panel);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

/** Writes the edit. Resolves to null on success, or the refusal message —
 *  which the caller shows in the panel it deliberately left open. */
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
