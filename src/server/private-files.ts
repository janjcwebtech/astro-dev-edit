import type { Connect, Plugin as VitePlugin } from 'vite';

/**
 * Files this integration writes into the project root that the dev server must
 * never hand back over HTTP.
 *
 * Vite serves the project root, so `.astro-dev-edit.json` — the option and
 * field-override document `settings.ts` writes — is reachable at
 * `GET /.astro-dev-edit.json` and at `/@fs/<root>/.astro-dev-edit.json`. None of
 * this integration's own defences see those requests: `middleware.ts` is mounted
 * from `astro:server:setup` with `server.middlewares.use()`, which appends
 * *after* Vite's static and `@fs` handlers, and it only inspects URLs under
 * `/__dev-edit` before calling `next()`. So `isLocalRequest` and
 * `validateEditablePath` are both bypassed. (spec §8)
 *
 * **Why not `server.fs.deny`.** That is the obvious lever and it is a trap.
 * Vite resolves server options with `mergeWithDefaultsRecursively`, where an
 * array in user config *replaces* the default rather than extending it — so
 * adding one entry would silently drop Vite's own protection for `.env`,
 * `.env.*`, `*.{crt,pem,key,…}`, `.npmrc`, `.yarnrc.yml` and every `.git`
 * directory. Nor can the list be extended after the fact: `fsDenyGlob` is compiled during
 * `resolveConfig`, before any `configResolved` hook could push to it.
 *
 * **The seam.** A Vite plugin's `configureServer` *body* runs before Vite
 * installs its own middlewares; only the function it returns is a post hook. So
 * registering here — and only here — puts this guard ahead of the static and
 * `@fs` handlers, on every Vite version Astro 5–7 pins.
 */

/** Fixed filenames, never client-supplied. Add a file here to make it unservable. */
const PRIVATE_FILES: readonly string[] = ['.astro-dev-edit.json'];

/**
 * `atomicWrite`'s mid-write sibling, `.<basename>.dev-edit-tmp-<pid>`
 * (`paths.ts`). It is covered for two reasons: the sibling of a secret-bearing
 * file briefly holds that secret, and for a dotfile target the doubled leading
 * dot (`..env.local.dev-edit-tmp-1234`) falls outside Vite's own `.env.*` deny.
 */
const TMP_SEGMENT_RE = /^\..+\.dev-edit-tmp-\d+$/;

/**
 * Whether a request URL names a private file, in any form the dev server would
 * resolve: a plain root path, a `base`-prefixed one (this runs before Vite's
 * `baseMiddleware`, so the base is still attached), `/@fs/<abs>`, with a query
 * (`?raw`, `?import`, `?t=…`) or a fragment, and percent-encoded.
 *
 * Segment equality rather than path resolution: it needs no filesystem access
 * and no knowledge of the project root or the configured base, and one rule
 * covers every form above. Three details are load-bearing:
 *
 * - Split on backslash too, or a Windows `/@fs/C:\proj\…` path is one segment.
 * - Test the raw *and* decoded spelling. Decode once, matching what Vite does:
 *   decoding further would only over-refuse, since `%252e` reaches the
 *   filesystem as a literal `%2e` filename. A URL that cannot be decoded is
 *   still tested raw — Vite bails on those too, so it is not a bypass.
 * - Compare case-insensitively, as Vite's own deny globs do: macOS and Windows
 *   will happily serve `/.ASTRO-DEV-EDIT.JSON`.
 */
export function isPrivateFileRequest(url: string): boolean {
  const path = url.split('#')[0].split('?')[0];

  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // Malformed escape — test the raw spelling only.
  }

  for (const candidate of decoded === path ? [path] : [path, decoded]) {
    for (const raw of candidate.split(/[\\/]/)) {
      const segment = raw.toLowerCase();
      if (PRIVATE_FILES.includes(segment) || TMP_SEGMENT_RE.test(segment)) return true;
    }
  }
  return false;
}

/**
 * Refuse with 403 rather than 404: the filename is documented publicly, so
 * there is no existence to conceal, and a legible refusal is worth more to a
 * developer whose `fetch` just failed. The body never echoes the path.
 */
function refuse(res: Parameters<Connect.NextHandleFunction>[1]): void {
  res.statusCode = 403;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end('astro-dev-edit: this file is not served by the dev server.\n');
}

/**
 * The guard plugin. Registered unconditionally from `astro:config:setup` — a
 * project that disabled the editor still has the file on disk, and a protection
 * that only appeared on some Astro versions would be a hole.
 */
export function createPrivateFilesPlugin(): VitePlugin {
  return {
    name: 'astro-dev-edit:private-files',
    // Never part of a build; `enforce: 'pre'` sorts this configureServer ahead
    // of other plugins', so none of them can install a file server in front.
    apply: 'serve',
    enforce: 'pre',
    configureServer(server) {
      // Registered in the hook body, NOT in a returned function: the body runs
      // before Vite installs its static and @fs middlewares, a returned
      // function runs after them. That ordering is the whole fix.
      server.middlewares.use((req, res, next) => {
        if (isPrivateFileRequest(req.url ?? '')) {
          refuse(res);
          return;
        }
        next();
      });
    },
  };
}
