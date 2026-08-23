import type { AstroIntegrationLogger } from 'astro';
import type { SettingsResponse, SettingsUpdateRequest } from '../shared/protocol.ts';
import {
  applyOptionPatch,
  coerceOptionPatch,
  type OptionsResolver,
  type ResolvedOption,
} from './options.ts';
import type { Route, RouteResult } from './router.ts';
import {
  checkGitignored,
  maskKey,
  readStoredOptions,
  saveStoredOptions,
  saveUnsplashKey,
} from './settings.ts';
import type { UnsplashConfig } from './unsplash-routes.ts';

/**
 * The `/settings` route group — what the overlay's Settings panel reads and
 * writes.
 *
 * Split out of `unsplash-routes.ts`, which held these two endpoints only because
 * the sole setting was that feature's access key and whose comment named this
 * split as the moment a second, unrelated setting arrived. That moment is the
 * option editor.
 *
 * Two compartments, deliberately different in kind:
 *
 * - **`options`** — ordinary values, read back in full. The panel needs the
 *   effective value *and* its provenance, because an option `astro.config.mjs`
 *   sets cannot be changed from here and the panel must say so instead of
 *   accepting input that resolution would discard.
 * - **`unsplash.accessKey`** — a secret. It is never in a response: a read
 *   reports only whether one resolved, from where, and a masked fragment. It
 *   must never enter a log line or an error message either.
 *
 * **Writes are all-or-nothing.** A patch naming any unknown, config-only or
 * locked key is refused whole, with per-key messages, before anything reaches
 * disk — so a partly-valid patch can never leave the file half-updated. This is
 * the same property `/apply`'s verify-all-then-write-once loop has.
 *
 * Both endpoints write a **fixed path** (`.astro-dev-edit.json` at the project
 * root, never client-supplied), which is why they bypass
 * `paths.ts::validateEditablePath` — see the header of `settings.ts` for the
 * full rationale.
 */

export interface SettingsRouteDeps {
  logger: AstroIntegrationLogger;
  /** Project root (fsPath). The settings file sits at its top level. */
  root: string;
  /** The live option resolver — the same one every other route reads through. */
  optionsResolver: OptionsResolver;
  /**
   * The Unsplash config, for its key resolver **only**.
   *
   * Deliberately not re-deriving the key here: `resolveUnsplashKey` has its own
   * precedence (config → env → file) that `/unsplash/search` already reads
   * through this seam, and a second call site would be a second place for that
   * order to drift. It is also the seam tests inject through, so a duplicate
   * would make this route disagree with the searches it reports on.
   */
  unsplash: UnsplashConfig | null;
}

/** Body cap for a settings write. Generous for a sparse patch of scalars and
 *  short path lists, far too small to smuggle anything bulky. */
const MAX_SETTINGS_BYTES = 8 * 1024;

