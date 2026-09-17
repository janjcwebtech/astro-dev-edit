import { describe, expect, it, vi } from 'vitest';
import {
  createValueStore, typesOnPage, valueKey, writable,
  type ElementTarget, type UsageTarget, type ValueTarget,
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
const usage = (over: Partial<UsageTarget> = {}): UsageTarget =>
  ({ kind: 'usage', usageId: 'k3f9x2a1', pathname: '/', file: '/src/pages/index.astro', loc: '9:3',
    name: 'title', slot: false, ordinal: 1, start: 40, end: 52, ...over });

describe('only a target the write path serves gets a field', () => {
  it('serves the literal-text targets /classify proves', () => {
    for (const targetType of ['text', 'markup', 'expression'] as const) {
      expect(writable(at({ targetType }))).not.toBeNull();
    }
  });

  it('refuses an image attribute, which the picker owns', () => {
    // Two ways to set one value is the split this design removes: a field that
    // wrote a path while the grid beside it did not.
    for (const targetType of ['src', 'alt'] as const) expect(writable(at({ targetType }))).toBeNull();
  });

  it('serves a usage-site value, which writes through its own endpoint', () => {
    expect(writable(usage())).not.toBeNull();
  });

  it('lets the page itself be typed into only for literal text', () => {
    expect(typesOnPage(at({ targetType: 'text' }))).toBe(true);
    // `markup`'s value is the element's source spelling, which a browser
    // hands back normalised; an expression's words are in the frontmatter.
    expect(typesOnPage(at({ targetType: 'markup' }))).toBe(false);
    expect(typesOnPage(at({ targetType: 'expression' }))).toBe(false);
    // A usage-site value is rendered somewhere inside a component, so there is
    // no text node on the page that *is* it.
    expect(typesOnPage(usage())).toBe(false);
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

/**
 * A usage-site value is the same store entry, addressed the other way.
 *
 * One store was the decision: the gesture — type, Save, Revert — is one
 * gesture, and the only thing that differs is where the words are written.
 */
describe('a value at a usage site is keyed by its render, not by its words', () => {
  it('keeps two renders of one usage site apart even when they read alike', () => {
    // The whole point of the ordinal: render 2 writes array entry 2 whatever
    // it says, so two identical cards are still two values.
    expect(valueKey(usage({ ordinal: 1 }), 'Same'))
      .not.toBe(valueKey(usage({ ordinal: 2 }), 'Same'));
  });

  it('separates two props of one site, and a prop from a slot at the same offset', () => {
    expect(valueKey(usage({ name: 'title' }), 'x')).not.toBe(valueKey(usage({ name: 'eyebrow' }), 'x'));
    expect(valueKey(usage(), 'x')).not.toBe(valueKey(usage({ slot: true }), 'x'));
  });

  it('is the same value however the words change under it', () => {
    // Unlike an element value: a usage site's identity is the site and the
    // render, and the words are what is being edited rather than the address.
    expect(valueKey(usage(), 'Protected')).toBe(valueKey(usage(), 'Guarded'));
  });

  it('stages and discards through the one store, like any other value', () => {
    const store = createValueStore();
    const entry = store.stage(usage(), 'Protected', 'Guarded');
    expect(entry).toMatchObject({ original: 'Protected', current: 'Guarded' });
    expect(store.all()).toHaveLength(1);
    // Its file is the usage site's, so an HMR drop finds it by the same rule.
    expect(store.dropFile('/src/pages/index.astro')).toHaveLength(1);
    expect(store.all()).toHaveLength(0);
  });
});

/**
 * Finding a pending value by what the page is *showing*.
 *
 * An element value is keyed by the words the source held, and a pending edit
 * has already replaced the words on screen. A row rebuilt from the page —
 * re-selecting the element, or selecting it on another route after a restore —
 * therefore knows `current`, not `original`. Without this, Revert found
 * nothing and Save sent the text it was about to replace as the `original` the
 * server verifies against.
 */
describe('a pending value is found by the words on screen', () => {
  it('finds it by what was typed, not only by what the source held', () => {
    const store = createValueStore();
    store.stage(at(), 'Shared on two routes', 'Pending across routes');
    expect(store.get(at(), 'Pending across routes')).toBeUndefined();
    expect(store.showing(at(), 'Pending across routes')?.original).toBe('Shared on two routes');
    // The plain lookup still answers when the page has not moved on.
    expect(store.showing(at(), 'Shared on two routes')?.original).toBe('Shared on two routes');
  });

  it('answers nothing when two pending values on one target read alike', () => {
    // Two cards of a `.map()` typed to the same words: which one is being
    // looked at is unknowable, and a wrong `original` beats a refused save.
    const store = createValueStore();
    const card = at({ targetType: 'expression' });
    store.stage(card, 'Design', 'Same');
    store.stage(card, 'Build', 'Same');
    expect(store.showing(card, 'Same')).toBeUndefined();
  });

  it('never crosses to another value of the same element, or another element', () => {
    const store = createValueStore();
    store.stage(at(), 'Words', 'Typed');
    expect(store.showing(at({ targetType: 'markup' }), 'Typed')).toBeUndefined();
    expect(store.showing(at({ loc: '9:1' }), 'Typed')).toBeUndefined();
    // The tag is not part of a value's identity, so it does not separate one.
    expect(store.showing(at({ tag: 'span' }), 'Typed')?.current).toBe('Typed');
  });

  it('finds a usage-site value whatever its words, since its key has none', () => {
    const store = createValueStore();
    store.stage(usage(), 'Protected', 'Guarded');
    expect(store.showing(usage(), 'Guarded')?.original).toBe('Protected');
    expect(store.showing(usage({ ordinal: 2 }), 'Guarded')).toBeUndefined();
  });
});
