import { isolateScroll, setFreshSrc, styled } from '../ui.ts';
import { icon } from '../icons.ts';

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
  /**
   * Why this tile cannot be picked *here*. Shown on the tile and as its title,
   * and the pick button goes inert.
   *
   * Disabled rather than hidden on purpose: an asset dir listing that quietly
   * drops half its files reads as "you have no images" when the real answer is
   * "not this one, and here is why" — the stance the collection designer takes
   * with a disabled field type. (issue #9)
   */
  disabledReason?: string;
  /** The long form of that reason, for the tile's title. The band on the tile
   *  is a few words over a thumbnail; the whole sentence belongs on hover. */
  disabledTitle?: string;
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

/** How many placeholder tiles a loading grid shows. The tile's own minimum
 *  width lives in styles.ts, where the grid template that uses it is. */
const SKELETON_COUNT = 6;

export function buildMediaGrid(opts: MediaGridOptions): MediaGridHandle {
  const el = styled('div', 'atx-media-pane');
  isolateScroll(el);

  const grid = styled('div', 'atx-media-grid');
  const footer = styled('div', 'atx-media-more');
  el.append(grid, footer);

  /** key → its pick button, for selection and busy state. */
  const buttons = new Map<string, HTMLButtonElement>();
  let selectedKey: string | null = null;

  const paint = (key: string, on: boolean): void => {
    const btn = buttons.get(key);
    if (!btn) return;
    // The ring and the tick are the same state, so one flag drives both.
    btn.toggleAttribute('data-selected', on);
  };

  const select = (key: string | null): void => {
    if (selectedKey === key) return;
    if (selectedKey) paint(selectedKey, false);
    selectedKey = key;
    if (key) paint(key, true);
    opts.onSelect(key);
  };

  /** Arrow keys walk the grid. The column count is read from the laid-out
   *  tiles rather than assumed, so it stays right at any modal width. A
   *  disabled tile still counts, or the geometry the count describes would be
   *  the wrong grid. */
  const columns = (): number => {
    const tiles = [...buttons.values()];
    if (tiles.length < 2) return 1;
    const top = tiles[0].getBoundingClientRect().top;
    const inRow = tiles.filter((b) => Math.abs(b.getBoundingClientRect().top - top) < 2);
    return Math.max(1, inRow.length);
  };

  const moveFocus = (from: HTMLButtonElement, delta: number): void => {
    const tiles = [...buttons.values()];
    // Step past anything inert — a disabled tile cannot take focus, so landing
    // on one would strand the keyboard where the mouse can still go.
    const step = delta > 0 ? 1 : -1;
    let at = tiles.indexOf(from) + delta;
    while (tiles[at]?.disabled) at += step;
    const next = tiles[at];
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
    const wrap = styled('div', 'atx-media-tile');

    const pick = styled('button', 'atx-media-pick');
    // An Unsplash tile carries the photo's own average colour, so the tile is
    // never a grey hole while the thumbnail loads. Everything else falls back
    // to the checkerboard the class already paints.
    if (tile.color) pick.style.background = tile.color;
    pick.type = 'button';
    pick.setAttribute('aria-label', tile.label);
    pick.title = tile.label;

    const img = styled('img', 'atx-media-thumb');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    // A CSP-blocked, offline or deleted image leaves the tile usable — the
    // caption still reads and the photo can still be picked.
    img.addEventListener('error', () => {
      img.toggleAttribute('data-hidden', true);
      pick.style.background = ''; // back to the class's checkerboard
      fallback.toggleAttribute('data-on', true);
    });
    // A retry that finally succeeds must undo that fallback.
    img.addEventListener('load', () => {
      img.toggleAttribute('data-hidden', false);
      fallback.toggleAttribute('data-on', false);
    });
    const fallback = styled('span', 'atx-media-fallback');
    fallback.append(icon('image', 20));
    pick.append(img, fallback);
    // Assigned last, so both handlers above are attached before loading starts.
    if (tile.fresh) setFreshSrc(img, tile.thumbUrl);
    else img.src = tile.thumbUrl;

    // Selection badge, hidden until staged.
    const check = styled('span', 'atx-media-check');
    check.append(icon('check', 14));
    pick.append(check);

    if (tile.current) {
      const chip = styled('span', 'atx-media-current');
      chip.textContent = 'Current';
      pick.append(chip);
    }

    if (tile.disabledReason) {
      wrap.toggleAttribute('data-off', true);
      pick.disabled = true;
      // The reason replaces the label as the title: "why can't I click this"
      // is the only question a dimmed tile raises.
      pick.title = tile.disabledTitle ?? tile.disabledReason;
      pick.setAttribute(
        'aria-label',
        `${tile.label} — ${tile.disabledTitle ?? tile.disabledReason}`,
      );
      const note = styled('span', 'atx-media-reason');
      note.textContent = tile.disabledReason;
      pick.append(note);
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
        const wrap = styled('div', 'atx-media-tile atx-media-skeleton');
        const box = styled('div', 'atx-media-skeleton-thumb');
        const bar = styled('div', 'atx-media-skeleton-cap');
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
      // aria-busy is both the accessible state and the style hook; the tile
      // dims, stops taking clicks and says so with its cursor.
      btn.setAttribute('aria-busy', busy ? 'true' : 'false');
    },
  };

  /** A full-width row inside the grid — messages must not be laid out as a tile. */
  function message(text: string, retry?: () => void): HTMLElement {
    const box = styled('div', 'atx-media-status');
    box.textContent = text;
    if (retry) {
      const btn = styled('button', 'atx-btn atx-btn-outline atx-btn-retry');
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
  const cap = styled('div', 'atx-media-cap');

  if (caption.kind === 'name') {
    cap.textContent = caption.text;
    if (caption.title) cap.title = caption.title;
    return cap;
  }

  // Credit is permanently visible rather than revealed on hover: it is what the
  // API guidelines ask for, and there is no stylesheet to hang a hover on.
  cap.dataset.credit = '';
  const author = link('atx-unsplash-author', caption.photographer, caption.photographerUrl);
  const source = link('atx-unsplash-link', 'Unsplash', caption.pageUrl);
  cap.append(author, document.createTextNode(' · '), source);
  cap.title = `${caption.photographer} on Unsplash`;
  return cap;
}

function link(className: string, text: string, href: string): HTMLAnchorElement {
  const a = styled('a', `atx-unsplash-credit ${className}`);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noreferrer';
  a.textContent = text;
  // The tile's own click handler must not fire when the credit is clicked.
  a.addEventListener('click', (e) => e.stopPropagation());
  return a;
}
