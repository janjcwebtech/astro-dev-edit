# Bug reports — airbnb-2026-09-06

Target, versions and served root: [project.md](project.md). Execution record:
[tests.md](tests.md). No implementation code was changed during this pass; every
test edit was restored (see [tests.md](tests.md) §Cleanup).

These are findings against **this** installed version on **this** project. They
are not a re-statement of the earlier playground run — the outcome of that run's
seven findings is recorded in [tests.md](tests.md) §Regression pass.

| ID | Severity | Finding | Layer |
| --- | --- | --- | --- |
| AIR-01 | Medium | Astro's own dev toolbar covers the entry drawer's Delete button, so it cannot be clicked | integration (client) |
| AIR-02 | Low | An `alt` containing an HTML entity reference becomes permanently uneditable, with a misleading "edited elsewhere" refusal | integration (client/patcher) |
| AIR-03 | Low | Image swap writes raw spaces into `src` instead of percent-encoding them | integration (client/patcher) |
| AIR-04 | Low | The gitignore warning is unreachable while the Unsplash photo source is off | integration (client) |
| AIR-05 | Info | A refusal notice states the *ancestor's* reason for component- and slot-rendered content | integration (client) — behaviour note, arguably by design |
| SETUP-1 | Medium | The target still uses pre-rename names, silently disabling the entire entry editor | consuming project, with a diagnosability gap |

---

## AIR-01 — Astro's dev toolbar makes the entry drawer's Delete button unclickable

**Severity:** Medium. A destructive action is unreachable by pointer at ordinary
window sizes. Keyboard activation works, so nothing is lost — but a user who does
not think to Tab to it concludes Delete is broken.

**Reproduce (UI)**

1. On any post detail page (e.g. `/area/beaches-near-esmoriz/`) with the
   page-source meta present, click **Edit entry**.
2. Click **Delete…** in the drawer footer with the mouse.

**Expected:** the confirm dialog opens.

**Observed:** the click never lands. Playwright reports
`<astro-dev-toolbar></astro-dev-toolbar> intercepts pointer events` and retries
until timeout. Focusing the button and pressing Enter *does* open the confirm
(`Delete astra-default-probe.mdx? (Undo is git.)`), and accepting it deleted the
file and navigated to `/area` correctly.

**Mechanism (measured, not inferred).** At a 1200×1938 viewport:

| Element | Rect (x, y, w, h) |
| --- | --- |
| `Delete…` button | 621, 1890, 98, 32 — centre (670, 1906) |
| Astro `#dev-bar-hitbox-above` | 512, 1878, 175, 42 |
| Astro `#dev-bar` | 512, 1920, 175, 42 |

`toolbar.shadowRoot.elementFromPoint(670, 1906)` returns
`#dev-bar-hitbox-above` — Astro's invisible hover target *above* its bar, which
covers the Delete button's centre even though the visible bar does not.

The stacking order is why the hitbox wins:

| Surface | computed `z-index` |
| --- | --- |
| Astro dev-toolbar root | **2000000010** |
| astro-dev-edit drawer | 1999999006 |
| astro-dev-edit backdrop | 1999999005 |
| astro-dev-edit bar | 1999999004 |

Every overlay surface sits ~1,000,004 below Astro's toolbar, so any overlay
control landing in the toolbar's footprint (bar or hitboxes, ~175px wide,
centred, 84px tall in total) is unclickable. Delete is the case that bites
because it sits in a footer band at the bottom of the viewport.

**Not affected:** the drawer's Cancel/Save (further right, outside the 512–687
band at this width), the admin bar (docked top by default), and keyboard use.
Not reproducible by widening the window far enough that the footer button clears
the centre band — so the trigger is viewport-dependent, which makes it easy to
miss in manual testing.

**Known vs new:** the earlier playground run saw this on Astro 7 and explicitly
declined to report it ("this overlap was not investigated enough"). This run
reproduces it on **Astro 5**, where the dev toolbar is *mandatory* for the
integration to work at all — so it cannot be configured away.

**Fix shape:** raise the overlay's stacking layer above Astro's toolbar, or lay
out drawer footer actions clear of the bottom-centre band. Regression test:
assert `elementFromPoint` at each footer button's centre resolves inside the
overlay's own shadow root while the Astro toolbar is mounted.

**Workaround (verified):** focus the button and press Enter.

---

## AIR-02 — An `alt` containing an HTML entity becomes permanently uneditable

**Severity:** Low. Narrow trigger (alt text whose *literal characters* include an
entity reference such as `&amp;`), but once it happens the element cannot be
edited again, and the message sends the user to a reload that does not help.

**Reproduce (UI)**

