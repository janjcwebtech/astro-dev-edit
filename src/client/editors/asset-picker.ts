import { entryAssetDir, entryRelativeToWeb, webToEntryRelative } from '../../shared/asset-path.ts';
import * as api from '../api.ts';
import { COLOR, FONT, INPUT_STYLE, basename, isolateScroll, styled, toast } from '../ui.ts';

/**
 * Shared image-asset UI for the overlay. `buildAssetPicker` owns the upload
 * drop-zone + existing-asset browser once; `buildImageField` wraps it as the
 * entry panel's compact form control (preview + path input + collapsible
 * picker). The image swap panel (editors/image.ts) consumes the same
 * `buildAssetPicker` primitive, so the upload/list wiring lives in one place.
 *
 * Two path universes meet here. By default a pick is a **web-servable path**
 * (`/images/hero.png`) — the shape a plain `<img src>` needs. With
 * `assetRef: 'relative'` the picker instead deals in importable `src/` assets,
 * because the caller is editing a field backed by Astro's `image()` helper whose
 * values are relative to the entry file (see shared/asset-path.ts). The two sets
 * are disjoint, so a field can never be handed a path of the wrong shape.
 */

export interface AssetPickerOptions {
  /** Called when the user uploads a file or clicks an existing asset. The
   *  caller decides what a pick means — set a form value, or live-swap the
   *  page image and commit. Always a web path; converting is the caller's job. */
  onPick: (webPath: string, origin: 'upload' | 'existing') => void;
  /** Rows matching this predicate are highlighted as the current selection,
   *  evaluated whenever the list (re)builds. */
  isCurrent?: (webPath: string) => boolean;
  /** Optional caption shown between the drop zone and the asset list. */
  listLabel?: string;
  /**
   * `'relative'` lists only importable `src/` assets and marks uploads as
   * backing an `image()` field. Omitted (the default) lists only web-servable
   * assets — files under `/src/` are served in dev but absent from a production
   * build, so offering them would produce edits that break once deployed.
   */
  assetRef?: 'relative';
  /** Root-relative directory the list opens scoped to, with a toggle to widen
   *  to everything. Re-read on each render, so it follows the field's value. */
  scopeDir?: () => string | undefined;
  /** Root-relative directory uploads are written into. Re-read at upload time. */
  uploadTargetDir?: () => string | undefined;
}

export interface AssetPickerHandle {
  /** Drop zone + existing-asset list, ready to append. */
  el: HTMLElement;
  /** Load (or reload) the existing-asset list. Lazy — the caller decides when
   *  to first show it. */
  loadList(): void;
}

const DROP_IDLE = 'Drop an image here, or click to choose a file';

/**
 * Upload drop-zone + existing-asset browser: reads a dropped/chosen file,
 * uploads it, and lists the project's swap-candidate images with thumbnails,
 * narrowed by a text filter and (optionally) scoped to one directory. Pure DOM
 * + I/O; success routing is the caller's via `onPick`. Error toasts (bad file,
 * failed upload, failed listing with Retry) are handled here.
 */
