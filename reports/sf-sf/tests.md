# Executed tests — sf-sf

Browser exploration: **2026-09-06**. Reports and final preservation recheck: **2026-09-07**. No implementation fixes. [Bugs](bugs.md), [media roadmap](image-storage-roadmap.md), [manual opening inventory](editor-opening-triggers.md), [project orientation](project.md).

**53 recorded cases: 46 Pass, 6 Fail, 1 Blocked.** These cases include setup, browser workflows, focused endpoint checks and final verification; they are separate from **635 passing unit assertions**. The six failed cases correspond to five integration/compatibility findings and one consumer setup issue. The direct Patterns image click is Blocked by site composition; its Elements alternative passed.

## Environment and setup

| Item | Observed value |
| --- | --- |
| Target root | `/Users/jc/_Web_Sites_/astro-text-edit/examples/sf-sf/` |
| Target revision/status before writes | `13b2949f5284312122c3c0f8d186cc117aae8990`; clean |
| Integration revision | `779528acdd6ee273535565450ab8c20a0e7e2e9b` |
| Integration local changes already present | `.gitignore`, `CHANGELOG.md`, `docs/VERIFICATION.md`, `src/server/annotate.ts`, `tests/annotate.test.ts`; existing untracked reports/handoff/project orientation. Left untouched. |
| Installed versions | Astro **5.18.2**; integration **0.7.1**; Node **v24.13.0** for shell/server |
| Package resolution | `examples/sf-sf/node_modules/astro-text-edit` is a symlink to the integration root, whose manifest name is `astro-dev-edit`; runs local source, including pre-existing annotation edits |
| Origin | **http://localhost:4383** |
| Port collision | `http://localhost:4381/__dev-edit/health` identifies `/Users/jc/_Web_Sites_/SF-SF-WEBSITE/`; that other checkout was read only and received no test edits |
| Health on test origin | `ok:true`, `name:"astro-dev-edit"`, intended example root, `cssInspector:true`, `openInEditor:true`, `entryEditor:true`, `unsplash:false` |
| Browser | Playwright's isolated Chromium, user agent Chrome **152.0.0.0**, macOS; not Safari/Firefox coverage |
| Viewports | **1200 × 1938** for main exploration; **390 × 844** for a bounded role drawer/media-picker check |
| Baseline preservation | 496 non-generated files copied with exact bytes/modes and SHA-256 manifest under `/tmp/sf-sf-retest-20260906/`; no secrets printed |

Dependencies were absent initially. `npm ci --no-audit --no-fund` installed the site's locked dependencies. An attempted npm installation under the legacy alias stalled and was interrupted. The working local installation uses this ignored symlink, with no package/lock/config edits:

```sh
# From examples/sf-sf, after npm ci; only create if the alias is absent.
ln -s ../../.. node_modules/astro-text-edit
SF_DEV_PORT=4383 npm run dev -- --host 127.0.0.1
```

The sandbox initially prevented opening a listening socket; the authorized local dev server was started with the execution tool's escalation. No rejected approval remains unresolved. The server remains running. It has never been substituted with the playground server.

The [initial plan](initial-plan.md) was written after source/feature discovery, before opening detailed historical integration bug reports. It initially assumed legacy meta support; runtime/source inspection corrected this: the legacy name produces a warning, not an accepted alias. Collection tests used the real **Collections → Items** UI. No layout patch or synthetic meta opt-in was introduced.

## Execution record

UI means real Playwright pointer/keyboard/chooser interactions. DOM reads are diagnostics, not substitutes for those actions. Endpoint cases are explicitly marked and do not claim full UI coverage. Unless stated otherwise, expected results follow the current feature docs. All writes listed below were restored or their disposable files deleted; the last section records the verification.

