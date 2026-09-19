import type { AstNode } from './astro.ts';

/**
 * Tracing `{expression}` text back to the string constant it renders, so the
 * words can be edited where they are read.
 *
 * Two shapes are understood, and only these two:
 *
 *   {title}     ← const title = 'Hello'
 *   {b.title}   ← const benefits = [{ title: 'Hello' }, …]  via  benefits.map((b) => …)
 *
 * **No JS parser is involved, and none is needed.** `@astrojs/compiler` already
 * splits a template expression into its text parts, so the expression source
 * (`b.title`) and the loop head (`benefits.map((b) => (`) arrive as plain
 * strings. What remains is finding one string literal inside the frontmatter,
 * which is done by scanning rather than parsing — deliberately, since a real
 * parser would mean a runtime dependency (`typescript` is absent from ordinary
 * Astro projects) for a job whose failure mode must be *refusal* anyway.
 *
 * Everything here therefore fails closed: any shape not matched exactly returns
 * null, and the caller keeps today's "edit this in the source" refusal.
 *
 * ## Which item, when a loop renders many
 *
 * Every card in a `.map()` shares one source loc, so the loc cannot say which
 * item was clicked. The rendered string does: the client sends the text it
 * showed and the item whose value equals it is the one patched. Two items with
 * the same text refuse rather than guess. A DOM sibling index was considered
 * and rejected — a `.filter()`, `.sort()` or `.slice()` in the chain would
 * silently mis-target, and a silently wrong write is the one failure this
 * project must not have.
 */

const IDENT = '[A-Za-z_$][\\w$]*';
const BARE_IDENT = new RegExp(`^${IDENT}$`);
const MEMBER = new RegExp(`^(${IDENT})\\.(${IDENT})$`);

/**
 * The head of a `.map()` call, up to the arrow: `items.map((it) => (`, or
 * `items.map(it =>`, with an optional index parameter. Anything else — a
 * `.filter().map()` chain, a nested member (`data.items.map`), a `function`
 * callback — does not match, and the expression stays refused.
 */
const MAP_HEAD = new RegExp(
  `^\\s*(${IDENT})\\s*\\.\\s*map\\s*\\(\\s*(?:\\(\\s*(${IDENT})\\s*(?:,[^)]*)?\\)|(${IDENT}))\\s*=>`,
);

export interface ExpressionTrace {
  /** Frontmatter key holding the string: `title`. */
  property: string;
  /** The array const the item lives in, when the text came from a `.map()`
   *  loop. Absent for a plain `{title}` const. */
  array?: string;
  /** How to name the target in the editor: `title` or `benefits[].title`. */
  label: string;
}

/** An expression node's source text, when it is one plain run of text.
 *  A nested element or a second text part means it isn't a simple value. */
function expressionText(node: AstNode): string | null {
  const children = node.children ?? [];
  if (children.length !== 1 || children[0].type !== 'text') return null;
  return (children[0].value ?? '').trim();
}

/** The leading text of an expression — for a `.map()` call, its head. */
function headText(node: AstNode): string {
  const first = (node.children ?? [])[0];
  return first?.type === 'text' ? (first.value ?? '') : '';
}

/**
 * What the element's `{expression}` renders, when it can be traced. `parentOf`
 * must reach every ancestor of `el`, so a member access can be bound through
 * the loop that introduced it.
 */
export function traceExpression(
  el: AstNode,
  parentOf: Map<AstNode, AstNode>,
): ExpressionTrace | null {
  const children = el.children ?? [];
  if (children.length !== 1 || children[0].type !== 'expression') return null;

  const expr = expressionText(children[0]);
  if (!expr) return null;

  // The nearest enclosing expression is the one that can bind a member's
  // parameter; for a mapped element it is the `.map()` call itself.
  let head: string | null = null;
  for (let node = parentOf.get(el); node; node = parentOf.get(node)) {
    if (node.type !== 'expression') continue;
    head = headText(node);
    break;
  }
  return traceExpressionSource(expr, head);
}

/**
 * The same trace from plain strings — the expression's source text, and the
 * head of the expression enclosing it (`null` when nothing encloses it).
 *
 * A prop at a usage site has no element to walk up from, so this is the entry
 * point {@link traceExpression} is built on rather than a second tracer: one
 * set of shapes is understood, in one place, and everything else refuses.
 */
