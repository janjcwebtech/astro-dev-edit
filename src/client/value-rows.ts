import type { ClassifyResult, SourceLoc, TargetType, UsageLink, UsageRefusal, UsageVerdict, UsageWrite } from '../shared/protocol.ts';
import type { ValueTarget } from './value-model.ts';

/**
 * The Values card as data: every value the selection is made of, in one
 * ordered list, before any of it is drawn.
 *
 * **Pure and DOM-free.** Selection facts, the `/classify` verdict and the
 * resolved chain go in; rows come out. It decides nothing about elements,
 * fields or focus — which is what makes the model testable without a browser
 * and what keeps the render a matter of walking a list.
 *
 * Two shapes of value meet here and the whole point is that they stop being
 * two kinds of thing:
 *
 * - what the clicked element renders, which `/classify` settles against the
 *   AST because the DOM cannot tell a resolved `{expression}` from literal
 *   text (the Flow list, step 1);
 * - what the usage sites above it pass, which `usage-parse.ts` has already
 *   given a three-state verdict and a proven byte range.
 *
 * Both become rows. Grouping by transport is what hid a slot's words behind a
 * read-only preview while its sibling props sat there editable.
 *
 * Nothing here writes or stages. A row says which of the three verdicts it is
 * and names the target it would write into; whether a field appears under it
 * is `value-model.ts::writable`'s answer, not this module's — one place says
 * what a value *is*, another says what the write path can serve.
 */

export type ValueBadge = 'selected element' | 'via slot';

/**
 * Why a row is not editable *here*, beyond the reasons the server sends.
 *
 * `imported` and `markdown` are the client's own: neither is a verdict
 * `usage-parse.ts` reaches, and both say the same shape of thing — the words
 * are real and writable, in a file this panel names and does not write.
 */
export type RowReason = UsageRefusal | 'imported' | 'markdown';

/** Which question a chain row answers about its file: who owns the look, and
 *  who holds the words. Both can be true of one link. */
export type ChainBadge = 'presentation' | 'content';

export interface ValueRow {
  /** Stable within one selection — the render keys rows off it. Derived from
   *  {@link ValueRow.target}, and never parsed back apart: what a caller needs
   *  from a row is on the target, in fields. */
  key: string;
  /**
   * What this row writes into, addressed the way the write path addresses it —
   * an element's `file:loc` and target type, or a usage site's byte range.
   *
   * It is the row's identity rather than a formatted string because staging
   * reads it back: `key.split('|')` was the alternative, and a value's address
   * is not a display concern.
   */
  target: ValueTarget;
  /** What the row is called: a prop name, `text`, `slot`, `src`. */
  label: string;
  verdict: UsageVerdict;
  /** Present on every verdict but `editable`. */
  reason?: RowReason;
  /** One line naming what this value *is*, in no mechanism vocabulary. */
  caption: string;
  /**
   * The words — the field's starting text and the apply op's `original`.
   *
   * For an editable value at a usage site that is the server's `value`, not
   * its `source`: the bytes of `title="Protected"` include the quotes, and a
   * field editing those would be editing syntax. A refused row shows the
   * source instead, because there the spelling *is* the thing to look at.
   */
  value: string;
  /** Where *View code* lands — the file holding the words, not the file the
   *  element was rendered into. Null when nothing is proven. */
  destination: SourceLoc | null;
  /** For `elsewhere`: the module specifier the value is imported from. It is
   *  named, never resolved — a specifier is not a path (#61's own rule). */
  from?: string;
  badges: readonly ValueBadge[];
  /** The clicked value, pinned first and marked. */
  pinned: boolean;
  /** 0 is the usage site nearest the selection; the route is highest. A
   *  pinned row is -1: it is the element itself, below every usage site. */
  depth: number;
  /** Mechanism vocabulary — kind, byte range, trace, chain position. Behind a
   *  disclosure, so a label can name a destination instead of explaining one. */
  details: readonly string[];
}

export interface ValueRows {
  rows: readonly ValueRow[];
  /** Set only when there are no rows at all: the card collapses to *nothing
   *  writable on this selection* plus this sentence. */
  refusal: string | null;
}

/** What the clicked element is, as the DOM and the annotations describe it.
 *  Supplied by the caller so this module never touches an element. */
