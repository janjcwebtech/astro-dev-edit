/**
 * astro-text-edit overlay — injected browser client.
 *
 * Edit mode gives you a hover highlight, and clicking routes by classification.
 * The DOM-side guess is only a hover hint: every click is confirmed against the
 * server's AST-truth /classify before an editor opens (a resolved {expression}
 * looks identical to literal text in the DOM). (spec §7.3, §16.1)
 *   - literal text  → inline contenteditable (Enter/blur commits, Esc cancels)
 *   - image         → swap panel (alt field + upload + asset list)
 *   - dynamic/other → a refusal notice with "Open source"
 * Commits POST /apply, which verifies the source still matches what the client
 * saw and patches the file atomically. Astro HMR then reloads the page from
 * disk; edit mode survives the reload via sessionStorage.
 *
 * Vanilla TS, no framework, no dependencies. (spec §4.2)
 */

import type {
  ApplyRequestWire,
  AttrState,
  ClassifyResult,
  SourceLoc,
} from '../shared/protocol.ts';

const API = '/__text-edit';
const Z = 2147483000; // above Astro's dev toolbar, below nothing that matters

/** DOM-side hover hint only — the server's ClassifyResult is authoritative. */
type Classification = 'editable' | 'image' | 'dynamic' | 'unknown';

let editMode = false;
let highlighted: HTMLElement | null = null;

// ---------------------------------------------------------------------------
// Source-location cache
// ---------------------------------------------------------------------------
//
// Astro emits `data-astro-source-file` / `-loc` in the served HTML, but its
// dev-toolbar runtime STRIPS those attributes out of the DOM shortly after
// hydration. By hover time they are gone — querying them live finds nothing.
// (Verified against Astro 5.18: 254 attrs in served HTML, 0 in the live DOM.)
//
// So we snapshot every annotated element into a WeakMap the instant this script
// runs, before the toolbar clears them, and read hover/edit locations from the
// cache instead of from live attributes. This is the same approach the site's
// existing astro-click-to-source integration uses. It also supersedes spec
// §4.2's "re-read attributes lazily on next hover", which is not viable here.

// Two-layer cache. The primary key is the element itself: when we see an
// annotated element we copy its {file, loc} onto a private JS property. A JS
// property survives the attribute-strip (Astro removes the HTML attribute, not
// our property) AND survives across hover with no path matching. The secondary
// path-keyed map is the fallback for the case where Astro REPLACES a node
// wholesale (new object, our property gone): we re-resolve by structural path.
//
// The critical timing fix: we don't snapshot once and hope. A MutationObserver
// watches for the attributes being added (initial render / HMR) and stamps them
// onto the element the moment they appear — so we always capture the value
// before the toolbar's own observer strips it, regardless of ordering.

const PROP = '__astroTextEditSrc' as const;

interface Stamped extends HTMLElement {
  [PROP]?: SourceLoc;
}

const sourceByPath = new Map<string, SourceLoc>();

/** Structural path: `tag:nth-of-type` chain to the document root. Computed from
 *  the live DOM at both stamp and lookup time, so the two always agree. */
function elementPath(el: HTMLElement): string {
  const parts: string[] = [];
  let cur: HTMLElement | null = el;
  while (cur && cur.parentElement) {
    const parent: HTMLElement = cur.parentElement;
    const tag = cur.tagName;
    let idx = 1;
    for (const sib of parent.children) {
      if (sib === cur) break;
      if (sib.tagName === tag) idx++;
    }
    parts.unshift(`${tag.toLowerCase()}:nth-of-type(${idx})`);
    cur = parent;
  }
  return parts.join('>');
}

/** Record an annotated element's source loc into both cache layers. */
function stamp(el: Stamped): void {
  if (el[PROP]) return;
  const file = el.getAttribute('data-astro-source-file');
  if (!file) return;
  const loc = el.getAttribute('data-astro-source-loc') ?? '';
  const src: SourceLoc = { file, loc };
  el[PROP] = src;
  sourceByPath.set(elementPath(el), src);
}

/** Snapshot everything currently annotated in the DOM. */
function cacheSourceMappings(): void {
  for (const el of document.querySelectorAll<Stamped>('[data-astro-source-file]')) {
    stamp(el);
  }
}

/** Resolve a live element's source loc: property first, path fallback. */
function sourceFor(el: HTMLElement): SourceLoc | undefined {
  return (el as Stamped)[PROP] ?? sourceByPath.get(elementPath(el));
}

// Stamp attributes the instant they appear, before the dev toolbar strips them.
// This wins the race regardless of script ordering. (verified fix)
const stampObserver = new MutationObserver((records) => {
  for (const rec of records) {
    if (rec.type === 'attributes' && rec.target instanceof HTMLElement) {
      stamp(rec.target);
    }
    for (const node of rec.addedNodes) {
      if (node instanceof HTMLElement) {
        if (node.hasAttribute('data-astro-source-file')) stamp(node);
        for (const el of node.querySelectorAll<Stamped>('[data-astro-source-file]')) {
          stamp(el);
        }
      }
    }
  }
});

