import type { FieldDescriptor, FieldType } from '../../shared/protocol.ts';
import { inputEl, styled } from '../ui.ts';
import { buildImageField } from './asset-picker.ts';

/**
 * Field controls for the entry drawer *and* the Settings drawer: one builder per
 * FieldType, looked up through a registry (mirroring src/patcher/registry.ts).
 * Adding a widget = add the FieldType to protocol.ts, register a builder here,
 * and (if it should be schema-derived rather than config-forced) map it in
 * server/schema-introspect.ts. Unknown types degrade to the read-only `json`
 * builder, so a stale client never crashes on a new wire value.
 *
 * The Settings drawer describes each integration option as a synthesized
 * {@link FieldDescriptor} and comes through here too, rather than growing a
 * parallel control system. That is what `readOnly` and `help` on the descriptor
 * are for: an option `astro.config.mjs` owns must render disabled (accepting
 * input for a value resolution would discard is a lie), and an option needs a
 * line of prose next to it far more often than a frontmatter key does.
 */

export interface FieldControl {
  field: FieldDescriptor;
  root: HTMLElement;
  /** Current wire value for this field. */
  value(): unknown;
  /** Whether the user changed it from its initial state. */
  dirty(): boolean;
  setError(message: string | null): void;
}

/** Grey out and block input on every control a builder mounted. Applied after
 *  the builder runs, so no builder has to know about `readOnly` — including the
 *  image picker, whose button is not an input at all. */
function lockControls(root: HTMLElement): void {
  for (const el of root.querySelectorAll('input, textarea, select, button')) {
    (el as HTMLInputElement | HTMLButtonElement).disabled = true;
  }
  root.dataset.locked = '';
}

/** What a builder must supply; buildControl adds the label/error chrome. */
interface ControlParts {
  value(): unknown;
  dirty(): boolean;
}

interface ControlContext {
  field: FieldDescriptor;
  /** Raw parsed frontmatter value (undefined for a new entry). */
  raw: unknown;
  /** `raw` rendered for display (see displayValue). */
  initial: string;
  /** Schema-default hint shown when the key is absent from the file. */
  placeholder: string;
  /** Mount point: append the control's element(s) here. */
  root: HTMLElement;
  /** Repo-relative path of the entry being edited; '' for a new one. Needed by
   *  controls whose values are relative to the file (see FieldDescriptor.assetRef). */
  entryFile: string;
}

type ControlBuilder = (ctx: ControlContext) => ControlParts;

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

/** Initial display value for a control, from the parsed frontmatter. */
function displayValue(field: FieldDescriptor, raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (field.type === 'tags' && Array.isArray(raw)) return raw.join(', ');
  if (field.type === 'json') return JSON.stringify(raw, null, 2);
  return String(raw);
}

// --- builders ----------------------------------------------------------------

/** text / date / number / tags share a plain input. */
const plainInput: ControlBuilder = ({ field, initial, placeholder, root }) => {
  const input = inputEl('input', 'atx-field-input');
  if (field.type === 'date' && (initial === '' || DATE_RE.test(initial))) {
    input.type = 'date';
    input.value = initial.slice(0, 10);
  } else if (field.type === 'number') {
    input.type = 'number';
    input.value = initial;
  } else {
    input.type = 'text';
    input.value = initial;
  }
  input.placeholder = placeholder;
  const started = input.value;
  root.append(input);
  return {
    value: () => {
      if (field.type === 'number') return input.value === '' ? '' : Number(input.value);
      if (field.type === 'tags') {
        return input.value.split(',').map((s) => s.trim()).filter(Boolean);
      }
      return input.value;
    },
    dirty: () => input.value !== started,
  };
};

const checkbox: ControlBuilder = ({ field, raw, root }) => {
  const wrap = styled('label', 'atx-field-check');
  const input = styled('input', 'atx-field-input atx-field-checkbox');
  input.type = 'checkbox';
  input.checked = raw === true;
  // A bare checkbox reads as unfinished UI, so the box is always accompanied by
  // words: "not set" while the key is absent from the file (the state the entry
  // drawer has to distinguish), and the plain on/off state once it is not.
  // An absent key is not Off — the schema's default is what will apply — so the
  // words say which default that is, and go back to saying it if the box is
  // ticked and unticked again.
  const hint = styled('span', 'atx-field-check-hint');
  const stateWord = (): string => (input.checked ? 'On' : 'Off');
  const unsetWord =
    field.defaultValue === undefined
      ? 'not set'
      : `not set — defaults to ${field.defaultValue === true ? 'On' : 'Off'}`;
  const render = (): void => {
    hint.textContent = !field.present && !input.checked ? unsetWord : stateWord();
  };
  render();
  input.addEventListener('change', render);
  wrap.append(input, hint);
  root.append(wrap);
  return {
    value: () => input.checked,
    dirty: () => input.checked !== (raw === true),
  };
};