export interface ValueSelection {
  /** The element's own source, when it has a proven one. */
  source: SourceLoc | null;
  /** True when the element sits inside generated HTML, whose inner elements
   *  have no proven source relationship. */
  opaque: boolean;
  /** True when slot markup passed at a usage site wraps this element. */
  viaSlot: boolean;
  /**
   * The nearest annotated **ancestor**'s source, for an element that has none
   * of its own. It is what separates content the route template rendered
   * without annotating — a Markdown body — from an element whose owner is some
   * component further down that simply did not annotate.
   */
  ancestorSource?: SourceLoc | null;
  /** The rendered text the page showed. */
  text: string;
  /** For an `img`, what it currently renders. */
  image?: { src: string; alt: string };
  /** Lowercased tag name — the apply request carries it, so the row's target
   *  has to. */
  tag: string;
  /**
   * For an unannotated element that wraps a slot boundary: the component that
   * rendered it from a tag it did not spell statically, and where the words
   * inside were written (issue #71).
   *
   * It names a refusal, never a row. Which element a dynamic tag resolves to
   * is a render-time fact, so nothing here is a write target — but "no source
   * annotation" is not the whole of what the page knows, and every other
   * refusal in this tool names its cause and points somewhere.
   */
  dynamicTag?: { component: SourceLoc; content: SourceLoc | null } | null;
}

export interface ValueRowsInput {
  selection: ValueSelection;
  /** The route the chain was resolved on. A usage id means nothing without
   *  it — the index that resolves one is route-scoped. */
  pathname: string;
  /** Which render of each usage site produced the selection, keyed by usage
   *  id. `render-occurrences.ts::chainOrdinals` reads them off the page; a
   *  site missing from it has an unknown render, which is `0`. */
  ordinals?: Readonly<Record<string, number>>;
  /** Null when `/classify` was not reached; `classifyError` then says why. */
  classification: ClassifyResult | null;
  classifyError?: string;
  /** The resolved chain, route first — so the nearest usage site is last. */
  links: readonly UsageLink[];
  /**
   * The Markdown entry this route renders, when the **page itself** declares
   * one (`page-source.ts::markdownSource`). Null otherwise, and null is not a
   * cue to go looking: an unresolved backing file opens the route template and
   * says so, rather than inventing an entry file.
   */
  markdownEntry?: string | null;
  /**
   * The file this route is written in, root-relative as `/page-source` spells
   * it. Two jobs, both of them refusals: it is where an unresolved value jumps
   * to, and it is the test that a `dynamic` value belongs to the template
   * rendering the entry rather than to some component further down.
   */
  routeFile?: string | null;
}

/** One sentence per refusal, in the vocabulary a reader already has. */
const CAPTIONS: Record<RowReason, string> = {
  styling: 'Styling, not content.',
  directive: 'A directive — it shapes structure, not words.',
  spread: 'Spread from the caller’s caller, so the words are not written here.',
  boolean: 'A flag with no string to write.',
  computed: 'Computed as the page renders.',
  template: 'A template literal — interpolation, not a fixed string.',
  untraced: 'This name has no proven path to a literal in this file.',
  'unproven-entry': 'One of several renders of this usage site — which array entry it reads is not yet proven.',
  markup: 'Markup that wraps values. The values inside it are rows of their own.',
  empty: 'Whitespace only — nothing to edit.',
  unlocated: 'The source does not read back the way the page described it.',
  unsupported: 'A value shape this inspector does not model.',
  absent: 'No alt attribute — add it in the IDE. Nothing is inserted for you.',
  imported: 'Written in another module.',
  markdown: 'Written in the Markdown entry this route renders.',
};

/**
 * Whether the element's annotated file is the route's own template.
 *
 * Both sides are root-relative — the annotation and `/page-source` — so this
 * is normally a plain equality. The suffix arm stays for the case where they
 * are anchored differently, and it errs the way `inspector-app.ts` does: a
 * near-miss reads as "not the template", which costs a jump rather than making
 * a claim.
 */
function isRouteTemplate(file: string, routeFile: string | null | undefined): boolean {
  if (!routeFile) return false;
  return file === routeFile || file.endsWith(`/${routeFile}`);
}

