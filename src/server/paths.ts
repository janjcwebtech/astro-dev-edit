import { realpath, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';

/**
 * Path confinement and mapping helpers — the single home for every "may this
 * path be touched?" rule. (spec §8)
 */

/** True when `abs` lies inside `root` (string-space; no symlink resolution). */
export function insideRoot(root: string, abs: string): boolean {
  const rel = relative(root, abs);
  return !rel.startsWith('..') && !rel.startsWith(sep);
}

/** Map an absolute file under the project root to its web-servable path:
 *  `public/` maps to the site root; everything else keeps its project path. */
export function toWebPath(root: string, absFile: string): string {
  const relToRoot = relative(root, absFile).split(sep).join('/');
  return relToRoot.startsWith('public/')
    ? '/' + relToRoot.slice('public/'.length)
    : '/' + relToRoot;
}

/**
 * Resolve and validate a client-supplied source path for editing. The real
 * path (symlinks resolved) must live inside the project root AND inside one of
 * the configured content roots, with an allowed extension. Throws otherwise.
 * (spec §8)
 */
export async function validateEditablePath(
  root: string,
  contentRoots: string[],
  editableExtensions: string[],
  file: string,
): Promise<string> {
  const abs = await realpath(resolve(root, file)); // throws if it doesn't exist
  const rootReal = await realpath(root);
  const rel = relative(rootReal, abs);
  if (!rel || rel.startsWith('..') || rel.startsWith(sep)) {
    throw new Error('path escapes the project root');
  }
  const inContentRoot = contentRoots.some(
    (cr) => rel === cr || rel.startsWith(cr.endsWith(sep) ? cr : cr + sep),
  );
  if (!inContentRoot) throw new Error('path is outside the editable content roots');
  if (!editableExtensions.includes(extname(abs).toLowerCase())) {
    throw new Error(`files of type ${extname(abs) || '(none)'} are not editable`);
  }
  return abs;
}

/** Write atomically: temp file in the same directory, then rename. (spec §10) */
export async function atomicWrite(target: string, content: string): Promise<void> {
  const tmp = join(dirname(target), `.${basename(target)}.text-edit-tmp-${process.pid}`);
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, target);
}
