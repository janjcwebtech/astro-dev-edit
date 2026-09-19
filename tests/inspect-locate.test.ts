import { describe, expect, it } from 'vitest';
import { literalBinding, locateSelector, resolveVariableTag } from '../src/server/inspect-locate.ts';
import { locOf } from './helpers.ts';

/**
 * Characterizes the CSS inspector's best-effort selector→line resolver: the
 * first place a class/id token is used as a selector, confined to <style> blocks
 * for .astro so markup class attributes don't get matched. A miss is null.
 */

const CSS = `:root {
  --ink: #111;
}

.hero-title {
  font-size: 3rem;
  color: var(--ink);
}

.hero-titles {
  font-size: 1rem;
}

#masthead {
  position: sticky;
}
`;

describe('locateSelector — plain .css', () => {
  it('finds a class selector line', () => {
    expect(locateSelector(CSS, '.hero-title', false)).toEqual({ line: 5, col: 1 });
  });

  it('finds an id selector line', () => {
    expect(locateSelector(CSS, '#masthead', false)).toEqual({ line: 14, col: 1 });
  });

  it('does not match a longer name that shares the prefix', () => {
    // ".accent" is absent even though ".hero-title" would substring-collide if
    // we searched without a token boundary.
    expect(locateSelector(CSS, '.accent', false)).toBeNull();
  });

  it('returns null when the selector is absent', () => {
    expect(locateSelector(CSS, '.nope', false)).toBeNull();
  });
});

const ASTRO = `---
const cls = 'hero-title';
---
<h1 class="hero-title accent">Hi</h1>
<p class="accent">Body</p>

<style>
  .hero-title {
    font-size: 3rem;
  }
  .accent {
    color: rebeccapurple;
  }
</style>
`;

describe('locateSelector — .astro (<style>-confined)', () => {
  it('finds the selector inside the <style> block, not the markup class attr', () => {
    // The `.hero-title` class attribute is on line 4; the selector is line 8.
    expect(locateSelector(ASTRO, '.hero-title', true)).toEqual({ line: 8, col: 3 });
  });

  it('finds a second selector in the same <style> block', () => {
    expect(locateSelector(ASTRO, '.accent', true)).toEqual({ line: 11, col: 3 });
  });

  it('returns null for a class that only appears in markup, never as a rule', () => {
    // No `.missing` rule exists; a markup-only class must not resolve.
    expect(locateSelector('<p class="missing"></p><style>.other{}</style>', '.missing', true)).toBeNull();
  });
});

/**
 * Issue #82. `<Wrapper>` parses as a component, so nothing annotates the
 * element it renders. When the name is a local const bound only to string
 * literals, the annotated element directly inside it proves where it is
 * written: downward, from the child's own AST parent, never by climbing.
 */
const NOTE_CARD = `---
const { title, href } = Astro.props;
const Wrapper = href ? 'a' : 'article';
---

<Wrapper
  class:list={['note-card']}
  href={href}
>
  <div class="note-card__text">
    <h2>{title}</h2>
  </div>
</Wrapper>
`;
/** The `<div>` directly inside: annotated at its first child, the newline. */
const CARD_CHILD = { loc: locOf(NOTE_CARD, '\n    <h2>'), tag: 'div' };

describe('resolveVariableTag — proven', () => {
  it('names the wrapper at its `<`, for either literal the binding can take', async () => {
    expect(CARD_CHILD.loc).toBe('10:32');
    const proof = { ok: true, loc: '6:1', name: 'Wrapper', tags: ['a', 'article'] };
    expect(await resolveVariableTag(NOTE_CARD, CARD_CHILD, 'a')).toEqual(proof);
    expect(await resolveVariableTag(NOTE_CARD, CARD_CHILD, 'article')).toEqual(proof);
  });

  it('proves through an expression and a fragment, which render no element', async () => {
    const source = `---\nconst Tag = open ? 'details' : 'div';\n---\n<Tag>{shown && <p>one</p>}<><span>two</span></></Tag>\n`;
    for (const [needle, tag] of [['one', 'p'], ['two', 'span']]) {
      expect(await resolveVariableTag(source, { loc: locOf(source, needle), tag }, 'details'))
        .toMatchObject({ ok: true, loc: '4:1', name: 'Tag', tags: ['details', 'div'] });
    }
  });

  it('is case-blind about the rendered tag, as the DOM is', async () => {
    const source = `---\nconst Tag = 'SECTION';\n---\n<Tag><p>x</p></Tag>\n`;
    expect(await resolveVariableTag(source, { loc: locOf(source, 'x<'), tag: 'p' }, 'section'))
      .toMatchObject({ ok: true, tags: ['SECTION'] });
  });
});

