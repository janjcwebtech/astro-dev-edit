import type { AstroIntegrationLogger } from 'astro';
import type {
  UnsplashErrorCode,
  UnsplashImportRequest,
  UnsplashPhoto,
  UnsplashSearchRequest,
  UnsplashSearchResponse,
} from '../shared/protocol.ts';
import { slugify } from '../shared/slug.ts';
import { saveBuffer } from './assets.ts';
import { resolveAssetTarget } from './paths.ts';
import type { Route, RouteResult } from './router.ts';
import type { ResolvedKey } from './settings.ts';

/**
 * The `/unsplash*` route group — search a third-party photo library and
 * download a chosen photo into the project like any other upload.
 *
 * **These routes return anticipated failures explicitly rather than throwing.**
 * `router.ts::dispatch` maps a thrown error to a 400, which would read as "your
 * query was malformed" when the real cause is Unsplash being down, rate-limited
 * or unreachable. Every foreseeable failure here therefore becomes a
 * `{ status, body: { error, code } }` result with an accurate status, and
 * `onError` exists only to turn a genuinely unanticipated throw into a 500.
 * This is an intentional divergence from every other route group.
 *
 * The Settings panel's own `/settings` endpoints used to live here, because the
 * only setting was this feature's access key. They now have their own group in
 * `settings-routes.ts` — the split this file's comment always called for.
 *
 * Security notes:
 * - The access key is resolved lazily per request (a thunk, not a value
 *   captured at config time), so a key entered through the Settings panel works
 *   without a dev-server restart. It never enters a response body or a log line.
 * - `/import` never fetches a URL the browser supplied. Search results are
 *   reshaped to drop the download URLs, which the server keeps in a bounded map
 *   keyed by photo id — so the browser can name a photo but cannot point the
 *   dev server at an arbitrary host.
 *
 * Attribution, per the Unsplash API guidelines: every credit link carries
 * `utm_source`/`utm_medium` (attached server-side, so the client cannot forget
 * them), and `/import` pings the photo's `download_location` when a user
 * actually chooses it.
 */

const API_BASE = 'https://api.unsplash.com';
const API_VERSION = 'v1';

/** JSON calls get 8s; the byte download gets 30s — the same order as a large
 *  upload, and the reader below is what actually bounds it. */
const API_TIMEOUT_MS = 8_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;

/** Same cap `/upload` enforces, so the two write paths agree. */
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

/** Long edge requested from Unsplash's image CDN. Comfortably above any
 *  reasonable display size while staying far below the byte cap. */
const IMPORT_WIDTH = 2400;

/** How long an identical search is served from memory. The demo tier allows
 *  only 50 API requests/hour, and iterating on one query must not burn them. */
const SEARCH_TTL_MS = 5 * 60 * 1000;

/** Ids the server will still honour at import time. Bounded because this map
 *  outlives HMR: it is dev-server memory, and only ever holds values the server
 *  itself minted from an Unsplash response. */
const PHOTO_CACHE_LIMIT = 500;

/** Resolved Unsplash configuration. `null` in `UnsplashRouteDeps` means the
 *  feature was never enabled, which is a different answer from "enabled but no
 *  key" (`disabled` vs `unconfigured`). */
export interface UnsplashConfig {
  /** Resolve the access key and where it came from. Async and per-request by
   *  design — a key entered through the Settings panel must work without a
   *  dev-server restart. `key` is `''` when nothing is configured anywhere. */
  resolve: () => Promise<ResolvedKey>;
  /** Whether the feature is switched on at all. A thunk for the same reason
   *  `resolve` is one: the Settings panel can turn the source on without a
   *  dev-server restart, so a value captured at setup time would be stale. */
  enabled: () => Promise<boolean>;
  /** Sent as `utm_source` on credit links, per the API guidelines. */
  appName: () => Promise<string>;
  /** Default results per page; already clamped to Unsplash's maximum. */
  perPage: () => Promise<number>;
  /** Injected so tests can stub Unsplash without touching globals — unlike a
   *  global stub this cannot leak across suites. Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
}

export interface UnsplashRouteDeps {
  logger: AstroIntegrationLogger;
  /** Project root (fsPath). Downloads are confined to it. */
  root: string;
  /** Where an imported photo may land — the same rule `/upload` uses. A thunk,
   *  because the directories come from options the Settings panel can change
   *  without a dev-server restart. */
  dirs: () => Promise<{ uploadDir: string; imageUploadDir: string; allowedDirs: string[] }>;
  /** null when the feature is disabled in config. */
  unsplash: UnsplashConfig | null;
}

