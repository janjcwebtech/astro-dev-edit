import { realpath } from 'node:fs/promises';
import { relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { annotateAstroSource } from './annotate.ts';
import { createUsageIndex } from './usage-index.ts';

/** Opt-in dev tracing. Supersedes the plain annotation plugin when enabled.
 *  `legacy` carries the same meaning as there: emit Astro's own
 *  `data-astro-source-*` pair only where Astro's compiler will not. */
export function createCompositionPlugin(
  root: string, invalidate: () => void = () => {}, opts: { legacy: boolean } = { legacy: true },
): Plugin {
  const index = createUsageIndex({ root, canonical: realpath });
  return {
    name: 'astro-dev-edit:composition', enforce: 'pre', apply: 'serve',
    transform: {
      order: 'pre',
      async handler(source, file) {
        if (!file.endsWith('.astro') || file.split(/[\\/]/).includes('node_modules')) return null;
        const rel = relative(root, await realpath(file));
        if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
        // Keep resolution local to the awaited transform, including aliases.
        const links = await index.update(source, file,
          async (specifier, importer) => (await this.resolve(specifier, importer))?.id ?? null);
        return { code: await annotateAstroSource(source, file, { composition: links, legacy: opts.legacy,
          runtime: fileURLToPath(new URL('./composition-runtime.ts', import.meta.url)) }), map: null };
      },
    },
    watchChange(id) { index.remove(id); invalidate(); },
  };
}
