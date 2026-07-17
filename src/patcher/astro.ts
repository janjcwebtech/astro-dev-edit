import { parse } from '@astrojs/compiler';
import type { AttrState, ClassifyResult, RefusalCode } from '../shared/protocol.ts';

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

export interface ApplyRequest {
  loc: string; // "line:col" from data-astro-source-loc
  tag: string; // lowercased tag name of the clicked element
  targetType: 'text' | 'src' | 'alt';
  original: string; // rendered text / attr value the client saw
  newText: string;
}

export type ApplyResult =
  | { ok: true; newSource: string }
  | { ok: false; code: RefusalCode; error: string };

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

function classifyResolved(el: AstNode): ClassifyResult {
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
  if (children.some((c) => c.type === 'expression')) {
    return {
      kind: 'dynamic',
      reason:
        'This text comes from a template expression (e.g. a frontmatter field or a variable), so editing it here would change code, not copy.',
    };
  }
  if (children.some((c) => c.type !== 'text')) {
    return {
      kind: 'dynamic',
      reason: 'This element contains nested markup, so its text cannot be edited as one block.',
    };
  }
  return { kind: 'text', reason: 'literal text' };
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
  return classifyResolved(res.element!);
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
  const cls = classifyResolved(el);
  if (cls.kind !== 'text') {
    return { ok: false, code: 'dynamic', error: cls.reason };
  }

  const children = el.children!;
  const first = children[0].position;
  const last = children[children.length - 1].position;
  if (!first || !last?.end) {
    return { ok: false, code: 'unsupported', error: 'The source positions for this text are incomplete.' };
  }
  const from = indexOfPos(starts, first.start);
  const to = indexOfPos(starts, last.end);
  if (from < 0 || to < 0 || to < from) {
    return { ok: false, code: 'unsupported', error: 'The source positions for this text are invalid.' };
  }

  const region = source.slice(from, to);
  // Verify the source still says what the client saw. (spec §7.5)
  if (normalize(decodeEntities(region)) !== normalize(original)) {
    return {
      ok: false,
      code: 'mismatch',
      error: 'The source no longer matches the text on the page (it may have been edited elsewhere). Reload and try again.',
    };
  }

  // Preserve the region's leading/trailing whitespace (indentation). (spec §6.1)
  const lead = /^\s*/.exec(region)![0];
  const trail = lead.length === region.length ? '' : /\s*$/.exec(region)![0];
  const replacement = lead + escapeText(newText.trim()) + trail;

  return { ok: true, newSource: source.slice(0, from) + replacement + source.slice(to) };
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

export async function applyAstro(source: string, req: ApplyRequest): Promise<ApplyResult> {
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
  return patchAttribute(source, starts, el, req.targetType, req.original, req.newText);
}
