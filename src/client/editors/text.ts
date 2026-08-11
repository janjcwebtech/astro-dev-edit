import type { SourceLoc } from '../../shared/protocol.ts';
import * as api from '../api.ts';
import { clearHighlight } from '../hover.ts';
import * as state from '../state.ts';
import { COLOR, basename, lockElement, toast } from '../ui.ts';

/**
 * Inline text editing: the clicked element becomes contenteditable in place.
 * Enter/blur commits, Esc cancels (restoring the original exactly). Commits
 * POST /apply; the server verifies the source still matches what the page
 * showed before writing. (spec §5, §6.1)
 */

export function beginTextEdit(el: HTMLElement, src: SourceLoc): void {
  clearHighlight();
  const original = el.textContent ?? '';

  el.setAttribute('contenteditable', 'plaintext-only');
  el.dataset.astroTextEditActive = '1';
  el.style.outline = `2px solid ${COLOR.accent}`;
  el.style.outlineOffset = '2px';
  el.style.borderRadius = '2px';
  el.focus();

  // Select all so a full retype is one gesture.
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);

  const finish = (commit: boolean): void => {
    state.releaseIf(token);
    el.removeEventListener('keydown', onKey);
    el.removeEventListener('blur', onBlur);
    el.removeEventListener('input', onInput);
    el.removeAttribute('contenteditable');
    delete el.dataset.astroTextEditActive;
    el.style.outline = '';
    el.style.outlineOffset = '';

    const next = el.textContent ?? '';
    if (!commit || next === original) {
      el.textContent = original; // cancel / no-op restores exactly
      state.setSavePhase('clean'); // nothing is pending — the bar can say so
      return;
    }
    void commitTextEdit(el, src, original, next);
  };
  const token = state.begin({ kind: 'text', finish });

  // Feeds the admin bar's exit button: unsaved keystrokes make it say
  // "Save & exit". Typing the original text back is not a change.
  const onInput = (): void => {
    state.setSavePhase((el.textContent ?? '') === original ? 'clean' : 'dirty');
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  };
  const onBlur = (): void => finish(true);

  el.addEventListener('keydown', onKey);
  el.addEventListener('input', onInput);
  el.addEventListener('blur', onBlur, { once: true });
}

async function commitTextEdit(
  el: HTMLElement,
  src: SourceLoc,
  original: string,
  newText: string,
): Promise<void> {
  // Hold the slot as busy while the save is in flight; releaseIf() means a
  // click that already re-targeted (and began a new interaction) wins.
  const busy = state.begin({ kind: 'busy' });
  const release = lockElement(el);
  state.setSavePhase('saving');
  try {
    await api.apply({
      file: src.file,
      loc: src.loc,
      tag: el.tagName.toLowerCase(),
      ops: [{ targetType: 'text', original, newText }],
    });
    state.setSavePhase('saved');
    toast(`Saved — ${basename(src.file)}:${src.loc}`, 'ok');
    // The file is written; Astro HMR reloads the page from disk.
  } catch (err) {
    el.textContent = original;
    // The change was rolled back, so nothing is pending — but the failure must
    // stay visible on the bar rather than reading as "all saved".
    state.setSavePhase('error');
    toast(`Save failed — ${err instanceof Error ? err.message : 'unknown error'}`, 'err');
  } finally {
    release();
    state.releaseIf(busy);
  }
}
