import { parse } from '@astrojs/compiler';
import type { AttrState, ClassifyResult } from '../shared/protocol.ts';
import type { ApplyResult, Patcher, PatchRequest } from './types.ts';

/**
 * .astro source patcher — resolves a `data-astro-source-loc` back to the AST
 * element it was emitted for, classifies it, and patches literal text or
 * static `src`/`alt` attribute values. Pure string-in/string-out: no fs here.
 *
 * Position semantics (empirically verified against @astrojs/compiler 2.13 on
 * this repo — 810/812 annotated elements resolve uniquely, see spec §16.1):
 *
 * - The compiler's `position.{line,column}` counts columns in UTF-16 code
 *   units, which is exactly JS string indexing — so all offset math here is
 *   plain (line, column) → string index. The `offset` field is BYTE-based
 *   (Go compiler) and must not be mixed with JS indices; we never use it.
 * - `data-astro-source-loc` is NOT the element's own start. It is the start of
 *   the element's first child's *content*: a text child's start as-is, an
 *   element/expression child's start + 1 (the tag name / the `{`). For
 *   childless elements it is the element's own start + 1 (its tag name).
 * - If two elements produce the same candidate loc (e.g. `<span><span></span>`
 *   nested empty spans) Astro's own annotations are ambiguous; we refuse.
 */

// The compiler's node types, loosely — we only touch what we verify.
interface Pos {
  line: number;
  column: number;
}
interface AstNode {
  type: string;
  name?: string;
  value?: string;
  kind?: string;
  position?: { start: Pos; end?: Pos };
  attributes?: AstNode[];
  children?: AstNode[];
}

// ---------------------------------------------------------------------------
// Position helpers (JS string space)
// ---------------------------------------------------------------------------

function lineStartIndices(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function indexOfPos(starts: number[], pos: Pos): number {
  const lineStart = starts[pos.line - 1];
  if (lineStart === undefined) return -1;
  return lineStart + pos.column - 1;
}

// ---------------------------------------------------------------------------
// Entity decoding / escaping
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  // Common typographic entities, so source that spells them as references
  // still verify-matches the rendered text the client sends. Unknown names
  // still pass through undecoded and fail safe with a mismatch refusal.
  mdash: '—',
  ndash: '–',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  sect: '§',
  deg: '°',
  times: '×',
  euro: '€',
  pound: '£',
};

/** Decode the entities a source region may contain so it compares equal to the
 *  rendered DOM text the client sends. Unknown entities pass through. */
function decodeEntities(s: string): string {
  return s.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body: string) => {
    if (body[0] === '#') {
      const cp =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      try {
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
      } catch {
        return m;
      }
    }
    return NAMED_ENTITIES[body] ?? m;
  });
}

/** Escape text for insertion as literal template content. `<` cannot open a
 *  tag, `{` cannot open an expression, `&` cannot form an entity — the write
 *  can change words but never structure or behaviour. (spec §7.2, §8) */
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\{/g, '&#123;');
}

/**
 * The markup path deliberately lets `<` and `&` through — the popup shows raw
 * source and tags are the point — so only `{` is neutralised, keeping the one
 * guarantee that matters: an edit can add formatting, never an expression.
 * Tag and attribute names are vetted separately by `validateInlineMarkup`.
 */
