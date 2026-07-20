import * as api from '../api.ts';
import { COLOR, FONT, INPUT_STYLE, basename, styled, toast } from '../ui.ts';

/**
 * Shared image-asset UI for the overlay. `buildAssetPicker` owns the upload
 * drop-zone + existing-asset browser once; `buildImageField` wraps it as the
 * entry panel's compact form control (preview + path input + collapsible
 * picker). The image swap panel (editors/image.ts) consumes the same
 * `buildAssetPicker` primitive, so the upload/list wiring lives in one place.
 */

export interface AssetPickerOptions {
  /** Called when the user uploads a file or clicks an existing asset. The
   *  caller decides what a pick means — set a form value, or live-swap the
   *  page image and commit. */
  onPick: (webPath: string, origin: 'upload' | 'existing') => void;
  /** Rows matching this predicate are highlighted as the current selection,
   *  evaluated whenever the list (re)builds. */
  isCurrent?: (webPath: string) => boolean;
  /** Optional caption shown between the drop zone and the asset list. */
  listLabel?: string;
}

export interface AssetPickerHandle {
  /** Drop zone + existing-asset list, ready to append. */
  el: HTMLElement;
  /** Load (or reload) the existing-asset list. Lazy — the caller decides when
   *  to first show it. */
  loadList(): void;
}

/**
 * Upload drop-zone + existing-asset browser: reads a dropped/chosen file,
 * uploads it, and lists the project's swap-candidate images with thumbnails.
 * Pure DOM + I/O; success routing is the caller's via `onPick`. Error toasts
 * (bad file, failed upload, failed listing with Retry) are handled here.
 */
export function buildAssetPicker(opts: AssetPickerOptions): AssetPickerHandle {
  const el = styled('div', 'atx-asset-picker', { display: 'grid', gap: '8px' });

  const drop = styled('label', 'atx-drop', {
    display: 'block', textAlign: 'center', padding: '14px 12px',
    border: '2px dashed #444', borderRadius: '8px', color: '#aaa', cursor: 'pointer',
    font: '13px system-ui', background: '#141420', transition: 'border-color 120ms, background 120ms',
  });
  drop.textContent = 'Drop an image here, or click to choose a file';
  const fileInput = styled('input', 'atx-file-input', { display: 'none' });
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  drop.append(fileInput);
  el.append(drop);

  if (opts.listLabel) {
    const label = styled('div', 'atx-assets-label', { font: '600 12px system-ui', opacity: '0.8' });
    label.textContent = opts.listLabel;
    el.append(label);
  }

  const list = styled('div', 'atx-asset-list', {
    maxHeight: '200px', overflowY: 'auto', display: 'grid', gap: '4px',
  });
  el.append(list);

  const DROP_IDLE = 'Drop an image here, or click to choose a file';

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
      const { webPath } = await api.upload({ dataUrl, filename: file.name });
      opts.onPick(webPath, 'upload');
    } catch (err) {
      toast(`Upload failed — ${err instanceof Error ? err.message : 'unknown error'}`, 'err');
    } finally {
      drop.textContent = DROP_IDLE;
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

  // Load the existing-images list, surfacing the real error and offering retry.
  const loadList = async (): Promise<void> => {
    list.textContent = 'Loading…';
    let files: string[];
    try {
      // A plain <img src> must reference a path that exists in the built site.
      // Files under /src/ are only served by the dev server — offering them
      // here would produce edits that break in production.
      files = (await api.getAssets()).filter((f) => !f.startsWith('/src/'));
    } catch (err) {
      list.textContent = '';
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

    list.textContent = '';
    if (!files.length) {
      list.textContent = 'No images found in asset directories.';
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

  return { el, loadList: () => void loadList() };
}

/**
 * Compact image-field control for the entry panel: current-value preview,
 * path input, and a collapsible asset picker (upload / browse). Delegates the
 * upload + existing-asset wiring to `buildAssetPicker`; keeps its own thumbnail
 * preview and text path input on top.
 */
export function buildImageField(
  initial: string,
  onChange: (webPath: string) => void,
): HTMLElement {
  let value = initial;

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
    showImage(next);
    onChange(next);
  };

  // Collapsible picker, holding the shared upload/browse UI.
  const picker = styled('div', 'atx-image-field-picker', { display: 'none' });
  const assets = buildAssetPicker({
    isCurrent: (f) => f === value,
    onPick: (path, origin) => {
      set(path);
      if (origin === 'upload') toast(`Uploaded ${basename(path)}`, 'ok');
      else picker.style.display = 'none';
    },
  });
  picker.append(assets.el);
  wrap.append(picker);

  set(initial);

  pathInput.addEventListener('input', () => {
    value = pathInput.value;
    showImage(value);
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
