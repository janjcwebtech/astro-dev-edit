import { describe, expect, it, vi } from 'vitest';
import type { CompositionLookupResponse, CompositionUsesResponse } from '../src/shared/protocol.ts';
import { createInspectorLoader, occurrenceSummary } from '../src/client/inspector-model.ts';

const coverage = { complete: true, files: 2, revision: 1, issues: [] };
const chain: CompositionLookupResponse = { tier: 'proven', route: '/Page.astro', links: [], coverage };
const uses: CompositionUsesResponse = { route: '/Page.astro', links: [], coverage };
const request = { pathname: '/', file: '/Card.astro', chain: '.abcdefgh', traceVersion: 2 as const };

describe('inspector render identity', () => {
  it('counts multi-root components once and repeated slot placements separately', () => {
    const occurrences = [
      { key: 0, instance: 'a', group: 'a/slot1', slots: [], ordinal: 1 },
      { key: 1, instance: 'a', group: 'a/slot1', slots: [], ordinal: 1 },
      { key: 2, instance: 'a', group: 'a/slot2', slots: [], ordinal: 2 },
      { key: 3, instance: 'b', group: 'b/slot3', slots: [], ordinal: 1 },
    ];
    expect(occurrenceSummary(occurrences[2], occurrences)).toEqual({ index: 2, total: 3, slots: [] });
  });
  it('never groups replayed HTML or a missing occurrence', () => {
    expect(occurrenceSummary({ key: 0, instance: 'a', group: null, slots: [], ordinal: 0, reason: 'untracked-html' }, [])).toBeNull();
    expect(occurrenceSummary({ key: 0, instance: 'a', group: 'a', slots: [], ordinal: 1 }, [])).toBeNull();
  });
});

describe('inspector response lifecycle', () => {
  it('passes the route, original source and versioned chain through unchanged', async () => {
    const api = { getComposition: vi.fn(async () => chain), getCompositionUses: vi.fn(async () => uses) };
    expect(await createInspectorLoader(api).load(request)).toEqual({ chain, uses });
    expect(api.getComposition).toHaveBeenCalledWith(request);
    expect(api.getCompositionUses).toHaveBeenCalledWith({ pathname: '/', file: '/Card.astro' });
  });
  it('ignores an older selection that finishes after a newer one', async () => {
    let resolve!: (answer: CompositionLookupResponse) => void;
    const old = new Promise<CompositionLookupResponse>(done => { resolve = done; });
    const api = { getComposition: vi.fn().mockReturnValueOnce(old).mockResolvedValue(chain),
      getCompositionUses: vi.fn().mockResolvedValue(uses) };
    const loader = createInspectorLoader(api);
    const first = loader.load(request);
    expect(await loader.load({ ...request, file: '/Other.astro' })).toEqual({ chain, uses });
    resolve(chain);
    expect(await first).toBeNull();
  });
  it('ignores responses after closing, navigation or HMR invalidation', async () => {
    const loader = createInspectorLoader({ getComposition: async () => chain, getCompositionUses: async () => uses });
    const pending = loader.load(request);
    loader.invalidate();
    expect(await pending).toBeNull();
  });
  it('retries a stale graph once and keeps named refusals and ambiguity intact', async () => {
    const ambiguous: CompositionLookupResponse = { ...chain, tier: 'candidates', candidates: [[], []] };
    const api = { getComposition: vi.fn().mockResolvedValueOnce({ ...chain, reason: 'stale-index' }).mockResolvedValue(ambiguous),
      getCompositionUses: vi.fn().mockResolvedValue(uses) };
    expect((await createInspectorLoader(api).load(request))?.chain).toEqual(ambiguous);
    expect(api.getComposition).toHaveBeenCalledTimes(2);
  });
  it('refuses mixed source generations instead of joining unrelated snapshots', async () => {
    const api = { getComposition: vi.fn().mockResolvedValue(chain),
      getCompositionUses: vi.fn().mockResolvedValue({ ...uses, coverage: { ...coverage, revision: 2 } }) };
    await expect(createInspectorLoader(api).load(request)).rejects.toThrow('Source changed');
    expect(api.getComposition).toHaveBeenCalledTimes(2);
  });
  it('refuses mixed route snapshots even when the revision is unchanged', async () => {
    const loader = createInspectorLoader({ getComposition: async () => chain,
      getCompositionUses: async () => ({ ...uses, route: '/Other.astro' }) });
    await expect(loader.load(request)).rejects.toThrow('Source changed');
  });
});
