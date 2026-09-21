# Image picker

One picker, in one place: a block at the top of the inspector panel, above
**Values**. The [README](../README.md) has the summary.

The inspector is opt-in, so the picker is too — turn it on with
`devEdit({ composition: true })`. Without it, clicking an image in edit mode
answers with a notice saying so, and `src` and `alt` are edited in the source
file instead.

It sits there because a list of fields cannot show pictures. Everything else
about an image — its `src`, its `alt` — is an ordinary Values row with its own
field and its own Save, so the picker adds the thumbnails and nothing else.

## Picking writes nothing

Clicking a tile **stages** the `src`, exactly as typing into the field does.
The element goes amber, the panel header reads *1 unsaved*, and the source file
is untouched until you press **Save** on that row. **Revert** or Esc throws the
choice away.

The one thing that does reach disk immediately is an **upload** — the bytes have
to exist before a grid can show them. It writes a new file into `uploadDir` and
never touches a `.astro` file; the `src` it produces is staged like any other
value and is still one Save away.

## What it shows

- **Newest first among the files you can actually use**, so a file uploaded a
  minute ago is the first tile rather than something to hunt for
  alphabetically. A file a build would not serve sinks to the end whatever its
  date — see the dimmed tiles below.
- **Eight at a time**, with a button that names what it will add and how much
  there is — *Show 8 more · 34 in this project*. Paging and the filter are both
  views over the one listing `GET /assets` returns; the server pages nothing.
- **Filter** matches anywhere in the path, so `hero`, `.svg` and `blog/` all
  work.
- **A file a build would not serve is shown, dimmed, with the reason.**
  `assetDirs` spans `src/assets` and your public directory on purpose, but a
  build copies only the public directory: `/src/assets/hero.svg` is a truthful
  dev URL and a 404 in `dist/`. The tile stays on screen and says which it is
  rather than disappearing, and it cannot be picked. The server decides this per
  file — nothing infers it from a path prefix.

## Uploads and `uploadDir`

The **Upload** button writes into `uploadDir`, and the line under it names that
directory before you use it. The rule it exists for is the one a byte-perfect
save cannot catch: `uploadDir` has to sit under your public directory
(`public/`, unless your Astro config sets `publicDir`), or the `src` it produces
reads back exactly as written and 404s in the built site. When it does not, that
line says so in the warning colour. A preflight warning also fires at startup.

## Alt text

`alt` is a Values row like any other where the attribute exists. Where it does
not, the row reads *no alt attribute — add it in the IDE*: this pass never
inserts an attribute the source does not contain, because a patcher cannot be
pointed at something that is not there.

![The inspector's Pick an image block: a filter box, a grid of project thumbnails with one marked Current, a Show more button, an Upload button and the line naming uploadDir](images/media-picker.png)
