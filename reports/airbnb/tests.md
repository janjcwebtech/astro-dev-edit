# Test record — airbnb-2026-09-06

Environment, served root and version identity: [project.md](project.md).
Findings: [bugs.md](bugs.md). Editor-launch inventory:
[editor-triggers.md](editor-triggers.md).

**Method column:** `UI` = real pointer/keyboard actions in Chromium, with the
resulting source file inspected on disk. `EP` = a direct request to an endpoint
(proves protocol behaviour only, not that the browser sends or handles the same).
`SRC` = read from the implementation. `CMD` = a shell command in the target or
integration repo.

Counts below are **test cases**, not assertions; the 627 vitest assertions are
one case (A-02).

---

## A · Automated gates and production output

| ID | Action | Expected | Observed | Result | Method |
| --- | --- | --- | --- | --- | --- |
| A-01 | `npm run typecheck` in the integration repo | clean | `tsc --noEmit` exit 0, no output | **Pass** | CMD |
| A-02 | `npm test` in the integration repo | suite green | 29 files, **627/627** passed, 2.14s | **Pass** | CMD |
| A-03 | `npm run build` in the target | succeeds | 20 pages built in 2.21s, sitemap emitted | **Pass** | CMD |
| A-04 | Scan `dist/` for dev-only artifacts | none present | zero files match `__dev-edit`, `astro-dev-edit`, `atx-toggle`, `data-astro-source-file`, `__open-in-editor` | **Pass** | CMD |
| A-05 | Scan `dist/` for the page-source meta | absent in production | zero matches for `page-source` — the target gates its meta on `import.meta.env.DEV`, so the earlier ASTRA-07 shape does **not** occur here | **Pass** | CMD |

## B · Runtime identity and the Astro 5 annotation regime

| ID | Action | Expected | Observed | Result | Method |
| --- | --- | --- | --- | --- | --- |
| B-01 | `GET /__dev-edit/health` on the real origin | identifies this project | `root` = the airbnb astro-site; `cssInspector`/`openInEditor`/`entryEditor` true, `unsplash` false | **Pass** | EP |
| B-02 | Overlay boots | host + shadow root + admin bar present | `<astro-dev-edit>` with open shadow root, 8 top-level surfaces, bar reads "Elements / Edit page" | **Pass** | UI |
| B-03 | Annotations exist on Astro 5 | compiler emits them; toolbar strips them from the live DOM | served HTML carries `data-astro-source-file`/`-loc`; `document.querySelectorAll('[data-astro-source-file]')` is **0** after load — the documented strip, and the source map still resolves every element tested | **Pass** | UI + EP |
| B-04 | Astro dev toolbar present (required on 5.x) | yes | `<astro-dev-toolbar>` mounted | **Pass** | UI |
| B-05 | Edit mode survives navigation | persists | `sessionStorage.astroDevEditMode === "1"` across four page loads | **Pass** | UI |

## C · Literal text editing in `.astro`

| ID | Action | Expected | Observed | Result | Method |
| --- | --- | --- | --- | --- | --- |
| C-01 | Hero `<h1>` on `/`, retype + Enter | one line rewritten | `index.astro:24` only; `git diff --stat` = 1 file, 1 insertion, 1 deletion | **Pass** | UI |
| C-02 | Multi-line indented `<p class="lede">` | replaced without disturbing indentation | two source lines collapsed to one, leading indentation preserved | **Pass** | UI |
| C-03 | `<figcaption>` with inline `<strong>` | markup popup, not inline edit | markup popup at `index.astro:39:22`, textarea pre-filled `<strong>Dina</strong> · stayed three weeks` | **Pass** | UI |
| C-04 | Save from that markup popup | writes the element's inner source | `<figcaption><strong>Dina</strong> · ASTRA-01 draft</figcaption>`; the literal `·` preserved | **Pass** | UI |
| C-05 | `<h1>Privacy &amp; legal</h1>` (real pre-existing entity), retype with `&` | re-escaped to `&amp;` | `<h1 …>Privacy &amp; legal ASTRA</h1>` | **Pass** | UI |
| C-06 | Type a literal `&amp;` into a heading, then edit **again** | round-trips, stays editable | source `Coast &amp;amp; sea ASTRA`, page shows `Coast &amp; sea ASTRA`, second edit appended `2` and saved | **Pass** | UI |

