<div align="center">
  <h1>astro-dev-edit</h1>
  <h3>Click the text on the page, edit it, and the change lands in your source file.</h3>
  <p>
    <a href="https://www.npmjs.com/package/astro-dev-edit"><img src="https://img.shields.io/npm/v/astro-dev-edit?color=6144d7" alt="npm version"></a>
    <a href="https://github.com/withastro/astro"><img src="https://img.shields.io/badge/astro-5%20%C2%B7%206%20%C2%B7%207-6144d7" alt="Astro 5, 6 and 7"></a>
    <img src="https://img.shields.io/badge/scope-dev%20server%20only-444" alt="Dev server only">
    <a href="LICENSE"><img src="https://img.shields.io/npm/l/astro-dev-edit?color=444" alt="MIT license"></a>
  </p>
  <p>
    <a href="https://youtu.be/sa0TdkoybAk"><b>Watch the demo</b></a> ·
    <a href="https://jcweb.tech/visual-editing-for-astro-development/">Why I built it</a> ·
    <a href="docs/EDITING.md">Docs</a> ·
    <a href="CHANGELOG.md">Changelog</a>
  </p>
</div>

https://github.com/user-attachments/assets/ac4a1864-daec-4ab6-b7e5-5ee0839f5356

I have always preferred coding websites over using a page builder, but the quick ad hoc changes after the main work was done always took longer than they should have, because each one started with hunting for the file the text lived in. So I built the tool I was missing.

`astro-dev-edit` is an integration for the Astro dev server. You turn on edit mode, click a piece of text or an image on the rendered page, change it, and the change is written into the source file it came from. Astro's hot reload refreshes the preview, and `git diff` shows exactly what changed. Hold Ctrl (Option on macOS) and links work as usual, so you can move around the site without leaving edit mode.

It registers nothing for `astro build` or `astro preview`, so it can never reach a production bundle, and every endpoint refuses anything that is not localhost. There is no build step: the package ships TypeScript, and your project compiles it like its own.

## Install

```bash
npm install --save-dev astro-dev-edit
```

```js
// astro.config.mjs
import { defineConfig } from "astro/config";
import devEdit from "astro-dev-edit";

export default defineConfig({
  integrations: [devEdit()],
});
```

Run `npm run dev` and click **Edit page** in the admin bar.

