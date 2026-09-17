import type { SourceLoc, UsageLink, CompositionCoverage } from '../shared/protocol.ts';
import * as api from './api.ts';
import { readRenderOccurrences } from './composition-dom.ts';
import { chainOrdinals } from './render-occurrences.ts';
import { rulesForElement } from './css-inspect.ts';
import { has } from './features.ts';
import { card, item, itemGroup } from './group.ts';
import { createInspectorLoader, occurrenceSummary } from './inspector-model.ts';
import { nearestOwnSource, sourceFor } from './source-map.ts';
import type { StagedValues } from './staged-values.ts';
import { basename, footButton, inputEl, isolateScroll, setButtonEnabled, styled, toast } from './ui.ts';
import { typesOnPage, writable, type ElementTarget, type ValueTarget } from './value-model.ts';
import { buildValueRows, chainBadges, type ValueRow, type ValueRows, type ValueSelection } from './value-rows.ts';

export interface InspectorDeps {
  viewCode(source: SourceLoc): void;
  openRule(file: string, selector: string): void;
  backingFile(): string | null;
  onClose(): void;
  /** The one staged-value store the panel and the page share. */
  staging: StagedValues;
}

/** One panel per click. Values that the write path can serve carry a field and
 *  one Save/Revert pair; everything else is read-only and says why. */
