import type { AstroIntegration } from 'astro';
import { createRequire } from 'node:module';
import { join, relative, resolve, sep } from 'node:path';
import { createAnnotatePlugin } from './server/annotate.ts';
import { createSchemaProvider } from './server/content-config.ts';
import { createMiddleware } from './server/middleware.ts';
import { createRouteManifest, type ResolvedRouteLike } from './server/route-manifest.ts';
import {
  createOptionsResolver,
  DEFAULTS,
  UNSPLASH_MAX_PER_PAGE,
  type TextEditOptions,
} from './server/options.ts';
import { resolveUnsplashKey } from './server/settings.ts';
import { fileURLToPath } from 'node:url';

/**
 * astro-text-edit — in-browser visual content editing for the local dev server.
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
 * read it. This file passes what the project actually wrote to `textEdit()`
 * through **unmerged**: `key in userOptions` is what tells the panel an option is
 * config-owned, and collapsing it into `DEFAULTS` here would erase exactly that.
 */

export type { TextEditOptions, UnsplashOptions, ResolvedOptions } from './server/options.ts';
export type { EntryEditorOptions, EntryFieldOverride } from './server/content-config.ts';

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

export default function textEdit(userOptions: TextEditOptions = {}): AstroIntegration {
  // Config-setup-time options only. Both are consumed before any dev server
  // exists — `sourceAnnotations` registers a Vite plugin — so neither can come
  // from the settings file, and both are reported to the panel as read-only.
  // `enabled` is additionally config-only because storing `false` there would
  // lock the user out of the UI that set it.
  const enabled = userOptions.enabled ?? DEFAULTS.enabled;
  const sourceAnnotations = userOptions.sourceAnnotations ?? DEFAULTS.sourceAnnotations;

  // Captured in config:setup, consumed in server:setup. Only set when we're
  // actually running in dev with the integration enabled.
  let active = false;
  let projectRoot = '';
  let base = '/';
  /** Astro's own route table, for "which file is this page written in". Replaced
   *  wholesale on every `astro:routes:resolved` and read through a thunk, never
   *  captured: the hook re-fires on any change under `srcDir`, so a page added
   *  mid-session has to be visible without a restart. */
  let resolvedRoutes: readonly ResolvedRouteLike[] = [];

  return {
    name: 'astro-text-edit',
    hooks: {
      'astro:config:setup': ({ command, config, injectScript, logger, updateConfig }) => {
        // Dev server only. Bail for `astro build` / `astro preview` so nothing
        // ships to production. (spec §4.1, §8)
        if (command !== 'dev') return;
        if (!enabled) {
          logger.info('disabled via options.enabled — skipping');
          return;
        }
        active = true;
        projectRoot = fileURLToPath(config.root);
        // Not normalized by Astro's schema — 'docs', '/docs' and '/docs/' are
        // all possible, and route-manifest.ts tolerates all three.
        base = config.base ?? '/';

        // Upload-directory preflight. Only warns about what the *config* says:
        // the panel enforces the same two rules on the value it stores, and a
        // startup warning about a value the user is about to change from the UI
        // would be noise.
        warnAboutUploadDirs(projectRoot, userOptions, logger);

        // The whole feature rides on `data-astro-source-file` / `-loc`
        // attributes. On Astro 5/6 the compiler emits them (dev toolbar on);
        // on Astro ≥7 the Rust compiler doesn't
        // (withastro/compiler-rs#96), so we inject them ourselves with a
        // pre-compiler Vite transform. Unresolvable version → inject too:
        // double annotation is harmless (identical values, browsers keep the
        // first), while missing annotation kills the feature.
        const astroMajor = detectAstroMajor(projectRoot);
        const selfAnnotate =
          sourceAnnotations === 'force' ||
          (sourceAnnotations === 'auto' && (astroMajor === null || astroMajor >= 7));
        if (selfAnnotate) {
          updateConfig({ vite: { plugins: [createAnnotatePlugin()] } });
          logger.info(
            `injecting data-astro-source-* annotations (` +
              (sourceAnnotations === 'force'
                ? 'sourceAnnotations: "force"'
                : `Astro ${astroMajor ?? 'unknown'} — its compiler does not emit them`) +
              ')',
          );
        }

        // Without self-annotation, only the dev toolbar makes Astro emit the
        // attributes. If it's off, hover highlight and click-to-edit silently
        // find nothing. Fail loud rather than mysteriously do nothing.
        const toolbarEnabled = config.devToolbar?.enabled ?? true;
        if (!toolbarEnabled && !selfAnnotate) {
          logger.warn(
            'the Astro dev toolbar is DISABLED, so no data-astro-source-* ' +
              'attributes are emitted. astro-text-edit needs them to locate ' +
              'editable elements and will find nothing. Re-enable the dev ' +
              'toolbar (devToolbar.enabled) or set sourceAnnotations: "force".',
          );
        }

        // Injected on every page. `overlay.ts` is compiled by Vite because the
        // injected code imports it by absolute path. (spec §4.1)
        const overlayUrl = new URL('./client/overlay.ts', import.meta.url);
        injectScript('page', `import ${JSON.stringify(fileURLToPath(overlayUrl))};`);

        logger.info('edit mode available — toggle it from the admin bar at the top of the page');
      },

      // Astro's answer to "which file is this route written in", which the DOM
      // cannot give: component tags carry no source annotation. This fires on
      // every add/unlink/change under srcDir, so the body is an assignment and
      // nothing else — no logging, no work per fire. The `active` guard is what
      // keeps the integration dev-only: it is set only by a dev config:setup.
      'astro:routes:resolved': ({ routes }: { routes: readonly ResolvedRouteLike[] }) => {
        if (!active) return;
        resolvedRoutes = routes;
      },

      'astro:server:setup': ({ server, logger }) => {
        if (!active) return;

        // The one seam every route reads options through. Per-request, so an
        // option changed in the Settings panel applies to the very next call.
        const optionsResolver = createOptionsResolver({
          root: projectRoot,
          configOptions: userOptions,
        });

        // Vite dev middleware exposes the edit API under /__text-edit/. (spec §4.3)
        server.middlewares.use(
          createMiddleware({
            logger,
            root: projectRoot,
            optionsResolver,
            // Always constructed: the entry editor can now be switched on from
            // the panel, so a provider built only when it started enabled would
            // leave the feature schema-less until the next restart. The routes
            // check the live gate themselves.
            schemaProvider: createSchemaProvider(server, projectRoot, async () => {
              const { options } = await optionsResolver.resolve();
              return options.entryEditor === false ? {} : options.entryEditor;
            }),
            // Always constructed, like schemaProvider: the array is simply
            // empty until the routes hook has fired, and the route then answers
            // an explicit refusal rather than guessing at a file.
            routeManifest: createRouteManifest({
              root: projectRoot,
              base,
              routes: () => resolvedRoutes,
            }),
            unsplash: {
              // Thunks, not values: both the key and the sub-options resolve
              // per request, so anything entered through the Settings panel
              // takes effect without a dev-server restart and nothing depends
              // on hook ordering.
              resolve: async () => {
                const { options } = await optionsResolver.resolve();
                const configKey =
                  options.unsplash === false ? undefined : options.unsplash.accessKey;
                return resolveUnsplashKey(projectRoot, configKey);
              },
              appName: async () => {
                const { options } = await optionsResolver.resolve();
                const o = options.unsplash;
                return (o === false ? '' : o.appName) || 'astro-text-edit';
              },
              perPage: async () => {
                const { options } = await optionsResolver.resolve();
                const o = options.unsplash;
                const raw = (o === false ? undefined : o.perPage) ?? 20;
                return Math.min(Math.max(1, Math.trunc(raw)), UNSPLASH_MAX_PER_PAGE);
              },
              enabled: async () => {
                const { options } = await optionsResolver.resolve();
                return options.unsplash !== false;
              },
            },
          }),
        );

        if (userOptions.unsplash) {
          if (userOptions.unsplash.accessKey) {
            logger.warn(
              'unsplash.accessKey is set in your Astro config. That file is ' +
                'committed and is read by `astro build`, so the key travels ' +
                'with the repo — prefer the overlay’s Settings panel or ' +
                'UNSPLASH_ACCESS_KEY.',
            );
          }
          logger.info(
            'Unsplash photo source enabled' +
              (userOptions.unsplash.accessKey
                ? ''
                : ' — add an access key from the admin bar’s Settings panel'),
          );
        }
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
  userOptions: TextEditOptions,
  logger: { warn(message: string): void },
): void {
  const uploadDir = userOptions.uploadDir;
  if (uploadDir !== undefined) {
    const rel = relative(projectRoot, resolve(projectRoot, uploadDir));
    if (!(rel === 'public' || rel.startsWith('public' + sep))) {
      logger.warn(
        `uploadDir "${uploadDir}" is not under public/ — uploaded images are ` +
          'served in dev but will 404 in a production build. Point uploadDir ' +
          'at a folder under public/.',
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
