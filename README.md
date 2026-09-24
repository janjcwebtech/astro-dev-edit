<div align="center">

<img src="https://raw.githubusercontent.com/janjcwebtech/astro-dev-edit/main/documentation/images/docked.png" alt="The playground site with the inspector docked around it: the element tree on the left, the inspector panel on the right showing component chain, values, slot relationships and CSS, and the code dock across the bottom scrolled to the selected line" width="900">

# astro-dev-edit

### Point at anything on the page and see the component that rendered it, the file its words live in, and the CSS that styles it — then change the words without leaving the page.

[![version](https://img.shields.io/github/v/tag/janjcwebtech/astro-dev-edit?color=6144d7&label=version)](https://github.com/janjcwebtech/astro-dev-edit/releases) ![status: beta](https://img.shields.io/badge/status-beta-f59e0b) [![Astro 5, 6 and 7](https://img.shields.io/badge/astro-5%20%C2%B7%206%20%C2%B7%207-6144d7)](https://github.com/withastro/astro) ![Dev server only](https://img.shields.io/badge/scope-dev%20server%20only-444) [![MIT license](https://img.shields.io/github/license/janjcwebtech/astro-dev-edit?color=444)](https://github.com/janjcwebtech/astro-dev-edit/blob/main/LICENSE)

[Why I built it](https://jcweb.tech/visual-editing-for-astro-development/) · [Docs](https://github.com/janjcwebtech/astro-dev-edit/blob/main/documentation/EDITING.md) · [Changelog](https://github.com/janjcwebtech/astro-dev-edit/blob/main/CHANGELOG.md)

</div>

`astro-dev-edit` is a **source inspector for the Astro dev server**. Hold Alt/Option and click any element — or open the element tree on the left edge — and it tells you which component rendered it, which slot carried it through, which file and line its text is written on, and which CSS rules apply. Where the value is a literal your template owns, you edit it in the panel and it is written to that file.

It stays out of the way until you ask for it: on a fresh page there is nothing but a small tab on the left edge.

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

**Import it statically, as above.** The package ships TypeScript with no build step, and Node refuses to strip types for anything under `node_modules` — so a dynamic `await import("astro-dev-edit")` in your config cannot load it, and wrapping one in `try`/`catch` to guard against the package being absent swallows that error along with the one you meant to catch. A static import is loaded by Vite, which strips the types, and works on every install.

Run `npm run dev`, then hold **Alt/Option** and click something — or open the tab on the left edge.

Works on Astro 5, 6 and 7, with the same setup on each: the integration injects its own `data-atx-*` source annotations rather than relying on Astro's. The details, and the one opt-out, are in [Astro versions and source annotations](https://github.com/janjcwebtech/astro-dev-edit/blob/main/documentation/CONFIGURATION.md#astro-versions-and-source-annotations).

## The three panes

- **Element tree**, left — every annotated element on the route, with the component and slot boundaries marked. Picking a row selects the element; hovering the page moves the row. Its header carries the route, *View code*, the menu and Settings.
- **Inspector**, right — what is true about the selection: the **component chain** from the route entry down, which rendered occurrence you are looking at, the **values** it owns, the **slot relationships** that carried it, and the **CSS** that applies with the file each rule is written in.
- **Code dock**, bottom — the selected element's own source, scrolled to its line, with *Open in editor*. It follows the selection.

Dock them around the page or float them over it — the button in the inspector's header switches, and the page reflows rather than being covered.

## What you can change

- **Literal text in a template.** The Values card gives you the string with the caret on the page beside it. Save writes it to the file and line the chain names.
- **Strings that arrive through an expression.** A value pulled from the frontmatter is followed back one hop to the string that produced it, and that string is what you edit.
- **Text carrying inline markup.** A heading broken by a `<br>`, or a sentence with a `<strong>` in it, is edited as the source spells it — tags and all. The safelist that validates it is `a`, `b`, `br`, `code`, `em`, `i`, `small`, `span`, `strong`, `sub`, `sup`, `u`, with presentational attributes only.
- **Images.** Selecting one opens a picker above its `src` and `alt` rows: the eight most recently added images, a *Show more* button, a filter over the whole path and an upload. Files your build would not serve are shown dimmed with the reason rather than hidden.

Content that lives in a Markdown or MDX entry is **not** edited in the browser. Each such value gets a row naming the entry file, with *View code* and no field, so you open that file in your editor instead of typing over rendered text. Literal content in the route template stays editable as usual.

## Screenshots

![The element tree open on the left with a nav link hovered, and a pill above it reading Nav.astro:16:28 followed by the chain index.astro, Base.astro, Nav.astro, a](https://raw.githubusercontent.com/janjcwebtech/astro-dev-edit/main/documentation/images/tree-and-chain.png)

_Hovering an element names the file and line it is written on, and the chain of components that rendered it — route entry first._

![The inspector panel showing a proven chain badge, the component chain for an h1, a Values card with the editable text, slot relationships and the CSS card](https://raw.githubusercontent.com/janjcwebtech/astro-dev-edit/main/documentation/images/inspector.png)

_The inspector for one `<h1>`: the chain that rendered it, the literal it owns with the field that edits it, the slot that carried it, and the rules that style it._

![The playground site at rest with no overlay chrome, only a small tab on the left edge](https://raw.githubusercontent.com/janjcwebtech/astro-dev-edit/main/documentation/images/at-rest.png)

_Nothing is drawn over your site until you ask. One tab on the left edge is the whole resting footprint._

## Configuration

Everything is optional. Pass what you want to `devEdit({ … })`, or set it from the **Settings** drawer, which saves your choices in `.astro-dev-edit.json` and applies them to the next request without a restart. Anything you set in `astro.config.mjs` wins over that file and renders read-only in the drawer, with a note saying where the value came from. Gitignore `.astro-dev-edit.json` — the drawer says so if your ignore rules miss it.

Every option, with its default and what it does: [Configuration reference](https://github.com/janjcwebtech/astro-dev-edit/blob/main/documentation/CONFIGURATION.md).

## Limits

- No undo and no edit history. Every save writes the file immediately, so your git tree is the safety net: start from a clean tree, review with `git diff`, discard with `git checkout <file>`. Writes are atomic and verified against what the page showed, so a stale click fails rather than corrupting the file.
- Content, never structure. An edited literal is escaped so it cannot introduce a tag, an expression or an entity. A markup value may carry tags, but only from the inline safelist, only with presentational attributes, and only well nested.
- Markdown and MDX content is not browser-editable. The inspector names the backing file and points you at it; nothing writes a `.md` frontmatter key or body line for you, and a route that declares no backing file opens its own template rather than guessing an entry.
- Tracing is a dev-server feature and costs a pre-compiler transform on every `.astro` file. Nothing is installed for `astro build`.

## Documentation

| Doc | What's in it |
| --- | --- |
| [Editing reference](https://github.com/janjcwebtech/astro-dev-edit/blob/main/documentation/EDITING.md) | Every value the inspector can change, and every surface it draws |
| [Inspector and tracing API](https://github.com/janjcwebtech/astro-dev-edit/blob/main/documentation/COMPOSITION-API.md) | The three panes, chains, slots and the tracing API |
| [Tracing proof](https://github.com/janjcwebtech/astro-dev-edit/blob/main/documentation/COMPOSITION-PROOF.md) | What the tracing guarantees, and the evidence for it |
| [Media picker](https://github.com/janjcwebtech/astro-dev-edit/blob/main/documentation/MEDIA.md) | Choosing and uploading images |
| [Configuration reference](https://github.com/janjcwebtech/astro-dev-edit/blob/main/documentation/CONFIGURATION.md) | Every option, the Settings drawer, and which source wins |
| [Styling reference](https://github.com/janjcwebtech/astro-dev-edit/blob/main/documentation/STYLING.md) | The `--atx-*` properties and `::part()` names you can theme |
| [Architecture](https://github.com/janjcwebtech/astro-dev-edit/blob/main/documentation/ARCHITECTURE.md) | How the layers fit together, and where a new capability goes |
| [Changelog](https://github.com/janjcwebtech/astro-dev-edit/blob/main/CHANGELOG.md) | What changed, release by release |

**Disclaimer:** The author is not responsible for any data loss. Back up your work regularly using git best practices.

## Credits

The technique of snapshotting source annotations onto a private JS property the instant they appear, rather than reading them off the element later, is borrowed from [`astro-click-to-source`](https://www.npmjs.com/package/astro-click-to-source) by **invisible1988** (MIT). This tool injects and reads its own `data-atx-*` pair rather than Astro's, but the caching pattern is theirs. If source navigation is all you want, that is the lighter tool for the job.

## Contributing

Bug reports and pull requests are welcome. Everything is reviewed and merged by me, and commits need a `Signed-off-by` line (`git commit -s`). [Contributing guide](https://github.com/janjcwebtech/astro-dev-edit/blob/main/CONTRIBUTING.md) · [Security policy](https://github.com/janjcwebtech/astro-dev-edit/blob/main/SECURITY.md).

## License

MIT
