/**
 * Best-effort selector → source line resolver for the CSS inspector's
 * "open in editor" jump. Pure string-in/(line,col)-out — no fs, no deps — so it
 * unit-tests like a patcher.
 *
 * The CSSOM the client reads exposes a rule's declarations but not its source
 * position, so this scans the file text for the selector fragment. It's
 * deliberately approximate: it finds the *first* place the class/id token
 * appears as a selector and returns that line. A miss returns null (the caller
 * opens the file at its top). For .astro files the search is confined to
 * <style> blocks, so a selector like `.hero-title` isn't matched against a
 * class attribute in the markup.
 */

export interface LineCol {
  /** 1-based line number. */
  line: number;
  /** 1-based column. */
  col: number;
}

/** A [start, end) offset range within the source. */
interface Range {
  start: number;
  end: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Content ranges of every <style>…</style> block (the text between the tags). */
function styleRanges(source: string): Range[] {
  const ranges: Range[] = [];
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  for (const m of source.matchAll(re)) {
    const openEnd = m.index + m[0].indexOf('>') + 1;
    ranges.push({ start: openEnd, end: openEnd + m[1].length });
  }
  return ranges;
}

function offsetToLineCol(source: string, offset: number): LineCol {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (source.charCodeAt(i) === 10 /* \n */) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, col: offset - lineStart + 1 };
}

/**
 * Locate the earliest occurrence of `selector` (a fragment like ".hero-title"
 * or "#masthead") used as a selector token. `isAstro` confines the search to
 * <style> blocks. Returns the 1-based line/col, or null when not found.
 */
export function locateSelector(
  source: string,
  selector: string,
  isAstro: boolean,
): LineCol | null {
  if (!selector) return null;
  // The fragment already carries its leading "." / "#". The negative lookahead
  // keeps ".hero-title" from matching ".hero-titles" (an identifier char or "-"
  // following the token means it's a longer name).
  const re = new RegExp(escapeRegExp(selector) + '(?![\\w-])');
  const ranges: Range[] = isAstro ? styleRanges(source) : [{ start: 0, end: source.length }];

  let best: number | null = null;
  for (const { start, end } of ranges) {
    const m = re.exec(source.slice(start, end));
    if (m) {
      const idx = start + m.index;
      if (best === null || idx < best) best = idx;
    }
  }
  return best === null ? null : offsetToLineCol(source, best);
}
