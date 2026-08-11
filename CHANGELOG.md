# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/): fix-only releases bump the patch (`0.0.x`), releases with feature work bump the minor (`0.x.0`), and the major (`X.0.0`) moves only on an explicitly confirmed bigger release. While the project is in alpha (`0.x.x`), breaking changes may land in minor releases.

## \[Unreleased\]

### Added

-   **Text with inline markup is editable.** A heading broken by a `<br>`, a sentence with a `<strong>` or a link in it, used to refuse with "This element contains nested markup" — a common shape, and one whose text is plainly still copy. Such elements now classify as `markup` and a click opens a **popup showing the element's source** (Save, or Cmd/Ctrl+Enter), a deliberately different affordance from inline editing since what you are editing is source rather than rendered text. The value shown is the source region the server read, not the DOM's `innerHTML`, and it goes straight back as the apply op's `original` — so verify-then-patch still compares like with like and a stale click still fails safe. The safelist is inline-only (`<a> <b> <br> <code> <em> <i> <small> <span> <strong> <sub> <sup> <u>`) with presentational attributes (`class`, `id`, `title`, `lang`, `dir`, plus `href`/`target`/`rel` on links); a tag outside it, a disallowed attribute, a `javascript:` href, or unbalanced tags are refused rather than written, and `{` is still escaped so no edit can introduce an expression. An element holding only plain text keeps inline editing, but can gain its first inline tag through this path. The allowed tags sit under the box as **buttons**: with text selected a tag wraps the selection and leaves it selected so tags can be stacked, otherwise it drops an empty pair at the caret — `<br>` inserts alone and `<a>` arrives as `<a href="">` with the caret inside the quotes. New `atx-markup-label` / `atx-markup-input` / `atx-markup-tags` / `atx-markup-tag` / `atx-markup-hint` styling hooks
-   **Admin bar.** Every global control now lives in a slim full-width bar docked to the top of the page (`#atx-bar`), replacing the floating pill group in the bottom-right corner: **Elements** (show/hide the element tree, turning edit mode on with it), **Edit page**, **Edit entry** on pages that declare a backing content file, and — behind the purple mark — an overflow menu with *Open page source* and the dev-server status. It **overlays** the page instead of pushing it down (the top edge is where sticky site headers live; reflowing it would change the layout you are editing) and stays semi-transparent until the pointer comes near. Two placement controls sit at the right end: **pin** (lit while pinned; unpinned, the bar slides off the edge leaving a thin accent line and returns when the pointer reaches that edge) and **dock**, which moves the whole bar to the bottom of the viewport for sites whose own chrome is at the top. Both are remembered per browser in `localStorage`. Items come from a registry, so adding a control is one entry rather than more layout code
-   **The exit button is the save indicator.** In edit mode the bar's right end carries a button that answers "is my work on disk?" at a glance: green **Done** (nothing pending), purple **Save & exit** (an inline edit has unsaved keystrokes), grey **Saving…**, green **Saved**, red **Save failed** (the write was refused and the change rolled back). Every way out of edit mode goes through it, so leaving **saves first and exits only once the write has landed**. Discarding stays deliberate — Escape while editing
-   The element tree has a **tab** on the left edge (`#atx-tree-tab`) whenever it is closed while edit mode is on — both after you close it with its ✕ and while it has not been opened yet — so the panel is never a one-way door and never hidden either
-   **An icon set** (`src/client/icons.ts`): hand-authored inline SVG on a 24px grid, drawn in `currentColor`, replacing the unicode glyphs (`✎ ✕ ▸ ▾ ↗ ⧉ ✓`) the overlay used to draw its controls with — those render at wildly different weights and baselines per platform font. No font file, no dependency, one `atx-ico` hook
-   New `atx-*` theming hooks: `#atx-bar` with `atx-bar-group`, `atx-bar-sep`, `#atx-bar-brand`, `atx-bar-btn` / `atx-bar-btn-icon` / `atx-bar-btn-label`, `#atx-bar-elements`, `#atx-bar-pin`, `#atx-bar-edge`, `#atx-bar-exit`, `#atx-bar-hint`, `#atx-hairline`, `#atx-menu` with `atx-menu-item` / `atx-menu-foot`, `#atx-tree-tab`, `atx-ico`, and `atx-pill-label` (the swappable label inside a hover-pill button)
-   **Copy an element's context for an AI assistant.** The hover pill gained a `copy ⧉` button next to `open ↗` that puts everything the overlay knows about the hovered element on the clipboard as one markdown block: its repo-relative source location and editability verdict, the page URL, its DOM path, the page's content entry when it declares one, the rendered HTML, the surrounding source lines (30 either side, with `>` marking the element's own line, read through the existing `/peek` endpoint), the CSS rules that match it with the stylesheet each came from, and a summary of its rendered box and type. Paste it into an assistant with what you want changed instead of describing where the element lives. Sections degrade independently — a location the server won't serve (an `astro:assets` `<Image>`) says so and the rest still copies — and the payload states its own caps (4 000 characters of HTML, 40 rules) rather than truncating silently. New `atx-tooltip-copy` styling hook
-   Clipboard-fallback panel (`atx-copy-note` / `atx-copy-text`): when the browser has no clipboard API to write to — a dev server reached over a network address is not a secure context — the context opens in a preselected read-only panel instead of failing
-   `/health` now reports the project `root`. Astro's source annotations are absolute fsPaths and the overlay only ever showed their basename; the copied context needs them repo-relative, and this is the only way the client can strip the prefix exactly. Absent on an older server, in which case paths stay absolute rather than being guessed at
-   **`image()` schema fields are now editable safely.** A collection field declared with Astro's `image()` helper stores a path relative to the *entry file* (`../../assets/blog/hero.png`), not a web URL. Such fields now carry `assetRef: 'relative'` on the wire, and the entry drawer's image control handles them end to end: the preview resolves the relative value to the path the dev server actually serves (so it renders instead of 404ing), Browse… lists the importable `src/` assets these fields need, and picking one writes the value back in entry-relative shape. A hint under the path input names the file the value is relative to. The `.astro` image swap panel is unchanged — it still deals only in web paths
-   New `imageUploadDir` option (default `src/assets`): the fallback directory for uploads backing an `image()` field. Those assets are imported by Astro rather than served verbatim, so they must live under `src/` — a preflight warning fires if the configured directory isn't. When the field already has a value, uploads instead land in **that value's own directory**, so assets stay grouped the way the project groups them
-   The asset picker gained a **text filter**, plus a directory scope toggle for relative fields (opens scoped to the field's own asset directory, with "Show all"). Both are needed at real-project scale — an unfiltered flat list of every listable asset is unusable. The filter is shared, so the swap panel gets it too
-   `UploadRequest` gained `assetRef` and `targetDir`; `EntryResponse` gained `collectionDir`, which the create drawer uses to resolve relative asset values for an entry that doesn't have a path yet

### Fixed

-   **Leaving edit mode no longer throws away an open inline edit.** Turning edit mode off went through `state.dismiss()`, which *cancels* a text interaction — restoring the original text and dropping the keystrokes with no prompt and no toast. Every exit path now commits instead (`state.commit()`), and edit mode stays on until the write settles; a failed write keeps you in edit mode with the failure on the bar rather than dropping you out
-   **Schema introspection now works on Astro 7.** Astro 7 ships zod v4 (`astro/zod` re-exports `zod/v4`), which renamed every internal the introspector reads — `_def.typeName` → `_def.type`, enum values → `_def.entries`, array element → `_def.element`, literal value → `_def.values[0]` — and moved `.describe()` into `z.globalRegistry`, so `_def.description` reads empty. The result was that **every** field on **every** collection fell back to value inference on Astro 7: enums rendered as plain text instead of selects, `image()` fields as plain text boxes, and defaults were invisible. A new `server/zod-adapt.ts` holds one accessor table per major behind a single duck-typed interface (still no zod import, so no dual-instance hazard), and `schema-introspect.ts` reads through it
-   **Entry saves are validated again on Astro 7.** `shapeOf` shared the same dead version guard, so `validateChanges` returned no errors at all: a required field could be blanked and a number field could take a string. Note this is a behaviour change as much as a fix — frontmatter that was silently tolerated may now come back as a field error
-   `z.string().readonly()` no longer degrades to a read-only `json` widget on zod v3. The unwrapper read `_def.type` for both `ZodBranded` and `ZodReadonly`, but only branded stores its inner schema there — readonly uses `_def.innerType`, so it never unwrapped
-   Under zod v4, a field declared with `.transform()` now resolves to the shape the form must *produce*. v4 compiles `.transform()` to `pipe{in, out}` whose `out` is a `transform` node no widget can render; the v4 table follows `in`. v3's `ZodPipeline` still follows `out`, unchanged

### Changed

-   **The floating bottom-right controls are gone**, replaced by the admin bar above. `#atx-controls`, `#atx-hide` (the ✕ that hid the buttons until the next reload) and `#atx-toggle-hint` no longer exist — unpinning the bar covers "keep it out of my way", and the hold-to-navigate note moved into the bar as `#atx-bar-hint`. `#atx-toggle` and `#atx-entry` keep their IDs but are now bar buttons, so CSS overrides targeting the removed hooks need updating
-   The hover pill's buttons now read **`open`** and **`copy`** with an icon instead of `open ↗` / `copy ⧉` (and `copied` instead of `copied ✓`); the rules card's per-rule jump follows. Their labels swap through a `[data-label]` span so the icon survives, and the copy button still holds a fixed width across `copy` / `copying…` / `copied`
-   **An unpinned bar no longer retracts while you are editing.** Unpinning is for keeping the bar out of the way as you browse; in edit mode the bar carries the save state and the only way out, so it must never be off-screen. It now behaves as pinned for the whole of edit mode (on the edge, translucent at rest, no hairline) and returns to sliding away once you leave. The pin preference itself is untouched — and the pin button says so while editing
-   **The element tree is opt-in.** Turning on edit mode no longer opens it — the panel stays closed with only its left-edge tab showing, and opens when you click that tab or **Elements** on the bar. Entering edit mode to change one paragraph shouldn't cover the layout you came to edit. Whether it is open is remembered for the session (`sessionStorage`, alongside edit mode), so the save-triggered reload restores it the way you left it, and re-entering edit mode reopens it if it was open when you left
-   The element tree's chevrons, leaf markers and close button are inline SVG icons rather than `▸ ▾ · ✕`
-   The element tree is positioned by top **and bottom** rather than a fixed height, and keeps clear of the admin bar's strip whichever edge it is docked to — pinned or not, since retraction is transient and the panel must not reflow every time the bar slides in
-   Toasts lift above a bottom-docked bar, and the hover pill drops below its element rather than hiding under the bar. Both read a shared chrome inset (`ui.ts::setChromeInset`), which the bar is the only writer of
-   The element-tree panel now floats inset from the viewport edge (`5px` margins, `6px` border radius, `calc(100vh - 10px)` tall) over a darker translucent background instead of docking flush to the left edge at full height
-   Uploads accept an optional `targetDir`, confined to the configured asset directories (`assetDirs` plus `uploadDir`/`imageUploadDir`). Anything outside them, or escaping the project root, is ignored in favour of the fallback directory and logged — a client-supplied target must never become a "write a file anywhere under the root" capability
-   Uploading an animated GIF to an `image()` field is refused (422). Astro optimises those assets, which flattens the animation to a single frame; the refusal points at `public/` plus a plain `<img src>` instead. GIF uploads for web-path fields are unaffected
-   `buildImageField` now takes an options object rather than positional `(initial, onChange)` arguments, so it can receive the field's asset mode and entry path. Internal to the client overlay; no effect on the public option surface

### Security

-   New `paths.ts::resolveUploadDir` is the single gate for a client-requested upload directory: realpath-free string confinement to the configured asset directories, falling back rather than throwing. Uploads continue to write only new asset files, never source patches

## \[0.6.0\] - 2026-07-24

### Added

-   **Element-tree panel in edit mode.** Turning on edit mode now docks a panel to the left of the viewport listing every source-annotated element on the page as a collapsible tree, two-way highlight-linked to the page. Hovering a row drives the same outline + verdict pill a page hover shows (and its class/ID chips); hovering an element on the page highlights its row and scrolls the tree to it. Clicking a row **locks** a persistent selection (the tree's own outline) and scrolls the element into view — it stays put while you move the mouse onto the element to inspect it, and clears only on Escape, a click elsewhere on the page, or selecting another row. Double-clicking a row opens the editor for that element, and clicking a row's `line:col` jumps your editor straight to that file and line (the same `/open` the hover pill's "open ↗" uses). The panel coexists with editing (it never claims the interaction slot) and is overlaid by the CMS drawer; it rebuilds itself after each HMR save, preserving collapse and selection state
-   New `atx-*` theming hooks for the tree: `.atx-tree` (the panel), `.atx-tree-title` / `-text` / `.atx-tree-close` (the header), `.atx-tree-body`, `.atx-tree-row` with `.atx-tree-chevron`, `-tag`, `-preview`, `-loc`, `.atx-tree-empty`, and `.atx-tree-selection` (the locked-selection outline)

## \[0.5.0\] - 2026-07-24

### Added

-   **CSS class/ID inspector in the hover pill.** With the inspector on (the new `cssInspector` option, default `true`), the hover pill grows a second row listing the element's classes and its ID as chips. Hovering a chip pops a card of the CSS rules that element actually matches through that class/ID — selector and syntax-highlighted declarations, read straight from the browser's `document.styleSheets`, so the whole display needs no server round-trip. Each rule with a resolvable source offers an `open ↗` that jumps the editor to (near) the rule. Rules from cross-origin stylesheets are skipped; Astro's `astro-*` scope class is filtered out; a rule whose source can't be resolved (inline `<style>`) still shows its CSS, just without the open link
-   New `cssInspector` option (default `true`); `false` disables the whole surface (no chips render). New `/inspect/open` endpoint backs the open-at-rule jump — it best-effort locates the selector in its source (for `.astro`, only within `<style>` blocks) and launches the editor there, falling back to the file top on a miss. The jump additionally honors `openInEditor`; the `.css` extension is admitted for *opening* only (never the write-side `editableExtensions`), and the path stays confined to `contentRoots`, so `node_modules`/external CSS is still excluded
-   New `atx-*` theming hooks for the inspector: `.atx-tooltip-row` (the pill's loc/verdict line), `.atx-tooltip-chips` and `.atx-tooltip-chip` (the class/ID chips), and the rules card `.atx-tooltip-rules` with `.atx-tooltip-rule`, `-sel`, `-decl`, `-foot`, `-src`, `-open`, and `.atx-tooltip-rules-empty`

### Fixed

-   Elements rendered by a package no longer spam the dev log with `classify failed: path is outside the editable content roots`. Astro's `astro:assets` `<Image>` renders through `node_modules/astro/components/Image.astro`, and that is the path the source annotation carries — so on any site using `<Image>`, merely *hovering* (the tooltip verdict calls `/classify` too) threw a 400 and logged a WARN. An out-of-root path is a legitimate "not editable here" answer, so `/classify` now returns a normal `dynamic` verdict for it, naming the package when the path is inside `node_modules`. Clicking the hover pill's `file:loc` label on such an element hits `/peek`, which likewise now refuses with an explanation (200 + `refused`, no source returned) instead of a 400
-   `POST /peek` responses gained an optional `refused` field carrying that explanation; the peek panel renders it in place of the code pane
-   Overlay panels now scroll on host pages that run a smooth-scroll library. Lenis, Locomotive and GSAP ScrollSmoother `preventDefault()` every `wheel` event on `window` and drive the page themselves, so a nested overflow container never scrolled — trying to scroll the source peek moved the page underneath it instead. Every scrollable surface (source peek, panel and drawer bodies, the asset list, the rich body editor) now goes through a shared `isolateScroll` helper: `overscroll-behavior: contain`, the `data-lenis-prevent` / `data-scroll-ignore` opt-out attributes those libraries resolve with `closest()`, and passive `wheel`/`touchmove` listeners that stop propagation before a window-level listener sees them. Nothing calls `preventDefault`, so page scrolling outside the overlay is unchanged

### Changed

-   The hover pill now sits fully above the highlighted element, positioned by its measured height (dropping just below only when there's no room above), so the new class/ID chips row — or any future taller pill — never overlaps the element. It previously used a fixed offset that assumed a single-line height
-   The overlay controls (`.atx-controls`) now sit `16px` from the bottom of the viewport instead of `64px`. The former offset lifted the Edit/entry pills clear of Astro's dev toolbar bar; they now sit lower and may overlap the toolbar when it's shown. The hold-to-navigate hint (`.atx-toggle-hint`) now sits to the left of the Edit pill rather than below it, so it stays on-screen at the new lower position
-   `paths.ts` now exposes `checkEditablePath()`, a non-throwing form of the path gate returning `{ok, code, reason}`, with `validateEditablePath()` re-expressed as the throwing wrapper over it. Read-only routes (`/classify`, `/peek`) use the former so they can answer instead of erroring; every route that writes or launches a file (`/apply`, `/open`, and the entry routes) keeps the identical throwing gate. Package internals stay unwritable — widening `contentRoots` to include `node_modules` remains the wrong fix and is called out as such in the README

## \[0.4.0\] - 2026-07-20

### Added

-   **Astro 7 support via self-annotation.** Astro 7's Rust compiler doesn't emit the `data-astro-source-*` attributes the feature rides on, so the integration now injects them itself: a pre-compiler Vite transform (`src/server/annotate.ts`) parses each `.astro` file with the WASM compiler and stamps every plain element with the same file/loc annotation Astro 5/6 emitted — loc-rule-identical to the patcher, so classify/apply work unchanged against the on-disk source. Verified end-to-end on Astro 7.1.1 (annotation coverage, classify, inline edit, on-disk write, post-HMR re-capture). Details in [docs/ASTRO-COMPAT.md](docs/ASTRO-COMPAT.md)
-   New `sourceAnnotations` option (`'auto'` | `'force'` | `'off'`, default `'auto'`): `'auto'` injects only on Astro ≥7 (or when the Astro version can't be resolved); `'force'` always injects — which also lifts the dev-toolbar requirement on Astro 5/6; `'off'` never injects. The peer range widened back from `>=5.0.0 <7` to `>=5.0.0 <8`
-   New `entryEditor.collections.<name>.extension` option (`'.md'` | `'.mdx'`) fixing the extension used for entries created via the panel

### Fixed

-   Image edits that change both the file and the alt text are now written in a single atomic pass, closing a partial-failure window. The image panel previously sent two sequential `/apply` requests (src, then alt); if the first succeeded and the second failed, the file was left half-updated while the overlay reverted both attributes, so page and source disagreed until reload. `/apply` now takes an `ops` array and the server does one verify-all-then-write-once pass — a single failing op writes nothing to disk
-   Entry create now matches the collection's file extension instead of always writing `.md`: the per-collection `extension` config wins; otherwise, when every existing entry in the collection shares one extension, new entries follow it (an all-`.mdx` collection gets `.mdx`); mixed or empty collections still fall back to `.md`. The chosen extension is validated against `editableExtensions` (422 when excluded)
-   `decodeEntities` now knows the common typographic named entities (`&mdash;`, `&ndash;`, `&hellip;`, curly single/double quotes, `&laquo;`/`&raquo;`, `&middot;`, `&bull;`, `&copy;`, `&reg;`, `&trade;`, `&sect;`, `&deg;`, `&times;`, `&euro;`, `&pound;`), so editing text whose source spells them as references no longer refuses with a `mismatch`. Unknown entities still pass through undecoded and fail safe
-   After creating an entry the client now polls the new page's URL until Astro's content layer has synced it (250ms interval, ~10s cap, then navigates regardless) instead of a fixed 800ms wait — a slow sync lands on the rendered page instead of a 404

### Changed

-   Narrowed the `astro` peer range to `>=5.0.0 <7` (superseded above by self-annotation, which widened it to `<8`). Astro 7 makes the rewritten Rust compiler (`@astrojs/compiler-rs`) the default, and it no longer emits the `data-astro-source-file` / `-loc` attributes the whole feature depends on — so click-to-edit was inert on Astro 7 (the entry drawer, which uses the page-source meta + content config, still worked). Filed [withastro/compiler-rs#96](https://github.com/withastro/compiler-rs/issues/96) upstream; full write-up, including the two-phase history and other tools on the same mechanism, in [docs/ASTRO-COMPAT.md](docs/ASTRO-COMPAT.md)
-   The playground now pins `astro` to `^7.0.0`, so the self-annotation regime is what the manual checklist exercises (Astro 5/6 keep their coverage through the loc-parity tests in `tests/annotate.test.ts`, which pin the same rules their compiler uses)
-   The image swap panel and the entry drawer's image field now share one `buildAssetPicker` primitive (`src/client/editors/asset-picker.ts`) for the upload drop-zone and existing-asset browser, instead of each carrying its own copy. As a side effect the entry drawer's image picker gains the swap panel's richer list — retry-on-load-failure, a neutral fallback tile for thumbnails that don't load, hover states, and a highlight on the current selection

## \[0.3.0\] - 2026-07-19

### Added

-   Source peek: a read-only, syntax-highlighted view of the whole source file, shown in a wide in-browser panel scrolled to the element's line (line numbers, the focus line highlighted and centered, an **Open in editor** jump-out button; pathological multi-thousand-line files are trimmed to ±1000 lines around the focus, with "⋯ N more lines" markers). Backed by a new localhost-only `POST /__text-edit/peek` endpoint that goes through the same path gate as every other file-touching route and never writes
-   The refusal notice's `file:line:col` line is now clickable and opens the source peek — you can see *why* content refused without leaving the browser

### Changed

-   Clicking the hover pill's `file:loc` label now opens the source peek instead of jumping to the editor; the "open ↗" button next to it still opens the location in your editor

-   The playground is now a neutral fictional site ("Copydesk", about visual editing for Astro) instead of a copy of a real business site — real branding, personal names, and company details are gone from the repo, and the imagery is replaced by tiny generated SVG placeholders. The blog collection schema now includes an enum `category` and a boolean `draft`, so the entry drawer's select and toggle widgets are exercised by real fixtures, and two entries are purpose-built: one with a markdown table (pins the raw-only body mode) and one draft (kept off the listing, page still renders)
-   The playground's accent color changed from terracotta orange to the overlay's edit-button purple (`#7c5cff`), with the warm cream/sand neutrals shifted to cool lavender-tinted equivalents and the placeholder SVGs regenerated to match; the CSS variables are now named `--accent`/`--accent-dark`

## \[0.2.0\] - 2026-07-19

### Changed

-   The hover pill no longer guesses editability from the DOM (which false-flagged resolved `{expressions}` as editable): it now appears instantly in a neutral "checking" state (muted outline, `file:loc · loading…`), and once the pointer rests on one element for ~500ms it is confirmed against the server's AST classification and upgrades to the verdict a click would get — `editable`, `image`, or `dynamic`. The verdict occupies a fixed-width slot in the pill, so the pill doesn't resize when the verdict lands. Verdicts are cached per element until the next HMR update, so a re-hover shows its verdict immediately and each element costs at most one `/classify` per file version; sweeping the mouse across the page fires no requests at all

## \[0.1.1\] - 2026-07-18

### Added

-   Content collection entry editing: frontmatter patching, content collection schema introspection, and an asset picker
-   Navigate-while-held: holding Ctrl or Alt/Option in edit mode suspends editing so clicks travel the site normally (link clicks are re-dispatched as plain navigation, since natively Alt+click downloads, Ctrl+click opens a new tab, and macOS treats Ctrl+click as a right-click); a small "hold … to navigate" annotation under the toggle surfaces the feature
-   Playground blog content, layouts, and nav/footer components to exercise entry editing end-to-end
-   `uploadDir` option (default `public`) controls where image uploads are written; a preflight warning fires when it points outside `public/`, where a plain `<img src>` would 404 in a production build
-   WYSIWYG body editor in the entry drawer: formatting toolbar (bold, italic, strikethrough, heading levels, lists, quote, code block, inline code, link, insert image) over a contenteditable surface, with an MD/Rich toggle; bodies using markdown outside the supported subset (tables, raw HTML/MDX, footnotes, nested lists) open in raw-markdown mode and refuse a lossy switch to rich
-   A small ✕ button, revealed while hovering the corner buttons, hides them (and turns edit mode off) until the next page reload
-   The hover pill's `file:loc` label is clickable and jumps to the source location, same as the "open ↗" button next to it

### Changed

-   The ✎ Edit entry button is now always visible on pages that declare a backing content file — a one-click CMS action, no longer gated behind edit mode
-   The edit toggle gained the ✎ icon and both floating pills share a fixed width so they render as an aligned stack
-   The corner buttons and the navigate hint now live in one wrapper (`#atx-controls`) — CSS overrides that repositioned `#atx-toggle` should target the wrapper instead; the pills are dimmed to 60% opacity until hovered, their labels are left-aligned so the ✎ icon sits in the same spot on both, and the "hold … to navigate" hint is anchored 10px below the buttons
-   Entry drawer widened to 50% of the viewport (still ≥440px, capped at 94vw on small screens)
-   Image field redesigned: large 240×160 preview above the path input, click-to-browse on the preview, and a placeholder (never a broken image) when the path is empty or fails to load
-   Clicking an image inside the rich body editor opens the picker to replace it
-   Alt-text field in the image insert/replace panel; a newly inserted image auto-suggests alt from the picked file's name (until edited by hand), while editing an existing image never changes its alt on its own
-   Rich editor toolbar and image insert/replace panel share a sticky header, so the image UI stays in the viewport when editing far down a long body
-   Rich editor surface is white with dark text (like the rendered page); drawer and panels restore normal per-element cursors instead of inheriting edit mode's crosshair

### Fixed

-   Moving the mouse from an element up to its hover pill often crossed a different annotated element (typically the parent) and instantly retargeted the highlight, yanking the pill away before it could be clicked; switching the highlight to a different element now waits out a short dwell (~150ms), cancelled by reaching the pill or returning to the element — the first highlight is still instant
-   Image uploads wrote into the first `assetDirs` entry (`src/assets` by default), producing an `<img src="/src/assets/…">` that works in the dev server but 404s in a production build; uploads now go to the configurable `uploadDir` under `public/`, and the uploaded file is offered by the swap panel afterwards
-   Clicking an existing image in the rich body editor pre-filled its alt text from the filename the moment the panel opened, so a plain Replace could silently rewrite the alt; existing images' alt is now left untouched (filename auto-suggest applies only to newly inserted images)
-   Bare block-level images (not wrapped in a paragraph) were dropped by the rich editor's markdown serialization; they now serialize as `![alt](src)`
-   Date fields already rendered as a native date picker, but its calendar icon was a near-invisible dark glyph on the dark input; `color-scheme: dark` on form controls makes the picker icon and popup (and number spinners) render light and discoverable

### Security

-   The open-in-editor endpoint (`/open`) confined client-supplied paths with a weaker string-space check than the edit endpoints (no symlink resolution, no content-roots or extension check); it now goes through the same `validateEditablePath` gate as `/classify` and `/apply`, so nonexistent paths, symlinks resolving outside the content roots, and non-editable file types are rejected before anything reaches `launch-editor`

## \[0.1.0\] - 2026-07-18

Initial alpha baseline. Never tagged on its own — first shipped as part of the v0.1.1 tag.

### Added

-   Overlay-based inline editor for Astro markdown content
-   Wire protocol (`shared/protocol.ts`), shared type-only between client and server
-   Server middleware route table with a pluggable patcher registry
-   Vitest characterization tests pinning patcher and middleware behavior

### Changed

-   Split the client into focused modules (`api.ts`, `ui.ts`, `overlay.ts`, `editors/`), with `overlay.ts` as the composition root
-   Replaced ad hoc interaction flags with a single token-based state controller