function startCapture(): void {
  cacheSourceMappings(); // grab whatever is already present
  stampObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-astro-source-file', 'data-astro-source-loc'],
  });
}

// Begin capturing as early as possible. If the body isn't parsed yet, wait for
// it; the observer then catches every annotated node as it arrives.
if (document.body) {
  startCapture();
} else {
  document.addEventListener('DOMContentLoaded', startCapture, { once: true });
}

// ---------------------------------------------------------------------------
// UI elements
// ---------------------------------------------------------------------------

const outline = document.createElement('div');
outline.dataset.astroTextEditUi = '1';
Object.assign(outline.style, {
  position: 'fixed',
  pointerEvents: 'none',
  zIndex: String(Z),
  border: '2px solid #7c5cff',
  borderRadius: '3px',
  background: 'rgba(124, 92, 255, 0.08)',
  display: 'none',
  transition: 'all 60ms ease-out',
} as CSSStyleDeclaration);

// The pill is interactive: hovering it keeps it open, and its "open source"
// button jumps to the element's source in the editor. (#3)
const tooltip = document.createElement('div');
tooltip.dataset.astroTextEditUi = '1';
Object.assign(tooltip.style, {
  position: 'fixed',
  pointerEvents: 'auto',
  zIndex: String(Z + 1),
  padding: '4px 4px 4px 8px',
  font: '500 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
  color: '#fff',
  background: '#1a1a2e',
  borderRadius: '5px',
  boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
  display: 'none',
  whiteSpace: 'nowrap',
  cursor: 'default',
} as CSSStyleDeclaration);

const tooltipLabel = document.createElement('span');
const tooltipOpen = document.createElement('button');
tooltipOpen.dataset.astroTextEditUi = '1';
tooltipOpen.type = 'button';
tooltipOpen.textContent = 'open ↗';
tooltipOpen.title = 'Open this location in your editor';
Object.assign(tooltipOpen.style, {
  marginLeft: '8px',
  padding: '2px 7px',
  font: '600 11px ui-sans-serif, system-ui, sans-serif',
  color: '#fff',
  background: 'rgba(255,255,255,0.14)',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
} as CSSStyleDeclaration);
tooltipOpen.addEventListener('mouseenter', () => (tooltipOpen.style.background = 'rgba(255,255,255,0.28)'));
tooltipOpen.addEventListener('mouseleave', () => (tooltipOpen.style.background = 'rgba(255,255,255,0.14)'));
tooltip.append(tooltipLabel, tooltipOpen);

const toggle = document.createElement('button');
toggle.dataset.astroTextEditUi = '1';
toggle.type = 'button';
toggle.textContent = 'Edit';
toggle.title = 'Toggle text-edit mode';
Object.assign(toggle.style, {
  position: 'fixed',
  // Offset up from the bottom so it clears Astro's dev toolbar bar. (spec §4.2)
  right: '16px',
  bottom: '64px',
  zIndex: String(Z + 2),
  padding: '8px 14px',
  font: '600 13px/1 ui-sans-serif, system-ui, sans-serif',
  color: '#fff',
  background: '#4a4a6a',
  border: 'none',
  borderRadius: '999px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
  cursor: 'pointer',
} as CSSStyleDeclaration);

// ---------------------------------------------------------------------------
// Classification (client-side hint only — the server is authoritative later)
// ---------------------------------------------------------------------------

/**
 * A cheap, purely-visual guess so the tooltip can say what will happen. The
 * server re-classifies from the AST at apply time regardless. (spec §7.3)
 */
function classify(el: HTMLElement): Classification {
  if (el.tagName === 'IMG') return 'image';

  const children = Array.from(el.childNodes);
  const hasElementChild = children.some((n) => n.nodeType === Node.ELEMENT_NODE);
  const hasText = children.some(
    (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0,
  );

  // Only-text content is the safe editable case. Anything with child elements
  // could be expression- or component-driven — treat as dynamic until the
  // server says otherwise. (spec §7.1 / §7.2)
  if (hasText && !hasElementChild) return 'editable';
  if (hasElementChild) return 'dynamic';
  return 'unknown';
}

const CLASS_COLOR: Record<Classification, string> = {
  editable: '#7c5cff',
  image: '#2bb673',
  dynamic: '#e0a800',
  unknown: '#888',
};

/**
 * Nearest ancestor (or self) with a cached source location, resolved by
 * structural path. Reads the snapshot cache, not live attributes — the
 * attributes are gone by now.
 */
function nearestSource(node: EventTarget | null): HTMLElement | null {
  let el = node as HTMLElement | null;
  while (el && el !== document.body) {
    if (sourceFor(el)) return el;
    el = el.parentElement;
  }
  return null;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * The content file backing a detail page, if the page declares one.
 *
 * Detail routes (e.g. `/area/<slug>/`) render a markdown/MDX entry through a
 * template, so their dynamic text — the title, body prose, etc. — lives in a
 * `.md`/`.mdx` file, not in the `.astro` the source loc points at. Editing that
 * text in place needs expression-following (spec §16.3), which isn't built. As
 * a fast interim (§16.2), a page can opt in by emitting
 *   <meta name="astro-text-edit:page-source" content="src/content/…/x.mdx">
 * and we surface an "Edit page content" jump-to-source button on the refusal
 * notice. Archive/listing pages simply omit the meta and get nothing extra.
 */
function pageSource(): string | null {
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="astro-text-edit:page-source"]',
  );
  const content = meta?.content?.trim();
  return content ? content : null;
}

