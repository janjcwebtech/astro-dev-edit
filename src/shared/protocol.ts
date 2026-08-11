/**
 * Wire protocol for the /__text-edit endpoints — the single source of truth
 * for every request/response shape exchanged between the browser overlay and
 * the dev-server middleware.
 *
 * Types only, no runtime code: both sides import from here with `import type`
 * (enforced by verbatimModuleSyntax), so this file can never reach the client
 * bundle. If a future feature changes what one side sends, the other side
 * fails `npm run typecheck` instead of failing at runtime.
 */

/** A source location as captured from data-astro-source-file / -loc. */
export interface SourceLoc {
  /** Path to the source file, relative to the project root. */
  file: string;
  /** "line:col" as emitted by Astro's dev annotations. */
  loc: string;
}

/** What an edit targets: the element's text content, its inner source when
 *  that text carries inline markup, the frontmatter string an `{expression}`
 *  renders, or an img attribute. */
export type TargetType = 'text' | 'markup' | 'expression' | 'src' | 'alt';

/** Whether an attribute can be patched: statically quoted, expression-driven,
 *  or absent from the source. */
export type AttrState = 'static' | 'dynamic' | 'missing';

export type ClassifyKind =
  | 'text' // children are exclusively literal text → editable inline
  | 'markup' // literal text plus safelisted inline tags → editable as raw source
  | 'expression' // {expression} traced to a frontmatter string → editable by value
  | 'image' // an element whose src/alt attrs may be editable (see attrs)
  | 'empty' // no children; nothing to text-edit
  | 'dynamic' // expression / child elements / component content
  | 'ambiguous' // ≥2 elements share this annotation loc — cannot patch safely
  | 'unresolved'; // no element matches this loc (stale DOM, edited file)

/** Why an apply was refused. Also used as ApplyResult codes server-side. */
export type RefusalCode = 'dynamic' | 'mismatch' | 'unresolved' | 'ambiguous' | 'unsupported';

// --- GET /health -------------------------------------------------------------
export interface HealthResponse {
  ok: true;
  name: string;
  milestone: number;
  /** Whether the hover-pill CSS class/ID inspector is enabled. The overlay
   *  reads this at boot and skips rendering the chips row when false. */
  cssInspector: boolean;
  /** Absolute project root. Astro's source annotations are absolute fsPaths,
   *  which the overlay only ever showed a basename of; the copied element
   *  context needs them repo-relative to be worth pasting anywhere, and this
   *  is the only way the client can strip the prefix exactly. Dev-only, and
   *  the annotations already carry the same information. */
  root: string;
}

// --- GET /assets -------------------------------------------------------------
export interface AssetsResponse {
  /** Web-servable image paths under the configured asset dirs. */
  files: string[];
}

// --- POST /upload ------------------------------------------------------------
export interface UploadRequest {
  /** data: URL of the image to write. */
  dataUrl: string;
  /** Client-suggested filename; sanitised server-side. */
  filename: string;
  /**
   * Marks the upload as backing an `assetRef: 'relative'` image field. Such
   * assets are imported by Astro rather than served verbatim, so the write
   * targets an importable `src/` dir and animated formats the image optimiser
   * would flatten are refused.
   */
  assetRef?: 'relative';
  /**
   * Root-relative directory to write into, so an upload lands beside the
   * field's existing asset instead of a shared root. Confined server-side to
   * the configured asset directories; omitted or rejected falls back to
   * `imageUploadDir` (relative fields) or `uploadDir`.
   */
  targetDir?: string;
}
export interface UploadResponse {
  webPath: string;
}

// --- POST /open --------------------------------------------------------------
export interface OpenRequest {
  file: string;
  /** "line:col"; omitted or empty opens the file at its top. */
  loc?: string;
}

// --- POST /inspect/open ------------------------------------------------------
/** Open the source of a CSS rule in the editor. The client resolves `file`
 *  from the stylesheet URL; the server best-effort locates `selector` inside it
 *  (for .astro, only within <style> blocks) and launches the editor there. */
export interface InspectOpenRequest {
  /** Source file the rule came from — root-relative or absolute. */
  file: string;
  /** The class/id selector fragment to locate, e.g. ".hero-title" or "#masthead". */
  selector: string;
}
export interface InspectOpenResponse {
  ok: true;
  /** "line:col" where the selector was found, or null when it wasn't (the file
   *  was opened at its top instead). */
  loc: string | null;
}

// --- POST /peek --------------------------------------------------------------
export interface PeekRequest {
  file: string;
  /** "line:col"; the line the panel highlights and scrolls to. Omitted or
   *  empty peeks from the top of the file. */
  loc?: string;
}
export interface PeekResponse {
  file: string;
  /** 1-based line number of `lines[0]` — 1 unless the huge-file cap cut the
   *  window down. */
  startLine: number;
  /** 1-based line the loc points at, clamped into the file. */
  focusLine: number;
  /** Total lines in the file, so the client can say "N more lines" when the
   *  cap applied. */
  totalLines: number;
  /** The file's source lines — the whole file, unless it exceeds the server's
   *  huge-file cap, in which case a window around `focusLine`. Empty when
   *  `refused` is set. */
  lines: string[];
  /** Set when the file exists but isn't the user's to look at through the
   *  panel — e.g. a package-owned path like the `astro:assets` `<Image>`
   *  component. The panel shows this sentence instead of source, and no file
   *  contents are returned. Absent on success. */
  refused?: string;
}

