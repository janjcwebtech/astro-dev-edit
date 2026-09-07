import type {
  FieldType,
  SchemaFieldSpec,
  SchemaForm as WireSchemaForm,
} from '../shared/protocol.ts';

/**
 * Reads and patches a project's `content.config.ts` — the schema half of the
 * collection designer. Pure string-in/string-out, like every other patcher; the
 * route owns all filesystem access.
 *
 * Deliberately **not** a registry `Patcher`: that interface is loc-based
 * (classify/apply against a source annotation), while this targets named
 * collections and named schema keys. It is the same kind of module as
 * `frontmatter.ts`, and shares its contract — the untouched bytes of the file,
 * comments and quoting included, come out exactly as they went in.
 *
 * **No JavaScript parser, by design.** `expression-trace.ts` already records the
 * reasoning: a runtime dependency is not worth taking on for a job whose failure
 * mode must be *refusal* anyway. It applies with more force here, because the
 * target is TypeScript — Vite's re-exported `parseAst` is a JavaScript parser and
 * throws on `import type`, `satisfies`, `as` and type annotations, all of which
 * belong in a real content config.
 *
 * So: a scanner anchored on shapes it can prove, refusing everything else.
 * {@link blankNonCode} makes that safe by blanking every string, template,
 * comment and regex literal to spaces first, so no brace, comma or colon inside
 * a string is ever mistaken for structure. Offsets are preserved, so every span
 * found in the blanked copy indexes the original.
 *
 * The shapes it can prove:
 *
 * - `const <name> = defineCollection({ … schema: z.object({ … }) })`
 * - `const <name> = defineCollection({ … schema: ({ image }) => z.object({ … }) })`
 * - `export const collections = { … }` — the registry a new name is added to
 *
 * Anything else — a schema built by a helper, a spread in the field list, a
 * conditional — is `unrecognized`, and the UI offers "open source" instead of
 * guessing. A refusal is a correct outcome here; a bad guess is not.
 *
 * **{@link renderZodField} is the inverse of `schema-introspect.ts::terminalType`
 * and the two must stay in step** — the same standing invariant `annotate.ts`
 * has against the patcher's loc rules. `tests/content-config-patch.test.ts`
 * guards it with a round trip through the real zod.
 */

/** Why a patch was refused.
 *
 *  - `unrecognized` — the shape isn't one this module can prove, so it won't try.
 *  - `missing` — the named collection, field or registry isn't there.
 *  - `exists` — it is already there.
 *  - `unsupported` — readable and present, but this edit can't be expressed
 *    (an `image()` field on a plain object schema, a `json` widget, a default on
 *    a date).
 */
export type ConfigRefusalCode = 'unrecognized' | 'missing' | 'exists' | 'unsupported';

export type ConfigPatchResult =
  | { ok: true; newSource: string }
  | { ok: false; error: string; code: ConfigRefusalCode };

/** A field as the designer describes it. The wire shape is the only shape —
 *  `protocol.ts` owns it, so a request body needs no translation here. */
export type SchemaField = SchemaFieldSpec;

/** One field as it stands in the source: its key and its zod expression
 *  verbatim, so the panel can show what it can't yet model. */
export interface RawSchemaField {
  name: string;
  expr: string;
}

/** How a collection's `schema:` is written. The wire shape is the only shape,
 *  the same way {@link SchemaField} is. */
export type SchemaForm = WireSchemaForm;

export interface CollectionBlock {
  /** The `const` name, which is also the key the registry uses. */
  name: string;
  /** Null when the schema key is absent or its shape wasn't recognized. */
  schemaForm: SchemaForm | null;
  /** Fields in source order. Empty when the schema wasn't recognized. */
  fields: RawSchemaField[];
  /** Why the schema can't be patched, when it can't. */
  unrecognized?: string;
  /** Whether the const appears in `export const collections`. */
  registered: boolean;
  /** 1-based line of the `const <name> = defineCollection(` statement, so the
   *  panel's "open source" can jump to the block rather than the file top. */
  line: number;
}

/** The shape {@link addCollection} emits. */
export interface NewCollection {
  name: string;
  /** Repo-relative entry directory, used as the glob loader's `base`. */
  dir: string;
  /** Glob pattern for the loader. Defaults to `**\/*.md`. */
  pattern?: string;
  /** Which form to write the schema in. Stated, not inferred from the fields:
   *  a collection may want `image()` in scope before it has an image field, and
   *  the designer's own switch is what says so. Defaults to `object`, and a
   *  spec that holds an image field is promoted regardless — that combination
   *  cannot compile otherwise. */
  schemaForm?: SchemaForm;
  fields: SchemaField[];
}

