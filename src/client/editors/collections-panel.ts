import type {
  CollectionEntryItem,
  CollectionSummary,
  CollectionsResponse,
  FieldDescriptor,
  FieldOverride,
  FieldType,
  SchemaFieldSpec,
  SchemaForm,
} from '../../shared/protocol.ts';
import * as api from '../api.ts';
import { has } from '../features.ts';
import { clearHighlight } from '../hover.ts';
import { icon, type IconName } from '../icons.ts';
import {
  badge,
  buildTabs,
  footButton,
  inputEl,
  setButtonEnabled,
  styled,
  switchControl,
  toast,
} from '../ui.ts';
import { card, item, itemGroup } from '../group.ts';
import { openCopyPanel } from './copy-panel.ts';
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

/** What the `image` option says while the collection can't hold one. Named
 *  once: the select is rebuilt on render and re-labelled live by the switch. */
const IMAGE_UNAVAILABLE = 'Image — turn on Image fields above';

/**
 * The Type choices for a schema half, with `image` kept **visible but
 * unpickable** on a plain `z.object` schema rather than filtered out.
 *
 * `image()` is only in scope in the `({ image }) => z.object({ … })` form, so
 * the patcher refuses it otherwise — but silently dropping the option leaves
 * the reason nowhere the eye is looking. The select's popup is drawn by the
 * browser over whatever sits beneath it, so a note under the form is behind the
 * list at exactly the moment the question is asked. The disabled option says
 * *that* there is a change to make and points down; the note below says what
 * the change is, in full, once the popup is out of the way.
 */
function schemaTypeChoices(allowImage: boolean): Choice[] {
  return SCHEMA_TYPES.map((t) =>
    t === 'image' && !allowImage
      ? ([t, IMAGE_UNAVAILABLE, true] as Choice)
      : ([t, TYPE_LABEL[t]] as Choice),
  );
}

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
  /**
   * Hand the surface the one button that completes the view being shown, or
   * `null` for a view that completes nothing — the list is a place to look, not
   * a decision to make.
   *
   * The pane cannot draw it itself and be read: the field list is longer than
   * the drawer, so a Save at the end of it sits below the fold behind the
   * scroll while the footer band — the one place the eye goes for the decision
   * — holds nothing but Close. Called on every render, so the surface can
   * assume the previous button is spent.
   */
  onPrimary?(button: HTMLElement | null): void;
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
 * The pane below carries all the state; this is only its shell. The footer band
 * holds Close plus one slot the pane fills with whatever completes the view it
 * is currently showing — Save changes in a collection, Create collection in the
 * new-collection form, nothing at all in the list.
 *
 * It is a slot rather than a fixed drawer-wide Save because there is no such
 * thing here: a schema write and an override write are different stores, and one
 * button standing for both would have to lie about which it meant. What the slot
 * fixes is where the button *is*. Drawn at the end of the pane it sat below the
 * fold behind a field list longer than the drawer, leaving the band that every
 * other drawer uses for the decision holding only the way out.
 */
