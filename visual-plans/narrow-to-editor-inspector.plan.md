---
plan:
  id: narrow-to-editor-inspector
  title: Narrow astro-dev-edit to an editor and a source inspector
  status: in-progress
  type: system-design
  priority: high
  created: "2026-09-13"
  updated: "2026-09-18"
  progress: 75
  visual: narrow-to-editor-inspector.plan.html
  mockup: narrow-to-editor-inspector.mockup.html
  tags: [scope-reduction, astro, composition, annotations]
---

<!-- Budget: ≤ 2,500 words. Decisions, verified facts and refusals only — the
     mockup is the UI spec and the code is the API spec, so neither is restated
     here. Before adding a line, delete one. -->

# Narrow astro-dev-edit to an editor and a source inspector

Remove the CMS — schema designer, entry management, rich-text body editing — and Unsplash. Keep on-page editing, CSS peek and open-in-editor. Markdown-backed content points to its code file for editing in the IDE. HTML supplied as a string remains editable when its source value is known. Add the capability that motivates the exercise: **Astro component-composition inspection**, the chain of `.astro` usages responsible for the selected content. One maintainer; optimised for correctness, a small supported scope, and maintainability.

**Visual plan:** [narrow-to-editor-inspector.plan.html](narrow-to-editor-inspector.plan.html) — wireframes, flow, architecture
**Interactive mockup:** [narrow-to-editor-inspector.mockup.html](narrow-to-editor-inspector.mockup.html) — the proposed UI, clickable, built from the real `ui.ts` tokens

---

## Decisions

Each names what it rules out, because the alternative is the part that gets re-proposed.

- **Adapt, don't rebuild.** The CMS couplings are seams: `protocol.ts:280-980` is one contiguous band (71% of the file), `client/api.ts:178-372` likewise (52%), and route groups are `create<Feature>Routes(deps)` factories concatenated in one place — ~12 composition-point edits plus ~35 whole-file deletes. Rules out a fresh implementation, and rules out "keep the server, rebuild the client": strictly more work for no correctness gain.
- **Props-threaded usage chain.** Component identity is manufactured by threading an interned usage id through `Astro.props` in the existing pre-compiler transform. Rules out DOM ancestry (provably wrong across slots and component gaps), import graphs (a component that *could* be used is not one that *was*), and HTML comment markers (the build strips comments).
- **Own the annotation namespace.** Self-inject `data-atx-*` on Astro 5, 6 and 7, still emitting `data-astro-source-*` first. Removes the dev-toolbar dependency and the attribute-strip race. Rules out narrowing to Astro 7 only.
- **Settings stays a slim drawer.** ~5 surviving options keep `drawer.ts`, `group.ts`, `fields.ts`, the switch control and the per-request options resolver earning their keep. Rules out collapsing options to boot-time constants.
- **Local image picker stays, Unsplash goes.** Browsing local assets and uploading survive; ~2,674 LOC go, including the repo's largest test file, `patcher/dotenv.ts` and the secret machinery.
- **⌥ holds *interception*, not the tool.** While it is down the overlay takes hover and clicks; the moment it is up the page has them back. A selection outlives the key, so the inspector stays open on what you picked while links navigate around it — conflating the two is what made a card inspect instead of following its link. Rules out the persistent edit-mode toggle and the save chip.
- **No admin bar.** One launcher tab on the left edge; opening it gives the element tree, whose header carries menu, settings, the route and a `view code` pill. Rules out the top bar that covered the page.
- **Markdown-backed content opens its code file.** Frontmatter values and body content offer *View code* and *Open in editor*, without browser editing or rendered-text matching. Literal content written in the Astro route template remains editable.
- **The inspector opens on every click** — one panel for every element, whatever the verdict. Rules out the modal refusal notice and the modal image panel, both folded into it.
- **One value, one field, one Save.** Everything writable on a selection is a row in **Values** with its own field and Save/Revert pair, literal text included; the page and the field are two views of one value. Rules out the separate "Edit · in place" block and the floating commit bar, which gave the same gesture two homes depending on where the words came from.
- **Nothing reaches a file until Save.** Every edit — typed, picked, uploaded — stages a value; the element wears an amber outline, deliberately not the selection colour, until Save writes or Revert discards. Clicking away, releasing ⌥ or closing the inspector leaves the change pending and says so. Rules out commit-on-blur. It is not an undo stack: past a save, the git tree is still the only way back (rule 5).
- **One verb for source — *View code*.** One popup, one *Open in editor* inside it, every button naming its destination rather than its mechanism. Rules out the ⧉ peek / ⌁ open pair that appeared three times in a single row, and rules out an inspector footer: a destination belongs to the row that owns it.
- **Developer-authored values may contain HTML.** Known string values, including values supplied to `set:html`, are editable as whole values. Braces, angle brackets and quotes are not reasons to reject content. Preserve the destination’s string syntax and text-versus-HTML behavior; source-target and stale-write checks still apply. This does not prove relationships inside the resulting HTML.
- **Props editable at the usage site, within a proven boundary** — string literals and one-hop traces to a literal; everything else read-only with a named reason. Rules out general prop editing.
- **The hover pill names a location, never a verdict.** `file:loc · click to inspect`, uncoloured. Rules out a classify round-trip per hover, and rules out the editability-coloured pill states the mockup draws.
- **A repeated usage site is disambiguated by a render ordinal, never by DOM order.** `composition-runtime.ts::child()` counts its invocations per usage site; a `.map()` value names its array entry only when that ordinal meets static proof of a 1:1 map over a literal array, and is refused by name otherwise. Rules out reading the index off sibling position, and rules out defaulting to the first entry when the instance is unknown.
- **`UsageProp` carries its own byte range**, as `UsageSlot` already does. Rules out re-finding a prop value by searching the tag text, which two props holding the same string would break.
- **A pending edit survives an unrelated HMR update, and is dropped loudly when its own file changed.** It is re-found by `file:loc` after the update; a change to the file the value writes into discards it with a toast rather than saving against stale source. Rules out today's silent loss, and rules out suppressing HMR while an edit is dirty.
- **An upload writes immediately; only the source edit stages.** The bytes must exist before the picker can show them. Rules out holding an upload in memory until Save.
- **No attribute insertion in the first pass.** `alt` is editable where it exists; where it does not, the row reads *no alt attribute · add it in the IDE*. Rules out writing an attribute the source does not contain, which rule 6 refuses to point at.
- **Composition extends the element tree, it does not replace it** — breadcrumbs on the hover pill, component-awareness in the tree. Rules out one unified inspector that swallows the tree.

