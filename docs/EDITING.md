# Editing reference

What the overlay can and can't edit, and every surface it puts on the page.
The [README](../README.md) has the short version; this is the whole of it.

- [What it can edit](#what-it-can-edit)
- [The hover pill and source peek](#the-hover-pill-and-source-peek)
- [Copy context for an AI assistant](#copy-context-for-an-ai-assistant)
- [CSS inspector](#css-inspector)
- [The admin bar](#the-admin-bar)
- [Element tree](#element-tree)

## What it can edit

- **Literal text in `.astro` templates** — an element whose children are only
  plain text. Click → inline edit → Enter/blur to save, Esc to cancel.
- **Literal text carrying inline markup** — a heading broken by a `<br>`, a
  sentence with a `<strong>` or a link in it. Inline editing can't serve these
  (it escapes `<`, which would turn the tag into visible punctuation), so a
  click opens a **markup popup** showing the element's source instead. Save
  with the button or Cmd/Ctrl+Enter; **open** in the title bar jumps to the
  file in your editor without closing the popup. Only these inline tags are allowed —
  `<a> <b> <br> <code> <em> <i> <small> <span> <strong> <sub> <sup> <u>` — with
  presentational attributes (`class`, `id`, `title`, `lang`, `dir`, plus
  `href`/`target`/`rel` on links); attributes already in your source are kept
  as they are. Anything else, including unbalanced tags, is refused rather
  than written — and a refusal is shown **in the popup**, which stays open with
  your markup intact so you can fix it and retry. Each allowed tag is a **button** under the box: with text
  selected it wraps the selection (and keeps it selected, so tags stack),
  otherwise it drops an empty pair at the caret. `<br>` inserts alone, and
  `<a>` arrives as `<a href="">` with the caret already inside the quotes.
- **Text rendered through an `{expression}`** — a frontmatter const
  (`<h1>{title}</h1>`), or one item of an array a `.map()` loops over
  (`{benefits.map((b) => <h3>{b.title}</h3>)}`). Clicking opens a **value
  popup** titled with where the string lives (`benefits[].title`), and the edit
  is written to that string in the frontmatter — the template itself is never
  touched. Its title bar carries the same **open** jump to your editor. Plain text only: `{value}` renders escaped, so tags typed here would
  show as punctuation rather than markup.

  Every card in a loop shares one source location, so **which item you clicked
  is identified by the text on the page**: the item whose value equals what you
  saw is the one patched. Two items reading exactly the same way refuse rather
  than guess, as do computed expressions (`{n + 1}`), template literals with
  `${…}` in them, `.filter().map()` chains, nested access (`{b.meta.label}`),
  and arrays imported from another file.
- **Images in `.astro`** — swap a static `src` from the project's images (with
  thumbnails) or upload a new file, and edit `alt`. Only statically-quoted
  attributes are editable; `src={…}` / `<Image>` are treated as dynamic.
- **Content-collection entries** — on a detail page that declares its backing
  `.md`/`.mdx` file, an **Edit entry** drawer edits the frontmatter as typed
  form fields (generated from your own zod schema) plus the markdown body, and
  can create or delete entries. See [Entry editor](ENTRY-EDITOR.md).
- Everything else **refuses safely** with a reason and an "Open source" jump to
  the editor. Expressions that can't be traced to a string, components,
  `set:html`, and block-level nested markup all fall here — on
  detail pages the refusal notice offers "Edit page content", which opens the
  entry drawer.
- **Something a component or a slot rendered** has no source location of its
  own — Astro annotates only what is written in the file — so a click on it is
  answered about the nearest element that *is*. The notice says so, naming the
  tag you clicked, because the reason then belongs to that ancestor: a one-word
  button can be refused for "containing nested markup" that lives in the
  wrapper around it, not in the button.
- **Package-rendered elements** refuse the same quiet way. Astro's
  `astro:assets` `<Image>` renders through
  `node_modules/astro/components/Image.astro`, and that is the path its source
  annotation carries — so those elements report "rendered by a package
  component" rather than pointing at your file. Edit the `<Image>` usage in
  your own component instead. Package paths are never writable: `contentRoots`
  does not include `node_modules`, and widening it is not a supported fix.

## The hover pill and source peek

In edit mode, hovering an element draws a box a couple of pixels clear of it
and shows a `file:line:col` pill above. The pill starts neutral (grey
`loading…`, no editability claim); once the pointer rests on one element for a
moment, the source AST is consulted and both name the verdict a click would
get — the pill in words (**editable**, **image**, or **dynamic**), the box in
colour. Verdicts are remembered until the file next changes, so known elements
show theirs instantly.

Clicking the pill's `file:loc` label opens a **source peek** — a wide
read-only panel showing the whole file syntax-highlighted, with line numbers,
scrolled to the element's line (highlighted and centered; scroll for full
context) — while the **open** button next to it jumps to the location in your
editor. The refusal notice's location line opens the same peek, so you can
see *why* something refused without leaving the browser. The peek's footer
has its own **Open in editor** jump-out.

## Copy context for an AI assistant

Next to `open` the pill has a **`copy context`** button. It puts what the
overlay knows about that element on your clipboard as one markdown block,
shaped for pasting into an assistant along with what you want changed:

- the element's **source location**, repo-relative (`src/pages/index.astro:12:3`),
  the **page URL**, its **DOM path**, and the page's **content entry** when it
  declares one;
- the **rendered HTML** of the element (the overlay's own nodes stripped out);
- the **source lines** around it — five either side, with `>` marking the
  element's own line — read through the same `/peek` endpoint the source peek
  uses. A location the server won't serve (an `astro:assets` `<Image>`, say)
  says so here instead, and the rest is still copied;
- **the CSS rules that apply to it**, with the stylesheet each came from —
  read from the browser, so only rules matching *this* element are listed, not
  ones it inherits from an ancestor.

It is a short block on purpose: its job is to say *which* element and *where*,
tightly enough that the subject is the first thing read. Open the source peek
when you want the surrounding file, and the CSS inspector when you want every
rule.

The copy is capped — 4 000 characters of HTML and 12 rules, the rules naming
this element kept ahead of the site-wide ones it merely matches — and says in
the payload when a cap applied, so nothing is silently left out. If your browser
refuses clipboard access (reaching the dev server over a network address is not
a secure context, so the API is simply absent) the text opens in a panel,
preselected, to copy by hand.

## CSS inspector

The pill also lists the element's **classes and ID** as chips (turn this off
with `cssInspector: false`). Hover a chip to pop a card of the CSS rules that
element actually matches through that class/ID — selector and declarations,
read straight from the browser, so it works without any server round-trip.
Each rule whose source can be resolved offers an **open** that jumps your
editor to (near) the rule; rules from cross-origin/CDN stylesheets or an inline
`<style>` still show their CSS but have no jump. The jump also honours
`openInEditor`, and reaches `.css` files as well as `.astro` `<style>` blocks
(still confined to `contentRoots`, so `node_modules`/external CSS is excluded).

## The admin bar

Every global control lives in a slim bar across the top of the page:

- **Elements** — show or hide the [element tree](#element-tree), which edit mode
  leaves closed unless you ask for it. Asking for it from a cold page turns edit
  mode on with it, since the tree's row highlights only mean anything while
  editing.
- **Edit page** — the edit-mode toggle.
- **Edit entry** — on pages that declare a backing content file, opens the
  [entry drawer](ENTRY-EDITOR.md).
- **The pin** — lit while the bar is pinned. Unpin it and the bar slides off the
  edge leaving a thin accent line, returning the moment the pointer reaches that
  edge again. **Edit mode overrides it**: while you are editing, the bar stays out
  whether it is pinned or not, since it carries the save state and the way out.
- **The dock button** — moves the bar to the **bottom** of the viewport, for
  sites whose own chrome lives at the top.
- **The purple mark** — the overflow menu plus the dev-server status. It holds
  *Open page source*, which opens **the file the page itself is written in** —
  resolved from Astro's own route manifest, so a page that mostly composes
  components opens the page rather than the busiest component, and a URL that
  matches no route says so instead of guessing;
  *Collections*, the [collection and field designer](ENTRY-EDITOR.md#collections--the-collection-designer);
  and *Settings*, where [every integration option](../README.md#options) — including the
  [Unsplash access key](MEDIA.md#unsplash-photo-picker) — is editable.

The bar **overlays** the page rather than pushing it down: the top edge is where
sticky site headers live, and reflowing the page would change the very layout
you are editing. It stays semi-transparent until the pointer comes near. Pin
state and edge are remembered per browser.

**The exit button is the save indicator.** In edit mode a button appears at the
right end that answers "is my work on disk?" without guessing:

| Button | Meaning |
| --- | --- |
| green **Done** | nothing pending — everything typed is written |
| purple **Save & exit** | an inline edit, or an open source popup, has unsaved keystrokes |
| grey **Saving…** | the write is in flight |
| green **Saved** | it just landed |
| red **Save failed** | the write was refused and the change rolled back |

Every way out of edit mode goes through it, so leaving **saves first and exits
after the write lands** — no path out silently drops what you typed. Throwing an
edit away stays deliberate: press **Escape** while editing.

**Panels and drawers are modal.** While one is open, the keyboard stays in it:
Tab cycles through its own controls and wraps, the page behind it and the bar
above it are out of reach, Escape closes it, and focus returns to whatever you
were on when it opened. Each announces itself as a dialog, named by its title.

## Element tree

A **tree of the page's elements** — every source-annotated element, nested by
structure — docks to the left edge on request. It is **opt-in**: edit mode leaves
it closed and puts a small tab on the left edge, and it opens when you click that
tab or **Elements** on the bar (so entering edit mode never covers the page you
came to edit). It's two-way linked to the page: hovering a row outlines the
matching element (with the same verdict pill and class/ID chips), and hovering an
element on the page highlights its row and scrolls the tree to it.

Clicking a row **selects** the element — a persistent outline that stays put
while you move the mouse onto the element to inspect it. The selection clears
only when you press **Escape**, click elsewhere on the page, or select another
row (plain hovering never changes it). **Double-click** a row to open the editor
for that element, exactly as a page click would. Each row's **`line:col`** is a
jump-out — click it to open that file at that line in your editor (the same
`/open` the hover pill's **open** button uses). The tree collapses per node, rebuilds
itself after each save, and is overlaid by the entry drawer when that's open.
Leaving edit mode hides it. Closing it with its ✕ while still editing leaves the
left-edge tab that brings it back — as does **Elements** on the bar. Whether it
was open is remembered for the session, so a save-triggered reload restores it
the way you left it.

