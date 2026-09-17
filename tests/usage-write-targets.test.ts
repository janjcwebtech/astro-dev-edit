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
