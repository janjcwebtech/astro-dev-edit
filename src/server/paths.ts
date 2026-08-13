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

/**
 * Resolve a client-requested upload directory, or fall back.
 *
 * Uploads may only land in directories the integration already treats as asset
 * locations — otherwise a client-supplied `targetDir` would be a general
 * "write a file anywhere under the project root" capability. Anything outside
 * them (or escaping the root) returns `fallback` rather than throwing, so a
 * stale or hostile request writes somewhere safe instead of failing the upload.
 * Pure string-space, like the rest of this module. (spec §8)
 */
export function resolveUploadDir(
  root: string,
  allowedDirs: string[],
  fallback: string,
  requested?: string,
): string {
  if (!requested) return fallback;
  const abs = resolve(root, requested);
  if (!insideRoot(root, abs)) return fallback;
  const allowed = allowedDirs.some((dir) => {
    const dirAbs = resolve(root, dir);
    return insideRoot(root, dirAbs) && insideRoot(dirAbs, abs);
  });
  return allowed ? requested : fallback;
}

/**
 * Where an asset write should land — the shared rule behind `/upload` and
 * `/unsplash/import`.
 *
 * Two decisions in one place. An `assetRef: 'relative'` field's asset is
 * imported by Astro rather than served verbatim, so it falls back to the
 * src-side dir instead of the web-servable one; and a client-supplied
 * `targetDir` is honoured only when {@link resolveUploadDir} finds it inside a
 * configured asset directory. Extracted rather than duplicated because a drift
 * between two copies of this is a path-confinement bug — the exact class this
 * module exists to centralise.
 *
 * `redirected` is true when a requested `targetDir` was refused, so the caller
 * can log it: the rule lives here, the logger does not.
 */
export function resolveAssetTarget(
  root: string,
  dirs: { uploadDir: string; imageUploadDir: string; allowedDirs: string[] },
  req: { assetRef?: 'relative'; targetDir?: string },
): { dir: string; redirected: boolean } {
  const fallback = req.assetRef === 'relative' ? dirs.imageUploadDir : dirs.uploadDir;
  const dir = resolveUploadDir(root, dirs.allowedDirs, fallback, req.targetDir);
  return { dir, redirected: Boolean(req.targetDir) && dir !== req.targetDir };
}

/** Map an absolute file under the project root to its web-servable path:
 *  `public/` maps to the site root; everything else keeps its project path. */
export function toWebPath(root: string, absFile: string): string {
  const relToRoot = relative(root, absFile).split(sep).join('/');
  return relToRoot.startsWith('public/')
    ? '/' + relToRoot.slice('public/'.length)
    : '/' + relToRoot;
}

/** Why a path was refused. `outside-roots` is a *normal answer* for read-only
 *  callers — the element belongs to a package or a non-content file, which is
 *  information, not a fault. The others are anomalies worth surfacing. */
export type PathRefusal = 'missing' | 'escapes-root' | 'outside-roots' | 'bad-extension';

export type PathCheck =
  | { ok: true; abs: string }
  /** `abs` is present whenever the path resolved at all (absent only for
   *  `missing`), so callers can tailor a message from where it landed. */
  | { ok: false; code: PathRefusal; reason: string; abs?: string };

/** True when the path lives inside an installed package. Such files are real
 *  and readable but are never the user's own source — `astro:assets` renders
 *  every `<Image>` through `node_modules/astro/components/Image.astro`, and
 *  that is the path the source annotation carries. */
export function isPackageOwned(abs: string): boolean {
  return abs.split(sep).includes('node_modules');
}

/**
 * Resolve and check a client-supplied source path, *without* throwing. The
 * real path (symlinks resolved) must live inside the project root AND inside
 * one of the configured content roots, with an allowed extension.
 *
 * This is the single implementation of the gate; `validateEditablePath` is the
 * throwing wrapper over it. Read-only callers that want to answer "not
 * editable" instead of erroring use this directly. (spec §8)
 */
export async function checkEditablePath(
  root: string,
  contentRoots: string[],
  editableExtensions: string[],
  file: string,
): Promise<PathCheck> {
  let abs: string;
  try {
    abs = await realpath(resolve(root, file));
  } catch {
    return { ok: false, code: 'missing', reason: `no such file: ${file}` };
  }
  const rootReal = await realpath(root);
  const rel = relative(rootReal, abs);
  if (!rel || rel.startsWith('..') || rel.startsWith(sep)) {
    return { ok: false, code: 'escapes-root', reason: 'path escapes the project root', abs };
  }
  const inContentRoot = contentRoots.some(
    (cr) => rel === cr || rel.startsWith(cr.endsWith(sep) ? cr : cr + sep),
  );
  if (!inContentRoot) {
    return {
      ok: false,
      code: 'outside-roots',
      reason: 'path is outside the editable content roots',
      abs,
    };
  }
  if (!editableExtensions.includes(extname(abs).toLowerCase())) {
    return {
      ok: false,
      code: 'bad-extension',
      reason: `files of type ${extname(abs) || '(none)'} are not editable`,
      abs,
    };
  }
  return { ok: true, abs };
}

/**
 * Throwing form of {@link checkEditablePath} — the gate every *writing* or
 * file-launching route passes through. Unchanged in behavior: any refusal is
 * an Error. (spec §8)
 */
export async function validateEditablePath(
  root: string,
  contentRoots: string[],
  editableExtensions: string[],
  file: string,
): Promise<string> {
  const check = await checkEditablePath(root, contentRoots, editableExtensions, file);
  if (!check.ok) throw new Error(check.reason);
  return check.abs;
}

/** Write atomically: temp file in the same directory, then rename. (spec §10) */
export async function atomicWrite(target: string, content: string): Promise<void> {
  const tmp = join(dirname(target), `.${basename(target)}.text-edit-tmp-${process.pid}`);
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, target);
}
