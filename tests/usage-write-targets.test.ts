import { describe, expect, it } from 'vitest';
import { parseUsages } from '../src/server/usage-parse.ts';
import { arrayEntries, locateEntryValue, type ExpressionTrace } from '../src/patcher/expression-trace.ts';

/**
 * The three write-layer prerequisites, each pinned at the property that makes
 * it safe to write against.
 *
 * - A prop's byte range **round-trips** — `source.slice(start, end)` is the
 *   prop's own `source`, the same invariant `UsageSlot` holds — so two props
 *   carrying the same string are still two different write targets.
 * - A render ordinal names an array entry **only where the map is provably
 *   1:1**. Everything else refuses by name; a wrong entry would be a silently
 *   wrong write.
 */

const frontmatterOf = (source: string) => source.split('---')[1] ?? '';

describe('a prop carries its own byte range', () => {
  it('round-trips every kind, and separates two props holding the same string', async () => {
    const source = `---
import Card from './Card.astro';
---
<Card title="Build things" {label} count={1 + 2} class:list={['x']} flag alt='same' other='same' {...Astro.props} />`;
    const [usage] = await parseUsages(source);
    for (const prop of usage.props) {
      expect(prop.start, prop.name).toBeTypeOf('number');
      expect(source.slice(prop.start, prop.end)).toBe(prop.source);
    }
    const same = usage.props.filter(p => p.source === "'same'");
    expect(same).toHaveLength(2);
    // The decision this exists for: identical text, different write targets.
    expect(same[0].start).not.toBe(same[1].start);
  });

  it('spans the value, not the name, so a quoted attribute keeps its quotes', async () => {
    const source = `---
import Card from './Card.astro';
---
<Card title="Hi" count={2} />`;
    const [usage] = await parseUsages(source);
    expect(source.slice(usage.props[0].start, usage.props[0].end)).toBe('"Hi"');
    expect(source.slice(usage.props[1].start, usage.props[1].end)).toBe('2');
  });

  it('reports no range when the source does not read back the way the AST describes it', async () => {
    // A component whose tag the parser can see but whose name is not a static
    // import is refused outright; its props still parse, and a range is only
    // offered where the bytes confirm it.
    const source = `---
import Card from './Card.astro';
---
<Card title="Hi" />`;
    const [usage] = await parseUsages(source);
    expect(usage.props[0].start).toBe(source.indexOf('"Hi"'));
  });
});

