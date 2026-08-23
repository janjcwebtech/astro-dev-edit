import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EntryEditorOptions } from '../src/server/content-config.ts';
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
 * the config is *silent* about must stay writable, which is what makes
 * `unsplash: {}` reachable from the UI on a fresh project.
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
    expect(options.unsplash).toBe(false);
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
    // `unsplash: {}` is exactly what the old Settings panel told users to add to
    // astro.config.mjs by hand. Absent from the config, the panel owns it.
    const before = await resolve({});
    expect(before.options.unsplash).toBe(false);
    expect(describedBy(before.described, 'unsplashEnabled').locked).toBe(false);

    const after = await resolve({}, { unsplashEnabled: true });
    expect(after.options.unsplash).not.toBe(false);
    expect(describedBy(after.described, 'unsplashEnabled').value).toBe(true);
    expect(describedBy(after.described, 'unsplashEnabled').source).toBe('file');
  });
});

describe('config-only options', () => {
  it('reports enabled and sourceAnnotations locked and restart-requiring', async () => {
    const { described } = await resolve();
    for (const key of ['enabled', 'sourceAnnotations']) {
      const d = describedBy(described, key);
      expect(d.locked).toBe(true);
      expect(d.restartRequired).toBe(true);
    }
  });

  it('never takes them from the stored file, even when present', async () => {
    // Storing `enabled: false` must not be able to lock the user out of the UI
    // that set it; `sourceAnnotations` registers a Vite plugin at config time.
    const { options } = await resolve({}, { enabled: false, sourceAnnotations: 'off' });
    expect(options.enabled).toBe(true);
    expect(options.sourceAnnotations).toBe('auto');
  });

  it('keeps them out of the writable key list', () => {
    expect(WRITABLE_OPTION_KEYS).not.toContain('enabled');
    expect(WRITABLE_OPTION_KEYS).not.toContain('sourceAnnotations');
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

describe('entryEditor merging', () => {
  it('merges collections per field, config leaf winning', async () => {
    const { options } = await resolve(
      { entryEditor: { collections: { blog: { fields: { excerpt: { widget: 'textarea' } } } } } },
      {
        entryEditorEnabled: true,
        entryEditor: {
          collections: {
            blog: { fields: { excerpt: { widget: 'text' }, title: { label: 'Headline' } } },
            notes: { dir: 'src/data/notes' },
          },
        },
      },
    );
    expect(options.entryEditor).not.toBe(false);
    const ee = options.entryEditor as Exclude<typeof options.entryEditor, false>;
    // The config's widget wins where it speaks...
    expect(ee.collections!.blog.fields!.excerpt.widget).toBe('textarea');
    // ...while a field only the panel knows about survives...
    expect(ee.collections!.blog.fields!.title.label).toBe('Headline');
    // ...as does a whole collection only the panel added.
    expect(ee.collections!.notes.dir).toBe('src/data/notes');
  });

  it('drops the merged detail when the feature resolves off', async () => {
    const { options } = await resolve(
      { entryEditor: false },
      { entryEditorEnabled: true, entryEditor: { collections: {} } },
    );
    expect(options.entryEditor).toBe(false);
  });
});

describe('coerceOptionPatch', () => {
  it('accepts well-typed values', () => {
    const { values, errors } = coerceOptionPatch({
      cssInspector: false,
      uploadDir: '  public/images  ',
      contentRoots: ['src', ' public '],
      unsplashPerPage: '12',
    });
    expect(errors).toEqual({});
    expect(values.get('cssInspector')).toBe(false);
    expect(values.get('uploadDir')).toBe('public/images');
    expect(values.get('contentRoots')).toEqual(['src', 'public']);
    expect(values.get('unsplashPerPage')).toBe(12);
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

  it('orders values by the option table, so a toggle precedes what it gates', () => {
    // JSON key order puts the sub-option first; the patch must still apply the
    // toggle first, or the sub-option would be dropped as "feature is off".
    const { values } = coerceOptionPatch({ unsplashAppName: 'my app', unsplashEnabled: true });
    expect([...values.keys()]).toEqual(['unsplashEnabled', 'unsplashAppName']);
  });
});

describe('applyOptionPatch', () => {
  const patch = (current: StoredOptions, raw: Record<string, unknown>) =>
    applyOptionPatch(current, coerceOptionPatch(raw).values);

  it('merges rather than replaces', () => {
    const next = patch({ uploadDir: 'public/a', cssInspector: false }, { openInEditor: false });
    expect(next).toEqual({ uploadDir: 'public/a', cssInspector: false, openInEditor: false });
  });

  it('turns the unsplash feature on and off without losing its sub-options', () => {
    const on = patch({}, { unsplashEnabled: true, unsplashAppName: 'my app' });
    expect(on.unsplashEnabled).toBe(true);
    expect(on.unsplash).toEqual({ appName: 'my app' });

    const off = patch(on, { unsplashEnabled: false });
    expect(off.unsplashEnabled).toBe(false);
    // The detail survives the toggle — that is what `StoredOptions` is for.
    expect(off.unsplash).toEqual({ appName: 'my app' });

    const again = patch(off, { unsplashEnabled: true });
    expect(again.unsplashEnabled).toBe(true);
    expect(again.unsplash).toEqual({ appName: 'my app' });
  });

  it('keeps entryEditor collections across an off/on cycle', () => {
    const detail: EntryEditorOptions = {
      collections: { blog: { fields: { excerpt: { widget: 'textarea' } } } },
    };
    const configured: StoredOptions = { entryEditorEnabled: true, entryEditor: detail };
    const off = patch(configured, { entryEditor: false });
    expect(off.entryEditorEnabled).toBe(false);
    expect(off.entryEditor).toEqual(detail);
    const on = patch(off, { entryEditor: true });
    expect(on.entryEditorEnabled).toBe(true);
    expect(on.entryEditor).toEqual(detail);
  });

  it('round-trips a toggle through the store, so the next resolve sees it', async () => {
    // The end-to-end property the panel depends on: save, then resolve, with no
    // dev-server restart in between.
    await saveStoredOptions(root, applyOptionPatch({}, coerceOptionPatch({
      unsplashEnabled: true,
      unsplashAppName: 'round trip',
    }).values));
    const { options } = await resolve();
    expect(options.unsplash).toEqual({ appName: 'round trip', perPage: 20 });
  });

  it('never persists the access key through the option path', () => {
    // The secret has exactly one home — the document's top-level `unsplash`
    // compartment, written only by `saveUnsplashKey`.
    const next = applyOptionPatch(
      { unsplashEnabled: true, unsplash: { accessKey: 'leaked', appName: 'old' } },
      coerceOptionPatch({ unsplashAppName: 'new' }).values,
    );
    expect(next.unsplash).toEqual({ appName: 'new' });
    expect(JSON.stringify(next)).not.toContain('leaked');
  });

  it('does not mutate the document it was given', () => {
    const current: StoredOptions = { unsplash: { accessKey: 'k', appName: 'old' } };
    patch(current, { unsplashAppName: 'new' });
    expect(current.unsplash).toEqual({ accessKey: 'k', appName: 'old' });
  });
});
