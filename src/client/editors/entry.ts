import type { EntryResponse, FieldDescriptor } from '../../shared/protocol.ts';
import * as api from '../api.ts';
import { EntryApplyError } from '../api.ts';
import * as state from '../state.ts';
import {
  COLOR,
  FONT,
  basename,
  buildBackdrop,
  buildDrawer,
  styled,
  toast,
} from '../ui.ts';
import { buildImageField } from './asset-picker.ts';

/**
 * The CMS entry drawer: a schema-driven form over a collection entry's
 * frontmatter plus its markdown body, with create and delete. Fields come from
 * the server (/entry) — derived from the project's own zod schema when
 * resolvable, inferred from the file's values otherwise. Saves are atomic and
 * etag-guarded; Astro HMR refreshes the page afterwards.
 */

// ---------------------------------------------------------------------------
// Field controls
// ---------------------------------------------------------------------------

interface FieldControl {
  field: FieldDescriptor;
  root: HTMLElement;
  /** Current wire value for this field. */
  value(): unknown;
  /** Whether the user changed it from its initial state. */
  dirty(): boolean;
  setError(message: string | null): void;
}

const INPUT_STYLE: Partial<CSSStyleDeclaration> = {
  width: '100%', padding: '6px 8px', boxSizing: 'border-box',
  border: '1px solid #444', borderRadius: '5px', background: '#111', color: '#fff',
  font: '13px system-ui',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

/** Initial display value for a control, from the parsed frontmatter. */
function displayValue(field: FieldDescriptor, raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (field.type === 'tags' && Array.isArray(raw)) return raw.join(', ');
  if (field.type === 'json') return JSON.stringify(raw, null, 2);
  return String(raw);
}

function buildControl(field: FieldDescriptor, raw: unknown): FieldControl {
  const root = styled('div', 'atx-field', { marginBottom: '12px' });

  const label = styled('label', 'atx-field-label', {
    display: 'block', font: '600 12px system-ui', marginBottom: '4px', opacity: '0.85',
  });
  label.textContent = field.required ? `${field.label} *` : field.label;
  root.append(label);

  const error = styled('div', 'atx-field-error', {
    display: 'none', marginTop: '3px', font: '12px system-ui', color: '#ff8a80',
  });
  const setError = (message: string | null): void => {
    error.textContent = message ?? '';
    error.style.display = message ? 'block' : 'none';
  };

  const initial = displayValue(field, raw);
  const placeholder =
    !field.present && field.defaultValue !== undefined
      ? `${displayValue({ ...field, present: true }, field.defaultValue)} (default)`
      : '';

  let value: () => unknown;
  let dirty: () => boolean;

  switch (field.type) {
    case 'boolean': {
      const wrap = styled('label', 'atx-field-check', {
        display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
        font: '13px system-ui',
      });
      const input = styled('input', 'atx-field-input', { cursor: 'pointer' });
      input.type = 'checkbox';
      input.checked = raw === true;
      const hint = styled('span', 'atx-field-check-hint', { opacity: '0.7' });
      hint.textContent = field.present ? '' : 'not set';
      input.addEventListener('change', () => (hint.textContent = ''));
      wrap.append(input, hint);
      root.append(wrap);
      value = () => input.checked;
      dirty = () => input.checked !== (raw === true);
      break;
    }

    case 'select': {
      const select = styled('select', 'atx-field-input', { ...INPUT_STYLE, cursor: 'pointer' });
      const opts = [...(field.options ?? [])];
      if (initial && !opts.includes(initial)) opts.unshift(initial);
      if (!field.present) {
        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = placeholder || '—';
        select.append(blank);
      }
      for (const o of opts) {
        const opt = document.createElement('option');
        opt.value = o;
        opt.textContent = o;
        select.append(opt);
      }
      select.value = initial;
      root.append(select);
      value = () => select.value;
      dirty = () => select.value !== initial;
      break;
    }

    case 'textarea': {
      const input = styled('textarea', 'atx-field-input', {
        ...INPUT_STYLE, minHeight: '64px', resize: 'vertical',
      });
      input.value = initial;
      input.placeholder = placeholder;
      root.append(input);
      value = () => input.value;
      dirty = () => input.value !== initial;
      break;
    }

    case 'image': {
      let current = initial;
      const picker = buildImageField(initial, (next) => (current = next));
      root.append(picker);
      value = () => current;
      dirty = () => current !== initial;
      break;
    }

    case 'json': {
      const input = styled('textarea', 'atx-field-input', {
        ...INPUT_STYLE, minHeight: '48px', font: `12px ${FONT.mono}`,
        opacity: '0.6', resize: 'vertical',
      });
      input.value = initial;
      input.readOnly = true;
      input.title = 'This field has a shape the panel can’t edit — change it in the file.';
      root.append(input);
      value = () => raw;
      dirty = () => false;
      break;
    }

    default: {
      // text / date / number / tags share a plain input.
      const input = styled('input', 'atx-field-input', INPUT_STYLE);
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
      value = () => {
        if (field.type === 'number') return input.value === '' ? '' : Number(input.value);
        if (field.type === 'tags') {
          return input.value.split(',').map((s) => s.trim()).filter(Boolean);
        }
        return input.value;
      };
      dirty = () => input.value !== started;
      break;
    }
  }

  root.append(error);
  return { field, root, value, dirty, setError };
}

/** The frontmatter payload for changed fields only. Clearing an optional
 *  field maps to null (= remove the key); required fields send '' and let the
 *  server's schema validation answer. */
function collectChanges(controls: FieldControl[]): Record<string, unknown> {
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

function applyFieldErrors(controls: FieldControl[], fieldErrors: Record<string, string>): void {
  for (const c of controls) c.setError(fieldErrors[c.field.name] ?? null);
}

// ---------------------------------------------------------------------------
// Shared drawer scaffolding
// ---------------------------------------------------------------------------

function footButton(
  label: string,
  kind: 'primary' | 'ghost' | 'danger',
  onClick: () => void,
): HTMLButtonElement {
  const styles: Record<typeof kind, Partial<CSSStyleDeclaration>> = {
    primary: { border: 'none', background: COLOR.accent, color: '#fff' },
    ghost: { border: '1px solid #3a3a4d', background: 'transparent', color: '#ccc' },
    danger: { border: '1px solid #7a3a3a', background: 'transparent', color: '#ff8a80', marginRight: 'auto' },
  };
  const btn = styled('button', `atx-btn atx-btn-${kind}`, {
    padding: '7px 14px', borderRadius: '7px', cursor: 'pointer', font: '600 13px system-ui',
    ...styles[kind],
  });
  btn.type = 'button';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function bodyTextarea(initial: string): HTMLTextAreaElement {
  const input = styled('textarea', 'atx-body-input', {
    ...INPUT_STYLE, minHeight: '40vh', font: `12px/1.5 ${FONT.mono}`, resize: 'vertical',
  });
  input.value = initial;
  return input;
}

function sectionLabel(text: string): HTMLElement {
  const l = styled('div', 'atx-section-label', {
    font: '600 12px system-ui', margin: '16px 0 6px', opacity: '0.85',
    paddingTop: '12px', borderTop: `1px solid ${COLOR.panelDivider}`,
  });
  l.textContent = text;
  return l;
}

/** URL of the listing above the current detail page (…/articles/x → …/articles). */
function parentPath(): string {
  const p = location.pathname.replace(/\/+$/, '');
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

/** URL a sibling entry with `slug` would live at, by route convention. */
function siblingPath(slug: string): string {
  const parent = parentPath();
  return (parent === '/' ? '' : parent) + '/' + slug;
}

// ---------------------------------------------------------------------------
// Edit drawer
// ---------------------------------------------------------------------------

/** Fetch an entry and open the edit drawer for it. */
export async function openEntryPanel(file: string): Promise<void> {
  const busy = state.begin({ kind: 'busy' });
  let entry: EntryResponse;
  try {
    entry = await api.getEntry({ file });
  } catch (err) {
    toast(`Could not load entry — ${err instanceof Error ? err.message : 'unknown error'}`, 'err');
    return;
  } finally {
    state.releaseIf(busy);
  }
  showEditDrawer(entry);
}

function showEditDrawer(entry: EntryResponse): void {
  const drawer = buildDrawer(`Edit entry · ${basename(entry.file)}`);
  const body = drawer.querySelector('[data-body]') as HTMLElement;
  const foot = drawer.querySelector('[data-foot]') as HTMLElement;
  const actions = drawer.querySelector('[data-actions]') as HTMLElement;

  const controls = entry.fields.map((f) => buildControl(f, entry.values[f.name]));
  for (const c of controls) body.append(c.root);

  let bodyInput: HTMLTextAreaElement | null = null;
  if (entry.bodyEditable) {
    body.append(sectionLabel('Body (markdown)'));
    bodyInput = bodyTextarea(entry.body);
    body.append(bodyInput);
  }

  const isDirty = (): boolean =>
    controls.some((c) => c.dirty()) || (bodyInput !== null && bodyInput.value !== entry.body);

  const teardown = (): void => {
    state.releaseIf(token);
    drawer.remove();
    backdrop.remove();
  };
  const close = (): void => {
    if (isDirty() && !window.confirm('Discard unsaved changes?')) {
      // The slot may already be cleared (Escape path goes through dismiss);
      // re-claim it so the drawer stays the active interaction.
      token = state.begin({ kind: 'panel', close });
      return;
    }
    teardown();
  };
  const backdrop = buildBackdrop(close);
  let token = state.begin({ kind: 'panel', close });

  // "+ New" — only when the file maps to a known collection.
  if (entry.collection) {
    const newBtn = footButton('+ New', 'ghost', () => {
      teardown();
      showCreateDrawer(entry);
    });
    newBtn.style.padding = '4px 10px';
    newBtn.style.font = '600 12px system-ui';
    actions.append(newBtn);
  }

  const save = async (): Promise<void> => {
    const changes: { frontmatter?: Record<string, unknown>; body?: string } = {};
    const fm = collectChanges(controls);
    if (Object.keys(fm).length > 0) changes.frontmatter = fm;
    if (bodyInput && bodyInput.value !== entry.body) changes.body = bodyInput.value;
    if (!changes.frontmatter && changes.body === undefined) {
      teardown();
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      await api.applyEntry({ file: entry.file, etag: entry.etag, changes });
      toast(`Saved ${basename(entry.file)}`, 'ok');
      teardown();
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      if (err instanceof EntryApplyError && err.code === 'validation' && err.fieldErrors) {
        applyFieldErrors(controls, err.fieldErrors);
        toast('Fix the highlighted fields', 'err');
      } else if (err instanceof EntryApplyError && err.code === 'conflict') {
        toast('File changed on disk — reloading its current state', 'err');
        teardown();
        void openEntryPanel(entry.file);
      } else {
        toast(`Save failed — ${err instanceof Error ? err.message : 'unknown error'}`, 'err');
      }
    }
  };

  const del = async (): Promise<void> => {
    if (!window.confirm(`Delete ${basename(entry.file)}? (Undo is git.)`)) return;
    try {
      await api.deleteEntry({ file: entry.file, etag: entry.etag });
      toast(`Deleted ${basename(entry.file)}`, 'ok');
      teardown();
      // This page is about to 404 — land on the listing above it.
      location.assign(parentPath());
    } catch (err) {
      toast(`Delete failed — ${err instanceof Error ? err.message : 'unknown error'}`, 'err');
    }
  };

  const saveBtn = footButton('Save', 'primary', () => void save());
  foot.append(
    footButton('Delete…', 'danger', () => void del()),
    footButton('Cancel', 'ghost', close),
    saveBtn,
  );

  document.body.append(backdrop, drawer);
}

// ---------------------------------------------------------------------------
// Create drawer
// ---------------------------------------------------------------------------

function showCreateDrawer(entry: EntryResponse): void {
  const collection = entry.collection!;
  const drawer = buildDrawer(`New entry · ${collection}`);
  const body = drawer.querySelector('[data-body]') as HTMLElement;
  const foot = drawer.querySelector('[data-foot]') as HTMLElement;

  // Slug first: filename of the new entry, auto-suggested from the title
  // while untouched.
  const slugField: FieldDescriptor = {
    name: 'slug', label: 'Slug (filename)', type: 'text',
    required: true, present: false, source: 'schema',
  };
  const slugControl = buildControl(slugField, '');
  const slugInput = slugControl.root.querySelector('input') as HTMLInputElement;
  slugInput.placeholder = 'my-new-entry';
  body.append(slugControl.root);

  // Only schema fields make sense for a brand-new entry.
  const controls = entry.fields
    .filter((f) => f.source === 'schema' && f.type !== 'json')
    .map((f) => buildControl(f, undefined));
  for (const c of controls) body.append(c.root);

  let slugTouched = false;
  slugInput.addEventListener('input', () => (slugTouched = true));
  const titleControl = controls.find((c) => c.field.name === 'title');
  if (titleControl) {
    const titleInput = titleControl.root.querySelector('input, textarea') as HTMLInputElement | null;
    titleInput?.addEventListener('input', () => {
      if (slugTouched) return;
      slugInput.value = titleInput.value
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    });
  }

  body.append(sectionLabel('Body (markdown)'));
  const bodyInput = bodyTextarea('');
  body.append(bodyInput);

  const isDirty = (): boolean =>
    slugInput.value !== '' || bodyInput.value !== '' || controls.some((c) => c.dirty());

  const teardown = (): void => {
    state.releaseIf(token);
    drawer.remove();
    backdrop.remove();
  };
  const close = (): void => {
    if (isDirty() && !window.confirm('Discard this new entry?')) {
      token = state.begin({ kind: 'panel', close });
      return;
    }
    teardown();
  };
  const backdrop = buildBackdrop(close);
  let token = state.begin({ kind: 'panel', close });

  const create = async (): Promise<void> => {
    const slug = slugInput.value.trim();
    if (!slug) {
      slugControl.setError('required');
      return;
    }
    slugControl.setError(null);
    const frontmatter: Record<string, unknown> = {};
    for (const c of controls) {
      const v = c.value();
      const empty = v === '' || v === undefined || (Array.isArray(v) && v.length === 0);
      if (!empty) frontmatter[c.field.name] = v;
    }
    createBtn.disabled = true;
    createBtn.textContent = 'Creating…';
    try {
      const { file } = await api.createEntry({ collection, slug, frontmatter, body: bodyInput.value });
      toast(`Created ${basename(file)}`, 'ok');
      teardown();
      // Detail routes are conventionally siblings of the current page. Give
      // Astro's content layer a beat to sync the new file before navigating,
      // or the fresh route 404s.
      setTimeout(() => location.assign(siblingPath(slug)), 800);
    } catch (err) {
      createBtn.disabled = false;
      createBtn.textContent = 'Create';
      if (err instanceof EntryApplyError && err.code === 'validation' && err.fieldErrors) {
        applyFieldErrors(controls, err.fieldErrors);
        toast('Fix the highlighted fields', 'err');
      } else if (err instanceof EntryApplyError && err.code === 'exists') {
        slugControl.setError(err.message);
        toast('That slug is taken', 'err');
      } else {
        toast(`Create failed — ${err instanceof Error ? err.message : 'unknown error'}`, 'err');
      }
    }
  };

  const createBtn = footButton('Create', 'primary', () => void create());
  foot.append(footButton('Cancel', 'ghost', close), createBtn);

  document.body.append(backdrop, drawer);
  slugInput.focus();
}
