import { describe, expect, it, vi } from 'vitest';
import type { ClassifyResult, CompositionLookupResponse, CompositionUsesResponse } from '../src/shared/protocol.ts';
import { createInspectorLoader, occurrenceSummary } from '../src/client/inspector-model.ts';
import { chainOrdinals, type TraceEvent } from '../src/client/render-occurrences.ts';

const coverage = { complete: true, files: 2, revision: 1, issues: [] };
const chain: CompositionLookupResponse = { tier: 'proven', route: '/Page.astro', links: [], coverage };
const uses: CompositionUsesResponse = { route: '/Page.astro', links: [], coverage };
const request = { pathname: '/', file: '/Card.astro', chain: '.abcdefgh', traceVersion: 2 as const };
const element = { file: '/Card.astro', loc: '5:3', tag: 'h2' };
const classified: ClassifyResult = { kind: 'text', reason: 'Literal text.' };
/** Every chain test also asks /classify, because one selection is one load. */
const classify = async () => classified;

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
    const api = { getComposition: vi.fn(async () => chain), getCompositionUses: vi.fn(async () => uses), classify: vi.fn(classify) };
    expect(await createInspectorLoader(api).load(request, element)).toEqual({ chain, uses, classification: classified });
    expect(api.getComposition).toHaveBeenCalledWith(request);
    expect(api.classify).toHaveBeenCalledWith(element);
    expect(api.getCompositionUses).toHaveBeenCalledWith({ pathname: '/', file: '/Card.astro' });
  });
  it('ignores an older selection that finishes after a newer one', async () => {
    let resolve!: (answer: CompositionLookupResponse) => void;
    const old = new Promise<CompositionLookupResponse>(done => { resolve = done; });
    const api = { getComposition: vi.fn().mockReturnValueOnce(old).mockResolvedValue(chain),
      getCompositionUses: vi.fn().mockResolvedValue(uses), classify };
    const loader = createInspectorLoader(api);
    const first = loader.load(request, element);
    expect(await loader.load({ ...request, file: '/Other.astro' }, element)).toEqual({ chain, uses, classification: classified });
    resolve(chain);
    expect(await first).toBeNull();
  });
  it('ignores responses after closing, navigation or HMR invalidation', async () => {
    const loader = createInspectorLoader({ getComposition: async () => chain, getCompositionUses: async () => uses, classify });
    const pending = loader.load(request, element);
    loader.invalidate();
    expect(await pending).toBeNull();
  });
  it('retries a stale graph once and keeps named refusals and ambiguity intact', async () => {
    const ambiguous: CompositionLookupResponse = { ...chain, tier: 'candidates', candidates: [[], []] };
    const api = { getComposition: vi.fn().mockResolvedValueOnce({ ...chain, reason: 'stale-index' }).mockResolvedValue(ambiguous),
      getCompositionUses: vi.fn().mockResolvedValue(uses), classify };
    expect((await createInspectorLoader(api).load(request, element))?.chain).toEqual(ambiguous);
    expect(api.getComposition).toHaveBeenCalledTimes(2);
  });
  it('refuses mixed source generations instead of joining unrelated snapshots', async () => {
    const api = { getComposition: vi.fn().mockResolvedValue(chain),
      getCompositionUses: vi.fn().mockResolvedValue({ ...uses, coverage: { ...coverage, revision: 2 } }), classify };
    await expect(createInspectorLoader(api).load(request, element)).rejects.toThrow('Source changed');
    expect(api.getComposition).toHaveBeenCalledTimes(2);
  });
  it('refuses mixed route snapshots even when the revision is unchanged', async () => {
    const loader = createInspectorLoader({ getComposition: async () => chain,
      getCompositionUses: async () => ({ ...uses, route: '/Other.astro' }), classify });
    await expect(loader.load(request, element)).rejects.toThrow('Source changed');
  });
  it('answers Values alone when there is no chain to resolve', async () => {
    const api = { getComposition: vi.fn(async () => chain), getCompositionUses: vi.fn(async () => uses), classify: vi.fn(classify) };
    expect(await createInspectorLoader(api).load(null, element))
      .toEqual({ chain: null, uses: null, classification: classified });
    expect(api.getComposition).not.toHaveBeenCalled();
  });
  it('keeps a failed classification as a caption rather than losing the chain', async () => {
    const api = { getComposition: async () => chain, getCompositionUses: async () => uses,
      classify: async () => { throw new Error('offline'); } };
    const answer = await createInspectorLoader(api).load(request, element);
    expect(answer?.chain).toEqual(chain);
    expect(answer?.classification).toBeNull();
    expect(answer?.classifyError).toContain('offline');
  });
});

/**
 * The live half of the `.map()` proof: which render of each usage site above
 * an element produced it. Nothing here is a source index — it is only ever
 * met with a static array by `usage-parse.ts::proveEntry`.
 */
describe('render ordinals along a chain', () => {
  const instance = (n: number) => String(n).padStart(24, '0');
  const el = (key: number, self: number, parent: number | null, chain: string, ordinal: number): TraceEvent =>
    ({ type: 'element', key, instance: instance(self), parent: parent === null ? '' : instance(parent),
      file: '/Card.astro', chain, ordinal: String(ordinal) });

  it('names the render of every usage site from the element up to the route', () => {
    const events = [
      el(0, 1, null, '!', 1),                      // the route's own render
      el(1, 2, 1, '.aaaaaaaa', 1),                 // <Services /> — first render
      el(2, 3, 2, '.aaaaaaaa.bbbbbbbb', 2),        // the second <Card /> inside it
    ];
    expect(chainOrdinals(events, 2)).toEqual({ aaaaaaaa: 1, bbbbbbbb: 2 });
  });

  it('stops where an instance emitted no annotated element of its own', () => {
    // The <Services /> hop rendered no plain element, so nothing counted it;
    // its usage site keeps its refusal rather than borrowing the count below.
    expect(chainOrdinals([el(0, 3, 2, '.aaaaaaaa.bbbbbbbb', 2)], 0)).toEqual({ bbbbbbbb: 2 });
  });

  it('answers nothing at all when one usage site is reached with two counts', () => {
    // `Astro.self` recursion: one source site, two depths. "The Nth render"
    // stops naming one thing, so the whole answer goes rather than half of it.
    expect(chainOrdinals([
      el(0, 1, null, '!', 1),
      el(1, 2, 1, '.aaaaaaaa', 1),
      el(2, 3, 2, '.aaaaaaaa.aaaaaaaa', 2),
    ], 2)).toEqual({});
  });

  it('reports nothing for a broken chain, replayed HTML, or an element it cannot see', () => {
    expect(chainOrdinals([el(0, 1, null, '?', 0)], 0)).toEqual({});
    expect(chainOrdinals([{ ...el(0, 1, null, '.aaaaaaaa', 1), opaque: true } as TraceEvent], 0)).toEqual({});
    expect(chainOrdinals([el(0, 1, null, '.aaaaaaaa', 1)], 7)).toEqual({});
  });
});
