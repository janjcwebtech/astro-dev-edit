# Architecture

`astro-dev-edit` is an Astro **integration**, not an app. It adds in-browser visual editing to the Astro **dev server**: turn on edit mode, click text or an image in the rendered page, and the change is written straight to the source file; HMR refreshes the preview.

It ships TypeScript source with **no build step** — `exports` points at `./src/index.ts`, and consuming projects compile the `.ts` like their own. `npm run typecheck` is the build-equivalent gate.

**Dev-only by construction.** `astro:config:setup` bails unless `command === 'dev'`, so nothing registers for `astro build` / `astro preview` and the code cannot reach a production bundle. Any new hook work preserves that guard.

**Two annotation regimes.** The whole feature rides on the `data-astro-source-file` / `-loc` attributes present in dev. Astro 5 and 6 emit them from the compiler (dev toolbar required); Astro 7 does not, so the integration injects them itself — `src/server/annotate.ts`, a pre-compiler Vite transform gated by the `sourceAnnotations` option. Two invariants hold it: its locs stay loc-rule-identical to the patcher's (`tests/helpers.ts::locOf`), and it keeps **hook-level** `transform: { order: 'pre' }`, because plugin-level `enforce` alone is not enough.

Three layers meet at one type-only contract.

## The contract — `src/shared/`

`protocol.ts` is the single source of truth for every request and response shape on the `/__dev-edit` endpoints. Both client and server import it with `import type` (enforced by `verbatimModuleSyntax`), so it never reaches the client bundle, and a shape change breaks `typecheck` on the other side instead of at runtime. Changing what one side sends starts there.

`protocol.ts` is types-only. The runtime shared modules are `slug.ts` (slug sanitizing) and `unsplash.ts` (the Unsplash import-width safelist), both the same shape: **client suggests, server re-runs as authority**. A runtime list that a type needs goes in a module like those, or server-side the way `FIELD_TYPES` does.

## Server — `src/server/`

Dev middleware, mounted under `/__dev-edit`.

| Module | Owns |
| --- | --- |
| `src/index.ts` | Integration entry: injects the overlay client, preflight-warns if the dev toolbar is off, mounts the middleware |
| `middleware.ts` | Composition point: the localhost gate, the core loc-based routes (health, assets, upload, open, classify, apply), and the concatenated feature route groups |
| `router.ts` | The dispatcher — body reading, JSON parse, size caps, error mapping |
| `entry-routes.ts` | `/entry*` — the CMS endpoints, etag guards, field assembly, schema validation |
| `entry-resolve-routes.ts` | `/entry/resolve` — URL → backing entry, so no meta tag is needed. Resolve-only; every failure is a named refusal |
| `schema-routes.ts` | The collection designer — `/collections`, `/collection/schema/apply`, `/collection/create`, `/collection/entries`, `/collection/open`, `/collection/page-editing` |
| `inspect-routes.ts`, `page-source-routes.ts`, `settings-routes.ts`, `unsplash-routes.ts` | One feature group each |
| `annotate.ts`, `private-files.ts` | The two injected Vite plugins, both ordering-critical: one annotates `.astro` source before the compiler, the other refuses to serve the files this integration writes |
| `options.ts` | The option vocabulary, `OPTION_SPECS`, `DevEditOptions`, `DEFAULTS`, `createOptionsResolver` |
| `paths.ts` | `validateEditablePath`, the one path gate |
| `text-writes.ts` | The single write seam |
| `content-config.ts` | Loads the project's `content.config.ts` through the dev server |
| `schema-introspect.ts` | zod object schema → `FieldDescriptor`s; owns `FIELD_TYPES` |
| `route-manifest.ts` | Which file a route is written in, from `astro:routes:resolved`; and which routes are dynamic |
| `entry-detect.ts` | Which collection a page route renders — a `getCollection('x')` scan, cached per file mtime |
| `collection-entries.ts` | A collection directory's entry files and their ids; the `contentRoots` check both readers share |

Each feature group is a `create<Feature>Routes(deps): Route[]` factory.

### Options are resolved per request, never captured