## Constraints

Verified this session at `f1966ba` unless stated.

- **Component identity exists in no annotation channel.** `data-astro-source-file` / `-loc` mark where an element is *written*, never which instance rendered it. Astro 5/6 emit them only with the dev toolbar on; Astro 7's Rust compiler emits nothing, so this repo already self-injects. The stalled upstream fix (compiler-rs#144) skips components *and* `<slot>` and emits wrong-shaped locs, so it would not help even if it landed. Identity must be manufactured.
- **Slot children compile into a closure in the parent's factory scope** — read off compiled output on both the Go (`@astrojs/compiler` 2.13.1) and Rust (`compiler-rs` 0.3.1) compilers:

  ```js
  $$renderComponent($$result, "Card", Card, { "title": "x" },
    { "default": () => $$render`<span>hi</span>` })   // ← closure in the PARENT factory
  ```

  So `Astro.props` inside slotted markup is the *parent's*, making "a slotted child's chain is a strict prefix of its DOM parent's" a lexical guarantee rather than a heuristic. It is the single property separating *which file owns the presentation* from *which supplies the content*, and nothing else gives it for free.
- **Astro synthesises the `Astro` binding even with no frontmatter**, on both compilers — so the transform needs no frontmatter injection and the no-newlines invariant survives.
- **The dev toolbar strips exactly two attributes.** `dev-toolbar/apps/audit/annotations.js` removes `data-astro-source-file` and `data-astro-source-loc` on init and on a 250ms-debounced observer. A tool-owned namespace is untouched, which is what makes owning one worth doing.
- **`{...Astro.props}` at a usage site clobbers the injected prop** (the spread lands after it) and truncates the chain. No attribute name dodges it, so it is *detected* instead: for an element in file `F` with chain `C`, `resolveTarget(last(C))` must equal `F`. A clobber breaks that equation, so the failure is caught rather than silently wrong.
- **Interning is required, not an optimisation.** Self-describing links cost ~150 bytes/element at depth 4 (+17 KB on a 111-tag page); 8-char content-derived ids cost ~36 bytes (+4 KB) and are depth-independent.
- **A Markdown body carries no annotation at all.** `<Content />` is the Markdown renderer, not an `.astro` component, so neither source attributes nor the chain reach what it emits. The chain ends at that usage. Link to the backing `.md` file when the route-to-entry relationship is known; otherwise link to the known Astro template and name the unresolved relationship. No body-line matching is required.
- **Keep the `atx-` prefix when surfaces merge.** `atx-outline` is the hover highlight (`hover.ts:62`, `styles.ts:1136`); `'outline'` is a `ButtonKind` passed to `footButton` (`ui.ts:894`). They do not collide today, and folding the refusal panel into the inspector is exactly when unprefixed names start meeting each other.
- **Two pre-existing `annotate.ts` gaps**, to fix as small independent issues: `<slot>` is stamped although the Go compiler does not stamp it, and hyphenated custom elements parse as `custom-element` rather than `element`, so force mode silently loses their annotation. `internal-documentation/ASTRO-COMPAT.md` is also wrong on why double annotation is harmless — our attribute is spliced **first** and the HTML parser keeps the first duplicate; the values are *not* identical, because the Go compiler computes its loc from the already-injected source and emits a column-shifted duplicate.
- **Astro dev answers an `.astro` change with a full page reload, not a module update.** Verified on the composition fixture: a sentinel on `window` is gone after touching any component. So "a pending edit survives an unrelated HMR update" cannot be met by an in-memory store — the store is mirrored into `sessionStorage` and each entry is re-found on boot by its source loc, kept only while its element still reads the text it was staged against. That check subsumes the file-level rule: an unrelated change leaves it true, and a change to the value's own line does not. A toast shown in the moment before a reload is destroyed unread, so a drop is *queued* and drained by the next boot or by `vite:afterUpdate`, whichever the update turns out to be.
- **Baseline health.** 38 test files, 851 tests green; `tsc --noEmit` clean.

