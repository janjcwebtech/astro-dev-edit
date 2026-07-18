> # Changelog

`inline code`

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/). While the project is in alpha (`0.x.x`), breaking changes may land in minor releases.

No versions have been tagged/published yet — sections below track work as it lands on `main`, and will be stamped with a release date once tagged.

## \[Unreleased\]

Work in progress on the `cms` branch, not yet merged to `main`.

### Added

-   Content collection entry editing: frontmatter patching, content collection schema introspection, and an asset picker
-   Playground blog content, layouts, and nav/footer components to exercise entry editing end-to-end
-   WYSIWYG body editor in the entry drawer: formatting toolbar (bold, italic, strikethrough, heading levels, lists, quote, code block, inline code, link, insert image) over a contenteditable surface, with an MD/Rich toggle; bodies using markdown outside the supported subset (tables, raw HTML/MDX, footnotes, nested lists) open in raw-markdown mode and refuse a lossy switch to rich

### Changed

-   Entry drawer widened to 50% of the viewport (still ≥440px, capped at 94vw on small screens)
-   Image field redesigned: large 240×160 preview above the path input, click-to-browse on the preview, and a placeholder (never a broken image) when the path is empty or fails to load
-   Clicking an image inside the rich body editor opens the picker to replace it
-   Rich editor toolbar and image insert/replace panel share a sticky header, so the image UI stays in the viewport when editing far down a long body
-   Rich editor surface is white with dark text (like the rendered page); drawer and panels restore normal per-element cursors instead of inheriting edit mode's crosshair

### Fixed

-   Bare block-level images (not wrapped in a paragraph) were dropped by the rich editor's markdown serialization; they now serialize as `![alt](src)`

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
