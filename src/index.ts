import type { AstroIntegration } from 'astro';
import { fileURLToPath } from 'node:url';
import { createMiddleware } from './middleware.ts';

/**
 * astro-text-edit — in-browser visual content editing for the local dev server.
 *
 * Click-to-edit for literal text and static img src/alt in .astro templates:
 * the client confirms each target against the server-side AST classification,
 * and commits patch the source file directly (verified, atomic). Markdown/MDX
 * body editing and expression-following are not built yet (spec §16.4/§16.5).
 *
 * Dev-only. The integration registers nothing for builds, so it can never reach
 * the Netlify production bundle. See spec §8.
 */

export interface TextEditOptions {
  /** Kill switch. When false the integration does nothing at all. */
  enabled?: boolean;
  /** Directories scanned for replacement images; uploads go to the first. */
  assetDirs?: string[];
  /** Extensions the patcher is allowed to write. */
  editableExtensions?: string[];
  /** Directories that writes are confined to. */
  contentRoots?: string[];
  /** Expose the click-to-source fallback. */
  openInEditor?: boolean;
}

const DEFAULTS: Required<TextEditOptions> = {
  enabled: true,
  assetDirs: ['src/assets', 'public'],
  editableExtensions: ['.astro', '.md', '.mdx'],
  contentRoots: ['src', 'public'],
  openInEditor: true,
};

export default function textEdit(userOptions: TextEditOptions = {}): AstroIntegration {
  const options = { ...DEFAULTS, ...userOptions };

  // Captured in config:setup, consumed in server:setup. Only set when we're
  // actually running in dev with the integration enabled.
  let active = false;
  let projectRoot = '';

  return {
    name: 'astro-text-edit',
    hooks: {
      'astro:config:setup': ({ command, config, injectScript, logger }) => {
        // Dev server only. Bail for `astro build` / `astro preview` so nothing
        // ships to production. (spec §4.1, §8)
        if (command !== 'dev') return;
        if (!options.enabled) {
          logger.info('disabled via options.enabled — skipping');
          return;
        }
        active = true;
        projectRoot = fileURLToPath(config.root);

        // The whole feature rides on `data-astro-source-file` / `-loc`
        // attributes, which Astro only emits when the dev toolbar is enabled.
        // If it's off, hover highlight and (later) click-to-edit silently find
        // nothing. Fail loud rather than mysteriously do nothing. (preflight)
        const toolbarEnabled = config.devToolbar?.enabled ?? true;
        if (!toolbarEnabled) {
          logger.warn(
            'the Astro dev toolbar is DISABLED, so no data-astro-source-* ' +
              'attributes are emitted. astro-text-edit needs them to locate ' +
              'editable elements and will find nothing. Re-enable the dev ' +
              'toolbar (devToolbar.enabled) to use text-edit.',
          );
        }

        // Injected on every page. `overlay.ts` is compiled by Vite because the
        // injected code imports it by absolute path. (spec §4.1)
        const overlayUrl = new URL('./client/overlay.ts', import.meta.url);
        injectScript(
          'page',
          `import ${JSON.stringify(fileURLToPath(overlayUrl))};`,
        );

        logger.info('edit mode available — toggle from the button in the page corner');
      },

      'astro:server:setup': ({ server, logger }) => {
        if (!active) return;
        // Vite dev middleware exposes the edit API under /__text-edit/. (spec §4.3)
        server.middlewares.use(
          createMiddleware({
            logger,
            root: projectRoot,
            assetDirs: options.assetDirs,
            contentRoots: options.contentRoots,
            editableExtensions: options.editableExtensions,
            openInEditor: options.openInEditor,
          }),
        );
      },
    },
  };
}
