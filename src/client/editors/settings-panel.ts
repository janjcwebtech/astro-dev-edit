import type { FieldDescriptor, OptionDescriptor, SettingsResponse } from '../../shared/protocol.ts';
import * as api from '../api.ts';
import { setFeatures } from '../features.ts';
import { clearHighlight } from '../hover.ts';
import { icon } from '../icons.ts';
import {
  COLOR,
  FONT,
  INPUT_STYLE,
  buildTabs,
  footButton,
  setButtonEnabled,
  styled,
  toast,
} from '../ui.ts';
import { openDrawer } from './drawer.ts';
import { applyFieldErrors, buildControl, collectChanges, type FieldControl } from './fields.ts';

/**
 * The Settings drawer — every integration option, editable in place.
 *
 * **The panel does not know what the options are.** `GET /settings` returns a
 * list of {@link OptionDescriptor}s — label, help, control type, current value,
 * provenance — and this module renders whatever arrives, grouped into tabs by
 * the `group` each one declares. Adding an option is one entry in the server's
 * `OPTION_SPECS` table and no client change at all. Each descriptor becomes a
 * synthesized {@link FieldDescriptor} so the controls come from the entry
 * editor's own `buildControl` registry rather than a parallel one.
 *
 * **`locked` is rendered, not hidden.** An option `astro.config.mjs` sets cannot
 * be changed from here, because config wins at resolve time. The control renders
 * disabled and says where the value came from — the same refusal this panel has
 * always made for a config-supplied Unsplash access key, now generalized to
 * every option. Hiding those rows would be worse: the user would wonder why the
 * option they can see in their config isn't listed.
 *
 * **The access key stays one-way.** It is never pre-filled — a read returns only
 * a masked hint — the input is `type="password"` with an explicit reveal, and the
 * value goes straight to the localhost-gated `/settings` endpoint. That POST is
 * the one moment the key crosses the wire in plaintext, unavoidable for a
 * paste-it-here UI and no worse than the `.env` alternative on a dev machine.
 */

const UNSPLASH_APPS_URL = 'https://unsplash.com/oauth/applications';

/** Where a resolved key came from, in words. */
const SOURCE_LABEL: Record<string, string> = {
  config: 'astro.config.mjs',
  env: 'the environment (.env or a shell variable)',
  file: '.astro-text-edit.json',
};

/** Tabs, in render order. A group with no options is dropped, so a server that
 *  predates a group simply shows fewer tabs. */
const GROUPS: ReadonlyArray<{ id: string; label: string; blurb: string }> = [
  {
    id: 'general',
    label: 'General',
    blurb: 'What the editor is allowed to touch, and how it finds your source.',
  },
  {
    id: 'editing',
    label: 'Editing',
    blurb: 'Which editing surfaces the overlay offers.',
  },
  {
    id: 'media',
    label: 'Media',
    blurb: 'Where images are read from, and where new ones are written.',
  },
  {
    id: 'unsplash',
    label: 'Unsplash',
    blurb: 'An optional photo source in the media picker.',
  },
];

export interface SettingsPanelOptions {
  /** Open on a particular tab. Used by the media modal's "no key configured"
   *  card, which wants the Unsplash tab specifically. */
  tab?: string;
  /** Stacking layer, when opened above something already raised — that same
   *  card opens this from the media modal's own layer. */
  layer?: number;
  /** Run after the drawer closes, whatever the outcome. */
  onClose?(): void;
}

