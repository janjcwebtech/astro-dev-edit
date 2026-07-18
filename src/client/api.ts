import type {
  ApplyRequestWire,
  AssetsResponse,
  ClassifyRequest,
  ClassifyResult,
  EntryApplyRequest,
  EntryCreateRequest,
  EntryCreateResponse,
  EntryDeleteRequest,
  EntryErrorResponse,
  EntryRequest,
  EntryResponse,
  OpenRequest,
  UploadRequest,
  UploadResponse,
} from '../shared/protocol.ts';

/**
 * Typed fetch client for the /__text-edit endpoints — the only place the
 * overlay talks to the dev server. Pure I/O: no DOM, no toasts; callers
 * present errors. Every function throws the server's `error` message (or a
 * "<what> failed (<status>)" fallback) on a non-OK response.
 */

const API = '/__text-edit';

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

/** True when the server side is alive; the overlay stays out of the way otherwise. */
export async function health(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

/** List the project's swap-candidate images as web paths. */
export async function getAssets(): Promise<string[]> {
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
