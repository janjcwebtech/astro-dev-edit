import { parse } from '@astrojs/compiler';
import type { Plugin as VitePlugin } from 'vite';
import type { UsageLink } from '../shared/protocol.ts';
import { prepareComposition } from './composition-instrument.ts';
import { toWirePath } from './wire-path.ts';

/**
 * Self-annotation — the tool stamps its own `data-atx-file` / `-loc` on every
 * supported Astro version, and Astro's `data-astro-source-*` only where Astro
 * itself does not.
 *
 * Astro 5/6 (WASM Go compiler) annotate every element in dev when the toolbar
 * is on; Astro 7's Rust compiler (@astrojs/compiler-rs) accepts the
 * `annotateSourceFile` flag and emits nothing (withastro/compiler-rs#96). A
 * channel owned by somebody else is therefore present on some versions, under
 * some settings — and the feature rides on it everywhere. So this Vite
 * `enforce: 'pre'` transform runs on all of 5/6/7, annotating the raw `.astro`
 * source BEFORE Astro's compiler sees it, and `data-atx-*` is the one channel
 * the client reads.
 *
 * **Never emit the legacy pair where the compiler will emit its own** (the
 * `legacy` option) — measured against `@astrojs/compiler` 2.x, that is not a
 * harmless duplicate. Given an element we already annotated, the Go printer
 * splices its own `data-astro-source-loc` in directly after our
 * `data-astro-source-file` and *also* appends its usual pair at the end. Its
 * loc is computed from the source we have already lengthened, so it is shifted
 * right by the width of our injection — and being first, it is the one the
 * HTML parser keeps. The duplicate does not lose; ours does.
 *
 * What no injection can avoid is that shift itself: an element's loc points at
 * its first child, which sits after the whole opening tag, so any attribute we
 * add moves the compiler's own idea of it. On 5/6 Astro's `data-astro-source-loc`
 * is therefore shifted whether or not we emit a pair of our own, which is the
 * standing reason the tool reads its own namespace and not that one.
 *
 * The critical invariant: injected locs are computed from the ORIGINAL source,
 * so they reference on-disk coordinates — the patcher resolves them against
 * the on-disk file (`src/patcher/astro.ts`) and needs no changes. Injection
 * in legacy mode adds no newlines. The enhanced composition experiment may
 * add frontmatter to allocate per-render state; its file/loc attributes still
 * refer to the original source, independently of generated line numbers.
 *
 * Loc rules mirror the compiler's, as documented in `src/patcher/astro.ts`
 * and pinned by `tests/helpers.ts::locOf`:
 * - text first child → its own start;
 * - element/expression first child → its start + 1 column (the tag name /
 *   the `{` — the compiler reports an expression's start one char before it);
 * - childless element → the element's own start + 1 column (its tag name).
 * Empirically verified: this walker reproduces Astro 6.4.8's own annotations
 * for the whole playground exactly (205/205 served attributes).
 *
 * Pure string-in/string-out like the patchers — no fs here.
 */

interface Pos {
  line: number;
  column: number;
}
interface AstNode {
  type: string;
  name?: string;
  position?: { start: Pos; end?: Pos };
  children?: AstNode[];
  attributes?: { name: string }[];
}