export function buildAssetPicker(opts: AssetPickerOptions): AssetPickerHandle {
  const relative = opts.assetRef === 'relative';
  const el = styled('div', 'atx-asset-picker', { display: 'grid', gap: '8px' });

  const drop = styled('label', 'atx-drop', {
    display: 'block', textAlign: 'center', padding: '14px 12px',
    border: '2px dashed #444', borderRadius: '8px', color: '#aaa', cursor: 'pointer',
    font: '13px system-ui', background: '#141420', transition: 'border-color 120ms, background 120ms',
  });
  const fileInput = styled('input', 'atx-file-input', { display: 'none' });
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  drop.append(fileInput);
  el.append(drop);

  /** Naming the destination matters most in relative mode, where uploads follow
   *  the field's own asset directory rather than one fixed configured dir. */
  const dropIdle = (): string => {
    const dir = opts.uploadTargetDir?.();
    return dir ? `${DROP_IDLE} — saves to ${dir}` : DROP_IDLE;
  };
  const resetDrop = (): void => {
    drop.textContent = dropIdle();
    drop.append(fileInput);
  };
  resetDrop();

  if (opts.listLabel) {
    const label = styled('div', 'atx-assets-label', { font: '600 12px system-ui', opacity: '0.8' });
    label.textContent = opts.listLabel;
    el.append(label);
  }

  // Filter + scope controls. A real project can have hundreds of listable
  // assets, which is unusable as a flat list.
  const controls = styled('div', 'atx-asset-controls', {
    display: 'flex', alignItems: 'center', gap: '6px',
  });
  const filterInput = styled('input', 'atx-asset-filter', {
    ...INPUT_STYLE, flex: '1 1 auto', minWidth: '0', font: `12px ${FONT.mono}`,
  });
  filterInput.type = 'search';
  filterInput.placeholder = 'Filter…';
  const scopeToggle = styled('button', 'atx-btn atx-asset-scope', {
    flex: '0 0 auto', display: 'none', padding: '6px 10px', borderRadius: '6px',
    border: '1px solid #555', background: 'transparent', color: '#ccc',
    cursor: 'pointer', font: '600 12px system-ui', whiteSpace: 'nowrap',
  });
  scopeToggle.type = 'button';
  controls.append(filterInput, scopeToggle);
  el.append(controls);

  const count = styled('div', 'atx-asset-count', {
    font: `11px ${FONT.mono}`, opacity: '0.6',
  });
  el.append(count);

  const list = styled('div', 'atx-asset-list', {
    maxHeight: '200px', overflowY: 'auto', display: 'grid', gap: '4px',
  });
  isolateScroll(list);
  el.append(list);

  /** Everything the server listed that suits this picker's mode. */
  let available: string[] = [];
  let showAll = false;

  // Read the file, POST it, then hand the returned web path to onPick.
  const handleFile = async (file: File): Promise<void> => {
    if (!file.type.startsWith('image/')) {
      toast('That is not an image file', 'err');
      return;
    }
    drop.textContent = 'Uploading…';
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(file);
      });
      const targetDir = opts.uploadTargetDir?.();
      const { webPath } = await api.upload({
        dataUrl,
        filename: file.name,
        ...(relative ? { assetRef: 'relative' as const } : {}),
        ...(targetDir ? { targetDir } : {}),
      });
      opts.onPick(webPath, 'upload');
    } catch (err) {
      toast(`Upload failed — ${err instanceof Error ? err.message : 'unknown error'}`, 'err');
    } finally {
      resetDrop();
    }
  };

  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.style.borderColor = COLOR.accent;
    drop.style.background = '#1c1c33';
  });
  drop.addEventListener('dragleave', () => {
    drop.style.borderColor = '#444';
    drop.style.background = '#141420';
  });
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) void handleFile(file);
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void handleFile(file);
  });

  /** Build the rows for the current filter + scope over `available`. */
  const render = (): void => {
    resetDrop();
    const scope = opts.scopeDir?.();
    const scoped = scope && !showAll
      ? available.filter((f) => f.startsWith('/' + scope + '/'))
      : available;
    // An empty scope would look like "no assets" — widen rather than mislead.
    const base = scope && !showAll && scoped.length === 0 ? available : scoped;
    const needle = filterInput.value.trim().toLowerCase();
    const files = needle ? base.filter((f) => f.toLowerCase().includes(needle)) : base;

    if (scope) {
      scopeToggle.style.display = '';
      scopeToggle.textContent = showAll ? 'This folder' : 'Show all';
      scopeToggle.title = showAll
        ? `Show only ${scope}`
        : `Showing ${scope} — click to list every asset`;
    }
    count.textContent = available.length
      ? `${files.length} of ${available.length}${scope && !showAll ? ` · ${scope}` : ''}`
      : '';

    list.textContent = '';
    if (!files.length) {
      list.textContent = available.length
        ? 'No images match.'
        : relative
          ? 'No importable images found under src/.'
          : 'No images found in asset directories.';
      return;
    }
    for (const file of files) {
      const current = opts.isCurrent?.(file) ?? false;
      const row = styled('button', 'atx-asset-row', {
        display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left',
        padding: '5px 8px', border: '1px solid #333', borderRadius: '5px',
        background: current ? '#2b2b4a' : '#161622', color: '#ddd', cursor: 'pointer',
        font: '12px ui-monospace, monospace', width: '100%', boxSizing: 'border-box',
      });
      row.type = 'button';

      // Thumbnail. The dev server serves the same web path, so we can point an
      // <img> straight at it. A checkerboard placeholder shows through for
      // transparent images; on load failure we swap in a neutral marker.
      const thumb = styled('img', 'atx-asset-thumb', {
        flex: '0 0 auto', width: '70px', height: '50px', objectFit: 'cover',
        borderRadius: '4px', border: '1px solid #333',
        background: 'repeating-conic-gradient(#2a2a3a 0% 25%, #202030 0% 50%) 50% / 12px 12px',
      });
      thumb.src = file;
      thumb.alt = '';
      thumb.loading = 'lazy';
      thumb.decoding = 'async';
      thumb.addEventListener('error', () => {
        thumb.style.display = 'none';
        marker.style.display = 'flex';
      });
      // Fallback tile shown only if the thumbnail fails to load.
      const marker = styled('span', 'atx-asset-marker', {
        display: 'none', flex: '0 0 auto', width: '70px', height: '50px',
        alignItems: 'center', justifyContent: 'center', borderRadius: '4px',
        border: '1px solid #333', background: '#202030', font: '16px system-ui',
      });
      marker.textContent = '🖼';

      const name = styled('span', 'atx-asset-name', {
        flex: '1 1 auto', minWidth: '0', overflow: 'hidden',
        whiteSpace: 'nowrap', textOverflow: 'ellipsis',
      });
      name.textContent = basename(file);
      name.title = file; // full path on hover — the row is otherwise truncated

      row.append(thumb, marker, name);
      row.addEventListener('mouseenter', () => (row.style.background = '#33335a'));
      row.addEventListener('mouseleave', () => (row.style.background = current ? '#2b2b4a' : '#161622'));
      row.addEventListener('click', () => opts.onPick(file, 'existing'));
      list.append(row);
    }
  };

  filterInput.addEventListener('input', render);
  scopeToggle.addEventListener('click', () => {
    showAll = !showAll;
    render();
  });

  // Load the existing-images list, surfacing the real error and offering retry.
  const loadList = async (): Promise<void> => {
    list.textContent = 'Loading…';
    let files: string[];
    try {
      files = await api.getAssets();
    } catch (err) {
      list.textContent = '';
      count.textContent = '';
      const msg = styled('div', 'atx-assets-error', {
        color: COLOR.warn, font: '12px system-ui', marginBottom: '8px',
      });
      msg.textContent = `Could not load image list: ${err instanceof Error ? err.message : 'unknown error'}`;
      const retry = styled('button', 'atx-btn atx-btn-retry', {
        padding: '5px 12px', borderRadius: '6px', border: '1px solid #555',
        background: 'transparent', color: '#ccc', cursor: 'pointer', font: '600 12px system-ui',
      });
      retry.type = 'button';
      retry.textContent = 'Retry';
      retry.addEventListener('click', () => void loadList());
      list.append(msg, retry);
      return;
    }
    // The two modes take disjoint halves of the listing. A plain `<img src>`
    // must reference a path that exists in the built site, so `/src/` files are
    // excluded; an image() field is the exact inverse — only `src/` assets can
    // be imported, and a public/ file would fail the collection's schema.
    available = files.filter((f) => f.startsWith('/src/') === relative);
    render();
  };

  return { el, loadList: () => void loadList() };
}