export function createSettingsRoutes(deps: SettingsRouteDeps): Route[] {
  const { logger, root, optionsResolver, unsplash } = deps;

  /** The full panel payload. Shared by read and write, so a save answers with
   *  the same shape a read would and the panel needs no second request. */
  async function settingsBody(): Promise<SettingsResponse> {
    const { options, described } = await optionsResolver.resolve();
    // Enabled-ness comes from the **option**, which is what this panel toggles
    // and the one source of truth for it. Only the key is asked of the injected
    // config, which owns its own config → env → file precedence.
    const unsplashOn = options.unsplash !== false && Boolean(unsplash);

    // Only asked for when the feature is on, so a disabled source reports
    // "not enabled" without touching the filesystem at all.
    const { key, source } = unsplashOn
      ? await unsplash!.resolve()
      : { key: '', source: null };

    return {
      options: described.map(toWire),
      unsplash: {
        enabled: unsplashOn,
        configured: Boolean(key),
        source,
        ...(key ? { hint: maskKey(key) } : {}),
        ...((await checkGitignored(root)) ? {} : { gitignoreWarning: true }),
      },
    };
  }

  return [
    {
      method: 'GET',
      path: '/settings',
      label: 'settings read',
      handler: async () => ({ status: 200, body: await settingsBody() }),
      onError: () => ({ status: 500, body: { error: 'could not read settings' } }),
    },

    {
      method: 'POST',
      path: '/settings',
      maxBytes: MAX_SETTINGS_BYTES,
      label: 'settings write',
      handler: async (body) => {
        const req = (body ?? {}) as SettingsUpdateRequest;
        const hasOptions = req.options && typeof req.options === 'object';
        const hasKey = typeof req.unsplash?.accessKey === 'string';
        if (!hasOptions && !hasKey) {
          return { status: 400, body: { error: 'nothing to save' } };
        }

        if (hasOptions) {
          const refusal = await writeOptions(req.options!);
          if (refusal) return refusal;
        }
        if (hasKey) {
          const refusal = await writeAccessKey(req.unsplash!.accessKey);
          if (refusal) return refusal;
        }
        return { status: 200, body: await settingsBody() };
      },
      onError: () => ({ status: 500, body: { error: 'could not save settings' } }),
    },
  ];

  /** Validate and store an option patch, or return the refusal. */
  async function writeOptions(patch: Record<string, unknown>): Promise<RouteResult | null> {
    const { values, errors } = coerceOptionPatch(patch);

    // `locked` depends on the current resolution, so it is checked here rather
    // than in the pure coercion step.
    const { described } = await optionsResolver.resolve();
    const byKey = new Map(described.map((o) => [o.key, o]));
    for (const key of values.keys()) {
      const opt = byKey.get(key);
      if (opt?.locked) {
        errors[key] =
          `${opt.label} is set in astro.config.mjs, which takes precedence. ` +
          'Remove it there to manage this option from the panel.';
        values.delete(key);
      }
    }

    if (Object.keys(errors).length > 0) {
      // All-or-nothing: nothing has touched disk yet, and nothing will.
      return {
        status: 422,
        body: { error: 'some options were refused', code: 'validation', fieldErrors: errors },
      };
    }
    if (values.size === 0) return null;

    const next = applyOptionPatch(await readStoredOptions(root), values);
    await saveStoredOptions(root, next);
    logger.info(`settings saved: ${[...values.keys()].join(', ')}`);
    return null;
  }

  /** Store or clear the access key, or return the refusal. */
  async function writeAccessKey(accessKey: string): Promise<RouteResult | null> {
    const { options } = await optionsResolver.resolve();
    if (options.unsplash === false || !unsplash) {
      return {
        status: 403,
        body: { error: 'the Unsplash photo source is disabled', code: 'disabled' },
      };
    }
    // A config or env key wins at resolve time, so storing one here would be a
    // value that silently does nothing. Refuse and say why.
    const { source } = await unsplash.resolve();
    if (source === 'config' || source === 'env') {
      return {
        status: 409,
        body: {
          error:
            source === 'config'
              ? 'An access key is set in your Astro config, which takes precedence. ' +
                'Remove `unsplash.accessKey` from astro.config.mjs first.'
              : 'UNSPLASH_ACCESS_KEY is set in the environment, which takes ' +
                'precedence. Unset it (or clear it from .env) first.',
          code: 'conflict',
        },
      };
    }
    await saveUnsplashKey(root, accessKey);
    logger.info(
      accessKey.trim()
        ? 'stored an Unsplash access key in .astro-dev-edit.json'
        : 'cleared the stored Unsplash access key',
    );
    return null;
  }
}

/** Server shape → wire shape. `restartRequired` is omitted when false so the
 *  common case stays absent from the payload. */
function toWire(o: ResolvedOption): NonNullable<SettingsResponse['options']>[number] {
  return {
    key: o.key,
    label: o.label,
    help: o.help,
    type: o.type,
    group: o.group,
    ...(o.choices ? { choices: o.choices } : {}),
    value: o.value,
    source: o.source,
    locked: o.locked,
    ...(o.restartRequired ? { restartRequired: true } : {}),
  };
}
