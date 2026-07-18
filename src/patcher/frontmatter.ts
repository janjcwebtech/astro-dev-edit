import { Document, parseDocument } from 'yaml';

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
    const doc = parsed.hasFrontmatter && frontmatterText.trim() !== ''
      ? parseDocument(frontmatterText)
      : new Document({});
    for (const [key, value] of Object.entries(fmChanges)) {
      if (value === null) doc.delete(key);
      else doc.set(key, value);
    }
    // lineWidth 0 disables wrapping: without it, untouched long plain scalars
    // get re-folded across lines just by round-tripping through toString().
    frontmatterText = doc.toString({ lineWidth: 0 });
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
