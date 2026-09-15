import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { createCompositionService } from '../src/server/composition-service.ts';
import { resolveComposition } from '../src/server/composition.ts';

const page = `---
import A from './A.astro';
import B from './B.astro';
---
<A />{false && <B />}`;
const through = `---\nimport A from './A.astro';\n---\n<A />`;
const allow = async (file: string) => file;
function fixture(extra = {}) {
  const files: Record<string, string> = { '/site/Page.astro': page, '/site/A.astro': '<p>A</p>', '/site/B.astro': through };
  const service = createCompositionService({ root: '/site', canonical: allow,
    resolve: async (specifier, importer) => resolve(dirname(importer), specifier),
    read: async file => { if (!(file in files)) throw new Error('missing'); return files[file]; }, ...extra });
  return { files, service };
}

describe('route graph discovery', () => {
  it('finds unrendered paths before transforms and exposes candidates, not false uniqueness', async () => {
    const { service } = fixture();
    const graph = await service.snapshot('/site/Page.astro', allow);
    expect(graph.coverage).toMatchObject({ complete: true, files: 3, issues: [] });
    const answer = resolveComposition({ route: '/site/Page.astro', file: '/site/A.astro' }, graph.links, graph.coverage.complete);
    expect(answer.tier).toBe('candidates');
    expect(answer.candidates?.map(path => path.length)).toEqual([1, 2]);
  });
  it('replaces changed usages and observes deletions without cached source', async () => {
    const { files, service } = fixture();
    await service.snapshot('/site/Page.astro', allow);
    files['/site/Page.astro'] = through;
    let graph = await service.snapshot('/site/Page.astro', allow);
    expect(graph.coverage.files).toBe(2);
    expect(graph.links).toHaveLength(1);
    delete files['/site/A.astro'];
    graph = await service.snapshot('/site/Page.astro', allow);
    expect(graph.coverage).toMatchObject({ complete: false, issues: [{ file: '/site/A.astro', reason: 'unresolved' }] });
  });
  it('keeps known runtime chains usable while opaque relationships block static inference', async () => {
    const { files, service } = fixture();
    files['/site/Page.astro'] = through + '<Dynamic />';
    const graph = await service.snapshot('/site/Page.astro', allow);
    const request = { route: '/site/Page.astro', file: '/site/A.astro', traceVersion: 2 as const };
    expect(graph.coverage.complete).toBe(false);
    expect(resolveComposition(request, graph.links, false).reason).toBe('incomplete-index');
    expect(resolveComposition({ ...request, chain: '.' + graph.links[0].id }, graph.links, false).tier).toBe('proven');
  });
  it('drops an in-flight snapshot when the watcher invalidates it', async () => {
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(done => { entered = done; });
    const waiting = new Promise<void>(done => { release = done; });
    const { service } = fixture({ read: async () => { entered(); await waiting; return '<p />'; } });
    const promise = service.snapshot('/site/Page.astro', allow);
    await started; service.invalidate(); release();
    expect(await promise).toMatchObject({ links: [], coverage: { complete: false, revision: 1, issues: [{ reason: 'stale-index' }] } });
  });
  it('does not read a disallowed module or claim full coverage', async () => {
    const { service } = fixture();
    const graph = await service.snapshot('/site/Page.astro', async file => {
      if (file.endsWith('/B.astro')) throw new Error('outside configured roots');
      return file;
    });
    expect(graph.coverage).toMatchObject({ complete: false, files: 2, issues: [{ reason: 'path-refused' }] });
    expect(graph.links.some(link => link.file.endsWith('/B.astro'))).toBe(false);
  });
  it.each([{ maxFiles: 1 }, { maxBytes: 1 }, { maxLinks: 1 }])('reports traversal limits: %j', async limit => {
    const { service } = fixture(limit);
    const graph = await service.snapshot('/site/Page.astro', allow);
    expect(graph.coverage.complete).toBe(false);
    expect(graph.coverage.issues.some(i => i.reason === 'index-limit')).toBe(true);
  });
  it('visits recursion once while retaining the cycle for the resolver to refuse', async () => {
    const { service, files } = fixture();
    files['/site/Page.astro'] = '<Astro.self />';
    const graph = await service.snapshot('/site/Page.astro', allow);
    expect(graph.coverage).toMatchObject({ complete: true, files: 1 });
    expect(resolveComposition({ route: '/site/Page.astro', file: '/site/Page.astro' }, graph.links, true).reason).toBe('recursive');
  });
});
