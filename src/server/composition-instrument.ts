import { parse } from '@astrojs/compiler';
import type { UsageLink } from '../shared/protocol.ts';
import { tagEnd, type TagAttribute } from './astro-tag-end.ts';

interface Node {
  type: string;
  name?: string;
  position?: { start: { line: number; column: number }; end?: { line: number; column: number } };
  children?: Node[];
  attributes?: TagAttribute[];
}

/** All edits refer to the untouched source. New frontmatter can add lines;
 * the original annotation coordinates remain authoritative for editing. */
export async function prepareComposition(source: string, file: string, links: readonly UsageLink[], runtime: string) {
  const { ast } = await parse(source, { position: true });
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
  const at = (p: { line: number; column: number }) => starts[p.line - 1] + p.column - 1;
  let alias = '__atxRuntime';
  while (source.includes(alias)) alias += '_';
  let trace = '__atxRender';
  while (source.includes(trace)) trace += '_';
  const insertions: { index: number; text: string; deleteCount?: number }[] = [];
  const setup = `import * as ${alias} from ${JSON.stringify(runtime)};const ${trace}=${alias}.begin(Astro.props,${JSON.stringify(file)},Astro.request);`;
  const frontmatter = (ast as unknown as Node).children?.find(n => n.type === 'frontmatter');
  if (frontmatter?.position) {
    const start = source.indexOf('\n', at(frontmatter.position.start)) + 1;
    insertions.push({ index: start, text: setup + (source.startsWith('---', start) ? '\n' : '') });
  } else insertions.push({ index: 0, text: `---\n${setup}\n---\n` });

  for (const link of links) {
    if (link.file !== file || !link.target || link.refusal) continue;
    if (link.injectionOffset === undefined) throw new Error(`Cannot safely instrument ${file}:${link.loc}`);
    insertions.push({ index: link.injectionOffset,
      text: ` {...${alias}.child(${trace},${JSON.stringify(link.id)},${JSON.stringify(link.target)})}` });
  }
  const walk = (node: Node, inExpression = false) => {
    if (node.name === 'slot' && node.position) {
      const attrs = node.attributes ?? [];
      const name = attrs.find(a => a.name === 'name');
      if (name && name.kind !== 'quoted') throw new Error('Dynamic slot names cannot be traced');
      let start = at(node.position.start);
      if (source[start] !== '<' && source[start - 1] === '<') start--;
      const opening = tagEnd(source, start, 'slot', attrs);
      const end = opening && source[opening.end - 2] === '/' ? opening.end
        : node.position.end ? at(node.position.end) : undefined;
      if (!opening || end === undefined) throw new Error(`Cannot safely trace a slot in ${file}`);
      const slotName = JSON.stringify(name?.value ?? 'default');
      const forwarded = attrs.find(a => a.name === 'slot');
      if (forwarded && forwarded.kind !== 'quoted') throw new Error('Dynamic forwarded slot names cannot be traced');
      if (forwarded) {
        const attrStart = forwarded.position && at(forwarded.position.start);
        const equals = attrStart === undefined ? null : /^slot\s*=\s*/.exec(source.slice(attrStart));
        if (attrStart === undefined || !equals || !forwarded.raw) throw new Error('Cannot move forwarded slot assignment');
        const width = equals[0].length + forwarded.raw.length;
        insertions.push({ index: attrStart, deleteCount: width,
          text: source.slice(attrStart, attrStart + width).replace(/[^\r\n]/g, ' ') });
      }
      const loc = `${node.position.start.line}:${node.position.start.column + start - at(node.position.start)}`;
      // The wrapper is an Astro expression container, so it needs braces in
      // markup position — but inside an expression that already opened one, `{`
      // would start an object literal and the JS never parses. A forwarded-slot
      // Fragment re-enters markup, so it puts the braces back.
      const braced = !inExpression || Boolean(forwarded);
      insertions.push({ index: start, text: (forwarded ? `<Fragment slot=${forwarded.raw}>` : '') +
        `${braced ? '{' : ''}${alias}.slot(${trace},${slotName},${JSON.stringify(loc)},!Astro.slots.has(${slotName}),<>` });
      insertions.push({ index: end, text: `</>)${braced ? '}' : ''}` + (forwarded ? '</Fragment>' : '') });
    }
    for (const child of node.children ?? []) walk(child, inExpression || node.type === 'expression');
  };
  walk(ast as unknown as Node);
  return { insertions, trace };
}
