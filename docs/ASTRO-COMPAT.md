# Astro version compatibility

**Supported: Astro 5.x, 6.x, and 7.x** — on 7 the integration injects the
source annotations itself (see [Adaptation](#adaptation-self-annotation-on-astro-7) below).

The entire feature rides on the `data-astro-source-file` / `data-astro-source-loc`
attributes present on every element in dev mode. The client snapshots them
(`src/client/source-map.ts`), the server resolves them back to the `.astro`
AST (`src/patcher/astro.ts`), and every classify/apply round-trip depends on
them. No annotations → nothing is editable.

| Astro | Compiler | `data-astro-source-*` in dev SSR | Status |
| --- | --- | --- | --- |
| 5.x | `@astrojs/compiler` (WASM, Go) | Emitted by Astro (toolbar on) | ✅ Works |
| 6.x (≤ 6.4.8 tested) | `@astrojs/compiler` (WASM, Go) | Emitted by Astro (toolbar on) | ✅ Works |
| 7.x (7.1.1 tested) | `@astrojs/compiler-rs` (Rust) | **Injected by this integration** | ✅ Works (self-annotation) |

## Why Astro 7 breaks

Astro 7 makes the rewritten Rust compiler (`@astrojs/compiler-rs`) the default.
Astro core still *requests* annotation — `packages/astro/src/core/compile/compile.ts`
sets `annotateSourceFile: true` in dev with the toolbar on — and `compiler-rs`
accepts the option (it's wired through `crates/astro_codegen/src/options.rs`,
the napi bindings, and `packages/compiler/src/shared.ts`). But the Rust compiler
**never emits the `data-astro-source-*` HTML attributes**: a code search of the
repo finds no such string, and the published native binary contains zero
occurrences. Verified empirically — an Astro 7.1.1 dev server serves **0**
`data-astro-source-*` attributes across every page, with the dev toolbar enabled.

Two distinct events, easy to conflate:

1. **Astro 5.x** ([withastro/astro#13602](https://github.com/withastro/astro/pull/13602))
   — the compiler still emits the attributes server-side; the Audit toolbar app
   snapshots them into a `WeakMap` and then *strips them client-side*. This
   integration already handles that with a `MutationObserver` that snapshots
   each element the instant it appears (the `astro-click-to-source` technique).
2. **Astro 7** (`compiler-rs`) — the attributes are **never emitted at all**, so
   there is nothing to snapshot. No client-side workaround is possible; the fix
   has to come upstream of the DOM — which is what the self-annotation
   transform below does.

## Adaptation: self-annotation on Astro 7

`src/server/annotate.ts` re-creates the annotations the compiler used to emit:
a Vite transform (added automatically on Astro ≥7, or via
`sourceAnnotations: 'force'`) parses each `.astro` file with the WASM
`@astrojs/compiler` — already a direct dependency for the patcher — and splices
`data-astro-source-file`/`-loc` attributes into every plain element **before**
Astro's compiler sees the source. Key properties:

- **Locs reference on-disk coordinates.** They are computed from the original
  source and injection adds no newlines, so the patcher (`src/patcher/astro.ts`)
  resolves them against the on-disk file unchanged — zero changes to the
  protocol, client, or server routes.
- **Loc parity is exact.** The walker implements the same rules the patcher
  documents (`tests/helpers.ts::locOf`), and reproduced Astro 6.4.8's own
  annotations for the whole playground 205/205 before implementation.
  `tests/annotate.test.ts` pins parity and the classify/apply round-trip.
- **Hook ordering is the subtle part.** Astro's `astro:build` plugin is itself
  `enforce: 'pre'` and compiles main `.astro` modules in a plain `transform`
  handler — and integration-injected Vite plugins land *after* it in the
  resolved array, so plugin-level `enforce: 'pre'` alone receives **compiled
  JS**, not source. The transform therefore uses hook-level
  `transform: { order: 'pre' }`, which Vite runs before all plain handlers
  regardless of array position.
- Astro 7's Audit toolbar app reads (and strips) the same attributes, so
  self-annotation incidentally restores its source-backed features too. The
  existing `MutationObserver` snapshot handles the strip exactly as on 5/6.
- If upstream restores emission ([compiler-rs#96](https://github.com/withastro/compiler-rs/issues/96)),
  double annotation is harmless — identical values, browsers keep the first
  occurrence — and the `'auto'` gate can then exclude fixed versions.

Verified end-to-end on Astro 7.1.1: full annotation coverage in dev SSR,
classify, inline edit, on-disk write at the injected loc, and post-HMR
re-capture.

## Is it coming back?

Likely, but untimelined. Astro core still sets `annotateSourceFile` on `main`, so
the removal reads as an unported feature rather than a deliberate deprecation, and
a maintainer noted on #13602 (June 2026) that the attributes "should be restored
via the Rust compiler." As of this writing there was **no** open tracking issue
in `compiler-rs`, so one was filed:

- **[withastro/compiler-rs#96](https://github.com/withastro/compiler-rs/issues/96)**
  — annotateSourceFile accepted but attributes not emitted (parity regression).

Self-annotation (above) makes this integration independent of that timeline;
when the issue lands, the `'auto'` gate can stop injecting on fixed versions.

## Other tools on the same mechanism

The `data-astro-source-*` channel is shared, so the breakage is not unique to us:

- **Astro's own Audit dev-toolbar app** reads `[data-astro-source-file]` for its
  source-backed features (e.g. "open in editor"). It's subject to the same gap on
  Astro 7 — which is the strongest reason to expect a compiler fix.
- **[`astro-click-to-source`](https://www.npmjs.com/package/astro-click-to-source)**
  (Alt-click → open source in `$EDITOR`) uses the identical approach: read
  `data-astro-source-file`/`-loc`, cache to survive HMR, launch via
  `launch-editor`. It's the project this integration borrowed the snapshot
  technique from (see README credits). Equally broken on Astro 7; no adaptation
  shipped.
- **CMS visual editors that do _not_ use this channel** — e.g.
  [Netlify Visual Editor](https://docs.netlify.com/manage/visual-editor/frameworks/astro/)
  and [Sanity visual editing](https://github.com/sanity-io/visual-editing) — carry
  their own content-source-map / annotation systems tied to CMS content, so this
  specific gap doesn't affect them. The robust-but-heavier escape hatch is the
  same idea as our adaptation: inject your own source attributes via your own
  transform, decoupled from Astro's dev-toolbar emission. This project ships
  that (`src/server/annotate.ts`); `astro-click-to-source` does not.

## What worked on Astro 7 even without self-annotation

The **entry drawer / CMS panel** never depended on `data-astro-source-*`: it's
driven by the integration's own `<meta>` page-source tag plus
`content.config.ts` loaded through `ssrLoadModule` and zod-schema
introspection. It opened and saved on Astro 7.1.1 before the annotator existed,
which is how the break was isolated to the annotation channel in the first
place.

That verification was *shallower than it looked*, though: the drawer opened and
wrote correctly, but every field was arriving from **value inference**, not the
schema — see the second regime below. A panel that silently degrades is a panel
that looks verified.

## The second version regime: zod v3 vs v4

Source annotation isn't the only thing that changed across the Astro majors.
The entry editor's schema introspection reads zod internals, and **which zod it
gets depends on the Astro major**:

| Astro | `astro/zod` re-exports | Internals |
| --- | --- | --- |
| 5, 6 | zod v3 | `_def.typeName` (`'ZodString'`), enum `_def.values`, array `_def.type`, literal `_def.value`, `.describe()` → `_def.description` |
| 7 | `zod/v4` (zod 4.x) | `_def.type` (`'string'`), enum `_def.entries`, array `_def.element`, literal `_def.values[0]`, `.describe()` → `z.globalRegistry` |

Every accessor moved. Because the introspector is deliberately duck-typed — it
never imports zod, avoiding a dual-instance hazard and a peer dependency — a
renamed internal doesn't fail loudly; it reads `undefined` and the code takes
its degrade path. On Astro 7 that meant `zodToFields` bailed at its first guard
and **every** field fell back to inference (enums as text, `image()` as text,
defaults invisible), while `shapeOf` bailing meant `validateChanges` returned no
errors at all, so entry saves went unvalidated.

`src/server/zod-adapt.ts` now holds one accessor table per major behind a single
interface, chosen by probing the schema itself (`_def.typeName` → v3,
`_def.type` → v4). Three v4 shapes are worth knowing about:

- `.describe()` is only readable through the **`.description` getter**, and only
  on the *unwrapped* schema — `image().optional()` carries it on the inner node.
- `.transform()` compiles to `pipe{in, out}` where `out` is a `transform` node no
  widget can render, so the v4 table follows **`in`**. v3's `ZodPipeline` still
  follows `out`.
- `.brand()` and `.refine()` no longer wrap at all (the kind stays `'string'`),
  so v3's `ZodBranded`/`ZodEffects` cases are simply dead on v4.

A future Astro that ships zod v5 will hit the same class of break. The
containment is that `adapterFor` returns `null` for internals it doesn't
recognize, so the panel degrades to inference rather than erroring — and that
the tests exercise the real `astro/zod`, so a bump surfaces as a red suite
rather than a silent downgrade.