// --- Lexing ------------------------------------------------------------------

/**
 * The source with every string, template, comment and regex-literal character
 * replaced by a space — newlines kept, so offsets and line numbers are
 * unchanged. Every scan in this module runs against this copy and slices the
 * original, which is what makes plain character matching safe.
 *
 * Templates are blanked whole, `${…}` included. That keeps braces balanced
 * (both the opener and its closer go), and a content config with structure
 * hiding inside a template expression is not a shape this module claims.
 *
 * Exported for the tests, which pin the blanking itself — it is the assumption
 * every other function here rests on.
 */
export function blankNonCode(source: string): string {
  const out = source.split('');
  let i = 0;
  let prevSig = '';
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < out.length; k++) {
      if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
    }
  };

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '/' && next === '/') {
      const nl = source.indexOf('\n', i);
      const end = nl === -1 ? source.length : nl;
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === '/' && next === '*') {
      const close = source.indexOf('*/', i + 2);
      const end = close === -1 ? source.length : close + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = endOfQuoted(source, i, ch);
      blank(i, end);
      i = end;
      prevSig = 'x';
      continue;
    }
    if (ch === '`') {
      const end = endOfTemplate(source, i);
      blank(i, end);
      i = end;
      prevSig = 'x';
      continue;
    }
    if (ch === '/' && REGEX_START.test(prevSig)) {
      const end = endOfRegex(source, i);
      blank(i, end);
      i = end;
      prevSig = 'x';
      continue;
    }
    if (!/\s/.test(ch)) prevSig = ch;
    i++;
  }
  return out.join('');
}

/** Characters after which a `/` starts a regex literal rather than a division.
 *  Empty (start of file) counts, hence the `^$` alternative. */
const REGEX_START = /^$|^[(,=:[!&|?{};+\-*%~^<>]$/;

/** Index just past the closing quote (or end of source). */
function endOfQuoted(src: string, open: number, quote: string): number {
  let i = open + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    // An unterminated single-line string: stop at the newline rather than
    // blanking the rest of the file.
    if (c === '\n') return i;
    i++;
  }
  return src.length;
}

/** Index just past the closing backtick, nested templates included. */
function endOfTemplate(src: string, open: number): number {
  let i = open + 1;
  let depth = 0; // brace depth inside a ${…}
  let inExpr = false;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (!inExpr && c === '$' && src[i + 1] === '{') {
      inExpr = true;
      depth = 1;
      i += 2;
      continue;
    }
    if (inExpr) {
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) inExpr = false;
      } else if (c === '`') {
        i = endOfTemplate(src, i);
        continue;
      }
      i++;
      continue;
    }
    if (c === '`') return i + 1;
    i++;
  }
  return src.length;
}

/** Index just past a regex literal's flags. */
function endOfRegex(src: string, open: number): number {
  let i = open + 1;
  let inClass = false;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '\n') return i;
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) {
      i++;
      while (i < src.length && /[a-z]/.test(src[i])) i++;
      return i;
    }
    i++;
  }
  return src.length;
}

const CLOSERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

/** Index of the bracket matching the one at `open` in a **blanked** source, or
 *  -1 when unbalanced. */
