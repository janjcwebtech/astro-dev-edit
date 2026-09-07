/**
 * Minimal markdown ⇄ HTML conversion for the WYSIWYG body editor.
 *
 * Deliberately a subset: headings, paragraphs, bold/italic/strikethrough,
 * inline code, fenced code blocks, flat lists, blockquotes, links, images,
 * hr. `canRichEdit` gates entry — anything outside the subset (tables, raw
 * HTML/MDX, footnotes, nested lists, indented code, setext headings) keeps
 * the editor in raw-markdown mode so a visual round-trip can never destroy
 * constructs it doesn't understand.
 *
 * `markdownToHtml`/`canRichEdit` are pure string functions (unit-tested);
 * `htmlToMarkdown` walks a live DOM tree and only runs in the browser.
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A link/image destination, in both the forms CommonMark writes it: bare, or
 * wrapped in angle brackets. A bare destination ends at the first space or
 * paren, so a path holding either can only be written wrapped — which is how
 * `/brand/Logo Miramar horizontal.png` survives being a destination at all.
 *
 * `escapeHtml` has already run by the time these match, so the brackets arrive
 * as entities. The wrapped form is read lazily up to the first `&gt;`, which is
 * the one character CommonMark does not allow raw inside it.
 */
const DESTINATION = String.raw`(?:&lt;(.*?)&gt;|([^()\s]+))`;
const IMAGE_RE = new RegExp(String.raw`!\[([^\]]*)\]\(${DESTINATION}\)`, 'g');
const LINK_RE = new RegExp(String.raw`\[([^\]]+)\]\(${DESTINATION}\)`, 'g');

/**
 * Write a URL as a markdown destination, wrapping it when it holds a character
 * that would otherwise end it early.
 *
 * Without this an `<img>` whose src has a space serializes to
 * `![alt](/a b.png)`, which is not an image: the next parse reads it as
 * literal text, and the save after that replaces the image with its own
 * markdown source. The image is gone and nothing reported a failure.
 */
export function mdDestination(url: string): string {
  if (!/[\s()<>]/.test(url)) return url;
  // `<` and `>` are the two characters the wrapper cannot carry raw.
  return `<${url.replace(/</g, '%3C').replace(/>/g, '%3E')}>`;
}

/** Inline markdown → inline HTML. Input is raw text; output is escaped. */
function inlineHtml(text: string): string {
  let s = escapeHtml(text);
  // Protect code spans first so their contents are never styled.
  const codes: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_, c: string) => {
    codes.push(`<code>${c}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s.replace(IMAGE_RE, (_, alt: string, wrapped?: string, bare?: string) =>
    `<img alt="${alt}" src="${wrapped ?? bare ?? ''}">`);
  s = s.replace(LINK_RE, (_, text: string, wrapped?: string, bare?: string) =>
    `<a href="${wrapped ?? bare ?? ''}">${text}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Underscore italics only at word boundaries, so snake_case survives.
  s = s.replace(/(^|[\s([])_([^_]+)_(?=$|[\s).,;:!?])/g, '$1<em>$2</em>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[Number(i)]);
  return s;
}

const FENCE_RE = /^```(\S*)\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const UL_RE = /^[-*+]\s+(.*)$/;
const OL_RE = /^\d+[.)]\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const HR_RE = /^(?:-{3,}|\*{3,}|_{3,})\s*$/;
const BLANK_RE = /^\s*$/;

/**
 * Whether the visual editor can represent this markdown without loss.
 * False sends the drawer to raw-markdown mode.
 */
export function canRichEdit(md: string): boolean {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let inFence = false;
  let prevWasText = false;
  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      prevWasText = false;
      continue;
    }
    if (inFence) continue;
    if (BLANK_RE.test(line)) {
      prevWasText = false;
      continue;
    }
    if (prevWasText && /^(=+|-{1,})\s*$/.test(line)) return false; // setext heading
    if (/^\s*<[a-zA-Z!/]/.test(line)) return false; // raw HTML / MDX component
    if (/^\s*\|/.test(line)) return false; // table row
    if (/^\s*\[\^/.test(line)) return false; // footnote
    if (/^\s*\[[^\]]+\]:\s/.test(line)) return false; // reference link definition
    if (/^(import|export)\s/.test(line)) return false; // MDX
    if (/^\s{2,}([-*+]|\d+[.)])\s/.test(line)) return false; // nested list
    if (/^ {4,}\S/.test(line)) return false; // indented code block
    prevWasText = !HEADING_RE.test(line) && !UL_RE.test(line)
      && !OL_RE.test(line) && !QUOTE_RE.test(line) && !HR_RE.test(line);
  }
  return !inFence; // an unclosed fence means we misread everything after it
}

/** Markdown (the canRichEdit subset) → HTML for the contenteditable. */
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let quote: string[] | null = null;
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;

  const flushPara = (): void => {
    if (para.length) out.push(`<p>${inlineHtml(para.join(' '))}</p>`);
    para = [];
  };
  const flushList = (): void => {
    if (list) {
      out.push(`<${list.tag}>${list.items.map((i) => `<li>${inlineHtml(i)}</li>`).join('')}</${list.tag}>`);
    }
    list = null;
  };
  const flushQuote = (): void => {
    if (quote) {
      const paras = quote.join('\n').split(/\n\s*\n/).filter((p) => p.trim() !== '');
      out.push(`<blockquote>${paras.map((p) => `<p>${inlineHtml(p.replace(/\n/g, ' '))}</p>`).join('')}</blockquote>`);
    }
    quote = null;
  };
  const flushAll = (): void => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE_RE.exec(line);
    if (fence) {
      flushAll();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      const lang = fence[1] ? ` data-lang="${escapeHtml(fence[1])}"` : '';
      out.push(`<pre${lang}><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    if (BLANK_RE.test(line)) {
      flushAll();
      continue;
    }
    const h = HEADING_RE.exec(line);
    if (h) {
      flushAll();
      out.push(`<h${h[1].length}>${inlineHtml(h[2])}</h${h[1].length}>`);
      continue;
    }
    if (HR_RE.test(line) && para.length === 0) {
      flushAll();
      out.push('<hr>');
      continue;
    }
    const q = QUOTE_RE.exec(line);
    if (q) {
      flushPara();
      flushList();
      (quote ??= []).push(q[1]);
      continue;
    }
    const ul = UL_RE.exec(line);
    if (ul) {
      flushPara();
      flushQuote();
      if (!list || list.tag !== 'ul') {
        flushList();
        list = { tag: 'ul', items: [] };
      }
      list.items.push(ul[1]);
      continue;
    }
    const ol = OL_RE.exec(line);
    if (ol) {
      flushPara();
      flushQuote();
      if (!list || list.tag !== 'ol') {
        flushList();
        list = { tag: 'ol', items: [] };
      }
      list.items.push(ol[1]);
      continue;
    }
    flushList();
    flushQuote();
    para.push(line.trim());
  }
  flushAll();
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// HTML → markdown (DOM walker; browser-only)
// ---------------------------------------------------------------------------

/** Inline serialization of an element's children. */
function inlineMd(node: Node): string {
  let out = '';
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      out += (child.nodeValue ?? '').replace(/\s+/g, ' ');
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as HTMLElement;
    const tag = el.tagName;
    if (tag === 'BR') {
      out += '\n';
    } else if (tag === 'IMG') {
      out += `![${el.getAttribute('alt') ?? ''}](${mdDestination(el.getAttribute('src') ?? '')})`;
    } else if (tag === 'A') {
      out += `[${inlineMd(el)}](${mdDestination(el.getAttribute('href') ?? '')})`;
    } else if (tag === 'CODE') {
      out += `\`${el.textContent ?? ''}\``;
    } else if (tag === 'STRONG' || tag === 'B') {
      const inner = inlineMd(el).trim();
      if (inner) out += `**${inner}**`;
    } else if (tag === 'EM' || tag === 'I') {
      const inner = inlineMd(el).trim();
      if (inner) out += `*${inner}*`;
    } else if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') {
      const inner = inlineMd(el).trim();
      if (inner) out += `~~${inner}~~`;
    } else if (tag === 'SPAN') {
      // execCommand sometimes styles spans instead of emitting tags.
      let inner = inlineMd(el);
      const st = el.style;
      const trimmed = inner.trim();
      if (trimmed) {
        if (st.textDecoration.includes('line-through')) inner = `~~${trimmed}~~`;
        if (st.fontStyle === 'italic') inner = `*${inner.trim()}*`;
        if (st.fontWeight === 'bold' || Number(st.fontWeight) >= 600) inner = `**${inner.trim()}**`;
      }
      out += inner;
    } else {
      out += inlineMd(el);
    }
  }
  return out;
}

