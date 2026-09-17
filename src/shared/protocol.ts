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

// Composition proof: usage ids identify source sites, never runtime instances.
export type CompositionTier = 'proven' | 'inferred' | 'candidates' | 'none';
export type CompositionRefusal =
  | 'dynamic' | 'namespaced' | 'not-astro' | 'package' | 'outside-root'
  | 'chain-break' | 'unresolved' | 'spread' | 'reserved-attribute'
  | 'invalid-chain' | 'incomplete-index' | 'too-many-paths' | 'no-path' | 'recursive'
  | 'disabled' | 'no-route' | 'stale-index' | 'index-limit' | 'path-refused' | 'untracked-html';
export interface UsageProp {
  name: string;
  kind: string;
  source: string;
}
export interface UsageSlot {
  name: string;
  start: number;
  end: number;
  source: string;
}
export interface UsageLink {
  id: string;
  file: string;
  loc: string;
  offset: number;
  /** Safe insertion point immediately before the opening tag's / or >. */
  injectionOffset?: number;
  name: string;
  target?: string;
  refusal?: CompositionRefusal;
  hasSpread: boolean;
  props: UsageProp[];
  slots: UsageSlot[];
}
export interface CompositionRequest {
  file: string;
  route: string;
  chain?: string;
  traceVersion?: 2;
}

/** IDs last for one server render; source usage ids remain stable across renders. */
export interface RenderTrace {
  id: string;
  file: string;
  parent: string | null;
  chain: string;
}
export interface SlotPlacement {
  id: string;
  receiver: string;
  name: string;
  loc: string;
  fallback: boolean;
  file: string;
  chain: string;
  parent: string | null;
}
export interface CompositionResponse {
  tier: CompositionTier;
  links: UsageLink[];
  candidates?: UsageLink[][];
  reason?: CompositionRefusal;
}

/** Browser requests name a URL; only the server chooses the route source file. */
export interface CompositionLookupRequest {
  pathname: string;
  file: string;
  chain?: string;
  traceVersion?: 2;
}
export interface CompositionLinksRequest {
  pathname: string;
  ids: string[];
}
/** Reverse usages are scoped to this route's reachable Astro modules. */
export interface CompositionUsesRequest {
  pathname: string;
  file: string;
}
export interface CompositionCoverage {
  complete: boolean;
  files: number;
  revision: number;
  issues: { file: string; loc?: string; reason: CompositionRefusal }[];
}
export interface CompositionLookupResponse extends CompositionResponse {
  route: string | null;
  coverage: CompositionCoverage;
}
export interface CompositionLinksResponse {
  route: string | null;
  links: UsageLink[];
  missing: string[];
  coverage: CompositionCoverage;
  reason?: CompositionRefusal;
}
export interface CompositionUsesResponse {
  route: string | null;
  links: UsageLink[];
  coverage: CompositionCoverage;
  reason?: CompositionRefusal;
}

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
  /** Opt-in read-only inspector, tracing API and version-2 annotations. */
  composition?: boolean;
  /** Whether the "Open source" buttons and jump-to-file links should render.
   *  Absent from a server that predates the option editor. */
  openInEditor?: boolean;
  /** Absolute project root. Astro's source annotations are absolute fsPaths,
   *  which the overlay only ever showed a basename of; the copied element
   *  context needs them repo-relative to be worth pasting anywhere, and this
   *  is the only way the client can strip the prefix exactly. Dev-only, and
   *  the annotations already carry the same information. */
  root: string;
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
  /**
   * Whether a **production build** still serves the file at {@link path}.
   *
   * The asset dirs span two worlds on purpose — `src/assets` has to be listed
   * so `image()` fields have somewhere to browse — but only the project's
   * `publicDir` is copied into the output. `/src/assets/hero.svg` is a truthful
   * *dev* URL and a 404 in the built site, so a picker filling a plain
   * `<img src>` or a markdown destination has to refuse it at pick time. The
   * server decides this from the configured public dir; no client re-derives it
   * from the path.
   */
  servable: boolean;
}
export interface AssetsResponse {
  /** Images under the configured asset dirs, sorted by path. */
  files: AssetInfo[];
  /** The project's public directory, root-relative — what a picker names when
   *  it explains why a non-servable file cannot be used. */
  publicDir: string;
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
export interface OpenResponse {
  /** False whenever `refused` is set — no editor was launched. */
  ok: boolean;
  /**
   * Set when the file is real but is not the user's to open: a package-owned
   * path like the `astro:assets` `<Image>` component, or one outside the
   * editable content roots. The overlay shows this sentence instead of an
   * error, the way `/peek` and `/classify` already answer for the same paths.
   *
   * A refusal, not a softened gate — the editor is not launched either way.
   * Genuine anomalies (missing, escaping the root, a disallowed extension)
   * remain errors.
   */
  refused?: string;
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

// --- The media modal ---------------------------------------------------------
/** What the media picker resolves with. `origin` is a server-side distinction:
 *  an existing asset and a fresh upload produce the same kind of path by
 *  different routes, and a caller may want to know which. */
export interface MediaPick {
  /** The value to write — already relative-converted if the field needs it. */
  webPath: string;
  origin: 'existing' | 'upload';
}

// --- GET/POST /settings ------------------------------------------------------
/** The control an option renders as. Declared by the server's `OPTION_SPECS`
 *  table; the panel builds a control per member and knows no option names. */
export type OptionControl = 'text' | 'number' | 'boolean' | 'select' | 'tags';

/** Which Settings tab an option is grouped under. */
export type OptionGroup = 'general' | 'editing' | 'media';

/**
 * One integration option, described well enough for the panel to render a
 * control for it without knowing the option exists.
 *
 * That genericity is the point: options are declared once in the server's
 * `OPTION_SPECS` table, and adding one needs no client change.
 */
export interface OptionDescriptor {
  /** Flat wire key — what a {@link SettingsUpdateRequest} patch is keyed by. */
  key: string;
  label: string;
  /** One-line prose shown under the control. */
  help: string;
  type: OptionControl;
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

export interface SettingsResponse {
  /** Every option, in the order the panel should render them. Absent from a
   *  server that predates the option editor, so the panel must tolerate it. */
  options?: OptionDescriptor[];
  /**
   * Settings files the project's `.gitignore` does not cover,
   * project-relative, in the order the panel should name them. Absent when
   * everything is covered. `.astro-dev-edit.json` exists as soon as any tab
   * saves an option. The panel repeats it because this integration cannot edit
   * a consuming project's ignore rules.
   */
  gitignoreWarning?: string[];
}

export interface SettingsUpdateRequest {
  /**
   * Sparse option patch — **only** the keys the panel changed, keyed by
   * {@link OptionDescriptor.key}. Values are `unknown` because the option set
   * is server-declared; the server checks each one against its spec's type and
   * refuses unknown, config-only and locked keys by name.
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
