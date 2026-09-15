import { parse } from '@astrojs/compiler';
import { init, parse as parseImports } from 'es-module-lexer';
import type { CompositionRefusal, UsageProp, UsageSlot } from '../shared/protocol.ts';

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
  specifier?: string;
  refusal?: CompositionRefusal;
  hasSpread: boolean;
  props: UsageProp[];
  slots: UsageSlot[];
}

/** AST locations and import lexer ranges come from the untouched source. */
export async function parseUsages(source: string): Promise<ParsedUsage[]> {
  const { ast } = await parse(source, { position: true });
  const root = ast as unknown as Node;
  const frontmatter = root.children?.find(n => n.type === 'frontmatter')?.value ?? '';
  const imports = new Map<string, string>();
  await init;
  try {
    for (const entry of parseImports(frontmatter)[0]) {
      if (entry.d !== -1 || !entry.n) continue;
      // Deliberately narrow: only a default import of a bare identifier.
      // The lexer excludes comments, strings and dynamic import() expressions.
      const match = /^import\s+([A-Za-z_$][\w$]*)\s+from\s*['"]/.exec(
        frontmatter.slice(entry.ss, entry.se),
      );
      if (match) imports.set(match[1], entry.n);
    }
  } catch { /* Unreadable imports leave usages explicitly dynamic. */ }
  const usages: ParsedUsage[] = [];
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  // Compiler offsets are bytes; columns use the patcher's UTF-16 convention.
  const indexAt = (pos: { line: number; column: number }) => starts[pos.line - 1] + pos.column - 1;
  const walk = (node: Node, expressions: string[]) => {
    const context = node.type === 'expression'
      ? [...expressions, (node.children ?? []).filter(n => n.type === 'text').map(n => n.value ?? '').join(' ')]
      : expressions;
    if (node.type === 'component' && node.name && node.position) {
      const attrs = node.attributes ?? [];
      const self = node.name === 'Astro.self';
      const shadowed = context.some(text => text.split(/[^\w$]+/).includes(node.name!));
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
        specifier: self ? undefined : imports.get(node.name), refusal,
        hasSpread: attrs.some(a => a.kind === 'spread'),
        props: attrs.map(a => ({ name: a.name ?? '', kind: a.kind ?? '', source: a.raw || a.value || a.name || '' })),
        slots: (node.children ?? []).flatMap((n, i, children) => {
          if (!n.position) return [];
          const start = indexAt(n.position.start);
          // Self-closing nodes have no end position. Their next sibling (or
          // the parent's closing tag) supplies the exact slot-content limit.
          const next = children.slice(i + 1).find(child => child.position)?.position?.start;
          const end = n.position.end ? indexAt(n.position.end) : next ? indexAt(next)
            : node.position?.end ? source.lastIndexOf('</', indexAt(node.position.end) - 1) : -1;
          if (end < start) return [];
          return [{ name: n.attributes?.find(a => a.name === 'slot')?.value ?? 'default',
            start, end, source: source.slice(start, end) }];
        }),
      });
    }
    for (const child of node.children ?? []) walk(child, context);
  };
  walk(root, []);
  return usages;
}
