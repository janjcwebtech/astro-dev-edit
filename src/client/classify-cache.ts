import type { ClassifyRequest, ClassifyResult } from '../shared/protocol.ts';
import * as api from './api.ts';

/**
 * Session cache for /classify verdicts, keyed by file|loc|tag. Hover
 * verification is the heavy caller: every cache miss costs the server a file
 * read plus a full AST parse, and hovering generates far more lookups than
 * clicking ever will. So settled verdicts are kept until the next HMR update
 * rewrites a source file, and concurrent requests for the same key share one
 * round-trip. Failures are never cached — the next lookup retries.
 */

type Fetcher = (req: ClassifyRequest) => Promise<ClassifyResult>;

const settled = new Map<string, ClassifyResult>();
const inflight = new Map<string, Promise<ClassifyResult>>();
// Bumped by invalidation so a request that was already in flight when the
// source changed can tell its verdict is stale and must not be cached.
let generation = 0;

const keyOf = (req: ClassifyRequest): string => `${req.file}|${req.loc}|${req.tag}`;

/** The settled verdict for this element, if one is cached — never fetches. */
export function peekClassification(req: ClassifyRequest): ClassifyResult | undefined {
  return settled.get(keyOf(req));
}

/** Classify through the cache: settled verdicts return without a round-trip,
 *  concurrent misses for the same key share one request. */
export function classifyCached(
  req: ClassifyRequest,
  fetcher: Fetcher = api.classify,
): Promise<ClassifyResult> {
  const key = keyOf(req);
  const hit = settled.get(key);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(key);
  if (pending) return pending;

  const gen = generation;
  const request = (async () => {
    const result = await fetcher(req);
    if (gen === generation) settled.set(key, result);
    return result;
  })();
  // Drop the in-flight slot once it settles (unless invalidation already
  // cleared it and a newer request took the key).
  const cleanup = (): void => {
    if (inflight.get(key) === request) inflight.delete(key);
  };
  request.then(cleanup, cleanup);
  inflight.set(key, request);
  return request;
}

/** Forget every verdict — call when HMR rewrites source files. */
export function invalidateClassifications(): void {
  generation++;
  settled.clear();
  inflight.clear();
}
