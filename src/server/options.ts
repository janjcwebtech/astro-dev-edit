import type { OptionControl } from '../shared/protocol.ts';
import { readStoredOptions } from './settings.ts';

/**
 * The integration's option vocabulary, and the resolver that turns it into the
 * effective values a request runs against.
 *
 * **Why options resolve per request.** Everything here used to be collapsed
 * once in `astro:config:setup` and captured by the middleware, so changing an
 * option meant editing `astro.config.mjs` and restarting the dev server. The
 * Settings panel needs to change them live, so resolution moved behind a thunk:
 * nothing depends on hook ordering, and a saved change takes effect on the next
 * request.
 *
 * **Precedence, highest first: `astro.config.mjs` → the settings file →
 * {@link DEFAULTS}.** The config wins because it is code the user wrote
 * deliberately, is committed, and is read by `astro build`. An option set there
 * is reported `locked` and the panel renders it read-only rather than storing a
 * value that resolution would ignore.
 *
 * **{@link OPTION_SPECS} is the registry.** One entry per option carries its
 * default, its wire label/help, the control it renders as, and how to read it
 * out of a partial config. That single table drives resolution, the `/settings`
 * response, and the panel's controls — so adding an option is one entry here,
 * with no client change at all.
 */

/** Options a consuming project passes to `devEdit()`. */
export interface DevEditOptions {
  /** Kill switch. When false the integration does nothing at all. */
  enabled?: boolean;
  /** Directories scanned for replacement images offered in the swap panel. */
  assetDirs?: string[];
  /**
   * Directory new image uploads are written to, relative to the project root.
   * Must be a web-servable location — files here become a plain `<img src>` in
   * the source, so anything outside `public/` works in dev but 404s in a
   * production build. Defaults to `public`.
   */
  uploadDir?: string;
  /**
   * Fallback directory for uploads that back an `image()` schema field, relative
   * to the project root. Those assets are *imported* by Astro rather than served
   * verbatim, so they must live under `src/` — `public/` files can't be
   * imported. Only used when the field has no existing value to sit beside;
   * otherwise the upload lands in that value's own directory. Defaults to
   * `src/assets`.
   */
  imageUploadDir?: string;
  /** Extensions the patcher is allowed to write. */
  editableExtensions?: string[];
  /** Directories that writes are confined to. */
  contentRoots?: string[];
  /** Expose the click-to-source fallback. */
  openInEditor?: boolean;
  /** Reveal text-write destinations in the external editor. Default false. */
  revealWrites?: boolean;
  /** Best-effort pause before existing-file writes, 0–10000 ms. Default 1000. */
  revealWriteDelayMs?: number;
  /**
   * The hover-pill CSS inspector: on hover, list an element's classes and ID,
   * and reveal the CSS rules each one applies (read from the browser, no server
   * round-trip) with a link to open the defining file at the rule. The
   * open-at-rule jump additionally requires `openInEditor`. `false` disables the
   * whole surface (no chips render).
   */
  cssInspector?: boolean;
  /**
   * Whether the tool injects the `data-atx-*` source annotations the feature
   * rides on. `'auto'` (default) and `'force'` both inject, on every supported
   * Astro version: Astro's own `data-astro-source-*` is not a channel the
   * client reads, and is never emitted here. `'off'` injects nothing, which
   * leaves the overlay unable to locate any element.
   */
  sourceAnnotations?: 'auto' | 'force' | 'off';
}

/** Every option's effective value for one request — no optionals left. */
export type ResolvedOptions = Required<DevEditOptions>;

/** What the Settings panel stores. Every option carries a single value, so the
 *  stored document is a partial config and nothing more. */
export type StoredOptions = Partial<DevEditOptions>;

export const DEFAULTS: ResolvedOptions = {
  enabled: true,
  assetDirs: ['src/assets', 'public'],
  uploadDir: 'public',
  imageUploadDir: 'src/assets',
  editableExtensions: ['.astro', '.md', '.mdx'],
  contentRoots: ['src', 'public'],
  openInEditor: true,
  revealWrites: false,
  revealWriteDelayMs: 1000,
  cssInspector: true,
  sourceAnnotations: 'auto',
};

/** Which Settings tab an option is grouped under. */
export type OptionGroup = 'general' | 'editing' | 'media';