## D · Refusals (a correct refusal is a pass)

| ID | Action | Expected | Observed | Result | Method |
| --- | --- | --- | --- | --- | --- |
| D-01 | `{RATING.score}` inside `<strong>` on `/` | refuse — imported constant | "This text comes from a template expression…" at `index.astro:120:23`, Cancel / Open source | **Pass** | UI |
| D-02 | `<Button>Book on Airbnb</Button>` | refuse — component-rendered | refusal at `index.astro:28:58`; the reason describes the annotated ancestor, see [AIR-05](bugs.md) | **Pass** (with note) | UI |
| D-03 | Post title `{d.title}` on `/area/beaches-near-esmoriz/` | refuse + offer the backing entry | refusal at `PostLayout.astro:62:38` plus "This page's content comes from beaches-near-esmoriz.mdx"; buttons Cancel / **Open template** / **Edit page content** | **Pass** | UI |
| D-04 | MDX body paragraph through `<slot/>` | refuse + same offer | refusal at `PostLayout.astro:89:26` with the entry jump | **Pass** (with note) | UI |
| D-05 | "Edit page content" on that refusal | hands off to the entry drawer | notice closed, entry drawer opened on the MDX — a peer handoff, not a stack | **Pass** | UI |
| D-06 | Click a nav link in edit mode | must not navigate | URL unchanged; expression **traced** to `links[].label` and a value popup opened | **Pass** | UI |

## E · Expression tracing into frontmatter

| ID | Action | Expected | Observed | Result | Method |
| --- | --- | --- | --- | --- | --- |
| E-01 | Click the 3rd `.map()`-generated nav link | resolve the right array element | popup titled `Value · links[].label`, "Text of label, in SiteHeader.astro", value `Area guide` — the 3rd of 5 | **Pass** | UI |
| E-02 | Save `Area guide` → `Area guide ASTRA` | surgical single-line write | only `SiteHeader.astro:17` changed; single quotes and object formatting preserved, siblings untouched | **Pass** | UI |

## F · Images

| ID | Action | Expected | Observed | Result | Method |
| --- | --- | --- | --- | --- | --- |
| F-01 | Click `<img src="/photos/hero-beach.jpg">` | image panel with alt + picker | panel `Image · index.astro:34:8`, `hero-beach.jpg · 148 KB`, alt input, Recently added, Browse all | **Pass** | UI |
| F-02 | Browse all → asset inventory | `assetDirs` honoured, `src/assets` excluded for a plain `<img src>` | 27 tiles = 24 `public/photos` + 3 `public` (incl. `public/brand`); **none** of the 42 files in `src/assets` — matches the config's own comment | **Pass** | UI |
| F-03 | Single click on a tile | stages only | selection badge only; the panel's filename did not change until commit — first attempt failed here as *automation* error, not a defect | **Pass** | UI |
| F-04 | **Use image** in the modal footer | commits the staged pick | panel updated to `Logo Miramar horizontal.png · 55 KB` | **Pass** | UI |
| F-05 | Save the swap | `src` rewritten | written, but with **raw spaces** — [AIR-03](bugs.md) | **Fail** | UI |
| F-06 | Alt edit with a plain `&` | escaped, and re-editable | `alt="Jan &amp; Carolina at the beach"`; a second edit appended text and saved | **Pass** | UI |
| F-07 | Alt containing a literal `&amp;`, second edit | should save | `POST /apply` **422**, error toast, draft discarded, permanently stuck — [AIR-02](bugs.md) | **Fail** | UI |
| F-08 | Failure is reported, not silent | a visible error | `atx-toast atx-toast-err` — "Save failed — The source alt no longer matches the page…" (captured with a MutationObserver registered before the click; the toast auto-expires, which is why a late check saw nothing) | **Pass** | UI |
| F-09 | Upload via the file input | file written under `uploadDir` | `public/photos/astra-upload-probe.png` created and tiled as `/photos/astra-upload-probe.png` | **Pass** | UI |
| F-10 | Cancel the modal after uploading | file stays; source untouched | upload still on disk (documented), `index.astro` unchanged | **Pass** | UI |

## G · Entry editor (unblocked by a reverted test edit — see [SETUP-1](bugs.md))