describe('resolveVariableTag — refused, fail closed', () => {
  const refusal = async (source: string, needle: string, tag: string, rendered: string) =>
    resolveVariableTag(source, { loc: locOf(source, needle), tag }, rendered);

  it('refuses an as-prop — a caller may pass a component', async () => {
    const source = `---\nconst { as: Tag = 'div' } = Astro.props;\n---\n<Tag><p>x</p></Tag>\n`;
    expect(await refusal(source, 'x<', 'p', 'div')).toEqual({ ok: false, reason: 'not-literal' });
  });

  it('refuses an imported component, which renders its own template', async () => {
    const source = `---\nimport Card from './Card.astro';\n---\n<Card><p>x</p></Card>\n`;
    expect(await refusal(source, 'x<', 'p', 'article')).toEqual({ ok: false, reason: 'not-literal' });
  });

  it('refuses <W><Inner /></W>: the child is annotated by Inner.astro, whose root is its parent', async () => {
    const inner = `<section><p>inner</p></section>\n`;
    expect(await refusal(inner, 'p>inner', 'section', 'a')).toEqual({ ok: false, reason: 'not-a-wrapper' });
  });

  it('refuses a child whose parent is an element — that element would carry the annotation', async () => {
    const source = `<ul><li>x</li></ul>\n`;
    expect(await refusal(source, 'x<', 'li', 'ul')).toEqual({ ok: false, reason: 'not-a-wrapper' });
  });

  it('refuses a name a .map() parameter rebinds', async () => {
    const source = `---\nconst Tag = 'li';\n---\n<ul>{items.map((Tag) => <Tag><b>k</b></Tag>)}</ul>\n`;
    expect(await refusal(source, 'k<', 'b', 'li')).toEqual({ ok: false, reason: 'not-literal' });
  });

  it('refuses a tag the binding cannot take', async () => {
    expect(await resolveVariableTag(NOTE_CARD, CARD_CHILD, 'section')).toEqual({ ok: false, reason: 'tag-mismatch' });
  });

  it('refuses a loc that names no element', async () => {
    expect(await resolveVariableTag(NOTE_CARD, { loc: '99:1', tag: 'div' }, 'a')).toEqual({ ok: false, reason: 'unresolved' });
  });
});

describe('literalBinding', () => {
  const bound = (frontmatter: string) => literalBinding(frontmatter, 'Tag');

  it.each([
    [`const Tag = href ? 'a' : 'article';`, ['a', 'article']],
    [`const Tag = 'h2' as const;`, ['h2']],
    [`const Tag = (x ? 'a' : "b") as const;`, ['a', 'b']],
    [`const Tag: 'h2' | 'h3' = level === 2 ? 'h2' : 'h3';`, ['h2', 'h3']],
    [`const Tag = a ? 'h1' : b ? 'h2' : 'h3';`, ['h1', 'h2', 'h3']],
    [`const Tag = a ? b ? 'h1' : 'h2' : 'h3';`, ['h1', 'h2', 'h3']],
    [`const Tag = x || y ? \`nav\` : 'div'`, ['nav', 'div']],
    [`const Tag = 'a' || 'span';`, ['a', 'span']],
    [`const Tag = /^https?:/.test(href) ? 'a' : 'span';`, ['a', 'span']],
    [`const Tag = list.some((i) => i.on) ? 'ol' : 'ul';`, ['ol', 'ul']],
    // ASI: the next line starts a statement, so the initializer ends here.
    [`const Tag = href ? 'a' : 'div'\nconst other = 1;`, ['a', 'div']],
    // A regex with a quote and a brace earlier in the file does not unbalance it.
    [`const slug = title.replace(/['{]/g, '');\nconst Tag = 'my-card';`, ['my-card']],
  ])('proves %s', (frontmatter, tags) => {
    expect(bound(frontmatter)).toEqual(tags);
  });

  it.each([
    [`const { as: Tag = 'div' } = Astro.props;`, 'a prop'],
    [`import Tag from './Tag.astro';`, 'an import'],
    [`let Tag = 'a';`, 'a let'],
    [`var Tag = 'a';`, 'a var'],
    [`const Tag = level ? \`h\${level}\` : 'p';`, 'an interpolated template'],
    [`const Tag = x || 'div';`, 'a fallback from a value'],
    [`const Tag = x ?? 'div';`, 'a nullish fallback from a value'],
    [`const Tag = tags[i];`, 'an index'],
    [`const Tag = 'h' + level;`, 'a concatenation'],
    [`const Tag = 'div'.trim();`, 'a call'],
    [`const Tag = x => x ? 'a' : 'b';`, 'an arrow whose body is a conditional'],
    [`const Tag = a = b ? 'x' : 'y';`, 'an assignment'],
    [`const Tag = x ? 'a' : '';`, 'an empty string, which is no tag'],
    [`const Tag = x ? 'a' : 'two words';`, 'a string that is no tag'],
    [`const Tag = x ? 'a' : 'b'\n.toUpperCase();`, 'a call continued on the next line'],
    [`const Tag = x ? 'a';`, 'a conditional with no else'],
    [`function f() { const Tag = 'span'; }`, 'a const in a nested scope'],
    [`const Tag = 'a';\nfunction f() { const Tag = 'span'; }`, 'a name declared twice'],
    [`const Other = 'a';`, 'no declaration at all'],
    [`const Tag = 'a'; const s = "unclosed`, 'a frontmatter it cannot read'],
  ])('refuses %s (%s)', (frontmatter) => {
    expect(bound(frontmatter)).toBeNull();
  });
});
