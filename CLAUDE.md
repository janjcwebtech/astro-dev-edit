# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`astro-text-edit` is an Astro **integration** (not an app) that adds in-browser visual content editing to the Astro **dev server**. Turn on edit mode, click text/images in the rendered page, and the change is written straight to the source file; Astro HMR refreshes the preview. It ships TypeScript source with **no build step.** Consuming Astro projects compile the `.ts` like their own.

**Dev-focused by design.** `astro:config:setup` bails unless `command === 'dev'`, so nothing registers for `astro build` / `astro preview` and the code can never reach a production bundle. Keep it that way — any new hook work must preserve the dev-only guard.

**Astro 5.x and 6.x only — not Astro 7.x.** The whole feature rides on the `data-astro-source-file` / `-loc` attributes Astro emits in dev. Astro 7 defaults to the Rust compiler (`@astrojs/compiler-rs`), which accepts the `annotateSourceFile` flag but **does not emit those attributes**, so click-to-edit is inert there (the entry drawer, which uses the page-source meta + content config, still works). The peer range is pinned `>=5.0.0 <7` for this reason. Don't bump the playground or peer range to 7 until upstream restores emission — tracked in [`docs/ASTRO-COMPAT.md`](docs/ASTRO-COMPAT.md) ([withastro/compiler-rs#96](https://github.com/withastro/compiler-rs/issues/96)), which also records the two-phase attribute-removal history and the other tools on the same mechanism.

## Commands

```bash
npm run typecheck          # tsc --noEmit; the primary correctness gate (no build)
npm test                   # vitest run (all tests once)
npm run test:watch         # vitest watch
npx vitest run tests/frontmatter.test.ts          # a single test file
npx vitest run -t "verifies before writing"       # tests matching a name
```

There is no lint step and no `dist/` — `exports` points directly at `./src/index.ts`. `npm run typecheck` is the build-equivalent check; run it after any change.

### Manual / browser verification

Never verify against the real consuming site on `localhost:4321` — it installs this integration as a normal dependency and does **not** see uncommitted `src/` changes. Use the playground instead:

```bash
cd examples/playground && npm run dev   # file:../.. symlink → runs live src/
```

The playground consumes the integration via a `file:../..` symlink, so Vite compiles the working-tree source on the fly. Edits made through the overlay write into the playground's own `src/pages/index.astro` — restore the fixture afterwards. Requires Astro's dev toolbar enabled (`devToolbar.enabled`), the source of the `data-astro-source-*` attributes the whole feature depends on.

## Architecture

Three layers meet at one type-only contract. **`src/shared/protocol.ts`** is the single source of truth for every request/response shape on the `/__text-edit` endpoints. Both client and server import it with `import type` (enforced by `verbatimModuleSyntax`), so it never reaches the client bundle and a shape change breaks `typecheck` on the other side instead of at runtime. When you change what one side sends, edit `protocol.ts` first. `shared/slug.ts` is the one _runtime_ shared module (slug sanitizing — client suggests, server re-runs as authority); keep `protocol.ts` itself types-only.

### Server (`src/server/`) — dev middleware

-   `index.ts` (repo root of `src/`) is the integration entry: `config:setup` injects the overlay client on every page and preflight-warns if the dev toolbar is off; `server:setup` mounts the middleware under `/__text-edit`.
-   `middleware.ts` is the **composition point**: it owns the localhost gate, the core loc-based routes (health, assets, upload, open, classify, apply), and concatenates feature route groups into one table. `entry-routes.ts` is the first such group — the `/entry*` CMS endpoints plus everything entry-specific (etag guards, field assembly, schema validation) behind a `createEntryRoutes(deps): Route[]` factory. `router.ts` is the tiny dispatcher (body reading, JSON parse, size caps, error mapping) that runs each route.
-   **Security is centralized.** `isLocalRequest` rejects non-localhost / bad Origin at the middleware door. `paths.ts::validateEditablePath` is the one gate every edit path passes: realpath (symlinks resolved) ∈ project root ∈ configured `contentRoots`, with an allowed extension. Every path-taking route — `/classify`, `/apply`, and `/open` alike — goes through it. Writes go through `atomicWrite` (temp file + rename).
-   `content-config.ts` loads the project's own `content.config.ts` through the dev server (`ssrLoadModule`, always fresh) to answer "which collection backs this file, and what's its zod schema?" It's impure and injected into the middleware so tests can stub it; every failure path returns `null` and the panel falls back to value inference. `schema-introspect.ts` turns a zod object schema into `FieldDescriptor`s and validates changes against it.

