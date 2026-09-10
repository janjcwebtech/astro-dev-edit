---
name: verify
description: Verification runbook for astro-dev-edit — the typecheck and vitest gates, then how to launch and drive the playground for runtime checks. Use before calling any change done, and when asked to verify, test, or confirm a change works in the real overlay.
---

# Verifying astro-dev-edit changes

Feature → test-file matrix and the full manual checklist: `internal-documentation/VERIFICATION.md`.
**A change that adds or reshapes functionality updates that matrix in the same commit, and any fact below that stops being true is fixed here in the same commit.**

## Gates 1 + 2 — always, first

```bash
npm run typecheck   # build-equivalent; enforces the protocol.ts contract
npm test            # vitest; the spec of current behavior
npx vitest run tests/frontmatter.test.ts     # scoped, while iterating
npx vitest run -t "name substring"
```

Patcher and middleware changes land with a pinning test. Server-side logic is covered here, not manually.

## Gate 3 — runtime in the playground

Needed for client/overlay changes, or server code the tests stub (`content-config.ts`'s real `ssrLoadModule` path).

### Launch

⚠️ **Astro ≥7.1 daemonizes `astro dev` when it detects an agent.** A plain `npm run dev` can print `Dev server already running at http://localhost:4321 (pid …)` and exit without starting anything — `--port` silently ignored, no Vite port fallback. The lock file wins.

```bash
cd examples/playground
npx astro dev status                        # already up? on what port?
curl -s localhost:<port>/__dev-edit/health  # `root` says WHICH project it serves
```

- **`health.root` is the only trustworthy identity check** — never the port. The daemonized playground routinely takes :4321, the port the real consuming site would use. `…/astro-text-edit/examples/playground/` is safe to drive.
- ⚠️ A server you did not start may belong to a **concurrent session**. Confirm `health.root` and leave it running rather than `stop`ping it.
- An already-running playground is fine for `src/client/` work — Vite compiles the working tree per request.
- ⚠️ **`src/server/` changes need a restart.** The middleware is built once in `astro:config:setup` / `server:setup` and captured, so a route, patcher or `schema-introspect.ts` edit keeps answering with the old code and looks like the fix did nothing. Option *values* are the deliberate exception — they resolve per request.

Your own instance (also for a second isolated one — concurrent session, different options):

```bash
ASTRO_DEV_BACKGROUND=1 npm run dev -- --port 4399 --ignore-lock
```

Both flags are required. `--ignore-lock` skips the lock check; `ASTRO_DEV_BACKGROUND=1` suppresses the agent detection that would otherwise refuse `--ignore-lock` outright. Runs in the **foreground** — background it and read its log for the real URL.

Daemon controls: `astro dev status`, `astro dev stop`, `astro dev logs [--follow]`. `logs` works only for a server started with `--background`; an agent-auto-daemonized one has no reachable log.

- Playwright MCP "Browser is already in use" = stale Chrome holding the profile → `pkill -f mcp-chrome`, retry.
- Screenshots save to the **repo root** (`./name.png`), element and full-page alike. Move or delete before committing.

### Drive the overlay

⚠️ **Every overlay node is inside the shadow root.** `document.querySelector('#atx-bar')` returns `null`, and Playwright's `browser_click` / `browser_snapshot` cannot pierce `<astro-dev-edit>` (it is not an iframe). Use `browser_evaluate`:

```js
const root = document.querySelector('astro-dev-edit').shadowRoot;
root.getElementById('atx-entry').click();
```

Exception: `.atx-rte-content` is slotted **light DOM**, so `document.querySelector` finds it.

- Singletons in that root: `#atx-bar` holding `#atx-toggle`, `#atx-entry` (detail pages only), `#atx-bar-elements`, `#atx-bar-pin`, `#atx-bar-exit`, `#atx-bar-edge`; `#atx-hairline` when retracted; menu items `#atx-menu-page-source`, `#atx-menu-collections`, `#atx-menu-settings`; `#atx-tree-tab`; drawer `.atx-drawer`.
- State: `sessionStorage.astroDevEditMode` (`'1'`/`'0'`), `localStorage.astroDevEditBar` (pin/dock).
- Hover is JS-driven on `#atx-bar` — `browser_hover` plus `getComputedStyle` through `browser_evaluate`.

Fixtures:

| Page | Exercises |
| --- | --- |
| `/` | Edit toggle only |
| `/articles/` | listing, literal text |
| `/articles/editing-astro-sites` | declares the page-source meta → Edit entry pill + CMS drawer |
| `/articles/text-editors-vs-visual-editors` | markdown table → body opens raw-only |
| `/articles/drafts-live-here-too` | `draft: true` → boolean widget, off the listing |

### Drive the CMS routes without a browser

Fastest way to exercise the `ssrLoadModule` path the tests stub. Every route needs a localhost `Origin`:

```bash
curl -s -H 'Content-Type: application/json' -H 'Origin: http://localhost:4321' \
  -X POST http://localhost:4321/__dev-edit/collections -d '{}'
```

`/collections` is the highest-signal single call: `fieldSource: "schema"` (not `"inferred"`) means schema introspection is alive for this project's zod major. Read the wire shape in `src/shared/protocol.ts` before hand-rolling a body — an unknown key is ignored, not refused (`dir` vs `directory` on `/collection/create` silently uses the default directory).

### Restore the fixtures

Overlay edits write into the playground's own source. Four things get dirtied and only the first shows in `git status`:

- entry files and `src/content.config.ts` → `git checkout --`
- **empty directories** the collection designer created (`src/content/<name>`) → `rmdir` by name
- `.astro-dev-edit.json` (gitignored) → reset by hand after testing overrides or settings
- `.env.local` (gitignored) → **delete it** after testing the access key. This is the one holding a real credential, so it is the one worth not forgetting

`/collections`' `etag` returns to its original value once the config is byte-identical again.
