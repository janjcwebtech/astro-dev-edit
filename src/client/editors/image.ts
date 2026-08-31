import type { ApplyOp, AssetInfo, AttrState, SourceLoc } from '../../shared/protocol.ts';
import * as api from '../api.ts';
import { clearHighlight } from '../hover.ts';
import * as state from '../state.ts';
import {
  basename,
  buildBackdrop,
  buildPanel,
  lockElement,
  setFreshSrc,
  styled,
  toast,
  wirePanelButtons,
} from '../ui.ts';
import { openMediaModal } from './media-modal.ts';
import { mount } from '../shadow.ts';

/**
 * Image swap panel: a preview of the image as it is now, its alt text, and a
 * way to replace it.
 *
 * It stopped being a browser. Picking from hundreds of project images (or from
 * Unsplash) is the media modal's job; this panel keeps only what belongs to
 * *this* element — the preview, the alt field, and a strip of the few most
 * recently added images for the common "swap in the thing I just uploaded"
 * case, with `Browse all` opening the modal for everything else.
 *
 * Only statically-quoted attributes are patchable; a missing alt can be added.
 * (spec §6.3)
 */

/** How many recent images the quick strip offers before you need the modal. */
const RECENTS = 6;

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

  const panel = buildPanel(`Image · ${basename(src.file)}:${src.loc}`, undefined, {
    width: 'min(520px, 92vw)',
  });
  const body = panel.querySelector('[data-body]') as HTMLElement;

  /** What the panel will save — starts as what the element already has. */
  let chosenSrc = originalSrc;

  // --- preview ---------------------------------------------------------------
  // Shown even when the file cannot be swapped: writing alt text for an image
  // you cannot see is the exact problem this fixes, and the preview is read
  // from the DOM rather than from anything patchable.
  const preview = styled('div', 'atx-image-preview');
  const previewImg = styled('img', 'atx-image-preview-img');
  previewImg.alt = '';
  previewImg.decoding = 'async';
  // A path that fails to load hides rather than showing a broken-image icon;
  // a retry that finally succeeds undoes that — see ui.ts::setFreshSrc.
  previewImg.addEventListener('error', () => previewImg.toggleAttribute('data-hidden', true));
  previewImg.addEventListener('load', () => previewImg.toggleAttribute('data-hidden', false));
  preview.append(previewImg);

  const meta = styled('p', 'atx-image-meta');

  /** `fresh` marks a file written seconds ago, which needs the retrying loader;
   *  `path` is always the clean value the metadata line and the save refer to. */
  const setPreview = (path: string, fresh = false): void => {
    if (fresh) setFreshSrc(previewImg, path);
    else previewImg.src = path;
    meta.textContent = path ? basename(path) : '';
    meta.title = path;
  };
  setPreview(originalSrc);
  body.append(preview, meta);

  if (!srcEditable) {
    const note = styled('p', 'atx-note');
    note.textContent =
      'The image file is set from code (an expression or astro:assets), so it can’t be swapped here — only the alt text can be edited.';
    body.append(note);
  }

  // --- alt text --------------------------------------------------------------
  const altLabel = styled('label', 'atx-alt-label');
  altLabel.textContent = 'Alt text';
  const altInput = styled('input', 'atx-alt-input');
  altInput.value = originalAlt;
  if (!altEditable) {
    altInput.disabled = true;
    altInput.title = 'The alt text is set from an expression — edit it in the source.';
    altInput.toggleAttribute('data-off', true);
  }
  body.append(altLabel, altInput);

  const close = (commit: boolean): void => {
    state.releaseIf(token);
    panel.remove();
    backdrop.remove();
    if (!commit) {
      img.setAttribute('src', originalSrc);
      img.setAttribute('alt', originalAlt);
      return;
    }
    const nextAlt = altInput.value;
    if (chosenSrc === originalSrc && nextAlt === originalAlt) return;
    void commitImageEdit(img, src, { originalSrc, originalAlt, nextSrc: chosenSrc, nextAlt });
  };

  const backdrop = buildBackdrop(() => close(false));
  wirePanelButtons(panel, () => close(false), () => close(true));
  const token = state.begin({ kind: 'panel', close: () => close(false) });
  mount(backdrop, panel);
  altInput.focus();

  // --- replace ---------------------------------------------------------------
  if (!srcEditable) return;

  /** Stage a replacement: preview it here and on the page, but write nothing
   *  until Save. `fresh` marks a file written seconds ago, which needs the
   *  retrying loader to survive Vite's 404 window (see ui.ts::setFreshSrc). */
  const stage = (webPath: string, fresh = false): void => {
    chosenSrc = webPath;
    setPreview(webPath, fresh);
    // Live preview on the page itself.
    if (fresh) setFreshSrc(img, webPath);
    else img.setAttribute('src', webPath);
    paintRecents();
  };

  const strip = styled('div', 'atx-image-recents');
  const stripLabel = styled('div', 'atx-image-recents-label');
  const stripTitle = styled('span', 'atx-image-recents-title');
  stripTitle.textContent = 'Recently added';
  const browseAll = styled('button', 'atx-btn atx-image-browse-all');
  browseAll.type = 'button';
  browseAll.textContent = 'Browse all →';
  browseAll.addEventListener('click', () => void browse());
  stripLabel.append(stripTitle, browseAll);
  body.append(stripLabel, strip);

  let recents: AssetInfo[] = [];
  const openedAt = Date.now();

  function paintRecents(): void {
    strip.textContent = '';
    for (const asset of recents) {
      const current = asset.path === chosenSrc;
      const btn = styled('button', 'atx-image-recent');
      btn.toggleAttribute('data-current', current);
      btn.type = 'button';
      btn.title = asset.path;
      const thumb = styled('img', 'atx-image-recent-thumb');
      // Anything written since this panel opened may still be in Vite's 404
      // window, so it gets the retrying loader; everything else loads normally.
      if (asset.mtime > openedAt) setFreshSrc(thumb, asset.path);
      else thumb.src = asset.path;
      thumb.alt = '';
      thumb.loading = 'lazy';
      thumb.decoding = 'async';
      thumb.addEventListener('error', () => thumb.toggleAttribute('data-hidden', true));
      // A retry that finally succeeds must undo that — see ui.ts::setFreshSrc.
      thumb.addEventListener('load', () => thumb.toggleAttribute('data-hidden', false));
      btn.append(thumb);
      btn.addEventListener('click', () => stage(asset.path));
      strip.append(btn);
    }
  }

  /** Everything beyond the six most recent lives in the modal. */
  async function browse(): Promise<void> {
    const pick = await openMediaModal({
      title: 'Replace image',
      ...(chosenSrc ? { currentWebPath: chosenSrc } : {}),
    });
    if (!pick) return; // cancelled — nothing staged
    stage(pick.webPath, pick.origin !== 'existing');
    // A newly uploaded or imported file belongs at the head of the strip.
    void loadRecents();
  }

  async function loadRecents(): Promise<void> {
    try {
      const files = await api.getAssets();
      // Same rule as the modal's project pane: a plain `<img src>` can only
      // reference paths that exist in the built site.
      recents = files
        .filter((f) => !f.path.startsWith('/src/'))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, RECENTS);
      // The current image's own metadata, now that we have the listing.
      const self = files.find((f) => f.path === chosenSrc);
      if (self) meta.textContent = `${basename(self.path)} · ${formatBytes(self.size)}`;
      paintRecents();
    } catch {
      // The strip is a convenience; the modal's Browse all still works, and it
      // reports its own failure with a Retry.
      stripLabel.toggleAttribute('data-hidden', true);
    }
  }

  void loadRecents();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