/**
 * The rows a Markdown-backed route contributes, or null when this selection is
 * not one of them.
 *
 * **Navigation, never a field.** The words are in an entry file, this pass
 * does not edit Markdown in the browser, and a row offering a field it could
 * not save would be worse than the sentence. So the verdict is `elsewhere` —
 * writable, in the file it names — and *View code* lands on the entry, at its
 * top: `<Content />` leaves no annotation at all, so no line is ever invented
 * for a body paragraph.
 *
 * Two shapes, and the difference is what the page can prove:
 *
 * - **Body content** has no source annotation of its own, because the Markdown
 *   renderer is not an `.astro` component and nothing threads through it. Its
 *   nearest annotated ancestor being the route's template is what separates it
 *   from an island or a component's output that merely failed to annotate.
 * - **A frontmatter value** is a `dynamic` expression written *in* the route
 *   template. That it reads the entry is derived, not proven — the trace stops
 *   at a member access this tool does not model — so the row says so in as many
 *   words and the detail line marks it `inferred`.
 */
function markdownRows(input: ValueRowsInput): ValueRow[] | null {
  const { selection, classification, markdownEntry, routeFile } = input;
  if (!markdownEntry || selection.opaque) return null;
  const destination: SourceLoc = { file: markdownEntry, loc: '1:1' };
  // `target` is the row's address, never a write: `elsewhere` is what keeps a
  // field off it, and this pass writes no Markdown at all. Body content has no
  // address of its own — <Content /> annotates nothing — so the entry's top is
  // the closest true thing to say, and no line is invented for it.
  const base = {
    verdict: 'elsewhere' as const, reason: 'markdown' as const, from: markdownEntry,
    value: selection.text, destination, badges: ['selected element' as const],
    pinned: true, depth: -1,
  };
  if (!selection.source) {
    // An unannotated element anywhere else on the page is not this: only the
    // template that renders <Content /> can have put it here.
    const ancestor = selection.ancestorSource;
    if (!ancestor || !isRouteTemplate(ancestor.file, routeFile)) return null;
    return [{
      ...base, key: `${markdownEntry}|body`,
      target: { kind: 'element', file: markdownEntry, loc: '1:1', tag: selection.tag,
        targetType: 'text' },
      label: 'content',
      caption: 'Body content from the Markdown entry — edit it there.',
      details: ['inferred · rendered by <Content />, which carries no annotation',
        'no line · a rendered paragraph names no source line',
        `entry · ${markdownEntry}`],
    }];
  }
  if (classification?.kind !== 'dynamic' || !isRouteTemplate(selection.source.file, routeFile)) {
    return null;
  }
  return [{
    ...base, key: `${selection.source.file}|${selection.source.loc}|frontmatter`,
    target: { kind: 'element', file: selection.source.file, loc: selection.source.loc,
      tag: selection.tag, targetType: 'text' },
    label: 'frontmatter value',
    caption: 'An expression in the route template, on a route backed by a Markdown entry — edit it there.',
    details: ['inferred · derived from the route’s template and the entry it renders',
      `template · ${selection.source.file}:${selection.source.loc}`,
      `entry · ${markdownEntry}`],
  }];
}

/** `read-only` and `elsewhere` both carry a reason; `editable` carries none. */
function verdictOf(write: UsageWrite): Pick<ValueRow, 'verdict' | 'reason' | 'from' | 'caption'> {
  if (write.verdict === 'editable') return { verdict: 'editable', caption: '' };
  return { verdict: write.verdict, reason: write.reason, from: write.from,
    caption: CAPTIONS[write.reason] };
}

const byteRange = (start?: number, end?: number) =>
  typeof start === 'number' && typeof end === 'number' ? [`bytes · ${start}–${end}`] : [];

/**
 * Which questions a chain row answers. The prefix rule makes this a lexical
 * fact rather than a guess: slot children compile into the *parent's* factory
 * scope, so the file that writes `<Name />` is the one supplying words, and
 * the file it resolves to is the one supplying the markup.
 */
export function chainBadges(link: UsageLink, selectionFile: string | null): ChainBadge[] {
  const badges: ChainBadge[] = [];
  if (selectionFile && link.target === selectionFile) badges.push('presentation');
  const supplies = (value: { verdict: UsageVerdict }) => value.verdict !== 'read-only';
  if (link.props.some(supplies) || link.slots.some(supplies)) badges.push('content');
  return badges;
}

