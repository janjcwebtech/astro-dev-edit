import { isAbsolute, relative } from 'node:path';

/**
 * Absolute fs path → the root-relative, forward-slashed spelling that travels
 * on the wire.
 *
 * **Paths leave the server relative and arrive absolute.** A served page is not
 * private — a LAN dev server, a tunnel, a screen share or a screenshot in a bug
 * report all publish it — and an absolute path names the developer, their
 * directory layout and often their client. So nothing the tool emits into HTML,
 * into a runtime comment, or into a JSON response carries one: every path the
 * client sees is relative to the project root, and `paths.ts::checkEditablePath`
 * resolves it back against the root it already knows before any gate runs.
 *
 * That makes the relative form a **wire format only** — never a filesystem
 * input, and never something the server compares against a real path without
 * resolving it first.
 *
 * Pure path arithmetic, no fs: the annotating transform imports this and must
 * stay string-in/string-out.
 */
export function toWirePath(root: string, file: string): string {
  const rel = relative(root, file);
  // `relative` answers with an absolute path only when the two live on
  // different Windows volumes — there is no root-relative spelling then, so
  // the absolute one is the truthful answer.
  return (isAbsolute(rel) ? file : rel).split(/[\\/]/).join('/');
}