export function traceExpressionSource(
  expr: string,
  enclosingHead: string | null,
): ExpressionTrace | null {
  const text = expr.trim();
  if (BARE_IDENT.test(text)) return { property: text, label: text };

  const member = MEMBER.exec(text);
  if (!member) return null;
  const [, param, property] = member;

  if (enclosingHead === null) return null;
  const map = MAP_HEAD.exec(enclosingHead);
  if (!map) return null; // an enclosing expression we don't understand
  const array = map[1];
  const bound = map[2] ?? map[3];
  if (bound !== param) return null; // shadowed, or bound somewhere else
  return { property, array, label: `${array}[].${property}` };
}

/**
 * The identifier an expression reads *from*, when it is a bare name or a
 * single `name.property` hop — `title` and `site` respectively. Null for
 * anything deeper or computed.
 *
 * It answers a different question from a trace: whether the name is bound by
 * an import, which makes the value writable in another file rather than
 * unwritable. A trace that fails still leaves that name worth reporting.
 */
export function expressionRoot(expr: string): string | null {
  const text = expr.trim();
  if (BARE_IDENT.test(text)) return text;
  const member = MEMBER.exec(text);
  return member ? member[1] : null;
}

/**
 * The object pattern of a `const { … } = Astro.props` declaration.
 *
 * `[^{}]*` on purpose: a nested pattern (`const { a: { b } } = Astro.props`)
 * and a default holding braces (`const { x = {} } = …`) both fail to match,
 * and failing to match is the refusal this module is built on. The optional
 * `: Props` type annotation and a trailing `as Props` are both accepted —
 * they are how the same declaration is ordinarily written.
 */
const PROPS_PATTERN = new RegExp(
  `(?:^|[\\s;])(?:const|let|var)\\s*\\{([^{}]*)\\}\\s*(?::[^=]*)?=\\s*Astro\\s*\\.\\s*props\\b`,
  'm',
);

/** Split an object pattern on its top-level commas. A default value may hold
 *  brackets or a quoted comma, so depth and string state are both tracked. */
function patternEntries(pattern: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < pattern.length; i++) {
    const past = skipOpaque(pattern, i);
    if (past >= 0) { i = past - 1; continue; }
    const ch = pattern[i];
    if (ch === '[' || ch === '{' || ch === '(') depth++;
    else if (ch === ']' || ch === '}' || ch === ')') depth--;
    else if (ch === ',' && depth === 0) { out.push(pattern.slice(start, i)); start = i + 1; }
  }
  out.push(pattern.slice(start));
  return out.map(entry => entry.trim()).filter(Boolean);
}

/**
 * The **prop** a local name is destructured from, when it comes from
 * `Astro.props` — else null.
 *
 * This is the lookup scope `hasCandidates` does not have, and the reason a
 * component-driven site refuses copy it plainly owns (issue #61). A trace that
 * resolves `{item.question}` to `items[].question` is *right*; it is
 * `declarationEnd` that then fails, and correctly so — `items` is a parameter,
 * not a declaration, so there is no literal in this file to find. Saying
 * "this is the `items` prop" is a different and true answer, and it is the one
 * the caller needs to take the hop.
 *
 * Decides nothing and reads no other file: `Patcher` is string-in/string-out
 * (`patcher/types.ts`), so resolving the caller belongs to the layer that
 * already holds the component graph.
 *
 * Renames and defaults are both read, because both are ordinary:
 * `const { title: heading, items = [] } = Astro.props` binds `heading` to the
 * `title` prop. A rest element (`...rest`) names no prop and is skipped.
 */
