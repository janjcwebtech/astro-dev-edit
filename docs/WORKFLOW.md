# Working on this repo

How work is tracked, how the docs stay honest, and how releases are cut.

## Commands

```bash
npm run typecheck          # tsc --noEmit; the primary correctness gate (no build)
npm test                   # vitest run
npm run test:watch         # vitest watch
npx vitest run tests/frontmatter.test.ts      # a single file
npx vitest run -t "verifies before writing"   # tests matching a name
```

There is no lint step and no `dist/`. `npm run typecheck` is the build-equivalent check; run it after any change.

## Manual verification

Verify in `examples/playground`, never against a real consuming site — a site installs this integration as a normal dependency and does not see uncommitted `src/` changes.

```bash
cd examples/playground && npm run dev   # file:../.. symlink → runs live src/
```

The playground consumes the integration through a `file:../..` symlink, so Vite compiles the working-tree source on the fly. Edits made through the overlay write into the playground's own `src/pages/index.astro` — restore the fixture afterwards. Astro's dev toolbar must be enabled (`devToolbar.enabled`), since it is the source of the `data-astro-source-*` attributes the whole feature depends on.

[Verification map](VERIFICATION.md) is the runbook: every feature area with the test file that pins it, plus the manual playground checklist. It stays current — a change that adds, removes or reshapes functionality updates its matrix in the same commit, and a manual-only behavior that gains a test moves into the automated table.

## Issues

**GitHub issues are the home for every kind of work** — bugs, deferrals, features, docs, chores, TODOs. There is no in-repo TODO list; anything that would have gone in one becomes an issue.

```bash
gh issue create --repo janjcwebtech/astro-dev-edit --title "…" --body-file …
```

Each issue carries a **type label**:

- **`bug`** — broken behavior against the documented intent.
- **`deferral`** — a documented, *intentional* behavior quirk (entity decoding, verify strictness, partial-failure windows). Search the open `deferral` issues before "fixing" one.
- **`enhancement`** / **`chore`** / **`documentation`** — planned-but-absent behavior, housekeeping, doc work.

…and an **`area:` label** naming the architecture layer it lands in: `area: client`, `area: server`, `area: patcher`, `area: protocol`, `area: docs`, `area: compat`. Together they carry on the issue what `Type` and `Area` carry on a board row, so an issue does not need a board row to be classified. (`Priority` has no label equivalent and is board-only.)

