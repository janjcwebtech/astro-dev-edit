import type {
  UnsplashErrorCode,
  UnsplashOrientation,
  UnsplashPhoto,
  UnsplashSearchRequest,
  UnsplashSearchResponse,
} from '../shared/protocol.ts';

/**
 * The Unsplash pane's search logic, with **no DOM** — debouncing, paging, and
 * the stale-response guarding that keeps a slow first request from overwriting
 * a newer one's results.
 *
 * Extracted from the pane so it can be unit-tested: the client layer has almost
 * no automated coverage, and "typing fast produces one request whose result is
 * the one you see" is exactly the kind of rule that breaks silently. The timer
 * functions are injected for the same reason.
 *
 * Stale-response guarding uses the monotonic-generation idiom from
 * `classify-cache.ts`: a `seq` bumped per request, and a response applied only
 * while it is still the newest one issued.
 */

export interface SearchError {
  code: UnsplashErrorCode | 'unknown';
  message: string;
  /** Whether offering a Retry makes sense. A bad key or a disabled feature
   *  needs a settings change, not another attempt at the same call. */
  retryable: boolean;
}

export type SearchState =
  /** Nothing asked for yet — a blank query never fetches. */
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  /** Results, possibly still growing via loadMore. */
  | {
      status: 'ready';
      query: string;
      photos: UnsplashPhoto[];
      total: number;
      totalPages: number;
      page: number;
      remaining?: number;
      /** True while a loadMore is in flight, so the button can say so without
       *  the grid dropping back to a loading state. */
      loadingMore: boolean;
      /** A *page* that failed. Reported here rather than as `status: 'error'`
       *  because the results already on screen are still good — throwing them
       *  away to show one error message would be the wrong trade. */
      moreError?: SearchError;
    }
  /** A search that succeeded and matched nothing — distinct from `ready` with
   *  an empty array, which the pane would render as a blank grid. */
  | { status: 'empty'; query: string }
  | { status: 'error'; query: string; error: SearchError };

export interface SearchController {
  state(): SearchState;
  /** Type-ahead entry point: debounced, and a blank query resets to idle. */
  setQuery(query: string): void;
  /** Changing orientation re-runs the current query immediately — it is a
   *  deliberate click, not a keystroke, so it should not wait out a debounce. */
  setOrientation(orientation: UnsplashOrientation): void;
  orientation(): UnsplashOrientation;
  /** Append the next page. No-op unless there is one and nothing is in flight. */
  loadMore(): void;
  /** Re-run the current query now, bypassing the debounce. */
  retry(): void;
  /** Cancel any pending debounce; in-flight responses are ignored afterwards. */
  dispose(): void;
}

export interface SearchControllerOptions {
  /** Performs the request. Injected so tests need no network and no api.ts. */
  search(req: UnsplashSearchRequest): Promise<UnsplashSearchResponse>;
  /** Called on every state transition. */
  onState(state: SearchState): void;
  debounceMs?: number;
  /** Timer injection, so tests drive time rather than wait for it. Matches the
   *  single-handle debounce idiom in `hover.ts` — no new generic utility. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Maps a rejected `search` to a typed error. Injected because the mapping
   *  lives in `api.ts` (which owns `UnsplashError`), and this module must stay
   *  free of anything that touches the network. */
  toError?: (err: unknown) => SearchError;
}

const DEFAULT_DEBOUNCE_MS = 350;

function defaultToError(err: unknown): SearchError {
  return {
    code: 'unknown',
    message: err instanceof Error ? err.message : 'Search failed.',
    retryable: true,
  };
}

export function createSearchController(opts: SearchControllerOptions): SearchController {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const toError = opts.toError ?? defaultToError;

  let current: SearchState = { status: 'idle' };
  let query = '';
  let orientation: UnsplashOrientation = 'any';
  let timer: unknown = null;
  let disposed = false;
  // Bumped for every request issued. A response is applied only while its own
  // seq is still the newest — so a slow early request cannot overwrite a fast
  // later one, and dispose() invalidates everything outstanding.
  let seq = 0;

  const emit = (next: SearchState): void => {
    current = next;
    opts.onState(next);
  };

  const cancelPending = (): void => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  /** Issue a request for page 1, replacing whatever is shown. */
  const run = (): void => {
    if (disposed) return;
    const q = query.trim();
    if (!q) {
      emit({ status: 'idle' });
      return;
    }
    const mine = ++seq;
    const issuedOrientation = orientation;
    emit({ status: 'loading', query: q });
    opts.search({ query: q, page: 1, orientation: issuedOrientation }).then(
      (res) => {
        if (disposed || mine !== seq) return; // superseded
        if (!res.photos.length) {
          emit({ status: 'empty', query: q });
          return;
        }
        emit({
          status: 'ready',
          query: q,
          photos: res.photos,
          total: res.total,
          totalPages: res.totalPages,
          page: res.page,
          ...(res.remaining === undefined ? {} : { remaining: res.remaining }),
          loadingMore: false,
        });
      },
      (err: unknown) => {
        if (disposed || mine !== seq) return;
        emit({ status: 'error', query: q, error: toError(err) });
      },
    );
  };

  return {
    state: () => current,

    setQuery(next) {
      query = next;
      cancelPending();
      if (disposed) return;
      // A cleared box resets immediately — waiting out a debounce to show
      // nothing would feel broken.
      if (!next.trim()) {
        seq++; // abandon anything outstanding
        emit({ status: 'idle' });
        return;
      }
      timer = setTimer(() => {
        timer = null;
        run();
      }, debounceMs);
    },

    setOrientation(next) {
      if (next === orientation) return;
      orientation = next;
      cancelPending();
      run();
    },

    orientation: () => orientation,

    loadMore() {
      if (disposed) return;
      const at = current;
      if (at.status !== 'ready' || at.loadingMore) return;
      if (at.page >= at.totalPages) return;

      const mine = ++seq;
      const issuedQuery = at.query;
      const issuedOrientation = orientation;
      const nextPage = at.page + 1;
      emit({ ...at, loadingMore: true, moreError: undefined });

      opts.search({ query: issuedQuery, page: nextPage, orientation: issuedOrientation }).then(
        (res) => {
          if (disposed || mine !== seq) return;
          // Appending is only valid if nothing about the search changed while
          // the page was in flight — otherwise these are results for a
          // different question.
          const now = current;
          if (
            now.status !== 'ready' ||
            now.query !== issuedQuery ||
            orientation !== issuedOrientation
          ) {
            return;
          }
          emit({
            ...now,
            photos: [...now.photos, ...res.photos],
            page: res.page,
            total: res.total,
            totalPages: res.totalPages,
            ...(res.remaining === undefined ? {} : { remaining: res.remaining }),
            loadingMore: false,
          });
        },
        (err: unknown) => {
          if (disposed || mine !== seq) return;
          const now = current;
          if (now.status !== 'ready') return;
          // The results already on screen survive; only the button reports.
          emit({ ...now, loadingMore: false, moreError: toError(err) });
        },
      );
    },

    retry() {
      cancelPending();
      run();
    },

    dispose() {
      disposed = true;
      cancelPending();
      seq++;
    },
  };
}
