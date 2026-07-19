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
| `POST /classify` — literal text, dynamic for non-`.astro`, out-of-root and nonexistent rejection | `tests/middleware.test.ts` |
| `POST /apply` — atomic on-disk patch, unsupported/refusal 422s, validation 400s | `tests/middleware.test.ts` |
| `POST /entry` — schema fields + values + body + etag; inference fallback; path rejection | `tests/middleware-entry.test.ts` |
| `POST /entry/apply` — atomic frontmatter+body write, stale-etag 409, schema 422 with fieldErrors, date coercion | `tests/middleware-entry.test.ts` |
| `POST /entry/create` — valid create, slug-clash 409, missing-required 422, unknown collection / empty slug rejection | `tests/middleware-entry.test.ts` |
| `POST /entry/delete` — fresh-etag delete, stale-etag 409 keeps file | `tests/middleware-entry.test.ts` |
| Entry editor disabled → all `/entry*` rejected | `tests/middleware-entry.test.ts` |
| `zodToFields` — playground blog schema, primitive/enum/array mapping, wrapper unwrapping, image() stub, degrade-to-json | `tests/schema-introspect.test.ts` |
| `validateChanges` — null-deletion rules for optional/defaulted/required/unknown keys | `tests/schema-introspect.test.ts` |
| `inferFields` — type inference from frontmatter values | `tests/schema-introspect.test.ts` |

Not automated: `content-config.ts` (loads the project's real
`content.config.ts` via `ssrLoadModule`) is injected and **stubbed** in every
test — its real code path only runs in the playground. Same for `/open`
actually launching an editor (tests only pin its rejection paths, which fail
before launch-editor is reached).

### Patchers (`src/patcher/`)

| Functionality | Test file |
| --- | --- |
| `classifyAstro` — text/dynamic/empty/image classification, ambiguity refusal, unresolved locs, tag mismatch | `tests/patcher-classify.test.ts` |
| `applyAstro` text — replace, whitespace frame, entity decoding, escaping `<`/`{`/`&`, whitespace-insensitive verify, mismatch/dynamic/unresolved/ambiguous refusals | `tests/patcher-apply-text.test.ts` |
| `applyAstro` attributes — src/alt replacement, quote escaping, missing-alt insertion (incl. self-closing and expression-attr neighbors), never-insert-src, exact-match verify | `tests/patcher-apply-attrs.test.ts` |
| `frontmatter.ts` — parse (fences, BOM, CRLF, invalid YAML), surgical apply (comments, key order, quoting, no re-wrap), serialize new entries, refusals | `tests/frontmatter.test.ts` |

Use `tests/helpers.ts::locOf` to build classify/apply requests — it mirrors
the loc rules in `astro.ts`.

### Client (`src/client/`)

| Functionality | Test file |
| --- | --- |
| `markdown.ts` — `markdownToHtml` rendering subset, `canRichEdit` accept/refuse | `tests/markdown.test.ts` |
| `classify-cache.ts` — verdict caching per file\|loc\|tag, in-flight dedupe, failure retry, HMR invalidation (incl. mid-flight) | `tests/classify-cache.test.ts` |

**Everything else in `src/client/` has no unit tests** — it is DOM- and
dev-server-bound and is verified only by the manual checklist below. When
extracting pure logic from a client module (as `markdown.ts` was), add a test
file and move the row up here.

## Manual checklist (playground)

Launch per the [verify skill](../.claude/skills/verify/SKILL.md). Work through
whichever sections your change touches; run the whole list before a release.

**Boot & chrome**

- [ ] Overlay pills appear bottom-corner (`#atx-controls` with `#atx-toggle`,
      and `#atx-entry` on pages declaring a page-source meta); dimmed idle,
      full opacity + hint on hover.
- [ ] Hover reveals the ✕ (`#atx-hide`); clicking hides the pills and exits
      edit mode until the next full reload.
- [ ] Edit mode persists across a reload (`sessionStorage.astroTextEditMode`).

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
      keeps the pill in place — no instant retarget; both the pill's file:loc
      label and its "open ↗" button jump to the source in the editor.
- [ ] Clicking dynamic content (a resolved `{expression}`) opens the refusal
      notice with a working "Open source" button — never a false edit.
- [ ] Escape / click-away discards; a stale edit (file changed underneath)
      fails safe with a mismatch message, file untouched.

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
      unknown → read-only json).
- [ ] Save writes frontmatter surgically — comments, key order, and quoting
      preserved in the entry file.
- [ ] Dirty-close asks for confirmation; a concurrent external file edit then
      save → etag conflict surfaced, file not clobbered.
- [ ] Entry create (new slug) and delete flows work end-to-end.

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

Deliberate quirks (entity decoding, verify strictness, partial-failure
windows) are documented in
[TODO.md](../TODO.md) — check there before treating a checklist failure as a
regression.