function listToMd(el: HTMLElement, indent: string): string {
  const lines: string[] = [];
  const ordered = el.tagName === 'OL';
  let n = 1;
  for (const li of Array.from(el.children)) {
    if (li.tagName !== 'LI') continue;
    const nested: string[] = [];
    const clone = li.cloneNode(true) as HTMLElement;
    for (const sub of Array.from(clone.querySelectorAll(':scope > ul, :scope > ol'))) {
      nested.push(listToMd(sub as HTMLElement, indent + '  '));
      sub.remove();
    }
    const marker = ordered ? `${n++}.` : '-';
    lines.push(`${indent}${marker} ${inlineMd(clone).trim()}`);
    lines.push(...nested);
  }
  return lines.join('\n');
}

function blockToMd(node: Node): string | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const t = (node.nodeValue ?? '').trim();
    return t === '' ? null : t;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as HTMLElement;
  const tag = el.tagName;
  const h = /^H([1-6])$/.exec(tag);
  if (h) return `${'#'.repeat(Number(h[1]))} ${inlineMd(el).trim()}`;
  if (tag === 'UL' || tag === 'OL') return listToMd(el, '');
  if (tag === 'BLOCKQUOTE') {
    const inner = htmlToMarkdown(el).replace(/\n$/, '');
    return inner === '' ? null : inner.split('\n').map((l) => (l === '' ? '>' : `> ${l}`)).join('\n');
  }
  if (tag === 'PRE') {
    const lang = el.getAttribute('data-lang') ?? '';
    const text = (el.textContent ?? '').replace(/\n$/, '');
    return `\`\`\`${lang}\n${text}\n\`\`\``;
  }
  if (tag === 'HR') return '---';
  if (tag === 'BR') return null;
  // A bare image between blocks (no <p> wrapper) is still content.
  if (tag === 'IMG') {
    return `![${el.getAttribute('alt') ?? ''}](${mdDestination(el.getAttribute('src') ?? '')})`;
  }
  // P, DIV, and anything unrecognized serialize as a paragraph.
  const inner = inlineMd(el).trim();
  return inner === '' ? null : inner;
}

/** Serialize the contenteditable's DOM back to subset markdown. */
export function htmlToMarkdown(root: HTMLElement): string {
  const blocks: string[] = [];
  for (const node of Array.from(root.childNodes)) {
    const b = blockToMd(node);
    if (b !== null) blocks.push(b);
  }
  return blocks.length ? blocks.join('\n\n') + '\n' : '';
}
