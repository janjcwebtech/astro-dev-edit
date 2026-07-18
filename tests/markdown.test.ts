import { describe, expect, it } from 'vitest';
import { canRichEdit, markdownToHtml } from '../src/client/markdown.ts';

describe('markdownToHtml', () => {
  it('renders headings h1–h6', () => {
    expect(markdownToHtml('# One')).toBe('<h1>One</h1>');
    expect(markdownToHtml('###### Six')).toBe('<h6>Six</h6>');
  });

  it('joins consecutive lines into one paragraph, blank lines split', () => {
    expect(markdownToHtml('a\nb\n\nc')).toBe('<p>a b</p>\n<p>c</p>');
  });

  it('renders inline emphasis', () => {
    expect(markdownToHtml('**b** *i* ~~s~~')).toBe(
      '<p><strong>b</strong> <em>i</em> <del>s</del></p>',
    );
  });

  it('keeps snake_case out of underscore italics', () => {
    expect(markdownToHtml('use snake_case_names here')).toBe('<p>use snake_case_names here</p>');
    expect(markdownToHtml('an _italic_ word')).toBe('<p>an <em>italic</em> word</p>');
  });

  it('protects inline code from emphasis processing', () => {
    expect(markdownToHtml('run `a * b * c` now')).toBe('<p>run <code>a * b * c</code> now</p>');
  });

  it('does not treat digits between spaces as code placeholders', () => {
    expect(markdownToHtml('item 5 here')).toBe('<p>item 5 here</p>');
  });

  it('renders links and images', () => {
    expect(markdownToHtml('[x](https://e.com)')).toBe('<p><a href="https://e.com">x</a></p>');
    expect(markdownToHtml('![alt](/img/a.png)')).toBe('<p><img alt="alt" src="/img/a.png"></p>');
  });

  it('renders flat lists', () => {
    expect(markdownToHtml('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(markdownToHtml('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
  });

  it('renders blockquotes with inner paragraphs', () => {
    expect(markdownToHtml('> a\n> b')).toBe('<blockquote><p>a b</p></blockquote>');
    expect(markdownToHtml('> a\n>\n> b')).toBe('<blockquote><p>a</p><p>b</p></blockquote>');
  });

  it('renders fenced code blocks with the language preserved', () => {
    expect(markdownToHtml('```js\nconst a = 1 < 2;\n```')).toBe(
      '<pre data-lang="js"><code>const a = 1 &lt; 2;</code></pre>',
    );
    expect(markdownToHtml('```\nplain\n```')).toBe('<pre><code>plain</code></pre>');
  });

  it('renders hr and escapes raw HTML in text', () => {
    expect(markdownToHtml('---')).toBe('<hr>');
    expect(markdownToHtml('a <b> c')).toBe('<p>a &lt;b&gt; c</p>');
  });
});

describe('canRichEdit', () => {
  it('accepts the supported subset', () => {
    const md = '# Title\n\nSome **bold** text.\n\n- one\n- two\n\n> quote\n\n```js\ncode\n```\n';
    expect(canRichEdit(md)).toBe(true);
  });

  it('accepts table/HTML-looking content inside fences', () => {
    expect(canRichEdit('```\n| a | b |\n<div>\n```\n')).toBe(true);
  });

  it.each([
    ['tables', '| a | b |\n| - | - |'],
    ['raw HTML', '<div class="x">hi</div>'],
    ['MDX components', '<Widget prop={1} />'],
    ['MDX imports', "import X from './x.astro';"],
    ['footnotes', 'text[^1]\n\n[^1]: note'],
    ['reference links', '[x]: https://e.com'],
    ['nested lists', '- a\n  - b'],
    ['indented code', 'para\n\n    indented code'],
    ['setext headings', 'Title\n====='],
    ['unclosed fences', '```js\ncode'],
  ])('rejects %s', (_name, md) => {
    expect(canRichEdit(md)).toBe(false);
  });
});
