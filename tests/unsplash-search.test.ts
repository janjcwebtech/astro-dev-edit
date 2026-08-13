import { beforeEach, describe, expect, it } from 'vitest';
import type { UnsplashPhoto, UnsplashSearchRequest, UnsplashSearchResponse } from '../src/shared/protocol.ts';
import { createSearchController, type SearchError, type SearchState } from '../src/client/unsplash-search.ts';

/**
 * The Unsplash pane's search logic, tested without a DOM or a network. Time is
 * driven through injected timers, so "three keystrokes issue one request" and
 * "a slow response never overwrites a newer one" are pinned rather than hoped
 * for — the failure mode is silent, and the client layer has no other coverage.
 */

/** A minimal fake clock: timers fire only when `tick` is called. */
function makeClock() {
  let next = 1;
  const pending = new Map<number, () => void>();
  return {
    setTimer: (fn: () => void) => {
      const id = next++;
      pending.set(id, fn);
      return id;
    },
    clearTimer: (h: unknown) => {
      pending.delete(h as number);
    },
    /** Fire every timer currently pending. */
    tick() {
      const due = [...pending.entries()];
      pending.clear();
      for (const [, fn] of due) fn();
    },
    get size() {
      return pending.size;
    },
  };
}

function photo(id: string): UnsplashPhoto {
  return {
    id,
    thumbUrl: `https://images.unsplash.com/${id}`,
    color: '#000000',
    width: 100,
    height: 100,
    description: id,
    photographer: 'Ada',
    photographerUrl: 'https://unsplash.com/@ada?utm_source=x&utm_medium=referral',
    pageUrl: `https://unsplash.com/photos/${id}?utm_source=x&utm_medium=referral`,
  };
}

function page(ids: string[], over: Partial<UnsplashSearchResponse> = {}): UnsplashSearchResponse {
  return {
    photos: ids.map(photo),
    total: 100,
    totalPages: 5,
    page: 1,
    ...over,
  };
}

/** A search fake whose promises are resolved by hand, so ordering is explicit. */
function makeSearch() {
  const calls: UnsplashSearchRequest[] = [];
  const resolvers: Array<{
    resolve: (r: UnsplashSearchResponse) => void;
    reject: (e: unknown) => void;
  }> = [];
  const search = (req: UnsplashSearchRequest): Promise<UnsplashSearchResponse> => {
    calls.push(req);
    return new Promise((resolve, reject) => resolvers.push({ resolve, reject }));
  };
  return { calls, resolvers, search };
}

let clock: ReturnType<typeof makeClock>;
let api: ReturnType<typeof makeSearch>;
let states: SearchState[];

function build(over: Partial<Parameters<typeof createSearchController>[0]> = {}) {
  return createSearchController({
    search: api.search,
    onState: (s) => states.push(s),
    debounceMs: 300,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    toError: (err: unknown): SearchError => ({
      code: (err as { code?: SearchError['code'] })?.code ?? 'unknown',
      message: String((err as Error)?.message ?? err),
      retryable: (err as { retryable?: boolean })?.retryable ?? true,
    }),
    ...over,
  });
}

beforeEach(() => {
  clock = makeClock();
  api = makeSearch();
  states = [];
});

describe('debouncing', () => {
  it('issues one request for three keystrokes inside the window', () => {
    const c = build();
    c.setQuery('f');
    c.setQuery('fo');
    c.setQuery('for');
    expect(api.calls).toHaveLength(0);
    clock.tick();
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].query).toBe('for');
  });

  it('stays idle on a blank or whitespace query, with no fetch', () => {
    const c = build();
    c.setQuery('   ');
    clock.tick();
    expect(api.calls).toHaveLength(0);
    expect(c.state()).toEqual({ status: 'idle' });
  });

  it('resets to idle immediately when the box is cleared', () => {
    const c = build();
    c.setQuery('forest');
    clock.tick();
    api.resolvers[0].resolve(page(['a']));
    c.setQuery('');
    expect(c.state()).toEqual({ status: 'idle' });
    expect(clock.size).toBe(0);
  });

  it('trims the query it sends', () => {
    const c = build();
    c.setQuery('  forest  ');
    clock.tick();
    expect(api.calls[0].query).toBe('forest');
  });

  it('retry() bypasses the debounce', () => {
    const c = build();
    c.setQuery('forest');
    c.retry();
    expect(api.calls).toHaveLength(1);
    // The pending debounce was cancelled, so ticking adds nothing.
    clock.tick();
    expect(api.calls).toHaveLength(1);
  });

  it('dispose() cancels a pending debounce and ignores a late response', async () => {
    const c = build();
    c.setQuery('forest');
    clock.tick();
    c.dispose();
    api.resolvers[0].resolve(page(['a']));
    await Promise.resolve();
    expect(states.filter((s) => s.status === 'ready')).toHaveLength(0);
  });
});