// --- POST /classify ----------------------------------------------------------
export interface ClassifyRequest extends SourceLoc {
  /** Lowercased tag name of the clicked element. */
  tag: string;
}
export interface ClassifyResult {
  kind: ClassifyKind;
  reason: string;
  /** For `img` targets: whether src/alt are patchable. */
  attrs?: { src: AttrState; alt: AttrState };
  /**
   * For `markup` targets: the element's inner *source*, outer whitespace
   * trimmed. The popup edits this rather than the DOM's `innerHTML` — only the
   * source knows how entities and quoting were spelled, and sending it back as
   * the apply op's `original` keeps verify-then-patch comparing like with like.
   */
  markup?: { html: string };
  /**
   * For `expression` targets: which frontmatter string the text was traced to.
   * `property` is the key holding it (`title`); `label` names the whole path
   * for the editor's title (`benefits[].title`). No value is sent — for a
   * `.map()` loop every card shares this classification, and which item is
   * being edited is only settled by the text the client sends on apply.
   */
  expression?: { property: string; label: string };
}

// --- POST /apply -------------------------------------------------------------
/** One field edit within an apply request. */
export interface ApplyOp {
  targetType: TargetType;
  /** Rendered text / attr value the client saw — verified against the source
   *  before writing, so a stale page fails safe. */
  original: string;
  newText: string;
}

/** A verify-all-then-write-once batch of edits to ONE element (same file/loc/
 *  tag). The server applies each op to an in-memory copy of the source and only
 *  writes if every op verifies; a single failing op means nothing reaches disk,
 *  so a multi-field edit can never leave the file half-updated. Text edits send
 *  one op; the image panel sends up to two (src, alt). */
export interface ApplyRequestWire extends SourceLoc {
  tag: string;
  ops: ApplyOp[];
}

/** Error body shape shared by all endpoints (4xx/5xx). */
export interface ErrorResponse {
  error: string;
  code?: RefusalCode;
}

// --- Entry editor (spec: CMS panel for content-collection entries) -----------

/** Widget/type a frontmatter field renders as in the entry panel. */
export type FieldType =
  | 'text'
  | 'textarea'
  | 'date'
  | 'number'
  | 'boolean'
  | 'select'
  | 'tags'
  | 'image'
  | 'json'; // unrecognized shape → shown read-only

/** One frontmatter field, derived from the collection's zod schema (or, when
 *  no schema is resolvable, inferred from the entry's own values). */
export interface FieldDescriptor {
  name: string;
  /** Humanized name; overridable via entryEditor config. */
  label: string;
  type: FieldType;
  /** No default and not optional/nullable. */
  required: boolean;
  /** Enum values, for `select`. */
  options?: string[];
  /**
   * How an `image` field's value references its asset. Absent (the default)
   * means a web-servable root-relative path, the shape a plain `<img src>`
   * needs. `'relative'` marks a field backed by Astro's `image()` schema
   * helper, whose values are paths relative to the *entry file* — the picker
   * must resolve previews and write values in that shape instead.
   */
  assetRef?: 'relative';
  /** Schema default — shown as placeholder when the key is absent. */
  defaultValue?: unknown;
  /** Whether the key exists in the file's frontmatter. */
  present: boolean;
  source: 'schema' | 'inferred';
}

// --- POST /entry -------------------------------------------------------------
export interface EntryRequest {
  /** Repo-relative path from the page-source meta tag. */
  file: string;
}
export interface EntryResponse {
  file: string;
  /** sha256 of the full file content; sent back on every write. */
  etag: string;
  /** Matched collection name, when the file maps to one. */
  collection: string | null;
  /** Repo-relative directory holding the collection's entries, when matched.
   *  The create drawer resolves `assetRef: 'relative'` values against it,
   *  since a new entry has no path of its own yet. */
  collectionDir: string | null;
  fields: FieldDescriptor[];
  /** Parsed frontmatter values (JSON-safe). */
  values: Record<string, unknown>;
  /** Markdown body, \n-normalized. */
  body: string;
  bodyEditable: boolean;
}

// --- POST /entry/apply -------------------------------------------------------
export interface EntryApplyRequest {
  file: string;
  etag: string;
  changes: {
    /** ONLY changed keys. `null` clears an optional key from the file. */
    frontmatter?: Record<string, unknown>;
    body?: string;
  };
}

// --- POST /entry/create ------------------------------------------------------
export interface EntryCreateRequest {
  collection: string;
  /** Filename without extension; sanitized server-side. */
  slug: string;
  frontmatter: Record<string, unknown>;
  body: string;
}
export interface EntryCreateResponse {
  /** Repo-relative path of the new file. */
  file: string;
}

// --- POST /entry/delete ------------------------------------------------------
export interface EntryDeleteRequest {
  file: string;
  etag: string;
}

/** Entry endpoints extend the shared error shape with two more codes and
 *  optional per-field validation messages. */
export interface EntryErrorResponse {
  error: string;
  code?: RefusalCode | 'conflict' | 'validation' | 'exists';
  /** Field name → message, for 422 validation failures. */
  fieldErrors?: Record<string, string>;
}
