import { resolveElement, type AstNode } from '../patcher/astro.ts';
import { propBinding, readLiteral } from '../patcher/expression-trace.ts';
import type { VariableTagRefusal } from '../shared/protocol.ts';

/**
 * Locators for the inspector: where on disk something the panel shows is
 * written. Pure, string in and answer out, no fs, so both unit-test like a
 * patcher. The two have opposite tempers:
 *
 * - {@link locateSelector} is **best-effort**. The CSSOM gives a rule's
 *   declarations but not its position, so it scans the file for the selector
 *   and a miss opens the file at its top.
 * - {@link resolveVariableTag} is a **proof**. It names a source for an
 *   element nothing annotates, so it refuses whatever it cannot show.
 */

// ---------------------------------------------------------------------------
// CSS selectors
// ---------------------------------------------------------------------------

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
 * <style> blocks, so `.hero-title` never matches a class attribute in the
 * markup. Returns the 1-based line/col, or null when not found.
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

// ---------------------------------------------------------------------------
// Variable tags (issue #82)
// ---------------------------------------------------------------------------

/**
 * One token of frontmatter, as much as the binding check needs. `string` is a
 * literal with a known value, a backtick one included when it interpolates
 * nothing. `template` interpolates, so its value is not known.
 */
interface Token {
  kind: 'ident' | 'string' | 'template' | 'number' | 'regex' | 'punct';
  text: string;
  /** The decoded value of a `string`. */
  value?: string;
  /** A line break comes before this token, which is where ASI can end a
   *  statement. */
  nl: boolean;
}

/** Longest first, so `??=` is never read as `??` then `=`. */
const PUNCT = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '++', '--', '+=', '-=', '*=', '/=', '%=',
  '&=', '|=', '^=', '**', '<<', '>>'];
const IDENT_START = /[A-Za-z_$\u0080-\uffff]/;
const IDENT_PART = /[\w$\u0080-\uffff]/;
/** Words after which a `/` starts a regex, not a division. */
const BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete',
  'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

/** Index just past the backtick that closes the template opened at `i`,
 *  stepping over every `${…}` and the strings nested in it. -1 when unclosed. */
function templateEnd(text: string, i: number): number {
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === '\\') j++;
    else if (text[j] === '`') return j + 1;
    else if (text[j] === '$' && text[j + 1] === '{') {
      let depth = 0;
      for (j += 2; j < text.length; j++) {
        const ch = text[j];
        if (ch === '"' || ch === "'" || ch === '`') {
          const end = ch === '`' ? templateEnd(text, j) : (readLiteral(text, j)?.to ?? -1);
          if (end < 0) return -1;
          j = end - 1;
        } else if (ch === '{') depth++;
        else if (ch === '}' && depth-- === 0) break;
      }
      if (j >= text.length) return -1;
    }
  }
  return -1;
}

/** Index just past the regex literal opened at `i`, or -1. A `/` inside a
 *  character class does not close it. */
function regexEnd(text: string, i: number): number {
  let inClass = false;
  for (let j = i + 1; j < text.length; j++) {
    const ch = text[j];
    if (ch === '\n') return -1;
    if (ch === '\\') j++;
    else if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) {
      while (j + 1 < text.length && IDENT_PART.test(text[j + 1])) j++;
      return j + 1;
    }
  }
  return -1;
}

/**
 * The frontmatter as tokens, or null when it cannot be read — an unclosed
 * string, comment or template. Nothing is guessed around a failure: the proof
 * refuses instead.
 */
