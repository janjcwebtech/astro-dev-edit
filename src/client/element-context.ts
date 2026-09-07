import type { ClassifyResult, PeekResponse, SourceLoc } from '../shared/protocol.ts';
import * as api from './api.ts';
import { classifyCached } from './classify-cache.ts';
import { narrowRules, rulesForElement, type MatchedRule } from './css-inspect.ts';
import { pageSource } from './page-source.ts';

/**
 * "Everything we know about this element", assembled into one markdown block to
 * paste into an AI assistant — what the hover pill's `copy ⧉` button produces.
 *
 * The knowledge is deliberately scattered and has to be gathered from three
 * places, none of which can answer for the others:
 *   - the **source loc** comes from source-map.ts's snapshot cache (Astro's dev
 *     toolbar strips the annotations out of the live DOM, so it can't be read
 *     from the element),
 *   - the **CSS** comes from the browser's own CSSOM (which knows what applies
 *     but not where it was authored), and
 *   - the **source text** is only on disk, so it needs the /peek round-trip.
 * Any of the three may come up empty; a section is then dropped or replaced
 * with the reason, and the copy still happens. Never fail the whole payload
 * because one part degraded.
 *
 * Split in two on purpose: `formatContext` is pure (an ElementContext in, a
 * string out) and unit-tested, while `collectContext` is the DOM + fetch half
 * that only the browser can run.
 */

/** Cap on the copied outerHTML. Big enough for a real component, small enough
 *  that hovering a page wrapper doesn't paste a whole document. */
const HTML_MAX = 4000;
/** Cap on copied CSS rules. A heavily-styled element can match dozens, most of
 *  them site-wide defaults it merely happens to match — `narrowRules` drops
 *  those first, so what survives the cap is what names this element. */
const RULES_MAX = 12;
/** Source lines kept either side of the element's own line. /peek returns the
 *  whole file (its own cap is ~1000 lines each way); this is the paste-sized
 *  window cut out of it.
 *
 *  Deliberately tight. The payload's job is to identify *one* element, and a
 *  wide window buries it: at ±30 a one-line `<a>` on line 30 of a 107-line file
 *  quoted more than half the file, comment blocks and unrelated arrays
 *  included, with the three lines that matter near the top. What the window
 *  leaves out is named on the section heading, and the whole file is one
 *  `/peek` away. */
const SOURCE_CONTEXT = 5;
/** Deepest DOM-path segments kept, counting from the element itself. */
const PATH_MAX = 8;

/** The source window actually quoted in the payload. */
export interface SourceWindow {
  file: string;
  /** 1-based line number of `lines[0]`. */
  startLine: number;
  /** 1-based line the element sits on — marked in the quote. */
  focusLine: number;
  /** Lines in the whole file, so the payload can say what it left out. */
  totalLines: number;
  lines: string[];
}

/** Everything the overlay knows about one element, before formatting. */
export interface ElementContext {
  loc: SourceLoc;
  /** The opening tag as rendered, e.g. `<h1 class="hero-title">`. */
  openTag: string;
  /** Short label for toasts/titles, e.g. `h1.hero-title`. */
  label: string;
  /** What a click would do, per the server's AST classification; null when it
   *  couldn't be determined. Deliberately *not* rendered into the copied
   *  markdown: it describes what this overlay can edit, not the element, and
   *  an LLM reads it as a constraint on what it may change. */
  verdict: string | null;
  pageUrl: string;
  /** Content-collection file backing the page, when it declares one. */
  entryFile: string | null;
  domPath: string;
  html: string;
  /** Characters the cap dropped from `html`; 0 when it's complete. */
  htmlDropped: number;
  rules: MatchedRule[];
  /** Rules the cap dropped; 0 when all matched rules are present. */
  rulesDropped: number;
  source: SourceWindow | null;
  /** Why `source` is null (a server refusal or a failed read), when it is. */
  sourceUnavailable: string | null;
}

// --- Formatting (pure) -------------------------------------------------------

/** Fence language for the source quote, by extension. */
function fenceLang(file: string): string {
  const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'astro') return 'astro';
  if (ext === 'md' || ext === 'mdx' || ext === 'markdown') return 'markdown';
  if (ext === 'html') return 'html';
  if (ext === 'ts' || ext === 'tsx') return 'ts';
  if (ext === 'js' || ext === 'jsx') return 'js';
  return '';
}

