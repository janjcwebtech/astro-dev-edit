# astro-text-edit

In-browser visual content editing for the Astro **dev server**. Turn on edit
mode, click text or an image in the rendered page, and the change is written
straight to the source file. Astro's HMR refreshes the preview. Need to move
to another page while editing? Hold **Ctrl** (or **⌥ Option** on macOS) and
clicks navigate normally — release to keep editing, no mode toggling.

**Dev-only by design.** The integration registers nothing for `astro build` /
`astro preview`, so it can never reach a production bundle. It ships TypeScript
source; your Astro project compiles it like any other `.ts`.


https://github.com/user-attachments/assets/ac4a1864-daec-4ab6-b7e5-5ee0839f5356


## What it can edit

- **Literal text in `.astro` templates** — an element whose children are only
  plain text. Click → inline edit → Enter/blur to save, Esc to cancel.
- **Images in `.astro`** — swap a static `src` from the project's images (with
  thumbnails) or upload a new file, and edit `alt`. Only statically-quoted
  attributes are editable; `src={…}` / `<Image>` are treated as dynamic.
- **Content-collection entries** — on a detail page that declares its backing
  `.md`/`.mdx` file, an **Edit entry** drawer edits the frontmatter as typed
  form fields (generated from your own zod schema) plus the markdown body, and
  can create or delete entries. See [Entry editor](#entry-editor-cms-panel-for-content-collections).
- Everything else **refuses safely** with a reason and an "Open source" jump to
  the editor. Expression-driven text (`{title}`), loop-generated content,
  components, `set:html`, and nested markup all fall here — on detail pages the
  refusal notice offers "Edit page content", which opens the entry drawer.
- **Package-rendered elements** refuse the same quiet way. Astro's
  `astro:assets` `<Image>` renders through
  `node_modules/astro/components/Image.astro`, and that is the path its source
  annotation carries — so those elements report "rendered by a package
  component" rather than pointing at your file. Edit the `<Image>` usage in
  your own component instead. Package paths are never writable: `contentRoots`
  does not include `node_modules`, and widening it is not a supported fix.

In edit mode, hovering an element outlines it and shows a `file:line:col`
pill. The pill starts neutral (grey `loading…`, no editability claim); once
the pointer rests on one element for a moment, the source AST is consulted
and the pill colors up to the verdict a click would get — **editable**,
**image**, or **dynamic**. Verdicts are remembered until the file next
changes, so known elements show theirs instantly.

Clicking the pill's `file:loc` label opens a **source peek** — a wide
read-only panel showing the whole file syntax-highlighted, with line numbers,
scrolled to the element's line (highlighted and centered; scroll for full
context) — while the "open ↗" button next to it jumps to the location in your
editor. The refusal notice's location line opens the same peek, so you can
see *why* something refused without leaving the browser. The peek's footer
has its own **Open in editor** jump-out.

### CSS inspector

The pill also lists the element's **classes and ID** as chips (turn this off
with `cssInspector: false`). Hover a chip to pop a card of the CSS rules that
element actually matches through that class/ID — selector and declarations,
read straight from the browser, so it works without any server round-trip.
Each rule whose source can be resolved offers an **open ↗** that jumps your
editor to (near) the rule; rules from cross-origin/CDN stylesheets or an inline
`<style>` still show their CSS but have no jump. The jump also honours
`openInEditor`, and reaches `.css` files as well as `.astro` `<style>` blocks
(still confined to `contentRoots`, so `node_modules`/external CSS is excluded).

### Element tree

Turning on edit mode also docks a **tree of the page's elements** to the left
edge — every source-annotated element, nested by structure. It's two-way linked
to the page: hovering a row outlines the matching element (with the same verdict
pill and class/ID chips), and hovering an element on the page highlights its row
and scrolls the tree to it.

