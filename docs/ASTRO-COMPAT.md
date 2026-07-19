# Astro version compatibility

**Supported: Astro 5.x and 6.x. Not Astro 7.x** (tracked below).

The entire feature rides on the `data-astro-source-file` / `data-astro-source-loc`
attributes Astro emits on every element in dev mode when the dev toolbar is
enabled. The client snapshots them (`src/client/source-map.ts`), the server
resolves them back to the `.astro` AST (`src/patcher/astro.ts`), and every
classify/apply round-trip depends on them. No annotations → nothing is editable.

| Astro | Compiler | `data-astro-source-*` in dev SSR | Status |
| --- | --- | --- | --- |
| 5.x | `@astrojs/compiler` (WASM, Go) | Yes | ✅ Works |
| 6.x (≤ 6.4.8 tested) | `@astrojs/compiler` (WASM, Go) | Yes | ✅ Works |
| 7.x (7.1.1 tested) | `@astrojs/compiler-rs` (Rust) | **No** | ❌ Core editing broken |

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
   there is nothing to snapshot. No client-side workaround is possible from this
   integration; the fix has to come from the compiler.

## Is it coming back?

Likely, but untimelined. Astro core still sets `annotateSourceFile` on `main`, so
the removal reads as an unported feature rather than a deliberate deprecation, and
a maintainer noted on #13602 (June 2026) that the attributes "should be restored
via the Rust compiler." As of this writing there was **no** open tracking issue
in `compiler-rs`, so one was filed:

- **[withastro/compiler-rs#96](https://github.com/withastro/compiler-rs/issues/96)**
  — annotateSourceFile accepted but attributes not emitted (parity regression).

Watch that issue; when it lands, re-test Astro 7 and lift the peer-range ceiling.

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
  same: inject your own source attributes via your own Vite/compiler transform,
  decoupled from Astro's dev-toolbar emission. Neither this project nor
  `astro-click-to-source` does that today.

## What still works on Astro 7

Only the loc-based click-to-edit path (text/image classify + apply) is dead. The
**entry drawer / CMS panel** does not depend on `data-astro-source-*`: it's driven
by the integration's own `<meta>` page-source tag plus `content.config.ts` loaded
through `ssrLoadModule` and zod-schema introspection — all verified working on
Astro 7.1.1. It's not a usable fallback on its own (you reach the drawer via the
overlay, and it only covers content-collection entries), but it confirms the
break is isolated to the annotation channel.