1. On `/`, edit mode on, click the hero photo (`.hero-photo > img`).
2. Set **Alt text** to `alt with &amp; ampersand` — the literal five characters
   `&amp;`, as someone pasting escaped copy would.
3. Save. This succeeds; the source becomes
   `alt="alt with &amp;amp; ampersand"`, which is the correct escaping of what
   was typed.
4. Reopen the same image and change the alt again in any way. Save.

**Expected:** the second save writes, as it does for every other alt value.

**Observed:** `POST /__dev-edit/apply` → **422**, and an error toast:

> Save failed — The source alt no longer matches the page (it may have been
> edited elsewhere). Reload and try again.

The file is not written and the panel closes, discarding the draft. Reloading
does not help — the state is stable, so the element is permanently stuck.

**Mechanism (partly inferred).** Astro's dev renderer decodes attribute entities
one level when emitting: source `&amp;amp;` is served as `alt="&amp;"`
(verified with `curl`), which the browser decodes to `&`. The panel reads the
DOM's `&`, the verify step compares it against the source's `&amp;amp;`, and the
mismatch is reported as a concurrent edit. Which layer performs the extra decode
is **inferred** from the served HTML; I did not instrument Astro.

**Not affected — checked explicitly:**

- **Text content is fine.** Typing `Coast &amp; sea` into a heading writes
  `Coast &amp;amp; sea`, renders as `Coast &amp; sea`, and a *second* edit
  succeeds (appended `2` → `Coast &amp;amp; sea ASTRA2`). Astro preserves the
  double escaping in text, so verify agrees.
- **A plain `&` in an alt is fine.** `Jan & Carolina at the beach` wrote
  `alt="Jan &amp; Carolina at the beach"` and edited again cleanly.
- The site's own real entity content (`Privacy &amp; legal`,
  `Hosted by Jan &amp; Carolina`) edits and re-edits correctly.

So the trigger is specifically *an entity reference appearing as literal text
inside an attribute*.

**Known vs new:** likely a member of the entity-decoding family that `CLAUDE.md`
records as a tracked `deferral`, but the *effect* here — a one-way write that
locks the element, reported as a phantom concurrent edit — is worth checking
against that item rather than assuming it is covered.

**Fix shape:** decode the source attribute to the same normal form the DOM
presents before comparing, or carry the raw source value in the classify
response and compare raw-to-raw. A regression test can pin it with a fixture
whose `alt` already contains `&amp;amp;`. Failing that, the refusal message
should not claim an external edit when the source is unchanged.

**Workaround:** edit the attribute in the source file by hand.

---

## AIR-03 — Image swap writes raw spaces into `src`

**Severity:** Low. It renders — browsers encode the space — but the attribute is
not a valid URI and does not match how the same project writes the same path by
hand.

**Reproduce (UI):** on `/`, click the hero photo → **Browse all** → pick
`/brand/Logo Miramar horizontal.png` → **Use image** → **Save**.

**Expected:** `src="/brand/Logo%20Miramar%20horizontal.png"`, matching
`SiteHeader.astro:26`, which the project author wrote percent-encoded.

**Observed:** `src="/brand/Logo Miramar horizontal.png"` — raw spaces. The
picker's own `aria-label`/`title` also carry the unencoded path.

**Evidence:** the two `<img>` elements served on `/` after the swap —

```html
<img src="/brand/Logo%20Miramar%20horizontal.png" …>   <!-- hand-written, SiteHeader -->
<img src="/brand/Logo Miramar horizontal.png" …>       <!-- written by the tool, index.astro -->
```

**Not affected:** every asset without spaces in its filename, which is all 24
files in `public/photos`. Only `public/brand/Logo Miramar horizontal.png` in this
project triggers it.

**Fix shape:** percent-encode path segments when composing the attribute value
(not the display label). Regression test: an asset fixture with a space and a
`#` in its name.

**Workaround:** rename the asset, or fix the attribute by hand.

---

## AIR-04 — The gitignore warning cannot appear while Unsplash is off

**Severity:** Low. The security intent still holds — the key field is disabled
until the photo source is enabled, and the warning does appear before a key can
be typed — but the warning is scoped to a tab the user may never open, while the
file it warns about already exists on disk.

**Reproduce (UI + endpoint)**

1. In a project with no `.gitignore` entry for `.astro-dev-edit.json` (the target
   has no `.gitignore` at the Astro root at all), open **Settings** and change
   any option, e.g. Media → *Upload directory*. Save. The file is created
   (`-rw-------`, correct) and shows as untracked in `git status`.
2. Open the **Unsplash** tab.

**Expected, per README:** "`.astro-dev-edit.json` **should be gitignored** … and
the drawer warns when it isn't."

