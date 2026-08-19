import type { FieldType } from '../shared/protocol.ts';
import type { EntryEditorOptions } from './content-config.ts';
import { readStoredOptions } from './settings.ts';

/**
 * The integration's option vocabulary, and the resolver that turns it into the
 * effective values a request runs against.
 *
 * **Why options resolve per request.** Everything here used to be collapsed
 * once in `astro:config:setup` and captured by the middleware, so changing an
 * option meant editing `astro.config.mjs` and restarting the dev server. The
 * Settings panel needs to change them live, so resolution moved behind a thunk
 * — the same shape `unsplash.resolve` already had, and for the same reason:
 * nothing depends on hook ordering, and a saved change takes effect on the next
 * request.
 *
 * **Precedence, highest first: `astro.config.mjs` → the settings file →
 * {@link DEFAULTS}.** The config wins because it is code the user wrote
 * deliberately, is committed, and is read by `astro build`. An option set there
 * is reported `locked` and the panel renders it read-only rather than storing a
 * value that resolution would ignore — the refusal `settings-panel.ts` already
 * makes for a config-supplied Unsplash key, generalized.
 *
 * **{@link OPTION_SPECS} is the registry.** One entry per option carries its
 * default, its wire label/help, the control it renders as, and how to read it
 * out of a partial config. That single table drives resolution, the `/settings`
 * response, and the panel's controls — so adding an option is one entry here,
 * with no client change at all.
 */

/** Options a consuming project passes to `textEdit()`. */
export interface TextEditOptions {
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
  /**
   * The hover-pill CSS inspector: on hover, list an element's classes and ID,
   * and reveal the CSS rules each one applies (read from the browser, no server
   * round-trip) with a link to open the defining file at the rule. The
   * open-at-rule jump additionally requires `openInEditor`. `false` disables the
   * whole surface (no chips render).
   */
  cssInspector?: boolean;
  /**
   * Who emits the `data-astro-source-*` attributes the feature rides on.
   * `'auto'` (default): Astro's own compiler on Astro 5/6; injected by this
   * integration on Astro ≥7, whose Rust compiler doesn't emit them
   * (withastro/compiler-rs#96). `'force'` always injects (also lifts the
   * dev-toolbar requirement on 5/6); `'off'` never injects.
   */
  sourceAnnotations?: 'auto' | 'force' | 'off';
  /**
   * The CMS-style entry panel for content-collection pages that emit the
   * `astro-text-edit:page-source` meta tag. Zero-config for conventional
   * `src/content/<name>/` layouts; `false` disables the whole surface.
   */
  entryEditor?: false | EntryEditorOptions;
  /**
   * The Unsplash photo source in the media picker. `unsplash: {}` turns it on
   * with defaults; omitted (the default) leaves it off entirely, and the media
   * modal renders as a single-source project-asset grid.
   *
   * Every user brings their own access key. The recommended way to give one is
   * the overlay's own Settings panel (admin bar → Settings), which stores it
   * outside the repo — see `accessKey` for why not here.
   */
  unsplash?: false | UnsplashOptions;
}

/** Options for the Unsplash photo source. See `TextEditOptions.unsplash`. */
export interface UnsplashOptions {
  /**
   * Access key, as an escape hatch for programmatic config. **Not the
   * recommended path:** `astro.config.mjs` is committed *and* is read by
   * `astro build`, so a key here travels with the repo. Prefer the Settings
   * panel, or `UNSPLASH_ACCESS_KEY` in the environment. When set, it wins over
   * both and the Settings panel says so rather than accepting a value that
   * would do nothing.
   */
  accessKey?: string;
  /**
   * Application name sent as `utm_source` on every photographer credit link,
   * as the Unsplash API guidelines require. Should match the application name
   * registered at unsplash.com/oauth/applications. Defaults to
   * `astro-text-edit`.
   */
  appName?: string;
  /** Results per search page. Clamped to Unsplash's own maximum of 30.
   *  Defaults to 20. */
  perPage?: number;
}

/** Every option's effective value for one request — no optionals left. */
export type ResolvedOptions = Required<TextEditOptions>;

/**
 * What the Settings panel stores. `Partial<TextEditOptions>` for every option
 * with a single value, plus explicit on/off flags for the two *features*.
 *
 * The flags exist because `TextEditOptions` encodes a feature as
 * `false | { …detail }`, which cannot hold "switched off" and "configured like
 * this" at the same time. In a config file that is fine — the user retypes the
 * object. In a store the panel writes, switching a feature off would silently
 * discard the per-collection widget overrides or the Unsplash app name, and
 * switching it back on would come up empty. So the stored document keeps the
 * detail under `entryEditor` / `unsplash` unconditionally and the on/off bit
 * beside it.
 */
export interface StoredOptions extends Partial<TextEditOptions> {
  entryEditorEnabled?: boolean;
  unsplashEnabled?: boolean;
}

