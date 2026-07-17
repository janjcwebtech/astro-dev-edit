/**
 * astro-text-edit overlay — injected browser client (composition root).
 *
 * Edit mode gives you a hover highlight, and clicking routes by classification.
 * The DOM-side guess is only a hover hint: every click is confirmed against the
 * server's AST-truth /classify before an editor opens (a resolved {expression}
 * looks identical to literal text in the DOM). (spec §7.3, §16.1)
 *   - literal text  → inline contenteditable (editors/text.ts)
 *   - image         → swap panel (editors/image.ts)
 *   - dynamic/other → a refusal notice with "Open source" (editors/notice.ts)
 * Commits POST /apply, which verifies the source still matches what the client
 * saw and patches the file atomically. Astro HMR then reloads the page from
 * disk; edit mode survives the reload via sessionStorage.
 *
 * This module only wires the pieces together: source-map capture, hover,
 * click routing, the edit-mode toggle, and boot. Vanilla TS, no framework,
 * no dependencies. (spec §4.2)
 */

import type { SourceLoc } from '../shared/protocol.ts';
import * as api from './api.ts';
import { clearHighlight, initHover } from './hover.ts';
import { initRouter } from './router.ts';
import { cacheSourceMappings, startCapture } from './source-map.ts';
import * as state from './state.ts';
import { COLOR, FONT, Z, basename, styled, toast } from './ui.ts';

// Begin capturing source annotations as early as possible. If the body isn't
// parsed yet, wait for it; the observer then catches every annotated node as
// it arrives. This must run synchronously at module evaluation to win the
// dev-toolbar attribute-strip race — see source-map.ts.
if (document.body) {
  startCapture();
} else {
  document.addEventListener('DOMContentLoaded', startCapture, { once: true });
}

// ---------------------------------------------------------------------------
// Edit-mode toggle
// ---------------------------------------------------------------------------

let editMode = false;

const toggle = styled('button', 'atx-toggle', {
  position: 'fixed',
  // Offset up from the bottom so it clears Astro's dev toolbar bar. (spec §4.2)
  right: '16px',
  bottom: '64px',
  zIndex: String(Z + 2),
  padding: '8px 14px',
  font: `600 13px/1 ${FONT.ui}`,
  color: '#fff',
  background: COLOR.idle,
  border: 'none',
  borderRadius: '999px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
  cursor: 'pointer',
}, 'atx-toggle');
toggle.type = 'button';
toggle.textContent = 'Edit';
toggle.title = 'Toggle text-edit mode';

function setEditMode(on: boolean): void {
  editMode = on;
  toggle.style.background = on ? COLOR.accent : COLOR.idle;
  toggle.textContent = on ? 'Editing' : 'Edit';
  document.body.style.cursor = on ? 'crosshair' : '';
  // Survive the full-page reload that follows every successful save.
  try {
    sessionStorage.setItem('astroTextEditMode', on ? '1' : '0');
  } catch {
    // sessionStorage unavailable (rare) — edit mode just won't persist.
  }
  if (!on) {
    clearHighlight();
    state.dismiss(); // cancel any open inline edit (restores text) / close any panel
  }
}

toggle.addEventListener('click', () => setEditMode(!editMode));

// Global Escape closes any open modal interaction (image/dynamic panel) and
// guarantees state resets. Inline text edits handle their own Escape (to
// restore original text) before this ever sees it.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.get()?.kind === 'panel') {
    e.preventDefault();
    state.dismiss();
  }
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/** Open a source location in the user's editor, reporting the result. */
async function openSource(src: SourceLoc): Promise<void> {
  try {
    await api.open({ file: src.file, loc: src.loc });
    toast(`Opened ${basename(src.file)}:${src.loc} in your editor`, 'ok');
  } catch (err) {
    toast(`Could not open source — ${err instanceof Error ? err.message : 'unknown'}`, 'err');
  }
}

const isEditMode = (): boolean => editMode;
const hoverElements = initHover({ isEditMode, openSource: (src) => void openSource(src) });
initRouter({ isEditMode, openSource: (src) => void openSource(src) });

// After an HMR update: drop stale hover state, and re-snapshot source
// mappings from the freshly-rendered (re-annotated) DOM before the toolbar
// strips them again. (spec §4.2 / §7.4, adapted for attribute-stripping)
if (import.meta.hot) {
  import.meta.hot.on('vite:afterUpdate', () => {
    clearHighlight();
    cacheSourceMappings();
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  // Confirm the server side is alive before showing the button. If the health
  // check fails the overlay stays out of the way entirely.
  if (!(await api.health())) return;
  document.body.append(...hoverElements, toggle);

  // Restore edit mode across the full-page reload that follows every save.
  try {
    if (sessionStorage.getItem('astroTextEditMode') === '1') setEditMode(true);
  } catch {
    // sessionStorage unavailable — start with edit mode off.
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  void boot();
}
