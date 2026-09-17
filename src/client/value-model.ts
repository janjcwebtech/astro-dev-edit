import type { TargetType } from '../shared/protocol.ts';

/**
 * The staged-value store: what has been typed, what the source held when the
 * typing started, and which of the two the page is showing.
 *
 * **Pure and DOM-free.** No element, no fetch, no timer. The panel and the
 * page are two views of one value, and this is the value — so a field, a
 * contenteditable and an amber outline all read the same object rather than
 * each keeping a copy and drifting.
 *
 * Nothing here writes. `original` exists to be handed back to the server as
 * the apply op's `original`, which is what makes verify-then-patch (rule 5)
 * comparable: the page says what it showed, and a source that has moved on
 * refuses rather than being overwritten.
 *
 * ## Two kinds of target, and why only one of them is written
 *
 * A **source loc** does not move when an edit lands earlier in the same file —
 * it is a line and a column the compiler recomputes on every parse. A **byte
 * range** does. That difference is the whole reason a pending edit can be
 * re-found after an unrelated HMR update: the element's `file:loc` still names
 * it, where `start`/`end` would silently point at different bytes.
 *
 * So {@link ElementTarget} — the clicked element's own value, proven by
 * `/classify` and written through `/apply` — is what stages. A usage-site prop
 * or slot run is a byte range at a usage id, and {@link stageable} refuses it
 * by returning null rather than offering a field the write path cannot serve.
 */

/** The clicked element's own value, addressed the way `/apply` addresses it. */
export interface ElementTarget {
  kind: 'element';
  file: string;
  loc: string;
  /** Lowercased tag, as the apply request carries it. */
  tag: string;
  targetType: TargetType;
}

/** A value passed at a component usage site: a byte range at a usage id.
 *  Read-only here — writing one is the prop/slot editing layer. */
export interface UsageTarget {
  kind: 'usage';
  usageId: string;
  /** The file the usage site is written in — where *View code* lands. */
  file: string;
  loc: string;
  /** The prop's name, or the slot's. */
  name: string;
  slot: boolean;
  start?: number;
  end?: number;
}

export type ValueTarget = ElementTarget | UsageTarget;

/**
 * The target types this write path serves.
 *
 * `text`, `markup` and `expression` are the literal-text targets `/classify`
 * proves and `/apply` already writes. `src` and `alt` are element targets too,
 * and deliberately absent: they are the image picker's, and a field that wrote
 * a path while the grid beside it did not would be two ways to set one value.
 */
const STAGEABLE: ReadonlySet<TargetType> = new Set<TargetType>(['text', 'markup', 'expression']);

/** Whether typing on the page itself can drive this value.
 *
 *  Only `text`. `markup`'s value is the element's *source* — how entities and
 *  attribute quotes were spelled — and a browser hands back normalised
 *  `innerHTML`, so a caret on the page would rewrite the spelling of every
 *  tag in the element as the price of fixing one word. `expression` renders a
 *  string that lives in the frontmatter, which is not the text node at all. */
export const typesOnPage = (target: ElementTarget): boolean => target.targetType === 'text';

/** The element target this row writes through, or null when the write path
 *  does not serve it — a usage-site value, or an image attribute. */
export function stageable(target: ValueTarget): ElementTarget | null {
  return target.kind === 'element' && STAGEABLE.has(target.targetType) ? target : null;
}

/**
 * One value's identity.
 *
 * `file|loc|targetType` is the value, not the element: a literal rendered on
 * two routes, or a component used twice, is one string on one line, so both
 * elements stage together and both go amber together.
 *
 * `original` is part of the identity because a `.map()` breaks the other half
 * of that: every card shares one source loc, and the rendered text is the only
 * thing separating them — which is exactly what the apply op sends. Two cards
 * reading identically collapse to one key here, and the server refuses that
 * pair as ambiguous rather than writing to a guess.
 */
export function valueKey(target: ElementTarget, original: string): string {
  return `${target.file}|${target.loc}|${target.targetType}|${original}`;
}

export interface StagedValue {
  key: string;
  target: ElementTarget;
  /** What the source held when the edit began — the apply op's `original`. */
  original: string;
  /** What has been typed. Never equal to `original`: a value typed back to
   *  what it was is not pending, so it leaves the store. */
  current: string;
  /** The text the page showed when the edit began. Equal to `original` for a
   *  text or expression value; for `markup` the original is source and this is
   *  what was rendered from it. It is how a re-rendered element is recognised
   *  as the one carrying this edit — see the module note on locs. */
  rendered: string;
}

export interface ValueStore {
  /** Stage `current` against the value `original` names. Typing the original
   *  text back discards the entry rather than keeping a clean one. Returns the
   *  entry, or null when nothing is pending. */
  stage(target: ElementTarget, original: string, current: string, rendered?: string): StagedValue | null;
  get(target: ElementTarget, original: string): StagedValue | undefined;
  byKey(key: string): StagedValue | undefined;
  /** Every pending value, in the order it was first staged. */
  all(): readonly StagedValue[];
  /** Drop one entry — Revert, or a landed Save. */
  discard(key: string): StagedValue | undefined;
  /**
   * Drop every value written into `file`, returning what went.
   *
   * The HMR case, and the one that must not be quiet: once that file has
   * changed on disk, `original` no longer describes it, so saving would either
   * be refused by the server or — worse — land on text that moved. The caller
   * says so out loud (rule 5's safety model is the git tree, not an undo).
   */
  dropFile(file: string): readonly StagedValue[];
  clear(): void;
  /** Called after any change, with no argument: readers re-read the store. */
  onChange(listener: () => void): () => void;
}

export function createValueStore(): ValueStore {
  const staged = new Map<string, StagedValue>();
  const listeners = new Set<() => void>();
  const changed = () => { for (const listener of [...listeners]) listener(); };

  return {
    stage(target, original, current, rendered = original) {
      const key = valueKey(target, original);
      const existing = staged.get(key);
      if (current === original) {
        if (!existing) return null;
        staged.delete(key);
        changed();
        return null;
      }
      const entry: StagedValue = { key, target, original, current,
        rendered: existing?.rendered ?? rendered };
      staged.set(key, entry);
      changed();
      return entry;
    },
    get: (target, original) => staged.get(valueKey(target, original)),
    byKey: key => staged.get(key),
    all: () => [...staged.values()],
    discard(key) {
      const entry = staged.get(key);
      if (!entry) return undefined;
      staged.delete(key);
      changed();
      return entry;
    },
    dropFile(file) {
      const gone = [...staged.values()].filter(entry => entry.target.file === file);
      for (const entry of gone) staged.delete(entry.key);
      if (gone.length) changed();
      return gone;
    },
    clear() {
      if (!staged.size) return;
      staged.clear();
      changed();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