### Patchers (`src/patcher/`) — pure string transforms

`Patcher` (`types.ts`) is string-in/string-out — **no fs access** (the middleware reads/writes). Two methods: `classify(source, {loc, tag})` returns AST-truth about the element at a source loc, and `apply(source, req)` does **verify-then-patch** (confirms the source still matches the `original` the client saw, then returns new source or a typed refusal). `registry.ts` maps a file extension to its patcher; `astro.ts` is the `.astro` implementation (`@astrojs/compiler` AST). `frontmatter.ts` is the separate YAML-patching path for content-collection entries — surgical edits that preserve comments, key order, and quoting (uses the `yaml` lib). Adding a file type = one `Patcher` + one `registry.ts` entry.

### Client (`src/client/`) — injected vanilla-TS overlay

No framework, no runtime deps. `overlay.ts` is the **composition root** (toggle button, entry button, boot, HMR wiring) and wires the leaf modules together:

-   `source-map.ts` — **the subtle core.** Astro's dev toolbar _strips_ the `data-astro-source-*` attributes from the live DOM shortly after hydration, so they can't be read at hover time. This module snapshots each annotated element (onto a private JS property + a structural-path map) the instant it appears, via a `MutationObserver` started synchronously at module load to win the race. Read source locations through `sourceFor` / `nearestSource`, never from live attributes.
-   `router.ts` — capture-phase click routing. Every click is confirmed against the server's `/classify` before an editor opens, because the DOM can't tell a resolved `{expression}` from literal text — only the AST can. Routes to `editors/text.ts` (inline contenteditable), `editors/image.ts` (swap panel), `editors/entry.ts` (CMS drawer), or `editors/notice.ts` (safe refusal + "Open source").
-   The CMS drawer is itself layered: `editors/entry.ts` composes `editors/fields.ts` (**field-control registry** — one builder per `FieldType`, unknown types degrade to read-only `json`), `editors/drawer.ts` (drawer shell + backdrop + state-token + dirty-confirm lifecycle, owned once), and `editors/asset-picker.ts` (the image-field control).
-   `state.ts` — a single token-based interaction controller (replaced ad-hoc boolean flags); `hover.ts`, `api.ts` (typed `fetch` wrappers), `ui.ts` (styled DOM helpers: design tokens `COLOR`/`FONT`/`INPUT_STYLE`, the `footButton` primitive every panel/drawer button goes through, and the `atx-*` classes/IDs the README documents for theming — don't rename them).

### Editing model

Every save writes disk immediately and atomically; there is **no in-app undo** — the safety model is the user's git working tree. The verify-before-write step (server confirms source still matches what the page showed) makes a stale click fail safe rather than corrupt the file. Preserve both properties in any change to the write path.

## Extending — where a new thing goes

Every extension point is a registry or a factory; expansion should mean adding a file or an entry, not growing an existing module. If a change makes `middleware.ts`, `entry.ts`, or `fields.ts` significantly longer, you're probably missing the intended seam.

**A new endpoint** — one `Route` entry. Add it to the core table in `middleware.ts` only if it serves the loc-based editing flow; anything feature-shaped gets its own `create<Feature>Routes(deps): Route[]` module next to `entry-routes.ts`, concatenated in `createMiddleware`. Define the wire shapes in `protocol.ts` first, add the typed wrapper in `client/api.ts` (nothing else in the client may call `fetch`), and give the route a `maxBytes` cap. The localhost gate covers every route automatically; path confinement does not — any handler that touches a file must go through `paths.ts::validateEditablePath` and write with `atomicWrite`.

**A new entry-panel widget** (e.g. a color picker) — add the name to `FieldType` in `protocol.ts`, register a builder in `CONTROL_BUILDERS` in `client/editors/fields.ts` (builders get `{field, raw, initial, placeholder, root}` and return `{value, dirty}`; label + error chrome is added for you). If the type should be _derived_ from a zod schema, map it in `schema-introspect.ts` (`terminalType` for schema shapes, `inferType` for value inference); if it's only ever forced via the `entryEditor.collections` config's `fields.widget`, the registry entry alone is enough. Old clients degrade safely: unknown types render as read-only `json`.

**A new editable file type** (e.g. MDX in-place edits) — implement the `Patcher` interface (`src/patcher/types.ts`, pure string-in/string-out, no fs) and add it to the array in `patcher/registry.ts`. Classify/apply pick it up by extension; also add the extension to the `editableExtensions` default in `src/index.ts`.

**A new client editor/panel** — a module under `client/editors/`, opened from `client/router.ts`'s classification switch. Claim the interaction slot with `state.begin({kind: 'panel', close})` and release via `state.releaseIf`; for drawer-shaped UI use `editors/drawer.ts::openDrawer` (handles backdrop, token, dirty-confirm) and `ui.ts::footButton` for actions. Build DOM only through `ui.ts::styled` — inline styles for correctness on any host page, a stable `atx-*` class for theming — and reuse `COLOR`/`FONT`/`INPUT_STYLE` rather than hardcoding values.

**A new integration option** — extend `TextEditOptions` in `src/index.ts`, give it a value in `DEFAULTS`, and thread it through `MiddlewareDeps` (or the feature's own deps interface). Server-side behavior toggles belong in deps injected into route factories, so tests can exercise both states without an Astro server.

**New server logic that needs the dev server or the project's config** — follow `content-config.ts`: wrap it in a small interface, inject it, return `null` on every failure path so the feature degrades instead of erroring, and stub the interface in tests.

## Tests

**`docs/VERIFICATION.md` is the verification map** — every feature area with the test file that pins it, plus the manual playground checklist for the client layer (which has no unit tests beyond `markdown.ts`). It must stay current: any change that adds, removes, or reshapes functionality updates its matrix in the same commit, and a manual-only behavior that gains a test moves into the automated table. The `.claude/skills/verify` skill is the runbook (typecheck → vitest → playground drive) that leans on it.

Vitest characterization tests pin patcher and middleware behavior — treat them as the spec of current behavior. `tests/helpers.ts::locOf` computes the `line:col` an element would be annotated with (mirrors the loc rules in `astro.ts`); use it to build classify/apply requests. Deliberate behavior quirks (entity decoding, verify strictness, partial-failure windows) are documented in `TODO.md` as known deferrals rather than bugs — check there before "fixing" one.

## Changelog, README, and versioning

Two docs are easy to forget and must not be — check both before any change lands:

-   **`CHANGELOG.md`** — every user-visible change (feature, fix, behavior or option change, security tightening) gets an entry under `[Unreleased]` in the appropriate Keep-a-Changelog section (Added / Changed / Fixed / Security), in the same commit as the change.
-   **`README.md`** — the user-facing doc. Any change to options, endpoints, editors/panels, refusal behavior, or the `atx-*` styling surface updates the matching README section in the same commit.

Versioning is semver, applied at release time (when work is stamped out of `[Unreleased]`), not per commit:

-   **Patch (`0.0.x`)** — a release containing only fixes.
-   **Minor (`0.x.0`)** — a release containing feature work. While in `0.x`, breaking changes may ride along in minors.
-   **Major (`X.0.0`)** — only when the user explicitly confirms a bigger release; never bump major on your own.

Stamping a release means: rename `[Unreleased]` to the new version with the date, bump `version` in `package.json` to match, and tag `vX.Y.Z` — all in one commit on `main`.
