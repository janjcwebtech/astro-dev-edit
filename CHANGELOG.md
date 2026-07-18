# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/). While the project is in alpha (`0.x.x`), breaking changes may land in minor releases.

No versions have been tagged/published yet — sections below track work as it lands on `main`, and will be stamped with a release date once tagged.

## \[Unreleased\]

Work in progress on the `cms` branch, not yet merged to `main`.

### Added

-   Content collection entry editing: frontmatter patching, content collection schema introspection, and an asset picker
-   Navigate-while-held: holding Ctrl or Alt/Option in edit mode suspends editing so clicks travel the site normally (link clicks are re-dispatched as plain navigation, since natively Alt+click downloads, Ctrl+click opens a new tab, and macOS treats Ctrl+click as a right-click); a small "hold … to navigate" annotation under the toggle surfaces the feature
-   Playground blog content, layouts, and nav/footer components to exercise entry editing end-to-end
-   WYSIWYG body editor in the entry drawer: formatting toolbar (bold, italic, strikethrough, heading levels, lists, quote, code block, inline code, link, insert image) over a contenteditable surface, with an MD/Rich toggle; bodies using markdown outside the supported subset (tables, raw HTML/MDX, footnotes, nested lists) open in raw-markdown mode and refuse a lossy switch to rich
-   A small ✕ button, revealed while hovering the corner buttons, hides them (and turns edit mode off) until the next page reload

### Changed

-   The ✎ Edit entry button is now always visible on pages that declare a backing content file — a one-click CMS action, no longer gated behind edit mode
-   The edit toggle gained the ✎ icon and both floating pills share a fixed width so they render as an aligned stack
-   The corner buttons and the navigate hint now live in one wrapper (`#atx-controls`) — CSS overrides that repositioned `#atx-toggle` should target the wrapper instead; the pills are dimmed to 60% opacity until hovered, their labels are left-aligned so the ✎ icon sits in the same spot on both, and the "hold … to navigate" hint is anchored 10px below the buttons
-   Entry drawer widened to 50% of the viewport (still ≥440px, capped at 94vw on small screens)
-   Image field redesigned: large 240×160 preview above the path input, click-to-browse on the preview, and a placeholder (never a broken image) when the path is empty or fails to load
-   Clicking an image inside the rich body editor opens the picker to replace it
-   Alt-text field in the image insert/replace panel, auto-suggested from the picked file's name until edited by hand; an existing alt is preserved when swapping the file
-   Rich editor toolbar and image insert/replace panel share a sticky header, so the image UI stays in the viewport when editing far down a long body
-   Rich editor surface is white with dark text (like the rendered page); drawer and panels restore normal per-element cursors instead of inheriting edit mode's crosshair

### Fixed

-   Bare block-level images (not wrapped in a paragraph) were dropped by the rich editor's markdown serialization; they now serialize as `![alt](src)`
-   Date fields already rendered as a native date picker, but its calendar icon was a near-invisible dark glyph on the dark input; `color-scheme: dark` on form controls makes the picker icon and popup (and number spinners) render light and discoverable

## \[0.1.0\] - Unreleased

Initial alpha baseline, currently on `main`.

### Added

-   Overlay-based inline editor for Astro markdown content
-   Wire protocol (`shared/protocol.ts`), shared type-only between client and server
-   Server middleware route table with a pluggable patcher registry
-   Vitest characterization tests pinning patcher and middleware behavior

### Changed

-   Split the client into focused modules (`api.ts`, `ui.ts`, `overlay.ts`, `editors/`), with `overlay.ts` as the composition root
-   Replaced ad hoc interaction flags with a single token-based state controller
