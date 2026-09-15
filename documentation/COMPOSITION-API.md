# Component tracing API

The opt-in tracing layer supplies source chains and component usage data to an
inspector. It is available through the normal integration:

```js
devEdit({ composition: true })
```

`composition` defaults to `false` and is config-only: changing it requires a dev
server restart. It installs the version-2 annotation transform, even when
`sourceAnnotations` is `off`. Builds and previews install neither the transform
nor the API. The existing editing UI remains; this option does not add the new
inspector, staged edits, prop writes or HTML-string writes.

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
`src/client/composition-dom.ts` for repeated instance groups and slot placements.
An occurrence marked `untracked-html` has no proven inner-element relationship;
a malformed placement graph is refused. The source-location reader also ignores
copied annotations beneath `data-atx-boundary="html"`, while retaining the
container's own source target. Editing a known whole HTML string is separate
from tracing its generated descendants.

`src/client/source-map.ts` prefers original `data-atx-file` / `data-atx-loc`
coordinates over legacy compiler annotations. Keep API results and render IDs
scoped to the current page/render; do not treat usage IDs as stable data-record
identities or the watcher revision as a write precondition.

The next inspector can combine these read APIs with the existing CSS inspector
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
source locations match the original coordinates, and all 17 native-slot
placements remain after toolbar initialization. Discovery covers 11 files with
no coverage issues. On `/cached`, the four copied roots remain untracked and do
not acquire editable source locations. This is fixture evidence, not the full
hydration or real-site compatibility matrix.

`npm run typecheck` and `ATX_ASTRO5_ROOT=examples/sf-sf npm test` pass: 942 tests
across 44 files. Vitest still reports the pre-existing shutdown timeout after a
successful run.