function tokenize(text: string): Token[] | null {
  const out: Token[] = [];
  let nl = false;
  const push = (token: Omit<Token, 'nl'>) => { out.push({ ...token, nl }); nl = false; };
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (ch === '\n') { nl = true; i++; continue; }
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) return null;
      if (text.slice(i, end).includes('\n')) nl = true;
      i = end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const literal = readLiteral(text, i);
      if (literal) {
        push({ kind: 'string', text: text.slice(i, literal.to), value: literal.value });
        i = literal.to;
        continue;
      }
      if (ch !== '`') return null;
      const end = templateEnd(text, i);
      if (end < 0) return null;
      push({ kind: 'template', text: text.slice(i, end) });
      i = end;
      continue;
    }
    if (IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < text.length && IDENT_PART.test(text[j])) j++;
      push({ kind: 'ident', text: text.slice(i, j) });
      i = j;
      continue;
    }
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(text[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < text.length && /[\w.]/.test(text[j])) j++;
      push({ kind: 'number', text: text.slice(i, j) });
      i = j;
      continue;
    }
    // A `/` after a value divides; anywhere else it opens a regex.
    const prev = out.at(-1);
    const afterValue = !!prev && (prev.kind === 'ident' ? !BEFORE_REGEX.has(prev.text)
      : prev.kind !== 'punct' || [')', ']', '}'].includes(prev.text));
    if (ch === '/' && !afterValue) {
      const end = regexEnd(text, i);
      if (end < 0) return null;
      push({ kind: 'regex', text: text.slice(i, end) });
      i = end;
      continue;
    }
    // `?.` is optional chaining, except before a digit: `a?.5:1` is a ternary.
    if (ch === '?' && text[i + 1] === '.' && !/\d/.test(text[i + 2] ?? '')) {
      push({ kind: 'punct', text: '?.' });
      i += 2;
      continue;
    }
    const multi = PUNCT.find(p => text.startsWith(p, i));
    push({ kind: 'punct', text: multi ?? ch });
    i += multi?.length ?? 1;
  }
  return out;
}

const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);

/** The first index in [lo, hi) outside every bracket opened in that range
 *  where `match` holds, or -1. A close with nothing open is asked too: it ends
 *  the bracket the range sits in. */
function atDepth0(tokens: Token[], lo: number, hi: number, match: (t: Token, i: number) => boolean): number {
  let depth = 0;
  for (let i = lo; i < hi; i++) {
    const t = tokens[i];
    if (t.kind === 'punct' && CLOSE.has(t.text) && depth > 0) { depth--; continue; }
    if (depth === 0 && match(t, i)) return i;
    if (t.kind === 'punct' && OPEN.has(t.text)) depth++;
  }
  return -1;
}

/** The index of the bracket that closes the one opened at `open`, or -1. */
function closeOf(tokens: Token[], open: number, hi: number): number {
  let depth = 0;
  for (let i = open; i < hi; i++) {
    const t = tokens[i];
    if (t.kind !== 'punct') continue;
    if (OPEN.has(t.text)) depth++;
    else if (CLOSE.has(t.text) && --depth === 0) return i;
  }
  return -1;
}

/** An assignment operator: `=`, `+=`, `??=` and the rest, not a comparison. */
function assigns(t: Token): boolean {
  return t.kind === 'punct' && t.text.endsWith('=') && !['==', '===', '!=', '!==', '<=', '>='].includes(t.text);
}

/** Where the initializer starting at `from` ends: a `;` or `,` outside every
 *  bracket, the close of the bracket it sits in, or a line break that ASI
 *  would end the statement at. */
function initializerEnd(tokens: Token[], from: number): number {
  const valueEnd = (t: Token) => t.kind !== 'punct' || [')', ']', '}', '++', '--'].includes(t.text);
  const continues = (t: Token) => t.kind === 'template' ||
    (t.kind === 'ident' ? ['in', 'instanceof', 'as', 'satisfies'].includes(t.text)
      : t.kind === 'punct' && !['{', '++', '--', '!', '~'].includes(t.text));
  const end = atDepth0(tokens, from, tokens.length, (t, i) =>
    (t.kind === 'punct' && (t.text === ';' || t.text === ',' || CLOSE.has(t.text))) ||
    (i > from && t.nl && valueEnd(tokens[i - 1]) && !continues(t)));
  return end < 0 ? tokens.length : end;
}

