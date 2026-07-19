/**
 * Minimal syntax tokenizer for the source-peek panel. Pure string→token logic,
 * no DOM (peek.ts renders tokens to styled spans) — keep it that way so it
 * stays unit-testable like markdown.ts.
 *
 * This is a readability aid, not a grammar: one lexer covers the mix that
 * appears in editable files (.astro markup + frontmatter JS, .md/.mdx, YAML)
 * well enough to tell comments, strings, tags, and keywords apart. Anything it
 * doesn't recognize stays plain text — a wrong guess renders as uncolored
 * code, never as wrong code.
 */

export type TokenKind =
  | 'plain'
  | 'comment'
  | 'string'
  | 'tag'
  | 'attr'
  | 'keyword'
  | 'number'
  | 'fence'; // the `---` frontmatter delimiter line

export interface Token {
  text: string;
  kind: TokenKind;
}

const KEYWORDS = new Set([
  'import', 'export', 'from', 'const', 'let', 'var', 'function', 'return',
  'if', 'else', 'for', 'of', 'in', 'await', 'async', 'new', 'class',
  'extends', 'interface', 'type', 'typeof', 'true', 'false', 'null',
  'undefined',
]);

const STRING_RE = /^("(?:[^"\\]|\\.)*(?:"|$)|'(?:[^'\\]|\\.)*(?:'|$)|`(?:[^`\\]|\\.)*(?:`|$))/;
const TAG_RE = /^<\/?[a-zA-Z][\w.:-]*/;
const IDENT_RE = /^[A-Za-z_$][\w$-]*/;
const NUMBER_RE = /^\d+(?:\.\d+)?/;
const BLOCK_COMMENT_RE = /^\/\*.*?(?:\*\/|$)/;

/**
 * Tokenize a window of source lines. Lines are processed in order because one
 * bit of state crosses them: an unclosed `<!--` comment colors the following
 * lines until its `-->`. (JS block comments are not carried across lines —
 * they are rare in the files we peek at, and a miss degrades to plain text.)
 */
export function tokenizeLines(lines: string[]): Token[][] {
  let inHtmlComment = false;
  return lines.map((line) => {
    const tokens: Token[] = [];
    let plain = '';
    const flushPlain = (): void => {
      if (plain) {
        tokens.push({ text: plain, kind: 'plain' });
        plain = '';
      }
    };
    const push = (text: string, kind: TokenKind): void => {
      flushPlain();
      tokens.push({ text, kind });
    };

    // The frontmatter fence is a whole-line affair.
    if (!inHtmlComment && line.trim() === '---') {
      return [{ text: line, kind: 'fence' }];
    }

    let i = 0;
    while (i < line.length) {
      const rest = line.slice(i);

      if (inHtmlComment) {
        const end = rest.indexOf('-->');
        const text = end === -1 ? rest : rest.slice(0, end + 3);
        if (end !== -1) inHtmlComment = false;
        push(text, 'comment');
        i += text.length;
        continue;
      }

      if (rest.startsWith('<!--')) {
        const end = rest.indexOf('-->', 4);
        const text = end === -1 ? rest : rest.slice(0, end + 3);
        if (end === -1) inHtmlComment = true;
        push(text, 'comment');
        i += text.length;
        continue;
      }

      // `//` comments only at line start or after whitespace, so URLs
      // (`https://…`) in prose or attributes stay plain.
      if (rest.startsWith('//') && (i === 0 || /\s/.test(line[i - 1] ?? ''))) {
        push(rest, 'comment');
        break;
      }

      let m = BLOCK_COMMENT_RE.exec(rest);
      if (m) {
        push(m[0], 'comment');
        i += m[0].length;
        continue;
      }

      // An apostrophe right after a word char is prose ("it's"), not a string
      // opener — without this, half the line in a .md peek turns green.
      const proseApostrophe = rest[0] === "'" && i > 0 && /\w/.test(line[i - 1] ?? '');
      m = proseApostrophe ? null : STRING_RE.exec(rest);
      if (m) {
        push(m[0], 'string');
        i += m[0].length;
        continue;
      }

      m = TAG_RE.exec(rest);
      if (m) {
        push(m[0], 'tag');
        i += m[0].length;
        continue;
      }

      // Consume identifiers whole, so keywords/numbers can't match mid-word
      // (`h1` is a tag name fragment, not `h` + number `1`).
      m = IDENT_RE.exec(rest);
      if (m) {
        const word = m[0];
        if (line[i + word.length] === '=') push(word, 'attr');
        else if (KEYWORDS.has(word)) push(word, 'keyword');
        else plain += word;
        i += word.length;
        continue;
      }

      m = NUMBER_RE.exec(rest);
      if (m) {
        push(m[0], 'number');
        i += m[0].length;
        continue;
      }

      plain += line[i];
      i += 1;
    }
    flushPlain();
    return tokens;
  });
}
