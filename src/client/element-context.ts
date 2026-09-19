import type { ClassifyResult, PeekResponse, SourceLoc, UsageLink } from '../shared/protocol.ts';
import * as api from './api.ts';
import { classifyCached } from './classify-cache.ts';
import { chainIds, createChainLinks } from './composition.ts';
import { pageSource } from './page-source.ts';

/**
 * The element's identity and where it lives, as one markdown block to paste
 * into an AI assistant — what the hover pill's `copy context` and the
 * inspector's **Copy context** produce.
 *
 * Its one job is to let a model find *this* element in *these* files. So it
 * carries only what is true of the source: the file and line it is written on,
 * the files that render it, where its words actually live, and the element's
 * own source lines. Nothing is said twice — the quoted line already shows the
 * tag, so the tag is printed only when there is no quote.
 * Rendered HTML and matched CSS are deliberately absent — compiled markup
 * (`data-astro-cid-*`, expanded components, resolved props) exists in no file,
 * and a model handed it searches for it, and a list of rules pulls it toward
 * restyling what it was only asked to find.
 *
 * Every part is best-effort: the /peek read, the classification, the route
 * lookup and the chain resolve may each come up empty, and a part is then dropped or replaced with
 * the reason. Never fail the whole payload because one part degraded.
 *
 * Split in two on purpose: `formatContext` is pure (an ElementContext in, a
 * string out) and unit-tested, while `collectContext` is the DOM + fetch half
 * that only the browser can run.
 */

/** Most lines quoted for one element. The quote is the element itself — from
 *  its opening line to its closing tag — and a longer element is cut here, the
 *  heading saying which lines were shown. */
const ELEMENT_LINES_MAX = 8;
/** Characters of the element's text kept as an identifier. */
const TEXT_MAX = 80;
/** Deepest DOM-path segments kept — the fallback identifier when there is no
 *  source to quote. */
const PATH_MAX = 6;

