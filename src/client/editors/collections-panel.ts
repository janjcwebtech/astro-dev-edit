import type {
  CollectionEntryItem,
  CollectionSummary,
  CollectionsResponse,
  FieldDescriptor,
  FieldOverride,
  FieldType,
  SchemaFieldSpec,
} from '../../shared/protocol.ts';
import * as api from '../api.ts';
import { has } from '../features.ts';
import { clearHighlight } from '../hover.ts';
import { icon } from '../icons.ts';
import {
  buildTabs,
  footButton,
  inputEl,
  setButtonEnabled,
  styled,
  toast,
} from '../ui.ts';
import { openDrawer } from './drawer.ts';
import { openEntryCreatePanel, openEntryPanel } from './entry.ts';

/**
 * The Collections drawer — the collection and field designer.
 *
 * A **peer** of the Settings drawer, opened from its own item in the admin bar's
 * menu rather than as a tab inside Settings. Options and content structure are
 * different jobs: an option is a switch on this tool, while a collection's shape
 * is the project's own committed source. Reaching the designer should not mean
 * going through a settings screen first.
 *
 * Shaped like Webflow's collections UI, adapted to a drawer: a list of
 * collections, then one collection's field table, then a create form. What it
 * does *not* borrow from Webflow is the illusion of a single store, because there
 * are two, and which one a control writes to matters:
 *
 * - **Schema** (type, required, default, add, remove) → `src/content.config.ts`.
 *   Committed source. It changes what `astro build` accepts, and it is the half
 *   `schemaEditor: false` switches off.
 * - **Editor** (widget, label, hidden) → `.astro-dev-edit.json`. Local,
 *   gitignored, and only the entry drawer reads it.
 *
 * Every field row carries both halves under those two words, and the legend at
 * the top of the field table says what each one means. A save sends one request;
 * the response reports each half separately, so a partial outcome is stated
 * rather than smoothed over.
 *
 * **Refusals are surfaced, not worked around.** A schema the patcher can't prove
 * (built by a helper, holding a spread) makes the schema half read-only for that
 * collection and offers "Open source" instead — the same stance the rest of the
 * overlay takes when the AST can't answer.
 */

/** Types the designer can write into a schema. `textarea` is deliberately absent:
 *  it is a *widget*, not a schema shape, and the Widget control below owns it —
 *  which is the two-store split working as intended. `json` is absent because it
 *  can't be synthesized at all. */
const SCHEMA_TYPES: readonly FieldType[] = [
  'text',
  'date',
  'number',
  'boolean',
  'select',
  'tags',
  'image',
];

/** Widget choices for the editor half. `''` means "whatever the schema implies". */
const WIDGET_CHOICES: ReadonlyArray<[string, string]> = [
  ['', 'From schema'],
  ['text', 'Text'],
  ['textarea', 'Textarea'],
  ['date', 'Date'],
  ['number', 'Number'],
  ['boolean', 'Checkbox'],
  ['select', 'Select'],
  ['tags', 'Tags'],
  ['image', 'Image'],
  ['json', 'Read-only JSON'],
];

const TYPE_LABEL: Record<string, string> = {
  text: 'Text',
  textarea: 'Textarea',
  date: 'Date',
  number: 'Number',
  boolean: 'Checkbox',
  select: 'Select',
  tags: 'Tags',
  image: 'Image',
  json: 'Read-only JSON',
};

/**
 * Collection to reopen after a full-page reload.
 *
 * Writing `content.config.ts` makes Astro resync its content layer, which
 * full-reloads the page — and takes this drawer with it, mid-save. Remembering
 * where the user was is the same trick, in the same store, that already carries
 * edit mode across the reload every text save causes.
 */
const RESUME_KEY = 'astroDevEditCollection';

/** How long a remembered collection stays valid. Long enough to survive the
 *  reload (Astro emits more than one while it resyncs, so the key must outlive
 *  the first boot), short enough that it can never hijack a later, unrelated
 *  visit to the designer. */
const RESUME_TTL_MS = 20_000;

/**
 * The collection a schema write is waiting to return to, or null.
 *
 * Deliberately **not** consumed on read: Astro's content resync reloads the page
 * more than once, and a key eaten by the first boot would leave the second with
 * nothing. It expires instead, and {@link clearPendingCollection} drops it the
 * moment the resumed drawer is closed.
 */
export function takePendingCollection(): string | null {
  try {
    const raw = sessionStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const { name, at } = JSON.parse(raw) as { name?: string; at?: number };
    if (!name || typeof at !== 'number' || Date.now() - at > RESUME_TTL_MS) {
      sessionStorage.removeItem(RESUME_KEY);
      return null;
    }
    return name;
  } catch {
    // sessionStorage unavailable or junk in it — the drawer just won't reopen.
    return null;
  }
}

/** Forget the remembered collection. Called when the resumed drawer closes. */
export function clearPendingCollection(): void {
  remember(null);
}