/**
 * Every value the tokens in [lo, hi) can evaluate to, or null when any of
 * them might not be a string literal.
 *
 * The grammar is deliberately tiny: a string literal, a conditional whose
 * branches are values, an `||` / `??` chain of values, and parentheses around
 * any of those, optionally `as const`. A conditional's *test* can be any code,
 * because it chooses between values and is never one.
 */
function valuesOf(tokens: Token[], lo: number, hi: number): string[] | null {
  if (lo >= hi) return null;
  // `||` and `??` bind tighter than `?:`, so the first `?` outside brackets is
  // the outermost conditional's.
  const q = atDepth0(tokens, lo, hi, t => t.kind === 'punct' && t.text === '?');
  if (q < 0) return operandsOf(tokens, lo, hi);
  // The test is code, not a value — but an arrow or an assignment at its top
  // level would make the whole initializer something other than a conditional.
  if (q === lo || atDepth0(tokens, lo, q, t => assigns(t) || (t.kind === 'punct' &&
    ['=>', ':', '...'].includes(t.text))) >= 0) return null;
  // Its `:` is the first one outside brackets that no nested `?` has claimed.
  let pending = 0;
  const colon = atDepth0(tokens, q + 1, hi, t => {
    if (t.kind !== 'punct') return false;
    if (t.text === '?') pending++;
    else if (t.text === ':') return pending-- === 0;
    return false;
  });
  if (colon < 0) return null;
  const then = valuesOf(tokens, q + 1, colon);
  const otherwise = valuesOf(tokens, colon + 1, hi);
  return then && otherwise ? [...then, ...otherwise] : null;
}

/** An `||` / `??` chain: every operand is a value. */
function operandsOf(tokens: Token[], lo: number, hi: number): string[] | null {
  const values: string[] = [];
  let start = lo;
  for (;;) {
    const op = atDepth0(tokens, start, hi, t => t.kind === 'punct' && (t.text === '||' || t.text === '??'));
    let end = op < 0 ? hi : op;
    if (end - start >= 3 && tokens[end - 2].text === 'as' && tokens[end - 1].text === 'const') end -= 2;
    const first = tokens[start];
    if (end - start === 1 && first?.kind === 'string') values.push(first.value!);
    else if (first?.kind === 'punct' && first.text === '(' && closeOf(tokens, start, end) === end - 1) {
      const inner = valuesOf(tokens, start + 1, end - 1);
      if (!inner) return null;
      values.push(...inner);
    } else return null;
    if (op < 0) return values;
    start = op + 1;
  }
}

/** What Astro renders as an element when a component is a string. */
const TAG_NAME = /^[A-Za-z][A-Za-z0-9-]*$/;
const IDENT = /^[A-Za-z_$][\w$]*$/;
const BINDERS = new Set(['const', 'let', 'var', 'function', 'class', 'import']);

/**
 * The tag names a frontmatter binding can hold, in source order, or null when
 * it is not provably one of them.
 *
 * Proven: one `const` at the frontmatter's top level, whose initializer every
 * branch of is a string literal — `href ? 'a' : 'article'`, `'h2' as const`,
 * `level || 'h2'` is not. Refused: a prop (`as`), an import, `let`/`var`, a
 * name declared twice (a shadow in a nested scope counts), and anything
 * computed.
 */