// --- the shape of what Unsplash actually sends -------------------------------
// Only the fields we read. Everything else is dropped by `reshape`.
interface RawPhoto {
  id?: string;
  color?: string;
  width?: number;
  height?: number;
  description?: string | null;
  alt_description?: string | null;
  urls?: { small?: string; raw?: string };
  links?: { html?: string; download_location?: string };
  user?: { name?: string; username?: string; links?: { html?: string } };
}
interface RawSearch {
  results?: RawPhoto[];
  total?: number;
  total_pages?: number;
}

/** What `/import` needs and the client never sees. */
interface CachedPhoto {
  rawUrl: string;
  downloadLocation: string;
  description: string;
  photographer: string;
}

/** An explicit failure result. Never carries anything key-derived. */
function fail(status: number, code: UnsplashErrorCode, error: string): RouteResult {
  return { status, body: { error, code } };
}

const DISABLED = fail(
  403,
  'disabled',
  'The Unsplash photo source is not enabled. Add `unsplash: {}` to the ' +
    'astro-text-edit integration options.',
);

const UNCONFIGURED = fail(
  403,
  'unconfigured',
  'No Unsplash access key is configured. Add one from the admin bar’s ' +
    'Settings panel, or set UNSPLASH_ACCESS_KEY.',
);

/**
 * The two guards every route starts with. Returns the resolved key, or the
 * result to send back. The unconfigured case returns **before any fetch
 * happens** — a missing key must never produce an outbound request.
 */
async function requireKey(
  cfg: UnsplashConfig | null,
): Promise<{ ok: true; key: string; appName: string } | { ok: false; result: RouteResult }> {
  if (!cfg || !(await cfg.enabled())) return { ok: false, result: DISABLED };
  const { key } = await cfg.resolve();
  if (!key.trim()) return { ok: false, result: UNCONFIGURED };
  return { ok: true, key: key.trim(), appName: await cfg.appName() };
}

/**
 * Map a thrown fetch failure to a result. `AbortSignal.timeout` raises a
 * DOMException *named* TimeoutError under undici; `instanceof DOMException` is
 * not reliable across Node and vitest environments, so match on the name.
 *
 * The browser gets a generic "could not reach" — it can't act on undici's
 * wording — but the real cause goes to the dev-server log, including the
 * `cause` undici hides the interesting part in. Without it, an environment
 * fault (a TLS-intercepting proxy whose root CA Node doesn't trust is the
 * common one) is indistinguishable from Unsplash being down.
 */
function fromThrown(err: unknown, what: string, logger: AstroIntegrationLogger): RouteResult {
  if (err && typeof err === 'object' && (err as { name?: string }).name === 'TimeoutError') {
    return fail(504, 'timeout', `Unsplash took too long to respond while ${what}.`);
  }
  const cause = (err as { cause?: { message?: string } } | undefined)?.cause?.message;
  logger.warn(`Unsplash request failed while ${what}: ${String(err)}${cause ? ` (${cause})` : ''}`);
  return fail(502, 'upstream', `Could not reach Unsplash while ${what}.`);
}

/** Map a non-2xx upstream status to a result. 403 is Unsplash's rate-limit
 *  signal, not a permission error, and deserves a 429 the client can act on. */
function fromStatus(status: number): RouteResult {
  if (status === 401) {
    return fail(
      502,
      'unauthorized',
      'Unsplash rejected the access key. Check the key in the Settings panel.',
    );
  }
  if (status === 403) {
    return fail(
      429,
      'rate-limited',
      'Unsplash’s hourly request limit is used up. A demo-tier key allows 50 ' +
        'requests per hour; it resets within the hour.',
    );
  }
  return fail(502, 'upstream', `Unsplash returned ${status}.`);
}

/** Append the attribution params the API guidelines require. Preserves any
 *  query string the URL already carries. */
