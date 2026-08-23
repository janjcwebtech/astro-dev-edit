import type {
  ApplyRequestWire,
  AssetInfo,
  AssetsResponse,
  ClassifyRequest,
  ClassifyResult,
  CollectionApplyResponse,
  CollectionCreateRequest,
  CollectionCreateResponse,
  CollectionEntriesRequest,
  CollectionEntriesResponse,
  CollectionOpenRequest,
  CollectionSchemaApplyRequest,
  CollectionsResponse,
  EntryApplyRequest,
  EntryCreateRequest,
  EntryCreateResponse,
  EntryDeleteRequest,
  EntryErrorResponse,
  EntryRequest,
  EntryResponse,
  HealthResponse,
  InspectOpenRequest,
  InspectOpenResponse,
  OpenRequest,
  PageSourceRequest,
  PageSourceResponse,
  PeekRequest,
  PeekResponse,
  SettingsErrorResponse,
  SettingsResponse,
  SettingsUpdateRequest,
  UnsplashErrorCode,
  UnsplashErrorResponse,
  UnsplashImportRequest,
  UnsplashImportResponse,
  UnsplashSearchRequest,
  UnsplashSearchResponse,
  UploadRequest,
  UploadResponse,
} from '../shared/protocol.ts';

/**
 * Typed fetch client for the /__dev-edit endpoints — the only place the
 * overlay talks to the dev server. Pure I/O: no DOM, no toasts; callers
 * present errors. Every function throws the server's `error` message (or a
 * "<what> failed (<status>)" fallback) on a non-OK response.
 */

const API = '/__dev-edit';

async function errorMessage(res: Response): Promise<string | undefined> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error;
}

async function post(path: string, payload: unknown): Promise<Response> {
  return fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/** The server's health payload (config flags the overlay reads at boot), or
 *  null when the server side isn't alive — the overlay stays out of the way. */
export async function health(): Promise<HealthResponse | null> {
  try {
    const res = await fetch(`${API}/health`);
    if (!res.ok) return null;
    return (await res.json()) as HealthResponse;
  } catch {
    return null;
  }
}

/** List the project's swap-candidate images, with size and mtime. */
export async function getAssets(): Promise<AssetInfo[]> {
  const res = await fetch(`${API}/assets`);
  if (!res.ok) throw new Error(`server returned ${res.status}`);
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    // Most likely our middleware didn't handle the route and Vite served
    // HTML — tells us exactly what went wrong instead of a vague message.
    throw new Error('endpoint returned non-JSON (middleware not reached?)');
  }
  return ((await res.json()) as AssetsResponse).files;
}

/** Upload an image (as a data URL); returns its web-servable path. */
export async function upload(req: UploadRequest): Promise<UploadResponse> {
  const res = await post('/upload', req);
  if (!res.ok) throw new Error((await errorMessage(res)) ?? `upload failed (${res.status})`);
  return (await res.json()) as UploadResponse;
}

/** Open a source location in the user's editor. */
export async function open(req: OpenRequest): Promise<void> {
  const res = await post('/open', req);
  if (!res.ok) throw new Error((await errorMessage(res)) ?? `open failed (${res.status})`);
}

/** Which source file the route serving `pathname` is written in — the admin
 *  bar's *Open page source*. Answered from Astro's route manifest, so it is the
 *  page's own template rather than whichever component filled the most of the
 *  DOM; `refusal` set means nothing could be identified. Named apart from
 *  `page-source.ts::pageSource`, which reads the backing-content `<meta>`. */
export async function resolvePageSource(req: PageSourceRequest): Promise<PageSourceResponse> {
  const res = await post('/page-source', req);
  if (!res.ok) throw new Error((await errorMessage(res)) ?? `page-source failed (${res.status})`);
  return (await res.json()) as PageSourceResponse;
}

/** Open a CSS rule's source in the editor: the server best-effort locates the
 *  selector and jumps there (or to the file top). */
export async function inspectOpen(req: InspectOpenRequest): Promise<InspectOpenResponse> {
  const res = await post('/inspect/open', req);
  if (!res.ok) throw new Error((await errorMessage(res)) ?? `open failed (${res.status})`);
  return (await res.json()) as InspectOpenResponse;
}

