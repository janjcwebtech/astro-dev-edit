/**
 * "Does this path belong to an installed package rather than the user's own
 * source?" — one implementation, because both sides ask it and a drift between
 * them is a bug in the refusal the whole `astro:assets` story rests on.
 *
 * The server asks it to name *why* a path is refused (`paths.ts::isPackageOwned`,
 * behind the content-root gate that does the actual refusing). The client asks
 * it on hover, to decide whether to look past an element for the markup that
 * used the component — and must answer without a round trip, since the answer
 * is wanted for every annotated element under the pointer.
 *
 * A `shared/slug.ts`-shaped runtime module rather than a corner of
 * `protocol.ts`, which stays types-only.
 */

/**
 * True when any path *segment* is `node_modules`.
 *
 * A segment test, never a substring: a project directory honestly named
 * `my_node_modules_notes` is the user's own source and must stay editable.
 *
 * Both separators are split on regardless of platform. The client receives
 * whatever Astro stamped into the annotation and has no `path.sep` to consult,
 * and on POSIX — where a backslash is a legal filename character rather than a
 * separator — the extra split can only ever classify *more* paths as
 * package-owned, never fewer. That direction is a refusal, so it fails safe.
 */
export function isPackagePath(path: string): boolean {
  return path.split(/[\\/]/).includes('node_modules');
}
