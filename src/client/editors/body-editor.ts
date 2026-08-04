import { canRichEdit, escapeHtml, htmlToMarkdown, markdownToHtml } from '../markdown.ts';
import { COLOR, FONT, INPUT_STYLE, basename, isolateScroll, styled, toast } from '../ui.ts';
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
}

/** Content styling can't be inlined (the user creates the elements), so the
 *  editor injects one scoped stylesheet. Host pages can still theme via the
 *  documented atx-rte-* hooks. */
const CONTENT_CSS = `
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
  margin: 0.6em 0; padding: 0.3em 0.9em; border-left: 3px solid ${COLOR.accent};
  background: rgba(124, 92, 255, 0.07); border-radius: 0 6px 6px 0;
}
.atx-rte-content pre {
  margin: 0.6em 0; padding: 8px 10px; background: #f4f4f6; border: 1px solid #ddd;
  border-radius: 6px; font: 12px/1.5 ${FONT.mono}; white-space: pre-wrap; overflow-x: auto;
}
.atx-rte-content code {
  background: #f4f4f6; border: 1px solid #ddd; border-radius: 4px;
  padding: 1px 4px; font-family: ${FONT.mono}; font-size: 0.9em;
}
.atx-rte-content pre code { background: transparent; border: none; padding: 0; }
.atx-rte-content a { color: #5b3fd4; }
.atx-rte-content img { max-width: 100%; border-radius: 4px; cursor: pointer; }
.atx-rte-content hr { border: none; border-top: 1px solid #ddd; margin: 0.8em 0; }
`;

function ensureContentStyles(): void {
  if (document.getElementById('atx-rte-style')) return;
  const style = document.createElement('style');
  style.id = 'atx-rte-style';
  style.textContent = CONTENT_CSS;
  document.head.append(style);
}

function toolbarButton(
  label: string,
  title: string,
  onRun: () => void,
  labelStyle: Partial<CSSStyleDeclaration> = {},
): HTMLButtonElement {
  const b = styled('button', 'atx-rte-btn', {
    border: 'none', background: 'transparent', color: '#ccc', cursor: 'pointer',
    padding: '5px 8px', borderRadius: '5px', font: `600 12px ${FONT.ui}`,
    minWidth: '28px', lineHeight: '1', ...labelStyle,
  });
  b.type = 'button';
  b.textContent = label;
  b.title = title;
  // preventDefault keeps the contenteditable selection alive through the click.
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('mouseenter', () => (b.style.background = '#2c2c3d'));
  b.addEventListener('mouseleave', () => (b.style.background = 'transparent'));
  b.addEventListener('click', onRun);
  return b;
}

function divider(): HTMLElement {
  return styled('span', 'atx-rte-divider', {
    width: '1px', alignSelf: 'stretch', margin: '3px 3px', background: COLOR.panelDivider,
  });
}