describe('stale-response guarding', () => {
  it('discards a slow response superseded by a newer query', async () => {
    const c = build();
    c.setQuery('forest');
    clock.tick();
    c.setQuery('desert');
    clock.tick();
    expect(api.calls.map((r) => r.query)).toEqual(['forest', 'desert']);

    // The *first* request answers last.
    api.resolvers[1].resolve(page(['desert-1']));
    await Promise.resolve();
    api.resolvers[0].resolve(page(['forest-1']));
    await Promise.resolve();

    const at = c.state();
    expect(at.status).toBe('ready');
    if (at.status === 'ready') {
      expect(at.query).toBe('desert');
      expect(at.photos.map((p) => p.id)).toEqual(['desert-1']);
    }
  });

  it('discards a stale error too', async () => {
    const c = build();
    c.setQuery('forest');
    clock.tick();
    c.setQuery('desert');
    clock.tick();
    api.resolvers[1].resolve(page(['desert-1']));
    await Promise.resolve();
    api.resolvers[0].reject(new Error('too late'));
    await Promise.resolve();
    expect(c.state().status).toBe('ready');
  });
});

describe('results', () => {
  it('reports zero matches as `empty`, not an empty ready', async () => {
    const c = build();
    c.setQuery('zxcvbnm');
    clock.tick();
    api.resolvers[0].resolve(page([], { total: 0, totalPages: 0 }));
    await Promise.resolve();
    expect(c.state()).toEqual({ status: 'empty', query: 'zxcvbnm' });
  });

  it('passes through totals and the remaining-request count', async () => {
    const c = build();
    c.setQuery('forest');
    clock.tick();
    api.resolvers[0].resolve(page(['a'], { total: 1283, totalPages: 65, remaining: 12 }));
    await Promise.resolve();
    const at = c.state();
    expect(at.status).toBe('ready');
    if (at.status === 'ready') {
      expect(at.total).toBe(1283);
      expect(at.totalPages).toBe(65);
      expect(at.remaining).toBe(12);
    }
  });

  it('goes through `loading` on the way to results', async () => {
    const c = build();
    c.setQuery('forest');
    clock.tick();
    expect(states.at(-1)).toEqual({ status: 'loading', query: 'forest' });
    api.resolvers[0].resolve(page(['a']));
    await Promise.resolve();
    expect(states.at(-1)!.status).toBe('ready');
  });
});

describe('errors', () => {
  it('surfaces the error code and retryability', async () => {
    const c = build();
    c.setQuery('forest');
    clock.tick();
    api.resolvers[0].reject(
      Object.assign(new Error('Unsplash rejected the access key.'), {
        code: 'unauthorized',
        retryable: false,
      }),
    );
    await Promise.resolve();
    const at = c.state();
    expect(at.status).toBe('error');
    if (at.status === 'error') {
      expect(at.error.code).toBe('unauthorized');
      expect(at.error.retryable).toBe(false);
    }
  });

  it('recovers on a retry after an error', async () => {
    const c = build();
    c.setQuery('forest');
    clock.tick();
    api.resolvers[0].reject(new Error('offline'));
    await Promise.resolve();
    expect(c.state().status).toBe('error');

    c.retry();
    api.resolvers[1].resolve(page(['a']));
    await Promise.resolve();
    expect(c.state().status).toBe('ready');
  });
});