Write an issue as: the offending code with `file:line`, the mechanism, symptoms as seen by a consuming project, what is *not* affected, the fix shape plus the regression test that should pin it, and any workaround currently in place downstream. [Issue #2](https://github.com/janjcwebtech/astro-dev-edit/issues/2) is the worked example. File it as a real issue, never a board draft — a draft has no URL to reference from a commit, a downstream repo, or a fix PR.

## The project board

The board is the **roadmap**, not the work queue: it holds planned direction. Something goes on it only when the maintainer explicitly asks — never as a follow-up to filing an issue. Mirroring every issue onto the board is what produced duplicate rows, the same bug once as an issue and once as a board item.

Board view (board layout): <https://github.com/users/janjcwebtech/projects/1/views/1?layout=board>

⚠️ **GitHub re-adds issues to the board automatically.** The project's built-in *Auto-add to project* workflow (`#7`, enabled) puts every newly created repo issue on the board at `Backlog` with no `Type`, re-creating the duplicate row the rule above exists to prevent. It cannot be disabled through the API — only in the project UI under ⋯ → **Workflows**. Until it is off, check the board after filing an issue and delete the row it added: `gh project item-list 1 --owner @me --format json` for the item id, then `gh project item-delete 1 --owner @me --id <item id>`.

A roadmap item carries four fields:

- **Status** — `Backlog` → `Next` → `In progress` → `Done`
- **Priority** — `High`, `Low`
- **Type** — `feature`, `fix`, `docs`, `chore`, `deferral`
- **Area** — `client`, `server`, `patcher`, `protocol`, `docs`, `compat`

Reading and updating it from the CLI needs the `project` OAuth scope (`gh auth refresh -s project`). It is project `#1` owned by `@me`:

```bash
gh project item-list 1 --owner @me
gh project item-create 1 --owner @me --title "…" --body "…"   # --body, not --body-file
gh project item-add 1 --owner @me --url …                     # promote an existing issue
```

Setting a field needs the numeric project id plus field and option ids — `gh project view 1 --owner @me --format json` and `gh project field-list 1 --owner @me --format json`, then `gh project item-edit --id <item> --project-id <pid> --field-id <fid> --single-select-option-id <oid>`. Views, Status options and workflows cannot be scripted.

## Docs and the changelog

**`CHANGELOG.md`** gets an entry under `[Unreleased]` for every user-visible change — feature, fix, behavior or option change, security tightening — in the appropriate Keep-a-Changelog section, in the same commit as the change.

The README is the **index**, not the whole of it: the pitch, install, a short list of what can be edited, a small annotated gallery, undo-is-git, scope and limitations, and a link per surface. Detail lives in the docs, and a change lands in whichever one owns it, in the same commit:

| Change to… | Update |
| --- | --- |
| an option (`OPTION_SPECS`) | the options table in [CONFIGURATION.md](CONFIGURATION.md) |
| what can be edited, refusal behavior, hover pill, peek, admin bar, element tree | [EDITING.md](EDITING.md) |
| the entry drawer, widgets, the meta tag, the collection designer | [ENTRY-EDITOR.md](ENTRY-EDITOR.md) |
| the media picker, uploads, Unsplash | [MEDIA.md](MEDIA.md) |
| a `--atx-*` custom property or a `::part()` name | [STYLING.md](STYLING.md) — those two tables are the theming API and must stay exact |
| a module's role, a layer invariant, an extension seam | [ARCHITECTURE.md](ARCHITECTURE.md) |
| a token, radius, control size or look rule | [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) |
| a test area, or a manual check that gained a test | [VERIFICATION.md](VERIFICATION.md) |

`docs/ASTRO-COMPAT.md` is gitignored — never link it from a doc, or the link 404s on GitHub.

### Keeping the docs from turning back into a changelog

The README once reached ~6 900 words — a 35-minute read before `npm install` — because each release's changelog entry was paraphrased into it and nothing was taken out. Every entry was individually accurate; it just grew. Three rules stop that recurring, and they govern `docs/` as much as the README.

**Docs are present tense; the changelog owns the delta.** Write what the tool *does*, never what changed about it. A sentence that only means something to a reader who remembers the old behavior is a changelog entry in the wrong file.

```
✗ Every import used to fetch a 2400px JPEG. The width is now yours to choose.
✓ Imports are fetched at the width you choose — `importWidth`, or the size select in the picker.
```

Check it with:

```bash
grep -nE '\b(now|no longer|used to|previously|has been|replaces|instead of)\b' \
  README.md docs/*.md
```

Every hit needs a reason. Comparing *this tool to its own past* is the leak; comparing external things is fine and stays (Astro 5 vs 7 — "the Rust compiler no longer emits them").

**Edit in place; never append.** Behavior changed means a sentence somewhere is wrong: find it and rewrite it. Adding a paragraph without deleting one is the tell — genuinely additive behavior is rarer than it feels. A new feature does not earn a new README section; it goes in the doc that owns that surface, and at most rewords the one summary paragraph the README already gives it.

**Budget: README ≤ 3 000 words** (`wc -w README.md`). Past that, something moves to `docs/` — the budget does not rise. A single doc past ~2 500 words wants splitting. `CHANGELOG.md` is the one user-facing file that is legitimately append-only; every other one gets rewritten.

## Releases

Semver, applied at release time — when work is stamped out of `[Unreleased]` — not per commit.

- **Patch (`0.0.x`)** — a release containing only fixes.
- **Minor (`0.x.0`)** — a release containing feature work. While in `0.x`, breaking changes may ride along in minors.
- **Major (`X.0.0`)** — only on the maintainer's explicit confirmation.

Stamping a release is one commit on `main`: rename `[Unreleased]` to the new version with the date, bump `version` in `package.json` to match, and tag `vX.Y.Z`.

## Real-site test passes — `reports/`

Manual passes driven against **real consuming sites**, cloned into `examples/` and gitignored so a client's source never lands in this repo. One directory per site, holding the executed tests and their outcomes, the findings, and any evidence captured. Read the latest pass before planning client-layer work — it is the only coverage the overlay has beyond `markdown.ts`.

The reports are the **evidence, not the queue**: every finding worth acting on is filed as an issue, and the report is what the issue points back to. Do not re-derive a fix list from a report without checking what was already filed.

An edit made while testing is restored before the pass ends, and a pass makes no implementation fixes — finding and fixing in one sitting is how a report stops matching what was actually observed.

## Where a thing is written down

- **Rules for the agent** → `CLAUDE.md` (gitignored)
- **User- and contributor-facing** → `README.md` and `docs/`
- **How outside contributions work** → [`CONTRIBUTING.md`](../CONTRIBUTING.md) and [`SECURITY.md`](../SECURITY.md), which GitHub links from the issue and pull request forms
- **Tasks** → GitHub issues
- **Background and research** → `notes/` (gitignored) — [`SIMILAR-TOOLS.md`](../notes/SIMILAR-TOOLS.md), [`RESEARCH-NOTES.md`](../notes/RESEARCH-NOTES.md). Never rules, never tasks.