**Observed:** no warning. `.atx-settings-warning` is present but empty with
`data-on` absent and `display: none`. The server *did* send it —
`GET /__dev-edit/settings` returns
`unsplash: {enabled:false, configured:false, source:null, gitignoreWarning:true}`.

Enabling **Unsplash photo source** and saving makes the warning render correctly.

**Cause (confirmed in source):** [`settings-panel.ts`](../../src/client/editors/settings-panel.ts)
`paintKey()` returns early at the `if (!u.enabled)` branch (~line 214), before
reaching the `if (u.gitignoreWarning)` block (~line 258). The server-side check
itself is correct: [`settings.ts::checkGitignored`](../../src/server/settings.ts)
found no `.gitignore` at the project root and reported `false`.

**Not affected:** the file's `0600` permissions, the secret's exclusion from the
response, and the warning's content once shown.

**Fix shape:** paint the gitignore warning outside the key branch — it is a fact
about the settings file, not about the key. Regression test: assert the warning
renders with `enabled: false` and `gitignoreWarning: true`.

---

## AIR-05 — A refusal states the ancestor's reason for slot-rendered content

**Severity:** Info. The refusal itself is correct and documented; only its
*stated reason* can describe a different element than the one clicked.

**Reproduce (UI)**

- On `/`, click the **Book on Airbnb** button (a `<Button>` component).
  → "This element contains nested markup, so its text cannot be edited as one
  block." at `index.astro:28:58`.
- On `/area/beaches-near-esmoriz/`, click a body paragraph rendered from MDX
  through `<slot/>`. → the same "contains nested markup" wording at
  `PostLayout.astro:89:26`.

**Mechanism (confirmed).** Astro annotates only elements written in the file, so
the component-rendered `<a class="btn">` carries **no**
`data-astro-source-file` (verified with `curl`). `nearestSource` climbs to the
nearest annotated ancestor — `.hero-actions` at 28:58 — and the reason returned
describes *that* element, which genuinely does contain nested markup. The clicked
element was never classified.

Refusing here is documented behaviour (`docs/EDITING.md`: components "all fall
here"), so this is a **pass** on safety. It is recorded because the wording can
send a reader hunting for nested markup inside a button that has none, and
because the post-page case is softened only by the secondary sentence pointing
at the MDX file.

**Suggestion, not a defect:** when the classified loc is an ancestor rather than
the clicked element, say so ("this element is rendered by a component; the
nearest source is …").

---

## SETUP-1 — The target's pre-rename names silently disable the entry editor

**Severity:** Medium as experienced (a whole feature surface is missing with no
message). The **cause** is the consuming project being stale against a documented
breaking rename, not an integration defect — but nothing anywhere says so.

**Two stale names, both failing silently.**

1. `astro.config.mjs` imports `astro-text-edit`. The package is
   `astro-dev-edit` since 0.7.0 (`CHANGELOG.md`: "The project is now
   `astro-dev-edit`… There is no migration shim"). The config's `try/catch`
   deliberately swallows `ERR_MODULE_NOT_FOUND`, so a plain
   `npm install file:…` leaves the overlay **entirely absent** with a green dev
   server. See [project.md](project.md) for the install that works.
2. `PostLayout.astro:48` emits
   `<meta name="astro-text-edit:page-source" …>`. The client reads
   `astro-dev-edit:page-source` ([`page-source.ts`](../../src/client/page-source.ts)).

**Observed for (2):** on every post detail page the **Edit entry** button exists
but carries `data-hidden` / `display: none`. No console message, no toast, no
admin-bar note. The entry drawer, its create/delete flows and the refusal
notice's "Edit page content" action are all unreachable. `/__dev-edit/health`
still reports `entryEditor: true`, so the health check does not reveal it either.

**Confirmed by test edit:** renaming the meta to `astro-dev-edit:page-source`
made the button appear immediately and every entry-editor test in
[tests.md](tests.md) then passed. **The test edit was reverted**; the file is
byte-identical to its baseline.

**Not affected:** `POST /page-source` resolves this page's route without any meta
at all (returns `src/pages/area/[...slug].astro` for `/area/[...slug]`), so the
admin bar's *Open page source* keeps working. Only the meta-driven entry surface
is lost.

**Fix shape.** For the target: rename both. For the integration, an optional
diagnosability improvement — the client already queries the document for its meta
tag; noticing an `astro-text-edit:page-source` tag and logging one line
("found a pre-0.7 page-source meta; rename it to `astro-dev-edit:page-source`")
would turn a silent absence into a one-line fix. That is a **feature
suggestion**, not a bug, and is not required for the target to work.