export function initInspector(deps: InspectorDeps) {
  const root = styled('aside', 'atx-inspector');
  root.setAttribute('aria-label', 'Source inspector');
  const header = styled('div', 'atx-inspector-header');
  const title = styled('strong', 'atx-inspector-title');
  /** Whether what is on screen for this selection is what is on disk. It sits
   *  in the header because it is the selection's answer, not a row's — and it
   *  is the one place a panel covering the page can still report the amber. */
  const saveState = styled('span', 'atx-value-chip');
  const closeButton = footButton('Close', 'ghost', close);
  header.append(title, saveState, closeButton);
  const body = styled('div', 'atx-inspector-body');
  isolateScroll(body);
  root.append(header, body);
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

  function paintSaveState() {
    const dirty = deps.staging.pending().length;
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

  function coverage(parent: HTMLElement, value: CompositionCoverage) {
    if (value.complete) return;
    const details = styled('details', 'atx-inspector-details');
    const summary = styled('summary', '');
    summary.textContent = `Incomplete discovery · ${value.files} files`;
    details.append(summary);
    for (const issue of value.issues) note(details, `${issue.reason} · ${issue.file}${issue.loc ? ':' + issue.loc : ''}`);
    parent.append(details);
  }

  /** A chain row. `selectionFile` lets it say which file owns the look and
   *  which holds the words; the values themselves are Values rows, so this row
   *  names its usage site rather than re-listing them. */
  function usage(parent: HTMLElement, link: UsageLink, selectionFile: string | null) {
    const row = item({ title: link.name,
      description: link.target ? basename(link.target) : `Unresolved · ${link.refusal ?? 'unresolved'}`,
      actions: [
        ...(link.target ? [codeButton({ file: link.target, loc: '1:1' })] : []),
        codeButton(link, 'Open parent'),
      ] });
    row.title.append(...chainBadges(link, selectionFile).map(badge => chip(badge, 'badge')));
    const details = styled('details', 'atx-inspector-details');
    const summary = styled('summary', '');
    summary.textContent = `Usage at ${basename(link.file)}:${link.loc}`;
    details.append(summary);
    for (const value of [...link.props, ...link.slots]) {
      note(details, 'name' in value && 'kind' in value
        ? `${value.name} · ${value.kind} · ${value.verdict}`
        : `slot ${value.name || 'default'} · ${value.verdict}`);
    }
    row.content.append(details);
    // The breadcrumb names a link by id; the row it opens has to be findable.
    row.root.dataset.usage = link.id;
    parent.append(row.root);
    return row.root;
  }

  function css(el: HTMLElement) {
    const section = card({ title: 'CSS', description: 'Selector matches in stylesheet order; conditional rules may be inactive. Computed values include inheritance.' });
    if (!has('cssInspector')) {
      note(section.body, 'CSS inspection is disabled in settings.');
      return section.root;
    }
    const inline = el.getAttribute('style');
    if (inline) {
      const code = styled('pre', 'atx-inspector-code');
      code.textContent = `element.style {\n${inline}\n}`;
      section.body.append(code);
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
    const rules = rulesForElement(el);
    if (!rules.length) note(section.body, 'No readable matched rules. Cross-origin stylesheets may be unavailable.');
    for (const rule of rules) {
      const row = item({ title: rule.selectorText, description: rule.sourceFile ? basename(rule.sourceFile) : 'Inline or unavailable source',
        actions: rule.sourceFile && has('openInEditor') ? [footButton('Open in editor', 'outline',
          () => deps.openRule(rule.sourceFile!, rule.selectorText))] : [] });
      const code = styled('pre', 'atx-inspector-code');
      code.textContent = rule.declarations;
      row.content.append(code);
      section.body.append(row.root);
    }
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
    const built = item({ title: row.label, description: row.caption,
      variant: row.pinned ? 'muted' : 'plain' });
    built.root.dataset.verdict = row.verdict;
    if (row.pinned) built.root.dataset.pinned = '';
    built.title.append(chip(row.verdict, row.verdict), ...row.badges.map(badge => chip(badge, 'badge')));

    // A field replaces the read-only value rather than sitting under it: two
    // copies of one string, one of them editable, is a question about which
    // is the value.
    const target = row.verdict === 'editable' ? writable(row.target) : null;
    if (target) valueField(built.content, row, target);
    else {
      const value = styled('pre', 'atx-inspector-code');
      value.textContent = row.value.slice(0, 4000) || '(empty)';
      built.content.append(value);
      // An `editable` verdict says the source proves a target; it does not say
      // this build can write to it. Saying which is missing beats a disabled
      // control that repeats the value above it and does nothing.
      if (row.verdict === 'editable') note(built.content, 'Edited with the image picker, not as text.');
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

  /** The Values card, rendered from the model and nothing else. A refusal
   *  collapses it to one sentence plus a jump to whatever source is known. */
  function renderValues(
    section: ReturnType<typeof card>,
    model: ValueRows,
    jump: { label: string; src: SourceLoc; description: string } | null,
  ) {
    // Every field on screen is about to be discarded, so every subscription
    // reading the store on its behalf has to go with it.
    unbind();
    section.body.replaceChildren();
    if (!model.rows.length) {
      note(section.body, `Nothing writable on this selection. ${model.refusal ?? ''}`.trim());
      if (jump) sourceRow(section.body, jump.label, jump.src, jump.description);
      return;
    }
    const list = itemGroup({ bleed: true });
    for (const row of model.rows.filter(r => r.depth <= 0)) list.append(valueRow(row));
    section.body.append(list);
    // Values passed further up the chain are real rows, not a summary — but
    // the site that handed this element its values is the one worth reading
    // without scrolling past its grandparents.
    const far = model.rows.filter(r => r.depth > 0);
    if (!far.length) return;
    const details = styled('details', 'atx-inspector-details');
    const summary = styled('summary', '');
    summary.textContent = `Further up the chain · ${far.length}`;
    const rest = itemGroup();
    for (const row of far) rest.append(valueRow(row));
    details.append(summary, rest);
    section.body.append(details);
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
    title.textContent = `<${el.tagName.toLowerCase()}>`;
    paintSaveState();
    root.setAttribute('data-on', '');
    body.replaceChildren();
    const values = card({ title: 'Values',
      description: 'Every value on this selection, one row each · Enter saves, Esc reverts' });
    const chain = card({ title: 'Component chain' });
    const slots = card({ title: 'Slot relationships' });
    chainBody = chain.body;
    body.append(values.root, chain.root, slots.root, css(el));
    note(values.body, 'Resolving values…');

    const source = sourceFor(el);
    const opaque = !!el.parentElement?.closest('[data-atx-boundary="html"]');
    const selection: ValueSelection = {
      source: source ?? null, opaque, viaSlot: false, tag: el.tagName.toLowerCase(),
      text: (el.textContent ?? '').trim().slice(0, 4000),
      // The attribute, not `currentSrc`: the row describes what the file holds.
      ...(el instanceof HTMLImageElement
        ? { image: { src: el.getAttribute('src') ?? '', alt: el.getAttribute('alt') ?? '' } } : {}),
    };
    const ancestor = !source && el.parentElement ? nearestOwnSource(el.parentElement) : null;
    const ancestorSource = ancestor && sourceFor(ancestor);
    const backing = deps.backingFile();
    const jump = ancestorSource
      ? { label: 'Enclosing source', src: ancestorSource,
        description: 'Container source; this element’s source is not proven.' }
      : backing
        ? { label: 'Page backing file', src: { file: backing, loc: '1:1' },
          description: 'Route content file; individual value mapping is not proven.' }
        : null;

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
        : 'No chain · this element has no source annotation.');
      note(slots.body, 'No proven slot relationship.');
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
      selection, pathname, ordinals,
      classification: answer.classification, classifyError: answer.classifyError,
      links: answer.chain?.links ?? [],
    });
    renderValues(values, model, jump);
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
    const labels = { proven: 'Proven chain', inferred: 'Inferred source path · rendered instance is not proven',
      candidates: 'Multiple possible source paths · no path selected', none: 'No chain' };
    note(chain.body, `${labels[answer.chain.tier]}${answer.chain.reason ? ' · ' + answer.chain.reason : ''}`);
    if (group) note(chain.body, `Rendered occurrence ${group.index} of ${group.total} of this source element.`);
    if (answer.chain.route) {
      sourceRow(chain.body, 'Route', { file: answer.chain.route, loc: '1:1' }).dataset.usage = 'route';
    }
    for (const link of answer.chain.links) usage(chain.body, link, source?.file ?? null);
    for (const [index, candidate] of (answer.chain.candidates ?? []).entries()) {
      const details = styled('details', 'atx-inspector-details');
      const summary = styled('summary', '');
      summary.textContent = `Possible path ${index + 1}`;
      details.append(summary);
      candidate.forEach(link => usage(details, link, source?.file ?? null));
      chain.body.append(details);
    }
    coverage(chain.body, answer.chain.coverage);
    const uses = styled('details', 'atx-inspector-details');
    const summary = styled('summary', '');
    summary.textContent = `Usages on this route · ${answer.uses.links.length}`;
    uses.append(summary);
    note(uses, 'Source usage sites, including unrendered branches. These are not rendered instance counts.');
    if (answer.uses.reason) note(uses, answer.uses.reason);
    answer.uses.links.forEach(link => usage(uses, link, null));
    coverage(uses, answer.uses.coverage);
    chain.body.append(uses);
    focusUsage(focus ?? null);
  }

  // Hydration can replace a selected node without a Vite update. Never keep
  // displaying a former node's chain as if it described its replacement.
  new MutationObserver(() => {
    if (selected && !selected.isConnected) close();
  }).observe(document.documentElement, { childList: true, subtree: true });

  return { root, select, focusUsage, close, isOpen: () => selected !== null,
    /** Whether `el` is what the panel currently describes — a breadcrumb asks
     *  before deciding between moving its mark and opening the panel. */
    shows: (el: HTMLElement) => selected === el,
    invalidate() { close(); } };
}