function remember(name: string | null): void {
  try {
    if (name) sessionStorage.setItem(RESUME_KEY, JSON.stringify({ name, at: Date.now() }));
    else sessionStorage.removeItem(RESUME_KEY);
  } catch {
    // As above: a missing store costs the convenience, nothing else.
  }
}

export interface CollectionsPaneOptions {
  /**
   * Close the surface this pane lives in, then run `open`.
   *
   * The entry drawers are *peers* of this one, not children: they claim the same
   * interaction slot, so stacking one on the other would leave the outer drawer
   * unable to close itself. Handing off instead is also the honest reading of the
   * gesture — clicking an entry means "edit this entry now".
   */
  handoff(open: () => void): void;
  /** Open straight into this collection's detail view, when it exists. Set by the
   *  overlay after a schema write reloaded the page. */
  initialCollection?: string;
}

export interface CollectionsPane {
  /** Mount point for the drawer's body. */
  root: HTMLElement;
  /** Read (or re-read) from the server. Safe to call again at any time. */
  load(): void;
  /** Whether anything is queued but unsaved — folded into the drawer's
   *  discard-confirm so a stray backdrop click can't lose a field edit. */
  isDirty(): boolean;
}

export interface CollectionsPanelOptions {
  /** Open straight into this collection's fields. Set by the overlay when a
   *  schema write reloaded the page out from under the drawer. */
  collection?: string;
  /** Run after the drawer closes, whatever the outcome. */
  onClose?(): void;
}

/**
 * Open the Collections drawer.
 *
 * The pane below carries all the state; this is only its shell. The footer holds
 * nothing but Close, deliberately: every save in here belongs to the row or the
 * form it changes — a schema write and an override write are different stores —
 * so a single drawer-wide Save would have to lie about which one it meant.
 */
export function openCollectionsPanel(opts: CollectionsPanelOptions = {}): void {
  clearHighlight();

  const pane = buildCollectionsPane({
    // An entry drawer replaces this one rather than stacking on it (see
    // `handoff`). The dirty check runs first, so a queued field edit can't be
    // lost by clicking an entry.
    handoff: (open) => {
      if (!shell.close()) return;
      open();
    },
    ...(opts.collection ? { initialCollection: opts.collection } : {}),
  });

  const shell = openDrawer('Collections', {
    isDirty: () => pane.isDirty(),
    discardMessage: 'Discard unsaved collection changes?',
    // Wider than the default drawer: a field row carries both stores' controls
    // side by side, and wrapping them would hide the split the legend explains.
    width: 'min(max(560px, 48vw), 96vw)',
    ...(opts.onClose ? { onClose: opts.onClose } : {}),
  });

  shell.body.append(pane.root);
  shell.foot.append(footButton('Close', 'ghost', () => shell.close()));
  pane.load();
}

