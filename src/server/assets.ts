import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { UploadRequest } from '../shared/protocol.ts';
import { insideRoot, toWebPath } from './paths.ts';

/**
 * Asset handling: read-only image listing for the swap panel, and image
 * uploads. Uploads write NEW files into a configured asset dir — never a
 * source-file patch. (spec §6.3, §11)
 */

export const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.svg']);

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
};

async function walk(dir: string): Promise<string[]> {
  const found: string[] = [];
  const items = await readdir(dir, { withFileTypes: true });
  for (const item of items) {
    const full = join(dir, item.name);
    if (item.isDirectory()) found.push(...(await walk(full)));
    else if (item.isFile()) found.push(full);
  }
  return found;
}

/** List image files under the configured asset dirs, as web-servable paths.
 *  Read-only. Every directory is confined to the project root. (spec §6.3, §8) */
export async function listAssets(root: string, assetDirs: string[]): Promise<string[]> {
  // A Set because asset dirs may nest (e.g. public/photos inside public).
  const out = new Set<string>();
  for (const dir of assetDirs) {
    const abs = resolve(root, dir);
    // Refuse anything that escaped the root (e.g. via `..`). (spec §8)
    if (!insideRoot(root, abs)) continue;
    let entries: string[];
    try {
      entries = await walk(abs);
    } catch {
      continue; // dir may not exist; skip quietly
    }
    for (const file of entries) {
      const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
      if (!IMAGE_EXT.has(ext)) continue;
      out.add(toWebPath(root, file));
    }
  }
  return [...out].sort();
}

/** Split a data: URL into its mime type and decoded bytes. Throws on
 *  anything that isn't a data URL. */
export function parseDataUrl(dataUrl: string): { mime: string; data: Buffer } {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl ?? '');
  if (!m) throw new Error('expected a data: URL');
  const mime = m[1].toLowerCase();
  const data = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
  return { mime, data };
}

/** Sanitise a user-supplied filename to a safe basename with an allowed ext. */
export function safeFileName(name: string, fallbackExt: string): string {
  const base = basename(name).replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+/, '');
  let ext = extname(base).toLowerCase();
  let stem = base.slice(0, base.length - ext.length) || 'image';
  if (!IMAGE_EXT.has(ext)) ext = fallbackExt;
  return `${stem}${ext}`;
}

/**
 * Write an uploaded image into an asset directory. Accepts a data-URL. The
 * destination is confined to a configured asset dir inside the project root,
 * the extension must be an allowed image type, and the name is sanitised. On a
 * name clash a numeric suffix is added rather than overwriting. Returns the
 * web-servable path. (safe: writes a NEW asset file, never patches source)
 */
export async function saveUpload(
  root: string,
  assetDirs: string[],
  payload: UploadRequest,
): Promise<{ webPath: string }> {
  const { mime, data } = parseDataUrl(payload.dataUrl);
  const fallbackExt = EXT_BY_MIME[mime];
  if (!fallbackExt) throw new Error(`unsupported image type: ${mime}`);

  // Target the first configured asset dir that lives inside the root.
  const dir = assetDirs.map((d) => resolve(root, d)).find((abs) => insideRoot(root, abs));
  if (!dir) throw new Error('no writable asset directory configured');

  const fileName = safeFileName(payload.filename || 'upload', fallbackExt);
  let target = join(dir, fileName);
  // Confirm the resolved target is still inside the asset dir. (spec §8)
  if (!insideRoot(dir, target)) throw new Error('path escapes asset dir');

  // Avoid clobbering an existing file.
  const stem = fileName.slice(0, fileName.length - extname(fileName).length);
  const ext = extname(fileName);
  let n = 1;
  const existing = new Set(await walk(dir).catch(() => []));
  while (existing.has(target)) {
    target = join(dir, `${stem}-${n++}${ext}`);
  }

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data);

  return { webPath: toWebPath(root, target) };
}