/** Read-only window of source lines around a loc, for the in-browser peek. */
export async function peek(req: PeekRequest): Promise<PeekResponse> {
  const res = await post('/peek', req);
  if (!res.ok) throw new Error((await errorMessage(res)) ?? `peek failed (${res.status})`);
  return (await res.json()) as PeekResponse;
}

/** AST-truth classification of the clicked element. (spec §7.3, §16.1) */
export async function classify(req: ClassifyRequest): Promise<ClassifyResult> {
  const res = await post('/classify', req);
  const body = (await res.json().catch(() => ({}))) as ClassifyResult & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `classify failed (${res.status})`);
  return body;
}

/** The real save: the server re-resolves the element in the AST, verifies the
 *  source still matches `original`, and writes atomically. (spec §5, §7.5) */
export async function apply(req: ApplyRequestWire): Promise<void> {
  const res = await post('/apply', req);
  if (!res.ok) throw new Error((await errorMessage(res)) ?? `save failed (${res.status})`);
}

/** Probe a page route (NOT a /__dev-edit endpoint): true once the dev server
 *  answers it with something other than a 404. Used after entry create to
 *  wait out the content-layer sync before navigating to the new page. */
export async function routeExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    return res.status !== 404;
  } catch {
    return false;
  }
}

// --- Entry editor ------------------------------------------------------------

/** Entry-endpoint failure carrying the code and per-field validation messages
 *  the panel needs for inline rendering — richer than the string-only errors
 *  the loc-based endpoints get away with. */
export class EntryApplyError extends Error {
  code?: EntryErrorResponse['code'];
  fieldErrors?: Record<string, string>;
  constructor(body: EntryErrorResponse, status: number) {
    super(body.error || `request failed (${status})`);
    this.name = 'EntryApplyError';
    this.code = body.code;
    this.fieldErrors = body.fieldErrors;
  }
}

async function entryPost<T>(path: string, payload: unknown, what: string): Promise<T> {
  const res = await post(path, payload);
  const body = (await res.json().catch(() => ({ error: `${what} failed (${res.status})` }))) as
    | T
    | EntryErrorResponse;
  if (!res.ok) throw new EntryApplyError(body as EntryErrorResponse, res.status);
  return body as T;
}

/** Read a collection entry as typed fields + markdown body. */
export async function getEntry(req: EntryRequest): Promise<EntryResponse> {
  return entryPost<EntryResponse>('/entry', req, 'entry read');
}

/** Atomic multi-field save; throws EntryApplyError on conflict/validation. */
export async function applyEntry(req: EntryApplyRequest): Promise<void> {
  await entryPost<{ ok: true }>('/entry/apply', req, 'save');
}

/** Create a new entry in a collection; resolves to its repo-relative path. */
export async function createEntry(req: EntryCreateRequest): Promise<EntryCreateResponse> {
  return entryPost<EntryCreateResponse>('/entry/create', req, 'create');
}

/** Delete an entry (etag-guarded; undo is git). */
export async function deleteEntry(req: EntryDeleteRequest): Promise<void> {
  await entryPost<{ ok: true }>('/entry/delete', req, 'delete');
}

// --- Unsplash + settings -----------------------------------------------------

/** Unsplash-endpoint failure carrying the server's `code`, which is what the
 *  pane branches on: a bad key or a disabled feature needs a settings change,
 *  while a timeout or an upstream fault is worth a Retry button. Mirrors the
 *  EntryApplyError/entryPost pair. */
export class UnsplashError extends Error {
  code: UnsplashErrorCode | 'unknown';
  constructor(body: Partial<UnsplashErrorResponse>, status: number) {
    super(body.error || `Unsplash request failed (${status})`);
    this.name = 'UnsplashError';
    this.code = body.code ?? 'unknown';
  }
  /** Whether offering a Retry makes sense. Configuration faults do not fix
   *  themselves, so the pane shows a link to Settings instead. */
  get retryable(): boolean {
    return !['disabled', 'unconfigured', 'unauthorized', 'expired'].includes(this.code);
  }
}

async function unsplashPost<T>(path: string, payload: unknown): Promise<T> {
  const res = await post(path, payload);
  const body = (await res.json().catch(() => ({}))) as T | UnsplashErrorResponse;
  if (!res.ok) throw new UnsplashError(body as UnsplashErrorResponse, res.status);
  return body as T;
}

