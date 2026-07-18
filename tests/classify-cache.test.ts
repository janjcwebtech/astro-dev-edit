import { beforeEach, describe, expect, it } from 'vitest';
import type { ClassifyRequest, ClassifyResult } from '../src/shared/protocol.ts';
import {
  classifyCached,
  invalidateClassifications,
  peekClassification,
} from '../src/client/classify-cache.ts';

/**
 * The classify cache backs hover verification: settled verdicts are reused
 * until HMR invalidates them, concurrent misses share one round-trip, and
 * failures are never cached. All tests inject a stub fetcher — the real
 * api.classify (and fetch) is never touched.
 */

const REQ: ClassifyRequest = { file: 'src/pages/index.astro', loc: '5:3', tag: 'p' };
const TEXT: ClassifyResult = { kind: 'text', reason: 'literal text' };
const DYNAMIC: ClassifyResult = { kind: 'dynamic', reason: 'expression' };

function stub(result: ClassifyResult = TEXT) {
  let calls = 0;
  const fetcher = (): Promise<ClassifyResult> => {
    calls++;
    return Promise.resolve(result);
  };
  return { fetcher, calls: () => calls };
}

function deferred() {
  let resolve!: (v: ClassifyResult) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<ClassifyResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// The cache is module-level state shared across tests.
beforeEach(invalidateClassifications);

describe('classifyCached', () => {
  it('fetches on miss, then serves the settled verdict without refetching', async () => {
    const s = stub();
    expect(await classifyCached(REQ, s.fetcher)).toEqual(TEXT);
    expect(await classifyCached(REQ, s.fetcher)).toEqual(TEXT);
    expect(s.calls()).toBe(1);
    expect(peekClassification(REQ)).toEqual(TEXT);
  });

  it('dedupes concurrent requests for the same key into one round-trip', async () => {
    const d = deferred();
    let calls = 0;
    const fetcher = (): Promise<ClassifyResult> => {
      calls++;
      return d.promise;
    };
    const a = classifyCached(REQ, fetcher);
    const b = classifyCached(REQ, fetcher);
    d.resolve(TEXT);
    expect(await a).toEqual(TEXT);
    expect(await b).toEqual(TEXT);
    expect(calls).toBe(1);
  });

  it('caches per file|loc|tag key, not globally', async () => {
    const s = stub();
    await classifyCached(REQ, s.fetcher);
    await classifyCached({ ...REQ, loc: '9:1' }, s.fetcher);
    await classifyCached({ ...REQ, tag: 'h1' }, s.fetcher);
    expect(s.calls()).toBe(3);
    expect(peekClassification({ ...REQ, loc: '9:1' })).toEqual(TEXT);
  });

  it('does not cache failures — the next lookup retries', async () => {
    const failing = (): Promise<ClassifyResult> => Promise.reject(new Error('offline'));
    await expect(classifyCached(REQ, failing)).rejects.toThrow('offline');
    expect(peekClassification(REQ)).toBeUndefined();

    const s = stub(DYNAMIC);
    expect(await classifyCached(REQ, s.fetcher)).toEqual(DYNAMIC);
    expect(s.calls()).toBe(1);
  });
});

describe('invalidateClassifications', () => {
  it('drops settled verdicts so the next lookup refetches', async () => {
    const s = stub();
    await classifyCached(REQ, s.fetcher);
    invalidateClassifications();
    expect(peekClassification(REQ)).toBeUndefined();
    await classifyCached(REQ, s.fetcher);
    expect(s.calls()).toBe(2);
  });

  it('never caches a request that was in flight when the source changed', async () => {
    const d = deferred();
    const inflight = classifyCached(REQ, () => d.promise);
    invalidateClassifications();
    d.resolve(TEXT);
    // The caller still gets its (now possibly stale) answer…
    expect(await inflight).toEqual(TEXT);
    // …but it is not kept: the next lookup hits the fetcher again.
    expect(peekClassification(REQ)).toBeUndefined();
    const s = stub(DYNAMIC);
    expect(await classifyCached(REQ, s.fetcher)).toEqual(DYNAMIC);
    expect(s.calls()).toBe(1);
  });
});
