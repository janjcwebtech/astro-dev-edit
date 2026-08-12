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
| `GET /health` | `tests/middleware.test.ts` |
| `GET /assets` — asset dirs listed as sorted web paths, `public/` mapped to `/` | `tests/middleware.test.ts` |
| `POST /upload` — data-URL write into the configured `uploadDir`, clash suffixing, traversal sanitising, mime/payload rejection | `tests/middleware.test.ts` |
| `POST /open` — disabled-by-config 403; path gate matches `/classify`/`/apply` (out-of-content-roots, out-resolving symlink, bad extension, nonexistent, missing field → 400) | `tests/middleware.test.ts` |
| `POST /peek` — whole-file lines + focus/total metadata, ±1000-line huge-file cap, no-loc default, out-of-range clamp, path rejection; out-of-root/package-owned paths refuse softly (200 + `refused`, no source) | `tests/middleware.test.ts` |
| `POST /classify` — literal text, dynamic for non-`.astro`, nonexistent rejection; out-of-root, `node_modules`, and out-resolving symlinks answer 200 `dynamic` instead of throwing | `tests/middleware.test.ts` |
| Read/write asymmetry of the path gate — `/classify` and `/peek` soften for package-owned paths, while `/open` and `/apply` still refuse them with 400 and leave the file byte-identical | `tests/middleware.test.ts` |
| `POST /apply` — atomic on-disk patch, multi-op batch (verify-all-then-write-once; a refused op writes nothing), unsupported/refusal 422s, empty-ops/validation 400s | `tests/middleware.test.ts` |
| `POST /entry` — schema fields + values + body + etag; inference fallback; path rejection | `tests/middleware-entry.test.ts` |
| `POST /entry/apply` — atomic frontmatter+body write, stale-etag 409, schema 422 with fieldErrors, date coercion | `tests/middleware-entry.test.ts` |
| `POST /entry/create` — valid create, slug-clash 409, missing-required 422, unknown collection / empty slug rejection | `tests/middleware-entry.test.ts` |
| `POST /entry/create` extension choice — configured `extension` wins, uniform-`.mdx` collection inferred (nested dirs included), mixed falls back to `.md`, non-editable extension 422 | `tests/middleware-entry.test.ts` |
| `POST /entry/delete` — fresh-etag delete, stale-etag 409 keeps file | `tests/middleware-entry.test.ts` |
| Entry editor disabled → all `/entry*` rejected | `tests/middleware-entry.test.ts` |
| `annotateAstroSource` — self-annotation for Astro ≥7: loc parity with `locOf` (text/expression/childless rules), component skip, elements inside expressions, self-closing tags, attr escaping, no-newline invariant, classify/apply round-trip against the original source | `tests/annotate.test.ts` |
| `locateSelector` — CSS-inspector best-effort selector→line: class/id hit in a `.css` file, token-boundary (no prefix collision), absent→null; `.astro` search confined to `<style>` blocks (markup class attrs ignored) | `tests/inspect-locate.test.ts` |
| `zodToFields` — playground blog schema, primitive/enum/array mapping, wrapper unwrapping, `readonly`, image() stub → `assetRef: 'relative'` (bare **and** through `.optional()`), plain-string no-assetRef, degrade-to-json. **Runs against both zod majors from the same assertions** | `tests/schema-introspect.test.ts` |
| `validateChanges` — null-deletion rules for optional/defaulted/required/unknown keys; wrong-type rejection, blanking a required field, `z.date()` string bridging. **Both majors** | `tests/schema-introspect.test.ts` |
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

Use `tests/helpers.ts::locOf` to build classify/apply requests — it mirrors
the loc rules in `astro.ts`.

### Client (`src/client/`)

| Functionality | Test file |
| --- | --- |
| `markdown.ts` — `markdownToHtml` rendering subset, `canRichEdit` accept/refuse | `tests/markdown.test.ts` |
| `editors/markup-insert.ts` — tag palette: pair wraps and keeps the selection, empty pair at the caret, void tag replaces rather than wraps, `<a href="">` caret inside the quotes, palette matches the patcher's safelist | `tests/markup-insert.test.ts` |
| `classify-cache.ts` — verdict caching per file\|loc\|tag, in-flight dedupe, failure retry, HMR invalidation (incl. mid-flight) | `tests/classify-cache.test.ts` |
| `highlight.ts` — peek tokenizer: lossless round-trip, fence/tag/attr/string/keyword/comment classification, multi-line comment carry, URL/apostrophe/identifier-digit false-positive guards, plain-text degrade | `tests/highlight.test.ts` |
| `tree-model.ts` — `buildTreeModel` nesting: roots in document order, direct children, loop siblings sharing one loc kept distinct, reparent across an unannotated component gap, sourceless elements dropped, empty input | `tests/tree-model.test.ts` |
| `element-context.ts` — `formatContext` clipboard payload: section order and omission (absent verdict/entry/box), `>` focus-line gutter marking, quoted-range wording, fence language per extension, refused-source sentence, empty-CSS note, rule blocks with/without a source comment, both truncation notices; `relativize` root stripping (trailing slash, outside-root, already-relative, unknown root, Windows separators); `windowAround` 1-based slicing (clamped both ends, whole file, pre-windowed response) | `tests/element-context.test.ts` |

**Everything else in `src/client/` has no unit tests** — it is DOM- and
dev-server-bound and is verified only by the manual checklist below. When
extracting pure logic from a client module (as `markdown.ts` was), add a test
file and move the row up here.

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
      (`localStorage.astroTextEditBar`).
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
- [ ] Edit mode persists across a reload (`sessionStorage.astroTextEditMode`).

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

**Inline text editing** (e.g. `/articles/` listing)

- [ ] Edit mode on → hovering highlights the element with a neutral grey pill
      (`file:loc · loading…`); after resting ~500ms on it the pill upgrades to
      the server verdict — purple `editable` on literal text, amber `dynamic`
      on expression-driven content, green `image` on a static `<img>` — with
      no change in pill width (the verdict slot is fixed-width). Sweeping
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
- [ ] The copied HTML contains no `data-astro-text-edit-ui` node and no
      `atx-*` class, on a page where an overlay panel was open at copy time.
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
      pill and class/ID chips; hovering an element on the page highlights its row
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
- [ ] Blank a required field and save → 422 with an inline field error, not a
      silent write. (Validation is only live when the schema resolved.)
- [ ] Save writes frontmatter surgically — comments, key order, and quoting
      preserved in the entry file.
- [ ] Dirty-close asks for confirmation; a concurrent external file edit then
      save → etag conflict surfaced, file not clobbered.
- [ ] Entry create (new slug) and delete flows work end-to-end; after create
      the browser polls the new URL and lands on the rendered page (not a
      404), even when the content-layer sync is slow.

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

**Cleanup**

- [ ] Restore playground fixtures: overlay edits write into
      `examples/playground/src/` — check `git status` and revert.

## Known deferrals

Deliberate quirks and improvement candidates are documented in
[TODO.md](../TODO.md) — check there before treating a checklist failure as a
regression.