| ID | Action | Expected | Observed | Result | Method |
| --- | --- | --- | --- | --- | --- |
| G-01 | Entry button on a post page, **as shipped** | should offer the drawer | hidden (`data-hidden`, `display:none`) — legacy meta name, [SETUP-1](bugs.md) | **Fail** (setup) | UI |
| G-02 | Same, after renaming the meta | button appears | "Edit entry" visible immediately | **Pass** | UI |
| G-03 | Schema → widgets, zod v3 on Astro 5 | typed controls from the real schema | 15 fields: enum → `<select>` with both cluster values, `z.coerce.date()` → `input[type=date]`, booleans → checkboxes, `z.string()` → text; required marked `*`, optionals not | **Pass** | UI |
| G-04 | Defaults surfaced | shown without being written | `author` empty with placeholder **"Jan (default)"**; booleans "not set — defaults to Off" | **Pass** | UI |
| G-05 | Frontmatter save with a colon in the value | surgical YAML | only `category:` changed, `"Beaches ASTRA: with colon"` kept inside the existing double quotes; key order, other quoting and absent optionals untouched | **Pass** | UI |
| G-06 | MDX body edit through the rich editor | only the edited block changes | appended a character to paragraph 1; whole-file diff = 2 lines (that paragraph + the earlier frontmatter test). `##` headings, `-` bullets with `**bold**`, em-dashes all byte-identical | **Pass** | UI |
| G-07 | Rich editor lives in light DOM | slotted, not in the shadow root | `document.querySelector('.atx-rte-content')` found with `contenteditable="true"` | **Pass** | UI |
| G-08 | Create an entry | file written, then navigate | `astra-probe-post.mdx` created; browser landed on `/area/astra-probe-post` | **Pass** | UI |
| G-09 | Created file contents | only what was filled | 7 keys; untouched `author`, `featured`, `draft` **omitted** so schema defaults apply | **Pass** | UI |
| G-10 | Delete an entry | confirm, delete, navigate | pointer click blocked ([AIR-01](bugs.md)); via keyboard, confirm `Delete astra-default-probe.mdx? (Undo is git.)`, file removed, navigated to `/area` | **Pass** (keyboard) / **Fail** (pointer) | UI |

## H · Collection designer

| ID | Action | Expected | Observed | Result | Method |
| --- | --- | --- | --- | --- | --- |
| H-01 | Open Collections | reads the project's own config | "1 collection · Declared in src/content.config.ts"; `posts · src/content/posts · 13 entries · plain z.object schema`, 15 field cards each split SCHEMA / EDITOR | **Pass** | UI |
| H-02 | Add-field form refuses `image()` | explains rather than guesses | Image absent from the Add type list, with "Image fields need Astro's image() helper, which only a `({ image }) => z.object({ … })` schema receives. Convert this collection's schema by hand." — correct for this project's plain schema | **Pass** | UI |
| H-03 | Add `astraFlag`, Checkbox, optional, default `true` | one line inserted | `+    astraFlag: z.boolean().default(true),` — every comment, blank line and sibling untouched | **Pass** | UI |
| H-04 | Drawer resumes after Astro's resync reload | reopens on the same collection | reopened twice (after add and after remove) on `posts` | **Pass** | UI |
| H-05 | Remove the field, Save changes | round-trip is byte-clean | `content.config.ts` SHA-256 back to `c00599c9…`, identical to the pre-test hash | **Pass** | UI |

## I · Settings

| ID | Action | Expected | Observed | Result | Method |
| --- | --- | --- | --- | --- | --- |
| I-01 | Open Settings | server-declared tabs and options | General / Editing / Media / Unsplash | **Pass** | UI |
| I-02 | Config-only options read-only | locked with provenance | `enabled` and `sourceAnnotations` disabled | **Pass** | UI |
| I-03 | `assetDirs` set in `astro.config.mjs` | locked, and says why | value `public/photos, src/assets, public`, disabled, "Set in astro.config.mjs, which takes precedence. Remove it there to change it from here." | **Pass** | UI |
| I-04 | Change `uploadDir` to `public/photos` and save | applies with **no restart** | `.astro-dev-edit.json` written holding only that option; the very next upload (F-09) landed in `public/photos` | **Pass** | UI |
| I-05 | Settings file permissions | `0600` | `-rw-------` | **Pass** | UI |
| I-06 | Gitignore warning when not ignored | warn | server sends `gitignoreWarning: true`; the drawer shows nothing while Unsplash is off — [AIR-04](bugs.md) | **Fail** | UI + EP |
| I-07 | Same after enabling Unsplash | warn | warning renders, and the key input was disabled until then, so it still precedes any key entry | **Pass** | UI |
| I-08 | Secret never returned | key absent from the response | `/settings` returns `configured:false`, no key field | **Pass** | EP |

