import { readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { insideRoot } from './paths.ts';

/**
 * Finding a collection's entry files on disk — the one piece of knowledge the
 * Items listing and the entry resolver both need.
 *
 * It lived inside the `/collection/entries` handler until `/entry/resolve`
 * needed the same walk. Two copies of "which files are this collection's
 * entries" is exactly the drift that makes a resolver point at a file the
 * listing never shows, so it is one module with one answer.
 *
 * Impure only in `readdir` (injected, so tests stay pure) and confined by
 * {@link inContentRoots} before it is ever called.
 */

/** Cap on one listing. Each entry can cost a stat and a frontmatter parse
 *  downstream, so a pathological directory can't turn a panel open into a long
 *  scan. Exceeding it is reported, never hidden. */
export const MAX_ENTRIES_LISTED = 500;

/** Injected directory walk; defaults to a recursive `readdir`. */
export type ReadDirRecursive = (dirAbs: string) => Promise<string[]>;

const defaultReadDir: ReadDirRecursive = async (dirAbs) =>
  (await readdir(dirAbs, { recursive: true })).map(String);

/**
 * Whether a directory is inside the configured content roots.
 *
 * `insideRoot` alone is not enough: it answers "under the project", while
 * `contentRoots` is the narrower gate the user controls. Both are asked, in
 * that order, exactly as `/collection/entries` has always asked them.
 */
export function inContentRoots(root: string, dirAbs: string, contentRoots: string[]): boolean {
  if (!insideRoot(root, dirAbs)) return false;
  const rel = relative(root, dirAbs);
  return contentRoots.some(
    (cr) => rel === cr || rel.startsWith(cr.endsWith(sep) ? cr : cr + sep),
  );
}

export interface EntryListing {
  /** Directory-relative, forward-slashed file names, sorted. */
  names: string[];
  /** True when the directory held more than {@link MAX_ENTRIES_LISTED}. */
  truncated: boolean;
}

/**
 * A collection directory's entry files, capped and sorted.
 *
 * A missing or unreadable directory is an empty listing, not a throw: a
 * collection declared in the config without its directory yet is a real and
 * common state, and neither caller has anything better to say about it.
 */
export async function listEntryFiles(
  dirAbs: string,
  extensions: readonly string[],
  readDir: ReadDirRecursive = defaultReadDir,
): Promise<EntryListing> {
  let all: string[];
  try {
    all = await readDir(dirAbs);
  } catch {
    return { names: [], truncated: false };
  }
  const names = all
    .map((f) => f.split(sep).join('/'))
    .filter((f) => extensions.some((e) => f.toLowerCase().endsWith(e)))
    .sort();
  return { names: names.slice(0, MAX_ENTRIES_LISTED), truncated: names.length > MAX_ENTRIES_LISTED };
}

/**
 * A directory-relative entry file name as its **entry id**.
 *
 * For a glob loader based at the collection directory this is precisely Astro's
 * own id — the posix path minus the extension, nested directories included — so
 * `2026/hello.md` is `2026/hello`, and a detail URL's tail can be matched
 * against it directly. That equivalence is what `/entry/resolve` rests on.
 */
export function entryId(name: string): string {
  return name.replace(/\.[^./]+$/, '');
}

/** Absolute path of a collection's directory, repo-relative `dir` in hand. */
export function collectionDirAbs(root: string, dir: string): string {
  return resolve(root, dir);
}