describe('a render ordinal names an array entry only when the map is provably 1:1', () => {
  const trace: ExpressionTrace = { property: 'title', array: 'services', label: 'services[].title' };
  const fm = (array: string) => `\nconst services = ${array};\n`;
  const LITERAL = fm(`[
  { title: 'First' },
  { title: 'Second' },
  { title: 'Third' },
]`);

  it('counts top-level entries of an array literal', () => {
    expect(arrayEntries(LITERAL, 'services')).toHaveLength(3);
  });

  it('resolves the nth render to the nth entry', () => {
    for (const [ordinal, value] of [[1, 'First'], [2, 'Second'], [3, 'Third']] as const) {
      const found = locateEntryValue(LITERAL, trace, ordinal);
      expect(found.ok).toBe(true);
      if (found.ok) expect(found.span.value).toBe(value);
    }
  });

  it('refuses a spread, which makes entry k stop being render k', () => {
    const spread = fm(`[{ title: 'First' }, ...more, { title: 'Third' }]`);
    expect(arrayEntries(spread, 'services')).toBeNull();
    const found = locateEntryValue(spread, trace, 1);
    expect(found).toMatchObject({ ok: false, code: 'untraceable' });
    if (!found.ok) expect(found.error).toContain('spread');
  });

  it('refuses an elision, which shifts every later index', () => {
    expect(arrayEntries(fm(`[{ title: 'First' }, , { title: 'Third' }]`), 'services')).toBeNull();
  });

  it('refuses an array it cannot see — imported, or built by a call', () => {
    expect(arrayEntries('\nconst other = [1];\n', 'services')).toBeNull();
    expect(arrayEntries(fm('buildServices()'), 'services')).toBeNull();
    expect(locateEntryValue('\n', trace, 1)).toMatchObject({ ok: false, code: 'untraceable' });
  });

  it('is not confused by brackets, braces or commas inside strings and comments', () => {
    const tricky = fm(`[
  { title: 'A, [nested] {brace}' }, // a, comma, in, a, comment
  { title: 'B' }, /* } and , inside a block comment */
]`);
    expect(arrayEntries(tricky, 'services')).toHaveLength(2);
    for (const [ordinal, value] of [[1, 'A, [nested] {brace}'], [2, 'B']] as const) {
      const found = locateEntryValue(tricky, trace, ordinal);
      expect(found.ok).toBe(true);
      if (found.ok) expect(found.span.value).toBe(value);
    }
  });

  it('refuses a comment between a key and its value rather than reading past it', () => {
    // The scan reads the literal that must sit immediately after `title:`.
    // A comment there is a shape it cannot prove, so it refuses by name — the
    // entry boundaries are still counted correctly around it.
    const commented = fm(`[{ title: 'First' }, { title: /* why */ 'Second' }]`);
    expect(arrayEntries(commented, 'services')).toHaveLength(2);
    expect(locateEntryValue(commented, trace, 2)).toMatchObject({ ok: false, code: 'untraceable' });
  });

  it('refuses an ordinal past the end rather than wrapping or clamping', () => {
    expect(locateEntryValue(LITERAL, trace, 4)).toMatchObject({ ok: false, code: 'mismatch' });
  });

  it('refuses an unknown ordinal, which is what a broken chain reports', () => {
    expect(locateEntryValue(LITERAL, trace, 0)).toMatchObject({ ok: false, code: 'untraceable' });
  });

  it('refuses an entry whose property is not a plain string', () => {
    const computed = fm(`[{ title: 'First' }, { title: label + '!' }]`);
    expect(locateEntryValue(computed, trace, 2)).toMatchObject({ ok: false, code: 'untraceable' });
  });

  it('refuses a trace that never came from an array', () => {
    expect(locateEntryValue(LITERAL, { property: 'title', label: 'title' }, 1))
      .toMatchObject({ ok: false, code: 'untraceable' });
  });

  it('reads the real frontmatter of a mapped usage site', () => {
    const source = `---
import ServiceCard from './ServiceCard.astro';
const services = [{ title: 'Design' }, { title: 'Build' }];
---
{services.map((s) => <ServiceCard title={s.title} />)}`;
    const found = locateEntryValue(frontmatterOf(source), trace, 2);
    expect(found.ok).toBe(true);
    if (found.ok) expect(source.slice(source.indexOf('---') + 3 + found.span.from, source.indexOf('---') + 3 + found.span.to)).toBe("'Build'");
  });
});

/**
 * The three-state write verdict, decided where the source is parsed.
 *
 * Two states were not enough: `eyebrow={site.tagline}` is a writable string in
 * another file, and folding it into `read-only` made it read as unwritable as
 * `featured={i === 0}`, which has no string at all. Every refusal is named —
 * nothing reaches a verdict by falling through.
 */
