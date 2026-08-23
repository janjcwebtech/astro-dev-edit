/**
 * Wire protocol for the /__dev-edit endpoints — the single source of truth
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
  /** Whether the "Open source" buttons and jump-to-file links should render.
   *  Absent from a server that predates the option editor. */
  openInEditor?: boolean;
  /** Whether the CMS entry drawer is enabled. Absent from a server that
   *  predates the option editor. */
  entryEditor?: boolean;
  /** Absolute project root. Astro's source annotations are absolute fsPaths,
   *  which the overlay only ever showed a basename of; the copied element
   *  context needs them repo-relative to be worth pasting anywhere, and this
   *  is the only way the client can strip the prefix exactly. Dev-only, and
   *  the annotations already carry the same information. */
  root: string;
  /** Whether the Unsplash photo source is both enabled AND holds a usable key.
   *  The overlay reads this at boot to decide whether the media modal renders
   *  its source tabs at all — a project that never opts in gets a single-source
   *  modal, not a tab that errors when clicked. */
  unsplash: boolean;
}

// --- GET /assets -------------------------------------------------------------
/** One image under the configured asset dirs. Metadata rather than a bare path
 *  so the picker can sort by recency and caption a tile — an image uploaded a
 *  minute ago is otherwise buried in an alphabetical list. */
