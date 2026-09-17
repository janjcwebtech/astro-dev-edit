import type { ApplyRequestWire, UsageApplyRequest } from '../shared/protocol.ts';
import { annotatedElements, sourceFor } from './source-map.ts';
import { COLOR } from './ui.ts';
import {
  createValueStore, typesOnPage,
  type ElementTarget, type StagedValue, type ValueTarget,
} from './value-model.ts';

/**
 * A staged value, everywhere it shows: the field in the panel, the caret on
 * the page, and the amber outline that says the words on screen are not the
 * words on disk.
 *
 * The pure half is `value-model.ts`. This is the half that touches things —
 * elements, the clipboard of the page's own text, and `/apply` — and it exists
 * so that all three views of one value move together. The panel's field and
 * the page's contenteditable are not two editors kept in sync; they are two
 * windows onto one store entry.
 *
 * Three rules it enforces, each of them a decision rather than a detail:
 *
 * - **Nothing commits on blur.** Clicking away, releasing ⌥ or closing the
 *   inspector stops the *typing*; the value stays staged and stays marked.
 *   Only Enter or Save writes, and only Esc or Revert discards.
 * - **Amber is not the selection colour.** A selection outline says "this is
 *   what I picked"; if unsaved wore it too, picked would read as saved.
 * - **State is an attribute, never a style read back** (rule 8). What is
 *   painted is inline, and what is *true* is `data-atx-unsaved`.
 *
 * There is no undo past a save. The git tree is the safety model (rule 5), and
 * nothing here pretends otherwise.
 *
 * ## Why the store outlives the page
 *
 * Astro's dev server answers an `.astro` change with a **full reload**, not a
 * module update — verified against the composition fixture: a sentinel on
 * `window` is gone after touching any component. So a pending edit held only
 * in memory would be lost by any save anywhere, silently, which is the one
 * thing the design rules out.
 *
 * It is therefore mirrored into `sessionStorage` and restored on boot — but
 * never restored *blindly*. Each entry is re-found by its source loc and has
 * to still be showing the text it was staged against; an entry whose element
 * has moved on is dropped and said out loud. That check is what makes "kept
 * across an unrelated update, dropped when its own file changed" fall out of
 * one rule rather than out of reading an HMR payload — and it is the same
 * rule the server applies before writing (rule 5).
 */

/** One key for the origin. Locs are file-based, so a pending edit is as valid
 *  on the next route as on this one. */
const STORAGE_KEY = 'astro-dev-edit:staged';
/**
 * Edits dropped but not yet reported.
 *
 * A drop and the reload that caused it are the same moment, and a toast shown
 * in it is destroyed before it can be read — which is how a loud refusal
 * became a silent one in testing. So the *notice* is queued rather than shown,
 * and whichever comes first drains it: the next boot, or `vite:afterUpdate`
 * when the update turned out not to reload the page at all.
 */
const NOTICE_KEY = 'astro-dev-edit:staged-dropped';

export interface StagedValues {
  /** Type into a value. `rendered` is what the page showed when the edit began
   *  — for `markup` that is not the value, which is the element's source. */
  stage(target: ValueTarget, original: string, current: string, rendered?: string): void;
  /** Throw the pending edit away and put the page back the way it read. */
  revert(key: string): void;
  /** Write it. Resolves to null on success, or the refusal to show in the row —
   *  a stale source refuses here rather than being overwritten (rule 5). */
  save(key: string): Promise<string | null>;
  get(target: ValueTarget, original: string): StagedValue | undefined;
  /**
   * The pending value on this target that the page is *currently showing*.
   *
   * An element value is keyed by the words the source held, and a pending edit
   * has already replaced the words on screen — so a row rebuilt from the page
   * (re-selecting the element, or selecting it on another route after a
   * restore) knows `current`, not `original`. Asking for it by what is shown
   * is what keeps that row's Save sending the `original` the server will
   * verify against, instead of the text it is about to replace.
   *
   * Undefined when two pending values on one target were typed to the same
   * words: which one is being looked at is then unknowable, and a wrong
   * `original` is worse than a refused save.
   */
  pendingFor(target: ValueTarget, shown: string): StagedValue | undefined;
  pending(): readonly StagedValue[];
  /**
   * Drop every pending edit that writes into `file`, returning what went, so
   * the caller can say so out loud. Once that file has changed on disk the
   * `original` a pending edit would send no longer describes it.
   */
  dropFile(file: string): readonly StagedValue[];
  /** Re-find the elements carrying each pending value and repaint them. The
   *  HMR case: the nodes were replaced, the source loc was not. */
  repaint(): void;
  /**
   * Take back the pending edits a full reload threw away, keeping only those
   * whose element still reads the way it did when the edit was staged — the
   * rest are named in `dropped` rather than saved against source that moved.
   * Call it once the page's annotations have been cached.
   */
  restore(): { restored: number; dropped: readonly StagedValue[] };
  /** Every drop not yet reported. Empty unless something was dropped since the
   *  last call, so a caller can announce unconditionally. */
  drainNotices(): readonly StagedValue[];
  onChange(listener: () => void): () => void;

