import type { PeekResponse, SourceLoc, UsageLink } from '../shared/protocol.ts';
import * as api from './api.ts';
import { chainIds, createChainLinks } from './composition.ts';
import { pageSource } from './page-source.ts';

/**
 * The element's identity and where it lives, as one markdown block to paste
 * into an AI assistant — what the hover pill's `copy context` and the
 * inspector's **Copy context** produce.
 *
 * Its one job is to let a model find *this* element in *these* files. So it
 * carries only what is true of the source: the authored tag, the file and line
 * it is written on, the chain of files that render it, and a few source lines.
 * Rendered HTML and matched CSS are deliberately absent — compiled markup
 * (`data-astro-cid-*`, expanded components, resolved props) exists in no file,
 * and a model handed it searches for it, and a list of rules pulls it toward
 * restyling what it was only asked to find.
 *
 * Every part is best-effort: the /peek read, the route lookup and the chain
 * resolve may each come up empty, and a part is then dropped or replaced with
 * the reason. Never fail the whole payload because one part degraded.
 *
 * Split in two on purpose: `formatContext` is pure (an ElementContext in, a
 * string out) and unit-tested, while `collectContext` is the DOM + fetch half
 * that only the browser can run.
 */

/** Source lines kept either side of the element's own line. /peek returns the
 *  whole file; this is the paste-sized window cut out of it — enough to pin the
 *  element, not enough to bury it. What it leaves out is named on the heading,
 *  and the whole file is one `/peek` away. */
const SOURCE_CONTEXT = 3;
/** Characters of the element's text kept as an identifier. */
const TEXT_MAX = 80;
/** Deepest DOM-path segments kept — the fallback identifier when there is no
 *  source to quote. */
const PATH_MAX = 6;

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

/** One component usage between the route and the element, outermost first. */
export interface ChainStep {
  /** The component's name as written at the usage site, e.g. `Hero`. */
  name: string;
  /** Where it is used — `file:line:col`. */
  usedAt: string;
  /** The component's own file, when it resolved to one in the project. */
  target: string | null;
}

