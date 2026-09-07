# Configuration reference

Every option the integration takes, where you can set it, and which source wins.
The [README](../README.md) has the short version; this is the whole of it.

- [Options](#options)
- [Where a value can come from](#where-a-value-can-come-from)
- [The Settings drawer](#the-settings-drawer)
- [The settings file](#the-settings-file)
- [Watching writes in your editor](#watching-writes-in-your-editor)

## Options

All of them are optional. Pass what you want to `devEdit({ … })`:

```js
// astro.config.mjs
import { defineConfig } from "astro/config";
import devEdit from "astro-dev-edit";

export default defineConfig({
  integrations: [
    devEdit({
      assetDirs: ["src/assets", "public", "src/images"],
      unsplash: { appName: "my-site" },
    }),
  ],
});
```

| Option | Default | What it does |
| --- | --- | --- |
| `enabled` | `true` | Kill switch. Config only, because it is read before the dev server exists. |
| `assetDirs` | `['src/assets', 'public']` | Directories the image picker scans. |
| `uploadDir` | `'public'` | Where uploads land. Must be web servable. |
| `imageUploadDir` | `'src/assets'` | Fallback for uploads backing an `image()` field. Must be under `src/`. |
| `editableExtensions` | `['.astro', '.md', '.mdx']` | Extensions the patcher may write. |
| `contentRoots` | `['src', 'public']` | Writes are confined to these, with symlinks resolved. |
| `openInEditor` | `true` | The "Open source" and jump to file buttons. |
| `revealWrites` | `false` | Open each text file in your editor as it is written. See [Watching writes in your editor](#watching-writes-in-your-editor). |
| `revealWriteDelayMs` | `1000` | How long to wait after asking the editor to open an existing file. A whole number of milliseconds, `0` to `10000`. |
| `cssInspector` | `true` | The hover pill's class and ID CSS inspector. |
| `sourceAnnotations` | `'auto'` | Who emits `data-astro-source-*`: `'auto'`, `'force'` or `'off'`. Config only, because it registers a Vite plugin. |
| `entryEditor` | `{}` | The entry drawer. `false` disables it. See [Entry editor](ENTRY-EDITOR.md). |
| `schemaEditor` | `true` | Whether the collection designer may write your `content.config.ts`. |
| `unsplash` | `false` | The Unsplash source. `{}` turns it on. Sub-options: `accessKey`, `appName`, `perPage`, `importWidth`. See [Unsplash](MEDIA.md#unsplash-photo-picker). |

## Where a value can come from

Highest first: **`astro.config.mjs`**, then **`.astro-dev-edit.json`**, then the
defaults above. `astro.config.mjs` wins because it is code you wrote
deliberately, it is committed, and `astro build` reads it.

`enabled` and `sourceAnnotations` are the two config only options. Both are
consumed in `astro:config:setup`, before a dev server exists, so the settings
file cannot reach them. They render read-only in the drawer.

## The Settings drawer

*Settings* in the admin bar's overflow menu opens a drawer holding every option
above, grouped into General, Editing, Media and Unsplash tabs. Options are
resolved on every request, so a change applies to the next one and the dev
server keeps running.

An option you set in `astro.config.mjs` is shown but locked, with a note saying
where the value came from, because the drawer writes the settings file and the
config file outranks it. The drawer is server declared: the endpoint sends the
option records and the panel renders whatever arrives.

## The settings file

`.astro-dev-edit.json` sits in your project root and holds two separate things:
the options the drawer writes, and your Unsplash access key. Access keys never
come back out of it in a response.

**Gitignore it.** The drawer warns you while the file is not ignored, and the
warning clears as soon as you add it to `.gitignore`.

## Watching writes in your editor

**Show changed files in editor** in *Settings → Editing* (`revealWrites`) opens
every text file the tool writes in your external editor around the save, so a
change can be watched arriving in the source rather than only in the browser.
It is off by default.

An **existing** file is opened first, at the first line that differs, and the
save follows after a pause — **Delay before writing (ms)**
(`revealWriteDelayMs`), 1000 by default and any whole number from 0 to 10000. A
**new** file is written complete and opened afterwards, since there is nothing
to watch until it exists. A save whose content already matches the file on disk
opens nothing.

Every text write is covered: text and image edits made on the page, entry saves
and creations, a collection's schema, a new collection, and the field overrides
and options in `.astro-dev-edit.json`. A collection save that writes both stores
reveals each file immediately before its own write — `src/content.config.ts`,
then the settings file. Uploaded and imported images, deleted entries and
Astro's own generated files are left alone. Bear in mind that the settings file
holds your Unsplash access key, so it is one you may not want on screen.

The timing is best-effort by nature. The launcher is the one behind *Open
source*, and it cannot report that your editor has actually brought the file
into view: a slow editor wants a longer delay, and whether the tab stays open,
takes focus or reloads from disk is your editor's decision. Changes appear as
whole saves, never as simulated typing. If the launcher fails, the dev server
logs a warning and the save goes ahead regardless.

Saves queue behind one another, and each runs on the options as they stood when
it started, so switching the mode off gets one last reveal. A file edited on
disk during the pause is not overwritten — the save is refused and the panel
asks you to reopen and try again. `openInEditor`, which governs the manual
*Open source* buttons, is a separate switch either way.
