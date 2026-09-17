import { describe, expect, it } from 'vitest';
import { parseUsages } from '../src/server/usage-parse.ts';
import { applyUsageWrite } from '../src/server/usage-write.ts';
import type { UsageApplyTarget } from '../src/shared/protocol.ts';

/**
 * Writing a value at a component usage site.
 *
 * Three destinations, one contract: **content is accepted, source syntax is
 * preserved**. Braces, angle brackets and quotes are words, and each is
 * encoded for the destination it is going to — so the file keeps working and
 * the value reads back as exactly what was typed. A write that cannot prove
 * that round-trip leaves the source untouched.
 */

const FRONTMATTER = [
  "import Card from './Card.astro';",
  "const greeting = 'Hello there';",
  "const cards = [{ title: 'Card one' }, { title: 'Card two' }];",
].join('\n');
const file = (body: string, frontmatter = FRONTMATTER) => `---\n${frontmatter}\n---\n${body}`;

/** The same lookup the route does: the usage's own loc and name from the
 *  index, and the byte offset the panel was shown. */
async function write(source: string, pick: { name: string; kind: 'prop' | 'slot' }, newText: string, ordinal = 0) {
  const usages = await parseUsages(source);
  for (const usage of usages) {
    const pool = pick.kind === 'prop' ? usage.props : usage.slots;
    const value = pool.find(candidate => candidate.name === pick.name);
    if (!value || value.start === undefined) continue;
    const target: UsageApplyTarget = { kind: pick.kind, name: pick.name, start: value.start };
    return applyUsageWrite(source, { loc: usage.loc, name: usage.name, target, ordinal,
      original: value.value ?? value.source, newText });
  }
  throw new Error(`no ${pick.kind} named ${pick.name}`);
}

describe('a quoted prop is written at its own byte range', () => {
  it('replaces one value and leaves everything else byte-identical', async () => {
    const source = file('<Card title="Protected" other="Protected" />');
    const result = await write(source, { name: 'title', kind: 'prop' }, 'Guarded');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.newSource).toBe(file('<Card title="Guarded" other="Protected" />'));
  });

  it('accepts quotes, braces and angle brackets as words, and reads them back', async () => {
    for (const value of ['a "quoted" word', "it's fine", '{braces} & <angles>', '5 > 3 && 2 < 4']) {
      const result = await write(file('<Card title="Protected" />'), { name: 'title', kind: 'prop' }, value);
      expect(result.ok, value).toBe(true);
      if (!result.ok) continue;
      const [usage] = await parseUsages(result.newSource);
      expect(usage.props[0].value, value).toBe(value);
    }
  });

  it('keeps the quote style the source already uses', async () => {
    const result = await write(file("<Card title='Protected' />"), { name: 'title', kind: 'prop' }, 'say "hi"');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.newSource).toContain(`title='say "hi"'`);
  });

  it('refuses a stale original rather than overwriting it', async () => {
    const source = file('<Card title="Protected" />');
    const [usage] = await parseUsages(source);
    const result = await applyUsageWrite(source, {
      loc: usage.loc, name: 'Card', ordinal: 0,
      target: { kind: 'prop', name: 'title', start: usage.props[0].start! },
      original: 'Something else', newText: 'Guarded',
    });
    expect(result).toMatchObject({ ok: false, code: 'mismatch' });
  });

  it('refuses a value the verdict never called editable', async () => {
    const source = file('<Card featured={i === 0} class="hero" {...Astro.props} />');
    for (const name of ['featured', 'class', 'Astro.props']) {
      const result = await write(source, { name, kind: 'prop' }, 'x');
      expect(result, name).toMatchObject({ ok: false });
    }
  });

  it('refuses a line break, which would move every usage site below it', async () => {
    expect(await write(file('<Card title="Protected" />'), { name: 'title', kind: 'prop' }, 'a\nb'))
      .toMatchObject({ ok: false, code: 'unsupported' });
  });

  it('refuses an offset that names nothing the parser found', async () => {
    const source = file('<Card title="Protected" />');
    const [usage] = await parseUsages(source);
    const result = await applyUsageWrite(source, {
      loc: usage.loc, name: 'Card', ordinal: 0,
      target: { kind: 'prop', name: 'title', start: 0 },
      original: 'Protected', newText: 'Guarded',
    });
    expect(result).toMatchObject({ ok: false, code: 'unresolved' });
  });
});