function withUtm(url: string, appName: string): string {
  if (!url) return '';
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}utm_source=${encodeURIComponent(appName)}&utm_medium=referral`;
}

/** Drop everything the client has no business seeing — exif, tags, topics,
 *  sponsorship, the full user record, every URL variant — so none of it can
 *  become an accidental API surface. */
function reshape(raw: RawPhoto, appName: string): UnsplashPhoto {
  const photographer = raw.user?.name || raw.user?.username || 'Unknown';
  return {
    id: raw.id ?? '',
    thumbUrl: raw.urls?.small ?? '',
    color: raw.color || '#333333',
    width: raw.width ?? 0,
    height: raw.height ?? 0,
    description: (raw.description || raw.alt_description || '').trim(),
    photographer,
    photographerUrl: withUtm(raw.user?.links?.html ?? '', appName),
    pageUrl: withUtm(raw.links?.html ?? '', appName),
  };
}

export function createUnsplashRoutes(deps: UnsplashRouteDeps): Route[] {
  const { logger, root, dirs, unsplash } = deps;
  const doFetch: typeof fetch = (...args) => (unsplash?.fetchImpl ?? globalThis.fetch)(...args);

  // Both caches are per-middleware, so a test's tree never sees another's.
  const photos = new Map<string, CachedPhoto>();
  const searches = new Map<string, { at: number; raw: RawSearch; remaining?: number }>();

  /** Remember what `/import` will need, evicting the oldest id first. */
  const rememberPhoto = (raw: RawPhoto): void => {
    if (!raw.id) return;
    photos.set(raw.id, {
      rawUrl: raw.urls?.raw ?? '',
      downloadLocation: raw.links?.download_location ?? '',
      description: (raw.description || raw.alt_description || '').trim(),
      photographer: raw.user?.name || raw.user?.username || '',
    });
    while (photos.size > PHOTO_CACHE_LIMIT) {
      const oldest = photos.keys().next();
      if (oldest.done) break;
      photos.delete(oldest.value);
    }
  };

  const authHeaders = (key: string): Record<string, string> => ({
    Authorization: `Client-ID ${key}`,
    'Accept-Version': API_VERSION,
  });

  return [
    // Proxies a search, reshaping every photo. Read-only: nothing touches disk.
    {
      method: 'POST',
      path: '/unsplash/search',
      maxBytes: 4 * 1024,
      label: 'unsplash search',
      handler: async (body) => {
        const guard = await requireKey(unsplash);
        if (!guard.ok) return guard.result;
        const cfg = unsplash!;

        const req = (body ?? {}) as UnsplashSearchRequest;
        const query = (req.query ?? '').trim();
        if (!query) return { status: 400, body: { error: 'query is required' } };

        const page = Math.max(1, Math.trunc(Number(req.page) || 1));
        const perPage = Math.min(
          30,
          Math.max(1, Math.trunc(Number(req.perPage) || (await cfg.perPage()))),
        );
        const orientation = req.orientation && req.orientation !== 'any' ? req.orientation : '';

        const cacheKey = `${query}\0${page}\0${perPage}\0${orientation}`;
        const hit = searches.get(cacheKey);
        let raw: RawSearch;
        let remaining: number | undefined;

        if (hit && Date.now() - hit.at < SEARCH_TTL_MS) {
          // Re-reshaped rather than replayed, so the photo cache is repopulated
          // even if these ids had been evicted since.
          raw = hit.raw;
          remaining = hit.remaining;
        } else {
          const url = new URL('/search/photos', API_BASE);
          url.searchParams.set('query', query);
          url.searchParams.set('page', String(page));
          url.searchParams.set('per_page', String(perPage));
          if (orientation) url.searchParams.set('orientation', orientation);

          let res: Response;
          try {
            res = await doFetch(url, {
              headers: authHeaders(guard.key),
              signal: AbortSignal.timeout(API_TIMEOUT_MS),
            });
          } catch (err) {
            return fromThrown(err, 'searching', logger);
          }
          if (!res.ok) return fromStatus(res.status);

          try {
            raw = (await res.json()) as RawSearch;
          } catch {
            return fail(502, 'upstream', 'Unsplash returned a malformed search response.');
          }

          const headerRemaining = Number(res.headers.get('x-ratelimit-remaining'));
          remaining = Number.isFinite(headerRemaining) ? headerRemaining : undefined;
          if (remaining !== undefined && remaining <= 5) {
            logger.warn(`Unsplash rate limit is nearly used up (${remaining} requests left)`);
          }
          searches.set(cacheKey, { at: Date.now(), raw, remaining });
        }

        const results = Array.isArray(raw.results) ? raw.results : [];
        for (const photo of results) rememberPhoto(photo);

        const response: UnsplashSearchResponse = {
          photos: results.map((photo) => reshape(photo, guard.appName)),
          total: Number(raw.total) || 0,
          totalPages: Number(raw.total_pages) || 0,
          page,
          ...(remaining === undefined ? {} : { remaining }),
        };
        return { status: 200, body: response };
      },
      onError: () =>
        fail(500, 'upstream', 'The Unsplash search failed unexpectedly. See the dev-server log.'),
    },

    // Downloads a chosen photo into the project — a NEW asset file, never a
    // source patch, through the same confinement rule as /upload.
    {
      method: 'POST',
      path: '/unsplash/import',
      maxBytes: 4 * 1024,
      label: 'unsplash import',
      handler: async (body) => {
        const guard = await requireKey(unsplash);
        if (!guard.ok) return guard.result;

        const req = (body ?? {}) as UnsplashImportRequest;
        const id = (req.id ?? '').trim();
        if (!id) return { status: 400, body: { error: 'id is required' } };

        const photo = photos.get(id);
        if (!photo || !photo.rawUrl) {
          return fail(
            409,
            'expired',
            'That photo is no longer available to import — the dev server has ' +
              'restarted since the search. Search again and re-pick it.',
          );
        }

        // Built from the URL the *server* stored, never one the client sent.
        // fm=jpg makes the content type deterministic, which keeps the
        // extension lookup honest. (There is no animated-GIF refusal to mirror
        // from /upload here: every import is a JPEG by construction.)
        const byteUrl = new URL(photo.rawUrl);
        byteUrl.searchParams.set('w', String(IMPORT_WIDTH));
        byteUrl.searchParams.set('fit', 'max');
        byteUrl.searchParams.set('q', '80');
        byteUrl.searchParams.set('fm', 'jpg');

        // The guideline is to ping when the user *chooses* to download, which is
        // now — so it goes out concurrently with the bytes rather than after a
        // multi-second download. Non-fatal: failing someone's import because an
        // analytics endpoint hiccupped would be user-hostile, and a rare
        // over-count on Unsplash's side is the safer error direction than a
        // compliance miss. Awaited inside the try so nothing escapes unhandled.
        const ping = photo.downloadLocation
          ? doFetch(photo.downloadLocation, {
              headers: authHeaders(guard.key),
              signal: AbortSignal.timeout(API_TIMEOUT_MS),
            }).then(
              () => undefined,
              (err: unknown) => {
                logger.warn(`Unsplash download ping failed (import continues): ${String(err)}`);
              },
            )
          : Promise.resolve(undefined);

        let res: Response;
        try {
          res = await doFetch(byteUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
        } catch (err) {
          await ping;
          return fromThrown(err, 'downloading the photo', logger);
        }
        await ping;
        if (!res.ok) return fromStatus(res.status);

        const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
        if (!contentType.startsWith('image/')) {
          return fail(502, 'upstream', 'Unsplash returned something that is not an image.');
        }
        // Cheap pre-check; content-length can lie or be absent, so the reader
        // below is the real bound.
        const declared = Number(res.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
          return fail(502, 'too-large', 'That photo is larger than the 25 MB import limit.');
        }

        let data: Buffer;
        try {
          data = await readCapped(res, MAX_DOWNLOAD_BYTES);
        } catch (err) {
          if (err instanceof TooLarge) {
            return fail(502, 'too-large', 'That photo is larger than the 25 MB import limit.');
          }
          return fromThrown(err, 'downloading the photo', logger);
        }

        // Same target rule as /upload: an image() field's asset must be
        // importable, and a requested targetDir is honoured only inside a
        // configured asset directory.
        const { dir, redirected } = resolveAssetTarget(root, await dirs(), req);
        if (redirected) {
          logger.warn(
            `unsplash targetDir "${req.targetDir}" is not inside a configured asset ` +
              `directory — writing to "${dir}" instead`,
          );
        }

        const stem = slugify(photo.description || photo.photographer || 'photo');
        const saved = await saveBuffer(root, dir, {
          mime: 'image/jpeg',
          data,
          filename: `unsplash-${stem || 'photo'}-${slugify(id)}.jpg`,
        });
        logger.info(`imported Unsplash photo -> ${saved.webPath}`);
        return { status: 200, body: saved };
      },
      onError: () =>
        fail(500, 'upstream', 'The Unsplash import failed unexpectedly. See the dev-server log.'),
    },
  ];
}

/** Thrown by {@link readCapped}; distinguishes "too big" from a transport fault. */
class TooLarge extends Error {}

/**
 * Read a response body, abandoning it the moment it exceeds `max`. Streaming
 * rather than `arrayBuffer()` so an oversized or lying `content-length` cannot
 * make the dev server buffer an unbounded download.
 */
async function readCapped(res: Response, max: number): Promise<Buffer> {
  if (!res.body) return Buffer.from(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new TooLarge('response exceeds the size cap');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
