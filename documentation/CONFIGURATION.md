# Configuration reference

Every option the integration takes, where you can set it, and which source wins.

- [Options](#options)
- [Where a value can come from](#where-a-value-can-come-from)
- [Astro versions and source annotations](#astro-versions-and-source-annotations)
- [The Settings drawer](#the-settings-drawer)
- [Where settings are stored](#where-settings-are-stored)
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
      cssInspector: false,
    }),
  ],
});
```

| Option | Default | What it does |
| --- | --- | --- |
| `enabled` | `true` | Kill switch. Config only, because it is read before the dev server exists. |
| `assetDirs` | `['src/assets', 'public']` | Directories the image picker scans. |
| `uploadDir` | `'public'` | Where uploads land. Must be web servable. |
| `imageUploadDir` | `'src/assets'` | Fallback directory for an upload referenced relative to the file using it, rather than by web path. Must be under `src/` — Astro imports those assets, and `public/` files cannot be. |
| `editableExtensions` | `['.astro', '.md', '.mdx']` | Extensions the path gate admits — for opening and peeking as well as writing. Only `.astro` has a patcher, so a `.md` entry opens in your editor but is not edited in place. |
| `contentRoots` | `['src', 'public']` | Writes are confined to these, with symlinks resolved. |
| `openInEditor` | `true` | The "Open source" and jump to file buttons. |
| `revealWrites` | `false` | Open each text file in your editor as it is written. See [Watching writes in your editor](#watching-writes-in-your-editor). |
| `revealWriteDelayMs` | `1000` | How long to wait after asking the editor to open an existing file. A whole number of milliseconds, `0` to `10000`. |
| `cssInspector` | `true` | The hover pill's class and ID CSS inspector. |
| `sourceAnnotations` | `'auto'` | Whether the integration injects its own source annotations: `'auto'` (yes, on every Astro version), `'force'` (a synonym) or `'off'`. Config only, because it registers a Vite plugin. |
| `composition` | `false` | The source inspector, tracing API and version-2 source annotations. Config only; when true, replaces the editing UI and supersedes `sourceAnnotations`. See [Component tracing and inspector](COMPOSITION-API.md). |

## Where a value can come from

Highest first: **`astro.config.mjs`**, then **`.astro-dev-edit.json`**, then the
defaults above. `astro.config.mjs` wins because it is code you wrote
deliberately, it is committed, and `astro build` reads it.

`enabled`, `sourceAnnotations` and `composition` are config only options. They are
consumed in `astro:config:setup`, before a dev server exists, so the settings
file cannot reach them. They render read-only in the drawer.

## Astro versions and source annotations

Astro 5, 6 and 7 are supported, and the overlay reads the same annotations on
all three: `data-atx-file` / `data-atx-loc`, injected by the integration itself
before Astro's compiler sees the file.

Astro's own `data-astro-source-*` is neither read nor emitted. Astro emits it on
**Astro 5 and 6** only while the dev toolbar is enabled, and on **Astro 7** not at
all ([withastro/compiler-rs#96](https://github.com/withastro/compiler-rs/issues/96)),
and the toolbar strips it from the live DOM within a frame of hydration on both
majors. The integration adds none of its own, because that pair is one absolute
path per element — the developer's home directory — in a page that a LAN dev
server, a tunnel, a screen share or a screenshot all publish, and it serves only
readers outside this tool. Tooling that looks for it on Astro 7 finds nothing
under stock Astro 7 either.

`'auto'` is the default and injects on every version; `'force'` is a synonym
kept for configs that set it. `'off'` disables injection entirely, and because
nothing else is read, it **disables the overlay** — on every Astro version,
whatever the dev toolbar is doing. The integration logs a warning saying so.
`composition: true` is the one exception: the tracing plugin stamps the same
attributes, so the overlay still works and no warning fires.

## The Settings drawer

*Settings* in the admin bar's overflow menu opens a drawer holding every option
above, grouped into General, Editing and Media tabs. Options are
resolved on every request, so a change applies to the next one and the dev
server keeps running.

An option you set in `astro.config.mjs` is shown but locked, with a note saying
where the value came from, because the drawer writes the settings file and the
config file outranks it. The drawer is server declared: the endpoint sends the
option records and the panel renders whatever arrives.

## Where settings are stored

`.astro-dev-edit.json` sits in your project root and holds the options the
drawer writes. Nothing secret is ever written to it.

**Gitignore it.** The drawer says so if your ignore rules miss it, and the
warning clears as soon as it is covered.

The dev server does not serve it. A request for `/.astro-dev-edit.json`, in any
spelling — through `/@fs/`, with a query, percent-encoded — is refused with a
403, as is any of the temporary files a save writes alongside it. That also
means project source cannot `import` the file.

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

Every text write is covered: text and image edits made on the page, the
inspector's prop and slot value saves, and the options in
`.astro-dev-edit.json`. Uploaded images and Astro's own generated files are
left alone.

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
