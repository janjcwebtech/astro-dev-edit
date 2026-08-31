import type {
  MediaPick,
  UnsplashImportWidth,
  UnsplashOrientation,
  UnsplashPhoto,
} from '../../shared/protocol.ts';
import {
  UNSPLASH_IMPORT_WIDTHS,
  coerceImportWidth,
  importWidthLabel,
} from '../../shared/unsplash.ts';
import * as api from '../api.ts';
import { UnsplashError } from '../api.ts';
import { unsplashImportWidth } from '../features.ts';
import { icon } from '../icons.ts';
import { createSearchController, type SearchError, type SearchState } from '../unsplash-search.ts';
import { COLOR, FONT, INPUT_STYLE, footButton, styled, toast } from '../ui.ts';
import type { GridTile } from './media-grid.ts';
import {
  railEmpty,
  railLine,
  railLink,
  railPreview,
  railTitle,
  type MediaPane,
  type MediaPaneDeps,
} from './media-modal.ts';
import { openSettingsPanel } from './settings-panel.ts';

/**
 * The modal's Unsplash tab: search controls, results, and the per-tile import.
 *
 * All the sequencing — debounce, paging, discarding a superseded response —
 * lives in the DOM-free `unsplash-search.ts` controller, which is unit-tested.
 * This module is rendering plus the import call.
 *
 * Paging is a **Load more** button rather than infinite scroll, deliberately:
 * the grid is a scroller inside a modal on a host page that may hijack `wheel`,
 * and on a 50-requests-per-hour demo key an accidental fling must not burn five
 * of them.
 */

const ORIENTATIONS: Array<{ value: UnsplashOrientation; label: string }> = [
  { value: 'any', label: 'Any shape' },
  { value: 'landscape', label: 'Landscape' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'squarish', label: 'Square' },
];

/** Turn an api-layer failure into the controller's typed error. */
function toError(err: unknown): SearchError {
  if (err instanceof UnsplashError) {
    return { code: err.code, message: err.message, retryable: err.retryable };
  }
  return {
    code: 'unknown',
    message: err instanceof Error ? err.message : 'Search failed.',
    retryable: true,
  };
}

