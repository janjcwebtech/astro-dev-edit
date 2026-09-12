import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Server modules must not defer a module load to request time.
 *
 * The package exports `src/index.ts`, and Node refuses to strip types under
 * `node_modules`. A consuming project's config therefore misses Astro's
 * native-import path and is loaded by `loadConfigWithVite`, whose minimal Vite
 * dev server is closed as soon as the config has been read. Everything under
 * `src/server` was evaluated inside that runner, so an `await import()` left
 * for request time is routed through a runner that no longer exists and throws
 * "Vite module runner has been closed."
 *
 * The failure is invisible in this repo's own tests and in `examples/`, where
 * the integration is a path dependency Node can load itself — it only appears
 * once someone installs the package for real. A static scan is the only guard
 * that runs on every change; the alternative is waiting for the next bug
 * report.
 */

const SERVER_DIR = fileURLToPath(new URL('../src/server', import.meta.url));

/** `import(` not preceded by a word character, so `.import(` on an object — a
 *  module runner's own `import` method, say — is not a hit. */
const DYNAMIC_IMPORT = /(^|[^.\w])import\s*\(/;

/** Blank out comments so the explanatory notes about this very rule don't trip
 *  it. Line breaks are kept so a reported line number is the real one. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('src/server', () => {
  it('loads every module statically', async () => {
    const names = (await readdir(SERVER_DIR)).filter((n) => n.endsWith('.ts'));
    expect(names.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const name of names) {
      const source = stripComments(await readFile(join(SERVER_DIR, name), 'utf8'));
      source.split(/\r?\n/).forEach((line, i) => {
        if (DYNAMIC_IMPORT.test(line)) offenders.push(`${name}:${i + 1}: ${line.trim()}`);
      });
    }

    expect(offenders).toEqual([]);
  });
});
