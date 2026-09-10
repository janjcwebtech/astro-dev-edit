# Contributing

Thanks for taking a look. This is a one-person project, so here is how it works.

## Reporting a bug

Open an issue: <https://github.com/janjcwebtech/astro-dev-edit/issues>

Tell me your Astro version, your Node version, and what you clicked. If the overlay refused an edit, paste the notice it showed you. A snippet of the `.astro` file or the entry the element came from usually settles it in one round.

Some behaviour that looks wrong is deliberate, and those are filed as `deferral` issues. Search the open ones before you write yours up.

Never paste a client's source into an issue. A reduced example on a fresh `npm create astro` project is worth more anyway.

## Proposing a change

Fork the repo, work on a branch, and open a pull request. I review and merge everything myself, so expect a wait, and expect me to turn down things that widen the scope. If your change is bigger than a fix, open an issue first and let us agree on the shape of it before you spend an evening on it.

Two things I will always check:

- It stays dev-only. `astro:config:setup` bails unless `command === 'dev'`, so nothing in here can reach a production bundle, and any new hook work has to keep that guard.
- It writes nothing outside the confinement. Every *client-supplied* path goes through `validateEditablePath`, and every write is atomic and verified against the source the page actually showed. The handful of fixed targets — the settings file, `.env.local`, the project's `content.config.ts` — are constants in server source rather than anything a request can name, and a file holding a secret is written `0600`.

[Architecture](documentation/ARCHITECTURE.md) is the tour. It will save you reading the whole `src/` tree to work out where your change belongs, and most extensions are one entry in a registry rather than a new branch in an existing module.

## Before you open the PR

```bash
npm run typecheck   # there is no build step, so this is the build
npm test            # vitest
```

Check anything that touches the overlay by hand in `examples/playground`, never against a real site: a real site installs this as a normal dependency and will not see your working tree.

Two more things, if the change is visible to someone using the tool:

- A line under `[Unreleased]` in `CHANGELOG.md`. One sentence, past tense, no essay.
- The doc in [`documentation/`](documentation/) that owns the surface you changed, in the same commit — options go in `CONFIGURATION.md`, editing behaviour in `EDITING.md`, the entry drawer in `ENTRY-EDITOR.md`, images in `MEDIA.md`, `--atx-*` and `::part()` names in `STYLING.md`.

## Sign your commits

Every commit needs a `Signed-off-by` line:

```bash
git commit -s -m "your message"
```

That line is the [Developer Certificate of Origin](https://developercertificate.org/). You are stating that you wrote the code or have the right to submit it, and that it can ship under the project's license. I cannot merge commits without it.

## License

The project is MIT, and your contribution goes in under MIT.
