# Component tracing API

The opt-in tracing layer supplies source chains and component usage data to an
inspector. It is available through the normal integration:

```js
devEdit({ composition: true })
```

`composition` defaults to `false` and is config-only: changing it requires a dev
server restart. It installs the version-2 annotation transform in place of the
plain one, even when `sourceAnnotations` is `off`. Builds and previews install neither the transform
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
- **Route row:** the current path, the project-relative path of the file the
  route is written in, and a **View code** button opening that file. The route
  source is resolved once per page; until it resolves the row reads
  `route source unresolved`.
- **Tree rows:** each row is its tag, a `</>` opening that file at that line,
  and a tooltip above the row naming the file, line and column. A row where the tree crosses
  into another file carries a mark, and only that row does — `❖` where a
  component's own markup begins, an amber in-arrow where the content was
  passed in through a `<slot />`, named alongside the slot and its receiving
  file. A legend under the tree names both.

Every card on it collapses from the chevron in its header. Its own two bands
sit above them: a title bar naming the tool and the selected tag with the
close, and a status row carrying the chain's tier, a **saved** or **N unsaved**
chip once there is something to report, and **Copy context** — this element's selector, source
loc, chain and applied CSS as one paste. A card's caveat is not a line under
its title: it hangs off the ⓘ beside it, shown on hover.

The panel shows, in this order:

- **Component chain** first — see below. Where a value came from is what tells
  you whether the values under it are the ones you meant.