/** The clicked element's own value(s), from the AST verdict rather than the
 *  DOM — the one thing the DOM provably cannot answer. */
function pinnedRows(input: ValueRowsInput): ValueRow[] {
  const { selection, classification } = input;
  const source = selection.source;
  if (!source || !classification) return [];
  const badges: ValueBadge[] = ['selected element', ...(selection.viaSlot ? ['via slot' as const] : [])];
  const at = (targetType: TargetType): ValueTarget =>
    ({ kind: 'element', file: source.file, loc: source.loc, tag: selection.tag, targetType });
  const row = (targetType: TargetType,
    o: Pick<ValueRow, 'label' | 'value' | 'caption'> & Partial<ValueRow>): ValueRow => ({
    key: `${source.file}|${source.loc}|${targetType}`, target: at(targetType),
    verdict: 'editable', destination: source,
    badges, pinned: true, depth: -1, details: [`classified · ${classification.kind}`], ...o,
  });
  const refused = (targetType: TargetType, label: string, value: string, reason: UsageRefusal): ValueRow =>
    row(targetType, { label, value, verdict: 'read-only', reason, caption: CAPTIONS[reason],
      details: [`classified · ${classification.kind}`, `reason · ${classification.reason}`] });

  switch (classification.kind) {
    case 'text':
      return [row('text', { label: 'text', value: selection.text,
        caption: 'A literal in the template — the caret lands on the page.' })];
    case 'markup':
      return [row('markup', { label: 'inline markup', value: classification.markup?.html ?? selection.text,
        caption: 'Literal text and inline tags, edited as the source spells them.' })];
    case 'expression':
      return [row('expression', { label: classification.expression?.label ?? 'value', value: selection.text,
        caption: 'One hop to a string in this file’s frontmatter.',
        details: [`classified · expression`, `trace · ${classification.expression?.label ?? '—'}`] })];
    // The container owns one value and says so plainly. Its descendants are a
    // different selection and keep their own refusal — `selection.opaque`.
    case 'html':
      return [row('html', { label: 'html', value: classification.html?.value ?? '',
        caption: 'Rendered as HTML. The whole string is edited here.' })];
    // Two rows, and the picker above them is the third view of the first: a
    // list of fields cannot show pictures, so the grid shows them and stages
    // into this same row rather than writing on its own.
    case 'image': {
      const attrs = classification.attrs ?? { src: 'dynamic' as const, alt: 'dynamic' as const };
      const image = selection.image ?? { src: '', alt: '' };
      const CAPTION = {
        src: 'A quoted attribute — pick a file above, or type the path.',
        alt: 'A quoted attribute on the element.',
      };
      const attr = (label: 'src' | 'alt') => attrs[label] === 'static'
        ? row(label, { label, value: image[label], caption: CAPTION[label] })
        // `missing` is only ever `alt`: an `img` with no `src` renders nothing
        // to click. Refused rather than inserted — rule 6 will not point a
        // patcher at an attribute the source does not contain.
        : refused(label, label, image[label], attrs[label] === 'missing' ? 'absent' : 'computed');
      return [attr('src'), attr('alt')];
    }
    // ≥2 elements share this loc, or none does: either way the bytes do not
    // confirm what the page showed, so there is no provable target.
    case 'ambiguous':
    case 'unresolved':
      return [refused('text', 'text', selection.text, 'unlocated')];
    case 'dynamic':
      return [refused('text', 'text', selection.text, 'computed')];
    case 'empty':
      return [];
  }
}