`createOptionsResolver` resolves `astro.config.mjs` → the settings file → `DEFAULTS` on **every request**, which is what lets the Settings drawer change an option without a dev-server restart. Two consequences:

- `src/index.ts` passes the project's **raw** `userOptions`, unmerged with `DEFAULTS`, because `key in userOptions` is the only way to tell a deliberate `false` from an absent key — which is what `locked` means.
- A feature gate cannot decide whether its route group is *registered*. Every group registers unconditionally and each handler checks its own live gate, answering an explicit `disabled` rather than a 404.

### Security is centralized

- `isLocalRequest` rejects non-localhost and bad Origin at the middleware door, covering every route automatically.
- `paths.ts::validateEditablePath` is the one gate every edit path passes: realpath (symlinks resolved) ∈ project root ∈ configured `contentRoots`, with an allowed extension. `/classify`, `/apply` and `/open` alike go through it.
- Writes go through `atomicWrite` (temp file + rename). Its `mode` rides the **temp** file, so a secret is never briefly readable at the umask before the rename.

### Four classes of write, and only the first uses that gate

1. **Content** — confined by `validateEditablePath`.
2. **The settings file** (`.astro-dev-edit.json`) — a *fixed* path; see `settings.ts`'s header.
3. **`.env.local`** — a fixed path too, holding the Unsplash access key. A secret does not belong in a file inside the directory Vite serves, and `.env`/`.env.*` are already denied by Vite itself. Written at `0600` through `patcher/dotenv.ts`, which upserts one variable by line slicing and **refuses** any value that would need dotenv quoting rather than escaping it.
4. **The project's `content.config.ts`** — `validateEditablePath` cannot cover it, since `.ts` is not an editable extension. Its path is **discovered server-side** from `EntrySchemaProvider.configPath` and a request names a *collection*, never a path, so there is nothing to smuggle; `schema-routes.ts::configTarget` re-checks realpath ∈ root and a config-shaped extension anyway. That module's header states the four rules that hold it in.

Anything reaching generated source — collection name, field name, directory, glob pattern — is **validated, not escaped**: a value that would need quoting is refused, which keeps every expression the patcher writes a shape it can read back.

### Every text write goes through one seam

`text-writes.ts::createTextWrites` owns it. `createMiddleware` builds a single coordinator and injects its `write` as `writeText` into the core `/apply` handler and the entry, schema and settings groups. It is `atomicWrite` plus the two things a bare write cannot do:

- It **re-verifies at the last moment** — parent realpath, file identity, byte contents — because `revealWrites` opens the destination in the user's editor and then *pauses* before writing, which makes the window between a handler's gate and the write real rather than theoretical.
- `run()` wraps every text-mutating POST (the `textMutationPaths` set), serializing whole requests and pinning the resolved options for the duration, so a save that switches the mode off still behaves the way it started.

