import type { OptionDescriptor, SettingsResponse } from '../../shared/protocol.ts';
import * as api from '../api.ts';
import { setFeatures } from '../features.ts';
import { clearHighlight } from '../hover.ts';
import { icon } from '../icons.ts';
import { buildTabs, footButton, setButtonEnabled, styled, toast } from '../ui.ts';
import { card, fieldGroup } from '../group.ts';
import { openDrawer } from './drawer.ts';
import {
  applyFieldErrors,
  buildControl,
  collectChanges,
  type FieldControl,
  type FieldDescriptor,
} from './fields.ts';

/**
 * The Settings drawer — every integration option, editable in place.
 *
 * **The panel does not know what the options are.** `GET /settings` returns a
 * list of {@link OptionDescriptor}s — label, help, control type, current value,
 * provenance — and this module renders whatever arrives, grouped into tabs by
 * the `group` each one declares. Adding an option is one entry in the server's
 * `OPTION_SPECS` table and no client change at all. Each descriptor becomes a
 * {@link FieldDescriptor} so the controls come from `buildControl`'s registry
 * rather than a parallel one.
 *
 * **`locked` is rendered, not hidden.** An option `astro.config.mjs` sets cannot
 * be changed from here, because config wins at resolve time. The control renders
 * disabled and says where the value came from. Hiding those rows would be worse:
 * the user would wonder why the option they can see in their config isn't listed.
 */

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
];

export interface SettingsPanelOptions {
  /** Open on a particular tab. */
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

  const isDirty = (): boolean =>
    !saving && Object.keys(collectChanges(controls)).length > 0;

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
    const pane = styled('div', `atx-settings-pane atx-settings-pane-${g.id}`);
    panes.set(g.id, pane);
  }

  const status = styled('p', 'atx-settings-status');

  const error = styled('p', 'atx-settings-error');

  const warning = styled('p', 'atx-settings-warning');

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

      // One card per tab: the group's name and its one-line blurb are the
      // card's header, so the pane says what it governs instead of opening
      // with an unattributed sentence above a run of controls.
      const group = fieldGroup();
      for (const o of mine) {
        const control = buildControl(toFieldDescriptor(o), o.value);
        if (o.locked) control.root.append(lockNote(o));
        controls.push(control);
        group.append(control.root);
      }
      if (mine.length > 0) {
        const optionCard = card({ title: g.label, description: g.blurb });
        optionCard.body.append(group);
        pane.append(optionCard.root);
      }

    }

    paintWarning(data);
    setButtonEnabled(saveBtn, true);
  };

  /** The uncommitted-settings warning. It lives under the tab host so it is on
   *  screen whichever tab is open, and the server sends the list because
   *  whether the file is even present is a question only it can answer. */
  const paintWarning = (data: SettingsResponse): void => {
    const files = data.gitignoreWarning ?? [];
    if (files.length > 0) {
      const subject = files.length === 1 ? `${files[0]} is not listed` : `${files.join(' and ')} are not listed`;
      warning.textContent =
        `${subject} in this project’s .gitignore. It holds this project’s overlay ` +
        'settings — add it to your ignore rules before it can be committed. ' +
        '(This integration cannot edit your ignore rules for you.)';
      warning.toggleAttribute('data-on', true);
    } else {
      warning.toggleAttribute('data-on', false);
    }
  };

  const text = (value: string, tone: 'muted' | 'ok' | 'warn', mono = false): HTMLElement => {
    const el = styled('span', 'atx-settings-text');
    el.dataset.tone = tone;
    if (mono) el.dataset.mono = '';
    el.textContent = value;
    return el;
  };

  /** Why a control is disabled, under the control. */
  const lockNote = (o: OptionDescriptor): HTMLElement => {
    // Muted, not amber: an option the project set in its own config is a
    // normal state, and painting a third of the panel in warning colour would
    // spend the one colour that should mean "something is wrong" — which here
    // is the uncommitted-secret warning at the bottom.
    const note = styled('p', 'atx-settings-lock');
    note.append(
      icon('lock', 12),
      document.createTextNode(
        o.restartRequired
          ? 'Read before the dev server starts, so it lives in astro.config.mjs and changing it needs a restart.'
          : 'Set in astro.config.mjs, which takes precedence. Remove it there to change it from here.',
      ),
    );
    return note;
  };

  /** Freeze the drawer during a write. */
  const setBusy = (busy: boolean): void => {
    saving = busy;
    for (const btn of shell.body.querySelectorAll('button')) setButtonEnabled(btn, !busy);
    for (const btn of foot.querySelectorAll('button')) setButtonEnabled(btn, !busy);
    if (!busy) setButtonEnabled(saveBtn, current !== null);
  };

  const showError = (message: string): void => {
    error.textContent = message;
    error.toggleAttribute('data-on', true);
  };

  const save = async (): Promise<void> => {
    error.toggleAttribute('data-on', false);
    applyFieldErrors(controls, {});

    const options = collectChanges(controls);
    if (Object.keys(options).length === 0) {
      showError('Nothing has changed yet.');
      return;
    }

    setBusy(true);
    try {
      const next = await api.saveSettings({ options });
      // Feature flags the overlay reads are option-derived, so a save repaints
      // the page's affordances without a reload.
      setFeatures({
        ok: true,
        name: 'astro-dev-edit',
        milestone: 1,
        cssInspector: valueOf(next, 'cssInspector') === true,
        openInEditor: valueOf(next, 'openInEditor') === true,
      });
      paint(next);
      toast('Settings saved', 'ok');
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
  const closeBtn = footButton('Close', 'outline', () => shell.close());
  const saveBtn = footButton('Save', 'default', () => void save());
  foot.append(closeBtn, saveBtn);

  // --- boot ------------------------------------------------------------------
  status.append(icon('spinner', 16), text('Reading settings…', 'muted'));
  setButtonEnabled(saveBtn, false);

  void api.getSettings().then(
    (data) => {
      paint(data);
      if (opts.tab) tabs.show(opts.tab);
    },
    (err: unknown) => {
      status.textContent = '';
      status.append(icon('alert', 16), text('Could not read settings', 'warn'));
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
    help: o.help,
    ...(o.choices ? { options: o.choices } : {}),
    ...(o.locked ? { readOnly: true } : {}),
  };
}

/** An option's value out of a response, by key. */
function valueOf(data: SettingsResponse, key: string): unknown {
  return data.options?.find((o) => o.key === key)?.value;
}
