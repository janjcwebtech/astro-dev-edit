/**
 * Interaction state controller — the single slot for "what editing
 * interaction is open right now". Replaces the trio of coordinated flags
 * (editingActive / activeCloser / activeTextFinish) whose invariants every
 * editor had to re-implement.
 *
 * Exactly one interaction can be active:
 *   - 'busy'  — a /classify round-trip or a save is in flight; clicks are
 *               ignored until it settles.
 *   - 'text'  — an inline contenteditable edit; `finish(commit)` commits or
 *               cancels it (cancel restores the original text).
 *   - 'panel' — a modal panel (image swap / refusal notice); `close()` tears
 *               it down without committing.
 *
 * The token pattern makes async completion safe: `begin()` returns the
 * interaction as a token, and `releaseIf(token)` only frees the slot if that
 * token still owns it — a commit (or a click-to-re-target) may have started a
 * NEW interaction by the time the previous async save settles. A new editor
 * kind is one `begin()` call; there are no flags to keep consistent.
 */

export type Interaction =
  | { kind: 'busy' }
  | { kind: 'text'; finish(commit: boolean): void }
  | { kind: 'panel'; close(): void };

let current: Interaction | null = null;

/** The open interaction, or null when idle. */
export function get(): Interaction | null {
  return current;
}

/** Claim the slot (replacing whatever held it). Returns the token to release with. */
export function begin(interaction: Interaction): Interaction {
  current = interaction;
  return interaction;
}

/** Free the slot — but only if `token` still owns it. */
export function releaseIf(token: Interaction): void {
  if (current === token) current = null;
}

/**
 * Tear down whatever is open: a panel closes, a text edit cancels (restoring
 * the original text), a busy marker is simply dropped. The slot is cleared
 * BEFORE the teardown runs, so closers that release their own token can't
 * re-enter.
 */
export function dismiss(): void {
  const interaction = current;
  current = null;
  if (!interaction) return;
  if (interaction.kind === 'panel') interaction.close();
  else if (interaction.kind === 'text') interaction.finish(false);
}
