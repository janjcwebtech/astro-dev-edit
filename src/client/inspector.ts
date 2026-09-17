import type { SourceLoc, UsageLink, CompositionCoverage } from '../shared/protocol.ts';
import * as api from './api.ts';
import { readRenderOccurrences } from './composition-dom.ts';
import { rulesForElement } from './css-inspect.ts';
import { has } from './features.ts';
import { card, item } from './group.ts';
import { createInspectorLoader, occurrenceSummary } from './inspector-model.ts';
import { nearestOwnSource, sourceFor } from './source-map.ts';
import { basename, footButton, isolateScroll, styled } from './ui.ts';

export interface InspectorDeps {
  viewCode(source: SourceLoc): void;
  openRule(file: string, selector: string): void;
  backingFile(): string | null;
  onClose(): void;
}

/** Read-only view. No classification, interaction slot, or write API. */
export function initInspector(deps: InspectorDeps) {
  const root = styled('aside', 'atx-inspector');
  root.setAttribute('aria-label', 'Source inspector');
  const header = styled('div', 'atx-inspector-header');
  const title = styled('strong', 'atx-inspector-title');
  const closeButton = footButton('Close', 'ghost', close);
  header.append(title, closeButton);
  const body = styled('div', 'atx-inspector-body');
  isolateScroll(body);
  root.append(header, body);
  const loader = createInspectorLoader(api);
  let selected: HTMLElement | null = null;
  let generation = 0;

  function close() {
    generation++;
    loader.invalidate();
    selected = null;
    root.removeAttribute('data-on');
    deps.onClose();
  }

  function note(parent: HTMLElement, text: string) {
    const p = styled('p', 'atx-inspector-note');
    p.textContent = text;
    parent.append(p);
  }

  function codeButton(source: SourceLoc, label = 'View code') {
    const button = footButton(label, 'outline', () => deps.viewCode(source));
    button.title = `${source.file}:${source.loc}`;
    return button;
  }

  function sourceRow(parent: HTMLElement, label: string, src: SourceLoc, description?: string) {
    parent.append(item({ title: label, description: description ?? `${basename(src.file)}:${src.loc}`,
      actions: [codeButton(src)] }).root);
  }

  function coverage(parent: HTMLElement, value: CompositionCoverage) {
    if (value.complete) return;
    const details = styled('details', 'atx-inspector-details');
    const summary = styled('summary', '');
    summary.textContent = `Incomplete discovery · ${value.files} files`;
    details.append(summary);
    for (const issue of value.issues) note(details, `${issue.reason} · ${issue.file}${issue.loc ? ':' + issue.loc : ''}`);
    parent.append(details);
  }

  function usage(parent: HTMLElement, link: UsageLink) {
    const row = item({ title: link.name,
      description: link.target ? basename(link.target) : `Unresolved · ${link.refusal ?? 'unresolved'}`,
      actions: [
        ...(link.target ? [codeButton({ file: link.target, loc: '1:1' })] : []),
        codeButton(link, 'Open parent'),
      ] });
    const details = styled('details', 'atx-inspector-details');
    const summary = styled('summary', '');
    summary.textContent = `Usage at ${basename(link.file)}:${link.loc}`;
    details.append(summary);
    for (const prop of link.props) {
      note(details, `${prop.name} · ${prop.kind}`);
      const value = styled('pre', 'atx-inspector-code');
      value.textContent = prop.source;
      details.append(value);
    }
    for (const slot of link.slots) {
      note(details, `Slot ${slot.name || 'default'} · caller source`);
      const value = styled('pre', 'atx-inspector-code');
      value.textContent = slot.source;
      details.append(value);
    }
    row.content.append(details);
    parent.append(row.root);
  }

  function css(el: HTMLElement) {
    const section = card({ title: 'CSS', description: 'Selector matches in stylesheet order; conditional rules may be inactive. Computed values include inheritance.' });
    if (!has('cssInspector')) {
      note(section.body, 'CSS inspection is disabled in settings.');
      return section.root;
    }
    const inline = el.getAttribute('style');
    if (inline) {
      const code = styled('pre', 'atx-inspector-code');
      code.textContent = `element.style {\n${inline}\n}`;
      section.body.append(code);
    }
    const computed = getComputedStyle(el);
    const details = styled('details', 'atx-inspector-details');
    const summary = styled('summary', '');
    summary.textContent = 'Computed styles';
    const values = styled('pre', 'atx-inspector-code');
    values.textContent = ['display', 'position', 'width', 'height', 'color', 'background-color',
      'font-family', 'font-size', 'font-weight', 'line-height', 'margin', 'padding', 'gap']
      .map(property => `${property}: ${computed.getPropertyValue(property)};`).join('\n');
    details.append(summary, values);
    section.body.append(details);
    const rules = rulesForElement(el);
    if (!rules.length) note(section.body, 'No readable matched rules. Cross-origin stylesheets may be unavailable.');
    for (const rule of rules) {
      const row = item({ title: rule.selectorText, description: rule.sourceFile ? basename(rule.sourceFile) : 'Inline or unavailable source',
        actions: rule.sourceFile && has('openInEditor') ? [footButton('Open in editor', 'outline',
          () => deps.openRule(rule.sourceFile!, rule.selectorText))] : [] });
      const code = styled('pre', 'atx-inspector-code');
      code.textContent = rule.declarations;
      row.content.append(code);
      section.body.append(row.root);
    }
    return section.root;
  }

  async function select(el: HTMLElement) {
    selected = el;
    const current = ++generation;
    loader.invalidate();
    const pathname = location.pathname;
    const alive = () => current === generation && el.isConnected && pathname === location.pathname;
    title.textContent = `<${el.tagName.toLowerCase()}> · Read-only`;
    root.setAttribute('data-on', '');
    body.replaceChildren();
    const values = card({ title: 'Values', description: 'Rendered value · read-only' });
    const text = styled('pre', 'atx-inspector-code');
    text.textContent = el instanceof HTMLImageElement ? `src: ${el.currentSrc || el.src}\nalt: ${el.alt}`
      : (el.textContent ?? '').trim().slice(0, 4000) || '(No text content)';
    values.body.append(text);
    const source = sourceFor(el);
    const opaque = !!el.parentElement?.closest('[data-atx-boundary="html"]');
    if (source && !opaque) sourceRow(values.body, 'Written here', source);
    else if (el.parentElement) {
      const ancestor = nearestOwnSource(el.parentElement);
      const ancestorSource = ancestor && sourceFor(ancestor);
      if (ancestorSource) sourceRow(values.body, 'Enclosing source', ancestorSource, 'Container source; this element’s source is not proven.');
    }
    const backing = deps.backingFile();
    if (backing) sourceRow(values.body, 'Page backing file', { file: backing, loc: '1:1' }, 'Route content file; individual value mapping is not proven.');
    const chain = card({ title: 'Component chain' });
    const slots = card({ title: 'Slot relationships' });
    body.append(values.root, chain.root, slots.root, css(el));

    // Never climb from an untracked descendant to manufacture its ownership.
    if (opaque || !source) {
      note(chain.body, opaque ? 'No chain · untracked-html. Generated HTML has no proven inner-element source relationship.'
        : 'No chain · this element has no source annotation.');
      note(slots.body, 'No proven slot relationship.');
      return;
    }
    const render = readRenderOccurrences(document);
    if (!render.result.ok) {
      note(chain.body, `No chain · ${render.result.reason}. Render annotations are incomplete or damaged.`);
      note(slots.body, 'Slot placement graph refused.');
      return;
    }
    const key = render.elements.indexOf(el);
    const occurrence = render.result.occurrences.find(p => p.key === key);
    const peers = render.result.occurrences.filter(p => {
      const peer = render.elements[p.key];
      return peer.getAttribute('data-atx-file') === el.getAttribute('data-atx-file') &&
        peer.getAttribute('data-atx-chain') === el.getAttribute('data-atx-chain') &&
        peer.getAttribute('data-atx-loc') === el.getAttribute('data-atx-loc');
    });
    const group = occurrence && occurrenceSummary(occurrence, peers);
    if (group) note(values.body, `Rendered occurrence ${group.index} of ${group.total} of this source element.`);
    if (!group?.slots.length) note(slots.body, 'No tracked slot insertion contains this element.');
    for (const slot of group?.slots ?? []) {
      sourceRow(slots.body, `${slot.name || 'default'} slot · ${slot.fallback ? 'fallback' : 'supplied content'}`,
        { file: slot.file, loc: slot.loc }, `Rendered inside ${basename(slot.file)}:${slot.loc}`);
    }
    const loading = styled('p', 'atx-inspector-note');
    loading.textContent = 'Resolving component chain…';
    loading.setAttribute('role', 'status');
    chain.body.append(loading);
    try {
      const answer = await loader.load({ pathname, file: source.file,
        chain: el.getAttribute('data-atx-chain') ?? undefined,
        ...(el.getAttribute('data-atx-version') === '2' ? { traceVersion: 2 as const } : {}),
      });
      if (!answer || !alive()) return;
      chain.body.replaceChildren();
      const labels = { proven: 'Proven chain', inferred: 'Inferred source path · rendered instance is not proven',
        candidates: 'Multiple possible source paths · no path selected', none: 'No chain' };
      note(chain.body, `${labels[answer.chain.tier]}${answer.chain.reason ? ' · ' + answer.chain.reason : ''}`);
      if (answer.chain.route) sourceRow(chain.body, 'Route', { file: answer.chain.route, loc: '1:1' });
      for (const link of answer.chain.links) usage(chain.body, link);
      for (const [index, candidate] of (answer.chain.candidates ?? []).entries()) {
        const details = styled('details', 'atx-inspector-details');
        const summary = styled('summary', '');
        summary.textContent = `Possible path ${index + 1}`;
        details.append(summary);
        candidate.forEach(link => usage(details, link));
        chain.body.append(details);
      }
      coverage(chain.body, answer.chain.coverage);
      const uses = styled('details', 'atx-inspector-details');
      const summary = styled('summary', '');
      summary.textContent = `Usages on this route · ${answer.uses.links.length}`;
      uses.append(summary);
      note(uses, 'Source usage sites, including unrendered branches. These are not rendered instance counts.');
      if (answer.uses.reason) note(uses, answer.uses.reason);
      answer.uses.links.forEach(link => usage(uses, link));
      coverage(uses, answer.uses.coverage);
      chain.body.append(uses);
    } catch (error) {
      if (alive()) loading.textContent = `Could not load composition · ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  // Hydration can replace a selected node without a Vite update. Never keep
  // displaying a former node's chain as if it described its replacement.
  new MutationObserver(() => {
    if (selected && !selected.isConnected) close();
  }).observe(document.documentElement, { childList: true, subtree: true });

  return { root, select, close, isOpen: () => selected !== null,
    invalidate() { close(); } };
}
