import type { EntryResponse, FieldDescriptor } from '../../shared/protocol.ts';
import * as api from '../api.ts';
import { EntryApplyError } from '../api.ts';
import { slugify } from '../../shared/slug.ts';
import * as state from '../state.ts';
import { COLOR, basename, footButton, styled, toast } from '../ui.ts';
import { buildBodyEditor } from './body-editor.ts';
import { openDrawer } from './drawer.ts';
import { applyFieldErrors, buildControl, collectChanges, type FieldControl } from './fields.ts';

/**
 * The CMS entry drawers (edit + create): schema-driven forms over a collection
 * entry's frontmatter plus its markdown body. Fields come from the server
 * (/entry) — derived from the project's own zod schema when resolvable,
 * inferred from the file's values otherwise — and render through the field
 * registry in fields.ts; the drawer shell/lifecycle comes from drawer.ts.
 * Saves are atomic and etag-guarded; Astro HMR refreshes the page afterwards.
 */

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

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

/** Navigate to a freshly created route once the content layer has synced it:
 *  poll until it stops 404ing, then go. After ~10s give up and navigate
 *  anyway, so a non-conventional detail route degrades to a visible 404
 *  (reload once the sync lands) instead of stranding the user here. */
async function navigateWhenReady(url: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await api.routeExists(url)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  location.assign(url);
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
  const controls = entry.fields.map((f) =>
    buildControl(f, entry.values[f.name], entry.file),
  );
  const bodyEditor = entry.bodyEditable ? buildBodyEditor(entry.body) : null;

  const shell = openDrawer(`Edit entry · ${basename(entry.file)}`, {
    isDirty: () => controls.some((c) => c.dirty()) || (bodyEditor?.dirty() ?? false),
    discardMessage: 'Discard unsaved changes?',
  });

  for (const c of controls) shell.body.append(c.root);
  if (bodyEditor) {
    shell.body.append(sectionLabel('Body'), bodyEditor.root);
  }

  // "+ New" — only when the file maps to a known collection.
  if (entry.collection) {
    const newBtn = footButton('+ New', 'ghost', () => {
      shell.teardown();
      showCreateDrawer(entry);
    });
    newBtn.style.padding = '4px 10px';
    newBtn.style.font = '600 12px system-ui';
    shell.actions.append(newBtn);
  }

  const save = async (): Promise<void> => {
    const changes: { frontmatter?: Record<string, unknown>; body?: string } = {};
    const fm = collectChanges(controls);
    if (Object.keys(fm).length > 0) changes.frontmatter = fm;
    if (bodyEditor?.dirty()) changes.body = bodyEditor.value();
    if (!changes.frontmatter && changes.body === undefined) {
      shell.teardown();
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      await api.applyEntry({ file: entry.file, etag: entry.etag, changes });
      toast(`Saved ${basename(entry.file)}`, 'ok');
      shell.teardown();
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      if (err instanceof EntryApplyError && err.code === 'validation' && err.fieldErrors) {
        applyFieldErrors(controls, err.fieldErrors);
        toast('Fix the highlighted fields', 'err');
      } else if (err instanceof EntryApplyError && err.code === 'conflict') {
        toast('File changed on disk — reloading its current state', 'err');
        shell.teardown();
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
      shell.teardown();
      // This page is about to 404 — land on the listing above it.
      location.assign(parentPath());
    } catch (err) {
      toast(`Delete failed — ${err instanceof Error ? err.message : 'unknown error'}`, 'err');
    }
  };

  const saveBtn = footButton('Save', 'primary', () => void save());
  shell.foot.append(
    footButton('Delete…', 'danger', () => void del()),
    footButton('Cancel', 'ghost', shell.close),
    saveBtn,
  );
}

// ---------------------------------------------------------------------------
// Create drawer
// ---------------------------------------------------------------------------

/**
 * Everything the create drawer needs, independent of a loaded entry — so the
 * collection designer's Items view can open it for a collection the user hasn't
 * navigated to.
 */
export interface EntrySeed {
  collection: string;
  /** Repo-relative collection dir; relative asset values resolve against it. */
  collectionDir: string | null;
  /** Stand-in path for asset resolution when there is no collection dir. */
  file: string;
  /** Only `source: 'schema'` fields are offered — a new entry has no values to
   *  infer from. */
  fields: FieldDescriptor[];
  /**
   * What to do once the file exists. The default navigates to the sibling
   * detail route, which is right when the create started from a rendered page
   * and wrong when it started from the Collections tab — hence the hook.
   */
  afterCreate?(file: string, slug: string): void;
}

function showCreateDrawer(entry: EntryResponse): void {
  openEntryCreatePanel({
    collection: entry.collection!,
    collectionDir: entry.collectionDir,
    file: entry.file,
    fields: entry.fields,
  });
}

/** The create drawer, opened from a seed rather than from a loaded entry. */
export function openEntryCreatePanel(entry: EntrySeed): void {
  const collection = entry.collection;

  // Slug first: filename of the new entry, auto-suggested from the title
  // while untouched.
  const slugField: FieldDescriptor = {
    name: 'slug', label: 'Slug (filename)', type: 'text',
    required: true, present: false, source: 'schema',
  };
  const slugControl = buildControl(slugField, '');
  const slugInput = slugControl.root.querySelector('input') as HTMLInputElement;
  slugInput.placeholder = 'my-new-entry';

  // A new entry has no path yet, but relative asset values only depend on the
  // *directory* it will land in — which is the collection dir the create route
  // writes to. Resolve against a placeholder sibling there.
  const entryFile = entry.collectionDir ? `${entry.collectionDir}/_new.md` : entry.file;

  // Only schema fields make sense for a brand-new entry.
  const controls: FieldControl[] = entry.fields
    .filter((f) => f.source === 'schema' && f.type !== 'json')
    .map((f) => buildControl(f, undefined, entryFile));

  const bodyEditor = buildBodyEditor('');

  const shell = openDrawer(`New entry · ${collection}`, {
    isDirty: () =>
      slugInput.value !== '' || bodyEditor.dirty() || controls.some((c) => c.dirty()),
    discardMessage: 'Discard this new entry?',
  });

  shell.body.append(slugControl.root);
  for (const c of controls) shell.body.append(c.root);
  shell.body.append(sectionLabel('Body'), bodyEditor.root);

  let slugTouched = false;
  slugInput.addEventListener('input', () => (slugTouched = true));
  const titleControl = controls.find((c) => c.field.name === 'title');
  if (titleControl) {
    const titleInput = titleControl.root.querySelector('input, textarea') as HTMLInputElement | null;
    titleInput?.addEventListener('input', () => {
      // The server re-runs the same slugify as the authority on create.
      if (!slugTouched) slugInput.value = slugify(titleInput.value);
    });
  }

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
      const { file } = await api.createEntry({ collection, slug, frontmatter, body: bodyEditor.value() });
      toast(`Created ${basename(file)}`, 'ok');
      shell.teardown();
      if (entry.afterCreate) {
        entry.afterCreate(file, slug);
      } else {
        // Detail routes are conventionally siblings of the current page; the
        // fresh route 404s until Astro's content layer syncs the new file.
        void navigateWhenReady(siblingPath(slug));
      }
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
  shell.foot.append(footButton('Cancel', 'ghost', shell.close), createBtn);
  slugInput.focus();
}