export function propBinding(frontmatter: string, name: string): string | null {
  const declared = PROPS_PATTERN.exec(frontmatter);
  if (!declared) return null;
  for (const entry of patternEntries(declared[1])) {
    if (entry.startsWith('...')) continue;
    // `prop: local = default` — the default is dropped first, so a `:` inside
    // one cannot be mistaken for the rename separator.
    const withoutDefault = entry.split('=')[0].trim();
    const colon = withoutDefault.indexOf(':');
    const prop = (colon < 0 ? withoutDefault : withoutDefault.slice(0, colon)).trim();
    const local = (colon < 0 ? withoutDefault : withoutDefault.slice(colon + 1)).trim();
    if (!BARE_IDENT.test(prop) || !BARE_IDENT.test(local)) continue;
    if (local === name) return prop;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Locating the string in the frontmatter
// ---------------------------------------------------------------------------

/** A string literal's span within the frontmatter, and its decoded value. */
export interface LiteralSpan {
  /** Index of the opening quote, relative to the frontmatter text. */
  from: number;
  /** Index just past the closing quote. */
  to: number;
  quote: string;
  value: string;
}

const ESCAPES: Record<string, string> = {
  n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '`': '`',
};

/**
 * Read the string literal starting at `i` (which must be its opening quote).
 * Returns null for an unterminated literal, or a template literal carrying an
 * `${…}` interpolation — that is code, not copy. Escapes outside the common
 * set are left encoded, so they simply fail to match and refuse.
 */
export function readLiteral(text: string, i: number): LiteralSpan | null {
  const quote = text[i];
  if (quote !== '"' && quote !== "'" && quote !== '`') return null;
  let value = '';
  for (let j = i + 1; j < text.length; j++) {
    const ch = text[j];
    if (ch === '\\') {
      const next = text[j + 1];
      if (next === undefined) return null;
      value += ESCAPES[next] ?? `\\${next}`;
      j++;
      continue;
    }
    if (ch === quote) return { from: i, to: j + 1, quote, value };
    if (quote === '`' && ch === '$' && text[j + 1] === '{') return null;
    if (quote !== '`' && ch === '\n') return null; // unterminated
    value += ch;
  }
  return null;
}

/** Step over a string literal or a comment, so scanners never mistake their
 *  contents for structure. Returns the index just past it, or -1. */
function skipOpaque(text: string, i: number): number {
  const ch = text[i];
  if (ch === '"' || ch === "'" || ch === '`') {
    const lit = readLiteral(text, i);
    if (lit) return lit.to;
    // An interpolated template still has to be stepped over; find its end
    // naively so the surrounding scan can continue or bail.
    for (let j = i + 1; j < text.length; j++) {
      if (text[j] === '\\') j++;
      else if (text[j] === ch) return j + 1;
    }
    return -1;
  }
  if (ch === '/' && text[i + 1] === '/') {
    const nl = text.indexOf('\n', i);
    return nl < 0 ? text.length : nl;
  }
  if (ch === '/' && text[i + 1] === '*') {
    const end = text.indexOf('*/', i + 2);
    return end < 0 ? -1 : end + 2;
  }
  return -1;
}

const DECL = (name: string) => new RegExp(`(?:^|[\\s;])(?:const|let|var)\\s+${name}\\s*(?::[^=\\n]*)?=\\s*`, 'm');

/** Index just past `const <name> = `, or -1. */
function declarationEnd(frontmatter: string, name: string): number {
  const m = DECL(name).exec(frontmatter);
  return m ? m.index + m[0].length : -1;
}

/**
 * The span of the array literal a const is initialised with — from its `[` to
 * the matching `]`, stepping over strings and comments so a bracket inside one
 * cannot close it early.
 */
export function arraySpan(frontmatter: string, name: string): { from: number; to: number } | null {
  const start = declarationEnd(frontmatter, name);
  if (start < 0 || frontmatter[start] !== '[') return null;
  let depth = 0;
  for (let i = start; i < frontmatter.length; i++) {
    const past = skipOpaque(frontmatter, i);
    if (past >= 0) {
      i = past - 1;
      continue;
    }
    const ch = frontmatter[i];
    if (ch === '[' || ch === '{' || ch === '(') depth++;
    else if (ch === ']' || ch === '}' || ch === ')') {
      depth--;
      if (depth === 0) return { from: start, to: i + 1 };
      if (depth < 0) return null;
    }
  }
  return null;
}

/** Every `<property>: "…"` string literal within `[from, to)`. */
export function propertyLiterals(
  frontmatter: string,
  property: string,
  from: number,
  to: number,
): LiteralSpan[] {
  const re = new RegExp(`(?:^|[{,\\s])${property}\\s*:\\s*`, 'g');
  const scope = frontmatter.slice(from, to);
  const out: LiteralSpan[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(scope)) !== null) {
    const at = from + m.index + m[0].length;
    const lit = readLiteral(frontmatter, at);
    if (lit) out.push(lit);
    // Overlapping keys can't occur, but keep the scan moving regardless.
    re.lastIndex = m.index + m[0].length;
  }
  return out;
}

/**
 * Whether the frontmatter holds anything a trace could patch — the const
 * exists and, for a loop, at least one item carries the property as a string.
 * Classification uses this so the page never offers an edit that the write
 * path would have to refuse for structural reasons. It deliberately does *not*
 * value-match: which item was clicked is only known once the text is sent.
 */
export function hasCandidates(frontmatter: string, trace: ExpressionTrace): boolean {
  if (!trace.array) return constLiteral(frontmatter, trace.property) !== null;
  const span = arraySpan(frontmatter, trace.array);
  return span !== null && propertyLiterals(frontmatter, trace.property, span.from, span.to).length > 0;
}

/**
 * The string literal a plain `const name = '…'` holds, or null for a const
 * that is absent, computed, or not a string at all.
 *
 * Separate from {@link locateValue} because it answers without being told what
 * the page showed: a one-hop trace to a const has exactly one candidate, so
 * the words are known at parse time and a field can be filled with them.
 */
export function constLiteral(frontmatter: string, property: string): LiteralSpan | null {
  const at = declarationEnd(frontmatter, property);
  return at < 0 ? null : readLiteral(frontmatter, at);
}

export type Located =
  | { ok: true; span: LiteralSpan }
  | { ok: false; code: 'untraceable' | 'mismatch' | 'ambiguous'; error: string };

/**
 * Find the one string literal the traced expression rendered, matching on the
 * text the client saw. Whitespace-trimmed on both sides, so re-indentation in
 * the source doesn't break the match — items that differ only in whitespace
 * therefore read as duplicates and refuse.
 */
export function locateValue(
  frontmatter: string,
  trace: ExpressionTrace,
  original: string,
): Located {
  const wanted = original.trim();

  if (!trace.array) {
    const at = declarationEnd(frontmatter, trace.property);
    if (at < 0) {
      return {
        ok: false,
        code: 'untraceable',
        error: `“${trace.property}” isn’t declared in this file’s frontmatter (it may be imported), so it must be edited in the source.`,
      };
    }
    const lit = readLiteral(frontmatter, at);
    if (!lit) {
      return {
        ok: false,
        code: 'untraceable',
        error: `“${trace.property}” isn’t a plain string in the frontmatter, so it must be edited in the source.`,
      };
    }
    if (lit.value.trim() !== wanted) {
      return {
        ok: false,
        code: 'mismatch',
        error: 'The source no longer matches the text on the page (it may have been edited elsewhere). Reload and try again.',
      };
    }
    return { ok: true, span: lit };
  }

  const span = arraySpan(frontmatter, trace.array);
  if (!span) {
    return {
      ok: false,
      code: 'untraceable',
      error: `“${trace.array}” isn’t an array declared in this file’s frontmatter (it may be imported), so it must be edited in the source.`,
    };
  }

  const hits = propertyLiterals(frontmatter, trace.property, span.from, span.to).filter(
    (l) => l.value.trim() === wanted,
  );
  if (hits.length === 1) return { ok: true, span: hits[0] };
  if (hits.length === 0) {
    return {
      ok: false,
      code: 'mismatch',
      error: `No “${trace.property}” in ${trace.array} still reads that way — the file may have been edited elsewhere. Reload and try again.`,
    };
  }
  return {
    ok: false,
    code: 'ambiguous',
    error: `Two entries in ${trace.array} have exactly this text, so the right one can’t be identified. Edit it in the source instead.`,
  };
}

/** Re-encode a replacement for the quote style the literal already uses. */
export function encodeLiteral(value: string, quote: string): string {
  let out = value.replace(/\\/g, '\\\\').split(quote).join(`\\${quote}`);
  if (quote !== '`') out = out.replace(/\r?\n/g, '\\n');
  else out = out.replace(/\$\{/g, '\\${');
  return out;
}

// ---------------------------------------------------------------------------
// Locating an entry by render ordinal
// ---------------------------------------------------------------------------

/**
 * Resolving a value by **where it rendered** rather than by what it says.
 *
 * `locateValue` above matches on the rendered text, which is the only thing a
 * page click supplies and which refuses two items that read alike. A component
 * usage site has something stronger available: `composition-runtime.ts::child()`
 * counted which render of that tag produced the instance, so the Nth render can
 * name the Nth array entry — but only where the correspondence is *proved*, not
 * assumed.
 *
 * **What has to hold, and every one of them is checked here.** The expression
 * is exactly `param.property` with `param` bound by the enclosing `.map()`; the
 * array is a literal declared in this file's frontmatter; it holds no spread,
 * no hole and no conditional, so entry *k* is render *k*; and the entry at that
 * ordinal carries the property as a plain string literal. A `.filter()`,
 * `.slice()` or `.sort()` anywhere in the chain fails at the first check,
 * because {@link MAP_HEAD} is anchored to a bare identifier.
 *
 * Anything short of that is refused **by name** rather than falling back to a
 * text match: an ordinal aimed at the wrong array is a silently wrong write,
 * which is the one failure this project must not have.
 */

/** Whether a segment between two commas holds nothing but whitespace and
 *  comments — a trailing comma when it is last, an elision when it is not. */
function codeless(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) continue;
    const past = text[i] === '/' ? skipOpaque(text, i) : -1;
    if (past < 0) return false;
    i = past - 1;
  }
  return true;
}

