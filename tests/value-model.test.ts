import { describe, expect, it, vi } from 'vitest';
import {
  createValueStore, stageable, typesOnPage, valueKey,
  type ElementTarget, type ValueTarget,
} from '../src/client/value-model.ts';

/**
 * The staged-value store, with no browser in sight.
 *
 * Two things it exists to settle. **Nothing is written by staging** — the
 * store holds what was typed and the `original` the server will verify it
 * against, and a save is somebody else's call. And **a value is a source
 * location, not an element**: one literal rendered twice is one entry, so two
 * elements go amber together and one Save writes one line.
 */

const at = (over: Partial<ElementTarget> = {}): ElementTarget =>
  ({ kind: 'element', file: '/src/pages/index.astro', loc: '5:3', tag: 'h1', targetType: 'text', ...over });

describe('only a target the write path serves gets a field', () => {
  it('serves the literal-text targets /classify proves', () => {
    for (const targetType of ['text', 'markup', 'expression'] as const) {
      expect(stageable(at({ targetType }))).not.toBeNull();
    }
  });

  it('refuses an image attribute, which the picker owns', () => {
    // Two ways to set one value is the split this design removes: a field that
    // wrote a path while the grid beside it did not.
    for (const targetType of ['src', 'alt'] as const) expect(stageable(at({ targetType }))).toBeNull();
  });

  it('refuses a usage-site value, whose target is a byte range', () => {
    const usage: ValueTarget = { kind: 'usage', usageId: 'k3f9', file: '/src/pages/index.astro',
      loc: '9:3', name: 'title', slot: false, start: 40, end: 52 };
    expect(stageable(usage)).toBeNull();
  });

  it('lets the page itself be typed into only for literal text', () => {
    expect(typesOnPage(at({ targetType: 'text' }))).toBe(true);
    // `markup`'s value is the element's source spelling, which a browser
    // hands back normalised; an expression's words are in the frontmatter.
    expect(typesOnPage(at({ targetType: 'markup' }))).toBe(false);
    expect(typesOnPage(at({ targetType: 'expression' }))).toBe(false);
  });
});

describe('a value is a source location, not an element', () => {
  it('gives one literal rendered in two places one key', () => {
    expect(valueKey(at(), 'Home')).toBe(valueKey(at({ tag: 'span' }), 'Home'));
  });

  it('separates two renders of one loc by the words they showed', () => {
    // Every card in a `.map()` shares a loc; the rendered text is the only
    // thing that tells them apart, and it is what the apply op sends.
    expect(valueKey(at({ targetType: 'expression' }), 'Design'))
      .not.toBe(valueKey(at({ targetType: 'expression' }), 'Build'));
  });

  it('separates the text and the markup of one element', () => {
    expect(valueKey(at({ targetType: 'text' }), 'Hi')).not.toBe(valueKey(at({ targetType: 'markup' }), 'Hi'));
  });
});

describe('staging holds a change without writing it', () => {
  it('keeps the original the server will verify against, alongside what was typed', () => {
    const store = createValueStore();
    store.stage(at(), 'Home', 'Home page');
    expect(store.get(at(), 'Home')).toMatchObject({ original: 'Home', current: 'Home page' });
  });

  it('drops an entry typed back to what it was, rather than keeping a clean one', () => {
    const store = createValueStore();
    store.stage(at(), 'Home', 'Home page');
    expect(store.stage(at(), 'Home', 'Home')).toBeNull();
    expect(store.all()).toHaveLength(0);
  });

  it('keeps what the page showed when the edit began, even as the value moves', () => {
    // For `markup` the original is source and the rendered text is not, so the
    // element carrying the edit is recognised by the latter.
    const store = createValueStore();
    const target = at({ targetType: 'markup' });
    store.stage(target, '<b>Hi</b> there', '<b>Hello</b> there', 'Hi there');
    store.stage(target, '<b>Hi</b> there', '<b>Hey</b> there', 'ignored on a re-stage');
    expect(store.get(target, '<b>Hi</b> there')).toMatchObject({ rendered: 'Hi there', current: '<b>Hey</b> there' });
  });

  it('tells its readers on every change, so the field and the outline agree', () => {
    const store = createValueStore();
    const listener = vi.fn();
    const stop = store.onChange(listener);
    store.stage(at(), 'Home', 'Home page');
    store.discard(valueKey(at(), 'Home'));
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    store.stage(at(), 'Home', 'Again');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('a pending edit is dropped by the file it writes into', () => {
  it('drops every value in that file and names what went', () => {
    const store = createValueStore();
    store.stage(at(), 'Home', 'Home page');
    store.stage(at({ loc: '9:5' }), 'About', 'About us');
    store.stage(at({ file: '/src/components/Nav.astro' }), 'Shop', 'Store');

    const gone = store.dropFile('/src/pages/index.astro');
    expect(gone.map(entry => entry.original)).toEqual(['Home', 'About']);
    // The unrelated file's edit survives: nothing about it moved.
    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]).toMatchObject({ current: 'Store' });
  });

  it('says nothing changed when no pending value lives in that file', () => {
    const store = createValueStore();
    const listener = vi.fn();
    store.stage(at(), 'Home', 'Home page');
    store.onChange(listener);
    expect(store.dropFile('/src/components/Nav.astro')).toHaveLength(0);
    expect(listener).not.toHaveBeenCalled();
  });
});