/**
 * One option, as both a resolution rule and a control the panel renders.
 *
 * `read` returns `undefined` for "this source is silent about the option",
 * which is what separates a deliberate `false` from an absent key — and
 * therefore what {@link OptionDescriptor.locked} means.
 */
interface OptionSpec {
  /** Flat wire key, and the settings-file key. */
  key: string;
  label: string;
  help: string;
  type: OptionControl;
  group: OptionGroup;
  /** Enum values, for `type: 'select'`. */
  choices?: string[];
  /**
   * Consumed in `astro:config:setup`, before any dev server exists — so it can
   * only come from the config, and changing it needs a restart. The panel
   * renders these read-only. `enabled` is additionally config-only because
   * storing `false` here would lock the user out of the UI that set it.
   */
  configOnly?: boolean;
  fallback: unknown;
  /** Read from the config layer. `undefined` = this layer is silent. */
  read(o: Partial<DevEditOptions>): unknown;
  /**
   * Read from the stored layer, when it encodes the option differently — only
   * the two feature toggles do, and only because the store separates a toggle
   * from its detail. Defaults to {@link read}.
   */
  readStored?(o: StoredOptions): unknown;
}

/** The registry. Adding an option is one entry — resolution, the `/settings`
 *  response and the panel's control all follow from it. */
const OPTION_SPECS: readonly OptionSpec[] = [
  {
    key: 'enabled',
    label: 'Integration enabled',
    help: 'The kill switch. Set in astro.config.mjs only — turning it off from here would remove the UI that turns it back on.',
    type: 'boolean',
    group: 'general',
    configOnly: true,
    fallback: DEFAULTS.enabled,
    read: (o) => o.enabled,
  },
  {
    key: 'sourceAnnotations',
    label: 'Source annotations',
    help: 'Whether the tool injects the source annotations everything rides on. "auto" (and "force") inject its own data-atx-* on every Astro version; "off" injects nothing and the overlay then finds no elements. Registers a Vite plugin, so it is config-only.',
    type: 'select',
    choices: ['auto', 'force', 'off'],
    group: 'general',
    configOnly: true,
    fallback: DEFAULTS.sourceAnnotations,
    read: (o) => o.sourceAnnotations,
  },
  {
    key: 'contentRoots',
    label: 'Content roots',
    help: 'Writes are confined to these directories, resolved through symlinks. Narrowing this is the main way to limit what the editor can touch.',
    type: 'tags',
    group: 'general',
    fallback: DEFAULTS.contentRoots,
    read: (o) => o.contentRoots,
  },
  {
    key: 'editableExtensions',
    label: 'Editable extensions',
    help: 'File extensions the patcher may write. Only .astro supports in-place element editing today; .md and .mdx are collection entries.',
    type: 'tags',
    group: 'general',
    fallback: DEFAULTS.editableExtensions,
    read: (o) => o.editableExtensions,
  },
  {
    key: 'openInEditor',
    label: 'Open in editor',
    help: 'Expose the "Open source" buttons and the jump-to-file links that launch your editor at a source location.',
    type: 'boolean',
    group: 'editing',
    fallback: DEFAULTS.openInEditor,
    read: (o) => o.openInEditor,
  },
  {
    key: 'revealWrites',
    label: 'Show changed files in editor',
    help: 'Reveal text files before saving, with a best-effort delay. New files open after creation. Independent of manual Open controls; excludes uploads and deletions.',
    type: 'boolean',
    group: 'editing',
    fallback: DEFAULTS.revealWrites,
    read: (o) => o.revealWrites,
  },
  {
    key: 'revealWriteDelayMs',
    label: 'Delay before writing (ms)',
    help: 'Wait 0–10000 milliseconds after requesting the editor to open an existing file. This cannot confirm that the file is visible.',
    type: 'number',
    group: 'editing',
    fallback: DEFAULTS.revealWriteDelayMs,
    read: (o) => o.revealWriteDelayMs,
  },
  {
    key: 'cssInspector',
    label: 'CSS inspector',
    help: 'The hover pill\'s class and ID chips, and the CSS rules each one applies. Off means no chips render at all.',
    type: 'boolean',
    group: 'editing',
    fallback: DEFAULTS.cssInspector,
    read: (o) => o.cssInspector,
  },
  {
    key: 'assetDirs',
    label: 'Asset directories',
    help: 'Directories scanned for the images offered in the media picker\'s project grid.',
    type: 'tags',
    group: 'media',
    fallback: DEFAULTS.assetDirs,
    read: (o) => o.assetDirs,
  },
  {
    key: 'uploadDir',
    label: 'Upload directory',
    help: 'Where new uploads are written. Must sit under public/ — files here become a plain <img src>, which 404s in a production build from anywhere else.',
    type: 'text',
    group: 'media',
    fallback: DEFAULTS.uploadDir,
    read: (o) => o.uploadDir,
  },
  {
    key: 'imageUploadDir',
    label: 'image() upload directory',
    help: 'Fallback for uploads backing an image() schema field. Must sit under src/ — Astro imports those assets, and public/ files cannot be imported.',
    type: 'text',
    group: 'media',
    fallback: DEFAULTS.imageUploadDir,
    read: (o) => o.imageUploadDir,
  },
];