export function openSettingsPanel(opts: SettingsPanelOptions = {}): void {
  clearHighlight();

  let controls: FieldControl[] = [];
  let current: SettingsResponse | null = null;
  let saving = false;
  /** Set once the key input has been typed into — the only dirty state the key
   *  field can report, since it never pre-fills. */
  const keyDirty = (): boolean => keyInput.value.trim().length > 0;

  const isDirty = (): boolean =>
    !saving && (keyDirty() || Object.keys(collectChanges(controls)).length > 0);

  const shell = openDrawer('Settings', {
    isDirty,
    discardMessage: 'Discard unsaved settings changes?',
    width: 'min(max(520px, 44vw), 94vw)',
    ...(opts.layer !== undefined ? { layer: opts.layer, restoreState: true } : {}),
    ...(opts.onClose ? { onClose: opts.onClose } : {}),
  });
  const { body, foot } = shell;

  // --- the option panes ------------------------------------------------------
  const panes = new Map<string, HTMLElement>();
  for (const g of GROUPS) {
    const pane = styled('div', `atx-settings-pane atx-settings-pane-${g.id}`, {
      paddingTop: '12px',
    });
    panes.set(g.id, pane);
  }

  const status = styled('p', 'atx-settings-status', {
    margin: '0 0 12px', font: '12px system-ui', display: 'flex', alignItems: 'center', gap: '6px',
  });

  const error = styled('p', 'atx-settings-error', {
    margin: '10px 0 0', font: '12px/1.5 system-ui', color: COLOR.warn, display: 'none',
  });

  // --- the Unsplash key section, which is not an option ----------------------
  const keySection = styled('div', 'atx-settings-key-section', {
    marginTop: '18px', paddingTop: '14px', borderTop: `1px solid ${COLOR.panelDivider}`,
  });

  const keyHeading = styled('h3', 'atx-settings-heading', {
    margin: '0 0 4px', font: '600 13px system-ui', color: '#eee',
  });
  keyHeading.textContent = 'Access key';

  const keyBlurb = styled('p', 'atx-settings-blurb', {
    margin: '0 0 12px', font: '12px/1.5 system-ui', color: COLOR.muted,
  });
  const appsLink = styled('a', 'atx-settings-link', { color: COLOR.accentText });
  appsLink.href = UNSPLASH_APPS_URL;
  appsLink.target = '_blank';
  appsLink.rel = 'noreferrer';
  appsLink.textContent = 'Create an application';
  keyBlurb.append(
    appsLink,
    document.createTextNode(' to get an access key — the demo tier allows 50 searches an hour.'),
  );

  const keyStatus = styled('p', 'atx-settings-key-status', {
    margin: '0 0 10px', font: '12px system-ui', display: 'flex', alignItems: 'center', gap: '6px',
  });

  const keyRow = styled('div', 'atx-settings-row', { display: 'flex', gap: '6px' });
  // No masked input exists anywhere else in the overlay, so this is built from
  // INPUT_STYLE rather than reused.
  const keyInput = styled('input', 'atx-settings-key', { ...INPUT_STYLE, flex: '1 1 auto' });
  keyInput.type = 'password';
  keyInput.autocomplete = 'off';
  keyInput.spellcheck = false;
  keyInput.placeholder = 'Paste your Unsplash access key';

  const reveal = footButton('Show', 'secondary', () => {
    const hidden = keyInput.type === 'password';
    keyInput.type = hidden ? 'text' : 'password';
    reveal.textContent = hidden ? 'Hide' : 'Show';
  });
  reveal.style.flex = '0 0 auto';
  keyRow.append(keyInput, reveal);

  const keyHint = styled('p', 'atx-settings-hint', {
    margin: '8px 0 0', font: '11px/1.5 system-ui', color: COLOR.muted,
  });

  const clearKeyBtn = footButton('Clear key', 'danger', () => void save({ clearKey: true }));
  clearKeyBtn.style.marginRight = '0';
  const keyActions = styled('div', 'atx-settings-key-actions', { marginTop: '10px' });
  keyActions.append(clearKeyBtn);

  keySection.append(keyHeading, keyBlurb, keyStatus, keyRow, keyHint, keyActions);

  const warning = styled('p', 'atx-settings-warning', {
    margin: '12px 0 0', font: '11px/1.5 system-ui', color: COLOR.warn, display: 'none',
  });

  const tabs = buildTabs(
    GROUPS.map((g) => ({ id: g.id, label: g.label, pane: panes.get(g.id)! })),
    { classPrefix: 'settings' },
  );
  body.append(status, tabs.strip, tabs.host, warning, error);

  // --- rendering the server's answer -----------------------------------------
  const paint = (data: SettingsResponse): void => {
    current = data;
    controls = [];
    status.textContent = '';

    const options = data.options ?? [];
    for (const g of GROUPS) {
      const pane = panes.get(g.id)!;
      pane.textContent = '';
      const mine = options.filter((o) => o.group === g.id);

      const blurb = styled('p', 'atx-settings-blurb', {
        margin: '0 0 14px', font: '12px/1.5 system-ui', color: COLOR.muted,
      });
      blurb.textContent = g.blurb;
      pane.append(blurb);

      for (const o of mine) {
        const control = buildControl(toFieldDescriptor(o), o.value);
        if (o.locked) control.root.append(lockNote(o));
        controls.push(control);
        pane.append(control.root);
      }

      // The access key belongs to the Unsplash tab but is not an option: it is
      // a secret with its own endpoint semantics and its own precedence.
      if (g.id === 'unsplash') pane.append(keySection);
    }

    paintKey(data);
    refreshFoot();
  };

  const paintKey = (data: SettingsResponse): void => {
    const u = data.unsplash;
    keyStatus.textContent = '';

    if (!u.enabled) {
      // The old dead end lived here: this used to read "add `unsplash: {}` to
      // astro.config.mjs, then restart the dev server". The toggle above is now
      // the answer, so point at it instead.
      keyStatus.append(
        icon('dot', 13),
        text('Turn the photo source on above to add a key', COLOR.muted),
      );
      keySection.style.opacity = '0.55';
      keyInput.disabled = true;
      setButtonEnabled(reveal, false);
      keyHint.textContent = '';
      clearKeyBtn.style.display = 'none';
      return;
    }

    keySection.style.opacity = '1';

    if (u.configured) {
      keyStatus.append(
        icon('check', 13),
        text(`Configured via ${SOURCE_LABEL[u.source ?? ''] ?? 'stored settings'}`, COLOR.ok),
      );
      if (u.hint) keyStatus.append(text(u.hint, COLOR.muted, true));
    } else {
      keyStatus.append(icon('dot', 13), text('Not configured', COLOR.muted));
    }

    // Config and env win at resolve time, so storing a key here would do
    // nothing. Say so instead of accepting it.
    const overridden = u.source === 'config' || u.source === 'env';
    keyInput.disabled = overridden;
    setButtonEnabled(reveal, !overridden);
    keyInput.placeholder = overridden
      ? 'Overridden — remove the other key first'
      : 'Paste your Unsplash access key';
    keyHint.textContent = overridden
      ? `A key from ${SOURCE_LABEL[u.source!]} takes precedence over anything stored here. ` +
        'Remove it to manage the key from this panel.'
      : 'Stored in .astro-text-edit.json at the project root, readable only by you (0600). ' +
        'It is never sent back to the browser.';
    clearKeyBtn.style.display = u.configured && u.source === 'file' ? '' : 'none';

    if (u.gitignoreWarning) {
      warning.textContent =
        '.astro-text-edit.json is not listed in this project’s .gitignore. Add it before ' +
        'saving a key, or the key can be committed. (This integration cannot edit your ' +
        'ignore rules for you.)';
      warning.style.display = '';
    } else {
      warning.style.display = 'none';
    }
  };

  const text = (value: string, color: string, mono = false): HTMLElement => {
    const el = styled('span', 'atx-settings-text', {
      color,
      font: mono ? `12px ${FONT.mono}` : '12px system-ui',
    });
    el.textContent = value;
    return el;
  };

  /** Why a control is disabled, under the control. */
  const lockNote = (o: OptionDescriptor): HTMLElement => {
    // Muted, not amber: an option the project set in its own config is a
    // normal state, and painting a third of the panel in warning colour would
    // spend the one colour that should mean "something is wrong" — which here
    // is the uncommitted-secret warning at the bottom.
    const note = styled('p', 'atx-settings-lock', {
      margin: '4px 0 0', font: '11px/1.45 system-ui', color: COLOR.muted,
      display: 'flex', alignItems: 'center', gap: '4px',
    });
    note.append(
      icon('lock', 11),
      document.createTextNode(
        o.restartRequired
          ? 'Read before the dev server starts, so it lives in astro.config.mjs and changing it needs a restart.'
          : 'Set in astro.config.mjs, which takes precedence. Remove it there to change it from here.',
      ),
    );
    return note;
  };

  /** Freeze the drawer during a write. Un-freezing defers to `refreshFoot`
   *  rather than blanket-enabling, so a control disabled *by state* stays
   *  that way. */
  const setBusy = (busy: boolean): void => {
    saving = busy;
    keyInput.readOnly = busy;
    for (const btn of shell.body.querySelectorAll('button')) setButtonEnabled(btn, !busy);
    for (const btn of foot.querySelectorAll('button')) setButtonEnabled(btn, !busy);
    if (!busy) {
      // Rebuilt by the paint that follows a successful save; on a failure this
      // restores the pre-save enablement.
      if (current) paintKey(current);
      refreshFoot();
    }
  };

  const showError = (message: string): void => {
    error.textContent = message;
    error.style.display = 'block';
  };

  const save = async (o: { clearKey?: boolean } = {}): Promise<void> => {
    error.style.display = 'none';
    applyFieldErrors(controls, {});

    const options = collectChanges(controls);
    const key = o.clearKey ? '' : keyInput.value;
    const sendKey = o.clearKey || key.trim().length > 0;
    if (Object.keys(options).length === 0 && !sendKey) {
      showError('Nothing has changed yet.');
      return;
    }

    setBusy(true);
    try {
      const next = await api.saveSettings({
        ...(Object.keys(options).length > 0 ? { options } : {}),
        ...(sendKey ? { unsplash: { accessKey: key } } : {}),
      });
      // Feature flags the overlay reads are option-derived, so a save repaints
      // the page's affordances without a reload.
      setFeatures({
        ok: true,
        name: 'astro-text-edit',
        milestone: 1,
        root: '',
        cssInspector: valueOf(next, 'cssInspector') === true,
        openInEditor: valueOf(next, 'openInEditor') === true,
        entryEditor: valueOf(next, 'entryEditor') === true,
        unsplash: next.unsplash.configured,
      });
      keyInput.value = '';
      keyInput.type = 'password';
      reveal.textContent = 'Show';
      paint(next);
      toast(
        o.clearKey ? 'Unsplash access key cleared' : 'Settings saved',
        'ok',
      );
    } catch (err) {
      if (err instanceof api.SettingsRefusal) {
        applyFieldErrors(controls, err.fieldErrors);
        showError(err.message);
      } else {
        showError(err instanceof Error ? err.message : 'Could not save.');
      }
    } finally {
      setBusy(false);
    }
  };

  // --- footer ----------------------------------------------------------------
  const closeBtn = footButton('Close', 'cancel', () => shell.close());
  const saveBtn = footButton('Save', 'primary', () => void save());
  foot.append(closeBtn, saveBtn);

  function refreshFoot(): void {
    setButtonEnabled(saveBtn, current !== null);
  }

  // --- boot ------------------------------------------------------------------
  status.append(icon('spinner', 13), text('Reading settings…', COLOR.muted));
  setButtonEnabled(saveBtn, false);
  clearKeyBtn.style.display = 'none';

  void api.getSettings().then(
    (data) => {
      paint(data);
      if (opts.tab) tabs.show(opts.tab);
    },
    (err: unknown) => {
      status.textContent = '';
      status.append(icon('alert', 13), text('Could not read settings', COLOR.warn));
      showError(err instanceof Error ? err.message : 'The dev server did not answer.');
    },
  );
}

/** An option, described as a field so `buildControl` can render it.
 *
 *  `present: true` and `required: false` throughout: an option always has an
 *  effective value (there is no "absent" state to hint a default for), and none
 *  of them can be cleared to nothing — `coerceOptionPatch` refuses an empty
 *  string or an empty list, so `collectChanges`' clear-to-null path is dead
 *  weight here rather than a hazard. */
function toFieldDescriptor(o: OptionDescriptor): FieldDescriptor {
  return {
    name: o.key,
    label: o.label,
    type: o.type,
    required: false,
    present: true,
    source: 'inferred',
    help: o.help,
    ...(o.choices ? { options: o.choices } : {}),
    ...(o.locked ? { readOnly: true } : {}),
  };
}

/** An option's value out of a response, by key. */
function valueOf(data: SettingsResponse, key: string): unknown {
  return data.options?.find((o) => o.key === key)?.value;
}