// ---------------------------------------------------------------------------
// Hover behaviour
// ---------------------------------------------------------------------------

// Source of the currently-highlighted element, so the pill's "open" button
// knows what to open.
let highlightedSrc: SourceLoc | null = null;
// Grace timer: when the mouse leaves an element we wait briefly before hiding,
// so the user can travel up to the pill and click it without it vanishing. (#3)
let hideTimer: number | null = null;

function cancelHide(): void {
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function scheduleHide(): void {
  cancelHide();
  hideTimer = window.setTimeout(clearHighlight, 220);
}

function onMouseMove(e: MouseEvent): void {
  if (!editMode) return;
  // Moving onto our own pill must NOT count as leaving the element.
  if (e.target instanceof Node && tooltip.contains(e.target)) {
    cancelHide();
    return;
  }
  const el = nearestSource(e.target);
  if (!el) {
    scheduleHide(); // grace period instead of instant hide
    return;
  }
  cancelHide();
  if (el === highlighted) return;
  highlighted = el;

  const kind = classify(el);
  const color = CLASS_COLOR[kind];
  const rect = el.getBoundingClientRect();

  Object.assign(outline.style, {
    display: 'block',
    left: `${rect.left - 2}px`,
    top: `${rect.top - 2}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    borderColor: color,
    background: hexToRgba(color, 0.08),
  } as CSSStyleDeclaration);

  const src = sourceFor(el);
  highlightedSrc = src ?? null;
  const file = src?.file ?? '';
  const loc = src?.loc || '?';
  tooltipLabel.textContent = `${basename(file)}:${loc} · ${kind}`;
  tooltip.style.borderLeft = `3px solid ${color}`;
  tooltip.style.display = 'block';
  // Prefer above the element; if there's no room, sit just below it. Add a
  // little vertical overlap so travelling from element to pill doesn't cross a
  // dead gap that would trigger the hide.
  const top = rect.top - 28 < 4 ? rect.bottom + 4 : rect.top - 28;
  tooltip.style.left = `${Math.max(4, rect.left)}px`;
  tooltip.style.top = `${top}px`;
}

function clearHighlight(): void {
  cancelHide();
  highlighted = null;
  highlightedSrc = null;
  outline.style.display = 'none';
  tooltip.style.display = 'none';
}

// Keep the pill open while hovered, and open source on click. (#3)
tooltip.addEventListener('mouseenter', cancelHide);
tooltip.addEventListener('mouseleave', scheduleHide);
tooltipOpen.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (highlightedSrc) void openSource(highlightedSrc);
});

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---------------------------------------------------------------------------
// Toggle
// ---------------------------------------------------------------------------

function setEditMode(on: boolean): void {
  editMode = on;
  toggle.style.background = on ? '#7c5cff' : '#4a4a6a';
  toggle.textContent = on ? 'Editing' : 'Edit';
  document.body.style.cursor = on ? 'crosshair' : '';
  // Survive the full-page reload that follows every successful save.
  try {
    sessionStorage.setItem('astroTextEditMode', on ? '1' : '0');
  } catch {
    // sessionStorage unavailable (rare) — edit mode just won't persist.
  }
  if (!on) {
    clearHighlight();
    activeTextFinish?.(false); // cancel any open inline edit (restores text)
    dismissActive(); // leaving edit mode always tears down any open interaction
  }
}

toggle.addEventListener('click', () => setEditMode(!editMode));
document.addEventListener('mousemove', onMouseMove, { passive: true });
window.addEventListener('scroll', clearHighlight, { passive: true });

// Global Escape closes any open modal interaction (image/dynamic panel) and
// guarantees state resets. Inline text edits handle their own Escape (to
// restore original text) before this ever sees it.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && activeCloser) {
    e.preventDefault();
    dismissActive();
  }
});

// ---------------------------------------------------------------------------
// Editing interactions
// ---------------------------------------------------------------------------

let editingActive = false; // an inline edit or panel is currently open

// Closer for whatever modal interaction is currently open, so a single global
// Escape (or leaving edit mode) can always dismiss it and reset state — no path
// can leave `editingActive` stuck true.
let activeCloser: (() => void) | null = null;

function setActiveCloser(fn: (() => void) | null): void {
  activeCloser = fn;
}

function dismissActive(): void {
  const fn = activeCloser;
  activeCloser = null;
  if (fn) fn();
  editingActive = false;
}

/** A commit (or a click-to-re-target) may have started a NEW interaction by the
 *  time the previous async save settles — only clear the busy flag when nothing
 *  else took over in the meantime. */
function releaseEditingActive(): void {
  if (!activeTextFinish && !activeCloser) editingActive = false;
}

/** The real save: POST /apply. The server re-resolves the element in the AST,
 *  verifies the source still matches `original`, and writes atomically. Throws
 *  with the server's reason on refusal. (spec §5, §7.5) */
async function applyEdit(payload: ApplyRequestWire): Promise<void> {
  const res = await fetch(`${API}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `save failed (${res.status})`);
  }
}

// --- Server-side classification (AST truth) ---------------------------------

async function serverClassify(src: SourceLoc, tag: string): Promise<ClassifyResult> {
  const res = await fetch(`${API}/classify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: src.file, loc: src.loc, tag }),
  });
  const body = (await res.json().catch(() => ({}))) as ClassifyResult & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `classify failed (${res.status})`);
  return body;
}

// --- Inline text editing ---------------------------------------------------

// Handle to the in-progress inline edit's finish(), so a click elsewhere can
// commit it synchronously and then act on the new target in one gesture.
let activeTextFinish: ((commit: boolean) => void) | null = null;

function beginTextEdit(el: HTMLElement, src: SourceLoc): void {
  editingActive = true;
  clearHighlight();
  const original = el.textContent ?? '';

  el.setAttribute('contenteditable', 'plaintext-only');
  el.dataset.astroTextEditActive = '1';
  el.style.outline = '2px solid #7c5cff';
  el.style.outlineOffset = '2px';
  el.style.borderRadius = '2px';
  el.focus();

  // Select all so a full retype is one gesture.
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);

  const finish = (commit: boolean): void => {
    if (activeTextFinish === finish) activeTextFinish = null;
    el.removeEventListener('keydown', onKey);
    el.removeEventListener('blur', onBlur);
    el.removeAttribute('contenteditable');
    delete el.dataset.astroTextEditActive;
    el.style.outline = '';
    el.style.outlineOffset = '';

    const next = el.textContent ?? '';
    if (!commit || next === original) {
      el.textContent = original; // cancel / no-op restores exactly
      editingActive = false;
      return;
    }
    void commitTextEdit(el, src, original, next);
  };
  activeTextFinish = finish;

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  };
  const onBlur = (): void => finish(true);

  el.addEventListener('keydown', onKey);
  el.addEventListener('blur', onBlur, { once: true });
}

async function commitTextEdit(
  el: HTMLElement,
  src: SourceLoc,
  original: string,
  newText: string,
): Promise<void> {
  const release = lockElement(el);
  try {
    await applyEdit({
      file: src.file,
      loc: src.loc,
      tag: el.tagName.toLowerCase(),
      targetType: 'text',
      original,
      newText,
    });
    toast(`Saved — ${basename(src.file)}:${src.loc}`, 'ok');
    // The file is written; Astro HMR reloads the page from disk.
  } catch (err) {
    el.textContent = original;
    toast(`Save failed — ${err instanceof Error ? err.message : 'unknown error'}`, 'err');
  } finally {
    release();
    releaseEditingActive();
  }
}

// --- Image swap panel ------------------------------------------------------

async function beginImageEdit(
  img: HTMLImageElement,
  src: SourceLoc,
  attrs: { src: AttrState; alt: AttrState },
): Promise<void> {
  editingActive = true;
  clearHighlight();
  const originalSrc = img.getAttribute('src') ?? '';
  const originalAlt = img.getAttribute('alt') ?? '';
  // Only statically-quoted attributes can be patched; expression values must be
  // edited in the source. A missing alt can be added (img only). (spec §6.3)
  const srcEditable = attrs.src === 'static';
  const altEditable = attrs.alt !== 'dynamic';

  const panel = buildPanel(`Image · ${basename(src.file)}:${src.loc}`);
  const body = panel.querySelector('[data-body]') as HTMLElement;

  if (!srcEditable) {
    const note = document.createElement('p');
    note.textContent =
      'The image file is set from code (an expression or astro:assets), so it can’t be swapped here — only the alt text can be edited.';
    Object.assign(note.style, { margin: '0 0 12px', font: '12px/1.5 system-ui', color: '#e0a800' } as CSSStyleDeclaration);
    body.append(note);
  }

  const altLabel = document.createElement('label');
  altLabel.textContent = 'Alt text';
  Object.assign(altLabel.style, { display: 'block', font: '600 12px system-ui', marginBottom: '4px', opacity: '0.8' } as CSSStyleDeclaration);
  const altInput = document.createElement('input');
  altInput.value = originalAlt;
  Object.assign(altInput.style, {
    width: '100%', padding: '6px 8px', marginBottom: '12px', boxSizing: 'border-box',
    border: '1px solid #444', borderRadius: '5px', background: '#111', color: '#fff', font: '13px system-ui',
  } as CSSStyleDeclaration);

  // --- Upload drop-zone / file picker ---
  const drop = document.createElement('label');
  drop.textContent = 'Drop an image here, or click to choose a file';
  Object.assign(drop.style, {
    display: 'block', textAlign: 'center', padding: '18px 12px', marginBottom: '14px',
    border: '2px dashed #444', borderRadius: '8px', color: '#aaa', cursor: 'pointer',
    font: '13px system-ui', background: '#141420', transition: 'border-color 120ms, background 120ms',
  } as CSSStyleDeclaration);
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  drop.append(fileInput);

  const listLabel = document.createElement('div');
  listLabel.textContent = 'Or replace with an existing image';
  Object.assign(listLabel.style, { font: '600 12px system-ui', marginBottom: '6px', opacity: '0.8' } as CSSStyleDeclaration);

  const list = document.createElement('div');
  Object.assign(list.style, { maxHeight: '200px', overflowY: 'auto', display: 'grid', gap: '4px' } as CSSStyleDeclaration);
  list.textContent = 'Loading…';

  if (!altEditable) {
    altInput.disabled = true;
    altInput.title = 'The alt text is set from an expression — edit it in the source.';
    altInput.style.opacity = '0.5';
  }

  body.append(altLabel, altInput);
  if (srcEditable) body.append(drop, listLabel, list);

  // Upload handling: read the file, POST it, then commit with the returned path.
  const handleFile = async (file: File): Promise<void> => {
    if (!file.type.startsWith('image/')) {
      toast('That is not an image file', 'err');
      return;
    }
    drop.textContent = 'Uploading…';
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(file);
      });
      const res = await fetch(`${API}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl, filename: file.name }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `upload failed (${res.status})`);
      }
      const { webPath } = (await res.json()) as { webPath: string };
      img.setAttribute('src', webPath); // live preview
      close(true, webPath);
    } catch (err) {
      drop.textContent = 'Drop an image here, or click to choose a file';
      toast(`Upload failed — ${err instanceof Error ? err.message : 'unknown error'}`, 'err');
    }
  };

  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.style.borderColor = '#7c5cff';
    drop.style.background = '#1c1c33';
  });
  drop.addEventListener('dragleave', () => {
    drop.style.borderColor = '#444';
    drop.style.background = '#141420';
  });
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) void handleFile(file);
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void handleFile(file);
  });

  const close = (commit: boolean, chosenSrc?: string): void => {
    activeCloser = null;
    panel.remove();
    backdrop.remove();
    if (!commit) {
      img.setAttribute('src', originalSrc);
      img.setAttribute('alt', originalAlt);
      editingActive = false;
      return;
    }
    const nextSrc = chosenSrc ?? originalSrc;
    const nextAlt = altInput.value;
    if (nextSrc === originalSrc && nextAlt === originalAlt) {
      editingActive = false;
      return;
    }
    void commitImageEdit(img, src, { originalSrc, originalAlt, nextSrc, nextAlt });
  };

  const backdrop = buildBackdrop(() => close(false));
  wirePanelButtons(panel, () => close(false), () => close(true));
  setActiveCloser(() => close(false));
  document.body.append(backdrop, panel);
  altInput.focus();

  // Load the existing-images list, surfacing the real error and offering retry.
  const loadList = async (): Promise<void> => {
    list.textContent = 'Loading…';
    let files: string[];
    try {
      const res = await fetch(`${API}/assets`);
      if (!res.ok) throw new Error(`server returned ${res.status}`);
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('application/json')) {
        // Most likely our middleware didn't handle the route and Vite served
        // HTML — tells us exactly what went wrong instead of a vague message.
        throw new Error('endpoint returned non-JSON (middleware not reached?)');
      }
      files = ((await res.json()) as { files: string[] }).files;
      // A plain <img src> must reference a path that exists in the built site.
      // Files under /src/ are only served by the dev server — offering them
      // here would produce edits that break in production.
      files = files.filter((f) => !f.startsWith('/src/'));
    } catch (err) {
      list.textContent = '';
      const msg = document.createElement('div');
      msg.textContent = `Could not load image list: ${err instanceof Error ? err.message : 'unknown error'}`;
      Object.assign(msg.style, { color: '#e0a800', font: '12px system-ui', marginBottom: '8px' } as CSSStyleDeclaration);
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Retry';
      Object.assign(retry.style, {
        padding: '5px 12px', borderRadius: '6px', border: '1px solid #555',
        background: 'transparent', color: '#ccc', cursor: 'pointer', font: '600 12px system-ui',
      } as CSSStyleDeclaration);
      retry.addEventListener('click', () => void loadList());
      list.append(msg, retry);
      return;
    }

    list.textContent = '';
    if (!files.length) {
      list.textContent = 'No images found in asset directories.';
      return;
    }
    for (const file of files) {
      const row = document.createElement('button');
      row.type = 'button';
      const current = file === originalSrc;
      Object.assign(row.style, {
        display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left',
        padding: '5px 8px', border: '1px solid #333', borderRadius: '5px',
        background: current ? '#2b2b4a' : '#161622', color: '#ddd', cursor: 'pointer',
        font: '12px ui-monospace, monospace', width: '100%', boxSizing: 'border-box',
      } as CSSStyleDeclaration);

      // Thumbnail. The dev server serves the same web path, so we can point an
      // <img> straight at it. A checkerboard placeholder shows through for
      // transparent images; on load failure we swap in a neutral marker.
      const thumb = document.createElement('img');
      thumb.src = file;
      thumb.alt = '';
      thumb.loading = 'lazy';
      thumb.decoding = 'async';
      Object.assign(thumb.style, {
        flex: '0 0 auto', width: '70px', height: '50px', objectFit: 'cover',
        borderRadius: '4px', border: '1px solid #333',
        background:
          'repeating-conic-gradient(#2a2a3a 0% 25%, #202030 0% 50%) 50% / 12px 12px',
      } as CSSStyleDeclaration);
      thumb.addEventListener('error', () => {
        thumb.style.display = 'none';
        marker.style.display = 'flex';
      });
      // Fallback tile shown only if the thumbnail fails to load.
      const marker = document.createElement('span');
      marker.textContent = '🖼';
      Object.assign(marker.style, {
        display: 'none', flex: '0 0 auto', width: '70px', height: '50px',
        alignItems: 'center', justifyContent: 'center', borderRadius: '4px',
        border: '1px solid #333', background: '#202030', font: '16px system-ui',
      } as CSSStyleDeclaration);

      const name = document.createElement('span');
      name.textContent = basename(file);
      name.title = file; // full path on hover — the row is otherwise truncated
      Object.assign(name.style, {
        flex: '1 1 auto', minWidth: '0', overflow: 'hidden',
        whiteSpace: 'nowrap', textOverflow: 'ellipsis',
      } as CSSStyleDeclaration);

      row.append(thumb, marker, name);
      row.addEventListener('mouseenter', () => (row.style.background = '#33335a'));
      row.addEventListener('mouseleave', () => (row.style.background = current ? '#2b2b4a' : '#161622'));
      row.addEventListener('click', () => {
        img.setAttribute('src', file); // live preview
        close(true, file);
      });
      list.append(row);
    }
  };

  void loadList();
}