function matchBracket(code: string, open: number): number {
  const stack: string[] = [];
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (CLOSERS[c]) {
      stack.push(CLOSERS[c]);
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** First non-whitespace index at or after `i` (blanked source, so comments are
 *  already whitespace). */
function skipSpace(code: string, i: number, end = code.length): number {
  let k = i;
  while (k < end && /\s/.test(code[k])) k++;
  return k;
}

/** Last index before `end` that isn't whitespace, plus one. */
function trimEnd(code: string, start: number, end: number): number {
  let k = end;
  while (k > start && /\s/.test(code[k - 1])) k--;
  return k;
}

interface Entry {
  /** Code start of the whole entry (its key). */
  start: number;
  /** Code end of the whole entry, trailing trivia trimmed. */
  end: number;
  /** Parsed key, or null when the entry isn't `key: value`. */
  name: string | null;
  /** Code start of the value expression. */
  valueStart: number;
}

/**
 * Top-level `key: value` entries of the object literal whose `{` is at
 * `braceOpen`. Anything that isn't a plain key (a spread, a computed key, a
 * shorthand, a method) comes back with `name: null` — callers refuse rather than
 * patch a list they can't fully account for.
 */
function readEntries(code: string, braceOpen: number, braceClose: number): Entry[] {
  const entries: Entry[] = [];
  let depth = 0;
  let segStart = braceOpen + 1;
  const push = (from: number, to: number): void => {
    const start = skipSpace(code, from, to);
    const end = trimEnd(code, start, to);
    if (start >= end) return;
    entries.push({ start, end, ...parseKey(code, start, end) });
  };
  for (let i = braceOpen + 1; i < braceClose; i++) {
    const c = code[i];
    if (CLOSERS[c]) depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      push(segStart, i);
      segStart = i + 1;
    }
  }
  push(segStart, braceClose);
  return entries;
}

const IDENT = /^[A-Za-z_$][\w$]*/;

function parseKey(code: string, start: number, end: number): { name: string | null; valueStart: number } {
  let i = start;
  let name: string | null = null;
  const quote = code[i];
  if (quote === '"' || quote === "'") {
    // The key text was blanked, so read it from the original later; here only
    // the span matters. Quoted keys are recognized but their name is unknown
    // from the blanked copy — the caller re-reads it.
    const close = code.indexOf(quote, i + 1);
    if (close === -1) return { name: null, valueStart: start };
    name = '';
    i = close + 1;
  } else {
    const m = IDENT.exec(code.slice(i, end));
    if (!m) return { name: null, valueStart: start };
    name = m[0];
    i += m[0].length;
  }
  i = skipSpace(code, i, end);
  if (code[i] !== ':') return { name: null, valueStart: start };
  return { name, valueStart: skipSpace(code, i + 1, end) };
}

// --- Locating ----------------------------------------------------------------

interface LocatedBlock extends Omit<CollectionBlock, 'line'> {
  /** First character of the `schema:` value, when the schema was recognized.
   *  On the function form this is the `(` of the parameter list. */
  schemaValueStart: number;
  /** Where `z.object` begins — the same offset on both forms, since the
   *  function form is exactly the object form with a prefix. The span between
   *  this and {@link schemaValueStart} *is* the arrow function's head, which is
   *  what makes switching between the forms an insert or a delete of one span
   *  rather than a rewrite. */
  zodObjectAt: number;
  /** `{` of the field object, when the schema was recognized. */
  fieldsOpen: number;
  /** matching `}` of the field object. */
  fieldsClose: number;
  /** Entry spans inside the field object. */
  entries: Entry[];
  /** Statement start of the whole `const … = defineCollection(…)`. */
  blockStart: number;
}

const COLLECTION_RE =
  /(^|[\n;])([ \t]*)(export[ \t]+)?const[ \t]+([A-Za-z_$][\w$]*)[ \t]*(?::[^=;]*)?=[\s]*defineCollection[\s]*\(/g;

interface Located {
  code: string;
  blocks: LocatedBlock[];
  /** `{` and `}` of `export const collections = { … }`, when present. */
  registry: { open: number; close: number; start: number; entries: Entry[] } | null;
}

function locate(source: string): Located {
  const code = blankNonCode(source);
  const blocks: LocatedBlock[] = [];
  const registry = locateRegistry(source, code);
  const registered = new Set(
    (registry?.entries ?? [])
      .map((e) => entryKey(source, code, e))
      .filter((n): n is string => Boolean(n)),
  );

  COLLECTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COLLECTION_RE.exec(code))) {
    const name = m[4];
    const argOpen = m.index + m[0].length - 1;
    const blockStart = m.index + m[1].length;
    const argClose = matchBracket(code, argOpen);
    const base = { name, registered: registered.has(name), blockStart };
    if (argClose === -1) {
      blocks.push({
        ...base,
        schemaForm: null,
        fields: [],
        unrecognized: 'the defineCollection(…) call is unbalanced',
        schemaValueStart: -1,
        zodObjectAt: -1,
        fieldsOpen: -1,
        fieldsClose: -1,
        entries: [],
      });
      continue;
    }
    blocks.push({ ...base, ...readSchema(source, code, argOpen, argClose) });
  }
  return { code, blocks, registry };
}

type SchemaPart = Omit<LocatedBlock, 'name' | 'registered' | 'blockStart'>;

