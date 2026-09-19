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

Needed for client/overlay changes, and for what exists only inside a running dev server — the `annotate.ts` transform, HMR.

### Launch

⚠️ **Astro ≥7.1 daemonizes `astro dev` when it detects an agent.** A plain `npm run dev` can print `Dev server already running at http://localhost:4321 (pid …)` and exit without starting anything — `--port` silently ignored, no Vite port fallback. The lock file wins.

```bash
cd examples/playground
npx astro dev status                        # already up? on what port?
lsof -a -p "$(lsof -tiTCP:<port> -sTCP:LISTEN)" -d cwd   # WHICH project it serves
```

- **The server's `cwd` is the only trustworthy identity check** — never the port, and not `/health`, which carries no path. The daemonized playground routinely takes :4321, the port the real consuming site would use. `…/astro-text-edit/examples/playground` is safe to drive.
- ⚠️ A server you did not start may belong to a **concurrent session**. Confirm its `cwd` and leave it running rather than `stop`ping it.
- An already-running playground is fine for `src/client/` work — Vite compiles the working tree per request.
- ⚠️ **`src/server/` changes need a restart.** The middleware is built once in `astro:config:setup` / `server:setup` and captured, so a route or patcher edit keeps answering with the old code and looks like the fix did nothing. Option *values* are the deliberate exception — they resolve per request.

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
root.getElementById('atx-toggle').click();
```

Exception: an inline edit is the page's **own element** made `contenteditable="plaintext-only"` — light DOM, so `document.querySelector('[contenteditable]')` finds it.

- Singletons in that root: `#atx-bar` holding `#atx-toggle`, `#atx-bar-elements`, `#atx-bar-pin`, `#atx-bar-exit`, `#atx-bar-edge`; `#atx-hairline` when retracted; menu items `#atx-menu-page-source`, `#atx-menu-settings`; `#atx-tree-tab`; drawer `.atx-drawer`.
- Inspector mode (`composition: true`, `npm run dev:composition`) adds `#atx-dock` and its drag handle `#atx-dock-grip`; the layout switch is the first button in `.atx-inspector-header`.
- State: `sessionStorage.astroDevEditMode` (`'1'`/`'0'`), `localStorage.astroDevEditBar` (pin/dock), `localStorage.astroDevEditLayout` (`{mode, dockHeight, dockOpen}`).
- Hover is JS-driven on `#atx-bar` — `browser_hover` plus `getComputedStyle` through `browser_evaluate`.

Fixtures:

| Page | Exercises |
| --- | --- |
| `/`, `/about` | literal text, edit toggle |
| `/articles/<slug>`, `/works/<slug>` | a route rendering a Markdown entry — its values are not editable in the browser |
| `/swap/a` ↔ `/swap/b` | `<ClientRouter />` navigation: the overlay must survive the body swap |
| `npm run dev:composition` → `/marketing` | inspector mode on a three-deep component chain |

### Live server checks without a browser

Routes are pinned by the middleware tests. For a live look, `GET /__dev-edit/health` and `GET /__dev-edit/settings`. An `Origin` header is optional, but when present it must be localhost.

### Restore the fixtures

Overlay edits write into the playground's own source:

- edited `.astro` files → `git checkout --`
- uploads land in the upload dir as new untracked files → delete by name
- `.astro-dev-edit.json` (gitignored, invisible to `git status`) → reset by hand after testing Settings
