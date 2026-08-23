# astro-dev-edit

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
  with the button or Cmd/Ctrl+Enter; **open** in the title bar jumps to the
  file in your editor without closing the popup. Only these inline tags are allowed —
  `<a> <b> <br> <code> <em> <i> <small> <span> <strong> <sub> <sup> <u>` — with
  presentational attributes (`class`, `id`, `title`, `lang`, `dir`, plus
  `href`/`target`/`rel` on links); attributes already in your source are kept
  as they are. Anything else, including unbalanced tags, is refused rather
  than written — and a refusal is shown **in the popup**, which stays open with
  your markup intact so you can fix it and retry. Each allowed tag is a **button** under the box: with text
  selected it wraps the selection (and keeps it selected, so tags stack),
  otherwise it drops an empty pair at the caret. `<br>` inserts alone, and
  `<a>` arrives as `<a href="">` with the caret already inside the quotes.
- **Text rendered through an `{expression}`** — a frontmatter const
  (`<h1>{title}</h1>`), or one item of an array a `.map()` loops over
  (`{benefits.map((b) => <h3>{b.title}</h3>)}`). Clicking opens a **value
  popup** titled with where the string lives (`benefits[].title`), and the edit
  is written to that string in the frontmatter — the template itself is never
  touched. Its title bar carries the same **open** jump to your editor. Plain text only: `{value}` renders escaped, so tags typed here would
  show as punctuation rather than markup.

  Every card in a loop shares one source location, so **which item you clicked
  is identified by the text on the page**: the item whose value equals what you
  saw is the one patched. Two items reading exactly the same way refuse rather
  than guess, as do computed expressions (`{n + 1}`), template literals with
  `${…}` in them, `.filter().map()` chains, nested access (`{b.meta.label}`),
  and arrays imported from another file.
- **Images in `.astro`** — swap a static `src` from the project's images (with
  thumbnails) or upload a new file, and edit `alt`. Only statically-quoted
  attributes are editable; `src={…}` / `<Image>` are treated as dynamic.
