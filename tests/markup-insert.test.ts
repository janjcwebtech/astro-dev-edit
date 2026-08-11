import { describe, expect, it } from 'vitest';
import { TAGS, tagInsertion } from '../src/client/editors/markup-insert.ts';

/**
 * The markup popup's tag palette: what clicking a tag does to the selection,
 * and where the caret lands afterwards. Offsets are relative to the start of
 * the replaced range.
 */

const spec = (tag: string) => TAGS.find((t) => t.tag === tag)!;

describe('tagInsertion', () => {
  it('wraps the selection in a pair and keeps it selected, so tags can be stacked', () => {
    const r = tagInsertion('best', spec('strong'));
    expect(r.text).toBe('<strong>best</strong>');
    expect(r.text.slice(r.caretFrom, r.caretTo)).toBe('best');
  });

  it('leaves the caret between the halves when nothing is selected', () => {
    const r = tagInsertion('', spec('em'));
    expect(r.text).toBe('<em></em>');
    expect(r.caretFrom).toBe('<em>'.length);
    expect(r.caretTo).toBe(r.caretFrom);
  });

  it('inserts a void tag alone, caret after it — a selection is replaced, not wrapped', () => {
    const r = tagInsertion('gone', spec('br'));
    expect(r.text).toBe('<br>');
    expect(r.caretFrom).toBe(4);
    expect(r.caretTo).toBe(4);
  });

  it('parks the caret inside the empty href quotes of a link', () => {
    const r = tagInsertion('docs', spec('a'));
    expect(r.text).toBe('<a href="">docs</a>');
    expect(r.caretFrom).toBe(r.caretTo);
    // The two characters around the caret are the quotes themselves.
    expect(r.text[r.caretFrom - 1]).toBe('"');
    expect(r.text[r.caretFrom]).toBe('"');
  });

  it('parks the caret inside the href quotes for an empty selection too', () => {
    const r = tagInsertion('', spec('a'));
    expect(r.text).toBe('<a href=""></a>');
    expect(r.text[r.caretFrom - 1]).toBe('"');
    expect(r.text[r.caretFrom]).toBe('"');
  });

  it('offers exactly the tags the patcher allows', () => {
    // Mirrors INLINE_TAGS in src/patcher/astro.ts — drift here surfaces as a
    // refusal on save, so the palette must not advertise more than that.
    expect(TAGS.map((t) => t.tag).sort()).toEqual(
      ['a', 'b', 'br', 'code', 'em', 'i', 'small', 'span', 'strong', 'sub', 'sup', 'u'],
    );
  });

  it('marks only <br> as void', () => {
    expect(TAGS.filter((t) => t.isVoid).map((t) => t.tag)).toEqual(['br']);
  });
});
