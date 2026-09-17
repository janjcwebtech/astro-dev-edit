import { describe, expect, it, vi } from 'vitest';
import type { UsageLink } from '../src/shared/protocol.ts';
import { chainIds, createChainLinks } from '../src/client/composition.ts';

const link = (id: string, target?: string): UsageLink => ({
  id, file: '/Page.astro', loc: '3:5', offset: 40, name: 'Card',
  ...(target ? { target } : {}), hasSpread: false, props: [], slots: [],
});

/** A stand-in for an annotated element — chainIds reads one attribute. */
const el = (chain: string | null) => ({
  getAttribute: (name: string) => (name === 'data-atx-chain' ? chain : null),
}) as unknown as Element;

describe('chainIds', () => {
  it('reads a chain outermost first', () => {
    expect(chainIds(el('.aaaaaaaa.bbbbbbbb'))).toEqual(['aaaaaaaa', 'bbbbbbbb']);
  });
  it('treats a root and a threading break as empty, not as errors', () => {
    expect(chainIds(el('!'))).toEqual([]);
    expect(chainIds(el('?'))).toEqual([]);
  });
  it('refuses a malformed chain whole rather than part-parsing it', () => {
    expect(chainIds(el('.abc'))).toBeNull();
    expect(chainIds(el('aaaaaaaa'))).toBeNull();
    expect(chainIds(el('.aaaaaaaa.bbb'))).toBeNull();
    expect(chainIds(el(null))).toBeNull();
  });
});

describe('chain link cache', () => {
  it('asks for each id once per page and serves repeats from the cache', async () => {
    const getCompositionLinks = vi.fn(async ({ ids }: { ids: string[] }) =>
      ({ links: ids.map(id => link(id, '/Card.astro')), missing: [] }));
    const cache = createChainLinks({ getCompositionLinks });

    const first = await cache.resolve('/', ['aaaaaaaa', 'bbbbbbbb']);
    expect([...first.keys()]).toEqual(['aaaaaaaa', 'bbbbbbbb']);
    await cache.resolve('/', ['aaaaaaaa']);
    expect(getCompositionLinks).toHaveBeenCalledTimes(1);

    // Only the id it has never seen goes on the wire.
    await cache.resolve('/', ['aaaaaaaa', 'cccccccc']);
    expect(getCompositionLinks).toHaveBeenLastCalledWith({ pathname: '/', ids: ['cccccccc'] });
  });

  it('caches a named miss instead of re-asking on every hover', async () => {
    const getCompositionLinks = vi.fn(async ({ ids }: { ids: string[] }) => ({ links: [], missing: ids }));
    const cache = createChainLinks({ getCompositionLinks });
    expect((await cache.resolve('/', ['aaaaaaaa'])).size).toBe(0);
    expect((await cache.resolve('/', ['aaaaaaaa'])).size).toBe(0);
    expect(getCompositionLinks).toHaveBeenCalledTimes(1);
  });

  it('shares one request between two dwells on the same chain', async () => {
    let release: (() => void) | null = null;
    const getCompositionLinks = vi.fn(async ({ ids }: { ids: string[] }) => {
      await new Promise<void>(resolve => { release = resolve; });
      return { links: ids.map(id => link(id)), missing: [] };
    });
    const cache = createChainLinks({ getCompositionLinks });
    const both = Promise.all([cache.resolve('/', ['aaaaaaaa']), cache.resolve('/', ['aaaaaaaa'])]);
    await vi.waitFor(() => expect(release).not.toBeNull());
    release!();
    const [a, b] = await both;
    expect(getCompositionLinks).toHaveBeenCalledTimes(1);
    expect(a.get('aaaaaaaa')).toEqual(b.get('aaaaaaaa'));
  });

  it('keeps one route’s ids apart from another’s, and forgets both on invalidate', async () => {
    const getCompositionLinks = vi.fn(async ({ pathname, ids }: { pathname: string; ids: string[] }) =>
      ({ links: ids.map(id => link(id, `${pathname}Card.astro`)), missing: [] }));
    const cache = createChainLinks({ getCompositionLinks });
    expect((await cache.resolve('/a/', ['aaaaaaaa'])).get('aaaaaaaa')?.target).toBe('/a/Card.astro');
    expect((await cache.resolve('/b/', ['aaaaaaaa'])).get('aaaaaaaa')?.target).toBe('/b/Card.astro');
    expect(getCompositionLinks).toHaveBeenCalledTimes(2);
    cache.invalidate();
    await cache.resolve('/a/', ['aaaaaaaa']);
    expect(getCompositionLinks).toHaveBeenCalledTimes(3);
  });

  it('drops an id the wire would refuse rather than sending it', async () => {
    const getCompositionLinks = vi.fn(async () => ({ links: [], missing: [] }));
    const cache = createChainLinks({ getCompositionLinks });
    expect((await cache.resolve('/', ['nope', '../../etc'])).size).toBe(0);
    expect(getCompositionLinks).not.toHaveBeenCalled();
  });

  it('does not poison the cache when a batch fails', async () => {
    let fail = true;
    const getCompositionLinks = vi.fn(async ({ ids }: { ids: string[] }) => {
      if (fail) throw new Error('offline');
      return { links: ids.map(id => link(id)), missing: [] };
    });
    const cache = createChainLinks({ getCompositionLinks });
    await expect(cache.resolve('/', ['aaaaaaaa'])).rejects.toThrow('offline');
    fail = false;
    expect((await cache.resolve('/', ['aaaaaaaa'])).get('aaaaaaaa')?.id).toBe('aaaaaaaa');
  });
});
