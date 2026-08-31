import { canRichEdit, escapeHtml, htmlToMarkdown, markdownToHtml } from '../markdown.ts';
import { COLOR, FONT, PAPER, RADIUS, basename, hexToRgba, inputEl, isolateScroll, styled, toast } from '../ui.ts';
import { mountLight } from '../shadow.ts';
import { buildImageField } from './asset-picker.ts';

/**
 * WYSIWYG markdown body editor for the entry drawer: a contenteditable
 * surface with a formatting toolbar (bold/italic/strikethrough, heading
 * level, lists, quote, code, link, image), backed by the subset converter in
 * client/markdown.ts. Bodies outside that subset (tables, raw HTML/MDX, …)
 * open in raw-markdown mode instead — the toolbar's MD/Rich toggle switches
 * views, and the switch to Rich is refused when it would be lossy.
 *
 * Dirty tracking compares against the *normalized* round-trip of the initial
 * body, so merely opening and closing the drawer never rewrites the file.
 */

export interface BodyEditor {
  root: HTMLElement;
  /** Current markdown. */
  value(): string;
  /** Whether the user actually changed the body. */
  dirty(): boolean;
  /** Drop the light-DOM contenteditable this editor slots into the drawer.
   *  Call from the drawer's onClose — `root.remove()` cannot reach it, because
   *  it is parented to the shadow host rather than to `root`. */
  destroy(): void;
}

/**
 * Content styling can't be inlined — the user creates these elements by typing
 * — so the editor injects one class-scoped stylesheet.
 *
 * It lives in the **document**, not in the overlay's shadow stylesheet, because
 * `.atx-rte-content` is the one piece of overlay chrome that stays in the light
 * DOM: Safari's selection and `execCommand` APIs are inert against a node
 * inside a shadow root, which would leave the toolbar doing nothing at all. The
 * node is slotted back into the drawer instead (shadow.ts::mountLight), so it
 * renders in place while remaining light-DOM for selection purposes — and is
 * therefore styled from here, where the document can see it.
 */
const CONTENT_CSS = `
/* The writing surface itself. White, like the rendered page rather than a form
   field, and color-scheme: light so native chrome (the scrollbar) matches it.
   Hidden in source mode; [data-on] is the visual half of the MD/Rich toggle. */
.atx-rte-content {
  display: none;
  box-sizing: border-box;
  width: 100%;
  min-height: 40vh;
  padding: 16px 20px;
  border: none;
  border-radius: ${RADIUS['2xl']};
  background: ${PAPER.bg};
  color: ${PAPER.fg};
  font: 15px/1.65 ${FONT.ui};
  color-scheme: light;
  outline: none;
  overflow-y: auto;
  cursor: text;
}
.atx-rte-content[data-on] { display: block; }
.atx-rte-content h1, .atx-rte-content h2, .atx-rte-content h3,
.atx-rte-content h4, .atx-rte-content h5, .atx-rte-content h6 {
  margin: 0.7em 0 0.35em; font-weight: 700; line-height: 1.25; color: inherit;
}
.atx-rte-content h1 { font-size: 1.55em; }
.atx-rte-content h2 { font-size: 1.35em; }
.atx-rte-content h3 { font-size: 1.18em; }
.atx-rte-content h4 { font-size: 1.05em; }
.atx-rte-content h5 { font-size: 0.95em; }
.atx-rte-content h6 { font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.04em; }
.atx-rte-content p { margin: 0.5em 0; }
.atx-rte-content ul, .atx-rte-content ol { margin: 0.5em 0; padding-left: 1.5em; }
.atx-rte-content li { margin: 0.2em 0; }
.atx-rte-content blockquote {
  margin: 0.6em 0; padding: 0.3em 0.9em; border-left: 3px solid ${COLOR.brand};
  background: ${hexToRgba(COLOR.brand, 0.07)}; border-radius: 0 ${RADIUS.md} ${RADIUS.md} 0;
}
.atx-rte-content pre {
  margin: 0.6em 0; padding: 8px 10px; background: ${PAPER.muted}; border: 1px solid ${PAPER.border};
  border-radius: 6px; font: 12px/1.5 ${FONT.mono}; white-space: pre-wrap; overflow-x: auto;
}
.atx-rte-content code {
  background: ${PAPER.muted}; border: 1px solid ${PAPER.border}; border-radius: 4px;
  padding: 1px 4px; font-family: ${FONT.mono}; font-size: 0.9em;
}
.atx-rte-content pre code { background: transparent; border: none; padding: 0; }
.atx-rte-content a { color: ${PAPER.link}; }
.atx-rte-content img { max-width: 100%; border-radius: 4px; cursor: pointer; }
.atx-rte-content hr { border: none; border-top: 1px solid ${PAPER.border}; margin: 0.8em 0; }
`;