describe('a traced prop is written where the words live, not where they are read', () => {
  it('writes the frontmatter const and never touches the tag', async () => {
    const source = file('<Card title={greeting} />');
    const result = await write(source, { name: 'title', kind: 'prop' }, 'Good evening');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newSource).toContain("const greeting = 'Good evening';");
      expect(result.newSource).toContain('<Card title={greeting} />');
    }
  });

  /**
   * The case the whole ordinal mechanism exists for: two cards, one usage
   * site, one source loc. Typing in card 2 must move entry 2.
   */
  it('writes the array entry the render ordinal names, and no other', async () => {
    const source = file('{cards.map((c) => <Card title={c.title} />)}');
    const usages = await parseUsages(source);
    const start = usages[0].props[0].start!;
    const at = (ordinal: number, original: string, newText: string) => applyUsageWrite(source, {
      loc: usages[0].loc, name: 'Card', ordinal, original, newText,
      target: { kind: 'prop', name: 'title', start },
    });
    const second = await at(2, 'Card two', 'Second card');
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.newSource).toContain("[{ title: 'Card one' }, { title: 'Second card' }]");
    }
    const first = await at(1, 'Card one', 'First card');
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.newSource).toContain("[{ title: 'First card' }, { title: 'Card two' }]");
    // The ordinal has to agree with the words the panel showed: entry 1 does
    // not read "Card two", so nothing is written.
    expect(await at(1, 'Card two', 'Nope')).toMatchObject({ ok: false, code: 'mismatch' });
    expect(await at(0, 'Card two', 'Nope')).toMatchObject({ ok: false, code: 'dynamic' });
    expect(await at(3, 'Card two', 'Nope')).toMatchObject({ ok: false, code: 'dynamic' });
  });

  it('escapes the quote and the backslash the literal is written with', async () => {
    const source = file("<Card title={greeting} />");
    const result = await write(source, { name: 'title', kind: 'prop' }, `it's a back\\slash`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const [usage] = await parseUsages(result.newSource);
      expect(usage.props[0].value).toBe(`it's a back\\slash`);
    }
  });
});

describe('literal slot text is written in the caller’s own file', () => {
  it('replaces the words and keeps the run’s indentation', async () => {
    const source = file('<Card>\n  Start a project\n</Card>');
    const usages = await parseUsages(source);
    const slot = usages[0].slots.find(s => s.verdict === 'editable')!;
    const result = await applyUsageWrite(source, {
      loc: usages[0].loc, name: 'Card', ordinal: 0,
      target: { kind: 'slot', name: slot.name, start: slot.start },
      original: slot.value!, newText: 'Book a call',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.newSource).toBe(file('<Card>\n  Book a call\n</Card>'));
  });

  it('encodes what would otherwise become structure, and reads it back', async () => {
    for (const value of ['tags <b>and</b> braces {x}', 'a & b', '} stray {']) {
      const result = await write(file('<Card>Start a project</Card>'), { name: 'default', kind: 'slot' }, value);
      expect(result.ok, value).toBe(true);
      if (!result.ok) continue;
      const [usage] = await parseUsages(result.newSource);
      expect(usage.slots[0], value).toMatchObject({ verdict: 'editable', value });
    }
  });

  it('refuses markup that wraps values, and refuses emptying a slot', async () => {
    expect(await write(file('<Card><b>Rich</b></Card>'), { name: 'default', kind: 'slot' }, 'x'))
      .toMatchObject({ ok: false });
    expect(await write(file('<Card>Start a project</Card>'), { name: 'default', kind: 'slot' }, '   '))
      .toMatchObject({ ok: false, code: 'unsupported' });
  });
});
