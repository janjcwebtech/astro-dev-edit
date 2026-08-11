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
- **Literal text carrying inline markup** — a heading broken by a `<br>`, a
  sentence with a `<strong>` or a link in it. Inline editing can't serve these
  (it escapes `<`, which would turn the tag into visible punctuation), so a
  click opens a **markup popup** showing the element's source instead. Save
  with the button or Cmd/Ctrl+Enter. Only these inline tags are allowed —
  `<a> <b> <br> <code> <em> <i> <small> <span> <strong> <sub> <sup> <u>` — with
  presentational attributes (`class`, `id`, `title`, `lang`, `dir`, plus
  `href`/`target`/`rel` on links); attributes already in your source are kept
  as they are. Anything else, including unbalanced tags, is refused rather
  than written. Each allowed tag is a **button** under the box: with text
  selected it wraps the selection (and keeps it selected, so tags stack),
  otherwise it drops an empty pair at the caret. `<br>` inserts alone, and
  `<a>` arrives as `<a href="">` with the caret already inside the quotes.
- **Images in `.astro`** — swap a static `src` from the project's images (with
  thumbnails) or upload a new file, and edit `alt`. Only statically-quoted
  attributes are editable; `src={…}` / `<Image>` are treated as dynamic.
- **Content-collection entries** — on a detail page that declares its backing
  `.md`/`.mdx` file, an **Edit entry** drawer edits the frontmatter as typed
  form fields (generated from your own zod schema) plus the markdown body, and
  can create or delete entries. See [Entry editor](#entry-editor-cms-panel-for-content-collections).
- Everything else **refuses safely** with a reason and an "Open source" jump to
  the editor. Expression-driven text (`{title}`), loop-generated content,
  components, `set:html`, and block-level nested markup all fall here — on
  detail pages the refusal notice offers "Edit page content", which opens the
  entry drawer.
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
context) — while the **open** button next to it jumps to the location in your
editor. The refusal notice's location line opens the same peek, so you can
see *why* something refused without leaving the browser. The peek's footer
has its own **Open in editor** jump-out.

### Copy context for an AI assistant

Next to `open` the pill has a **`copy`** button. It puts everything the
overlay knows about that element on your clipboard as one markdown block,
shaped for pasting into an assistant along with what you want changed:

- the element's **source location**, repo-relative (`src/pages/index.astro:12:3`),
  its **editability verdict** with the reason, the **page URL**, its **DOM
  path**, and the page's **content entry** when it declares one;
- the **rendered HTML** of the element (the overlay's own nodes stripped out);
- the **source lines** around it — 30 either side, with `>` marking the
  element's own line — read through the same `/peek` endpoint the source peek
  uses. A location the server won't serve (an `astro:assets` `<Image>`, say)
  says so here instead, and the rest is still copied;
- **the CSS rules that apply to it**, with the stylesheet each came from —
  read from the browser, so only rules matching *this* element are listed, not
  ones it inherits from an ancestor;
- a one-line summary of its **rendered box and type** (display, size, font,
  colors).

The copy is capped — 4 000 characters of HTML and 40 rules — and says in the
payload when a cap applied, so nothing is silently left out. If your browser
refuses clipboard access (reaching the dev server over a network address is not
a secure context, so the API is simply absent) the text opens in a panel,
preselected, to copy by hand.

### CSS inspector

The pill also lists the element's **classes and ID** as chips (turn this off
with `cssInspector: false`). Hover a chip to pop a card of the CSS rules that
element actually matches through that class/ID — selector and declarations,
read straight from the browser, so it works without any server round-trip.
Each rule whose source can be resolved offers an **open** that jumps your
editor to (near) the rule; rules from cross-origin/CDN stylesheets or an inline
`<style>` still show their CSS but have no jump. The jump also honours
`openInEditor`, and reaches `.css` files as well as `.astro` `<style>` blocks
(still confined to `contentRoots`, so `node_modules`/external CSS is excluded).

### The admin bar

Every global control lives in a slim bar across the top of the page:

