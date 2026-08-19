import type { AssetInfo, MediaPick } from '../../shared/protocol.ts';
import * as api from '../api.ts';
import { hasUnsplash } from '../features.ts';
import { clearHighlight } from '../hover.ts';
import { icon } from '../icons.ts';
import * as state from '../state.ts';
import {
  COLOR,
  FONT,
  INPUT_STYLE,
  basename,
  buildBackdrop,
  buildPanel,
  buildTabs,
  footButton,
  setFreshSrc,
  setButtonEnabled,
  styled,
  toast,
} from '../ui.ts';
import { buildMediaGrid, type GridTile, type MediaGridHandle } from './media-grid.ts';
import { createUnsplashPane } from './unsplash-pane.ts';

/**
 * The media modal — one picker, four callers, two sources.
 *
 * It **resolves a promise** rather than firing a callback mid-flight, so the
 * caller decides when anything is written: a click stages a tile, the footer
 * commits it, and Cancel/Escape resolve `null` with nothing staged. That is what
 * makes "select a tile and press Escape" leave the working tree untouched.
 *
 * Three things here are easy to get wrong and are load-bearing:
 *
 * 1. **Stacking and the interaction token.** This can open *over* the CMS
 *    drawer, which is `Z+6` and holds the single interaction token. The modal
 *    takes `Z+8` (backdrop `Z+7`) and claims its **own** token, handing it back
 *    on close — the re-claim idiom from `source-popup.ts`. Getting it wrong
 *    closes the drawer out from under the modal and discards unsaved fields.
 * 2. **No global busy lock during an import.** Claiming `state.begin({kind:
 *    'busy'})` would evict the modal's own panel token and break Escape and the
 *    backdrop for the length of a multi-second download. Busy is per-tile.
 * 3. **Cancel means nothing was written.** Uploads and imports do write files —
 *    that is unavoidable, they are how the asset arrives — but the *source
 *    edit* only happens on commit.
 */

export interface MediaModalOptions {
  /** Title-bar text. */
  title?: string;
  /** `'relative'` picks importable `src/` assets for an `image()` field;
   *  omitted picks web-servable ones. The two sets are disjoint. */
  assetRef?: 'relative';
  /** The web path the field already holds, marked with a `Current` chip. */
  currentWebPath?: string;
  /** Root-relative directory the project list opens scoped to. */
  scopeDir?: string;
  /** Root-relative directory uploads and imports are written into. */
  targetDir?: string;
}

/**
 * A source of images inside the modal. The shell owns chrome, selection and the
 * footer; a pane owns its own toolbar, how it fills the grid, what the details
 * rail says, and what committing a staged key means.
 */
export interface MediaPane {
  /**
   * The pane's **toolbar only** — its own controls (filter/sort, or search and
   * orientation). Deliberately not the grid: the grid is one shared instance so
   * selection has a single home, and a DOM node can only live in one parent, so
   * the shell places it below whichever toolbar is showing.
   */
  el: HTMLElement;
  /** Footer commit-button label — "Use image" vs "Import & use". */
  commitLabel: string;
  /** Called the first time the tab is shown. */
  activate(): void;
  /** Fill `into` with details for the staged key (or its empty state). */
  renderRail(into: HTMLElement, key: string | null): void;
  /** Footer count line. */
  status(): string;
  /** Turn a staged key into a pick. Resolves `null` when it failed — the pane
   *  has already told the user why. */
  commit(key: string): Promise<MediaPick | null>;
  dispose(): void;
}

export interface MediaPaneDeps {
  grid: MediaGridHandle;
  /** Where an upload/import should land. */
  targetDir?: string;
  assetRef?: 'relative';
  /** Ask the shell to repaint the footer and rail — after results arrive, a
   *  page is appended, or an error changes what the pane can say. */
  refresh(): void;
}

const RAIL_WIDTH = '280px';
type SortKey = 'newest' | 'name';

