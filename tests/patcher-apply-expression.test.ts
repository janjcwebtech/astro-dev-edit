import { describe, expect, it } from 'vitest';
import { applyAstro } from '../src/patcher/astro.ts';
import { locOf } from './helpers.ts';

/**
 * The expression patch path: `{title}` and `{b.title}` traced back to the
 * frontmatter string they render, and edited there.
 *
 * `original` is the text the page showed. For a `.map()` loop it is also the
 * only thing identifying *which* item was clicked, so these tests pin both
 * halves of that contract: the right item is patched, and an ambiguous or
 * stale match writes nothing.
 */

const LOOP = `---
const benefits = [
  { tag: 'Context', title: 'Edit where you read' },
  { tag: 'Speed', title: 'A typo takes seconds' },
];
---
<div>
  {benefits.map((b) => (
    <article>
      <h3>{b.title}</h3>
    </article>
  ))}
</div>
`;

function req(src: string, needle: string, tag: string, original: string, newText: string) {
  return { loc: locOf(src, needle), tag, targetType: 'expression' as const, original, newText };
}

describe('applyAstro — expressions', () => {
  it('edits a plain frontmatter const behind {title}', async () => {
    const src = `---\nconst title = 'Old words';\n---\n<h1>{title}</h1>\n`;
    const res = await applyAstro(src, req(src, '{title}', 'h1', 'Old words', 'New words'));
    expect(res).toEqual({
      ok: true,
      newSource: `---\nconst title = 'New words';\n---\n<h1>{title}</h1>\n`,
    });
  });

  it('patches the mapped item the rendered text identifies — not the first one', async () => {
    const res = await applyAstro(
      LOOP,
      req(LOOP, '{b.title}', 'h3', 'A typo takes seconds', 'A typo takes moments'),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.newSource).toContain(`{ tag: 'Context', title: 'Edit where you read' }`);
      expect(res.newSource).toContain(`{ tag: 'Speed', title: 'A typo takes moments' }`);
    }
  });

  it('touches only the string — the loop, the sibling keys and the layout are untouched', async () => {
    const res = await applyAstro(
      LOOP,
      req(LOOP, '{b.title}', 'h3', 'Edit where you read', 'Edit in place'),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      const before = LOOP.split(`'Edit where you read'`);
      const after = res.newSource.split(`'Edit in place'`);
      expect(after[0]).toBe(before[0]);
      expect(after[1]).toBe(before[1]);
    }
  });

  it('keeps the quote style the source used, and escapes a quote in the new text', async () => {
    const src = `---\nconst title = "Old";\n---\n<h1>{title}</h1>\n`;
    const res = await applyAstro(src, req(src, '{title}', 'h1', 'Old', 'A "quoted" word'));
    expect(res).toEqual({
      ok: true,
      newSource: `---\nconst title = "A \\"quoted\\" word";\n---\n<h1>{title}</h1>\n`,
    });
  });

  it('refuses with mismatch when no item still reads that way', async () => {
    const res = await applyAstro(LOOP, req(LOOP, '{b.title}', 'h3', 'Never rendered', 'x'));
    expect(res).toMatchObject({ ok: false, code: 'mismatch' });
  });

  it('refuses as ambiguous when two items share the text, rather than guessing', async () => {
    const src = LOOP.replace(`'A typo takes seconds'`, `'Edit where you read'`);
    const res = await applyAstro(
      src,
      req(src, '{b.title}', 'h3', 'Edit where you read', 'Something else'),
    );
    expect(res).toMatchObject({ ok: false, code: 'ambiguous' });
  });

  it('refuses when the array is imported rather than declared here', async () => {
    const src =
      `---\nimport { benefits } from '../data.ts';\n---\n` +
      `<div>\n  {benefits.map((b) => (\n    <article>\n      <h3>{b.title}</h3>\n    </article>\n  ))}\n</div>\n`;
    const res = await applyAstro(src, req(src, '{b.title}', 'h3', 'Anything', 'x'));
    expect(res).toMatchObject({ ok: false, code: 'dynamic' });
    expect((res as { error: string }).error).toContain('imported');
  });

  it('refuses a computed expression', async () => {
    const src = `---\nconst n = 2;\n---\n<h1>{n + 1}</h1>\n`;
    const res = await applyAstro(src, req(src, '{n + 1}', 'h1', '3', '4'));
    expect(res).toMatchObject({ ok: false, code: 'dynamic' });
  });

  it('refuses a template literal carrying an interpolation', async () => {
    const src = '---\nconst who = "you";\nconst title = `Hello ${who}`;\n---\n<h1>{title}</h1>\n';
    const res = await applyAstro(src, req(src, '{title}', 'h1', 'Hello you', 'Hi you'));
    expect(res.ok).toBe(false);
  });

  it('edits a plain template literal (no interpolation), keeping its backticks', async () => {
    const src = '---\nconst title = `Old`;\n---\n<h1>{title}</h1>\n';
    const res = await applyAstro(src, req(src, '{title}', 'h1', 'Old', 'New'));
    expect(res).toEqual({
      ok: true,
      newSource: '---\nconst title = `New`;\n---\n<h1>{title}</h1>\n',
    });
  });

  it('is not confused by a matching string outside the array', async () => {
    const src =
      `---\nconst heading = 'Edit where you read';\n` +
      `const items = [{ title: 'Edit where you read' }];\n---\n` +
      `<ul>\n  {items.map((it) => (\n    <li>{it.title}</li>\n  ))}\n</ul>\n`;
    const res = await applyAstro(src, req(src, '{it.title}', 'li', 'Edit where you read', 'Changed'));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.newSource).toContain(`const heading = 'Edit where you read';`);
      expect(res.newSource).toContain(`{ title: 'Changed' }`);
    }
  });

  it('is not confused by the same key in a nested object', async () => {
    const src =
      `---\nconst items = [{ title: 'Outer', meta: { title: 'Inner' } }];\n---\n` +
      `<ul>\n  {items.map((it) => (\n    <li>{it.title}</li>\n  ))}\n</ul>\n`;
    const res = await applyAstro(src, req(src, '{it.title}', 'li', 'Outer', 'Changed'));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.newSource).toContain(`{ title: 'Changed', meta: { title: 'Inner' } }`);
  });

  it('refuses a shadowed parameter — the name is bound by something else', async () => {
    const src =
      `---\nconst items = [{ title: 'One' }];\n---\n` +
      `<ul>\n  {items.map((row) => (\n    <li>{it.title}</li>\n  ))}\n</ul>\n`;
    const res = await applyAstro(src, req(src, '{it.title}', 'li', 'One', 'Two'));
    expect(res).toMatchObject({ ok: false, code: 'dynamic' });
  });

  it('refuses a filtered chain, whose items no longer line up with the array', async () => {
    const src =
      `---\nconst items = [{ title: 'One' }, { title: 'Two' }];\n---\n` +
      `<ul>\n  {items.filter((i) => i.on).map((it) => (\n    <li>{it.title}</li>\n  ))}\n</ul>\n`;
    const res = await applyAstro(src, req(src, '{it.title}', 'li', 'One', 'Changed'));
    expect(res).toMatchObject({ ok: false, code: 'dynamic' });
  });
});
