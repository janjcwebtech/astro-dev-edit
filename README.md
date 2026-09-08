<div align="center">

<img src="https://raw.githubusercontent.com/janjcwebtech/astro-dev-edit/main/documentation/images/banner.webp" alt="VS Code with the playground site in the editor pane: the hover pill reads index.astro:22:13 editable, with open and copy buttons, above a heading selected for inline editing, and the matching h1 highlighted in the source on the right" width="820">

# astro-dev-edit

### Click the text on the page, edit it, and the change lands in your source file.

[![version](https://img.shields.io/github/v/tag/janjcwebtech/astro-dev-edit?color=6144d7&label=version)](https://github.com/janjcwebtech/astro-dev-edit/releases) ![status: beta](https://img.shields.io/badge/status-beta-f59e0b) [![Astro 5, 6 and 7](https://img.shields.io/badge/astro-5%20%C2%B7%206%20%C2%B7%207-6144d7)](https://github.com/withastro/astro) ![Dev server only](https://img.shields.io/badge/scope-dev%20server%20only-444) [![MIT license](https://img.shields.io/github/license/janjcwebtech/astro-dev-edit?color=444)](LICENSE)

[**Watch the demo**](https://youtu.be/sa0TdkoybAk) · [Why I built it](https://jcweb.tech/visual-editing-for-astro-development/) · [Docs](documentation/EDITING.md) · [Changelog](CHANGELOG.md)

</div>

[https://github.com/user-attachments/assets/ac4a1864-daec-4ab6-b7e5-5ee0839f5356](https://github.com/user-attachments/assets/ac4a1864-daec-4ab6-b7e5-5ee0839f5356)

`astro-dev-edit` is an **in-browser visual content editor** for Astro websites running on a local dev server. Turn on the edit mode, click a piece of text or an image on the rendered page, change it, and the change is written into the source file it came from.

For bigger changes it **points you to the right place in the source code**.
There is also a **quick source preview** for HTML and CSS and allows you to give the exact **context to your AI** agent.

**Tip:** Hold Ctrl (Option on macOS) and links work as usual, so you can move around the site without leaving edit mode.

## Install

Not on npm yet. While it is in beta, install it from GitHub:

```bash
npm install --save-dev github:janjcwebtech/astro-dev-edit
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

Works on Astro 5, 6 and 7. The per-version setup, and the one flag Astro 5 and 6 need, are in [Astro versions and source annotations](documentation/CONFIGURATION.md#astro-versions-and-source-annotations).

## What you can edit

- **Literal text in a template.** Click it and type. The pill above the element names the file and the line the change will land in. Enter saves, escape cancels.
- **Strings that arrive through an expression.** A value pulled from the frontmatter is followed back to the string that produced it, and you edit that string, with the trace of where it came from.
- **Text carrying inline markup.** A heading broken by a `<br>`, or a sentence with a `<strong>` in it, opens over the raw source with a row of insertable tags: `br`, `strong`, `em`, `b`, `i`, `u`, `a`, `span`, `code`, `small`, `sup`, `sub`.
- **Images.** Click one and you get a preview, the file name and size, the alt text, and the six images most recently added to the project. The full picker lists everything in your asset directories, with a filter, an upload button and an Unsplash tab if you add an access key.
- **Markdown and MDX entries.** On a page rendered from a content collection, **Edit entry** opens a drawer of typed form fields generated from your own zod schema, and the body as rich text or as raw markdown. It looks like a small CMS panel, but it reads and writes the entry file directly. You can create and delete entries from here too.
- **Collection schemas.** The designer lists every collection you declare and lets you add a field, retype one, remove one, or build a collection from scratch. Those edits patch your `content.config.ts`.

## Other features

- **CSS peek**
- **Code peek**
- **Structure tree view**
- **Links to the source code across the UI**
- **Copy element's context for AI**

## Screenshots

![A heading in edit mode with the hover pill above it naming the file and line](https://raw.githubusercontent.com/janjcwebtech/astro-dev-edit/main/documentation/images/edit-text.png)

_Editing a heading in place. The pill names the file, the line and the column, and it stays there while you type._

![The body field of the entry drawer showing a formatting toolbar above rendered headings, paragraphs and a code block](https://raw.githubusercontent.com/janjcwebtech/astro-dev-edit/main/documentation/images/body-editor.png)

_The body of a markdown entry in the rich text editor. The toolbar covers headings, emphasis, lists, quotes, code, links, images and horizontal rules, and you can switch to the raw markdown at any point._

![The Unsplash tab of the picker showing search results for mountains, each tile credited to its photographer, with shape and size selects](https://raw.githubusercontent.com/janjcwebtech/astro-dev-edit/main/documentation/images/unsplash.jpg)

_With an Unsplash access key, a second tab in the picker searches Unsplash from inside your own site and imports the photo you pick at the width you choose._

![The hover pill showing class chips for btn and btn-primary, with a popup listing the CSS rules applied by btn-primary and the file they are written in](https://raw.githubusercontent.com/janjcwebtech/astro-dev-edit/main/documentation/images/css-inspector.png)

_The class chips on the pill show which CSS rules apply to the element and which file they are written in, so adjusting a transition is one click rather than a search._

![The pill's copy button, next to a Claude Code prompt filled with the element context: source location, page URL, DOM path and applied CSS](https://raw.githubusercontent.com/janjcwebtech/astro-dev-edit/main/documentation/images/copy-context.png)

_**Copy Context** puts the whole context of the element on your clipboard: the source location, the page URL, the DOM path, the rendered HTML and the CSS rules that apply to it. Your AI agent starts at the change instead of spending turns working all of that out._

## Configuration

Everything is optional. Pass what you want to `devEdit({ … })`, or set it from the **Settings** drawer, which saves your choices in `.astro-dev-edit.json` and applies them to the next request without a restart. Anything you set in `astro.config.mjs` wins over that file and renders read-only in the drawer, with a note saying where the value came from.

Gitignore `.astro-dev-edit.json`, since it also holds your Unsplash key. The drawer warns you when you have not.

Every option, with its default and what it does: [Configuration reference](documentation/CONFIGURATION.md).

## Limits

- No undo and no edit history. Every save writes the file immediately, so your git tree is the safety net: start from a clean tree, review with `git diff`, discard with `git checkout <file>`. Writes are atomic and verified against what the page showed, so a stale click fails rather than corrupting the file.
- Content, never structure. Inline edited text is escaped so it cannot introduce a tag, an expression or an entity. The markup popup lets tags through, but only the inline safelist, only with presentational attributes, and only well nested.
- The rich body editor covers a markdown subset. Anything past it, so tables, raw HTML or MDX, footnotes and nested lists, stays editable as markdown source.
- The collection designer reads only the schema shapes it can prove: `schema: z.object({ … })` and `schema: ({ image }) => z.object({ … })` with a plain field list. Anything else is reported as unreadable, with _Open source_ offered instead.
- Unsplash is free tier only, and a photo is importable only while the dev server that searched for it is still running.

## Documentation

| Doc                                  | What's in it                                                 |
| ------------------------------------ | ------------------------------------------------------------ |
| Editing reference                    | Everything the overlay can edit, and every surface it draws  |
| Entry editor and collection designer | The CMS drawer, the meta tag, schema editing                 |
| Media picker and Unsplash            | Choosing, uploading and importing images                     |
| Configuration reference              | Every option, the Settings drawer, and which source wins     |
| Styling reference                    | The --atx-\* properties and ::part() names you can theme     |
| Architecture                         | How the layers fit together, and where a new capability goes |
| Changelog                            | What changed, release by release                             |

**Disclaimer:** The author is not responsible for any data loss. Back up your work regularly using git best practices.

## Credits

The technique of snapshotting Astro's `data-astro-source-*` attributes into a private JS property the instant they appear, before the dev toolbar runtime strips them from the live DOM, is borrowed from [`astro-click-to-source`](https://www.npmjs.com/package/astro-click-to-source) by **invisible1988** (MIT). If source navigation is all you want, that is the lighter tool for the job.

## Contributing

Bug reports and pull requests are welcome. Everything is reviewed and merged by me, and commits need a `Signed-off-by` line (`git commit -s`). [Contributing guide](CONTRIBUTING.md) · [Security policy](SECURITY.md).

## License

MIT