- **Values:** one row per value on the selection. The clicked
  value is pinned first — marked *selected element*, badged *via slot* when
  slot markup wraps it, and ruled with a bar down its edge — followed by the
  values the **nearest** usage site passes. Values handed down from further up
  the chain are not listed: they belong to that component, and selecting it
  shows them. Every
  row carries its verdict — `editable`, `elsewhere` or `read-only` — at its
  right edge, a plain caption, the value in a box whether or not it can be
  typed into (a dashed one where it cannot), and **View code** on the file
  holding the words, named once. Mechanism vocabulary sits behind *Details*. A
  selection with no value at all collapses the card to *nothing writable on
  this selection* plus the reason and a jump to whatever source is known.
  A row the write path serves carries a field and one Save/Revert pair instead
  of a read-only value — see [Staged values and Save](EDITING.md#staged-values-and-save).
  A usage-site prop or slot value says so and offers **View code** only.
- **Component chain:** a proven runtime chain, an explicitly inferred static
  path, separate candidate paths, or a named refusal — the status row says
  which in one word (*proven chain*, *one link inferred*, *no chain*) and the
  reason sits at the top of the card. Drawn as a tree, indented by depth: the
  route entry, then a level per component, then the element the chain ends at,
  with a rule where the rows stop. A component row is badged *presentation*
  when the usage renders the selected element's own file and *content* when it
  supplies any writable value. **Selecting a row** — clicking it, or arriving
  from a breadcrumb — reveals **View code** for the component, **Open parent**
  for its usage site, and the props and slots that usage passes with their
  verdicts; the values themselves are Values rows.
- **Slot relationships:** all enclosing native-slot insertion boundaries,
  including forwarded slots and fallback content, with links to the receiving
  `<slot>` locations. The selected element's own source remains separate. An
  unannotated element that *wraps* a boundary gets a row for it too — see
  below.

**An element rendered from a dynamic tag** — `<Tag {...attributes}><slot /></Tag>`,
where `Tag` is a variable — carries no annotation from anyone: a tag name that
is a value cannot be stamped, and injecting into the attribute position is
refused because `Tag` may resolve to a component, where the attributes would
become props. The panel names it instead of stopping at *no source annotation*:
the slot boundary such an element wraps identifies the component that rendered
it and the first annotated element inside identifies where the words were
written, so Values refuses with both named, *View code* is offered on each, and
the slot row says which `<slot />` is wrapped. Selecting an element inside gives
the full chain, unchanged.
- **CSS:** inline declarations, readable matched selectors in stylesheet order,
  and computed values behind a disclosure. Each rule is shown as source — the
  same syntax-tinted block the hover pill's class chips pop — with the file it
  came from on a band underneath, offering an **Open in editor** jump where the
  source is available (selector location is best-effort). Chips above the list
  filter it to one of the element's classes; they never reorder it, because
  among equal specificity the cascade *is* document order. Conditional matches
  may be inactive, and inaccessible cross-origin sheets are omitted.

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
coverage is reported on the wire but no longer shown in the panel: a file the
walker could not follow is rarely the reason the chain in front of you is
wrong, and the list read as a defect report for the site. Source changes during
discovery are retried once; rapid selection changes and closed panels discard
late responses. Navigation, HMR and removal of the selected DOM node clear the
selection, so render identities are not carried onto a replacement page.

Run `npm run dev:composition` for a fixture using this integration. `/advanced`
exercises repeated components and slots; `/cached` contains replayed HTML.
[Tracing mechanics and boundaries](COMPOSITION-PROOF.md) describe the identities
and supported source relationships.

## Contract

All four endpoints are `POST`s under `/__dev-edit` sharing the existing
localhost/origin gate, and only `/composition/apply` writes. The three read
endpoints cap request bodies at 32 KiB; invalid shapes return `400`, named
refusals return `200`, and a disabled endpoint returns `reason: "disabled"`.
`/health` reports `composition`.

| Endpoint | Request | Answer |
| --- | --- | --- |
| `/composition` | `{ pathname, file, chain?, traceVersion?: 2, ordinals? }` | `tier`, ordered `links`, optional `candidates` / `reason`, `route`, `coverage` |
| `/composition/links` | `{ pathname, ids }` | `links`, `missing`, `route`, `coverage`, optional `reason` |
| `/composition/uses` | `{ pathname, file }` | matching usage `links`, `route`, `coverage`, optional `reason` |
| `/composition/apply` | `{ pathname, usageId, target, ordinal?, original, newText }` | `{ ok: true }`, or `422` with `error` and a `code` |

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

`ordinals` maps usage IDs to render counts, at most 128 of them, each a
non-negative integer — see [Render ordinals](#render-ordinals-and-write-targets).
They are applied only to a `proven` chain.

`/composition/apply` caps its body at 256 KiB and names a **usage ID, never a
path**. `target` is `{ kind: "prop" | "slot", name, start }`, where `start` is
the byte offset the panel was shown — a *selector* among the values the server
parses for itself, not an offset to write into. The file the ID resolves to
passes the same source-path gate as every other write, the bytes go through
the one injected write seam, and the path joins `textMutationPaths` so writes
queue with every other file mutation. It refuses unless the value's verdict is
`editable` and `original` still equals the words the source holds.

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
from tracing its generated descendants: the container owns the string, and the
elements it produces stay untracked.

A `set:html` on a **component** tag keeps its `chain-break` refusal, so its prop
never reaches the panel. The injected HTML lands in the component's slot, where
there is no container element to mark `data-atx-boundary="html"`, and the source
reader would attribute those elements to the component's own template.

`src/client/composition.ts` is the batching read side. `chainIds(element)`
parses `data-atx-chain` — `!` (rendered by the route itself) and `?` (threading
broke) are empty chains, and any other shape is refused whole rather than
part-parsed. `createChainLinks(api)` resolves ids through
`getCompositionLinks`, caching per pathname: an id is asked for once, an id the
server reports as `missing` is cached as a miss rather than re-asked, and two
callers wanting the same ids share one request. Call `invalidate()` on
navigation and on every HMR update — ids survive a server restart but not an
edit to the file that mints them.

`src/client/source-map.ts` reads `data-atx-file` / `data-atx-loc` and nothing
else — the integration stamps them on every supported Astro version and the dev
toolbar does not strip them. Astro's own `data-astro-source-*` is not read at
all: the toolbar strips it on both majors, and on 5/6 its loc is shifted by the
injection, so it is never original coordinates. Keep API results and render IDs
scoped to the current page/render; do not treat usage IDs as stable data-record
identities or the watcher revision as a write precondition.

## Render ordinals and write targets

- **`RenderTrace.ordinal`**, on every version-2 element as `data-atx-ordinal`.
  It is counted by `composition-runtime.ts::child()` as the render happens —
  which render of that usage site, under that parent instance, produced this
  element. A second parent counts from 1 again, and `0` means the chain broke
  so nothing counted it. It is a **render count, not an array index**: nothing
  may read it as a source position without the static proof below.
- **`render-occurrences.ts::chainOrdinals`**, the client's walk from the
  selected element up its instance parents, giving each usage ID in the chain
  the render count that produced the next hop. A hop whose instance emitted no
  annotated element stops the walk; one usage ID reached with two different
  counts — recursion through a single source site — answers nothing at all.
  The result travels as the `ordinals` field of a `/composition` request.
- **`UsageProp.start` / `.end`**, bounding the prop's `source` in the file the
  `UsageLink` names, exactly as `UsageSlot`'s do. Two props on one tag can hold
  the same string, so a write target is a byte range and never a search of the
  tag text. Both are absent when the source does not read back the way the AST
  describes it, and a caller must then refuse rather than fall back to a scan.
- **`UsageProp.verdict` / `UsageSlot.verdict`**, in three states rather than
  two, with an `editable` verdict carrying the `value` it edits — the words,
  decoded out of the syntax that carries them: a quoted attribute without its
  quotes or entities, the frontmatter literal a traced prop reads, the text of
  a slot run. `source` stays the bytes `start`/`end` bound.
  `editable` is a value this file can write, `elsewhere` is one that is
  writable in the module the same object names in `from`, and `read-only` is
  one with no string to write. Every verdict but `editable` carries a named
  `reason` — `styling`, `directive`, `spread`, `boolean`, `computed`,
  `template`, `untraced`, `unproven-entry`, `markup`, `empty`, `unlocated`,
  `unsupported`, `imported` — decided in `usage-parse.ts` beside the byte range
  it needs. `elsewhere` names a module; it never resolves or follows one.
- **`unproven-entry`**, the refusal a value read from a `.map()` carries until
  its ordinal arrives. The trace resolves and the array holds matching
  literals, which proves only that *some* entry matches — every card in the
  loop shares one usage site, so an `editable` verdict would aim every field at
  entry 1. It is the one refusal that carries its `trace`, because it is the
  one that can be earned back: `usage-parse.ts::proveEntry` meets it with the
  ordinal and turns it into `editable` when — and only when —
  `locateEntryValue` proves the entry. A value in the same loop that does not
  read from the array is unambiguous and stays `editable`.
- **Only a `proven` chain spends an ordinal.** An inferred path or a candidate
  set names a *possible* usage site, never the instance that rendered this
  element, so a render count aimed at one would be a guess wearing a proof.
- **`expression-trace.ts::locateEntryValue`**, the one-hop trace from
  `{s.title}` to the entry an ordinal names. It proves the correspondence
  first: the array is a literal in this file's frontmatter, holding no spread
  and no elision, so entry *k* is render *k*, and the entry at that ordinal
  carries the property as a plain string literal. A `.filter()`, `.slice()` or
  `.sort()` in the chain, an imported or computed array, or an out-of-range
  ordinal each refuse **by name**.

- **`usage-write.ts::applyUsageWrite`**, the pure writer. It is a *sibling* of
  `patcher/astro.ts::resolveElement`, not a loosening of it: that function
  matches a plain element by the loc Astro would have annotated, and a
  component tag carries no annotation, so the usage site's own loc is the
  address instead. Content is accepted and source syntax preserved — a quoted
  attribute is encoded with `escapeAttrValue`, a frontmatter literal with
  `encodeLiteral` in the quote style already there, slot text as template text
  — and the patched source is parsed again so the value has to **read back** as
  exactly what was typed. A line break is refused, because it would move every
  usage site below it and a usage site is addressed by its loc.

The inspector combines these read APIs with the existing CSS inspector
and source links. Markdown-backed values open their known backing file in the
IDE; they do not require a Markdown write API. Element values are staged and
saved through `/apply`; a prop or slot value at a usage site goes through
`/composition/apply` ([Staged values and Save](EDITING.md#staged-values-and-save)).
A whole HTML string goes through whichever of the two owns its destination: a
`set:html` container through `/apply` as an `html` target, a `set:html` prop at
a usage site through `/composition/apply`.

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
