import { readFile, realpath } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { launchInEditor } from './editor.ts';
import type { OptionsResolver, ResolvedOptions } from './options.ts';
import { atomicWrite, insideRoot } from './paths.ts';

/** null means a new file; undefined snapshots the current contents. */
export type TextWriter = (target: string, content: string, original?: string | null) => Promise<void>;

async function contents(target: string): Promise<string | null> {
  try {
    return await readFile(target, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** One instance per middleware. Entire requests queue, including settings merges. */
export function createTextWrites(deps: {
  root: string;
  optionsResolver: OptionsResolver;
  logger: { warn(message: string): void };
  launch?: (spec: string, onError?: () => void) => Promise<void>;
  wait?: (ms: number) => Promise<void>;
}) {
  let tail: Promise<unknown> = Promise.resolve();
  let active: ResolvedOptions | undefined;
  const launch = deps.launch ?? launchInEditor;
  const wait = deps.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function reveal(target: string, line: number) {
    let warned = false;
    const warn = () => {
      if (!warned) deps.logger.warn(`Could not reveal ${basename(target)} in the editor; saving continues.`);
      warned = true;
    };
    try { await launch(`${target}:${line}:1`, warn); } catch { warn(); }
  }

  const write: TextWriter = async (target, content, original) => {
    const options = active ?? (await deps.optionsResolver.resolve()).options;
    const before = original === undefined ? await contents(target) : original;
    if (before === content) return;
    // Callers retain their content/config/fixed-settings path gates. Pin the
    // resolved target and parent as well, so a symlink swap during the pause fails.
    const root = await realpath(deps.root);
    const parent = await realpath(dirname(target));
    const identity = before === null ? null : await realpath(target);
    if (!insideRoot(root, parent) || (identity !== null && !insideRoot(root, identity))) {
      throw new Error('write path escapes the project root');
    }
    if (options.revealWrites && before !== null) {
      const oldLines = before.split('\n');
      const newLines = content.split('\n');
      let index = 0;
      while (index < Math.min(oldLines.length, newLines.length) && oldLines[index] === newLines[index]) index++;
      await reveal(target, Math.min(index + 1, oldLines.length));
      await wait(options.revealWriteDelayMs);
    }
    if (await realpath(dirname(target)) !== parent ||
        (identity !== null && await realpath(target) !== identity) ||
        await contents(target) !== before) {
      throw new Error('file changed on disk before saving; reopen it and try again');
    }
    await atomicWrite(target, content);
    if (options.revealWrites && before === null) await reveal(target, 1);
  };

  return {
    write,
    run<T>(operation: () => Promise<T>): Promise<T> {
      const next = tail.then(async () => {
        active = (await deps.optionsResolver.resolve()).options;
        try { return await operation(); } finally { active = undefined; }
      });
      tail = next.catch(() => {});
      return next;
    },
  };
}