function unreadable(reason: string): SchemaPart {
  return {
    schemaForm: null,
    fields: [],
    unrecognized: reason,
    schemaValueStart: -1,
    zodObjectAt: -1,
    fieldsOpen: -1,
    fieldsClose: -1,
    entries: [],
  };
}

/** The `schema:` value inside a `defineCollection(` argument list. */
function readSchema(source: string, code: string, argOpen: number, argClose: number): SchemaPart {
  const objOpen = skipSpace(code, argOpen + 1, argClose);
  if (code[objOpen] !== '{') {
    return unreadable('defineCollection() is not called with an object literal');
  }
  const objClose = matchBracket(code, objOpen);
  if (objClose === -1) return unreadable('the collection config object is unbalanced');

  const schemaEntry = readEntries(code, objOpen, objClose).find(
    (e) => e.name === 'schema' || (e.name === '' && readQuotedKey(source, e.start) === 'schema'),
  );
  if (!schemaEntry) return unreadable('this collection has no schema');

  // Either `z.object(` directly, or an arrow function returning one — the form
  // that receives Astro's image() helper.
  let form: SchemaForm = 'object';
  let at = schemaEntry.valueStart;
  const arrow = findArrow(code, at, schemaEntry.end);
  if (arrow !== -1) {
    form = 'function';
    at = skipSpace(code, arrow + 2, schemaEntry.end);
    // `=> (z.object({…}))` and `=> ({…})` both start with a paren; only the
    // first is a shape we can prove.
    while (code[at] === '(') {
      const inner = skipSpace(code, at + 1, schemaEntry.end);
      if (code.startsWith('z.object', inner)) at = inner;
      else break;
    }
  }
  if (!code.startsWith('z.object', at)) {
    return unreadable(
      form === 'function'
        ? 'the schema function does not return a plain z.object({…})'
        : 'the schema is not a plain z.object({…})',
    );
  }
  const callOpen = skipSpace(code, at + 'z.object'.length, schemaEntry.end);
  if (code[callOpen] !== '(') return unreadable('z.object is not called');
  const callClose = matchBracket(code, callOpen);
  if (callClose === -1) return unreadable('the z.object(…) call is unbalanced');
  const fieldsOpen = skipSpace(code, callOpen + 1, callClose);
  if (code[fieldsOpen] !== '{') return unreadable('z.object() is not given an object literal');
  const fieldsClose = matchBracket(code, fieldsOpen);
  if (fieldsClose === -1) return unreadable('the schema field list is unbalanced');

  const entries = readEntries(code, fieldsOpen, fieldsClose);
  const fields: RawSchemaField[] = [];
  for (const e of entries) {
    const name = e.name === '' ? readQuotedKey(source, e.start) : e.name;
    if (!name) {
      return unreadable(
        'the schema field list holds something other than plain `name: schema` entries',
      );
    }
    e.name = name;
    fields.push({ name, expr: source.slice(e.valueStart, e.end) });
  }
  return {
    schemaForm: form,
    fields,
    schemaValueStart: schemaEntry.valueStart,
    zodObjectAt: at,
    fieldsOpen,
    fieldsClose,
    entries,
  };
}

/** Index of the `=>` that separates an arrow function's params from its body, at
 *  the top level of `[start, end)`; -1 when the value isn't an arrow function. */
function findArrow(code: string, start: number, end: number): number {
  let depth = 0;
  for (let i = start; i < end - 1; i++) {
    const c = code[i];
    if (CLOSERS[c]) depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && c === '=' && code[i + 1] === '>') return i;
  }
  return -1;
}

/** A quoted key's text, read from the original source at a span the blanked copy
 *  located. Only simple quoting is accepted — an escape means we don't know the
 *  key for certain, so it reads as unknown. */
function readQuotedKey(source: string, start: number): string | null {
  const quote = source[start];
  if (quote !== '"' && quote !== "'") return null;
  const close = source.indexOf(quote, start + 1);
  if (close === -1) return null;
  const raw = source.slice(start + 1, close);
  return raw.includes('\\') ? null : raw;
}

/**
 * An object entry's key: a bare identifier, a quoted key, or — as
 * `export const collections = { blog, works }` writes it — a shorthand, where
 * the entry *is* the name. Null when it is none of those.
 */
function entryKey(source: string, code: string, e: Entry): string | null {
  if (e.name === '') return readQuotedKey(source, e.start);
  if (e.name) return e.name;
  const m = IDENT.exec(code.slice(e.start, e.end));
  return m && e.start + m[0].length === trimEnd(code, e.start, e.end) ? m[0] : null;
}

