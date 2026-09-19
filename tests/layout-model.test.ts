import { describe, expect, it } from 'vitest';
import {
  DOCK_BAR_H,
  DOCK_MIN,
  MIN_PAGE_WIDTH,
  NO_INSET,
  addInsets,
  canDock,
  clampDockHeight,
  dockStrip,
  freeBox,
  pillPlacement,
  sameInset,
} from '../src/client/layout-model.ts';

/**
 * The docked layout's arithmetic.
 *
 * Everything here is what a browser would otherwise be the only witness to: the
 * dock's clamp, how two owners' claims on the viewport add up, and where the
 * hover pill lands once the code dock has taken the bottom of the window. The
 * pieces that need a DOM — the push, the observer, the drag — are driven in the
 * playground; see internal-documentation/VERIFICATION.md.
 */

const inset = (part: Partial<typeof NO_INSET>) => ({ ...NO_INSET, ...part });

describe('clampDockHeight', () => {
  it('leaves a height between the floor and the ceiling alone', () => {
    expect(clampDockHeight(300, 1000)).toBe(300);
  });

  it('stops at the floor when dragged past the bottom', () => {
    expect(clampDockHeight(10, 1000)).toBe(DOCK_MIN);
    expect(clampDockHeight(-400, 1000)).toBe(DOCK_MIN);
  });

  it('stops at 82vh when dragged past the top', () => {
    expect(clampDockHeight(5000, 1000)).toBe(820);
    expect(clampDockHeight(900, 1000)).toBe(820);
  });

  it('rounds to whole pixels, so a drag cannot accumulate a fraction', () => {
    expect(clampDockHeight(300.6, 1000)).toBe(301);
  });

  // The ceiling is clamped against the floor rather than the other way round:
  // in a window shorter than the floor the range would otherwise invert and the
  // dock would come back as 82vh of nothing.
  it('never returns a ceiling below the floor in a tiny window', () => {
    expect(clampDockHeight(500, 100)).toBe(DOCK_MIN);
    expect(clampDockHeight(10, 100)).toBe(DOCK_MIN);
  });
});

describe('dockStrip', () => {
  it('stands its full height open and its header bar folded', () => {
    expect(dockStrip(340, true)).toBe(340);
    expect(dockStrip(340, false)).toBe(DOCK_BAR_H);
  });

  // The fold is not a resize: unfolding has to give the dragged height back,
  // which it can only do if folding never consumed it.
  it('keeps the dragged height across a fold', () => {
    const dragged = 512;
    expect(dockStrip(dragged, false)).toBe(DOCK_BAR_H);
    expect(dockStrip(dragged, true)).toBe(dragged);
  });
});

describe('addInsets', () => {
  it('adds each edge across owners', () => {
    const total = addInsets([inset({ top: 36 }), inset({ left: 330, right: 476, bottom: 340 })]);
    expect(total).toEqual({ top: 36, bottom: 340, left: 330, right: 476 });
  });

  // The admin bar docked to the bottom and the code dock above it both claim
  // the bottom edge, and what has to stay clear is both of them.
  it('sums two claims on the same edge', () => {
    expect(addInsets([inset({ bottom: 36 }), inset({ bottom: 340 })]).bottom).toBe(376);
  });

  it('is the empty inset for no owners', () => {
    expect(addInsets([])).toEqual(NO_INSET);
  });
});

describe('sameInset', () => {
  it('compares every edge', () => {
    expect(sameInset(inset({ top: 1 }), inset({ top: 1 }))).toBe(true);
    expect(sameInset(inset({ top: 1 }), inset({ top: 1, right: 1 }))).toBe(false);
    expect(sameInset(inset({ left: 2 }), inset({ right: 2 }))).toBe(false);
  });
});

describe('freeBox', () => {
  it('is the whole viewport less the chrome, less the keep-clear margin', () => {
    const free = freeBox(inset({ top: 36, bottom: 340, left: 330, right: 476 }),
      { width: 1600, height: 1000 }, 8);
    expect(free).toEqual({ top: 44, left: 338, right: 1116, bottom: 652 });
  });

  it('is the viewport itself when nothing is claimed', () => {
    expect(freeBox(NO_INSET, { width: 800, height: 600 }, 0))
      .toEqual({ top: 0, left: 0, right: 800, bottom: 600 });
  });
});

describe('pillPlacement', () => {
  const size = { width: 260, height: 30 };
  const free = { top: 8, left: 8, right: 992, bottom: 592 };

  it('sits above the element when there is room', () => {
    const at = pillPlacement({ top: 300, bottom: 340, left: 100, right: 400 }, size, free, 8);
    expect(at).toEqual({ top: 262, left: 100 });
  });

  it('drops below the element when there is no room above', () => {
    const at = pillPlacement({ top: 10, bottom: 50, left: 100, right: 400 }, size, free, 8);
    expect(at.top).toBe(58);
  });

  // The acceptance case for the dock: an element low in the page column, with
  // the dock's measured top as the floor. Below would put the pill under the
  // dock, so it flips above the element instead of sliding underneath.
  it('flips above rather than under the code dock', () => {
    const docked = freeBox(inset({ bottom: 340 }), { width: 1000, height: 1000 }, 8);
    const at = pillPlacement({ top: 600, bottom: 640, left: 100, right: 400 }, size, docked, 8);
    expect(at.top).toBe(562);
    expect(at.top + size.height).toBeLessThan(docked.bottom);
  });

  // Nowhere to go: pinned inside the free box rather than drawn under the dock.
  it('stays inside the free box when neither above nor below fits', () => {
    const tight = { top: 8, left: 8, right: 992, bottom: 120 };
    const at = pillPlacement({ top: 20, bottom: 110, left: 100, right: 400 }, size, tight, 8);
    expect(at.top).toBeGreaterThanOrEqual(tight.top);
    expect(at.top + size.height).toBeLessThanOrEqual(tight.bottom);
  });

  it('clamps horizontally into the free box on both sides', () => {
    const at = pillPlacement({ top: 300, bottom: 340, left: 900, right: 990 }, size, free, 8);
    expect(at.left).toBe(free.right - size.width);
    expect(pillPlacement({ top: 300, bottom: 340, left: -40, right: 90 }, size, free, 8).left)
      .toBe(free.left);
  });
});

describe('canDock', () => {
  it('needs the page column to stay a page', () => {
    expect(canDock(1600, 330, 476)).toBe(true);
    expect(canDock(900, 330, 476)).toBe(false);
  });

  it('is exact at the boundary', () => {
    expect(canDock(MIN_PAGE_WIDTH + 100, 50, 50)).toBe(true);
    expect(canDock(MIN_PAGE_WIDTH + 99, 50, 50)).toBe(false);
  });

  // Which panels are open is part of the answer: closing the tree can be what
  // makes a window wide enough to dock.
  it('is answered against the panels that are actually open', () => {
    expect(canDock(1000, 330, 476)).toBe(false);
    expect(canDock(1000, 0, 476)).toBe(true);
  });
});
