import { describe, expect, it } from 'vitest';
import type { PeekResponse } from '../src/shared/protocol.ts';
import {
  formatContext,
  relativize,
  windowAround,
  type ElementContext,
} from '../src/client/element-context.ts';

/**
 * The clipboard payload behind the hover pill's "copy ⧉". `formatContext` is
 * the pure half of element-context.ts — an ElementContext in, markdown out —
 * so what an assistant actually receives is pinned here without a browser.
 * The DOM/fetch half (collectContext) is manual-verified in the playground;
 * see docs/VERIFICATION.md.
 */

const FULL: ElementContext = {
  loc: { file: 'src/pages/index.astro', loc: '12:3' },
  openTag: '<h1 class="hero-title">',
  label: 'h1.hero-title',
  verdict: 'editable text — literal text',
  pageUrl: 'http://localhost:4321/',
  entryFile: null,
  domPath: 'body > main > section.hero > h1.hero-title',
  html: '<h1 class="hero-title">Something Familiar</h1>',
  htmlDropped: 0,
  rules: [
    {
      selectorText: '.hero-title',
      declarations: 'font-size: 3rem;\nline-height: 1.05;',
      sourceFile: 'src/styles/global.css',
    },
  ],
  rulesDropped: 0,
  source: {
    file: 'src/pages/index.astro',
    startLine: 11,
    focusLine: 12,
    totalLines: 24,
    lines: ['<section class="hero">', '  <h1 class="hero-title">{title}</h1>', '</section>'],
  },
  sourceUnavailable: null,
  box: 'display: block · 720×58 px · font: 700 56px/1.05 Inter · color: rgb(34, 34, 44)',
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
  it('lays out every section, in order, for a fully-populated element', () => {
    const out = formatContext(FULL);
    expect(out).toContain('# Element context — src/pages/index.astro:12:3');
    expect(out).toContain('- **Element** `<h1 class="hero-title">`');
    expect(out).toContain('- **Editability** editable text — literal text');
    expect(out).toContain('- **Page** http://localhost:4321/');
    expect(out).toContain('- **DOM path** body > main > section.hero > h1.hero-title');
    const order = ['## Rendered HTML', '## Source —', '## CSS that applies', '## Rendered box & type'];
    const positions = order.map((heading) => out.indexOf(heading));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(out.endsWith('\n')).toBe(true);
  });

  it('gutter-marks the element line with ">" and numbers from startLine', () => {
    const out = formatContext(FULL);
    expect(out).toContain('  11 | <section class="hero">');
    expect(out).toContain('> 12 |   <h1 class="hero-title">{title}</h1>');
    expect(out).toContain('  13 | </section>');
  });

  it('states the quoted range and picks the fence language from the extension', () => {
    expect(formatContext(FULL)).toContain(
      '## Source — src/pages/index.astro (lines 11–13 of 24, `>` marks the element)',
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
    const out = formatContext({ ...FULL, verdict: null, entryFile: null });
    expect(out).not.toContain('**Editability**');
    expect(out).not.toContain('**Content entry**');
  });

  it('names the backing content entry when the page declares one', () => {
    const out = formatContext({ ...FULL, entryFile: 'src/content/works/lamp.md' });
    expect(out).toContain('- **Content entry** src/content/works/lamp.md');
  });

  it('replaces the source block with the reason when the server refused it', () => {
    const out = formatContext({
      ...FULL,
      source: null,
      sourceUnavailable: 'That file belongs to a package, not your project.',
    });
    expect(out).toContain('## Source\n_Not available — That file belongs to a package, not your project._');
    expect(out).not.toContain('```astro');
    // The rest of the payload still stands.
    expect(out).toContain('## Rendered HTML');
    expect(out).toContain('## CSS that applies');
  });

  it('drops the source section entirely when there is nothing to say', () => {
    const out = formatContext({ ...FULL, source: null, sourceUnavailable: null });
    expect(out).not.toContain('## Source');
  });

  it('explains an empty CSS scan instead of printing an empty fence', () => {
    const out = formatContext({ ...FULL, rules: [], rulesDropped: 0 });
    expect(out).toContain('## CSS that applies\n_No stylesheet rule matches this element directly');
    expect(out).not.toContain('```css');
  });

  it('prints each rule with its source file, indented inside a block', () => {
    const out = formatContext(FULL);
    expect(out).toContain('/* src/styles/global.css */\n.hero-title {\n  font-size: 3rem;\n  line-height: 1.05;\n}');
  });

  it('omits the source comment for a rule whose stylesheet could not be resolved', () => {
    const out = formatContext({
      ...FULL,
      rules: [{ selectorText: '.hero-title', declarations: 'color: red;', sourceFile: null }],
    });
    expect(out).toContain('.hero-title {\n  color: red;\n}');
    expect(out).not.toContain('/* null */');
  });

  it('declares both truncations rather than silently shortening', () => {
    const out = formatContext({ ...FULL, htmlDropped: 812, rulesDropped: 6 });
    expect(out).toContain('_Truncated — 812 more characters of markup._');
    expect(out).toContain('## CSS that applies (1 of 7 rules)');
    expect(out).toContain('_Truncated — 6 further matching rules._');
  });

  it('counts rules in the heading when nothing was dropped', () => {
    expect(formatContext(FULL)).toContain('## CSS that applies (1 rule)');
    expect(
      formatContext({ ...FULL, rules: [FULL.rules[0], FULL.rules[0]] }),
    ).toContain('## CSS that applies (2 rules)');
  });

  it('omits the rendered box line when it could not be measured', () => {
    const out = formatContext({ ...FULL, box: null });
    expect(out).not.toContain('## Rendered box & type');
  });
});

describe('relativize', () => {
  const ROOT = '/Users/dev/projects/site';

  it('strips the project root from an absolute annotation path', () => {
    expect(relativize(`${ROOT}/src/pages/index.astro`, ROOT)).toBe('src/pages/index.astro');
  });

  it('tolerates a trailing slash on the root', () => {
    expect(relativize(`${ROOT}/src/x.astro`, `${ROOT}/`)).toBe('src/x.astro');
  });

  it('leaves a path that is not under the root alone', () => {
    expect(relativize('/elsewhere/x.astro', ROOT)).toBe('/elsewhere/x.astro');
  });

  it('leaves an already-relative path alone', () => {
    expect(relativize('src/pages/index.astro', ROOT)).toBe('src/pages/index.astro');
  });

  it('passes the path through unchanged when the root is unknown', () => {
    expect(relativize(`${ROOT}/src/x.astro`, null)).toBe(`${ROOT}/src/x.astro`);
  });

  it('normalizes Windows separators on both sides before comparing', () => {
    expect(relativize('C:\\dev\\site\\src\\pages\\index.astro', 'C:\\dev\\site')).toBe(
      'src/pages/index.astro',
    );
  });
});

describe('windowAround', () => {
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
