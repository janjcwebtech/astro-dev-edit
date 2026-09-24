# Component tracing proof

Component tracing is opt-in and dev-only. Without it the integration runs its
editing UI; the dev server always installs the tracing, the source
inspector and the [tracing API](COMPOSITION-API.md). This page is the evidence
for that mechanism, run against the committed fixture, which sets the option.

## Run it

```sh
npm run dev:composition
npm run typecheck
npm test
```

Visit `/advanced` for repeated components, forwarding, recursion and slots;
`/cached` demonstrates the explicit refusal for replayed HTML. The default route
holds the nested component fixture.

The render tests select the compiler matching the installed Astro peer. To also
exercise an existing Astro 5/6 installation while the repository uses Astro 7:

```sh
ATX_ASTRO5_ROOT=/absolute/path/to/an/astro5-project npm test
```

That project supplies the runtime only. Tests render this repository's fixture
from temporary compiled modules and do not edit the other project. Go-generated
code requires an Astro 5/6 runtime; Astro 7 changes the `createAstro` arguments.

## Three independent identities

| Identity | Meaning | Lifetime |
| --- | --- | --- |
| Usage ID | A component invocation written at a particular source location | Stable across renders/restarts while that location stays the same |
| Render ID | One execution of a component, with its lexical parent render | One request/render; all native elements it creates share the ID |
| Slot placement ID | One insertion through a native `<slot>`, with receiver, name, location and fallback status | One insertion, including repeated or forwarded insertions |

`data-atx-file` / `data-atx-loc` retain the original source coordinates.
`data-atx-chain` retains the lexical usage chain. Version 2 additionally emits
`data-atx-instance`, `data-atx-parent`, and `data-atx-version="2"`.

### Protected transport

The transform appends its private tracing payload **after every application
attribute and spread**. The payload uses a private symbol key. An injected
frontmatter initializer captures it, removes it from `Astro.props`, and freezes
the render context before application code runs. Ordinary prop forwarding and
application changes to `Astro.props` cannot overwrite that captured context.

The opening-tag insertion point comes from the compiler's attribute text,
including expressions, regexes, nested templates and nested markup. Unsupported
spans fail explicitly instead of inserting into an expression by guesswork.

Each request has one initial root. A later invocation missing the transport gets
`?`, not the root sentinel `!`. That distinction catches dynamically bound
recursion even when it renders the route's own file. Broken relationships remain
broken through subsequent known usages. Version 1 chains retain the original
conservative spread checks; version 2 still validates the route and every hop.

### Slot insertion boundaries

Slot content can be evaluated before its receiving component renders. Source
ownership alone therefore cannot describe the final placement. The runtime
emits paired comments around each actual native-slot insertion. The comments
include the receiver's identity and source chain, so transparent forwarding
components are represented even when they contribute no native element.

These are **runtime comments**, emitted after compilation. The compiler's removal
of source comments does not remove them. They add no wrapper elements or layout
boxes. They are visible to code that reads `childNodes`.

Forwarded named slots preserve their assignment on the outer fragment; the
original inner `<slot>` loses that assignment. This is required by the Go
compiler: keeping it on both levels silently drops the named content.

`render-occurrences.ts` reads balanced boundary events. `composition-dom.ts`
collects those events from the real DOM. An occurrence groups by render ID plus
its slot-placement path. This distinguishes repeated insertion of the same
caller-owned markup as well as components with multiple sibling roots. Empty
and text-only slot placements remain available as placement records.

## Findings and evidence — 2026-09-15

| Case | Result |
| --- | --- |
| `.map()` renders a component with two roots | Each pair shares one render ID; different executions have different IDs |
| Ordinary and recursive `{...Astro.props}` forwarding | Full chains remain proven, with distinct recursive render IDs |
| Application mutates `Astro.props` | Captured tracing remains intact; no private symbols remain in application props |
| Named, default and fallback slots | Each insertion carries explicit placement metadata |
| A component is supplied through a slot | Its source chain remains distinct from the receiver's; placement is explicit |
| A slot is rendered twice or forwarded through another component | Distinct placement IDs and correctly nested receiver records |
| Async siblings and concurrent page renders | Correct receivers; no instance-ID sharing between requests |
| Missing transport through dynamic recursion | Explicit `chain-break`, including recursion into the route's own file |
| Slot HTML is cached as a string and inserted twice with `set:html` | Marked `untracked-html`; replayed instance IDs are not grouped |
| Malformed, duplicate or incomplete boundary markers | Refused rather than used for a partial placement graph |

`npm run typecheck` passes and the full suite with both runtimes passes **739
tests across 42 files**. The pre-existing shutdown-timeout warning still follows
a successful run.

Automated rendering passes with Go compiler 2.13.1 / Astro 5.18.2 and Rust compiler
0.3.1 / Astro 7.1.1. After removing tracing attributes and runtime comments, the
advanced fixture's HTML is byte-identical to its version 1 rendering on both
pairs. Original annotation coordinates also match, and classify/apply still
patches the original source. This is fixture evidence, not a universal guarantee
for every component or script.

In live browser checks, **both Astro 5.18.2 and Astro 7.1.1** retain **45/45**
element annotations and **17 slot placements** after their toolbars initialize;
all legacy annotations are removed. The real DOM reader distinguishes repeated
root pairs and forwarded slot paths. The cached-HTML page returns explicit
`untracked-html` occurrences. Astro 5 uses an isolated temporary project with
its own dependency resolution, resolving the first milestone's mixed-version
harness failure.

### Cost

The 45-element, 17-slot advanced fixture adds **12,183 uncompressed bytes** over
version 1: 21,452 → 33,635 bytes with Go; 14,120 → 26,303 bytes with Rust. These
counts include machine-specific source paths and are not a real-site budget.
Most metadata is deliberately verbose for the proof. A per-request manifest
with compact references is a possible follow-up before expanding coverage.

### Original source coordinates remain authoritative

Version 2 creates frontmatter when a file has none, so it relaxes the first
prototype's no-newlines rule. File/loc attributes are still computed from the
untouched source. Generated-code diagnostics do not yet have a transform source
map back to the original file. Astro's first legacy loc can be shifted on Go;
`data-atx-loc` is the authoritative coordinate for the inspector.

## Remaining boundaries

- Render identity does not prove which array entry, computed value, or imported
  value should be edited. Existing source tracing and verified writes remain
  necessary; duplicate data values still need an ambiguity refusal.
- Serialized HTML can replay IDs and comments. Descendants of instrumented
  `set:html` containers are opaque to the DOM reader. Direct `Astro.slots.render`
  and other HTML-string insertion mechanisms are not a general supported
  placement channel.
- A component emitting only plain text has no element on which to expose its
  render ID. A full instance graph, including every transparent component,
  still needs additional boundary records or a per-request manifest.
- Dynamic component bindings, framework/MDX boundaries, packages and server
  islands retain the existing refusals. Static slot names are required.
- IDs are ephemeral; selection restoration across HMR needs separate logic.
  Full hydration, client DOM rewrites, toolbar-off combinations and the real-site
  compatibility/weight matrix are not verified. Missing or damaged markers need
  a parity check when client code can remove both halves of a boundary.
- The tracing API discovers the graph reachable from a requested route, not
  every caller in the repository. Its completeness and freshness rules are in
  [the API contract](COMPOSITION-API.md). The inspector consumes it, and stages
  a value against what it read; the write goes through `/composition/apply`,
  which verifies against the source before patching.

Within the tested Astro scope the mechanism handles spread props and multi-root
components. It gives the inspector concrete instance and slot-placement data,
with explicit refusals at the remaining boundaries.