## UI

**Asleep until asked, then one pill and one panel.** Today five floating surfaces can be on screen before any modal opens — admin bar, tree panel, hover outline, a two-row pill and a chips rules card. That is what is being reduced. The [mockup](narrow-to-editor-inspector.mockup.html) is the visual spec; what follows is only what it cannot state about itself.

### WF-1 — Waking the tool

1. **⌥ holds *interception*, and releasing it hands the page back** — but the selection stays: the inspector, its outline and any text edit in progress survive the key going up. Conflating the two is what made a card inspect instead of following its link.
2. **No mode to enter or leave**, so no save chip and nothing to forget. The only persistent chrome is a launcher tab on the left edge.

### WF-2 — The panel header

3. **The launcher opens the element tree**; its header carries a `☰` menu and a separate `⚙` settings, then close, with the route and a `view code` pill below. *Open page source* leaves the hidden overflow menu for where the question is actually asked.

### WF-3 — Hover pill

4. **One row at rest** — `ServiceCard.astro:12:5 · edit via prop`. The verdict names the *transport*, not a yes/no. Breadcrumbs appear on dwell — `index.astro › Services.astro › ServiceCard.astro` — each segment opening the inspector focused on that link. No pinned state, no chips row, no rules card.

### WF-4 — One panel, every click

5. **Same sections, same order, for every element: Values · Component chain · CSS.** The value the click landed on is pinned first, marked and focused, so what changes between elements is the *caption* on a row, never the shape of the surface:

| The element is | Its pinned row says |
| --- | --- |
| literal text or safe inline markup | written literally in this file — the caret is already on the page |
| rendered from a prop | it arrives as that prop, from the usage site named |
| slot content passed to a component | the slot lives in the caller, at that usage site |
| a traced expression | the trace, one hop, to the literal it came from |
| Markdown frontmatter or body content | edit in the IDE — View code points to the backing file when known |
| HTML supplied as a string | edit the whole source value; inner elements may remain untracked |
| an image | src and alt as rows, plus a filterable asset browser above them |
| none of these | the reason, and a jump to source — no field |

6. **The inspector's own header is three things** — the chain verdict (`proven` · `one link inferred` · `no chain`), a `saved` / `unsaved` badge for the selection, and `⎘ Copy context`: selector, source loc and chain in one paste.
7. **Two things earn a block above Values, nothing else** — the image grid, because a list of fields cannot show pictures; and a refusal, after which Values reads *nothing writable on this selection*.
8. **Three row verdicts, not two** — `editable` · `elsewhere` (writable, in another file, which is named) · `read-only` (nothing to write). Folding the middle into `read-only` made `eyebrow={site.tagline}` look as unwritable as `featured={i === 0}`.
9. **Slot markup does not hide the values inside it.** Values wrapped by slot markup get their own rows badged `via slot`; the wrapper stays read-only. A value belonging to another element carries *Select on page →*.
10. **One Save, directly under its field.** Typing on the page drives that same field; Enter saves, Esc reverts, anything else leaves the value pending in amber and closing says so. A literal is keyed by source loc, so a string rendered on two routes is one value writing one line, and both elements go amber together.
11. **Destinations differ; the verb does not.** A Values row's *View code* lands on the file holding the *words*; a chain row pairs it with *Open parent*, the usage site writing `<Name />`. For a prop-backed heading those differ, and conflating them was the old refusal panel's main sin.
12. **Chain rows carry presentation / content badges** — how the panel answers which file owns the look and which holds the words — and re-target Values to that usage site without unpinning the clicked row.
13. **Three details that stop a row becoming a wall:** prose over ~70 characters opens as a textarea (Shift+Enter breaks the line); a row is three bands — what it is · what you type · where it goes — with the destination named once rather than three times; the mechanism vocabulary sits behind a `▸ Details` disclosure so a label can name a destination instead of explaining one.

