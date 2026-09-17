# Component tracing API

The opt-in tracing layer supplies source chains and component usage data to an
inspector. It is available through the normal integration:

```js
devEdit({ composition: true })
```

`composition` defaults to `false` and is config-only: changing it requires a dev
server restart. It installs the version-2 annotation transform, even when
`sourceAnnotations` is `off`. Builds and previews install neither the transform
nor the API. This option selects the read-only inspector described below.
Staged edits, prop writes and HTML-string writes are not part of this layer.

## Read-only inspector

The left-edge launcher opens the element tree. Click a tree row, or hold
Alt/Option and click an element on the page, to inspect it. Releasing the key
returns clicks to the page while keeping the selection and inspector open.
Close or Escape clears the selection. With `composition: false`, the existing
editing UI remains available.

The tree panel's own header carries every tool-wide action, because this mode
mounts no toolbar:

- **Title bar:** a `☰` menu, a `⚙` settings button opening the integration
  settings drawer, then close. The menu holds **Copy page context** — the
  route, its template, a declared backing content file, annotated-element
  counts and the components resolved on this route, as markdown — and
  **Re-scan the page**, which re-reads annotations and rebuilds the tree.
- **Route row:** the current path, the file the route is written in, and a
  **View code** button opening that file. The route source is resolved once per
  page; until it resolves the row reads `route source unresolved`.

The panel shows:

- **Values:** a read-only rendered text or image-attribute snapshot and its
  original source location. A known page backing file has a separate source
  link; it does not claim that every value comes from that file.
- **Component chain:** a proven runtime chain, an explicitly inferred static
  path, separate candidate paths, or a named refusal. Component rows offer
  **View code** for the component and **Open parent** for its usage site.
  Usage details show prop and slot source text without evaluating it.
- **Slot relationships:** all enclosing native-slot insertion boundaries,
  including forwarded slots and fallback content, with links to the receiving
  `<slot>` locations. The selected element's own source remains separate.
- **CSS:** inline declarations, computed values and readable matched selectors
  in stylesheet order. Conditional matches may be inactive, and inaccessible
  cross-origin sheets are omitted. Available stylesheet sources offer an
  **Open in editor** jump; selector location is best-effort.

A component chain row can also be reached from the hover pill's breadcrumb
(below): the segment marks its chain row and scrolls to it, and never replaces
the element the rest of the panel describes.

Source buttons open the existing read-only preview. Its **Open in editor**
action respects the `openInEditor` option; CSS also respects `cssInspector`.
Occurrence counts distinguish repeated insertions of the selected source
element. Route-scoped usage counts describe source sites, including unrendered
branches, rather than runtime instances.

Generated HTML descendants never acquire a chain from copied annotations or
their container. Malformed render/slot metadata is refused. Incomplete graph
coverage is displayed separately from a proven chain. Source changes during
discovery are retried once; rapid selection changes and closed panels discard
late responses. Navigation, HMR and removal of the selected DOM node clear the
selection, so render identities are not carried onto a replacement page.

Run `npm run dev:composition` for a fixture using this integration. `/advanced`
exercises repeated components and slots; `/cached` contains replayed HTML.
[Tracing mechanics and boundaries](COMPOSITION-PROOF.md) describe the identities
and supported source relationships.

## Contract

All three endpoints are read-only `POST`s under `/__dev-edit`. They share the
existing localhost/origin gate and return JSON. Request bodies are capped at
32 KiB. Invalid request shapes return `400`; named refusals return `200`.
Disabled endpoints return `reason: "disabled"`. `/health` reports `composition`.

| Endpoint | Request | Answer |
| --- | --- | --- |
| `/composition` | `{ pathname, file, chain?, traceVersion?: 2 }` | `tier`, ordered `links`, optional `candidates` / `reason`, `route`, `coverage` |
| `/composition/links` | `{ pathname, ids }` | `links`, `missing`, `route`, `coverage`, optional `reason` |
| `/composition/uses` | `{ pathname, file }` | matching usage `links`, `route`, `coverage`, optional `reason` |

`pathname` is the browser's route, including any configured base. Astro's route
manifest selects the source entrypoint; a client-supplied `route` field cannot
replace it. Files are canonical absolute paths in successful responses. Client
file paths and discovered modules pass the existing source-path gate, restricted
to `.astro` files in `contentRoots`, excluding packages and escaping symlinks.
An unsupported or disallowed entrypoint/selected file returns `path-refused`.

`chain` is `!` for the root, `?` for broken transport, or up to 128 dot-prefixed
usage IDs. Pass `traceVersion: 2` with the fixture's annotations. Version 2
preserves spreads; `?` always returns `none / chain-break`, never a static guess.
Batches accept at most 128 IDs, remove duplicates, preserve requested order and
report unknown IDs in `missing`.

`UsageLink` includes its usage ID, caller file, original source location and
source offsets (JavaScript string indices), component name, resolved target or
refusal, prop source text and slot source ranges. These describe source; they do
not authorize edits or identify an array record.

## Discovery and freshness

Each request discovers the static graph reachable from its route using Vite's
SSR resolver, including aliases and unrendered conditional branches. It reads
current source without depending on previously transformed or visited modules.
`/composition/uses` is **route-scoped**, not a repository-wide caller search.

`coverage` contains:

- `complete`: every reachable supported relationship was explored without a
  refusal or limit;
- `files`: number of allowed modules visited;
- `revision`: the watcher generation, not a source version or write token;
- `issues`: up to 64 named problems, with file and optional usage location.

