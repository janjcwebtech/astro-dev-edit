import type { UsageLink } from '../shared/protocol.ts';

/**
 * The client's read side of the composition chain: turn an element's
 * `data-atx-chain` into resolved {@link UsageLink}s, batched and cached per
 * page.
 *
 * Why a cache at all — the hover pill's breadcrumb asks for a chain on every
 * dwell, and a chain is 1–8 ids of which the page reuses nearly all: every card
 * in a `.map()` shares its usage site, and every element inside a component
 * shares that component's link. Resolving per hover would be one round-trip per
 * element crossed, which is exactly the classify-per-hover cost the pill rules
 * out. Ids are content-derived and stable across a restart, so the only thing
 * that invalidates them is the source changing — which arrives as an HMR update
 * or a navigation, and both call {@link ChainLinks.invalidate}.
 *
 * `/composition/links` answers a batch in one call and names the ids it could
 * not resolve. A missing id is cached as a miss, not retried: the server has
 * already said this id is not in the route's graph, and asking again on the
 * next hover would turn one honest gap into a request per mouse pass.
 *
 * DOM-free apart from {@link chainIds}, which reads one attribute.
 */

/** The wire's own id shape, mirrored from `composition-routes.ts`'s guard. */
const ID = /^[\w-]{8}$/;
/** The batch endpoint's cap; a deeper chain is truncated rather than refused. */
const MAX_IDS = 128;

/**
 * The usage ids an element's chain names, outermost first.
 *
 * `!` is a root element (rendered by the route itself, nothing above it) and
 * `?` is a chain the transform could not thread; both are empty chains rather
 * than errors — the breadcrumb then has only a route and a leaf to show, which
 * is the truth. Anything that is not one of the three shapes is refused rather
 * than part-parsed, matching `render-occurrences.ts`.
 */
export function chainIds(el: Element): string[] | null {
  const chain = el.getAttribute('data-atx-chain');
  if (chain === null) return null;
  if (chain === '!' || chain === '?') return [];
  if (!/^(?:\.[\w-]{8})+$/.test(chain)) return null;
  return chain.slice(1).split('.').slice(0, MAX_IDS);
}

export interface ChainLinks {
  /** Resolve `ids`, hitting the server only for ones not already known.
   *  Unresolvable ids are absent from the map, never invented. */
  resolve(pathname: string, ids: readonly string[]): Promise<ReadonlyMap<string, UsageLink>>;
  /** Drop the cache — the source, or the page, changed under it. */
  invalidate(): void;
}

export function createChainLinks(api: {
  getCompositionLinks(request: { pathname: string; ids: string[] }): Promise<{ links: UsageLink[]; missing: string[] }>;
}): ChainLinks {
  /** pathname → id → link, or null for an id the server says it does not have. */
  const pages = new Map<string, Map<string, UsageLink | null>>();
  /** In-flight batches, so two dwells on one chain share a request. */
  const pending = new Map<string, Promise<void>>();

  const pageOf = (pathname: string) => {
    let page = pages.get(pathname);
    if (!page) pages.set(pathname, (page = new Map()));
    return page;
  };
  const hits = (page: Map<string, UsageLink | null>, ids: readonly string[]) => {
    const found = new Map<string, UsageLink>();
    for (const id of ids) {
      const link = page.get(id);
      if (link) found.set(id, link);
    }
    return found;
  };

  return {
    invalidate() {
      pages.clear();
      pending.clear();
    },
    async resolve(pathname, ids) {
      const page = pageOf(pathname);
      const wanted = [...new Set(ids)].filter((id) => ID.test(id));
      const absent = wanted.filter((id) => !page.has(id));
      if (absent.length) {
        const key = [pathname, ...absent].join('/');
        let request = pending.get(key);
        if (!request) {
          request = api.getCompositionLinks({ pathname, ids: absent }).then((answer) => {
            // The cache may have been invalidated while this was in flight; the
            // map we hold is then detached, and writing to it is harmless.
            for (const link of answer.links) page.set(link.id, link);
            for (const id of answer.missing) page.set(id, null);
          });
          pending.set(key, request);
          void request.catch(() => {}).finally(() => {
            if (pending.get(key) === request) pending.delete(key);
          });
        }
        await request;
      }
      return hits(page, wanted);
    },
  };
}