## J · Other surfaces

| ID | Action | Expected | Observed | Result | Method |
| --- | --- | --- | --- | --- | --- |
| J-01 | Hover pill | `file:line:col` + verdict | `miramar-esmoriz.astro:95:29 · editable`, with `open` / `copy` and the CSS chips `.reveal .in` | **Pass** | UI |
| J-02 | Elements tree | populated on Astro 5 | opens, 232 rows, per-row `line:col` | **Pass** | UI |
| J-03 | Loop-generated siblings in the tree | share one loc (correct) | four nav `<a>` rows all `30:42`, matching `links.map(...)` at `SiteHeader.astro:30` | **Pass** | UI |
| J-04 | `POST /page-source` on a `[...slug]` route | resolves without any meta | `{file:"src/pages/area/[...slug].astro", pattern:"/area/[...slug]", refusal:null}` | **Pass** | EP |
| J-05 | Coexistence with `astro-click-to-source` | no conflict | Alt+Click in edit mode reached that tool's `/__open-in-editor` with the right file/line; astro-dev-edit opened nothing. Plain click still routes to astro-dev-edit | **Pass** | UI |

## K · Regression pass against the earlier playground findings

Those findings were recorded on Astro 7.1.1 against a different consumer; this is
whether the same behaviour is observable **here**.