export function buildCollectionsPane(opts: CollectionsPaneOptions): CollectionsPane {
  const root = styled('div', 'atx-collections');

  let data: CollectionsResponse | null = null;
  let selected: string | null = null;
  let creating = false;
  let busy = false;

  /** Pending edits for the selected collection, cleared on every navigation and
   *  after a successful save. */
  let editors: FieldEditor[] = [];
  let queuedAdds: SchemaFieldSpec[] = [];
  let removals = new Set<string>();
  /** Field specs typed into the create form. */
  let newFields: SchemaFieldSpec[] = [];
  let createDirty = false;
  /** Consumed by the first load, so a later navigation isn't hijacked. */
  let initial = opts.initialCollection ?? null;

  const resetPending = (): void => {
    editors = [];
    queuedAdds = [];
    removals = new Set();
    newFields = [];
    createDirty = false;
  };

  const isDirty = (): boolean =>
    !busy &&
    (queuedAdds.length > 0 ||
      removals.size > 0 ||
      createDirty ||
      newFields.length > 0 ||
      editors.some((e) => e.dirty()));

  // --- navigation ------------------------------------------------------------
  const goList = (): void => {
    selected = null;
    creating = false;
    resetPending();
    render();
  };
  const goDetail = (name: string): void => {
    selected = name;
    creating = false;
    resetPending();
    render();
  };
  const goCreate = (): void => {
    selected = null;
    creating = true;
    resetPending();
    render();
  };

  const load = (): void => {
    root.textContent = '';
    root.append(note([icon('spinner', 16), textNode('Reading collections…')], 'muted'));
    void api.listCollections().then(
      (next) => {
        data = next;
        if (initial) {
          if (next.collections.some((c) => c.name === initial)) selected = initial;
          initial = null;
        }
        render();
      },
      (err: unknown) => {
        root.textContent = '';
        root.append(
          note(
            [icon('alert', 16), textNode(err instanceof Error ? err.message : 'Could not read collections.')],
            'warn',
          ),
        );
      },
    );
  };

  // --- rendering -------------------------------------------------------------
  function render(): void {
    root.textContent = '';
    // The editor list belongs to the DOM this call is about to build. Without
    // clearing it, a return to this view would leave detached editors from the
    // previous render in the dirty check and in the next save's payload.
    editors = [];
    if (!data) return;
    if (creating) root.append(renderCreate(data));
    else if (selected) {
      const found = data.collections.find((c) => c.name === selected);
      root.append(found ? renderDetail(data, found) : renderList(data));
    } else root.append(renderList(data));
  }

  function renderList(d: CollectionsResponse): HTMLElement {
    const wrap = styled('div', 'atx-collections-list');
    wrap.append(
      blurb(
        d.configPath
          ? `Collections declared in ${d.configPath}. Clicking one opens its fields.`
          : 'This project has no content config, so there are no collections to show. ' +
              'Create src/content.config.ts to use the designer.',
      ),
    );

    if (!d.schemaEditor) {
      wrap.append(
        note(
          [
            icon('lock', 12),
            textNode(
              'Schema editing is off, so fields and collections are read-only here. ' +
                'Settings → Editing turns it on. Widget, label and hidden still save.',
            ),
          ],
          'muted',
        ),
      );
    }

    for (const c of d.collections) {
      const row = styled('button', `atx-collections-row atx-collections-row-${c.name}`);
      row.type = 'button';
      const title = styled('div', 'atx-collections-row-name');
      title.append(textNode(c.name));
      if (!c.registered) title.append(badge('not registered', 'warn'));
      if (c.schemaForm === null) title.append(badge('no readable schema', 'muted'));
      if (c.fieldSource === 'source' && c.schemaForm !== null) {
        title.append(badge('schema not loaded', 'warn'));
      }
      if (!c.dirExists) title.append(badge('directory missing', 'warn'));
      const meta = styled('div', 'atx-collections-row-meta');
      meta.textContent = `${c.dir} · ${c.entryCount} ${c.entryCount === 1 ? 'entry' : 'entries'} · ${c.fields.length} fields`;
      row.append(title, meta);
      row.addEventListener('click', () => goDetail(c.name));
      wrap.append(row);
    }

    if (d.configPath && d.schemaEditor) {
      wrap.append(footButton('New collection', 'outline', goCreate));
    }
    return wrap;
  }

  function renderDetail(d: CollectionsResponse, c: CollectionSummary): HTMLElement {
    const wrap = styled('div', `atx-collections-detail atx-collections-detail-${c.name}`);
    const fieldsPane = styled('div', 'atx-collections-fieldspane');
    const head = styled('div', 'atx-collections-head');
    head.append(backLink(goList));
    const name = styled('span', 'atx-collections-title');
    name.textContent = c.name;
    head.append(name);
    head.append(styled('span', 'atx-collections-spacer'));
    if (has('openInEditor')) {
      const openBtn = footButton('Open source', 'ghost', () => {
        void api.openCollectionSource({ collection: c.name }).catch((err: unknown) => {
          toast(err instanceof Error ? err.message : 'Could not open the config', 'err');
        });
      });
      head.append(openBtn);
    }
    wrap.append(head);

    const meta = styled('div', 'atx-collections-meta');
    meta.textContent =
      `${c.dir} · ${c.entryCount} ${c.entryCount === 1 ? 'entry' : 'entries'}` +
      (c.schemaForm === 'function' ? ' · function schema (image() available)' : '') +
      (c.schemaForm === 'object' ? ' · plain z.object schema' : '');
    wrap.append(meta);

    const items = buildItemsPane(c);
    const tabs = buildTabs(
      [
        { id: 'fields', label: 'Fields', pane: fieldsPane },
        { id: 'items', label: `Items · ${c.entryCount}`, pane: items.root },
      ],
      {
        classPrefix: 'collections-view',
        onActivate: (id) => {
          if (id === 'items') items.load();
        },
      },
    );
    wrap.append(tabs.strip, tabs.host);

    const writable = d.schemaEditor && c.schemaForm !== null;
    if (c.unrecognized) {
      fieldsPane.append(
        note(
          [
            icon('alert', 12),
            textNode(
              `${c.unrecognized}. Fields are read-only here — edit the config directly.`,
            ),
          ],
          'warn',
        ),
      );
    }
    if (c.fieldSource === 'source' && c.schemaForm !== null) {
      fieldsPane.append(
        note(
          [
            icon('alert', 12),
            textNode(
              'Astro could not load this content config, so these field names come from the ' +
                'config text and their types are unknown. Fix the config error first — the dev ' +
                'server log names it.',
            ),
          ],
          'warn',
        ),
      );
    }
    fieldsPane.append(legend());

    const list = styled('div', 'atx-collections-fields');
    for (const f of c.fields) {
      const editor = buildFieldEditor(f, c, writable);
      editors.push(editor);
      list.append(editor.root);
    }
    fieldsPane.append(list);

    // Queued additions live between the existing fields and the add form, so the
    // order on screen is the order they will land in.
    const pending = styled('div', 'atx-collections-pending');
    const repaintPending = (): void => {
      pending.textContent = '';
      for (const spec of queuedAdds) pending.append(pendingRow(spec, () => {
        queuedAdds = queuedAdds.filter((s) => s !== spec);
        repaintPending();
        refreshSave();
      }));
    };
    repaintPending();
    fieldsPane.append(pending);

    const error = styled('p', 'atx-collections-error');

    if (writable) {
      const form = buildFieldSpecForm(c, (spec) => {
        if (c.fields.some((f) => f.name === spec.name) || queuedAdds.some((s) => s.name === spec.name)) {
          showError(error, `${c.name} already has a "${spec.name}" field.`);
          return false;
        }
        queuedAdds.push(spec);
        repaintPending();
        refreshSave();
        return true;
      });
      fieldsPane.append(form.root);
    }

    const actions = styled('div', 'atx-collections-actions');
    const saveBtn = footButton('Save changes', 'default', () => void saveDetail(c, error));
    actions.append(saveBtn);
    fieldsPane.append(actions, error);

    const refreshSave = (): void => setButtonEnabled(saveBtn, isDirty());
    for (const e of editors) e.onChange(refreshSave);
    refreshSave();
    return wrap;
  }

  /**
   * The Items view: one collection's entry files, newest first.
   *
   * This is the half of the designer that reaches entries no rendered page links
   * to — drafts, and anything whose route doesn't exist yet. Clicking one hands
   * off to the existing entry drawer rather than reimplementing it.
   */
  function buildItemsPane(c: CollectionSummary): { root: HTMLElement; load(): void } {
    const root = styled('div', 'atx-collections-items');
    let loaded = false;

    const paint = (list: CollectionEntryItem[], truncated: boolean): void => {
      root.textContent = '';
      const bar = styled('div', 'atx-collections-itembar');
      const count = styled('span', 'atx-collections-itemcount');
      count.textContent = `${list.length} ${list.length === 1 ? 'entry' : 'entries'} in ${c.dir}`;
      bar.append(count);

      // A new entry's form is built from schema fields; with no resolvable schema
      // there is nothing to build it from, so the button says why instead of
      // opening an empty drawer.
      const canCreate = c.fieldSource === 'schema' && c.dirExists;
      const newBtn = footButton('New item', 'outline', () => {
        opts.handoff(() =>
          openEntryCreatePanel({
            collection: c.name,
            collectionDir: c.dir,
            file: `${c.dir}/_new.md`,
            fields: c.fields,
            // Started from the designer, not from a rendered page, so there is no
            // sibling route to navigate to.
            afterCreate: (file) => toast(`Created ${file}`, 'ok'),
          }),
        );
      });
      setButtonEnabled(newBtn, canCreate);
      bar.append(newBtn);
      root.append(bar);
      if (!canCreate) {
        root.append(
          note(
            [
              textNode(
                c.dirExists
                  ? 'A new entry’s form comes from the collection’s schema, which didn’t resolve.'
                  : `${c.dir} doesn’t exist yet, so there is nowhere to write an entry.`,
              ),
            ],
            'muted',
          ),
        );
      }

      if (list.length === 0) {
        root.append(blurb('No entries yet.'));
        return;
      }

      for (const e of list) {
        const row = styled('button', 'atx-collections-item');
        row.type = 'button';
        const title = styled('div', 'atx-collections-item-title');
        title.append(textNode(e.title ?? e.slug));
        if (e.draft) title.append(badge('draft', 'warn'));
        const meta = styled('div', 'atx-collections-item-meta');
        meta.textContent = `${e.slug} · ${when(e.mtime)}`;
        row.append(title, meta);
        row.addEventListener('click', () => {
          opts.handoff(() => void openEntryPanel(e.file));
        });
        root.append(row);
      }

      if (truncated) {
        root.append(
          note(
            [
              icon('alert', 12),
              textNode(
                `Only the first ${list.length} entries are listed — this collection has more.`,
              ),
            ],
            'warn',
          ),
        );
      }
    };

    const load = (): void => {
      if (loaded) return;
      loaded = true;
      root.textContent = '';
      root.append(note([icon('spinner', 16), textNode('Reading entries…')], 'muted'));
      void api.listCollectionEntries({ collection: c.name }).then(
        (res) => paint(res.entries, res.truncated === true),
        (err: unknown) => {
          root.textContent = '';
          root.append(
            note(
              [
                icon('alert', 16),
                textNode(err instanceof Error ? err.message : 'Could not read the entries.'),
              ],
              'warn',
            ),
          );
        },
      );
    };

    return { root, load };
  }

  /** One field's two halves. */
  function buildFieldEditor(
    f: FieldDescriptor,
    c: CollectionSummary,
    writable: boolean,
  ): FieldEditor {
    const expr = c.expressions[f.name];
    // A field the schema doesn't declare (inferred, or absent from the source)
    // can't be retyped — there is nothing to patch. Its editor half still works.
    const inSchema = expr !== undefined;
    const schemaEditable = writable && inSchema && f.type !== 'json';

    const card = styled('div', `atx-collections-field atx-collections-field-${f.name}`);

    const head = styled('div', 'atx-collections-field-head');
    const nameEl = styled('span', 'atx-collections-field-name');
    nameEl.textContent = f.name;
    head.append(nameEl);
    if (!inSchema) head.append(badge('not in schema', 'muted'));
    head.append(styled('span', 'atx-collections-spacer'));

    const listeners: Array<() => void> = [];
    const fire = (): void => listeners.forEach((fn) => fn());

    let removed = false;
    // Ghost, not danger: clicking this only *queues* a removal — the card dims and
    // the label becomes "Undo remove", and nothing is written until Save. Eight
    // red buttons down a field list would also shout louder than the field names.
    const removeBtn = footButton('Remove', 'ghost', () => {
      removed = !removed;
      if (removed) removals.add(f.name);
      else removals.delete(f.name);
      removeBtn.textContent = removed ? 'Undo remove' : 'Remove';
      card.toggleAttribute('data-removed', removed);
      fire();
    });
    if (schemaEditable) head.append(removeBtn);
    card.append(head);

    // --- schema half ---------------------------------------------------------
    const typeSel = select(
      SCHEMA_TYPES.map((t) => [t, TYPE_LABEL[t]] as [string, string]),
      SCHEMA_TYPES.includes(f.type) ? f.type : '',
      fire,
    );
    if (!SCHEMA_TYPES.includes(f.type)) {
      // e.g. a `json` field: offer the choices without claiming the current one.
      const unknown = document.createElement('option');
      unknown.value = '';
      unknown.textContent = TYPE_LABEL[f.type] ?? f.type;
      typeSel.prepend(unknown);
      typeSel.value = '';
    }
    const requiredBox = checkbox('Required', f.required, fire);
    const defaultInput = input(
      f.defaultValue === undefined ? '' : String(f.defaultValue),
      'no default',
      fire,
    );
    const optionsInput = input((f.options ?? []).join(', '), 'Option, Option, …', fire);
    const optionsRow = controlRow('Options', [optionsInput]);
    const syncOptions = (): void => {
      optionsRow.toggleAttribute('data-hidden', typeSel.value !== 'select');
    };
    typeSel.addEventListener('change', syncOptions);

    const schemaGroup = group('Schema', [
      controlRow('Type', [typeSel]),
      controlRow('Required', [requiredBox.root]),
      controlRow('Default', [defaultInput]),
      optionsRow,
    ]);
    syncOptions();
    if (!schemaEditable) {
      for (const el of schemaGroup.querySelectorAll('input, select')) {
        (el as HTMLInputElement).disabled = true;
      }
      schemaGroup.toggleAttribute('data-off', true);
    }
    card.append(schemaGroup);

    // --- editor half ---------------------------------------------------------
    const o = c.overrides[f.name] ?? {};
    const overrideLocked = c.lockedFields.includes(f.name);
    const widgetSel = select(WIDGET_CHOICES, o.widget ?? '', fire);
    const labelInput = input(o.label ?? '', f.label, fire);
    const hiddenBox = checkbox('Hidden', o.hidden === true, fire);
    const editorGroup = group('Editor', [
      controlRow('Widget', [widgetSel]),
      controlRow('Label', [labelInput]),
      controlRow('Hidden', [hiddenBox.root]),
    ]);
    if (overrideLocked) {
      // astro.config.mjs owns this field's override, and config wins at resolve
      // time — so accepting input here would store a value that does nothing.
      for (const el of editorGroup.querySelectorAll('input, select')) {
        (el as HTMLInputElement).disabled = true;
      }
      editorGroup.append(
        note(
          [icon('lock', 12), textNode('Set in astro.config.mjs, which takes precedence.')],
          'muted',
        ),
      );
    }
    card.append(editorGroup);

    if (inSchema) {
      const exprEl = styled('code', 'atx-collections-expr');
      exprEl.textContent = expr;
      card.append(exprEl);
    }

    const currentSpec = (): SchemaFieldSpec => ({
      name: f.name,
      type: (typeSel.value || f.type) as FieldType,
      required: requiredBox.input.checked,
      ...(defaultInput.value.trim() ? { defaultValue: defaultInput.value.trim() } : {}),
      ...(typeSel.value === 'select'
        ? { options: optionsInput.value.split(',').map((s) => s.trim()).filter(Boolean) }
        : {}),
    });
    const initialSpec = JSON.stringify({
      type: SCHEMA_TYPES.includes(f.type) ? f.type : '',
      required: f.required,
      def: f.defaultValue === undefined ? '' : String(f.defaultValue),
      options: (f.options ?? []).join(', '),
    });
    const nowSpec = (): string =>
      JSON.stringify({
        type: typeSel.value,
        required: requiredBox.input.checked,
        def: defaultInput.value.trim(),
        options: optionsInput.value,
      });

    /** A locked field reports its effective value unchanged, so it can never be
     *  read as dirty and can never be sent. */
    const currentOverride = (): FieldOverride =>
      overrideLocked
        ? normalize(o)
        : {
            ...(widgetSel.value ? { widget: widgetSel.value as FieldType } : {}),
            ...(labelInput.value.trim() ? { label: labelInput.value.trim() } : {}),
            ...(hiddenBox.input.checked ? { hidden: true } : {}),
          };
    const initialOverride = JSON.stringify(normalize(o));

    return {
      name: f.name,
      root: card,
      removed: () => removed,
      schemaChange: () =>
        !removed && schemaEditable && nowSpec() !== initialSpec ? currentSpec() : null,
      overrideChange: () => {
        const next = currentOverride();
        if (JSON.stringify(normalize(next)) === initialOverride) return undefined;
        return Object.keys(next).length > 0 ? next : null;
      },
      dirty: () =>
        removed ||
        (schemaEditable && nowSpec() !== initialSpec) ||
        JSON.stringify(normalize(currentOverride())) !== initialOverride,
      onChange: (fn) => listeners.push(fn),
    };
  }

  // --- saving ----------------------------------------------------------------
  async function saveDetail(c: CollectionSummary, error: HTMLElement): Promise<void> {
    error.toggleAttribute('data-on', false);
    const update = editors.map((e) => e.schemaChange()).filter((s): s is SchemaFieldSpec => s !== null);
    const overrides: Record<string, FieldOverride | null> = {};
    for (const e of editors) {
      const next = e.overrideChange();
      if (next !== undefined) overrides[e.name] = next;
    }
    const remove = [...removals];
    if (update.length + remove.length + queuedAdds.length === 0 && Object.keys(overrides).length === 0) {
      showError(error, 'Nothing has changed yet.');
      return;
    }

    busy = true;
    // Set before the request, because the reload the write triggers can arrive
    // before its response does. Corrected below if nothing was in fact written.
    const willReload = update.length + remove.length + queuedAdds.length > 0;
    if (willReload) remember(c.name);
    try {
      const result = await api.applyCollectionSchema({
        collection: c.name,
        ...(data?.etag ? { etag: data.etag } : {}),
        ...(update.length + remove.length + queuedAdds.length > 0
          ? { schema: { update, remove, add: queuedAdds } }
          : {}),
        ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
      });
      if (!result.schemaWritten) remember(null);
      const wrote = [
        result.schemaWritten ? 'schema' : null,
        result.overridesWritten ? 'editor settings' : null,
      ].filter(Boolean);
      toast(wrote.length ? `Saved ${wrote.join(' and ')}` : 'Nothing to change', 'ok');
      if (!result.ok && result.error) showError(error, result.error);
      resetPending();
      // Re-read: the config etag has moved on, and the schema the entry drawer
      // sees comes from Astro's own module graph, not from this response.
      load();
    } catch (err) {
      remember(null);
      showError(
        error,
        err instanceof Error ? err.message : 'Could not save the collection changes.',
      );
    } finally {
      busy = false;
    }
  }

  // --- the create form -------------------------------------------------------
  function renderCreate(d: CollectionsResponse): HTMLElement {
    const wrap = styled('div', 'atx-collections-create');
    const head = styled('div', 'atx-collections-head atx-collections-head-create');
    head.append(backLink(goList));
    const title = styled('span', 'atx-collections-title');
    title.textContent = 'New collection';
    head.append(title);
    wrap.append(head);
    wrap.append(
      blurb(
        `Appends a defineCollection block to ${d.configPath ?? 'the content config'}, registers ` +
          'the name in `export const collections`, and creates the entry directory.',
      ),
    );

    const nameInput = input('', 'notes', () => {
      createDirty = nameInput.value.trim().length > 0;
      if (!dirTouched) dirInput.value = nameInput.value.trim() ? `src/content/${nameInput.value.trim()}` : '';
      refresh();
    });
    let dirTouched = false;
    const dirInput = input('', 'src/content/notes', () => {
      dirTouched = true;
      refresh();
    });
    const patternInput = input('**/*.md', '**/*.md', refresh);
    wrap.append(
      controlRow('Name', [nameInput]),
      controlRow('Directory', [dirInput]),
      controlRow('Pattern', [patternInput]),
    );

    const error = styled('p', 'atx-collections-error');

    const fieldList = styled('div', 'atx-collections-newfields');
    const repaintFields = (): void => {
      fieldList.textContent = '';
      fieldList.append(caption('Fields'));
      if (newFields.length === 0) {
        fieldList.append(blurb('No fields yet — a collection needs at least one.'));
      }
      for (const spec of newFields) {
        fieldList.append(
          pendingRow(spec, () => {
            newFields = newFields.filter((s) => s !== spec);
            repaintFields();
            refresh();
          }),
        );
      }
    };
    repaintFields();
    wrap.append(fieldList);

    const form = buildFieldSpecForm(null, (spec) => {
      if (newFields.some((s) => s.name === spec.name)) {
        showError(error, `"${spec.name}" is already in the list.`);
        return false;
      }
      newFields.push(spec);
      repaintFields();
      refresh();
      return true;
    });
    wrap.append(form.root);

    const actions = styled('div', 'atx-collections-actions atx-collections-actions-create');
    const createBtn = footButton('Create collection', 'default', () => void create());
    actions.append(createBtn);
    wrap.append(actions, error);

    function refresh(): void {
      setButtonEnabled(createBtn, nameInput.value.trim().length > 0 && newFields.length > 0);
    }
    refresh();

    async function create(): Promise<void> {
      error.toggleAttribute('data-on', false);
      busy = true;
      remember(nameInput.value.trim());
      try {
        const created = await api.createCollection({
          name: nameInput.value.trim(),
          ...(dirInput.value.trim() ? { dir: dirInput.value.trim() } : {}),
          ...(patternInput.value.trim() ? { pattern: patternInput.value.trim() } : {}),
          fields: newFields,
          ...(d.etag ? { etag: d.etag } : {}),
        });
        toast(`Created ${created.name} in ${created.dir}`, 'ok');
        selected = created.name;
        creating = false;
        resetPending();
        load();
      } catch (err) {
        remember(null);
        showError(error, err instanceof Error ? err.message : 'Could not create the collection.');
      } finally {
        busy = false;
      }
    }

    return wrap;
  }

  /**
   * The one form used for both "add a field" and a new collection's starter
   * fields, so the two paths can't drift in what they accept.
   */
  function buildFieldSpecForm(
    c: CollectionSummary | null,
    accept: (spec: SchemaFieldSpec) => boolean,
  ): { root: HTMLElement } {
    const wrap = styled('div', 'atx-collections-addfield');
    wrap.append(caption('Add field'));

    const nameInput = input('', 'subtitle', () => {});
    // image() needs the function schema form; offering it against a plain
    // z.object would only produce a refusal on save.
    const allowImage = c === null || c.schemaForm === 'function';
    const types = SCHEMA_TYPES.filter((t) => t !== 'image' || allowImage);
    const typeSel = select(types.map((t) => [t, TYPE_LABEL[t]] as [string, string]), 'text', () => {
      optionsRow.toggleAttribute('data-hidden', typeSel.value !== 'select');
    });
    const requiredBox = checkbox('Required', true, () => {});
    const defaultInput = input('', 'no default', () => {});
    const optionsInput = input('', 'Option, Option, …', () => {});
    const optionsRow = controlRow('Options', [optionsInput]);
    optionsRow.toggleAttribute('data-hidden', true);

    wrap.append(
      controlRow('Name', [nameInput]),
      controlRow('Type', [typeSel]),
      controlRow('Required', [requiredBox.root]),
      controlRow('Default', [defaultInput]),
      optionsRow,
    );
    if (c && c.schemaForm !== 'function') {
      wrap.append(
        note(
          [
            textNode(
              'Image fields need Astro’s image() helper, which only a ' +
                '`({ image }) => z.object({ … })` schema receives. Convert this collection’s ' +
                'schema by hand to add one.',
            ),
          ],
          'muted',
        ),
      );
    }

    const addBtn = footButton('Add', 'outline', () => {
      const name = nameInput.value.trim();
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
        toast('A field name must be a plain identifier', 'err');
        return;
      }
      const ok = accept({
        name,
        type: typeSel.value as FieldType,
        required: requiredBox.input.checked,
        ...(defaultInput.value.trim() ? { defaultValue: defaultInput.value.trim() } : {}),
        ...(typeSel.value === 'select'
          ? { options: optionsInput.value.split(',').map((s) => s.trim()).filter(Boolean) }
          : {}),
      });
      if (!ok) return;
      nameInput.value = '';
      defaultInput.value = '';
      optionsInput.value = '';
    });
    wrap.append(addBtn);
    return { root: wrap };
  }

  return { root, load, isDirty };
}

