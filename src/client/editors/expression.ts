import type { SourceLoc } from '../../shared/protocol.ts';
import * as api from '../api.ts';
import { clearHighlight } from '../hover.ts';
import * as state from '../state.ts';
import { basename, lockElement, toast } from '../ui.ts';
import { openSourcePopup } from './source-popup.ts';

/**
 * Value popup: for text the page renders through an `{expression}` — a
 * frontmatter const, or one item of an array a `.map()` loops over. The words
 * are edited here and written back to that string in the frontmatter; the
 * template itself is never touched.
 *
 * Deliberately a popup rather than inline editing, and deliberately titled
 * with where the value lives (`benefits[].title`): what you are changing is a
 * constant that may be rendered in more than one place, which is worth knowing
 * before you type.
 *
 * **Plain text only, no markup palette.** `{value}` renders escaped in Astro,
 * so a `<br>` typed here would show as visible punctuation rather than a line
 * break. Offering the palette would promise something the template can't do.
 *
 * The text sent is the text the page showed, and for a loop it is the *only*
 * thing that says which item was clicked — every card shares one source loc.
 * Two items reading the same way refuse rather than guess.
 */

export function beginExpressionEdit(
  el: HTMLElement,
  src: SourceLoc,
  info: { property: string; label: string },
  openSource: (src: SourceLoc) => void,
): void {
  clearHighlight();
  const original = el.textContent ?? '';
  openSourcePopup({
    title: `Value · ${info.label}`,
    label: `Text of ${info.property}, in ${basename(src.file)}`,
    value: original,
    minHeight: '90px',
    // The element's own loc: that is where the {expression} sits, which is the
    // way in to both the loop and the const it reads.
    openSource: () => openSource(src),
    save: (value) => commitExpressionEdit(el, src, original, value),
  });
}

/** Writes the edit. Resolves to null on success, or the refusal message. */
async function commitExpressionEdit(
  el: HTMLElement,
  src: SourceLoc,
  original: string,
  newText: string,
): Promise<string | null> {
  const busy = state.begin({ kind: 'busy' });
  const release = lockElement(el);
  state.setSavePhase('saving');
  try {
    await api.apply({
      file: src.file,
      loc: src.loc,
      tag: el.tagName.toLowerCase(),
      ops: [{ targetType: 'expression', original, newText }],
    });
    state.setSavePhase('saved');
    toast(`Saved — ${basename(src.file)}`, 'ok');
    // HMR re-renders from the frontmatter; every place that value appears
    // updates with it, which is exactly why the popup names where it lives.
    return null;
  } catch (err) {
    state.setSavePhase('error');
    return err instanceof Error ? err.message : 'The edit could not be saved.';
  } finally {
    release();
    state.releaseIf(busy);
  }
}
