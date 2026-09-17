# Media picker

One picker serves every place you choose an image. The
[README](../README.md) has the summary.

Anywhere you choose an image the same picker opens: a grid of your project's
images, a filter, a folder scope toggle, and a details rail showing the
selected file's path, size and modified time.

Three things about how it behaves:

- **Newest first by default.** A file you uploaded a minute ago is the first
  thing you see, not something to hunt for alphabetically. Switch the sort to
  **Name** if you prefer.
- **Picking is staged, not applied.** Clicking a tile selects it; the footer's
  **Use image** is what hands it back to the field. **Cancel** or **Escape**
  writes nothing at all — which matters, because this modal can open on top of
  another panel, and closing it must never disturb what is underneath.
- **A file the field cannot take is shown, dimmed, with the reason.** `assetDirs`
  spans both `public/` and `src/assets`, because the two kinds of image field
  need opposite halves of it. An `image()` field needs a file Astro can import,
  which means under `src/`. A plain `<img src>` needs a
  URL the **built** site has, which only your public directory gives —
  `/src/assets/hero.svg` is served in dev and absent from `dist/`. So the tile
  stays on screen and says which one it is rather than disappearing, and it
  cannot be selected. The rule is applied at pick time, where it is still cheap
  to choose something else.

Uploading works from the **Upload file…** button or by dropping a file anywhere
on the modal. Uploads land in `uploadDir` — or, for an `image()` field, beside
the field's existing asset. `uploadDir` has to be somewhere the browser can
fetch from, which means under your public directory (`public/`, unless your
Astro config sets `publicDir`): a file there becomes a plain `<img src>`, so a
`src/`-relative directory works in dev and 404s in a production build. A
preflight warning fires at startup if the configured directory isn't
web-servable.

The swap panel keeps a shortcut for the common case: a preview of the image you
are editing, and a strip of the **six most recently added** images, with
**Browse all** opening the full picker.

![The media picker showing the Project tab with a grid of project images, a filter box, a sort select and an Upload file button](images/media-picker.png)

![An image panel showing a preview, the file name and size, an alt text input, and a strip of recently added images](images/image-swap.png)