export function createUnsplashPane(deps: MediaPaneDeps): MediaPane {
  let photos: UnsplashPhoto[] = [];
  let remaining: number | undefined;
  let importing: string | null = null;
  // Starts at the resolved project-wide option and is then this pane's own
  // choice, because the right size belongs to the slot the image goes in, not
  // to the project. Not persisted: the next slot is a different size.
  let width: UnsplashImportWidth = unsplashImportWidth();

  // The pane contributes its toolbar only; the shared grid is placed by the
  // shell (see MediaPane.el).
  const el = styled('div', 'atx-media-toolbar atx-media-pane-unsplash', {
    display: 'flex', alignItems: 'center', gap: '6px',
  });

  const searchWrap = styled('div', 'atx-unsplash-search', {
    flex: '1 1 auto', minWidth: '0', display: 'flex', alignItems: 'center', gap: '6px',
    ...INPUT_STYLE, padding: '4px 8px',
  });
  const glass = icon('search', 13);
  glass.style.opacity = '0.6';
  const searchInput = styled('input', 'atx-unsplash-input', {
    flex: '1 1 auto', minWidth: '0', border: 'none', background: 'transparent',
    color: COLOR.foreground, font: '13px system-ui', outline: 'none',
  });
  searchInput.type = 'search';
  searchInput.placeholder = 'Search Unsplash…';
  searchWrap.append(glass, searchInput);

  const orientSelect = styled('select', 'atx-unsplash-orient', {
    ...INPUT_STYLE, flex: '0 0 auto', width: 'auto', font: '12px system-ui',
  });
  for (const { value, label } of ORIENTATIONS) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    orientSelect.append(option);
  }

  // Width, next to shape: both narrow what a pick will produce, and both are
  // the pane's own state rather than the modal's.
  const widthSelect = styled('select', 'atx-unsplash-width', {
    ...INPUT_STYLE, flex: '0 0 auto', width: 'auto', font: '12px system-ui',
  });
  for (const value of UNSPLASH_IMPORT_WIDTHS) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = importWidthLabel(value);
    widthSelect.append(option);
  }
  widthSelect.value = String(width);
  widthSelect.title = 'Width the chosen photo is downloaded at';
  widthSelect.addEventListener('change', () => {
    width = coerceImportWidth(widthSelect.value) ?? width;
    deps.refresh(); // the rail states the width, so it repaints with it
  });

  el.append(searchWrap, orientSelect, widthSelect);

  // --- the controller --------------------------------------------------------
  const controller = createSearchController({
    search: (req) => api.unsplashSearch(req),
    onState: (next) => render(next),
    toError,
  });

  searchInput.addEventListener('input', () => controller.setQuery(searchInput.value));
  orientSelect.addEventListener('change', () =>
    controller.setOrientation(orientSelect.value as UnsplashOrientation),
  );

  const loadMoreBtn = footButton('Load more', 'outline', () => controller.loadMore());

  function render(next: SearchState): void {
    deps.grid.footer.textContent = '';

    if (next.status === 'idle') {
      photos = [];
      deps.grid.showMessage('Type to search Unsplash. Nothing is requested until you stop typing.');
      deps.refresh();
      return;
    }
    if (next.status === 'loading') {
      photos = [];
      deps.grid.showSkeletons();
      deps.refresh();
      return;
    }
    if (next.status === 'empty') {
      photos = [];
      deps.grid.showMessage(`No photos match “${next.query}”.`);
      deps.refresh();
      return;
    }
    if (next.status === 'error') {
      photos = [];
      renderError(next.error);
      deps.refresh();
      return;
    }

    photos = next.photos;
    remaining = next.remaining;
    deps.grid.setTiles(
      next.photos.map(
        (photo): GridTile => ({
          key: photo.id,
          thumbUrl: photo.thumbUrl,
          color: photo.color,
          label: photo.description || `Photo by ${photo.photographer}`,
          caption: {
            kind: 'credit',
            photographer: photo.photographer,
            photographerUrl: photo.photographerUrl,
            pageUrl: photo.pageUrl,
          },
        }),
      ),
    );

    if (next.page < next.totalPages) {
      loadMoreBtn.textContent = next.loadingMore
        ? 'Loading…'
        : `Load more (${next.photos.length} of ${next.total.toLocaleString()})`;
      loadMoreBtn.disabled = next.loadingMore;
      deps.grid.footer.append(loadMoreBtn);
    }
    if (next.moreError) {
      const line = styled('span', 'atx-media-error', {
        font: '12px system-ui', color: COLOR.warning, marginLeft: '10px',
      });
      line.textContent = next.moreError.message;
      deps.grid.footer.append(line);
    }
    deps.refresh();
  }

  /** An unconfigured key gets a card with a way out, not an error string. */
  function renderError(error: SearchError): void {
    if (error.code === 'unconfigured' || error.code === 'disabled') {
      deps.grid.showMessage('');
      const box = deps.grid.el.querySelector('.atx-media-status') as HTMLElement;
      box.textContent = '';
      const title = styled('p', 'atx-media-error', {
        margin: '0 0 6px', font: '600 13px system-ui', color: COLOR.foreground,
      });
      title.textContent = 'Add an Unsplash access key';
      const detail = styled('p', 'atx-media-error', {
        margin: '0 0 12px', font: '12px/1.6 system-ui', color: COLOR.mutedFg,
      });
      detail.textContent = error.message;
      // Opened above the modal (which is Z+8), and re-runs the search on close
      // so entering a key here lands you straight back in results.
      const open = footButton('Open Settings', 'default', () =>
        // Straight to the Unsplash tab: the user clicked a card about a
        // missing key, so landing them on General would be a detour.
        openSettingsPanel({ tab: 'unsplash', layer: 10, onClose: () => controller.retry() }),
      );
      open.style.margin = '0 auto';
      box.append(title, detail, open);
      return;
    }
    deps.grid.showMessage(
      error.message,
      error.retryable ? () => controller.retry() : undefined,
    );
  }

  const photoFor = (id: string): UnsplashPhoto | undefined => photos.find((p) => p.id === id);

  return {
    el,
    commitLabel: 'Import & use',

    activate() {
      searchInput.focus();
      render(controller.state());
    },

    status() {
      const at = controller.state();
      if (at.status === 'ready') {
        const shown = at.photos.length;
        return `${shown} of ${at.total.toLocaleString()} photos`;
      }
      if (at.status === 'loading') return 'Searching…';
      return '';
    },

    renderRail(into, key) {
      const photo = key === null ? undefined : photoFor(key);
      if (!photo) {
        into.append(railEmpty('Search, then select a photo to see its details.'));
      } else {
        into.append(
          railPreview(photo.thumbUrl, photo.color),
          railTitle(photo.description || `Photo by ${photo.photographer}`),
          railLink('Photographer', photo.photographer, photo.photographerUrl),
          railLink('Source', 'View on Unsplash', photo.pageUrl),
          railLine('Dimensions', `${photo.width} × ${photo.height}`),
          railLine('Downloads at', downloadsAt(photo, width)),
          railLine('Saves as', importFilename(photo)),
        );
      }
      if (remaining !== undefined) {
        const line = styled('p', 'atx-unsplash-rate', {
          margin: '14px 0 0', font: `11px ${FONT.mono}`,
          color: remaining <= 5 ? COLOR.warning : COLOR.mutedFg,
        });
        line.textContent = `${remaining} Unsplash requests left this hour`;
        into.append(line);
      }
    },

    async commit(key) {
      if (importing) return null;
      importing = key;
      // Per-tile busy, never a global lock — see the media-modal header.
      deps.grid.setTileBusy(key, true);
      try {
        const res = await api.unsplashImport({
          id: key,
          width,
          ...(deps.assetRef ? { assetRef: deps.assetRef } : {}),
          ...(deps.targetDir ? { targetDir: deps.targetDir } : {}),
        });
        toast(`Imported ${res.filename}`, 'ok');
        return { webPath: res.webPath, origin: 'unsplash' } satisfies MediaPick;
      } catch (err) {
        const mapped = toError(err);
        toast(`Import failed — ${mapped.message}`, 'err');
        // An expired id means the dev server restarted since the search; the
        // results on screen are all stale, so re-run rather than leave them.
        if (mapped.code === 'expired') controller.retry();
        return null;
      } finally {
        importing = null;
        deps.grid.setTileBusy(key, false);
      }
    },

    dispose() {
      controller.dispose();
    },
  };
}

/** What the chosen width actually means for this photo. `fit=max` only shrinks,
 *  so a photo narrower than the request comes back at its own size — saying
 *  "2400 px" there would be a promise the CDN does not keep. */
function downloadsAt(photo: UnsplashPhoto, width: UnsplashImportWidth): string {
  if (width === 'original') return `${photo.width} px wide (original)`;
  if (photo.width <= width) return `${photo.width} px wide (already smaller)`;
  return `${width} px wide`;
}

/** Mirrors the server's naming so the rail can promise what will land. The
 *  server re-derives it as the authority; this is a preview, not a request. */
function importFilename(photo: UnsplashPhoto): string {
  const stem = slugPreview(photo.description || photo.photographer || 'photo');
  return `unsplash-${stem || 'photo'}-${slugPreview(photo.id)}.jpg`;
}

function slugPreview(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}
