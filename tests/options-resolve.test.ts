import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyOptionPatch,
  coerceOptionPatch,
  createOptionsResolver,
  DEFAULTS,
  WRITABLE_OPTION_KEYS,
  type StoredOptions,
  type DevEditOptions,
} from '../src/server/options.ts';
import { readStoredOptions, saveStoredOptions, SETTINGS_FILE } from '../src/server/settings.ts';

/**
 * Characterization tests for option resolution — the seam that lets the Settings
 * panel change behaviour without a dev-server restart.
 *
 * The property that matters most: **`astro.config.mjs` always wins.** An option
 * the project set in code must resolve to that value and be reported `locked`,
 * so the panel renders it read-only instead of storing something resolution
 * would silently discard. The mirror property is just as load-bearing: an option
 * the config is *silent* about must stay writable, which is what makes an
 * option reachable from the UI on a fresh project.
 */

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'atx-options-test-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Resolve with the given config, after optionally storing a file layer. */
async function resolve(configOptions: DevEditOptions = {}, stored?: StoredOptions) {
  if (stored) await saveStoredOptions(root, stored);
  return createOptionsResolver({ root, configOptions }).resolve();
}

const describedBy = (described: Awaited<ReturnType<typeof resolve>>['described'], key: string) =>
  described.find((o) => o.key === key)!;

describe('precedence', () => {
  it('falls back to DEFAULTS when neither layer speaks', async () => {
    const { options, described } = await resolve();
    expect(options.contentRoots).toEqual(DEFAULTS.contentRoots);
    expect(options.cssInspector).toBe(true);
    expect(describedBy(described, 'cssInspector').source).toBe('default');
    expect(describedBy(described, 'cssInspector').locked).toBe(false);
  });

  it('takes the stored file layer over DEFAULTS', async () => {
    const { options, described } = await resolve({}, { cssInspector: false });
    expect(options.cssInspector).toBe(false);
    expect(describedBy(described, 'cssInspector').source).toBe('file');
    expect(describedBy(described, 'cssInspector').locked).toBe(false);
  });

  it('takes the config over the stored file layer, and locks it', async () => {
    const { options, described } = await resolve({ cssInspector: true }, { cssInspector: false });
    expect(options.cssInspector).toBe(true);
    const d = describedBy(described, 'cssInspector');
    expect(d.source).toBe('config');
    expect(d.locked).toBe(true);
  });

  it('treats a config `false` as speaking, not as absent', async () => {
    // The distinction the whole `locked` idea rests on: `{...DEFAULTS, ...user}`
    // could not tell these apart, which is why the raw options are passed in.
    const spoken = await resolve({ openInEditor: false });
    expect(describedBy(spoken.described, 'openInEditor').locked).toBe(true);

    const silent = await resolve({});
    expect(describedBy(silent.described, 'openInEditor').locked).toBe(false);
  });

  it('leaves an option the config is silent about writable — the fresh-project case', async () => {
    // Absent from the config, the panel owns the option outright.
    const before = await resolve({});
    expect(before.options.cssInspector).toBe(true);
    expect(describedBy(before.described, 'cssInspector').locked).toBe(false);

    const after = await resolve({}, { cssInspector: false });
    expect(after.options.cssInspector).toBe(false);
    expect(describedBy(after.described, 'cssInspector').value).toBe(false);
    expect(describedBy(after.described, 'cssInspector').source).toBe('file');
  });
});

describe('config-only options', () => {
  it('reports setup options locked and restart-requiring', async () => {
    const { described } = await resolve();
    for (const key of ['enabled', 'sourceAnnotations', 'composition']) {
      const d = describedBy(described, key);
      expect(d.locked).toBe(true);
      expect(d.restartRequired).toBe(true);
    }
  });

  it('never takes them from the stored file, even when present', async () => {
    // Storing `enabled: false` must not be able to lock the user out of the UI
    // that set it; `sourceAnnotations` registers a Vite plugin at config time.
    const { options } = await resolve({}, { enabled: false, sourceAnnotations: 'off', composition: true });
    expect(options.enabled).toBe(true);
    expect(options.sourceAnnotations).toBe('auto');
    expect(options.composition).toBe(false);
  });

  it('keeps them out of the writable key list', () => {
    expect(WRITABLE_OPTION_KEYS).not.toContain('enabled');
    expect(WRITABLE_OPTION_KEYS).not.toContain('sourceAnnotations');
    expect(WRITABLE_OPTION_KEYS).not.toContain('composition');
    expect(WRITABLE_OPTION_KEYS).toContain('cssInspector');
  });
});

