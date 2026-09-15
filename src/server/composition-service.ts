import { readFile, realpath } from 'node:fs/promises';
import type { CompositionCoverage, CompositionRefusal, UsageLink } from '../shared/protocol.ts';
import { createUsageIndex } from './usage-index.ts';

export interface CompositionSnapshot {
  links: UsageLink[];
  coverage: CompositionCoverage;
}
export interface CompositionServiceDeps {
  root: string;
  resolve: (specifier: string, importer: string) => Promise<string | null>;
  read?: (file: string) => Promise<string>;
  canonical?: (file: string) => Promise<string>;
  maxFiles?: number;
  maxBytes?: number;
  maxLinks?: number;
}

/** Discover the complete reachable static graph, including unrendered branches.
 * Each request reads current source; transformed-module visitation is irrelevant.
 * A watcher revision invalidates in-flight answers. No completed snapshot cache
 * can outlive a file edit, deletion, resolver change or permission change. */
export function createCompositionService(deps: CompositionServiceDeps) {
  let revision = 0;
  return {
    invalidate() { revision++; },
    async snapshot(route: string, allow: (file: string) => Promise<string>): Promise<CompositionSnapshot> {
      const started = revision;
      const index = createUsageIndex({ root: deps.root, canonical: deps.canonical ?? realpath, resolve: deps.resolve });
      const queue = [route], visited = new Set<string>();
      const issues: CompositionCoverage['issues'] = [];
      let bytes = 0, count = 0, incomplete = false;
      const issue = (file: string, reason: CompositionRefusal, loc?: string) => {
        incomplete = true;
        if (issues.length < 64) issues.push({ file, reason, ...(loc ? { loc } : {}) });
      };
      while (queue.length) {
        const requested = queue.shift()!;
        let file: string;
        try { file = await allow(requested); }
        catch { issue(requested, 'path-refused'); continue; }
        if (visited.has(file)) continue;
        if (visited.size >= (deps.maxFiles ?? 512)) { issue(file, 'index-limit'); break; }
        visited.add(file);
        let source: string;
        try { source = await (deps.read ?? ((f) => readFile(f, 'utf8')))(file); }
        catch { issue(file, 'unresolved'); continue; }
        bytes += Buffer.byteLength(source);
        if (bytes > (deps.maxBytes ?? 2 * 1024 * 1024)) { issue(file, 'index-limit'); break; }
        let links: UsageLink[];
        try { links = await index.update(source, file); }
        catch { issue(file, 'unresolved'); continue; }
        count += links.length;
        if (count > (deps.maxLinks ?? 4096)) { index.remove(file); issue(file, 'index-limit'); break; }
        for (const link of links) {
          // An opaque relationship could hide another path to the selected file.
          // Known runtime chains can still be proven; static uniqueness cannot.
          if (link.refusal) issue(file, link.refusal, link.loc);
          else if (link.target && !visited.has(link.target)) queue.push(link.target);
        }
      }
      if (started !== revision) {
        return { links: [], coverage: { complete: false, files: 0, revision,
          issues: [{ file: route, reason: 'stale-index' }] } };
      }
      return { links: index.links(), coverage: { complete: !incomplete, files: visited.size, revision, issues } };
    },
  };
}

export type CompositionService = ReturnType<typeof createCompositionService>;
