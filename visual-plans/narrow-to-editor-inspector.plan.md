---
plan:
  id: narrow-to-editor-inspector
  title: Narrow astro-dev-edit to an editor and a source inspector
  status: draft
  type: system-design
  priority: high
  created: "2026-09-13"
  updated: "2026-09-14"
  progress: 0
  visual: narrow-to-editor-inspector.plan.html
  mockup: narrow-to-editor-inspector.mockup.html
  tags: [scope-reduction, astro, composition, annotations]
---

# Narrow astro-dev-edit to an editor and a source inspector

Remove the CMS — collection schema designer, entry management, rich-text body editing — and Unsplash; keep on-page editing, CSS peek and open-in-editor; keep a content entry's *values* editable from the page that renders them, which is the one piece of the entry stack that survives; add the capability that motivates the whole exercise — **Astro component-composition inspection**, the chain of `.astro` component usages responsible for the selected content. For one maintainer, optimising for correctness, a small supported scope, and maintainability.

**Visual plan:** [narrow-to-editor-inspector.plan.html](narrow-to-editor-inspector.plan.html) — wireframes, flow, architecture
**Interactive mockup:** [narrow-to-editor-inspector.mockup.html](narrow-to-editor-inspector.mockup.html) — the proposed UI, clickable, built from the real `ui.ts` tokens

---

## Decisions

