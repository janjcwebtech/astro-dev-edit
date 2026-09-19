import { describe, expect, it } from 'vitest';
import type { PeekResponse, UsageLink } from '../src/shared/protocol.ts';
import {
  chainSteps,
  elementLines,
  formatContext,
  originSentence,
  textOf,
  type ElementContext,
} from '../src/client/element-context.ts';

/**
 * The clipboard payload behind **Copy context**. `formatContext` is the pure
 * half of element-context.ts — an ElementContext in, markdown out — so what an
 * assistant actually receives is pinned here without a browser. The DOM/fetch
 * half (collectContext) is manual-verified in the playground.
 */

const FULL: ElementContext = {
  loc: { file: 'src/components/notes-detail/NoteArticle.astro', loc: '70:56' },
  openTag: '<h1 class="note-article__title">',
  label: 'h1.note-article__title',
  text: 'AI brand visibility',
  origin: { kind: 'dynamic', hasChildElements: false },
  pageUrl: 'http://localhost:4321/notes/ai-brand-visibility',
  routeFile: 'src/pages/notes/[id].astro',
  entryFile: null,
  chain: [{ name: 'NoteArticle', usedAt: 'src/pages/notes/[id].astro:57:5', target: 'src/components/notes-detail/NoteArticle.astro' }],
  domPath: 'body > main > article > h1.note-article__title',
  source: {
    file: 'src/components/notes-detail/NoteArticle.astro',
    startLine: 70,
    lines: ['    <h1 class="note-article__title">{cleanTitle}</h1>'],
  },
  sourceUnavailable: null,
};

function peek(overrides: Partial<PeekResponse> = {}): PeekResponse {
  return {
    file: 'src/pages/index.astro',
    startLine: 1,
    focusLine: 2,
    totalLines: 6,
    lines: ['<section>', '  <h1>Hi</h1>', '  <p>', '    Body', '  </p>', '</section>'],
    ...overrides,
  };
}

describe('formatContext', () => {
  it('prints the whole payload exactly — nothing said twice', () => {
    expect(formatContext(FULL)).toBe(
      [
        '# h1.note-article__title "AI brand visibility"',
        '',
        '- **Source** src/components/notes-detail/NoteArticle.astro:70:56',
        '- **Rendered by** src/pages/notes/[id].astro:57:5 `<NoteArticle>`',
        '- **Text** Computed by an expression — the words are not in this file.',
        '',
        '```astro line 70',
        '70 |     <h1 class="note-article__title">{cleanTitle}</h1>',
        '```',
        '',
      ].join('\n'),
    );
  });

  // Compiled markup and matched CSS exist in no source file; a model handed
  // them searches for markup that is not there, or starts restyling.
  it('carries no rendered HTML, no CSS, and nothing Astro generated', () => {
    const out = formatContext(FULL);
    expect(out).not.toContain('```html');
    expect(out).not.toContain('```css');
    expect(out).not.toContain('data-astro-cid');
  });

  it('joins a deep chain outermost first', () => {
    const out = formatContext({
      ...FULL,
      chain: [
        { name: 'Marketing', usedAt: 'src/pages/marketing.astro:4:1', target: 'Marketing.astro' },
        { name: 'FeatureCard', usedAt: 'FeatureSection.astro:9:22', target: 'FeatureCard.astro' },
      ],
    });
    expect(out).toContain('- **Rendered by** src/pages/marketing.astro:4:1 `<Marketing>` › FeatureSection.astro:9:22 `<FeatureCard>`');
  });

  it('names the route only when it is not the file the element is written in', () => {
    const inComponent = formatContext({ ...FULL, chain: [] });
    expect(inComponent).toContain('- **Route** src/pages/notes/[id].astro');
    const inRoute = formatContext({ ...FULL, chain: [], loc: { file: 'src/pages/notes/[id].astro', loc: '3:1' } });
    expect(inRoute).not.toContain('**Route**');
    expect(inRoute).not.toContain('**Page**');
  });

  it('falls back to the page URL when the route did not resolve', () => {
    const out = formatContext({ ...FULL, chain: [], routeFile: null });
    expect(out).toContain('- **Page** http://localhost:4321/notes/ai-brand-visibility');
  });

  it('names the backing content entry when the page declares one', () => {
    const out = formatContext({ ...FULL, entryFile: 'src/content/notes/ai.md' });
    expect(out).toContain('- **Content entry** src/content/notes/ai.md');
    expect(out).toContain("The page's content entry is src/content/notes/ai.md.");
  });

  it('prints the tag and DOM path only when there is no quote', () => {
    expect(formatContext(FULL)).not.toContain('**Element**');
    expect(formatContext(FULL)).not.toContain('**DOM path**');
    const out = formatContext({ ...FULL, source: null, sourceUnavailable: 'That file belongs to a package.' });
    expect(out).toContain('- **Element** `<h1 class="note-article__title">`');
    expect(out).toContain('- **DOM path** body > main > article > h1.note-article__title');
    expect(out).toContain('_Source not available — That file belongs to a package._');
  });

  it('omits what is absent', () => {
    const out = formatContext({ ...FULL, text: '', origin: null, source: null, sourceUnavailable: null });
    expect(out.split('\n')[0]).toBe('# h1.note-article__title');
    expect(out).not.toContain('**Text**');
    expect(out).not.toContain('```');
  });

  it('numbers a multi-line quote and states the range', () => {
    const out = formatContext({ ...FULL, source: { ...FULL.source!, startLine: 9, lines: ['<p>', '  Body', '</p>'] } });
    expect(out).toContain('```astro lines 9–11\n 9 | <p>\n10 |   Body\n11 | </p>\n```');
  });
});