| ID | Method / action and input | Expected | Observed outcome and evidence | Result |
| --- | --- | --- | --- | --- |
| T01 | Setup + browser health; identify both ports and installed packages | Test the intended example with tool active | Correct example root on 4383; Astro 5.18.2/local tool 0.7.1; other checkout excluded | Pass |
| T02 | UI, note/work detail pages with existing meta | Detail entry shortcuts available when correctly configured | Legacy name hides Edit entry; console warning explains rename. Collections workaround works; SF-SETUP-01 | Fail |
| T03 | UI, `/approach` → How we work → type `SF probe <tag> & café` → Enter | Write text safely to the intended component | `/apply` 200; only heading changed to `SF probe &lt;tag> &amp; café`; reload rendered literal text | Pass |
| T04 | UI, same heading → `SF cancel probe` → Escape | Discard pending text | Prior saved value restored in DOM; canceled value did not enter source | Pass |
| T05 | UI, heading → `SF pointer exit probe` → pointer Save & exit | Save and leave editing after reload | 200, saved text visible, bar Edit page, session mode `0` | Pass |
| T06 | UI, approach markup heading → `SF invalid <div>block</div>` → Save | Refuse unsupported block markup, retain editing surface | Failed request/console error; popup stayed open, source did not acquire invalid markup; corrected input could be saved | Pass |
| T07 | UI, markup → `SF markup <strong>growth</strong><br />Café &amp; teams` → Control+Enter | Persist allowed markup | 200; only ApproachIntro heading source changed; reload completed | Pass |
| T08 | UI, 19 Tab presses from markup textarea with a draft | Focus stays in modal, wraps | All 19 active controls were inside dialog; Save wrapped to open and textarea, not page or global exit | Pass |
| T09 | UI, click Discover card heading | Refuse unsafe edits to component-prop output | Explanation points to `ApproachCard.astro:25:51`; no source write | Pass |
| T10 | UI + source, Collections discovery | Show discoverable collections and safe limitations | Six collections; works 23, notes 20, services 30, roles 2, policies 3. Archive shows directory missing/0 because it uses a JSON file loader with 14 records; documented model limitation, see roadmap | Pass |
| T11 | UI/DOM, animation-note entry fields | Schema-derived accessible controls and field types | Labels associated with controls, including required `*`; date input `2024-08-15`, enum/default, Draft, image path; Excerpt is configured textarea | Pass |
| T12 | UI, change only note Title to `SF note title — café & growth` | Preserve all other source bytes | 200; diff changed only quoted title, leaving folded excerpt, date, body and GIF references untouched | Pass |
| T13 | UI/DOM, note image() preview and rich body | Resolve each kind of image in its own path model | Source cover preview loaded and all 13 public GIFs had nonzero natural widths | Pass |
| T14 | UI, note Browse → filter `wellbeing-with-kris-cover` → select → Escape | Selection is staged and cancel preserves field | Notes scope showed 72/241 source images, no broken thumbnails; one dialog remained and original image value persisted | Pass |
| T15 | UI, repeat selection → Use image → entry Save | Write an entry-relative import path | 200; `../../assets/notes/wellbeing-with-kris-cover.png` saved; title/body retained | Pass |
| T16 | UI file chooser, upload `sf-probe-upload.png` through note image() picker | Upload beside existing image, show new asset | Created `src/assets/notes/sf-probe-upload.png`, 1,642,122 bytes; selected details visible, count 73/242 | Pass |
| T17 | UI, Cancel picker after upload | Keep prior field selection; account for immediate upload side effect | Field unchanged; uploaded file remained independently of Cancel and was explicitly removed during cleanup | Pass |
| T18 | UI, type `SF rich body probe.` into note rich body and Save | Persist actual body edit while retaining supported content | 200; inserted at current caret in Anticipation paragraph. All 13 GIF references retained; markdown delimiters/whitespace normalized. This did **not** verify append-at-end placement or lossless body byte preservation | Pass |
| T19 | UI, Appcast case study source/rich mode | Complex MDX must not be converted lossily | Initially source mode; Rich request remained in source mode. Component imports/markup preserved during subsequent frontmatter save | Pass |
| T20 | UI, Appcast title-only save | Untouched YAML bytes preserved | Title changed but categories/sector/services flow arrays were reformatted; SF-02, captured diff | Fail |
| T21 | UI, reopen Appcast → Save without changes | No-op must avoid rewriting | Drawer closed; no `/entry/apply` response/request during registered 5-second window; no additional diff | Pass |
| T22 | UI/DOM, service `web-design-bristol` fields | Nested values read-only, supported strings editable | Process, Testimonial, Faq JSON read-only; configured Intro/Summary/Work Body textareas; Featured Work tags. No source edit | Pass |
| T23 | UI, dirty service Title → New | Protect unsaved existing-entry draft | Existing draft disappeared without confirmation; blank new-entry Title; original file unchanged; SF-01 | Fail |
| T24 | UI, create service from entry opened while on `/work/appcast` | Useful service destination or retained collection context | Correct `.mdx` file created, but `/work/...` queued and ultimately 404; actual `/services/...` returns 200; SF-03 | Fail |
| T25 | UI create payload + file inspection | Infer MDX extension and omit untouched defaults | Request/frontmatter contained only title/category; Draft/order/default strings absent; extension `.mdx` | Pass |
| T26 | UI pointer Delete of disposable service → dismiss native confirm | Do not delete on cancel | Disposable file still existed | Pass |
| T27 | UI pointer Delete → accept; repeated on second disposable entry | Delete correct file and navigate away | Both disposable files removed by UI; no toolbar pointer interception at 1200×1938; parent navigation `/work` then `/services` followed current route | Pass |
| T28 | UI, New from `/services/brand-motion`, create `SF sibling navigation probe` | Navigate to conventional new sibling after HMR | Reached `/services/sf-sibling-navigation-probe`; correct title, one overlay host, cleared pending intent | Pass |
| T29 | UI, disposable service Hero Video = `not-a-url` → Save | Schema refusal, preserve draft and disk | 422 `validation`, `heroVideo: Invalid url`; control `aria-invalid=true`, field value retained, source unchanged | Pass |
| T30 | UI, dirty Cancel → reject discard confirmation | Continue editing without draft loss | `Discard unsaved changes?`; declining kept `not-a-url` | Pass |
| T31 | UI, clear invalid URL, change Title to `SF conflict newer title`, Save | Successful correction | 200; only newer title persisted; invalid URL omitted | Pass |
| T32 | Endpoint, replay original etag against updated disposable entry | Refuse stale write | 409 `conflict`, “file changed on disk since it was loaded”; newer title unchanged | Pass |
| T33 | UI, create again with slug `sf-sibling-navigation-probe` | Never overwrite existing entry | 409 `exists`; original disposable entry preserved; canceled new-entry draft | Pass |
| T34 | UI, direct pointer click Patterns deck image on `/approach` | Reach static image editor | Site `.patterns__link` intercepted the click; no force click used. Use Elements (T35) | Blocked |
| T35 | UI, Elements → double-click Patterns image tag at 58:6 | Open correct browser image editor | `Image · Patterns.astro:58:6` displayed expected asset and controls | Pass |
| T36 | UI, alt `SF alt literal &amp; café` → Save → reopen → edit again | Exact literal alt round trip and subsequent edit | Source correctly escaped but reopened value was `SF alt literal & café`; repeat edit still saved 200. Fidelity failure SF-05; AIR-02 lock did not recur | Fail |
| T37 | UI, recent images → `/patterns-deck-2.png` → Save | Change static src and preserve other attributes | 200; source src changed, width/height/loading retained; new image fetched successfully | Pass |
| T38 | UI, hover/source peek and CSS chip; refusal location → loaded peek | Show matching local source/rules | HowWeWork CSS rules rendered. Refusal peek loaded all 77 ApproachCard lines, including `{title}` at 25. Desktop jump not verified | Pass |
| T39 | UI, Settings General/Editing | Honor config-only and explicitly configured locks | Enabled/annotations disabled; entryEditor disabled with config precedence explanation; remaining controls named | Pass |
| T40 | UI, CSS inspector off → Save → health → on → Save | Live settings without restart | Actual `POST /settings` 200; health false then restored true; new settings file mode 0600, subsequently removed | Pass |
| T41 | UI, Settings across General/Editing/Media/Unsplash | Warn if settings file is not ignored, even with Unsplash off | Warning visible throughout; Unsplash off and key control disabled; no key entered | Pass |
| T42 | UI, Alt-click footer Services from `/approach` while editing | Navigate normally and preserve functional overlay | Reached `/services`, one overlay host, editing mode `1`; subsequently opened collection drawers | Pass |
| T43 | UI, policy privacy entry | Safely represent sections and MDX body | Sections read-only JSON; body source mode with Rich control; no edits | Pass |
| T44 | UI, creative-developer role entry | Correct schema and cross-area image resolution | Title/location/employment fields, rich body, Draft; preview `/src/assets/studio/bristol-cityscape.jpg` loaded | Pass |
| T45 | UI/DOM, role drawer and nested media at 390×844 | Fit viewport and allow footer actions | Drawer x=23.41, width=366.59, height=844; Delete/Cancel/Save hit tests returned their controls. Picker x=11.70, width=366.59. This is a bounded check, not full responsive certification | Pass |
| T46 | UI file chooser, upload actual animated GIF into role image() field | Refuse optimization that would flatten animation | `/upload` 422 `unsupported` with explicit GIF/public-path explanation; no new file, original image unchanged | Pass |
| T47 | Endpoint `/page-source` for seven real routes | Resolve page entrypoint rather than busiest component | Correct `/`, `/approach`, work, service, note, policy and role templates; no desktop claim | Pass |
| T48 | Endpoint + UI menu source opening on `/sf-not-real` | Source for displayed 404 or safe refusal | Actual custom 404, but resolver and captured UI `/open` payload target `[policy].astro:1:1`; SF-04 | Fail |
| T49 | Existing integration `npm test` | Existing assertions pass | **29 test files, 635 assertions passed** (log not committed, see [evidence](evidence/README.md)) | Pass |
| T50 | Integration `npm run typecheck` | No TypeScript errors | Exit 0 (log not committed, see [evidence](evidence/README.md)) | Pass |
| T51 | Restored consumer `npm run build` | Static build succeeds | Exit 0, **88 pages**, 782 image optimization outputs, 22.01 s; [log withheld](evidence/README.md) | Pass |
| T52 | Filesystem scan of built HTML/JS/CSS | No editor injection/meta or probe residue | 130 files scanned including 88 HTML files; zero listed marker hits; [scan](evidence/production-scan.json) | Pass |
| T53 | Filesystem hash/mode checks + git + browser storage | Restore exact baseline and only our state | 496 files matched; example git clean, test entries/assets/settings absent, local/session storage empty; [restoration](evidence/restoration.json) | Pass |