/** Search Unsplash through the dev server, which holds the key and reshapes
 *  every photo. Throws UnsplashError. */
export async function unsplashSearch(
  req: UnsplashSearchRequest,
): Promise<UnsplashSearchResponse> {
  return unsplashPost<UnsplashSearchResponse>('/unsplash/search', req);
}

/** Download a searched photo into the project. Throws UnsplashError — notably
 *  `expired` when the dev server restarted since the search. */
export async function unsplashImport(
  req: UnsplashImportRequest,
): Promise<UnsplashImportResponse> {
  return unsplashPost<UnsplashImportResponse>('/unsplash/import', req);
}

/** Read every integration option plus the access-key status. Never returns the
 *  key itself — only whether one resolved, from where, and a masked hint. */
export async function getSettings(): Promise<SettingsResponse> {
  const res = await fetch(`${API}/settings`);
  if (!res.ok) throw new Error((await errorMessage(res)) ?? `settings failed (${res.status})`);
  return (await res.json()) as SettingsResponse;
}

/**
 * Save a sparse option patch and/or the Unsplash access key. Resolves to the
 * same shape a read would, so the panel needs no follow-up request.
 *
 * A 422 carries per-option messages, so the rejection is thrown as a
 * {@link SettingsRefusal} the drawer can paint onto individual controls rather
 * than as a single opaque message. Nothing was written when this throws — the
 * server refuses a patch whole.
 */
export async function saveSettings(req: SettingsUpdateRequest): Promise<SettingsResponse> {
  const res = await post('/settings', req);
  if (res.ok) return (await res.json()) as SettingsResponse;

  const body = (await res.json().catch(() => null)) as SettingsErrorResponse | null;
  if (body?.fieldErrors) {
    throw new SettingsRefusal(body.error || 'some options were refused', body.fieldErrors);
  }
  throw new Error(body?.error ?? `settings save failed (${res.status})`);
}

/** A refusal that names the options at fault. */
export class SettingsRefusal extends Error {
  constructor(
    message: string,
    readonly fieldErrors: Record<string, string>,
  ) {
    super(message);
    this.name = 'SettingsRefusal';
  }
}

/** A collection-designer refusal, carrying the server's code so the panel can
 *  tell "reopen the tab" (a conflict) from "this shape can't be patched". */
export class CollectionRefusalError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
    readonly status: number,
  ) {
    super(message);
    this.name = 'CollectionRefusalError';
  }
}

async function collectionPost<T>(path: string, payload: unknown): Promise<T> {
  const res = await post(path, payload);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) {
    throw new CollectionRefusalError(
      body.error ?? `${path} failed (${res.status})`,
      body.code,
      res.status,
    );
  }
  return body;
}

/** Every collection, its fields, and the content-config etag every write needs. */
export async function listCollections(): Promise<CollectionsResponse> {
  return collectionPost<CollectionsResponse>('/collections', {});
}

/** Schema edits and/or editor overrides for one collection. The schema half is
 *  etag-guarded and all-or-nothing; the response says which half landed. */
export async function applyCollectionSchema(
  req: CollectionSchemaApplyRequest,
): Promise<CollectionApplyResponse> {
  return collectionPost<CollectionApplyResponse>('/collection/schema/apply', req);
}

/** One collection's entry files, newest first. Reaches drafts and entries no
 *  rendered page links to — which is the point of the Items view. */
export async function listCollectionEntries(
  req: CollectionEntriesRequest,
): Promise<CollectionEntriesResponse> {
  return collectionPost<CollectionEntriesResponse>('/collection/entries', req);
}

/** Launch the editor on the content config, at a collection's own line when one
 *  is named. Carries no path — the server opens the config it discovered. */
export async function openCollectionSource(req: CollectionOpenRequest): Promise<void> {
  await collectionPost<{ ok: true }>('/collection/open', req);
}

/** Append a collection to the content config and make its entry directory. */
export async function createCollection(
  req: CollectionCreateRequest,
): Promise<CollectionCreateResponse> {
  return collectionPost<CollectionCreateResponse>('/collection/create', req);
}
