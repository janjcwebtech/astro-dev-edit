import type { RefusalCode, UsageApplyTarget, UsageProp, UsageSlot, UsageWrite } from '../shared/protocol.ts';
import type { ApplyResult } from '../patcher/types.ts';
import { escapeAttrValue } from '../patcher/astro.ts';
import { encodeLiteral, locateEntryValue, locateValue } from '../patcher/expression-trace.ts';
import { parseFile, proveEntry, type ParsedUsage } from './usage-parse.ts';

/**
 * Writing a value passed at a component usage site — a quoted prop, the
 * frontmatter literal a traced prop reads, or a run of literal slot text.
 *
 * **Pure: string in, string out, no fs** (rule 6). The route reads the file,
 * resolves the usage id through its own index and writes through `writeText`;
 * everything between is here, and it refuses whatever it cannot prove.
 *
 * ## A sibling resolver, not a looser one
 *
 * `patcher/astro.ts::resolveElement` matches a plain element by the loc Astro
 * would have annotated it with. A component tag has no annotation, so there is
 * nothing to match — the usage site's own loc, minted by `usage-parse.ts` and
 * carried by the `UsageLink`, is the address instead. Loosening the element
 * resolver to accept component tags would have made every element lookup
 * fuzzier to serve a case that already has an exact address.
 *
 * ## Content is accepted; source syntax is preserved
 *
 * Braces, angle brackets and quotes are ordinary words and none of them is a
 * reason to refuse. Each destination has its own spelling and the value is
 * encoded for the one it is going to: a quoted attribute through
 * `escapeAttrValue`, a JavaScript string literal through `encodeLiteral` in
 * the quote style already there, template text through {@link encodeSlotText}.
 * Nothing an edit can contain may become structure or behaviour.
 *
 * The guarantee is checked rather than asserted: the patched source is parsed
 * again and the value has to **read back** as exactly what was typed. A write
 * whose own encoding does not round-trip is refused with the file untouched.
 */

/**
 * Slot children are template text. `<` may not open a tag, `{` may not open an
 * expression, `&` may not form an entity — and `>` and `}` are encoded too, so
 * the run reads back as the plain text `slotWrite` is willing to call text.
 */
function encodeSlotText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
}

export interface UsageWriteRequest {
  /** The usage site's own loc, from the server's index — never from the
   *  client, which names a usage id and nothing else. */
  loc: string;
  /** The component's name at that site, as the index recorded it. */
  name: string;
  target: UsageApplyTarget;
  /** `0` when the chain broke; a mapped value then refuses. */
  ordinal: number;
  original: string;
  newText: string;
}

const refuse = (code: RefusalCode, error: string): ApplyResult => ({ ok: false, code, error });

/** One sentence per refusal, in the reader's vocabulary rather than the
 *  parser's. The verdict is already named; this says what to do about it. */
const REFUSALS: Record<string, string> = {
  styling: 'This prop is styling rather than content, so it is not edited here.',
  directive: 'This is a directive, not a value with words in it.',
  spread: 'This value is spread in from the caller’s caller, so it is not written at this usage site.',
  boolean: 'This prop is a flag with no string to write.',
  computed: 'This value is computed as the page renders.',
  template: 'This value is a template literal, so it has no fixed string to write.',
  untraced: 'This value has no proven path to a literal in this file.',
  'unproven-entry': 'Which entry of the array this render read is not proven, so nothing is written. Edit it in the source instead.',
  markup: 'This slot content is markup rather than words; the values inside it have rows of their own.',
  empty: 'There is nothing but whitespace here to edit.',
  unlocated: 'The source no longer reads the way the page described it. Reload and try again.',
  unsupported: 'This value has a shape the inspector does not model.',
  imported: 'This value is written in another module. Edit it there.',
};

/** The one usage site this write names, or a refusal. Two sites cannot share a
 *  loc, so more than one hit means the file moved under the request. */
function resolveUsage(usages: readonly ParsedUsage[], req: UsageWriteRequest): ParsedUsage | null {
  const hits = usages.filter(usage => usage.loc === req.loc && usage.name === req.name);
  return hits.length === 1 ? hits[0] : null;
}

/** The value at the offset the panel was shown, selected among the ones this
 *  parse found — never trusted as bytes to write into. */
function selectValue(usage: ParsedUsage, target: UsageApplyTarget): { value: UsageProp | UsageSlot; index: number } | null {
  const pool: readonly (UsageProp | UsageSlot)[] = target.kind === 'prop' ? usage.props : usage.slots;
  const hits = pool.map((value, index) => ({ value, index }))
    .filter(({ value }) => value.start === target.start && value.name === target.name);
  return hits.length === 1 ? hits[0] : null;
}

/** The value a proven write target holds, after the render ordinal has had its
 *  say. Props only: a slot run is literal text at a fixed range. */
function verdictFor(value: UsageProp | UsageSlot, frontmatter: string, ordinal: number, kind: 'prop' | 'slot'): UsageWrite {
  return kind === 'prop' ? proveEntry(frontmatter, value, ordinal) : value;
}

