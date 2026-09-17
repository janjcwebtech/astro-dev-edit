import type { TextWriter } from './text-writes.ts';
import type { AstroIntegrationLogger } from 'astro';
import type { SettingsResponse, SettingsUpdateRequest } from '../shared/protocol.ts';
import {
  applyOptionPatch,
  coerceOptionPatch,
  type OptionsResolver,
  type ResolvedOption,
} from './options.ts';
import type { Route, RouteResult } from './router.ts';
import { readStoredOptions, saveStoredOptions, uncoveredSettingsFiles } from './settings.ts';

/**
 * The `/settings` route group — what the overlay's Settings panel reads and
 * writes.
 *
 * Options are ordinary values in `.astro-dev-edit.json`, read back in full. The
 * panel needs the effective value *and* its provenance, because an option
 * `astro.config.mjs` sets cannot be changed from here and the panel must say so
 * instead of accepting input that resolution would discard.
 *
 * **An option patch is all-or-nothing.** A patch naming any unknown,
 * config-only or locked key is refused whole, with per-key messages, before
 * anything reaches disk — so a partly-valid patch can never leave the file
 * half-updated. This is the same property `/apply`'s verify-all-then-write-once
 * loop has.
 *
 * The write targets a **fixed path** (`.astro-dev-edit.json` at the project
 * root, never client-supplied), which is why it bypasses
 * `paths.ts::validateEditablePath` — see the header of `settings.ts` for the
 * full rationale.
 */

export interface SettingsRouteDeps {
  writeText?: TextWriter;
  logger: AstroIntegrationLogger;
  /** Project root (fsPath). The settings file sits at its top level. */
  root: string;
  /** The live option resolver — the same one every other route reads through. */
  optionsResolver: OptionsResolver;
}

/** Body cap for a settings write. Generous for a sparse patch of scalars and
 *  short path lists, far too small to smuggle anything bulky. */
const MAX_SETTINGS_BYTES = 8 * 1024;

export function createSettingsRoutes(deps: SettingsRouteDeps): Route[] {
  const { logger, root, optionsResolver } = deps;

  /** The full panel payload. Shared by read and write, so a save answers with
   *  the same shape a read would and the panel needs no second request. */
  async function settingsBody(): Promise<SettingsResponse> {
    const { described } = await optionsResolver.resolve();
    const uncovered = await uncoveredSettingsFiles(root);
    return {
      options: described.map(toWire),
      ...(uncovered.length > 0 ? { gitignoreWarning: uncovered } : {}),
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
        if (!req.options || typeof req.options !== 'object') {
          return { status: 400, body: { error: 'nothing to save' } };
        }
        const refusal = await writeOptions(req.options);
        if (refusal) return refusal;
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
    await saveStoredOptions(root, next, deps.writeText);
    logger.info(`settings saved: ${[...values.keys()].join(', ')}`);
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
