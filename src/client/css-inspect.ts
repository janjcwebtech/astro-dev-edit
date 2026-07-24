/**
 * The hover-pill CSS inspector's client core: read which CSS rules an element
 * matches through a given class/ID, straight from the browser's CSSOM, and
 * build the little rules card the pill shows on chip hover.
 *
 * All of this is client-only — `document.styleSheets` already knows the applied
 * rules and their declarations. The one thing the CSSOM does NOT expose is a
 * rule's source line, so the card's "open ↗" defers to the server
 * (/inspect/open) to jump the editor there. See src/server/inspect-locate.ts.
 */

import { COLOR, FONT, Z, basename, isolateScroll, styled } from './ui.ts';

/** One applied rule, distilled for display. */
export interface MatchedRule {
  /** The comma-joined sub-selectors (of this rule) the element actually matched. */
  selectorText: string;
  /** The declaration block, one `prop: value;` per line. */
  declarations: string;
  /** Source file the rule came from (root-relative or absolute), or null when
   *  it can't be resolved (inline <style>, cross-origin) — no open link then. */
  sourceFile: string | null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `sub` contains the class/id token as a whole selector token
 *  (so `.foo` doesn't match `.foobar`). Works on Astro's scoped selectors too,
 *  where the token still appears literally alongside `:where([data-astro-cid-…])`. */
function referencesToken(sub: string, token: string, kind: 'class' | 'id'): boolean {
  const prefix = kind === 'class' ? '\\.' : '#';
  return new RegExp(prefix + escapeRegExp(token) + '(?![\\w-])').test(sub);
}

/** Split a selector list on top-level commas — commas inside `()` / `[]`
 *  (e.g. `:is(.a, .b)`, attribute selectors) don't separate selectors. */
function splitSelectorList(selectorText: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of selectorText) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** The sub-selectors of `rule` that reference the token AND that `el` matches. */
function matchingSubSelectors(
  rule: CSSStyleRule,
  el: Element,
  token: string,
  kind: 'class' | 'id',
): string[] {
  const matched: string[] = [];
  for (const sub of splitSelectorList(rule.selectorText)) {
    if (!referencesToken(sub, token, kind)) continue;
    try {
      if (el.matches(sub)) matched.push(sub.trim());
    } catch {
      // Invalid/unsupported sub-selector — skip it rather than fail the scan.
    }
  }
  return matched;
}

/** Split a declaration block on top-level `;` — semicolons inside `()` (url,
 *  var, data URIs) or quotes don't separate declarations. */
function splitDeclarations(cssText: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (const ch of cssText) {
    if (quote) {
      if (ch === quote) quote = '';
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The rule's declarations as `prop: value;` lines, one per line. Uses cssText
 *  (not item()/getPropertyValue) so shorthands driven by CSS variables — which
 *  expand to empty longhands in the CSSOM — keep their authored value. */
function formatDeclarations(rule: CSSStyleRule): string {
  return splitDeclarations(rule.style.cssText)
    .map((d) => `${d};`)
    .join('\n');
}

/** Best-effort map a stylesheet to a source path the server can open. */
function sheetSource(sheet: CSSStyleSheet): string | null {
  // <link> / @import / Astro's `…/index.astro?astro&type=style` hrefs. The
  // pathname is dev-server-root-relative; strip the leading slash so the server
  // resolves it against the project root (an absolute "/src/…" would escape it).
  if (sheet.href) {
    try {
      const u = new URL(sheet.href, location.href);
      if (u.origin !== location.origin) return null; // external / CDN
      return decodeURIComponent(u.pathname).replace(/^\/+/, '') || null;
    } catch {
      return null;
    }
  }
  // Vite injects imported CSS as `<style data-vite-dev-id="/abs/path?…">`; that
  // absolute path is passed through as-is (the server confines it to the root).
  const viteId = (sheet.ownerNode as HTMLElement | null)?.dataset?.viteDevId;
  if (viteId) return viteId.split('?')[0];
  return null;
}

function walkRules(
  rules: CSSRuleList,
  el: Element,
  token: string,
  kind: 'class' | 'id',
  source: string | null,
  out: MatchedRule[],
  seen: Set<string>,
): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      const matched = matchingSubSelectors(rule, el, token, kind);
      if (matched.length === 0) continue;
      const declarations = formatDeclarations(rule);
      const key = `${matched.join(',')}|${declarations}|${source ?? ''}`;
      if (seen.has(key)) continue; // dev often injects the same rule twice (HMR)
      seen.add(key);
      out.push({ selectorText: matched.join(', '), declarations, sourceFile: source });
    } else if ('cssRules' in rule) {
      // @media / @supports / @layer / @container — recurse into the group.
      walkRules((rule as CSSGroupingRule).cssRules, el, token, kind, source, out, seen);
    }
  }
}

/** Every rule `el` matches through `token`, across all readable stylesheets. */
export function rulesForToken(el: Element, token: string, kind: 'class' | 'id'): MatchedRule[] {
  const out: MatchedRule[] = [];
  const seen = new Set<string>();
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin stylesheet — CSSOM access throws; skip it
    }
    walkRules(rules, el, token, kind, sheetSource(sheet), out, seen);
  }
  return out;
}

// --- Card DOM ----------------------------------------------------------------

