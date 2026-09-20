import type { AstroIntegration } from 'astro';
import { createRequire } from 'node:module';
import { join, relative, resolve, sep } from 'node:path';
import { createAnnotatePlugin } from './server/annotate.ts';
import { createCompositionPlugin } from './server/composition-plugin.ts';
import { createCompositionService, type CompositionService } from './server/composition-service.ts';
import { createMiddleware } from './server/middleware.ts';
import { createPrivateFilesPlugin } from './server/private-files.ts';
import { createRouteManifest, type ResolvedRouteLike } from './server/route-manifest.ts';
import { createOptionsResolver, DEFAULTS, type DevEditOptions } from './server/options.ts';
import { fileURLToPath } from 'node:url';

/**
 * astro-dev-edit — in-browser visual content editing for the local dev server.
 *
 * Click-to-edit for literal text and static img src/alt in .astro templates:
 * the client confirms each target against the server-side AST classification,
 * and commits patch the source file directly (verified, atomic).
 *
 * Dev-only. The integration registers nothing for builds, so it can never reach
 * a production bundle. See spec §8.
 *
 * **The option vocabulary lives in `server/options.ts`,** not here — the
 * Settings panel resolves options per request against the settings file, so the
 * table that declares them has to sit where both the resolver and the routes can
 * read it. This file passes what the project actually wrote to `devEdit()`
 * through **unmerged**: `key in userOptions` is what tells the panel an option is
 * config-owned, and collapsing it into `DEFAULTS` here would erase exactly that.
 */

export type { DevEditOptions, ResolvedOptions } from './server/options.ts';

/** The project's installed Astro major, resolved from the project root (the
 *  integration's own tree has no astro). null when resolution fails. */
function detectAstroMajor(projectRoot: string): number | null {
  try {
    const req = createRequire(join(projectRoot, 'package.json'));
    const version = (req('astro/package.json') as { version: string }).version;
    const major = Number.parseInt(version.split('.')[0]!, 10);
    return Number.isNaN(major) ? null : major;
  } catch {
    return null;
  }
}

