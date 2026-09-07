# Evidence — sf-sf

Two files from this pass are **not kept here**, because both carry the client
site's own material and the clone they came from is gitignored for exactly that
reason:

-   `build.log` — the restored consumer's `astro build` output (T51). 950 lines
    naming the site's asset files, and through them its client list. The result
    it evidenced: exit 0, 88 pages, 782 image-optimization outputs, 22.01 s.
-   `test-mutations.diff` — the reviewable diff of the five source files edited
    during testing, captured before cleanup. 132 lines of verbatim component
    source. The finding it evidenced is [SF-02](../bugs.md), reproduced from the
    integration's own side by `tests/frontmatter.test.ts`; the restoration it
    documented is recorded in [restoration.json](restoration.json) and in
    [tests.md](../tests.md) §Cleanup.

What remains is the integration's own output, which names nothing of the
client's: [production-scan.json](production-scan.json) and
[restoration.json](restoration.json).

The pass's `unit-tests.log` and `typecheck.log` stay local — the repo ignores
`*.log`, and both are reproducible on demand with `npm test` and
`npm run typecheck`. Their results are recorded in [tests.md](../tests.md)
(T49, T50).
