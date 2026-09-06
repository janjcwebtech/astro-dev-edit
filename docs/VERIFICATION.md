# Verification guide

How every piece of functionality in this integration is verified — which
vitest file pins it, and what can only be checked by hand in the playground.

> **Maintenance rule — keep this file current.** Any change that adds,
> removes, or reshapes functionality must update the matrix below in the same
> commit. When a manual-only behavior gains a test, move it from the manual
> checklist into the automated matrix. A row that names a test file that no
> longer covers it is worse than no row at all.

## The three gates

Run in this order; each is cheaper than the next.

1. `npm run typecheck` — the build-equivalent check (no build step exists).
   Also the enforcement point for the `protocol.ts` type-only contract: a
   wire-shape change breaks the other side here, not at runtime.
2. `npm test` — vitest characterization suite (patchers, middleware, schema
   introspection, client markdown). These tests are the spec of current
   behavior.
3. Manual playground drive — for anything client/overlay-side or anything
   touching the real Astro dev server. Recipe in
   [.claude/skills/verify/SKILL.md](../.claude/skills/verify/SKILL.md);
   checklist below. Never verify against the real consuming site on `:4321`
   (it runs an installed copy, not the working tree).

## Automated coverage matrix

### Server (`src/server/`)

| Functionality | Test file |
| --- | --- |
| Route dispatch: base-path passthrough, exact-path matching, query strings, 404s | `tests/middleware.test.ts` (routing & guards) |
| Security gate: non-localhost 403, foreign-Origin 403, localhost Origin accepted | `tests/middleware.test.ts` (routing & guards) |
| Request hygiene: body size caps, malformed JSON, missing/mistyped fields → 400 | `tests/middleware.test.ts` (per-route cases) |
| `GET /health` — option-derived flags (`cssInspector`, `openInEditor`, `entryEditor`); `unsplash` true only when enabled *and* a key resolves, false when disabled / empty key / resolution throws; `unsplashImportWidth` reporting the resolved width and absent when the feature is off | `tests/middleware.test.ts`, `tests/unsplash-routes.test.ts` |
| **Import-width safelist** (`shared/unsplash.ts`) — every offered width parsed from both a number and its wire text, a near-miss (801, 2399, 12000, 0, negative) and a non-width (`''`, `null`, `'2400px'`, `'2400&fm=png'`, objects) **refused rather than clamped**, the choices exposed as ordered text for the option select, the default itself on the list, and the UI labels | `tests/unsplash-width.test.ts` |
| **`unsplash.importWidth` resolution** (`options.ts`) — defaults to 2400; a numeric config value reported as the matching string choice (or the panel's select matches nothing); `'original'` through both layers; a hand-edited off-safelist file value falling back rather than resolving to a width the import route would refuse; a saved width stored parsed, not stringly-typed; an unoffered choice refused | `tests/options-resolve.test.ts` |
| **Option resolution** (`options.ts`) — precedence `astro.config.mjs` > settings file > `DEFAULTS`; a config `false` reads as *set* rather than absent (what `locked` rests on); an option the config is silent about stays writable; `enabled`/`sourceAnnotations` never taken from the file and absent from the writable-key list; malformed or wrong-shaped settings file degrades to config + defaults; `entryEditor` deep-merged per collection *per field* with the config leaf winning | `tests/options-resolve.test.ts` |
| **Option patching** (`options.ts`) — type coercion and refusals per option kind (unknown / config-only / mistyped / empty string / empty list), patch ordered by the option table so a feature toggle precedes the sub-options it gates, merge-not-replace, a feature's detail surviving an off/on cycle, the access key never persisted through the option path, and the caller's document never mutated | `tests/options-resolve.test.ts` |
| `GET`/`POST /settings` **(options half)** — every option described well enough to render a control (label/help/type/group/value/source/locked, `choices` for a select), config-set marked locked and config-only marked restart-requiring, a read touching no filesystem; a sparse patch stored and answered with full new state, visible to the very next request with no restart, biting on the gate it controls (`/inspect/open` 403) and on write confinement (`contentRoots` narrowing → `/apply` refused), merge-not-replace, fixed root path `0600` with no temp file, locked/config-only/unknown/mistyped keys refused **whole** with `fieldErrors` and nothing written, empty body 400, and the fresh-project case: the Unsplash source switched on from the panel with no config edit | `tests/settings-routes.test.ts` |
| `GET /assets` — asset dirs listed as sorted web paths, `public/` mapped to `/` | `tests/middleware.test.ts` |
| `listAssets` — `AssetInfo` shape (`path`/`size`/`mtime`), mtime ordering for the newest-first sort, extension filter, dedupe across nested asset dirs, escaping/nonexistent dirs skipped | `tests/assets.test.ts` |
| `POST /upload` — data-URL write into the configured `uploadDir`, clash suffixing, traversal sanitising, mime/payload rejection (the `saveBuffer`/`resolveAssetTarget` extractions are pinned by these passing unedited) | `tests/middleware.test.ts` |
| `POST /open` — disabled-by-config 403; path gate matches `/classify`/`/apply` (out-of-content-roots, out-resolving symlink, bad extension, nonexistent, missing field → 400) | `tests/middleware.test.ts` |
| `POST /page-source` + `route-manifest.ts` — route-manifest lookup: static and dynamic (`[slug]`, `[...slug]`) routes, index-beats-catch-all priority (first hit in Astro's own sorted order), both trailing-slash styles via the slash-flip variant and the variants-outer ordering, `base` stripped incl. unnormalized `docs` / `/docs/` and a lookalike prefix, percent-encoded non-ASCII, non-`page` types skipped, package-owned / outside-root / absent entrypoints refused by kind, junk normalized, a live routes thunk seeing a page added mid-session; route gating (`openInEditor: false` → 403), missing `pathname` → 400, and each refusal answered 200 with `file: null` | `tests/page-source.test.ts` |
| `POST /peek` — whole-file lines + focus/total metadata, ±1000-line huge-file cap, no-loc default, out-of-range clamp, path rejection; out-of-root/package-owned paths refuse softly (200 + `refused`, no source) | `tests/middleware.test.ts` |
| `POST /classify` — literal text, dynamic for non-`.astro`, nonexistent rejection; out-of-root, `node_modules`, and out-resolving symlinks answer 200 `dynamic` instead of throwing | `tests/middleware.test.ts` |
| Read/write asymmetry of the path gate — `/classify` and `/peek` soften for package-owned paths, while `/open` and `/apply` still refuse them with 400 and leave the file byte-identical | `tests/middleware.test.ts` |
| `POST /apply` — atomic on-disk patch, multi-op batch (verify-all-then-write-once; a refused op writes nothing), unsupported/refusal 422s, empty-ops/validation 400s | `tests/middleware.test.ts` |
| `POST /unsplash/search` — outbound query/paging/orientation + `Client-ID`/`Accept-Version` headers, the reshape (no raw Unsplash field, no download/raw URL crosses the wire), utm params appended with correct separator, perPage/page clamping, blank query 400, disabled 403, unconfigured 403 **with fetch never called**, 401→502 / 403→429 / 5xx→502 / network→502 / `TimeoutError`→504 / malformed JSON→502, TTL cache serving a repeat from one call | `tests/unsplash-routes.test.ts` |
| `POST /unsplash/import` — bytes land in `uploadDir`, byte URL carries `w`/`fit`/`q`/`fm=jpg` and preserves `ixid`, a per-import `width` honoured and `'original'` **deleting** `w` rather than merely not setting it, an absent width falling back to the resolved option, an off-safelist width (numeric or a string carrying extra query text) refused 400 with no fetch and nothing written, the `download_location` ping fires authenticated with its `ixid`, a failed ping still succeeds, `assetRef: 'relative'` → `imageUploadDir`, targetDir honoured/ignored-outside/ignored-escaping, hostile description → safe basename, re-import suffixes, unknown id → 409 `expired`, byte-fetch failure / non-image content-type / over-cap body → 502 **with nothing written**, cache eviction 409s the oldest id | `tests/unsplash-routes.test.ts` |
| `GET`/`POST /settings` **(access-key half)** — write-then-read reports masked and **never the raw key**, fixed root path written `0600` with no temp file left, malformed file degrades to unconfigured, clearing, `config` > `env` > `file` precedence, a config/env key refuses a store (409), disabled 403 touching no filesystem, and a stored key usable by the **next** search with no restart. Deliberately **not** moved to `tests/settings-routes.test.ts` with the option half: these cases run the key through the injected `UnsplashConfig` seam, and the last one asserts it reaches the next *search* — which needs this suite's recording fetch fake | `tests/unsplash-routes.test.ts` |
| `POST /collections` — the designer's read: fields joined to the config source (derived types plus each field's verbatim zod expression), entry counts, `dirExists`, `registered`, `schemaForm`, the config etag every write needs; `schemaEditor: false` reported without refusing the read; entry editor off → 403 `disabled`; no config → nulls and an empty list; a collection whose directory is missing; `lockedFields` naming the fields whose override the *config* owns (and **not** naming one the panel itself stored); a config that fails to load still listing its collections from the source with `fieldSource: 'source'` | `tests/schema-routes.test.ts` |
| `POST /collection/schema/apply` — add/update/remove in one etag-guarded write; stale **and missing** etag → 409 with the file byte-identical; `schemaEditor: false` → 403 touching no file; all-or-nothing (one refused edit in a batch writes none); non-identifier field name and unknown field type refused; the two stores staying separate — overrides land in `.astro-dev-edit.json` and the config is untouched, overrides still save while `schemaEditor` is off, a cleared override removes the entry rather than storing a no-op, unknown widget refused before any file is written; empty request 400 | `tests/schema-routes.test.ts` |
| `POST /collection/create` — block appended, name registered, directory made; directory outside `contentRoots` and a traversing directory refused with nothing created; a glob pattern carrying a quote refused (it is written verbatim into generated source); duplicate 409; `schemaEditor: false` 403; a field needing `image()` switching the emitted schema to the function form | `tests/schema-routes.test.ts` |
| `POST /collection/entries` — the Items listing: newest-first, title-ish frontmatter key, `draft: true` flagged, nested files included, `editableExtensions` honoured, missing directory → empty list, directory outside `contentRoots` refused, entry editor off → 403 | `tests/schema-routes.test.ts` |
| `POST /collection/open` — `openInEditor: false` → 403 `disabled`. The launch itself is playground-only, like `/open` | `tests/schema-routes.test.ts` |
| `POST /entry` — schema fields + values + body + etag; inference fallback; path rejection | `tests/middleware-entry.test.ts` |
| `POST /entry/apply` — atomic frontmatter+body write, stale-etag 409, schema 422 with fieldErrors, date coercion | `tests/middleware-entry.test.ts` |
| `POST /entry/create` — valid create, slug-clash 409, missing-required 422, unknown collection / empty slug rejection | `tests/middleware-entry.test.ts` |
| `POST /entry/create` extension choice — configured `extension` wins, uniform-`.mdx` collection inferred (nested dirs included), mixed falls back to `.md`, non-editable extension 422 | `tests/middleware-entry.test.ts` |
| `POST /entry/delete` — fresh-etag delete, stale-etag 409 keeps file | `tests/middleware-entry.test.ts` |
| Entry editor disabled → all `/entry*` rejected | `tests/middleware-entry.test.ts` |
| `annotateAstroSource` — self-annotation for Astro ≥7: loc parity with `locOf` (text/expression/childless rules), component skip, elements inside expressions, self-closing tags, attr escaping, no-newline invariant, classify/apply round-trip against the original source | `tests/annotate.test.ts` |
| `locateSelector` — CSS-inspector best-effort selector→line: class/id hit in a `.css` file, token-boundary (no prefix collision), absent→null; `.astro` search confined to `<style>` blocks (markup class attrs ignored) | `tests/inspect-locate.test.ts` |
| `zodToFields` — playground blog schema, primitive/enum/array mapping, wrapper unwrapping, `readonly`, image() stub → `assetRef: 'relative'` (bare **and** through `.optional()`), plain-string no-assetRef, degrade-to-json. **Runs against both zod majors from the same assertions** | `tests/schema-introspect.test.ts` |
| `validateChanges` — null-deletion rules for optional/defaulted/required/unknown keys; wrong-type rejection, blanking a required field, `z.date()` string bridging, and an unreadable date answered in its own words across `z.date()`/`z.coerce.date()`/optional rather than with zod's "expected date, received Date" (non-date errors still zod's). **Both majors** | `tests/schema-introspect.test.ts` |
| `zod-adapt` accessor tables — major detection, kind normalization, every wrapper (`optional`/`nullable`/`default`/`catch`/`readonly`, v4 `nonoptional` pinning), `.describe()` post-unwrap, enum options, array element, literal value, object shape, transform/refine/brand see-through, v4 `pipe` following `in`; non-zod → null | `tests/zod-adapt.test.ts` |
| `inferFields` — type inference from frontmatter values | `tests/schema-introspect.test.ts` |
| `asset-path` conversions — entry-relative ↔ served path, nested/sibling/deeper dirs, round-trips, `./` for siblings, root-escape refusal, `public/` refusal for `image()`, Windows separators, upload-dir derivation | `tests/asset-path.test.ts` |
| `POST /upload` `assetRef: 'relative'` — `imageUploadDir` fallback, honoured in-asset-dir target, ignored out-of-asset-dir and root-escaping targets, GIF refusal (422) vs GIF allowed for web-path uploads | `tests/middleware.test.ts` |