/** `>` gutter-marks the element's own line, so the model knows which of the
 *  quoted lines is the subject without a marker polluting the code text. */
function quoteSource(source: SourceWindow): string {
  const last = source.startLine + source.lines.length - 1;
  const width = String(last).length;
  return source.lines
    .map((line, i) => {
      const no = source.startLine + i;
      const mark = no === source.focusLine ? '>' : ' ';
      return `${mark} ${String(no).padStart(width)} | ${line}`;
    })
    .join('\n');
}

function ruleBlock(rule: MatchedRule): string {
  const body = rule.declarations
    .split('\n')
    .map((d) => `  ${d}`)
    .join('\n');
  const from = rule.sourceFile ? `/* ${rule.sourceFile} */\n` : '';
  return `${from}${rule.selectorText} {\n${body}\n}`;
}

/** Render an ElementContext as the markdown that lands on the clipboard.
 *  Every section is optional — an element with no classes has no CSS block, a
 *  refused /peek has no source block. */
export function formatContext(ctx: ElementContext): string {
  const where = `${ctx.loc.file}:${ctx.loc.loc}`;
  const out: string[] = [`# Element context — ${where}`, ''];

  out.push(`- **Element** \`${ctx.openTag}\``);
  out.push(`- **Source** ${where}`);
  out.push(`- **Page** ${ctx.pageUrl}`);
  if (ctx.entryFile) out.push(`- **Content entry** ${ctx.entryFile}`);
  out.push(`- **DOM path** ${ctx.domPath}`, '');

  out.push('## Rendered HTML', '```html', ctx.html, '```');
  if (ctx.htmlDropped > 0) {
    out.push(`_Truncated — ${ctx.htmlDropped} more characters of markup._`);
  }
  out.push('');

  if (ctx.source) {
    const { startLine, lines, totalLines, file } = ctx.source;
    const last = startLine + lines.length - 1;
    const range = lines.length === totalLines ? `all ${totalLines} lines` : `lines ${startLine}–${last} of ${totalLines}`;
    out.push(`## Source — ${file} (${range}, \`>\` marks the element)`);
    const lang = fenceLang(file);
    out.push(`\`\`\`${lang}`, quoteSource(ctx.source), '```', '');
  } else if (ctx.sourceUnavailable) {
    out.push('## Source', `_Not available — ${ctx.sourceUnavailable}_`, '');
  }

  if (ctx.rules.length > 0) {
    const shown = ctx.rules.length;
    const total = shown + ctx.rulesDropped;
    const count = ctx.rulesDropped > 0 ? `${shown} of ${total} rules` : `${shown} rule${shown === 1 ? '' : 's'}`;
    out.push(`## CSS that applies (${count})`, '```css');
    out.push(ctx.rules.map(ruleBlock).join('\n\n'));
    out.push('```');
    if (ctx.rulesDropped > 0) out.push(`_Truncated — ${ctx.rulesDropped} further matching rules._`);
    out.push('');
  } else {
    out.push('## CSS that applies', '_No stylesheet rule matches this element directly (it may inherit from an ancestor, or its stylesheets are cross-origin)._', '');
  }

  return `${out.join('\n').trimEnd()}\n`;
}

/**
 * Source paths repo-relative, the shape a person (or an assistant) can act on.
 *
 * Astro's `data-astro-source-file` annotations are absolute fsPaths — the pill
 * only ever showed their basename, so it never mattered before, but
 * "/Users/you/projects/site/src/pages/index.astro:12:3" is noise in a paste.
 * `root` comes from /health; without it the path is left as-is rather than
 * guessed at.
 */
export function relativize(file: string, root: string | null): string {
  const path = file.replace(/\\/g, '/');
  if (!root) return path;
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
  return path.startsWith(base) ? path.slice(base.length) : path;
}

/** Cut the paste-sized window out of a /peek response (which is normally the
 *  whole file). Exported for its own test — the arithmetic is 1-based and easy
 *  to get wrong by one. */