/** The top-level entries of an array literal, or null when the literal is not
 *  one this can count — a spread, a hole, or an unbalanced bracket all mean
 *  entry *k* is not render *k*. */
export function arrayEntries(frontmatter: string, name: string): { from: number; to: number }[] | null {
  const span = arraySpan(frontmatter, name);
  if (!span) return null;
  const entries: { from: number; to: number }[] = [];
  let depth = 0;
  let start = -1;
  for (let i = span.from; i < span.to; i++) {
    const past = skipOpaque(frontmatter, i);
    if (past >= 0) {
      if (past > span.to) return null;
      i = past - 1;
      continue;
    }
    const ch = frontmatter[i];
    if (ch === '[' || ch === '{' || ch === '(') {
      depth++;
      if (depth === 1) start = i + 1;
      continue;
    }
    if (ch === ']' || ch === '}' || ch === ')') {
      depth--;
      if (depth === 0) {
        // The final entry, unless the literal ended on a trailing comma — a
        // comment after that comma is not an entry either.
        if (start >= 0 && !codeless(frontmatter.slice(start, i))) entries.push({ from: start, to: i });
        break;
      }
      continue;
    }
    if (ch === ',' && depth === 1) {
      // An elision (`[a, , b]`) shifts every later index, so it is not
      // countable — and a comment in that position is still an elision.
      if (codeless(frontmatter.slice(start, i))) return null;
      entries.push({ from: start, to: i });
      start = i + 1;
    }
  }
  if (depth !== 0) return null;
  // A spread contributes an unknown number of entries, so nothing after it —
  // and in truth nothing at all — keeps a provable index.
  for (const entry of entries) if (/^\s*\.\.\./.test(frontmatter.slice(entry.from, entry.to))) return null;
  return entries;
}

