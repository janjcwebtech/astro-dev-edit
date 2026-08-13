import { COLOR, FONT, isolateScroll, setFreshSrc, styled } from '../ui.ts';

/**
 * The tile grid shared by both of the media modal's panes. One builder, two
 * caption modes: a filename for a project asset, a photographer credit for an
 * Unsplash photo.
 *
 * Tile anatomy matters and is easy to get wrong. `atx-media-tile` wraps a
 * `<button>` (the pick target) and the caption as **siblings** — the credit
 * caption contains `<a>` elements, and an anchor nested inside a button is
 * invalid HTML whose click the button would swallow. So a credit link opens the
 * photographer's profile without also selecting the photo.
 *
 * `repeat(auto-fill, minmax(132px, 1fr))` means the column count is correct at
 * any modal width with no media queries and no JS measurement.
 */

export type TileCaption =
  /** A project asset: its filename, full path on hover. */
  | { kind: 'name'; text: string; title?: string }
  /** An Unsplash photo: the attribution the API guidelines require. Both URLs
   *  arrive from the server already carrying the utm params. */
  | { kind: 'credit'; photographer: string; photographerUrl: string; pageUrl: string };

export interface GridTile {
  /** Stable identity — a web path for project assets, the photo id for Unsplash. */
  key: string;
  /** What the `<img>` loads. */
  thumbUrl: string;
  /** Written moments ago, so it may still be inside Vite's brief 404 window
   *  and needs the retrying loader (ui.ts::setFreshSrc). */
  fresh?: boolean;
  /** Average colour, painted behind the thumb so the grid doesn't flash grey. */
  color?: string;
  /** Accessible name for the pick button. */
  label: string;
  caption: TileCaption;
  /** Marks the value the field already holds. */
  current?: boolean;
}

export interface MediaGridHandle {
  /** The scroller, ready to append. */
  el: HTMLElement;
  setTiles(tiles: GridTile[]): void;
  /** Placeholder tiles during a load — sized like real ones, so nothing
   *  reflows when the results land. */
  showSkeletons(count?: number): void;
  /** Replace the grid with a message, optionally offering a retry. */
  showMessage(text: string, retry?: () => void): void;
  /** Currently staged key, or null. */
  selected(): string | null;
  select(key: string | null): void;
  /** Dim one tile and make it inert — an import in flight. Deliberately
   *  per-tile: taking a global busy lock would break the modal's own Escape
   *  and backdrop for the duration of a multi-second download. */
  setTileBusy(key: string, busy: boolean): void;
  /** Append below the grid (the Load more button lives here). */
  footer: HTMLElement;
}

export interface MediaGridOptions {
  /** A click on a tile — stages it. */
  onSelect(key: string | null): void;
  /** Double-click or Enter — the "use this one" shortcut. */
  onCommit(key: string): void;
  /** Shown when `setTiles` receives nothing. */
  emptyText?: string;
}

const TILE_MIN = 132;
const SKELETON_COUNT = 6;

const CHECKER =
  'repeating-conic-gradient(#2a2a3a 0% 25%, #202030 0% 50%) 50% / 12px 12px';

