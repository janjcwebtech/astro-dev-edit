# astro-text-edit

In-browser visual content editing for the Astro **dev server**. Turn on edit
mode, click text or an image in the rendered page, and the change is written
straight to the source file. Astro's HMR refreshes the preview.

**Dev-only by design.** The integration registers nothing for `astro build` /
`astro preview`, so it can never reach a production bundle. It ships TypeScript
source; your Astro project compiles it like any other `.ts`.

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

### Requires the dev toolbar

The feature depends on `data-astro-source-*` attributes, which Astro only emits
when the **dev toolbar is enabled**. With it off, the integration finds nothing
to edit and logs a preflight warning. Keep `devToolbar.enabled` on in dev.

## Options

```js
textEdit({
  enabled: true,                          // kill switch
  assetDirs: ['public', 'src/assets'],    // scanned for images; uploads → first
  editableExtensions: ['.astro', '.md', '.mdx'],
  contentRoots: ['src', 'public'],        // writes confined to these
  openInEditor: true,                     // expose "Open source" / jump-to-file
  entryEditor: {},                        // CMS entry drawer; false disables it
})
```

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | `false` disables the integration entirely. |
| `assetDirs` | `['src/assets', 'public']` | Dirs scanned for replacement images; **uploads go to the first**. |
| `editableExtensions` | `['.astro', '.md', '.mdx']` | Extensions the patcher is allowed to write. |
| `contentRoots` | `['src', 'public']` | Writes are confined to these (resolved, symlinks included). |
| `openInEditor` | `true` | Expose the "Open source" / jump-to-file behaviour. |
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
edit mode shows an **✎ Edit entry** button, and clicking any collection-driven
text offers **"Edit page content"**. Both open a drawer that edits the entry
like a CMS would:

- **Frontmatter as typed form fields** — the field list, types, requiredness,
  defaults, and enum options are **introspected from your own
  `content.config.ts` zod schema** (loaded through the dev server, always
  fresh). `z.string()` → text, `z.coerce.date()` → date picker,
  `z.boolean()` → checkbox, `z.enum` → select, `z.array(z.string())` → tags,
  and so on. No schema resolvable? Field types are inferred from the entry's
  own values instead — the panel always works.
- **Markdown body in a WYSIWYG editor** — a white writing surface with a
  sticky formatting toolbar: bold / italic / strikethrough, heading levels
  (H1–H6 dropdown), bulleted and numbered lists, quote, code block, inline
  code, links, and image insert (upload, browse existing assets, or type a
  path). Clicking an image inside the body reopens the same panel to replace
  it. The **MD** button flips to raw-markdown source; bodies using markdown
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
by convention); after a delete, to the parent listing. Projects with
non-conventional detail routes still get the file written/removed — only the
navigation guess differs.

## Styling the overlay

Every overlay element carries a stable class, and the singletons carry IDs:
`#atx-toggle` (the Edit button), `#atx-outline` (hover highlight),
`#atx-tooltip` (the file:loc pill), plus classes like `atx-panel`,
`atx-panel-body`, `atx-btn atx-btn-primary|secondary|cancel`, `atx-toast`,
`atx-backdrop`, `atx-drop`, `atx-asset-row`, `atx-drawer`, and the rich body
editor's `atx-rte`, `atx-rte-head` (sticky toolbar + image panel),
`atx-rte-toolbar`, `atx-rte-btn`, `atx-rte-content`, `atx-rte-image-panel`,
and the image field's `atx-image-field-preview|thumb|empty|path`.

One exception to the inline-styles rule: the rich editor's *content* elements
(headings, lists, quotes… that you create while typing) are styled by a small
injected stylesheet, `#atx-rte-style`, scoped under `.atx-rte-content`. Those
rules are ordinary CSS, so overriding them needs specificity, not
`!important`.

Use them to reference elements from devtools or to override styling. The
baseline styles are **inline** on purpose — they win specificity against any
host-page CSS so the overlay renders correctly on every site — which means
your overrides need `!important`:

```css
/* e.g. move the Edit button above a cookie banner */
#atx-toggle { bottom: 120px !important; }
```

## Scope and limitations

- **Dev only.** Nothing runs in build/preview/production.
- **Localhost only.** All endpoints reject non-localhost requests.
- **Content, never structure.** Inserted text is escaped so it can't introduce a
  tag, an expression, or an entity — edits change words, never behaviour.
- **No in-place (click-on-the-page) editing of expression-driven text.** On
  detail pages those clicks route to the entry drawer; elsewhere they refuse
  with "Open source" as the escape hatch.
- **The rich body editor covers a markdown subset** — headings, emphasis,
  lists, quotes, code, links, images, hr. Anything beyond it (tables, raw
  HTML/MDX, footnotes, nested lists) is still editable, but as markdown
  source. No `astro:assets` `image()` metadata (path strings only).
- Verified against Astro 5.x. Requires the dev toolbar (above).

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