function escapeMarkup(s: string): string {
  return s.replace(/\{/g, '&#123;');
}

/** Escape an attribute value for insertion inside `quote`-delimited quotes. */
function escapeAttrValue(s: string, quote: string): string {
  let out = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\{/g, '&#123;');
  out = quote === '"' ? out.replace(/"/g, '&quot;') : out.replace(/'/g, '&#39;');
  return out;
}

/** Whitespace-insensitive comparison form. (spec §7.5) */
function normalize(s: string): string {
  return s.replace(/[\s ]+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Inline markup safelist
// ---------------------------------------------------------------------------

/**
 * Text with a `<br>` or a `<strong>` in it is still copy, but the literal-text
 * path can't carry it: that path escapes `<`, so a round-trip would turn the
 * tag into visible punctuation. These elements are instead classified as
 * `markup` and edited as raw source through a popup.
 *
 * The safelist is intentionally small and inline-only — formatting a phrase,
 * not restructuring a page. Anything outside it (a nested `<div>`, a component,
 * an expression) keeps today's refusal and points at the source.
 */
const INLINE_TAGS = new Set([
  'a', 'b', 'br', 'code', 'em', 'i', 'small', 'span', 'strong', 'sub', 'sup', 'u',
]);

/** The one safelisted tag that never closes. */
const VOID_INLINE_TAGS = new Set(['br']);

/** Attributes accepted on any safelisted tag. Presentational only: nothing
 *  here can run code or load a resource. */
const GLOBAL_ATTRS = new Set(['class', 'id', 'title', 'lang', 'dir']);

/** Extra attributes accepted on specific tags. */
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'target', 'rel']),
};

function attrAllowed(tag: string, attr: string): boolean {
  return GLOBAL_ATTRS.has(attr) || (TAG_ATTRS[tag]?.has(attr) ?? false);
}

const ALLOWED_LIST = [...INLINE_TAGS].map((t) => `<${t}>`).join(', ');

/**
 * Whether a child node may appear inside a `markup` element: literal text, or a
 * safelisted inline element (recursively) whose attributes are all statically
 * quoted and allowed. An expression-valued attribute fails here on purpose —
 * the popup rewrites the whole region as text, which would destroy it.
 */
function isInlineSafe(n: AstNode): boolean {
  if (n.type === 'text') return true;
  if (n.type !== 'element') return false;
  const tag = (n.name ?? '').toLowerCase();
  if (!INLINE_TAGS.has(tag)) return false;
  const attrsOk = (n.attributes ?? []).every(
    (a) => a.kind === 'quoted' && attrAllowed(tag, (a.name ?? '').toLowerCase()),
  );
  return attrsOk && (n.children ?? []).every(isInlineSafe);
}

/** An expression anywhere in the subtree — checked ahead of the markup rule so
 *  `<p><strong>{x}</strong></p>` refuses with the expression reason, which is
 *  the one that tells the user what to do about it. */
function hasExpressionDeep(n: AstNode): boolean {
  return (n.children ?? []).some((c) => c.type === 'expression' || hasExpressionDeep(c));
}

/**
 * Vet a raw-markup replacement before it is written. Returns an error message,
 * or null when the string is nothing but text and well-nested safelisted inline
 * tags. Written as a scanner rather than a regex sweep because it also has to
 * hold the open-tag stack: unbalanced markup would corrupt the rest of the
 * page, so it is refused rather than repaired.
 */
function validateInlineMarkup(html: string): string | null {
  const stack: string[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;

    let j = lt + 1;
    const closing = html[j] === '/';
    if (closing) j++;
    const nameStart = j;
    while (j < html.length && /[a-zA-Z0-9]/.test(html[j])) j++;
    const tag = html.slice(nameStart, j).toLowerCase();
    if (!tag) {
      return 'A “<” here does not start a tag. Write it as &lt; if you meant the character itself.';
    }
    if (!INLINE_TAGS.has(tag)) {
      return `<${tag}> can’t be added here. Allowed inline tags: ${ALLOWED_LIST}. Edit this element in the source instead.`;
    }

    // Scan to the closing `>`, stepping over quoted attribute values so a `>`
    // inside one doesn't end the tag early.
    let k = j;
    let attrText = '';
    while (k < html.length && html[k] !== '>') {
      const ch = html[k];
      if (ch === '"' || ch === "'") {
        const close = html.indexOf(ch, k + 1);
        if (close < 0) return `An attribute value on <${tag}> is missing its closing quote.`;
        attrText += html.slice(k, close + 1);
        k = close + 1;
        continue;
      }
      attrText += ch;
      k++;
    }
    if (k >= html.length) return `The <${tag}> tag is missing its closing “>”.`;

    if (closing) {
      if (attrText.trim()) return `A closing </${tag}> tag can’t carry attributes.`;
      if (stack.pop() !== tag) {
        return `</${tag}> doesn’t close the tag it should — check the tags nest correctly.`;
      }
    } else {
      const bad = validateAttrs(tag, attrText);
      if (bad) return bad;
      const selfClosing = /\/\s*$/.test(attrText);
      if (!VOID_INLINE_TAGS.has(tag) && !selfClosing) stack.push(tag);
    }
    i = k + 1;
  }
  if (stack.length) return `<${stack[stack.length - 1]}> is never closed.`;
  return null;
}

/** Attribute-level vetting for one opening tag's attribute text. */
function validateAttrs(tag: string, attrText: string): string | null {
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrText)) !== null) {
    const name = m[1].toLowerCase();
    if (!attrAllowed(tag, name)) {
      return `The ${name} attribute isn’t allowed on <${tag}> here. Edit this element in the source instead.`;
    }
    const value = (m[3] ?? '').trim().replace(/^["']|["']$/g, '');
    if (name === 'href' && /^\s*javascript:/i.test(value)) {
      return 'A javascript: link can’t be added here. Edit this element in the source instead.';
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Element resolution
// ---------------------------------------------------------------------------

function collectElements(root: AstNode): AstNode[] {
  const out: AstNode[] = [];
  const visit = (n: AstNode): void => {
    if (n.type === 'element') out.push(n);
    for (const c of n.children ?? []) visit(c);
  };
  visit(root);
  return out;
}

/** The loc Astro would annotate this element with (see header comment). */
function annotationLoc(el: AstNode): Pos | null {
  const first = (el.children ?? []).find((c) => c.position);
  if (!first) {
    if (!el.position) return null;
    return { line: el.position.start.line, column: el.position.start.column + 1 };
  }
  const s = first.position!.start;
  return first.type === 'text' ? { line: s.line, column: s.column } : { line: s.line, column: s.column + 1 };
}

interface Resolution {
  status: 'ok' | 'ambiguous' | 'unresolved';
  element?: AstNode;
}

async function resolveElement(source: string, loc: string, tag: string): Promise<Resolution> {
  const m = /^(\d+):(\d+)$/.exec(loc);
  if (!m) return { status: 'unresolved' };
  const line = Number(m[1]);
  const column = Number(m[2]);

  const { ast } = await parse(source, { position: true });
  const hits = collectElements(ast as AstNode).filter((el) => {
    if ((el.name ?? '').toLowerCase() !== tag.toLowerCase()) return false;
    const cand = annotationLoc(el);
    return cand !== null && cand.line === line && cand.column === column;
  });

  if (hits.length === 1) return { status: 'ok', element: hits[0] };
  return { status: hits.length ? 'ambiguous' : 'unresolved' };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function attrState(el: AstNode, name: string): AttrState {
  const attr = (el.attributes ?? []).find((a) => a.name === name);
  if (!attr) return 'missing';
  return attr.kind === 'quoted' ? 'static' : 'dynamic';
}

/** The source span covering all of an element's children — the region a text
 *  or markup edit replaces. */
function innerSpan(starts: number[], el: AstNode): { from: number; to: number } | null {
  const children = el.children ?? [];
  const first = children[0]?.position;
  const last = children[children.length - 1]?.position;
  if (!first || !last?.end) return null;
  const from = indexOfPos(starts, first.start);
  const to = indexOfPos(starts, last.end);
  if (from < 0 || to < 0 || to < from) return null;
  return { from, to };
}

function classifyResolved(el: AstNode, source: string, starts: number[]): ClassifyResult {
  const tag = (el.name ?? '').toLowerCase();
  const children = el.children ?? [];

  if (tag === 'img') {
    return {
      kind: 'image',
      reason: 'image element',
      attrs: { src: attrState(el, 'src'), alt: attrState(el, 'alt') },
    };
  }

  if (!children.length) {
    return { kind: 'empty', reason: 'This element has no text content in the source.' };
  }
  if (hasExpressionDeep(el)) {
    return {
      kind: 'dynamic',
      reason:
        'This text comes from a template expression (e.g. a frontmatter field or a variable), so editing it here would change code, not copy.',
    };
  }
  if (children.every((c) => c.type === 'text')) {
    return { kind: 'text', reason: 'literal text' };
  }
  // Literal text carrying inline formatting: editable, but as raw source in a
  // popup rather than inline, since the tags have to survive the round-trip.
  if (children.every(isInlineSafe)) {
    const span = innerSpan(starts, el);
    if (span) {
      return {
        kind: 'markup',
        reason: 'literal text with inline markup',
        markup: { html: source.slice(span.from, span.to).trim() },
      };
    }
  }
  return {
    kind: 'dynamic',
    reason: 'This element contains nested markup, so its text cannot be edited as one block.',
  };
}

export async function classifyAstro(source: string, loc: string, tag: string): Promise<ClassifyResult> {
  const res = await resolveElement(source, loc, tag);
  if (res.status === 'ambiguous') {
    return {
      kind: 'ambiguous',
      reason: 'Two elements in the source share this location marker, so the edit target cannot be identified safely.',
    };
  }
  if (res.status === 'unresolved') {
    return {
      kind: 'unresolved',
      reason: 'No element matches this source location — the file may have changed since the page loaded. Try reloading.',
    };
  }
  return classifyResolved(res.element!, source, lineStartIndices(source));
}

// ---------------------------------------------------------------------------
// Patching
// ---------------------------------------------------------------------------

function patchTextContent(
  source: string,
  starts: number[],
  el: AstNode,
  original: string,
  newText: string,
): ApplyResult {
  const cls = classifyResolved(el, source, starts);
  if (cls.kind !== 'text') {
    return { ok: false, code: 'dynamic', error: cls.reason };
  }

  const span = innerSpan(starts, el);
  if (!span) {
    return { ok: false, code: 'unsupported', error: 'The source positions for this text are invalid.' };
  }

  const region = source.slice(span.from, span.to);
  // Verify the source still says what the client saw. (spec §7.5)
  if (normalize(decodeEntities(region)) !== normalize(original)) {
    return {
      ok: false,
      code: 'mismatch',
      error: 'The source no longer matches the text on the page (it may have been edited elsewhere). Reload and try again.',
    };
  }

  return { ok: true, newSource: splice(source, span, region, escapeText(newText.trim())) };
}

/**
 * Replace an element's inner source with raw inline markup. Unlike the text
 * path this compares source against source — `original` is the very string
 * /classify handed the popup — so no entity decoding is involved on either
 * side, and a file edited out-of-band still fails safe with a mismatch.
 */
function patchMarkupContent(
  source: string,
  starts: number[],
  el: AstNode,
  original: string,
  newHtml: string,
): ApplyResult {
  const cls = classifyResolved(el, source, starts);
  // `text` is accepted too: an element that holds only literal text today can
  // legitimately gain its first <br> or <strong> through this path.
  if (cls.kind !== 'markup' && cls.kind !== 'text') {
    return { ok: false, code: 'dynamic', error: cls.reason };
  }

  const span = innerSpan(starts, el);
  if (!span) {
    return { ok: false, code: 'unsupported', error: 'The source positions for this text are invalid.' };
  }

  const region = source.slice(span.from, span.to);
  if (normalize(region) !== normalize(original)) {
    return {
      ok: false,
      code: 'mismatch',
      error: 'The source no longer matches the markup on the page (it may have been edited elsewhere). Reload and try again.',
    };
  }

  const trimmed = newHtml.trim();
  const bad = validateInlineMarkup(trimmed);
  if (bad) return { ok: false, code: 'unsupported', error: bad };

  return { ok: true, newSource: splice(source, span, region, escapeMarkup(trimmed)) };
}

/** Swap `replacement` into `span`, keeping the region's own leading/trailing
 *  whitespace so the file's indentation survives. (spec §6.1) */
function splice(
  source: string,
  span: { from: number; to: number },
  region: string,
  replacement: string,
): string {
  const lead = /^\s*/.exec(region)![0];
  const trail = lead.length === region.length ? '' : /\s*$/.exec(region)![0];
  return source.slice(0, span.from) + lead + replacement + trail + source.slice(span.to);
}

/**
 * Find the value span of a `quoted` attribute by scanning forward from the
 * attribute's name position: name, `=`, opening quote, closing quote. Refuses
 * (returns null) on anything unexpected — including unquoted values.
 */
function attrValueSpan(
  source: string,
  starts: number[],
  attr: AstNode,
): { from: number; to: number; quote: string } | null {
  if (!attr.position || !attr.name) return null;
  let i = indexOfPos(starts, attr.position.start);
  if (i < 0 || !source.startsWith(attr.name, i)) return null;
  i += attr.name.length;
  while (i < source.length && /\s/.test(source[i])) i++;
  if (source[i] !== '=') return null;
  i++;
  while (i < source.length && /\s/.test(source[i])) i++;
  const quote = source[i];
  if (quote !== '"' && quote !== "'") return null;
  const close = source.indexOf(quote, i + 1);
  if (close < 0) return null;
  return { from: i + 1, to: close, quote };
}

/**
 * Find the index just before the `>` (or `/>`) that closes an element's
 * opening tag, skipping quoted attribute values and `{...}` expressions.
 * Returns null on anything it does not fully understand.
 */
function openTagInsertionPoint(source: string, starts: number[], el: AstNode): number | null {
  if (!el.position) return null;
  let i = indexOfPos(starts, el.position.start);
  if (i < 0 || source[i] !== '<') return null;
  i++;
  let depth = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'") {
      const close = source.indexOf(ch, i + 1);
      if (close < 0) return null;
      i = close + 1;
      continue;
    }
    if (ch === '{') {
      depth++;
      i++;
      continue;
    }
    if (ch === '}') {
      if (depth === 0) return null;
      depth--;
      i++;
      continue;
    }
    if (ch === '>' && depth === 0) {
      // Step back over a self-closing slash and trailing whitespace.
      let at = i;
      let back = i - 1;
      if (source[back] === '/') back--;
      while (back > 0 && /\s/.test(source[back])) back--;
      at = back + 1;
      return at;
    }
    if (ch === '<' && depth === 0) return null; // ran into another tag: lost
    i++;
  }
  return null;
}

function patchAttribute(
  source: string,
  starts: number[],
  el: AstNode,
  attrName: 'src' | 'alt',
  original: string,
  newValue: string,
): ApplyResult {
  const attr = (el.attributes ?? []).find((a) => a.name === attrName);

  if (!attr) {
    // Insert-if-missing is allowed for `alt` on <img> only: adding alt text is
    // still strictly content. A missing `src` is never inserted. (spec §6.3)
    if (attrName !== 'alt' || (el.name ?? '').toLowerCase() !== 'img' || original !== '') {
      return { ok: false, code: 'unsupported', error: `This element has no ${attrName} attribute in the source.` };
    }
    const at = openTagInsertionPoint(source, starts, el);
    if (at === null) {
      return { ok: false, code: 'unsupported', error: 'Could not find a safe place to add the alt attribute.' };
    }
    const insertion = ` alt="${escapeAttrValue(newValue, '"')}"`;
    return { ok: true, newSource: source.slice(0, at) + insertion + source.slice(at) };
  }

  if (attr.kind !== 'quoted') {
    return {
      ok: false,
      code: 'dynamic',
      error: `The ${attrName} attribute is set from an expression, so it must be edited in the source.`,
    };
  }

  const span = attrValueSpan(source, starts, attr);
  if (!span) {
    return { ok: false, code: 'unsupported', error: `Could not locate the ${attrName} value in the source.` };
  }

  // Deliberately exact — no whitespace normalization, unlike text content.
  // The DOM preserves attribute values verbatim, so source and page only
  // diverge when the file really changed out-of-band; refusing is safe.
  const current = decodeEntities(source.slice(span.from, span.to));
  if (current !== original) {
    return {
      ok: false,
      code: 'mismatch',
      error: `The source ${attrName} no longer matches the page (it may have been edited elsewhere). Reload and try again.`,
    };
  }

  const replacement = escapeAttrValue(newValue, span.quote);
  return { ok: true, newSource: source.slice(0, span.from) + replacement + source.slice(span.to) };
}

export async function applyAstro(source: string, req: PatchRequest): Promise<ApplyResult> {
  const res = await resolveElement(source, req.loc, req.tag);
  if (res.status === 'ambiguous') {
    return { ok: false, code: 'ambiguous', error: 'Two elements share this source location; refusing to guess.' };
  }
  if (res.status === 'unresolved') {
    return {
      ok: false,
      code: 'unresolved',
      error: 'No element matches this source location — the file may have changed. Reload and try again.',
    };
  }

  const starts = lineStartIndices(source);
  const el = res.element!;
  if (req.targetType === 'text') {
    return patchTextContent(source, starts, el, req.original, req.newText);
  }
  if (req.targetType === 'markup') {
    return patchMarkupContent(source, starts, el, req.original, req.newText);
  }
  return patchAttribute(source, starts, el, req.targetType, req.original, req.newText);
}

/** This file's classify/apply pair, packaged for the extension registry. */
export const astroPatcher: Patcher = {
  extensions: ['.astro'],
  classify: (source, { loc, tag }) => classifyAstro(source, loc, tag),
  apply: applyAstro,
};