/** Every value passed at a usage site, nearest site first. */
function usageRows(links: readonly UsageLink[], pathname: string,
  ordinals: Readonly<Record<string, number>>): ValueRow[] {
  const rows: ValueRow[] = [];
  // Route-first on the wire; nearest-first to read, because the site that
  // handed this element its values is the one worth seeing without scrolling.
  [...links].reverse().forEach((link, depth) => {
    const at: SourceLoc = { file: link.file, loc: link.loc };
    const chain = `chain · <${link.name} /> in ${link.file}:${link.loc}`;
    for (const prop of link.props) {
      const write = verdictOf(prop);
      rows.push({
        key: `${link.id}|prop|${prop.name}|${prop.start ?? 'unlocated'}`,
        target: { kind: 'usage', usageId: link.id, pathname, file: link.file, loc: link.loc,
          name: prop.name, slot: false, ordinal: ordinals[link.id] ?? 0, start: prop.start, end: prop.end },
        label: prop.name, ...write, value: prop.value ?? prop.source, destination: at,
        badges: [], pinned: false, depth,
        caption: write.verdict !== 'editable' ? write.caption
          // The whole string, and only the whole string: what the tags inside
          // it produce has no proven source, and this row never claims it has.
          : prop.html ? 'Rendered as HTML. The whole string is edited here.'
          : prop.trace ? 'One hop to a literal in this file.'
          : 'A quoted string literal at the usage site.',
        details: [`kind · ${prop.kind}`, ...(prop.html ? ['renders as · HTML'] : []),
          ...byteRange(prop.start, prop.end),
          ...(prop.trace ? [`trace · ${prop.trace.label}`] : []),
          ...(prop.verdict === 'elsewhere' ? [`imported from · ${prop.from}`] : []), chain],
      });
    }
    for (const slot of link.slots) {
      const write = verdictOf(slot);
      rows.push({
        key: `${link.id}|slot|${slot.start}`,
        target: { kind: 'usage', usageId: link.id, pathname, file: link.file, loc: link.loc,
          name: slot.name, slot: true, ordinal: ordinals[link.id] ?? 0, start: slot.start, end: slot.end },
        label: slot.name === 'default' ? 'slot' : `slot: ${slot.name}`,
        ...write, value: slot.value ?? slot.source, destination: at,
        // Slot words arrive through the wrapper the caller passed, which is
        // exactly what the badge says — and what keeps them from reading as
        // a property of the component that renders them (WF-4 item 9).
        badges: write.verdict === 'editable' ? ['via slot'] : [], pinned: false, depth,
        caption: write.verdict === 'editable'
          ? 'Literal slot text, written at the usage site.' : write.caption,
        details: [`slot · ${slot.name}`, ...byteRange(slot.start, slot.end), chain],
      });
    }
  });
  return rows;
}

/** Last path segment — enough to name a file in a sentence. */
function base(file: string): string {
  return file.split(/[\\/]/).pop() || file;
}

/**
 * Why an unannotated element is unannotated, when the page can say.
 *
 * A polymorphic `<Tag>` is the case worth naming: the tool holds the slot
 * boundary, so it knows which component rendered the element and where the
 * words inside it came from — the same words that answer fully when the
 * `<span>` inside is clicked instead. Saying "no source annotation" to one and
 * a full chain to the other, for one string of text, is the defect.
 */
function dynamicTagRefusal(selection: ValueSelection): string {
  const dynamic = selection.dynamicTag;
  if (!dynamic) return 'This element has no source annotation.';
  const where = `Rendered from a dynamic tag in ${base(dynamic.component.file)} — ` +
    'a tag name that is a value, so no annotation could be written on it.';
  return dynamic.content
    ? `${where} The words inside come from ${base(dynamic.content.file)}:${dynamic.content.loc}.`
    : `${where} Nothing inside it carries a source annotation either.`;
}

/** Build the Values card's rows for one selection. */
export function buildValueRows(input: ValueRowsInput): ValueRows {
  const { selection, classification, classifyError, links } = input;
  // A Markdown-backed value replaces the pinned row rather than joining it:
  // what the template says about the value is `dynamic`, which is true and is
  // not the answer the reader came for. Values further up the chain are still
  // the caller's own and stay.
  const pinned = markdownRows(input) ?? pinnedRows(input);
  const rows = [...pinned, ...usageRows(links, input.pathname, input.ordinals ?? {})];
  if (rows.length) return { rows, refusal: null };
  if (selection.opaque) {
    return { rows, refusal: 'Generated HTML — its inner elements have no proven source relationship.' };
  }
  if (!selection.source) return { rows, refusal: dynamicTagRefusal(selection) };
  if (classifyError) return { rows, refusal: classifyError };
  if (classification) return { rows, refusal: classification.reason };
  return { rows, refusal: 'No value was resolved for this selection.' };
}
