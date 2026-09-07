# Editor-opening triggers — manual verification checklist

Run label **airbnb-2026-09-06**. Environment: [project.md](project.md).

**Nothing in this file was verified as an actual desktop-editor launch.** No
`/open`, `/inspect/open` or `/collection/open` request was issued during this
run, precisely because a success would have opened a window on the user's
machine. The inventory below is traced from the current client source at
`d62acf7`, not copied from the previous run's list — re-trace it after any change
to `overlay.ts`, `admin-bar.ts` or `editors/`.

`/__dev-edit/health` reports `openInEditor: true` for this project, so all of
these are expected to be live. An HTTP 200 from any of them still would not prove
a window opened; only looking at the editor does.

## The three server endpoints

Every trigger funnels through one of these, and all three converge on
[`server/editor.ts::launchInEditor`](../../src/server/editor.ts):

| Endpoint | Reached from | Registered in |
| --- | --- | --- |
| `POST /open` | `overlay.ts::openSource` and `openPageSource`, via `api.open` | `middleware.ts` (core table) |
| `POST /inspect/open` | `overlay.ts::openCssRule`, via `api.inspectOpen` | `inspect-routes.ts` |
| `POST /collection/open` | `collections-panel.ts`, via `api.collectionOpen` | `schema-routes.ts` |

`client/api.ts` is the only module in the client permitted to call `fetch`, so
the three wrappers there (`open`, `inspectOpen`, `collectionOpen`) bound the whole
inventory.

## Triggers

| # | Trigger | Where to exercise it on **this** site | Expected target | Path through the code |
| --- | --- | --- | --- | --- |
| 1 | Hover pill **open** | Edit mode → hover any element → click `open` in the pill | that element's file + `line:col`, e.g. `miramar-esmoriz.astro:95:29` (verified as the pill's own label in J-01) | `hover.ts:266` → `deps.openSource` → `overlay.ts:207` → `/open` |
| 2 | Elements row **line:col** | Elements → click the location at the right of a row | that row's file/location. Row **double-click** opens the in-browser editor or a refusal instead — not a launch | `tree.ts:283` → `deps.openSource` → `/open` |
| 3 | Source peek footer **Open in editor** | Open a peek (from the pill's file label, or a refusal's location), then its footer | the peeked file and original loc | `peek.ts:100` → the `openSource` passed at `overlay.ts:309` → `/open` |
| 4 | Markup popup title-bar **open** | `/` → click the hero review `<figcaption>` (mixed inline markup) | `index.astro:39:22` — the popup should stay open | `markup.ts:89` → `source-popup.ts:70` → `/open` |
| 5 | Expression/value popup title-bar **open** | `/stay/miramar-esmoriz/` → click a nav link (traces to `links[].label`) | the rendered element's `.astro` loc. It does **not** resolve a separate frontmatter offset for this jump, so expect `SiteHeader.astro:30:42`, not line 17 | `expression.ts:32` → `source-popup.ts:70` → `/open` |
| 6 | Refusal **Open source** (no backing entry) | `/` → click **Book on Airbnb**, or the `{RATING.score}` `<strong>` | the refused element's file/loc — `index.astro:28:58` / `index.astro:120:23`. Note these are the *annotated ancestor's* locs, see [AIR-05](bugs.md) | `notice.ts:73` → `/open` |
| 7 | Refusal **Open template** (backing entry present) | `/area/beaches-near-esmoriz/` → click the post `<h1>` → secondary action | `PostLayout.astro:62:38`. The **primary** button, *Edit page content*, opens the browser drawer and is not a launch. **Requires the page-source meta fix** — see [SETUP-1](bugs.md) | `notice.ts:81` → `/open` |
| 8 | Admin menu **Open page source** | purple brand mark → *Open page source*, on both a static page (`/`) and a detail page | the route entrypoint at `1:1`. Resolution verified only (J-04): `/area/beaches-near-esmoriz/` → `src/pages/area/[...slug].astro`. Works without the meta tag | `admin-bar.ts:577` → `overlay.ts:236` → `/page-source` then `/open` |
| 9 | CSS rule card **open** | Enable the CSS inspector → hover an element → click a class chip (`.reveal`, `.in` appear in the pill on this site) → rule card | the resolved local stylesheet or the `.astro` `<style>` block. Unresolved/external sheets give no usable jump. **Untested this run beyond the chips rendering** | `css-inspect.ts` `ruleBlock()` → `overlay.ts:265` `api.inspectOpen` → `/inspect/open` |
| 10 | Collections detail **Open source** | brand menu → Collections → `posts` → the corner *Open source* action | `src/content.config.ts` at the `posts` declaration. Also the offered fallback for a schema shape the patcher cannot prove | `collections-panel.ts:422` → `api.collectionOpen` → `/collection/open` |

## What is *not* a desktop launch

Easy to mistake for one, and all four were exercised in the browser this run:

- the inline `contenteditable` text editor,
- the light-DOM rich-text body editor in the entry drawer,
- an Elements **row** double-click (opens the in-browser editor or a refusal),
- the source **peek** panel itself — only its footer button launches.

`astro-click-to-source` is separately installed on this site and answers
**Alt+Click** on its own `/__open-in-editor` endpoint (verified in J-05). A
window opening after Alt+Click is *that* tool, not this one — check which
endpoint fired before recording a result.

## Suggested manual pass

1. Confirm `openInEditor: true` at `/__dev-edit/health`, and note which editor
   `launch-editor` will pick (the target lists `launch-editor` as a devDependency
   for the other integration; the resolution order is that library's, not this
   tool's).
2. Walk 1 → 10 in order, and for each record: the endpoint that fired, the HTTP
   status, **whether a window actually came to the front**, and the file and
   `line:col` it landed on.
3. Trigger 7 needs the page-source meta renamed first, or it will not appear.
4. Triggers 9 and 10 are the two never exercised in any form this run — give them
   the most attention.
