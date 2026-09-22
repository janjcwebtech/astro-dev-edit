<div align="center">

<img src="https://raw.githubusercontent.com/janjcwebtech/astro-dev-edit/main/documentation/images/banner.webp" alt="VS Code with the playground site in the editor pane: the hover pill reads index.astro:22:13 editable, with open and copy buttons, above a heading selected for inline editing, and the matching h1 highlighted in the source on the right" width="820">

# astro-dev-edit

### Click the text on the page, edit it, and the change lands in your source file.

[![version](https://img.shields.io/github/v/tag/janjcwebtech/astro-dev-edit?color=6144d7&label=version)](https://github.com/janjcwebtech/astro-dev-edit/releases) ![status: beta](https://img.shields.io/badge/status-beta-f59e0b) [![Astro 5, 6 and 7](https://img.shields.io/badge/astro-5%20%C2%B7%206%20%C2%B7%207-6144d7)](https://github.com/withastro/astro) ![Dev server only](https://img.shields.io/badge/scope-dev%20server%20only-444) [![MIT license](https://img.shields.io/github/license/janjcwebtech/astro-dev-edit?color=444)](https://github.com/janjcwebtech/astro-dev-edit/blob/main/LICENSE)

[**Watch the demo**](https://youtu.be/sa0TdkoybAk) · [Why I built it](https://jcweb.tech/visual-editing-for-astro-development/) · [Docs](https://github.com/janjcwebtech/astro-dev-edit/blob/main/documentation/EDITING.md) · [Changelog](https://github.com/janjcwebtech/astro-dev-edit/blob/main/CHANGELOG.md)

</div>

[https://github.com/user-attachments/assets/ac4a1864-daec-4ab6-b7e5-5ee0839f5356](https://github.com/user-attachments/assets/ac4a1864-daec-4ab6-b7e5-5ee0839f5356)

`astro-dev-edit` is an **in-browser visual content editor** for Astro websites running on a local dev server. Turn on the edit mode, click a piece of text or an image on the rendered page, change it, and the change is written into the source file it came from.

For bigger changes it **points you to the right place in the source code**.
There is also a **quick source preview** for HTML and CSS and allows you to give the exact **context to your AI** agent.

**Tip:** Hold Ctrl or Alt and links work as usual, so you can move around the site without leaving edit mode. The bar says which key while you are editing.

## Install

```bash
npm install --save-dev astro-dev-edit
```

It runs on the dev server and nowhere else, so it belongs in `devDependencies`.

```js
// astro.config.mjs
import { defineConfig } from "astro/config";
import devEdit from "astro-dev-edit";

export default defineConfig({
  integrations: [devEdit()],
});
```

Run `npm run dev` and click **Edit page** in the admin bar.

Works on Astro 5, 6 and 7, with the same setup on each — the integration injects its own source annotations rather than relying on Astro's. The details, and the one opt-out, are in [Astro versions and source annotations](https://github.com/janjcwebtech/astro-dev-edit/blob/main/documentation/CONFIGURATION.md#astro-versions-and-source-annotations).

## What you can edit

- **Literal text in a template.** Click it and type. The pill above the element names the file and the line the change will land in. Enter saves, escape cancels.
- **Strings that arrive through an expression.** A value pulled from the frontmatter is followed back to the string that produced it, and you edit that string, with the trace of where it came from.
- **Text carrying inline markup.** A heading broken by a `<br>`, or a sentence with a `<strong>` in it, opens over the raw source with a row of insertable tags: `br`, `strong`, `em`, `b`, `i`, `u`, `a`, `span`, `code`, `small`, `sup`, `sub`.
- **Images.** With the inspector on, clicking one opens a picker above its `src` and `alt` rows: the eight most recently added images, a *Show more* button, a filter over the whole path and an upload. Files your build would not serve are shown dimmed with the reason rather than hidden. Without the inspector, an image click says so and you edit `src` and `alt` in the file.

Content that lives in a Markdown or MDX entry is not edited in the browser. Each such value gets a row naming the entry file, with **View code** and no field, so you open that file in your IDE instead of typing over rendered text. Literal content in the route template stays editable as usual.

## Other features

- **Component inspector** — opt in with `devEdit({ composition: true })` for a source inspector with component chains, native slots, source links and CSS. Hold Alt/Option and click, or open the left-edge element tree — selection needs no key while it is open. See [Component tracing and inspector](https://github.com/janjcwebtech/astro-dev-edit/blob/main/documentation/COMPOSITION-API.md).
- **CSS peek** — the class chips on the hover pill pop the rules that actually apply to the element, each with the file it is written in.
- **Code peek** — *View code* shows the element's own source, scrolled to its line, without leaving the page.
- **Structure tree view** — a left-edge tree of every annotated element on the page; picking a row selects the element, and selecting on the page moves the row.
- **Links to the source code across the UI** — every file the overlay names opens in your editor, from the pill, the tree and every panel row.
- **Copy element's context for AI** — one button puts the element, the files that render it, where its words live and its source lines on your clipboard.

## Screenshots

![A heading in edit mode with the hover pill above it naming the file and line](https://raw.githubusercontent.com/janjcwebtech/astro-dev-edit/main/documentation/images/edit-text.png)

_Editing a heading in place. The pill names the file, the line and the column, and it stays there while you type._

![The hover pill showing class chips for btn and btn-primary, with a popup listing the CSS rules applied by btn-primary and the file they are written in](https://raw.githubusercontent.com/janjcwebtech/astro-dev-edit/main/documentation/images/css-inspector.png)

_The class chips on the pill show which CSS rules apply to the element and which file they are written in, so adjusting a transition is one click rather than a search._

![The pill's copy button, next to a Claude Code prompt filled with the element context: its source location and source lines](https://raw.githubusercontent.com/janjcwebtech/astro-dev-edit/main/documentation/images/copy-context.png)

_**Copy Context** puts what identifies the element on your clipboard: its text, the file and line it is written on, the components that render it, where its words actually live, and its own source lines. Your AI agent starts at the change instead of spending turns working out where it lives._

## Configuration

Everything is optional. Pass what you want to `devEdit({ … })`, or set it from the **Settings** drawer, which saves your choices in `.astro-dev-edit.json` and applies them to the next request without a restart. Anything you set in `astro.config.mjs` wins over that file and renders read-only in the drawer, with a note saying where the value came from. Gitignore `.astro-dev-edit.json` — the drawer says so if your ignore rules miss it.

Every option, with its default and what it does: [Configuration reference](https://github.com/janjcwebtech/astro-dev-edit/blob/main/documentation/CONFIGURATION.md).

## Limits

- No undo and no edit history. Every save writes the file immediately, so your git tree is the safety net: start from a clean tree, review with `git diff`, discard with `git checkout <file>`. Writes are atomic and verified against what the page showed, so a stale click fails rather than corrupting the file.
- Content, never structure. Inline edited text is escaped so it cannot introduce a tag, an expression or an entity. The markup popup lets tags through, but only the inline safelist, only with presentational attributes, and only well nested.
- Markdown and MDX content is not browser-editable. The overlay names the backing file and points you at it; nothing writes a `.md` frontmatter key or body line for you, and a route that declares no backing file opens its own template rather than guessing an entry.

## Documentation

| Doc | What's in it |
| --- | --- |
| [Editing reference](https://github.com/janjcwebtech/astro-dev-edit/blob/main/documentation/EDITING.md) | Everything the overlay can edit, and every surface it draws |
| [Component tracing and inspector](https://github.com/janjcwebtech/astro-dev-edit/blob/main/documentation/COMPOSITION-API.md) | The inspector, chains, slots and the tracing API |
| [Tracing proof](https://github.com/janjcwebtech/astro-dev-edit/blob/main/documentation/COMPOSITION-PROOF.md) | What the tracing guarantees, and the evidence for it |
| [Media picker](https://github.com/janjcwebtech/astro-dev-edit/blob/main/documentation/MEDIA.md) | Choosing and uploading images |
| [Configuration reference](https://github.com/janjcwebtech/astro-dev-edit/blob/main/documentation/CONFIGURATION.md) | Every option, the Settings drawer, and which source wins |
| [Styling reference](https://github.com/janjcwebtech/astro-dev-edit/blob/main/documentation/STYLING.md) | The --atx-\* properties and ::part() names you can theme |
| [Architecture](https://github.com/janjcwebtech/astro-dev-edit/blob/main/documentation/ARCHITECTURE.md) | How the layers fit together, and where a new capability goes |
| [Changelog](https://github.com/janjcwebtech/astro-dev-edit/blob/main/CHANGELOG.md) | What changed, release by release |

**Disclaimer:** The author is not responsible for any data loss. Back up your work regularly using git best practices.

## Credits

The technique of snapshotting source annotations onto a private JS property the instant they appear, rather than reading them off the element later, is borrowed from [`astro-click-to-source`](https://www.npmjs.com/package/astro-click-to-source) by **invisible1988** (MIT). This tool injects and reads its own `data-atx-*` pair rather than Astro's, but the caching pattern is theirs. If source navigation is all you want, that is the lighter tool for the job.

## Contributing

Bug reports and pull requests are welcome. Everything is reviewed and merged by me, and commits need a `Signed-off-by` line (`git commit -s`). [Contributing guide](https://github.com/janjcwebtech/astro-dev-edit/blob/main/CONTRIBUTING.md) · [Security policy](https://github.com/janjcwebtech/astro-dev-edit/blob/main/SECURITY.md).

## License

MIT
