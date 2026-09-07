import type { TextWriter } from './text-writes.ts';
import { chmod, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SettingsSource } from '../shared/protocol.ts';
import type { StoredOptions } from './options.ts';
import { atomicWrite } from './paths.ts';

/**
 * User settings that live outside the Astro config: the Unsplash access key and
 * the option document the overlay's Settings panel writes.
 *
 * Two deliberately separate compartments in one file. `unsplash.accessKey` is a
 * **secret** — never returned to the browser, masked on read, chmod'ed 0600.
 * `options` is an ordinary `Partial<DevEditOptions>`, the same vocabulary
 * `astro.config.mjs` uses, so the file reads like the config it supplements and
 * `options.ts` can apply one `read` per option to either source. The key is
 * stripped from `options.unsplash` on every write, so the secret has exactly one
 * home.
 *
 * **A new class of write.** This is neither a source patch nor an asset upload,
 * so it cannot go through `paths.ts::validateEditablePath`, which would block it
 * three ways: `realpath` fails on a file that doesn't exist yet, a root dotfile
 * is outside `contentRoots`, and `.json` isn't an editable extension. It follows
 * `/entry/create` instead: a **fixed target** — the path is a constant here,
 * never client-supplied — written with the existing `atomicWrite`.
 *
 * Server-side rather than `localStorage` so it survives a browser data clear,
 * works from any browser, and gives future settings a home. The cost is a secret
 * on disk, which is why {@link checkGitignored} exists and why the file is
 * chmod'ed 0600.
 *
 * The key is **never** returned to the client — only whether one resolved, where
 * from, and a masked fragment. It must never enter a log line or an error
 * message either.
 */

/** Fixed, never client-supplied. */
export const SETTINGS_FILE = '.astro-dev-edit.json';

interface StoredSettings {
  /** The secret compartment. Read only by `resolveUnsplashKey`. */
  unsplash?: { accessKey?: string };
  /** What the Settings panel writes — see `options.ts::StoredOptions`. */
  options?: StoredOptions;
}

/** Read the settings file. Every failure — absent, unreadable, malformed JSON,
 *  wrong shape — degrades to "nothing stored" rather than throwing, so a
 *  corrupt file makes the feature unconfigured instead of breaking the page. */