- **Elements** — show or hide the [element tree](#element-tree), which edit mode
  no longer opens on its own. Asking for it from a cold page turns edit mode on
  with it, since the tree's row highlights only mean anything while editing.
- **Edit page** — the edit-mode toggle.
- **Edit entry** — on pages that declare a backing content file, opens the
  [entry drawer](#entry-editor--cms-panel-for-content-collections).
- **The pin** — lit while the bar is pinned. Unpin it and the bar slides off the
  edge leaving a thin accent line, returning the moment the pointer reaches that
  edge again. **Edit mode overrides it**: while you are editing, the bar stays out
  whether it is pinned or not, since it carries the save state and the way out.
- **The dock button** — moves the bar to the **bottom** of the viewport, for
  sites whose own chrome lives at the top.
- **The purple mark** — the overflow menu (currently *Open page source*, which
  opens the file this page is written in) plus the dev-server status.

The bar **overlays** the page rather than pushing it down: the top edge is where
sticky site headers live, and reflowing the page would change the very layout
you are editing. It stays semi-transparent until the pointer comes near. Pin
state and edge are remembered per browser.

**The exit button is the save indicator.** In edit mode a button appears at the
right end that answers "is my work on disk?" without guessing:

| Button | Meaning |
| --- | --- |
| green **Done** | nothing pending — everything typed is written |
| purple **Save & exit** | an inline edit has unsaved keystrokes |
| grey **Saving…** | the write is in flight |
| green **Saved** | it just landed |
| red **Save failed** | the write was refused and the change rolled back |

Every way out of edit mode goes through it, so leaving **saves first and exits
after the write lands** — no path out silently drops what you typed. Throwing an
edit away stays deliberate: press **Escape** while editing.

### Element tree

A **tree of the page's elements** — every source-annotated element, nested by
structure — docks to the left edge on request. It is **opt-in**: edit mode leaves
it closed and puts a small tab on the left edge, and it opens when you click that
tab or **Elements** on the bar (so entering edit mode never covers the page you
came to edit). It's two-way linked to the page: hovering a row outlines the
matching element (with the same verdict pill and class/ID chips), and hovering an
element on the page highlights its row and scrolls the tree to it.

Clicking a row **selects** the element — a persistent outline that stays put
while you move the mouse onto the element to inspect it. The selection clears
only when you press **Escape**, click elsewhere on the page, or select another
row (plain hovering never changes it). **Double-click** a row to open the editor
for that element, exactly as a page click would. Each row's **`line:col`** is a
jump-out — click it to open that file at that line in your editor (the same
`/open` the hover pill's **open** button uses). The tree collapses per node, rebuilds
itself after each save, and is overlaid by the entry drawer when that's open.
Leaving edit mode hides it. Closing it with its ✕ while still editing leaves the
left-edge tab that brings it back — as does **Elements** on the bar. Whether it
was open is remembered for the session, so a save-triggered reload restores it
the way you left it.

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

Then `npm run dev` and click **Edit page** in the admin bar across the top of
the page.

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
  imageUploadDir: 'src/assets',           // fallback for image() field uploads
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
| `imageUploadDir` | `'src/assets'` | Fallback for uploads backing an [`image()` schema field](#image-fields-are-relative-to-the-entry-file). The mirror-image rule: these assets are *imported* by Astro, so they must be under `src/` — `public/` files can't be imported (a preflight warning fires if it isn't). Only used when the field is empty; otherwise the upload lands in the field's existing asset directory. |
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
an **Edit entry** button is always visible (no need to enter edit mode —
it's a one-click CMS action), and in edit mode clicking any collection-driven
text offers **"Edit page content"**. Both open a drawer that edits the entry
like a CMS would:

- **Frontmatter as typed form fields** — the field list, types, requiredness,
  defaults, and enum options are **introspected from your own
  `content.config.ts` zod schema** (loaded through the dev server, always
  fresh). `z.string()` → text, `z.coerce.date()`/`z.date()` → native date
  picker, `z.number()` → number, `z.boolean()` → checkbox, `z.enum` → select,
  `z.array(z.string())` → tags, and so on. Both zod majors are read: v3 (Astro
  5/6) and v4 (Astro 7, whose `astro/zod` re-exports `zod/v4`). No schema
  resolvable? Field types are inferred from the entry's own values instead (a
  `YYYY-MM-DD` value infers as a date) — the panel always works.
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
(nested objects, unions) render read-only as `json` — including an `image()`
nested inside an object, which is a known gap.

#### `image()` fields are relative to the entry file

A field declared with Astro's `image()` helper doesn't hold a web URL — it holds
a path relative to the markdown file it sits in (`../../assets/blog/hero.png`),
which Astro imports at build time. The drawer detects these from your schema and
treats them accordingly:

- the **preview** resolves the relative value to the path the dev server serves,
  so it renders (a hint under the input names the file it's relative to)
- **Browse…** lists only the importable assets under `src/`, opening scoped to
  the field's own asset directory with a text filter and a "Show all" toggle
- **picking** writes the value back relative to the entry, never as a web path
- **uploads** land in the field's existing asset directory, falling back to
  `imageUploadDir`

Animated GIFs are refused for these fields: Astro optimises `image()` assets,
which flattens the animation. Keep those in `public/` and reference them from a
plain `<img src>` instead.

Fields whose values genuinely *are* web paths — a plain `z.string()`, or any
field forced to the `image` widget via config — keep the original behaviour:
`public/` assets, web-shaped values. The two sets never mix. Full
`astro:assets` metadata (width/height/format) remains out of scope; the field
edits the path.

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
`#atx-bar` (the admin bar) — inside it `atx-bar-group`, `atx-bar-sep`,
`#atx-bar-brand` (the mark that opens the overflow menu), and one
`atx-bar-btn` per control (`atx-bar-btn-icon` when icon-only, with the text in
`atx-bar-btn-label`): `#atx-bar-elements`, `#atx-toggle` (Edit page),
`#atx-entry` (Edit entry), `#atx-bar-pin`, `#atx-bar-edge`, `#atx-bar-exit`
(the save-state exit button) and `#atx-bar-hint` (the "hold … to navigate"
note) — plus `#atx-hairline` (the line an unpinned bar leaves behind) and
`#atx-menu` with `atx-menu-item` / `atx-menu-foot`,
`#atx-tree-tab` (the tab that reopens a closed element tree),
`atx-ico` (every icon — an inline SVG inheriting `currentColor`),
`#atx-outline` (hover highlight),
`#atx-tooltip` (the file:loc pill — its label opens the source peek, the
**open** button jumps to the source in your editor and `atx-tooltip-copy`
copies the element's context; inside it, `atx-tooltip-row`
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
`atx-backdrop`, `atx-drop`, `atx-drawer`, the asset picker's `atx-asset-row`
plus `atx-asset-controls` (filter + scope row), `atx-asset-filter`,
`atx-asset-scope` (the "Show all" toggle) and `atx-asset-count`, the rich body
editor's `atx-rte`, the markup popup's `atx-markup-label` /
`atx-markup-input` / `atx-markup-tags` (the palette row) / `atx-markup-hint` /
`atx-markup-tag` (one per insertable tag), `atx-rte-head` (sticky toolbar + image panel),
`atx-rte-toolbar`, `atx-rte-btn`, `atx-rte-content`, `atx-rte-image-panel`,
the image field's `atx-image-field-preview|thumb|empty|path|hint`, the source
peek's `atx-peek-code` (scroll container), `atx-peek-line` / `atx-peek-focus`
(rows), `atx-peek-gutter`, `atx-peek-text`, and `atx-peek-more` (the
"⋯ N more lines" markers), and the clipboard-fallback panel's `atx-copy-note`
and `atx-copy-text`.

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
/* e.g. keep the admin bar fully opaque, even at rest */
#atx-bar { opacity: 1 !important; }
```

## Scope and limitations

- **Dev only.** Nothing runs in build/preview/production.
- **Localhost only.** All endpoints reject non-localhost requests.
- **Source peek is read-only and confined.** It is the one endpoint that
  returns raw file content to the browser, and it only serves files that are
  already editable (inside `contentRoots`, allowed extension) — the same gate
  as every other route.
- **Content, never structure.** Inline-edited text is escaped so it can't
  introduce a tag, an expression, or an entity. The markup popup deliberately
  lets tags through, but only the inline safelist above, only with
  presentational attributes, and only well-nested — `{` is still neutralised
  there, so no edit of any kind can introduce an expression.
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