// --- one field's editing state ----------------------------------------------

interface FieldEditor {
  name: string;
  root: HTMLElement;
  removed(): boolean;
  /** The full desired spec when the schema half changed, else null. Full, not a
   *  diff: `updateField` rewrites the whole expression. */
  schemaChange(): SchemaFieldSpec | null;
  /** The override to store, `null` to clear it, `undefined` when unchanged. */
  overrideChange(): FieldOverride | null | undefined;
  dirty(): boolean;
  onChange(fn: () => void): void;
}

// --- small DOM helpers ------------------------------------------------------

/** Which of the two voices a badge or a note speaks in: `warn` for something
 *  the user has to act on, `muted` for a state that is merely worth saying. */
type Tone = 'warn' | 'muted';

/** Two-store legend. The one piece of chrome that explains the whole drawer. */
function legend(): HTMLElement {
  const wrap = styled('div', 'atx-collections-legend');
  const line = (word: string, rest: string): HTMLElement => {
    const p = styled('p', 'atx-collections-legend-line');
    const strong = styled('strong', 'atx-collections-legend-word');
    strong.textContent = word;
    p.append(strong, document.createTextNode(` ${rest}`));
    return p;
  };
  wrap.append(
    line('Schema', 'writes your content config — committed source, and it changes what builds.'),
    line('Editor', 'writes .astro-dev-edit.json — local, and only this drawer reads it.'),
    line(
      '',
      'Saving a schema change rewrites that field’s expression in canonical form, and reloads ' +
        'the page as Astro resyncs — this drawer reopens here afterwards. A retype existing ' +
        'entries don’t satisfy will fail that sync until you update them.',
    ),
  );
  return wrap;
}