Not automated: `content-config.ts` (loads the project's real
`content.config.ts` via `ssrLoadModule`) is injected and **stubbed** in every
test — its real code path only runs in the playground. Same for `/open` and
`/inspect/open` actually launching an editor (the pure `locateSelector` is
tested directly; the route's fs read + launch only run in the playground), and
for `createAnnotatePlugin`'s Vite
hook-ordering (`transform: { order: 'pre' }` must beat Astro's own compile
plugin — only observable against a real Astro ≥7 dev server; check that dev
SSR contains `data-astro-source-*` on all files, not just page entries).

**zod majors.** The introspection suites import v3 from the `zod`
devDependency and v4 from `astro/zod` — the exact module a consuming Astro 7
project loads, so the tables break if zod moves its internals again. Note the
asymmetry: the playground runs Astro 7 (zod v4), so **v3 has unit coverage but
no live surface**. A regression in the v3 table would pass every automated gate
and the playground drive alike; only a real Astro 5/6 project would catch it.
This is also how the v4 breakage shipped unnoticed — the suite pinned v3
behaviour that no Astro 7 consumer executes.

### Patchers (`src/patcher/`)

| Functionality | Test file |
| --- | --- |
| `classifyAstro` — text/markup/dynamic/empty/image classification, inline-safelist rules (block child, disallowed attr, expression attr, nested expression wins the reason), ambiguity refusal, unresolved locs, tag mismatch | `tests/patcher-classify.test.ts` |
| `applyAstro` text — replace, whitespace frame, entity decoding (incl. typographic entities; unknown ones still refuse), escaping `<`/`{`/`&`, whitespace-insensitive verify, mismatch/dynamic/unresolved/ambiguous refusals | `tests/patcher-apply-text.test.ts` |
| `expression-trace.ts` + `applyAstro` expressions — plain const and `.map()` member access, the rendered text picking the right item, quote style kept and quotes escaped, refusals for no-match/duplicate-text/imported array/computed/shadowed param/`.filter()` chain/interpolated template, and neither a matching string outside the array nor a same-named nested key confusing the match | `tests/patcher-apply-expression.test.ts` |
| `applyAstro` markup — inner-source replacement, plain text gaining its first inline tag, whitespace frame, entities left as typed, `{` neutralised, source-vs-source verify, refusals for non-safelisted tags/`<script>`/event handlers/`javascript:` hrefs/unbalanced and crossed tags, allowed link attributes, self-closing `<br />` | `tests/patcher-apply-markup.test.ts` |
| `applyAstro` attributes — src/alt replacement, quote escaping, missing-alt insertion (incl. self-closing and expression-attr neighbors), never-insert-src, exact-match verify | `tests/patcher-apply-attrs.test.ts` |
| `frontmatter.ts` — parse (fences, BOM, CRLF, invalid YAML), surgical apply (comments, key order, quoting, no re-wrap), serialize new entries, refusals | `tests/frontmatter.test.ts` |
| `content-config.ts` — the content-config patcher. `blankNonCode` (strings/templates/comments/regex blanked, offsets and line count preserved, a division left alone); `readCollectionBlocks` on both schema forms with each field's verbatim expression, braces and colons inside strings and comments not mistaken for structure, helper-built schema and spread-holding field list reported `unrecognized`, unregistered block detected, **and the real playground config parsed as a drift guard**; `addField` inserting one line at the right indentation in both forms (nothing else moves), single-line and empty schemas, a missing trailing comma supplied, `image()` refused on a plain object schema with the fix named, duplicate/unknown-collection/unrecognized refusals; `updateField` replacing only the expression (comments above and same-line comments intact) and rewriting enum options; `removeField` taking only the field's own line, leaving a comment above it, no dangling comma on the last field, emptying to `z.object({})`; `addCollection` appending a block and registering the name (single-line and multiline registries), switching to the function form for `image()`, adding the `glob` import when absent, refusing duplicate/missing-registry/no-imports/non-identifier | `tests/content-config-patch.test.ts` |
| **`renderZodField` ↔ `schema-introspect.ts::terminalType` round trip** — every `FieldType` rendered, evaluated with the real zod, read back through `zodToFields`, and required to come back as the same type; `.optional()`/`.default(…)` surviving; `json`, an empty select and a date default refused. This is the test that keeps the two halves of the schema vocabulary in step — the same kind of standing invariant `annotate.ts` has against the patcher's loc rules | `tests/content-config-patch.test.ts` |

Use `tests/helpers.ts::locOf` to build classify/apply requests — it mirrors
the loc rules in `astro.ts`.

### Client (`src/client/`)

| Functionality | Test file |
| --- | --- |
| `markdown.ts` — `markdownToHtml` rendering subset, `canRichEdit` accept/refuse | `tests/markdown.test.ts` |
| `editors/markup-insert.ts` — tag palette: pair wraps and keeps the selection, empty pair at the caret, void tag replaces rather than wraps, `<a href="">` caret inside the quotes, palette matches the patcher's safelist | `tests/markup-insert.test.ts` |
| `classify-cache.ts` — verdict caching per file\|loc\|tag, in-flight dedupe, failure retry, HMR invalidation (incl. mid-flight) | `tests/classify-cache.test.ts` |
| `unsplash-search.ts` — the DOM-free search controller: debounce collapsing keystrokes to one request, blank/whitespace staying idle with no fetch, immediate reset on clear, `retry()` bypassing the debounce, stale responses (and stale errors) discarded, zero results as `empty` not an empty `ready`, error code/retryability surfaced, `loadMore` appending and bumping the page, discarded when the query or orientation changed mid-flight, a failed page keeping the shown results via `moreError`, orientation re-running immediately, `dispose()` cancelling | `tests/unsplash-search.test.ts` |
| `highlight.ts` — peek tokenizer: lossless round-trip, fence/tag/attr/string/keyword/comment classification, multi-line comment carry, URL/apostrophe/identifier-digit false-positive guards, plain-text degrade | `tests/highlight.test.ts` |
| `tree-model.ts` — `buildTreeModel` nesting: roots in document order, direct children, loop siblings sharing one loc kept distinct, reparent across an unannotated component gap, sourceless elements dropped, empty input | `tests/tree-model.test.ts` |
| `ui.ts` — contrast guard on the design tokens. Parses both notations (`#rrggbb` and `rgb(r g b / a)`) and **flattens a translucent token onto the ground beneath it**, since `border`/`input`/`inputBg` have one ratio per surface rather than one ratio. Every ink against **all three** surfaces (`background`, `card`, `elevated`) at AA 4.5:1, plus `foreground`/`mutedFg` against a field interior composited on each; `foreground` on `brand` and `success`, `primaryFg` on `primary` and `destructive` — and that `foreground` *fails* on `primary`, so the dark-ink pairing cannot be dropped; `input`/`ring`/`destructive` at the 3:1 a control boundary requires; `brand`/`success` still failing as foregrounds, which is what `brandText`/`successText` are for; `border` staying *below* 3:1 because a separator is not a control; `inputBg` lifting the surface without becoming one; the neutral ramp achromatic on parsed channels (translucent white included) with `primary` in it and `brand` deliberately not; and the rich-text editor's light `PAPER` set clearing AA on its own ground while being invisible on the dark surfaces, so the two cannot be mixed | `tests/contrast.test.ts` |
| `group.ts` — no unit test: pure DOM with no branching beyond "was this slot given". Covered by the **Grouping and precedence** manual checklist below | — |
| `element-context.ts` — `formatContext` clipboard payload: section order and omission (absent entry/box, and the never-formatted editability verdict), `>` focus-line gutter marking, quoted-range wording, fence language per extension, refused-source sentence, empty-CSS note, rule blocks with/without a source comment, both truncation notices; `relativize` root stripping (trailing slash, outside-root, already-relative, unknown root, Windows separators); `windowAround` 1-based slicing (clamped both ends, whole file, pre-windowed response) | `tests/element-context.test.ts` |

The Settings drawer itself has no unit tests — it is DOM-bound — but it is
**almost entirely server-driven**: the option list, every label, every control
type and every `locked` flag come from `/settings`, so `tests/settings-routes.test.ts`
pins what the drawer will render. What remains manual is the rendering itself.

The same holds for the **Collections drawer**: the collection list, each field's
type, its verbatim expression, which fields' overrides are locked and whether the
schema is patchable at all come from `/collections`, and every write it can make
is pinned in `tests/schema-routes.test.ts` against the patcher tests underneath.
What is manual is the two-store rendering, the Items view and the reopen-after-
reload behaviour.

**Everything else in `src/client/` has no unit tests** — it is DOM- and
dev-server-bound and is verified only by the manual checklist below. When
extracting pure logic from a client module (as `markdown.ts` was), add a test
file and move the row up here.

**The shadow root (`shadow.ts`, `styles.ts`) is manual for the same reason**, and
four of its behaviours fail *silently* rather than visibly — they are the first
things to check after touching anything in `src/client/`:

- [ ] **Event retargeting.** A `document`-level listener sees `event.target` as
      the host element, so an `e.target`-based "is this ours" test answers wrong
      without erroring. Covered by the pill, menu and bar-focus items in the
      *Boot & chrome* list below; the three known sites are `hover.ts`'s
      `isOwnUi`, the menu's click-outside, and `applyVisibility`'s
      `overlayActiveElement()`.
- [ ] **Mount points.** Every panel must open — settings, collections, entry
      drawer, media modal, peek, notice, source popup, copy panel, toast, veil.
      Each is a separate `mount()` call, and one missed redirect appends to the
      document instead, where the page's CSS can repaint it.
- [ ] **The slotted writing surface.** Open an entry with a body: the white
      markdown island must render *inside* the drawer, its toolbar must apply
      bold to a selection, and closing the drawer must leave
      `document.querySelector('astro-dev-edit').children.length === 0` — the
      light-DOM node is not removed by the drawer going away, only by
      `BodyEditor.destroy()`. **Check this in Safari specifically**; it is the
      engine the arrangement exists for.
- [ ] **The theming API.** `astro-dev-edit { --atx-card: … }` reaches inside,
      and `astro-dev-edit::part(bar) { … }` matches. Both are documented
      promises in `docs/STYLING.md`.

## Manual checklist (playground)

Launch per the [verify skill](../.claude/skills/verify/SKILL.md). Work through
whichever sections your change touches; run the whole list before a release.

**Boot & chrome**

- [ ] The admin bar (`#atx-bar`) spans the top of the page, translucent at rest
      and opaque as the pointer approaches, **overlaying** the site's own header
      rather than pushing the page down. Order: mark · Elements · Edit page ·
      Edit entry (only on pages declaring a page-source meta) … pin · dock ·
      exit. Every icon renders (`atx-ico`, inline SVG).
- [ ] **Pin**: lit while pinned. Unpin **out of edit mode** → the bar slides off
      the edge and leaves the hairline (`#atx-hairline`); moving the pointer to
      that edge brings it back, moving away retracts it again; a retracted bar
      swallows no clicks. Pinned/unpinned survives a reload
      (`localStorage.astroDevEditBar`).
- [ ] Unpinned **in edit mode** the bar never retracts: it stays on the edge
      (translucent at rest, opaque on approach) with no hairline, so the exit
      button and save state are always on screen. Unpin mid-edit → nothing
      slides away; leave edit mode → it retracts, pointer permitting. Enter edit
      mode from a retracted bar → it comes out and stays out.
- [ ] **Dock**: flips the bar to the bottom. The element tree and toasts move
      clear of it, the overflow menu opens upward, and the choice persists.
      Neither edge lets the bar overlap the tree, pinned or not.
- [ ] The mark opens the overflow menu; Escape and an outside click close it,
      and the bar cannot retract while it is open.
- [ ] Overflow menu → *Open page source*: on `/` it opens
      **`src/pages/index.astro`** — not `Nav.astro` or `Base.astro` — with a
      toast naming the pattern `/`; on `/articles/` it opens
      `src/pages/articles/index.astro`, and on an article
      `src/pages/articles/[...slug].astro`. Browse to a URL with no route → the
      toast says no route matched and **nothing opens**. Add a page while the
      dev server runs and visit it → it resolves with no restart (the routes
      hook re-fired). With `openInEditor` off, the item is gone.
- [ ] Edit mode persists across a reload (`sessionStorage.astroDevEditMode`).

**Save state & leaving edit mode** (the bar's exit button)

- [ ] Edit mode on with nothing pending → green **Done**; clicking it leaves
      edit mode.
- [ ] Type in an inline edit → purple **Save & exit**; typing the original text
      back returns it to **Done**. Escape restores the text and clears the state
      without writing.
- [ ] Clicking **Save & exit** with unsaved keystrokes writes the file
      (grey **Saving…** → green **Saved**) and leaves edit mode only after the
      write lands — never before, and never discarding the change. Same for the
      **Editing** toggle, which routes through the same exit.
- [ ] A refused write (edit, then change the file underneath) shows red
      **Save failed**, keeps you in edit mode, and the file is untouched.
- [ ] Click **Save & exit** with a real pointer *while the inline edit still has
      focus* (the blur-commit and the click race there): the file is written and
      edit mode ends — the bar comes back saying **Edit page**, not **Editing**.
- [ ] With any panel or drawer open, Tab cycles inside it and wraps at both
      ends — the site's own links, Astro's toolbar and the admin bar are never
      reached — and closing it puts focus back where it was. Open the media
      modal over the entry drawer: the modal traps, and closing it hands the
      trap back to the drawer rather than dropping it. The drawer's rich-text
      body (light DOM, slotted) is reachable and keeps focus while typing.
- [ ] Type into an expression or markup popup, then activate **Save & exit** by
      keyboard (the backdrop swallows a pointer click on the bar) → the draft is
      written and edit mode ends. If the write is refused, the popup stays open
      with the text in it and edit mode stays on.

**Inline text editing** (e.g. `/articles/` listing)

- [ ] Edit mode on → hovering boxes the element and shows a neutral grey pill
      (`file:loc · loading…`); after resting ~500ms on it the pill upgrades to
      the server verdict — purple `editable` on literal text, amber `dynamic`
      on expression-driven content, green `image` on a static `<img>` — with
      no change in pill width (the verdict slot is fixed-width). Only the box
      carries the verdict colour; the pill has no coloured edge, and its
      corners wrap its `open`/`copy` buttons rather than cutting them. The box
      stands 2px clear of the element on every side — on a heading whose ink
      runs to its box, the border must not touch the letters. Sweeping
      the mouse across elements without resting fires no `/classify` requests,
      a re-hover of a verified element shows its verdict instantly with no new
      request (network tab), and after an HMR update verdicts re-verify.
- [ ] Click on literal text opens the inline contenteditable (works before the
      verdict lands, too); save writes the file and HMR refreshes.
- [ ] Mousing from an element up to its pill (crossing the parent en route)
      keeps the pill in place — no instant retarget; the pill's **open**
      button jumps to the source in the editor.
- [ ] Clicking the pill's file:loc label opens the source-peek panel: wide
      layout, line numbers, syntax tinting, the whole file scrollable with
      the element's line highlighted and centered, Escape / backdrop / Close
      dismisses, and "Open in editor" jumps out.
- [ ] **Markup popup**: click the home page's `The page is the best<br>editor
      for the page` heading → a popup titled `Markup · index.astro:44:13`
      showing the raw source `The page is the best<br>editor for the page` (not
      the DOM's innerHTML), the allowed-tags hint below it. Edit the words →
      Save (or Cmd/Ctrl+Enter) → the file is written with the `<br>` intact and
      HMR refreshes. Escape / backdrop / Cancel discards. Typing a `<div>`, a
      `<script>`, an `onclick=` attribute or an unclosed `<strong>` → the save
      is refused with the reason shown **inside the popup** (`atx-popup-error`),
      the popup still open and the typed markup intact, the bar reading "Save
      failed", and the file untouched — fixing the markup and saving again
      succeeds and closes the popup.
- [ ] **Open from the title bar** (both source popups): click **open** →
      the editor jumps to that `file:line:col`, a toast confirms it, and the
      popup stays open with the typed text intact.
- [ ] **Tag palette** (same popup): select a word → click `<strong>` → it is
      wrapped and stays selected; click `<em>` again → the tags stack. With no
      selection, `<span>` drops an empty pair with the caret between the halves,
      `<br>` inserts alone, and `<a>` inserts `<a href="">` with the caret
      inside the quotes. Clicking a tag never collapses the selection first, the
      exit button turns purple (dirty), and Cmd/Ctrl+Z undoes the insertion.
      Restore the fixture afterwards.
- [ ] **Value popup** (the home page's benefit cards, a `.map()` over
      `const benefits`): click the *fourth* card's heading → a popup titled
      `Value · benefits[].title` holding that card's text and **no tag palette**
      (`{value}` renders escaped). Change it → Save → the **fourth** array item
      is the one rewritten, the other five untouched, HMR refreshes. Repeat on a
      card's `<p>` → `benefits[].body`. Temporarily give two items the same
      title, click one → the save refuses inside the popup as ambiguous and the
      file is untouched. Restore the fixture afterwards.
- [ ] Clicking dynamic content that can't be traced (`{n + 1}`, an imported
      array) opens the refusal notice with a working "Open source" button —
      never a false edit; its file:loc line opens the source peek.
- [ ] An element rendered by `astro:assets` `<Image>` reports "rendered by a
      package component" instead of logging a `classify failed` WARN, and
      clicking its file:loc label shows that sentence in the peek panel rather
      than an error. The playground has no `<Image>` fixture — verify against a
      consuming site that uses one.
- [ ] **On a host page running a smooth-scroll library** (Lenis et al.): the
      source peek scrolls under the cursor and the page behind it stays put,
      including at the peek's top/bottom ends. Same for the entry drawer body
      and the asset list. Not reproducible in the playground — it has no
      smooth-scroll library.
- [ ] Escape / click-away discards; a stale edit (file changed underneath)
      fails safe with a mismatch message, file untouched.

**Copy context** (hover pill `copy`)

- [ ] Hovering an element and clicking `copy` flips the label to
      `copying…` → `copied` (pill width unchanged) and toasts
      "Copied context for `<label>` — N KB". Pasting gives a markdown block
      whose loc is **repo-relative** (`src/pages/index.astro:12:3`, not an
      absolute fsPath — the `root` from `/health`), with the rendered HTML, the
      source window whose `>` line is the element's own, and the matching CSS
      rules.
- [ ] On a detail page the payload carries the **Content entry** line; on a
      page without the meta tag it is absent.
- [ ] An `astro:assets` `<Image>`: the Source section reads "Not available —
      rendered by a package component" and everything else still copies.
- [ ] The copied HTML contains no `atx-*` class, on a page where an overlay
      panel was open at copy time.
- [ ] An element over the caps (>4 000 characters of markup, or >40 matching
      rules) ends its section with the `_Truncated — …_` notice. No playground
      fixture is that big — check on a real site.
- [ ] Clipboard refused (open the playground over a LAN address, or block the
      permission): the fallback panel opens with the text preselected, its Copy
      works, Escape/backdrop/Close dismiss it, and the pill's button returns to
      `copy` rather than claiming success.

**CSS inspector** (hover pill chips)

- [ ] With `cssInspector` on (default), hovering an element that has classes/an
      ID grows the pill with a chips row (`.atx-tooltip-chips`); an element with
      neither leaves the pill unchanged. Astro's `astro-*` scope class is not
      shown as a chip.
- [ ] Hovering a class chip pops a rules card showing the applied declarations;
      a chip whose token doesn't actually apply shows "No applied rules". Moving
      the pointer from chip → card keeps both open; leaving both dismisses them.
- [ ] The card's `open` jumps the editor to (near) the rule — verify for a
      **global `.css`** rule and an **Astro scoped `<style>`** rule (which
      resolves to the `.astro` file). A rule from an external/CDN or inline
      `<style>` still shows its CSS but offers no open link.
- [ ] `cssInspector: false` → no chips row at all. `openInEditor: false` → the
      card's open link fails with a toast (chips + CSS still shown).

**Element tree** (left panel, opened on request in edit mode)

- [ ] Edit mode on → the tree (`.atx-tree`) stays **closed**, showing only its
      tab (`#atx-tree-tab`) on the left edge. The tab or the bar's **Elements**
      opens it: it docks to the left listing the page's annotated elements,
      nested; chevrons collapse/expand nodes.
- [ ] Closing it with the ✕ (`.atx-tree-close`) while still editing puts the tab
      back; the tab and **Elements** both reopen it, and **Elements** is lit
      exactly while the panel is open. Leaving edit mode hides panel and tab
      both. **Elements** from a cold page turns edit mode on with the tree.
- [ ] Open the tree, edit + save → after the reload edit mode **and** the open
      tree come back (session-remembered); do the same with the tree closed and
      it stays closed, tab only.
- [ ] Hovering a row outlines the matching element on the page with the verdict
      pill and class/ID chips; a clicked row's locked selection sits the same
      2px clear of the element as the hover box; hovering an element on the page highlights its row
      (dashed, `.atx-tree-selection` distinct) and scrolls the tree to it.
- [ ] Clicking a row locks a persistent selection outline and scrolls the element
      into view; scrolling the page keeps the outline glued to it. With a row
      selected, moving the mouse onto the element to read its classes leaves the
      selection intact — it clears only on Escape, a click elsewhere on the page,
      or selecting another row.
- [ ] Double-clicking a row opens the correct editor (text / image / entry),
      same as clicking the element on the page. Clicking a row's `line:col`
      (`.atx-tree-loc`) instead jumps the editor to that file+line and does not
      select the row.
- [ ] Edit + save → after HMR the tree rebuilds and keeps its collapsed/expanded
      and selected state (matched by structural path across the DOM replacement).
- [ ] Opening the entry drawer overlays the tree; page clicks still route
      normally while the tree is open (it never blocks the click router).

**Image editing**

- [ ] Click an `<img>` in edit mode → swap panel with preview, asset browse,
      upload, and alt-text field; save patches src/alt in the source.

**Hold-to-navigate**

- [ ] Holding Ctrl or Alt/Option in edit mode suspends editing; link clicks
      navigate normally (no new tab, no download, no context menu); the
      "hold … to navigate" hint shows under the toggle.

**Entry drawer (CMS)** (e.g. `/articles/editing-astro-sites`)

- [ ] ✎ Edit entry pill opens the drawer; fields match the collection's zod
      schema (date → native picker, enum → select, image → picker control,
      unknown → read-only json). Fields report `source: "schema"`, **not
      `"inferred"`** — inferred everywhere means schema introspection is dead
      for that project's zod major, and every check below it is meaningless.
- [ ] Send a required field a value its schema rejects — a non-option for
      `category`, a word for `year` — and save → 422 with an inline field
      error, not a silent write. (Validation is only live when the schema
      resolved.) Note that *emptying a text box is not this test*: a bare
      `z.string()` accepts `''`, so a blanked `title` is validly written as
      `title: ""`. The 422 comes from **clearing** the key (`null`), which is
      what the drawer sends for a field it is removing.
- [ ] Save writes frontmatter surgically — comments, key order, and quoting
      preserved in the entry file.
- [ ] Dirty-close asks for confirmation; a concurrent external file edit then
      save → etag conflict surfaced, file not clobbered.
- [ ] Every field is named by its own label: clicking the label focuses the
      input (and ticks a checkbox), and `input.labels[0]` is the visible field
      name — including a checkbox, whose state word is its description, not its
      name. Same in the Settings drawer, which shares the renderer.
- [ ] The playground's `astro-dev-edit:page-source` meta is present in dev and
      **absent from `examples/playground/dist/`** after `npm run build` — the
      layout gates it on `import.meta.env.DEV`, which is what the reference
      asks every consuming layout to do.
- [ ] Entry create (new slug) and delete flows work end-to-end; after create
      the browser polls the new URL and lands on the rendered page (not a
      404), even when the content-layer sync is slow.
- [ ] In the **New entry** drawer every control starts unset: a defaulted field
      shows its default as a placeholder and an unticked checkbox reads
      "not set — defaults to On/Off". Create while leaving fields alone → the
      written file holds **only what you filled in**, so `published:` is absent
      and the schema's `.default(true)` is what the page renders.

**`image()` schema fields** (`/works/onvero` — the `works` collection exists for
this; `cover` is required and `thumbnail` is `image().optional()`, both pointing
into a nested asset dir. `/works/ledger` leaves `thumbnail` unset.)

- [ ] Both image fields show a **rendered preview**, not "No image — click to
      browse", and a hint naming the file the value is relative to.
- [ ] Browse… opens scoped to the field's own asset dir (count reads `N of M ·
      src/assets/works/onvero`); the filter narrows; "Show all" widens.
- [ ] **No `public/` assets appear** in the list for these fields.
- [ ] Picking an asset in a *different* directory stores a relative value
      (`../../assets/works/atlas-cover.svg`) and the preview follows it.
- [ ] Save, then confirm the markdown holds the relative path and the page
      still renders — no collection validation error in the dev log.
- [ ] Dropping an image on a populated field uploads into **that field's**
      directory; on the empty `thumbnail` of `/works/ledger` it falls back to
      `imageUploadDir`.
- [ ] Dropping an animated `.gif` on one of these fields is refused with a
      pointer to `public/`.
- [ ] **Regression:** on `/articles/…` (whose `image` is a plain string forced
      to the `image` widget) the field stays web-shaped — no relative hint, no
      scope toggle, `/src/` assets absent from the list, uploads to `uploadDir`.

**Body editor**

- [ ] MD ⇄ Rich toggle; toolbar ops (bold, italic, strikethrough, headings,
      lists, quote, code block, inline code, link, image) round-trip through
      save without mangling the markdown body.
- [ ] A body using unsupported markdown (tables, raw HTML, footnotes, nested
      lists) opens in raw mode and refuses a lossy switch to rich (fixture:
      `/articles/text-editors-vs-visual-editors`, which contains a table).
- [ ] Clicking an image inside the rich editor opens the replace picker; alt
      is auto-suggested from the filename and preserved on swap.

**Media picker**

- [ ] With no `unsplash` option, the modal has **one** tab, no source strip, and
      `/health` reports `unsplash: false` — a pure grid upgrade for projects that
      never opt in.
- [ ] Five columns at the default modal width, no horizontal scroll; a fresh
      upload appears first under **Newest**, and switching to **Name** re-sorts.
- [ ] **Staged pick:** select a tile, press Escape — `git status` clean, nothing
      written. Select, **Use image**, then **Save** — written once, and the
      source holds the clean path with **no `?atx=` cache-buster in it**.
- [ ] **Stacking:** open the modal from the CMS drawer's image field with a
      dirty field. Escape closes the **modal only**, the drawer keeps its unsaved
      values; a second Escape reaches the drawer's own "Discard unsaved changes?".
      (The drawer uses a blocking `window.confirm`, which stalls a Playwright
      driver — stub `window.confirm` before driving this one.)
- [ ] The modal opens from all four hosts: the swap panel's **Browse all**, the
      entry drawer's image field, the rich body editor's image panel, and the
      swap panel's preview.
- [ ] A just-uploaded or just-imported image renders in the preview, the recents
      strip, the grid and the rail — **not** an empty box (Vite 404s a file for a
      moment after it lands; `ui.ts::setFreshSrc` retries).
- [ ] On an `image()` field the pick lands in the field's own asset dir and the
      stored value is entry-relative.

**Unsplash**

- [ ] Settings opens from the admin bar's overflow menu, accepts a key, and
      reports it configured with a masked hint; reload keeps it; the raw key is
      **not** in any response (check the Network tab).
- [ ] `.astro-dev-edit.json` appears at the project root, is `0600`, and
      `git status` does **not** list it. **Clear** removes the key.
- [ ] With a key in `.env` or the config, the Settings field is **disabled** and
      names which one takes precedence; the Save button is visibly disabled.
- [ ] Switching to the Unsplash tab fires no request until you type; typing
      issues **one** `/unsplash/search` after you stop, not one per keystroke.
- [ ] Every tile shows the photographer; the link opens their profile in a new
      tab carrying `utm_source`/`utm_medium`, and clicking it does **not** select
      the photo.
- [ ] `Load more (N of M)` appends a page and disappears on the last.
- [ ] **Import stays interactive:** during a download the tile is busy but the
      backdrop still closes the modal and Escape still works.
- [ ] After an import, `git status` shows a new `.jpg` plus the `src` change, and
      **no `images.unsplash.com` anywhere in the source**.
- [ ] With no key, the pane shows an *Add an Unsplash access key* card whose
      button opens the Settings drawer **above** the modal, **on its Unsplash
      tab**; entering a key re-runs the search, and closing the drawer leaves the
      modal owning Escape and the backdrop again.
- [ ] A bad key shows an error naming the setting with **no** Retry; offline
      shows the reach/timeout error **with** Retry.
- [ ] The requests-left line appears at the foot of the rail.
- [ ] The toolbar's **size select** starts at *Settings → Unsplash → Import
      width* (change that, save, and the select moves with no reload). The
      rail's *Downloads at* line follows the select, and reads
      "N px wide (already smaller)" for a photo narrower than the choice.
- [ ] Importing at **800 px** writes a visibly smaller file than at 2400 —
      check the byte size in `git status`/Finder, and that the request in the
      Network tab carries `w=800`. At **Original size** the request carries no
      `w` at all.

**Settings drawer**

The playground's config sets `contentRoots`, `assetDirs`, `uploadDir`,
`entryEditor` and `unsplash`, which makes it a good test of the locked/editable
split.

- [ ] Admin bar → the purple mark → *Settings* opens a **drawer** with General /
      Editing / Media / Unsplash tabs. Every control has a label and a line of
      help.
- [ ] `contentRoots`, `assetDirs`, `uploadDir`, `entryEditor` and *Unsplash photo
      source* render **disabled with a padlock note**; `editableExtensions`,
      `openInEditor`, `cssInspector`, `imageUploadDir`, *Application name* and
      *Results per page* are editable.
- [ ] `enabled` and `sourceAnnotations` are disabled and say a **restart** is
      needed, whether or not the config mentions them.
- [ ] Locked notes are **muted grey with a padlock**, not amber — amber is
      reserved for the gitignore warning.
- [ ] A locked field's **label stays full-strength white**, the same as an
      editable one's. The dim lands on the control only: a greyed label reads
      as a lesser setting rather than as one this project has already decided.
- [ ] Turn *CSS inspector* off, **Save** (toast: *Settings saved*), close, hover an
      element **with a class** (e.g. the header's `.brand`): no chips row, **with
      no reload**. Turn it back on and the chips return.
- [ ] Editing a locked control is impossible; forcing one through (devtools) is
      refused with a per-control message and `.astro-dev-edit.json` is unchanged.
- [ ] Close with an unsaved change: a discard confirm appears; cancelling keeps
      the drawer, confirming drops the change.
- [ ] `.astro-dev-edit.json` holds **only** the options you changed, and is
      `-rw-------`.
- [ ] With `unsplash: {}` commented out of the playground config and the server
      restarted, the Unsplash tab offers an **enable toggle** — *not* the old
      "add `unsplash: {}` … then restart the dev server" text. Enabling it makes
      the media picker's Unsplash tab appear. Restore the config line after.

**Collections drawer (the designer)**

Opened from **Collections** in the admin bar's overflow menu — its own item, not a
tab inside Settings. The playground gives both schema forms — `blog` is a plain `z.object`, `works` a
function schema with `image()` fields — and its config sets widget overrides on
`blog.excerpt` and `blog.image`, which makes it a good test of the locked split.

- [ ] The menu item is present while `entryEditor` is on and **gone** when the
      Settings drawer's Editing tab switches the entry editor off (the whole
      designer sits behind that gate server-side).
- [ ] The drawer lists `blog` (5 entries, 8 fields) and `works` (2 entries, 7
      fields) with their directories. Its footer holds **Close** only — every save
      in here belongs to the row or the form it changes.
- [ ] Opening `blog` shows the meta line *plain z.object schema*, the two-store
      legend, and a card per field: a **Schema** group (type / required / default,
      plus options for a select) and an **Editor** group (widget / label /
      hidden), with the field's zod expression underneath.
- [ ] `blog.excerpt` and `blog.image` have their **Editor** group disabled with a
      padlock (*set in astro.config.mjs*); `blog.title` does not. `works` has none
      locked.
- [ ] The **Add field** form offers `image` for `works` and **not** for `blog`,
      which instead explains that image fields need the function schema form.
      `textarea` is absent from the type list — it is a widget, offered in the
      Editor group.
- [ ] Add `subtitle` (Text, not required) to `blog` and **Save changes**: the page
      reloads as Astro resyncs, and the drawer **reopens itself in `blog`** with
      `subtitle` showing `z.string().optional()`. `git diff` on
      `src/content.config.ts` is **one inserted line**, every comment and quote
      style intact.
- [ ] The new field appears in the entry drawer for a blog entry — with **no
      dev-server restart**.
- [ ] Remove `subtitle` again through the panel (the card dims, the button becomes
      *Undo remove*) and save: `git diff` on the config is now **empty** — the
      round trip is byte-for-byte.
- [ ] Set `works.client`'s **Widget** to *Textarea* and save: the toast says
      *Saved editor settings*, the config is **untouched**, and
      `.astro-dev-edit.json` holds the override. The entry drawer for a works
      entry renders that field as a textarea.
- [ ] **New collection** → name `notes` (the directory prefills to
      `src/content/notes`), add a `title` field, create: the block is appended,
      `export const collections` gains `notes`, the directory exists, and the
      drawer reopens in `notes`. Create an entry in it from the Items view.
- [ ] Break the config on purpose (`schema: buildSchema()` on a new collection):
      the list still shows every collection, badged **schema not loaded**, with
      field names read from the source; the broken one is badged *no readable
      schema* and adding a field to it is refused as `unrecognized`. Restore.
- [ ] Forcing an `image` field onto `blog` (devtools) is refused with the
      convert-the-schema message; a stale etag is refused with *reopen*;
      both leave the config byte-identical.
- [ ] Turn **Schema editing** off in the Settings drawer's Editing tab: the
      Collections list carries a padlock note, field Schema groups are disabled, **New collection** is
      gone, and widget/label/hidden still save.
- [ ] **Items**: the view shows all 5 blog entries newest-first, with a **draft**
      badge on `drafts-live-here-too` — an entry the rendered site hides. Clicking
      one **closes the Collections drawer** and opens the entry drawer for that
      file.
      Do it with a queued field edit pending: the discard confirm appears first,
      and cancelling keeps you where you were.

**Grouping and precedence** (structure, not tokens — nothing here is unit
testable, because the check is "does the eye group these the way the code says
they group")

- [ ] **Every drawer is a stack of cards on a darker canvas.** Open the entry,
      Settings and Collections drawers. In each, the scrolling area is darker
      than the surfaces on it, every card carries a hairline edge, and no
      control floats directly on the canvas. A card whose header repeats the
      drawer's own title is a bug — the Collections card is titled by count for
      exactly that reason.

- [ ] **A card header states its concern.** The entry drawer's Frontmatter card
      says where its fields came from — "From the collection's schema." when
      `content.config.ts` resolved, "Inferred from the file's own values."
      when it did not. Break the config and reopen: the line must change, since
      it is the only place the drawer says which mode it is in.

- [ ] **A corner action leaves; a footer action completes.** **New** sits in a
      header's top-right and opens something else. Save, Create and Use image
      sit in a footer band — a rule and a darker ground — and are the only
      filled buttons on their surface.

- [ ] **Delete is not in the pair.** In the entry drawer's footer, Delete… is at
      the far left with an icon, and Cancel/Save are together at the right.
      Both Cancel and Close are outlined: a footer action always has an edge,
      whatever it weighs against.

- [ ] **Every clickable has a box, and every surface has one primary.** Sweep
      each drawer, panel and modal: nothing that responds to a click is bare
      text on the background. A control that carries no edge or fill of its own
      is legitimate only *inside* a bounded container that supplies one — the
      markdown toolbar's keys inside its bordered strip, an admin-bar menu item
      inside the menu. Exactly one button per surface is filled near-white; if
      two are, they are competing, and if none is, the surface's primary has
      gone missing or has been drawn somewhere the eye does not look.

- [ ] **The collection designer's primary is in the footer band.** Open a
      collection with more fields than fit: **Save changes** sits in the sticky
      band next to Close, still visible with the field list scrolled to the top.
      Go back to the list and it disappears — a list completes nothing. Open
      **New collection** and the band carries *Create collection* instead.

- [ ] **No glyph is the operating system's.** Nothing in the overlay draws a
      unicode dingbat or an emoji: the markdown toolbar's quote, link and image
      keys, and the media grid's selection tick and broken-thumbnail fallback,
      are all `icons.ts` strokes in `currentColor`. A coloured glyph anywhere
      means a literal has crept back into a `textContent`.

- [ ] **A list is rows, not blocks.** The Collections list gives each row a
      16px icon, a name, a monospaced path-and-counts line, and a chevron.
      Hover fills the row and brightens the chevron; Tab reaches each row and
      Enter opens it, since the row itself carries the button semantics. The
      rows sit flush with a 1px rule between them, and both the rule and the
      hover fill run to the card's own left and right edges — a gap between
      rows, or an inset tile under the pointer, means the list is being drawn
      as a stack of separate objects.

- [ ] **A field's two stores are two columns.** Open a collection: each field
      card shows *Schema* and *Editor* beside each other, their control rows
      lining up. Narrow the window until the drawer hits its 440px floor and
      they stack — a control squeezed off its label instead of stacking means
      the grid's minimum has drifted.

- [ ] **An outlined button has a body.** In any footer band, hold a thumb over
      the labels: *Cancel* and *Save* must still read as two boxes of the same
      weight. An outlined button is a faint fill inside a 1px edge — if it is a
      hairline around the band's own ground, it reads as bare text beside the
      filled confirm however exactly the two boxes measure, which is the
      failure this check exists for. Its edge is `--atx-input`, not
      `--atx-border`: a separator may sit under 3:1, a control may not.

- [ ] **Buttons and fields share a corner.** A button beside a text field is
      the same height and the same radius — if the button reads as a pill next
      to a box, the radius ladder has drifted off its 10px base.

- [ ] **The designer's cards are on the same measure as every other card.**
      Open a collection: a field card has 16px of padding on all four sides,
      12px between it and the next one, and the zod expression under a hairline
      at the card's foot. A store's caption sits 12px above its first row and
      its rows are 12px apart. If two field cards read as one block, the
      measure has slipped back to the 8/10px it was drawn at.

- [ ] **The admin bar is one height, and has no corners.** The launcher mark,
      every chip and both icon buttons measure 28px; the icon buttons are
      square. The bar spans its edge with square corners — a radius anywhere on
      the bar itself means it has picked one up from the panel vocabulary.

- [ ] **The element tree marks branches only.** Open *Elements*: a row with
      children carries a chevron, a leaf carries nothing at all, and both kinds
      of tag still line up in one column. A mark in a leaf's slot reads as a
      list bullet in front of every leaf in the tree.

**Focus and field state** (new behaviour, no unit test — the tokens are pinned,
the fact that a rule reaches the right element is not)

- [ ] **Tab through the entry drawer.** Every field, button and tab takes a 3px
      neutral ring, and the ring appears on **keyboard focus only** — click the
      same controls with the mouse and no ring should appear. That split is
      `:focus-visible`, and it is the whole reason the indicator is acceptable
      to leave on.

- [ ] **An invalid field shows both signals.** Clear a required field and save:
      the control takes a destructive border, the message appears under it, and
      `aria-invalid="true"` is on the control itself — check it in the
      inspector, since that is the half a screen reader uses. Fix the field and
      both clear together.

- [ ] **Native chrome stays light.** The date field's calendar picker and any
      number field's spinners render light, not as near-invisible dark glyphs —
      `color-scheme: dark` reached them. The **checkbox** needs its own look:
      unticked it is a dark box with a light edge, ticked it is **near-white
      with a dark tick**, never purple.

- [ ] **Fields read as containers, not holes.** Every text control sits a step
      *lighter* than the panel behind it, and a textarea grows with its content
      where `field-sizing` is supported.

- [ ] **Hover shifts, never tints.** Buttons, menu items, tree rows and tabs all
      move to a lighter surface on hover. If anything picks up a hue, a rule is
      reaching for `brand` that should not.

- [ ] **The purple is only ever pointing at your content.** In edit mode, hover
      a heading: the outline and the pill's left edge are brand-coloured. Then
      check that nothing in the tool's own furniture is — the confirm button, an
      active tab, a checked box and an active admin-bar chip are all near-white.
      The launcher glyph is the one deliberate exception.

**Contrast** (`tests/contrast.test.ts` pins the tokens; these two things it cannot)

- [ ] **Host-page CSS cannot touch the overlay at all.** The shadow root makes
      this a pass/fail rather than a leak hunt: selectors cannot cross the
      boundary, so no rule on the page can match an overlay node, `!important`
      included. Open a panel, paste this, and watch the page — the site should
      go red, lime and cursive while the overlay does not move a pixel. It
      reports `true` when the overlay is untouched. Reload afterwards.

      ```js
      (() => {
        const root = document.querySelector('astro-dev-edit').shadowRoot;
        const shot = () => [...root.querySelectorAll('*')]
          .map(e => { const s = getComputedStyle(e);
            return [e.className, s.color, s.backgroundColor, s.fontFamily, s.borderRadius].join('|'); })
          .join('\n');
        const before = shot();
        document.head.insertAdjacentHTML('beforeend',
          '<style id="atx-probe">*{color:red!important;font-family:cursive!important;' +
          'background:lime!important;border-radius:0!important}</style>');
        const after = shot();
        document.getElementById('atx-probe').remove();
        return before === after;
      })()
      ```

- [ ] **Inheritance is closed too.** Inheritance is the one thing that *does*
      cross a shadow boundary, and `:host { all: initial }` in `styles.ts` is
      what stops it — this is the check that it is still there. On the
      playground, whose `global.css` sets `p { color: var(--grey) }`, open
      *Settings*: the status line under the tabs must be the overlay's own
      foreground grey-white, not the site's `#5d5d5d`.

- [ ] **The admin bar stays legible over a light page.** It is the one surface
      that is translucent *and* dimmed at rest, so its contrast depends on what
      is behind it. On a white section of the playground, the resting bar's
      labels and its `#atx-bar-hint` are readable without hovering.

      Computed against the playground's `rgb(253,252,255)` body: a resting bar
      label on the bare surface is ~5.9:1, one inside a button chip ~4.8:1 (the
      worst case — the chip's white tint lifts the surface under the ink), and
      the bar 11:1 or better the moment it is approached or edit mode is on.
      **Measure the chip case for real** rather than trusting that number: it
      sits within a rounding error of the 4.5 line, and the model behind it
      does not account for the bar's `saturate` backdrop filter.

      A resting figure that lands under AA is a **deliberate deferral**, not a
      regression: recessive-until-touched is what the surface is for. See
      `REST_OPACITY` in `admin-bar.ts` and the board. Re-flag it only if the
      *approached* bar or any other surface drops below 4.5.

**Cleanup**

- [ ] Restore playground fixtures: overlay edits write into
      `examples/playground/src/` — check `git status` and revert.
- [ ] Delete imported photos from `examples/playground/public/images/` and remove
      `examples/playground/.astro-dev-edit.json` if the Settings drawer wrote one
      — every option change lands there, so it is almost always present after a
      settings pass.
- [ ] After a Collections pass, `git checkout examples/playground/src/content.config.ts`
      and `rm -rf examples/playground/src/content/notes` — a created collection
      leaves both a config block and a directory behind.

## Known deferrals

Deliberate quirks and improvement candidates live on the
[roadmap board](https://github.com/users/janjcwebtech/projects/1/views/1?layout=board)
as `deferral`-type items — check there before treating a checklist failure as a
regression. (This used to point at an in-repo `TODO.md`, which the board
replaced.)
