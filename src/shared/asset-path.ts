/**
 * Path conversions for `image()`-backed frontmatter fields.
 *
 * Two path universes meet in the entry drawer. A plain `<img src>` in a
 * `.astro` file needs a **web-servable, root-relative** path (`/images/hero.png`)
 * that still resolves in the built site. A field backed by Astro's `image()`
 * schema helper needs an **entry-file-relative** path (`../../assets/hero.png`)
 * that Vite can import at build time. This module is the only place that
 * converts between them.
 *
 * Runtime-shared (client + server), like `slug.ts` — so it is pure posix string
 * math with no `node:path` import and no DOM. Every function returns `null`
 * rather than throwing, and refuses anything that would escape the project root.
 */

/** Only assets under `src/` can back an `image()` field: Astro imports them
 *  through Vite, and files in `public/` are copied verbatim, never importable. */
const IMPORTABLE_PREFIX = 'src';

/** Split a path into segments, tolerating Windows separators and dropping the
 *  no-op `.` and empty parts. */
function segmentsOf(path: string): string[] {
  return path.replace(/\\/g, '/').split('/').filter((s) => s !== '' && s !== '.');
}

/** Resolve `..` segments, or null when they climb past the root. */
function normalize(parts: string[]): string[] | null {
  const out: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      if (out.length === 0) return null; // escapes the project root
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out;
}

/** The directory segments of a repo-relative file path. */
function dirSegments(file: string): string[] {
  const parts = segmentsOf(file);
  return parts.slice(0, -1);
}

/**
 * An entry-relative asset value → the path the dev server serves it at.
 *
 * `('src/content/blog/post.md', '../../assets/blog/hero.png')`
 *   → `'/src/assets/blog/hero.png'`
 *
 * A value that is already root-relative is returned unchanged: it is the wrong
 * shape for the field, but previewing what it actually points at is more useful
 * than showing nothing. Returns null for an empty value or one that climbs out
 * of the project root.
 */
export function entryRelativeToWeb(entryFile: string, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/')) return trimmed;
  // A bare URL or data: value is not a file path at all — hand it back for the
  // preview to attempt, and let the caller decide it isn't a valid field value.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  const resolved = normalize([...dirSegments(entryFile), ...segmentsOf(trimmed)]);
  return resolved && resolved.length ? '/' + resolved.join('/') : null;
}

/**
 * A served asset path → the entry-relative value to store in frontmatter.
 *
 * `('src/content/blog/post.md', '/src/assets/blog/hero.png')`
 *   → `'../../assets/blog/hero.png'`
 *
 * Returns null when the asset can't back an `image()` field — anything outside
 * `src/`, which covers every `public/` asset, since Astro cannot import those.
 */
export function webToEntryRelative(entryFile: string, webPath: string): string | null {
  if (!webPath.startsWith('/')) return null;
  const target = normalize(segmentsOf(webPath));
  if (!target || target[0] !== IMPORTABLE_PREFIX) return null;
  const from = normalize(dirSegments(entryFile));
  if (!from) return null;

  let common = 0;
  while (common < from.length && common < target.length && from[common] === target[common]) {
    common++;
  }
  const up = new Array(from.length - common).fill('..');
  const down = target.slice(common);
  if (down.length === 0) return null; // the asset *is* the directory
  // A bare `hero.png` reads as a bare module specifier to Vite; `./hero.png`
  // is unambiguously a sibling file.
  return up.length ? [...up, ...down].join('/') : './' + down.join('/');
}

/**
 * The root-relative directory an `image()` field's current value lives in, for
 * uploads that should land beside their siblings rather than in a shared root.
 *
 * `('src/content/blog/post.md', '../../assets/blog/hero.png')` → `'src/assets/blog'`
 *
 * Returns null when there is no value, or when it doesn't resolve to an
 * importable `src/` asset — the caller then falls back to its configured dir.
 */
export function entryAssetDir(entryFile: string, value: string): string | null {
  const web = entryRelativeToWeb(entryFile, value);
  if (!web || !web.startsWith('/')) return null;
  const parts = normalize(segmentsOf(web));
  if (!parts || parts[0] !== IMPORTABLE_PREFIX) return null;
  const dir = parts.slice(0, -1);
  return dir.length ? dir.join('/') : null;
}