export async function applyUsageWrite(source: string, req: UsageWriteRequest): Promise<ApplyResult> {
  // A line break would move every usage site below it, and a usage site is
  // addressed by its loc — so a content write keeps the file's line structure
  // exactly as it found it.
  if (/[\r\n]/.test(req.newText)) {
    return refuse('unsupported', 'A value at a usage site is written on one line; a line break has to be added in the source.');
  }
  const parsed = await parseFile(source);
  const usage = resolveUsage(parsed.usages, req);
  if (!usage) {
    return refuse('unresolved', 'No component usage matches this source location — the file may have changed. Reload and try again.');
  }
  const selected = selectValue(usage, req.target);
  if (!selected) {
    return refuse('unresolved', `No ${req.target.kind} named “${req.target.name}” is at that position any more — the file may have changed. Reload and try again.`);
  }
  const write = verdictFor(selected.value, parsed.frontmatter, req.ordinal, req.target.kind);
  if (write.verdict !== 'editable') {
    return refuse(write.reason === 'unlocated' ? 'mismatch' : 'dynamic',
      REFUSALS[write.reason] ?? 'This value is not editable here.');
  }
  // Verify-then-patch (rule 5): the words the panel showed against the words
  // the file holds now, before anything is replaced.
  if (write.value !== req.original) {
    return refuse('mismatch', 'The source no longer matches what the panel showed (it may have been edited elsewhere). Reload and try again.');
  }

  // A quoted attribute keeps the spaces it is given — they are content there.
  // A slot run's outer whitespace is the file's indentation, and a frontmatter
  // literal is written trimmed, exactly as the expression patcher writes one.
  const expected = write.trace || req.target.kind === 'slot' ? req.newText.trim() : req.newText;
  const patched = write.trace
    ? patchTracedLiteral(source, parsed, write, req)
    : patchInPlace(source, selected.value, req);
  if (!patched.ok) return patched;

  // Read back: the same parse, the same selector, and the value has to be
  // exactly what was typed. An encoding that does not round-trip refuses here
  // with the file still untouched.
  const after = await parseFile(patched.newSource);
  const site = after.usages[parsed.usages.indexOf(usage)];
  const written = site && site.name === usage.name
    ? (req.target.kind === 'prop' ? site.props : site.slots)[selected.index] : undefined;
  const verdict = written && verdictFor(written, after.frontmatter, req.ordinal, req.target.kind);
  if (!verdict || verdict.verdict !== 'editable' || verdict.value !== expected) {
    return refuse('unsupported', 'The value could not be written so that it reads back unchanged, so nothing was written.');
  }
  return patched;
}

/** A quoted attribute or a run of slot text: the bytes at the proven range,
 *  re-encoded for the destination they sit in. */
function patchInPlace(source: string, value: UsageProp | UsageSlot, req: UsageWriteRequest): ApplyResult {
  const { start, end } = value;
  if (typeof start !== 'number' || typeof end !== 'number') {
    return refuse('unsupported', 'This value has no proven byte range to write into.');
  }
  if (req.target.kind === 'slot') {
    const region = source.slice(start, end);
    const text = req.newText.trim();
    if (!text) return refuse('unsupported', 'Slot text cannot be emptied from here; remove the content in the source.');
    // The region's own indentation stays, exactly as `patcher/astro.ts`
    // splices a text edit: the words change, the file's shape does not.
    const lead = /^\s*/.exec(region)![0];
    const trail = lead.length === region.length ? '' : /\s*$/.exec(region)![0];
    return { ok: true, newSource: source.slice(0, start) + lead + encodeSlotText(text) + trail + source.slice(end) };
  }
  const quote = source[start];
  if ((quote !== '"' && quote !== "'") || source[end - 1] !== quote) {
    return refuse('unsupported', 'This prop is not a quoted string in the source, so it is not written from here.');
  }
  return { ok: true,
    newSource: source.slice(0, start + 1) + escapeAttrValue(req.newText, quote) + source.slice(end - 1) };
}

/** A prop that reads a frontmatter literal. The tag is never touched — the
 *  loop keeps rendering exactly as it did, and only the words change. */
function patchTracedLiteral(
  source: string,
  parsed: { frontmatter: string; frontmatterAt: number },
  write: UsageWrite & { verdict: 'editable' },
  req: UsageWriteRequest,
): ApplyResult {
  const trace = write.trace!;
  const found = trace.array
    ? locateEntryValue(parsed.frontmatter, trace, req.ordinal)
    : locateValue(parsed.frontmatter, trace, req.original);
  if (!found.ok) return refuse(found.code === 'untraceable' ? 'dynamic' : found.code, found.error);
  const { from, to, quote } = found.span;
  const at = parsed.frontmatterAt;
  return { ok: true, newSource: source.slice(0, at + from) +
    quote + encodeLiteral(req.newText.trim(), quote) + quote + source.slice(at + to) };
}
