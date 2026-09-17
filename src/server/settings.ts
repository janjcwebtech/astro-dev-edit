import type { TextWriter } from './text-writes.ts';
import { chmod, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StoredOptions } from './options.ts';
import { atomicWrite, SECRET_MODE } from './paths.ts';

/**
 * User settings that live outside the Astro config.
 *
 * `.astro-dev-edit.json` holds the option document the Settings panel writes —
 * ordinary values, in the same vocabulary `astro.config.mjs` uses, so the file
 * reads like the config it supplements and `options.ts` can apply one `read`
 * per option to either source. It is never served over HTTP
 * (`private-files.ts`), but it is a plain JSON file in the project's own tree,
 * so nothing secret may ever be written here.
 *
 * **A class of write of its own.** The file cannot go through
 * `paths.ts::validateEditablePath`, which would block it three ways: `realpath`
 * fails on a file that does not exist yet, a root dotfile is outside
 * `contentRoots`, and `.json` is not an editable extension. It is a **fixed
 * target** — the path is a constant here, never client-supplied — written
 * through the injected `writeText`.
 *
 * Server-side rather than `localStorage` so settings survive a browser data
 * clear, work from any browser, and have a home for future additions.
 */

/** Fixed, never client-supplied. */
export const SETTINGS_FILE = '.astro-dev-edit.json';

interface StoredSettings {
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

/** Write the settings file atomically. It holds no secret, but it is
 *  user-private configuration and the restrictive mode costs nothing. */
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
 * Whether the settings file this integration writes is covered by the project's
 * `.gitignore`, reported as the list of uncovered files the panel should name.
 *
 * Best-effort and deliberately not a glob engine: it compares whole lines
 * against a list of the patterns projects actually write. The file is checked
 * unconditionally — it appears the moment any tab saves an option.
 *
 * This integration cannot edit a consuming project's ignore rules, which is why
 * this reports rather than fixes.
 */
export async function uncoveredSettingsFiles(root: string): Promise<string[]> {
  let lines: string[] = [];
  try {
    lines = (await readFile(join(root, '.gitignore'), 'utf8')).split('\n').map((line) => line.trim());
  } catch {
    lines = []; // no .gitignore at all — definitely not covered
  }
  const covered = [SETTINGS_FILE, '/' + SETTINGS_FILE, '.astro-dev-edit.*', '.astro-*']
    .some((pattern) => lines.includes(pattern));
  return covered ? [] : [SETTINGS_FILE];
}
