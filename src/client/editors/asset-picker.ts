import { entryAssetDir, entryRelativeToWeb, webToEntryRelative } from '../../shared/asset-path.ts';
import { COLOR, FONT, INPUT_STYLE, setFreshSrc, styled, toast } from '../ui.ts';
import { openMediaModal } from './media-modal.ts';

/**
 * `buildImageField` — the entry panel's image form control: a preview, a path
 * input, and a Browse button that opens the shared media modal.
 *
 * Browsing, uploading and searching all live in `media-modal.ts` now; what
 * stays here is what is specific to a *field*. Chiefly the path conversion:
 *
 * Two path universes meet in this file. By default a value is a **web-servable
 * path** (`/images/hero.png`) — the shape a plain `<img src>` needs. With
 * `assetRef: 'relative'` the field instead stores a path relative to its entry
 * file, because it is backed by Astro's `image()` helper (see
 * shared/asset-path.ts). The modal deals only in web paths, so this control is
 * the single place that converts between the two — and the two candidate sets
 * are disjoint, so a field can never be handed a path of the wrong shape.
 */

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
 * Compact image-field control for the entry panel: current-value preview, path
 * input, and a Browse button that opens the media modal. In relative mode this
 * control is the *only* place that converts between the stored entry-relative
 * value and the web path the browser and the modal speak.
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
    borderRadius: '8px', border: `1px solid ${COLOR.control}`,
    background: 'repeating-conic-gradient(#2a2a3a 0% 25%, #202030 0% 50%) 50% / 16px 16px',
  });
  thumbWrap.type = 'button';
  thumbWrap.title = 'Browse images';
  const thumb = styled('img', 'atx-image-field-thumb', {
    width: '100%', height: '100%', objectFit: 'cover', display: 'none',
  });
  thumb.alt = '';
  const thumbEmpty = styled('span', 'atx-image-field-empty', {
    font: '12px system-ui', color: COLOR.muted, pointerEvents: 'none',
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
    flex: '0 0 auto', padding: '6px 10px', borderRadius: '6px', border: `1px solid ${COLOR.control}`,
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

  const showImage = (src: string, fresh = false): void => {
    if (src) {
      // A just-written file may still be inside Vite's brief 404 window, so it
      // gets the retrying loader; the *stored* value stays the clean path.
      if (fresh) setFreshSrc(thumb, src);
      else thumb.src = src;
    } else {
      thumb.removeAttribute('src');
      thumb.style.display = 'none';
      thumbEmpty.style.display = '';
    }
  };
  const set = (next: string, fresh = false): void => {
    value = next;
    pathInput.value = next;
    showImage(previewSrc(next), fresh);
    onChange(next);
  };

  /**
   * Browsing opens the shared media modal rather than an inline list. This is
   * the one place that converts a picked web path back into the stored
   * entry-relative value — the modal deals only in web paths.
   */
  const browseImages = async (): Promise<void> => {
    const dir = relative ? entryAssetDir(entryFile, value) : undefined;
    const pick = await openMediaModal({
      title: 'Choose an image',
      ...(relative ? { assetRef: 'relative' as const } : {}),
      ...(previewSrc(value) ? { currentWebPath: previewSrc(value) } : {}),
      ...(dir ? { scopeDir: dir, targetDir: dir } : {}),
    });
    if (!pick) return; // cancelled — nothing staged, nothing written
    const next = relative ? webToEntryRelative(entryFile, pick.webPath) : pick.webPath;
    if (!next) {
      toast('That image cannot back an image() field — it must live under src/.', 'err');
      return;
    }
    set(next, pick.origin !== 'existing');
  };

  set(initial);

  pathInput.addEventListener('input', () => {
    value = pathInput.value;
    showImage(previewSrc(value));
    onChange(value);
  });

  browse.addEventListener('click', () => void browseImages());
  thumbWrap.addEventListener('click', () => void browseImages());

  return wrap;
}
