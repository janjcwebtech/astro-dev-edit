import { Document, isMap, isNode, isPair, isScalar, parseDocument } from 'yaml';

/**
 * Frontmatter entry parsing and patching for the CMS entry panel — pure
 * string-in/string-out, like the .astro patcher. Deliberately NOT a registry
 * `Patcher`: that interface is loc-based (classify/apply against a source
 * annotation), while entry edits target named frontmatter keys and the body.
 * The middleware still owns all filesystem access.
 *
 * The YAML block is patched via the `yaml` Document API so that comments, key
 * order, and the quoting style of untouched keys survive a save byte-for-byte.
 * Only the keys the client actually changed are re-emitted.
 */

export interface ParsedEntry {
  hasFrontmatter: boolean;
  /** Raw text between the fences ('' when none). \n-normalized. */
  frontmatterText: string;
  /** Parsed frontmatter mapping; {} when absent or not a mapping. */
  data: Record<string, unknown>;
  /** Set when the YAML block failed to parse — frontmatter edits must refuse. */
  yamlError?: string;
  /** Markdown body with the post-fence blank-line run stripped. \n-normalized. */
  body: string;
  /** Newline run that separated the closing fence from the body. */
  bodyGap: string;
  /** Dominant EOL of the original file, restored on write. */
  eol: '\n' | '\r\n';
  /** Leading byte-order mark, restored on write. */
  bom: string;
}

export interface EntryChanges {
  /** Only changed keys. `null` deletes the key. */
  frontmatter?: Record<string, unknown>;
  /** Full replacement body (\n-normalized). */
  body?: string;
}

export type EntryPatchResult =
  | { ok: true; newSource: string }
  | { ok: false; error: string };

const CLOSE_FENCE = /^(---|\.\.\.)[ \t]*$/;

export function parseEntry(source: string): ParsedEntry {
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
  const eol: '\n' | '\r\n' = source.includes('\r\n') ? '\r\n' : '\n';
  const text = source.slice(bom.length).replace(/\r\n/g, '\n');

  const empty: Omit<ParsedEntry, 'body' | 'bodyGap'> = {
    hasFrontmatter: false,
    frontmatterText: '',
    data: {},
    eol,
    bom,
  };

  const lines = text.split('\n');
  if (lines[0]?.trimEnd() !== '---') {
    const { body, bodyGap } = splitGap(text);
    return { ...empty, body, bodyGap };
  }

  const closeIdx = lines.findIndex((l, i) => i > 0 && CLOSE_FENCE.test(l));
  if (closeIdx === -1) {
    // Unterminated fence — treat the whole file as body so nothing is lost.
    const { body, bodyGap } = splitGap(text);
    return { ...empty, body, bodyGap };
  }

  const frontmatterText = lines.slice(1, closeIdx).join('\n') + (closeIdx > 1 ? '\n' : '');
  const rawBody = lines.slice(closeIdx + 1).join('\n');
  const { body, bodyGap } = splitGap(rawBody);

  let data: Record<string, unknown> = {};
  let yamlError: string | undefined;
  try {
    const doc = parseDocument(frontmatterText);
    if (doc.errors.length > 0) {
      yamlError = doc.errors[0].message;
    } else {
      const js = doc.toJS() as unknown;
      if (js && typeof js === 'object' && !Array.isArray(js)) {
        data = js as Record<string, unknown>;
      }
    }
  } catch (err) {
    yamlError = err instanceof Error ? err.message : String(err);
  }

  return { hasFrontmatter: true, frontmatterText, data, yamlError, body, bodyGap, eol, bom };
}

/** Split a leading newline run off the body so the textarea starts at content. */
function splitGap(raw: string): { body: string; bodyGap: string } {
  const m = raw.match(/^\n+/);
  return m ? { body: raw.slice(m[0].length), bodyGap: m[0] } : { body: raw, bodyGap: '' };
}

/** Byte span of one top-level `key: value` pair, from the key's first
 *  character to the end of its value — excluding any trailing inline comment
 *  and the line break after it. */
interface PairSpan {
  start: number;
  end: number;
}

/**
 * Index a mapping's top-level pairs by key name. A key that is not a plain
 * string, that appears twice, or whose value carries no source range maps to
 * `null`: without a single unambiguous span there is nothing to copy back.
 */
function pairSpans(doc: Document): Map<string, PairSpan | null> {
  const spans = new Map<string, PairSpan | null>();
  if (!isMap(doc.contents)) return spans;
  for (const item of doc.contents.items) {
    if (!isPair(item)) continue;
    const key = item.key;
    if (!isScalar(key) || typeof key.value !== 'string') continue;
    if (spans.has(key.value)) {
      spans.set(key.value, null); // duplicate key
      continue;
    }
    const start = key.range?.[0];
    const end = isNode(item.value) ? item.value.range?.[1] : undefined;
    spans.set(
      key.value,
      start !== undefined && end !== undefined && end > start ? { start, end } : null,
    );
  }
  return spans;
}