### WF-5 — The image picker

14. **Project assets only**, filterable across the configured directories, paged eight at a time. **Picking a tile and uploading both stage a value; neither writes.** `uploadDir` is shown, because the rule that bites is that uploads must sit under `public/` or the reference 404s after a build. Stock-photo search goes with the CMS.

### WF-6 — The element tree

15. **Component boundary rows** replace `tree-model.ts`'s documented "reparent across an unannotated component gap", which silently attributes a component's output to whatever annotated ancestor encloses it — possibly in a different file.
16. **Slot content is marked** by the prefix rule, so "written in `Services.astro`, rendered inside `ServiceCard.astro`" is visible rather than inferred. Two links per component row; per route; a Markdown-backed route ends at `Content — markdown, chain ends`.

Retained: hover sync both ways, click to lock selection, collapse state surviving HMR via `pathFor()`. Not in this plan, but the data model should permit it later: duplicating or reordering elements from the tree.

### WF-7 — A route backed by a Markdown entry

`/services/product-design`, rendered by `src/pages/services/[slug].astro` from `src/content/services/product-design.md`. Four behaviours on one page, and the distinction is the point:

| Element | Behaviour |
| --- | --- |
| `<p class="eyebrow">Service</p>` — literal in the template | **text** — the caret lands on the page, the same value sits in the field |
| `<h1>{entry.data.title}</h1>` | **View code** — opens the backing Markdown file |
| a body paragraph from `<Content />` | **View code** — opens the backing Markdown file |
| a paragraph with a link and bold text | **View code** — the same IDE editing path |

The chain ends honestly at the entry, and that last link is marked **inferred** with its reason: derived from the route's template and the entry it renders, not proven like the links above it.

## Flow

Classification is unchanged. Composition resolution is new, and runs as its own tiered lookup with every failure named.

1. Click → `/classify` (AST truth; the DOM cannot tell a resolved `{expression}` from literal text).
2. Editable → a Values row with a field, whatever the transport. For `text` alone the element is *also* made contenteditable so the caret lands where you clicked; the field and the page are bound to one value and one Save writes it. `markup`'s value is the element's *source*, which a browser hands back re-spelled, so it is typed in the field only. Nothing commits on blur — an abandoned edit stays staged and stays marked.
3. Not editable → the inspector opens instead of a modal, carrying the reason.
4. In parallel, `data-atx-chain` resolves:
   - **present, every id resolves, equation holds at every hop** → `proven`: full chain, props, slot previews, slot relations.
   - **spread-truncated, or absent but the static graph offers exactly one path from the route entrypoint** → `inferred`: same display, every inferred link flagged with its reason.
   - **2–8 static paths** → `candidates`: "used in N places", each openable. Explicitly not an answer.
   - **0 or >8 paths, package-owned leaf, or an MDX boundary** → `none`: a named refusal plus *View code* on what is known.

Tiers 2–3 are pure static work needing no instrumentation, which is why the static index is the floor the runtime chain stands on rather than an accessory.

## Architecture

**Mechanism.** Extend `src/server/annotate.ts` so that, per `.astro` file:

- every **component usage tag** provably resolving to a project-owned `.astro` file gains an injected prop carrying an interned usage id:
  `<ServiceCard data-atx-chain={(Astro.props["data-atx-chain"]??"")+".k3f9x2a"} />`
- every **annotated plain element** gains `data-atx-chain={Astro.props["data-atx-chain"]??"!"}` alongside its source attributes.

Injection is gated to `.astro`→`.astro`, project-owned, bare identifier bound by a static import, specifier resolved through Rollup's `this.resolve` (so aliases work). Everything else is a *named* break, never a silent one. Package `.astro` components are excluded because `Image.astro` forwards `Astro.props` into `getImage()`; framework components because props serialise into `astro-island` and into the island's hash. Ids are `sha1(rootRelativeFile, loc)` → 8 chars base64url, so a restart mints identical ids and no registry is needed.

