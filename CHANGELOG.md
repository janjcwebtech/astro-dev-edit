# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/). Fix-only releases bump the patch, releases with feature work bump the minor, and the major moves only on an explicitly confirmed bigger release. While the project is in `0.x`, breaking changes may land in minor releases.

<!--
Writing an entry — one line, past tense, no essay:
  • What changed, and the identifier a reader would search for (option, endpoint, token, hook).
  • Not why, not how it was built, not what it used to do. The diff is the record of that.
  • Two sentences is the ceiling. If it needs a third, it needs a doc in documentation/.
  • Nothing about internal refactors, tests, or docs reorganisation unless it moves a public link.
-->

## [Unreleased]

### Added

- Contributing guide, security policy, and issue/PR templates — `CONTRIBUTING.md`, `SECURITY.md`, `.github/`. Commits need a `Signed-off-by` line; suspected vulnerabilities go through GitHub's private reporting rather than a public issue
- [Architecture](documentation/ARCHITECTURE.md) — the layer map, the invariants holding each one, and where a new endpoint, widget, file type, panel or option goes
- Image fields are a switch on the collection, on both the create form and an existing collection's Fields tab. Ticking it rewrites the one `schema:` line to `({ image }) => z.object({ … })`; `POST /collection/schema/apply` takes `schema.form` and `POST /collection/create` takes `schemaForm`

### Changed

