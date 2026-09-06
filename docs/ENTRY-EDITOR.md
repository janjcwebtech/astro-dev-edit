# Entry editor and collection designer

The CMS half of the tool: editing a content-collection entry as form fields,
and editing the collection's own schema. The [README](../README.md) covers
when you'd reach for these; this is the reference.

- [Entry editor](#entry-editor)
- [Setup per project](#setup-per-project)
- [`image()` fields are relative to the entry file](#image-fields-are-relative-to-the-entry-file)
- [The page-source meta tag](#the-page-source-meta-tag)
- [Collections — the collection designer](#collections--the-collection-designer)

## Entry editor

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
  `YYYY-MM-DD` value infers as a date) — the panel always works. Every control is
  **named by the label above it** — clicking that label focuses the field (and
  ticks a checkbox), and a screen reader reads the field's own name, with its
  help line, its error and a checkbox's "not set" as the description. The same
  renderer draws the Settings drawer, so both behave alike.
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
- **Create** (the **New** button in the drawer's header — slug auto-suggested from the title,
  never overwrites) and **Delete** (confirmed; undo is git). A field you leave
  alone is **left out of the file**, so your schema's default is what applies —
  including a boolean, whose unticked box means "not set" and says so, naming
  the default it will take.
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

### `image()` fields are relative to the entry file

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
  `imageUploadDir` — which has to be under `src/`, because Astro *imports*
  these assets and `public/` files cannot be imported (a preflight warning
  fires if it isn't)

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
new file (up to ~10s) so you land on the rendered page, not a 404 — and that
wait survives the reload the sync itself causes, so the page you end up on is
the new entry either way; after a delete, to the parent listing. Projects with non-conventional detail routes
still get the file written/removed — only the navigation guess differs.


## Collections — the collection designer

**Collections** in the admin bar's overflow menu lists every collection your
content config declares, opens one into its field table, and can append a new one.
It is its own drawer, alongside Settings rather than inside it: an option is a
switch on this tool, while a collection's shape is your own committed source. It is
part of the [entry editor](#entry-editor)
surface, so `entryEditor: false` removes the menu item along with the drawer. Two
things it does that the rest of the overlay doesn't:

**It writes `src/content.config.ts`.** Adding a field, changing a field's type,
removing one, creating a collection — all of it patches that file, which is
committed TypeScript your build reads. The patch is surgical: only the touched
span changes, so comments, key order and quoting come out exactly as they went in.
Set `schemaEditor: false` to forbid this outright while keeping the rest of the
tool.

**Every field card holds two stores side by side, and says which is which:**

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
-   **Names are validated, not escaped.** A collection or field name has to be a
    plain identifier, and a new collection's directory is confined to
    `contentRoots` like any other write. A value that would need quoting to be
    written safely is refused rather than quoted, which keeps every expression
    the patcher writes a shape it can read back.

### Items

Each collection also has an **Items** view: its entry files, newest first, with a
badge on drafts. This is the way to reach an entry no rendered page links to — a
draft, or one whose route doesn't exist yet. Clicking an item opens the ordinary
entry drawer for it (this drawer hands over rather than stacking); **New
item** opens the ordinary create drawer, built from the collection's schema.
Deleting is still done from the entry drawer, still etag-guarded, and still has no
in-app undo.