export const DEFAULTS: ResolvedOptions = {
  enabled: true,
  assetDirs: ['src/assets', 'public'],
  uploadDir: 'public',
  imageUploadDir: 'src/assets',
  editableExtensions: ['.astro', '.md', '.mdx'],
  contentRoots: ['src', 'public'],
  openInEditor: true,
  cssInspector: true,
  sourceAnnotations: 'auto',
  entryEditor: {},
  // Off unless asked for: the feature reaches a third-party API and needs a key
  // the user has to supply, so opting in is deliberate.
  unsplash: false,
};

/** Unsplash's own ceiling on `per_page`. */
export const UNSPLASH_MAX_PER_PAGE = 30;

/** Which Settings tab an option is grouped under. */
export type OptionGroup = 'general' | 'editing' | 'media' | 'unsplash';

/**
 * One option, as both a resolution rule and a control the panel renders.
 *
 * `read` returns `undefined` for "this source is silent about the option",
 * which is what separates a deliberate `false` from an absent key — and
 * therefore what {@link OptionDescriptor.locked} means.
 */
interface OptionSpec {
  /** Flat wire key. Also the settings-file key for everything but the
   *  `unsplash*` trio, which flattens a nested config object. */
  key: string;
  label: string;
  help: string;
  type: FieldType;
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
  read(o: Partial<TextEditOptions>): unknown;
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
    help: 'Who emits the data-astro-source-* attributes everything rides on. "auto" uses Astro\'s compiler on 5/6 and injects them on 7+. Registers a Vite plugin, so it is config-only.',
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
    key: 'cssInspector',
    label: 'CSS inspector',
    help: 'The hover pill\'s class and ID chips, and the CSS rules each one applies. Off means no chips render at all.',
    type: 'boolean',
    group: 'editing',
    fallback: DEFAULTS.cssInspector,
    read: (o) => o.cssInspector,
  },
  {
    key: 'entryEditor',
    label: 'Entry editor',
    help: 'The CMS drawer for content-collection entries. Off disables every /entry endpoint and the admin bar button.',
    type: 'boolean',
    group: 'editing',
    fallback: DEFAULTS.entryEditor !== false,
    // An object means the feature is on and configured; only an explicit
    // `false` is a config-level kill. A configured object therefore locks the
    // toggle on without locking the per-collection detail, which merges.
    read: (o) => (o.entryEditor === undefined ? undefined : o.entryEditor !== false),
    readStored: (o) => o.entryEditorEnabled,
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
  {
    key: 'unsplashEnabled',
    label: 'Unsplash photo source',
    help: 'Adds an Unsplash tab to the media picker. Needs an access key, below.',
    type: 'boolean',
    group: 'unsplash',
    fallback: DEFAULTS.unsplash !== false,
    read: (o) => (o.unsplash === undefined ? undefined : o.unsplash !== false),
    readStored: (o) => o.unsplashEnabled,
  },
  {
    key: 'unsplashAppName',
    label: 'Application name',
    help: 'Sent as utm_source on every photographer credit link, as the Unsplash API guidelines require. Should match the name you registered.',
    type: 'text',
    group: 'unsplash',
    fallback: 'astro-text-edit',
    read: (o) => (o.unsplash ? o.unsplash.appName : undefined),
  },
  {
    key: 'unsplashPerPage',
    label: 'Results per page',
    help: `How many photos each search returns. Clamped to Unsplash's own maximum of ${UNSPLASH_MAX_PER_PAGE}.`,
    type: 'number',
    group: 'unsplash',
    fallback: 20,
    read: (o) => (o.unsplash ? o.unsplash.perPage : undefined),
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
  type: FieldType;
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
  /** Exactly what the project passed to `textEdit()`, **not** merged with
   *  DEFAULTS: `key in configOptions` is what makes an option `locked`. */
  configOptions: Partial<TextEditOptions>;
}

export interface OptionsResolver {
  /** Resolve for one request. Cheap — one small JSON read, the same cost
   *  `resolveUnsplashKey` already pays per request. */
  resolve(): Promise<OptionsResolution>;
}

/** Deep-merge `entryEditor`, config leaf winning over stored leaf.
 *
 *  `entryEditor` is the one option that is not a single value: a project may
 *  configure `collections.blog.fields.excerpt.widget` in code while the panel
 *  adds `collections.notes` at runtime, and both must apply. Merging per leaf
 *  keeps the config authoritative exactly where it speaks. */
function mergeEntryEditor(
  stored: EntryEditorOptions | undefined,
  config: EntryEditorOptions | undefined,
): EntryEditorOptions {
  if (!stored) return config ?? {};
  if (!config) return stored;
  const names = new Set([
    ...Object.keys(stored.collections ?? {}),
    ...Object.keys(config.collections ?? {}),
  ]);
  const collections: NonNullable<EntryEditorOptions['collections']> = {};
  for (const name of names) {
    const s = stored.collections?.[name] ?? {};
    const c = config.collections?.[name] ?? {};
    const fieldNames = new Set([...Object.keys(s.fields ?? {}), ...Object.keys(c.fields ?? {})]);
    const fields: NonNullable<typeof s.fields> = {};
    for (const f of fieldNames) fields[f] = { ...s.fields?.[f], ...c.fields?.[f] };
    collections[name] = {
      ...s,
      ...c,
      ...(fieldNames.size > 0 ? { fields } : {}),
    };
  }
  return {
    ...stored,
    ...config,
    ...(names.size > 0 ? { collections } : {}),
  };
}

/** Rebuild the nested option shape from resolved flat values. Explicit rather
 *  than driven by per-spec writers, because the `unsplash*` trio collapses to a
 *  single `false` and order-of-assignment bugs there are invisible. */
function toResolvedOptions(
  flat: Map<string, unknown>,
  entryEditor: EntryEditorOptions,
  accessKeyFromConfig: string | undefined,
): ResolvedOptions {
  const unsplashOn = flat.get('unsplashEnabled') === true;
  return {
    enabled: flat.get('enabled') as boolean,
    assetDirs: flat.get('assetDirs') as string[],
    uploadDir: flat.get('uploadDir') as string,
    imageUploadDir: flat.get('imageUploadDir') as string,
    editableExtensions: flat.get('editableExtensions') as string[],
    contentRoots: flat.get('contentRoots') as string[],
    openInEditor: flat.get('openInEditor') === true,
    cssInspector: flat.get('cssInspector') === true,
    sourceAnnotations: flat.get('sourceAnnotations') as 'auto' | 'force' | 'off',
    entryEditor: flat.get('entryEditor') === true ? entryEditor : false,
    unsplash: unsplashOn
      ? {
          // The key never travels through the option table — it resolves
          // separately, through settings.ts, and is only ever read there.
          ...(accessKeyFromConfig ? { accessKey: accessKeyFromConfig } : {}),
          appName: flat.get('unsplashAppName') as string,
          perPage: flat.get('unsplashPerPage') as number,
        }
      : false,
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

      const entryEditor = mergeEntryEditor(
        // The stored side holds detail only — its on/off bit is
        // `entryEditorEnabled`, already folded into `flat` above.
        stored.entryEditor === false ? undefined : stored.entryEditor,
        configOptions.entryEditor === false ? undefined : configOptions.entryEditor,
      );
      const configUnsplash = configOptions.unsplash;
      const accessKey = configUnsplash ? configUnsplash.accessKey : undefined;

      return {
        options: toResolvedOptions(flat, entryEditor, accessKey),
        described,
      };
    },
  };
}

