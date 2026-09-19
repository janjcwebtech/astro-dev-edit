import { describe, expect, it } from 'vitest';
import type { ClassifyResult, UsageLink, UsageProp, UsageSlot } from '../src/shared/protocol.ts';
import { buildValueRows, chainBadges, type ValueRowsInput } from '../src/client/value-rows.ts';

/**
 * The Values card as data, with no browser in sight.
 *
 * The two things this model exists to settle: that the clicked value is pinned
 * first whatever it arrived by, and that a value keeps its own verdict — a
 * prop writable in another module reads `elsewhere`, never `read-only`.
 */

const prop = (name: string, source: string, write: Partial<UsageProp> = {}): UsageProp =>
  ({ name, kind: 'quoted', source, start: 0, end: source.length, verdict: 'editable',
    value: source.replace(/^['"]|['"]$/g, ''), ...write } as UsageProp);
const slot = (source: string, write: Partial<UsageSlot> = {}): UsageSlot =>
  ({ name: 'default', start: 0, end: source.length, source, verdict: 'editable', value: source, ...write } as UsageSlot);

const link = (id: string, file: string, over: Partial<UsageLink> = {}): UsageLink => ({
  id, file, loc: '9:3', offset: 0, name: 'Card', target: '/Card.astro',
  hasSpread: false, props: [], slots: [], ...over,
});

const input = (over: Partial<ValueRowsInput> = {}): ValueRowsInput => ({
  selection: { source: { file: '/Card.astro', loc: '5:3' }, opaque: false, viaSlot: false, text: 'Protected', tag: 'h2' },
  classification: { kind: 'text', reason: 'Literal text.' },
  pathname: '/',
  links: [],
  ...over,
});

const text: ClassifyResult = { kind: 'text', reason: 'Literal text.' };

describe('the clicked value is pinned first', () => {
  it('puts it above every usage-site value, whatever transport it arrived by', () => {
    const { rows } = buildValueRows(input({
      links: [link('a', '/Page.astro', { props: [prop('title', '"Protected"')] })],
    }));
    expect(rows[0]).toMatchObject({ label: 'text', pinned: true, depth: -1, verdict: 'editable' });
    expect(rows[0].badges).toContain('selected element');
    expect(rows[1]).toMatchObject({ label: 'title', pinned: false, depth: 0 });
  });

  it('badges a value that slot markup wraps, rather than hiding it behind the wrapper', () => {
    const { rows } = buildValueRows(input({ selection: { ...input().selection, viaSlot: true } }));
    expect(rows[0].badges).toEqual(['selected element', 'via slot']);
  });

  it('reads an image as two rows, refusing an absent alt by name', () => {
    const { rows } = buildValueRows(input({
      selection: { ...input().selection, image: { src: '/hero.jpg', alt: '' } },
      classification: { kind: 'image', reason: 'Image.', attrs: { src: 'static', alt: 'missing' } },
    }));
    expect(rows[0]).toMatchObject({ label: 'src', verdict: 'editable', value: '/hero.jpg' });
    expect(rows[1]).toMatchObject({ label: 'alt', verdict: 'read-only', reason: 'absent' });
  });

  it('refuses a value the AST cannot pin to one element, rather than offering it', () => {
    for (const kind of ['ambiguous', 'unresolved'] as const) {
      const { rows } = buildValueRows(input({ classification: { kind, reason: 'Two elements share this loc.' } }));
      expect(rows[0]).toMatchObject({ verdict: 'read-only', reason: 'unlocated' });
    }
  });

  it('asks /classify rather than the DOM: the same characters, two verdicts', () => {
    const selection = input().selection;
    expect(buildValueRows(input({ selection, classification: text })).rows[0].verdict).toBe('editable');
    expect(buildValueRows(input({ selection,
      classification: { kind: 'dynamic', reason: 'Rendered from a prop.' } })).rows[0])
      .toMatchObject({ verdict: 'read-only', reason: 'computed' });
  });
});

describe('every usage-site value becomes a row that keeps its own verdict', () => {
  const chain = [
    link('outer', '/Advanced.astro', { name: 'Forward', target: '/Forward.astro', props: [
      prop('title', '"Protected"'),
      prop('eyebrow', 'site.tagline', { kind: 'expression', verdict: 'elsewhere', reason: 'imported', from: './site-data.ts' }),
      prop('featured', 'i === 0', { kind: 'expression', verdict: 'read-only', reason: 'computed' }),
    ] }),
    link('inner', '/Forward.astro', { props: [
      prop('Astro.props', 'Astro.props', { kind: 'spread', verdict: 'read-only', reason: 'spread' }),
    ] }),
  ];

  it('names the module an elsewhere value is writable in, and never calls it read-only', () => {
    const { rows } = buildValueRows(input({ links: chain }));
    const eyebrow = rows.find(row => row.label === 'eyebrow');
    expect(eyebrow).toMatchObject({ verdict: 'elsewhere', reason: 'imported', from: './site-data.ts' });
    expect(rows.find(row => row.label === 'featured')).toMatchObject({ verdict: 'read-only', reason: 'computed' });
  });

  it('orders usage sites nearest first, so the site that handed over the values leads', () => {
    const { rows } = buildValueRows(input({ links: chain }));
    expect(rows.filter(row => !row.pinned).map(row => [row.label, row.depth]))
      .toEqual([['Astro.props', 0], ['title', 1], ['eyebrow', 1], ['featured', 1]]);
  });

  it('points View code at the file holding the words, not the file rendering them', () => {
    const { rows } = buildValueRows(input({ links: chain }));
    expect(rows.find(row => row.label === 'title')?.destination).toEqual({ file: '/Advanced.astro', loc: '9:3' });
  });

  it('badges editable slot text via slot, and leaves wrapping markup read-only', () => {
    const { rows } = buildValueRows(input({ classification: { kind: 'empty', reason: 'No children.' },
      links: [link('a', '/Page.astro', { slots: [
        slot('Repeated words'),
        slot('<span>Repeated words</span>', { verdict: 'read-only', reason: 'markup' }),
      ] })] }));
    expect(rows[0]).toMatchObject({ label: 'slot', verdict: 'editable', badges: ['via slot'] });
    expect(rows[1]).toMatchObject({ verdict: 'read-only', reason: 'markup', badges: [] });
  });

  it('keeps the mechanism vocabulary out of the caption and behind the details', () => {
    const { rows } = buildValueRows(input({ links: chain }));
    const title = rows.find(row => row.label === 'title')!;
    expect(title.caption).toBe('A quoted string literal at the usage site.');
    expect(title.details).toContain('kind · quoted');
    expect(title.details.some(line => line.startsWith('bytes · '))).toBe(true);
  });

  it('addresses a usage-site value by its byte range, not by a parsed key', () => {
    const { rows } = buildValueRows(input({
      links: [link('k3f9', '/Page.astro', {
        props: [prop('title', '"Protected"', { start: 40, end: 51 })],
        slots: [slot('Start', { start: 60, end: 65 })],
      })],
    }));
    expect(rows[1].target).toEqual({ kind: 'usage', usageId: 'k3f9', pathname: '/', file: '/Page.astro',
      loc: '9:3', name: 'title', slot: false, ordinal: 0, start: 40, end: 51 });
    expect(rows[2].target).toMatchObject({ kind: 'usage', slot: true, name: 'default', start: 60, end: 65 });
  });

  it('shows an editable value its words, and a refused one its bytes', () => {
    const { rows } = buildValueRows(input({
      ordinals: { k3f9: 2 },
      links: [link('k3f9', '/Page.astro', {
        props: [
          prop('title', '"x &amp; y"', { value: 'x & y' }),
          prop('featured', 'i === 0', { kind: 'expression', verdict: 'read-only', reason: 'computed', value: undefined }),
        ],
      })],
    }));
    // A field editing `"x &amp; y"` would be editing syntax; the row's value is
    // what the words are, and the byte range stays on the target.
    expect(rows[1]).toMatchObject({ label: 'title', value: 'x & y' });
    expect(rows[1].target).toMatchObject({ kind: 'usage', ordinal: 2 });
    // Where the spelling *is* the thing to look at, the source is what shows.
    expect(rows[2]).toMatchObject({ label: 'featured', value: 'i === 0', verdict: 'read-only' });
  });

  it('gives every row a key of its own, so two props holding one string stay two rows', () => {
    const { rows } = buildValueRows(input({ links: [link('a', '/Page.astro', { props: [
      prop('alt', "'same'", { start: 10, end: 16 }), prop('other', "'same'", { start: 30, end: 36 }),
    ] })] }));
    expect(new Set(rows.map(row => row.key)).size).toBe(rows.length);
  });
});

/**
 * A row's address is fields, not a formatted string. Staging reads it back —
 * `key.split('|')` was the alternative — and the two kinds differ in a way
 * that matters: an element's `file:loc` survives an edit landing earlier in
 * the file, and a usage site's byte range does not.
 */
describe('every row names the target it would write into', () => {
  it('addresses the clicked element by loc and target type, as /apply does', () => {
    const { rows } = buildValueRows(input());
    expect(rows[0].target).toEqual({ kind: 'element', file: '/Card.astro', loc: '5:3',
      tag: 'h2', targetType: 'text' });
  });

  it('gives markup and an expression their own target types at one loc', () => {
    const markup = buildValueRows(input({
      classification: { kind: 'markup', reason: 'Inline markup.', markup: { html: 'a <b>b</b>' } },
    })).rows[0];
    const expression = buildValueRows(input({
      classification: { kind: 'expression', reason: 'Traced.', expression: { property: 'title', label: 'title' } },
    })).rows[0];
    expect(markup.target).toMatchObject({ targetType: 'markup' });
    expect(expression.target).toMatchObject({ targetType: 'expression' });
  });

  it('gives an image its two attribute targets', () => {
    const { rows } = buildValueRows(input({
      selection: { ...input().selection, image: { src: '/hero.jpg', alt: 'A hill' } },
      classification: { kind: 'image', reason: 'Image.', attrs: { src: 'static', alt: 'static' } },
    }));
    expect(rows.map(row => row.target)).toMatchObject([{ targetType: 'src' }, { targetType: 'alt' }]);
  });
});

describe('a refusal collapses the card instead of drawing an empty list', () => {
  it('names generated HTML, which has no proven inner-element source', () => {
    expect(buildValueRows(input({ selection: { ...input().selection, opaque: true },
      classification: null }))).toMatchObject({ rows: [], refusal: expect.stringContaining('Generated HTML') });
  });

  it('names a missing annotation rather than guessing an owner', () => {
    expect(buildValueRows(input({ selection: { ...input().selection, source: null }, classification: null }))
      .refusal).toContain('no source annotation');
  });

  /**
   * Issue #71. A polymorphic `<Tag>` renders an element nobody annotates, and
   * the tool still holds the slot boundary it wraps — which names the
   * component that chose the tag, and the file the words inside were written
   * in. Clicking the `<span>` inside answered fully all along; clicking the
   * `<h2>` around it must not answer with a mechanical fact and stop.
   */
  it('names the dynamic tag that rendered an unannotated element, and both files', () => {
    const refusal = buildValueRows(input({
      selection: { ...input().selection, source: null, dynamicTag: {
        component: { file: '/repo/src/components/ui/Heading.astro', loc: '6:22' },
        content: { file: '/repo/src/components/sections/Intro.astro', loc: '21:272' } } },
      classification: null,
    })).refusal;
    expect(refusal).toContain('dynamic tag in Heading.astro');
    expect(refusal).toContain('Intro.astro:21:272');
    expect(refusal).not.toContain('no source annotation');
  });

  it('says so when nothing inside the dynamic tag is annotated either', () => {
    const refusal = buildValueRows(input({
      selection: { ...input().selection, source: null, dynamicTag: {
        component: { file: '/repo/src/components/ui/Heading.astro', loc: '6:22' }, content: null } },
      classification: null,
    })).refusal;
    expect(refusal).toContain('dynamic tag in Heading.astro');
    expect(refusal).toContain('Nothing inside it carries a source annotation');
  });

  /**
   * Issue #82. A variable tag with no slot inside is proven, so it has a
   * source and a chain — but its loc names a component node, so no verdict is
   * asked for the element itself. What its caller passes is still a row.
   */
  it('shows what the caller passes to a proven variable tag, with no row of its own', () => {
    const { rows, refusal } = buildValueRows(input({
      selection: { ...input().selection, tag: 'a', source: { file: 'src/NoteCard.astro', loc: '46:1' },
        variableTag: { name: 'Wrapper', tags: ['a', 'article'] } },
      classification: null,
      links: [link('a', 'src/pages/notes.astro', { props: [prop('title', '"Protected"')] })],
    }));
    expect(refusal).toBeNull();
    expect(rows.map(row => [row.label, row.pinned])).toEqual([['title', false]]);
  });

  it('names a proven variable tag when nothing is passed to it', () => {
    const refusal = buildValueRows(input({
      selection: { ...input().selection, tag: 'a', source: { file: 'src/NoteCard.astro', loc: '46:1' },
        variableTag: { name: 'Wrapper', tags: ['a', 'article'] } },
      classification: null,
    })).refusal;
    expect(refusal).toContain('Written as <Wrapper> in NoteCard.astro');
    expect(refusal).toContain('(<a> or <article>)');
    expect(refusal).not.toContain('No value was resolved');
  });

  it('carries a failed classification through as the reason', () => {
    expect(buildValueRows(input({ classification: null, classifyError: 'Could not classify — offline' }))
      .refusal).toBe('Could not classify — offline');
  });

  it('is absent whenever a row survived', () => {
    expect(buildValueRows(input()).refusal).toBeNull();
  });
});

describe('a chain row says which file owns the look and which holds the words', () => {
  it('marks the usage that renders the selection’s own file as presentation', () => {
    expect(chainBadges(link('a', '/Page.astro', { target: '/Card.astro' }), '/Card.astro')).toContain('presentation');
    expect(chainBadges(link('a', '/Page.astro', { target: '/Other.astro' }), '/Card.astro')).not.toContain('presentation');
  });

  it('marks a usage that supplies any writable value as content', () => {
    expect(chainBadges(link('a', '/Page.astro', { props: [prop('title', '"x"')] }), null)).toEqual(['content']);
    expect(chainBadges(link('a', '/Page.astro', { props: [
      prop('class', '"x"', { verdict: 'read-only', reason: 'styling' })] }), null)).toEqual([]);
  });

  it('counts an elsewhere value as content — the words are still passed here', () => {
    expect(chainBadges(link('a', '/Page.astro', { props: [
      prop('eyebrow', 'site.x', { verdict: 'elsewhere', reason: 'imported', from: './s.ts' })] }), null))
      .toEqual(['content']);
  });
});

/**
 * A `set:html` container and a `set:html` prop are the same promise made at
 * two destinations: one whole string, edited raw, saying nothing about the
 * elements it produces.
 */
describe('an HTML value is one whole row, and says so', () => {
  it('gives the container a row of its own where the children would be empty', () => {
    const { rows } = buildValueRows(input({
      classification: { kind: 'html', reason: 'set:html.', html: { value: '<p>Hello <b>there</b></p>' } },
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: 'html', verdict: 'editable', pinned: true,
      value: '<p>Hello <b>there</b></p>', caption: 'Rendered as HTML. The whole string is edited here.' });
    expect(rows[0].target).toMatchObject({ kind: 'element', targetType: 'html' });
  });

  it('marks a usage-site prop as HTML without changing what makes it editable', () => {
    const { rows } = buildValueRows(input({
      links: [link('a', '/Page.astro', { props: [
        prop('set:html', '{intro}', { kind: 'expression', html: true, value: '<p>Hi</p>' }),
        prop('set:html', '{built}', { kind: 'expression', html: true, verdict: 'read-only', reason: 'computed', value: undefined }),
      ] })],
    }));
    const [, editable, refused] = rows;
    expect(editable).toMatchObject({ label: 'set:html', verdict: 'editable', value: '<p>Hi</p>',
      caption: 'Rendered as HTML. The whole string is edited here.' });
    expect(editable.details).toContain('renders as · HTML');
    // The destination is a fact about the value, not about the verdict — a
    // refused one is still HTML, and still keeps its own reason.
    expect(refused).toMatchObject({ verdict: 'read-only', reason: 'computed' });
    expect(refused.details).toContain('renders as · HTML');
  });
});

/**
 * A Markdown-backed route, which is the one case that pulls the other way:
 * every other row exists so a value can be written, and these exist so one
 * cannot be. The words are real and the file holding them is named; this pass
 * edits no Markdown in the browser, so a field would be an offer it could not
 * keep.
 */
describe('a route rendering a Markdown entry', () => {
  const ROUTE = 'src/pages/services/[slug].astro';
  const TEMPLATE = `/repo/${ROUTE}`;
  const ENTRY = 'src/content/services/product-design.md';
  const md = (over: Partial<ValueRowsInput> = {}) => input({
    markdownEntry: ENTRY, routeFile: ROUTE, ...over,
  });

  it('answers a frontmatter expression with the entry, and no field', () => {
    const { rows } = buildValueRows(md({
      selection: { ...input().selection, source: { file: TEMPLATE, loc: '15:7' }, text: 'Product design' },
      classification: { kind: 'dynamic', reason: 'A template expression.' },
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: 'frontmatter value', verdict: 'elsewhere',
      reason: 'markdown', from: ENTRY, pinned: true });
    // The top of the entry, never a line: nothing proves which one.
    expect(rows[0].destination).toEqual({ file: ENTRY, loc: '1:1' });
    expect(rows[0].details.some(line => line.startsWith('inferred ·'))).toBe(true);
  });

  it('answers a body paragraph — which carries no annotation at all — the same way', () => {
    const { rows } = buildValueRows(md({
      selection: { ...input().selection, source: null, text: 'We start every engagement…',
        ancestorSource: { file: TEMPLATE, loc: '17:12' } },
      classification: null,
    }));
    expect(rows[0]).toMatchObject({ label: 'content', verdict: 'elsewhere', reason: 'markdown' });
    expect(rows[0].destination).toEqual({ file: ENTRY, loc: '1:1' });
    expect(rows[0].details).toContain('no line · a rendered paragraph names no source line');
  });

  it('leaves a literal written in the template editable — one page, both behaviours', () => {
    const { rows } = buildValueRows(md({
      selection: { ...input().selection, source: { file: TEMPLATE, loc: '14:22' }, text: 'Service' },
      classification: text,
    }));
    expect(rows[0]).toMatchObject({ label: 'text', verdict: 'editable', pinned: true });
  });

  it('claims nothing for an unannotated element the route template does not enclose', () => {
    const { rows, refusal } = buildValueRows(md({
      selection: { ...input().selection, source: null, text: 'Somewhere else',
        ancestorSource: { file: '/repo/src/components/Widget.astro', loc: '3:1' } },
      classification: null,
    }));
    expect(rows).toHaveLength(0);
    expect(refusal).toBe('This element has no source annotation.');
  });

  it('refuses the whole shape when the page declares no backing file', () => {
    const { rows } = buildValueRows(input({
      routeFile: ROUTE,
      selection: { ...input().selection, source: { file: TEMPLATE, loc: '15:7' } },
      classification: { kind: 'dynamic', reason: 'A template expression.' },
    }));
    // The template's own refusal, pointing at the template — never an entry
    // path invented from the URL.
    expect(rows[0]).toMatchObject({ verdict: 'read-only', reason: 'computed' });
    expect(rows[0].destination).toEqual({ file: TEMPLATE, loc: '15:7' });
  });

  it('does not claim a dynamic value written somewhere other than the route template', () => {
    const { rows } = buildValueRows(md({
      selection: { ...input().selection, source: { file: '/repo/src/components/Nav.astro', loc: '4:3' } },
      classification: { kind: 'dynamic', reason: 'A template expression.' },
    }));
    expect(rows[0]).toMatchObject({ verdict: 'read-only', reason: 'computed' });
  });
});