/**
 * The string literal that a `.map()`'s Nth render read, proven rather than
 * matched. `ordinal` is 1-based, as {@link RenderTrace.ordinal} is.
 */
export function locateEntryValue(
  frontmatter: string,
  trace: ExpressionTrace,
  ordinal: number,
): Located {
  if (!trace.array) {
    return {
      ok: false,
      code: 'untraceable',
      error: `“${trace.property}” isn’t read from an array, so a render position cannot name an entry.`,
    };
  }
  if (!Number.isInteger(ordinal) || ordinal < 1) {
    return {
      ok: false,
      code: 'untraceable',
      error: 'The render position for this element is unknown, so the array entry it came from cannot be proved.',
    };
  }
  const entries = arrayEntries(frontmatter, trace.array);
  if (!entries) {
    return {
      ok: false,
      code: 'untraceable',
      error: `“${trace.array}” isn’t a plain array literal in this file’s frontmatter (it may be imported, built, or hold a spread), so its entries can’t be counted. Edit it in the source instead.`,
    };
  }
  const entry = entries[ordinal - 1];
  if (!entry) {
    return {
      ok: false,
      code: 'mismatch',
      error: `${trace.array} no longer has ${ordinal} entries — the file may have been edited elsewhere. Reload and try again.`,
    };
  }
  const hits = propertyLiterals(frontmatter, trace.property, entry.from, entry.to);
  if (hits.length === 1) return { ok: true, span: hits[0] };
  if (hits.length === 0) {
    return {
      ok: false,
      code: 'untraceable',
      error: `That entry of ${trace.array} has no “${trace.property}” string to edit. Edit it in the source instead.`,
    };
  }
  return {
    ok: false,
    code: 'ambiguous',
    error: `That entry of ${trace.array} declares “${trace.property}” more than once, so the right one can’t be identified. Edit it in the source instead.`,
  };
}