| Prior | Status here | Evidence |
| --- | --- | --- |
| ASTRA-01 — keyboard Save & exit discards a popup draft | **Not reproducible; the reported path is closed** | With a dirty markup popup open, 16 real Tab presses cycled inside the popup and returned to its textarea — focus never reached the admin bar. A pointer click is also blocked: `shadowRoot.elementFromPoint` at the exit button resolves to `.atx-backdrop` (z 1999999005 over the bar's 1999999004). The underlying `state.commit()` path was **not** re-audited, so this is "unreachable by the reported route", not "the commit semantics were verified". |
| ASTRA-02 — untouched boolean default overridden with `false` | **Pass (fixed)** | Tested with a genuine default-**true** boolean added for the purpose (`astraFlag: z.boolean().default(true)`). Left untouched on create; the file omits the key entirely — see G-09/H-03. |
| ASTRA-03 — post-create navigation lost in Astro's reload | **Pass (fixed)** | Both creates landed on the new route (`/area/astra-probe-post`, `/area/astra-default-probe`) across the reload — G-08. |
| ASTRA-04 — controls not named by their visible labels | **Pass (fixed)** | Every entry and Settings control has an `id` and `labels.length === 1` (`atx-field-1` … `atx-field-31`) — G-03. |
| ASTRA-05 — modal focus escapes behind the backdrop | **Pass (fixed)** | Focus is contained and wraps — see ASTRA-01 row. |
| ASTRA-06 — pointer Save & exit saves but does not exit | **Not tested** | Superseded by the backdrop blocking that click while a panel is open; the inline-edit variant was not re-run. Recorded as untested, not as a pass. |
| ASTRA-07 — playground ships the page-source meta in production | **Not applicable here** | The target gates its meta on `import.meta.env.DEV`; `dist/` contains none — A-05. |
| Astro toolbar intercepted a Delete pointer click (noted, unreported) | **Reproduces, now diagnosed** | [AIR-01](bugs.md), with rects and z-indexes. |

---

## Not tested / out of scope for this run

- Any browser other than Chromium; no touch or mobile layout; no Firefox/WebKit,
  so the light-DOM rich-editor rationale (a Safari constraint) is untested here.
- Live Unsplash search, import or credential storage — no access key, and none
  was created. `unsplash.enabled` was toggled on and the file removed afterwards.
- Any **desktop editor launch**. Every `/open`, `/inspect/open` and
  `/collection/open` trigger is inventoried by tracing in
  [editor-triggers.md](editor-triggers.md) and left for manual verification; no
  editor window was opened, so nothing is claimed about detection or errors.
- CSS rule card (`/inspect/open`) beyond the class chips appearing in the pill;
  source peek; the copy-element panel; drag-and-drop upload; duplicate upload
  names; upload size/type rejection.
- Stale-etag / conflict paths on `/entry` and `/collection/schema/apply`; the
  entry drawer's dirty-confirm; concurrent edits from two tabs.
- The `remote-work` cluster, the contact form, `/style-guide`, `/long-stays`,
  MDX components inside post bodies, and RSS/sitemap routes.
- Markdown source ↔ rich-text mode switching and the toolbar's formatting
  buttons (present in the DOM, not exercised).
- `entryEditor.collections` widget overrides (not configured in this project).

## Automation lessons from this run

- **macOS `End` is a scroll key, not a caret move.** Pressing `End` in a
  `contenteditable` did not collapse the editor's initial select-all, so the next
  character replaced the whole element. This looked exactly like a data-loss bug
  and is not one — `ArrowRight` collapses correctly. Any earlier report of
  "typing replaced the whole heading" from a `End`-then-type sequence on macOS
  should be re-checked.
- A media tile is **staged** by one click and **committed** by the footer
  *Use image* (or a double-click). A single click that "does nothing" is the
  design, not a failure.
- The error toast auto-expires; register a `MutationObserver` on the shadow root
  *before* the triggering click or you will conclude a failure was silent.
- `document.querySelector` cannot see overlay chrome — go through
  `document.querySelector('astro-dev-edit').shadowRoot`. The rich-text surface is
  the exception: it is light DOM.
- `document.activeElement` reads `ASTRO-DEV-EDIT` for anything focused inside the
  overlay; use `shadowRoot.activeElement`.
- Playwright pierces the shadow root for locators, but `.atx-btn-default`
  matches more than one button inside a drawer — prefer `:text-is("Save")`.

## Cleanup and preservation

**Baseline** taken before the first write: SHA-256 of all 50 `.astro`/`.mdx`/
`.md`/`.ts`/`.css` files under `src/` and `public/`, a full copy of `src/`, the
`public/photos` and `src/assets` listings, plus a separate copy of
`content.config.ts`. Recorded that `.astro-dev-edit.json` **did not exist**.

**Mutated during testing, all restored:** `src/pages/index.astro`,
`src/pages/privacy-policy.astro`, `src/components/SiteHeader.astro`,
`src/layouts/PostLayout.astro` (the meta rename), `src/content.config.ts`
(add + remove of `astraFlag`), and
`src/content/posts/beaches-near-esmoriz.mdx`.

**Created and removed:** `src/content/posts/astra-probe-post.mdx`,
`src/content/posts/astra-default-probe.mdx` (removed through the tool's own
delete flow), `public/photos/astra-upload-probe.png`, and
`.astro-dev-edit.json`.

**Final state.** A full re-hash matches the baseline exactly — *"ALL SOURCE BYTES
MATCH BASELINE"* — and `git status` in the target repo is **clean**, with no
`astra-*` files remaining under `src/` or `public/`. `content.config.ts` is back
to `c00599c9cee604623481b9f2cd66c8673319c0685452a992e8b7fa65b9fdc50f`.

**Deliberately left in place, and why:**

- `node_modules/astro-dev-edit` (the `file:` link) and the
  `node_modules/astro-text-edit` alias symlink — these are what make the tool
  run here; removing them would undo "make sure the tool is installed". Both are
  inside `node_modules`, and `npm install`/`npm ci` prunes them anyway.
- `dist/` — produced by test A-03. It is gitignored and regenerable. I did not
  delete it because I did not verify whether an earlier build existed, and
  destroying someone else's build output is the worse error.
- `.playwright-mcp/` session captures — gitignored in the target repo.
- The dev server on port 4325 is still running.

Nothing in the integration repo's own working tree was touched: the pre-existing
modifications to `.gitignore`, `CHANGELOG.md`, `docs/VERIFICATION.md`,
`src/server/annotate.ts` and `tests/annotate.test.ts`, and the untracked
`astra-*.md`, `handoff-astro-testing.md` and `project.md`, are all as found. This
run's own output is confined to `reports/airbnb/`.
