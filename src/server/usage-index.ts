import { relative, isAbsolute, sep } from 'node:path';
import { parseUsages } from './usage-parse.ts';
import { usageId } from '../shared/usage-id.ts';
import type { UsageLink } from '../shared/protocol.ts';

export interface UsageIndexDeps {
  root: string;
  resolve?: (specifier: string, importer: string) => Promise<string | null>;
  /** Realpath in production; injectable for in-memory fixtures. */
  canonical: (file: string) => Promise<string>;
}

/** Per-file replacement also removes stale ids on HMR; no process-global registry.
 * This index contains visited files, not necessarily the whole static graph. */
export function createUsageIndex(deps: UsageIndexDeps) {
  const files = new Map<string, UsageLink[]>();
  const revisions = new Map<string, number>();
  function owned(file: string) {
    const rel = relative(deps.root, file);
    return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  }
  return {
    async update(source: string, file: string, resolveSpecifier = deps.resolve): Promise<UsageLink[]> {
      const revision = (revisions.get(file) ?? 0) + 1;
      revisions.set(file, revision);
      files.delete(file);
      const links: UsageLink[] = [];
      for (const usage of await parseUsages(source)) {
        const link: UsageLink = {
          id: usageId(relative(deps.root, file), usage.loc), file, loc: usage.loc, offset: usage.offset,
          injectionOffset: usage.injectionOffset,
          name: usage.name, hasSpread: usage.hasSpread, props: usage.props,
          slots: usage.slots, refusal: usage.refusal,
        };
        if (!link.refusal) {
          try {
            const resolved = usage.name === 'Astro.self' ? file : await resolveSpecifier?.(usage.specifier!, file);
            if (!resolved) link.refusal = 'unresolved';
            else {
              const target = await deps.canonical(resolved);
              if ([resolved, target].some(path => path.split(/[\\/]/).includes('node_modules'))) link.refusal = 'package';
              else if (!owned(target)) link.refusal = 'outside-root';
              else if (target.endsWith('.mdx') || target.endsWith('.md')) link.refusal = 'chain-break';
              else if (!target.endsWith('.astro')) link.refusal = 'not-astro';
              else link.target = target;
            }
          } catch { link.refusal = 'unresolved'; }
        }
        links.push(link);
      }
      // Hash collisions fail closed, including collisions with another file.
      const other = [...files.entries()].filter(([key]) => key !== file).flatMap(([, value]) => value);
      if (links.some((link, i) => [...other, ...links.slice(0, i)].some(l => l.id === link.id))) {
        files.delete(file);
        throw new Error('Component usage id collision');
      }
      if (revisions.get(file) === revision) files.set(file, links);
      return links;
    },
    remove(file: string) {
      revisions.set(file, (revisions.get(file) ?? 0) + 1);
      files.delete(file);
    },
    links() { return [...files.values()].flat(); },
    usesOf(file: string) { return [...files.values()].flat().filter(link => link.target === file); },
  };
}