async function commitImageEdit(
  img: HTMLImageElement,
  src: SourceLoc,
  v: { originalSrc: string; originalAlt: string; nextSrc: string; nextAlt: string },
): Promise<void> {
  const release = lockElement(img);
  try {
    img.setAttribute('src', v.nextSrc);
    img.setAttribute('alt', v.nextAlt);
    const common = { file: src.file, loc: src.loc, tag: 'img' };
    if (v.nextSrc !== v.originalSrc) {
      await applyEdit({ ...common, targetType: 'src', original: v.originalSrc, newText: v.nextSrc });
    }
    if (v.nextAlt !== v.originalAlt) {
      await applyEdit({ ...common, targetType: 'alt', original: v.originalAlt, newText: v.nextAlt });
    }
    toast(`Saved — ${basename(src.file)}:${src.loc}`, 'ok');
  } catch (err) {
    img.setAttribute('src', v.originalSrc);
    img.setAttribute('alt', v.originalAlt);
    toast(`Save failed — ${err instanceof Error ? err.message : 'unknown error'}`, 'err');
  } finally {
    release();
    releaseEditingActive();
  }
}

// --- Dynamic refusal notice ------------------------------------------------

function showDynamicNotice(el: HTMLElement, src: SourceLoc, reason: string): void {
  editingActive = true;
  clearHighlight();
  const panel = buildPanel('Can’t edit this here');
  const body = panel.querySelector('[data-body]') as HTMLElement;

  const msg = document.createElement('p');
  msg.textContent = reason;
  Object.assign(msg.style, { margin: '0 0 6px', font: '13px/1.5 system-ui', color: '#ddd' } as CSSStyleDeclaration);

  const where = document.createElement('p');
  where.textContent = `${basename(src.file)}:${src.loc}`;
  Object.assign(where.style, { margin: '0 0 12px', font: '12px ui-monospace, monospace', color: '#999' } as CSSStyleDeclaration);

  body.append(msg, where);

  // On a detail page whose content lives in a markdown/MDX file, that file is
  // almost always the *right* place to edit this text — not the template line
  // the source loc points at. Offer a direct jump to it. (spec §16.2)
  const contentFile = pageSource();
  if (contentFile) {
    const hint = document.createElement('p');
    hint.textContent = `This page's content comes from ${basename(contentFile)} — that's where its title and body text are edited.`;
    Object.assign(hint.style, { margin: '0 0 4px', font: '13px/1.5 system-ui', color: '#bda9ff' } as CSSStyleDeclaration);
    body.append(hint);
  }

  const close = (): void => { activeCloser = null; panel.remove(); backdrop.remove(); editingActive = false; };
  const backdrop = buildBackdrop(close);
  setActiveCloser(close);

  // cancel = close, "Open template" = jump to the .astro loc, and (when the
  // page declares a content file) a primary "Edit page content" that opens it.
  wirePanelButtons(
    panel,
    close,
    () => {
      if (contentFile) {
        void openSource({ file: contentFile, loc: '' });
      } else {
        void openSource(src);
      }
      close();
    },
    contentFile
      ? {
          confirmLabel: 'Edit page content',
          secondaryLabel: 'Open template',
          onSecondary: () => {
            void openSource(src);
            close();
          },
        }
      : { confirmLabel: 'Open source' },
  );
  document.body.append(backdrop, panel);
}