| Straightforward | Needs the instrumentation | Explicit named refusal |
| --- | --- | --- |
| `.astro`→`.astro`, static and aliased imports | Repeated instances (`.map()`) — one usage site, N instances by DOM subtree | Framework components — `not-astro` |
| Nested layouts (a layout is just a usage) | Slot relations, via the prefix rule | Package `.astro` (`<Image>`) — `package` |
| Conditional rendering (per usage *site*) | `{...Astro.props}` forwarders — detect, then repair or refuse | `<Comp />` where `Comp` is a variable — `dynamic` |
| `Astro.self` recursion | | `<Comp.Sub />` — `namespaced`; `client:only`; `set:html`; MDX — `chain-break` |

Server islands (`server:defer`) are refused in v1 by choice: props would join the encrypted blob, and above 2048 chars Astro flips GET→POST.

**Wire shapes** go in `protocol.ts` first (rule 2), types-only: `UsageLink`, `UsageProp`, `UsageSlot`, `CompositionRequest/Response`, `CompositionTier`, `CompositionRefusal`, `HealthResponse.composition`. Three routes in one `createCompositionRoutes(deps)` group: `/composition` (clicked element → tiered chain), `/composition/links` (batch id → link, one call per page), `/composition/uses` (what could be here / who uses this). Slot detection needs no wire shape — the client has both chains and tests `chain(E) ⊊ chain(nearestAnnotatedAncestor(E))`.

### Editing props at the usage site

Issue #61 proposed scanning the repo for callers and acting when exactly one matched. The maintainability report's objection was precise — *"One matching caller or literal across the repository does not by itself prove that caller produced this live component instance."* The runtime chain names the usage site that actually rendered *this* instance, so there is no scan and no uniqueness assumption: #61's hard part is supplied by a feature being built anyway.

Editable where the source value is proven. Existing patchers need extension for string syntax that they currently refuse:

