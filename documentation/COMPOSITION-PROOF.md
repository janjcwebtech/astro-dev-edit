# Component tracing proof

The `feat/editor-inspector` branch starts with an isolated tracing implementation.
The CMS-capable baseline is preserved by the annotated tag
`cms-snapshot-2026-09-15` at `7be47b5`. The public integration still exposes its
existing editing UI; composition is enabled only in the committed fixture.

## Run it

```sh
npm run dev:composition
npm run typecheck
npm test
```

The render tests select the compiler matching the installed Astro peer. To also
exercise an existing Astro 5/6 installation while the repository uses Astro 7:

```sh
ATX_ASTRO5_ROOT=/absolute/path/to/an/astro5-project npm test
```

That project supplies the runtime only. The test renders this repository's
fixture from temporary compiled modules and does not edit the other project.
The Go compiler's generated code requires the Astro 5/6 runtime: Astro 7 changes
`createAstro`'s arguments, so mixing them is not a valid compatibility test.

## What the implementation establishes

- `usage-parse.ts` reads original Astro AST positions and actual static imports
  through `es-module-lexer`. Slot ranges use UTF-16 source coordinates, including
  Unicode and self-closing component children. Only default imports bound to bare
  identifiers are supported; unsupported bindings remain named refusals.
- `usage-index.ts` resolves imports through an injected resolver; the dev plugin
  supplies Vite's `this.resolve`, including aliases. Canonical paths exclude
  packages and files outside the project. Per-file replacement removes stale
  usage ids. This is an index of visited modules, **not a complete repository
  scan**; static inference requires the caller to explicitly supply a complete
  graph.
- The existing annotation transform injects interned source-site ids through
  component props. Original element loc annotations are identical with tracing
  enabled or disabled, and injection adds no newlines. Tool-owned file, loc and
  chain attributes accompany the legacy attributes in the fixture.
- `composition.ts` checks the route, every caller/target hop, and the selected
  element's source file. A complete static graph yields one inferred path,
  2–8 candidates, or a named refusal. Uncertain chains never authorize writes.
- `composition-model.ts` distinguishes lexical component and slot relationships.
  It requires validated chains; divergent chains need actual slot source ranges.
  It does not invent runtime instance ids or build the inspector/tree UI.

The fixture covers nested layouts, three source links below a route, aliases,
conditional usages, repeated cards with duplicate text, default/named/fallback
slots, components supplied through slots, recursion, prop forwarding, recursive
forwarding, and repeated output with multiple roots. Existing classify/apply is
exercised against the original source of a rendered element.

## Corrections to the proposed mechanism

### Slot components need more than a prefix comparison

Caller-owned native markup has a shorter chain than its receiving component.
However, `Page → Label` supplied inside `Page → Card` has divergent chains.
The slot relationship is proven by locating the Label usage inside the Card
usage's slot-content range. Without that range the model reports `unrelated`.

### A matching final file cannot prove forwarded recursion

`{...Astro.props}` can erase an injected usage id. An ordinary forwarder fails
the caller/target equations. A recursive forwarder can erase its entire cycle
and still end at the expected file. The resolver detects possible spread cycles
and conservatively downgrades affected chains, including the outer render.
Static lookup refuses to invent a recursion depth. Automatic spread repair is
not implemented.

### A source-site id is not a rendered instance id

Repeated cards share a usage id but have distinct enclosing DOM subtrees. A
source value still needs the existing value-matching and ambiguity checks before
any future write. Adjacent repeated components with multiple roots do not have
an unambiguous grouping from chain ids alone. They remain `same-site`, with no
manufactured instance number.

## Verification evidence — 2026-09-15

- Server-rendered assertions pass using Go compiler 2.13.1 with Astro 5.18.2 and
  Rust compiler 0.3.1 with Astro 7.1.1.
- The fixture's original loc annotations match with composition on/off, its
  newline counts match, and a rendered label classifies and patches against its
  original file. These checks cover the committed fixture, not the plan's older
  205-element playground measurement.
- `npm run typecheck` passes; the full suite with both runtimes passes **896 tests across 41 files** (baseline: 880 across 39). The existing suite still reports a shutdown timeout after passing; the baseline does too.
- Live Astro 7.1.1 with the dev toolbar active retains all **54/54** tool-owned
  annotations after the toolbar removes the legacy attributes (**0** remain).
- Live Astro 5.18.2 retains **54/54** tool-owned annotations and renders matching
  chains, including the aliased slot component. Its toolbar fails to initialize
  in the mixed-version harness, so toolbar survival on Astro 5 is **unverified**.

### Legacy locs on the Go compiler

The Go compiler can put its shifted loc before the original loc when it emits
its own duplicate annotations. In the live Astro 5 fixture, all 54 first legacy
locs differed from the tool-owned original locs. The plan's assumption that the
first legacy value is always ours is therefore unsafe. The inspector must read
`data-atx-file` / `data-atx-loc`; the legacy read path cannot establish parity by
itself.

## Boundary of this milestone

This is the E1 tracing gate and supporting parts of E2/E5, not the complete scope
reduction. There are no composition HTTP routes, public option, inspector,
instance tree, staged-value store, prop writes, or CMS/Unsplash removals yet.
The static graph still needs repository discovery, caching and complete-coverage
checks before its fallback tiers can be exposed to the client. Full hydration
and toolbar on/off compatibility, large-page overhead, and the two real-site
passes remain unverified. Markdown and framework boundaries remain outside the
runtime proof.

The next implementation slice is the complete static index and read-only route
group, followed by the component-aware tree/inspector using these refusal rules.