- **Content-collection entries** — on a detail page that declares its backing
  `.md`/`.mdx` file, an **Edit entry** drawer edits the frontmatter as typed
  form fields (generated from your own zod schema) plus the markdown body, and
  can create or delete entries. See [Entry editor](#entry-editor-cms-panel-for-content-collections).
- Everything else **refuses safely** with a reason and an "Open source" jump to
  the editor. Expressions that can't be traced to a string, components,
  `set:html`, and block-level nested markup all fall here — on
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
- **The purple mark** — the overflow menu plus the dev-server status. It holds
  *Open page source*, which opens **the file the page itself is written in** —
  resolved from Astro's own route manifest, so a page that mostly composes
  components opens the page rather than the busiest component, and a URL that
  matches no route says so instead of guessing;
  *Collections*, the [collection and field designer](#collections--the-collection-designer);
  and *Settings*, where [every integration option](#settings-drawer) — including the
  [Unsplash access key](#unsplash-photo-picker) — is editable.

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
npm install --save-dev "github:janjcwebtech/astro-dev-edit"
# or from a local checkout during development:
npm install --save-dev "file:../astro-dev-edit"
```

Add it to `astro.config.mjs`:

```js
import { defineConfig } from 'astro/config';
import devEdit from 'astro-dev-edit';

export default defineConfig({
  integrations: [
    devEdit(),
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
-   **Astro ≥7** — the new Rust compiler accepts Astro's `annotateSourceFile`
    option but doesn't emit the attributes
    ([withastro/compiler-rs#96](https://github.com/withastro/compiler-rs/issues/96)),
    so the integration **injects them itself** via a pre-compiler transform.
    Automatic; the dev toolbar is no longer required for locating elements on 7.

## Options

**You do not have to edit this file.** Every option below is also editable from
the overlay's own **Settings** drawer (admin bar → the purple mark → *Settings*),
which stores your choices in `.astro-dev-edit.json` at the project root and
applies them to the next request — no dev-server restart. Setting an option here
in `astro.config.mjs` still wins: this file is code you wrote deliberately, it is
committed, and it is read by `astro build`. An option set here therefore renders
**read-only** in the drawer, with a note saying where the value came from, rather
than accepting input that resolution would quietly discard.

Precedence, highest first: **`astro.config.mjs` → `.astro-dev-edit.json` → the
defaults below.** See [Settings drawer](#settings-drawer) for the whole picture.

```js
devEdit({
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
  schemaEditor: true,                     // let the designer write content.config.ts
  unsplash: false,                        // Unsplash photo source; {} turns it on
})
```

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | `false` disables the integration entirely. **Config-only** — read before the dev server exists, and storing `false` elsewhere would remove the UI that turns it back on. |
| `assetDirs` | `['src/assets', 'public']` | Dirs scanned for the swap panel's replacement-image list. |
| `uploadDir` | `'public'` | Where new uploads are written. Must be under `public/` — files here become a plain `<img src>`, so a `src/`-relative dir works in dev but 404s in a production build (a preflight warning fires if it isn't web-servable). |
| `imageUploadDir` | `'src/assets'` | Fallback for uploads backing an [`image()` schema field](#image-fields-are-relative-to-the-entry-file). The mirror-image rule: these assets are *imported* by Astro, so they must be under `src/` — `public/` files can't be imported (a preflight warning fires if it isn't). Only used when the field is empty; otherwise the upload lands in the field's existing asset directory. |
| `editableExtensions` | `['.astro', '.md', '.mdx']` | Extensions the patcher is allowed to write. |
| `contentRoots` | `['src', 'public']` | Writes are confined to these (resolved, symlinks included). |
| `openInEditor` | `true` | Expose the "Open source" / jump-to-file behaviour. |
| `cssInspector` | `true` | The hover-pill CSS class/ID inspector. `false` hides the chips row entirely. The per-rule open-in-editor jump also honours `openInEditor`. |
| `sourceAnnotations` | `'auto'` | Who emits the `data-astro-source-*` attributes. `'auto'`: Astro's compiler on 5/6, injected by the integration on ≥7. `'force'`: always inject (also lifts the dev-toolbar requirement on 5/6). `'off'`: never inject. **Config-only** — it registers a Vite plugin, so changing it needs a restart. |
| `entryEditor` | `{}` | The [entry editor](#entry-editor-cms-panel-for-content-collections); `false` disables all `/entry*` endpoints and UI. |
| `schemaEditor` | `true` | Whether the [collection designer](#collections--the-collection-designer) may write your `src/content.config.ts`. `false` keeps the designer read-only for schema edits — collections and fields still list, and the editor-only overrides (widget, label, hidden) still save, because those go to `.astro-dev-edit.json` rather than to committed source. |
| `unsplash` | `false` | The [Unsplash photo source](#unsplash-photo-picker) in the media picker. `{}` turns it on with defaults, or just switch it on in the Settings drawer. Sub-options: `accessKey` (discouraged — see below), `appName` (`'astro-dev-edit'`, sent as `utm_source` on credit links), `perPage` (`20`, capped at Unsplash's own 30). |

Every option except `enabled` and `sourceAnnotations` is editable from the
Settings drawer. Those two are consumed during `astro:config:setup`, before a dev
server exists, so they can only come from this file — the drawer shows them
read-only and says a restart is needed.

### Settings drawer

Opened from the admin bar's overflow menu. Four tabs — **General**, **Editing**,
**Media**, **Unsplash** — each holding one control per option with a line of prose
saying what it does. Saving writes only the options you changed into
`.astro-dev-edit.json`, merging with whatever is already there. Collections are
not settings: they have their own
[drawer](#collections--the-collection-designer), alongside this one in the same
menu.

A few properties worth knowing:

-   **Changes bite immediately**, including the ones that *restrict* the editor.
    Narrowing `contentRoots` takes effect on the very next write attempt, not
    after a restart.
-   **A save is all-or-nothing.** If any option in the patch is unknown,
    config-only, locked, or the wrong shape, the whole save is refused with a
    message against each offending control, and nothing is written.
-   **Turning a feature off keeps its configuration.** Switching the entry editor
    or the Unsplash source off and back on restores its per-collection widget
    overrides and its app name.
-   `.astro-dev-edit.json` **should be gitignored** — it is also where the
    Unsplash access key is stored. The drawer warns when it isn't.

The options the drawer offers come from the server, so it renders whatever your
installed version declares; an option added in a later release appears without
any change to the overlay.

### Collections — the collection designer

**Collections** in the admin bar's overflow menu lists every collection your
content config declares, opens one into its field table, and can append a new one.
It is its own drawer, alongside Settings rather than inside it: an option is a
switch on this tool, while a collection's shape is your own committed source. It is
part of the [entry editor](#entry-editor-cms-panel-for-content-collections)
surface, so `entryEditor: false` removes the menu item along with the drawer. Two
things it does that the rest of the overlay doesn't:

**It writes `src/content.config.ts`.** Adding a field, changing a field's type,
removing one, creating a collection — all of it patches that file, which is
committed TypeScript your build reads. The patch is surgical: only the touched
span changes, so comments, key order and quoting come out exactly as they went in.
Set `schemaEditor: false` to forbid this outright while keeping the rest of the
tool.

**Every field row spans two stores, and the row says which is which:**

| Half | Controls | Written to | Effect |
| --- | --- | --- | --- |
| **Schema** | type, required, default, add, remove | `src/content.config.ts` | Committed. Changes what `astro build` accepts. |
| **Editor** | widget, label, hidden | `.astro-dev-edit.json` | Local, gitignored. Only the entry drawer reads it. |

A save that touches both does one request and tells you which half landed. A
widget or label your `astro.config.mjs` sets renders read-only with a padlock,
for the same reason a config-set option does.

Worth knowing before you use it:

-   **A schema save reloads the page.** Astro resyncs its content layer whenever
    that file changes. The drawer reopens itself in the collection you were
    editing.
-   **A retype your existing entries don't satisfy will fail that sync.** Change
    a field from text to number while entries hold strings and Astro refuses the
    collection until you update them — it names the first offending file. That is
    Astro's own validation doing its job, not a bug in the designer; the fix is to
    update the entries (or change the field back).
-   **Saving a schema change rewrites that field's expression in canonical form.**
    `z.string()`, `z.coerce.date()`, `z.enum([…])`, `z.array(z.string())`,
    `image()`, plus `.optional()` or `.default(…)`. If your field was written some
    other way that means the same thing, the canonical form replaces it.
-   **There is no rename.** A schema key is the frontmatter key in every entry
    file, so renaming it here alone would break the collection. Remove and add
    instead, and update the entries.
-   **Long text is a widget, not a schema type.** Set the schema type to *Text*
    and the widget to *Textarea* — the schema stays `z.string()` and the drawer
    renders the bigger control.
-   **`image()` needs the function schema form.** Only
    `schema: ({ image }) => z.object({ … })` receives Astro's helper, so an image
    field is offered for collections written that way and refused, with that
    explanation, for a plain `z.object({ … })`.
-   **A schema the designer can't prove, it won't touch.** Built by a helper,
    holding a spread, conditional — the row says so and offers *Open source*
    instead of controls.

#### Items

Each collection also has an **Items** view: its entry files, newest first, with a
badge on drafts. This is the way to reach an entry no rendered page links to — a
draft, or one whose route doesn't exist yet. Clicking an item opens the ordinary
entry drawer for it (this drawer hands over rather than stacking); **New
item** opens the ordinary create drawer, built from the collection's schema.
Deleting is still done from the entry drawer, still etag-guarded, and still has no
in-app undo.

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

## Media picker

Anywhere you choose an image — the swap panel, the entry drawer's `image()`
fields, the rich body editor's image panel — the same picker opens: a grid of
your project's images, a filter, a folder scope toggle, and a details rail
showing the selected file's path, size and modified time.

Two things about how it behaves:

- **Newest first by default.** A file you uploaded a minute ago is the first
  thing you see, not something to hunt for alphabetically. Switch the sort to
  **Name** if you prefer.
- **Picking is staged, not applied.** Clicking a tile selects it; the footer's
  **Use image** is what hands it back to the field. **Cancel** or **Escape**
  writes nothing at all — which matters, because this modal can open on top of
  the entry drawer, and closing it must never disturb the fields underneath.

Uploading works from the **Upload file…** button or by dropping a file anywhere
on the modal. Uploads land in `uploadDir` — or, for an `image()` field, beside
the field's existing asset.

The swap panel keeps a shortcut for the common case: a preview of the image you
are editing, and a strip of the **six most recently added** images, with
**Browse all** opening the full picker.

## Unsplash photo picker

Off by default. Turn it on with `unsplash: {}` and the picker grows a second
source: search Unsplash from inside the overlay, pick a photo, and the dev
server **downloads it into your project** like any other upload.

```js
devEdit({ unsplash: {} })
```

The photo is a normal file in your repo afterwards. Nothing but the local path
is written into your source, so your published site never depends on Unsplash
being up — and an `image()` field can use it, which a remote URL cannot.

### Your access key

Every user brings their own, from
[unsplash.com/oauth/applications](https://unsplash.com/oauth/applications). The
demo tier allows **50 API requests an hour** until Unsplash approves your
application for production (then 1000). Resolution order, highest first:

| Where | Notes |
| --- | --- |
| `unsplash.accessKey` in `astro.config.mjs` | An escape hatch for programmatic config, **not recommended**: that file is committed *and* is read by `astro build`, so the key travels with the repo. |
| `UNSPLASH_ACCESS_KEY` in the environment | For teams and CI. Read through Vite's own env loader, so a `.env` file works — note that `astro dev` does **not** copy `.env` into `process.env` itself. |
| The **Settings** drawer (admin bar → the purple mark → *Settings* → *Unsplash*) | The recommended path. Writes `.astro-dev-edit.json` at your project root, `0600`. |

**Gitignore `.astro-dev-edit.json` and your `.env`.** The Settings panel warns
if the first isn't covered, but this integration cannot edit your ignore rules
for you. The key is never sent back to the browser: a read reports only whether
one resolved, from where, and a masked fragment like `••••••••Ab3d`. When a key
comes from the config or the environment the panel's field is disabled and says
so, rather than accepting a value that would be ignored.

### Attribution

Handled for you, because the API guidelines require it: every photographer is
credited in the grid and in the details rail, linked to their profile with the
`utm_source`/`utm_medium` parameters attached **server-side** (so the client
cannot forget them), and each import pings Unsplash's download endpoint. Set
`appName` to the application name you registered, which is what `utm_source`
carries.

### Staying inside the rate limit

Searches are debounced, paging is a **Load more** button rather than infinite
scroll, and an identical search is served from a 5-minute server-side cache. Only
JSON calls count against the limit — the thumbnails in the grid are free — and
the requests you have left this hour are shown at the foot of the details rail.

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
devEdit({
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
      name="astro-dev-edit:page-source"
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
editor's `atx-rte`, `atx-panel-title` (with `atx-panel-heading` and, on the
source popups, the `atx-panel-open` jump-to-editor button),
the source popups' shared `atx-popup-label` /
`atx-popup-input` / `atx-popup-error` plus the markup palette's
`atx-markup-tags` (the row) / `atx-markup-hint` / `atx-markup-tag` (one per
insertable tag), `atx-rte-head` (sticky toolbar + image panel),
`atx-rte-toolbar`, `atx-rte-btn`, `atx-rte-content`, `atx-rte-image-panel`,
the image field's `atx-image-field-preview|thumb|empty|path|hint`,
the media picker's `atx-media-*` — `atx-media-tabs` / `atx-media-tab`
(one per source, `atx-media-tab-project` / `-unsplash`), `atx-media-toolbars`
/ `atx-media-toolbar`, `atx-media-sort`, `atx-media-upload`, `atx-media-panes`,
`atx-media-pane` (the grid's scroller), `atx-media-grid`, `atx-media-tile`
wrapping `atx-media-pick` (the button) with `atx-media-thumb`,
`atx-media-fallback`, `atx-media-check` (selection badge) and
`atx-media-current` (the "Current" chip) inside it, `atx-media-cap` (the
caption, a *sibling* of the button), `atx-media-rail` with
`atx-media-rail-preview|img|title|line|key|value|empty`, `atx-media-status`,
`atx-media-more` (the Load more footer), `atx-media-drop` /
`atx-media-dropzone` (the drag overlay) and `atx-media-error`;
the Unsplash pane's `atx-unsplash-search` / `atx-unsplash-input` /
`atx-unsplash-orient`, `atx-unsplash-credit` with `atx-unsplash-author` and
`atx-unsplash-link`, and `atx-unsplash-rate` (the requests-left line);
the settings drawer's `atx-settings-tabs`, `atx-settings-tab` (plus `atx-settings-tab-<group>`), `atx-settings-tabs-host`, `atx-settings-pane` (plus `atx-settings-pane-<group>`), `atx-settings-lock`, `atx-settings-key-section`, `atx-settings-key-status`, `atx-settings-key-actions`, and the older `atx-settings-heading|blurb|link|status|text|row|key|hint|warning|error`; each option control is a standard `atx-field` (with `atx-field-label`, `atx-field-input`, `atx-field-help`, `atx-field-error`), the same hooks the entry drawer uses;
the collection designer's `atx-collections` (the pane) with `atx-collections-list` / `atx-collections-row` (plus `atx-collections-row-<name>`) / `atx-collections-row-name|meta`, `atx-collections-detail` (plus `atx-collections-detail-<name>`), `atx-collections-head|title|back|meta|spacer|badge|blurb|note|legend` (`atx-collections-legend-line|word`), `atx-collections-view-tabs` / `atx-collections-view-tab` (`-fields` / `-items`) / `atx-collections-view-host`, `atx-collections-fieldspane`, `atx-collections-fields`, `atx-collections-field` (plus `atx-collections-field-<name>`) with `atx-collections-field-head|name`, `atx-collections-group` (plus `atx-collections-group-schema` / `-editor`), `atx-collections-caption`, `atx-collections-control` / `atx-collections-control-label`, `atx-collections-input|select|checkbox|check|check-hint`, `atx-collections-expr` (the zod expression line), `atx-collections-new` / `atx-collections-new-name|meta` (a queued addition), `atx-collections-addfield`, `atx-collections-pending`, `atx-collections-actions`, `atx-collections-error`, `atx-collections-create` / `atx-collections-newfields`, and the Items view's `atx-collections-items`, `atx-collections-itembar|itemcount`, `atx-collections-item` / `atx-collections-item-title|meta`;
the swap panel's `atx-image-preview` / `atx-image-preview-img` /
`atx-image-meta` and its `atx-image-recents` strip
(`atx-image-recents-label|title`, `atx-image-recent`, `atx-image-recent-thumb`,
`atx-image-browse-all`), the source
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

That protection is per element, not per subtree: an inline colour on a panel
does not shield a child that takes its colour by inheritance, because an
ordinary `p { color: … }` or `label { … }` rule on your page outranks an
inherited value. Every piece of text in the overlay therefore sets its own
colour, so styling elements by tag on your site cannot repaint it. If you
*want* to re-colour the overlay, target the `atx-*` hooks above with
`!important` rather than element selectors.

Overlay text is picked to clear **WCAG AA** contrast (4.5:1) against the
surface it sits on, and control borders the 3:1 that applies to a control's
boundary; `tests/contrast.test.ts` holds those tokens to it. If you re-theme
the panels, note that a lighter panel background will need darker inks to keep
that.

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
- **Expression-driven text is edited in a popup, not in place**, and only when
  it traces to a plain string in the same file's frontmatter (see above).
  Anything else still refuses; on detail pages those clicks route to the entry
  drawer, elsewhere to "Open source".
- **The rich body editor covers a markdown subset** — headings, emphasis,
  lists, quotes, code, links, images, hr. Anything beyond it (tables, raw
  HTML/MDX, footnotes, nested lists) is still editable, but as markdown
  source. No `astro:assets` `image()` metadata (path strings only).
- **The collection designer only reads the schema shapes it can prove** —
  `schema: z.object({ … })` and `schema: ({ image }) => z.object({ … })`, with a
  plain `name: value` field list. A schema built by a helper, holding a spread, or
  assembled conditionally is reported unreadable and offers *Open source*; it is
  never guessed at. Collection and field names must be plain identifiers, and a
  new collection's directory is confined to `contentRoots` like any other write.
- **Astro 5.x–7.x.** On 5/6 Astro's compiler provides the source annotations
  (dev toolbar required, above); on ≥7 the integration injects them itself,
  since the Rust compiler no longer emits them
  ([withastro/compiler-rs#96](https://github.com/withastro/compiler-rs/issues/96)).
- **Unsplash is the only photo source**, and only its free tier. Unsplash+ is a
  consumer subscription with no API surface, so premium content cannot be
  offered by a package many people install.
- **An Unsplash photo id is only importable while the dev server that searched
  for it is running.** The server keeps the download URLs in memory rather than
  letting the browser supply them — the browser can name a photo but cannot
  point the dev server at an arbitrary host. After a restart an import answers
  "search again" instead.
- **A strict `img-src` CSP on your dev page blocks the Unsplash thumbnails.**
  The grid stays usable — credits still read and photos still import — but the
  tiles show a placeholder.

## How it works (short version)

Astro emits `data-astro-source-file` / `-loc` attributes in dev, but the dev
toolbar strips them from the live DOM shortly after hydration. A
`MutationObserver` snapshots each element's location into a private JS property
the instant it appears, winning the race. On click, the client asks the dev
server to classify the target from the **`.astro` source AST** (the DOM can't
tell a resolved `{expression}` from literal text), and only literal text / static
image attributes are offered for editing. Saves POST to a localhost-only
endpoint that re-resolves the element, verifies the source still matches, and
writes atomically. "Which file is this whole *page*?" is a different question
with a different answer: only elements are annotated, never component tags, so
the DOM cannot be counted for it — that one comes from Astro's route manifest
(`astro:routes:resolved`), matched the way Astro matches a request.

## Credits

The technique of snapshotting Astro's `data-astro-source-*` attributes into a
private JS property the instant they appear — before the dev-toolbar runtime
strips them from the live DOM — is borrowed from
[`astro-click-to-source`](https://www.npmjs.com/package/astro-click-to-source)
by **invisible1988** (MIT). Thanks to that project for the approach.

## License

MIT