/** A small "open ↗" button matching the pill's own, for a rule's source jump. */
function openButton(onClick: () => void): HTMLButtonElement {
  const btn = styled('button', 'atx-tooltip-rule-open', {
    marginLeft: '8px',
    padding: '2px 7px',
    font: `600 10.5px ${FONT.ui}`,
    color: '#fff',
    background: 'rgba(255,255,255,0.14)',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    flex: '0 0 auto',
  });
  btn.type = 'button';
  btn.textContent = 'open ↗';
  btn.title = 'Open this rule in your editor';
  btn.addEventListener('mouseenter', () => (btn.style.background = 'rgba(255,255,255,0.28)'));
  btn.addEventListener('mouseleave', () => (btn.style.background = 'rgba(255,255,255,0.14)'));
  btn.addEventListener('click', onClick);
  return btn;
}

// CSS declaration syntax colors on the card's dark ground — the same palette
// the source-peek panel uses, so highlighting reads consistently across the UI.
const CSS_COLOR = {
  prop: '#82b1ff', // property name
  value: '#cfd2e6', // keyword / identifier value
  string: '#a5d6a7',
  number: '#f5c27a', // numbers, units, hex colors
  variable: '#c9a7ff', // custom properties (--foo)
  keyword: '#ff8a9e', // !important
  punct: '#8b94a7', // : ; , ( ) and the like
} as const;

// One pass over a declaration's value: strings, hex colors, custom-property
// refs, !important, numbers-with-units, identifiers, whitespace, punctuation.
const VALUE_TOKEN =
  /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(#[0-9a-fA-F]{3,8}\b)|(--[A-Za-z0-9-]+)|(!important\b)|(-?\d*\.?\d+[a-z%]*)|([A-Za-z][\w-]*)|(\s+)|([^\s])/g;

function span(text: string, color: string): HTMLElement {
  const s = styled('span', '', { color });
  s.textContent = text;
  return s;
}

/** Append syntax-colored spans for one `prop: value;` line onto `pre`. Anything
 *  unrecognized stays a plain value span — a wrong guess is never wrong code. */
function appendDeclLine(pre: HTMLElement, line: string): void {
  const colon = line.indexOf(':');
  if (colon === -1) {
    pre.append(span(line, CSS_COLOR.value));
    return;
  }
  const prop = line.slice(0, colon);
  pre.append(span(prop, /^\s*--/.test(prop) ? CSS_COLOR.variable : CSS_COLOR.prop));
  pre.append(span(':', CSS_COLOR.punct));
  for (const m of line.slice(colon + 1).matchAll(VALUE_TOKEN)) {
    const [text, str, hex, variable, imp, num, ident, ws] = m;
    const color = str
      ? CSS_COLOR.string
      : hex || num
        ? CSS_COLOR.number
        : variable
          ? CSS_COLOR.variable
          : imp
            ? CSS_COLOR.keyword
            : ident || ws
              ? CSS_COLOR.value
              : CSS_COLOR.punct;
    pre.append(span(text, color));
  }
}

/** Fill the declarations `<pre>` with syntax-highlighted lines. */
function renderDeclarations(pre: HTMLElement, declarations: string): void {
  declarations.split('\n').forEach((line, i) => {
    if (i > 0) pre.append(document.createTextNode('\n'));
    appendDeclLine(pre, line);
  });
}

function ruleBlock(
  rule: MatchedRule,
  selector: string,
  first: boolean,
  openRule: (file: string, selector: string) => void,
): HTMLElement {
  const block = styled('div', 'atx-tooltip-rule', {
    padding: first ? '0 0 6px' : '6px 0',
    borderTop: first ? 'none' : `1px solid ${COLOR.panelDivider}`,
  });

  const sel = styled('div', 'atx-tooltip-rule-sel', {
    color: '#cbb9ff',
    wordBreak: 'break-all',
  });
  sel.textContent = rule.selectorText;

  // 10px of breathing room above and below the properties list.
  const decl = styled('pre', 'atx-tooltip-rule-decl', {
    margin: '10px 0',
    font: `12px ${FONT.mono}`,
    color: CSS_COLOR.value,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  });
  renderDeclarations(decl, rule.declarations);
  block.append(sel, decl);

  if (rule.sourceFile) {
    const foot = styled('div', 'atx-tooltip-rule-foot', {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    });
    const src = styled('span', 'atx-tooltip-rule-src', {
      color: COLOR.muted,
      font: `10.5px ${FONT.mono}`,
      overflow: 'hidden',
      whiteSpace: 'nowrap',
      textOverflow: 'ellipsis',
    });
    src.textContent = basename(rule.sourceFile);
    src.title = rule.sourceFile;
    foot.append(src, openButton(() => openRule(rule.sourceFile!, selector)));
    block.append(foot);
  }
  return block;
}

/**
 * Build the (detached, fixed-position) rules card for one class/ID chip. The
 * caller appends it to the body and positions it; `selector` is the fragment
 * (".hero-title" / "#masthead") passed to the open jump.
 */
export function buildRulesCard(
  selector: string,
  rules: MatchedRule[],
  openRule: (file: string, selector: string) => void,
): HTMLElement {
  const card = styled('div', 'atx-tooltip-rules', {
    position: 'fixed',
    zIndex: String(Z + 1),
    maxWidth: '360px',
    maxHeight: '50vh',
    overflowY: 'auto',
    padding: '8px 10px',
    background: COLOR.panelBg,
    color: '#ddd',
    border: `1px solid ${COLOR.panelBorder}`,
    borderRadius: '6px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    font: `12px ${FONT.mono}`,
    cursor: 'default',
  });
  isolateScroll(card);

  if (rules.length === 0) {
    const empty = styled('div', 'atx-tooltip-rules-empty', { color: COLOR.muted });
    empty.textContent = `No applied rules for ${selector}`;
    card.append(empty);
    return card;
  }
  rules.forEach((rule, i) => card.append(ruleBlock(rule, selector, i === 0, openRule)));
  return card;
}
