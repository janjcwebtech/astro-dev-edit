import { parse } from '@astrojs/compiler';
import { init, parse as parseImports } from 'es-module-lexer';
import { attrSpan, tagEnd, type TagAttribute } from './astro-tag-end.ts';
import { expressionRoot, hasCandidates, traceExpressionSource } from '../patcher/expression-trace.ts';
import type { CompositionRefusal, UsageProp, UsageSlot, UsageWrite } from '../shared/protocol.ts';

interface Node {
  type: string;
  name?: string;
  value?: string;
  kind?: string;
  raw?: string;
  position?: { start: { offset: number; line: number; column: number }; end?: { offset: number; line: number; column: number } };
  attributes?: Node[];
  children?: Node[];
}
export interface ParsedUsage {
  name: string;
  loc: string;
  offset: number;
  injectionOffset?: number;
  specifier?: string;
  refusal?: CompositionRefusal;
  hasSpread: boolean;
  props: UsageProp[];
  slots: UsageSlot[];
}

/** Styling, not content — the one prop group refused by name rather than by
 *  shape, because `class="hero"` is a perfectly ordinary quoted literal. */
const STYLING = new Set(['class', 'class:list', 'style']);

/** Every local name a static import statement binds — default, namespace and
 *  named, with `as` aliases resolved to the local side. A type-only import
 *  binds no value and is skipped. */
