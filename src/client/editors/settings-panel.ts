import type { SettingsResponse } from '../../shared/protocol.ts';
import * as api from '../api.ts';
import { updateFeature } from '../features.ts';
import { clearHighlight } from '../hover.ts';
import { icon } from '../icons.ts';
import * as state from '../state.ts';
import {
  COLOR,
  FONT,
  INPUT_STYLE,
  buildBackdrop,
  buildPanel,
  footButton,
  setButtonEnabled,
  styled,
  toast,
} from '../ui.ts';

/**
 * Integration settings, opened from the admin bar's overflow menu. Today that
 * means one thing: the Unsplash access key.
 *
 * The key is a secret, so this panel is deliberately one-way. It **never**
 * pre-fills from the server — a read returns only a masked hint — the input is
 * `type="password"` with an explicit reveal, and the value goes straight to the
 * localhost-gated `/settings` endpoint. That POST is the one moment the key
 * crosses the wire in plaintext, which is unavoidable for a paste-it-here UI and
 * no worse than the `.env` alternative on a dev machine.
 *
 * When the key comes from the Astro config or the environment, the field is
 * disabled and says so: silently accepting a value that resolution would ignore
 * is worse than refusing it.
 */

const UNSPLASH_APPS_URL = 'https://unsplash.com/oauth/applications';

/** Where a resolved key came from, in words. */
const SOURCE_LABEL: Record<string, string> = {
  config: 'astro.config.mjs',
  env: 'the environment (.env or a shell variable)',
  file: '.astro-text-edit.json',
};

export interface SettingsPanelOptions {
  /** Stacking layer, when opened above something that is already raised — the
   *  media modal's "no key configured" card opens this from `Z+8`. */
  layer?: number;
  /** Run after the panel closes, whatever the outcome. Lets the Unsplash pane
   *  re-run its search once a key has been entered. */
  onClose?(): void;
}

