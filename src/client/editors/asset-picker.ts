import * as api from '../api.ts';
import { COLOR, basename, styled, toast } from '../ui.ts';

/**
 * Compact image-field control for the entry panel: current-value preview,
 * upload (drop zone / picker), and a collapsible list of existing assets.
 * Shares the upload/asset-list behavior of the image swap panel (editors/
 * image.ts keeps its own live-<img>-preview wiring for now — extracting the
 * remainder is a follow-up).
 */
export function buildImageField(
  initial: string,
  onChange: (webPath: string) => void,
): HTMLElement {
  let value = initial;

  const wrap = styled('div', 'atx-image-field', { display: 'grid', gap: '6px' });

  const row = styled('div', 'atx-image-field-row', {
    display: 'flex', alignItems: 'center', gap: '8px',
  });
  const thumb = styled('img', 'atx-image-field-thumb', {
    flex: '0 0 auto', width: '56px', height: '40px', objectFit: 'cover',
    borderRadius: '4px', border: '1px solid #333',
    background: 'repeating-conic-gradient(#2a2a3a 0% 25%, #202030 0% 50%) 50% / 12px 12px',
  });
  thumb.alt = '';
  const pathInput = styled('input', 'atx-image-field-path', {
    flex: '1 1 auto', minWidth: '0', padding: '6px 8px', boxSizing: 'border-box',
    border: '1px solid #444', borderRadius: '5px', background: '#111', color: '#fff',
    font: '12px ui-monospace, monospace',
  });
  const browse = styled('button', 'atx-btn atx-image-field-browse', {
    flex: '0 0 auto', padding: '6px 10px', borderRadius: '6px', border: '1px solid #555',
    background: 'transparent', color: '#ccc', cursor: 'pointer', font: '600 12px system-ui',
  });
  browse.type = 'button';
  browse.textContent = 'Browse…';
  row.append(thumb, pathInput, browse);
  wrap.append(row);

  const picker = styled('div', 'atx-image-field-picker', { display: 'none' });

  const drop = styled('label', 'atx-drop', {
    display: 'block', textAlign: 'center', padding: '12px', marginBottom: '8px',
    border: '2px dashed #444', borderRadius: '8px', color: '#aaa', cursor: 'pointer',
    font: '12px system-ui', background: '#141420',
  });
  drop.textContent = 'Drop an image here, or click to choose a file';
  const fileInput = styled('input', 'atx-file-input', { display: 'none' });
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  drop.append(fileInput);

  const list = styled('div', 'atx-asset-list', {
    maxHeight: '160px', overflowY: 'auto', display: 'grid', gap: '4px',
  });
  picker.append(drop, list);
  wrap.append(picker);

  const set = (next: string): void => {
    value = next;
    pathInput.value = next;
    thumb.src = next;
    onChange(next);
  };
  set(initial);

  pathInput.addEventListener('input', () => {
    value = pathInput.value;
    thumb.src = value;
    onChange(value);
  });

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
      set(webPath);
      toast(`Uploaded ${basename(webPath)}`, 'ok');
    } catch (err) {
      toast(`Upload failed — ${err instanceof Error ? err.message : 'unknown error'}`, 'err');
    } finally {
      drop.textContent = 'Drop an image here, or click to choose a file';
    }
  };

  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.style.borderColor = COLOR.accent;
  });
  drop.addEventListener('dragleave', () => (drop.style.borderColor = '#444'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) void handleFile(file);
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void handleFile(file);
  });

  let listLoaded = false;
  const loadList = async (): Promise<void> => {
    list.textContent = 'Loading…';
    let files: string[];
    try {
      // Same rule as the swap panel: only offer paths the built site serves.
      files = (await api.getAssets()).filter((f) => !f.startsWith('/src/'));
    } catch (err) {
      list.textContent = `Could not load image list: ${err instanceof Error ? err.message : 'unknown'}`;
      return;
    }
    list.textContent = '';
    if (!files.length) {
      list.textContent = 'No images found in asset directories.';
      return;
    }
    for (const file of files) {
      const rowBtn = styled('button', 'atx-asset-row', {
        display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left',
        padding: '4px 8px', border: '1px solid #333', borderRadius: '5px',
        background: file === value ? '#2b2b4a' : '#161622', color: '#ddd', cursor: 'pointer',
        font: '12px ui-monospace, monospace', width: '100%', boxSizing: 'border-box',
      });
      rowBtn.type = 'button';
      const t = styled('img', 'atx-asset-thumb', {
        flex: '0 0 auto', width: '56px', height: '36px', objectFit: 'cover',
        borderRadius: '4px', border: '1px solid #333',
      });
      t.src = file;
      t.alt = '';
      t.loading = 'lazy';
      const name = styled('span', 'atx-asset-name', {
        flex: '1 1 auto', minWidth: '0', overflow: 'hidden',
        whiteSpace: 'nowrap', textOverflow: 'ellipsis',
      });
      name.textContent = basename(file);
      name.title = file;
      rowBtn.append(t, name);
      rowBtn.addEventListener('click', () => {
        set(file);
        picker.style.display = 'none';
      });
      list.append(rowBtn);
    }
  };

  browse.addEventListener('click', () => {
    const open = picker.style.display !== 'none';
    picker.style.display = open ? 'none' : 'block';
    if (!open && !listLoaded) {
      listLoaded = true;
      void loadList();
    }
  });

  return wrap;
}
