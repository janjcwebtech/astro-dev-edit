# Follow-ups

Known, deliberate deferrals — behavior quirks the 2026-07 refactor documented
but did not change, plus improvement candidates it surfaced. Each is small and
self-contained; none blocks current functionality.

## Batched image apply (partial-failure window)

`commitImageEdit` (src/client/editors/image.ts) sends up to two sequential
`/apply` requests (src, then alt). If the first succeeds and the second fails,
the file is half-updated while the UI reverts both attributes — the page and
the source disagree until reload. Fix: extend the wire protocol so one
`/apply` accepts an ops array and the server does a single
verify-all-then-write-once pass.

## Verify strictness differs between text and attributes

Text content verification is whitespace-normalized
(`normalize()` in src/patcher/astro.ts); attribute verification is exact.
Both are pinned by tests. Decide deliberately whether attrs should normalize
too, and align.

## Named-entity coverage in `decodeEntities`

`decodeEntities` (src/patcher/astro.ts) knows six named entities
(amp/lt/gt/quot/apos/nbsp); anything else passes through undecoded, so source
text containing e.g. `&mdash;` never matches the rendered original and every
edit of it refuses with `mismatch` (fails safe, verified live in the
playground). Fix: decode the full HTML named-entity set — or at least the
common typographic ones (mdash, ndash, hellip, rsquo, lsquo, rdquo, ldquo,
copy, trade) — in both the compare and (escaped) write paths.

## Finish the asset-picker extraction

The entry drawer's image field (src/client/editors/asset-picker.ts) reuses
api.upload/getAssets but the image swap panel (editors/image.ts) still carries
its own copy of the drop-zone + asset-list wiring. Fold image.ts onto
buildImageField (keeping its live-<img> preview behaviour) so the upload/list
UI exists once.

## Entry create writes `.md` only

`/entry/create` (src/server/entry-routes.ts) always writes `<slug>.md`, even
though the entry editor reads/edits `.mdx` too. Creating an entry in an
all-MDX collection therefore produces a plain markdown file. Fix: let config
(or the collection's existing entries) pick the extension, and thread it
through `EntryCreateRequest`.

## Entry create navigates by convention

After /entry/create the client waits ~800ms for the content layer to sync,
then navigates to the sibling URL (swap the last path segment for the new
slug). A non-conventional detail route or a slow sync still 404s until reload.
Options: poll the new URL until it stops 404ing, or let config declare a
detail-route template per collection.
