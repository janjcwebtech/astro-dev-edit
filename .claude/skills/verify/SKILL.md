---
name: verify
description: Full verification workflow for astro-dev-edit changes — typecheck + vitest gates, then the launch/drive recipe for runtime checks in the playground.
---

# Verifying astro-dev-edit changes

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
overlay in a browser on the **playground** dev server. The real consuming site
also lives on this machine and runs an *installed* copy of the integration, so
it can never show working-tree changes — but a port number is not how you tell
the two apart (see below).

## Launch

**Astro ≥7.1 detects an agent environment and daemonizes `astro dev` on its
own.** So a plain `npm run dev` may print nothing but

```
Dev server already running at http://localhost:4321 (pid …)
```

and exit *without starting anything* — `--port` included, silently ignored.
There is no Vite port fallback any more; the lock file wins.

Check first, then decide:

```bash
cd examples/playground
npx astro dev status                       # is one already up, and on what port?
curl -s localhost:<port>/__dev-edit/health # `root` says WHICH project it serves
```

**`health.root` is the only trustworthy identity check** — it is the absolute
path of the project the server is serving. `.../astro-text-edit/examples/playground/`
is the playground and is safe to drive, whatever port it landed on. Never infer
this from the port: the daemonized playground routinely takes :4321, the port
the real consuming site would otherwise use.

If `status` shows a playground server, **you can usually just drive it** —
Vite compiles the working tree on every request, so an already-running one is
as current as a fresh one for anything under `src/client/`.

⚠️ **`src/server/` changes are the exception: they need a restart.** The
middleware is built once in `astro:config:setup`/`server:setup` and then
captured, so an edit to a route, a patcher or `schema-introspect.ts` will *not*
appear in a running server — it will keep answering with the old code and look
like your fix did nothing. (Option *values* are the deliberate exception: those
resolve per request, which is what lets the Settings drawer work live.)

Start your own instance for that, and whenever you need a second isolated one
(a concurrent session, or a different set of options):

```bash
ASTRO_DEV_BACKGROUND=1 npm run dev -- --port 4399 --ignore-lock
```

Both flags are required and neither works alone: `--ignore-lock` skips the lock
check, and `ASTRO_DEV_BACKGROUND=1` suppresses the agent detection that would
otherwise refuse `--ignore-lock` outright ("cannot be used together with an
auto-detected AI agent environment"). This runs in the **foreground**, so
background it and read its log for the real URL.

Controls for a daemonized server: `astro dev status`, `astro dev stop`,
`astro dev logs [--follow]`. `logs` only works for one started with
`--background`; an agent-auto-daemonized one has no reachable log, so a
foreground server of your own is the way to watch output.

⚠️ **A server you did not start may belong to a concurrent session** — confirm
`health.root` and leave it running rather than `stop`ping it.

Gotchas:
- Playwright MCP may refuse to start with "Browser is already in use":
  stale Chrome processes from a previous session hold the profile. Fix:
  `pkill -f mcp-chrome` then retry.
- Screenshots save to the **repo root** (`./name.png`), not `.playwright-mcp/`
  — element *and* full-page alike. Delete or move them before committing.

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
- **Every overlay node is inside the shadow root, so page-level selectors
  cannot reach it.** `document.querySelector('#atx-bar')` returns `null`, and
  Playwright's `browser_click`/`browser_snapshot` cannot pierce `<astro-dev-edit>`
  either (it is not an iframe). Drive the overlay through `browser_evaluate`:

  ```js
  const root = document.querySelector('astro-dev-edit').shadowRoot;
  root.getElementById('atx-entry').click();
  ```

  The one exception is the rich-text surface: `.atx-rte-content` is slotted
  **light DOM**, so plain `document.querySelector` does find it.
- Overlay singletons, all within that root: `#atx-bar` (admin bar) holding
  `#atx-toggle` (Edit page), `#atx-entry` (Edit entry, detail pages only),
  `#atx-bar-elements`, `#atx-bar-pin`, `#atx-bar-exit`, `#atx-bar-edge`;
  `#atx-hairline` when the bar is retracted; overflow-menu items
  `#atx-menu-page-source`, `#atx-menu-collections`, `#atx-menu-settings`;
  `#atx-tree-tab` for the element tree. Drawer: `.atx-drawer`.
- Edit-mode persistence: `sessionStorage.astroDevEditMode` (`'1'`/`'0'`);
  bar pin/dock: `localStorage.astroDevEditBar`.
- Hover states are JS-driven (mouseenter/leave on `#atx-bar`), so
  `browser_hover` + `getComputedStyle` via `browser_evaluate` observes them.

**The CMS server routes are drivable without a browser**, which is the fastest
way to exercise the `ssrLoadModule` path the tests stub. Every route needs a
localhost `Origin`:

```bash
curl -s -H 'Content-Type: application/json' -H 'Origin: http://localhost:4321' \
  -X POST http://localhost:4321/__dev-edit/collections -d '{}'
```

`/collections` is the highest-signal single call: if its fields come back
`fieldSource: "schema"` (not `"inferred"`), schema introspection is alive for
this project's zod major and the rest of the CMS is worth checking. Wire shapes
are in `src/shared/protocol.ts` — read the interface before hand-rolling a body,
since an unknown key is ignored rather than refused (`dir` vs `directory` on
`/collection/create` silently falls back to the default directory).

Edits made through the overlay write into the playground's own source files —
restore the fixtures afterwards (`git status` shows them; the playground is
part of this repo). Three separate things can be dirtied, and only the first is
caught by `git status`:

- entry files and `src/content.config.ts` — `git checkout --` them;
- **directories** the collection designer created (`src/content/<name>`), which
  git does not track when empty — `rmdir` them by name;
- `.astro-dev-edit.json`, which is gitignored — check it back to `{}`-ish by
  hand after testing field overrides or settings.

`/collections`' `etag` is a cheap end-state check: it returns to its original
value once the config is byte-identical again.

Drive whichever sections of the manual checklist in `docs/VERIFICATION.md`
your change touches; the whole list before a release.
