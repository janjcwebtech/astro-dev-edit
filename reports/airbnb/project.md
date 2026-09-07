# Project orientation — Apartamento Miramar (airbnb example)

Run label: **airbnb-2026-09-06**. This file orients a tester on the *target*; it
does not restate the integration's architecture or feature manual.

## What was tested

| | |
| --- | --- |
| Target | `examples/airbnb/05-development/astro-site` (package `apartamento-miramar` 0.1.0) |
| Served at | <http://localhost:4325/> (`astro dev --port 4325`) |
| `/__dev-edit/health` `root` | `…/examples/airbnb/05-development/astro-site/` — confirmed the served project |
| Astro | **5.18.2** (`^5.0.0`) |
| Integration | `astro-dev-edit` 0.7.1, working tree `d62acf7`, linked with `file:../../../../` |
| Target repo revision | `137c2db`, clean tree at start |
| Node / browser | v24.13.0 / Chromium via Playwright MCP |
| Health flags | `cssInspector` `openInEditor` `entryEditor` all true; `unsplash` false |

The airbnb example is its **own git repository** nested inside the integration
repo, with numbered project-phase directories; the Astro site is only
`05-development/astro-site`.

## Documentation to read first

Nothing here duplicates these — read them, not this file, for how the tool works.

| Need | Reference |
| --- | --- |
| Purpose, install, options table, supported scope | [README.md](../../README.md) |
| Architecture, source ownership, conventions | [Architecture](../../docs/ARCHITECTURE.md) |
| Text/image editing, refusals, hover pill, Elements | [docs/EDITING.md](../../docs/EDITING.md) |
| Entry drawer, widgets, page-source meta, Collections | [docs/ENTRY-EDITOR.md](../../docs/ENTRY-EDITOR.md) |
| Media picker, uploads, Unsplash | [docs/MEDIA.md](../../docs/MEDIA.md) |
| Standing verification matrix | [docs/VERIFICATION.md](../../docs/VERIFICATION.md) |
| The target's own orientation | `examples/airbnb/05-development/astro-site/README.md` |
| The target's original integration spec (historical) | `examples/airbnb/05-development/astro-edit-integration-spec.md` |

Prior exploration against a **different** consumer (this repo's playground, Astro
7.1.1): `notes/astra-test-results.md`, `notes/astra-found-bugs.md` and
`notes/project.md` (local, gitignored).
Those are historical; this run's regression outcomes are in
[tests.md](tests.md).

## Navigation context a new tester will want

**Installing the tool here is not one command.** The site's `astro.config.mjs`
imports the package under its **pre-rename name** `astro-text-edit`, and wraps
the import in a `try/catch` that swallows `ERR_MODULE_NOT_FOUND` — so a wrong
install makes the overlay *silently absent* rather than failing. What worked:

```sh
cd examples/airbnb/05-development/astro-site
npm install
npm install --no-save --no-package-lock "file:../../../../"   # → node_modules/astro-dev-edit
ln -s ../../../../.. node_modules/astro-text-edit             # alias for the config's old import
npm run dev -- --port 4325
```

Both are `node_modules`-only; no project source is touched. Confirm with
`/__dev-edit/health` before trusting any browser result. See SETUP-1 in
[bugs.md](bugs.md) for the second half of the same staleness.

**A different regime from the playground.** Astro 5 means the *compiler* emits
`data-astro-source-*` and the dev toolbar is required; the integration's own
`annotate.ts` injector is not in play here. Astro's toolbar then strips the
attributes from the live DOM, so `document.querySelectorAll('[data-astro-source-file]')`
returns **0** on a loaded page — that is normal, not a fault. Read the raw
annotations with `curl` if you need them.

**Content shapes that make this target useful.**

- One collection, `posts` — 12 MDX files, `glob` loader, a plain `z.object`
  schema exercising enum, `z.coerce.date()`, optionals, string defaults and
  boolean defaults.
- `image` is a **plain `z.string()`** path into `/public/photos`, *not* Astro's
  `image()` helper — so the entry drawer renders it as a text box, and the
  collection designer refuses to add an `image()` field with an explanation.
- Two clusters (`area`, `remote-work`) routed by a frontmatter enum through two
  `[...slug].astro` routes sharing one `PostLayout`.
- Real pre-existing HTML entities in copy (`Privacy &amp; legal`,
  `Jan &amp; Carolina`) — the natural test material for escaping round-trips.
- `src/lib/site.ts` holds imported constants, and `SiteHeader.astro` builds its
  nav from a local `links` array — the two different expression cases.

**`astro-click-to-source` is also installed** and binds Alt+Click. The two tools
coexist: Alt+Click reaches `/__open-in-editor` (click-to-source), plain click
reaches astro-dev-edit. Don't attribute one's behaviour to the other.

**Ports.** Don't assume 4321 — this site's README says 4321, its `site` fallback
says 4323, and this run used 4325. The health endpoint's `root` is the only
reliable identity.
