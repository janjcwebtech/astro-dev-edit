import type { ClassifyResult, SourceLoc, UsageLink, UsageRefusal, UsageVerdict, UsageWrite } from '../shared/protocol.ts';

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
 * Nothing here writes, stages or offers a field: every row is read-only and
 * says which of the three verdicts it is.
 */

export type ValueBadge = 'selected element' | 'via slot';

/** Which question a chain row answers about its file: who owns the look, and
 *  who holds the words. Both can be true of one link. */
export type ChainBadge = 'presentation' | 'content';

export interface ValueRow {
  /** Stable within one selection — the render keys rows off it. */
  key: string;
  /** What the row is called: a prop name, `text`, `slot`, `src`. */
  label: string;
  verdict: UsageVerdict;
  /** Present on every verdict but `editable`. */
  reason?: UsageRefusal | 'imported';
  /** One line naming what this value *is*, in no mechanism vocabulary. */
  caption: string;
  /** The value as the source spells it. Read-only in this iteration. */
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
  /** The rendered text the page showed. */
  text: string;
  /** For an `img`, what it currently renders. */
  image?: { src: string; alt: string };
}

export interface ValueRowsInput {
  selection: ValueSelection;
  /** Null when `/classify` was not reached; `classifyError` then says why. */
  classification: ClassifyResult | null;
  classifyError?: string;
  /** The resolved chain, route first — so the nearest usage site is last. */
  links: readonly UsageLink[];
}

/** One sentence per refusal, in the vocabulary a reader already has. */
const CAPTIONS: Record<UsageRefusal | 'imported', string> = {
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
  absent: 'Not in the source. Add the attribute in the IDE.',
  imported: 'Written in another module.',
};

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
  const row = (o: Pick<ValueRow, 'label' | 'value' | 'caption'> & Partial<ValueRow>): ValueRow => ({
    key: `${source.file}|${source.loc}|${o.label}`, verdict: 'editable', destination: source,
    badges, pinned: true, depth: -1, details: [`classified · ${classification.kind}`], ...o,
  });
  const refused = (label: string, value: string, reason: UsageRefusal): ValueRow =>
    row({ label, value, verdict: 'read-only', reason, caption: CAPTIONS[reason],
      details: [`classified · ${classification.kind}`, `reason · ${classification.reason}`] });

  switch (classification.kind) {
    case 'text':
      return [row({ label: 'text', value: selection.text,
        caption: 'A literal in the template — the caret lands on the page.' })];
    case 'markup':
      return [row({ label: 'inline markup', value: classification.markup?.html ?? selection.text,
        caption: 'Literal text and inline tags, edited as the source spells them.' })];
    case 'expression':
      return [row({ label: classification.expression?.label ?? 'value', value: selection.text,
        caption: 'One hop to a string in this file’s frontmatter.',
        details: [`classified · expression`, `trace · ${classification.expression?.label ?? '—'}`] })];
    case 'image': {
      const attrs = classification.attrs ?? { src: 'dynamic' as const, alt: 'dynamic' as const };
      const image = selection.image ?? { src: '', alt: '' };
      const attr = (label: 'src' | 'alt') => attrs[label] === 'static'
        ? row({ label, value: image[label], caption: 'A quoted attribute on the element.' })
        : refused(label, image[label], attrs[label] === 'missing' ? 'absent' : 'computed');
      return [attr('src'), attr('alt')];
    }
    // ≥2 elements share this loc, or none does: either way the bytes do not
    // confirm what the page showed, so there is no provable target.
    case 'ambiguous':
    case 'unresolved':
      return [refused('text', selection.text, 'unlocated')];
    case 'dynamic':
      return [refused('text', selection.text, 'computed')];
    case 'empty':
      return [];
  }
}

/** Every value passed at a usage site, nearest site first. */
function usageRows(links: readonly UsageLink[]): ValueRow[] {
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
        label: prop.name, ...write, value: prop.source, destination: at,
        badges: [], pinned: false, depth,
        caption: write.verdict !== 'editable' ? write.caption
          : prop.trace ? 'One hop to a literal in this file.'
          : 'A quoted string literal at the usage site.',
        details: [`kind · ${prop.kind}`, ...byteRange(prop.start, prop.end),
          ...(prop.trace ? [`trace · ${prop.trace.label}`] : []),
          ...(prop.verdict === 'elsewhere' ? [`imported from · ${prop.from}`] : []), chain],
      });
    }
    for (const slot of link.slots) {
      const write = verdictOf(slot);
      rows.push({
        key: `${link.id}|slot|${slot.start}`,
        label: slot.name === 'default' ? 'slot' : `slot: ${slot.name}`,
        ...write, value: slot.source, destination: at,
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

/** Build the Values card's rows for one selection. */
export function buildValueRows(input: ValueRowsInput): ValueRows {
  const { selection, classification, classifyError, links } = input;
  const rows = [...pinnedRows(input), ...usageRows(links)];
  if (rows.length) return { rows, refusal: null };
  if (selection.opaque) {
    return { rows, refusal: 'Generated HTML — its inner elements have no proven source relationship.' };
  }
  if (!selection.source) return { rows, refusal: 'This element has no source annotation.' };
  if (classifyError) return { rows, refusal: classifyError };
  if (classification) return { rows, refusal: classification.reason };
  return { rows, refusal: 'No value was resolved for this selection.' };
}