/** Keys the Settings panel may write — everything the config does not own
 *  outright. Exported so the route can refuse anything else by name. */
export const WRITABLE_OPTION_KEYS: readonly string[] = OPTION_SPECS.filter(
  (s) => !s.configOnly,
).map((s) => s.key);

/** Where an effective value came from. */
export type OptionSource = 'default' | 'file' | 'config';

/** One option as the panel sees it: the control to render, the effective value,
 *  and whether the config owns it. Mirrors `OptionDescriptor` in protocol.ts. */
export interface ResolvedOption {
  key: string;
  label: string;
  help: string;
  type: OptionControl;
  group: OptionGroup;
  choices?: string[];
  value: unknown;
  source: OptionSource;
  locked: boolean;
  restartRequired: boolean;
}

export interface OptionsResolution {
  /** The effective options this request runs against. */
  options: ResolvedOptions;
  /** The same values, described for the Settings panel. */
  described: ResolvedOption[];
}

export interface OptionsResolverDeps {
  /** Project root (fsPath) — where the settings file lives. */
  root: string;
  /** Exactly what the project passed to `devEdit()`, **not** merged with
   *  DEFAULTS: `key in configOptions` is what makes an option `locked`. */
  configOptions: Partial<DevEditOptions>;
}

export interface OptionsResolver {
  /** Resolve for one request. Cheap — one small JSON read. */
  resolve(): Promise<OptionsResolution>;
}

/** Rebuild the option shape from resolved flat values. Explicit rather than
 *  driven by per-spec writers, so a missing key is a type error here. */
function toResolvedOptions(flat: Map<string, unknown>): ResolvedOptions {
  return {
    enabled: flat.get('enabled') as boolean,
    assetDirs: flat.get('assetDirs') as string[],
    uploadDir: flat.get('uploadDir') as string,
    imageUploadDir: flat.get('imageUploadDir') as string,
    editableExtensions: flat.get('editableExtensions') as string[],
    contentRoots: flat.get('contentRoots') as string[],
    openInEditor: flat.get('openInEditor') === true,
    revealWrites: flat.get('revealWrites') === true,
    revealWriteDelayMs: validRevealDelay(flat.get('revealWriteDelayMs')) ? flat.get('revealWriteDelayMs') as number : DEFAULTS.revealWriteDelayMs,
    cssInspector: flat.get('cssInspector') === true,
    sourceAnnotations: flat.get('sourceAnnotations') as 'auto' | 'force' | 'off',
  };
}

export function createOptionsResolver(deps: OptionsResolverDeps): OptionsResolver {
  const { root, configOptions } = deps;

  return {
    async resolve() {
      // Every failure inside degrades to "nothing stored", so a corrupt or
      // unreadable settings file falls back to config + defaults rather than
      // breaking every endpoint.
      const stored = await readStoredOptions(root);

      const flat = new Map<string, unknown>();
      const described: ResolvedOption[] = [];

      for (const spec of OPTION_SPECS) {
        const fromConfig = spec.read(configOptions);
        const fromFile = spec.configOnly
          ? undefined
          : (spec.readStored ?? spec.read)(stored);

        let value: unknown;
        let source: OptionSource;
        if (fromConfig !== undefined) {
          value = fromConfig;
          source = 'config';
        } else if (fromFile !== undefined) {
          value = fromFile;
          source = 'file';
        } else {
          value = spec.fallback;
          source = 'default';
        }

        flat.set(spec.key, value);
        described.push({
          key: spec.key,
          label: spec.label,
          help: spec.help,
          type: spec.type,
          group: spec.group,
          ...(spec.choices ? { choices: spec.choices } : {}),
          value,
          source,
          // Config-only options are always locked; the rest lock only when the
          // config actually speaks about them.
          locked: Boolean(spec.configOnly) || source === 'config',
          restartRequired: Boolean(spec.configOnly),
        });
      }

      return { options: toResolvedOptions(flat), described };
    },
  };
}