export function windowAround(peeked: PeekResponse, context = SOURCE_CONTEXT): SourceWindow {
  const first = peeked.startLine;
  const last = first + peeked.lines.length - 1;
  const from = Math.max(first, peeked.focusLine - context);
  const to = Math.min(last, peeked.focusLine + context);
  return {
    file: peeked.file,
    startLine: from,
    focusLine: peeked.focusLine,
    totalLines: peeked.totalLines,
    lines: peeked.lines.slice(from - first, to - first + 1),
  };
}

// --- Collection (DOM + server) -----------------------------------------------

/** Astro's own scoping class is machine-generated noise in a path label. */
function authoredClass(el: Element): string | undefined {
  return Array.from(el.classList).find((c) => !/^astro-[\w-]+$/.test(c));
}

/** `h1.hero-title` / `section#masthead` / `div` — one path segment. */
function describe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  const cls = authoredClass(el);
  return cls ? `${tag}.${cls}` : tag;
}

function domPathOf(el: HTMLElement): string {
  const parts: string[] = [];
  let cur: HTMLElement | null = el;
  while (cur && cur !== document.documentElement) {
    parts.unshift(describe(cur));
    cur = cur.parentElement;
  }
  if (parts.length > PATH_MAX) return `… > ${parts.slice(-PATH_MAX).join(' > ')}`;
  return parts.join(' > ');
}

/** The opening tag only, attributes included, as the browser renders it. */
function openTagOf(el: HTMLElement): string {
  const shallow = el.cloneNode(false) as HTMLElement;
  const end = shallow.outerHTML.indexOf('>');
  return end === -1 ? `<${el.tagName.toLowerCase()}>` : shallow.outerHTML.slice(0, end + 1);
}

/** outerHTML, capped. Nothing of the overlay's can appear in it: every panel,
 *  outline and veil lives in the shadow root, whose host is a child of <body>
 *  and never of the element being copied. */
function renderedHtml(el: HTMLElement): { html: string; dropped: number } {
  const full = el.outerHTML;
  if (full.length <= HTML_MAX) return { html: full, dropped: 0 };
  return { html: full.slice(0, HTML_MAX), dropped: full.length - HTML_MAX };
}

/** Phrase the AST classification the way the payload reads best. */
function verdictOf(result: ClassifyResult): string {
  const what =
    result.kind === 'text'
      ? 'editable text'
      : result.kind === 'image'
        ? 'image (src/alt)'
        : `not editable in place (${result.kind})`;
  return `${what} — ${result.reason}`;
}

async function sourceFor(
  src: SourceLoc,
  root: string | null,
): Promise<Pick<ElementContext, 'source' | 'sourceUnavailable'>> {
  try {
    const peeked = await api.peek({ file: src.file, loc: src.loc });
    // Not an error: the file is real but package-owned (an astro:assets
    // <Image>, say), so the server explains instead of returning source.
    if (peeked.refused) return { source: null, sourceUnavailable: peeked.refused };
    const window = windowAround(peeked);
    return { source: { ...window, file: relativize(window.file, root) }, sourceUnavailable: null };
  } catch (err) {
    return {
      source: null,
      sourceUnavailable: err instanceof Error ? err.message : 'the source file could not be read',
    };
  }
}

/** Gather everything for one element. Only the /peek read can be slow; the
 *  classification is served from the hover cache in the normal case. `root` is
 *  the project root from /health, used to render source paths repo-relative. */
export async function collectContext(
  el: HTMLElement,
  src: SourceLoc,
  root: string | null,
): Promise<ElementContext> {
  const { html, dropped } = renderedHtml(el);
  const matched = rulesForElement(el);
  const kept = narrowRules(el, matched, RULES_MAX);

  let verdict: string | null = null;
  try {
    verdict = verdictOf(await classifyCached({ file: src.file, loc: src.loc, tag: el.tagName.toLowerCase() }));
  } catch {
    // Classification is a nicety here — the rest of the context still stands.
  }

  return {
    loc: { file: relativize(src.file, root), loc: src.loc },
    openTag: openTagOf(el),
    label: describe(el),
    verdict,
    pageUrl: location.href,
    entryFile: pageSource(),
    domPath: domPathOf(el),
    html,
    htmlDropped: dropped,
    rules: kept,
    rulesDropped: matched.length - kept.length,
    ...(await sourceFor(src, root)),
  };
}
