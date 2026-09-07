/**
 * Launch the user's editor at a file spec — the one place the `launch-editor`
 * package is invoked, shared by the /open and /inspect/open routes.
 */

/** Spawn the editor for `spec` (an abs path, or "abs:line" / "abs:line:col"). */
export async function launchInEditor(spec: string, onError?: () => void): Promise<void> {
  // launch-editor is CommonJS: the module IS the function. Interop may wrap it
  // under .default depending on the loader, so handle both.
  const mod = (await import('launch-editor')) as unknown as
    | ((f: string, onError?: () => void) => void)
    | { default: (f: string, onError?: () => void) => void };
  const launch = typeof mod === 'function' ? mod : mod.default;
  launch(spec, onError);
}
