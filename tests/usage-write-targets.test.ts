import { describe, expect, it } from 'vitest';
import { parseUsages, proveEntry, proveLink } from '../src/server/usage-parse.ts';
import { arrayEntries, locateEntryValue, type ExpressionTrace } from '../src/patcher/expression-trace.ts';
import type { UsageLink, UsageWrite } from '../src/shared/protocol.ts';

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

  it('traces one hop to a literal in this file', async () => {
    const props = await parse('<Card title={greeting} />', [
      "import Card from './Card.astro';",
      "const greeting = 'Hello';",
    ].join('\n'));
    expect(props.title).toMatchObject({ verdict: 'editable', trace: { property: 'greeting', label: 'greeting' } });
  });

  /**
   * The trace resolves and the array holds matching literals — and that is
   * still not a write target. `hasCandidates` proves *some* entry matches, and
   * every card in the loop shares one usage site, so an `editable` verdict here
   * would give ten identical cards ten fields all aimed at entry 1.
   * `locateEntryValue` proves the entry from the render ordinal; until that
   * ordinal reaches the verdict the refusal is named rather than assumed.
   */
  it('refuses a mapped value by name until the render ordinal proves its entry', async () => {
    const props = await parse('{services.map((s) => <Card title={s.title} {greeting} />)}', [
      "import Card from './Card.astro';",
      "const services = [{ title: 'Design' }, { title: 'Build' }];",
      "const greeting = 'Hello';",
    ].join('\n'));
    // The refusal carries the trace, because it is the one refusal that can be
    // earned back — nothing else would let the ordinal name the entry later.
    expect(props.title).toMatchObject({ verdict: 'read-only', reason: 'unproven-entry',
      trace: { property: 'title', array: 'services', label: 'services[].title' } });
    // A value that does not read from an array is unambiguous and stays editable,
    // in the same loop — the refusal is about the array, not about the `.map()`.
    expect(props.greeting).toMatchObject({ verdict: 'editable', trace: { property: 'greeting', label: 'greeting' }, value: 'Hello' });
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

/**
 * Earning the refusal back.
 *
 * `unproven-entry` is not a permanent verdict — it is the one that waits for a
 * fact the static index cannot have. `proveEntry` is where the render ordinal
 * arrives, and it may only ever turn that single refusal into `editable`: a
 * wrong entry is a silently wrong write, so every check `locateEntryValue`
 * makes has to still be reachable from here.
 */
describe('a render ordinal earns back the unproven-entry refusal', () => {
  const mapped = (frontmatter: string, body = '{services.map((s) => <Card title={s.title} />)}') =>
    parseUsages(`---\nimport Card from './Card.astro';\n${frontmatter}\n---\n${body}`);
  const LITERAL = "const services = [{ title: 'Design' }, { title: 'Build' }];";
  const fm = (source: string) => source.split('---')[1] ?? '';
  const write = async (frontmatter: string, ordinal: number): Promise<UsageWrite> => {
    const source = `---\nimport Card from './Card.astro';\n${frontmatter}\n---\n{services.map((s) => <Card title={s.title} />)}`;
    const [usage] = await parseUsages(source);
    return proveEntry(fm(source), usage.props[0], ordinal);
  };

  it('names the entry the ordinal points at, and carries its words', async () => {
    expect(await write(LITERAL, 1)).toMatchObject({ verdict: 'editable', value: 'Design' });
    expect(await write(LITERAL, 2)).toMatchObject({ verdict: 'editable', value: 'Build' });
  });

  it('keeps refusing the 0 a broken chain reports, and an ordinal past the end', async () => {
    for (const ordinal of [0, 3, -1, 1.5]) {
      expect(await write(LITERAL, ordinal), String(ordinal))
        .toMatchObject({ verdict: 'read-only', reason: 'unproven-entry' });
    }
  });

  it('keeps refusing a spread array and a duplicated property, which the ordinal cannot settle', async () => {
    for (const frontmatter of [
      "const services = [{ title: 'Design' }, ...more];",
      "const services = [{ title: 'Design', title: 'Again' }];",
    ]) {
      expect(await write(frontmatter, 1), frontmatter)
        .toMatchObject({ verdict: 'read-only', reason: 'unproven-entry' });
    }
  });

  it('leaves an array it never proved at all refused earlier, and by its own name', async () => {
    // Neither of these reaches `unproven-entry`: a built array has no literals
    // to find, and an imported name is a value in another module. The ordinal
    // has nothing to earn back, which is the point of naming refusals apart.
    const [built] = await mapped('const services = buildServices();');
    expect(built.props[0]).toMatchObject({ verdict: 'read-only', reason: 'untraced' });
    // An imported array is `untraced` rather than `elsewhere`: the prop reads
    // `s.title`, and `s` is the loop's own parameter — no import binds it, so
    // there is no module to name. `elsewhere` belongs to a prop that reads the
    // imported name itself.
    const [imported] = await mapped("import { services } from '../data/services.ts';");
    expect(imported.props[0]).toMatchObject({ verdict: 'read-only', reason: 'untraced' });
    const [direct] = await mapped("import { services } from '../data/services.ts';",
      '<Card title={services} />');
    expect(direct.props[0]).toMatchObject({ verdict: 'elsewhere', from: '../data/services.ts' });
  });

  it('touches nothing but that one refusal', async () => {
    const [usage] = await mapped(LITERAL,
      '{services.map((s) => <Card title={s.title} label="Static" featured={s === 0} />)}');
    const proven = proveLink({ id: 'aaaaaaaa', file: '/Page.astro', loc: '5:20', offset: 0,
      name: 'Card', hasSpread: false, props: usage.props, slots: usage.slots } satisfies UsageLink,
      "\nconst services = [{ title: 'Design' }, { title: 'Build' }];\n", 2);
    expect(proven.props.map(p => [p.name, p.verdict, p.value])).toEqual([
      ['title', 'editable', 'Build'], ['label', 'editable', 'Static'], ['featured', 'read-only', undefined],
    ]);
    // The byte range survives the upgrade: it is what a quoted write targets.
    expect(proven.props[1].start).toBe(usage.props[1].start);
  });
});

/**
 * Every `editable` verdict knows its words.
 *
 * The bytes are not the words: `"Protected"` carries its own quotes, `{title}`
 * carries none of them, and a field that edited either as written would be
 * editing syntax. `value` is what the field shows and what the write verifies.
 */
describe('an editable value carries the words, not the bytes', () => {
  it('separates a quoted attribute from its quotes and its entities', async () => {
    const source = `---\nimport Card from './Card.astro';\n---\n<Card a="x &amp; y &lt; z" b="Plain" />`;
    const [usage] = await parseUsages(source);
    // The compiler truncates `raw` around an entity; the span is proved against
    // the decoded value instead, so it still reaches the closing quote.
    expect(usage.props[0]).toMatchObject({ verdict: 'editable', source: '"x &amp; y &lt; z"', value: 'x & y < z' });
    expect(source.slice(usage.props[0].start, usage.props[0].end)).toBe('"x &amp; y &lt; z"');
    expect(usage.props[1]).toMatchObject({ source: '"Plain"', value: 'Plain' });
  });

  it('gives a slot run its text, entities decoded', async () => {
    const [usage] = await parseUsages(`---\nimport Card from './Card.astro';\n---\n<Card>Start &amp; finish</Card>`);
    expect(usage.slots[0]).toMatchObject({ verdict: 'editable', source: 'Start &amp; finish', value: 'Start & finish' });
  });

  it('gives a traced prop the literal it reads, never the expression that reads it', async () => {
    const [usage] = await parseUsages(
      `---\nimport Card from './Card.astro';\nconst greeting = 'Hello there';\n---\n<Card title={greeting} />`);
    expect(usage.props[0]).toMatchObject({ source: 'greeting', value: 'Hello there' });
  });

  it('never leaves an editable verdict without one', async () => {
    const source = `---
import Card from './Card.astro';
const greeting = 'Hello';
---
<Card a="x" b={greeting} c={site.x} d={1 + 1} e f={\`t\`} class="g" {...rest}>words</Card>`;
    const [usage] = await parseUsages(source);
    for (const value of [...usage.props, ...usage.slots]) {
      if (value.verdict === 'editable') expect(value.value, value.name).toBeTypeOf('string');
      else expect(value.value, value.name).toBeUndefined();
    }
  });
});
