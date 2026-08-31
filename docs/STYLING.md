# Styling the overlay

The overlay draws itself inside a **shadow root** on a single `<astro-dev-edit>`
element at the end of `<body>`. That boundary is the point: your site's CSS
cannot reach the overlay, and the overlay's CSS cannot reach your site. A
`*{ color: red !important }` on your page leaves the toolbar untouched, and the
overlay's own styles can never leak into your layout.

Two consequences, and they are the whole of this page:

- Your CSS **cannot** target the overlay's internal classes. Selectors do not
  cross a shadow boundary in either direction, `!important` included — it cannot
  win a match it is unable to make.
- Theming happens through the two mechanisms that *do* cross: **custom
  properties** for values, and **`::part()`** for structure.

- [Custom properties](#custom-properties)
- [Parts](#parts)
- [The rich-text editor is the exception](#the-rich-text-editor-is-the-exception)
- [Internal class hooks](#internal-class-hooks)
- [Sites with smooth scrolling](#sites-with-smooth-scrolling)
- [Native form chrome](#native-form-chrome)
- [Contrast](#contrast)

## Custom properties

Custom properties inherit through a shadow boundary, so setting one on the host
element reaches every surface that reads it. Set them on `astro-dev-edit`:

```css
astro-dev-edit {
  --atx-card: #101014;        /* panel and drawer surface */
  --atx-radius-xl: 6px;       /* squarer panels */
}
```

The names are the overlay's design tokens, kebab-cased and prefixed. Surfaces:
`--atx-background`, `--atx-card`, `--atx-elevated`, `--atx-border`,
`--atx-input`, `--atx-ring`. Ink: `--atx-foreground`, `--atx-muted-fg`,
`--atx-faint-fg`. Accents: `--atx-primary`, `--atx-primary-fg`,
`--atx-primary-text`, `--atx-destructive`, `--atx-destructive-text`,
`--atx-destructive-border`, `--atx-success`, `--atx-success-text`,
`--atx-warning`, `--atx-info`, `--atx-chart1` … `--atx-chart5`, and the two
translucent surfaces `--atx-glass` and `--atx-glass-raised`. Radii:
`--atx-radius-sm|md|lg|xl|full`. Fonts: `--atx-font-ui`, `--atx-font-mono`.

Every property is defined on the host, so a value you do not set keeps its
built-in default, and the palette is contrast-checked as a set — a token you
override is yours to keep legible.

## Parts

For anything a value cannot express — moving a surface, hiding one, restyling
its box — the overlay exposes six parts:

| Part | Surface |
| --- | --- |
| `bar` | the admin bar |
| `panel` | the centred modal panel shell |
| `drawer` | the side drawer shell (entry editor, settings, collections) |
| `backdrop` | the dim behind a panel or drawer |
| `pill` | the hover pill that names the element under the cursor |
| `toast` | the save confirmation |

```css
astro-dev-edit::part(bar)     { opacity: 1; }        /* never fade at rest */
astro-dev-edit::part(drawer)  { width: 620px; }
astro-dev-edit::part(backdrop){ background: rgb(0 0 0 / .75); }
```

The set is deliberately small — each part is a promise to keep that element's
shape stable. Buttons, fields and rows are not parts: recolour them with the
properties above. If you need one that is not here, open an issue rather than
reaching for a workaround; there isn't one.

## The rich-text editor is the exception

The entry drawer's markdown writing surface, `.atx-rte-content`, lives in the
**light DOM** and is slotted into the drawer. It has to: Safari's selection and
`execCommand` APIs do not operate on a `contenteditable` inside a shadow root,
which would leave the formatting toolbar doing nothing at all.

So that one element — and the headings, lists, quotes and code blocks you create
by typing inside it — is styled by an ordinary document stylesheet,
`#atx-rte-style`, scoped under `.atx-rte-content`. Those rules are reachable
from your CSS, and overriding them needs specificity, not `!important`:

```css
.atx-rte-content blockquote { border-left-color: #888; }
```

It is also the one place your own page styles can bleed into the overlay. If a
global `p { color: … }` shows up in the editor, that is why.

## Internal class hooks

Elements inside the root carry `atx-*` classes, and singletons carry `atx-*`
IDs. They are **internal** — how the overlay's own stylesheet and DOM lookups
find things — and they are not a theming API: your CSS cannot match them across
the boundary, so a rule written against one silently does nothing. They are
still useful for reading the DOM in devtools (inspect the `astro-dev-edit`
element and open its shadow root), and they may be renamed between releases.

## Sites with smooth scrolling

Smooth-scroll libraries (Lenis, Locomotive, GSAP ScrollSmoother) listen for
`wheel` on the window with `{ passive: false }` and `preventDefault()` it,
driving the page from their own animation loop. A scrollable panel inside the
overlay would be frozen by that, so the overlay's scroll containers stop those
events from reaching the page. Your site's smooth scrolling keeps working; the
overlay's own lists scroll normally over it.

## Native form chrome

Form controls in the overlay set `color-scheme: dark`, so browser-drawn parts —
the date input's calendar picker, number spinners, scrollbars — render light on
the dark surface instead of as near-invisible dark glyphs. The markdown writing
surface sets `color-scheme: light` for the same reason, being a light island.

## Contrast

The token palette is authored in OKLCH and verified as a set: text clears WCAG
AA (4.5:1) against every surface it can land on, and control outlines clear
1.4.11 (3:1). `tests/contrast.test.ts` enforces this, so a token change that
would make a panel illegible fails the suite rather than shipping.

If you override colour properties, that guarantee is yours to maintain — the
test checks the built-in values, not yours.
