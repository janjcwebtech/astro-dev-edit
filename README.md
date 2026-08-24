# astro-dev-edit

In-browser visual content editing for the Astro **dev server**. Turn on edit
mode, click text or an image in the rendered page, and the change is written
straight to the source file. Astro's HMR refreshes the preview. Need to move
to another page while editing? Hold **Ctrl** (or **⌥ Option** on macOS) and
clicks navigate normally — release to keep editing, no mode toggling.

**Development-focused by design.** The integration registers nothing for
`astro build` / `astro preview`, so it can never reach a production bundle. It
ships TypeScript source; your Astro project compiles it like any other `.ts`.


https://github.com/user-attachments/assets/ac4a1864-daec-4ab6-b7e5-5ee0839f5356


## What it can edit

- **Literal text in `.astro` templates** — click, edit inline, Enter to save.
- **Text carrying inline markup** — a heading broken by a `<br>`, a sentence
  with a `<strong>` in it. Opens a popup over a safelist of inline tags.
- **Text rendered through an `{expression}`** — a frontmatter const, or one
  item of an array a `.map()` loops over. The edit goes to the string in the
  frontmatter; the template itself is never touched.
- **Images in `.astro`** — swap a static `src` from your project's images or
  upload a new one, and edit `alt`.
- **Content-collection entries** — a CMS drawer over the entry's frontmatter
  and markdown body, with fields generated from your own zod schema.
- **Collection schemas** — a designer that patches your `content.config.ts`.

**Everything else refuses safely**, with a reason and a jump to the source.
Components, `set:html`, block-level nested markup, expressions that can't be
traced to a string, and anything rendered by a package all land there — the
tool never guesses at a write it cannot prove.

