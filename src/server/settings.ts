import type { TextWriter } from './text-writes.ts';
import { createHash } from 'node:crypto';
import { chmod, readFile } from 'node:fs/promises';
import { join } from 'node:path';
// Static, not a lazy import inside readEnvKey: see the note in editor.ts. A
// deferred import() runs after the config-loading module runner has closed.
import { loadEnv } from 'vite';
import type { SettingsSource } from '../shared/protocol.ts';
import { upsertEnvVar } from '../patcher/dotenv.ts';
import type { StoredOptions } from './options.ts';
import { atomicWrite, SECRET_MODE } from './paths.ts';

/**
 * User settings that live outside the Astro config, and the resolution of the
 * Unsplash access key.
 *
 * **Two files, for two different kinds of thing.**
 *
 * `.astro-dev-edit.json` holds the option document the Settings panel writes
 * and the entry drawer's field overrides — ordinary values, in the same
 * vocabulary `astro.config.mjs` uses, so the file reads like the config it
 * supplements and `options.ts` can apply one `read` per option to either
 * source. It is never served over HTTP (`private-files.ts`), but it is a plain
 * JSON file in the project's own tree.
 *
 * `.env.local` holds the access key, as `UNSPLASH_ACCESS_KEY`. A secret does
 * not belong in a file that sits in the directory Vite serves — a guard is one
 * thing to get wrong, whereas `.env` and `.env.*` are already denied by Vite
 * itself and already expected to hold secrets by every project's ignore rules.
 * It is also the file a developer would have edited by hand, so the panel is
 * writing to the same place rather than inventing a private one.
 *
 * A legacy `unsplash.accessKey` inside `.astro-dev-edit.json` is still read, at
 * the lowest precedence, and is stripped the next time a key is saved. See
 * {@link saveUnsplashKey} for why the two writes go in the order they do.
 *
 * **A class of write of its own.** Neither file can go through
 * `paths.ts::validateEditablePath`, which would block both three ways:
 * `realpath` fails on a file that does not exist yet, a root dotfile is outside
 * `contentRoots`, and neither `.json` nor an extensionless dotfile is an
 * editable extension. They follow `/entry/create` instead: a **fixed target** —
 * the path is a constant here, never client-supplied — written through the
 * injected `writeText`.
 *
 * Server-side rather than `localStorage` so settings survive a browser data
 * clear, work from any browser, and have a home for future additions.
 *
 * The key is **never** returned to the client — only whether one resolved,
 * where from, and a fingerprint of it. It must never enter a log line or an error
 * message either.
 */

/** Fixed, never client-supplied. */
export const SETTINGS_FILE = '.astro-dev-edit.json';

/**
 * The env file the Settings panel owns. `.env.local` rather than `.env`
 * because it is conventionally the personal, gitignored half of the pair, it
 * outranks `.env` so the panel can override a value a team shares, and Vite's
 * default `.env.*` deny already covers it.
 */
export const ENV_TARGET = '.env.local';

/**
 * The files Vite's `loadEnv` reads, **lowest precedence first** — it merges
 * them left to right, so later wins, and `process.env` then overrides them all.
 * Mirrors `getEnvFilesForMode`. The two `development` entries are why a save
 * can be refused: they outrank the file this module writes.
 */
const ENV_FILES = ['.env', '.env.local', '.env.development', '.env.development.local'] as const;

/** Env files that beat {@link ENV_TARGET}, so a key in one cannot be replaced
 *  by writing `.env.local`. */
const ENV_FILES_ABOVE_TARGET: readonly string[] = ['.env.development', '.env.development.local'];

const ENV_VAR = 'UNSPLASH_ACCESS_KEY';

