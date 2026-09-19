import type { SourceLoc, UsageLink } from '../shared/protocol.ts';
import * as api from './api.ts';
import { readRenderOccurrences, wrappedSlot } from './composition-dom.ts';
import { chainOrdinals } from './render-occurrences.ts';
import { buildRuleBlock, rulesForElement } from './css-inspect.ts';
import { buildImagePicker } from './editors/image.ts';
import { has } from './features.ts';
import { icon, type IconName } from './icons.ts';
import { card, item, itemGroup } from './group.ts';
import { createInspectorLoader, occurrenceSummary, passedLabel, passedRows } from './inspector-model.ts';
import { nearestOwnSource, sourceFor } from './source-map.ts';
import type { StagedValues } from './staged-values.ts';
import type { LayoutMode } from './layout.ts';
import { basename, footButton, inputEl, isolateScroll, setButtonEnabled, styled, toast } from './ui.ts';
import { typesOnPage, writable, type ElementTarget, type ValueTarget } from './value-model.ts';
import { buildValueRows, chainBadges, type ValueRow, type ValueRows, type ValueSelection } from './value-rows.ts';

export interface InspectorDeps {
  viewCode(source: SourceLoc): void;
  openRule(file: string, selector: string): void;
  /** The Markdown entry this route renders, when the page declares one. Null
   *  is not a cue to go looking — an unresolved entry opens the template. */
  markdownEntry(): string | null;
  /** The file this route is written in, root-relative, or null while it is
   *  unresolved. The jump of last resort, and never a guessed one. */
  routeFile(): string | null;
  onClose(): void;
  /** The layout switch this panel's header carries. Read lazily, never
   *  captured: the layout is built *after* the panels it measures, and the
   *  effective mode changes on its own when the window gets too narrow. */
  layout: {
    mode(): LayoutMode;
    toggle(): void;
  };
  /** Element-scoped counterpart to the launcher menu's page context: the
   *  selector, the source loc, the chain and the applied CSS, as one paste. */
  copyContext(el: HTMLElement, source: SourceLoc): void;
  /** The one staged-value store the panel and the page share. */
  staging: StagedValues;
}

/** One panel per click. Values that the write path can serve carry a field and
 *  one Save/Revert pair; everything else is read-only and says why. */
