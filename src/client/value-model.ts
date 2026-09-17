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
 * ## Two kinds of target, addressed two ways
 *
 * {@link ElementTarget} is the clicked element's own value, proven by
 * `/classify` and written through `/apply`. It is addressed by `file:loc`,
 * which does *not* move when an edit lands earlier in the same file — the
 * compiler recomputes it on every parse — and that is what lets a pending edit
 * be re-found after an unrelated HMR update.
 *
 * {@link UsageTarget} is a value passed at a component usage site, written
 * through `/composition/apply`. It is addressed by a **usage id**, and its
 * `start` is a byte offset the server only ever uses to *select* among the
 * values it parses for itself. Bytes do move, which is why they are a selector
 * and not a write offset, and why the server refuses when nothing of its own
 * starts there.
 *
 * {@link writable} is the one place that says which targets the write path
 * serves at all — `src` and `alt` are the image picker's, not a field's.
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

/** A value passed at a component usage site, addressed the way
 *  `/composition/apply` addresses it. */
export interface UsageTarget {
  kind: 'usage';
  usageId: string;
  /** The route the id was resolved on. The usage index is route-scoped, so it
   *  is what turns the id back into a file — and it travels with the value
   *  because a pending edit outlives the page it was made on. */
  pathname: string;
  /** The file the usage site is written in — where *View code* lands, and what
   *  an HMR drop matches against. Never sent: the server resolves its own. */
  file: string;
  loc: string;
  /** The prop's name, or the slot's. */
  name: string;
  slot: boolean;
  /** Which render of this usage site the panel was describing. `0` is unknown,
   *  and a value read from a `.map()` then refuses. */
  ordinal: number;
  start?: number;
  end?: number;
}

export type ValueTarget = ElementTarget | UsageTarget;

/**
 * The target types this write path serves.
 *
 * `text`, `markup` and `expression` are the literal-text targets `/classify`
 * proves and `/apply` already writes; `html` is a `set:html` container's whole
 * string, which is a value like any other once it is edited raw. `src` and
 * `alt` are element targets too, and deliberately absent: they are the image
 * picker's, and a field that wrote a path while the grid beside it did not
 * would be two ways to set one value.
 */
const STAGEABLE: ReadonlySet<TargetType> = new Set<TargetType>(['text', 'markup', 'expression', 'html']);

/** Whether typing on the page itself can drive this value.
 *
 *  Only an element's `text`. `markup`'s value is the element's *source* — how
 *  entities and attribute quotes were spelled — and a browser hands back
 *  normalised `innerHTML`, so a caret on the page would rewrite the spelling
 *  of every tag in the element as the price of fixing one word. `expression`
 *  renders a string that lives in the frontmatter, which is not the text node
 *  at all; `html` is a raw string whose tags a caret would turn into the very
 *  elements they describe; and a usage-site value is rendered somewhere inside
 *  a component. */
export const typesOnPage = (target: ValueTarget): boolean =>
  target.kind === 'element' && target.targetType === 'text';

/** The target this row writes through, or null when the write path does not
 *  serve it — today that is only an image attribute, which the picker owns. */
export function writable(target: ValueTarget): ValueTarget | null {
  return target.kind === 'usage' || STAGEABLE.has(target.targetType) ? target : null;
}

/**
 * One value's identity.
 *
 * For an element, `file|loc|targetType` is the value rather than the element:
 * a literal rendered on two routes, or a component used twice, is one string
 * on one line, so both elements stage together and both go amber together.
 * `original` is part of it because a `.map()` breaks the other half of that —
 * every card shares one source loc, and the rendered text is the only thing
 * separating them, which is exactly what the apply op sends. Two cards reading
 * identically collapse to one key here, and the server refuses that pair as
 * ambiguous rather than writing to a guess.
 *
 * For a usage-site value the ordinal separates the renders instead, so two
 * cards reading identically are still two values. It has to: the whole point
 * of the ordinal is that render 2 writes array entry 2 whatever it says.
 */
export function valueKey(target: ValueTarget, original: string): string {
  return target.kind === 'element'
    ? `${target.file}|${target.loc}|${target.targetType}|${original}`
    : `${target.usageId}|${target.slot ? 'slot' : 'prop'}|${target.name}|${target.start}|${target.ordinal}`;
}

export interface StagedValue {
  key: string;
  target: ValueTarget;
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

/** Same value, whatever words it is carrying — {@link valueKey} minus the
 *  `original` an element value is keyed by. */
export function sameTarget(a: ValueTarget, b: ValueTarget): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === 'element'
    ? a.file === b.file && a.loc === b.loc && a.targetType === (b as ElementTarget).targetType
    : valueKey(a, '') === valueKey(b, '');
}

export interface ValueStore {
  /** Stage `current` against the value `original` names. Typing the original
   *  text back discards the entry rather than keeping a clean one. Returns the
   *  entry, or null when nothing is pending. */
  stage(target: ValueTarget, original: string, current: string, rendered?: string): StagedValue | null;
  get(target: ValueTarget, original: string): StagedValue | undefined;
  /**
   * The pending value on this target that the page is *currently showing*.
   *
   * An element value is keyed by the words the source held, and a pending edit
   * has already replaced the words on screen — so a row rebuilt from the page
   * knows `current`, not `original`. Asking by what is shown is what keeps
   * that row's Save sending the `original` the server verifies against,
   * instead of the text it is about to replace.
   *
   * Undefined when two pending values on one target were typed to the same
   * words: which one is being looked at is then unknowable, and a wrong
   * `original` is worse than a refused save.
   */
  showing(target: ValueTarget, shown: string): StagedValue | undefined;
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
    showing(target, shown) {
      const direct = staged.get(valueKey(target, shown));
      if (direct) return direct;
      const candidates = [...staged.values()].filter(entry =>
        sameTarget(entry.target, target) && entry.current.trim() === shown.trim());
      return candidates.length === 1 ? candidates[0] : undefined;
    },
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