export function buildBodyEditor(initial: string): BodyEditor {
  ensureContentStyles();

  const root = styled('div', 'atx-rte', {});
  let mode: 'visual' | 'source' = canRichEdit(initial) ? 'visual' : 'source';

  // --- the two surfaces ----------------------------------------------------

  // White writing surface, like the rendered page rather than a form field.
  // colorScheme:light keeps native chrome (scrollbar) matched to the light bg,
  // overriding the dark default INPUT_STYLE carries.
  const content = styled('div', 'atx-rte-content', {
    ...INPUT_STYLE, minHeight: '40vh', padding: '10px 14px',
    background: '#fff', color: '#1a1a1a', border: '1px solid #444', colorScheme: 'light',
    font: `13px/1.6 ${FONT.ui}`, outline: 'none', overflowY: 'auto', cursor: 'text',
  });
  isolateScroll(content);
  content.contentEditable = 'true';
  content.addEventListener('focus', () => {
    // Tag-based markup (<b>, <p>…), not styled spans — the serializer's format.
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand('defaultParagraphSeparator', false, 'p');
  }, { once: true });

  // Class kept from the old plain-textarea body input, so existing user CSS
  // overrides keep working in source mode.
  const srcInput = styled('textarea', 'atx-body-input', {
    ...INPUT_STYLE, minHeight: '40vh', font: `12px/1.5 ${FONT.mono}`, resize: 'vertical',
  });
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

  const headWrap = styled('span', 'atx-rte-heading', { position: 'relative', display: 'inline-flex' });
  const headMenu = styled('div', 'atx-rte-heading-menu', {
    position: 'absolute', top: 'calc(100% + 4px)', left: '0', display: 'none',
    minWidth: '150px', padding: '4px', background: COLOR.panelBg,
    border: `1px solid ${COLOR.panelBorder}`, borderRadius: '8px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.45)', zIndex: '3',
  });
  const hideMenu = (): void => {
    headMenu.style.display = 'none';
  };
  const menuItem = (tag: string, chip: string, name: string, size: string): HTMLButtonElement => {
    const item = styled('button', 'atx-rte-heading-item', {
      display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
      padding: '5px 8px', border: 'none', borderRadius: '5px', background: 'transparent',
      color: '#ddd', cursor: 'pointer', textAlign: 'left', font: `12px ${FONT.ui}`,
    });
    item.type = 'button';
    const chipEl = styled('span', 'atx-rte-heading-chip', {
      font: `700 11px ${FONT.mono}`, opacity: '0.7', minWidth: '20px',
    });
    chipEl.textContent = chip;
    const nameEl = styled('span', 'atx-rte-heading-name', { font: `600 ${size} ${FONT.ui}` });
    nameEl.textContent = name;
    item.append(chipEl, nameEl);
    item.addEventListener('mousedown', (e) => e.preventDefault());
    item.addEventListener('mouseenter', () => (item.style.background = '#2c2c3d'));
    item.addEventListener('mouseleave', () => (item.style.background = 'transparent'));
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
      headMenu.style.display = headMenu.style.display === 'none' ? 'block' : 'none';
    }),
    headMenu,
  );

  // --- image insert/replace (reuses the asset-picker field: upload / browse /
  //     path). Opened by the toolbar button (insert at caret) or by clicking
  //     an image inside the content (replace that image).

  const imagePanel = styled('div', 'atx-rte-image-panel', {
    display: 'none', margin: '6px 0 0', padding: '10px',
    border: `1px solid ${COLOR.panelBorder}`, borderRadius: '8px', background: '#161622',
  });
  let imageValue = '';
  let replaceTarget: HTMLImageElement | null = null;
  const imageFieldSlot = styled('div', 'atx-rte-image-slot', {});

  // Alt text, auto-suggested from the picked file's name until edited by hand.
  const altFromPath = (path: string): string =>
    (basename(path).replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ')).trim();
  let altTouched = false;
  const altLabel = styled('label', 'atx-rte-image-alt-label', {
    display: 'block', font: `600 11px ${FONT.ui}`, margin: '8px 0 4px', opacity: '0.85',
  });
  altLabel.textContent = 'Alt text';
  const altInput = styled('input', 'atx-rte-image-alt', { ...INPUT_STYLE });
  altInput.type = 'text';
  altInput.placeholder = 'Describe the image';
  altInput.addEventListener('input', () => (altTouched = true));

  const imageActions = styled('div', 'atx-rte-image-actions', {
    display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px',
  });
  const smallBtn = (label: string, primary: boolean, onClick: () => void): HTMLButtonElement => {
    const b = styled('button', `atx-btn atx-btn-${primary ? 'primary' : 'ghost'}`, {
      padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', font: `600 12px ${FONT.ui}`,
      border: primary ? 'none' : '1px solid #3a3a4d',
      background: primary ? COLOR.accent : 'transparent', color: primary ? '#fff' : '#ccc',
    });
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
    imagePanel.style.display = 'none';
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
    smallBtn('Cancel', false, () => (imagePanel.style.display = 'none')),
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
    imagePanel.style.display = 'block';
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

  const toolbar = styled('div', 'atx-rte-toolbar', {
    display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '1px',
    padding: '4px',
    background: COLOR.panelBg, border: `1px solid ${COLOR.panelBorder}`, borderRadius: '9px',
  });

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
  }, { marginLeft: 'auto', font: `700 11px ${FONT.mono}`, color: '#9d86ff' });

  const formatButtons = [
    toolbarButton('B', 'Bold', () => exec('bold'), { fontWeight: '800' }),
    toolbarButton('I', 'Italic', () => exec('italic'), { fontStyle: 'italic', fontFamily: 'serif' }),
    toolbarButton('S', 'Strikethrough', () => exec('strikeThrough'), { textDecoration: 'line-through' }),
    divider(),
    headWrap,
    divider(),
    toolbarButton('•–', 'Bulleted list', () => exec('insertUnorderedList')),
    toolbarButton('1.', 'Numbered list', () => exec('insertOrderedList')),
    divider(),
    toolbarButton('❝', 'Quote', () => exec('formatBlock', '<blockquote>')),
    toolbarButton('PRE', 'Code block', () => exec('formatBlock', '<pre>'), { font: `700 10px ${FONT.mono}` }),
    toolbarButton('`', 'Inline code', insertInlineCode, { font: `700 13px ${FONT.mono}` }),
    divider(),
    toolbarButton('🔗', 'Insert link', insertLink),
    toolbarButton('🖼', 'Insert image', () => {
      if (imagePanel.style.display !== 'none') {
        imagePanel.style.display = 'none';
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
    content.style.display = visual ? 'block' : 'none';
    imagePanel.style.display = 'none';
    hideMenu();
    srcInput.style.display = visual ? 'none' : 'block';
    for (const el of formatButtons) el.style.display = visual ? '' : 'none';
    modeBtn.textContent = visual ? 'MD' : 'Rich';
  };
  setMode(mode);

  // Toolbar and image panel share one sticky header, so the panel stays in
  // view when it's opened for an image far down a long body.
  const stickyHead = styled('div', 'atx-rte-head', {
    position: 'sticky', top: '0', zIndex: '2',
    background: COLOR.panelBg, paddingBottom: '6px',
  });
  stickyHead.append(toolbar, imagePanel);

  root.append(stickyHead, content, srcInput);

  const value = (): string => (mode === 'visual' ? htmlToMarkdown(content) : srcInput.value);

  return {
    root,
    value,
    dirty: () => {
      const v = value();
      return v !== initial && (visualBaseline === null || v !== visualBaseline);
    },
  };
}