export function openMediaModal(opts: MediaModalOptions = {}): Promise<MediaPick | null> {
  clearHighlight();

  const openedAt = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    /** Every exit goes through here exactly once. */
    const finish = (pick: MediaPick | null): void => {
      if (settled) return;
      settled = true;
      projectPane.dispose();
      unsplashPane?.dispose();
      // Hand the slot back to the drawer/panel underneath, not just release it
      // — see state.ts::releaseTo.
      state.releaseTo(token, heldBefore);
      panel.remove();
      backdrop.remove();
      window.removeEventListener('keydown', onKey, true);
      resolve(pick);
    };

    // --- shell ---------------------------------------------------------------
    const panel = buildPanel(opts.title ?? 'Choose an image', undefined, {
      width: 'min(1080px, 94vw)',
      height: 'min(720px, 86vh)',
      layer: 8,
    });
    const body = panel.querySelector('[data-body]') as HTMLElement;
    const foot = panel.querySelector('[data-foot]') as HTMLElement;
    // The body is a column that never scrolls; the grid inside it does.
    Object.assign(body.style, {
      display: 'flex', flexDirection: 'column', gap: '10px', overflow: 'hidden',
    });

    // The backdrop must sit above the drawer this may have opened over, but
    // below the modal itself.
    const backdrop = buildBackdrop(() => finish(null), 7);
    // Captured before claiming, so the drawer underneath gets the slot back.
    const heldBefore = state.get();
    const token = state.begin({ kind: 'panel', close: () => finish(null) });

    // Escape closes the modal ONLY. Captured here rather than left to the
    // global handler so it can never reach the drawer underneath.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      finish(null);
    };
    window.addEventListener('keydown', onKey, true);

    // --- tabs + upload -------------------------------------------------------
    const uploadBtn = styled('button', 'atx-btn atx-media-upload', {
      marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px',
      padding: '6px 12px', borderRadius: '6px', border: '1px solid #555',
      background: 'transparent', color: '#ccc', cursor: 'pointer', font: '600 12px system-ui',
    });
    uploadBtn.type = 'button';
    uploadBtn.append(icon('upload', 13), document.createTextNode('Upload file…'));

    const fileInput = styled('input', 'atx-media-file', { display: 'none' });
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) void uploadFile(file);
    });

    // --- panes ---------------------------------------------------------------
    const paneHost = styled('div', 'atx-media-panes', {
      flex: '1 1 auto', minWidth: '0', minHeight: '0',
      display: 'flex', flexDirection: 'column', gap: '10px',
    });
    const rail = styled('div', 'atx-media-rail', {
      flex: `0 0 ${RAIL_WIDTH}`, width: RAIL_WIDTH, borderLeft: `1px solid ${COLOR.panelDivider}`,
      paddingLeft: '14px', marginLeft: '14px', overflowY: 'auto',
    });
    const content = styled('div', 'atx-media-content', {
      flex: '1 1 auto', minHeight: '0', display: 'flex',
    });
    content.append(paneHost, rail);

    const dropStrip = styled('div', 'atx-media-drop', {
      flex: '0 0 auto', font: `11px ${FONT.mono}`, color: COLOR.muted, textAlign: 'center',
    });

    // `tabsRow` and `toolbarHost` come from buildTabs, below.

    // --- footer --------------------------------------------------------------
    const status = styled('span', 'atx-media-status', {
      marginRight: 'auto', font: '12px system-ui', color: COLOR.muted,
    });
    const cancelBtn = footButton('Cancel', 'cancel', () => finish(null));
    const useBtn = footButton('Use image', 'primary', () => void commitSelection());
    foot.append(status, cancelBtn, useBtn);

    // --- pane construction ---------------------------------------------------
    const grid = buildMediaGrid({
      onSelect: () => refresh(),
      onCommit: () => void commitSelection(),
      emptyText: 'No images found.',
    });

    const paneDeps: MediaPaneDeps = {
      grid,
      ...(opts.targetDir ? { targetDir: opts.targetDir } : {}),
      ...(opts.assetRef ? { assetRef: opts.assetRef } : {}),
      refresh: () => refresh(),
    };

    const projectPane = createProjectPane(paneDeps, opts);
    // A project that never opted in gets a single-source modal — not a tab that
    // errors when clicked, and not a hidden one.
    const unsplashPane = hasUnsplash() ? createUnsplashPane(paneDeps) : null;
    const panes: Array<{ id: string; label: string; pane: MediaPane }> = [
      { id: 'project', label: 'Project', pane: projectPane },
      ...(unsplashPane ? [{ id: 'unsplash', label: 'Unsplash', pane: unsplashPane }] : []),
    ];

    const byId = new Map(panes.map((p) => [p.id, p.pane]));
    const tabs = buildTabs(
      panes.map(({ id, label, pane }) => ({ id, label, pane: pane.el })),
      {
        classPrefix: 'media',
        // A source's first activation is what runs its initial search, so it is
        // deferred until the user actually asks for that tab.
        onActivate: (id: string) => byId.get(id)?.activate(),
        onChange: (id: string) => {
          active = panes.find((p) => p.id === id) ?? active;
          // A selection in one source means nothing in another.
          grid.select(null);
          refresh();
        },
      },
    );
    // The strip's own host is the toolbar slot: only the source's toolbar swaps,
    // while the grid below it stays put.
    tabs.host.style.flex = '0 0 auto';
    tabs.strip.append(uploadBtn);
    let active = panes[0];
    tabs.host.classList.add('atx-media-toolbars');

    body.append(tabs.strip, content, dropStrip, fileInput);
    paneHost.append(tabs.host, grid.el);

    /** Repaint everything that depends on pane state or selection. */
    function refresh(): void {
      const key = grid.selected();
      useBtn.textContent = active.pane.commitLabel;
      setButtonEnabled(useBtn, key !== null);
      status.textContent = active.pane.status();
      rail.textContent = '';
      active.pane.renderRail(rail, key);
      // The project tab's count is the only place the tab label can carry one.
      tabs.setLabel('project', projectCount === null ? 'Project' : `Project · ${projectCount}`);
      dropStrip.textContent = opts.targetDir
        ? `Drop an image anywhere to upload it to ${opts.targetDir}`
        : 'Drop an image anywhere to upload it';
    }

    async function commitSelection(): Promise<void> {
      const key = grid.selected();
      if (key === null) return;
      const pick = await active.pane.commit(key);
      if (pick) finish(pick);
    }

    // --- drag & drop over the whole modal ------------------------------------
    // A dedicated dashed box would eat grid height; the modal itself is the
    // target, with an accent tint while a file is over it.
    const dropOverlay = styled('div', 'atx-media-dropzone', {
      position: 'absolute', inset: '0', display: 'none', zIndex: '2',
      background: 'rgba(97,68,215,0.18)', border: `2px dashed ${COLOR.accent}`,
      borderRadius: '12px', pointerEvents: 'none',
    });
    panel.append(dropOverlay);
    let dragDepth = 0;
    panel.addEventListener('dragenter', (e) => {
      e.preventDefault();
      // Counted, because dragging across child elements fires enter/leave pairs.
      if (++dragDepth === 1) dropOverlay.style.display = '';
    });
    panel.addEventListener('dragover', (e) => e.preventDefault());
    panel.addEventListener('dragleave', () => {
      if (--dragDepth <= 0) {
        dragDepth = 0;
        dropOverlay.style.display = 'none';
      }
    });
    panel.addEventListener('drop', (e) => {
      e.preventDefault();
      dragDepth = 0;
      dropOverlay.style.display = 'none';
      const file = e.dataTransfer?.files?.[0];
      if (file) void uploadFile(file);
    });

    /** Upload is shared by the button and the drop target, and always lands in
     *  the project source — an uploaded file is a project asset by definition. */
    async function uploadFile(file: File): Promise<void> {
      if (!file.type.startsWith('image/')) {
        toast('That is not an image file', 'err');
        return;
      }
      setButtonEnabled(uploadBtn, false);
      uploadBtn.textContent = 'Uploading…';
      try {
        const dataUrl = await new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result));
          fr.onerror = () => rej(fr.error);
          fr.readAsDataURL(file);
        });
        const { webPath } = await api.upload({
          dataUrl,
          filename: file.name,
          ...(opts.assetRef ? { assetRef: opts.assetRef } : {}),
          ...(opts.targetDir ? { targetDir: opts.targetDir } : {}),
        });
        toast(`Uploaded ${basename(webPath)}`, 'ok');
        // Show it immediately, staged and first under Newest — but still only
        // *staged*: the user still has to commit.
        tabs.show('project');
        await projectPane.reload();
        grid.select(webPath);
      } catch (err) {
        toast(`Upload failed — ${err instanceof Error ? err.message : 'unknown error'}`, 'err');
      } finally {
        setButtonEnabled(uploadBtn, true);
        uploadBtn.textContent = '';
        uploadBtn.append(icon('upload', 13), document.createTextNode('Upload file…'));
      }
    }

    // --- project pane --------------------------------------------------------
    let projectCount: number | null = null;

    /** Defined here (rather than in its own module) because the project source
     *  *is* the modal's default: its state is the shell's own. */
    function createProjectPane(
      deps: MediaPaneDeps,
      modal: MediaModalOptions,
    ): MediaPane & { reload(): Promise<void> } {
      const relative = modal.assetRef === 'relative';
      let assets: AssetInfo[] = [];
      let sort: SortKey = 'newest';
      let showAll = false;
      let failure: string | null = null;

      const el = styled('div', 'atx-media-toolbar atx-media-pane-project', {
        display: 'flex', alignItems: 'center', gap: '6px',
      });
      const filterInput = styled('input', 'atx-asset-filter', {
        ...INPUT_STYLE, flex: '1 1 auto', minWidth: '0', font: `12px ${FONT.mono}`,
      });
      filterInput.type = 'search';
      filterInput.placeholder = 'Filter…';
      filterInput.addEventListener('input', () => paint());

      const scopeToggle = styled('button', 'atx-btn atx-asset-scope', {
        flex: '0 0 auto', display: 'none', padding: '6px 10px', borderRadius: '6px',
        border: '1px solid #555', background: 'transparent', color: '#ccc',
        cursor: 'pointer', font: '600 12px system-ui', whiteSpace: 'nowrap',
      });
      scopeToggle.type = 'button';
      scopeToggle.addEventListener('click', () => {
        showAll = !showAll;
        paint();
      });

      const sortSelect = styled('select', 'atx-media-sort', {
        ...INPUT_STYLE, flex: '0 0 auto', width: 'auto', font: '12px system-ui',
      });
      for (const [value, label] of [['newest', 'Newest'], ['name', 'Name']] as const) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        sortSelect.append(option);
      }
      sortSelect.value = sort;
      sortSelect.addEventListener('change', () => {
        sort = sortSelect.value as SortKey;
        paint();
      });

      el.append(filterInput, scopeToggle, sortSelect);

      /** Everything listed that suits this mode. The two modes take disjoint
       *  halves: a plain `<img src>` cannot reference `/src/`, and an `image()`
       *  field can only take `src/`. */
      const suitable = (): AssetInfo[] =>
        assets.filter((a) => a.path.startsWith('/src/') === relative);

      const visible = (): AssetInfo[] => {
        let list = suitable();
        const scope = modal.scopeDir;
        if (scope && !showAll) {
          const scoped = list.filter((a) => a.path.startsWith('/' + scope + '/'));
          // An empty scope would read as "no assets" — widen rather than mislead.
          if (scoped.length) list = scoped;
        }
        const needle = filterInput.value.trim().toLowerCase();
        if (needle) list = list.filter((a) => a.path.toLowerCase().includes(needle));
        return [...list].sort((a, b) =>
          sort === 'newest' ? b.mtime - a.mtime : a.path.localeCompare(b.path),
        );
      };

      const paint = (): void => {
        if (failure) {
          deps.grid.showMessage(failure, () => void load());
          deps.refresh();
          return;
        }
        const scope = modal.scopeDir;
        if (scope) {
          scopeToggle.style.display = '';
          scopeToggle.textContent = showAll ? 'This folder' : 'Show all';
          scopeToggle.title = showAll ? `Show only ${scope}` : `Showing ${scope} — click to list every asset`;
        }
        const list = visible();
        projectCount = suitable().length;
        deps.grid.setTiles(
          list.map(
            (asset): GridTile => ({
              key: asset.path,
              thumbUrl: asset.path,
              // A file written since the modal opened is one this session just
              // created, so it may still be inside Vite's brief 404 window.
              ...(asset.mtime > openedAt ? { fresh: true } : {}),
              label: asset.path,
              current: asset.path === modal.currentWebPath,
              caption: { kind: 'name', text: basename(asset.path), title: asset.path },
            }),
          ),
        );
        deps.refresh();
      };

      const load = async (): Promise<void> => {
        failure = null;
        deps.grid.showSkeletons();
        try {
          assets = await api.getAssets();
        } catch (err) {
          failure = `Could not load the image list: ${err instanceof Error ? err.message : 'unknown error'}`;
        }
        paint();
      };

      return {
        el,
        commitLabel: 'Use image',
        activate: () => void load(),
        reload: load,
        status() {
          if (failure) return '';
          const shown = visible().length;
          const total = suitable().length;
          if (!total) return relative ? 'No importable images under src/' : 'No images in the asset directories';
          return shown === total ? `${total} image${total === 1 ? '' : 's'}` : `${shown} of ${total}`;
        },
        renderRail(into, key) {
          const asset = key === null ? null : suitable().find((a) => a.path === key) ?? null;
          if (!asset) {
            into.append(railEmpty('Select an image to see its details.'));
            return;
          }
          into.append(
            railPreview(asset.path, undefined, asset.mtime > openedAt),
            railTitle(basename(asset.path)),
            railLine('Path', asset.path),
            railLine('Size', formatBytes(asset.size)),
            railLine('Modified', formatWhen(asset.mtime)),
          );
        },
        async commit(key) {
          return { webPath: key, origin: 'existing' };
        },
        dispose() {},
      };
    }

    // Kick off the default pane and paint the chrome.
    projectPane.activate();
    refresh();
    document.body.append(backdrop, panel);

    /** The panel's own token is re-claimed after any `busy` interaction the
     *  panes take, so the modal keeps owning the page's clicks. */
    void token;
  });
}