- **Adapt, don't rebuild** — delete the CMS and keep the engine. The couplings are seams: `protocol.ts:280-980` is one contiguous CMS band (71% of the file), `client/api.ts:178-372` likewise (52%), and route groups are `create<Feature>Routes(deps)` factories concatenated in one place. Removal is ~12 composition-point edits plus ~35 whole-file deletes. Rules out both a fresh implementation and the middle path ("keep the server, rebuild the client"), which is strictly more work than adapting for no correctness gain.
- **Props-threaded usage chain** — manufacture component identity by threading an interned usage id through `Astro.props` in the existing pre-compiler transform. Rules out DOM ancestry (provably wrong across slots and component gaps), import graphs (a component that *could* be used is not one that *was*), and HTML comment markers (Astro's build strips comments; dev behaviour would be an unverified dependency).
- **Own the annotation namespace** — self-inject `data-atx-*` on Astro 5, 6 and 7 while continuing to emit `data-astro-source-*` first. Removes the dev-toolbar dependency and the attribute-strip race. Rules out narrowing to Astro 7 only.
- **Settings stays as a slim drawer** — keeps `drawer.ts`, `group.ts`, `fields.ts` and the switch control alive for ~5 surviving options, and keeps the per-request options resolver earning its keep. Rules out collapsing options to boot-time constants.
- **Local image picker stays, Unsplash goes** — image swap keeps browsing local assets and uploading. Removes ~2,674 LOC including the repo's largest test file, plus `patcher/dotenv.ts` and the secret machinery.
- **Hold ⌥ to wake the tool; no admin bar** — the overlay is asleep until the modifier is held, so the site stays fully usable and ordinary links navigate. The only persistent chrome is a launcher on the left edge; opening it gives the element tree, whose header carries the menu and settings, with the current route and an `⌁ source` pill below. Rules out the persistent edit-mode toggle, the save chip, and the top bar that covered the page.
- **Markdown-backed routes are in scope** — a route rendering a content entry gets frontmatter fields and plain-text body lines as editable targets. Rules out the rich-text editor returning: no HTML→Markdown conversion, and any paragraph carrying inline markup is refused.
- **The inspector opens on every click** — one panel for every element, whatever the verdict. Editable text still edits in place on the page; the inspector shows the context beside it. Rules out the modal refusal notice and the modal image panel, both of which folded into the panel.
- **Props are editable at the usage site, within a proven boundary** — string literals, and expressions that trace one hop to a literal. Everything else (imports, computed values, spreads, `class`) stays read-only with a named reason. Rules out general prop editing.
- **Composition is breadcrumbs on the hover widget; the element tree stays** — the tree becomes component-aware rather than being replaced. Rules out a single unified inspector that swallows the tree.

## Constraints

**Keep the `atx-` prefix convention when surfaces merge.** The overlay already uses it to keep two `outline`
roles apart — `atx-outline` is the hover highlight (`hover.ts:62`, `styles.ts:1136`) while `'outline'` is a
`ButtonKind` passed to `footButton` (`ui.ts:894`). Verified: they do not collide today. Worth stating only
because the narrowed UI folds the refusal panel into the inspector, which is exactly when unprefixed class
names start meeting each other.

**Component identity does not exist in any annotation channel.** `data-astro-source-file` / `-loc` mark where an element is *written*, never which component instance rendered it. Astro 5/6's compiler emits them only when the dev toolbar is on; Astro 7's Rust compiler emits nothing, so this repo already self-injects. The stalled upstream fix (compiler-rs#144) skips components *and* `<slot>`, and emits wrong-shaped locs — so it would not help even if it landed. Identity must be manufactured.

**Slot children compile into a closure in the parent's factory scope.** Verified by reading compiled output on both the Go (`@astrojs/compiler` 2.13.1) and Rust (`compiler-rs` 0.3.1) compilers:

```js
$$renderComponent($$result, "Card", Card, { "title": "x" },
  { "default": () => $$render`<span>hi</span>` })   // ← closure in the PARENT factory
```

So `Astro.props` inside slotted markup is the *parent's* props, which makes "a slotted child's chain is a strict prefix of its DOM parent's chain" a lexical guarantee rather than a heuristic. This is the single property that separates *which file owns the presentation* from *which supplies the content*, and no alternative mechanism gives it for free.

**Astro synthesises the `Astro` binding even with no frontmatter**, on both compilers — so the transform needs no frontmatter injection and the existing no-newlines invariant survives intact.

**The dev toolbar strips exactly two attributes.** `dev-toolbar/apps/audit/annotations.js` removes `data-astro-source-file` and `data-astro-source-loc` on init and on a 250ms-debounced observer. A tool-owned namespace is untouched — which is what makes namespace ownership worth doing.

**`{...Astro.props}` at a usage site clobbers the injected prop** (the spread lands after it), truncating the chain. No attribute name dodges this. It is *detectable* instead: for an element in file `F` with chain `C`, `resolveTarget(last(C))` must equal `F`. A clobber breaks that equation, so the failure is caught rather than silently wrong.

**Interning is required, not an optimisation.** Self-describing links cost ~150 bytes/element at depth 4 (+17KB on a 111-tag page); 8-char content-derived ids cost ~36 bytes (+4KB) and are depth-independent.

**Two pre-existing `annotate.ts` gaps** surfaced during design and should be fixed as small independent issues: `<slot>` is stamped although the Go compiler does not stamp it, and hyphenated custom elements parse as `custom-element` rather than `element`, so force mode silently loses their annotation. `internal-documentation/ASTRO-COMPAT.md` also carries an inaccuracy — double annotation is harmless because our attribute is spliced **first** and the HTML parser keeps the first duplicate, not because the values are identical (the Go compiler computes its loc from the already-injected source and emits a column-shifted duplicate).

**A Markdown body carries no annotation at all.** `<Content />` is the Markdown renderer, not an `.astro` component, so neither the source attributes nor the usage chain reach anything it emits. Two consequences: the chain must end at that usage and say so rather than guessing past it, and locating a body line means **matching the rendered text against the `.md` source** — unique match writes, duplicate or near-match refuses. That is the same doctrine `expression-trace.ts` already applies to `.map()` items, applied to a second file type.

**Baseline health.** 38 test files, 851 tests, all green; `tsc --noEmit` clean. Verified in this session at `f1966ba`.

## UI

The model is **asleep until asked, then one pill and one panel**. The current build can put five floating surfaces on screen at once before any modal opens — admin bar, element-tree panel, hover outline, a two-row pill, and a chips rules card. That is the thing being reduced.

### WF-1 — Waking the tool

1. **Hold ⌥ and the overlay wakes.** Release it and it goes quiet again. There is no edit mode to enter or leave, so there is no save chip and nothing to forget to turn off.
2. **Ordinary clicks keep working** while the key is up — links navigate, forms submit, nothing is intercepted. This is what lets a card behave as a card.
3. **The only persistent chrome is a launcher** on the left edge. The admin bar is gone.

### WF-2 — The panel header

4. **Opening the launcher gives the element tree.** Its header carries the tool actions: `☰` menu and a separate `⚙` settings, then close.
5. **Below that, the route you are on** — `/services/product-design` over `src/pages/services/[slug].astro` — with an `⌁ source` pill beside it. *Open page source* comes out of the hidden overflow menu and sits where the question is actually asked.

### WF-3 — Hover pill

6. **Compact at rest.** One row: `ServiceCard.astro:12:5 · editable`. No chips row, no rules card on plain hover.
7. **Composition breadcrumb** appears on dwell: `index.astro › Services.astro › ServiceCard.astro`, each segment a button that opens the inspector focused on that link.
8. **No pinned state.** Clicking the pill — or the element — opens the inspector, where the actions, CSS chips and matched rules live.

### WF-4 — One panel, every click

9. **Click anything and the inspector opens**, with the same five sections in the same order: **Edit** (whatever this element actually permits), **Component chain**, **Props**, **Slot content**, **CSS**. No modal refusal, no modal image panel. Only the Edit section changes shape:

| The element is | Edit section shows |
| --- | --- |
| literal text or safe inline markup | "Editing in place" — the page is already contenteditable |
| rendered from a prop | the prop's field, focused, plus where that value is written |
| slot content passed to a component | the slot text field at the caller's usage site |
| a traced expression | the value field, with the trace named |
| an entry's frontmatter value | the field, and which YAML key it writes |
| a Markdown body line | the field, and the line it matched |
| an image | src, alt, a filterable asset browser and upload |
| none of these | the reason, and a jump to source |

10. **The chain is indented**, one level per usage, with connector rules. Each row carries **presentation** / **content** badges, which is how the panel answers "which file owns the look and which holds the words". Selecting any row re-targets the Props and Slot sections to that usage site.

11. **Two sets of open buttons, deliberately.** The Edit section's go to the file holding the *words*; the footer's go to the file that *draws* the element. For a prop-backed heading those differ, and conflating them was the old refusal panel's main sin.

12. **Prose gets a textarea, not a 32px input.** Any value over ~70 characters — a Markdown paragraph, a lede — opens as a sized textarea; Enter saves, Shift+Enter breaks the line.

### WF-5 — The image picker

13. **Everything the project already has**, filterable by name across the configured asset directories, eight tiles at a time with an explicit "show more" that names the total.
14. **Upload** writes into the configured `uploadDir` and patches the `src` in the same verified write. The directory is shown, because the rule that bites is that uploads must sit under `public/` or the reference 404s after a build.
15. Stock-photo search is **gone** with the rest of the CMS.

### WF-6 — The element tree

16. **Component boundary rows** replace `tree-model.ts`'s documented "reparent across an unannotated component gap", which silently attributes a component's output to whatever annotated ancestor encloses it — possibly in a different file.
17. **Slot content is marked** using the prefix rule, so "written in `Services.astro`, rendered inside `ServiceCard.astro`" is visible rather than inferred.
18. **Two links per component row** — the component file, and the usage-site line in the parent.
19. **The tree is per route**, and on a Markdown-backed route it ends at `Content — markdown, chain ends`, with the entry's lines beneath it.

Retained: hover sync both ways, click to lock selection, collapse state surviving HMR via `pathFor()`. Explicitly **not** in this plan, but the data model should permit it later: duplicating or reordering elements from the tree.

### WF-7 — A route backed by a Markdown entry

Clicking a service card opens `/services/product-design`, rendered by `src/pages/services/[slug].astro` from `src/content/services/product-design.md`. Four distinct behaviours on one page, and the distinction is the point:

| Element | Behaviour |
| --- | --- |
| `<p class="eyebrow">Service</p>` — literal in the template | edits in place |
| `<h1>{entry.data.title}</h1>` | **entry field** — writes one YAML key in the entry's frontmatter |
| a body paragraph from `<Content />` | **markdown** — the rendered text is matched against the `.md`; a unique match gives an unambiguous line to write |
| a paragraph with a link and bold text | **refused**, because writing it back would mean converting HTML to Markdown |

The chain ends honestly at the entry: `<Content />` is the Markdown renderer, not an `.astro` component, so no chain threads through it. That link is marked **inferred** and says why — derived from the route's template and the entry it renders, rather than proven like the links above it.

## Flow

Clicking an element is unchanged up to classification. What is new is composition resolution, which runs as its own tiered lookup with every failure named.

1. Click → `/classify` (AST truth; the DOM cannot tell a resolved `{expression}` from literal text).
2. Editable → inline contenteditable (`text`), swap panel (`image`), or the small source popup (`markup` / `expression`).
3. Not editable → the inspector opens instead of a modal, carrying the reason.
4. In parallel, the element's `data-atx-chain` resolves:
   - **chain present, every id resolves, equation holds at every hop** → `proven`: full chain, props, slot previews, slot relations.
   - **spread-truncated, or absent but the static graph offers exactly one path from the route entrypoint** → `inferred`: same display, every inferred link flagged with its reason.
   - **2–8 static paths** → `candidates`: "used in N places", each openable. Explicitly not an answer.
   - **0 or >8 paths, package-owned leaf, or an MDX boundary** → `none`: a named refusal plus *Open source* on what is known.

Tiers 2–3 are pure static work and need no instrumentation at all, which is why the static index is the floor the runtime chain stands on rather than an accessory.

## Architecture

**Mechanism.** Extend `src/server/annotate.ts` so that, per `.astro` file:

- every **component usage tag** that provably resolves to a project-owned `.astro` file gains an injected prop carrying an interned usage id:
  `<ServiceCard data-atx-chain={(Astro.props["data-atx-chain"]??"")+".k3f9x2a"} />`
- every **annotated plain element** gains `data-atx-chain={Astro.props["data-atx-chain"]??"!"}` alongside its source attributes.

Injection is gated: `.astro`→`.astro` only, project-owned only, bare identifier bound by a static import, specifier resolved through Rollup's `this.resolve` (so aliases work). Everything else is a *named* break, never a silent one. Package `.astro` components are excluded because `Image.astro` forwards `Astro.props` into `getImage()`; framework components are excluded because props serialise into `astro-island` and into the island's hash.

Ids are `sha1(rootRelativeFile, loc)` → 8 chars base64url, so a dev-server restart mints identical ids and no registry is needed.

**Support matrix**

| Straightforward | Needs the instrumentation | Explicit named refusal |
| --- | --- | --- |
| `.astro`→`.astro`, static and aliased imports | Repeated instances (`.map()`) — one usage site, N instances by DOM subtree | Framework components — `not-astro` |
| Nested layouts (a layout is just a usage) | Slot relations, via the prefix rule | Package `.astro` (`<Image>`) — `package` |
| Conditional rendering (per usage *site*) | `{...Astro.props}` forwarders — detect, then repair or refuse | `<Comp />` where `Comp` is a variable — `dynamic` |
| `Astro.self` recursion | | `<Comp.Sub />` — `namespaced`; `client:only`; `set:html`; MDX — `chain-break` |

Server islands (`server:defer`) are refused in v1 by choice: props would join the encrypted blob, and above 2048 chars Astro flips GET→POST.

**Wire shapes** go in `protocol.ts` first (rule 2), types-only: `UsageLink`, `UsageProp`, `UsageSlot`, `CompositionRequest/Response`, `CompositionTier`, `CompositionRefusal`, and `HealthResponse.composition`. Three routes in one `createCompositionRoutes(deps)` group: `/composition` (clicked element → tiered chain), `/composition/links` (batch id → link, one call per page), `/composition/uses` (what could be here / who uses this).

Slot detection needs no wire shape — the client has both chains and tests `chain(E) ⊊ chain(nearestAnnotatedAncestor(E))`.

### Editing props at the usage site

The chain does not just explain where a value came from — it makes that value *writable*, within a boundary the tool can prove.

**Why this is now reasonable.** Issue #61 ("copy arriving as a prop always refuses") proposed scanning the repository for callers and acting when exactly one matched. The maintainability report's objection was precise: *"One matching caller or literal across the repository does not by itself prove that caller produced this live component instance."* The runtime chain removes that objection — it names the usage site that actually rendered *this* instance, so no scan and no uniqueness assumption is needed. #61's hard part is supplied by a feature being built anyway.

**The boundary.** Editable only where the write is a byte-level patch the existing machinery already performs:

| Prop shape | Verdict | Mechanism |
| --- | --- | --- |
| `title="Build things…"` — quoted string literal | **editable** | The value span of a quoted attribute, exactly as `src`/`alt` are written today (`patcher/astro.ts::escapeAttrValue`) |
| `<Button>Start a project</Button>` — literal slot text | **editable** | The slot children's source range from the static usage index; a text edit inside it |
| `title={s.title}` — traces one hop to a literal in the same file | **editable** | `expression-trace.ts`, with the chain supplying the hop and the instance matched by rendered text |
| `eyebrow={site.tagline}` — imported | **read-only** | A second file; no transitive chase (#61's own rule) |
| `featured={i === 0}` — computed | **read-only** | Not a string |
| `{...Astro.props}` — spread | **read-only** | The values arrive from the caller's caller |
| `class`, `class:list`, `style` | **read-only** | Styling, not content — CSS editing stays out of scope |

**Rules it must obey.** The write is a **component tag's** attribute, which is new: `patcher/astro.ts::resolveElement` matches plain elements by annotation loc, and component tags carry no annotation — so resolution comes from the usage index's loc instead, and the patcher gains a sibling resolver rather than a looser one. Verify-then-patch is unchanged (rule 5): the server confirms the attribute still holds what the panel showed. Values are **validated, not escaped** (rule 10) — anything containing `{`, `<` or `>` is refused rather than encoded, because a brace would start an expression and an angle bracket would change markup. The request names a **usage id**, never a path, and the file it resolves to still passes `validateEditablePath` (rule 3).

**Protocol.** `ApplyOp` gains a `usage` target type carrying `{usageId, prop | slot}`, and `UsageProp` gains `editable: boolean` plus a `refusal` naming why not — so the client renders a read-only field with a reason rather than guessing.

### Editing a Markdown-backed route

Two targets, both narrower than the entry editor that was removed.

**A frontmatter value.** `{entry.data.title}` resolves to one YAML key in the entry the route renders. The write is a single-key rewrite through `patcher/frontmatter.ts`, which preserves comments, key order and quoting. Which entry backs the route comes from the route manifest plus the template's own `getCollection`/`getEntry` call — not from the deleted auto-resolution, whose failure mode (a confident match on an unrelated file) is the thing the maintainability report flagged as a high-priority correctness concern. Here the template names the collection, so there is nothing to guess.

**A body line.** Matched by rendered text, written as plain text. The refusals are the feature: a paragraph whose rendered HTML contains any inline markup is refused outright, because writing it back would require an HTML→Markdown conversion — the lossy round trip the rich-text editor was removed for. A text that appears more than once in the file is refused as ambiguous. Nothing converts, nothing guesses.

**This keeps one module the first draft deleted.** `src/patcher/frontmatter.ts` — 249 pure lines, 213 lines of tests — survives as a value writer. The entry drawer, the schema designer, the collections panel and auto entry-resolution all still go. **This is a scope decision, not a technical necessity**: the alternative is to show frontmatter values read-only with a jump to the file, which costs nothing to build and loses the most useful edit on a blog-shaped site.

## Files touched

### New

| File | Status | Change |
| --- | --- | --- |
| `src/shared/usage-id.ts` | new | The one id hash the transform and index both mint, so they agree by construction. |
| `src/server/usage-parse.ts` | new | **Pure.** `parseUsages(source)` → usages, prop source text per prop, slot child ranges, frontmatter import scan. |
| `src/server/usage-index.ts` | new | **Injected/impure.** mtime cache (the `entry-detect.ts` pattern), specifier resolution, reverse id map, `usesOf(file)`. |
| `src/server/composition.ts` | new | **Pure.** Tiering, the validation equation, spread repair, candidates. DOM-free and fs-free like `inspect-locate.ts`. |
| `src/server/composition-routes.ts` | new | The three-route feature group, each with a `maxBytes` cap, answering `disabled` at 200 rather than 404. |
| `src/client/composition-model.ts` | new | **Pure, DOM-free.** Instance tree + slot edges. The `tree-model.ts` pattern. |
| `src/client/composition.ts` | new | Reads `data-atx-chain`, batches id resolution through `api.ts`, caches per page. |
| `src/server/md-locate.ts` | new | **Pure.** Rendered text → the line that holds it in a `.md`, or a named refusal for duplicate / no match. The `inspect-locate.ts` shape. |
| `src/server/entry-value-routes.ts` | new | The two writes a Markdown-backed route needs — one frontmatter key, one body line — each through the injected `writeText` seam. |
| `src/client/launcher.ts` | new | The edge launcher and the hold-⌥ activation, replacing the admin bar's mode toggle. |

### Modified

| File | Status | Change |
| --- | --- | --- |
| `src/shared/protocol.ts` | mod | Delete the contiguous CMS band (280–980); add the composition shapes. |
| `src/server/annotate.ts` | mod | Component-usage injection + two element attributes, arriving as `opts` so the module stays pure. |
| `src/server/middleware.ts` | mod | ~55 lines: imports, route composition, `textMutationPaths`, `/health` fields, deps. |
| `src/index.ts` | mod | ~70 lines: drop schemaProvider and the Unsplash thunks; build one `UsageIndex`. |
| `src/server/options.ts` | mod | ~150 lines: drop `entryEditor`, `schemaEditor` and the Unsplash group; add one `composition` spec. |
| `src/client/overlay.ts` | mod | ~60 lines across 5 clusters: imports, bar deps, boot. |
| `src/client/admin-bar.ts` | mod | **Mostly deleted.** The bar, its pin/edge/save chip and the overflow menu go; what survives is the menu and settings entries, which move into the tree panel's header. |
| `src/client/tree.ts` (header) | mod | Gains the tool-action row and the route row with its `⌁ source` pill, fed by `route-manifest.ts`. |
| `src/client/editors/image.ts` | mod | Becomes an inspector section rather than a modal; gains the asset filter, paging and upload. |
| `src/client/editors/media-modal.ts` · `media-grid.ts` | mod | The grid stays and moves inside the inspector; the modal shell and its Unsplash tab go. |
| `src/patcher/frontmatter.ts` | **kept** | Retained as a value writer only — see § Editing a Markdown-backed route. |
| `src/client/editors/notice.ts` | mod | **Rewrite, not a trim** — ~90 of 197 lines are CMS; what remains becomes the inspector's refusal header. |
| `src/client/api.ts` | mod | Delete the contiguous band (178–372); add the composition wrappers. |
| `src/client/hover.ts` | mod | Compact/pinned pill; breadcrumb row. |
| `src/client/tree.ts` | mod | Component boundary rows, slot marks, two links per component row. |
| `src/client/source-map.ts` | mod | Prefer `data-atx-*`; retire the strip-race cache after the parity counter proves it safe. |
| `src/client/styles.ts` | mod | ~830 dead lines out — **last, in its own commit**, after code deletions are green. |
| `src/client/ui.ts` | mod | `buildDrawer` stays (Settings); `PAPER` and `switchControl`'s CMS-only uses go. |
| `src/client/element-context.ts` | mod | "Component chain" section in the copy payload; drop the `pageSource()` tendril. |
| `src/client/features.ts` | mod | Drop `entryEditor` / `unsplash`; add `composition`. |
| `src/client/editors/settings-panel.ts` | mod | Slim to the surviving options. |
| `tests/helpers.ts` | mod | Drop `stubSchemaProvider` and the `content-config.ts` import. |

### Kept, against the first draft

`src/patcher/frontmatter.ts` — the pure YAML writer, retained solely as a value writer for Markdown-backed routes. Rationale and the boundary: § Editing a Markdown-backed route. Everything else in the entry stack still goes.

### Removed

~34 files. Schema designer (`collections-panel.ts`, `schema-routes.ts`, `schema-introspect.ts`, `zod-adapt.ts`, `patcher/content-config.ts`); entry management (`editors/entry.ts`, `entry-routes.ts`, `entry-resolve-routes.ts`, `server/content-config.ts`, `collection-entries.ts`, `entry-detect.ts`, `client/page-source.ts`); rich text (`body-editor.ts`, `markdown.ts`, `shadow.ts::mountLight`); Unsplash (`unsplash-routes.ts`, `unsplash-pane.ts`, `unsplash-search.ts`, `shared/unsplash.ts`, `patcher/dotenv.ts`); `editors/asset-picker.ts`; and their tests (~4,900 lines). `documentation/ENTRY-EDITOR.md` deletes wholly.

**Net: ~9,150 `src/` lines (~35%) and ~4,700 test lines (~49%) removed; ~2,400–3,000 added.**

`editors/markup.ts` and `markup-insert.ts` are **kept** — they serve the on-page `markup` classification and have zero CMS coupling. `media-grid.ts` / `server/assets.ts` are **kept** — the grid moves into the inspector and keeps the upload route. `route-manifest.ts` and `page-source-routes.ts` are **kept** and become load-bearing for composition's route anchor.

## Open questions

- **E1 is the gate.** If chain threading cannot be shown truthful on a real component tree, the feature degrades to static tiers only (`inferred` / `candidates` / `none`) — still useful, but it cannot distinguish repeated instances.
- **Page weight at real-site scale** is unmeasured. If E4 fails, chains stamp on component-root elements only and the client resolves by ancestor walk.
- **Keeping `patcher/frontmatter.ts` is your call.** It is the only piece of the entry stack the Markdown-route work needs. Dropping it means frontmatter values display read-only with a jump to the file — cheaper, and noticeably less useful on a content-backed site.
- **⌥ is an assumption.** Hold-to-activate needs a key that is free on both platforms and does not fight the browser; ⌥ is what the current build already uses for hold-to-navigate, so it is the obvious inversion — but it is unverified against real sites that bind it.
- **Whether the legacy annotation read path can be removed** depends on the dev-only parity counter shipped in Phase 3 showing zero gaps across both real fixtures. Until then both namespaces are emitted.

## Implementation progress

- [ ] **E6** — removal blast radius: scratch branch, delete CMS + Unsplash, count edits outside deleted files
- [ ] **E2** — loc parity untouched with composition on
- [ ] **E1** — chain threading truthful on a purpose-built component tree
- [ ] **E3** — tool-owned namespace survives hydration on Astro 5.18
- [ ] **E4** — page-weight budget on the largest real fixture page
- [ ] **E5** — static usage index coverage, every failure named
- [ ] **P1** — delete the CMS, Unsplash, asset picker, `client/page-source.ts`; fix the ~12 composition points
- [ ] **P1** — rewrite `notice.ts`; revise README + the four owning docs; delete `ENTRY-EDITOR.md`
- [ ] **P1** — dead CSS out of `styles.ts`, its own commit, after green
- [ ] **P2** — compact/pinned hover pill; refusal folded into the inspector; Settings slimmed
- [ ] **P3** — emit `data-atx-*` on all versions + dev-only parity counter; fix `<slot>` and `custom-element` gaps; correct `ASTRO-COMPAT.md`
- [ ] **P4** — `protocol.ts` shapes, then `usage-parse.ts`, `usage-index.ts`, `composition.ts`, `composition-routes.ts`
- [ ] **P5** — component-usage injection in `annotate.ts` behind the `composition` option
- [ ] **P6** — `composition-model.ts`, `client/composition.ts`, pill breadcrumb, component-aware tree
- [ ] **P6a** — hold-to-activate replaces edit mode; the admin bar becomes a launcher plus a panel header carrying menu, settings, route and source
- [ ] **P6b** — one inspector for every click: Edit / Chain / Props / Slot / CSS, replacing the refusal modal and the image modal
- [ ] **P6c** — prop and slot-text editing at the usage site, within the boundary table above (closes #61)
- [ ] **P6d** — Markdown-backed routes: frontmatter fields, body lines matched by rendered text, rich paragraphs refused
- [ ] **P6e** — image picker: filter across the project's assets, paged browsing, and upload into the configured `uploadDir`
- [ ] **P7** — committed fixture site with a genuine 3-deep chain; real-site pass on both fixtures
- [ ] **P7** — remove the legacy annotation read path, parity counter as evidence

## Verification

Every phase ends green on both gates, with a `CHANGELOG.md` entry under `[Unreleased]` and the owning doc updated in the same commit.

- [ ] `npm run typecheck` clean and `npm test` green after every phase — baseline 38 files / 851 tests
- [ ] Element annotations are **byte-identical** with composition on and off — the single most important regression guard in the feature
- [ ] 205/205 playground loc parity retained; no newlines added by the transform; classify/apply round-trip green
- [ ] `usage-parse.ts`, `composition.ts`, `composition-model.ts`, `usage-id.ts` unit-tested with fixtures covering spreads, shorthand props, `class:list`, `Fragment slot=`, dotted names and `.map()`
- [ ] Clicking a component-rendered element shows a chain whose last link resolves to that element's own file; a `{...Astro.props}` forwarder shows `inferred` or `candidates`, never a wrong chain
- [ ] Slotted content is marked as slotted, and its chain is a strict prefix of its DOM parent's
- [ ] `data-atx-file` count in the live DOM equals the served count on Astro 5.18 and 7.1.1, with the dev toolbar both on and off
- [ ] No route under `/__dev-edit` answers a CMS path; `/health` reports no `entryEditor` or `unsplash`
- [ ] A quoted prop edited from the inspector lands as a byte-level patch at the usage site, and a stale one refuses rather than writes
- [ ] A `{s.title}` prop inside a `.map()` edits **only** the clicked instance, and names which array entry it wrote
- [ ] A value containing `{`, `<` or `>` is refused with a reason, never escaped into source
- [ ] Imported, computed and spread props render read-only with a named reason — never an editable field that fails on save
- [ ] Clicking any element opens the inspector; no modal refusal or modal image panel remains
- [ ] On a Markdown-backed route: a frontmatter value writes one YAML key and leaves every other key byte-identical
- [ ] A body paragraph edits only when its rendered text matches the `.md` exactly once; a duplicate or a near-match refuses
- [ ] A paragraph containing a link or bold text is refused, with a jump to the line — never round-tripped
- [ ] The overlay is inert until ⌥ is held: links navigate, forms submit, nothing is intercepted
- [ ] A composition section exists in `VERIFICATION.md`'s manual checklist — today it has none, and every component/slot case there is a refusal to verify
