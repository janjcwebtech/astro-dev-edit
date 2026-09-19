import { describe, expect, it } from 'vitest';
import type { PeekResponse, UsageLink } from '../src/shared/protocol.ts';
import {
  chainSteps,
  formatContext,
  textOf,
  windowAround,
  type ElementContext,
} from '../src/client/element-context.ts';

/**
 * The clipboard payload behind **Copy context**. `formatContext` is the pure
 * half of element-context.ts — an ElementContext in, markdown out — so what an
 * assistant actually receives is pinned here without a browser. The DOM/fetch
 * half (collectContext) is manual-verified in the playground.
 */

const FULL: ElementContext = {
  loc: { file: 'src/components/Hero.astro', loc: '12:3' },
  openTag: '<h1 class="hero-title">',
  label: 'h1.hero-title',
  text: 'Something Familiar',
  pageUrl: 'http://localhost:4321/',
  routeFile: 'src/pages/index.astro',
  entryFile: null,
  chain: [{ name: 'Hero', usedAt: 'src/pages/index.astro:8:5', target: 'src/components/Hero.astro' }],
  domPath: 'body > main > section.hero > h1.hero-title',
  source: {
    file: 'src/components/Hero.astro',
    startLine: 11,
    focusLine: 12,
    totalLines: 24,
    lines: ['<section class="hero">', '  <h1 class="hero-title">{title}</h1>', '</section>'],
  },
  sourceUnavailable: null,
};

function peek(overrides: Partial<PeekResponse> = {}): PeekResponse {
  return {
    file: 'src/pages/index.astro',
    startLine: 1,
    focusLine: 5,
    totalLines: 9,
    lines: ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9'],
    ...overrides,
  };
}

describe('formatContext', () => {
  it('names the element, where it is written, and the files that render it', () => {
    const out = formatContext(FULL);
    expect(out).toContain('# Element context — src/components/Hero.astro:12:3');
    expect(out).toContain('- **Element** `<h1 class="hero-title">`');
    expect(out).toContain('- **Text** "Something Familiar"');
    expect(out).toContain('- **Written in** src/components/Hero.astro:12:3');
    expect(out).toContain('- **Page** http://localhost:4321/');
    expect(out).toContain('- **Route file** src/pages/index.astro');
    expect(out).toContain('- **Rendered via** (outermost first)\n  - `<Hero>` at src/pages/index.astro:8:5 → src/components/Hero.astro');
    expect(out).toContain('## Source — src/components/Hero.astro');
    expect(out.endsWith('\n')).toBe(true);
  });

  // Compiled markup and matched CSS exist in no source file; a model handed
  // them searches for markup that is not there, or starts restyling.
  it('carries no rendered HTML, no CSS, and nothing Astro generated', () => {
    const out = formatContext(FULL);
    expect(out).not.toContain('Rendered HTML');
    expect(out).not.toContain('CSS');
    expect(out).not.toContain('```html');
    expect(out).not.toContain('```css');
    expect(out).not.toContain('data-astro-cid');
    expect(out).not.toContain('**Editability**');
  });

  it('stays small — it identifies one element, it does not describe a page', () => {
    expect(formatContext(FULL).length).toBeLessThan(800);
  });

  it('gutter-marks the element line with ">" and numbers from startLine', () => {
    const out = formatContext(FULL);
    expect(out).toContain('  11 | <section class="hero">');
    expect(out).toContain('> 12 |   <h1 class="hero-title">{title}</h1>');
    expect(out).toContain('  13 | </section>');
  });

  it('states the quoted range and picks the fence language from the extension', () => {
    expect(formatContext(FULL)).toContain(
      '## Source — src/components/Hero.astro (lines 11–13 of 24, `>` marks the element)',
    );
    expect(formatContext(FULL)).toContain('```astro');
    const md = formatContext({
      ...FULL,
      source: { ...FULL.source!, file: 'src/content/works/lamp.md' },
    });
    expect(md).toContain('```markdown');
  });

  it('says "all N lines" when the whole file is quoted', () => {
    const whole = formatContext({
      ...FULL,
      source: { ...FULL.source!, startLine: 1, totalLines: 3 },
    });
    expect(whole).toContain('(all 3 lines,');
  });

  it('omits the optional facts that are absent', () => {
    const out = formatContext({ ...FULL, text: '', routeFile: null, entryFile: null, chain: [] });
    expect(out).not.toContain('**Text**');
    expect(out).not.toContain('**Route file**');
    expect(out).not.toContain('**Content entry**');
    expect(out).not.toContain('**Rendered via**');
  });

  it('names the backing content entry when the page declares one', () => {
    const out = formatContext({ ...FULL, entryFile: 'src/content/works/lamp.md' });
    expect(out).toContain('- **Content entry** src/content/works/lamp.md');
  });

  it('prints the DOM path only when there is no source quote to pin the element', () => {
    expect(formatContext(FULL)).not.toContain('**DOM path**');
    const out = formatContext({ ...FULL, source: null, sourceUnavailable: 'refused' });
    expect(out).toContain('- **DOM path** body > main > section.hero > h1.hero-title');
  });

  it('replaces the source block with the reason when the server refused it', () => {
    const out = formatContext({
      ...FULL,
      source: null,
      sourceUnavailable: 'That file belongs to a package, not your project.',
    });
    expect(out).toContain('## Source\n_Not available — That file belongs to a package, not your project._');
    expect(out).not.toContain('```astro');
    expect(out).toContain('- **Written in** src/components/Hero.astro:12:3');
  });

  it('drops the source section entirely when there is nothing to say', () => {
    const out = formatContext({ ...FULL, source: null, sourceUnavailable: null });
    expect(out).not.toContain('## Source');
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

describe('windowAround', () => {
  it('defaults to a tight window — the payload identifies one element, not a file', () => {
    // 107 lines, the element on line 30: the old ±30 quoted more than half the
    // file around a one-line subject.
    const lines = Array.from({ length: 107 }, (_, i) => `l${i + 1}`);
    const w = windowAround({
      file: 'src/pages/index.astro', startLine: 1, focusLine: 30, totalLines: 107, lines,
    });
    expect(w.startLine).toBe(27);
    expect(w.lines).toHaveLength(7);
    expect(w.lines[w.lines.length - 1]).toBe('l33');
    // …and the heading still says what was left out.
    expect(w.totalLines).toBe(107);
  });

  it('keeps `context` lines either side of the focus line', () => {
    const w = windowAround(peek(), 2);
    expect(w.startLine).toBe(3);
    expect(w.lines).toEqual(['l3', 'l4', 'l5', 'l6', 'l7']);
    expect(w.focusLine).toBe(5);
    expect(w.totalLines).toBe(9);
  });

  it('clamps to the response when the window would run past either end', () => {
    const top = windowAround(peek({ focusLine: 2 }), 5);
    expect(top.startLine).toBe(1);
    expect(top.lines[0]).toBe('l1');

    const bottom = windowAround(peek({ focusLine: 8 }), 5);
    expect(bottom.lines.at(-1)).toBe('l9');
  });

  it('returns the whole response when it is smaller than the window', () => {
    const w = windowAround(peek(), 100);
    expect(w.lines).toHaveLength(9);
    expect(w.startLine).toBe(1);
  });

  it('slices correctly when /peek already windowed the file (startLine > 1)', () => {
    // Lines 100–108 of a 500-line file, element on 104.
    const w = windowAround(
      peek({ startLine: 100, focusLine: 104, totalLines: 500 }),
      1,
    );
    expect(w.startLine).toBe(103);
    expect(w.lines).toEqual(['l4', 'l5', 'l6']);
  });
});
