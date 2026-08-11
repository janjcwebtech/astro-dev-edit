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

/**
 * Close whatever is open, *keeping* the user's work: a text edit commits
 * (writing to disk) instead of reverting; a panel still just closes, since it
 * owns its own Save button. The counterpart to `dismiss()` — leaving edit mode
 * must never silently discard typing, so the exit path goes through here.
 */
export function commit(): void {
  const interaction = current;
  current = null;
  if (!interaction) return;
  if (interaction.kind === 'panel') interaction.close();
  else if (interaction.kind === 'text') interaction.finish(true);
}

// --- Save phase --------------------------------------------------------------

/**
 * How the on-disk state of the page relates to what's on screen — the admin
 * bar's exit button renders this, so "are my changes saved?" is answerable at a
 * glance:
 *
 *   - 'clean'  — nothing pending; everything typed has been written
 *   - 'dirty'  — an inline edit has unsaved keystrokes in it
 *   - 'saving' — a write is in flight
 *   - 'saved'  — a write just landed (decays back to 'clean')
 *   - 'error'  — the last write failed and its change was rolled back
 *
 * It lives beside the interaction slot because the same editors drive both, but
 * it is deliberately *reported* rather than derived: only the editor knows
 * whether the keystrokes so far differ from the original, and only the commit
 * knows whether the server accepted them.
 */
export type SavePhase = 'clean' | 'dirty' | 'saving' | 'saved' | 'error';

/** How long 'saved' stays on screen before decaying to 'clean'. */
const SAVED_LINGER = 1400;

let phase: SavePhase = 'clean';
let decayTimer: number | null = null;
const phaseListeners = new Set<(p: SavePhase) => void>();

export function savePhase(): SavePhase {
  return phase;
}

/** Report a phase change. Repeats are dropped, so an editor may call this on
 *  every keystroke without waking any listener more than once. */
export function setSavePhase(next: SavePhase): void {
  if (next === phase) return;
  if (decayTimer !== null) {
    clearTimeout(decayTimer);
    decayTimer = null;
  }
  phase = next;
  for (const fn of phaseListeners) fn(phase);
  if (phase === 'saved') {
    decayTimer = window.setTimeout(() => {
      decayTimer = null;
      setSavePhase('clean');
    }, SAVED_LINGER);
  }
}

/** Subscribe to phase changes; returns an unsubscribe. */
export function onSavePhase(fn: (p: SavePhase) => void): () => void {
  phaseListeners.add(fn);
  return () => phaseListeners.delete(fn);
}