describe('degradation', () => {
  it('falls back to config and defaults on a malformed settings file', async () => {
    await writeFile(join(root, SETTINGS_FILE), '{ not json');
    const { options } = await resolve({ uploadDir: 'public/img' });
    expect(options.uploadDir).toBe('public/img');
    expect(options.contentRoots).toEqual(DEFAULTS.contentRoots);
  });

  it('ignores a settings file whose options key is the wrong shape', async () => {
    await writeFile(join(root, SETTINGS_FILE), JSON.stringify({ options: 'nope' }));
    expect(await readStoredOptions(root)).toEqual({});
    const { options } = await resolve();
    expect(options.cssInspector).toBe(true);
  });
});

describe('coerceOptionPatch', () => {
  it('accepts well-typed values', () => {
    const { values, errors } = coerceOptionPatch({
      cssInspector: false,
      uploadDir: '  public/images  ',
      contentRoots: ['src', ' public '],
      revealWriteDelayMs: '250',
    });
    expect(errors).toEqual({});
    expect(values.get('cssInspector')).toBe(false);
    expect(values.get('uploadDir')).toBe('public/images');
    expect(values.get('contentRoots')).toEqual(['src', 'public']);
    expect(values.get('revealWriteDelayMs')).toBe(250);
  });

  it('refuses a cleared field as empty rather than as the wrong type', () => {
    // `collectChanges` sends `null` for an emptied optional field. An option has
    // no absent state, so this is a refusal — with a message about emptiness.
    const { values, errors } = coerceOptionPatch({ uploadDir: null, assetDirs: null });
    expect(values.size).toBe(0);
    expect(errors.uploadDir).toBe('cannot be empty');
    expect(errors.assetDirs).toBe('cannot be empty');
  });

  it('refuses unknown, config-only, mistyped and empty values', () => {
    const { values, errors } = coerceOptionPatch({
      nope: 1,
      enabled: false,
      cssInspector: 'yes',
      uploadDir: '   ',
      contentRoots: [],
    });
    expect(values.size).toBe(0);
    expect(errors.nope).toBe('unknown option');
    expect(errors.enabled).toContain('astro.config.mjs');
    expect(errors.cssInspector).toContain('true or false');
    expect(errors.uploadDir).toContain('empty');
    expect(errors.contentRoots).toContain('at least one');
  });

});

describe('applyOptionPatch', () => {
  const patch = (current: StoredOptions, raw: Record<string, unknown>) =>
    applyOptionPatch(current, coerceOptionPatch(raw).values);

  it('merges rather than replaces', () => {
    const next = patch({ uploadDir: 'public/a', cssInspector: false }, { openInEditor: false });
    expect(next).toEqual({ uploadDir: 'public/a', cssInspector: false, openInEditor: false });
  });

  it('round-trips a toggle through the store, so the next resolve sees it', async () => {
    // The end-to-end property the panel depends on: save, then resolve, with no
    // dev-server restart in between.
    await saveStoredOptions(root, applyOptionPatch({}, coerceOptionPatch({
      cssInspector: false,
      uploadDir: 'public/round-trip',
    }).values));
    const { options } = await resolve();
    expect(options.cssInspector).toBe(false);
    expect(options.uploadDir).toBe('public/round-trip');
  });

  it('does not mutate the document it was given', () => {
    const current: StoredOptions = { uploadDir: 'public/a', cssInspector: true };
    patch(current, { uploadDir: 'public/b' });
    expect(current).toEqual({ uploadDir: 'public/a', cssInspector: true });
  });
});