/** Everything the payload says about one element, before formatting. */
export interface ElementContext {
  loc: SourceLoc;
  /** The opening tag with authored attributes only, e.g. `<h1 class="hero-title">`. */
  openTag: string;
  /** Short label for toasts/titles, e.g. `h1.hero-title`. */
  label: string;
  /** The element's visible text, whitespace-collapsed and capped; empty when it has none. */
  text: string;
  pageUrl: string;
  /** The route's own template, when the server resolved it. */
  routeFile: string | null;
  /** Content-collection file backing the page, when it declares one. */
  entryFile: string | null;
  /** Component usages from the route down to the element; empty when the
   *  element sits in the route itself or no chain could be resolved. */
  chain: ChainStep[];
  domPath: string;
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

/** Render an ElementContext as the markdown that lands on the clipboard. */
export function formatContext(ctx: ElementContext): string {
  const where = `${ctx.loc.file}:${ctx.loc.loc}`;
  const out: string[] = [`# Element context — ${where}`, ''];

  out.push(`- **Element** \`${ctx.openTag}\``);
  if (ctx.text) out.push(`- **Text** "${ctx.text}"`);
  out.push(`- **Written in** ${where}`);
  out.push(`- **Page** ${ctx.pageUrl}`);
  if (ctx.routeFile) out.push(`- **Route file** ${ctx.routeFile}`);
  if (ctx.entryFile) out.push(`- **Content entry** ${ctx.entryFile}`);
  if (ctx.chain.length > 0) {
    out.push('- **Rendered via** (outermost first)');
    for (const step of ctx.chain) {
      const into = step.target ? ` → ${step.target}` : '';
      out.push(`  - \`<${step.name}>\` at ${step.usedAt}${into}`);
    }
  }
  // Only worth its tokens when nothing below pins the element in source.
  if (!ctx.source) out.push(`- **DOM path** ${ctx.domPath}`);
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

  return `${out.join('\n').trimEnd()}\n`;
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

/** Machine-generated by Astro, never in source: a model handed them searches
 *  the repo for markup that is not there. */
const GENERATED_CLASS = /^astro-[\w-]+$/;
const GENERATED_ATTR = /^data-(?:astro-|atx-)/;

/** Astro's own scoping class is machine-generated noise in a path label. */
function authoredClass(el: Element): string | undefined {
  return Array.from(el.classList).find((c) => !GENERATED_CLASS.test(c));
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

/** The opening tag with Astro's and the overlay's generated attributes and
 *  classes removed — as close to what was authored as the DOM can say. */
function openTagOf(el: HTMLElement): string {
  const shallow = el.cloneNode(false) as HTMLElement;
  for (const { name } of Array.from(shallow.attributes)) {
    if (GENERATED_ATTR.test(name)) shallow.removeAttribute(name);
  }
  for (const cls of Array.from(shallow.classList)) {
    if (GENERATED_CLASS.test(cls)) shallow.classList.remove(cls);
  }
  if (shallow.classList.length === 0) shallow.removeAttribute('class');
  const end = shallow.outerHTML.indexOf('>');
  return end === -1 ? `<${el.tagName.toLowerCase()}>` : shallow.outerHTML.slice(0, end + 1);
}

/** Visible text, whitespace-collapsed, capped. */
export function textOf(raw: string, max = TEXT_MAX): string {
  const text = raw.replace(/\s+/g, ' ').trim().replaceAll('"', "'");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The chain's usages as steps, outermost first. Unresolved ids are skipped —
 *  a partial chain still names real files, and a guess would not. */
export function chainSteps(ids: readonly string[], links: ReadonlyMap<string, UsageLink>): ChainStep[] {
  return ids.flatMap((id) => {
    const link = links.get(id);
    return link ? [{ name: link.name, usedAt: `${link.file}:${link.loc}`, target: link.target ?? null }] : [];
  });
}

/** One cache for every copy on this page load; a copy is rare, so the only
 *  thing it saves is re-asking for a chain the user copies twice. */
const chainLinks = createChainLinks(api);

async function chainFor(el: HTMLElement): Promise<ChainStep[]> {
  const ids = chainIds(el);
  if (!ids?.length) return [];
  try {
    return chainSteps(ids, await chainLinks.resolve(location.pathname, ids));
  } catch {
    // Composition off, or the graph could not be built: the payload stands without it.
    return [];
  }
}

async function routeFileFor(): Promise<string | null> {
  try {
    return (await api.resolvePageSource({ pathname: location.pathname })).file ?? null;
  } catch {
    return null;
  }
}

async function sourceFor(
  src: SourceLoc,
): Promise<Pick<ElementContext, 'source' | 'sourceUnavailable'>> {
  try {
    const peeked = await api.peek({ file: src.file, loc: src.loc });
    // Not an error: the file is real but package-owned (an astro:assets
    // <Image>, say), so the server explains instead of returning source.
    if (peeked.refused) return { source: null, sourceUnavailable: peeked.refused };
    return { source: windowAround(peeked), sourceUnavailable: null };
  } catch (err) {
    return {
      source: null,
      sourceUnavailable: err instanceof Error ? err.message : 'the source file could not be read',
    };
  }
}

/** Gather everything for one element. The three reads run together; every
 *  path in the result is already root-relative — that is what the annotation
 *  carries and what the server echoes back — so nothing here rewrites one. */
export async function collectContext(
  el: HTMLElement,
  src: SourceLoc,
): Promise<ElementContext> {
  const [source, routeFile, chain] = await Promise.all([sourceFor(src), routeFileFor(), chainFor(el)]);
  return {
    loc: { file: src.file, loc: src.loc },
    openTag: openTagOf(el),
    label: describe(el),
    // innerText, not textContent: it breaks between block children, so a card
    // reads "Strategy We find…" rather than "StrategyWe find…".
    text: textOf(el.innerText ?? el.textContent ?? ''),
    pageUrl: location.href,
    routeFile,
    entryFile: pageSource(),
    chain,
    domPath: domPathOf(el),
    ...source,
  };
}