const select: ControlBuilder = ({ field, initial, placeholder, root }) => {
  const el = inputEl('select', 'atx-field-input atx-field-select');
  const opts = [...(field.options ?? [])];
  if (initial && !opts.includes(initial)) opts.unshift(initial);
  if (!field.present) {
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = placeholder || '—';
    el.append(blank);
  }
  for (const o of opts) {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = o;
    el.append(opt);
  }
  el.value = initial;
  root.append(el);
  return { value: () => el.value, dirty: () => el.value !== initial };
};

const textarea: ControlBuilder = ({ initial, placeholder, root }) => {
  const input = inputEl('textarea', 'atx-field-input atx-field-textarea');
  input.value = initial;
  input.placeholder = placeholder;
  root.append(input);
  return { value: () => input.value, dirty: () => input.value !== initial };
};

const image: ControlBuilder = ({ field, initial, root, entryFile }) => {
  let current = initial;
  root.append(
    buildImageField({
      initial,
      onChange: (next) => (current = next),
      // An image() field stores a path relative to the entry file, not a web
      // URL — the control resolves previews and writes picks in that shape.
      ...(field.assetRef ? { assetRef: field.assetRef, entryFile } : {}),
    }),
  );
  return { value: () => current, dirty: () => current !== initial };
};

/** Shapes the panel can't edit render read-only; saves never touch them. */
const json: ControlBuilder = ({ raw, initial, root }) => {
  const input = inputEl('textarea', 'atx-field-input atx-field-json');
  input.value = initial;
  input.readOnly = true;
  input.title = 'This field has a shape the panel can’t edit — change it in the file.';
  root.append(input);
  return { value: () => raw, dirty: () => false };
};

const CONTROL_BUILDERS: Record<FieldType, ControlBuilder> = {
  text: plainInput,
  date: plainInput,
  number: plainInput,
  tags: plainInput,
  boolean: checkbox,
  select,
  textarea,
  image,
  json,
};

// --- assembly ----------------------------------------------------------------

export function buildControl(
  field: FieldDescriptor,
  raw: unknown,
  entryFile = '',
): FieldControl {
  const root = styled('div', 'atx-field');

  const label = styled('label', 'atx-field-label');
  label.textContent = field.required ? `${field.label} *` : field.label;
  root.append(label);

  const error = styled('div', 'atx-field-error');
  // A live region, so the message is announced when it appears rather than
  // only being found by someone who happens to navigate back over the field.
  error.role = 'alert';
  const setError = (message: string | null): void => {
    error.textContent = message ?? '';
    error.toggleAttribute('data-on', Boolean(message));
    // The destructive border is drawn from aria-invalid rather than from a
    // class of its own, so the thing a screen reader is told and the thing the
    // eye is shown are the same fact instead of two that can disagree.
    for (const el of root.querySelectorAll('[data-input]')) {
      if (message) el.setAttribute('aria-invalid', 'true');
      else el.removeAttribute('aria-invalid');
    }
  };

  const initial = displayValue(field, raw);
  const placeholder =
    !field.present && field.defaultValue !== undefined
      ? `${displayValue({ ...field, present: true }, field.defaultValue)} (default)`
      : '';

  const builder = CONTROL_BUILDERS[field.type] ?? json;
  const parts = builder({ field, raw, initial, placeholder, root, entryFile });

  if (field.help) {
    const help = styled('div', 'atx-field-help');
    help.textContent = field.help;
    root.append(help);
  }

  root.append(error);

  if (field.readOnly) {
    lockControls(root);
    // Reported clean regardless of what the control holds: a locked field can
    // never contribute to a save, so `collectChanges` must not see it.
    return { field, root, value: parts.value, dirty: () => false, setError };
  }
  return { field, root, value: parts.value, dirty: parts.dirty, setError };
}

/** The frontmatter payload for changed fields only. Clearing an optional
 *  field maps to null (= remove the key); required fields send '' and let the
 *  server's schema validation answer. */
export function collectChanges(controls: FieldControl[]): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const c of controls) {
    if (!c.dirty()) continue;
    const v = c.value();
    const emptied = v === '' || (Array.isArray(v) && v.length === 0);
    if (emptied && !c.field.required && c.field.present) changes[c.field.name] = null;
    else if (emptied && !c.field.present) continue; // never present, still empty
    else changes[c.field.name] = v;
  }
  return changes;
}

export function applyFieldErrors(
  controls: FieldControl[],
  fieldErrors: Record<string, string>,
): void {
  for (const c of controls) c.setError(fieldErrors[c.field.name] ?? null);
}