describe('loadMore', () => {
  async function ready() {
    const c = build();
    c.setQuery('forest');
    clock.tick();
    api.resolvers[0].resolve(page(['a', 'b'], { page: 1, totalPages: 3 }));
    await Promise.resolve();
    return c;
  }

  it('appends the next page and bumps the page number', async () => {
    const c = await ready();
    c.loadMore();
    expect(api.calls[1].page).toBe(2);
    api.resolvers[1].resolve(page(['c'], { page: 2, totalPages: 3 }));
    await Promise.resolve();
    const at = c.state();
    if (at.status !== 'ready') throw new Error('expected ready');
    expect(at.photos.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(at.page).toBe(2);
    expect(at.loadingMore).toBe(false);
  });

  it('marks loadingMore while a page is in flight and ignores a second call', async () => {
    const c = await ready();
    c.loadMore();
    const at = c.state();
    expect(at.status === 'ready' && at.loadingMore).toBe(true);
    c.loadMore();
    expect(api.calls).toHaveLength(2);
  });

  it('does nothing on the last page', async () => {
    const c = build();
    c.setQuery('forest');
    clock.tick();
    api.resolvers[0].resolve(page(['a'], { page: 3, totalPages: 3 }));
    await Promise.resolve();
    c.loadMore();
    expect(api.calls).toHaveLength(1);
  });

  it('discards a page whose query changed while it was in flight', async () => {
    const c = await ready();
    c.loadMore();
    c.setQuery('desert');
    clock.tick();
    // The page-2 response for "forest" lands after the new search was issued.
    api.resolvers[1].resolve(page(['c'], { page: 2 }));
    await Promise.resolve();
    api.resolvers[2].resolve(page(['desert-1'], { page: 1 }));
    await Promise.resolve();
    const at = c.state();
    if (at.status !== 'ready') throw new Error('expected ready');
    expect(at.photos.map((p) => p.id)).toEqual(['desert-1']);
  });

  it('keeps the shown results when a page fails, reporting via moreError', async () => {
    const c = await ready();
    c.loadMore();
    api.resolvers[1].reject(Object.assign(new Error('offline'), { code: 'upstream' }));
    await Promise.resolve();
    const at = c.state();
    if (at.status !== 'ready') throw new Error('expected ready, not a wiped grid');
    expect(at.photos.map((p) => p.id)).toEqual(['a', 'b']);
    expect(at.loadingMore).toBe(false);
    expect(at.moreError?.code).toBe('upstream');
  });

  it('does nothing before any search has run', () => {
    const c = build();
    c.loadMore();
    expect(api.calls).toHaveLength(0);
  });
});

describe('orientation', () => {
  it('re-runs the query immediately, without waiting out a debounce', async () => {
    const c = await (async () => {
      const ctl = build();
      ctl.setQuery('forest');
      clock.tick();
      api.resolvers[0].resolve(page(['a']));
      await Promise.resolve();
      return ctl;
    })();

    c.setOrientation('portrait');
    expect(api.calls).toHaveLength(2);
    expect(api.calls[1].orientation).toBe('portrait');
    expect(c.orientation()).toBe('portrait');
  });

  it('ignores a no-change set', () => {
    const c = build();
    c.setQuery('forest');
    clock.tick();
    c.setOrientation('any');
    expect(api.calls).toHaveLength(1);
  });

  it('sends the orientation on the first search', () => {
    const c = build();
    c.setOrientation('landscape');
    c.setQuery('forest');
    clock.tick();
    expect(api.calls.at(-1)!.orientation).toBe('landscape');
  });

  it('discards a page whose orientation changed while it was in flight', async () => {
    const c = build();
    c.setQuery('forest');
    clock.tick();
    api.resolvers[0].resolve(page(['a'], { page: 1, totalPages: 3 }));
    await Promise.resolve();

    c.loadMore();
    c.setOrientation('portrait');
    api.resolvers[1].resolve(page(['stale'], { page: 2 }));
    await Promise.resolve();
    api.resolvers[2].resolve(page(['fresh'], { page: 1 }));
    await Promise.resolve();

    const at = c.state();
    if (at.status !== 'ready') throw new Error('expected ready');
    expect(at.photos.map((p) => p.id)).toEqual(['fresh']);
  });
});