function group(title: string, rows: HTMLElement[]): HTMLElement {
  const wrap = styled('div', `atx-collections-group atx-collections-group-${title.toLowerCase()}`);
  wrap.append(caption(title));
  for (const r of rows) wrap.append(r);
  return wrap;
}

function caption(text: string): HTMLElement {
  const el = styled('div', 'atx-collections-caption');
  el.textContent = text;
  return el;
}

function controlRow(label: string, controls: HTMLElement[]): HTMLElement {
  const row = styled('label', 'atx-collections-control');
  const name = styled('span', 'atx-collections-control-label');
  name.textContent = label;
  row.append(name, ...controls);
  return row;
}

function input(value: string, placeholder: string, onChange: () => void): HTMLInputElement {
  const el = inputEl('input', 'atx-collections-input');
  el.type = 'text';
  el.value = value;
  el.placeholder = placeholder;
  el.spellcheck = false;
  el.addEventListener('input', onChange);
  return el;
}

function select(
  choices: ReadonlyArray<[string, string]>,
  value: string,
  onChange: () => void,
): HTMLSelectElement {
  const el = inputEl('select', 'atx-collections-select');
  for (const [v, label] of choices) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = label;
    el.append(opt);
  }
  el.value = value;
  el.addEventListener('change', onChange);
  return el;
}