## Historical comparisons

Compared after initial discovery with [playground bugs](../../notes/astra-found-bugs.md) (local, gitignored) and [Airbnb bugs](../airbnb/bugs.md). This is a bounded comparison, not a claim that every prior issue is fixed on every browser/version.

| Prior finding | Outcome here |
| --- | --- |
| ASTRA-01 popup draft lost through global Save & exit | The demonstrated keyboard route is no longer reachable: markup Tab wraps inside its modal (T08). Global popup commit itself was not invoked; do not call that independent path fully verified. |
| ASTRA-02 untouched boolean defaults overwritten | Untouched `draft: default(false)` omitted in both new service files and request payloads (T25). A default-true field is absent from the exercised creation schemas and was not added for testing. |
| ASTRA-03 create reload loses destination | Conventional sibling service creation navigated successfully (T28). SF-03 is a different failure: persisted destination chosen from the wrong current route. |
| ASTRA-04 missing accessible field labels | Named entry/Settings controls present (T11/T39); real screen-reader session not run. |
| ASTRA-05 modal focus escapes | 19-key markup cycle stayed in dialog (T08); nested picker Escape preserved its entry drawer (T14). Not an exhaustive audit of every dialog. |
| ASTRA-06 pointer Save & exit does not exit | Passed with real pointer and full reload (T05). |
| ASTRA-07 production meta leak | Both old and current meta names absent in restored sf-sf production output (T52). |
| AIR-01 Astro toolbar covers Delete | Pointer deletion worked at the prior report's 1200×1938 viewport (T27); narrow footer hit tests also passed. |
| AIR-02 entity alt permanently locks later editing | Second save succeeded. Exact displayed value still differs from literal entity input (SF-05/T36). |
| AIR-03 spaces in media src | Not retested with a space-containing asset filename; no pass claimed. |
| AIR-04 missing gitignore warning when Unsplash off | Warning visible with source off, across tabs (T41). |
| AIR-05 ancestor refusal wording | Ordinary prop refusal and source peek inspected. Component/slot fallback wording not comprehensively retested. |
| Airbnb SETUP-1 stale names | Present in sf-sf, but client now emits a diagnostic. Collections is a verified workaround (SF-SETUP-01). |

