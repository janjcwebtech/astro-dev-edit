/**
 * The URL form of an asset path, once it is written into markup.
 *
 * Pure string math — no `node:path` import and no DOM — so it can live in
 * `shared/` and run on either side.
 */

/**
 * A web path as it must be written into markup: every segment
 * percent-encoded.
 *
 * A filesystem name may hold characters a URL path may not — a space above
 * all — and the paths `toWebPath` produces are descriptions of
 * files, so they carry those characters raw. A browser forgives a raw space
 * when it fetches one, which is why this is easy to miss, but `src="/a b.png"`
 * is not a valid URI and is not how anyone writes that path by hand.
 *
 * Only for a path that is **not yet** encoded — one this tool composed from a
 * filename. Running it over a value a person typed would turn their `%20` into
 * `%2520`, so a hand-edited field keeps what it was given.
 */
export function webPathToUrl(webPath: string): string {
  return webPath.split('/').map(encodeURIComponent).join('/');
}
