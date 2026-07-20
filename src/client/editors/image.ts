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
import { buildAssetPicker } from './asset-picker.ts';

/**
 * Image swap panel: edit alt text, upload a new image (drop zone / picker),
 * or pick a replacement from the project's existing assets — with thumbnails.
 * The upload/browse UI is the shared `buildAssetPicker`; this panel adds the
 * alt-text field and live page-image preview on top. Only statically-quoted
 * attributes are patchable; a missing alt can be added. (spec §6.3)
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
  if (!altEditable) {
    altInput.disabled = true;
    altInput.title = 'The alt text is set from an expression — edit it in the source.';
    altInput.style.opacity = '0.5';
  }
  body.append(altLabel, altInput);

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

  // The image file can only be swapped when statically quoted; picking an image
  // (upload or existing) previews it on the page and commits straight away.
  if (srcEditable) {
    const assets = buildAssetPicker({
      listLabel: 'Or replace with an existing image',
      isCurrent: (f) => f === originalSrc,
      onPick: (path) => {
        img.setAttribute('src', path); // live preview
        close(true, path);
      },
    });
    body.append(assets.el);
    assets.loadList();
  }
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