Clicking a row **selects** the element — a persistent outline that stays put
while you move the mouse onto the element to inspect it. The selection clears
only when you press **Escape**, click elsewhere on the page, or select another
row (plain hovering never changes it). **Double-click** a row to open the editor
for that element, exactly as a page click would. Each row's **`line:col`** is a
jump-out — click it to open that file at that line in your editor (the same
`/open` the hover pill's "open ↗" uses). The tree collapses per node, rebuilds
itself after each save, and is overlaid by the entry drawer when that's open.
Leaving edit mode hides it.

## Install

Install from git (shipping TypeScript source — no build step):

```bash
npm install --save-dev "github:janjcwebtech/astro-text-edit"
# or from a local checkout during development:
npm install --save-dev "file:../astro-text-edit"
```

Add it to `astro.config.mjs`:

```js
import { defineConfig } from 'astro/config';
import textEdit from 'astro-text-edit';

export default defineConfig({
  integrations: [
    textEdit(),
  ],
});
```

Then `npm run dev` and click **Edit** (bottom-right of the page).

### Where the source locations come from

The feature depends on `data-astro-source-*` attributes on every element:

-   **Astro 5/6** — Astro's own compiler emits them, but only when the **dev
    toolbar is enabled**. With it off, the integration finds nothing to edit
    and logs a preflight warning. Keep `devToolbar.enabled` on in dev (or set
    `sourceAnnotations: 'force'`).
-   **Astro ≥7** — the new Rust compiler doesn't emit them at all
    ([details](docs/ASTRO-COMPAT.md)), so the integration **injects them
    itself** via a pre-compiler transform. Automatic; the dev toolbar is no
    longer required for locating elements on 7.

## Options

```js
textEdit({
  enabled: true,                          // kill switch
  assetDirs: ['src/assets', 'public'],    // scanned for swappable images
  uploadDir: 'public',                    // where new uploads are written
  editableExtensions: ['.astro', '.md', '.mdx'],
  contentRoots: ['src', 'public'],        // writes confined to these
  openInEditor: true,                     // expose "Open source" / jump-to-file
  cssInspector: true,                     // hover-pill class/ID CSS inspector
  sourceAnnotations: 'auto',              // who emits data-astro-source-*
  entryEditor: {},                        // CMS entry drawer; false disables it
})
```

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | `false` disables the integration entirely. |
| `assetDirs` | `['src/assets', 'public']` | Dirs scanned for the swap panel's replacement-image list. |
| `uploadDir` | `'public'` | Where new uploads are written. Must be under `public/` — files here become a plain `<img src>`, so a `src/`-relative dir works in dev but 404s in a production build (a preflight warning fires if it isn't web-servable). |
| `editableExtensions` | `['.astro', '.md', '.mdx']` | Extensions the patcher is allowed to write. |
| `contentRoots` | `['src', 'public']` | Writes are confined to these (resolved, symlinks included). |
| `openInEditor` | `true` | Expose the "Open source" / jump-to-file behaviour. |
| `cssInspector` | `true` | The hover-pill CSS class/ID inspector. `false` hides the chips row entirely. The per-rule open-in-editor jump also honours `openInEditor`. |
| `sourceAnnotations` | `'auto'` | Who emits the `data-astro-source-*` attributes. `'auto'`: Astro's compiler on 5/6, injected by the integration on ≥7. `'force'`: always inject (also lifts the dev-toolbar requirement on 5/6). `'off'`: never inject. |
| `entryEditor` | `{}` | The [entry editor](#entry-editor-cms-panel-for-content-collections); `false` disables all `/entry*` endpoints and UI. |

## Undo is git — there is no in-app undo

**Every save writes the source file on disk immediately.** There is no undo
button, no history, no confirmation-to-commit. The safety model is your **git
working tree**:

- Before an editing session, make sure your working tree is clean (or
  committed), so `git diff` shows exactly what changed.
- To undo an edit, `git checkout <file>` (or use your editor's local history).
- Writes are **atomic** (temp file + rename) and **verified** — the server
  confirms the source still matches what the page showed before writing, so a
  stale click fails safe rather than corrupting the file. But once a write
  succeeds, reverting it is a git operation, not an app feature.

Treat it like editing the files directly, because that is what it does.

## Entry editor — CMS panel for content collections

On a detail page that declares its backing content file (the meta tag below),
an **✎ Edit entry** button is always visible (no need to enter edit mode —
it's a one-click CMS action), and in edit mode clicking any collection-driven
text offers **"Edit page content"**. Both open a drawer that edits the entry
like a CMS would:

- **Frontmatter as typed form fields** — the field list, types, requiredness,
  defaults, and enum options are **introspected from your own
  `content.config.ts` zod schema** (loaded through the dev server, always
  fresh). `z.string()` → text, `z.coerce.date()`/`z.date()` → native date
  picker, `z.number()` → number, `z.boolean()` → checkbox, `z.enum` → select,
  `z.array(z.string())` → tags, and so on. No schema resolvable? Field types
  are inferred from the entry's own values instead (a `YYYY-MM-DD` value infers
  as a date) — the panel always works.
- **Markdown body in a WYSIWYG editor** — a white writing surface with a
  sticky formatting toolbar: bold / italic / strikethrough, heading levels
  (H1–H6 dropdown), bulleted and numbered lists, quote, code block, inline
  code, links, and image insert (upload, browse existing assets, or type a
  path) with an alt-text field auto-suggested from the file name. Clicking an
  image inside the body reopens the same panel to replace it. The **MD** button flips to raw-markdown source; bodies using markdown
  the rich view can't represent losslessly (tables, raw HTML/MDX, footnotes,
  nested lists, indented code) open in source mode, and the switch back to
  rich is refused rather than performed lossily. The body is only rewritten
  when you actually change it — opening the drawer never reformats the file.
- **Atomic, surgical saves** — one request writes everything at once. The YAML
  is patched in place: comments, key order, quoting, and keys you didn't touch
  survive byte-for-byte. Changed values are validated against your zod schema
  *before* the write (inline per-field errors), and every write is etag-guarded
  — if the file changed on disk since the panel opened, you get a conflict and
  a fresh reload instead of a lost update.
- **Create** (the `+ New` button — slug auto-suggested from the title, schema
  defaults honoured, never overwrites) and **Delete** (confirmed; undo is git).
  New entries take the collection's file extension: the per-collection
  `extension` config wins; otherwise, when every existing entry shares one
  extension the new entry follows it (an all-`.mdx` collection gets `.mdx`),
  and mixed or empty collections fall back to `.md`.

### Setup per project

1. Add the integration (above).
2. Emit the meta tag from your detail-page layout (below).
3. Optional: tune fields via `entryEditor` config.

The file→collection mapping follows the `src/content/<name>/` convention.
Unconventional layouts and field tweaks go in the options:

```js
textEdit({
  entryEditor: {
    // configPath: 'src/content.config.ts',      // auto-detected normally
    collections: {
      blog: {
        // dir: 'content/posts',                 // if not src/content/blog
        // extension: '.mdx',                    // for new entries; default: inferred (see below)
        fields: {
          excerpt: { widget: 'textarea' },
          image: { widget: 'image' },            // asset picker + upload
          internalId: { hidden: true },
        },
      },
    },
  },
})
```

Widgets: `text`, `textarea`, `date`, `number`, `boolean`, `select`, `tags`,
`image`, `json` (read-only). Fields whose zod shape the panel can't edit
(nested objects, unions) render read-only as `json`. Schema functions using
`image()` helpers are handled best-effort: the image field edits the path
string; full `astro:assets` metadata is out of scope.

### The page-source meta tag

**Opt in per detail-page layout** by emitting one **dev-only** meta tag into
`<head>`:

```astro
---
import type { CollectionEntry } from 'astro:content';
const { entry } = Astro.props as { entry: CollectionEntry<'posts'> };
---
<head>
  {import.meta.env.DEV && (
    <meta
      name="astro-text-edit:page-source"
      content={entry.filePath}
    />
  )}
</head>
```

Rules of the contract:

- **`content` must be the repo-relative path** to the file whose copy backs the
  page. For glob-loader content collections that's `entry.filePath`
  (e.g. `src/content/posts/my-post.mdx`). For other data sources, supply the
  equivalent path yourself.
- **Gate it on `import.meta.env.DEV`** so it never ships to production.
- **Emit it only on detail pages** — routes that render *one* entry. Archive /
  listing routes render a *set* of entries with no single backing file; leave
  the meta off and they correctly fall back to plain "Open source".
- Nothing auto-detects detail pages. The meta tag **is** the opt-in — if it's
  absent, the entry button simply doesn't appear. If your layout renders inside
  a wrapper layout, make sure the meta ends up in the document `<head>` (e.g.
  via a named `head` slot).
- Entries must live under a configured `contentRoots` dir (default `src`).

After a create the browser navigates to the sibling URL (`/articles/<new-slug>`
by convention), polling it first until Astro's content layer has synced the
new file (up to ~10s) so you land on the rendered page, not a 404; after a
delete, to the parent listing. Projects with non-conventional detail routes
still get the file written/removed — only the navigation guess differs.

## Styling the overlay

Every overlay element carries a stable class, and the singletons carry IDs:
`#atx-controls` (the fixed bottom-right group holding the buttons),
`#atx-toggle` (the Edit button), `#atx-entry` (the Edit entry button),
`#atx-hide` (the ✕ shown on hover that hides the group until reload),
`#atx-toggle-hint` (the "hold … to navigate" note under the buttons),
`#atx-outline` (hover highlight),
`#atx-tooltip` (the file:loc pill — its label opens the source peek, the
"open ↗" button jumps to the source in your editor; inside it, `atx-tooltip-row`
is the loc/verdict line, with `atx-tooltip-loc` holding
the location and `atx-tooltip-verdict` the fixed-width verdict slot, and
`atx-tooltip-chips` / `atx-tooltip-chip` the CSS-inspector class/ID chips row;
hovering a chip shows the rules card `atx-tooltip-rules` — `atx-tooltip-rule`
per rule, with `-sel`, `-decl`, `-foot`, `-src`, `-open` inside it, and
`atx-tooltip-rules-empty` when nothing applies),
the element tree `atx-tree` (the left panel) — `atx-tree-title` / `-text` /
`atx-tree-close` (header), `atx-tree-body` (scroll container), `atx-tree-row`
with `atx-tree-chevron`, `-tag`, `-preview`, `-loc` inside it, `atx-tree-empty`,
and `atx-tree-selection` (the locked-selection outline) — plus
classes like `atx-panel`,
`atx-panel-body`, `atx-btn atx-btn-primary|secondary|cancel`, `atx-toast`,
`atx-backdrop`, `atx-drop`, `atx-asset-row`, `atx-drawer`, the rich body
editor's `atx-rte`, `atx-rte-head` (sticky toolbar + image panel),
`atx-rte-toolbar`, `atx-rte-btn`, `atx-rte-content`, `atx-rte-image-panel`,
the image field's `atx-image-field-preview|thumb|empty|path`, and the source
peek's `atx-peek-code` (scroll container), `atx-peek-line` / `atx-peek-focus`
(rows), `atx-peek-gutter`, `atx-peek-text`, and `atx-peek-more` (the
"⋯ N more lines" markers).

One exception to the inline-styles rule: the rich editor's *content* elements
(headings, lists, quotes… that you create while typing) are styled by a small
injected stylesheet, `#atx-rte-style`, scoped under `.atx-rte-content`. Those
rules are ordinary CSS, so overriding them needs specificity, not
`!important`.

### Sites with smooth scrolling

Smooth-scroll libraries (Lenis, Locomotive, GSAP ScrollSmoother) listen for
`wheel` on `window` and `preventDefault()` it, driving the page from their own
animation loop — which normally stops any nested container from scrolling, so
the page slides around underneath an open panel instead. Every scrollable
surface in the overlay (source peek, drawer and panel bodies, the asset list,
the rich body editor) opts out of that: it sets `overscroll-behavior: contain`,
carries the `data-lenis-prevent` / `data-scroll-ignore` attributes those
libraries look for, and stops `wheel`/`touchmove` from reaching window-level
listeners. Nothing calls `preventDefault`, so normal page scrolling outside the
overlay is unaffected. No configuration needed; if you use a smooth-scroll
library with a different opt-out convention, adding its attribute to
`.atx-peek-code` (and the other surfaces above) from your own CSS/JS is enough.

Form controls declare `color-scheme: dark`, so the browser renders native
chrome — the date field's calendar-picker icon and popup, number-input
spinners — in light colours that stay visible against the dark inputs. If you
re-theme the inputs to a light background, override this to `light !important`
so those native controls flip back.

Use them to reference elements from devtools or to override styling. The
baseline styles are **inline** on purpose — they win specificity against any
host-page CSS so the overlay renders correctly on every site — which means
your overrides need `!important`:

```css
/* e.g. move the edit buttons above a cookie banner */
#atx-controls { bottom: 120px !important; }
```

## Scope and limitations

- **Dev only.** Nothing runs in build/preview/production.
- **Localhost only.** All endpoints reject non-localhost requests.
- **Source peek is read-only and confined.** It is the one endpoint that
  returns raw file content to the browser, and it only serves files that are
  already editable (inside `contentRoots`, allowed extension) — the same gate
  as every other route.
- **Content, never structure.** Inserted text is escaped so it can't introduce a
  tag, an expression, or an entity — edits change words, never behaviour.
- **No in-place (click-on-the-page) editing of expression-driven text.** On
  detail pages those clicks route to the entry drawer; elsewhere they refuse
  with "Open source" as the escape hatch.
- **The rich body editor covers a markdown subset** — headings, emphasis,
  lists, quotes, code, links, images, hr. Anything beyond it (tables, raw
  HTML/MDX, footnotes, nested lists) is still editable, but as markdown
  source. No `astro:assets` `image()` metadata (path strings only).
- **Astro 5.x–7.x.** On 5/6 Astro's compiler provides the source annotations
  (dev toolbar required, above); on ≥7 the integration injects them itself,
  since the Rust compiler no longer emits them. See
  [docs/ASTRO-COMPAT.md](docs/ASTRO-COMPAT.md).

## How it works (short version)

Astro emits `data-astro-source-file` / `-loc` attributes in dev, but the dev
toolbar strips them from the live DOM shortly after hydration. A
`MutationObserver` snapshots each element's location into a private JS property
the instant it appears, winning the race. On click, the client asks the dev
server to classify the target from the **`.astro` source AST** (the DOM can't
tell a resolved `{expression}` from literal text), and only literal text / static
image attributes are offered for editing. Saves POST to a localhost-only
endpoint that re-resolves the element, verifies the source still matches, and
writes atomically.

## Credits

The technique of snapshotting Astro's `data-astro-source-*` attributes into a
private JS property the instant they appear — before the dev-toolbar runtime
strips them from the live DOM — is borrowed from
[`astro-click-to-source`](https://www.npmjs.com/package/astro-click-to-source)
by **invisible1988** (MIT). Thanks to that project for the approach.

## License

MIT