  /** Put the caret on the page, in the element itself, bound to the same value
   *  the field is. Returns immediately for a value the page cannot type into. */
  editOnPage(el: HTMLElement, target: ElementTarget, original: string): void;
  /** Stop typing on the page. Never writes and never discards. */
  stopEditing(): void;
  /** Whether a caret is live in the page. Escape belongs to the edit while one
   *  is — the panel's own Escape listener is on `document` in the capture
   *  phase, so it would otherwise close the panel before the element is asked. */
  isEditing(): boolean;
  /** Where the click that made the selection landed, so the caret can go
   *  there rather than to the start of the element. */
  notePoint(x: number, y: number): void;
}

export interface StagedValuesDeps {
  apply(request: ApplyRequestWire): Promise<void>;
  /** The usage-site half. Two endpoints, because the two targets are addressed
   *  differently — one store, because they are the same gesture. */
  applyUsage(request: UsageApplyRequest): Promise<void>;
}

/** What an outline overwrote, so reverting the mark restores the author's own
 *  inline styles instead of blanking them. */
interface Painted { outline: string; outlineOffset: string }

export function createStagedValues(deps: StagedValuesDeps): StagedValues {
  const store = createValueStore();
  /** The elements currently carrying each pending value, cached so typing does
   *  not re-walk the page on every keystroke. Re-found when they go stale. */
  const bound = new Map<string, HTMLElement[]>();
  const painted = new WeakMap<HTMLElement, Painted>();
  let point: { x: number; y: number } | null = null;
  let editing: (() => void) | null = null;

  // --- The amber mark -------------------------------------------------------

  function mark(el: HTMLElement) {
    if (!painted.has(el)) painted.set(el, { outline: el.style.outline, outlineOffset: el.style.outlineOffset });
    el.dataset.atxUnsaved = '1';
    el.style.outline = `2px solid ${COLOR.warning}`;
    // Inside the selection frame, which `ui.ts::OUTLINE_GAP` draws 2px clear
    // of the element: two rings at one offset read as one thick ring, and the
    // whole point of amber is that it is not the selection colour.
    el.style.outlineOffset = '-1px';
  }

  function unmark(el: HTMLElement) {
    const was = painted.get(el);
    delete el.dataset.atxUnsaved;
    el.style.outline = was?.outline ?? '';
    el.style.outlineOffset = was?.outlineOffset ?? '';
    painted.delete(el);
  }

  /**
   * Every element rendering this value. A source loc identifies the *value*,
   * not the element, so a literal a layout renders on two routes — or a
   * component used twice — is one entry with two elements, and both go amber.
   *
   * The rendered text narrows it, because a `.map()` gives every card the same
   * loc and only its words separate them. Matching `current` as well keeps an
   * element found while it is being typed into.
   */
  function findElements(entry: StagedValue): HTMLElement[] {
    if (entry.target.kind === 'usage') return instanceElements(entry.target);
    const target = entry.target;
    const here = annotatedElements().filter(el => {
      const src = sourceFor(el);
      return !!src && src.file === target.file && src.loc === target.loc;
    });
    // An HTML value is not the words on screen. The browser re-serialises what
    // the string produced — its own quoting, its own optional tags — so there
    // is nothing here to compare the source against, and the container is
    // identified by its loc and by still being a boundary. Two containers
    // rendering one string are two views of one value and both go amber, which
    // is the rule this module already follows for a literal on two routes; a
    // source that has moved on is caught where it always is, by the server
    // verifying `original` before it writes (rule 5).
    if (target.targetType === 'html') {
      return here.filter(el => el.getAttribute('data-atx-boundary') === 'html');
    }
    const wanted = [entry.rendered.trim(), entry.current.trim()];
    return here.filter(el => wanted.includes((el.textContent ?? '').trim()));
  }

  /**
   * What a usage-site value marks: the component instance it was passed to.
   *
   * A prop is read somewhere inside that component and a slot run is rendered
   * inside it, and neither leaves a mark on one element the page could be
   * asked for — so the honest answer is the instance, and the outermost
   * elements it rendered are what draws it. The chain ends with the usage id
   * and the ordinal picks the render, so the second card of a `.map()` goes
   * amber on its own, which is the whole point.
   */
  function instanceElements(target: { usageId: string; ordinal: number }): HTMLElement[] {
    const inside = annotatedElements().filter(el => {
      const chain = el.getAttribute('data-atx-chain') ?? '';
      if (!chain.endsWith('.' + target.usageId)) return false;
      const ordinal = el.getAttribute('data-atx-ordinal');
      return !target.ordinal || ordinal === String(target.ordinal);
    });
    return inside.filter(el => !inside.some(other => other !== el && other.contains(el)));
  }

  function elementsFor(entry: StagedValue): HTMLElement[] {
    const cached = bound.get(entry.key);
    if (cached?.length && cached.every(el => el.isConnected)) return cached;
    const found = findElements(entry);
    bound.set(entry.key, found);
    return found;
  }

  // --- Surviving the reload -------------------------------------------------

  /** `sessionStorage` is absent or full in enough browsers and modes that a
   *  throw here must cost nothing: losing persistence is a degraded feature,
   *  and breaking the page over it would be a worse one. */
  function persist() {
    try {
      const entries = store.all();
      if (entries.length) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch { /* no persistence; the edit lives as long as the page does. */ }
  }

  function read(key: string): StagedValue[] {
    try {
      const raw = sessionStorage.getItem(key);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      // Shape-checked rather than trusted: this crossed a storage boundary,
      // and a half-written entry must not become a write target.
      return parsed.filter((entry): entry is StagedValue => {
        if (!entry || typeof entry.original !== 'string' || typeof entry.current !== 'string' ||
          typeof entry.rendered !== 'string' || !entry.target) return false;
        const target = entry.target;
        if (typeof target.file !== 'string' || typeof target.loc !== 'string') return false;
        return target.kind === 'element' ? typeof target.tag === 'string'
          : target.kind === 'usage' && typeof target.usageId === 'string' &&
            typeof target.pathname === 'string' && typeof target.name === 'string' &&
            typeof target.ordinal === 'number' && typeof target.slot === 'boolean';
      });
    } catch {
      return [];
    }
  }

  /** Queue a drop to be announced by whoever gets there first. */
  function queueNotice(entries: readonly StagedValue[]) {
    if (!entries.length) return;
    try {
      sessionStorage.setItem(NOTICE_KEY, JSON.stringify([...read(NOTICE_KEY), ...entries]));
    } catch { /* unannounced beats broken; the outline is already gone. */ }
  }

  function drainNotices(): StagedValue[] {
    const notices = read(NOTICE_KEY);
    try { sessionStorage.removeItem(NOTICE_KEY); } catch { /* nothing to clear. */ }
    return notices;
  }

  /** Repaint from the store: every pending value marked, everything it no
   *  longer holds cleared. Driven by `onChange`, so no caller has to remember. */
  function sync() {
    const live = new Set<string>();
    for (const entry of store.all()) {
      live.add(entry.key);
      for (const el of elementsFor(entry)) mark(el);
    }
    for (const [key, elements] of [...bound]) {
      if (live.has(key)) continue;
      for (const el of elements) unmark(el);
      bound.delete(key);
    }
  }
  store.onChange(sync);
  store.onChange(persist);

  // --- Typing ---------------------------------------------------------------

  /** Show the pending text on every element bound to the value except the one
   *  holding the caret — rewriting that node collapses the selection to its
   *  start on every keystroke. Only for `text`: an expression's words live in
   *  the frontmatter and markup's value is source, so neither is this node. */
  function mirror(entry: StagedValue, except: HTMLElement | null) {
    if (!typesOnPage(entry.target)) return;
    for (const el of elementsFor(entry)) if (el !== except) el.textContent = entry.current;
  }

  function stage(target: ValueTarget, original: string, current: string, rendered = original) {
    const entry = store.stage(target, original, current, rendered);
    if (entry) mirror(entry, document.activeElement instanceof HTMLElement ? document.activeElement : null);
  }

  function revert(key: string) {
    const entry = store.byKey(key);
    if (!entry) return;
    // Put the page back before the entry goes: once it is gone there is
    // nothing left that knows which elements were showing the pending words.
    if (typesOnPage(entry.target)) for (const el of elementsFor(entry)) el.textContent = entry.original;
    store.discard(key);
  }

  async function save(key: string): Promise<string | null> {
    const entry = store.byKey(key);
    if (!entry) return null;
    const target = entry.target;
    try {
      if (target.kind === 'usage') {
        await deps.applyUsage({
          pathname: target.pathname, usageId: target.usageId, ordinal: target.ordinal,
          target: { kind: target.slot ? 'slot' : 'prop', name: target.name, start: target.start ?? -1 },
          original: entry.original, newText: entry.current,
        });
      } else {
        await deps.apply({
          file: target.file, loc: target.loc, tag: target.tag,
          ops: [{ targetType: target.targetType, original: entry.original, newText: entry.current }],
        });
      }
    } catch (error) {
      // The value stays staged and stays amber: a refused write has changed
      // nothing, and dropping what was typed would be a second loss.
      return error instanceof Error ? error.message : 'The edit could not be saved.';
    }
    store.discard(key);
    return null;
  }

  // --- The caret on the page ------------------------------------------------

  function placeCaret(el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const inside = point && point.x >= rect.left && point.x <= rect.right &&
      point.y >= rect.top && point.y <= rect.bottom;
    const selection = window.getSelection();
    if (!selection) return;
    // `caretRangeFromPoint` is the non-standard name Safari and Chrome ship;
    // Firefox has `caretPositionFromPoint`. Without either the caret simply
    // lands at the end, which is where a click past the text would put it.
    const at = inside && typeof document.caretRangeFromPoint === 'function'
      ? document.caretRangeFromPoint(point!.x, point!.y) : null;
    const range = at ?? document.createRange();
    if (!at) {
      range.selectNodeContents(el);
      range.collapse(false);
    }
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function editOnPage(el: HTMLElement, target: ElementTarget, original: string) {
    stopEditing();
    if (!typesOnPage(target)) return;
    el.setAttribute('contenteditable', 'plaintext-only');
    el.dataset.atxEditing = '1';
    el.focus({ preventScroll: true });
    placeCaret(el);

    const onInput = () => stage(target, original, el.textContent ?? '', original);
    const onKey = (event: KeyboardEvent) => {
      const entry = store.get(target, original);
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (entry) void save(entry.key);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        // Stop first: reverting restores the text, and a live caret in a node
        // whose contents were replaced is a selection pointing at nothing.
        stopEditing();
        if (entry) revert(entry.key);
      }
    };
    el.addEventListener('input', onInput);
    el.addEventListener('keydown', onKey);
    editing = () => {
      el.removeEventListener('input', onInput);
      el.removeEventListener('keydown', onKey);
      el.removeAttribute('contenteditable');
      delete el.dataset.atxEditing;
      editing = null;
    };
  }

  function stopEditing() {
    editing?.();
  }

  return {
    stage, revert, save, editOnPage, stopEditing,
    isEditing: () => editing !== null,
    get: (target, original) => store.get(target, original),
    pendingFor: (target, shown) => store.showing(target, shown),
    pending: () => store.all(),
    dropFile(file) {
      stopEditing();
      // The page is about to be replaced by the update that changed this file,
      // so there is nothing to restore — only the store and the marks to clear.
      const gone = store.dropFile(file);
      for (const entry of gone) bound.delete(entry.key);
      queueNotice(gone);
      return gone;
    },
    repaint() {
      for (const entry of store.all()) bound.delete(entry.key);
      sync();
    },
    drainNotices,
    restore() {
      const dropped: StagedValue[] = drainNotices();
      let restored = 0;
      for (const entry of read(STORAGE_KEY)) {
        // The one question: does the page still read the way this edit was
        // made against it? An unrelated change leaves that true; a change to
        // this value's own line does not, and the edit goes rather than being
        // written on top of whatever replaced it.
        if (!findElements({ ...entry, current: entry.rendered }).length) {
          dropped.push(entry);
          continue;
        }
        // Through the local `stage`, not the bare store: restoring a value
        // has to put the pending words back on the page as well as in the
        // record, or the outline would be amber over text that reads saved.
        stage(entry.target, entry.original, entry.current, entry.rendered);
        restored++;
      }
      // Whatever survived is now the record; whatever did not is gone from it.
      persist();
      return { restored, dropped };
    },
    onChange: listener => store.onChange(listener),
    notePoint(x, y) { point = { x, y }; },
  };
}
