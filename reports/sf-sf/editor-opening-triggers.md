# Editor-opening triggers — sf-sf manual verification

Inventory traced against the current integration source, not copied as an assertion from previous runs. Start the [tested setup](tests.md#environment-and-setup) at http://localhost:4383. **Desktop editor windows, editor detection, foreground focus and final cursor positions remain unverified.** A successful request or a toast cannot establish those outcomes.

The final 404-menu test captured the actual `/open` payload with a temporary browser request interception. An earlier attempt removed that interception before the asynchronous route lookup completed, so it could reach the real launch endpoint; no desktop behavior was observed. Other desktop launch actions below were traced in source or their browser surfaces inspected, not invoked as verified OS launches.

## Desktop source-editor triggers

For each available trigger, manually confirm that the intended editor opens the intended project/file/line, the UI handles a missing editor gracefully, and repeated activation does not change content.

| ID | UI trigger | sf-sf location / expected target | This run |
| --- | --- | --- | --- |
| O01 | Hover pill **open** | Edit page → hover “How we work:” on `/approach`; `src/components/approach/HowWeWork.astro:45:44` | Pill and classification observed. Launch pending. [hover.ts](../../src/client/hover.ts) → `overlay.openSource` → `/open`. |
| O02 | Elements row **line:col** | Elements → location at right of the desired row; e.g. `Patterns.astro:58:6` or the HowWeWork heading | Location and owning file inspected. Launch pending. [tree.ts](../../src/client/tree.ts) → `/open`. Click the location, not the tag. |
| O03 | Source peek footer **Open in editor** | Hover pill file label, or refusal location → peek → footer. The tested refusal peek was `ApproachCard.astro:25:51` | Full source loaded; launch pending. [peek.ts](../../src/client/editors/peek.ts) → `/open`, carrying the originally requested location. |
| O04 | Markup popup header **open** | `/approach` → opening heading with `<br>`; `ApproachIntro.astro:11:47`. `/contact`'s heading is another source-traced candidate. | Markup popup exercised. Launch pending; popup should remain open. [markup.ts](../../src/client/editors/markup.ts) → [source-popup.ts](../../src/client/editors/source-popup.ts) → `/open`. |
| O05 | Expression-value popup header **open** | Source-traced candidate: Footer's local `navLinks.map()` label on `/approach`, at `Footer.astro:140:32`. Confirm that classification opens a value popup before testing its header. | Conditional trigger traced; this popup was not exercised. [expression.ts](../../src/client/editors/expression.ts) → shared source popup → `/open`. Target is the rendered element's template location, not a newly computed frontmatter offset. |
| O06 | Refusal **Open source** when no recognized page entry exists | `/approach` → “Discover”; `ApproachCard.astro:25:51`. Also currently present on sf-sf detail pages because their legacy meta is unrecognized. | Refusal observed. Launch pending. [notice.ts](../../src/client/editors/notice.ts) → `/open`. Package-owned paths may safely refuse instead. |
| O07 | Refusal **Open template** when a recognized page entry exists | After a separate authorized migration to the current meta name: collection-derived title on a detail page → owning Astro template/component | **Unavailable in the unchanged sf-sf setup** (SF-SETUP-01). Conditional code traced in [notice.ts](../../src/client/editors/notice.ts). Primary Edit page content opens the browser drawer, not the desktop editor. |
| O08 | CSS rule card **open** | Hover HowWeWork heading → `.how-we-work__label` chip → rule; expect the local `.astro` style block. Global class chips may target `src/styles/*.css`. | CSS rules rendered; source-location launch pending. [css-inspect.ts](../../src/client/css-inspect.ts) → `overlay.openRule` → `/inspect/open`. External/unresolvable styles have no usable jump. |
| O09 | Admin menu **Open page source** | `/approach` → `src/pages/approach.astro:1:1`; work/note/service/role routes → their `[id].astro:1:1`; `/privacy-policy` → `[policy].astro:1:1` | Seven real routes resolved by endpoint. On `/sf-not-real`, UI dispatch wrongly targets `[policy].astro:1:1` (SF-04). [admin-bar.ts](../../src/client/admin-bar.ts) → `/page-source` → `/open`. Desktop pending. |
| O10 | Collections detail **Open source** | Menu → Collections → any collection; expect `src/content.config.ts` at that collection's declaration | Button present and callback traced; declaration cursor position/desktop launch pending. [collections-panel.ts](../../src/client/editors/collections-panel.ts) → `/collection/open`. Includes the fallback for an unreadable schema; no extra distinct trigger exists for that fallback. |

The three endpoint families converge on [server/editor.ts](../../src/server/editor.ts), `launchInEditor()`. Settings → Editing → Open in editor controls the advertised capability. Feature-off behavior of every individual trigger was not retested; keep it in the manual checklist. No file-open links in documentation or Astro's own separate toolbar are counted as integration triggers.

## Browser editor and inspector entry points

These are included to disambiguate “editor-opening”: they open tool UI, and do not launch a desktop editor by themselves.

| Trigger | Result / availability |
| --- | --- |
| **Edit page**, then click an eligible text element | Inline text, markup popup, expression popup, or safe refusal according to classification. Literal, markup and prop refusal were exercised. |
| Edit page, then click a static image | Image swap panel. The Patterns site's stretched link blocks its direct click; use Elements below. Dynamic Astro/MDX imagery has the documented support boundary. |
| **Elements**, or the left-edge **Show the element tree** tab | Opens the tree. Elements also enables edit mode when necessary. A row click selects; **double-click the tag/row** opens its browser editor or refusal. Patterns image double-click was verified. |
| **Edit entry** in the bar | Entry drawer for the recognized meta file; hidden on this unchanged project's detail pages. |
| Refusal **Edit page content** | Same entry drawer; hidden here for the same legacy-meta reason. |
| Menu → **Collections** → collection → **Items** → entry | Entry drawer for the selected file, independently of the currently displayed route. Verified for works, notes, services, roles and policies. |
| Collections → Items → **New item** | New-entry drawer; source-traced, creation via this exact trigger not run. Archive has no recognized directory and cannot use it. |
| Entry drawer → **New** | New-entry drawer. Tested; see SF-01 and SF-03 before relying on it with pending edits or a different current route. |
| Entry image thumbnail / **Browse…** | Shared media picker. Both optimized-field previews and Browse were inspected; Browse/cancel/select/upload exercised. |
| Image swap panel → **Browse all** | Shared picker for web-path images. Static panel and recent-image selection tested; this exact Browse all path not exercised. |
| Entry **MD / Rich** | Markdown-source/rich-body modes; complex MDX remains source-only. Tested. |
| Rich body **Insert image**, or click a body image | Body image controls and their browse/upload actions. Existing body images and a body edit tested; insertion/replacement controls not exercised. |
| Rich body **Insert link** / heading menu | Formatting controls, not desktop source navigation. Not exercised. |
| Menu → **Settings** | Settings drawer. General, Editing, Media and Unsplash inspected; live CSS-inspector setting saved and restored. |
| Unsplash configuration-error action → **Open Settings** | Nested Settings entry point, conditional on Unsplash UI. Not available during this run because Unsplash stayed disabled. |
| Hover file label / refusal file location | Read-only source peek. Verified through the refusal location; hover-open shell also observed. |
| Hover class/ID chip | CSS inspection card. Verified. |
| Hover pill **copy**, when clipboard access fails | Copy-context fallback panel; conditional source-traced trigger, not exercised. |

Manual follow-up should include keyboard activation and focus return, missing editor executables, source paths containing spaces, and all supported browsers. The run does not establish those outcomes.