/** The element's own source lines, as quoted in the payload. */
export interface SourceWindow {
  file: string;
  /** 1-based line number of `lines[0]` — the line the element opens on. */
  startLine: number;
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

/** What the server's classification proved about where the element's words
 *  come from — the subset of {@link ClassifyResult} the payload phrases. */
export interface TextOrigin {
  kind: ClassifyResult['kind'];
  /** The frontmatter path an `expression` was traced to, e.g. `hero.title`. */
  expression?: string;
  /** The prop the words arrive through, as the caller spells it, e.g. `title`. */
  prop?: string;
  /** Whether the element holds other elements — a `dynamic` verdict then means
   *  "mixed content", not "a computed value". */
  hasChildElements: boolean;
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
  /** Where the words come from; null when the classification failed. */
  origin: TextOrigin | null;
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

/** Line-numbered, so the quote can be matched against the file. */
function quoteSource(source: SourceWindow): string {
  const last = source.startLine + source.lines.length - 1;
  const width = String(last).length;
  return source.lines
    .map((line, i) => `${String(source.startLine + i).padStart(width)} | ${line}`)
    .join('\n');
}

/** One sentence on where the element's words live — the fact a model most
 *  needs and cannot read off the quoted line. Null when there is nothing
 *  worth saying (an image, an empty element, a verdict that proved nothing). */
export function originSentence(origin: TextOrigin | null, caller: ChainStep | null, entryFile: string | null): string | null {
  if (!origin) return null;
  const inEntry = entryFile ? ` The page's content entry is ${entryFile}.` : '';
  switch (origin.kind) {
    case 'text':
      return 'Written literally in the quoted source.';
    case 'markup':
      return 'Written literally in the quoted source, with inline markup.';
    case 'expression':
      return origin.expression
        ? `An expression traced to the frontmatter string \`${origin.expression}\` in this file.`
        : 'An expression traced to a frontmatter string in this file.';
    case 'html':
      return 'A `set:html` string in this file.';
    case 'dynamic':
      if (origin.prop) {
        const at = caller ? ` at ${caller.usedAt}` : '';
        return `The prop \`${origin.prop}\` — the words are set by the caller${at}, not in this file.`;
      }
      if (origin.hasChildElements) return 'Mixed content — see the child elements for where each part is written.';
      return `Computed by an expression — the words are not in this file.${inEntry}`;
    default:
      return null;
  }
}

/** Render an ElementContext as the markdown that lands on the clipboard. */
export function formatContext(ctx: ElementContext): string {
  const where = `${ctx.loc.file}:${ctx.loc.loc}`;
  const text = ctx.text ? ` "${ctx.text}"` : '';
  const out: string[] = [`# ${ctx.label}${text}`, ''];

  // The quoted line shows the tag; without a quote it is the best identifier left.
  if (!ctx.source) out.push(`- **Element** \`${ctx.openTag}\``);
  out.push(`- **Source** ${where}`);
  if (ctx.chain.length > 0) {
    const via = ctx.chain.map((step) => `${step.usedAt} \`<${step.name}>\``).join(' › ');
    out.push(`- **Rendered by** ${via}`);
  } else if (ctx.routeFile && ctx.routeFile !== ctx.loc.file) {
    out.push(`- **Route** ${ctx.routeFile}`);
  } else if (!ctx.routeFile) {
    out.push(`- **Page** ${ctx.pageUrl}`);
  }
  if (ctx.entryFile) out.push(`- **Content entry** ${ctx.entryFile}`);
  const origin = originSentence(ctx.origin, ctx.chain.at(-1) ?? null, ctx.entryFile);
  if (origin) out.push(`- **Text** ${origin}`);
  if (!ctx.source) out.push(`- **DOM path** ${ctx.domPath}`);
  out.push('');

  if (ctx.source) {
    const { startLine, lines, file } = ctx.source;
    const last = startLine + lines.length - 1;
    const range = last === startLine ? `line ${startLine}` : `lines ${startLine}–${last}`;
    out.push(`\`\`\`${fenceLang(file)} ${range}`, quoteSource(ctx.source), '```', '');
  } else if (ctx.sourceUnavailable) {
    out.push(`_Source not available — ${ctx.sourceUnavailable}_`, '');
  }

  return `${out.join('\n').trimEnd()}\n`;
}

/** Cut the element's own lines out of a /peek response (normally the whole
 * file): from its opening line down to the line that closes it, capped. The
 * close is found by text — the first `</tag` or `/>` after the opening — which
 * is exact for the one-line and plain-block cases this is for; a nested
 * same-name tag stops the quote early, which the line range makes visible.
 * Exported for its own test — the arithmetic is 1-based and easy to get wrong
 * by one. */
export function elementLines(peeked: PeekResponse, tag: string, max = ELEMENT_LINES_MAX): SourceWindow {
  const first = peeked.startLine;
  const from = peeked.focusLine - first;
  const close = new RegExp(`</${tag}\\s*>|/>`, 'i');
  let to = from;
  // The opening line may hold the whole element; look past its own `<tag`.
  const opening = peeked.lines[from] ?? '';
  const openAt = opening.search(new RegExp(`<${tag}\\b`, 'i'));
  const rest = openAt === -1 ? opening : opening.slice(openAt + tag.length + 1);
  if (!close.test(rest)) {
    while (to + 1 < peeked.lines.length && to - from + 1 < max) {
      to++;
      if (close.test(peeked.lines[to]!)) break;
    }
  }
  return {
    file: peeked.file,
    startLine: peeked.focusLine,
    lines: peeked.lines.slice(from, to + 1),
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

async function originFor(el: HTMLElement, src: SourceLoc): Promise<TextOrigin | null> {
  try {
    const result = await classifyCached({ file: src.file, loc: src.loc, tag: el.tagName.toLowerCase() });
    return {
      kind: result.kind,
      expression: result.expression?.label,
      prop: result.prop?.name,
      hasChildElements: el.children.length > 0,
    };
  } catch {
    // The verdict is one sentence of the payload; the rest still stands.
    return null;
  }
}

async function sourceFor(
  el: HTMLElement,
  src: SourceLoc,
): Promise<Pick<ElementContext, 'source' | 'sourceUnavailable'>> {
  try {
    const peeked = await api.peek({ file: src.file, loc: src.loc });
    // Not an error: the file is real but package-owned (an astro:assets
    // <Image>, say), so the server explains instead of returning source.
    if (peeked.refused) return { source: null, sourceUnavailable: peeked.refused };
    return { source: elementLines(peeked, el.tagName.toLowerCase()), sourceUnavailable: null };
  } catch (err) {
    return {
      source: null,
      sourceUnavailable: err instanceof Error ? err.message : 'the source file could not be read',
    };
  }
}

/** Gather everything for one element. The four reads run together; every
 *  path in the result is already root-relative — that is what the annotation
 *  carries and what the server echoes back — so nothing here rewrites one. */
export async function collectContext(
  el: HTMLElement,
  src: SourceLoc,
): Promise<ElementContext> {
  const [source, origin, routeFile, chain] = await Promise.all([
    sourceFor(el, src), originFor(el, src), routeFileFor(), chainFor(el),
  ]);
  return {
    loc: { file: src.file, loc: src.loc },
    openTag: openTagOf(el),
    label: describe(el),
    // innerText, not textContent: it breaks between block children, so a card
    // reads "Strategy We find…" rather than "StrategyWe find…".
    text: textOf(el.innerText ?? el.textContent ?? ''),
    origin,
    pageUrl: location.href,
    routeFile,
    entryFile: pageSource(),
    chain,
    domPath: domPathOf(el),
    ...source,
  };
}
