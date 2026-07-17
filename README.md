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
- Everything else **refuses safely** with a reason and an "Open source" jump to
  the editor. Expression-driven text (`{title}`), loop-generated content,
  components, `set:html`, nested markup, and markdown/MDX bodies all fall here.

On a **detail page** (a route rendering one content entry through a template),
the refusal notice can offer a one-click jump to the backing `.md`/`.mdx` file —
see [Detail-page content jump](#detail-page-content-jump).

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
})
```

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | `false` disables the integration entirely. |
| `assetDirs` | `['src/assets', 'public']` | Dirs scanned for replacement images; **uploads go to the first**. |
| `editableExtensions` | `['.astro', '.md', '.mdx']` | Extensions the patcher is allowed to write. |
| `contentRoots` | `['src', 'public']` | Writes are confined to these (resolved, symlinks included). |
| `openInEditor` | `true` | Expose the "Open source" / jump-to-file behaviour. |

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

## Detail-page content jump

A detail-page layout can opt in so that clicking dynamic content (e.g. the post
title) offers **"Edit page content"**, opening the entry's markdown/MDX file in
your editor. This is the interim answer for content that renders through an
expression (`{title}`) — in-place editing of those fields is not built yet.

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
  absent, the jump button simply doesn't appear. If your layout renders inside a
  wrapper layout, make sure the meta ends up in the document `<head>` (e.g. via a
  named `head` slot).

The button opens the file at its top (no line number); it does not yet resolve
which line a specific field lives on.

## Styling the overlay

Every overlay element carries a stable class, and the singletons carry IDs:
`#atx-toggle` (the Edit button), `#atx-outline` (hover highlight),
`#atx-tooltip` (the file:loc pill), plus classes like `atx-panel`,
`atx-panel-body`, `atx-btn atx-btn-primary|secondary|cancel`, `atx-toast`,
`atx-backdrop`, `atx-drop`, `atx-asset-row`.

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
- **No in-place editing of markdown/MDX bodies or expression-driven fields yet.**
  Those refuse, with "Open source" / "Edit page content" as the escape hatch.
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
