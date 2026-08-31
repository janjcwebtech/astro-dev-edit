# Styling the overlay

Every overlay element carries a stable `atx-` class, and the singletons carry
IDs. Use them to reference elements from devtools or to override styling.

- [The three rules](#the-three-rules)
- [Hook reference](#hook-reference)
- [Sites with smooth scrolling](#sites-with-smooth-scrolling)
- [Native form chrome](#native-form-chrome)
- [Contrast](#contrast)

## The three rules

**1. Baseline styles are inline, so your overrides need `!important`.** They
are inline on purpose — inline wins specificity against any host-page CSS, so
the overlay renders correctly on every site it is dropped into.

```css
/* e.g. keep the admin bar fully opaque, even at rest */
#atx-bar { opacity: 1 !important; }
```

**2. That protection is per element, not per subtree.** An inline colour on a
panel does not shield a child that takes its colour by inheritance, because an
ordinary `p { color: … }` or `label { … }` rule on your page outranks an
inherited value. Every piece of text in the overlay therefore sets its own
colour, so styling elements by tag on your site cannot repaint it. If you
*want* to re-colour the overlay, target the hooks below with `!important`
rather than element selectors.

**3. One exception to the inline rule.** The rich editor's *content* elements
(headings, lists, quotes… that you create while typing) are styled by a small
injected stylesheet, `#atx-rte-style`, scoped under `.atx-rte-content`. Those
rules are ordinary CSS, so overriding them needs specificity, not `!important`.

## Hook reference

Grouped by the surface that owns them. `<name>`/`<group>`/`<id>` mark a
suffix filled in at runtime — `atx-collections-row-blog`,
`atx-settings-pane-media`.

| Surface | Hooks |
| --- | --- |
| **Admin bar** | `#atx-bar`, `atx-bar-group`, `atx-bar-group-right`, `atx-bar-sep`, `#atx-bar-brand` (the mark that opens the overflow menu), `atx-bar-btn` (+ `atx-bar-btn-icon` when icon-only, with the text in `atx-bar-btn-label`), `#atx-bar-elements`, `#atx-toggle` (Edit page), `#atx-entry` (Edit entry), `#atx-bar-pin`, `#atx-bar-edge`, `#atx-bar-exit` (the save-state exit button), `#atx-bar-hint` (the "hold … to navigate" note), `#atx-hairline` + `atx-hairline-nub` (the line an unpinned bar leaves behind) |
| **Overflow menu** | `#atx-menu`, `atx-menu-item`, `atx-menu-foot`, `atx-menu-live` (the dev-server status dot), and one id per entry — `atx-menu-page-source`, `atx-menu-collections`, `atx-menu-items`, `atx-menu-settings` |
| **Hover pill** | `#atx-outline` (the highlight), `#atx-tooltip` with `atx-tooltip-row` (the loc/verdict line), `atx-tooltip-loc`, `atx-tooltip-label`, `atx-tooltip-verdict` (fixed-width verdict slot), `atx-tooltip-open`, `atx-tooltip-copy` |
| **CSS inspector** | `atx-tooltip-chips` / `atx-tooltip-chip` (the class/ID row); the rules card `atx-tooltip-rules` with `atx-tooltip-rule` per rule (`atx-tooltip-rule-sel`, `atx-tooltip-rule-decl`, `atx-tooltip-rule-foot`, `atx-tooltip-rule-src`, `atx-tooltip-rule-open` inside it) and `atx-tooltip-rules-empty` |
| **Element tree** | `atx-tree` (the left panel), `atx-tree-title` / `atx-tree-title-text` / `atx-tree-close` (header), `atx-tree-body` (scroll container), `atx-tree-row` with `atx-tree-chevron`, `atx-tree-tag`, `atx-tree-preview`, `atx-tree-loc`; `atx-tree-empty`, `atx-tree-selection` (the locked-selection outline), `#atx-tree-tab` (the edge tab that reopens a closed tree) |
| **Source peek** | `atx-peek-code` (scroll container), `atx-peek-line` / `atx-peek-focus` (rows), `atx-peek-gutter`, `atx-peek-text`, `atx-peek-more` (the "⋯ N more lines" markers), `atx-peek-loading` |
| **Panels and drawers** | `atx-panel`, `atx-panel-title` (with `atx-panel-heading` and, on the source popups, the `atx-panel-open` jump-to-editor button), `atx-panel-body`, `atx-panel-foot`; `atx-drawer` with `atx-drawer-title` / `atx-drawer-title-text` / `atx-drawer-body` / `atx-drawer-foot` / `atx-drawer-actions`; `atx-backdrop`, `atx-toast` (+ `atx-toast-ok` / `atx-toast-err`), `atx-veil` / `atx-veil-chip` (the editable-text veil), `atx-note`, `atx-section-label` |
| **Buttons and icons** | `atx-btn` plus one of `atx-btn-default`, `atx-btn-secondary`, `atx-btn-outline`, `atx-btn-ghost`, `atx-btn-destructive`; `atx-btn-retry`; `atx-pill-label` (the swappable label inside a hover-pill button); `atx-ico` (every icon — an inline SVG inheriting `currentColor`) |
| **Source popups** (markup, value) | `atx-popup-label`, `atx-popup-input`, `atx-popup-error`; the markup palette's `atx-markup-tags` (the row), `atx-markup-tag` (one per insertable tag), `atx-markup-hint` |
| **Refusal notice** | `atx-notice-reason`, `atx-notice-loc`, `atx-notice-hint` |
| **Image swap panel** | `atx-image-preview` / `atx-image-preview-img`, `atx-image-meta`, the recents strip `atx-image-recents` (`atx-image-recents-label`, `atx-image-recents-title`, `atx-image-recent`, `atx-image-recent-thumb`), `atx-image-browse-all`, `atx-alt-label` / `atx-alt-input` |
| **Media picker** | `atx-media-tabs` / `atx-media-tab` (+ `atx-media-tab-project` / `-unsplash`), `atx-media-host`, `atx-media-toolbars` / `atx-media-toolbar`, `atx-media-sort`, `atx-media-upload`, `atx-media-content`, `atx-media-panes`, `atx-media-pane` (+ `atx-media-pane-project` / `atx-media-pane-unsplash`), `atx-media-grid`, `atx-media-tile` wrapping `atx-media-pick` with `atx-media-thumb`, `atx-media-fallback`, `atx-media-skeleton`, `atx-media-check` (selection badge) and `atx-media-current` (the "Current" chip); `atx-media-cap` (the caption, a *sibling* of the button), `atx-media-file`, the details rail `atx-media-rail` with `atx-media-rail-preview|img|title|line|key|value|empty`, `atx-media-status`, `atx-media-more` (Load more), `atx-media-drop` / `atx-media-dropzone` (the drag overlay), `atx-media-error`; the shared filter controls `atx-asset-filter` and `atx-asset-scope` (the "Show all" toggle) |
| **Unsplash pane** | `atx-unsplash-search`, `atx-unsplash-input`, `atx-unsplash-orient` (the shape filter), `atx-unsplash-width` (the per-import size select), `atx-unsplash-credit` with `atx-unsplash-author` and `atx-unsplash-link`, `atx-unsplash-rate` (the requests-left line) |
| **Entry drawer fields** | `atx-field` with `atx-field-label`, `atx-field-input`, `atx-field-help`, `atx-field-error`, `atx-field-check`, `atx-field-check-hint`; the image control's `atx-image-field` with `atx-image-field-row|preview|thumb|empty|path|hint|browse` |
| **Rich body editor** | `atx-rte`, `atx-rte-head` (sticky toolbar + image panel), `atx-rte-toolbar`, `atx-rte-btn`, `atx-rte-divider`, `atx-rte-content`, `atx-body-input` (the raw-markdown view), the heading control `atx-rte-heading` with `atx-rte-heading-chip|menu|item|name`, the image panel `atx-rte-image-panel` with `atx-rte-image-slot`, `atx-rte-image-actions`, `atx-rte-image-alt` and `atx-rte-image-alt-label`, and `#atx-rte-style` (see rule 3) |
| **Settings drawer** | `atx-settings-tabs` / `atx-settings-tab` (+ `atx-settings-tab-<group>`), `atx-settings-host` (the active pane's host), `atx-settings-pane` (+ `atx-settings-pane-<group>`), `atx-settings-lock`, `atx-settings-key-section`, `atx-settings-key-status`, `atx-settings-key-actions`, and `atx-settings-heading|blurb|link|status|text|row|key|hint|warning|error`. Each option control is a standard `atx-field`, the same hooks the entry drawer uses |
| **Collection designer** | `atx-collections` (the pane) with `atx-collections-list` / `atx-collections-row` (+ `atx-collections-row-<name>`) / `atx-collections-row-name|meta`; `atx-collections-detail` (+ `atx-collections-detail-<name>`), `atx-collections-head|title|back|meta|spacer|badge|blurb|note`, the two-store legend `atx-collections-legend` with `atx-collections-legend-line` and `atx-collections-legend-word`; the view tabs `atx-collections-view-tabs` / `atx-collections-view-tab` (`-fields` / `-items`) / `atx-collections-view-host`; `atx-collections-fieldspane`, `atx-collections-fields`, `atx-collections-field` (+ `atx-collections-field-<name>`) with `atx-collections-field-head|name`, `atx-collections-group` (+ `atx-collections-group-schema` / `atx-collections-group-editor`), `atx-collections-caption`, `atx-collections-control` / `atx-collections-control-label`, `atx-collections-input|select|checkbox|check|check-hint`, `atx-collections-expr` (the zod expression line), `atx-collections-new` / `atx-collections-new-name` / `atx-collections-new-meta` (a queued addition), `atx-collections-addfield`, `atx-collections-pending`, `atx-collections-actions`, `atx-collections-error`, `atx-collections-create` / `atx-collections-newfields`; the Items view's `atx-collections-items`, `atx-collections-itembar|itemcount`, `atx-collections-item` / `atx-collections-item-title` / `atx-collections-item-meta` |
| **Clipboard fallback** | `atx-copy-note`, `atx-copy-text` |

## Sites with smooth scrolling

Smooth-scroll libraries (Lenis, Locomotive, GSAP ScrollSmoother) listen for
`wheel` on `window` and `preventDefault()` it, driving the page from their own
animation loop — which normally stops any nested container from scrolling, so
the page slides around underneath an open panel instead. Every scrollable
surface in the overlay (source peek, drawer and panel bodies, the asset list,
the rich body editor) opts out of that: it sets `overscroll-behavior: contain`,
carries the `data-lenis-prevent` / `data-scroll-ignore` attributes those
libraries look for, and stops `wheel`/`touchmove` from reaching window-level
listeners. Nothing calls `preventDefault`, so normal page scrolling outside the
overlay is unaffected. No configuration needed; if you use a smooth-scroll
library with a different opt-out convention, adding its attribute to
`.atx-peek-code` (and the other surfaces above) from your own CSS/JS is enough.

## Native form chrome

Form controls declare `color-scheme: dark`, so the browser renders native
chrome — the date field's calendar-picker icon and popup, number-input
spinners — in light colours that stay visible against the dark inputs. If you
re-theme the inputs to a light background, override this to `light !important`
so those native controls flip back.

## Contrast

The overlay's colours are semantic design tokens on the
[shadcn/ui](https://ui.shadcn.com) naming scheme — `background`, `card`,
`elevated`, `border`, `input`, `ring`, `foreground`, `mutedFg`, `primary`,
`destructive` and the rest — authored in OKLCH and defined in
`src/client/ui.ts`. The greys are achromatic, so nothing in the overlay's own
chrome carries a hue; only the brand and status tokens do. `RADIUS` is the
matching corner scale, on shadcn's single-knob `sm`/`md`/`lg`/`xl` steps.

Every ink clears **WCAG AA** (4.5:1) against all three surfaces it can land on,
and control boundaries clear the 3:1 that applies to a control's outline;
`tests/contrast.test.ts` holds every token to it, and also pins that the greys
have no hue. The rich-text editor is the one light surface, with its own
`PAPER` token group checked against its own ground.

**One deliberate exception:** the admin bar is semi-transparent until the
pointer comes near, and a chip label on the *resting* bar over a light page
measures 4.31:1 — just under AA. Approached or in edit mode it is 9.53:1. The
bar being recessive until you reach for it is the intent, so the resting
opacity stays as it is; it is tracked as a `deferral` on the roadmap rather
than fixed.

If you re-theme the panels, note that a lighter panel background will need
darker inks to keep AA.
