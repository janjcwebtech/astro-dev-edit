import { describe, expect, it } from 'vitest';
import { tokenizeLines, type Token } from '../src/client/highlight.ts';

/**
 * Pins the peek panel's tokenizer. It is a readability aid, not a grammar —
 * these tests assert the classifications that matter (comments, strings, tags,
 * keywords stand apart from prose) and that unknown text degrades to plain.
 */

const kindsOf = (tokens: Token[]): string[] => tokens.map((t) => t.kind);
const textOf = (tokens: Token[]): string => tokens.map((t) => t.text).join('');

describe('tokenizeLines', () => {
  it('round-trips every line losslessly', () => {
    const lines = [
      '---',
      "const title = 'Dynamic';",
      '<main class="wrap">',
      '  <p>Editable text</p>',
      '<!-- note -->',
    ];
    const out = tokenizeLines(lines);
    out.forEach((tokens, i) => expect(textOf(tokens)).toBe(lines[i]));
  });

  it('marks a frontmatter fence line', () => {
    expect(tokenizeLines(['---'])[0]).toEqual([{ text: '---', kind: 'fence' }]);
  });

  it('classifies tags, attributes, and strings in markup', () => {
    const [tokens] = tokenizeLines(['<img src="/photo.jpg" alt="A photo">']);
    expect(tokens).toEqual(
      expect.arrayContaining([
        { text: '<img', kind: 'tag' },
        { text: 'src', kind: 'attr' },
        { text: '"/photo.jpg"', kind: 'string' },
        { text: 'alt', kind: 'attr' },
        { text: '"A photo"', kind: 'string' },
      ]),
    );
  });

  it('classifies keywords and strings in frontmatter JS', () => {
    const [tokens] = tokenizeLines(["const title = 'Dynamic';"]);
    expect(tokens).toEqual([
      { text: 'const', kind: 'keyword' },
      { text: ' title = ', kind: 'plain' },
      { text: "'Dynamic'", kind: 'string' },
      { text: ';', kind: 'plain' },
    ]);
  });

  it('carries an unclosed HTML comment across lines until its close', () => {
    const out = tokenizeLines(['<!-- start', 'middle', 'end --> <p>after</p>']);
    expect(kindsOf(out[0]!)).toEqual(['comment']);
    expect(kindsOf(out[1]!)).toEqual(['comment']);
    expect(out[2]![0]).toEqual({ text: 'end -->', kind: 'comment' });
    expect(out[2]!).toEqual(expect.arrayContaining([{ text: '<p', kind: 'tag' }]));
  });

  it('does not mistake URLs for comments', () => {
    const [tokens] = tokenizeLines(['see https://example.com for details']);
    expect(kindsOf(tokens)).not.toContain('comment');
  });

  it('does not mistake a prose apostrophe for a string opener', () => {
    const [tokens] = tokenizeLines(["it's just markdown prose"]);
    expect(kindsOf(tokens)).not.toContain('string');
  });

  it('keeps numbers out of identifiers', () => {
    const [tokens] = tokenizeLines(['grid2 spans 12 columns']);
    expect(tokens).toEqual(
      expect.arrayContaining([{ text: '12', kind: 'number' }]),
    );
    expect(tokens.some((t) => t.kind === 'number' && t.text === '2')).toBe(false);
  });

  it('degrades unrecognized text to plain, never dropping characters', () => {
    const line = '{items.map((item) => <Card {...item} />)}';
    const [tokens] = tokenizeLines([line]);
    expect(textOf(tokens)).toBe(line);
  });
});