// --- rail primitives, shared with the Unsplash pane --------------------------

export function railEmpty(text: string): HTMLElement {
  const el = styled('p', 'atx-media-rail-empty', {
    margin: '0', font: '12px/1.6 system-ui', color: COLOR.muted,
  });
  el.textContent = text;
  return el;
}

export function railPreview(src: string, color?: string, fresh = false): HTMLElement {
  const box = styled('div', 'atx-media-rail-preview', {
    width: '100%', aspectRatio: '4 / 3', borderRadius: '8px', overflow: 'hidden',
    border: '1px solid #333', marginBottom: '10px',
    background: color || 'repeating-conic-gradient(#2a2a3a 0% 25%, #202030 0% 50%) 50% / 12px 12px',
  });
  const img = styled('img', 'atx-media-rail-img', {
    width: '100%', height: '100%', objectFit: 'contain', display: 'block',
  });
  img.alt = '';
  img.decoding = 'async';
  img.addEventListener('error', () => (img.style.display = 'none'));
  // A retry that finally succeeds must undo that — see ui.ts::setFreshSrc.
  img.addEventListener('load', () => (img.style.display = 'block'));
  if (fresh) setFreshSrc(img, src);
  else img.src = src;
  box.append(img);
  return box;
}

export function railTitle(text: string): HTMLElement {
  const el = styled('h4', 'atx-media-rail-title', {
    margin: '0 0 8px', font: '600 13px system-ui', color: '#eee',
    overflow: 'hidden', textOverflow: 'ellipsis',
  });
  el.textContent = text;
  el.title = text;
  return el;
}