export interface ImageFieldOptions {
  /** The field's current stored value (a web path, or entry-relative). */
  initial: string;
  /** Called with the new stored value on every change. */
  onChange: (value: string) => void;
  /**
   * Set for a field backed by Astro's `image()` helper: values are paths
   * relative to `entryFile`, so previews resolve through it and picks are
   * converted back into that shape.
   */
  assetRef?: 'relative';
  /** Repo-relative path of the entry being edited. Required for relative mode. */
  entryFile?: string;
}

/**
 * Compact image-field control for the entry panel: current-value preview,
 * path input, and a collapsible asset picker (upload / browse). Delegates the
 * upload + existing-asset wiring to `buildAssetPicker`; keeps its own thumbnail
 * preview and text path input on top.
 *
 * In relative mode this control is the *only* place that converts between the
 * stored entry-relative value and the web path the browser and picker speak.
 */
export function buildImageField(opts: ImageFieldOptions): HTMLElement {
  const { initial, onChange } = opts;
  const entryFile = opts.entryFile ?? '';
  const relative = opts.assetRef === 'relative' && entryFile !== '';
  let value = initial;

  /** The stored value as something an <img> can load. */
  const previewSrc = (raw: string): string =>
    relative ? (entryRelativeToWeb(entryFile, raw) ?? '') : raw;

  const wrap = styled('div', 'atx-image-field', { display: 'grid', gap: '8px' });

  // Preview above the path input; clicking it opens the browse list too.
  const thumbWrap = styled('button', 'atx-image-field-preview', {
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0',
    width: '240px', height: '160px', overflow: 'hidden', cursor: 'pointer',
    borderRadius: '8px', border: '1px solid #333',
    background: 'repeating-conic-gradient(#2a2a3a 0% 25%, #202030 0% 50%) 50% / 16px 16px',
  });
  thumbWrap.type = 'button';
  thumbWrap.title = 'Browse images';
  const thumb = styled('img', 'atx-image-field-thumb', {
    width: '100%', height: '100%', objectFit: 'cover', display: 'none',
  });
  thumb.alt = '';
  const thumbEmpty = styled('span', 'atx-image-field-empty', {
    font: '12px system-ui', color: '#888', pointerEvents: 'none',
  });
  thumbEmpty.textContent = 'No image — click to browse';
  // A path that fails to load falls back to the placeholder, never a broken icon.
  thumb.addEventListener('error', () => {
    thumb.style.display = 'none';
    thumbEmpty.style.display = '';
  });
  thumb.addEventListener('load', () => {
    thumb.style.display = '';
    thumbEmpty.style.display = 'none';
  });
  thumbWrap.append(thumb, thumbEmpty);
  wrap.append(thumbWrap);

  const row = styled('div', 'atx-image-field-row', {
    display: 'flex', alignItems: 'center', gap: '8px',
  });
  const pathInput = styled('input', 'atx-image-field-path', {
    ...INPUT_STYLE, flex: '1 1 auto', minWidth: '0', font: `12px ${FONT.mono}`,
  });
  const browse = styled('button', 'atx-btn atx-image-field-browse', {
    flex: '0 0 auto', padding: '6px 10px', borderRadius: '6px', border: '1px solid #555',
    background: 'transparent', color: '#ccc', cursor: 'pointer', font: '600 12px system-ui',
  });
  browse.type = 'button';
  browse.textContent = 'Browse…';
  row.append(pathInput, browse);
  wrap.append(row);

  // A relative value is meaningless without knowing what it is relative to.
  if (relative) {
    const hint = styled('div', 'atx-image-field-hint', {
      font: `11px ${FONT.mono}`, opacity: '0.6',
    });
    hint.textContent = `relative to ${entryFile}`;
    wrap.append(hint);
  }

  const showImage = (src: string): void => {
    if (src) {
      thumb.src = src;
    } else {
      thumb.removeAttribute('src');
      thumb.style.display = 'none';
      thumbEmpty.style.display = '';
    }
  };
  const set = (next: string): void => {
    value = next;
    pathInput.value = next;
    showImage(previewSrc(next));
    onChange(next);
  };

  // Collapsible picker, holding the shared upload/browse UI.
  const picker = styled('div', 'atx-image-field-picker', { display: 'none' });
  const assets = buildAssetPicker({
    ...(relative ? { assetRef: 'relative' as const } : {}),
    isCurrent: (f) => f === previewSrc(value),
    // Open scoped to the directory this field's asset already lives in, and
    // upload there too, so assets stay grouped the way the project groups them.
    ...(relative
      ? {
          scopeDir: () => entryAssetDir(entryFile, value) ?? undefined,
          uploadTargetDir: () => entryAssetDir(entryFile, value) ?? undefined,
        }
      : {}),
    onPick: (path, origin) => {
      const next = relative ? webToEntryRelative(entryFile, path) : path;
      if (!next) {
        toast('That image cannot back an image() field — it must live under src/.', 'err');
        return;
      }
      set(next);
      if (origin === 'upload') toast(`Uploaded ${basename(path)}`, 'ok');
      else picker.style.display = 'none';
    },
  });
  picker.append(assets.el);
  wrap.append(picker);

  set(initial);

  pathInput.addEventListener('input', () => {
    value = pathInput.value;
    showImage(previewSrc(value));
    onChange(value);
  });

  let listLoaded = false;
  const togglePicker = (): void => {
    const open = picker.style.display !== 'none';
    picker.style.display = open ? 'none' : 'block';
    if (!open && !listLoaded) {
      listLoaded = true;
      assets.loadList();
    }
  };
  browse.addEventListener('click', togglePicker);
  thumbWrap.addEventListener('click', togglePicker);

  return wrap;
}
