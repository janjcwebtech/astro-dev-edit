import type { AstroIntegrationLogger } from 'astro';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { InspectOpenRequest } from '../shared/protocol.ts';
import { launchInEditor } from './editor.ts';
import { locateSelector } from './inspect-locate.ts';
import type { OptionsResolver } from './options.ts';
import { checkEditablePath } from './paths.ts';
import type { Route } from './router.ts';

/**
 * The CSS-inspector route group (/inspect/open) — the "open this rule in my
 * editor" jump for the hover-pill class/ID inspector. A feature route module:
 * it exports a `Route[]` the middleware concatenates, keeping middleware.ts a
 * thin composition point.
 *
 * The inspector's *display* is entirely client-side (it reads document.style-
 * Sheets), so this is the only server surface it needs: best-effort locate the
 * selector in its source file, then launch the editor there. Read-only — no
 * writes ever pass through here.
 */

export interface InspectRouteDeps {
  logger: AstroIntegrationLogger;
  /** Project root (fsPath). Every served path is confined to this. */
  root: string;
  /** Live options — `cssInspector` gates the group, `openInEditor` gates the
   *  editor launch, and both can change without a dev-server restart. */
  optionsResolver: OptionsResolver;
}

export function createInspectRoutes(deps: InspectRouteDeps): Route[] {
  const { root, optionsResolver } = deps;

  // A rule's source is commonly a .css file, which is never in the write-side
  // editableExtensions. Broaden the *open* allowlist with .css only — the rest
  // of the gate (realpath ∈ root ∈ contentRoots) is unchanged, so node_modules
  // and external stylesheets are still excluded. (spec §8)
  const openableExtensions = (editableExtensions: string[]): string[] =>
    editableExtensions.includes('.css') ? editableExtensions : [...editableExtensions, '.css'];

  // A rule's file arrives as the stylesheet URL's path. URLs under the public
  // dir have that segment stripped (Astro serves `public/foo.css` at
  // `/foo.css`), so a bare `styles/global.css` won't resolve on disk — retry it
  // under `public/`. Absolute paths (Vite's `data-vite-dev-id`) resolve on the
  // first candidate. First path that clears the gate wins. (spec §8)
  async function resolveOpenable(
    file: string,
    contentRoots: string[],
    openable: string[],
  ): Promise<string> {
    const candidates = file.startsWith('public/') ? [file] : [file, `public/${file}`];
    let lastReason = `no such file: ${file}`;
    for (const cand of candidates) {
      const check = await checkEditablePath(root, contentRoots, openable, cand);
      if (check.ok) return check.abs;
      lastReason = check.reason;
    }
    throw new Error(lastReason);
  }

  return [
    // Best-effort jump to a CSS rule's source line, then launch the editor.
    {
      method: 'POST',
      path: '/inspect/open',
      maxBytes: 64 * 1024,
      label: 'inspect-open',
      fallback: 'open failed',
      handler: async (body) => {
        const { options } = await optionsResolver.resolve();
        if (!options.cssInspector) {
          return { status: 403, body: { error: 'the CSS inspector is disabled by configuration' } };
        }
        if (!options.openInEditor) {
          return { status: 403, body: { error: 'open-in-editor is disabled by configuration' } };
        }
        const { file, selector } = body as InspectOpenRequest;
        if (!file || !selector) throw new Error('file and selector are required');
        const abs = await resolveOpenable(
          file,
          options.contentRoots,
          openableExtensions(options.editableExtensions),
        );
        const source = await readFile(abs, 'utf8');
        const hit = locateSelector(source, selector, extname(abs).toLowerCase() === '.astro');
        const loc = hit ? `${hit.line}:${hit.col}` : null;
        await launchInEditor(loc ? `${abs}:${loc}` : abs);
        return { status: 200, body: { ok: true, loc } };
      },
    },
  ];
}
