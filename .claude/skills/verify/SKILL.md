---
name: verify
description: Build/launch/drive recipe for verifying astro-text-edit overlay changes at runtime in the playground.
---

# Verifying astro-text-edit changes

The surface is the injected overlay in a browser on the **playground** dev
server (never the real consuming site on :4321 — it runs an installed copy).

## Launch

```bash
cd examples/playground && npm run dev -- --port 4399   # background it
```

Gotchas:
- If the port is busy, **Vite silently falls back to the next port** — read
  the dev log for the actual URL before driving, or you'll test a stale
  server from an earlier session.
- Playwright MCP may refuse to start with "Browser is already in use":
  stale Chrome processes from a previous session hold the profile. Fix:
  `pkill -f mcp-chrome` then retry.
- Element screenshots save to the **repo root** (`./name.png`), not
  `.playwright-mcp/` — move them out before committing.

## Drive

- Home page `/` has the ✎ Edit toggle only.
- `/articles/` is a listing (literal text, editable in edit mode).
- `/articles/wordpress-auto-updates` (any id under `src/content/blog/`) is a
  detail page that declares the page-source meta → the ✎ Edit entry pill and
  the CMS drawer appear there.
- Overlay singletons: `#atx-controls` (button group wrapper), `#atx-toggle`,
  `#atx-entry`, `#atx-hide`, `#atx-toggle-hint`. Drawer: `.atx-drawer`.
- Edit-mode persistence: `sessionStorage.astroTextEditMode` (`'1'`/`'0'`).
- Hover states are JS-driven (mouseenter/leave on `#atx-controls`), so
  `browser_hover` + `getComputedStyle` via `browser_evaluate` observes them.

Edits made through the overlay write into the playground's own source files —
restore the fixtures afterwards (`git -C examples/playground status`... the
playground is part of this repo, plain `git status` shows it).