| Prop shape | Verdict | Mechanism |
| --- | --- | --- |
| `title="Build things…"` — quoted string literal | **editable** | The value span of a quoted attribute, as `src`/`alt` are written today (`patcher/astro.ts::escapeAttrValue`) |
| `set:html={html}` — a known literal string | **editable** | Edit the whole string at its proven source; its generated descendants remain untracked. A quoted one is raw: Astro injects that attribute undecoded |
| `<Button>Start a project</Button>` — literal slot text | **editable** | The slot children's source range from the static usage index |
| `title={s.title}` — one hop to a literal in the same file | **editable** | `expression-trace.ts`, chain supplying the hop, instance matched by rendered text |
| `eyebrow={site.tagline}` — imported | **elsewhere** | A second file; no transitive chase (#61's own rule). Read-only, and it names that file |
| `featured={i === 0}` — computed | **read-only** | Not a string |
| `{...Astro.props}` — spread | **read-only** | The values arrive from the caller's caller |
| `class`, `class:list`, `style` | **read-only** | Styling, not content |

Rules it must obey:

- The target is a **component tag's** attribute, which is new: `patcher/astro.ts::resolveElement` matches plain elements by annotation loc and component tags carry none, so resolution comes from the usage index's loc — a sibling resolver, not a looser one.
- Verify-then-patch is unchanged (rule 5); the request names a **usage id**, never a path, and the file it resolves to still passes `validateEditablePath` (rule 3).
- **Content is accepted; source syntax is preserved.** Encode string values for their actual destination (quoted attribute, JavaScript string or template text), preserving literal characters and existing rendering semantics. HTML strings receive a raw-value field, not a structural HTML editor. This user-approved scope supersedes the blanket character refusal for these content writes; it does not widen config or dotenv writes. Verify the written value reads back unchanged.
- `ApplyOp` gains a `usage` target carrying `{usageId, prop | slot}`. `UsageProp` and `UsageSlot` carry a **three-state** `UsageWrite` — `editable` · `elsewhere` (writable, in the module it names in `from`) · `read-only` — each refusal naming its reason, so the client renders a reason rather than guessing. Three, not a boolean plus a refusal: a boolean cannot carry `elsewhere`, which is the state WF-4 item 8 exists to protect. `set:html` names a value rather than structure, so it earns a verdict at both destinations. At a *component* tag the usage is separately a `chain-break` — the injected HTML has no container to mark opaque — so that verdict is reachable through the API and not through the panel.

### Source navigation for a Markdown-backed route

- Frontmatter and body content offer *View code*, with *Open in editor* inside it. No Markdown values are staged or written through the browser.
- Resolve the backing file from the route template and entry when provable. Otherwise open the known template and explain that the entry file is unresolved; never guess a file or body line.
- No body-line locator, entry-value routes or dedicated frontmatter writer is needed for this feature. Remove CMS-only writers once surviving callers have been checked.

## Files touched

**New** — every one is a registry, a pure module or a factory, per CLAUDE.md § Extending.

| File | Change |
| --- | --- |
| `src/shared/usage-id.ts` | The one id hash the transform and the index both mint, so they agree by construction. |
| `src/server/usage-parse.ts` | **Pure.** `parseUsages(source)` → usages, prop source text, slot child ranges, frontmatter import scan. |
| `src/server/usage-index.ts` | **Impure/injected.** mtime cache (the `entry-detect.ts` pattern), specifier resolution, reverse id map, `usesOf(file)`. |
| `src/server/composition.ts` | **Pure.** Tiering, the validation equation, spread repair, candidates — DOM- and fs-free like `inspect-locate.ts`. |
| `src/server/composition-routes.ts` | The three-route group, each `maxBytes`-capped, answering `disabled` at 200 rather than 404. |
| `src/client/composition-model.ts` | **Pure, DOM-free.** Instance tree + slot edges; the `tree-model.ts` pattern. |
| `src/client/composition.ts` | Reads `data-atx-chain`, batches id resolution through `api.ts`, caches per page. |
| `src/client/value-model.ts` | **Pure, DOM-free.** The staged-value store: original, current, dirty — keyed by source loc, so one literal rendered twice is one value. |
| `src/client/launcher.ts` | The edge launcher, and hold-⌥ as *interception* held separately from the selection. |

**Modified** — ~12 composition points, and two that are rewrites rather than trims.

| File | Change |
| --- | --- |
| `src/shared/protocol.ts` · `src/client/api.ts` | Delete the contiguous CMS bands (280–980, 178–372); add the composition shapes and wrappers. |
| `src/server/annotate.ts` | Component-usage injection + two element attributes, arriving as `opts` so the module stays pure. |
| `src/server/middleware.ts` | ~55 lines: imports, route composition, `textMutationPaths`, `/health` fields, deps. |
| `src/index.ts` | ~70 lines: drop schemaProvider and the Unsplash thunks; build one `UsageIndex`. |
| `src/server/options.ts` | ~150 lines: drop `entryEditor`, `schemaEditor` and the Unsplash group; add one `composition` spec. |
| `src/client/overlay.ts` | ~60 lines across 5 clusters: imports, bar deps, boot. |
| `src/client/admin-bar.ts` | **Mostly deleted** — bar, pin/edge/save chip, overflow menu go; menu and settings move into the tree header. |
| `src/client/editors/notice.ts` | **Rewrite** — ~90 of 197 lines are CMS; the rest becomes the inspector's refusal header. |
| `src/client/tree.ts` | Header gains the tool actions, route row and `view code` pill (via `route-manifest.ts`); body gains boundary rows, slot marks, two links per component row. |
| `src/client/editors/image.ts` | An inspector section, not a modal; gains filter, paging, upload. `src`/`alt` leave for Values rows, and picking stages rather than writes. |
| `src/client/editors/media-modal.ts` · `media-grid.ts` | The grid moves inside the inspector; the modal shell and its Unsplash tab go. |
| `src/client/hover.ts` | Compact pill, breadcrumb row. |
| `src/client/element-context.ts` | "Component chain" in the copy payload; drop the `pageSource()` tendril. |
| `src/client/features.ts` · `src/client/editors/settings-panel.ts` | Drop `entryEditor` / `unsplash`, add `composition`; Settings slimmed to the surviving options. |
| `src/client/source-map.ts` | Prefer `data-atx-*`; retire the strip-race cache once the parity counter proves it safe. |
| `src/client/styles.ts` | ~830 dead lines out — **last, in its own commit**, after the code deletions are green. |
| `src/client/ui.ts` | `buildDrawer` stays for Settings; `PAPER` and `switchControl`'s CMS-only uses go. |
| `tests/helpers.ts` | Drop `stubSchemaProvider` and the `content-config.ts` import. |

**Removed** — 34 source files, 13 test files, ~17,000 lines. Schema designer (`collections-panel.ts`, `schema-routes.ts`, `schema-introspect.ts`, `zod-adapt.ts`, `patcher/content-config.ts`); entry management (`editors/entry.ts`, `entry-routes.ts`, `entry-resolve-routes.ts`, `server/content-config.ts`, `collection-entries.ts`, `entry-detect.ts`, `entry-pattern.ts`, `patcher/frontmatter.ts`); rich text (`body-editor.ts`, `markdown.ts`, `shadow.ts::mountLight`, `ui.ts::PAPER`); Unsplash (`unsplash-routes.ts`, `unsplash-pane.ts`, `unsplash-search.ts`, `shared/unsplash.ts`, `patcher/dotenv.ts`, `shared/slug.ts`); `editors/asset-picker.ts`; `documentation/ENTRY-EDITOR.md` wholly.

`client/page-source.ts` **survives**, against the original plan: the inspector's route anchor reads the page's own `astro-dev-edit:page-source` declaration, so only the `/entry/resolve` half of the module went.

**Kept deliberately:** `editors/markup.ts` + `markup-insert.ts` (they serve the on-page `markup` classification, zero CMS coupling); `media-grid.ts` / `server/assets.ts` (grid and upload route); `route-manifest.ts` + `page-source-routes.ts` (load-bearing for composition's route anchor).

**Original sizing estimate:** ~9,150 `src/` lines and ~4,700 test lines removed; ~2,400–3,000 added. Recount after removing Markdown writes and adding whole-string HTML editing.

## Open questions

- **E1 is the gate.** If chain threading cannot be shown truthful on a real component tree, the feature degrades to static tiers only (`inferred` / `candidates` / `none`) — still useful, but unable to distinguish repeated instances.
- **Page weight at real-site scale is unmeasured.** If E4 fails, chains stamp on component-root elements only and the client resolves by ancestor walk.
- **⌥ is an assumption.** It is what the current build uses for hold-to-navigate, so the inversion is obvious, but it is unverified against real sites that bind it.
- **Whether the legacy annotation read path can go** depends on the dev-only parity counter in P3 showing zero gaps across both fixtures. Until then both namespaces are emitted.

## Implementation progress

- [ ] **E6** — removal blast radius: scratch branch, delete CMS + Unsplash, count edits outside deleted files
- [x] **E2** — loc parity untouched with composition on
- [x] **E1** — chain threading truthful on a purpose-built component tree
- [ ] **E3** — tool-owned namespace survives hydration on Astro 5.18
- [ ] **E4** — page-weight budget on the largest real fixture page
- [x] **E5** — static usage index coverage, every failure named
- [x] **P1** — delete the CMS, Unsplash and the asset picker; fix the ~12 composition points. `client/page-source.ts` **stays**: the inspector's route anchor reads the page's own meta declaration, and only the `/entry/resolve` half went
- [x] **P1** — rewrite `notice.ts`; revise README + the owning docs; delete `ENTRY-EDITOR.md`
- [x] **P1** — dead CSS out of `styles.ts`, its own commit, after green — 831 lines
- [x] **P2** — compact hover pill with a breadcrumb row (the inspector's; `hover.ts`'s editing pill is untouched and still carries the chips row); refusal folded into the inspector — `showDynamicNotice` has one caller, `router.ts`; Settings slimmed to three tabs and twelve options
- [ ] **P3** — emit `data-atx-*` on all versions + dev-only parity counter; fix `<slot>` and `custom-element` gaps; correct `ASTRO-COMPAT.md`
- [x] **P4** — `protocol.ts` shapes, then `usage-parse.ts`, `usage-index.ts`, `composition.ts`, `composition-routes.ts`
- [x] **P5** — component-usage injection in `annotate.ts` behind the `composition` option
- [x] **P6** — `composition-model.ts`, `composition-dom.ts`, component-aware tree
- [x] **P6** — hover-pill breadcrumb: one row at rest, the chain of resolved files on dwell, each segment focusing that link's chain row without unpinning the clicked element. `composition.ts` batches ids per page — seven dwells, one request
- [x] **P6a** — hold-to-activate replaces edit mode; the admin bar becomes a left-edge launcher plus a panel header carrying route and source
- [x] **P6a** — menu and settings in that header: `☰` (Copy page context, Re-scan the page) and `⚙` Settings, then close, with the route, its template and *View code* below
- [x] **P6b** — one read-only inspector for every click: Values, Component chain, Slot relationships, CSS, one *View code* verb
- [x] **P6b** — the row model: every value on a selection is a Values row carrying its own three-state verdict, the clicked value pinned and badged, slot-wrapped values badged `via slot`, and the destination named once behind a `Details` disclosure. `/classify` joins the selection load, since the DOM cannot tell a resolved `{expression}` from literal text
- [x] **P6b** — staged values and one Save per row, for the literal-text targets (`text` / `markup` / `expression`): a field and one Save/Revert pair under each editable row, the caret on the page for `text`, amber on the element, verify-then-patch unchanged, and a pending edit kept across an unrelated reload or dropped by name
- [x] **P6b** — the same field, Save and Revert for props and slot text, through the one staged-value store; `elsewhere` and `read-only` rows keep their sentence and their *View code*. The image grid in place of the modal is P6e
- [x] **P6c-0** — `UsageProp` byte range in `protocol.ts`; render ordinal in `composition-runtime.ts::child()`; one-hop trace from `{s.title}` to a literal array entry
- [x] **P6c** — prop and slot-text editing at proven source targets, with destination-aware encoding, lands via `/composition/apply` and `usage-write.ts`; the render ordinal earns back `unproven-entry` for a proven 1:1 `.map()`; and a known whole HTML string is editable at both destinations — `set:html` at a usage site, and a `set:html` container through `/apply`'s `html` target
- [ ] **P6d** — Markdown-backed routes: source-file navigation for frontmatter and body content; no browser writes
- [ ] **P6e** — image picker: filter across the project's assets, paged browsing, and upload into the configured `uploadDir`
- [ ] **P7** — committed fixture site with a genuine 3-deep chain; real-site pass on both fixtures
- [ ] **P7** — remove the legacy annotation read path, parity counter as evidence

## Verification

Every phase ends green on both gates, with a `CHANGELOG.md` entry under `[Unreleased]` and the owning doc updated in the same commit.

- [x] `npm run typecheck` clean and `npm test` green after every phase — 33 files / 523 tests (`ATX_ASTRO5_ROOT=examples/sf-sf` is required, or `composition-render.test.ts` drops its Astro-5 leg silently)
- [x] Element annotations are **byte-identical** with composition on and off — the single most important regression guard in the feature
- [ ] 205/205 playground loc parity retained; no newlines added by the transform; classify/apply round-trip green
- [x] `usage-parse.ts`, `composition.ts` (server), `client/composition.ts`, `composition-model.ts`, `usage-id.ts` unit-tested with fixtures covering spreads, shorthand props, `class:list`, `Fragment slot=`, dotted names and `.map()`
- [x] Clicking a component-rendered element shows a chain whose last link resolves to that element's own file; a `{...Astro.props}` forwarder shows `inferred` or `candidates`, never a wrong chain
- [x] Slotted content is marked as slotted, and its chain is a strict prefix of its DOM parent's
- [ ] `data-atx-file` count in the live DOM equals the served count on Astro 5.18 and 7.1.1, with the dev toolbar both on and off
- [x] No route under `/__dev-edit` answers a CMS path; `/health` reports no `entryEditor` or `unsplash`
- [x] A quoted prop edited from the inspector lands as a byte-level patch at the usage site, and a stale one refuses rather than writes
- [x] A `{s.title}` prop inside a `.map()` edits **only** the clicked instance, and names which array entry it wrote
- [x] String values containing braces, angle brackets and quotes save and read back unchanged at a usage site, and at an HTML-valued destination — where the same characters are the tags themselves and reach the page as tags
- [x] A known HTML string is editable as a whole even when its generated descendants have no proven component relationships — the container carries the row, and every element inside the HTML it renders refuses
- [x] Computed, spread, styling and untraceable props render `read-only` with a named reason, and imported ones `elsewhere` naming their module
- [x] No refused value ever offers an editable field that then fails on save — a field appears only for an `editable` verdict whose target the write path serves, which is what `unproven-entry` exists to keep true
- [ ] Clicking any element opens the inspector; no modal refusal or modal image panel remains
- [ ] Nothing reaches disk before Save: a typed change, a picked image and an upload all leave the source byte-identical, and the element stays marked unsaved until Save
- [x] Releasing ⌥ restores ordinary navigation while the inspector keeps its selection, and leaves any pending edit pending rather than committing it
- [x] A pending edit survives an unrelated HMR update, and is discarded with a toast when its own file changed
- [x] A literal rendered on two routes edits as one value and writes one line, and both elements mark unsaved together
- [x] A value writable in another file reads `elsewhere` with that file named — never `read-only`
- [x] A value wrapped in slot markup is an editable row badged `via slot`, not a read-only slot preview
- [ ] Markdown frontmatter, plain paragraphs and formatted paragraphs all offer source navigation without editable fields or Save
- [ ] An unresolved Markdown backing file opens the known route template, without inventing an entry file or body-line location
- [x] The overlay is inert until ⌥ is held: links navigate, forms submit, nothing is intercepted
- [x] A composition section exists in `VERIFICATION.md`'s manual checklist — today it has none, and every component/slot case there is a refusal to verify