📖 **[Editing reference](docs/EDITING.md)** — the full list, plus the hover
pill, source peek, CSS inspector, admin bar, element tree, and the
copy-context-for-an-AI-assistant button.

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
| `imageUploadDir` | `'src/assets'` | Fallback for uploads backing an [`image()` schema field](docs/ENTRY-EDITOR.md#image-fields-are-relative-to-the-entry-file). The mirror-image rule: these assets are *imported* by Astro, so they must be under `src/` — `public/` files can't be imported (a preflight warning fires if it isn't). Only used when the field is empty; otherwise the upload lands in the field's existing asset directory. |
| `editableExtensions` | `['.astro', '.md', '.mdx']` | Extensions the patcher is allowed to write. |
| `contentRoots` | `['src', 'public']` | Writes are confined to these (resolved, symlinks included). |
| `openInEditor` | `true` | Expose the "Open source" / jump-to-file behaviour. |
| `cssInspector` | `true` | The hover-pill CSS class/ID inspector. `false` hides the chips row entirely. The per-rule open-in-editor jump also honours `openInEditor`. |
| `sourceAnnotations` | `'auto'` | Who emits the `data-astro-source-*` attributes. `'auto'`: Astro's compiler on 5/6, injected by the integration on ≥7. `'force'`: always inject (also lifts the dev-toolbar requirement on 5/6). `'off'`: never inject. **Config-only** — it registers a Vite plugin, so changing it needs a restart. |
| `entryEditor` | `{}` | The [entry editor](docs/ENTRY-EDITOR.md); `false` disables all `/entry*` endpoints and UI. |
| `schemaEditor` | `true` | Whether the [collection designer](docs/ENTRY-EDITOR.md#collections--the-collection-designer) may write your `src/content.config.ts`. `false` keeps the designer read-only for schema edits — collections and fields still list, and the editor-only overrides (widget, label, hidden) still save, because those go to `.astro-dev-edit.json` rather than to committed source. |
| `unsplash` | `false` | The [Unsplash photo source](docs/MEDIA.md#unsplash-photo-picker) in the media picker. `{}` turns it on with defaults, or just switch it on in the Settings drawer. Sub-options: `accessKey` (discouraged — see [the docs](docs/MEDIA.md#your-access-key)), `appName` (`'astro-dev-edit'`, sent as `utm_source` on credit links), `perPage` (`20`, capped at Unsplash's own 30), `importWidth` (`2400`; one of `800`, `1600`, `2400`, `'original'` — see [Import size](docs/MEDIA.md#import-size)). |

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
[drawer](docs/ENTRY-EDITOR.md#collections--the-collection-designer), alongside this one in the same
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


## Entry editor — CMS for content collections

On a detail page that declares its backing content file, an **Edit entry**
button opens a drawer that edits the entry the way a CMS would: **frontmatter
as typed form fields**, generated from your own `content.config.ts` zod schema,
plus the **markdown body in a WYSIWYG editor**. Saves are atomic, surgical
(comments, key order and quoting survive byte-for-byte), validated against the
schema before writing, and etag-guarded against a lost update. Entries can be
created and deleted from the same drawer.

Alongside it, a **collection designer** lists every collection you declare and
edits their **schemas** — adding, retyping and removing fields patches your
`content.config.ts` directly. It refuses anything it cannot prove rather than
guessing, and `schemaEditor: false` forbids the schema half outright.

Both need one opt-in: a dev-only `<meta name="astro-dev-edit:page-source">`
tag naming the file that backs the page.

📖 **[Entry editor and collection designer](docs/ENTRY-EDITOR.md)** — the meta
tag contract, per-collection config, widgets, `image()` field handling, and
what the designer will and won't touch.

## Media picker and Unsplash

Anywhere you choose an image — the swap panel, the entry drawer's `image()`
fields, the rich body editor — the same picker opens: a grid of your project's
images newest-first, a filter, a folder scope toggle, and a details rail.
Picking is staged (Cancel or Escape writes nothing at all), and the whole modal
is a drop target for uploads.

**Unsplash is an optional second source**, off unless you turn it on with
`unsplash: {}` and supply your own access key. Search from inside the overlay
and the dev server downloads the chosen photo into your project like any other
upload — nothing but the local path is written to your source, so your
published site never depends on Unsplash being up. Imports are fetched at a
width you choose (`importWidth`, or the size select in the picker), and
attribution is handled server-side as the API guidelines require.

📖 **[Media picker and Unsplash](docs/MEDIA.md)** — upload targets, access-key
resolution and storage, import sizes, attribution, and staying inside the rate
limit.

## Styling the overlay

Every overlay element carries a stable `atx-` class and the singletons carry
IDs, so you can reference them from devtools or restyle them. The baseline
styles are **inline** on purpose — they win specificity against any host-page
CSS so the overlay renders correctly on every site — which means your
overrides need `!important`:

```css
/* e.g. keep the admin bar fully opaque, even at rest */
#atx-bar { opacity: 1 !important; }
```

📖 **[Styling reference](docs/STYLING.md)** — the full hook list by surface,
the inheritance caveat, smooth-scroll compatibility, and the contrast tokens.

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


## Documentation

| Doc | What's in it |
| --- | --- |
| [Editing reference](docs/EDITING.md) | Everything the overlay can edit, and every surface it draws |
| [Entry editor and collection designer](docs/ENTRY-EDITOR.md) | The CMS drawer, the meta tag, schema editing |
| [Media picker and Unsplash](docs/MEDIA.md) | Choosing, uploading and importing images |
| [Styling reference](docs/STYLING.md) | The `atx-*` hooks and how to override them |
| [Changelog](CHANGELOG.md) | What changed, release by release |

## Credits

The technique of snapshotting Astro's `data-astro-source-*` attributes into a
private JS property the instant they appear — before the dev-toolbar runtime
strips them from the live DOM — is borrowed from
[`astro-click-to-source`](https://www.npmjs.com/package/astro-click-to-source)
by **invisible1988** (MIT). Thanks to that project for the approach.

## License

MIT
