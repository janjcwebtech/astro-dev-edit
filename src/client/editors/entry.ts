import type { EntryResponse, FieldDescriptor } from '../../shared/protocol.ts';
import * as api from '../api.ts';
import { EntryApplyError } from '../api.ts';
import { slugify } from '../../shared/slug.ts';
import * as state from '../state.ts';
import { basename, footButton, toast } from '../ui.ts';
import { card, fieldGroup } from '../group.ts';
import { icon } from '../icons.ts';
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

/**
 * Where the field list came from, said plainly. The drawer is schema-driven
 * when the project's `content.config.ts` resolves and value-inferred when it
 * does not, and that difference decides whether a missing field is a gap in
 * the file or a gap in what the tool could work out — worth a line rather than
 * something the user infers from which fields happen to be present.
 */
function fieldsOrigin(fields: readonly FieldDescriptor[]): string {
  return fields.some((f) => f.source === 'schema')
    ? "From the collection's schema."
    : "Inferred from the file's own values.";
}

/** A card holding one run of fields. The drawer body is a stack of these, so
 *  every group states what it is instead of running into the next. */
function fieldCard(title: string, description: string, controls: readonly FieldControl[]): HTMLElement {
  const c = card({ title, description });
  const group = fieldGroup();
  for (const ctl of controls) group.append(ctl.root);
  c.body.append(group);
  return c.root;
}

/** The header's corner action: one size down, and iconned, because it leaves
 *  the drawer rather than completing it. */