export default function devEdit(userOptions: DevEditOptions = {}): AstroIntegration {
  // Config-setup-time options only. These are consumed before any dev server
  // exists — annotation and composition options register Vite plugins — so
  // they cannot come from the settings file and appear read-only in the panel.
  // `enabled` is additionally config-only because storing `false` there would
  // lock the user out of the UI that set it.
  const enabled = userOptions.enabled ?? DEFAULTS.enabled;
  const sourceAnnotations = userOptions.sourceAnnotations ?? DEFAULTS.sourceAnnotations;

  // Captured in config:setup, consumed in server:setup. Only set when we're
  // actually running in dev with the integration enabled.
  let active = false;
  let projectRoot = '';
  let base = '/';
  /** Astro's `publicDir`, root-relative and posix-shaped. The one directory a
   *  build copies verbatim, so it is what decides both the URL an asset is
   *  served at and whether that URL survives the build. Read from the config
   *  rather than assumed to be `public`. */
  let publicDir = 'public';
  /** Astro's own route table, for "which file is this page written in". Replaced
   *  wholesale on every `astro:routes:resolved` and read through a thunk, never
   *  captured: the hook re-fires on any change under `srcDir`, so a page added
   *  mid-session has to be visible without a restart. */
  let resolvedRoutes: readonly ResolvedRouteLike[] = [];
  let composition: CompositionService | null = null;

  return {
    name: 'astro-dev-edit',
    hooks: {
      'astro:config:setup': ({ command, config, injectScript, logger, updateConfig }) => {
        // Dev server only. Bail for `astro build` / `astro preview` so nothing
        // ships to production. (spec §4.1, §8)
        if (command !== 'dev') return;

        // Ahead of the `enabled` bail on purpose: a project that turned the
        // editor off still has `.astro-dev-edit.json` sitting in a directory
        // Vite serves, so "disabled" must mean no editor, not no protection.
        // Like `createAnnotatePlugin` below this is an ordering problem, but in
        // the middleware stack rather than the transform one — see the header
        // of `private-files.ts` for why `configureServer` is the only seam and
        // `server.fs.deny` is not.
        updateConfig({ vite: { plugins: [createPrivateFilesPlugin()] } });

        if (!enabled) {
          logger.info('disabled via options.enabled — skipping');
          return;
        }
        active = true;
        projectRoot = fileURLToPath(config.root);
        // Not normalized by Astro's schema — 'docs', '/docs' and '/docs/' are
        // all possible, and route-manifest.ts tolerates all three.
        base = config.base ?? '/';
        publicDir =
          relative(projectRoot, fileURLToPath(config.publicDir)).split(sep).join('/') || 'public';

        // Upload-directory preflight. Only warns about what the *config* says:
        // the panel enforces the same two rules on the value it stores, and a
        // startup warning about a value the user is about to change from the UI
        // would be noise.
        warnAboutUploadDirs(projectRoot, publicDir, userOptions, logger);

        // The whole feature rides on source annotations, so the tool owns them
        // on every supported version rather than borrowing a channel that is
        // present on 5/6 only while the dev toolbar is on and absent from 7
        // altogether (withastro/compiler-rs#96). One transform, one namespace,
        // one set of loc rules to hold — and `data-atx-*` is nobody else's to
        // strip, shift or switch off. `'off'` is the one opt-out, and now
        // leaves the overlay with nothing at all: the client reads no other
        // namespace.
        //
        // Astro's own `data-astro-source-*` is never emitted alongside, and
        // the reason differs by case. Where Astro emits its own, a second pair
        // is not a harmless duplicate: the Go printer splices its own (shifted)
        // loc in ahead of ours and the parser keeps that one. Where Astro emits
        // nothing — 7, or 5/6 with the toolbar off — the pair served readers
        // outside this tool only, and cost one absolute path per element in
        // served HTML (#76). See `annotate.ts`'s header for both measurements.
        const astroMajor = detectAstroMajor(projectRoot);
        const toolbarEnabled = config.devToolbar?.enabled ?? true;
        const astroAnnotates = astroMajor !== null && astroMajor < 7 && toolbarEnabled;
        const trace = userOptions.composition ?? DEFAULTS.composition;
        const selfAnnotate = trace || sourceAnnotations !== 'off';
        if (selfAnnotate) {
          updateConfig({ vite: { plugins: [trace
            ? createCompositionPlugin(projectRoot, () => composition?.invalidate())
            : createAnnotatePlugin(projectRoot)] } });
          logger.info(
            (trace ? 'component tracing and ' : '') +
            `injecting data-atx-* source annotations (Astro ${astroMajor ?? 'unknown'})`,
          );
        }

        // `sourceAnnotations: 'off'` is now total, not a handover: the client
        // reads `data-atx-*` and nothing else, so Astro's own annotations —
        // where a 5/6 dev toolbar still emits them — are no longer a second
        // read path. Fail loud rather than mysteriously do nothing.
        if (!selfAnnotate) {
          logger.warn(
            'sourceAnnotations is "off", so no data-atx-* annotations are ' +
              'injected and astro-dev-edit has nothing to locate elements ' +
              'with. It will find nothing' +
              (astroAnnotates
                ? ' — Astro\u2019s own data-astro-source-* is not a substitute; ' +
                  'the client stopped reading it.'
                : '.') +
              ' Set sourceAnnotations: "auto" to inject them.',
          );
        }

        // Injected on every page. `overlay.ts` is compiled by Vite because the
        // injected code imports it by absolute path. (spec §4.1)
        const overlayUrl = new URL('./client/overlay.ts', import.meta.url);
        injectScript('page', `import ${JSON.stringify(fileURLToPath(overlayUrl))};`);

        logger.info(userOptions.composition
          ? 'read-only inspector available — hold Alt / Option and click, or open the left-edge element tree'
          : 'edit mode available — toggle it from the admin bar at the top of the page');
      },

      // Astro's answer to "which file is this route written in", which the DOM
      // cannot give: component tags carry no source annotation. This fires on
      // every add/unlink/change under srcDir, so the body is an assignment and
      // nothing else — no logging, no work per fire. The `active` guard is what
      // keeps the integration dev-only: it is set only by a dev config:setup.
      'astro:routes:resolved': ({ routes }: { routes: readonly ResolvedRouteLike[] }) => {
        if (!active) return;
        resolvedRoutes = routes;
        composition?.invalidate();
      },

      'astro:server:setup': ({ server, logger }) => {
        if (!active) return;

        // The one seam every route reads options through. Per-request, so an
        // option changed in the Settings panel applies to the very next call.
        const optionsResolver = createOptionsResolver({
          root: projectRoot,
          configOptions: userOptions,
        });
        if (userOptions.composition ?? DEFAULTS.composition) {
          composition = createCompositionService({ root: projectRoot,
            resolve: async (specifier, importer) => (await server.pluginContainer.resolveId(specifier, importer, { ssr: true }))?.id ?? null });
        }

        // Vite dev middleware exposes the edit API under /__dev-edit/. (spec §4.3)
        server.middlewares.use(
          createMiddleware({
            logger,
            root: projectRoot,
            publicDir,
            optionsResolver,
            composition,
            // Always constructed: the array is simply empty until the routes
            // hook has fired, and the route then answers an explicit refusal
            // rather than guessing at a file.
            routeManifest: createRouteManifest({
              root: projectRoot,
              base,
              routes: () => resolvedRoutes,
            }),
          }),
        );

      },
    },
  };
}

/**
 * Warn when a *configured* upload directory cannot work, at startup where the
 * user will see it.
 *
 * Uploads become a literal `<img src>` in the source, so anything outside
 * `public/` is served by Vite in dev but absent from a production build and the
 * reference 404s once deployed. The mirror-image rule holds for `image()`
 * fields: Astro imports those assets through Vite, and `public/` files are
 * copied verbatim rather than importable, so a `public/` target fails the
 * collection's own schema.
 */
function warnAboutUploadDirs(
  projectRoot: string,
  publicDir: string,
  userOptions: DevEditOptions,
  logger: { warn(message: string): void },
): void {
  const uploadDir = userOptions.uploadDir;
  if (uploadDir !== undefined) {
    const rel = relative(projectRoot, resolve(projectRoot, uploadDir));
    const pub = relative(projectRoot, resolve(projectRoot, publicDir));
    if (!(rel === pub || rel.startsWith(pub + sep))) {
      logger.warn(
        `uploadDir "${uploadDir}" is not under ${publicDir}/ — uploaded images ` +
          'are served in dev but will 404 in a production build. Point uploadDir ' +
          `at a folder under ${publicDir}/.`,
      );
    }
  }

  const imageUploadDir = userOptions.imageUploadDir;
  if (imageUploadDir !== undefined) {
    const rel = relative(projectRoot, resolve(projectRoot, imageUploadDir));
    if (!(rel === 'src' || rel.startsWith('src' + sep))) {
      logger.warn(
        `imageUploadDir "${imageUploadDir}" is not under src/ — Astro cannot ` +
          'import assets from there for an image() schema field, so uploads to ' +
          'it will fail the collection schema. Point imageUploadDir at a folder ' +
          'under src/.',
      );
    }
  }
}