function importedBindings(statement: string): string[] {
  const clause = /^import\s+([\s\S]*?)\s*from\s*['"]/.exec(statement)?.[1];
  if (!clause || /^type\s/.test(clause)) return [];
  const names: string[] = [];
  for (const part of (/\{([\s\S]*)\}/.exec(clause)?.[1] ?? '').split(',')) {
    const local = part.trim().split(/\s+as\s+/).pop()?.trim();
    if (local && /^[A-Za-z_$][\w$]*$/.test(local)) names.push(local);
  }
  for (const m of clause.replace(/\{[\s\S]*\}/, '')
    .matchAll(/(?:^|,)\s*(?:\*\s*as\s*)?([A-Za-z_$][\w$]*)/g)) names.push(m[1]);
  return names;
}

/** Rule 6, as one gate: an `editable` verdict needs bytes that read back the
 *  way the AST described them. Without a proven, round-tripping range there is
 *  no write target, so the verdict is a refusal rather than a hope. */
function located(source: string, span: { start?: number; end?: number; source: string }, write: UsageWrite): UsageWrite {
  return typeof span.start === 'number' && typeof span.end === 'number' &&
    source.slice(span.start, span.end) === span.source
    ? write : { verdict: 'read-only', reason: 'unlocated' };
}

/**
 * The write verdict for one prop at a usage site, decided where the source is
 * parsed and the byte range is already proven.
 *
 * Every branch names its reason and the chain of checks is exhaustive: an
 * attribute shape this parser does not model reaches `unsupported`, never a
 * silent `editable`. `elsewhere` *names* the module a value is imported from
 * and deliberately does not resolve it — no transitive chase (#61's own rule).
 */
function propWrite(
  prop: { name: string; kind: string; source: string; start?: number; end?: number },
  context: { source: string; frontmatter: string; enclosingHead: string | null; values: Map<string, string> },
): UsageWrite {
  const { name, kind, source } = prop;
  if (STYLING.has(name)) return { verdict: 'read-only', reason: 'styling' };
  if (name === 'slot' || name.includes(':')) return { verdict: 'read-only', reason: 'directive' };
  if (kind === 'spread') return { verdict: 'read-only', reason: 'spread' };
  if (kind === 'empty') return { verdict: 'read-only', reason: 'boolean' };
  if (kind === 'quoted') return located(context.source, prop, { verdict: 'editable' });
  if (kind === 'template-literal') return { verdict: 'read-only', reason: 'template' };
  if (kind !== 'expression' && kind !== 'shorthand') return { verdict: 'read-only', reason: 'unsupported' };
  if (source.trimStart().startsWith('`')) return { verdict: 'read-only', reason: 'template' };
  const root = expressionRoot(source);
  if (!root) return { verdict: 'read-only', reason: 'computed' };
  const from = context.values.get(root);
  if (from) return { verdict: 'elsewhere', reason: 'imported', from };
  const trace = traceExpressionSource(source, context.enclosingHead);
  if (!trace || !hasCandidates(context.frontmatter, trace)) return { verdict: 'read-only', reason: 'untraced' };
  return located(context.source, prop, { verdict: 'editable', trace });
}

/**
 * The write verdict for one run of slot children.
 *
 * Only literal text is editable. Markup that *wraps* values stays read-only on
 * purpose — the values inside it are annotated elements with rows of their own
 * (WF-4 item 9), and rewriting the wrapper as a string would edit structure
 * while pretending to edit words.
 */
function slotWrite(type: string, slot: { start: number; end: number; source: string }, source: string): UsageWrite {
  if (source.slice(slot.start, slot.end) !== slot.source) return { verdict: 'read-only', reason: 'unlocated' };
  if (type !== 'text') return { verdict: 'read-only', reason: type === 'expression' ? 'computed' : 'markup' };
  if (!slot.source.trim()) return { verdict: 'read-only', reason: 'empty' };
  // A bracket inside a range the AST called text means the bytes carry
  // structure, and a whole-value write would change it rather than the words.
  if (/[<>{}]/.test(slot.source)) return { verdict: 'read-only', reason: 'markup' };
  return { verdict: 'editable' };
}

/** AST locations and import lexer ranges come from the untouched source. */
export async function parseUsages(source: string): Promise<ParsedUsage[]> {
  const { ast } = await parse(source, { position: true });
  const root = ast as unknown as Node;
  const frontmatter = root.children?.find(n => n.type === 'frontmatter')?.value ?? '';
  const imports = new Map<string, string>();
  /** Every imported *value* name, which is a wider set than the component map:
   *  a prop reads `site.tagline` however `site` arrived, and the verdict only
   *  ever names that module — it never resolves or follows it. */
  const values = new Map<string, string>();
  await init;
  try {
    for (const entry of parseImports(frontmatter)[0]) {
      if (entry.d !== -1 || !entry.n) continue;
      const statement = frontmatter.slice(entry.ss, entry.se);
      // Deliberately narrow: only a default import of a bare identifier.
      // The lexer excludes comments, strings and dynamic import() expressions.
      const match = /^import\s+([A-Za-z_$][\w$]*)\s+from\s*['"]/.exec(statement);
      if (match) imports.set(match[1], entry.n);
      for (const name of importedBindings(statement)) values.set(name, entry.n);
    }
  } catch { /* Unreadable imports leave usages explicitly dynamic. */ }
  const usages: ParsedUsage[] = [];
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  // Compiler offsets are bytes; columns use the patcher's UTF-16 convention.
  const indexAt = (pos: { line: number; column: number }) => starts[pos.line - 1] + pos.column - 1;
  // An enclosing expression is read twice: its whole text says whether it
  // shadows a component name, and its *head* is what binds a `.map()`
  // parameter for a one-hop prop trace.
  const walk = (node: Node, expressions: { text: string; head: string }[]) => {
    const parts = node.type === 'expression'
      ? (node.children ?? []).filter(n => n.type === 'text').map(n => n.value ?? '') : [];
    const context = node.type === 'expression'
      ? [...expressions, { text: parts.join(' '), head: parts[0] ?? '' }]
      : expressions;
    if (node.type === 'component' && node.name && node.position) {
      const attrs = node.attributes ?? [];
      const self = node.name === 'Astro.self';
      const shadowed = context.some(({ text }) => text.split(/[^\w$]+/).includes(node.name!));
      const refusal: CompositionRefusal | undefined =
        attrs.some(a => a.name === 'client:only' || a.name === 'server:defer' || a.name === 'set:html') ? 'chain-break'
        : attrs.some(a => a.name === 'data-atx-chain') ? 'reserved-attribute'
        : !self && node.name.includes('.') ? 'namespaced'
        : !self && (!imports.has(node.name) || shadowed) ? 'dynamic' : undefined;
      const start = node.position.start;
      let offset = indexAt(start);
      // A leading, childless component without frontmatter is reported at
      // its name by the Go parser. Normalize usage sites to the opening '<'.
      if (source[offset] !== '<' && source[offset - 1] === '<') offset--;
      const column = start.column + offset - indexAt(start);
      usages.push({
        name: node.name, loc: `${start.line}:${column}`, offset,
        injectionOffset: tagEnd(source, offset, node.name, attrs as TagAttribute[])?.insert,
        specifier: self ? undefined : imports.get(node.name), refusal,
        hasSpread: attrs.some(a => a.kind === 'spread'),
        props: attrs.map((a): UsageProp => {
          // The byte range is proven, not searched: two props on one tag can
          // hold the same string, so a value is identified by where it is.
          const span = attrSpan(source, a as TagAttribute);
          const prop = {
            name: a.name ?? '', kind: a.kind ?? '',
            source: a.raw || a.value || a.name || '',
            ...(span ? { start: span.start, end: span.end } : {}),
          };
          return { ...prop, ...propWrite(prop, {
            source, frontmatter, values,
            enclosingHead: context.at(-1)?.head ?? null,
          }) };
        }),
        slots: (node.children ?? []).flatMap((n, i, children) => {
          if (!n.position) return [];
          const start = indexAt(n.position.start);
          // Self-closing nodes have no end position. Their next sibling (or
          // the parent's closing tag) supplies the exact slot-content limit.
          const next = children.slice(i + 1).find(child => child.position)?.position?.start;
          const end = n.position.end ? indexAt(n.position.end) : next ? indexAt(next)
            : node.position?.end ? source.lastIndexOf('</', indexAt(node.position.end) - 1) : -1;
          if (end < start) return [];
          const slot = { name: n.attributes?.find(a => a.name === 'slot')?.value ?? 'default',
            start, end, source: source.slice(start, end) };
          return [{ ...slot, ...slotWrite(n.type, slot, source) } satisfies UsageSlot];
        }),
      });
    }
    for (const child of node.children ?? []) walk(child, context);
  };
  walk(root, []);
  return usages;
}