function ensureContentStyles(): void {
  if (document.getElementById('atx-rte-style')) return;
  const style = document.createElement('style');
  style.id = 'atx-rte-style';
  style.textContent = CONTENT_CSS;
  document.head.append(style);
}

/** A toolbar button. `variant` is an extra class, not a style object: what each
 *  button does to its own label — bold, italic, struck through, monospaced — is
 *  a fixed choice from a known set, so it belongs in the stylesheet. */
function toolbarButton(
  label: string,
  title: string,
  onRun: () => void,
  variant = '',
): HTMLButtonElement {
  const b = styled('button', variant ? `atx-rte-btn ${variant}` : 'atx-rte-btn');
  b.type = 'button';
  b.textContent = label;
  b.title = title;
  // preventDefault keeps the contenteditable selection alive through the click.
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', onRun);
  return b;
}

function divider(): HTMLElement {
  return styled('span', 'atx-rte-divider');
}

/** Slot names must be unique per editor instance: a drawer hand-off can build
 *  the next editor before the previous one's node is gone. */
let rteSeq = 0;

export function buildBodyEditor(initial: string): BodyEditor {
  ensureContentStyles();

  const root = styled('div', 'atx-rte');
  let mode: 'visual' | 'source' = canRichEdit(initial) ? 'visual' : 'source';

  // --- the two surfaces ----------------------------------------------------

  // The one control that can wear neither the shared [data-input] baseline nor
  // a rule from the overlay's stylesheet: it lives in the light DOM, where
  // selectors from the shadow root do not reach and ::slotted() loses to the
  // document. Its whole box is in CONTENT_CSS instead, alongside the rules for
  // the elements the user types into it.
  const content = styled('div', 'atx-rte-content');
  // The editing surface is the one node that does not move into the shadow
  // root — see CONTENT_CSS above. It is parented to the host and composed back
  // into the drawer through this slot, so layout is the drawer's job and
  // selection keeps working in every engine.
  const slotName = `atx-rte-${++rteSeq}`;
  content.slot = slotName;
  const contentSlot = document.createElement('slot');
  contentSlot.name = slotName;
  mountLight(content);

  isolateScroll(content);
  content.contentEditable = 'true';
  content.addEventListener('focus', () => {
    // Tag-based markup (<b>, <p>…), not styled spans — the serializer's format.
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand('defaultParagraphSeparator', false, 'p');
  }, { once: true });

  // Class kept from the old plain-textarea body input, so existing user CSS
  // overrides keep working in source mode.
  const srcInput = inputEl('textarea', 'atx-body-input');
  srcInput.value = initial;

  let visualBaseline: string | null = null;
  if (mode === 'visual') {
    content.innerHTML = markdownToHtml(initial);
    visualBaseline = htmlToMarkdown(content);
  }

  // --- commands ------------------------------------------------------------

  const exec = (cmd: string, val?: string): void => {
    content.focus();
    document.execCommand(cmd, false, val);
  };

  let savedRange: Range | null = null;
  const saveSelection = (): void => {
    const s = window.getSelection();
    savedRange = s && s.rangeCount > 0 ? s.getRangeAt(0).cloneRange() : null;
  };
  const restoreSelection = (): void => {
    if (!savedRange) return;
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(savedRange);
  };

  const insertInlineCode = (): void => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !content.contains(s.anchorNode)) return;
    exec('insertHTML', `<code>${escapeHtml(s.toString())}</code>`);
  };

  const insertLink = (): void => {
    saveSelection();
    const url = window.prompt('Link URL', 'https://');
    if (!url) return;
    content.focus();
    restoreSelection();
    const s = window.getSelection();
    if (!s || s.isCollapsed) exec('insertHTML', `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`);
    else exec('createLink', url);
  };

  // --- heading dropdown ----------------------------------------------------

  const headWrap = styled('span', 'atx-rte-heading');
  const headMenu = styled('div', 'atx-rte-heading-menu');
  const hideMenu = (): void => {
    headMenu.toggleAttribute('data-on', false);
  };
  const menuItem = (tag: string, chip: string, name: string, size: string): HTMLButtonElement => {
    const item = styled('button', 'atx-rte-heading-item');
    item.type = 'button';
    const chipEl = styled('span', 'atx-rte-heading-chip');
    chipEl.textContent = chip;
    // The one size the stylesheet cannot know: each row previews its own level.
    const nameEl = styled('span', 'atx-rte-heading-name', { fontSize: size });
    nameEl.textContent = name;
    item.append(chipEl, nameEl);
    item.addEventListener('mousedown', (e) => e.preventDefault());
    item.addEventListener('click', () => {
      hideMenu();
      exec('formatBlock', `<${tag}>`);
    });
    return item;
  };
  for (let i = 1; i <= 6; i++) {
    headMenu.append(menuItem(`h${i}`, `H${i}`, `Heading ${i}`, `${17 - i}px`));
  }
  headMenu.append(menuItem('p', 'P', 'Paragraph', '12px'));
  headWrap.append(
    toolbarButton('Hx', 'Heading level', () => {
      headMenu.toggleAttribute('data-on');
    }),
    headMenu,
  );

  // --- image insert/replace (reuses the asset-picker field: upload / browse /
  //     path). Opened by the toolbar button (insert at caret) or by clicking
  //     an image inside the content (replace that image).

  const imagePanel = styled('div', 'atx-rte-image-panel');
  let imageValue = '';
  let replaceTarget: HTMLImageElement | null = null;
  const imageFieldSlot = styled('div', 'atx-rte-image-slot');

  // Alt text, auto-suggested from the picked file's name until edited by hand.
  const altFromPath = (path: string): string =>
    (basename(path).replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ')).trim();
  let altTouched = false;
  const altLabel = styled('label', 'atx-rte-image-alt-label');
  altLabel.textContent = 'Alt text';
  const altInput = inputEl('input', 'atx-rte-image-alt');
  altInput.type = 'text';
  altInput.placeholder = 'Describe the image';
  altInput.addEventListener('input', () => (altTouched = true));

  const imageActions = styled('div', 'atx-rte-image-actions');
  const smallBtn = (label: string, primary: boolean, onClick: () => void): HTMLButtonElement => {
    const kind = primary ? 'default' : 'outline';
    const b = styled('button', `atx-btn atx-btn-${kind} atx-rte-image-btn`);
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };
  const confirmBtn = smallBtn('Insert', true, () => {
    if (!imageValue) {
      toast('Pick or upload an image first', 'err');
      return;
    }
    imagePanel.toggleAttribute('data-on', false);
    const alt = altInput.value.trim();
    if (replaceTarget && replaceTarget.isConnected) {
      replaceTarget.src = imageValue;
      replaceTarget.alt = alt;
    } else {
      content.focus();
      restoreSelection();
      exec('insertHTML', `<img src="${escapeHtml(imageValue)}" alt="${escapeHtml(alt)}">`);
    }
  });
  imageActions.append(
    smallBtn('Cancel', false, () => imagePanel.toggleAttribute('data-on', false)),
    confirmBtn,
  );
  imagePanel.append(imageFieldSlot, altLabel, altInput, imageActions);

  /** (Re)builds the field so the path/preview reflect this open, not the last. */
  const openImagePanel = (prefill: string, target: HTMLImageElement | null): void => {
    replaceTarget = target;
    imageValue = prefill;
    // Editing an existing image never rewrites its alt on its own — the source
    // value is authoritative, even when blank. Filename auto-suggest applies
    // only to a brand-new insert, and only until the field is edited by hand.
    altInput.value = target?.getAttribute('alt') ?? '';
    altTouched = target !== null || altInput.value !== '';
    imageFieldSlot.textContent = '';
    // Body images stay web-path shaped: a markdown `![](…)` in a rendered page
    // resolves against the site, not the entry file (unlike an image() field).
    imageFieldSlot.append(buildImageField({
      initial: prefill,
      onChange: (v) => {
        imageValue = v;
        if (!altTouched) altInput.value = altFromPath(v);
      },
    }));
    confirmBtn.textContent = target ? 'Replace' : 'Insert';
    imagePanel.toggleAttribute('data-on', true);
  };

  // Clicking an image in the content opens the panel targeting it.
  content.addEventListener('click', (e) => {
    const t = e.target;
    if (t instanceof HTMLImageElement && content.contains(t)) {
      saveSelection();
      openImagePanel(t.getAttribute('src') ?? '', t);
    }
  });

  // --- toolbar -------------------------------------------------------------

  const toolbar = styled('div', 'atx-rte-toolbar');

  const modeBtn = toolbarButton('MD', 'Switch between rich text and markdown source', () => {
    if (mode === 'visual') {
      srcInput.value = htmlToMarkdown(content);
      setMode('source');
    } else {
      if (!canRichEdit(srcInput.value)) {
        toast('Body uses markdown the rich editor can’t preserve (tables, HTML, …)', 'err');
        return;
      }
      content.innerHTML = markdownToHtml(srcInput.value);
      setMode('visual');
    }
  }, 'atx-rte-mode');

  const formatButtons = [
    toolbarButton('B', 'Bold', () => exec('bold'), 'atx-rte-btn-bold'),
    toolbarButton('I', 'Italic', () => exec('italic'), 'atx-rte-btn-italic'),
    toolbarButton('S', 'Strikethrough', () => exec('strikeThrough'), 'atx-rte-btn-strike'),
    divider(),
    headWrap,
    divider(),
    toolbarButton('•–', 'Bulleted list', () => exec('insertUnorderedList')),
    toolbarButton('1.', 'Numbered list', () => exec('insertOrderedList')),
    divider(),
    toolbarButton('❝', 'Quote', () => exec('formatBlock', '<blockquote>')),
    toolbarButton('PRE', 'Code block', () => exec('formatBlock', '<pre>'), 'atx-rte-btn-pre'),
    toolbarButton('`', 'Inline code', insertInlineCode, 'atx-rte-btn-code'),
    divider(),
    toolbarButton('🔗', 'Insert link', insertLink),
    toolbarButton('🖼', 'Insert image', () => {
      if (imagePanel.hasAttribute('data-on')) {
        imagePanel.toggleAttribute('data-on', false);
        return;
      }
      saveSelection();
      openImagePanel('', null);
    }),
  ];
  toolbar.append(...formatButtons, modeBtn);

  // Clicking into the text closes the heading menu.
  content.addEventListener('mousedown', hideMenu);

  const setMode = (next: 'visual' | 'source'): void => {
    mode = next;
    const visual = next === 'visual';
    content.toggleAttribute('data-on', visual);
    imagePanel.toggleAttribute('data-on', false);
    hideMenu();
    srcInput.toggleAttribute('data-on', !visual);
    for (const el of formatButtons) el.toggleAttribute('data-hidden', !visual);
    modeBtn.textContent = visual ? 'MD' : 'Rich';
  };
  setMode(mode);

  // Toolbar and image panel share one sticky header, so the panel stays in
  // view when it's opened for an image far down a long body.
  const stickyHead = styled('div', 'atx-rte-head');
  stickyHead.append(toolbar, imagePanel);

  root.append(stickyHead, contentSlot, srcInput);

  const value = (): string => (mode === 'visual' ? htmlToMarkdown(content) : srcInput.value);

  return {
    root,
    value,
    dirty: () => {
      const v = value();
      return v !== initial && (visualBaseline === null || v !== visualBaseline);
    },
    destroy: () => content.remove(),
  };
}
