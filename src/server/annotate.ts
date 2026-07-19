import { parse } from '@astrojs/compiler';
import type { Plugin as VitePlugin } from 'vite';

/**
 * Self-annotation for Astro ≥7 — inject `data-astro-source-file` / `-loc`
 * ourselves when Astro's compiler no longer does.
 *
 * Astro 5/6 (WASM Go compiler) annotate every element in dev when the toolbar
 * is on; the whole feature rides on those attributes. Astro 7's Rust compiler
 * (@astrojs/compiler-rs) accepts the `annotateSourceFile` flag but emits
 * nothing (withastro/compiler-rs#96, docs/ASTRO-COMPAT.md). So on 7 we run a
 * Vite `enforce: 'pre'` transform that annotates the raw `.astro` source
 * BEFORE Astro's compiler sees it.
 *
 * The critical invariant: injected locs are computed from the ORIGINAL source,
 * so they reference on-disk coordinates — the patcher resolves them against
 * the on-disk file (`src/patcher/astro.ts`) and needs no changes. Injection
 * adds no newlines, so line numbers stay true end to end; only columns shift
 * in the compiled output (dev-only, cosmetic).
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

/** Plain lowercase HTML elements only — components/fragments are never
 *  annotated (matches compiler behavior; the client walks up via
 *  nearestSource anyway). */
function isAnnotatable(node: AstNode): boolean {
  return node.type === 'element' && !!node.name && /^[a-z]/.test(node.name);
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

interface Insertion {
  index: number;
  text: string;
}

/**
 * Annotate every plain element in an `.astro` source with the
 * `data-astro-source-*` attributes Astro 5/6 would have emitted.
 * `file` is the absolute path stamped into the attribute (what the Vite
 * transform receives as its module id).
 */
export async function annotateAstroSource(source: string, file: string): Promise<string> {
  const { ast } = await parse(source, { position: true });
  const starts = lineStartIndices(source);
  const insertions: Insertion[] = [];
  const fileAttr = escapeAttr(file);

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
            ` data-astro-source-file="${fileAttr}"` +
            ` data-astro-source-loc="${loc.line}:${loc.column}"`,
        });
      }
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(ast as unknown as AstNode);

  if (insertions.length === 0) return source;
  insertions.sort((a, b) => a.index - b.index);
  let out = '';
  let cursor = 0;
  for (const ins of insertions) {
    out += source.slice(cursor, ins.index) + ins.text;
    cursor = ins.index;
  }
  return out + source.slice(cursor);
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
export function createAnnotatePlugin(): VitePlugin {
  return {
    name: 'astro-text-edit:annotate',
    enforce: 'pre',
    transform: {
      order: 'pre',
      async handler(code, id) {
        if (!id.endsWith('.astro')) return null;
        return { code: await annotateAstroSource(code, id), map: null };
      },
    },
  };
}