export function initInspector(deps: InspectorDeps) {
  const root = styled('aside', 'atx-inspector');
  root.setAttribute('aria-label', 'Source inspector');
  // Two bands, as the wireframe has them. The title bar names the tool and
  // what is selected, and carries only the one control that leaves the panel.
  // Everything that is an *answer* about the selection — how far the chain is
  // proven, whether the page matches disk — belongs to the status row below
  // it, with the one action scoped to this element beside them.
  const header = styled('div', 'atx-inspector-header');
  const title = styled('strong', 'atx-inspector-title');
  title.textContent = 'Inspector';
  const tag = styled('span', 'atx-inspector-tag');
  // The one control that changes the *shape* of the session rather than the
  // selection: overlay, where the panels float over the page, or docked, where
  // the page is squeezed between them with the code dock under it. It sits next
  // to Close because both are about the panel rather than about the element,
  // and it is a view preference — per developer, in localStorage, never a
  // project setting in OPTION_SPECS.
  const layoutButton = styled('button', 'atx-tree-action');
  layoutButton.type = 'button';
  layoutButton.append(icon('sidebar', 16));
  layoutButton.addEventListener('click', () => {
    deps.layout.toggle();
    syncLayout();
  });

  /** Paint the switch from the *effective* mode — a window too narrow to dock
   *  stays overlay, and the button must not claim otherwise. */
  function syncLayout(): void {
    const docked = deps.layout.mode() === 'docked';
    layoutButton.toggleAttribute('data-on', docked);
    const label = docked
      ? 'Float the panels over the page'
      : 'Dock the panels beside the page';
    layoutButton.title = label;
    layoutButton.setAttribute('aria-label', label);
    layoutButton.setAttribute('aria-pressed', String(docked));
  }
  // Deliberately not painted here: the layout measures this very panel, so it
  // does not exist yet. The composition root paints it the moment it does.

  const closeButton = styled('button', 'atx-tree-action');
  closeButton.type = 'button';
  closeButton.title = 'Close (Esc)';
  closeButton.setAttribute('aria-label', 'Close the inspector');
  closeButton.append(icon('x', 16));
  closeButton.addEventListener('click', close);
  header.append(title, tag, layoutButton, closeButton);

  const status = styled('div', 'atx-inspector-status');
  /** One word on whether the chain can be trusted. Hidden until an answer
   *  arrives, because "no tier yet" and "no chain" are different things. */
  const tier = styled('span', 'atx-tier');
  tier.hidden = true;
  /** Whether what is on screen for this selection is what is on disk. It sits
   *  here because it is the selection's answer, not a row's — and it is the
   *  one place a panel covering the page can still report the amber. */
  const saveState = styled('span', 'atx-value-chip');
  const copyButton = footButton('Copy context', 'outline', () => {
    if (selected) deps.copyContext(selected, sourceFor(selected) ?? { file: '', loc: '' });
  });
  copyButton.classList.add('atx-btn-sm');
  copyButton.title = 'Copy this element’s selector, source loc, chain and CSS';
  status.append(tier, saveState, copyButton);

  const body = styled('div', 'atx-inspector-body');
  isolateScroll(body);
  root.append(header, status, body);
  const loader = createInspectorLoader(api);
  let selected: HTMLElement | null = null;
  let generation = 0;
  /** The chain card of the current selection, for {@link focusUsage}. */
  let chainBody: HTMLElement | null = null;
  /** One per field on screen: a field reads the store, so it has to stop
   *  reading it when the row it belongs to is replaced. */
  let bindings: (() => void)[] = [];
  /** The selection's own value, when the page can be typed into for it. Kept
   *  so re-clicking the element already selected puts the caret back rather
   *  than answering with the panel it is already showing. */
  let pageEdit: { target: ElementTarget; original: string } | null = null;

  function unbind() {
    for (const stop of bindings) stop();
    bindings = [];
  }

  /** Whether a write has landed since the panel opened. `saved` reports that
   *  it did; with nothing pending and nothing written the chip has nothing to
   *  say, and a permanent "saved" on a panel that has never written anything
   *  is a claim about the file the panel has not earned. */
  let wrote = false;

  function paintSaveState() {
    const dirty = deps.staging.pending().length;
    saveState.hidden = !dirty && !wrote;
    saveState.textContent = dirty ? `${dirty} unsaved` : 'saved';
    saveState.dataset.chip = dirty ? 'unsaved' : 'editable';
  }
  deps.staging.onChange(paintSaveState);

  function close() {
    const wasOpen = selected !== null;
    generation++;
    loader.invalidate();
    unbind();
    deps.staging.stopEditing();
    selected = null;
    pageEdit = null;
    chainBody = null;
    wrote = false;
    paintSaveState();
    root.removeAttribute('data-on');
    // Leaving with work pending is allowed and is the point — but it is never
    // silent, because the only other signal is an outline on a page the panel
    // was covering. Only on a real close: an invalidation of a panel that was
    // not open has nothing to report.
    const pending = wasOpen ? deps.staging.pending().length : 0;
    if (pending) toast(`Closed with ${pending} unsaved ${pending === 1 ? 'value' : 'values'} — still marked on the page`, 'warn');
    deps.onClose();
  }

  /**
   * Bring one chain row to the eye: the hover pill's breadcrumb names a usage
   * id (or `'route'`), and the panel answers by marking and scrolling to that
   * row — never by reselecting, because the clicked element is what the rest of
   * the panel describes and a breadcrumb is a way *into* it, not a new
   * selection. An id the chain does not carry marks nothing rather than
   * scrolling to something adjacent and implying it is the answer.
   */
  function focusUsage(id: string | null): void {
    if (!chainBody) return;
    for (const marked of chainBody.querySelectorAll(':scope > [data-focus]')) marked.removeAttribute('data-focus');
    if (!id) return;
    // Scoped to the chain's own rows: the "usages on this route" list below it
    // renders the same links, and a focus that could land there would mark a
    // source usage site as if it were the one that rendered this element.
    const row = chainBody.querySelector(`:scope > [data-usage="${CSS.escape(id)}"]`);
    if (!(row instanceof HTMLElement)) return;
    row.setAttribute('data-focus', '');
    row.scrollIntoView({ block: 'nearest' });
  }

  function note(parent: HTMLElement, text: string) {
    const p = styled('p', 'atx-inspector-note');
    p.textContent = text;
    parent.append(p);
  }

  function codeButton(source: SourceLoc, label = 'View code') {
    const button = footButton(label, 'outline', () => deps.viewCode(source));
    button.title = `${source.file}:${source.loc}`;
    return button;
  }

  function sourceRow(parent: HTMLElement, label: string, src: SourceLoc, description?: string) {
    const row = item({ title: label, description: description ?? `${basename(src.file)}:${src.loc}`,
      actions: [codeButton(src)] }).root;
    parent.append(row);
    return row;
  }

  /**
   * One row of the indented chain.
   *
   * The chain is a nesting, and a flat list of cards was the one thing about
   * this panel that did not say so — so it is drawn as a tree: depth as
   * indent, an elbow to the row above, and the file's own glyph. Everything a
   * row can *do* stays folded until the row is the selected one, because a
   * five-deep chain with two buttons and a disclosure on every row is a wall.
   */
  interface ChainRow {
    depth: number;
    glyph: IconName;
    name: string;
    /** The mono second line — where it is used, or what it is. */
    sub: string;
    /** Marks the row findable by the breadcrumb, and clickable. */
    id?: string;
    kind?: 'leaf' | 'inferred';
    roles?: readonly string[];
    /** Revealed with the row, never before it. */
    actions?: readonly HTMLElement[];
    /** Extra detail revealed with the actions. */
    extra?: HTMLElement;
  }

  function chainRow(parent: HTMLElement, o: ChainRow) {
    const row = styled('div', 'atx-chain-row');
    row.style.setProperty('--atx-d', String(o.depth));
    if (o.kind) row.dataset.kind = o.kind;

    const glyph = styled('span', 'atx-chain-ic');
    glyph.append(icon(o.glyph, 13));

    const main = styled('div', 'atx-chain-main');
    const name = styled('div', 'atx-chain-name');
    name.textContent = o.name;
    for (const role of o.roles ?? []) {
      const pill = styled('span', 'atx-chain-role');
      pill.dataset.role = role;
      pill.textContent = role;
      name.append(pill);
    }
    const sub = styled('div', 'atx-chain-sub');
    sub.textContent = o.sub;
    sub.title = o.sub;
    main.append(name, sub);

    if (o.actions?.length || o.extra) {
      const acts = styled('div', 'atx-chain-acts');
      if (o.actions?.length) acts.append(...o.actions);
      if (o.extra) acts.append(o.extra);
      main.append(acts);
    }
    row.append(glyph, main);
    if (o.id) {
      // The breadcrumb names a link by id; the row it opens has to be findable.
      row.dataset.usage = o.id;
      row.tabIndex = 0;
      const open = () => focusUsage(row.hasAttribute('data-focus') ? null : o.id!);
      row.addEventListener('click', open);
      row.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
      });
    }
    parent.append(row);
    return row;
  }

  /** A chain row for a usage link. `selectionFile` lets it say which file owns
   *  the look and which holds the words; the values themselves are Values
   *  rows, so this row names its usage site rather than re-listing them. */
  function usage(parent: HTMLElement, link: UsageLink, selectionFile: string | null, depth = 0) {
    const passed = link.props.length + link.slots.length;
    let extra: HTMLElement | undefined;
    if (passed) {
      extra = styled('details', 'atx-inspector-details');
      const summary = styled('summary', '');
      // The count is the true number of values passed; the rows below it fold
      // indistinguishable slot runs, so the two legitimately differ.
      summary.textContent = `What this usage passes · ${passed}`;
      extra.append(summary);
      for (const row of passedRows(link)) note(extra, passedLabel(row));
    }
    return chainRow(parent, {
      depth, id: link.id, glyph: 'component', name: link.name,
      sub: link.target
        ? `used at ${basename(link.file)}:${link.loc}`
        : `unresolved · ${link.refusal ?? 'unresolved'} · at ${basename(link.file)}:${link.loc}`,
      roles: chainBadges(link, selectionFile),
      actions: [
        ...(link.target ? [codeButton({ file: link.target, loc: '1:1' })] : []),
        codeButton(link, 'Open parent'),
      ],
      extra,
    });
  }

  /**
   * Where a Markdown-backed chain stops, and why it is honest to stop there.
   *
   * `<Content />` is the Markdown renderer, not an `.astro` component, so no
   * chain threads through it and nothing it emits carries an annotation. The
   * link to the entry is therefore **inferred** — derived from the route's own
   * declaration of what it renders — and it says so rather than sitting in a
   * list of proven links looking like one of them.
   */
  function markdownChainEnd(parent: HTMLElement, entry: string, depth = 0) {
    chainRow(parent, { depth, glyph: 'doc', kind: 'inferred',
      name: 'Content — markdown, chain ends', sub: `renders ${basename(entry)}`,
      actions: [codeButton({ file: entry, loc: '1:1' })] });
    note(parent, 'Inferred · derived from the route’s template and the entry it renders, not proven like the links above it.');
  }

  /** Which of the element's own class tokens a selector names. A rule that
   *  matches without naming one — `a { … }`, a descendant rule — belongs to
   *  no chip and lands under *other*. */
  function ruleClasses(selector: string, classes: readonly string[]): string[] {
    return classes.filter(name =>
      new RegExp(`\\.${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(selector));
  }

  /**
   * The CSS group: which classes matched, and each matched rule as source.
   *
   * The rule blocks are `css-inspect.ts::buildRuleBlock`, the same ones the
   * hover pill's class chips pop — one renderer, one palette, one open jump.
   * The chips here filter that list and never reorder it: among equal
   * specificity the cascade *is* document order, so a ranked list would
   * misreport which rule wins.
   */
  function css(el: HTMLElement) {
    const section = card({ title: 'CSS', description: 'Selector matches in stylesheet order; conditional rules may be inactive. Computed values include inheritance.' });
    if (!has('cssInspector')) {
      note(section.body, 'CSS inspection is disabled in settings.');
      return section.root;
    }
    const openRule = (file: string, selector: string) => deps.openRule(file, selector);
    const inline = el.getAttribute('style');
    if (inline) {
      section.body.append(buildRuleBlock({ selectorText: 'element.style', sourceFile: null,
        declarations: inline.split(';').map(one => one.trim()).filter(Boolean).map(one => `${one};`).join('\n') },
      'element.style', openRule));
    }

    const rules = rulesForElement(el);
    if (!rules.length) note(section.body, 'No readable matched rules. Cross-origin stylesheets may be unavailable.');
    if (rules.length) {
      const classes = [...el.classList]
        .filter(name => rules.some(rule => ruleClasses(rule.selectorText, [name]).length));
      const unnamed = rules.filter(rule => !ruleClasses(rule.selectorText, classes).length);
      const buckets = [
        { label: 'all', rules },
        ...classes.map(name => ({ label: `.${name}`,
          rules: rules.filter(rule => ruleClasses(rule.selectorText, [name]).length) })),
        ...(unnamed.length && classes.length ? [{ label: 'other', rules: unnamed }] : []),
      ];
      const chips = styled('div', 'atx-rule-chips');
      const out = styled('div', 'atx-rule-list');
      const show = (label: string) => {
        for (const button of chips.children) {
          (button as HTMLElement).dataset.open = String((button as HTMLElement).textContent === label);
        }
        const bucket = buckets.find(one => one.label === label);
        out.replaceChildren(...(bucket?.rules ?? []).map(rule =>
          buildRuleBlock(rule, label.startsWith('.') ? label : rule.selectorText, openRule)));
      };
      // One chip is pointless: `all` and the single class would list the same
      // rules twice.
      if (buckets.length > 1) {
        for (const bucket of buckets) {
          const button = styled('button', 'atx-rule-chip');
          button.type = 'button';
          button.textContent = bucket.label;
          button.title = `${bucket.rules.length} matched ${bucket.rules.length === 1 ? 'rule' : 'rules'}`;
          button.addEventListener('click', () => show(bucket.label));
          chips.append(button);
        }
        section.body.append(chips);
      }
      section.body.append(out);
      show('all');
    }

    const computed = getComputedStyle(el);
    const details = styled('details', 'atx-inspector-details');
    const summary = styled('summary', '');
    summary.textContent = 'Computed styles';
    const values = styled('pre', 'atx-inspector-code');
    values.textContent = ['display', 'position', 'width', 'height', 'color', 'background-color',
      'font-family', 'font-size', 'font-weight', 'line-height', 'margin', 'padding', 'gap']
      .map(property => `${property}: ${computed.getPropertyValue(property)};`).join('\n');
    details.append(summary, values);
    section.body.append(details);
    return section.root;
  }

  /** A verdict or a badge, as one small pill beside the row's label. */
  function chip(text: string, kind: string) {
    const el = styled('span', 'atx-value-chip');
    el.dataset.chip = kind;
    el.textContent = text;
    return el;
  }

  /**
   * The field, and the one Save/Revert pair that belongs to it.
   *
   * There is exactly one of each per value — that is the decision the block
   * exists to hold. The page and this field are two views of one store entry,
   * so typing in either moves both, and a floating bar over the element would
   * be a second pair of buttons for the same gesture.
   *
   * Enter saves and Esc reverts, here and on the page. **Blur does neither**:
   * the row keeps the change, the element keeps its amber outline, and the
   * only way to disk is deliberate.
   */
  function valueField(parent: HTMLElement, row: ValueRow, target: ValueTarget) {
    // A row built from the page describes what the page is *showing*, and a
    // pending edit has already changed that. The store still knows what the
    // source held, and that is what Save has to send (rule 5).
    const original = deps.staging.pendingFor(target, row.value)?.original ?? row.value;
    // A sentence of prose does not belong in a 32px input; Shift+Enter breaks
    // its lines, because Enter is spoken for.
    const long = original.length > 70 || original.includes('\n');
    const input = inputEl(long ? 'textarea' : 'input', 'atx-value-input');
    if (input instanceof HTMLTextAreaElement) input.rows = Math.min(8, Math.ceil(original.length / 52) + 1);
    input.value = original;
    input.spellcheck = false;

    const error = styled('p', 'atx-value-error');
    error.hidden = true;
    const commit = styled('div', 'atx-value-commit');
    const saveButton = footButton('Save', 'default', () => void write());
    const revertButton = footButton('Revert', 'outline', () => discard());
    for (const button of [saveButton, revertButton]) {
      button.classList.add('atx-btn-sm');
      // A button steals focus on mousedown, which would collapse the caret
      // before the click lands — and for the page's contenteditable that is
      // the caret the user is typing with.
      button.addEventListener('mousedown', event => event.preventDefault());
    }
    const pendingNote = styled('span', 'atx-value-pending');
    pendingNote.textContent = 'unsaved';
    commit.append(saveButton, revertButton, pendingNote);
    parent.append(input, error, commit);

    /** Read the store, never the control: the page may have moved the value. */
    const paint = () => {
      const entry = deps.staging.get(target, original);
      commit.hidden = !entry;
      if (input !== document.activeElement) input.value = entry?.current ?? original;
    };
    const type = () => {
      error.hidden = true;
      deps.staging.stage(target, original, input.value, original);
      commit.hidden = !deps.staging.get(target, original);
    };
    async function write() {
      const entry = deps.staging.get(target, original);
      if (!entry) return;
      setButtonEnabled(saveButton, false);
      const refusal = await deps.staging.save(entry.key);
      setButtonEnabled(saveButton, true);
      if (refusal) {
        error.hidden = false;
        error.textContent = refusal;
        return;
      }
      wrote = true;
      paintSaveState();
      toast(`Saved — ${basename(target.file)}:${target.loc}`, 'ok');
    }
    function discard() {
      const entry = deps.staging.get(target, original);
      error.hidden = true;
      if (entry) deps.staging.revert(entry.key);
      input.value = original;
    }

    input.addEventListener('input', type);
    // Through the element type rather than the union: `input | textarea` has no
    // single `addEventListener` overload, so the event would arrive untyped.
    const control: HTMLElement = input;
    control.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void write();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        discard();
      }
    });
    bindings.push(deps.staging.onChange(paint));
    paint();
  }

  /**
   * One Values row, in three bands — **what it is** (label, verdict, badges,
   * caption) · **the value** · **where it goes** — with the destination named
   * once and the mechanism vocabulary folded behind `Details`, so the label
   * can name a destination instead of explaining one.
   */
  function valueRow(row: ValueRow) {
    // Always plain: `muted` is the standalone-tile variant, and a pinned row
    // in a list wears the brand bar instead — a filled neutral tile under a
    // brand bar reads as two different marks for one fact.
    const built = item({ title: row.label, description: row.caption });
    built.root.dataset.verdict = row.verdict;
    if (row.pinned) built.root.dataset.pinned = '';
    // The label is a value's *name* — `href`, `src`, `slot` — so it is set as
    // source rather than as prose, in its own span the stylesheet can reach.
    built.title.textContent = '';
    const name = styled('span', 'atx-value-name');
    name.textContent = row.label;
    // Badges qualify the name and stay beside it; the verdict is the row's
    // answer and goes to the right edge, in one column down the card.
    const verdict = chip(row.verdict, row.verdict);
    verdict.classList.add('atx-value-verdict');
    built.title.append(name, ...row.badges.map(badge => chip(badge, 'badge')), verdict);

    // A field replaces the read-only value rather than sitting under it: two
    // copies of one string, one of them editable, is a question about which
    // is the value.
    const target = row.verdict === 'editable' ? writable(row.target) : null;
    if (target) valueField(built.content, row, target);
    else {
      // Boxed like the field it is standing in for, and dashed rather than
      // filled: every value on this panel is a box, and the border is what
      // says which of them you can type into.
      const value = styled('pre', 'atx-value-readonly');
      value.textContent = row.value.slice(0, 4000) || '(empty)';
      built.content.append(value);
      // An `editable` verdict says the source proves a target; it does not say
      // this build can write to it. Saying which is missing beats a disabled
      // control that repeats the value above it and does nothing.
      if (row.verdict === 'editable') note(built.content, 'This build has no field for this value.');
    }

    const foot = styled('div', 'atx-value-foot');
    if (row.destination) foot.append(codeButton(row.destination));
    const where = styled('span', 'atx-value-where');
    where.textContent = [
      row.destination && `${basename(row.destination.file)}:${row.destination.loc}`,
      row.from && `writable in ${row.from}`,
    ].filter(Boolean).join(' · ') || 'No proven destination.';
    if (row.destination) where.title = `${row.destination.file}:${row.destination.loc}`;
    foot.append(where);
    built.content.append(foot);

    const details = styled('details', 'atx-inspector-details');
    const summary = styled('summary', '');
    summary.textContent = 'Details';
    details.append(summary);
    for (const line of row.details) note(details, line);
    built.content.append(details);
    return built.root;
  }

  /**
   * The image picker, above Values, when the selection has a `src` this build
   * can write.
   *
   * Two views of one value, never two ways to write one: a tile click stages
   * through the same store the `src` field does, so the field follows the grid
   * and the grid follows the field. Nothing reaches disk until that row's Save.
   *
   * Absent when the `src` is not writable — an `{expression}` or an
   * `astro:assets` `<Image>`. A grid of tiles that could not be picked would
   * be an offer the row beside it has already refused.
   */
  function mountPicker(host: HTMLElement, model: ValueRows) {
    host.replaceChildren();
    const row = model.rows.find(r => r.pinned && r.target.kind === 'element'
      && r.target.targetType === 'src' && r.verdict === 'editable');
    const target = row && writable(row.target);
    if (!row || !target) return;
    const original = deps.staging.pendingFor(target, row.value)?.original ?? row.value;
    const picker = buildImagePicker({
      currentSrc: () => deps.staging.get(target, original)?.current ?? original,
      pick: url => deps.staging.stage(target, original, url, original),
    });
    host.append(picker.root);
    // The field and the grid are the same value: typing a path, or reverting
    // one, has to move the ring too.
    bindings.push(deps.staging.onChange(picker.repaint));
  }

  /** The Values card, rendered from the model and nothing else. A refusal
   *  collapses it to one sentence plus a jump to whatever source is known. */
  function renderValues(
    section: ReturnType<typeof card>,
    model: ValueRows,
    jump: readonly { label: string; src: SourceLoc; description: string }[],
  ) {
    // Every field on screen is about to be discarded, so every subscription
    // reading the store on its behalf has to go with it.
    unbind();
    section.body.replaceChildren();
    if (!model.rows.length) {
      note(section.body, `Nothing writable on this selection. ${model.refusal ?? ''}`.trim());
      for (const to of jump) sourceRow(section.body, to.label, to.src, to.description);
      return;
    }
    // The nearest usage site only. A value handed down from three components
    // above is a value of *that* component, reachable by selecting it — listing
    // it here made the card a scroll of other elements' business.
    const list = itemGroup();
    for (const row of model.rows.filter(r => r.depth <= 0)) list.append(valueRow(row));
    section.body.append(list);
  }

  /** `focus` names a chain row to mark once the chain has resolved — a
   *  breadcrumb segment. Reselecting the element already shown keeps the panel
   *  as it is and only moves the mark. */
  async function select(el: HTMLElement, focus?: string) {
    if (selected === el && chainBody) {
      // Already showing this element: the panel has nothing to redo, but a
      // click on the page is still a click asking for the caret.
      if (pageEdit) deps.staging.editOnPage(el, pageEdit.target, pageEdit.original);
      return focusUsage(focus ?? null);
    }
    // Typing on the previous element stops; what was typed stays staged and
    // stays amber. Nothing commits because attention moved (WF-4 item 10).
    deps.staging.stopEditing();
    pageEdit = null;
    selected = el;
    chainBody = null;
    const current = ++generation;
    loader.invalidate();
    const pathname = location.pathname;
    const alive = () => current === generation && el.isConnected && pathname === location.pathname;
    tag.textContent = `<${el.tagName.toLowerCase()}>`;
    tier.hidden = true;
    paintSaveState();
    root.setAttribute('data-on', '');
    body.replaceChildren();
    const values = card({ title: 'Values',
      description: 'Every value on this selection, one row each · Enter saves, Esc reverts' });
    values.body.classList.add('atx-inspector-values');
    const chain = card({ title: 'Component chain' });
    // Full-bleed: a chain row's indent is measured from the card's edge, and
    // the body's own 16px would be a second, invisible indent under it.
    chain.body.classList.add('atx-chain');
    const slots = card({ title: 'Slot relationships' });
    chainBody = chain.body;
    // The one block that may sit above Values, and it is empty until the
    // selection turns out to be an image with a writable `src` — a list of
    // fields cannot show pictures, and nothing else has earned the place.
    const picker = styled('div', 'atx-inspector-picker');
    // The chain first: "where did this come from" is the question the panel is
    // opened with, and it is what tells you whether the values under it are
    // the ones you meant. Values second, because that is what you act on.
    body.append(picker, chain.root, values.root, slots.root, css(el));
    note(values.body, 'Resolving values…');

    const source = sourceFor(el);
    const opaque = !!el.parentElement?.closest('[data-atx-boundary="html"]');
    const ancestor = !source && el.parentElement ? nearestOwnSource(el.parentElement) : null;
    const ancestorSource = ancestor ? sourceFor(ancestor) ?? null : null;
    // Only asked of an element with nothing of its own to say: a slot boundary
    // inside an annotated element is an ordinary containment fact, and the
    // Slot relationships card already covers it.
    const wrapped = !source && !opaque ? wrappedSlot(el) : null;
    const dynamicTag = wrapped
      ? { component: { file: wrapped.placement.file, loc: wrapped.placement.loc }, content: wrapped.content }
      : null;
    const selection: ValueSelection = {
      source: source ?? null, opaque, viaSlot: false, tag: el.tagName.toLowerCase(),
      ancestorSource, dynamicTag,
      text: (el.textContent ?? '').trim().slice(0, 4000),
      // The attribute, not `currentSrc`: the row describes what the file holds.
      ...(el instanceof HTMLImageElement
        ? { image: { src: el.getAttribute('src') ?? '', alt: el.getAttribute('alt') ?? '' } } : {}),
    };
    const markdownEntry = deps.markdownEntry();
    const routeFile = deps.routeFile();
    // The jump of last resort, for a selection with no rows at all. The
    // enclosing element first, because it is the one thing proven; then the
    // route's own template, which is known rather than guessed. Never an entry
    // file — a value belonging to one earns a row of its own, and a page that
    // has not declared one has told us nothing to name.
    const jump: { label: string; src: SourceLoc; description: string }[] = dynamicTag
      // Both files, because the answer is in two places: the component that
      // chose the tag, and the file the words are written in.
      ? [{ label: 'Dynamic tag', src: dynamicTag.component,
        description: `The <slot /> this element wraps, in ${basename(dynamicTag.component.file)}.` },
        ...(dynamicTag.content ? [{ label: 'Content source', src: dynamicTag.content,
          description: `Where the words inside were written, ${basename(dynamicTag.content.file)}:${dynamicTag.content.loc}.` }] : [])]
      : ancestorSource
        ? [{ label: 'Enclosing source', src: ancestorSource,
          description: 'Container source; this element’s source is not proven.' }]
        : routeFile
          ? [{ label: 'Route template', src: { file: routeFile, loc: '1:1' },
            description: 'The file this route is written in; this element’s own source is not proven.' }]
          : [];

    // Never climb from an untracked descendant to manufacture its ownership.
    // Values is still answered: /classify needs only a source loc, and a
    // broken chain says nothing about the words written in this file.
    let render: ReturnType<typeof readRenderOccurrences> | null = null;
    let group: ReturnType<typeof occurrenceSummary> = null;
    /** Which render of each usage site above this element produced it. Read
     *  from the page, sent to the server, and meaningful only against a proven
     *  chain — see `chainOrdinals`. */
    let ordinals: Record<string, number> = {};
    if (opaque || !source) {
      note(chain.body, opaque ? 'No chain · untracked-html. Generated HTML has no proven inner-element source relationship.'
        : dynamicTag ? `No chain · rendered from a dynamic tag in ${basename(dynamicTag.component.file)}. ` +
          'Select an element inside it for the chain its content does have.'
          : 'No chain · this element has no source annotation.');
      // A Markdown body is the one unannotated element whose owner is known,
      // because the route declared it. The chain still ends — it just ends
      // somewhere nameable.
      if (!opaque && markdownEntry && ancestorSource) markdownChainEnd(chain.body, markdownEntry);
      // The boundary this element wraps is a proven slot relationship — it is
      // the one thing about this element that *is* proven, so it is shown as a
      // row like any other rather than left inside the refusal sentence.
      if (wrapped) {
        sourceRow(slots.body, `${wrapped.placement.name || 'default'} slot · wrapped by this element`,
          dynamicTag!.component,
          `This element surrounds the <slot /> at ${basename(wrapped.placement.file)}:${wrapped.placement.loc}`);
      } else note(slots.body, 'No proven slot relationship.');
    } else {
      render = readRenderOccurrences(document);
      if (!render.result.ok) {
        note(chain.body, `No chain · ${render.result.reason}. Render annotations are incomplete or damaged.`);
        note(slots.body, 'Slot placement graph refused.');
      } else {
        const key = render.elements.indexOf(el);
        ordinals = chainOrdinals(render.events, key);
        const occurrence = render.result.occurrences.find(p => p.key === key);
        const peers = render.result.occurrences.filter(p => {
          const peer = render!.elements[p.key];
          return peer.getAttribute('data-atx-file') === el.getAttribute('data-atx-file') &&
            peer.getAttribute('data-atx-chain') === el.getAttribute('data-atx-chain') &&
            peer.getAttribute('data-atx-loc') === el.getAttribute('data-atx-loc');
        });
        group = occurrence ? occurrenceSummary(occurrence, peers) : null;
        selection.viaSlot = (group?.slots ?? []).some(placement => !placement.fallback);
        if (group) note(chain.body, `Rendered occurrence ${group.index} of ${group.total} of this source element.`);
        if (!group?.slots.length) note(slots.body, 'No tracked slot insertion contains this element.');
        for (const slot of group?.slots ?? []) {
          sourceRow(slots.body, `${slot.name || 'default'} slot · ${slot.fallback ? 'fallback' : 'supplied content'}`,
            { file: slot.file, loc: slot.loc }, `Rendered inside ${basename(slot.file)}:${slot.loc}`);
        }
      }
    }

    const chainable = !!source && !opaque && !!render?.result.ok;
    const loading = styled('p', 'atx-inspector-note');
    if (chainable) {
      loading.textContent = 'Resolving component chain…';
      loading.setAttribute('role', 'status');
      chain.body.append(loading);
    }
    let answer;
    try {
      answer = await loader.load(
        chainable ? {
          pathname, file: source!.file, ordinals,
          chain: el.getAttribute('data-atx-chain') ?? undefined,
          ...(el.getAttribute('data-atx-version') === '2' ? { traceVersion: 2 as const } : {}),
        } : null,
        source ? { file: source.file, loc: source.loc, tag: el.tagName.toLowerCase() } : null,
      );
    } catch (error) {
      if (!alive()) return;
      loading.textContent = `Could not load composition · ${error instanceof Error ? error.message : 'Unknown error'}`;
      renderValues(values, { rows: [], refusal: 'The source changed while this selection was being resolved.' }, jump);
      return;
    }
    if (!answer || !alive()) return;
    const model = buildValueRows({
      selection, pathname, ordinals, markdownEntry, routeFile,
      classification: answer.classification, classifyError: answer.classifyError,
      links: answer.chain?.links ?? [],
    });
    renderValues(values, model, jump);
    mountPicker(picker, model);
    // The caret belongs where the click landed, not in a panel on the right —
    // so for a value the page can type into, the element itself becomes the
    // other view of the field that was just built. Both drive one store entry.
    const pinned = model.rows.find(row => row.pinned && row.verdict === 'editable');
    const onPage = pinned && pinned.target.kind === 'element' && typesOnPage(pinned.target)
      ? pinned.target : null;
    if (pinned && onPage) {
      // The same correction as the field's: the caret joins the value the
      // store is holding, not the pending words already on screen.
      const original = deps.staging.pendingFor(onPage, pinned.value)?.original ?? pinned.value;
      pageEdit = { target: onPage, original };
      deps.staging.editOnPage(el, onPage, original);
    }
    if (!answer.chain || !answer.uses) return;
    chain.body.replaceChildren();
    // The tier is a pill in the card's header rather than a sentence at the
    // top of it: it is the one-word answer to "can I trust this chain", and
    // the reason under it is the long form.
    const labels = { proven: 'proven chain', inferred: 'one link inferred',
      candidates: 'no chain · candidates', none: 'no chain' };
    tier.hidden = false;
    tier.dataset.tier = answer.chain.tier;
    tier.textContent = labels[answer.chain.tier];
    if (answer.chain.reason) note(chain.body, answer.chain.reason);
    if (group) note(chain.body, `Rendered occurrence ${group.index} of ${group.total} of this source element.`);
    // Depth is the nesting: the route entry, then a level per link, then the
    // element the chain ends at.
    let depth = 0;
    if (answer.chain.route) {
      chainRow(chain.body, { depth: depth++, id: 'route', glyph: 'doc',
        name: basename(answer.chain.route), sub: `route entry · ${answer.chain.route}`,
        actions: [codeButton({ file: answer.chain.route, loc: '1:1' })] });
    }
    for (const link of answer.chain.links) usage(chain.body, link, source?.file ?? null, depth++);
    if (source) {
      chainRow(chain.body, { depth, glyph: 'node', kind: 'leaf',
        name: `<${el.tagName.toLowerCase()}>`, sub: `${source.file}:${source.loc}` });
    }
    // Only for a value the entry actually supplies: an ordinary literal in the
    // same template ends at the template, and saying "chain ends at the entry"
    // under it would claim a relationship it does not have.
    if (markdownEntry && model.rows.some(row => row.pinned && row.reason === 'markdown')) {
      markdownChainEnd(chain.body, markdownEntry, depth);
    }
    for (const [index, candidate] of (answer.chain.candidates ?? []).entries()) {
      const details = styled('details', 'atx-inspector-details');
      const summary = styled('summary', '');
      summary.textContent = `Possible path ${index + 1}`;
      details.append(summary);
      candidate.forEach(link => usage(details, link, source?.file ?? null));
      chain.body.append(details);
    }
    const uses = styled('details', 'atx-inspector-details');
    const summary = styled('summary', '');
    summary.textContent = `Usages on this route · ${answer.uses.links.length}`;
    uses.append(summary);
    note(uses, 'Source usage sites, including unrendered branches. These are not rendered instance counts.');
    if (answer.uses.reason) note(uses, answer.uses.reason);
    answer.uses.links.forEach(link => usage(uses, link, null));
    chain.body.append(uses);
    focusUsage(focus ?? null);
  }

  // Hydration can replace a selected node without a Vite update. Never keep
  // displaying a former node's chain as if it described its replacement.
  new MutationObserver(() => {
    if (selected && !selected.isConnected) close();
  }).observe(document.documentElement, { childList: true, subtree: true });

  return { root, select, focusUsage, close, isOpen: () => selected !== null,
    /** Repaint the layout switch. The effective mode can change without the
     *  button being touched — the window narrowing past the point where the
     *  page column is still a page. */
    syncLayout,
    /** Whether `el` is what the panel currently describes — a breadcrumb asks
     *  before deciding between moving its mark and opening the panel. */
    shows: (el: HTMLElement) => selected === el,
    invalidate() { close(); } };
}
