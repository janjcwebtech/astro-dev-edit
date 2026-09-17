import type {
  CompositionLookupRequest,
  CompositionLookupResponse,
  CompositionLinksRequest,
  CompositionLinksResponse,
  CompositionUsesRequest,
  CompositionUsesResponse,
  ApplyRequestWire,
  AssetsResponse,
  ClassifyRequest,
  ClassifyResult,
  HealthResponse,
  InspectOpenRequest,
  InspectOpenResponse,
  OpenRequest,
  OpenResponse,
  PageSourceRequest,
  PageSourceResponse,
  PeekRequest,
  PeekResponse,
  SettingsErrorResponse,
  SettingsResponse,
  SettingsUpdateRequest,
  UploadRequest,
  UploadResponse,
  UsageApplyRequest,
} from '../shared/protocol.ts';

/**
 * Typed fetch client for the /__dev-edit endpoints — the only place the
 * overlay talks to the dev server. Pure I/O: no DOM, no toasts; callers
 * present errors. Every function throws the server's `error` message (or a
 * "<what> failed (<status>)" fallback) on a non-OK response.
 */

const API = '/__dev-edit';

/** Read-only composition queries. A named refusal is a successful answer. */
async function compositionPost<T>(path: string, request: unknown): Promise<T> {
  const res = await post(path, request);
  if (!res.ok) throw new Error((await errorMessage(res)) ?? `composition failed (${res.status})`);
  return res.json() as Promise<T>;
}
export const getComposition = (req: CompositionLookupRequest): Promise<CompositionLookupResponse> =>
  compositionPost('/composition', req);
export const getCompositionLinks = (req: CompositionLinksRequest): Promise<CompositionLinksResponse> =>
  compositionPost('/composition/links', req);
export const getCompositionUses = (req: CompositionUsesRequest): Promise<CompositionUsesResponse> =>
  compositionPost('/composition/uses', req);

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

/** List the project's swap-candidate images, with size, mtime and whether a
 *  build still serves them — plus the public dir the last of those is measured
 *  against, so a picker can name it when it refuses a file, and the upload dir
 *  the picker has to show before anything is written into it. */
export async function getAssets(): Promise<AssetsResponse> {
  const res = await fetch(`${API}/assets`);
  if (!res.ok) throw new Error(`server returned ${res.status}`);
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    // Most likely our middleware didn't handle the route and Vite served
    // HTML — tells us exactly what went wrong instead of a vague message.
    throw new Error('endpoint returned non-JSON (middleware not reached?)');
  }
  const body = (await res.json()) as AssetsResponse;
  // A server that predates `servable` listed nothing but web-path candidates,
  // so treating an absent flag as true keeps such a listing usable.
  return {
    files: body.files.map((f) => ({ ...f, servable: f.servable ?? true })),
    publicDir: body.publicDir || 'public',
    uploadDir: body.uploadDir || 'public',
  };
}

/** Upload an image (as a data URL); returns its web-servable path. */
export async function upload(req: UploadRequest): Promise<UploadResponse> {
  const res = await post('/upload', req);
  if (!res.ok) throw new Error((await errorMessage(res)) ?? `upload failed (${res.status})`);
  return (await res.json()) as UploadResponse;
}

/** Open a source location in the user's editor. */
export async function open(req: OpenRequest): Promise<OpenResponse> {
  const res = await post('/open', req);
  if (!res.ok) throw new Error((await errorMessage(res)) ?? `open failed (${res.status})`);
  return (await res.json()) as OpenResponse;
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

/** The same save for a value passed at a component usage site. It names a
 *  usage id rather than a path; the server resolves the file, gates it and
 *  verifies `original` before writing. */
export async function applyUsage(req: UsageApplyRequest): Promise<void> {
  const res = await post('/composition/apply', req);
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

// --- Settings ----------------------------------------------------------------

/** Read every integration option, with its effective value and provenance. */
export async function getSettings(): Promise<SettingsResponse> {
  const res = await fetch(`${API}/settings`);
  if (!res.ok) throw new Error((await errorMessage(res)) ?? `settings failed (${res.status})`);
  return (await res.json()) as SettingsResponse;
}

/**
 * Save a sparse option patch. Resolves to the same shape a read would, so the
 * panel needs no follow-up request.
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
