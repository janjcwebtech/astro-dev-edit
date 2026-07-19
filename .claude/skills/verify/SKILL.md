---
name: verify
description: Full verification workflow for astro-text-edit changes — typecheck + vitest gates, then the launch/drive recipe for runtime checks in the playground.
---

# Verifying astro-text-edit changes

The complete map of what is verified where — feature → test file, plus the
manual checklist for everything client-side — lives in `docs/VERIFICATION.md`.
This skill is the operational recipe. **If your change added or reshaped
functionality, update that doc's matrix in the same commit.**

## Gate 1+2 — automated (always run these first)

```bash
npm run typecheck   # build-equivalent check; enforces the protocol.ts contract
npm test            # vitest; the spec of current behavior
```

Scoped runs while iterating: `npx vitest run tests/frontmatter.test.ts` or
`npx vitest run -t "name substring"`. Patcher and middleware changes should
land with a pinning test — server/patcher logic is expected to be covered
here, not just manually.

## Gate 3 — runtime, in the playground

Only needed for client/overlay changes or server code the tests stub (e.g.
`content-config.ts`'s real `ssrLoadModule` path). The surface is the injected
overlay in a browser on the **playground** dev server (never the real
consuming site on :4321 — it runs an installed copy).

## Launch

```bash
cd examples/playground && npm run dev -- --port 4399   # background it
```

`--port 4399` is a *preference, not a lock* — its only job is to steer the
playground away from the default :4321, where the real consuming site lives
(same-looking URL, but it runs an installed copy). A busy port never errors.

Gotchas:
- If the port is busy (e.g. a concurrent session), **Vite silently falls back
  to the next port** (4400, 4401, …) — the dev log's URL is the only truth;
  read it before driving, or you'll test a stale server from an earlier
  session. Concurrent sessions coexist fine, each on its own fallback port.
- Playwright MCP may refuse to start with "Browser is already in use":
  stale Chrome processes from a previous session hold the profile. Fix:
  `pkill -f mcp-chrome` then retry.
- Element screenshots save to the **repo root** (`./name.png`), not
  `.playwright-mcp/` — move them out before committing.

## Drive

- Home page `/` has the ✎ Edit toggle only.
- `/articles/` is a listing (literal text, editable in edit mode).
- `/articles/editing-astro-sites` (any id under `src/content/blog/`) is a
  detail page that declares the page-source meta → the ✎ Edit entry pill and
  the CMS drawer appear there.
- Special-purpose fixtures: `/articles/text-editors-vs-visual-editors` has a
  markdown table → its body opens raw-only in the drawer;
  `/articles/drafts-live-here-too` is `draft: true` (off the listing, page
  still renders — exercises the boolean widget).
- Overlay singletons: `#atx-controls` (button group wrapper), `#atx-toggle`,
  `#atx-entry`, `#atx-hide`, `#atx-toggle-hint`. Drawer: `.atx-drawer`.
- Edit-mode persistence: `sessionStorage.astroTextEditMode` (`'1'`/`'0'`).
- Hover states are JS-driven (mouseenter/leave on `#atx-controls`), so
  `browser_hover` + `getComputedStyle` via `browser_evaluate` observes them.

Edits made through the overlay write into the playground's own source files —
restore the fixtures afterwards (`git -C examples/playground status`... the
playground is part of this repo, plain `git status` shows it).

Drive whichever sections of the manual checklist in `docs/VERIFICATION.md`
your change touches; the whole list before a release.