// --- The write side ----------------------------------------------------------

/** Look a spec up by wire key. */
function specFor(key: string): OptionSpec | undefined {
  return OPTION_SPECS.find((s) => s.key === key);
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

  // Table order, not the client's JSON key order: `applyOptionPatch` relies on
  // `unsplashEnabled` being applied before the sub-options it gates.
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
 * Merge-not-replace, like `saveUnsplashKey` — the panel sends only what changed,
 * so anything absent from the patch must survive. The `unsplash*` trio folds
 * back into one nested object, and `accessKey` is **stripped**: the key lives at
 * the document's top level, resolved by `settings.ts`, and must never be written
 * anywhere the option table can echo back to the browser.
 */
export function applyOptionPatch(
  current: StoredOptions,
  values: Map<string, unknown>,
): StoredOptions {
  const next: StoredOptions = { ...current };

  for (const [key, value] of values) {
    switch (key) {
      // Both feature toggles set the flag beside the detail, never the detail
      // itself — see {@link StoredOptions} for why they are separate.
      case 'entryEditor': {
        next.entryEditorEnabled = value === true;
        break;
      }
      case 'unsplashEnabled': {
        next.unsplashEnabled = value === true;
        break;
      }
      case 'unsplashAppName':
      case 'unsplashPerPage': {
        // Stored whether or not the feature is on: in this document the object
        // is detail, not the on/off bit, so writing it enables nothing.
        const base = next.unsplash === false || next.unsplash === undefined ? {} : next.unsplash;
        const merged: UnsplashOptions = { ...base };
        if (key === 'unsplashAppName') merged.appName = value as string;
        else merged.perPage = value as number;
        next.unsplash = merged;
        break;
      }
      default: {
        (next as Record<string, unknown>)[key] = value;
        break;
      }
    }
  }

  if (next.unsplash) {
    // Never persist the secret through this path. Copied rather than deleted
    // in place, because `next.unsplash` can still be `current`'s own object.
    const { accessKey: _secret, ...rest } = next.unsplash;
    next.unsplash = rest;
  }
  return next;
}