// (line, column) → JS string index; same math as src/patcher/astro.ts, which
// verified the compiler's columns are UTF-16 units, i.e. JS string indexing.
function lineStartIndices(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function indexOfPos(starts: number[], pos: Pos): number {
  const lineStart = starts[pos.line - 1];
  if (lineStart === undefined) return -1;
  return lineStart + pos.column - 1;
}

function bump(pos: Pos): Pos {
  return { line: pos.line, column: pos.column + 1 };
}

/** The loc the compiler would have stamped for this element. */
function locForElement(node: AstNode): Pos | null {
  const first = (node.children ?? []).find((k) => k.position);
  if (!first) return node.position ? bump(node.position.start) : null;
  if (first.type === 'text') return first.position!.start;
  return bump(first.position!.start);
}

/**
 * Tags that must never be stamped. Astro treats a `<script>` or `<style>`
 * carrying an attribute it does not recognise as `is:inline` — no bundling,
 * no TypeScript, no import resolution, no `type="module"` — which breaks
 * every script on the page (its own `ClientRouter` included). Neither is an
 * editable element, so nothing in the editing surface is lost.
 */
const NEVER_ANNOTATE = new Set(['script', 'style', 'slot']);

/**
 * Plain lowercase HTML elements only — components/fragments are never
 * annotated (matches compiler behavior; the client walks up via
 * nearestSource anyway), nor is anything in NEVER_ANNOTATE.
 *
 * **A polymorphic `<Tag>` stays out, deliberately** (issue #71). Its attribute
 * position is static even though its tag name is not, so injecting there looks
 * possible — but `as` is a prop, and any usage site may pass a *component*, at
 * which point the injected attributes become props and land in `Astro.props`.
 * That is exactly the leak the `.astro`→`.astro` injection gate exists to
 * prevent, and a literal default proves nothing about what a caller passes. The
 * only honest proof is at render time (`typeof Tag === 'string'`), which means
 * a conditional spread on a component tag and a loc on a node the patcher's loc
 * rules do not cover (rule 9). Until both are answered, the client names the
 * refusal instead: `composition-dom.ts::wrappedSlot` reads the slot boundary
 * such an element wraps, and the inspector says which component rendered it and
 * where the words inside were written.
 */
function isAnnotatable(node: AstNode): boolean {
  return (
    (node.type === 'element' || node.type === 'custom-element') &&
    !!node.name &&
    /^[a-z]/.test(node.name) &&
    !NEVER_ANNOTATE.has(node.name)
  );
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

interface Insertion {
  index: number;
  text: string;
  deleteCount?: number;
}

/**
 * Annotate every plain element in an `.astro` source with the tool-owned
 * `data-atx-file` / `-loc` pair, and — unless `legacy` is false — the
 * `data-astro-source-*` pair Astro 5/6 would have emitted. `file` is the
 * absolute path the Vite transform receives as its module id, and stays the
 * index's identity for a module throughout.
 *
 * **`data-atx-file` carries the root-relative spelling** ({@link toWirePath}),
 * never `file` itself: it is repeated once per element into HTML anyone on the
 * network can read, and an absolute path there names the developer's home
 * directory (issue #72). `opts.root` is what makes that possible; without it
 * the absolute path is stamped, which is only ever a unit test with no project
 * root to speak of.
 *
 * `data-astro-source-file` is the exception, and deliberately so: it is
 * Astro's own attribute in Astro's own format, read by the dev toolbar and by
 * other tooling that expects the absolute path Astro itself emits. Changing
 * its shape would break those readers to no benefit — the tool's own channel
 * is the one the client reads.
 */
export async function annotateAstroSource(
  source: string, file: string,
  opts: { composition?: readonly UsageLink[]; runtime?: string; legacy?: boolean; root?: string } = {},
): Promise<string> {
  const { ast } = await parse(source, { position: true });
  const starts = lineStartIndices(source);
  const insertions: Insertion[] = [];
  const fileAttr = escapeAttr(file);
  const atxAttr = escapeAttr(opts.root === undefined ? file : toWirePath(opts.root, file));
  const enhanced = opts.runtime ? await prepareComposition(source, file, opts.composition ?? [], opts.runtime, opts.root) : undefined;
  if (enhanced) insertions.push(...enhanced.insertions);
  for (const link of enhanced ? [] : opts.composition ?? []) {
    if (link.file !== file || !link.target || link.refusal || !source.startsWith(`<${link.name}`, link.offset)) continue;
    insertions.push({
      index: link.offset + 1 + link.name.length,
      text: ` data-atx-chain={(Astro.props["data-atx-chain"]??"")+".${link.id}"}`,
    });
  }

  const walk = (node: AstNode): void => {
    if (isAnnotatable(node) && node.position) {
      const loc = locForElement(node);
      // Insertion point: right after `<tagname`, before any existing
      // attributes — so expression attributes / spreads are never touched.
      const tagStart = indexOfPos(starts, node.position.start);
      if (loc && tagStart >= 0) {
        insertions.push({
          index: tagStart + 1 + node.name!.length,
          text:
            (opts.legacy === false ? '' :
              ` data-astro-source-file="${fileAttr}"` +
              ` data-astro-source-loc="${loc.line}:${loc.column}"`) +
            ` data-atx-file="${atxAttr}" data-atx-loc="${loc.line}:${loc.column}"` +
            (opts.composition ?
              (enhanced ? ` data-atx-chain={${enhanced.trace}.chain} data-atx-instance={${enhanced.trace}.id}` +
                ` data-atx-parent={${enhanced.trace}.parent??""} data-atx-ordinal={String(${enhanced.trace}.ordinal)} data-atx-version="2"`
                + (node.attributes?.some(a => a.name === 'set:html') ? ' data-atx-boundary="html"' : '')
                : ` data-atx-chain={Astro.props["data-atx-chain"]??"!"}`) : ''),
        });
      }
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(ast as unknown as AstNode);

  if (insertions.length === 0) return source;
  insertions.sort((a, b) => a.index - b.index);
  // Build with a parts array + single join, not `out += …` in the loop: the
  // latter recopies a growing string per insertion (O(k²) over the output).
  // A `.map()` loop lives in source once, so real files have few insertions —
  // but a large hand-written template shouldn't degrade.
  const parts: string[] = [];
  let cursor = 0;
  for (const ins of insertions) {
    parts.push(source.slice(cursor, ins.index), ins.text);
    cursor = ins.index + (ins.deleteCount ?? 0);
  }
  parts.push(source.slice(cursor));
  return parts.join('');
}

/**
 * The dev-only Vite plugin. Ordering matters twice over: Astro's `astro:build`
 * plugin is itself `enforce: 'pre'` and compiles main `.astro` modules in a
 * plain `transform` handler — and integration-injected plugins land AFTER it
 * in the resolved array, so plugin-level `enforce` alone is not enough (the
 * transform would receive compiled JS, not source). Hook-level
 * `order: 'pre'` is the decisive lever: Vite runs order-'pre' transform
 * handlers before all plain handlers regardless of array position, so the
 * compiler (WASM or Rust) receives the already-annotated source. Only the
 * main module is transformed — style/script sub-requests carry a
 * `?astro&type=…` query and no longer end in `.astro`.
 */
export function createAnnotatePlugin(root: string, opts: { legacy: boolean }): VitePlugin {
  return {
    name: 'astro-dev-edit:annotate',
    enforce: 'pre',
    transform: {
      order: 'pre',
      async handler(code, id) {
        if (!id.endsWith('.astro')) return null;
        return { code: await annotateAstroSource(code, id, { legacy: opts.legacy, root }), map: null };
      },
    },
  };
}
