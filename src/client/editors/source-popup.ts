import { icon } from '../icons.ts';
import type { Interaction } from '../state.ts';
import * as state from '../state.ts';
import { mount } from '../shadow.ts';
import {
  inputEl,
  buildBackdrop,
  buildPanel,
  pillButton,
  styled,
  wirePanelButtons,
} from '../ui.ts';

/**
 * The panel shape shared by every editor that edits *source* rather than
 * rendered text — the markup popup and the traced-expression popup. Inline
 * contenteditable can't serve either: one would escape the tags, the other
 * would rewrite the template instead of the string behind it.
 *
 * What this owns, so its callers don't each re-implement it:
 *
 * - panel + backdrop + the interaction token, released exactly once;
 * - the dirty flag the admin bar's exit button reads;
 * - Cmd/Ctrl+Enter to save (plain Enter stays a newline — a panel has a Save
 *   button, unlike an inline edit);
 * - **staying open when a save is refused.** A refusal here is an ordinary
 *   outcome — a disallowed tag, an ambiguous match — that the user fixes and
 *   retries, so the reason is shown inside the panel with the text intact
 *   rather than closing and losing the work.
 */

export interface SourcePopupOptions {
  /** Panel title bar, e.g. `Markup · index.astro:44:13`. */
  title: string;
  /** Label above the box. */
  label: string;
  /** Initial (and baseline) text. */
  value: string;
  /** Minimum height of the editing box. */
  minHeight?: string;
  /** Monospace box (source) rather than proportional (prose). */
  mono?: boolean;
  /** Optional controls under the box, built with the live textarea. */
  tools?: (input: HTMLTextAreaElement, markDirty: () => void) => HTMLElement;
  /**
   * Write the edit. Resolve `null` on success — the panel then closes — or the
   * message to show inside the still-open panel.
   */
  save: (value: string) => Promise<string | null>;
  /**
   * Jump to the source in the user's editor. Adds an **open** button to the
   * title bar: what these popups edit *is* source, so the file it came from
   * should be one click away — the same escape hatch the hover pill and the
   * refusal notice offer. Editing continues; the panel stays open.
   */
  openSource?: () => void;
}

export function openSourcePopup(opts: SourcePopupOptions): void {
  let jump: HTMLElement | undefined;
  if (opts.openSource) {
    const btn = pillButton(
      'atx-panel-open',
      'open',
      'Open this location in your editor',
      { marginLeft: '0', flex: '0 0 auto' },
      icon('external', 12),
    );
    btn.addEventListener('click', () => opts.openSource?.());
    jump = btn;
  }

  const panel = buildPanel(opts.title, jump);
  const body = panel.querySelector('[data-body]') as HTMLElement;

  const label = styled('label', 'atx-popup-label');
  label.textContent = opts.label;

  // Only the caller's height override stays inline; the face is a flag, since
  // both faces are fixed and only the choice between them is the caller's.
  const input = inputEl(
    'textarea',
    'atx-popup-input',
    opts.minHeight ? { minHeight: opts.minHeight } : undefined,
  );
  if (opts.mono) input.dataset.mono = '';
  input.value = opts.value;

  const error = styled('p', 'atx-popup-error');

  const markDirty = (): void => {
    state.setSavePhase(input.value.trim() === opts.value.trim() ? 'clean' : 'dirty');
  };

  body.append(label, input);
  if (opts.tools) body.append(opts.tools(input, markDirty));
  body.append(error);

  // `commit` is what leaving edit mode runs: an action labelled "Save & exit"
  // must write the draft in the box, not drop it. A refusal keeps the panel
  // open (see `run`), and the error phase keeps edit mode open with it.
  const claim = (): Interaction =>
    state.begin({ kind: 'panel', close: () => close(false), commit: () => close(true) });

  let token = claim();
  let saving = false;

  const teardown = (): void => {
    state.releaseIf(token);
    panel.remove();
    backdrop.remove();
  };

  const setBusy = (busy: boolean): void => {
    for (const btn of panel.querySelectorAll('button')) btn.disabled = busy;
    input.readOnly = busy;
  };

  const run = async (): Promise<void> => {
    saving = true;
    setBusy(true);
    error.toggleAttribute('data-on', false);

    const failure = await opts.save(input.value);

    saving = false;
    if (!failure) {
      teardown();
      return;
    }
    // The in-flight `busy` interaction released the slot; re-claim it so the
    // still-open panel keeps owning the page's clicks.
    token = claim();
    setBusy(false);
    error.textContent = failure;
    error.toggleAttribute('data-on', true);
    input.focus();
  };

  const close = (commit: boolean): void => {
    if (saving) return; // the write is in flight; let it settle
    if (!commit || input.value.trim() === opts.value.trim()) {
      teardown();
      state.setSavePhase('clean');
      return;
    }
    void run();
  };

  const backdrop = buildBackdrop(() => close(false));
  wirePanelButtons(panel, () => close(false), () => close(true));

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      close(true);
    }
  });
  input.addEventListener('input', markDirty);

  mount(backdrop, panel);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}