export interface AssetInfo {
  /** Web-servable path, e.g. `/src/assets/hero.jpg`. */
  path: string;
  /** Size in bytes. */
  size: number;
  /** Last-modified time, epoch ms — the sort key behind "Newest first". */
  mtime: number;
}
export interface AssetsResponse {
  /** Images under the configured asset dirs, sorted by path. */
  files: AssetInfo[];
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

// --- POST /page-source -------------------------------------------------------
/**
 * "Which file is this route written in?" — the admin bar's *Open page source*.
 *
 * Answered from Astro's own route manifest, because the DOM cannot answer it:
 * component tags are never annotated, so counting annotated elements makes a
 * markup-dense Nav.astro outrank a page that merely composes components.
 */
export interface PageSourceRequest {
  /** `location.pathname` exactly as the browser has it, base prefix included —
   *  the server strips the configured base itself. */
  pathname: string;
}
/** Why nothing resolved. `no-routes` — the manifest is empty (the routes hook
 *  never fired); `no-match` — no page route matches the pathname; `not-in-project`
 *  — the matched route's entrypoint belongs to a package or sits outside the
 *  root; `missing` — the entrypoint is not on disk (Astro's injected default
 *  404 page). */
export type PageSourceRefusal = 'no-routes' | 'no-match' | 'not-in-project' | 'missing';
export interface PageSourceResponse {
  /** Root-relative path of the route's entrypoint, or null when unresolved. */
  file: string | null;
  /** The route pattern that matched, e.g. "/articles/[...slug]"; null when
   *  unresolved. */
  pattern: string | null;
  /** Null on success. Set means nothing was opened — the panel says so rather
   *  than guessing at a file. */
  refusal: PageSourceRefusal | null;
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
  /** Render the control disabled. Used by the Settings panel for an option
   *  `astro.config.mjs` owns, where accepting input would be a lie. */
  readOnly?: boolean;
  /** One-line prose shown under the control. */
  help?: string;
}

/**
 * The *editor* half of a field: which control it renders as, what it is called,
 * whether it shows at all. Stored in `.astro-dev-edit.json` (or set in
 * `astro.config.mjs` under `entryEditor.collections.<name>.fields`) and never in
 * the collection's zod schema — the collection designer keeps the two halves
 * visibly apart, because one is committed source and the other is local.
 */
export interface FieldOverride {
  widget?: FieldType;
  label?: string;
  hidden?: boolean;
}

/**
 * A schema field as the designer *writes* it — the inverse of a
 * {@link FieldDescriptor}, which is one read out of a live schema.
 * `patcher/content-config.ts` renders these to zod expressions.
 */
export interface SchemaFieldSpec {
  name: string;
  type: FieldType;
  /** False renders `.optional()`; a `defaultValue` implies optional. */
  required: boolean;
  /** Renders `.default(…)`. Not supported for `date` or `image`. */
  defaultValue?: unknown;
  /** Enum values, for `type: 'select'`. */
  options?: string[];
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

// --- The media modal ---------------------------------------------------------
/** What the shared media modal resolves with. Lives here rather than in the
 *  client because `origin` is a server-side distinction: the modal's three
 *  sources produce the same kind of path by different routes, and a caller may
 *  want to know which (an Unsplash pick has already been downloaded and
 *  attributed by the time it reaches this shape). */
export interface MediaPick {
  /** The value to write — already relative-converted if the field needs it. */
  webPath: string;
  origin: 'existing' | 'upload' | 'unsplash';
}

// --- POST /unsplash/search ---------------------------------------------------
/**
 * A photo, reshaped by the server. Unsplash's own object carries exif, tags,
 * topics, sponsorship, the full user record and a dozen URL variants; none of
 * that crosses the wire, so it can never become an accidental API surface.
 *
 * Deliberately carries **no** raw or download_location URL. The server keeps
 * those in a bounded in-memory map keyed by `id`, so `/unsplash/import` never
 * fetches a URL the browser supplied — that removes an SSRF-shaped capability
 * from the dev server. The cost is that an `id` minted before a restart imports
 * as `409 expired`.
 */
export interface UnsplashPhoto {
  /** Unsplash's id — the only handle `/unsplash/import` accepts. */
  id: string;
  /** Grid thumbnail (urls.small), hotlinked in the picker UI only. */
  thumbUrl: string;
  /** Average colour, painted behind the tile while the thumb loads. */
  color: string;
  width: number;
  height: number;
  description: string;
  photographer: string;
  /** Profile URL with the required utm params already attached, so the client
   *  cannot forget them and the app name lives in one place. */
  photographerUrl: string;
  pageUrl: string;
}

export type UnsplashOrientation = 'any' | 'landscape' | 'portrait' | 'squarish';

export interface UnsplashSearchRequest {
  query: string;
  /** 1-based; clamped to >= 1 server-side. */
  page?: number;
  /** Clamped to Unsplash's own maximum of 30. */
  perPage?: number;
  orientation?: UnsplashOrientation;
}
export interface UnsplashSearchResponse {
  photos: UnsplashPhoto[];
  /** Total matches across all pages, for the "Load more (20 of 1,283)" label. */
  total: number;
  totalPages: number;
  page: number;
  /** Requests left this hour, when Unsplash reported it. Surfaced at the foot
   *  of the details rail — the demo tier allows only 50/hour. */
  remaining?: number;
}

// --- POST /unsplash/import ---------------------------------------------------
export interface UnsplashImportRequest {
  /** An id from a search in this dev-server process; see UnsplashPhoto. */
  id: string;
  /** Same semantics as UploadRequest: marks an `image()`-backed field, so the
   *  bytes land in an importable `src/` dir rather than the web-servable one. */
  assetRef?: 'relative';
  /** Root-relative directory, confined server-side exactly as /upload's is. */
  targetDir?: string;
}
export interface UnsplashImportResponse {
  /** Web-servable path of the downloaded file. */
  webPath: string;
  /** The name actually written, after sanitising and clash-suffixing. */
  filename: string;
}

/**
 * Why an Unsplash call failed. These routes answer with an explicit code rather
 * than throwing, because a thrown error becomes a 400 — which would read as
 * "your query was malformed" when the real cause is upstream. See the module
 * header in server/unsplash-routes.ts.
 */
export type UnsplashErrorCode =
  | 'disabled' // the integration option is off
  | 'unconfigured' // enabled, but no access key resolved
  | 'unauthorized' // Unsplash rejected the key
  | 'rate-limited' // hourly quota exhausted (50/hr on the demo tier)
  | 'expired' // photo id is no longer in the server's cache
  | 'timeout' // the upstream call took too long
  | 'too-large' // the download exceeded the size cap
  | 'upstream'; // anything else on Unsplash's side

export interface UnsplashErrorResponse {
  error: string;
  code: UnsplashErrorCode;
}

// --- GET/POST /settings ------------------------------------------------------
/** Where a resolved access key came from. Config beats env beats the file the
 *  Settings panel writes; the panel disables its input for the first two, since
 *  silently accepting a value that does nothing is worse than saying so. */
export type SettingsSource = 'config' | 'env' | 'file';

/** Which Settings tab an option is grouped under. */
export type OptionGroup = 'general' | 'editing' | 'media' | 'unsplash';

/**
 * One integration option, described well enough for the panel to render a
 * control for it without knowing the option exists.
 *
 * That genericity is the point: options are declared once in the server's
 * `OPTION_SPECS` table, and adding one needs no client change. `type` reuses
 * {@link FieldType} so the panel can build the control through the entry
 * editor's own `buildControl` registry rather than a parallel one.
 */
export interface OptionDescriptor {
  /** Flat wire key — what a {@link SettingsUpdateRequest} patch is keyed by. */
  key: string;
  label: string;
  /** One-line prose shown under the control. */
  help: string;
  type: FieldType;
  group: OptionGroup;
  /** Enum values, for `type: 'select'`. */
  choices?: string[];
  /** The effective value, after precedence. */
  value: unknown;
  /** Which layer supplied it. */
  source: 'default' | 'file' | 'config';
  /**
   * `astro.config.mjs` sets it, so storing a value here would do nothing — the
   * panel renders the control read-only and says why. Also true for options
   * consumed before the dev server exists, which can only come from the config.
   */
  locked: boolean;
  /** Changing it needs a dev-server restart. */
  restartRequired?: boolean;
}

/**
 * The access key itself is **never** in this shape. Only whether one resolved,
 * where from, and a masked fragment.
 */
export interface SettingsResponse {
  /** Every option, in the order the panel should render them. Absent from a
   *  server that predates the option editor, so the panel must tolerate it. */
  options?: OptionDescriptor[];
  unsplash: {
    /** Whether the option is enabled at all, independent of a key. */
    enabled: boolean;
    configured: boolean;
    source: SettingsSource | null;
    /** Masked tail, e.g. `••••••••Ab3d`. Absent when nothing is configured. */
    hint?: string;
    /** True when the settings file is not covered by the project's .gitignore
     *  — a warning the panel repeats, since this integration cannot fix a
     *  consuming project's ignore rules. */
    gitignoreWarning?: boolean;
  };
}

export interface SettingsUpdateRequest {
  unsplash?: {
    /** The access key to store. An empty string clears it. */
    accessKey: string;
  };
  /**
   * Sparse option patch — **only** the keys the panel changed, keyed by
   * {@link OptionDescriptor.key}, mirroring `EntryApplyRequest.changes`. Values
   * are `unknown` because the option set is server-declared; the server checks
   * each one against its spec's type and refuses unknown, config-only and
   * locked keys by name.
   */
  options?: Record<string, unknown>;
}

/** 422 from `POST /settings`: which keys were refused and why. Nothing is
 *  written when this comes back — the patch is all-or-nothing, so a rejected
 *  key cannot leave the file half-updated. */
export interface SettingsErrorResponse {
  error: string;
  code?: 'validation' | 'conflict' | 'disabled';
  /** Option key → message. */
  fieldErrors?: Record<string, string>;
}

// --- The collection designer -------------------------------------------------

/**
 * A field row in the designer spans **two stores**, and the wire shape keeps
 * them apart on purpose:
 *
 * - the **schema** half (`type`, `required`, `defaultValue`, add, remove) is
 *   written to the project's own `src/content.config.ts` — committed source that
 *   changes what `astro build` accepts;
 * - the **editor** half ({@link FieldOverride}) is written to
 *   `.astro-dev-edit.json` — local, gitignored, and only affects the entry
 *   drawer.
 *
 * A request may carry both; the response says which half landed.
 */

// --- POST /collections -------------------------------------------------------
export interface CollectionSummary {
  name: string;
  /** Repo-relative directory holding the collection's entries. */
  dir: string;
  /** Whether that directory exists yet. A collection declared in the config
   *  without its directory is a real and common state. */
  dirExists: boolean;
  /** Entry files found in it (.md/.mdx, recursive). */
  entryCount: number;
  /** The collection's fields — schema-derived when the schema resolved. */
  fields: FieldDescriptor[];
  /**
   * Where {@link fields} came from. `'source'` means the config module didn't
   * load (usually because it has an error), so the names come from the config
   * text and the types are unknown — the panel says so rather than showing an
   * authoritative-looking field table built from a guess.
   */
  fieldSource: 'schema' | 'source';
  /** The zod expression for each field, keyed by name, as it stands in the
   *  config. Shown for anything the designer can't model. */
  expressions: Record<string, string>;
  /** How the `schema:` is written. Null when the designer couldn't read it — the
   *  panel then offers "open source" instead of controls. */
  schemaForm: 'object' | 'function' | null;
  /** Why the schema isn't patchable, when it isn't. */
  unrecognized?: string;
  /** Whether the const is registered in `export const collections`. */
  registered: boolean;
  /** 1-based line of the collection's block in the config, for "open source". */
  configLine?: number;
  /** Editor-only overrides in force for this collection. */
  overrides: Record<string, FieldOverride>;
  /**
   * Fields whose override `astro.config.mjs` owns. Storing one from the panel
   * would resolve to nothing, so the editor half renders read-only — the same
   * `locked` honesty {@link OptionDescriptor} has, applied per field.
   */
  lockedFields: string[];
}

export interface CollectionsResponse {
  /** Repo-relative content config the designer reads and patches, or null when
   *  the project has none. Discovered server-side; a request never names it. */
  configPath: string | null;
  /** sha256 of that file, required by every write below. Null with no config. */
  etag: string | null;
  /** False when `schemaEditor` is off: the panel stays read-only for the schema
   *  half and still saves the editor half. */
  schemaEditor: boolean;
  collections: CollectionSummary[];
}

// --- POST /collection/schema/apply -------------------------------------------
export interface CollectionSchemaApplyRequest {
  collection: string;
  /** {@link CollectionsResponse.etag} as the panel read it. Required whenever
   *  `schema` is present; a stale one is refused rather than merged. */
  etag?: string;
  /** Schema edits. Applied removes → updates → adds, all against one in-memory
   *  copy, and written once — so a refusal anywhere leaves the file untouched. */
  schema?: {
    add?: SchemaFieldSpec[];
    update?: SchemaFieldSpec[];
    remove?: string[];
  };
  /** Editor-only overrides, merged per field. `null` clears one. */
  overrides?: Record<string, FieldOverride | null>;
}

export interface CollectionApplyResponse {
  /** True when everything asked for landed. */
  ok: boolean;
  /** Whether the config file was rewritten. */
  schemaWritten: boolean;
  /** Whether the settings file was rewritten. */
  overridesWritten: boolean;
  /** Fresh config etag after a schema write. */
  etag?: string;
  /** Why a half didn't land. */
  error?: string;
  code?: CollectionRefusal;
}

/** Why a designer write was refused.
 *  `conflict` — the config changed on disk since the panel read it.
 *  `disabled` — `schemaEditor: false`.
 *  `unrecognized` — a schema shape the patcher won't guess at.
 *  The rest name the collection or field. */
export type CollectionRefusal =
  | 'conflict'
  | 'disabled'
  | 'unrecognized'
  | 'missing'
  | 'exists'
  | 'unsupported';

// --- POST /collection/entries ------------------------------------------------
export interface CollectionEntriesRequest {
  collection: string;
}

/** One entry as the Items view lists it. Enough to identify and open it, and
 *  nothing more — the body is never read into this response. */
export interface CollectionEntryItem {
  /** Repo-relative path, which is exactly what `POST /entry` takes. */
  file: string;
  /** Filename without its extension. */
  slug: string;
  /** A title-ish frontmatter value, when the entry has one. */
  title: string | null;
  /** Last-modified time, ms since the epoch. */
  mtime: number;
  /** `draft: true` in the frontmatter. */
  draft: boolean;
}

export interface CollectionEntriesResponse {
  collection: string;
  dir: string;
  entries: CollectionEntryItem[];
  /** True when the directory held more entries than the endpoint will read. The
   *  panel says so rather than presenting a partial list as complete. */
  truncated?: boolean;
}

// --- POST /collection/open ---------------------------------------------------
/** Launch the editor on the content config. Carries **no path**: the server
 *  opens the config it discovered, optionally at a collection's own line. */
export interface CollectionOpenRequest {
  collection?: string;
}

// --- POST /collection/create -------------------------------------------------
export interface CollectionCreateRequest {
  /** Identifier-safe; it becomes a `const` name and a registry key. */
  name: string;
  /** Repo-relative entry directory. Defaults to `src/content/<name>`. */
  dir?: string;
  /** Glob pattern for the loader. Defaults to `**\/*.md`. */
  pattern?: string;
  fields: SchemaFieldSpec[];
  etag?: string;
}

export interface CollectionCreateResponse {
  name: string;
  /** The directory that was created. */
  dir: string;
  etag: string;
}
