import type { AssetInfo } from '../shared/protocol.ts';

/**
 * What the image picker shows, and what it says about the files it will not
 * let you pick.
 *
 * **Pure and DOM-free.** A listing goes in, an order and a sentence come out.
 * Its own module for the reason `value-model.ts` is: the decision that a file
 * is unusable — and the words explaining why — is the part worth pinning in a
 * test, and it must not need a browser to ask.
 *
 * The rule it exists to hold is the one that reads back byte-perfect and is
 * still wrong on the page: `assetDirs` spans `src/` and the public directory
 * on purpose, but a **build** copies only the public directory. A `src`
 * pointing anywhere else is a truthful dev URL and a 404 in the built site.
 * Servability is the server's answer, carried per file — never re-derived here
 * from a path prefix, because only the server knows the configured `publicDir`.
 */

/** Why this asset cannot be used as a plain `<img src>`, or null when it can. */
export function assetRefusal(asset: AssetInfo, publicDir: string):
  { short: string; full: string } | null {
  if (asset.servable) return null;
  return {
    short: 'Dev only',
    full: `${asset.path} — served in dev only. A build copies just ${publicDir}/, so this path would 404 in the built site.`,
  };
}

/**
 * Everything matching the filter, usable first and newest first inside that.
 *
 * Unusable files stay in the listing rather than being dropped: a grid that
 * quietly hides half a directory reads as "you have no images" when the real
 * answer is "not this one, and here is why" (issue #9). They sort last, so a
 * first page of eight is not spent on tiles that cannot be clicked.
 */
export function visibleAssets(
  files: readonly AssetInfo[], filter: string, publicDir: string,
): AssetInfo[] {
  const needle = filter.trim().toLowerCase();
  const list = needle ? files.filter(asset => asset.path.toLowerCase().includes(needle)) : [...files];
  return list.sort((a, b) => {
    const usable = Number(assetRefusal(b, publicDir) === null) - Number(assetRefusal(a, publicDir) === null);
    return usable || b.mtime - a.mtime;
  });
}

/**
 * The sentence under the upload button.
 *
 * `uploadDir` is named either way, because a directory is not something to
 * discover from a toast after a file has been written into it. The warning
 * form is the one that matters: an upload outside the public directory
 * produces a `src` the built site cannot serve, and that is cheap to see here
 * and expensive to find later.
 */
export function uploadNote(uploadDir: string, publicDir: string): { text: string; warn: boolean } {
  const under = uploadDir === publicDir || uploadDir.startsWith(`${publicDir}/`);
  return under
    ? { text: `Uploads land in ${uploadDir}/ — inside ${publicDir}/, so the built site serves them.`, warn: false }
    : { text: `Uploads land in ${uploadDir}/, which is outside ${publicDir}/. A build copies only ${publicDir}/, so a src pointing there would 404.`, warn: true };
}