A handler that writes project text takes `writeText` from its deps (defaulting to `text-writes.ts::directWrite`, which is how tests skip the seam — not `atomicWrite` itself, whose third parameter is the file mode where `TextWriter`'s is the original), passes the `original` it verified against (`null` for a create), an optional file mode, and adds its path to that set. Uploads, imports and deletions stay outside the seam on purpose.

### Impure dependencies are injected

`content-config.ts` loads the project's own `content.config.ts` through the dev server (`ssrLoadModule`, always fresh) to answer "which collection backs this file, and what is its zod schema?" It is injected so tests can stub it, and every failure path returns `null` so the panel falls back to value inference.

`route-manifest.ts` is the second instance: it reads routes through a thunk (the hook re-fires on every change under `srcDir`) and returns a typed *refusal* rather than a guess, which is why *Open page source* does not count annotated elements in the DOM.

## Patchers — `src/patcher/`

Pure string transforms with **no fs access** — the middleware reads and writes. `Patcher` (`types.ts`) is the loc-based interface behind the registry, and has two methods; `frontmatter.ts`, `content-config.ts` and `dotenv.ts` are pure in the same way but target named keys rather than source locs, so they implement none of it:

- `classify(source, {loc, tag})` returns AST-truth about the element at a source loc.
- `apply(source, req)` does **verify-then-patch**: it confirms the source still matches the `original` the client saw, then returns new source or a typed refusal.

`registry.ts` maps a file extension to its patcher; `astro.ts` is the `.astro` implementation over the `@astrojs/compiler` AST. `frontmatter.ts` is the separate YAML path for content-collection entries — surgical edits that preserve comments, key order and quoting, via the `yaml` lib.

`dotenv.ts` upserts one variable in a `.env` document for the settings panel — line slicing only, so comments, ordering and every other variable survive, and a value outside `[A-Za-z0-9_-]` is refused rather than quoted.

`content-config.ts` is the third non-registry patcher: it reads and patches the project's `content.config.ts` for the collection designer, **with no JS parser, deliberately**. Vite's re-exported `parseAst` is a *JavaScript* parser and throws on the TypeScript a real config contains, and the failure mode has to be refusal anyway. Instead `blankNonCode` blanks every string, template, comment and regex literal to spaces (offsets preserved), and everything downstream is plain character matching on the blanked copy while slicing the original. It anchors only on shapes it can prove — `schema: z.object({…})`, `schema: ({ image }) => z.object({…})`, `export const collections = {…}` — and reports anything else as `unrecognized`, so the UI offers *Open source* instead of guessing. Inside a field list the refusal is per entry, not per block: an entry that isn't `name: schema` (a spread, a computed key) is reported in `opaqueEntries` and skipped, keeping its bytes in the span arithmetic while the fields around it stay patchable.

Two invariants:

- `renderZodField` is the inverse of `schema-introspect.ts::terminalType`, and the two stay in step — the round-trip test in `tests/content-config-patch.test.ts` is the guard.
- There is **no rename**. A schema key is the frontmatter key in every entry file, so renaming it alone would break the collection.

## Client — `src/client/`

An injected vanilla-TS overlay: no framework, no runtime deps.

### One shadow root

Every piece of chrome the overlay draws lives in one shadow root. `shadow.ts` owns the `<astro-dev-edit>` host, the root, and the `mount()` that stands in for `document.body.append` at every mount point. Nothing appends overlay UI to the document directly. Three consequences are load-bearing:

- A `document`-level listener sees `event.target` **retargeted to the host**, so any "is this ours" test uses `composedPath()` (`shadow.ts::isOwnUi`), and `document.activeElement` becomes `overlayActiveElement()`.
- `document.querySelector` cannot find our own elements — query the root.
- The host never gains `transform`, `filter` or `contain`, which would re-anchor every `position: fixed` panel to it.

**One deliberate exception, and it is not negotiable.** The rich-text editor's `.atx-rte-content` stays in the **light DOM** and is `<slot>`-ed into the drawer (`shadow.ts::mountLight`). Safari's selection and `execCommand` APIs are inert against a `contenteditable` inside a shadow root — `document.execCommand` silently does nothing, `getSelection().anchorNode` retargets to `<body>` — which kills the whole markdown toolbar, not one guard. Verified in Chrome, Firefox and WebKit. Because it is slotted, `root.contains()` is false for it while `composedPath()` includes it, and it is styled by `CONTENT_CSS` in the document rather than by the overlay stylesheet.

### Modules

`overlay.ts` is the composition root — toggle button, entry button, boot, HMR wiring — and wires the leaves together.

- **`source-map.ts` — the subtle core.** Astro's dev toolbar *strips* the `data-astro-source-*` attributes from the live DOM shortly after hydration, so they cannot be read at hover time. This module snapshots each annotated element (onto a private JS property plus a structural-path map) the instant it appears, via a `MutationObserver` started synchronously at module load to win the race. Read source locations through `sourceFor` / `nearestSource`, never from live attributes.
- **`router.ts`** — capture-phase click routing. Every click is confirmed against the server's `/classify` before an editor opens, because the DOM cannot tell a resolved `{expression}` from literal text; only the AST can. Routes to `editors/text.ts` (inline contenteditable), `editors/image.ts` (swap panel), `editors/entry.ts` (CMS drawer) or `editors/notice.ts` (safe refusal + *Open source*).
- **`editors/entry.ts`** composes `editors/fields.ts` (the field-control registry, one builder per `FieldType`, unknown types degrading to read-only `json`), `editors/drawer.ts` (drawer shell, backdrop, state token, dirty-confirm lifecycle, owned once) and `editors/asset-picker.ts` (the image-field control).
- **`editors/settings-panel.ts`** is a **server-declared** drawer: `/settings` returns self-describing option records and it renders whatever arrives, so adding an option needs no client change.
- **`editors/collections-panel.ts`** is the collection designer — a **peer** of the Settings drawer with its own admin-bar menu item (`atx-menu-collections`), not a tab inside it: an option is a switch on this tool, a collection's shape is the project's own committed source. It holds no options and saves through its own endpoints, so its footer is Close-only. Two load-bearing details: a field row spans **two stores** (schema → `content.config.ts`, editor → `.astro-dev-edit.json`) and the UI keeps saying which is which; and a schema write makes Astro resync its content layer, which reloads the page more than once, so the collection to return to is remembered in `sessionStorage` with a TTL and consumed by `overlay.ts`'s boot rather than by the pane's own load.
- The entry drawers are **peers** of the Settings drawer, not children — they claim the same interaction slot. The Items view therefore *hands off* (`shell.close()` then open) rather than stacking, which is why `DrawerShell.close()` returns whether it actually closed.
- **`group.ts`** — the structural half of the look, as `ui.ts` is the token half: `card` (header/body/footer band), `fieldGroup`, `separator`, `item`/`itemGroup`. Pure DOM, no state, no imports beyond `styled`. Every panel builds its content from these rather than growing its own row and its own section heading — a drawer is a stack of cards on a canvas one step darker than they are, which is what makes a card's edge a boundary. A bespoke row means this seam was missed.
- **`focus.ts`** — modal focus containment, the keyboard half of what a backdrop does for the pointer. `trapFocus(shell)` gives a panel dialog semantics and holds Tab inside it; traps **stack** (media modal over drawer) the way `state.releaseTo` does, and the walk follows `<slot>`s so the light-DOM rich-text surface is in the cycle. Every `buildBackdrop` caller pairs with one.
- **`state.ts`** — a single token-based interaction controller. **`hover.ts`**, **`api.ts`** (typed `fetch` wrappers — nothing else in the client calls `fetch`), **`ui.ts`** (styled DOM helpers: the `COLOR`/`RADIUS`/`FONT`/`INPUT_STYLE` tokens, the `footButton` primitive every panel and drawer button goes through, and the `atx-*` classes and IDs — **internal** hooks for the stylesheet and DOM lookups, not a theming API, since user CSS cannot match across the boundary).
- **`styles.ts`** — `overlayCss()`, the single stylesheet the root adopts. It opens with the `:host { all: initial }` inheritance guard and **generates** the `--atx-*` custom-property block from `ui.ts`'s tokens; hand-writing that block would leave `tests/contrast.test.ts` guarding a copy the UI does not use. It is a function, not a constant, because `ui.ts → shadow.ts → styles.ts → ui.ts` is an import cycle and reading `COLOR` at module-evaluation time would hit the TDZ.

Theming is `--atx-*` plus a deliberately small `::part()` set (`bar`, `panel`, `drawer`, `backdrop`, `pill`, `toast`), assigned centrally from `PARTS` in `ui.ts::styled`. A new part is an API commitment — add one only on demand. Both tables are documented in [Styling reference](STYLING.md).

## Editing model

Every save writes disk immediately and atomically. There is **no in-app undo** — the safety model is the user's git working tree. The verify-before-write step, where the server confirms the source still matches what the page showed, makes a stale click fail safe rather than corrupt the file. Both properties survive any change to the write path.

## Extending

Every extension point is a registry or a factory. Expansion means adding a file or an entry, not growing an existing module — if a change makes `middleware.ts`, `entry.ts` or `fields.ts` significantly longer, a seam is being missed.

| Adding… | Where it goes |
| --- | --- |
| **An endpoint** | One `Route` entry. The core table in `middleware.ts` only if it serves the loc-based editing flow; anything feature-shaped gets its own `create<Feature>Routes(deps)` module, concatenated in `createMiddleware`. Define the wire shapes in `protocol.ts` first, add the typed wrapper in `client/api.ts`, give the route a `maxBytes` cap, and pass any file path through `validateEditablePath` and `atomicWrite` — or the injected `writeText` for project text |
| **A project file that must never be served** | One entry in `PRIVATE_FILES` (`src/server/private-files.ts`). Vite serves the project root, so anything written there is reachable at `/<name>` and `/@fs/<abs>` unless listed. `server.fs.deny` is not the seam: an array in user config *replaces* Vite's defaults rather than extending them |
| **An entry-panel widget** | The name in `FieldType` (`protocol.ts`) plus a builder in `CONTROL_BUILDERS` (`client/editors/fields.ts`) — builders get `{field, raw, initial, placeholder, root}` and return `{value, dirty}`; label and error chrome are added for you. To *derive* it from a zod schema, map it in `schema-introspect.ts` (`terminalType` for schema shapes, `inferType` for value inference); if it is only ever forced via `entryEditor.collections`'s `fields.widget`, the registry entry alone is enough. Unknown types render as read-only `json`, so old clients degrade safely |
| **A per-collection editor setting** | A key on `EntryEditorOptions.collections[<name>]` — **not** an `OPTION_SPECS` entry, which is flat scalars only. `mergeEntryEditor` already merges new sibling keys per collection with the config leaf winning, so resolution needs no change; give it a route shaped like `writePageEditing` and read the config layer through `optionsResolver.entryEditorConfig()` to know whether it is locked |
| **A collection-designer capability** | The schema half is `src/patcher/content-config.ts` plus one route in `src/server/schema-routes.ts`; the editor half is a `FieldOverride` key, which goes through `writeOverrides` into the settings file and never near the config. A new schema *shape* means a new anchor in the patcher and a case in `tests/content-config-patch.test.ts`; a new field *type* means `renderZodField` **and** `terminalType`, kept in step by the round-trip test |
| **An editable file type** | One `Patcher` implementation (`src/patcher/types.ts`) plus an entry in `patcher/registry.ts`, and the extension in the `editableExtensions` default in `src/index.ts` |
| **A client editor or panel** | A module under `client/editors/`, opened from `client/router.ts`'s classification switch. Claim the interaction slot with `state.begin({kind: 'panel', close})` and release via `state.releaseIf`; for drawer-shaped UI use `editors/drawer.ts::openDrawer` and `ui.ts::footButton`. Build DOM through `ui.ts::styled` and `group.ts`, reusing `COLOR`/`FONT`/`INPUT_STYLE` |
| **An integration option** | **One entry in `OPTION_SPECS` (`src/server/options.ts`)**, carrying the default, wire label and help, control, Settings tab, and how to read it out of a partial config. It drives resolution, the `/settings` payload **and** the panel's control, so no client change is needed. Set `configOnly: true` only for something consumed in `astro:config:setup`, before a dev server exists. Read it off `await deps.options()`; do not add a field to `MiddlewareDeps`, which carries one options thunk |
| **Server logic needing the dev server or project config** | Follow `content-config.ts`: a small interface, injected, returning `null` on every failure path so the feature degrades instead of erroring, stubbed in tests |
| **A user setting that is not an integration option** | If it is not a secret, it goes in `.astro-dev-edit.json` (`settings.ts`) beside `options` — an ordinary `Partial<DevEditOptions>` — or it is an option and belongs in `OPTION_SPECS`. **A secret does not go in that file at all**: it goes to `.env.local` through `patcher/dotenv.ts`, at `0600`, with its own resolution, and never enters a response — only whether one resolved, where from, and whether the panel may change it. It also joins `uncoveredSecretFiles`, so the panel can warn when the project's ignore rules miss it |

## Tests

Vitest characterization tests pin patcher and middleware behavior. The client layer has no unit tests beyond `markdown.ts`; it is covered by a manual checklist.

`tests/helpers.ts::locOf` computes the `line:col` an element would be annotated with, mirroring the loc rules in `astro.ts`; use it to build classify and apply requests.

Deliberate behavior quirks — entity decoding, verify strictness, partial-failure windows — are tracked as [`deferral`-labelled issues](https://github.com/janjcwebtech/astro-dev-edit/issues?q=is%3Aissue+label%3Adeferral), not bugs.
