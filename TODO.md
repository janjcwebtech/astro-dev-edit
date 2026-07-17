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

## `/open` path validation is weaker than the edit endpoints

The open-in-editor route (src/server/middleware.ts) confines the path with
`insideRoot()` only — no `realpath` (symlinks unresolved), no contentRoots
check, no extension check — while `/classify`/`/apply` go through
`validateEditablePath`. Harmless today (it only opens an editor), but the
asymmetry is unearned. Fix: route it through `validateEditablePath` with a
relaxed extension list, or a shared `confine(level)` helper in
src/server/paths.ts.

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
