import { isPackagePath } from '../shared/package-path.ts';
import type { SourceLoc } from '../shared/protocol.ts';

/**
 * Source-location capture cache.
 *
 * The client reads `data-atx-file` / `data-atx-loc` and nothing else. Those are
 * the integration's own, injected by `server/annotate.ts` on every supported
 * Astro version, and no other tool strips, shifts or switches them off.
 *
 * Astro's `data-astro-source-*` used to be a second read path here. It is gone,
 * on evidence rather than on taste:
 *
 * - It is not dependable. The dev toolbar strips `data-astro-source-*` out of
 *   the live DOM within a frame of hydration — on **both** majors, including
 *   the copy we inject on 7 for other tooling's benefit. By hover time it has
 *   nothing to offer.
 * - It is not needed. Across five Astro 5.18.2 routes, all **1,721** of Astro's
 *   own `(file, loc)` pairs reproduce byte-identically from our own
 *   annotations, with zero disagreements, and we annotate 75 elements more
 *   (`<html>`, `<head>` and its children, which the compiler skips). The legacy
 *   population was a strict subset of the tool-owned one.
 * - It was not safe. On 5/6 the Go printer splices its own injection-shifted
 *   loc in ahead of ours, so a legacy loc points into *transformed* source and
 *   could outrank a correct one.
 *
 * `sourceAnnotations: 'off'` therefore leaves the client with nothing to read,
 * on every version — `src/index.ts` warns about exactly that.
 *
 * Two-layer cache. The primary key is the element itself: when we see an
 * annotated element we copy its {file, loc} onto a private JS property. The
 * secondary path-keyed map is the fallback for the case where a node is
 * REPLACED wholesale — a framework island re-rendering, or an HMR swap — so a
 * fresh element object carrying no annotation still resolves by structural
 * path. A MutationObserver keeps both fed as the DOM changes.
 *
 * TIMING CONTRACT: this module has no top-level side effects. The entry module
 * (overlay.ts) must call startCapture() synchronously at module evaluation, so
 * the cache is populated before anything asks it a question.
 */

const PROP = '__astroDevEditSrc' as const;
const SOURCE_ELEMENTS = '[data-atx-file]';

function opaque(el: HTMLElement): boolean {
  return Boolean(el.parentElement?.closest('[data-atx-boundary="html"]'));
}

/** The one annotation the client reads. Coordinates refer to untouched source. */
function ownSource(el: HTMLElement): SourceLoc | undefined {
  const file = el.getAttribute('data-atx-file'), loc = el.getAttribute('data-atx-loc');
  return file && loc ? { file, loc } : undefined;
}

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
  if (opaque(el)) return;
  const own = ownSource(el);
  if (!own) return;
  el[PROP] = own;
  sourceByPath.set(elementPath(el), own);
}

/** Snapshot everything currently annotated in the DOM. Called at capture start
 *  and again after HMR re-renders (which re-annotate the fresh DOM). */
export function cacheSourceMappings(): void {
  for (const el of document.querySelectorAll<Stamped>(SOURCE_ELEMENTS)) {
    stamp(el);
  }
}

/**
 * Every live element that carries a captured source loc, in document order.
 *
 * Walks every element rather than querying `SOURCE_ELEMENTS`, because a node
 * replaced after stamping resolves through the cache and no longer carries the
 * attribute. The element-tree panel derives its structure from this. Assumes
 * the DOM has already been stamped (startCapture / cacheSourceMappings), which
 * the boot and HMR paths guarantee before this is called.
 */
export function annotatedElements(root: HTMLElement = document.body): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of root.querySelectorAll<Stamped>('*')) {
    if (!opaque(el) && (ownSource(el) || el[PROP])) out.push(el);
  }
  return out;
}

/** The structural path used as the cache's fallback key — a stable identity for
 *  an element across HMR re-renders (which replace the element object). The tree
 *  panel keys its collapse/selection state on this so both survive a save. */
export function pathFor(el: HTMLElement): string {
  return elementPath(el);
}

/** Live attribute first, then the capture cache for a replaced node. */
export function sourceFor(el: HTMLElement): SourceLoc | undefined {
  if (opaque(el)) return undefined;
  return ownSource(el) ?? (el as Stamped)[PROP] ?? sourceByPath.get(elementPath(el));
}

/** Nearest ancestor (or self) with a source location, live or cached. */
export function nearestSource(node: EventTarget | null): HTMLElement | null {
  let el = node as HTMLElement | null;
  while (el && el !== document.body) {
    if (sourceFor(el)) return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * Whether a loc names a file inside an installed package rather than the
 * user's own source.
 *
 * Asked on hover — `astro:assets` annotates every `<Image>` to
 * `node_modules/astro/components/Image.astro` — so it answers from the string
 * the client already holds rather than a round trip. The predicate itself is
 * shared with the server, which asks the same question of the same annotation.
 */
export function isPackageSource(src: SourceLoc): boolean {
  return isPackagePath(src.file);
}

/**
 * Nearest ancestor (or self) whose source loc is the user's own — skipping
 * package-owned locs.
 *
 * {@link nearestSource} stops at the first annotated element, and for an
 * `astro:assets` `<Image>` that is the `<img>` itself, annotated to Astro's
 * own component. The element is then a dead end: nothing in it can be edited,
 * and the file cannot even be opened. But the element *was* written somewhere
 * — as `<Image …>` or as a wrapper around it — and that somewhere is the
 * nearest enclosing element annotated to a project file.
 *
 * Two levels of indirection do not break it: a `<SiteImage>` wrapping an
 * `<Image>` still renders inside whatever markup the page wrote around it, so
 * the walk lands on that markup rather than on either component.
 *
 * Returns null when nothing above it is the user's either, which is the honest
 * answer for a page whose whole subtree came from a package.
 */
export function nearestOwnSource(from: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = from;
  while (el && el !== document.body) {
    const src = sourceFor(el);
    if (src && !isPackageSource(src)) return el;
    el = el.parentElement;
  }
  return null;
}

// Stamp annotations the instant they appear, so a node replaced later still
// resolves from the cache.
const stampObserver = new MutationObserver((records) => {
  for (const rec of records) {
    if (rec.type === 'attributes' && rec.target instanceof HTMLElement) {
      stamp(rec.target);
    }
    for (const node of rec.addedNodes) {
      if (node instanceof HTMLElement) {
        if (node.matches(SOURCE_ELEMENTS)) stamp(node);
        for (const el of node.querySelectorAll<Stamped>(SOURCE_ELEMENTS)) {
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
    attributeFilter: ['data-atx-file', 'data-atx-loc'],
  });
}