function newEntryButton(onClick: () => void): HTMLButtonElement {
  const btn = footButton('New', 'outline', onClick);
  btn.classList.add('atx-btn-sm');
  btn.prepend(icon('plus', 16));
  return btn;
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

/**
 * Where a just-created entry is waiting to be opened, remembered across the
 * reload that creating it causes.
 *
 * Writing the file makes Astro resync its content layer, which full-reloads the
 * page — the very reload the poll below is waiting for the *result* of. A
 * promise cannot survive that: the document it belongs to is gone, and with it
 * the only record that anyone asked to go anywhere. The same `sessionStorage`
 * trick that carries edit mode across a save carries the destination.
 */
const NAV_KEY = 'astroDevEditPendingNav';

/** How long the poll runs, measured from the create — not from the boot that
 *  resumed it, so a reload cannot extend the wait indefinitely. */
const NAV_BUDGET_MS = 10_000;

/** After this a remembered destination is stale — a poll that never finished
 *  must not hijack an unrelated visit minutes later. */
const NAV_TTL_MS = 30_000;

function rememberNavigation(url: string | null, at = Date.now()): void {
  try {
    if (url) sessionStorage.setItem(NAV_KEY, JSON.stringify({ url, at }));
    else sessionStorage.removeItem(NAV_KEY);
  } catch {
    // sessionStorage unavailable — the poll just won't survive a reload.
  }
}

function readPendingNavigation(): { url: string; at: number } | null {
  try {
    const raw = sessionStorage.getItem(NAV_KEY);
    if (!raw) return null;
    const { url, at } = JSON.parse(raw) as { url?: string; at?: number };
    if (!url || typeof at !== 'number' || Date.now() - at > NAV_TTL_MS) {
      sessionStorage.removeItem(NAV_KEY);
      return null;
    }
    return { url, at };
  } catch {
    return null;
  }
}

const samePath = (a: string, b: string): boolean =>
  a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

/**
 * Pick a create's navigation back up after Astro's reload interrupted it.
 * Called from the overlay's boot; does nothing when nothing is pending, and
 * drops the record when this *is* the page it named.
 */
export function resumePendingNavigation(): void {
  const pending = readPendingNavigation();
  if (!pending) return;
  if (samePath(location.pathname, pending.url)) {
    rememberNavigation(null);
    return;
  }
  void navigateWhenReady(pending.url, pending.at);
}

/** Navigate to a freshly created route once the content layer has synced it:
 *  poll until it stops 404ing, then go. After ~10s give up and navigate
 *  anyway, so a non-conventional detail route degrades to a visible 404
 *  (reload once the sync lands) instead of stranding the user here. */
async function navigateWhenReady(url: string, since = Date.now()): Promise<void> {
  rememberNavigation(url, since);
  const deadline = since + NAV_BUDGET_MS;
  while (Date.now() < deadline) {
    if (await api.routeExists(url)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  // Consumed *before* the jump: arriving must never re-arm the poll, and a
  // give-up landing on a route that still 404s must not loop on it either.
  rememberNavigation(null);
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

  const shell = openDrawer('Edit entry', {
    description: entry.file,
    isDirty: () => controls.some((c) => c.dirty()) || (bodyEditor?.dirty() ?? false),
    discardMessage: 'Discard unsaved changes?',
    // The body editor's writing surface is light-DOM (slotted in), so closing
    // the drawer does not take it with it.
    onClose: () => bodyEditor?.destroy(),
  });

  shell.body.append(fieldCard('Frontmatter', fieldsOrigin(entry.fields), controls));
  if (bodyEditor) {
    const bodyCard = card({ title: 'Body', description: 'Markdown, written straight to the file.' });
    bodyCard.body.append(bodyEditor.root);
    shell.body.append(bodyCard.root);
  }

  // "New" — only when the file maps to a known collection.
  if (entry.collection) {
    shell.actions.append(
      newEntryButton(() => {
        shell.teardown();
        showCreateDrawer(entry);
      }),
    );
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

  const saveBtn = footButton('Save', 'default', () => void save());
  const delBtn = footButton('Delete…', 'destructive', () => void del());
  delBtn.prepend(icon('trash', 16));
  // Delete first in the DOM is what puts it at the far end of the band — see
  // the `:first-child` rule in styles.ts. Cancel is an outline rather than a
  // ghost so the pair the user is choosing between reads as a pair.
  shell.foot.append(delBtn, footButton('Cancel', 'outline', shell.close), saveBtn);
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

  // Only schema fields make sense for a brand-new entry. The descriptors
  // describe the entry this drawer was opened from, where a key may well be
  // present; in a file that does not exist yet none of them is, and `present`
  // is what tells a control to offer the schema's default rather than to
  // present its own idle state as a value.
  const controls: FieldControl[] = entry.fields
    .filter((f) => f.source === 'schema' && f.type !== 'json')
    .map((f) => buildControl({ ...f, present: false }, undefined, entryFile));

  const bodyEditor = buildBodyEditor('');

  const shell = openDrawer('New entry', {
    description: `in ${collection}`,
    isDirty: () =>
      slugInput.value !== '' || bodyEditor.dirty() || controls.some((c) => c.dirty()),
    discardMessage: 'Discard this new entry?',
    onClose: () => bodyEditor.destroy(),
  });

  // Three concerns, three cards. The slug is not frontmatter — it is the
  // filename, and therefore the URL — so it gets said separately rather than
  // sitting at the top of the field list looking like a key.
  shell.body.append(
    fieldCard('File', 'The filename, and the path it will be served at.', [slugControl]),
    fieldCard('Frontmatter', fieldsOrigin(entry.fields), controls),
  );
  const bodyCard = card({ title: 'Body', description: 'Markdown, written straight to the file.' });
  bodyCard.body.append(bodyEditor.root);
  shell.body.append(bodyCard.root);

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
      // Only what was actually filled in. An untouched control has no value to
      // contribute — it has an idle state, which is not the same thing, and
      // writing it would override the schema's own default. A checkbox is
      // where that bites: nobody chose Off, the box simply starts empty, and
      // `published: false` in the file beats `.default(true)` in the schema.
      if (!c.dirty()) continue;
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

  const createBtn = footButton('Create', 'default', () => void create());
  shell.foot.append(footButton('Cancel', 'outline', shell.close), createBtn);
  slugInput.focus();
}