- The README's install command is the `github:` spec while the package is unpublished, and says so; `npm install astro-dev-edit` 404s until the first publish
- `docs/` is now `documentation/`, holding public reference only. Maintainer material — design system, workflow, verification map, Astro compatibility — moved to a gitignored `internal-documentation/`
- The collection designer carries an **experimental** badge on its drawer title
- The Astro 5/6/7 source-annotation setup moved out of the README into [Configuration reference](documentation/CONFIGURATION.md#astro-versions-and-source-annotations); the README keeps a one-line pointer
- The README's "Your git is the undo button" section is now a single bullet under **Limits**
- Every in-repo README link is an absolute `github.com/…/blob/main/` URL, so the docs, changelog, contributing guide, security policy and licence resolve from npmjs.com and from an unpacked `node_modules` copy, neither of which holds anything but `src/`, `README.md` and `LICENSE`
- README screenshots are links to `documentation/images/` again, not inlined base64, and the hero carries a banner image. The URLs are absolute `raw.githubusercontent.com` ones so they also render on npmjs.com, where `documentation/` is not shipped
- The version and license badges read the repository (`shields.io/github/...`) instead of the npm registry, which 404s until the package is published, and a **beta** badge sits beside them
- Turning image fields back off is refused while any field still uses `image()`, and the refusal names them

## [0.8.0] - 2026-09-07

### Added

- **Settings drawer** in the admin bar's overflow menu — every integration option editable in place, applied on the next request with no dev-server restart. Tabs for General, Editing, Media and Unsplash; values set in `astro.config.mjs` render read-only with a padlock and say where they came from. `enabled` and `sourceAnnotations` stay config-only. A patch naming an unknown, config-only or locked option is refused whole, with per-option messages. New `atx-settings-*` hooks and a `lock` icon
- **Collection designer**, on its own **Collections** item in the overflow menu: collection list, then one collection's field table, then a create form. It writes `src/content.config.ts` surgically — comments, key order and quoting outside the edited span come out byte-for-byte
- A field row shows its two stores separately: *Schema* (type, required, default) writes `content.config.ts`, *Editor* (widget, label, hidden) writes `.astro-dev-edit.json`. A save reports each half
- **Items view** per collection — entry files newest-first with draft flags, which is how you reach a draft or an entry with no route yet
- Schema writes are etag-guarded and all-or-nothing: a refusal anywhere leaves the config untouched
- A schema the designer cannot prove is reported as unreadable, with *Open source* offered instead of controls
- The designer reopens in the collection you were editing after a schema save triggers Astro's content-layer resync
- `schemaEditor` option (default `true`); `false` keeps the schema half read-only while editor-only overrides still save
- A field whose widget, label or hidden flag `astro.config.mjs` owns renders read-only with a padlock
- **Media picker** modal, used everywhere images are chosen — the swap panel, `image()` fields, and the body editor's image panel. Grid of tiles newest-first, details rail with path, size and modified time, filter and folder scope, drop target for uploads. Picking is staged: **Use image** commits, Cancel and Escape write nothing. New `atx-media-*` hooks
- **Unsplash photo source** in that picker, off unless you opt in with `unsplash: {}`. The dev server downloads the photo into your project like any other upload, so nothing but the local `src` reaches your source. Photographers are credited with the `utm_source`/`utm_medium` links the API guidelines require, imports ping the download endpoint, and identical searches are served from a 5-minute cache
- `unsplash` option (default `false`) with `accessKey`, `appName` and `perPage`
- The Unsplash access key is written to `.astro-dev-edit.json` at `0600` and never returned to the browser — a read reports only whether one resolved, from where, and a masked fragment. The drawer warns when that file is not covered by `.gitignore`
- `unsplash.importWidth` option (`800`, `1600`, `2400`, `'original'`; default `2400`) plus a size select in the picker's toolbar that applies to the next import only. A width off that safelist is refused, not rounded. New `atx-unsplash-width` hook
- `revealWrites` option (default off) opens every text file the tool writes in your external editor around the save, after `revealWriteDelayMs` (default `1000`, range `0`–`10000`). Uploads, imports and deletions are excluded. A save queues and re-verifies at the last moment, so a file you edit during the pause is refused rather than overwritten
- The image swap panel shows the image being edited with its filename and size, above a strip of the six most recent images and a **Browse all** button
- New endpoint `POST /page-source`, resolving a URL to the file its page is written in from Astro's route manifest, read through `astro:routes:resolved` and re-read on every route change
- New endpoints: `POST /collections`, `POST /collection/schema/apply`, `POST /collection/create`, `POST /collection/entries`, `POST /collection/open`, `POST /unsplash/search`, `POST /unsplash/import`, `GET /settings`, `POST /settings`. New `collections` icon and `atx-collections-*` hooks
- `GET /health` reports `unsplash`, `openInEditor` and `entryEditor`, so the overlay hides a switched-off affordance the moment you save, without a reload

### Changed

- **The overlay renders inside a shadow root** on a single `<astro-dev-edit>` element, so host-page CSS cannot reach it in either direction. Theming is `--atx-*` custom properties plus a small `::part()` set — `bar`, `panel`, `drawer`, `backdrop`, `pill`, `toast`. The rich-text surface stays in the light DOM, because `execCommand` is inert inside a shadow root
- **Colours are a design system** on the [shadcn/ui](https://ui.shadcn.com) naming scheme — `background`, `card`, `elevated`, `border`, `input`, `ring`, `primary`, `secondary`, `destructive`, `accent`, `muted` — defined in `src/client/ui.ts` and pinned by `tests/contrast.test.ts`
- **Chrome is neutral and the brand purple means one thing: this element on your page is editable.** The accent moved from `#7c5cff` to `#6144d7`; primary buttons, active tabs, toggles and admin-bar chips went neutral
- Controls follow shadcn's anatomy: no border at rest, 32px tall with 16px icons, one radius scale, and a 3px `--atx-ring` on `:focus-visible` only. Entry-drawer fields set `aria-invalid` from the same call that shows their error
- An outline button is a faint fill (`--atx-control-bg`) inside a 1px `--atx-input` edge. **Close** and **Cancel** are outlined wherever they appear
- Panels are built out of cards — a header names the concern, a body carries the fields, a footer band carries the action that completes it. A destructive action sits at the far end of that band, away from the pair being chosen between
- Icons come from [Lucide](https://lucide.dev) (ISC). No glyph in the overlay is the platform's, including the markdown toolbar's quote, link and image keys, the media grid's selection tick, and every `<select>` chevron
- The hover highlight sits 2px clear of the element rather than flush against it, and the element tree's locked selection is drawn by the same geometry. The pill dropped the coloured left edge that repeated the outline's verdict
- The element tree marks branches with a chevron and leaves with nothing, tags still column-aligned
- The admin bar is one 28px height throughout, full-bleed at the viewport edge, at 94% opacity
- A locked field dims only its control — the label and the help text explaining why it is locked stay at full strength
- The overlay layers *below* Astro's dev toolbar: base z-index moved from `2147483000` to `1999999000`
- **Options resolve per request** instead of being captured when `astro:server:setup` ran, which is what removes the restart
- `.astro-dev-edit.json` keeps a feature's on/off flag beside its detail, so switching a feature off and on again restores its configuration
- `GET /assets` returns `{ path, size, mtime }` per image instead of a bare path string
- **The package is `astro-dev-edit`** (was `astro-text-edit`): `devEdit()`, `DevEditOptions`, `/__dev-edit`, `.astro-dev-edit.json` and the `astro-dev-edit:page-source` meta name. `atx-*` hooks are unchanged
- The copied element context dropped its **Editability** line, which an assistant read as a constraint on what it was allowed to change
- The hover pill's copy button reads **copy context** and copies five source lines either side of the element instead of the whole file
- Boolean fields show `On`, `Off` or `not set` in words beside the checkbox
- The overflow menu lists *Open page source* above *Collections*
- **The README is an index with a screenshot per feature, not the whole manual.** It had grown past 7 000 words; the detail moved into per-surface docs
- The styling-hook list was rebuilt from source and grouped by surface — four documented hooks did not exist and about forty real ones were missing
- The media picker removed `atx-asset-row`, `atx-asset-controls` and `atx-asset-count`, and renamed `atx-drop` to `atx-media-drop` / `atx-media-dropzone`
- Contrast fixes: `COLOR.muted` and `COLOR.faint` raised, `COLOR.accentText` used wherever the accent was a foreground, and one `COLOR.control` border token at 3:1 replacing four invisible ones
- Smaller measure and alignment fixes: the collection designer's field cards (16px padding, 12px apart, zod expression under a hairline, two halves as two columns), *Save changes* moved into the footer band, 10px between a markup or expression box and its label, and the **Elements** button carrying the tree tab's own icon

### Fixed

- Picking a `src/assets` image for a body or a plain `<img>` wrote a path that 404s once built. `GET /assets` now reports whether an asset is servable and those slots refuse the ones that are not
- A layout still emitting the pre-0.7 `astro-text-edit:page-source` meta is told so, instead of the entry button silently never appearing
- A refusal says when it is describing a different element than the one you clicked
- An attribute holding a literal entity (`&amp;`) could be written once and then never edited again
- Swapping in an image whose filename holds a space wrote a raw space into `src` instead of `%20`
- An image whose filename held a space vanished from a body on the next save, because a markdown destination ends at the first space
- Saving one entry field re-spaced every flow array in the frontmatter
- The uncommitted-secret warning could not appear while the Unsplash source was off
- Astro's dev toolbar swallowed clicks on the overlay's modal surfaces
- Creating an entry from another collection's Items drawer navigated to a 404
- The entry drawer's *New* button discarded an unsaved draft without asking
- Every `<script>` on the page was served raw and broken on Astro 7, because the self-annotation transform stamped `data-astro-source-*` onto it
- Leaving edit mode discarded an open expression or markup draft
- A new entry wrote `false` over a boolean's schema default
- Creating an entry left you on the page you started from
- A field's label did not name its control — no `for`, no `aria-label`
- The keyboard walked straight out of an open panel. Panels trap focus now, and traps stack
- Clicking *Save & exit* during an inline edit saved but did not exit
- A date field rejected a typo with "Invalid input: expected date, received Date."
- *Open page source* opened the wrong file, typically a nav or header component instead of the page's own template
- The collection designer's two-store legend inherited the host page's body colour, dropping it to 2.7:1
- `src/server/unsplash-routes.ts` carried three raw NUL bytes, which made the whole file read as binary to `grep`
- A freshly uploaded or imported image showed as an empty box until the page was reloaded
- Opening a panel above another one left the lower one owning no interaction slot once the upper closed
- Pill-button labels sat about 1.5px low

## [0.7.1] - 2026-08-12

### Added

- The source popups carry an **open** button in their title bar, jumping to `file:line:col` in your editor. New `atx-panel-heading` and `atx-panel-open` hooks

## [0.7.0] - 2026-08-12

### Added

- **Text rendered through an `{expression}` is editable** — `<h1>{title}</h1>`, and a card inside a `.map()` loop, traced back to the value in the source through the `@astrojs/compiler` AST
- **Text with inline markup is editable** rather than refused: a heading broken by a `<br>`, a sentence carrying a `<strong>` or an `<a href="">`. New `atx-markup-*` hooks
- **Admin bar** (`#atx-bar`): every global control in a slim full-width strip docked to the top, replacing the floating pill group in the corner
- The exit button doubles as the save indicator, answering "is my work on disk?" at a glance
- The element tree has a left-edge tab (`#atx-tree-tab`) whenever it is closed while edit mode is on
- **Copy an element's context for an AI assistant** — a `copy` button on the hover pill putting the source location, page URL, DOM path and applied CSS on the clipboard
- A clipboard-fallback panel (`atx-copy-note` / `atx-copy-text`) for a dev server reached over a network address, where the browser offers no clipboard API
- An icon set (`src/client/icons.ts`): inline SVG on a 24px grid drawn in `currentColor`, replacing the unicode glyphs
- **`image()` schema fields are editable safely** — the path is stored relative to the entry file, as Astro's helper requires (`assetRef: 'relative'`)
- `imageUploadDir` option (default `src/assets`) — the fallback directory for uploads backing an `image()` field
- The asset picker gained a text filter, plus a directory scope toggle for relative fields
- `GET /health` reports the project `root`, so the copied context can show a project-relative path
- The two source-editing popups share one shell, `editors/source-popup.ts`, with `atx-popup-label` / `-input` / `-error` hooks
- `UploadRequest` gained `assetRef` and `targetDir`; `EntryResponse` gained `collectionDir`
- New `atx-*` hooks for the bar and menu: `atx-bar-group`, `atx-bar-sep`, `#atx-bar-brand`, `atx-bar-btn`, `#atx-bar-exit`, `#atx-bar-pin`, `#atx-bar-hint`, `#atx-menu`, `#atx-hairline`

### Fixed

- Leaving edit mode threw away an open inline edit — the exit path cancelled the interaction instead of committing it
- Schema introspection works on Astro 7, which ships zod v4 and renamed every internal the introspector reads
- Entry saves are validated again on Astro 7 — `shapeOf` shared the same dead version guard, so `validateChanges` returned no errors at all
- `z.string().readonly()` no longer degrades to a read-only `json` widget on zod v3
- Under zod v4, a field declared with `.transform()` resolves to the shape the form must produce rather than the one it accepts

### Changed

- **The floating bottom-right controls are gone**, replaced by the admin bar. `#atx-controls`, `#atx-hide`, `#atx-toggle`, `#atx-entry` and `#atx-toggle-hint` no longer exist
- The hover pill's buttons read `open` and `copy` with an icon, instead of `open ↗` and `copy ⧉`
- An unpinned bar no longer retracts while you are editing
- **The element tree is opt-in** — turning on edit mode no longer opens it
- The tree's chevrons, leaf markers and close button are inline SVG rather than `▸ ▾ · ✕`
- The tree is positioned by top and bottom rather than a fixed height, floats inset from the viewport edge, and keeps clear of the admin bar's strip at either edge
- Toasts lift above a bottom-docked bar and the hover pill drops below its element rather than hiding under it, both from a shared chrome inset (`ui.ts::setChromeInset`)
- Uploads accept an optional `targetDir`, confined to the configured asset directories
- Uploading an animated GIF to an `image()` field is refused (422) — Astro's optimisation flattens the animation to one frame
- `buildImageField` takes an options object rather than positional arguments

### Security

- New `paths.ts::resolveUploadDir` is the single gate for a client-requested upload directory, confined to the configured asset directories

## [0.6.0] - 2026-07-24

### Added

- **Element-tree panel in edit mode**, listing every source-annotated element on the page with its tag, `line:col` and a text preview, and jumping to the source on click
- New `atx-tree-*` theming hooks for the panel, header, rows, chevrons and selection

## [0.5.0] - 2026-07-24

### Added

- **CSS class and ID inspector in the hover pill** — a chip per class, and on click the rules that chip applies plus the file each is written in
- `cssInspector` option (default `true`); `false` renders no chips at all
- New endpoint `/inspect/open`, opening a rule at its source location
- New `atx-tooltip-*` theming hooks for the pill's rows, chips and rules list

### Fixed

- Elements rendered by a package no longer spam the dev log with `classify failed: path is outside the editable content roots`
- `POST /peek` responses gained an optional `refused` field, which the peek panel renders in place of the code pane
- Overlay panels scroll on host pages running a smooth-scroll library — Lenis, Locomotive and GSAP ScrollSmoother all `preventDefault()` every `wheel` event

### Changed

- The hover pill sits fully above the highlighted element, dropping below only when there is no room
- The overlay controls sit `16px` from the bottom of the viewport instead of `64px`
- `paths.ts` exposes `checkEditablePath()`, a non-throwing form of the path gate returning `{ok, code, reason}`

## [0.4.0] - 2026-07-20

### Added

- **Astro 7 support via self-annotation** (`src/server/annotate.ts`) — Astro 7's Rust compiler does not emit the `data-astro-source-*` attributes the feature rides on, so the integration injects them itself
- `sourceAnnotations` option (`'auto'` | `'force'` | `'off'`, default `'auto'`), and the `astro` peer range widened to `>=5.0.0 <8`
- `entryEditor.collections.<name>.extension` option (`'.md'` | `'.mdx'`), fixing the extension used for entries created through the panel

### Fixed

- Image edits that change both the file and the alt text are written in a single atomic pass, closing a partial-failure window
- Entry create matches the collection's file extension instead of always writing `.md`
- `decodeEntities` knows the common typographic named entities — `&mdash;`, `&ndash;`, `&hellip;`, curly quotes, `&laquo;`, `&middot;` and the rest
- After creating an entry the client polls the new page's URL until Astro's content layer has synced it

### Changed

- The playground pins `astro` to `^7.0.0`, so the self-annotation regime is what the manual checklist exercises
- The image swap panel and the entry drawer's image field share one `buildAssetPicker` primitive

## [0.3.0] - 2026-07-19

### Added

- **Source peek** — a read-only, syntax-highlighted view of the whole source file in a wide in-browser panel, scrolled to the element's line
- The refusal notice's `file:line:col` line opens the peek, so you can see why content refused without leaving the browser

### Changed

- The hover pill's `file:loc` label opens the source peek instead of jumping to the editor; the **open** button beside it still opens the location
- The playground is a neutral fictional site ("Copydesk") rather than a copy of a real business site
- The playground's accent moved from terracotta to the overlay's purple

## [0.2.0] - 2026-07-19

### Changed

- The hover pill classifies against the server instead of guessing from the DOM, which false-flagged resolved `{expressions}` as editable. It appears immediately in a neutral loading state and settles into its verdict

## [0.1.1] - 2026-07-18

### Added

- **Content-collection entry editing** — frontmatter patching, schema introspection, and an asset picker
- **WYSIWYG body editor** in the entry drawer: bold, italic, strikethrough, headings, lists, quote, code block, inline code, link and image insert
- **Navigate-while-held** — holding Ctrl or Alt/Option in edit mode suspends editing so clicks travel the site normally
- `uploadDir` option (default `public`), with a preflight warning when it points outside `public/`
- Playground blog content, layouts and nav/footer components, to exercise entry editing end to end
- A ✕ button, revealed on hovering the corner buttons, hides them until the next page reload
- The hover pill's `file:loc` label is clickable and jumps to the source location

### Changed

- The **Edit entry** button is always visible on pages that declare a backing content file, no longer gated behind edit mode
- Entry drawer widened to 50% of the viewport, still at least 440px and capped at 94vw
- Image field redesigned: a 240×160 preview above the path input, click-to-browse on the preview, and a placeholder rather than a broken image
- Clicking an image inside the rich body editor opens the picker to replace it
- The image insert and replace panel gained an alt-text field, auto-suggested from the filename for a new image only
- The rich editor toolbar and image panel share a sticky header
- The rich editor surface is white with dark text, like the rendered page
- The corner buttons and the navigate hint live in one wrapper (`#atx-controls`)

### Fixed

- Moving the mouse from an element up to its hover pill retargeted the highlight to whatever it crossed, usually the parent
- Image uploads wrote into the first `assetDirs` entry, producing an `<img src="/src/assets/…">` that 404s in a build
- Clicking an existing image in the body editor pre-filled its alt text from the filename, so a plain Replace could silently rewrite the alt
- Bare block-level images were dropped by the rich editor's markdown serialization
- The date field's native calendar icon was near-invisible on the dark input

### Security

- The open-in-editor endpoint (`/open`) confined client-supplied paths with a weaker check than the edit endpoints — no symlink resolution, no content-root test. It goes through `validateEditablePath` now

## [0.1.0] - 2026-07-18

### Added

- Overlay-based inline editor for Astro markdown content
- Wire protocol (`shared/protocol.ts`), shared type-only between client and server
- Server middleware route table with a pluggable patcher registry
- Vitest characterization tests pinning patcher and middleware behavior

### Changed

- The client split into focused modules (`api.ts`, `ui.ts`, `overlay.ts`, `editors/`), with `overlay.ts` as the composition root
- Ad hoc interaction flags replaced with a single token-based state controller
