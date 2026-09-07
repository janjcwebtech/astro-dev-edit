# Bugs found — sf-sf

Observed 2026-09-06 on the [environment recorded in tests.md](tests.md). No implementation bugs or project setup issues were fixed. All test edits were restored. Historical reports were consulted only after the [initial plan](initial-plan.md).

| ID | Severity | Finding | Layer |
| --- | --- | --- | --- |
| SF-01 | Medium | New silently discards unsaved edits to the current entry | Tool client |
| SF-02 | Low | A title-only save reformats untouched YAML flow arrays | Tool frontmatter serialization |
| SF-03 | Medium | New from an entry opened through Collections can navigate to another collection's URL and a 404 | Tool navigation |
| SF-04 | Low | Open page source chooses a policy template for the custom 404 page | Tool route resolution |
| SF-05 | Low | Literal entity text in an image alt does not survive the source/render/display round trip | Astro rendering/tool compatibility |
| SF-SETUP-01 | Medium | Legacy meta name hides Edit entry on all detail templates | Consumer configuration |

## SF-01 — New discards an existing entry's draft

**Impact:** unsaved authoring work disappears through a normal visible action, without confirmation or a recovery path.

**Reproduction:** visit `/work/appcast`, open menu → Collections → services → Items → `web-design-bristol`. Change **Title** to `SF unsaved existing entry`, then click **New** in the drawer header.

**Expected:** offer to keep, save, or explicitly discard the current draft before replacing the drawer. The ordinary Cancel action already prompts when dirty.

**Actual:** the drawer immediately becomes **New entry / in services**, with an empty Title. No confirmation appears. The service file remains unchanged and the draft is lost. The subsequent creation is a separate operation; it does not retain the existing entry's pending changes.

**Evidence/cause:** UI reproduction and disk diff. In [entry.ts](../../src/client/editors/entry.ts), `showEditDrawer()` wires New directly to `shell.teardown(); showCreateDrawer(entry);`, bypassing the dirty-confirm path configured on `openDrawer()`. Cause confidence: high. This was not among the prior playground or Airbnb findings.

**Workaround:** save the current entry before using New. Normal Cancel's keep-editing confirmation was verified separately.

## SF-02 — A title-only save modifies untouched arrays

**Impact:** unnecessary changes obscure review and violate the documented preservation of untouched frontmatter. Observed values remain semantically unchanged; this is not demonstrated data loss.

**Reproduction:** on `/work/appcast`, use Collections → works → Items → `appcast`. Change only Title to `SF complex MDX preservation probe` and Save.

**Expected:** only the title changes; untouched YAML remains byte-identical.

**Actual:** alongside the title, three arrays gain spaces inside their brackets:

```diff
-categories: [Campaign, Digital]
+categories: [ Campaign, Digital ]
-sector: [Health & Fitness, Technology, Social Media]
+sector: [ Health & Fitness, Technology, Social Media ]
-services: [Campaign Film, Creative Strategy, Motion Design, Paid Social, Script Writing]
+services: [ Campaign Film, Creative Strategy, Motion Design, Paid Social, Script Writing ]
```

The complex MDX body, imports, nested results and comments survived. A subsequent untouched Save issued no `/entry/apply` request and introduced no further source diff.