function checkbox(
  label: string,
  checked: boolean,
  onChange: () => void,
): { root: HTMLElement; input: HTMLInputElement } {
  const wrap = styled('span', 'atx-collections-checkbox');
  const box = styled('input', 'atx-collections-check');
  box.type = 'checkbox';
  box.checked = checked;
  const hint = styled('span', 'atx-collections-check-hint');
  hint.textContent = checked ? 'Yes' : 'No';
  box.addEventListener('change', () => {
    hint.textContent = box.checked ? 'Yes' : 'No';
    onChange();
  });
  wrap.append(box, hint);
  wrap.setAttribute('aria-label', label);
  return { root: wrap, input: box };
}

function pendingRow(spec: SchemaFieldSpec, undo: () => void): HTMLElement {
  const row = styled('div', 'atx-collections-new');
  const name = styled('span', 'atx-collections-new-name');
  name.textContent = spec.name;
  const meta = styled('span', 'atx-collections-new-meta');
  meta.textContent =
    `${TYPE_LABEL[spec.type] ?? spec.type}${spec.required ? ' · required' : ' · optional'}` +
    (spec.defaultValue !== undefined ? ` · default ${String(spec.defaultValue)}` : '');
  row.append(name, meta, footButton('Remove', 'ghost', undo));
  return row;
}