// --- The write side ----------------------------------------------------------

/** Look a spec up by wire key. */
function specFor(key: string): OptionSpec | undefined {
  return OPTION_SPECS.find((s) => s.key === key);
}

function validRevealDelay(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10000;
}

export interface CoercedPatch {
  /** Wire key → validated value, for keys that passed. */
  values: Map<string, unknown>;
  /** Wire key → message, for keys that did not. */
  errors: Record<string, string>;
}

/**
 * Validate a flat patch from the Settings panel. The client is typed but not
 * trusted — these values become the project's write confinement and upload
 * targets, so every one is checked against its spec's declared type, and an
 * unknown or config-only key is an error rather than a silent no-op.
 *
 * `locked` is deliberately **not** checked here: it depends on the resolution
 * this patch is about to change, so the route checks it against a fresh resolve.
 */
export function coerceOptionPatch(patch: Record<string, unknown>): CoercedPatch {
  const values = new Map<string, unknown>();
  const errors: Record<string, string> = {};

  for (const key of Object.keys(patch)) {
    if (!specFor(key)) errors[key] = 'unknown option';
  }

  for (const spec of OPTION_SPECS) {
    const key = spec.key;
    if (!(key in patch)) continue;
    const raw = patch[key];
    if (spec.configOnly) {
      errors[key] = `${spec.label} can only be set in astro.config.mjs`;
      continue;
    }
    // `collectChanges` maps an emptied optional field to `null` (= remove the
    // key), which is right for frontmatter and meaningless here: an option
    // always has an effective value, and there is no "absent" state to fall back
    // to. Caught up front so the message is about being empty rather than about
    // the type.
    if (raw === null) {
      errors[key] = 'cannot be empty';
      continue;
    }
    switch (spec.type) {
      case 'boolean': {
        if (typeof raw !== 'boolean') {
          errors[key] = 'expected true or false';
          continue;
        }
        values.set(key, raw);
        break;
      }
      case 'number': {
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (key === 'revealWriteDelayMs' && !validRevealDelay(n)) {
          errors[key] = 'expected an integer from 0 to 10000';
          continue;
        }
        if (!Number.isFinite(n)) {
          errors[key] = 'expected a number';
          continue;
        }
        values.set(key, Math.trunc(n));
        break;
      }
      case 'select': {
        if (typeof raw !== 'string' || !spec.choices?.includes(raw)) {
          errors[key] = `expected one of ${spec.choices?.join(', ')}`;
          continue;
        }
        values.set(key, raw);
        break;
      }
      case 'tags': {
        const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : null;
        if (!list) {
          errors[key] = 'expected a list';
          continue;
        }
        const clean = list.map((v) => String(v).trim()).filter(Boolean);
        if (clean.length === 0) {
          errors[key] = 'at least one entry is required';
          continue;
        }
        values.set(key, clean);
        break;
      }
      default: {
        // 'text' and anything a future spec adds: a trimmed non-empty string.
        if (typeof raw !== 'string') {
          errors[key] = 'expected text';
          continue;
        }
        const trimmed = raw.trim();
        if (!trimmed) {
          errors[key] = 'cannot be empty';
          continue;
        }
        values.set(key, trimmed);
        break;
      }
    }
  }

  return { values, errors };
}

/**
 * Merge a validated flat patch into the stored option document.
 *
 * Merge-not-replace: the panel sends only what changed, so anything absent from
 * the patch must survive.
 */
export function applyOptionPatch(
  current: StoredOptions,
  values: Map<string, unknown>,
): StoredOptions {
  const next: StoredOptions = { ...current };
  for (const [key, value] of values) {
    (next as Record<string, unknown>)[key] = value;
  }
  return next;
}