**Evidence:** the captured test diff, [withheld with the rest of the client's source](evidence/README.md). [frontmatter.ts](../../src/patcher/frontmatter.ts), `applyEntryChanges()`, parses and serializes the whole YAML document via `doc.toString()` after applying the changed keys. That explains the normalization; no serializer instrumentation was added. Cause confidence: high. New relative to the consulted reports.

**Workaround:** inspect the diff after a frontmatter save. No browser workaround preserving these exact array bytes was verified.

## SF-03 — Creating from a different collection uses the current page's route

**Impact:** a successful create ends on a 404, making it appear unsuccessful. The new file exists and can still be opened through Collections or its actual route.

**Reproduction:** while viewing `/work/appcast`, open Collections → services → Items → `web-design-bristol` → New. Enter Title `SF retest disposable 20260906`, Category `Digital`, and Create. Wait for the navigation to finish.

**Expected:** stay in a useful collection/editor context or navigate to `/services/sf-retest-disposable-20260906`.

**Actual:** `/entry/create` returns 200 and writes `src/content/services/sf-retest-disposable-20260906.mdx`. The client stores:

```json
{"url":"/work/sf-retest-disposable-20260906","at":1788718815595}
```

in `astroDevEditPendingNav`, repeatedly requests that missing work route, and eventually navigates there. The destination returns **404** and displays the custom not-found page. The correct `/services/...` route returns **200**.

**Cause:** [entry.ts](../../src/client/editors/entry.ts) derives a sibling destination from the current browser path, even when Collections opened an entry belonging to another route family. [collections-panel.ts](../../src/client/editors/collections-panel.ts) explicitly avoids this assumption for its direct **New item** action, but the existing-entry → New path does not carry that context. Cause confidence: high.

**Comparison:** distinct from ASTRA-03's lost navigation during reload. Here the persisted intent survives but contains the wrong destination. A control create from `/services/brand-motion` successfully reached `/services/sf-sibling-navigation-probe` through the reload. Both disposable entries were deleted using the UI.

**Verified workaround:** start creation from an existing detail route in the same collection. Direct New item avoids a route guess in current code, but was not exercised as a creation workaround in this run.

## SF-04 — Source opening on a 404 targets the policy template

**Impact:** the menu opens unrelated source when inspecting a missing page, directing a developer to the wrong file.

**Reproduction:** visit `/sf-not-real`, which returns HTTP 404 and the site's **Page not found — Something Familiar** page. Choose menu → **Open page source**.

**Expected:** identify `src/pages/404.astro`, the page being displayed, or explicitly refuse resolution.

**Actual:** `/page-source` returns:

```json
{"file":"src/pages/[policy].astro","pattern":"/[policy]","refusal":null}
```

The menu dispatches `{"file":"src/pages/[policy].astro","loc":"1:1"}` to `/open`. A second UI attempt intercepted that final request to record the payload; desktop application behavior was not inspected. The actual rendered heading maps to `src/components/not-found/NotFoundHero.astro:41:42`.

**Cause:** [route-manifest.ts](../../src/server/route-manifest.ts) selects the first matching route regex, without determining whether the requested value belongs to that static route's generated paths or whether Astro served its 404 fallback. Cause confidence: high. Valid policy and other sampled detail URLs resolved correctly. New relative to prior reports.

**Workaround:** open `src/pages/404.astro` manually, or inspect an actual rendered element through the hover pill/Elements to locate its component.

## SF-05 — Image alt loses literal entity notation

**Impact:** narrowly affects copy containing the literal characters of an HTML entity reference. What the editor shows after saving is different from what was entered.

**Reproduction:** on `/approach`, enter edit mode → Elements → find the image row at `Patterns.astro:58:6` → double-click its tag. Set Alt text to the literal string `SF alt literal &amp; café`, Save, and reopen the same image.

**Expected:** the same literal `&amp;` string survives in the rendered alt and reopened control.

**Actual:** the source correctly contains `alt="SF alt literal &amp;amp; café"`, but the reopened field reads `SF alt literal & café`. A subsequent change to `SF alt second edit` succeeds with HTTP 200.

**Attribution:** this is a rendering-compatibility finding, not evidence of a wrongly escaped source write. [astro.ts](../../src/patcher/astro.ts), `decodeDepths()`, documents Astro's extra attribute-entity decoding and accepts multiple decoded forms when verifying an update. The observed source and reopened UI support that explanation; this run did not instrument the compiler or retain the intermediate raw HTML response. Cause confidence: high for the boundary where fidelity is lost; inferred for the compiler mechanism.

**Comparison:** AIR-02's permanent second-save refusal does **not** reproduce. Its broader entity round-trip problem still has a visible effect. Ordinary alt editing and replacement image saves passed. No lossless browser workaround for literal entity notation was verified.

## SF-SETUP-01 — Old meta name hides the detail-page entry shortcut

**Impact:** Edit entry and the refusal notice's Edit page content shortcut are absent despite `/health` reporting `entryEditor: true`.

**Reproduction:** after installing the local tool under the package name used by this example's config, open `/notes/12-principles-of-animation` or `/work/appcast`.

**Actual:** [Base.astro](../../examples/sf-sf/src/layouts/Base.astro) emits `astro-text-edit:page-source`. The current client requires `astro-dev-edit:page-source`. The entry button stays hidden. A console warning explicitly identifies the old name and the required rename.

The defensive import in [astro.config.mjs](../../examples/sf-sf/astro.config.mjs) also expects `astro-text-edit`, while the current package is named `astro-dev-edit`. The tested local alias handles dependency resolution, but it does not change the meta tag contract.

**Comparison:** the consuming-project mismatch from Airbnb SETUP-1 is present here too. Its former lack of a diagnostic is resolved: the current code emits a clear warning. The initial plan's assumption that the legacy meta was supported was corrected during runtime discovery; no source rename or injected DOM meta was used to bypass it.

**Verified workaround for testing:** menu → Collections → collection → Items → entry opens the same entry drawer without relying on a page meta tag. Project source/config were left unchanged.