export function buildMediaGrid(opts: MediaGridOptions): MediaGridHandle {
  const el = styled('div', 'atx-media-pane', {
    flex: '1 1 auto', minHeight: '0', overflowY: 'auto', padding: '2px',
  });
  isolateScroll(el);

  const grid = styled('div', 'atx-media-grid', {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, minmax(${TILE_MIN}px, 1fr))`,
    gap: '12px',
    alignContent: 'start',
  });
  const footer = styled('div', 'atx-media-more', {
    display: 'flex', justifyContent: 'center', padding: '14px 0 4px',
  });
  el.append(grid, footer);

  /** key → its pick button, for selection and busy state. */
  const buttons = new Map<string, HTMLButtonElement>();
  let selectedKey: string | null = null;

  const paint = (key: string, on: boolean): void => {
    const btn = buttons.get(key);
    if (!btn) return;
    btn.style.outline = on ? `2px solid ${COLOR.accent}` : '2px solid transparent';
    btn.style.outlineOffset = '2px';
    const badge = btn.querySelector('.atx-media-check') as HTMLElement | null;
    if (badge) badge.style.display = on ? 'flex' : 'none';
  };

  const select = (key: string | null): void => {
    if (selectedKey === key) return;
    if (selectedKey) paint(selectedKey, false);
    selectedKey = key;
    if (key) paint(key, true);
    opts.onSelect(key);
  };

  /** Arrow keys walk the grid. The column count is read from the laid-out
   *  tiles rather than assumed, so it stays right at any modal width. */
  const columns = (): number => {
    const tiles = [...buttons.values()];
    if (tiles.length < 2) return 1;
    const top = tiles[0].getBoundingClientRect().top;
    const inRow = tiles.filter((b) => Math.abs(b.getBoundingClientRect().top - top) < 2);
    return Math.max(1, inRow.length);
  };

  const moveFocus = (from: HTMLButtonElement, delta: number): void => {
    const tiles = [...buttons.values()];
    const at = tiles.indexOf(from);
    const next = tiles[at + delta];
    if (next) next.focus();
  };

  const clearGrid = (): void => {
    grid.textContent = '';
    buttons.clear();
    // The staged key is gone with its tile; tell the caller so the footer's
    // "Use image" button can't act on something no longer on screen.
    if (selectedKey !== null) {
      selectedKey = null;
      opts.onSelect(null);
    }
  };

  const buildTile = (tile: GridTile): HTMLElement => {
    const wrap = styled('div', 'atx-media-tile', { position: 'relative', minWidth: '0' });

    const pick = styled('button', 'atx-media-pick', {
      display: 'block', width: '100%', padding: '0', overflow: 'hidden',
      aspectRatio: '4 / 3', borderRadius: '8px', border: '1px solid #333',
      background: tile.color || CHECKER,
      cursor: 'pointer', outline: '2px solid transparent', outlineOffset: '2px',
      transition: 'outline-color 100ms',
    });
    pick.type = 'button';
    pick.setAttribute('aria-label', tile.label);
    pick.title = tile.label;

    const img = styled('img', 'atx-media-thumb', {
      width: '100%', height: '100%', objectFit: 'cover', display: 'block',
    });
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    // A CSP-blocked, offline or deleted image leaves the tile usable — the
    // caption still reads and the photo can still be picked.
    img.addEventListener('error', () => {
      img.style.display = 'none';
      pick.style.background = CHECKER;
      fallback.style.display = 'flex';
    });
    // A retry that finally succeeds must undo that fallback.
    img.addEventListener('load', () => {
      img.style.display = 'block';
      fallback.style.display = 'none';
    });
    const fallback = styled('span', 'atx-media-fallback', {
      display: 'none', width: '100%', height: '100%', alignItems: 'center',
      justifyContent: 'center', font: '18px system-ui', color: '#666',
    });
    fallback.textContent = '🖼';
    pick.append(img, fallback);
    // Assigned last, so both handlers above are attached before loading starts.
    if (tile.fresh) setFreshSrc(img, tile.thumbUrl);
    else img.src = tile.thumbUrl;

    // Selection badge, hidden until staged.
    const check = styled('span', 'atx-media-check', {
      display: 'none', position: 'absolute', top: '6px', right: '6px',
      width: '20px', height: '20px', borderRadius: '50%', background: COLOR.accent,
      color: '#fff', alignItems: 'center', justifyContent: 'center',
      font: '700 12px system-ui', pointerEvents: 'none',
    });
    check.textContent = '✓';
    pick.append(check);

    if (tile.current) {
      const chip = styled('span', 'atx-media-current', {
        position: 'absolute', top: '6px', left: '6px', padding: '2px 6px',
        borderRadius: '4px', background: 'rgba(0,0,0,0.7)', color: '#ddd',
        font: '600 10px system-ui', pointerEvents: 'none',
      });
      chip.textContent = 'Current';
      pick.append(chip);
    }

    pick.addEventListener('click', () => select(tile.key));
    pick.addEventListener('dblclick', () => {
      select(tile.key);
      opts.onCommit(tile.key);
    });
    pick.addEventListener('keydown', (e) => {
      const cols = columns();
      const moves: Record<string, number> = {
        ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols,
      };
      if (e.key in moves) {
        e.preventDefault();
        moveFocus(pick, moves[e.key]);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        select(tile.key);
        opts.onCommit(tile.key);
      }
    });
    // Focusing a tile stages it, so keyboard and mouse agree on what "current
    // choice" means.
    pick.addEventListener('focus', () => select(tile.key));

    wrap.append(pick, buildCaption(tile.caption));
    buttons.set(tile.key, pick);
    return wrap;
  };

  return {
    el,
    footer,

    setTiles(tiles) {
      clearGrid();
      if (!tiles.length) {
        grid.append(message(opts.emptyText ?? 'Nothing to show.'));
        return;
      }
      for (const tile of tiles) grid.append(buildTile(tile));
    },

    showSkeletons(count = SKELETON_COUNT) {
      clearGrid();
      for (let i = 0; i < count; i++) {
        const wrap = styled('div', 'atx-media-tile atx-media-skeleton', { minWidth: '0' });
        const box = styled('div', 'atx-media-thumb', {
          width: '100%', aspectRatio: '4 / 3', borderRadius: '8px',
          border: '1px solid #2a2a3a', background: '#20202e',
        });
        const bar = styled('div', 'atx-media-cap', {
          height: '10px', margin: '6px 0 0', borderRadius: '3px', background: '#20202e',
        });
        wrap.append(box, bar);
        grid.append(wrap);
      }
    },

    showMessage(text, retry) {
      clearGrid();
      grid.append(message(text, retry));
    },

    selected: () => selectedKey,
    select,

    setTileBusy(key, busy) {
      const btn = buttons.get(key);
      if (!btn) return;
      btn.setAttribute('aria-busy', busy ? 'true' : 'false');
      btn.style.opacity = busy ? '0.45' : '1';
      btn.style.pointerEvents = busy ? 'none' : '';
      btn.style.cursor = busy ? 'progress' : 'pointer';
    },
  };

  /** A full-width row inside the grid — messages must not be laid out as a tile. */
  function message(text: string, retry?: () => void): HTMLElement {
    const box = styled('div', 'atx-media-status', {
      gridColumn: '1 / -1', padding: '28px 12px', textAlign: 'center',
      font: '13px/1.6 system-ui', color: COLOR.muted,
    });
    box.textContent = text;
    if (retry) {
      const btn = styled('button', 'atx-btn atx-btn-retry', {
        display: 'block', margin: '12px auto 0', padding: '5px 12px', borderRadius: '6px',
        border: '1px solid #555', background: 'transparent', color: '#ccc',
        cursor: 'pointer', font: '600 12px system-ui',
      });
      btn.type = 'button';
      btn.textContent = 'Retry';
      btn.addEventListener('click', retry);
      box.append(btn);
    }
    return box;
  }
}

/** The caption sits *outside* the pick button — see the module header. */
function buildCaption(caption: TileCaption): HTMLElement {
  const cap = styled('div', 'atx-media-cap', {
    margin: '6px 2px 0', font: `11px/1.4 ${FONT.mono}`, color: COLOR.muted,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  });

  if (caption.kind === 'name') {
    cap.textContent = caption.text;
    if (caption.title) cap.title = caption.title;
    return cap;
  }

  // Credit is permanently visible rather than revealed on hover: it is what the
  // API guidelines ask for, and there is no stylesheet to hang a hover on.
  cap.style.font = '11px/1.4 system-ui';
  const author = link('atx-unsplash-author', caption.photographer, caption.photographerUrl);
  const source = link('atx-unsplash-link', 'Unsplash', caption.pageUrl);
  cap.append(author, document.createTextNode(' · '), source);
  cap.title = `${caption.photographer} on Unsplash`;
  return cap;
}

function link(className: string, text: string, href: string): HTMLAnchorElement {
  const a = styled('a', `atx-unsplash-credit ${className}`, { color: COLOR.accentText });
  a.href = href;
  a.target = '_blank';
  a.rel = 'noreferrer';
  a.textContent = text;
  // The tile's own click handler must not fire when the credit is clicked.
  a.addEventListener('click', (e) => e.stopPropagation());
  return a;
}
