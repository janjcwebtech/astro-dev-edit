/**
 * The markup popup's tag palette, and the pure text/caret math behind it.
 *
 * Separated from `markup.ts` so the wrapping and caret rules — the part with
 * off-by-ones in it — can be unit-tested without a DOM. Nothing here touches
 * the document; `markup.ts` applies the result to its textarea.
 */

export interface TagSpec {
  tag: string;
  /** Never closes — inserted alone, never wrapping. */
  isVoid?: boolean;
  /** Attribute pre-filled on insert, with the caret left inside its quotes. */
  attr?: string;
}

/**
 * The tags the palette offers. Kept in step with `INLINE_TAGS` in
 * `src/patcher/astro.ts`, which is the authority: drift here shows up as a
 * refusal on save, never as a bad write.
 */
export const TAGS: TagSpec[] = [
  { tag: 'br', isVoid: true },
  { tag: 'strong' },
  { tag: 'em' },
  { tag: 'b' },
  { tag: 'i' },
  { tag: 'u' },
  { tag: 'a', attr: 'href=""' },
  { tag: 'span' },
  { tag: 'code' },
  { tag: 'small' },
  { tag: 'sup' },
  { tag: 'sub' },
];

export interface Insertion {
  /** Text to put in place of [start, end). */
  text: string;
  /** Selection to leave behind, as offsets from `start`. */
  caretFrom: number;
  caretTo: number;
}

/**
 * What inserting `spec` should do to `selected` — the text currently
 * highlighted in the popup, empty when the caret is just sitting somewhere.
 *
 * - A void tag is inserted at the caret and replaces any selection.
 * - A pair with a selection wraps it and *keeps it selected*, so tags can be
 *   stacked without re-selecting (`<em>` then `<strong>`).
 * - A pair with no selection leaves the caret between the two halves.
 * - A tag with a pre-filled attribute (`<a href="">`) always leaves the caret
 *   inside the quotes instead, since the URL is the next thing to type.
 */
export function tagInsertion(selected: string, spec: TagSpec): Insertion {
  if (spec.isVoid) {
    const text = `<${spec.tag}>`;
    return { text, caretFrom: text.length, caretTo: text.length };
  }

  const open = spec.attr ? `<${spec.tag} ${spec.attr}>` : `<${spec.tag}>`;
  const text = `${open}${selected}</${spec.tag}>`;

  if (spec.attr) {
    const inQuotes = open.length - 2;
    return { text, caretFrom: inQuotes, caretTo: inQuotes };
  }
  if (selected) {
    return { text, caretFrom: open.length, caretTo: open.length + selected.length };
  }
  return { text, caretFrom: open.length, caretTo: open.length };
}