Unsupported relationships also make coverage incomplete: an opaque component
could hide another path. A known runtime chain can still be `proven` with
incomplete coverage. Static `inferred`, `candidates`, and `no-path` answers require
complete coverage. A cycle reaching the target cannot establish a unique static
instance depth and is refused.

Discovery is capped at 512 files, 2 MiB of source and 4,096 usage links per query.
Hitting a cap reports `index-limit` in coverage. Source read/parse failures and
path refusals also prevent static inference. File and route changes invalidate
in-flight snapshots: a response whose graph changed during discovery returns
`stale-index`, no links, and can be retried. Completed graphs are not cached.
This favors freshness; large-site latency and caching remain unmeasured.

## Client seam

`src/client/api.ts` exports typed `getComposition`, `getCompositionLinks`, and
`getCompositionUses` functions. A selected element supplies:

```ts
const answer = await getComposition({
  pathname: location.pathname,
  file: element.getAttribute('data-atx-file')!,
  chain: element.getAttribute('data-atx-chain')!,
  traceVersion: 2,
});
```

Only use this for a tracked element. Read `readRenderOccurrences(document)` from
`src/client/composition-dom.ts` for repeated instance groups, render ordinals
and slot placements. An occurrence marked `untracked-html` has no proven
inner-element relationship; a malformed placement graph is refused. The source-location reader also ignores
copied annotations beneath `data-atx-boundary="html"`, while retaining the
container's own source target. Editing a known whole HTML string is separate
from tracing its generated descendants.

`src/client/composition.ts` is the batching read side. `chainIds(element)`
parses `data-atx-chain` — `!` (rendered by the route itself) and `?` (threading
broke) are empty chains, and any other shape is refused whole rather than
part-parsed. `createChainLinks(api)` resolves ids through
`getCompositionLinks`, caching per pathname: an id is asked for once, an id the
server reports as `missing` is cached as a miss rather than re-asked, and two
callers wanting the same ids share one request. Call `invalidate()` on
navigation and on every HMR update — ids survive a server restart but not an
edit to the file that mints them.

`src/client/source-map.ts` prefers original `data-atx-file` / `data-atx-loc`
coordinates over legacy compiler annotations. Keep API results and render IDs
scoped to the current page/render; do not treat usage IDs as stable data-record
identities or the watcher revision as a write precondition.

## Render ordinals and write targets

Three things exist for the value-writing layer, and none of them writes
anything yet.

- **`RenderTrace.ordinal`**, on every version-2 element as `data-atx-ordinal`.
  It is counted by `composition-runtime.ts::child()` as the render happens —
  which render of that usage site, under that parent instance, produced this
  element. A second parent counts from 1 again, and `0` means the chain broke
  so nothing counted it. It is a **render count, not an array index**: nothing
  may read it as a source position without the static proof below.
- **`UsageProp.start` / `.end`**, bounding the prop's `source` in the file the
  `UsageLink` names, exactly as `UsageSlot`'s do. Two props on one tag can hold
  the same string, so a write target is a byte range and never a search of the
  tag text. Both are absent when the source does not read back the way the AST
  describes it, and a caller must then refuse rather than fall back to a scan.
- **`expression-trace.ts::locateEntryValue`**, the one-hop trace from
  `{s.title}` to the entry an ordinal names. It proves the correspondence
  first: the array is a literal in this file's frontmatter, holding no spread
  and no elision, so entry *k* is render *k*, and the entry at that ordinal
  carries the property as a plain string literal. A `.filter()`, `.slice()` or
  `.sort()` in the chain, an imported or computed array, or an out-of-range
  ordinal each refuse **by name**.

The inspector combines these read APIs with the existing CSS inspector
and source links. Markdown-backed values open their known backing file in the
IDE; they do not require a Markdown write API. Whole-string content editing and
Save/Revert belong to the separate value-writing layer.

## Verification

Automated coverage lives in `composition-service.test.ts` and
`composition-routes.test.ts`, alongside the compiler/runtime tracing suites.
The API tests exercise the real middleware: route anchoring, unrendered
alternatives, source changes, deletions, live path settings, disabled responses,
request limits, local-request restrictions, and the build guard. Service tests
exercise incomplete discovery, traversal caps, recursion and invalidation during
an asynchronous read.

Verified on the committed fixture with Astro 5.18.2 and 7.1.1: all 45 annotated
`/advanced` elements resolve through the typed API to proven chains, all 45
source locations match the original coordinates, and all 18 native-slot
placements across 14 elements remain after toolbar initialization. Discovery
covers 11 files with no coverage issues. On `/cached`, the four copied roots
remain untracked and do not acquire editable source locations. This is fixture
evidence, not the full hydration or real-site compatibility matrix.

The inspector's request-generation and occurrence-grouping tests live in
`inspector-model.test.ts`. The browser surface issues only read queries and
explicit source-opening requests; it does not enter the legacy editing router.

Browser verification on the fixture covers all 43 selectable annotated elements
on `/advanced`: proven chains, original source-preview lines, repeated insertion
counts, forwarded slot boundaries and page/tree selection. All four copied roots
on `/cached` remain untracked without composition requests. Computed CSS,
selection removal and navigation invalidation are also checked. This is fixture
evidence, not a full hydration or browser compatibility matrix.

`npm run typecheck` and `ATX_ASTRO5_ROOT=examples/sf-sf npm test` are the validation
commands. Without `ATX_ASTRO5_ROOT`, `composition-render.test.ts` silently skips its
Go-compiler leg — 5 tests instead of 10 — and reports a pass either way.