/** Open a source location in the user's editor via the /open endpoint. */
async function openSource(src: SourceLoc): Promise<void> {
  try {
    const res = await fetch(`${API}/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: src.file, loc: src.loc }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `open failed (${res.status})`);
    }
    toast(`Opened ${basename(src.file)}:${src.loc} in your editor`, 'ok');
  } catch (err) {
    toast(`Could not open source — ${err instanceof Error ? err.message : 'unknown'}`, 'err');
  }
}

// --- Click router ----------------------------------------------------------

/** True when the event is inside our own overlay UI (toggle, panels, veils). */
function isOwnUi(e: Event): boolean {
  return e
    .composedPath()
    .some((n) => n instanceof HTMLElement && n.dataset?.astroTextEditUi === '1');
}

/**
 * Open the appropriate editor for a source-mapped element — after confirming
 * the target with the server's AST classification. The DOM can't distinguish a
 * resolved {expression} from literal text; the AST can. (spec §16.1)
 */
async function openElement(el: HTMLElement, src: SourceLoc): Promise<void> {
  // Claim the busy flag synchronously: /classify is async, and without this a
  // rapid second click during the round-trip could open a second editor.
  editingActive = true;
  let server: ClassifyResult;
  try {
    server = await serverClassify(src, el.tagName.toLowerCase());
  } catch (err) {
    editingActive = false;
    toast(`Could not check editability — ${err instanceof Error ? err.message : 'unknown error'}`, 'err');
    return;
  }

  if (server.kind === 'image' && el instanceof HTMLImageElement) {
    const attrs = server.attrs ?? { src: 'dynamic', alt: 'dynamic' };
    if (attrs.src !== 'static' && attrs.alt === 'dynamic') {
      showDynamicNotice(
        el,
        src,
        'Both the image file and its alt text are set from code, so they must be edited in the source.',
      );
      return;
    }
    void beginImageEdit(el, src, attrs);
  } else if (server.kind === 'text') {
    beginTextEdit(el, src);
  } else {
    showDynamicNotice(
      el,
      src,
      server.reason ??
        'This content is generated from a template expression or a loop, so editing it here could change behaviour, not just words. Edit it at the source instead.',
    );
  }
}

function onClick(e: MouseEvent): void {
  if (!editMode) return;
  if (isOwnUi(e)) return;

  const el = nearestSource(e.target);
  const src = el ? sourceFor(el) : undefined;

  // Case A: an inline text edit is open. A click elsewhere should commit it and
  // — if it landed on another editable target — open that one in the SAME
  // gesture, rather than only dismissing and forcing a second click. (#1)
  if (activeTextFinish) {
    const active = document.querySelector('[data-astro-text-edit-active="1"]');
    if (el && el === active) return; // clicking within the edit: leave it be
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    activeTextFinish(true); // commit the current edit now
    if (el && src) void openElement(el, src); // and open the new target immediately
    return;
  }

  // Case B: a modal interaction (image/dynamic panel) is open — its own
  // backdrop/buttons handle dismissal. Don't route background clicks.
  if (editingActive) return;

  if (!el || !src) return;

  // Fully swallow the click so a wrapping <a>/<button> can't navigate or submit.
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  void openElement(el, src);
}

// In edit mode, also swallow mousedown on an editable target in capture phase —
// some browsers begin navigation/focus on mousedown before click fires. This
// stops a wrapping link from acting; our own UI is exempt.
function onMouseDown(e: MouseEvent): void {
  if (!editMode || isOwnUi(e)) return;
  const el = nearestSource(e.target);
  if (el && sourceFor(el)) {
    // Don't preventDefault when the mousedown is inside the active edit, or the
    // caret won't move where the user clicked.
    if (el.dataset.astroTextEditActive === '1') return;
    e.preventDefault();
    e.stopPropagation();
  }
}

// Capture phase so we intercept before links/buttons act on their default.
document.addEventListener('click', onClick, true);
document.addEventListener('mousedown', onMouseDown, true);

// After an HMR update: drop stale hover state, and re-snapshot source
// mappings from the freshly-rendered (re-annotated) DOM before the toolbar
// strips them again. (spec §4.2 / §7.4, adapted for attribute-stripping)
if (import.meta.hot) {
  import.meta.hot.on('vite:afterUpdate', () => {
    clearHighlight();
    cacheSourceMappings();
  });
}

// ---------------------------------------------------------------------------
// Shared UI helpers
// ---------------------------------------------------------------------------

/** Lock an element during a save: dim + spinner overlay. Returns a release fn. */
function lockElement(el: HTMLElement): () => void {
  const rect = el.getBoundingClientRect();
  const veil = document.createElement('div');
  veil.dataset.astroTextEditUi = '1';
  Object.assign(veil.style, {
    position: 'fixed', zIndex: String(Z + 3), pointerEvents: 'all',
    left: `${rect.left - 2}px`, top: `${rect.top - 2}px`,
    width: `${rect.width + 4}px`, height: `${rect.height + 4}px`,
    background: 'rgba(124, 92, 255, 0.12)', borderRadius: '3px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  } as CSSStyleDeclaration);
  const chip = document.createElement('div');
  chip.textContent = 'saving…';
  Object.assign(chip.style, {
    font: '600 11px system-ui', color: '#fff', background: '#7c5cff',
    padding: '2px 8px', borderRadius: '999px', boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
  } as CSSStyleDeclaration);
  veil.append(chip);
  document.body.append(veil);
  return () => veil.remove();
}

/** Bottom-center toast. `kind` sets the accent. Auto-dismisses. */
function toast(message: string, kind: 'ok' | 'err'): void {
  const t = document.createElement('div');
  t.dataset.astroTextEditUi = '1';
  t.textContent = message;
  Object.assign(t.style, {
    position: 'fixed', zIndex: String(Z + 5), left: '50%', bottom: '24px',
    transform: 'translateX(-50%)', padding: '10px 16px', borderRadius: '8px',
    font: '500 13px system-ui', color: '#fff',
    background: kind === 'ok' ? '#2b8a4a' : '#c0392b',
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)', opacity: '0', transition: 'opacity 120ms',
  } as CSSStyleDeclaration);
  document.body.append(t);
  requestAnimationFrame(() => (t.style.opacity = '1'));
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 200);
  }, 2400);
}

/** A centered modal panel shell with a title bar, body slot, and two buttons. */
function buildPanel(title: string): HTMLElement {
  const panel = document.createElement('div');
  panel.dataset.astroTextEditUi = '1';
  Object.assign(panel.style, {
    position: 'fixed', zIndex: String(Z + 6), left: '50%', top: '50%',
    transform: 'translate(-50%, -50%)', width: 'min(420px, 92vw)',
    background: '#1c1c2b', color: '#eee', borderRadius: '12px',
    boxShadow: '0 12px 48px rgba(0,0,0,0.5)', border: '1px solid #333',
    overflow: 'hidden', font: '13px system-ui',
  } as CSSStyleDeclaration);

  const bar = document.createElement('div');
  bar.textContent = title;
  Object.assign(bar.style, {
    padding: '12px 16px', font: '600 13px system-ui', borderBottom: '1px solid #2c2c3d',
  } as CSSStyleDeclaration);

  const body = document.createElement('div');
  body.dataset.body = '';
  Object.assign(body.style, { padding: '16px' } as CSSStyleDeclaration);

  const foot = document.createElement('div');
  foot.dataset.foot = '';
  Object.assign(foot.style, {
    padding: '12px 16px', display: 'flex', gap: '8px', justifyContent: 'flex-end',
    borderTop: '1px solid #2c2c3d',
  } as CSSStyleDeclaration);

  panel.append(bar, body, foot);
  return panel;
}

/** Dim backdrop that closes the panel when clicked. */
function buildBackdrop(onClose: () => void): HTMLElement {
  const b = document.createElement('div');
  b.dataset.astroTextEditUi = '1';
  Object.assign(b.style, {
    position: 'fixed', inset: '0', zIndex: String(Z + 5),
    background: 'rgba(0,0,0,0.4)',
  } as CSSStyleDeclaration);
  b.addEventListener('click', onClose);
  return b;
}

/** Populate a panel's footer with cancel + confirm buttons, and optionally a
 *  secondary (outline) button between them for a second action. */
function wirePanelButtons(
  panel: HTMLElement,
  onCancel: () => void,
  onConfirm: () => void,
  opts: { confirmLabel?: string; secondaryLabel?: string; onSecondary?: () => void } = {},
): void {
  const foot = panel.querySelector('[data-foot]') as HTMLElement;
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  Object.assign(cancel.style, {
    padding: '7px 14px', borderRadius: '7px', border: '1px solid #3a3a4d',
    background: 'transparent', color: '#ccc', cursor: 'pointer', font: '600 13px system-ui',
  } as CSSStyleDeclaration);
  cancel.addEventListener('click', onCancel);
  foot.append(cancel);

  if (opts.secondaryLabel && opts.onSecondary) {
    const secondary = document.createElement('button');
    secondary.type = 'button';
    secondary.textContent = opts.secondaryLabel;
    Object.assign(secondary.style, {
      padding: '7px 14px', borderRadius: '7px', border: '1px solid #5a5a7a',
      background: 'transparent', color: '#cdd', cursor: 'pointer', font: '600 13px system-ui',
    } as CSSStyleDeclaration);
    secondary.addEventListener('click', opts.onSecondary);
    foot.append(secondary);
  }

  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.textContent = opts.confirmLabel ?? 'Save';
  Object.assign(confirm.style, {
    padding: '7px 14px', borderRadius: '7px', border: 'none',
    background: '#7c5cff', color: '#fff', cursor: 'pointer', font: '600 13px system-ui',
  } as CSSStyleDeclaration);
  confirm.addEventListener('click', onConfirm);
  foot.append(confirm);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  // Confirm the server side is alive before showing the button. If the health
  // check fails the overlay stays out of the way entirely.
  try {
    const res = await fetch(`${API}/health`);
    if (!res.ok) return;
  } catch {
    return;
  }
  document.body.append(outline, tooltip, toggle);

  // Restore edit mode across the full-page reload that follows every save.
  try {
    if (sessionStorage.getItem('astroTextEditMode') === '1') setEditMode(true);
  } catch {
    // sessionStorage unavailable — start with edit mode off.
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  void boot();
}
