import type { SourceLoc } from '../shared/protocol.ts';
import { fillWithSource } from './editors/peek.ts';
import { has } from './features.ts';
import { icon } from './icons.ts';
import { basename, footButton, setButtonEnabled, styled } from './ui.ts';

/**
 * The code dock — the docked layout's second destination for a source peek.
 *
 * The same source, rendered by the same loader, in a pane that spans the page
 * column instead of a modal over the middle of it. What changes is not how code
 * is drawn but what kind of thing is showing it: **the dock is chrome, not a
 * modal.** It claims no interaction slot in state.ts, puts up no backdrop, does
 * not trap focus and does not answer Escape — you are meant to keep clicking
 * the page with it open, which is the whole reason it exists.
 *
 * This file is the view. Every number it renders — where the page column
 * starts and ends, how tall the dock is, whether it is folded — is handed to it
 * by layout.ts, which owns that arithmetic and the persistence behind it.
 */

export interface DockDeps {
  /** The edge moved. `commit` is the end of a gesture — the point worth
   *  persisting, rather than every frame of a drag. */
  resize(height: number, commit: boolean): void;
  /** Double-click or Home: hand the height back to the default. */
  reset(): void;
  toggleFold(): void;
}

export interface DockHandle {
  /** Appended to the shadow root at boot; hidden until the layout docks. */
  root: HTMLElement;
  /** Whether the dock is part of the layout at all (docked mode). */
  setActive(on: boolean): void;
  isActive(): boolean;
  /** The page column it spans, and how tall it stands. */
  setBox(box: { left: number; right: number; height: number }): void;
  setOpen(open: boolean): void;
  /** Bounds for the separator's ARIA values — the same clamp the drag obeys. */
  setBounds(min: number, max: number): void;
  /** Render a source loc into the pane. Replaces whatever it was showing. */
  show(src: SourceLoc, openSource: (src: SourceLoc) => void): void;
  /** What it is showing, for carrying a peek across a mode switch. */
  source(): SourceLoc | null;
}

export function createDock(deps: DockDeps): DockHandle {
  const root = styled('section', 'atx-dock', undefined, 'atx-dock');
  root.setAttribute('aria-label', 'Source preview');

  // The top edge is the handle. It overlays the header's top few pixels, which
  // hold nothing — the header's controls are centred in their bar.
  const grip = styled('div', 'atx-dock-grip', undefined, 'atx-dock-grip');
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-orientation', 'horizontal');
  grip.setAttribute('aria-label', 'Resize the source preview');
  grip.tabIndex = 0;
  grip.title = 'Drag to resize · double-click to reset';

  const head = styled('div', 'atx-dock-head');
  const mark = icon('code', 14);
  const title = styled('strong', 'atx-dock-title');
  const loc = styled('span', 'atx-dock-loc');
  const foldButton = styled('button', 'atx-tree-action atx-dock-fold');
  foldButton.type = 'button';
  foldButton.append(icon('chevronDown', 16));
  foldButton.addEventListener('click', () => deps.toggleFold());
  head.append(mark, title, loc);

  /** The height last written by {@link DockHandle.setBox} — the *committed*
   *  one, which is not what the rect says while the transition is still
   *  running. A keyboard nudge has to step from this, or two presses in one
   *  frame both step from the same half-animated number and the second is
   *  swallowed. */
  let standing = 0;
  let current: SourceLoc | null = null;
  let openSource: ((src: SourceLoc) => void) | null = null;
  let openButton: HTMLButtonElement | null = null;
  if (has('openInEditor')) {
    openButton = footButton('Open in editor', 'outline', () => {
      if (current && openSource) openSource(current);
    });
    openButton.classList.add('atx-btn-sm');
    // Live only once there is a file to open: the dock is chrome and stands
    // there empty, and a button that answers nothing reads as broken.
    setButtonEnabled(openButton, false);
    head.append(openButton);
  }
  head.append(foldButton);

  const body = styled('div', 'atx-dock-body');
  const placeholder = styled('div', 'atx-peek-loading');
  placeholder.textContent = 'Pick an element and choose View code.';
  body.append(placeholder);

  root.append(grip, head, body);
  setTitle(null);

  function setTitle(src: SourceLoc | null): void {
    title.textContent = src ? basename(src.file) : 'No file open';
    loc.textContent = src?.loc ? src.loc : '';
    title.title = src?.file ?? '';
    if (openButton) setButtonEnabled(openButton, src !== null);
  }

  // --- The resizable edge ----------------------------------------------------

  grip.addEventListener('pointerdown', event => {
    if (!root.hasAttribute('data-open')) return;
    // Also what stops the drag selecting the page's text under the pointer:
    // pointer capture routes the moves here, but the selection starts on the
    // default action of this very event.
    event.preventDefault();
    grip.setPointerCapture(event.pointerId);
    // A drag must land on the frame it was given, not 170ms later.
    root.toggleAttribute('data-resizing', true);
    const startY = event.clientY;
    const startH = root.getBoundingClientRect().height;
    const move = (e: PointerEvent): void => deps.resize(startH + (startY - e.clientY), false);
    const up = (): void => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      root.toggleAttribute('data-resizing', false);
      deps.resize(root.getBoundingClientRect().height, true);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('dblclick', () => deps.reset());
  // A pointer gesture is not the only way to move an edge. The steps are the
  // ones a separator is expected to answer with; Home is the reset the
  // double-click gives a mouse.
  grip.addEventListener('keydown', event => {
    if (event.key === 'Home') {
      event.preventDefault();
      deps.reset();
      return;
    }
    const step = { ArrowUp: 24, ArrowDown: -24, PageUp: 120, PageDown: -120 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    deps.resize(standing + step, true);
  });

  // --- Handle ---------------------------------------------------------------

  return {
    root,
    setActive(on) {
      root.toggleAttribute('data-on', on);
    },
    isActive: () => root.hasAttribute('data-on'),
    setBox({ left, right, height }) {
      standing = height;
      root.style.left = `${left}px`;
      root.style.right = `${right}px`;
      root.style.height = `${height}px`;
      grip.setAttribute('aria-valuenow', String(Math.round(height)));
    },
    setOpen(open) {
      root.toggleAttribute('data-open', open);
      foldButton.title = open ? 'Collapse the source preview' : 'Expand the source preview';
      foldButton.setAttribute('aria-expanded', String(open));
    },
    setBounds(min, max) {
      grip.setAttribute('aria-valuemin', String(min));
      grip.setAttribute('aria-valuemax', String(max));
    },
    show(src, open) {
      current = src;
      openSource = open;
      setTitle(src);
      const pane = styled('div', 'atx-dock-pane');
      body.replaceChildren(pane);
      // The dock outlives any one request, so a late answer has to be able to
      // tell that the pane it was loading for has already been replaced.
      fillWithSource(pane, src, () => current === src && pane.isConnected);
    },
    source: () => current,
  };
}
