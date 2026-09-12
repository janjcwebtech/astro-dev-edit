/**
 * Launch the user's editor at a file spec — the one place the `launch-editor`
 * package is invoked, shared by the /open and /inspect/open routes.
 *
 * **The import is static on purpose.** The package exports `src/index.ts`, and
 * Node refuses to strip types under `node_modules`, so a consuming project's
 * config falls out of Astro's native-import path into `loadConfigWithVite` —
 * a minimal Vite dev server whose module runner is closed the moment the
 * config has loaded. Every module here was evaluated inside that runner, so a
 * deferred `await import()` is still routed through it and throws "Vite module
 * runner has been closed." at request time. A top-level import resolves while
 * the runner is alive and its binding outlives the close.
 */

import launchEditor from 'launch-editor';

/** Spawn the editor for `spec` (an abs path, or "abs:line" / "abs:line:col"). */
export async function launchInEditor(spec: string, onError?: () => void): Promise<void> {
  // launch-editor is CommonJS: the module IS the function. Interop may wrap it
  // under .default depending on the loader, so handle both.
  const mod = launchEditor as unknown as
    | ((f: string, onError?: () => void) => void)
    | { default: (f: string, onError?: () => void) => void };
  const launch = typeof mod === 'function' ? mod : mod.default;
  launch(spec, onError);
}