describe('originSentence', () => {
  const origin = (o: Partial<Parameters<typeof originSentence>[0] & object>) =>
    ({ kind: 'text', hasChildElements: false, ...o }) as NonNullable<Parameters<typeof originSentence>[0]>;
  const caller = { name: 'Hero', usedAt: 'src/pages/index.astro:8:5', target: 'src/components/Hero.astro' };

  it('says where the words live, per verdict', () => {
    expect(originSentence(origin({ kind: 'text' }), null, null)).toBe('Written literally in the quoted source.');
    expect(originSentence(origin({ kind: 'expression', expression: 'hero.title' }), null, null))
      .toBe('An expression traced to the frontmatter string `hero.title` in this file.');
    expect(originSentence(origin({ kind: 'dynamic', prop: 'title' }), caller, null))
      .toBe('The prop `title` — the words are set by the caller at src/pages/index.astro:8:5, not in this file.');
    expect(originSentence(origin({ kind: 'dynamic', hasChildElements: true }), null, null)).toMatch(/^Mixed content/);
  });

  it('stays silent where there is nothing to prove', () => {
    for (const kind of ['image', 'empty', 'ambiguous', 'unresolved'] as const) {
      expect(originSentence(origin({ kind }), null, null)).toBeNull();
    }
    expect(originSentence(null, null, null)).toBeNull();
  });
});

describe('elementLines', () => {
  it('quotes a one-line element alone', () => {
    const w = elementLines(peek(), 'h1');
    expect(w.startLine).toBe(2);
    expect(w.lines).toEqual(['  <h1>Hi</h1>']);
  });

  it('runs a block element down to its closing tag', () => {
    const w = elementLines(peek({ focusLine: 3 }), 'p');
    expect(w.startLine).toBe(3);
    expect(w.lines).toEqual(['  <p>', '    Body', '  </p>']);
  });

  it('stops at a self-closing tag', () => {
    const w = elementLines(peek({ lines: ['<Image', '  src={a}', '  alt="x" />', 'after'], focusLine: 1 }), 'img');
    expect(w.lines).toHaveLength(3);
  });

  it('caps an element that never closes within reach', () => {
    const lines = ['<div>', ...Array.from({ length: 20 }, (_, i) => `  l${i}`)];
    const w = elementLines(peek({ lines, focusLine: 1, totalLines: 21 }), 'div', 8);
    expect(w.lines).toHaveLength(8);
  });

  it('slices correctly when /peek already windowed the file (startLine > 1)', () => {
    const w = elementLines(peek({ startLine: 100, focusLine: 101, totalLines: 500 }), 'h1');
    expect(w.startLine).toBe(101);
    expect(w.lines).toEqual(['  <h1>Hi</h1>']);
  });
});

describe('textOf', () => {
  it('collapses whitespace and caps with an ellipsis', () => {
    expect(textOf('  Something\n   Familiar  ')).toBe('Something Familiar');
    const long = textOf('x'.repeat(200), 10);
    expect(long).toHaveLength(10);
    expect(long.endsWith('…')).toBe(true);
  });

  it('keeps the quoted text from closing its own quotes', () => {
    expect(textOf('say "hi"')).toBe("say 'hi'");
  });
});

describe('chainSteps', () => {
  const link = (id: string, name: string, target?: string): UsageLink => ({
    id, file: 'src/pages/index.astro', loc: '8:5', offset: 0, name, target,
    hasSpread: false, props: [], slots: [],
  });

  it('keeps the chain order and skips ids that did not resolve', () => {
    const links = new Map([
      ['aaaaaaaa', link('aaaaaaaa', 'Layout', 'src/layouts/Base.astro')],
      ['cccccccc', link('cccccccc', 'Hero')],
    ]);
    expect(chainSteps(['aaaaaaaa', 'bbbbbbbb', 'cccccccc'], links)).toEqual([
      { name: 'Layout', usedAt: 'src/pages/index.astro:8:5', target: 'src/layouts/Base.astro' },
      { name: 'Hero', usedAt: 'src/pages/index.astro:8:5', target: null },
    ]);
  });
});
