import type { ApplyOp, AttrState, SourceLoc } from '../../shared/protocol.ts';
import * as api from '../api.ts';
import { clearHighlight } from '../hover.ts';
import * as state from '../state.ts';
import {
  COLOR,
  basename,
  buildBackdrop,
  buildPanel,
  lockElement,
  styled,
  toast,
  wirePanelButtons,
} from '../ui.ts';

/**
 * Image swap panel: edit alt text, upload a new image (drop zone / picker),
 * or pick a replacement from the project's existing assets — with thumbnails.
 * Only statically-quoted attributes are patchable; a missing alt can be added.
 * (spec §6.3)
 */

export async function beginImageEdit(
  img: HTMLImageElement,
  src: SourceLoc,
  attrs: { src: AttrState; alt: AttrState },
): Promise<void> {
  clearHighlight();
  const originalSrc = img.getAttribute('src') ?? '';
  const originalAlt = img.getAttribute('alt') ?? '';
  // Only statically-quoted attributes can be patched; expression values must be
  // edited in the source. A missing alt can be added (img only). (spec §6.3)
  const srcEditable = attrs.src === 'static';
  const altEditable = attrs.alt !== 'dynamic';

  const panel = buildPanel(`Image · ${basename(src.file)}:${src.loc}`);
  const body = panel.querySelector('[data-body]') as HTMLElement;

  if (!srcEditable) {
    const note = styled('p', 'atx-note', {
      margin: '0 0 12px', font: '12px/1.5 system-ui', color: COLOR.warn,
    });
    note.textContent =
      'The image file is set from code (an expression or astro:assets), so it can’t be swapped here — only the alt text can be edited.';
    body.append(note);
  }

  const altLabel = styled('label', 'atx-alt-label', {
    display: 'block', font: '600 12px system-ui', marginBottom: '4px', opacity: '0.8',
  });
  altLabel.textContent = 'Alt text';
  const altInput = styled('input', 'atx-alt-input', {
    width: '100%', padding: '6px 8px', marginBottom: '12px', boxSizing: 'border-box',
    border: '1px solid #444', borderRadius: '5px', background: '#111', color: '#fff', font: '13px system-ui',
  });
  altInput.value = originalAlt;

  // --- Upload drop-zone / file picker ---
  const drop = styled('label', 'atx-drop', {
    display: 'block', textAlign: 'center', padding: '18px 12px', marginBottom: '14px',
    border: '2px dashed #444', borderRadius: '8px', color: '#aaa', cursor: 'pointer',
    font: '13px system-ui', background: '#141420', transition: 'border-color 120ms, background 120ms',
  });
  drop.textContent = 'Drop an image here, or click to choose a file';
  const fileInput = styled('input', 'atx-file-input', { display: 'none' });
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  drop.append(fileInput);

  const listLabel = styled('div', 'atx-assets-label', {
    font: '600 12px system-ui', marginBottom: '6px', opacity: '0.8',
  });
  listLabel.textContent = 'Or replace with an existing image';

  const list = styled('div', 'atx-asset-list', {
    maxHeight: '200px', overflowY: 'auto', display: 'grid', gap: '4px',
  });
  list.textContent = 'Loading…';

  if (!altEditable) {
    altInput.disabled = true;
    altInput.title = 'The alt text is set from an expression — edit it in the source.';
    altInput.style.opacity = '0.5';
  }

  body.append(altLabel, altInput);
  if (srcEditable) body.append(drop, listLabel, list);

  // Upload handling: read the file, POST it, then commit with the returned path.
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
      img.setAttribute('src', webPath); // live preview
      close(true, webPath);
    } catch (err) {
      drop.textContent = 'Drop an image here, or click to choose a file';
      toast(`Upload failed — ${err instanceof Error ? err.message : 'unknown error'}`, 'err');
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

  const close = (commit: boolean, chosenSrc?: string): void => {
    state.releaseIf(token);
    panel.remove();
    backdrop.remove();
    if (!commit) {
      img.setAttribute('src', originalSrc);
      img.setAttribute('alt', originalAlt);
      return;
    }
    const nextSrc = chosenSrc ?? originalSrc;
    const nextAlt = altInput.value;
    if (nextSrc === originalSrc && nextAlt === originalAlt) return;
    void commitImageEdit(img, src, { originalSrc, originalAlt, nextSrc, nextAlt });
  };

  const backdrop = buildBackdrop(() => close(false));
  wirePanelButtons(panel, () => close(false), () => close(true));
  const token = state.begin({ kind: 'panel', close: () => close(false) });
  document.body.append(backdrop, panel);
  altInput.focus();

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
      const current = file === originalSrc;
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
        background:
          'repeating-conic-gradient(#2a2a3a 0% 25%, #202030 0% 50%) 50% / 12px 12px',
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
      row.addEventListener('click', () => {
        img.setAttribute('src', file); // live preview
        close(true, file);
      });
      list.append(row);
    }
  };

  void loadList();
}

async function commitImageEdit(
  img: HTMLImageElement,
  src: SourceLoc,
  v: { originalSrc: string; originalAlt: string; nextSrc: string; nextAlt: string },
): Promise<void> {
  const busy = state.begin({ kind: 'busy' });
  const release = lockElement(img);
  try {
    img.setAttribute('src', v.nextSrc);
    img.setAttribute('alt', v.nextAlt);
    // One batched apply: the server verifies both attrs and writes once, so a
    // src+alt change can never leave the file half-updated. (spec §6.3)
    const ops: ApplyOp[] = [];
    if (v.nextSrc !== v.originalSrc) {
      ops.push({ targetType: 'src', original: v.originalSrc, newText: v.nextSrc });
    }
    if (v.nextAlt !== v.originalAlt) {
      ops.push({ targetType: 'alt', original: v.originalAlt, newText: v.nextAlt });
    }
    if (ops.length) await api.apply({ file: src.file, loc: src.loc, tag: 'img', ops });
    toast(`Saved — ${basename(src.file)}:${src.loc}`, 'ok');
  } catch (err) {
    img.setAttribute('src', v.originalSrc);
    img.setAttribute('alt', v.originalAlt);
    toast(`Save failed — ${err instanceof Error ? err.message : 'unknown error'}`, 'err');
  } finally {
    release();
    state.releaseIf(busy);
  }
}