export function railLine(label: string, value: string): HTMLElement {
  const row = styled('div', 'atx-media-rail-line', { margin: '0 0 6px' });
  const key = styled('span', 'atx-media-rail-key', {
    display: 'block', font: '600 10px system-ui', letterSpacing: '0.04em',
    textTransform: 'uppercase', color: COLOR.muted,
  });
  key.textContent = label;
  const val = styled('span', 'atx-media-rail-value', {
    display: 'block', font: `11px/1.5 ${FONT.mono}`, color: '#ccc', wordBreak: 'break-all',
  });
  val.textContent = value;
  row.append(key, val);
  return row;
}

export function railLink(label: string, text: string, href: string): HTMLElement {
  const row = styled('div', 'atx-media-rail-line', { margin: '0 0 6px' });
  const key = styled('span', 'atx-media-rail-key', {
    display: 'block', font: '600 10px system-ui', letterSpacing: '0.04em',
    textTransform: 'uppercase', color: COLOR.muted,
  });
  key.textContent = label;
  const a = styled('a', 'atx-media-rail-value atx-unsplash-credit', {
    display: 'block', font: '12px/1.5 system-ui', color: COLOR.accentText,
  });
  a.href = href;
  a.target = '_blank';
  a.rel = 'noreferrer';
  a.textContent = text;
  row.append(key, a);
  return row;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Relative for anything recent, absolute once it stops being useful. */
function formatWhen(mtime: number): string {
  const seconds = Math.max(0, (Date.now() - mtime) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)} d ago`;
  return new Date(mtime).toLocaleDateString();
}
