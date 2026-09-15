/** The compiler supplies expression text, so no second JS lexer is needed
 * to skip braces, regexes, templates or nested tags inside attributes. */
export interface TagAttribute {
  name: string;
  kind: string;
  value?: string;
  raw?: string;
  position?: { start: { line: number; column: number } };
}

export function tagEnd(source: string, offset: number, name: string, attrs: readonly TagAttribute[]): { insert: number; end: number } | null {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  const last = attrs.at(-1);
  let cursor = offset + name.length + 1;
  if (last) {
    if (!last.position) return null;
    const pos = last.position.start;
    cursor = starts[pos.line - 1] + pos.column - 1;
    if (last.kind === 'spread' || last.kind === 'shorthand') {
      // The parser points at the expression, not the opening brace.
      if (source.slice(cursor, cursor + last.name.length) !== last.name) return null;
      cursor += last.name.length;
      if (source[cursor] !== '}') return null;
      cursor++;
    } else {
      if (source.slice(cursor, cursor + last.name.length) !== last.name) return null;
      cursor += last.name.length;
      if (last.kind !== 'empty') {
        const equals = /^\s*=\s*/.exec(source.slice(cursor));
        if (!equals) return null;
        cursor += equals[0].length;
        const value = last.kind === 'expression' ? `{${last.value ?? ''}}` : last.raw;
        if (!value || !source.startsWith(value, cursor)) return null;
        cursor += value.length;
      }
    }
  }
  const close = /^(\s*)(\/?)>/.exec(source.slice(cursor));
  return close ? { insert: cursor + close[1].length, end: cursor + close[0].length } : null;
}