export function literalBinding(frontmatter: string, name: string): string[] | null {
  if (!IDENT.test(name) || propBinding(frontmatter, name) !== null) return null;
  const tokens = tokenize(frontmatter);
  if (!tokens) return null;
  let depth = 0;
  let declared = 0;
  let at = -1;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === 'punct' && OPEN.has(t.text)) depth++;
    else if (t.kind === 'punct' && CLOSE.has(t.text) && --depth < 0) return null;
    else if (t.kind === 'ident' && t.text === name && i > 0 && tokens[i - 1].kind === 'ident' &&
      BINDERS.has(tokens[i - 1].text)) {
      declared++;
      if (tokens[i - 1].text === 'const' && depth === 0) at = i;
    }
  }
  if (declared !== 1 || at < 0) return null;
  // `const Tag: 'a' | 'b' = …` — the annotation says nothing about the value.
  let eq = at + 1;
  if (tokens[eq]?.text === ':') {
    eq = atDepth0(tokens, eq + 1, tokens.length, t => t.kind === 'punct' && t.text === '=');
    if (eq < 0) return null;
  }
  if (tokens[eq]?.text !== '=') return null;
  const values = valuesOf(tokens, eq + 1, initializerEnd(tokens, eq + 1));
  if (!values || !values.every(value => TAG_NAME.test(value))) return null;
  return [...new Set(values)];
}

/** Nodes that render no element of their own. A child written inside one is
 *  still a DOM child of the element around it. */
const TRANSPARENT = new Set(['expression', 'fragment']);

export type VariableTagProof =
  | { ok: true; loc: string; name: string; tags: string[] }
  | { ok: false; reason: Exclude<VariableTagRefusal, 'disabled' | 'ambiguous'> };

/**
 * Prove that an unannotated element is a variable tag's, from one annotated
 * element directly inside it (issue #82). **Downward only**: the child names
 * its own node, and the node's AST parent is the only candidate — nothing
 * here walks up the DOM to an annotated ancestor and calls it the owner.
 *
 * 1. `child` resolves by the patcher's own loc rule.
 * 2. Its parent, past expressions and fragments, is a `component` node whose
 *    name is a bare identifier not rebound by an enclosing expression — a
 *    `.map((Tag) => <Tag>…)` parameter is not the frontmatter's `Tag`.
 * 3. That name is a {@link literalBinding}, and `rendered` is one of its
 *    literals.
 *
 * Then Astro rendered the node as that HTML element, so the element is the
 * child's DOM parent and is written where the node starts. `loc` is that
 * start, the `<` of `<Wrapper`, which is never an annotation loc. In
 * `<Wrapper><Inner /></Wrapper>` the child annotated by `Inner.astro` fails
 * step 2, because its parent there is the file's root.
 *
 * It assumes the browser kept the nesting the template wrote. Markup the
 * parser repairs, such as a `<div>` inside a `<p>`, moves the child and
 * breaks every annotation around it, not only this one.
 */
export async function resolveVariableTag(
  source: string, child: { loc: string; tag: string }, rendered: string,
): Promise<VariableTagProof> {
  const resolved = await resolveElement(source, child.loc, child.tag);
  if (resolved.status !== 'ok') return { ok: false, reason: 'unresolved' };
  const parents = resolved.parents!;
  let node: AstNode | undefined = parents.get(resolved.element!);
  while (node && TRANSPARENT.has(node.type)) node = parents.get(node);
  if (node?.type !== 'component' || !node.name || !IDENT.test(node.name) || !node.position) {
    return { ok: false, reason: 'not-a-wrapper' };
  }
  const name = node.name;
  for (let up = parents.get(node); up; up = parents.get(up)) {
    if (up.type !== 'expression') continue;
    const code = (up.children ?? []).filter(c => c.type === 'text').map(c => c.value ?? '').join(' ');
    if (code.split(/[^\w$]+/).includes(name)) return { ok: false, reason: 'not-literal' };
  }
  const tags = literalBinding(resolved.frontmatter?.text ?? '', name);
  if (!tags) return { ok: false, reason: 'not-literal' };
  if (!tags.some(tag => tag.toLowerCase() === rendered.toLowerCase())) return { ok: false, reason: 'tag-mismatch' };
  const { line, column } = node.position.start;
  return { ok: true, loc: `${line}:${column}`, name, tags };
}