function locateRegistry(source: string, code: string): Located['registry'] {
  const m = /(^|[\n;])[ \t]*export[ \t]+const[ \t]+collections[ \t]*(?::[^=;]*)?=[\s]*\{/.exec(code);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = matchBracket(code, open);
  if (close === -1) return null;
  return {
    open,
    close,
    start: m.index + m[1].length,
    entries: readEntries(code, open, close),
  };
}

// --- Reading -----------------------------------------------------------------

/** Every `defineCollection` block in the file, in source order. */
export function readCollectionBlocks(source: string): CollectionBlock[] {
  return locate(source).blocks.map((b) => ({
    name: b.name,
    schemaForm: b.schemaForm,
    fields: b.fields,
    ...(b.unrecognized ? { unrecognized: b.unrecognized } : {}),
    registered: b.registered,
    line: source.slice(0, b.blockStart).split('\n').length,
  }));
}

// --- Rendering ---------------------------------------------------------------

export type RenderResult = { ok: true; expr: string } | { ok: false; error: string };

/** Base zod expression per {@link FieldType}. `json` and `image` are handled by
 *  {@link renderZodField} — the first can't be synthesized from a widget name,
 *  the second needs the function schema form. */
const BASE_EXPR: Partial<Record<FieldType, string>> = {
  // `textarea` is widget-only: `terminalType` never produces it, so it stores a
  // `fields.<key>.widget` override alongside a plain string in the schema.
  text: 'z.string()',
  textarea: 'z.string()',
  date: 'z.coerce.date()',
  number: 'z.number()',
  boolean: 'z.boolean()',
  tags: 'z.array(z.string())',
};

/**
 * The zod expression for a field — the inverse of
 * `schema-introspect.ts::terminalType`, and the piece those two must keep in
 * step. `tests/content-config-patch.test.ts` round-trips every `FieldType`
 * through the real zod to hold the pair together.
 */
export function renderZodField(field: SchemaField, form: SchemaForm): RenderResult {
  let base: string;
  if (field.type === 'json') {
    return {
      ok: false,
      error: 'A read-only JSON field has no schema shape to write. Edit the config by hand.',
    };
  } else if (field.type === 'image') {
    if (form !== 'function') {
      return {
        ok: false,
        error:
          "An image() field needs Astro's image helper, which only the function schema form " +
          'receives. Change this collection\'s schema to `({ image }) => z.object({ … })` first.',
      };
    }
    base = 'image()';
  } else if (field.type === 'select') {
    const options = field.options ?? [];
    if (options.length === 0) {
      return { ok: false, error: 'A select field needs at least one option.' };
    }
    base = `z.enum([${options.map(quote).join(', ')}])`;
  } else {
    const known = BASE_EXPR[field.type];
    if (!known) return { ok: false, error: `Unsupported field type "${field.type}".` };
    base = known;
  }

  const hasDefault = field.defaultValue !== undefined && field.defaultValue !== '';
  if (hasDefault) {
    if (field.type === 'date' || field.type === 'image') {
      return {
        ok: false,
        error: `A ${field.type} field can't take a default from here — add one in the config by hand.`,
      };
    }
    const lit = literal(field.defaultValue, field.type);
    if (!lit) return { ok: false, error: `That default isn't valid for a ${field.type} field.` };
    return { ok: true, expr: `${base}.default(${lit})` };
  }
  return { ok: true, expr: field.required ? base : `${base}.optional()` };
}

/** Single-quoted string literal, matching the repo's own style. */
function quote(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** A default value as source, or null when it can't be one. */
function literal(value: unknown, type: FieldType): string | null {
  if (type === 'number') {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? String(n) : null;
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return String(value);
    if (value === 'true' || value === 'false') return String(value);
    return null;
  }
  if (type === 'tags') {
    const list = Array.isArray(value) ? value : String(value).split(',').map((s) => s.trim());
    if (!list.every((v) => typeof v === 'string')) return null;
    return `[${list.filter(Boolean).map(quote).join(', ')}]`;
  }
  return typeof value === 'string' ? quote(value) : null;
}

// --- Patching ----------------------------------------------------------------

/** Resolve a collection to a patchable block, or the refusal that explains why
 *  it isn't one. */
function patchable(
  source: string,
  collection: string,
): { ok: true; found: LocatedBlock } | { ok: false; error: string; code: ConfigRefusalCode } {
  const { blocks } = locate(source);
  const found = blocks.find((b) => b.name === collection);
  if (!found) {
    return {
      ok: false,
      code: 'missing',
      error: `No \`const ${collection} = defineCollection(…)\` in this config.`,
    };
  }
  if (found.unrecognized || found.fieldsOpen === -1) {
    return {
      ok: false,
      code: 'unrecognized',
      error: `${collection}: ${found.unrecognized ?? 'the schema field list could not be located'}.`,
    };
  }
  return { ok: true, found };
}

/** Add a field to a collection's schema. */
export function addField(source: string, collection: string, field: SchemaField): ConfigPatchResult {
  const target = patchable(source, collection);
  if (!target.ok) return target;
  const { found } = target;
  if (!validName(field.name)) {
    return { ok: false, code: 'unsupported', error: `"${field.name}" is not a valid field name.` };
  }
  if (found.fields.some((f) => f.name === field.name)) {
    return { ok: false, code: 'exists', error: `${collection} already has a "${field.name}" field.` };
  }
  const rendered = renderZodField(field, found.schemaForm ?? 'object');
  if (!rendered.ok) return { ok: false, code: 'unsupported', error: rendered.error };

  return {
    ok: true,
    newSource: appendEntry(
      source,
      found.fieldsOpen,
      found.fieldsClose,
      found.entries,
      `${field.name}: ${rendered.expr}`,
      fieldIndent(source, found),
    ),
  };
}

/**
 * Append `text` as a new last entry of the object literal spanning
 * `[open, close]`, normalizing the previous last entry's trailing comma and
 * keeping the file's existing single-line or multiline style. `text` carries no
 * comma of its own — one is added only where the style wants it.
 */
function appendEntry(
  source: string,
  open: number,
  close: number,
  entries: Entry[],
  text: string,
  indent: string,
): string {
  const last = entries[entries.length - 1];
  const lastEnd = last ? last.end : open + 1;
  const between = source.slice(lastEnd, close);
  const needsComma = last !== undefined && !blankNonCode(between).includes(',');

  if (!source.slice(open, close).includes('\n')) {
    // `z.object({ title: z.string() })` — stay on the one line, no trailing comma.
    const at = trimEnd(source, open + 1, close);
    return `${source.slice(0, at)}${needsComma ? ',' : ''} ${text} ${source.slice(close)}`;
  }

  let lineStart = close;
  while (lineStart > 0 && source[lineStart - 1] !== '\n') lineStart--;
  const ownLine = /^[ \t]*$/.test(source.slice(lineStart, close));
  const insertAt = ownLine ? lineStart : close;
  const insertion = ownLine ? `${indent}${text},\n` : `\n${indent}${text},`;
  return (
    source.slice(0, lastEnd) +
    (needsComma ? ',' : '') +
    source.slice(lastEnd, insertAt) +
    insertion +
    source.slice(insertAt)
  );
}

/**
 * Retype an existing field. Only the zod expression is replaced — the key, its
 * comments and the surrounding formatting are untouched.
 *
 * There is deliberately no rename: a schema key is the frontmatter key in every
 * entry file, so renaming it here alone would break the collection. The designer
 * offers remove + add instead, which is the honest shape of that operation.
 */
export function updateField(
  source: string,
  collection: string,
  field: SchemaField,
): ConfigPatchResult {
  const target = patchable(source, collection);
  if (!target.ok) return target;
  const { found } = target;
  const entry = found.entries.find((e) => e.name === field.name);
  if (!entry) {
    return { ok: false, code: 'missing', error: `${collection} has no "${field.name}" field.` };
  }
  const rendered = renderZodField(field, found.schemaForm ?? 'object');
  if (!rendered.ok) return { ok: false, code: 'unsupported', error: rendered.error };
  return {
    ok: true,
    newSource: source.slice(0, entry.valueStart) + rendered.expr + source.slice(entry.end),
  };
}

/**
 * Switch a collection's schema between the two forms.
 *
 * The forms differ by exactly one span — the arrow function's head — so this is
 * an insert or a delete at a located offset, never a rewrite. Promoting leaves
 * every existing field expression, comment and line break where it was; the
 * `z.object({` that followed `schema:` simply now follows `({ image }) =>`.
 *
 * Demoting is refused while any field still calls `image()`, because that
 * helper would go out of scope and the collection would stop building. The
 * refusal names the fields, since "remove them first" is only actionable if you
 * know which they are.
 *
 * Neither direction re-indents the field list. A demoted schema's fields keep
 * the deeper indentation the function form gave them — cosmetic, visible in
 * `git diff`, and preferable to moving lines this patch was not asked to touch.
 */
export function setSchemaForm(
  source: string,
  collection: string,
  form: SchemaForm,
): ConfigPatchResult {
  const target = patchable(source, collection);
  if (!target.ok) return target;
  const { found } = target;
  if (found.schemaForm === form) {
    return { ok: true, newSource: source };
  }
  if (form === 'function') {
    return {
      ok: true,
      newSource:
        source.slice(0, found.zodObjectAt) + '({ image }) => ' + source.slice(found.zodObjectAt),
    };
  }
  const users = found.fields.filter((f) => usesImageHelper(f.expr)).map((f) => f.name);
  if (users.length > 0) {
    return {
      ok: false,
      code: 'unsupported',
      error:
        `${collection}: ${users.join(', ')} ${users.length === 1 ? 'uses' : 'use'} image(), ` +
        'which only the function schema form provides. Remove or retype ' +
        `${users.length === 1 ? 'it' : 'them'} first.`,
    };
  }
  return {
    ok: true,
    newSource: source.slice(0, found.schemaValueStart) + source.slice(found.zodObjectAt),
  };
}

/** Whether a field expression calls Astro's `image()` helper. Read off the
 *  blanked copy so an `image()` inside a string or a comment doesn't count. */
function usesImageHelper(expr: string): boolean {
  return /(^|[^\w$.])image\s*\(/.test(blankNonCode(expr));
}

/**
 * Remove a field from a collection's schema.
 *
 * The field's own line goes; a comment on the line above stays. Deleting a
 * comment we only *assume* belonged to the field would be a guess, and an
 * orphaned comment is visible in `git diff` where a silently deleted one is not.
 */
export function removeField(source: string, collection: string, name: string): ConfigPatchResult {
  const target = patchable(source, collection);
  if (!target.ok) return target;
  const { found } = target;
  const idx = found.entries.findIndex((e) => e.name === name);
  if (idx === -1) {
    return { ok: false, code: 'missing', error: `${collection} has no "${name}" field.` };
  }
  const entry = found.entries[idx];
  const code = blankNonCode(source);

  // Take the trailing comma with it, plus the rest of that line when nothing
  // else shares it.
  let cut = entry.end;
  const afterComma = skipSpace(code, cut, found.fieldsClose);
  if (code[afterComma] === ',') cut = afterComma + 1;
  else if (idx > 0) {
    // Last entry with no trailing comma: drop the previous one's comma instead.
    const prev = found.entries[idx - 1];
    const between = code.slice(prev.end, entry.start);
    const commaAt = prev.end + between.indexOf(',');
    if (between.includes(',')) return spliceOut(source, commaAt, cut);
  }
  let start = entry.start;
  let lineStart = start;
  while (lineStart > 0 && source[lineStart - 1] !== '\n') lineStart--;
  if (/^[ \t]*$/.test(source.slice(lineStart, start))) start = lineStart;
  let end = cut;
  while (end < source.length && (source[end] === ' ' || source[end] === '\t')) end++;
  if (source[end] === '\n' && start === lineStart) end++;
  else if (source.startsWith('\r\n', end) && start === lineStart) end += 2;
  return spliceOut(source, start, end);
}

function spliceOut(source: string, from: number, to: number): ConfigPatchResult {
  return { ok: true, newSource: source.slice(0, from) + source.slice(to) };
}

/**
 * Append a collection: its `defineCollection` block, its entry in
 * `export const collections`, and — when the file doesn't import it yet — the
 * `glob` loader import the block needs.
 *
 * Emitted with two-space indentation, the convention in Astro's own templates
 * and in every config this designer writes into.
 */
export function addCollection(source: string, spec: NewCollection): ConfigPatchResult {
  if (!validName(spec.name)) {
    return { ok: false, code: 'unsupported', error: `"${spec.name}" is not a valid collection name.` };
  }
  const { code, blocks, registry } = locate(source);
  if (blocks.some((b) => b.name === spec.name)) {
    return { ok: false, code: 'exists', error: `This config already defines "${spec.name}".` };
  }
  if (!registry) {
    return {
      ok: false,
      code: 'missing',
      error: 'No `export const collections = { … }` to register the collection in.',
    };
  }
  if (registry.entries.some((e) => entryKey(source, code, e) === spec.name)) {
    return { ok: false, code: 'exists', error: `"${spec.name}" is already registered.` };
  }
  for (const ident of ['defineCollection', 'z']) {
    if (!importsIdentifier(code, ident)) {
      return {
        ok: false,
        code: 'unrecognized',
        error: `This config doesn't import \`${ident}\`, so a generated block wouldn't compile.`,
      };
    }
  }

  // The switch decides, except that an image field forces the function form —
  // there is no valid config in which one is asked for and the other applies.
  const form: SchemaForm =
    spec.schemaForm === 'function' || spec.fields.some((f) => f.type === 'image')
      ? 'function'
      : 'object';
  const lines: string[] = [];
  for (const f of spec.fields) {
    if (!validName(f.name)) {
      return { ok: false, code: 'unsupported', error: `"${f.name}" is not a valid field name.` };
    }
    const rendered = renderZodField(f, form);
    if (!rendered.ok) return { ok: false, code: 'unsupported', error: rendered.error };
    lines.push(`${f.name}: ${rendered.expr},`);
  }

  const pattern = spec.pattern ?? '**/*.md';
  const base = `./${spec.dir.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')}`;
  const indent = form === 'function' ? '      ' : '    ';
  const objectLines = lines.map((l) => `${indent}${l}`).join('\n');
  const schema =
    form === 'function'
      ? `  schema: ({ image }) =>\n    z.object({\n${objectLines}\n    }),`
      : `  schema: z.object({\n${objectLines}\n  }),`;
  const block =
    `const ${spec.name} = defineCollection({\n` +
    `  loader: glob({ pattern: '${pattern}', base: '${base}' }),\n` +
    `${schema}\n` +
    `});\n\n`;

  // Register the name first. The block goes in *before* the registry statement,
  // so editing the registry first leaves every offset this function holds valid.
  const regIndent =
    /\n([ \t]*)\S/.exec(source.slice(registry.open, registry.close))?.[1] ?? '  ';
  let out = appendEntry(
    source,
    registry.open,
    registry.close,
    registry.entries,
    spec.name,
    regIndent,
  );
  out = out.slice(0, registry.start) + block + out.slice(registry.start);

  if (!importsIdentifier(code, 'glob')) {
    out = addGlobImport(out);
  }
  return { ok: true, newSource: out };
}

/** Whether an identifier appears in an import statement's binding list. */
function importsIdentifier(code: string, ident: string): boolean {
  const re = new RegExp(
    `(^|[\\n;])[ \\t]*import[\\s\\S]*?\\b${ident}\\b[\\s\\S]*?from[ \\t]`,
    'm',
  );
  for (const stmt of importStatements(code)) {
    if (re.test(stmt.text)) return true;
  }
  return false;
}

interface ImportStatement {
  text: string;
  end: number;
}

/** Top-level `import … from '…';` statements of a blanked source. The module
 *  specifier is blanked, so matching stops at `from`. */
function importStatements(code: string): ImportStatement[] {
  const out: ImportStatement[] = [];
  const re = /(^|\n)[ \t]*import\b[^\n;]*;?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    out.push({ text: m[0], end: m.index + m[0].length });
  }
  return out;
}

/** Add `import { glob } from 'astro/loaders';` after the last import. */
function addGlobImport(source: string): string {
  const imports = importStatements(blankNonCode(source));
  const line = "import { glob } from 'astro/loaders';";
  if (imports.length === 0) return `${line}\n${source}`;
  const at = imports[imports.length - 1].end;
  return `${source.slice(0, at)}\n${line}${source.slice(at)}`;
}

const NAME_RE = /^[A-Za-z_$][\w$]*$/;

/** Identifier-safe, so it can be a bare object key and a `const` name without
 *  quoting. The designer never needs anything else, and refusing keeps every
 *  generated expression a shape this module can read back. */
function validName(name: string): boolean {
  return typeof name === 'string' && NAME_RE.test(name);
}

/** Indentation to give a new field: the last existing field's, else one step in
 *  from the `{`. */
function fieldIndent(source: string, block: LocatedBlock): string {
  const last = block.entries[block.entries.length - 1];
  const anchor = last ? last.start : block.fieldsOpen;
  let lineStart = anchor;
  while (lineStart > 0 && source[lineStart - 1] !== '\n') lineStart--;
  const lead = /^[ \t]*/.exec(source.slice(lineStart, anchor))?.[0] ?? '';
  return last ? lead : lead + '  ';
}