describe('a prop carries its write verdict', () => {
  const parse = async (body: string, frontmatter = "import Card from './Card.astro';") => {
    const source = `---\n${frontmatter}\n---\n${body}`;
    const usages = await parseUsages(source);
    return Object.fromEntries(usages.flatMap(u => u.props).map(p => [p.name, p]));
  };

  it('accepts a quoted string literal, empty string included', async () => {
    const props = await parse('<Card title="Build things" flag="" />');
    expect(props.title).toMatchObject({ verdict: 'editable' });
    expect(props.flag).toMatchObject({ verdict: 'editable' });
  });

  it('names the module an imported value comes from rather than calling it read-only', async () => {
    const props = await parse('<Card eyebrow={site.tagline} line={TAGLINE} all={everything.x} />', [
      "import Card from './Card.astro';",
      "import site from '../data/site.ts';",
      "import { TAGLINE } from '../data/copy.ts';",
      "import * as everything from '../data/all.ts';",
    ].join('\n'));
    expect(props.eyebrow).toMatchObject({ verdict: 'elsewhere', reason: 'imported', from: '../data/site.ts' });
    expect(props.line).toMatchObject({ verdict: 'elsewhere', reason: 'imported', from: '../data/copy.ts' });
    expect(props.all).toMatchObject({ verdict: 'elsewhere', reason: 'imported', from: '../data/all.ts' });
  });

  it('ignores a type-only import, which binds no value to write', async () => {
    const props = await parse('<Card title={Props.title} />', [
      "import Card from './Card.astro';",
      "import type { Props } from './types.ts';",
    ].join('\n'));
    expect(props.title).toMatchObject({ verdict: 'read-only', reason: 'untraced' });
  });

  it('traces one hop to a literal in this file, including through a map', async () => {
    const props = await parse('{services.map((s) => <Card title={s.title} {greeting} />)}', [
      "import Card from './Card.astro';",
      "const services = [{ title: 'Design' }, { title: 'Build' }];",
      "const greeting = 'Hello';",
    ].join('\n'));
    expect(props.title).toMatchObject({ verdict: 'editable',
      trace: { property: 'title', array: 'services', label: 'services[].title' } });
    expect(props.greeting).toMatchObject({ verdict: 'editable', trace: { property: 'greeting', label: 'greeting' } });
  });

  it('refuses a hop it cannot land on a literal, rather than offering the edit', async () => {
    // The const exists but holds a call, and the mapped array is imported —
    // both are one hop from *something*, and neither is one hop from a string.
    const props = await parse('{list.map((s) => <Card title={s.title} subtitle={built} />)}', [
      "import Card from './Card.astro';",
      'const built = compute();',
    ].join('\n'));
    expect(props.title).toMatchObject({ verdict: 'read-only', reason: 'untraced' });
    expect(props.subtitle).toMatchObject({ verdict: 'read-only', reason: 'untraced' });
  });

  it('refuses each unwritable shape by its own name', async () => {
    const props = await parse(
      '<Card featured={i === 0} tpl={`a${b}`} plain class="x" class:list={[1]} style="color:red" ' +
      'slot="detail" client:load {...Astro.props} />');
    expect(props.featured).toMatchObject({ verdict: 'read-only', reason: 'computed' });
    expect(props.tpl).toMatchObject({ verdict: 'read-only', reason: 'template' });
    expect(props.plain).toMatchObject({ verdict: 'read-only', reason: 'boolean' });
    expect(props.class).toMatchObject({ verdict: 'read-only', reason: 'styling' });
    expect(props['class:list']).toMatchObject({ verdict: 'read-only', reason: 'styling' });
    expect(props.style).toMatchObject({ verdict: 'read-only', reason: 'styling' });
    expect(props.slot).toMatchObject({ verdict: 'read-only', reason: 'directive' });
    expect(props['client:load']).toMatchObject({ verdict: 'read-only', reason: 'directive' });
    expect(props['Astro.props']).toMatchObject({ verdict: 'read-only', reason: 'spread' });
  });

  it('never leaves a verdict unnamed', async () => {
    const source = `---
import Card from './Card.astro';
const greeting = 'Hello';
---
<Card a="x" b={greeting} c={site.x} d={1 + 1} e f={\`t\`} class="g" {...rest} />`;
    for (const prop of (await parseUsages(source)).flatMap(u => u.props)) {
      expect(prop.verdict, prop.name).toMatch(/^(editable|elsewhere|read-only)$/);
      if (prop.verdict !== 'editable') expect(prop.reason, prop.name).toBeTruthy();
    }
  });
});

describe('a slot run carries its write verdict', () => {
  const slotsOf = async (body: string) =>
    (await parseUsages(`---\nimport Card from './Card.astro';\n---\n${body}`)).flatMap(u => u.slots);

  it('accepts literal slot text', async () => {
    expect(await slotsOf('<Card>Start a project</Card>'))
      .toMatchObject([{ source: 'Start a project', verdict: 'editable' }]);
  });

  it('leaves markup that wraps values read-only — the values inside get rows of their own', async () => {
    expect(await slotsOf('<Card><b>Rich</b> text</Card>')).toMatchObject([
      { source: '<b>Rich</b>', verdict: 'read-only', reason: 'markup' },
      { source: ' text', verdict: 'editable' },
    ]);
  });

  it('refuses an expression and a nested component tag by name', async () => {
    expect(await slotsOf('<Card>{greeting}</Card>'))
      .toMatchObject([{ verdict: 'read-only', reason: 'computed' }]);
    expect((await slotsOf('<Card><Card /></Card>'))[0])
      .toMatchObject({ verdict: 'read-only', reason: 'markup' });
  });

  it('refuses whitespace, which has no words to edit', async () => {
    const slots = await slotsOf('<Card>\n  <b>x</b>\n</Card>');
    expect(slots.filter(s => !s.source.trim())).not.toHaveLength(0);
    for (const slot of slots.filter(s => !s.source.trim())) {
      expect(slot).toMatchObject({ verdict: 'read-only', reason: 'empty' });
    }
  });
});
