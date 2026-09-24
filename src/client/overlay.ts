/**
 * astro-dev-edit overlay — injected browser client (composition root).
 *
 * This module does three things and nothing else: it starts capturing source
 * annotations before anything can strip them, it puts the shadow root back
 * after a `<ClientRouter />` swap, and it boots the inspector once the server
 * answers. Everything the user sees is built by `inspector-app.ts`.
 *
 * Vanilla TS, no framework, no dependencies. (spec §4.2)
 */

import * as api from './api.ts';
import { setFeatures } from './features.ts';
import { initInspectorApp } from './inspector-app.ts';
import { reattachOverlay } from './shadow.ts';
import { startCapture } from './source-map.ts';

// Begin capturing source annotations as early as possible. If the body isn't
// parsed yet, wait for it; the observer then catches every annotated node as
// it arrives. This must run synchronously at module evaluation so the cache is
// populated before anything asks it a question — source-map.ts's timing
// contract, which that module has no top-level side effects of its own to keep.
if (document.body) {
  startCapture();
} else {
  document.addEventListener('DOMContentLoaded', startCapture, { once: true });
}

// ---------------------------------------------------------------------------
// Client-side navigation
// ---------------------------------------------------------------------------

// A `<ClientRouter />` swap leaves the host behind with the old body, and
// `boot()` will never run again because the browser has already evaluated this
// module. Registered at module evaluation so it runs *before* the listener
// `initInspectorApp()` adds inside the async boot — the root is live again by
// the time the inspector rebuilds into it. (issue #77)
document.addEventListener('astro:page-load', reattachOverlay);
window.addEventListener('popstate', reattachOverlay);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  // Confirm the server side is alive before drawing anything. If the health
  // check fails the overlay stays out of the way entirely.
  const info = await api.health();
  if (!info) return;
  // Every option-derived flag is read through features.ts rather than a local,
  // so a panel deep in the import graph can see them without importing the
  // composition root, and so a Settings save updates them in place.
  setFeatures(info);
  initInspectorApp();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  void boot();
}
