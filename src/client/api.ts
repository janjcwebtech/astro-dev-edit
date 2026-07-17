import type {
  ApplyRequestWire,
  AssetsResponse,
  ClassifyRequest,
  ClassifyResult,
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