It works on Astro 5 through 7. On Astro 5 and 6 the source annotations come from the compiler, but only while the dev toolbar is enabled, so keep `devToolbar.enabled` on or set `sourceAnnotations: 'force'`. From Astro 7 the Rust compiler stopped emitting them ([withastro/compiler-rs#96](https://github.com/withastro/compiler-rs/issues/96)), so the integration injects them itself.

## What you can edit

- **Literal text in a template.** Click it and type. The pill above the element names the file and the line the change will land in. Enter saves, escape cancels.
- **Strings that arrive through an expression.** A value pulled from the frontmatter is followed back to the string that produced it, and you edit that string, with the trace of where it came from.
- **Text carrying inline markup.** A heading broken by a `<br>`, or a sentence with a `<strong>` in it, opens over the raw source with a row of insertable tags: `br`, `strong`, `em`, `b`, `i`, `u`, `a`, `span`, `code`, `small`, `sup`, `sub`.
- **Images.** Click one and you get a preview, the file name and size, the alt text, and the six images most recently added to the project. The full picker lists everything in your asset directories, with a filter, an upload button and an Unsplash tab if you add an access key.
- **Markdown and MDX entries.** On a page rendered from a content collection, **Edit entry** opens a drawer of typed form fields generated from your own zod schema, and the body as rich text or as raw markdown. It looks like a small CMS panel, but it reads and writes the entry file directly. You can create and delete entries from here too.
- **Collection schemas.** The designer lists every collection you declare and lets you add a field, retype one, remove one, or build a collection from scratch. Those edits patch your `content.config.ts`.
- **Nothing it cannot prove.** Components, `set:html`, nested block markup, untraceable expressions and anything a package renders get a notice explaining the reason and a button that opens the source instead.

Both drawers need one line of setup: a dev-only `<meta name="astro-dev-edit:page-source">` tag naming the file behind the page. See [Entry editor and collection designer](docs/ENTRY-EDITOR.md).

### A look at it

<img src="docs/images/edit-text.png" alt="A heading in edit mode with the hover pill above it naming the file and line" width="900">

Editing a heading in place. The pill names the file, the line and the column, and it stays there while you type.

<img src="docs/images/body-editor.png" alt="The body field of the entry drawer showing a formatting toolbar above rendered headings, paragraphs and a code block" width="900">

The body of a markdown entry in the rich text editor. The toolbar covers headings, emphasis, lists, quotes, code, links, images and horizontal rules, and you can switch to the raw markdown at any point.

<img src="docs/images/unsplash.jpg" alt="The Unsplash tab of the picker showing search results for mountains, each tile credited to its photographer, with shape and size selects" width="900">

With an Unsplash access key, a second tab in the picker searches Unsplash from inside your own site and imports the photo you pick at the width you choose.

<img src="docs/images/css-inspector.png" alt="The hover pill showing class chips for btn and btn-primary, with a popup listing the CSS rules applied by btn-primary and the file they are written in" width="900">

The class chips on the pill show which CSS rules apply to the element and which file they are written in, so adjusting a transition is one click rather than a search.

<img src="docs/images/copy-context.png" alt="The pill's copy button, next to a Claude Code prompt filled with the element context: source location, page URL, DOM path and applied CSS" width="900">

**Copy** puts the whole context of the element on your clipboard: the source location, the page URL, the DOM path, the rendered HTML and the CSS rules that apply to it. Your AI agent starts at the change instead of spending turns working all of that out.

## Configuration

Everything is optional. Pass what you want to `devEdit({ … })`, or set it from the **Settings** drawer, which saves your choices in `.astro-dev-edit.json` and applies them to the next request without a restart. Anything you set in `astro.config.mjs` wins over that file and renders read-only in the drawer, with a note saying where the value came from.

Gitignore `.astro-dev-edit.json`, since it also holds your Unsplash key. The drawer warns you when you have not.

Every option, with its default and what it does: [Configuration reference](docs/CONFIGURATION.md).

## Your git tree is the undo button

Every save writes the file on disk immediately. There is no undo button and no edit history, which is deliberate: your working tree already does that job better than a second history system inside an overlay would. Start a session from a clean tree, review with `git diff`, and throw an edit away with `git checkout <file>` if you need to. You can also undo in your editor, if you open the file you just edited.

The writes themselves are careful. Each one is atomic, and the server confirms the source still matches what the page showed before touching anything, so a stale click fails instead of corrupting the file.

## Limits

- Content, never structure. Inline edited text is escaped so it cannot introduce a tag, an expression or an entity. The markup popup lets tags through, but only the inline safelist, only with presentational attributes, and only well nested.
- The rich body editor covers a markdown subset. Anything past it, so tables, raw HTML or MDX, footnotes and nested lists, stays editable as markdown source.
- The collection designer reads only the schema shapes it can prove: `schema: z.object({ … })` and `schema: ({ image }) => z.object({ … })` with a plain field list. Anything else is reported as unreadable, with *Open source* offered instead.
- Unsplash is free tier only, and a photo is importable only while the dev server that searched for it is still running.

## Documentation

| Doc | What's in it |
| --- | --- |
| [Editing reference](docs/EDITING.md) | Everything the overlay can edit, and every surface it draws |
| [Entry editor and collection designer](docs/ENTRY-EDITOR.md) | The CMS drawer, the meta tag, schema editing |
| [Media picker and Unsplash](docs/MEDIA.md) | Choosing, uploading and importing images |
| [Configuration reference](docs/CONFIGURATION.md) | Every option, the Settings drawer, and which source wins |
| [Styling reference](docs/STYLING.md) | The `--atx-*` properties and `::part()` names you can theme |
| [Changelog](CHANGELOG.md) | What changed, release by release |

## Credits

The technique of snapshotting Astro's `data-astro-source-*` attributes into a private JS property the instant they appear, before the dev toolbar runtime strips them from the live DOM, is borrowed from [`astro-click-to-source`](https://www.npmjs.com/package/astro-click-to-source) by **invisible1988** (MIT). If source navigation is all you want, that is the lighter tool for the job.

## License

MIT
