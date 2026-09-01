import { entryAssetDir, entryRelativeToWeb, webToEntryRelative } from '../../shared/asset-path.ts';
import { inputEl, setFreshSrc, styled, toast } from '../ui.ts';
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

  const wrap = styled('div', 'atx-image-field');

  // Preview above the path input; clicking it opens the browse list too.
  const thumbWrap = styled('button', 'atx-image-field-preview');
  thumbWrap.type = 'button';
  thumbWrap.title = 'Browse images';
  const thumb = styled('img', 'atx-image-field-thumb');
  thumb.toggleAttribute('data-hidden', true);
  thumb.alt = '';
  const thumbEmpty = styled('span', 'atx-image-field-empty');
  thumbEmpty.textContent = 'No image — click to browse';
  /** The preview shows exactly one of the two: the image, or the placeholder. */
  const showThumb = (on: boolean): void => {
    thumb.toggleAttribute('data-hidden', !on);
    thumbEmpty.toggleAttribute('data-hidden', on);
  };
  // A path that fails to load falls back to the placeholder, never a broken icon.
  thumb.addEventListener('error', () => showThumb(false));
  thumb.addEventListener('load', () => showThumb(true));
  thumbWrap.append(thumb, thumbEmpty);
  wrap.append(thumbWrap);

  const row = styled('div', 'atx-image-field-row');
  const pathInput = inputEl('input', 'atx-image-field-path');
  const browse = styled('button', 'atx-btn atx-btn-outline atx-image-field-browse');
  browse.type = 'button';
  browse.textContent = 'Browse…';
  row.append(pathInput, browse);
  wrap.append(row);

  // A relative value is meaningless without knowing what it is relative to.
  if (relative) {
    const hint = styled('div', 'atx-image-field-hint');
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
      showThumb(false);
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