function backLink(onClick: () => void): HTMLButtonElement {
  const btn = styled('button', 'atx-collections-back');
  btn.type = 'button';
  // The chevron is the forward one, turned around — one path, two directions.
  btn.append(icon('chevronRight', 12), document.createTextNode('Collections'));
  btn.addEventListener('click', onClick);
  return btn;
}

function badge(label: string, tone: Tone): HTMLElement {
  const el = styled('span', 'atx-collections-badge');
  el.dataset.tone = tone;
  el.textContent = label;
  return el;
}

function blurb(text: string): HTMLElement {
  const el = styled('p', 'atx-collections-blurb');
  el.textContent = text;
  return el;
}

function note(parts: Node[], tone: Tone): HTMLElement {
  const el = styled('p', 'atx-collections-note');
  el.dataset.tone = tone;
  el.append(...parts);
  return el;
}

/** Relative time, coarse. A listing needs "recent or not", not a timestamp. */
function when(mtime: number): string {
  if (!mtime) return 'unknown date';
  const mins = Math.round((Date.now() - mtime) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(mtime).toISOString().slice(0, 10);
}

function textNode(text: string): Text {
  return document.createTextNode(text);
}

function showError(el: HTMLElement, message: string): void {
  el.textContent = message;
  el.toggleAttribute('data-on', true);
}

/** An override with its empty keys dropped, for comparison. */
function normalize(o: FieldOverride): FieldOverride {
  return {
    ...(o.widget ? { widget: o.widget } : {}),
    ...(o.label ? { label: o.label } : {}),
    ...(o.hidden ? { hidden: true } : {}),
  };
}