export function openCollectionsPanel(opts: CollectionsPanelOptions = {}): void {
  clearHighlight();

  // The footer's action slot, declared before the pane that fills it.
  const primary = styled('div', 'atx-collections-primary');

  const pane = buildCollectionsPane({
    // An entry drawer replaces this one rather than stacking on it (see
    // `handoff`). The dirty check runs first, so a queued field edit can't be
    // lost by clicking an entry.
    handoff: (open) => {
      if (!shell.close()) return;
      open();
    },
    ...(opts.collection ? { initialCollection: opts.collection } : {}),
    onPrimary: (button) => {
      primary.textContent = '';
      if (button) primary.append(button);
    },
  });

  const shell = openDrawer('Collections', {
    isDirty: () => pane.isDirty(),
    discardMessage: 'Discard unsaved collection changes?',
    // On the title rather than in a view, because it is true of the whole
    // designer — the list, a collection's fields and the create form alike —
    // and the title is the one thing that survives navigating between them.
    badge: badge('experimental', 'muted'),
    // Wider than the default drawer: a field row carries both stores' controls
    // side by side, and wrapping them would hide the split the legend explains.
    width: 'min(max(560px, 48vw), 96vw)',
    ...(opts.onClose ? { onClose: opts.onClose } : {}),
  });

  shell.body.append(pane.root);
  // Close first, then the slot: the pane's own action is the rightmost thing in
  // the band, where the confirm sits in every other drawer.
  shell.foot.append(footButton('Close', 'outline', () => shell.close()), primary);
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
  /** The schema form staged by the detail view's Image fields switch, or null
   *  while it still matches what the config says. Staged like every other schema
   *  edit and written by Save changes — a switch that wrote on flip would be the
   *  one control in this drawer that commits without being asked to. */
  let formChange: SchemaForm | null = null;
  /** The same switch on the create form, which has no config to compare to. */
  let createForm: SchemaForm = 'object';
  /** Field specs typed into the create form. */
  let newFields: SchemaFieldSpec[] = [];
  let createDirty = false;
  /**
   * Type selects that must re-answer "can this be an image?" when the switch
   * moves. Re-rendering the view instead would be simpler and wrong: it rebuilds
   * the field editors from the server's copy, throwing away every other staged
   * edit — so the switch would silently undo work.
   */
  let imageAvailability: Array<(allow: boolean) => void> = [];

  /**
   * Keep one Type select in step with the switch. `keepOwn` is for a field that
   * is *already* an image: its own type stays selectable whatever the switch
   * says, so the control can never fail to show the value it holds.
   */
  function bindImageChoice(sel: HTMLSelectElement, keepOwn = false): HTMLSelectElement {
    const opt = [...sel.options].find((o) => o.value === 'image');
    if (opt) {
      imageAvailability.push((allow) => {
        const on = allow || (keepOwn && sel.value === 'image');
        opt.disabled = !on;
        opt.textContent = on ? TYPE_LABEL.image : IMAGE_UNAVAILABLE;
      });
    }
    return sel;
  }

  const setImageAvailable = (allow: boolean): void => {
    for (const fn of imageAvailability) fn(allow);
  };

  /** What a collection's schema form *would* be if the pending edits were saved.
   *  Every Type control asks this rather than `c.schemaForm`, so ticking the
   *  switch makes Image pickable in the same sitting rather than after a save. */
  const wantedForm = (c: CollectionSummary): SchemaForm =>
    formChange ?? c.schemaForm ?? 'object';
  /** Consumed by the first load, so a later navigation isn't hijacked. */
  let initial = opts.initialCollection ?? null;

  const resetPending = (): void => {
    editors = [];
    queuedAdds = [];
    removals = new Set();
    formChange = null;
    createForm = 'object';
    newFields = [];
    createDirty = false;
    imageAvailability = [];
  };

  const isDirty = (): boolean =>
    !busy &&
    (queuedAdds.length > 0 ||
      removals.size > 0 ||
      formChange !== null ||
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
    opts.onPrimary?.(null);
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
    opts.onPrimary?.(null);
    // The editor list belongs to the DOM this call is about to build. Without
    // clearing it, a return to this view would leave detached editors from the
    // previous render in the dirty check and in the next save's payload. The
    // image-availability hooks are per-render for the same reason: they close
    // over selects this call is about to replace.
    editors = [];
    imageAvailability = [];
    if (!data) return;
    if (creating) root.append(renderCreate(data));
    else if (selected) {
      const found = data.collections.find((c) => c.name === selected);
      root.append(found ? renderDetail(data, found) : renderList(data));
    } else root.append(renderList(data));
  }

  /**
   * The one control that decides whether a collection's detail pages offer the
   * entry drawer — what replaces hand-emitting the page-source meta tag.
   *
   * It sits on the **list row** and **saves on the flip**, which is deliberate
   * on both counts: this view has no Save button (`onPrimary(null)`), and
   * switching several collections on is the first thing anyone does here.
   *
   * A row is its own hit target, so the switch has to stop its own events
   * reaching it — otherwise every flip would also navigate into the collection.
   */
  function pageEditingSwitch(c: CollectionSummary): HTMLElement {
    // A switch, not a checkbox: this is a live capability that is on or off
    // right now, not an answer inside a form waiting for Save. It is named
    // rather than labelled On/Off — "On" beside a collection says nothing about
    // *what* is on, and the row has room for the two words that do.
    const sw = switchControl(
      'Content editor',
      c.pageEditing,
      (wanted) => {
        sw.input.disabled = true;
        void api.setCollectionPageEditing({ collection: c.name, enabled: wanted }).then(
          () => {
            toast(`Content editor ${wanted ? 'on' : 'off'} for ${c.name}`, 'ok');
            // Reload rather than patch the row in place: the detected route and
            // the "no detail route" badge are part of the same answer, and a row
            // that kept a stale one would be worse than a brief spinner.
            load();
          },
          (err: unknown) => {
            sw.input.checked = !wanted;
            sw.input.disabled = false;
            toast(err instanceof Error ? err.message : 'Could not save', 'err');
          },
        );
      },
      // Every row says "Content editor"; the name has to say which one.
      `Content editor for ${c.name}`,
    );
    sw.root.classList.add('atx-collections-pageedit');
    if (c.pageEditingLocked) {
      sw.input.disabled = true;
      sw.root.append(icon('lock', 12));
      sw.root.title = 'Set in astro.config.mjs, which takes precedence.';
    }
    // The row owns click and Enter/Space; without this every flip navigates.
    sw.root.addEventListener('click', (e) => e.stopPropagation());
    sw.root.addEventListener('keydown', (e) => e.stopPropagation());
    return sw.root;
  }

  function renderList(d: CollectionsResponse): HTMLElement {
    const wrap = styled('div', 'atx-collections-list');

    // One card: what these are, where they are declared, and — in the corner —
    // the one action that adds to them. "New" is a header action rather than a
    // button trailing the list, so it reads as belonging to the collection set
    // rather than to the last row.
    const n = d.collections.length;
    const listCard = card({
      // The count rather than the word "Collections", which the drawer's own
      // title already said 30px above this line.
      title: n === 1 ? '1 collection' : `${n} collections`,
      description: d.configPath
        ? `Declared in ${d.configPath}. Open one to edit its fields.`
        : 'This project has no content config. Create src/content.config.ts to use the designer.',
      ...(d.configPath && d.schemaEditor
        ? { action: newCollectionButton(goCreate) }
        : {}),
    });
    wrap.append(listCard.root);

    if (!d.schemaEditor) {
      listCard.body.append(
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

    const list = itemGroup({ bleed: true });
    for (const c of d.collections) {
      const row = item({
        title: c.name,
        description: `${c.dir} · ${c.entryCount} ${c.entryCount === 1 ? 'entry' : 'entries'} · ${c.fields.length} fields`,
        media: icon('collections', 16),
        actions: [pageEditingSwitch(c)],
      });
      // The route the switch actually affects, on its own line rather than
      // appended to the description: it answers a different question — not
      // "what is this collection" but "where would turning this on show up" —
      // and a dot-separated list that wraps leaves a separator dangling. Shown
      // whether the switch is on or off, so you can see what it would do before
      // you do it.
      if (c.detailRoute) {
        const route = styled('div', 'atx-collections-route');
        route.append(icon('file', 11), textNode(c.detailRoute));
        row.content.append(route);
      }
      row.root.classList.add('atx-collections-row', `atx-collections-row-${c.name}`);
      // A row is the whole hit target, so it carries the button semantics
      // rather than nesting a button that would only cover its label.
      row.root.role = 'button';
      row.root.tabIndex = 0;
      if (!c.registered) row.title.append(badge('not registered', 'warn'));
      if (c.schemaForm === null) row.title.append(badge('no readable schema', 'muted'));
      if (c.fieldSource === 'source' && c.schemaForm !== null) {
        row.title.append(badge('schema not loaded', 'warn'));
      }
      if (!c.dirExists) row.title.append(badge('directory missing', 'warn'));
      // Switched on with nothing to switch on *for*: worth saying, because the
      // user has just asked for a button that will not appear anywhere.
      if (c.pageEditing && !c.detailRoute) row.title.append(badge('no detail route', 'warn'));
      row.root.addEventListener('click', () => goDetail(c.name));
      row.root.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          goDetail(c.name);
        }
      });
      list.append(row.root);
    }
    listCard.body.append(list);
    return wrap;
  }

  /**
   * What the switch on the list row means for *this* collection.
   *
   * A note rather than a second switch: two controls bound to one value is a
   * source of disagreement, not convenience. What this adds instead is the
   * detail the row has no space for — which route was detected, and, when none
   * was, the meta tag that reaches these entries anyway.
   *
   * The tool deliberately does not write that tag into the project's layout: it
   * would have to guess the entry variable's name, how the layout is wrapped,
   * and where the document `<head>` lives — three guesses this project takes
   * nowhere else. Handing over the snippet is the honest substitute.
   */
  function pageEditingNote(c: CollectionSummary): HTMLElement {
    if (!c.pageEditing) {
      return note(
        [
          icon('file', 12),
          textNode(
            'Content editor is off. Switch it on in the collections list and ' +
              (c.detailRoute
                ? `${c.detailRoute} gets an Edit entry button.`
                : "this collection's detail pages get an Edit entry button."),
          ),
        ],
        'muted',
      );
    }
    if (c.detailRoute) {
      return note(
        [
          icon('file', 12),
          textNode(`Content editor is on — ${c.detailRoute} offers Edit entry, with no meta tag.`),
        ],
        'muted',
      );
    }
    const snippet =
      '{import.meta.env.DEV && (\n' +
      '  <meta name="astro-dev-edit:page-source" content={entry.filePath} />\n' +
      ')}';
    const n = note(
      [
        icon('alert', 12),
        textNode(
          'Content editor is on, but no route naming this collection was found — it may ' +
            "fetch its entries through a helper. Emit this in the detail page's <head>, " +
            'with your own entry variable, and the drawer works there too:',
        ),
      ],
      'warn',
    );
    const pre = styled('pre', 'atx-collections-snippet');
    pre.textContent = snippet;
    n.classList.add('atx-collections-note-snippet');
    n.append(pre, cornerButton('Copy', 'copy', () => void copySnippet(c.name, snippet)));
    return n;
  }

  async function copySnippet(collection: string, snippet: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(snippet);
      toast(`Copied the meta tag for ${collection}`, 'ok');
    } catch {
      // The same fallback the copy-context flow takes: an insecure context has
      // no clipboard API, and a panel the user can select from still works.
      openCopyPanel(`${collection} page-source meta`, snippet);
    }
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
      const openBtn = cornerButton('Open source', 'code', () => {
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
    wrap.append(pageEditingNote(c));

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
    if (c.opaqueEntries?.length) {
      // Not a warning: the schema is fine and most of it is editable. This says
      // which part isn't, so a disabled control reads as a boundary rather than
      // as the designer being broken.
      const what = c.opaqueEntries.join(', ');
      fieldsPane.append(
        note(
          [
            icon('lock', 12),
            textNode(
              `This schema builds ${c.opaqueEntries.length === 1 ? 'part' : 'parts'} of its field ` +
                `list from ${what}, which is declared elsewhere. The fields ${
                  c.opaqueEntries.length === 1 ? 'it brings' : 'they bring'
                } in are ` +
                'read-only here — edit them where they are declared. Every field written out in ' +
                'this schema stays editable, and a new one can still be added.',
            ),
          ],
          'muted',
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

    // Above the fields, because it decides what a field is allowed to be. The
    // switch is a schema write like any other, so `schemaEditor: false` and an
    // unreadable schema lock it for the same reasons they lock a type.
    if (c.schemaForm !== null) {
      fieldsPane.append(
        imageSwitch(
          wantedForm(c),
          writable
            ? null
            : 'Schema editing is off, so the form of this schema can’t be changed here.',
          (form) => {
            formChange = form === c.schemaForm ? null : form;
            refreshSave();
          },
        ),
      );
    }

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

    const saveBtn = footButton('Save changes', 'default', () => void saveDetail(c, error));
    opts.onPrimary?.(saveBtn);
    fieldsPane.append(error);

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
    // Astro resolved it, but the config text doesn't write it out: it arrives
    // through an entry the patcher skipped. Saying "not in schema" about a field
    // that plainly *is* in the schema would read as a bug in the panel.
    const elsewhere = !inSchema && f.source === 'schema' && Boolean(c.opaqueEntries?.length);
    const schemaEditable = writable && inSchema && f.type !== 'json';

    const card = styled('div', `atx-collections-field atx-collections-field-${f.name}`);

    const head = styled('div', 'atx-collections-field-head');
    const nameEl = styled('span', 'atx-collections-field-name');
    nameEl.textContent = f.name;
    head.append(nameEl);
    if (!inSchema) head.append(badge(elsewhere ? 'declared elsewhere' : 'not in schema', 'muted'));
    head.append(styled('span', 'atx-collections-spacer'));

    const listeners: Array<() => void> = [];
    const fire = (): void => listeners.forEach((fn) => fn());

    let removed = false;
    // Outline, not danger: clicking this only *queues* a removal — the card dims
    // and the label becomes "Undo remove", and nothing is written until Save.
    // Eight red buttons down a field list would also shout louder than the field
    // names. What it must not be is a bare word: it is the only control in the
    // card's header and has to look like one.
    const removeBtn = cornerButton('Remove', null, () => {
      removed = !removed;
      if (removed) removals.add(f.name);
      else removals.delete(f.name);
      removeBtn.textContent = removed ? 'Undo remove' : 'Remove';
      card.toggleAttribute('data-removed', removed);
      fire();
    });
    if (schemaEditable) head.append(removeBtn);
    card.append(head);

    // The two stores sit side by side, not stacked: they hold the *same* field
    // and the point of the card is that you can read one against the other.
    // The grid collapses to one column when the drawer is too narrow to keep
    // a control legible beside its label.
    const stores = styled('div', 'atx-collections-stores');

    // --- schema half ---------------------------------------------------------
    const typeSel = bindImageChoice(
      select(
        // A field that is *already* an image stays pickable whatever the form
        // says, so its own type can't become unselectable underneath it.
        schemaTypeChoices(wantedForm(c) === 'function' || f.type === 'image'),
        SCHEMA_TYPES.includes(f.type) ? f.type : '',
        fire,
      ),
      true,
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
    stores.append(schemaGroup);

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
    stores.append(editorGroup);
    card.append(stores);

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
    const form = formChange;
    const schemaEdits = update.length + remove.length + queuedAdds.length + (form ? 1 : 0);
    if (schemaEdits === 0 && Object.keys(overrides).length === 0) {
      showError(error, 'Nothing has changed yet.');
      return;
    }

    busy = true;
    // Set before the request, because the reload the write triggers can arrive
    // before its response does. Corrected below if nothing was in fact written.
    const willReload = schemaEdits > 0;
    if (willReload) remember(c.name);
    try {
      const result = await api.applyCollectionSchema({
        collection: c.name,
        ...(data?.etag ? { etag: data.etag } : {}),
        ...(schemaEdits > 0
          ? { schema: { ...(form ? { form } : {}), update, remove, add: queuedAdds } }
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

    wrap.append(
      imageSwitch(createForm, null, (form) => {
        createForm = form;
        createDirty = true;
        refresh();
      }),
    );

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

    const createBtn = footButton('Create collection', 'default', () => void create());
    opts.onPrimary?.(createBtn);
    wrap.append(error);

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
          schemaForm: createForm,
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
   * The Image fields switch — the one control that decides which schema form is
   * written, on both the create form and an existing collection.
   *
   * It exists because the form used to be *inferred*: adding an image field to a
   * new collection quietly emitted the function form, and an existing plain
   * collection had no way to reach it at all. Inference is a poor fit here — the
   * form is a visible property of the user's own committed source, and which one
   * they get should be something they chose, not something they triggered.
   *
   * `onFlip` receives the form now wanted. Nothing is written: the detail view
   * stages it for Save changes, the create form holds it until Create.
   */
  function imageSwitch(
    current: SchemaForm,
    locked: string | null,
    onFlip: (form: SchemaForm) => void,
  ): HTMLElement {
    const c = card({
      title: 'Image fields',
      description:
        'Writes the schema as ({ image }) => z.object({ … }), which is the only form ' +
        'Astro gives its image() helper. Turn this on to add image fields.',
    });
    const box = checkbox(
      'Image fields',
      current === 'function',
      () => {
        const form: SchemaForm = box.input.checked ? 'function' : 'object';
        setImageAvailable(form === 'function');
        onFlip(form);
      },
      ['On', 'Off'],
    );
    if (locked) {
      box.input.disabled = true;
      c.body.append(box.root, note([icon('lock', 12), textNode(locked)], 'muted'));
    } else {
      c.body.append(box.root);
    }
    return c.root;
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
    // Both views ask the same question — what will the schema form be when this
    // is saved — so neither has a rule of its own about image().
    const allowImage = (c === null ? createForm : wantedForm(c)) === 'function';
    const typeSel = bindImageChoice(
      select(schemaTypeChoices(allowImage), 'text', () => {
        optionsRow.toggleAttribute('data-hidden', typeSel.value !== 'select');
      }),
    );
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

/** Which of the two voices a note speaks in: `warn` for something the user has
 *  to act on, `muted` for a state that is merely worth saying. */
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

/** A choice: value, label, and whether it is shown but unpickable. */
type Choice = readonly [value: string, label: string, disabled?: boolean];

function select(
  choices: ReadonlyArray<Choice>,
  value: string,
  onChange: () => void,
): HTMLSelectElement {
  const el = inputEl('select', 'atx-collections-select');
  for (const [v, label, disabled] of choices) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = label;
    if (disabled) opt.disabled = true;
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
  /** The words beside the box. A required flag reads Yes/No; a switch that turns
   *  a capability on reads On/Off, because "Yes" answers nothing there. */
  words: readonly [on: string, off: string] = ['Yes', 'No'],
): { root: HTMLElement; input: HTMLInputElement } {
  const wrap = styled('span', 'atx-collections-checkbox');
  const box = styled('input', 'atx-collections-check');
  box.type = 'checkbox';
  box.checked = checked;
  const hint = styled('span', 'atx-collections-check-hint');
  hint.textContent = checked ? words[0] : words[1];
  box.addEventListener('change', () => {
    hint.textContent = box.checked ? words[0] : words[1];
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
  row.append(name, meta, cornerButton('Remove', null, undo));
  return row;
}

/**
 * A control that belongs to the surface it sits on rather than to a footer: a
 * card header's corner action, or the detail view's way back. One size down
 * and outlined, which is the shape `newCollectionButton` already uses — these
 * are the same kind of thing and reading as one family is the point.
 */
function cornerButton(
  label: string,
  glyph: IconName | null,
  onClick: () => void,
): HTMLButtonElement {
  const btn = footButton(label, 'outline', onClick);
  btn.classList.add('atx-btn-sm');
  if (glyph) btn.prepend(icon(glyph, 16));
  return btn;
}

function backLink(onClick: () => void): HTMLButtonElement {
  const btn = cornerButton('Collections', null, onClick);
  btn.classList.add('atx-collections-back');
  // The chevron is the forward one, turned around — one path, two directions.
  btn.prepend(icon('chevronRight', 16));
  return btn;
}

/** The collection list's corner action, the same shape the entry drawer's
 *  "New" uses, because it is the same kind of thing. */
function newCollectionButton(onClick: () => void): HTMLButtonElement {
  return cornerButton('New', 'plus', onClick);
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