## Significant coverage left open

- Desktop editor behavior: all ten launch triggers require the [manual inventory](editor-opening-triggers.md). Source/request resolution is a separate result.
- No source writes through the collection schema designer: adding/removing/retyping fields and creating collections remain untested on this complex schema. Discovery and item browsing were exercised.
- No Unsplash enable/search/import/key flow, remote CDN upload, or production network/video quality testing.
- No full multi-browser, touch-device, screen-reader, keyboard-shortcut, or breakpoint sweep. Narrow checks used Chromium viewport resizing, not a physical phone.
- Expression-value popup saves, copy-context/clipboard fallback, rich formatting/link/image insertion buttons, upload drag/drop, filename collisions, alpha-channel pixel comparison, nested-image authoring and imported-image usage rewriting were not exercised.
- No UI race against a concurrent external file writer. Stale conflict coverage was a labeled direct request using a previously valid etag.
- The archive's file-loader entries are outside the documented conventional Markdown entry mapping. No schema/data migration was attempted.
- Production isolation was checked in emitted files. A preview server and production endpoint requests were not run.

The note rich editor showed `_The Illusion of Life: Disney Animation_` literally inside a link label instead of showing nested emphasis. Its markdown remained intact after the body save. Treat nested inline formatting preview fidelity as a follow-up observation; this run did not isolate a minimal reproducer or verify every supported nesting combination.

