import type { SourceLoc } from '../shared/protocol.ts';

/**
 * Source-location capture cache.
 *
 * Astro emits `data-astro-source-file` / `-loc` in the served HTML, but its
 * dev-toolbar runtime STRIPS those attributes out of the DOM shortly after
 * hydration. By hover time they are gone — querying them live finds nothing.
 * (Verified against Astro 5.18: 254 attrs in served HTML, 0 in the live DOM.)
 *
 * So we snapshot every annotated element the instant it appears, before the
 * toolbar clears them, and read hover/edit locations from the cache instead of
 * from live attributes. This is the same approach the astro-click-to-source
 * integration uses. It supersedes spec §4.2's "re-read attributes lazily on
 * next hover", which is not viable here.
 *
 * Two-layer cache. The primary key is the element itself: when we see an
 * annotated element we copy its {file, loc} onto a private JS property. A JS
 * property survives the attribute-strip (Astro removes the HTML attribute, not
 * our property) AND survives across hover with no path matching. The secondary
 * path-keyed map is the fallback for the case where Astro REPLACES a node
 * wholesale (new object, our property gone): we re-resolve by structural path.
 *
 * The critical timing fix: we don't snapshot once and hope. A MutationObserver
 * watches for the attributes being added (initial render / HMR) and stamps them
 * onto the element the moment they appear — so we always capture the value
 * before the toolbar's own observer strips it, regardless of ordering.
 *
 * TIMING CONTRACT: this module has no top-level side effects. The entry module
 * (overlay.ts) must call startCapture() synchronously at module evaluation to
 * win the race against the toolbar's stripping.
 */

const PROP = '__astroTextEditSrc' as const;

interface Stamped extends HTMLElement {
  [PROP]?: SourceLoc;
}

const sourceByPath = new Map<string, SourceLoc>();

/** Structural path: `tag:nth-of-type` chain to the document root. Computed from
 *  the live DOM at both stamp and lookup time, so the two always agree. */
function elementPath(el: HTMLElement): string {
  const parts: string[] = [];
  let cur: HTMLElement | null = el;
  while (cur && cur.parentElement) {
    const parent: HTMLElement = cur.parentElement;
    const tag = cur.tagName;
    let idx = 1;
    for (const sib of parent.children) {
      if (sib === cur) break;
      if (sib.tagName === tag) idx++;
    }
    parts.unshift(`${tag.toLowerCase()}:nth-of-type(${idx})`);
    cur = parent;
  }
  return parts.join('>');
}

/** Record an annotated element's source loc into both cache layers. */
function stamp(el: Stamped): void {
  if (el[PROP]) return;
  const file = el.getAttribute('data-astro-source-file');
  if (!file) return;
  const loc = el.getAttribute('data-astro-source-loc') ?? '';
  const src: SourceLoc = { file, loc };
  el[PROP] = src;
  sourceByPath.set(elementPath(el), src);
}

/** Snapshot everything currently annotated in the DOM. Called at capture start
 *  and again after HMR re-renders (which re-annotate the fresh DOM). */
export function cacheSourceMappings(): void {
  for (const el of document.querySelectorAll<Stamped>('[data-astro-source-file]')) {
    stamp(el);
  }
}

/**
 * Every live element that carries a captured source loc, in document order.
 *
 * The `data-astro-source-*` attributes are gone by now (the toolbar stripped
 * them), so we can't query them — we read the stamped JS property instead,
 * which persists. This is the only way to enumerate annotated elements after
 * boot; the element-tree panel derives its structure from it. Assumes the DOM
 * has already been stamped (startCapture / cacheSourceMappings), which the boot
 * and HMR paths guarantee before this is called.
 */
export function annotatedElements(root: HTMLElement = document.body): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of root.querySelectorAll<Stamped>('*')) {
    if (el[PROP]) out.push(el);
  }
  return out;
}

/** The structural path used as the cache's fallback key — a stable identity for
 *  an element across HMR re-renders (which replace the element object). The tree
 *  panel keys its collapse/selection state on this so both survive a save. */
export function pathFor(el: HTMLElement): string {
  return elementPath(el);
}

/** Resolve a live element's source loc: property first, path fallback. */
export function sourceFor(el: HTMLElement): SourceLoc | undefined {
  return (el as Stamped)[PROP] ?? sourceByPath.get(elementPath(el));
}

/**
 * Nearest ancestor (or self) with a cached source location. Reads the
 * snapshot cache, not live attributes — the attributes are gone by now.
 */
export function nearestSource(node: EventTarget | null): HTMLElement | null {
  let el = node as HTMLElement | null;
  while (el && el !== document.body) {
    if (sourceFor(el)) return el;
    el = el.parentElement;
  }
  return null;
}

// Stamp attributes the instant they appear, before the dev toolbar strips them.
// This wins the race regardless of script ordering. (verified fix)
const stampObserver = new MutationObserver((records) => {
  for (const rec of records) {
    if (rec.type === 'attributes' && rec.target instanceof HTMLElement) {
      stamp(rec.target);
    }
    for (const node of rec.addedNodes) {
      if (node instanceof HTMLElement) {
        if (node.hasAttribute('data-astro-source-file')) stamp(node);
        for (const el of node.querySelectorAll<Stamped>('[data-astro-source-file]')) {
          stamp(el);
        }
      }
    }
  }
});

/** Begin capturing: snapshot what's present, then observe for the rest. */
export function startCapture(): void {
  cacheSourceMappings(); // grab whatever is already present
  stampObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-astro-source-file', 'data-astro-source-loc'],
  });
}
