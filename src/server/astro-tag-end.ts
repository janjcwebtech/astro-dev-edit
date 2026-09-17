/** The compiler supplies expression text, so no second JS lexer is needed
 * to skip braces, regexes, templates or nested tags inside attributes. */
export interface TagAttribute {
  name: string;
  kind: string;
  value?: string;
  raw?: string;
  position?: { start: { line: number; column: number } };
}

/** Where one attribute's **value text** sits in the source, and where the
 *  attribute as a whole ends.
 *
 *  `start`/`end` bound exactly the text `usage-parse.ts` reports as the prop's
 *  `source` — the quotes included for a quoted attribute, the braces excluded
 *  for an expression — so `source.slice(start, end)` round-trips, the same
 *  invariant `UsageSlot` holds. `after` is where the next attribute may begin,
 *  which is what walking the tag needs. */
export interface AttrSpan {
  start: number;
  end: number;
  after: number;
}

/** Line-start offsets, so a compiler position becomes an index. */
function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  return starts;
}

/**
 * The span of one attribute's value, or null when the source does not read
 * back the way the AST describes it.
 *
 * **Refuses rather than guesses.** Every step is checked against the bytes —
 * the name where the position says it is, the `=` after it, the value text
 * exactly as the compiler reported it. A mismatch means the offsets and the
 * source disagree, and a byte range derived from that would patch the wrong
 * place; `null` sends the caller to a named refusal instead.
 */
export function attrSpan(source: string, attr: TagAttribute, starts = lineStarts(source)): AttrSpan | null {
  const pos = attr.position?.start;
  if (!pos) return null;
  let cursor = starts[pos.line - 1] + pos.column - 1;
  if (source.slice(cursor, cursor + attr.name.length) !== attr.name) return null;

  // A spread or shorthand is `{name}`: the parser points at the expression, so
  // the value *is* the name and the closing brace follows it.
  if (attr.kind === 'spread' || attr.kind === 'shorthand') {
    const end = cursor + attr.name.length;
    if (source[end] !== '}') return null;
    return { start: cursor, end, after: end + 1 };
  }

  const nameStart = cursor;
  cursor += attr.name.length;
  // A bare boolean attribute is its own value.
  if (attr.kind === 'empty') return { start: nameStart, end: cursor, after: cursor };

  const equals = /^\s*=\s*/.exec(source.slice(cursor));
  if (!equals) return null;
  cursor += equals[0].length;
  // An expression's value text sits inside braces the compiler strips; a
  // quoted attribute's `raw` carries its own quotes.
  const value = attr.kind === 'expression' ? attr.value ?? '' : attr.raw;
  if (value === undefined) return null;
  const opened = attr.kind === 'expression' ? 1 : 0;
  if (opened && source[cursor] !== '{') return null;
  const start = cursor + opened;
  if (!source.startsWith(value, start)) return null;
  const end = start + value.length;
  if (opened && source[end] !== '}') return null;
  return { start, end, after: end + opened };
}

export function tagEnd(source: string, offset: number, name: string, attrs: readonly TagAttribute[]): { insert: number; end: number } | null {
  const last = attrs.at(-1);
  let cursor = offset + name.length + 1;
  if (last) {
    const span = attrSpan(source, last);
    if (!span) return null;
    cursor = span.after;
  }
  const close = /^(\s*)(\/?)>/.exec(source.slice(cursor));
  return close ? { insert: cursor + close[1].length, end: cursor + close[0].length } : null;
}