## Automation and attribution notes

Some attempts failed because the test selector or transport assumption was wrong: inline editing uses `contenteditable="plaintext-only"`, required field names include `*`, Astro's own toolbar also contains Settings, and a hidden site Showreel also has `role=dialog`. These were diagnosed and the actual controls used; those attempts are not product failures. A late hover-peek attempt timed out when the pill was hidden; the refusal-location path verified the loaded peek instead.

The browser upload tool refused the initial `/tmp` fixture path because its allowed upload roots were narrower than the shell's. The same exact fixture was copied under this workspace's ignored `.playwright-mcp/sf-sf-retest/` and the real file chooser succeeded. One native-confirm Escape call stalled; the pending confirmation was handled separately and file state rechecked. The Settings save waiter initially listened for `/settings/apply`; the actual route is `POST /settings`, whose 200 was checked in network records. A build invocation from the integration root failed because that package has no build script; the consumer's documented build then passed. None of these failures was classified as an implementation bug.

Console/network errors included intentional validation/unsupported/conflict requests, real 404s from the wrong create destination, and the legacy-meta warning. Existing CDN videos returned 206 responses during the browser pass. External contact/subscribe forms and mail links were not submitted.

## Restoration and remaining artifacts

A `test-mutations.diff` preserved the reviewable diff before cleanup; it is [not kept here](evidence/README.md), being the client's own source. Five existing source files were restored: ApproachIntro, HowWeWork, shared Patterns, the animation note and Appcast. The note body normalization and Appcast array formatting changes are included in that restoration. Current hashes were checked against the recorded final test state before restoring so an unrelated concurrent edit would not be overwritten.

Both created service entries were deleted through browser confirmation. The uploaded note asset and newly created `.astro-dev-edit.json` were removed after verifying their recorded hashes. All 496 baseline files matched their original bytes **and modes**, including package.json, package-lock.json, Astro config, schemas, source/assets, and existing ignored content included in the baseline. Post-build verification also found no baseline changes. The example git working tree is clean.

Browser storage started empty and was restored to empty by removing only this run's `astroDevEditMode`/`astroDevEditTree` state; edit mode is off and the viewport is restored to 1200×1938. Pending create state had already cleared. Port 4383 remains available for follow-up testing.

Installed `node_modules`, generated `.astro`/`dist`/image caches, tooling snapshots/logs and the external temporary backup remain as operational artifacts; mtimes may differ for restored files. Reports under this directory are intentional additions. The integration's pre-existing working changes were preserved. A later change to `examples/playground/src/pages/index.astro` appeared during the session pause and was also left untouched.
