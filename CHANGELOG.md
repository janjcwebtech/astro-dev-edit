# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/): fix-only releases bump the patch (`0.0.x`), releases with feature work bump the minor (`0.x.0`), and the major (`X.0.0`) moves only on an explicitly confirmed bigger release. While the project is in alpha (`0.x.x`), breaking changes may land in minor releases.

## \[Unreleased\]

### Changed

-   Narrowed the `astro` peer range to `>=5.0.0 <7`. Astro 7 makes the rewritten Rust compiler (`@astrojs/compiler-rs`) the default, and it no longer emits the `data-astro-source-file` / `-loc` attributes the whole feature depends on — so click-to-edit is inert on Astro 7 (the entry drawer, which uses the page-source meta + content config, still works). Verified working on Astro 5.x and 6.x (6.4.8). Filed [withastro/compiler-rs#96](https://github.com/withastro/compiler-rs/issues/96) upstream; full write-up, including the two-phase history and other tools on the same mechanism, in [docs/ASTRO-COMPAT.md](docs/ASTRO-COMPAT.md)

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