/**
 * Copy every untouched pair's original bytes back over the re-emitted ones.
 *
 * Re-serializing the document normalizes keys nobody asked about: long plain
 * scalars get re-folded (which `lineWidth: 0` answers), flow collections gain
 * padding inside their brackets (`[a, b]` becomes `[ a, b ]`), a four-space
 * block indent becomes two. Each is a separate stringify option, and chasing
 * them one at a time only ever fixes the instance in front of you — so the
 * bytes are restored wholesale instead, which is what this module's contract
 * has always promised. Keys the caller changed, added or deleted keep the
 * serializer's output, since for those there is no original to preserve.
 */
function restoreUntouchedPairs(
  before: string,
  beforeSpans: Map<string, PairSpan | null>,
  after: string,
  changed: Set<string>,
): string {
  const afterDoc = parseDocument(after);
  if (afterDoc.errors.length > 0) return after;

  const edits: { start: number; end: number; text: string }[] = [];
  for (const [name, afterSpan] of pairSpans(afterDoc)) {
    if (afterSpan === null || changed.has(name)) continue;
    const beforeSpan = beforeSpans.get(name);
    if (!beforeSpan) continue;
    const original = before.slice(beforeSpan.start, beforeSpan.end);
    const emitted = after.slice(afterSpan.start, afterSpan.end);
    if (original === emitted) continue;
    // A pair's span ends at its last character for a plain scalar, but at the
    // newline closing its final line for a block collection. Keep whichever
    // terminator the emitted text had so the bytes after the span still line up.
    const body = original.replace(/\n$/, '');
    edits.push({
      start: afterSpan.start,
      end: afterSpan.end,
      text: emitted.endsWith('\n') ? `${body}\n` : body,
    });
  }

  // Back to front, so an earlier edit cannot shift a later one's offsets.
  edits.sort((a, b) => b.start - a.start);
  let out = after;
  for (const edit of edits) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  return out;
}

/**
 * Apply field/body changes to an entry source. Untouched frontmatter keys,
 * comments, and ordering survive; a body-only change leaves the frontmatter
 * block byte-identical (and vice versa).
 */
export function applyEntryChanges(source: string, changes: EntryChanges): EntryPatchResult {
  const parsed = parseEntry(source);
  const fmChanges = changes.frontmatter ?? {};
  const fmKeys = Object.keys(fmChanges);

  if (fmKeys.length === 0 && changes.body === undefined) {
    return { ok: false, error: 'no changes to apply' };
  }

  let frontmatterText = parsed.frontmatterText;
  let hasFrontmatter = parsed.hasFrontmatter;

  if (fmKeys.length > 0) {
    if (parsed.yamlError) {
      return { ok: false, error: `frontmatter YAML is invalid: ${parsed.yamlError}` };
    }
    const hadMapping = parsed.hasFrontmatter && frontmatterText.trim() !== '';
    const doc = hadMapping ? parseDocument(frontmatterText) : new Document({});
    // Spans are read before the edits, while every node still carries the
    // range it parsed from.
    const beforeSpans = hadMapping ? pairSpans(doc) : new Map<string, PairSpan | null>();
    for (const [key, value] of Object.entries(fmChanges)) {
      if (value === null) doc.delete(key);
      else doc.set(key, value);
    }
    // lineWidth 0 disables wrapping: without it, untouched long plain scalars
    // get re-folded across lines just by round-tripping through toString().
    frontmatterText = doc.toString({ lineWidth: 0 });
    if (hadMapping) {
      frontmatterText = restoreUntouchedPairs(
        parsed.frontmatterText,
        beforeSpans,
        frontmatterText,
        new Set(fmKeys),
      );
    }
    if (frontmatterText === '{}\n') frontmatterText = ''; // emptied mapping
    hasFrontmatter = true;
  }

  const body = changes.body !== undefined ? changes.body.replace(/\r\n/g, '\n') : parsed.body;
  // A file with frontmatter conventionally separates fence and body with a
  // blank line; keep whatever the file had, defaulting to one for new fences.
  const gap = parsed.hasFrontmatter ? parsed.bodyGap : (hasFrontmatter ? '\n' : parsed.bodyGap);

  let text = hasFrontmatter
    ? `---\n${frontmatterText}---\n${gap}${body}`
    : `${gap}${body}`;
  if (text !== '' && !text.endsWith('\n')) text += '\n';

  if (parsed.eol === '\r\n') text = text.replace(/\n/g, '\r\n');
  return { ok: true, newSource: parsed.bom + text };
}

/** Build a brand-new entry file from scratch (for /entry/create). */
export function serializeEntry(frontmatter: Record<string, unknown>, body: string): string {
  const doc = new Document(frontmatter);
  const fm = doc.toString({ lineWidth: 0 });
  const normalizedBody = body.replace(/\r\n/g, '\n');
  let text = `---\n${fm}---\n\n${normalizedBody}`;
  if (!text.endsWith('\n')) text += '\n';
  return text;
}
