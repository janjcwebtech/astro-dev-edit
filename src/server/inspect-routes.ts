import type { AstroIntegrationLogger } from 'astro';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type {
  InspectOpenRequest, VariableTagRefusal, VariableTagRequest, VariableTagResponse,
} from '../shared/protocol.ts';
import { launchInEditor } from './editor.ts';
import { locateSelector, resolveVariableTag, type VariableTagProof } from './inspect-locate.ts';
import type { OptionsResolver } from './options.ts';
import { checkEditablePath, isPackageOwned } from './paths.ts';
import type { Route } from './router.ts';

/**
 * The inspector's locate routes. A feature route module: it exports a
 * `Route[]` the middleware concatenates, keeping middleware.ts a thin
 * composition point. Read-only — no writes ever pass through here.
 *
 * - `/inspect/open` — the "open this rule in my editor" jump for the CSS
 *   inspector. Its *display* is client-side (it reads document.styleSheets),
 *   so the server only best-effort locates the selector and launches the
 *   editor. Gated by `cssInspector`.
 * - `/inspect/tag` — where an unannotated element is written, proven from the
 *   annotated elements directly inside it (issue #82). Gated by `composition`,
 *   the option that turns the inspector panel on.
 */

export interface InspectRouteDeps {
  logger: AstroIntegrationLogger;
  /** Project root (fsPath). Every served path is confined to this. */
  root: string;
  /** Live options — `cssInspector` gates `/inspect/open`, `openInEditor` its
   *  editor launch, `composition` gates `/inspect/tag`, and all of them can
   *  change without a dev-server restart. */
  optionsResolver: OptionsResolver;
}

/** How far a child's proof got before it refused. When several children
 *  refuse, the furthest one says the most about the element. */
const PROGRESS: VariableTagRefusal[] = ['unresolved', 'not-a-wrapper', 'not-literal', 'tag-mismatch'];
const TAG = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_CHILDREN = 16;

/** The request as sent, or null when it is not one. */
function variableTagRequestOf(body: unknown): VariableTagRequest | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { tag, children } = body as Record<string, unknown>;
  if (typeof tag !== 'string' || !TAG.test(tag)) return null;
  if (!Array.isArray(children) || !children.length || children.length > MAX_CHILDREN) return null;
  for (const child of children as unknown[]) {
    if (!child || typeof child !== 'object') return null;
    const { file, loc, tag: childTag } = child as Record<string, unknown>;
    if (typeof file !== 'string' || !file || file.length > 4096) return null;
    if (typeof loc !== 'string' || !/^\d{1,7}:\d{1,7}$/.test(loc)) return null;
    if (typeof childTag !== 'string' || !TAG.test(childTag)) return null;
  }
  return { tag, children: children as VariableTagRequest['children'] };
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

    // Every child is tried, because the first may be another component's root.
    // All proofs must name one node: a DOM element is rendered by exactly one,
    // so two different answers mean one of them is wrong, and neither is sent.
    {
      method: 'POST',
      path: '/inspect/tag',
      maxBytes: 64 * 1024,
      label: 'inspect-tag',
      handler: async (body) => {
        const answer = (value: VariableTagResponse) => ({ status: 200, body: value });
        const { options } = await optionsResolver.resolve();
        const req = variableTagRequestOf(body);
        if (!req) throw new Error(`tag and 1–${MAX_CHILDREN} annotated children ({file, loc, tag}) are required`);
        const sources = new Map<string, Promise<string>>();
        const proofs: { child: number; file: string; proof: Extract<VariableTagProof, { ok: true }> }[] = [];
        let furthest = 0;
        for (const [child, { file, loc, tag }] of req.children.entries()) {
          // The same gate as every client-supplied path (rule 3). A package's
          // own file — an astro:assets <Image> — is not the user's to name.
          const check = await checkEditablePath(root, options.contentRoots, ['.astro'], file);
          if (!check.ok || isPackageOwned(check.abs)) continue;
          if (!sources.has(check.abs)) sources.set(check.abs, readFile(check.abs, 'utf8'));
          const proof = await resolveVariableTag(await sources.get(check.abs)!, { loc, tag }, req.tag);
          if (proof.ok) proofs.push({ child, file, proof });
          else furthest = Math.max(furthest, PROGRESS.indexOf(proof.reason));
        }
        if (!proofs.length) return answer({ ok: false, reason: PROGRESS[furthest] });
        const [first] = proofs;
        if (proofs.some(p => p.file !== first.file || p.proof.loc !== first.proof.loc)) {
          return answer({ ok: false, reason: 'ambiguous' });
        }
        return answer({ ok: true, child: first.child, source: { file: first.file, loc: first.proof.loc },
          name: first.proof.name, tags: first.proof.tags });
      },
    },
  ];
}