export function openSettingsPanel(opts: SettingsPanelOptions = {}): void {
  clearHighlight();

  const layer = opts.layer ?? 6;
  const panel = buildPanel('Settings', undefined, { width: 'min(520px, 92vw)', layer });
  const body = panel.querySelector('[data-body]') as HTMLElement;
  const foot = panel.querySelector('[data-foot]') as HTMLElement;

  let saving = false;
  // This can open from the media modal's "no key configured" card, so the slot
  // is handed back rather than cleared — see state.ts::releaseTo.
  const heldBefore = state.get();
  let token = state.begin({ kind: 'panel', close: () => close() });

  const close = (): void => {
    if (saving) return; // the write is in flight; let it settle
    state.releaseTo(token, heldBefore);
    panel.remove();
    backdrop.remove();
    opts.onClose?.();
  };
  const backdrop = buildBackdrop(close, layer - 1);

  // --- Unsplash section ------------------------------------------------------
  const heading = styled('h3', 'atx-settings-heading', {
    margin: '0 0 4px', font: '600 13px system-ui', color: '#eee',
  });
  heading.textContent = 'Unsplash photo source';

  const blurb = styled('p', 'atx-settings-blurb', {
    margin: '0 0 12px', font: '12px/1.5 system-ui', color: COLOR.muted,
  });
  blurb.append(
    document.createTextNode('Search Unsplash from the media picker and import a photo straight into this project. '),
  );
  const appsLink = styled('a', 'atx-settings-link', { color: COLOR.accentText });
  appsLink.href = UNSPLASH_APPS_URL;
  appsLink.target = '_blank';
  appsLink.rel = 'noreferrer';
  appsLink.textContent = 'Create an application';
  blurb.append(appsLink, document.createTextNode(' to get an access key — the demo tier allows 50 searches an hour.'));

  const status = styled('p', 'atx-settings-status', {
    margin: '0 0 12px', font: '12px system-ui', display: 'flex', alignItems: 'center', gap: '6px',
  });

  const label = styled('label', 'atx-settings-label', {
    display: 'block', font: '600 12px system-ui', color: '#bbb', margin: '0 0 6px',
  });
  label.textContent = 'Access key';

  const row = styled('div', 'atx-settings-row', { display: 'flex', gap: '6px' });
  // No masked input exists anywhere else in the overlay, so this is built from
  // INPUT_STYLE rather than reused.
  const input = styled('input', 'atx-settings-key', { ...INPUT_STYLE, flex: '1 1 auto' });
  input.type = 'password';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = 'Paste your Unsplash access key';

  const reveal = footButton('Show', 'secondary', () => {
    const hidden = input.type === 'password';
    input.type = hidden ? 'text' : 'password';
    reveal.textContent = hidden ? 'Hide' : 'Show';
  });
  reveal.style.flex = '0 0 auto';
  row.append(input, reveal);

  const hint = styled('p', 'atx-settings-hint', {
    margin: '8px 0 0', font: '11px/1.5 system-ui', color: COLOR.muted,
  });

  const warning = styled('p', 'atx-settings-warning', {
    margin: '10px 0 0', font: '11px/1.5 system-ui', color: COLOR.warn, display: 'none',
  });

  const error = styled('p', 'atx-settings-error', {
    margin: '10px 0 0', font: '12px/1.5 system-ui', color: COLOR.warn, display: 'none',
  });

  body.append(heading, blurb, status, label, row, hint, warning, error);

  // --- rendering the server's answer -----------------------------------------
  let current: SettingsResponse | null = null;

  const paint = (data: SettingsResponse): void => {
    current = data;
    const u = data.unsplash;
    status.textContent = '';

    if (!u.enabled) {
      status.append(icon('alert', 13), text('Not enabled in this project', COLOR.warn));
      hint.textContent =
        'Add `unsplash: {}` to the astro-text-edit options in astro.config.mjs, then restart the dev server.';
      input.disabled = true;
      setButtonEnabled(reveal, false);
      warning.style.display = 'none';
      refreshFoot();
      return;
    }

    if (u.configured) {
      status.append(
        icon('check', 13),
        text(`Configured via ${SOURCE_LABEL[u.source ?? ''] ?? 'stored settings'}`, COLOR.ok),
      );
      if (u.hint) status.append(text(u.hint, COLOR.muted, true));
    } else {
      status.append(icon('dot', 13), text('Not configured', COLOR.muted));
    }

    // Config and env win at resolve time, so storing a key here would do
    // nothing. Say so instead of accepting it.
    const overridden = u.source === 'config' || u.source === 'env';
    input.disabled = overridden;
    setButtonEnabled(reveal, !overridden);
    input.placeholder = overridden
      ? 'Overridden — remove the other key first'
      : 'Paste your Unsplash access key';
    hint.textContent = overridden
      ? `A key from ${SOURCE_LABEL[u.source!]} takes precedence over anything stored here. ` +
        'Remove it to manage the key from this panel.'
      : 'Stored in .astro-text-edit.json at the project root, readable only by you (0600). ' +
        'It is never sent back to the browser.';

    if (u.gitignoreWarning) {
      warning.textContent =
        '.astro-text-edit.json is not listed in this project’s .gitignore. Add it before ' +
        'saving a key, or the key can be committed. (This integration cannot edit your ' +
        'ignore rules for you.)';
      warning.style.display = '';
    } else {
      warning.style.display = 'none';
    }

    refreshFoot();
  };

  const text = (value: string, color: string, mono = false): HTMLElement => {
    const el = styled('span', 'atx-settings-text', {
      color,
      font: mono ? `12px ${FONT.mono}` : '12px system-ui',
    });
    el.textContent = value;
    return el;
  };

  /** Freeze the panel during a write. Un-freezing defers to `refreshFoot`
   *  rather than blanket-enabling, so a button that is disabled *by state*
   *  (Save, when the key is overridden) stays that way. */
  const setBusy = (busy: boolean): void => {
    saving = busy;
    input.readOnly = busy;
    if (busy) {
      for (const btn of panel.querySelectorAll('button')) setButtonEnabled(btn, false);
      return;
    }
    for (const btn of panel.querySelectorAll('button')) setButtonEnabled(btn, true);
    refreshFoot();
  };

  const showError = (message: string): void => {
    error.textContent = message;
    error.style.display = '';
  };

  const save = async (value: string): Promise<void> => {
    error.style.display = 'none';
    setBusy(true);
    try {
      const next = await api.saveSettings({ unsplash: { accessKey: value } });
      // The Unsplash tab appears (or vanishes) without a page reload.
      updateFeature('unsplash', next.unsplash.configured);
      input.value = '';
      input.type = 'password';
      reveal.textContent = 'Show';
      paint(next);
      toast(value.trim() ? 'Unsplash access key saved' : 'Unsplash access key cleared', 'ok');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not save the key.');
    } finally {
      setBusy(false);
      // The in-flight `busy` interaction released the slot; re-claim it so the
      // still-open panel keeps owning the page's clicks.
      token = state.begin({ kind: 'panel', close: () => close() });
    }
  };

  // --- footer ----------------------------------------------------------------
  const clearBtn = footButton('Clear', 'danger', () => void save(''));
  const closeBtn = footButton('Close', 'cancel', close);
  const saveBtn = footButton('Save key', 'primary', () => {
    if (!input.value.trim()) {
      showError('Paste a key first, or use Clear to remove the stored one.');
      return;
    }
    void save(input.value);
  });
  foot.append(clearBtn, closeBtn, saveBtn);

  /** Clear only means something when this panel is what stored the key. */
  function refreshFoot(): void {
    const u = current?.unsplash;
    const stored = u?.configured === true && u.source === 'file';
    clearBtn.style.display = stored ? '' : 'none';
    setButtonEnabled(saveBtn, Boolean(u?.enabled) && u!.source !== 'config' && u!.source !== 'env');
  }

  // --- boot ------------------------------------------------------------------
  status.append(icon('spinner', 13), text('Reading settings…', COLOR.muted));
  setButtonEnabled(saveBtn, false);
  clearBtn.style.display = 'none';

  void api.getSettings().then(
    (data) => paint(data),
    (err: unknown) => {
      status.textContent = '';
      status.append(icon('alert', 13), text('Could not read settings', COLOR.warn));
      showError(err instanceof Error ? err.message : 'The dev server did not answer.');
    },
  );

  document.body.append(backdrop, panel);
  requestAnimationFrame(() => input.focus());
}
