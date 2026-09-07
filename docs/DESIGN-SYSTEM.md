# Design system

The internal rules behind the overlay's look. The *theming API* a consuming project can reach — the `--atx-*` properties and `::part()` names — is [Styling reference](STYLING.md); this doc is the half that lives inside the shadow root. `ui.ts` holds the tokens, `group.ts` the structures, `styles.ts` the one stylesheet — see [Architecture](ARCHITECTURE.md#client--srcclient).

## The reference is a live page

**Not a memory:** <https://ui.shadcn.com/create?preset=b3yNs0>. It renders the current components in one grid — cards with header/description/corner-action/footer band, field groups, item rows, button groups, inputs, selects, tabs, badges, empty states — on the **stock** theme apart from its accent, so its geometry is the geometry. Re-measure it before any styling work rather than trusting values written down anywhere: sweep `getComputedStyle` over `[data-slot]` elements inside its `<iframe>` (`document.querySelector('iframe').contentDocument`), adding `documentElement.classList.add('dark')` for the dark palette. Two prior passes shipped a look that was visibly off because they followed a snapshot the registry had moved past — the colours held, every geometric figure did not.

## Where style lives

Style lives in the stylesheet; inline is for what a stylesheet cannot know — measured geometry, a computed stacking layer, a caller's size override, a colour chosen per element at hover time. Twelve call sites qualify, plus every write to a *host-page* element (`text.ts`'s contenteditable outline, `overlay.ts`'s body cursor, `isolateScroll`). A value *chosen* at runtime from a fixed set becomes a data attribute instead; the state vocabulary is `[data-on] [data-open] [data-docked] [data-edge] [data-state] [data-active] [data-off] [data-hidden] [data-sized] [data-input] [data-pill] [data-dimmed] [data-shown] [data-leaf] [data-locked] [data-removed] [data-tone] [data-mono] [data-selected] [data-current] [data-credit] [data-flush] [data-token] [data-css]`.

⚠️ **Never read an inline style back as state.** Four functions did, and every one of them was a bug.

## Non-negotiables

- A form control has **no border at rest** — a transparent edge over a translucent fill, with the 1px border held for focus and `aria-invalid`. A deliberate WCAG 1.4.11 deviation, documented at `COLOR.input` and carried by the 3px `ring` instead.
- Radius is one knob off a 10px base: `sm` 6 for a swatch or checkbox, `md` 8 for small and icon buttons, menu items, tree rows and tabs, `lg` 10 for **form controls and full-size buttons alike**, `xl` 14 for panels, drawers and cards, `full` for badges and nothing else.
- Controls are 32px, so a button beside a field lines up; icons inside one are 16px. `accent` is every hover. `[data-dimmed]` and `:disabled` are one population.
- A leaf keeps a bespoke rule only for what the variant cannot know — five buttons each grew a private copy of the outline variant before this was written down.
- The quiet (`ghost`) variant carries full-strength ink and no boundary, so it reads as a button only inside something that already frames it. In a footer band, every Close and Cancel is `outline`.

## Two settled decisions

**Neutral chrome, semantic purple:** the brand `#6144d7` marks editable affordances on the *page*, and the tool's own furniture goes neutral. **Glass is the one tinted grey:** `glass` / `glassRaised` carry chroma 0.012 at the brand hue, because chroma 0 cost the admin bar its apparent transparency — a neutral translucent surface reads as a scrim, not glass. Both are pinned from either side in `tests/contrast.test.ts`.