async function readSettingsFile(root: string): Promise<StoredSettings> {
  try {
    const raw = await readFile(join(root, SETTINGS_FILE), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as StoredSettings;
  } catch {
    return {};
  }
}

/** Write the settings file atomically, then restrict it to the owner. The chmod
 *  is best-effort: it is meaningless on Windows and must not fail the save. */
async function writeSettingsFile(root: string, next: StoredSettings, writeText: TextWriter = atomicWrite): Promise<void> {
  const target = join(root, SETTINGS_FILE);
  await writeText(target, JSON.stringify(next, null, 2) + '\n');
  try {
    await chmod(target, 0o600);
  } catch {
    // Non-POSIX filesystem; the file is written either way.
  }
}

/**
 * Read an unprefixed variable the way Vite does.
 *
 * `astro dev` does **not** populate `process.env` from `.env` — Astro's env
 * plugin does that only when `isBuild` (`vite-plugin-env.js`: `if (!isBuild ||
 * populated) return`), and Vite has not mutated `process.env` since v2. So a
 * plain `process.env` read sees a `.env` entry *never* in dev. Going through
 * Vite's own `loadEnv` also handles `.env.local`, `.env.[mode]`, quoting and
 * expansion. `process.env` is still consulted as a fallback for a real shell
 * variable.
 *
 * `vite` is imported dynamically rather than declared as a dependency: it
 * resolves from any Astro project, and a static import would make this module
 * unloadable anywhere it doesn't.
 */
async function readEnvVar(root: string, name: string): Promise<string> {
  try {
    const { loadEnv } = await import('vite');
    // Empty prefix: return unprefixed variables too (the default `VITE_` prefix
    // would hide UNSPLASH_ACCESS_KEY entirely).
    const env = loadEnv('development', root, '');
    if (env[name]) return env[name];
  } catch {
    // vite unresolvable, or the project has no readable .env — fall through.
  }
  return process.env[name] ?? '';
}

const ENV_VAR = 'UNSPLASH_ACCESS_KEY';

export interface ResolvedKey {
  /** Empty when nothing is configured anywhere. */
  key: string;
  source: SettingsSource | null;
}

/**
 * Resolve the Unsplash access key, highest precedence first:
 *
 * 1. `unsplash.accessKey` in the Astro config — documented but discouraged;
 *    that file is committed and is read by `astro build`.
 * 2. `UNSPLASH_ACCESS_KEY` from `.env` or the real environment — for teams/CI.
 * 3. The settings file this module writes — what the Settings panel uses.
 *
 * Called per request (never captured at config time), so a key entered through
 * the UI works without a dev-server restart.
 */
export async function resolveUnsplashKey(
  root: string,
  configKey?: string,
): Promise<ResolvedKey> {
  if (configKey?.trim()) return { key: configKey.trim(), source: 'config' };

  const fromEnv = (await readEnvVar(root, ENV_VAR)).trim();
  if (fromEnv) return { key: fromEnv, source: 'env' };

  const stored = (await readSettingsFile(root)).unsplash?.accessKey?.trim();
  if (stored) return { key: stored, source: 'file' };

  return { key: '', source: null };
}

/** Store (or, with an empty string, clear) the key the Settings panel supplied.
 *  Merges into whatever else the file holds rather than replacing it. */
export async function saveUnsplashKey(root: string, accessKey: string, writeText?: TextWriter): Promise<void> {
  const current = await readSettingsFile(root);
  const key = accessKey.trim();
  const next: StoredSettings = { ...current };
  if (key) next.unsplash = { ...current.unsplash, accessKey: key };
  else if (next.unsplash) {
    const { accessKey: _dropped, ...rest } = next.unsplash;
    next.unsplash = rest;
  }
  await writeSettingsFile(root, next, writeText);
}

/**
 * The stored option document, or `{}` when nothing is stored. Degrades on every
 * failure path exactly as {@link readSettingsFile} does, so a corrupt file makes
 * the panel's changes vanish rather than breaking every endpoint that resolves
 * options.
 */
export async function readStoredOptions(root: string): Promise<StoredOptions> {
  const stored = (await readSettingsFile(root)).options;
  return stored && typeof stored === 'object' ? stored : {};
}

/** Replace the stored option document, leaving the secret compartment alone.
 *  The caller has already merged the panel's sparse patch into `next` — see
 *  `options.ts::applyOptionPatch`. */
export async function saveStoredOptions(root: string, next: StoredOptions, writeText?: TextWriter): Promise<void> {
  const current = await readSettingsFile(root);
  await writeSettingsFile(root, { ...current, options: next }, writeText);
}

/** A fragment of the key, for recognition only — never enough to use. Eight
 *  bullets regardless of length, so the mask leaks nothing about the real one. */
export function maskKey(key: string): string {
  return '••••••••' + key.slice(-4);
}

/**
 * Whether the project's own `.gitignore` covers the settings file. Best-effort
 * and deliberately literal: it matches an exact line, not the full gitignore
 * pattern grammar, so a `.astro-*` style rule reads as *not* covered and the
 * user gets a warning they can dismiss by adding the plain line. Erring toward
 * a false warning is the right direction when the alternative is a committed
 * secret — and this integration cannot edit a consuming project's ignore rules.
 */
export async function checkGitignored(root: string): Promise<boolean> {
  try {
    const raw = await readFile(join(root, '.gitignore'), 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .some((line) => line === SETTINGS_FILE || line === '/' + SETTINGS_FILE);
  } catch {
    return false; // no .gitignore at all — definitely not covered
  }
}