interface StoredSettings {
  /** Legacy. Read for back-compat, never written; stripped on the next key
   *  save. The live key lives in {@link ENV_TARGET}. */
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

/** File contents, or null when it does not exist. Any other read error is a
 *  real problem and propagates. */
async function readIfPresent(target: string): Promise<string | null> {
  try {
    return await readFile(target, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Write the settings file atomically. It holds no secret, so it takes no
 *  mode — but the chmod predates that split and costs nothing to keep, and the
 *  file may still hold a legacy key until the next save strips it. */
async function writeSettingsFile(
  root: string,
  next: StoredSettings,
  writeText: TextWriter = (target, content, _original, mode) => atomicWrite(target, content, mode),
): Promise<void> {
  const target = join(root, SETTINGS_FILE);
  await writeText(target, JSON.stringify(next, null, 2) + '\n', undefined, SECRET_MODE);
  try {
    await chmod(target, SECRET_MODE);
  } catch {
    // Non-POSIX filesystem; the file is written either way.
  }
}

/**
 * Read the access key out of the environment, and say where it came from.
 *
 * `astro dev` does **not** populate `process.env` from `.env` — Astro's env
 * plugin does that only when `isBuild` (`vite-plugin-env.js`: `if (!isBuild ||
 * populated) return`), and Vite has not mutated `process.env` since v2. So a
 * plain `process.env` read sees a `.env` entry *never* in dev. Going through
 * Vite's own `loadEnv` also handles `.env.local`, `.env.[mode]`, quoting and
 * expansion.
 *
 * The order here is not a heuristic: `loadEnv` with an empty prefix copies
 * `process.env` over everything it parsed from files, so an exported variable
 * genuinely does outrank all four files. Checking `process.env` first only
 * makes that visible, so the panel can say the key cannot be changed from a
 * file. The file scan afterwards is cosmetic — it names the winning file, while
 * the *value* always comes from `loadEnv`, quoting and expansion intact.
 *
 * `vite` is imported dynamically rather than declared as a dependency: it
 * resolves from any Astro project, and a static import would make this module
 * unloadable anywhere it doesn't.
 */
async function readEnvKey(
  root: string,
  name: string,
): Promise<{ key: string; origin: 'shell' | 'file' | null; file?: string }> {
  const exported = (process.env[name] ?? '').trim();
  if (exported) return { key: exported, origin: 'shell' };

  let value = '';
  try {
    // Empty prefix: return unprefixed variables too (the default `VITE_` prefix
    // would hide UNSPLASH_ACCESS_KEY entirely).
    value = (loadEnv('development', root, '')[name] ?? '').trim();
  } catch {
    // The project has no readable .env — fall through.
  }
  if (!value) return { key: '', origin: null };

  // Highest-precedence file that declares it, for the panel to name. A literal
  // assignment scan, not a parse: it decides only which label to show.
  const declares = new RegExp(`^\\s*(export\\s+)?${name}\\s*=`);
  for (const file of [...ENV_FILES].reverse()) {
    const raw = await readIfPresent(join(root, file));
    if (raw && raw.split(/\r?\n/).some((line) => declares.test(line))) {
      return { key: value, origin: 'file', file };
    }
  }
  // A value with no file behind it: `loadEnv` also merges `process.env`, and a
  // variable set to whitespace would have been trimmed away above.
  return { key: value, origin: 'file' };
}

export interface ResolvedKey {
  /** Empty when nothing is configured anywhere. */
  key: string;
  source: SettingsSource | null;
  /** Project-relative file the key came from, when it came from one. */
  file?: string;
}

/**
 * Resolve the Unsplash access key, highest precedence first:
 *
 * 1. `unsplash.accessKey` in the Astro config — documented but discouraged;
 *    that file is committed and is read by `astro build`.
 * 2. An exported `UNSPLASH_ACCESS_KEY` — for CI, and impossible to change from
 *    the panel.
 * 3. `UNSPLASH_ACCESS_KEY` in a `.env` file, which is what the panel writes.
 * 4. A legacy key in the settings file, kept working until the next save.
 *
 * Called per request (never captured at config time), so a key entered through
 * the UI works without a dev-server restart.
 */
export async function resolveUnsplashKey(root: string, configKey?: string): Promise<ResolvedKey> {
  if (configKey?.trim()) return { key: configKey.trim(), source: 'config' };

  const env = await readEnvKey(root, ENV_VAR);
  if (env.key) {
    return env.origin === 'shell'
      ? { key: env.key, source: 'env-shell' }
      : { key: env.key, source: 'env-file', ...(env.file ? { file: env.file } : {}) };
  }

  const stored = (await readSettingsFile(root)).unsplash?.accessKey?.trim();
  if (stored) return { key: stored, source: 'file', file: SETTINGS_FILE };

  return { key: '', source: null };
}

/**
 * Whether the panel may change the key, and whether **Clear** would do
 * anything. The server owns this rather than the panel, because the answer
 * turns on *which* env file won — precedence the client has no business
 * carrying a second copy of.
 */
export function keyWritable(resolved: ResolvedKey): {
  writable: boolean;
  clearable: boolean;
  reason?: string;
} {
  const refuse = (reason: string) => ({ writable: false, clearable: false, reason });

  switch (resolved.source) {
    case 'config':
      return refuse(
        'An access key is set in your Astro config, which takes precedence. ' +
          'Remove `unsplash.accessKey` from astro.config.mjs first.',
      );
    case 'env-shell':
      return refuse(
        `${ENV_VAR} is exported in your environment, which overrides every .env ` +
          'file. Unset it in your shell first.',
      );
    case 'env-file':
      if (resolved.file && ENV_FILES_ABOVE_TARGET.includes(resolved.file)) {
        return refuse(
          `An access key in ${resolved.file} takes precedence over ${ENV_TARGET}, ` +
            `which is where this panel saves. Remove it from ${resolved.file} first.`,
        );
      }
      // A key in `.env` can be overridden by writing `.env.local`, but removing
      // a line from `.env.local` cannot unset it — so saving works and clearing
      // does not. A Clear button that leaves the key working is worse than one
      // that says why it cannot.
      return resolved.file === '.env'
        ? {
            writable: true,
            clearable: false,
            reason:
              `An access key is also set in .env. Saving here writes ${ENV_TARGET}, ` +
              'which takes precedence — remove the .env one when you are ready.',
          }
        : { writable: true, clearable: true };
    // A legacy stored key, or nothing configured at all.
    default:
      return { writable: true, clearable: true };
  }
}

/** A legacy key is sitting in the settings file while something else wins, so
 *  the next save has something to clean up and the panel has something to say. */
export async function hasStaleStoredKey(root: string, resolved: ResolvedKey): Promise<boolean> {
  if (resolved.source === 'file') return false;
  return Boolean((await readSettingsFile(root)).unsplash?.accessKey?.trim());
}

export type KeySaveResult =
  | { ok: false; reason: string }
  | { ok: true; file: string; migrated: boolean; staleStoredKey?: true };

/**
 * Store (or, with an empty string, clear) the access key.
 *
 * **Env first, settings file second, always.** The order is the failure model:
 *
 * - The patch is refused → nothing has touched disk, and nothing will.
 * - The `.env.local` write throws → nothing changed. The legacy key, if there
 *   is one, still resolves and the panel repaints unchanged.
 * - The strip throws → the key is in *both* files. `.env.local` outranks the
 *   settings file, so the feature works and what is left behind is a stale
 *   secret rather than a broken save; it is reported as `staleStoredKey`, the
 *   panel nudges, and the next save retries the strip.
 *
 * Stripping first would risk the opposite: a key in neither file.
 */
export async function saveUnsplashKey(
  root: string,
  accessKey: string,
  writeText?: TextWriter,
): Promise<KeySaveResult> {
  const write: TextWriter =
    writeText ?? ((target, content, _original, mode) => atomicWrite(target, content, mode));
  const target = join(root, ENV_TARGET);

  const before = await readIfPresent(target);
  const patched = upsertEnvVar(before ?? '', ENV_VAR, accessKey);
  if (!patched.ok) return { ok: false, reason: patched.reason };

  if (patched.action !== 'unchanged') {
    await write(target, patched.text, before, SECRET_MODE);
  }

  // Migration. Only ever a removal, so a failure here can lose nothing.
  const current = await readSettingsFile(root);
  if (current.unsplash?.accessKey === undefined) return { ok: true, file: ENV_TARGET, migrated: false };

  const { unsplash: _legacy, ...rest } = current;
  try {
    await writeSettingsFile(root, rest, writeText);
  } catch {
    return { ok: true, file: ENV_TARGET, migrated: false, staleStoredKey: true };
  }
  return { ok: true, file: ENV_TARGET, migrated: true };
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

/** Replace the stored option document, leaving anything else in the file alone.
 *  The caller has already merged the panel's sparse patch into `next` — see
 *  `options.ts::applyOptionPatch`. */
export async function saveStoredOptions(root: string, next: StoredOptions, writeText?: TextWriter): Promise<void> {
  const current = await readSettingsFile(root);
  await writeSettingsFile(root, { ...current, options: next }, writeText);
}

/**
 * A **fingerprint** of the key, for recognition only — four hex characters of
 * its SHA-256, behind eight bullets regardless of length, so neither the tail
 * nor the length of the real key leaks.
 *
 * The tail this used to return was four real characters of the resolved key,
 * on every `GET /settings`, and that includes a key the server was never asked
 * to store — one from `astro.config.mjs` or an exported shell variable.
 * `SECURITY.md` counts a fragment of an access key in a response as reportable.
 *
 * A hash keeps the one property the mask exists for: the same key always draws
 * the same four characters, so a user can tell "still the key I saved" from
 * "something else now supplies it". Recognising *which* key by sight was never
 * the job — where a config or shell variable supplies it, the panel names the
 * file.
 */
export function maskKey(key: string): string {
  return '••••••••' + createHash('sha256').update(key).digest('hex').slice(0, 4);
}

/**
 * Which of the files this integration writes are **not** covered by the
 * project's `.gitignore`, in the order the panel should name them.
 *
 * Best-effort and deliberately not a glob engine: it compares whole lines
 * against a list of the patterns projects actually write. Erring toward a false
 * warning is the right direction when the alternative is a committed secret —
 * but only up to a point. `.env*` is what Astro's own starters ship, so
 * treating it as "not covered" would put a permanent, undismissable warning on
 * nearly every real project, and a warning nobody can clear is one everybody
 * learns to ignore.
 *
 * `.env.local` is checked only once it exists, so a project that has never
 * saved a key is not nagged about a file it does not have. The settings file is
 * checked unconditionally: it appears the moment any tab saves an option.
 *
 * This integration cannot edit a consuming project's ignore rules, which is why
 * this reports rather than fixes.
 */
export async function uncoveredSecretFiles(root: string): Promise<string[]> {
  let lines: string[] = [];
  try {
    lines = (await readFile(join(root, '.gitignore'), 'utf8')).split('\n').map((line) => line.trim());
  } catch {
    lines = []; // no .gitignore at all — definitely not covered
  }

  const covered = (file: string, patterns: string[]) =>
    [file, '/' + file, ...patterns].some((pattern) => lines.includes(pattern));

  const uncovered: string[] = [];
  if ((await readIfPresent(join(root, ENV_TARGET))) !== null &&
      !covered(ENV_TARGET, ['.env*', '.env.*', '.env*.local', '*.local'])) {
    uncovered.push(ENV_TARGET);
  }
  if (!covered(SETTINGS_FILE, ['.astro-dev-edit.*', '.astro-*'])) uncovered.push(SETTINGS_FILE);
  return uncovered;
}
