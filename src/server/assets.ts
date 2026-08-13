import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { AssetInfo, UploadRequest } from '../shared/protocol.ts';
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

/** List image files under the configured asset dirs, as web-servable paths with
 *  size and mtime. Read-only. Every directory is confined to the project root.
 *  Sorted by path; the client re-sorts (by recency, by default). (spec §6.3, §8) */
export async function listAssets(root: string, assetDirs: string[]): Promise<AssetInfo[]> {
  // A Map because asset dirs may nest (e.g. public/photos inside public), so
  // the same file can be reached twice — keyed by web path, first one wins.
  const out = new Map<string, AssetInfo>();
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
      const path = toWebPath(root, file);
      if (out.has(path)) continue;
      // Statted after the extension filter, so non-images cost nothing. A file
      // deleted between the readdir and the stat is simply left out.
      try {
        const info = await stat(file);
        out.set(path, { path, size: info.size, mtime: info.mtimeMs });
      } catch {
        continue;
      }
    }
  }
  return [...out.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** The mime type of a data: URL without decoding its payload — for policy
 *  checks that must not pay for a base64 decode of the whole image. Empty
 *  string when the value isn't a data URL. */
export function dataUrlMime(dataUrl: string): string {
  return /^data:([^;,]+)/.exec(dataUrl ?? '')?.[1]?.toLowerCase() ?? '';
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
 * Write image bytes into the configured upload directory. The destination is
 * confined to the upload dir inside the project root, the mime must be an
 * allowed image type, and the name is sanitised. On a name clash a numeric
 * suffix is added rather than overwriting. Returns the web-servable path and
 * the name actually written. (safe: writes a NEW asset file, never patches
 * source)
 *
 * Bytes-in rather than data-URL-in because not every caller has a data URL:
 * `/unsplash/import` downloads a response body, and synthesising a data URL
 * from it would mean a ~33% larger base64 string and a decode straight back to
 * the Buffer we started with.
 */
export async function saveBuffer(
  root: string,
  uploadDir: string,
  file: { mime: string; data: Buffer; filename: string },
): Promise<{ webPath: string; filename: string }> {
  const fallbackExt = EXT_BY_MIME[file.mime];
  if (!fallbackExt) throw new Error(`unsupported image type: ${file.mime}`);

  // Uploads land in the configured upload dir, confined to the project root.
  const dir = resolve(root, uploadDir);
  if (!insideRoot(root, dir)) throw new Error('upload directory escapes the project root');

  const fileName = safeFileName(file.filename || 'upload', fallbackExt);
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
  await writeFile(target, file.data);

  return { webPath: toWebPath(root, target), filename: basename(target) };
}

/**
 * Write an uploaded image into the configured upload directory. Accepts a
 * data-URL; everything past the decode is {@link saveBuffer}.
 */
export async function saveUpload(
  root: string,
  uploadDir: string,
  payload: UploadRequest,
): Promise<{ webPath: string }> {
  const { mime, data } = parseDataUrl(payload.dataUrl);
  return saveBuffer(root, uploadDir, { mime, data, filename: payload.filename });
}
