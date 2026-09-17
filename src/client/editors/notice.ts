import type { SourceLoc } from '../../shared/protocol.ts';
import { clearHighlight } from '../hover.ts';
import { pageSource } from '../page-source.ts';
import { trapFocus } from '../focus.ts';
import * as state from '../state.ts';
import { basename, buildBackdrop, buildPanel, styled, wirePanelButtons } from '../ui.ts';
import { mount } from '../shadow.ts';

/**
 * Refusal notice for content that can't be edited in place — expressions,
 * nested markup, package components.
 *
 * **It names a destination, and offers one verb to reach it.** *View code*
 * opens the read-only source popup, which carries its own *Open in editor*;
 * the panel never pairs a peek button with a jump button for the same file,
 * because a destination belongs to the row that owns it. Where the page
 * declares a backing content file, that file is named as the place the words
 * actually live — it is not browser-editable, and the notice says so rather
 * than offering a field.
 */

export interface NoticeOptions {
  /**
   * The tag the pointer actually landed on, when that element carries no
   * source annotation and the loc below therefore belongs to an **ancestor**.
   *
   * Astro annotates only elements written in the file, so a `<Button>`'s
   * rendered `<a>` and every element slotted in from MDX have none of their
   * own, and the router classifies the nearest annotated ancestor instead. The
   * refusal is right either way — none of it is editable here — but the
   * *reason* then describes a different element than the one that was clicked,
   * which reads as a puzzle: "contains nested markup" over a button that
   * plainly holds one word. Naming the substitution is the whole fix.
   */
  clickedTag?: string;

  /**
   * Where the package component that rendered this element was **used** — the
   * nearest enclosing element written in the project's own source.
   *
   * Set only when `src` itself is package-owned, which is the one refusal that
   * otherwise names a file the user can neither edit nor open: an
   * `astro:assets` `<Image>` annotates to
   * `node_modules/astro/components/Image.astro`. The reason already says "edit
   * where the component is used instead"; this is that place, so the notice
   * can offer it rather than leave the sentence as advice with nowhere to go.
   *
   * It is a **jump, not an edit**. The ancestor is the markup around the
   * component, so opening it puts the cursor at the call site — where the
   * props are written — rather than making this element editable in place.
   */
  usedAt?: SourceLoc;
}

export function showDynamicNotice(
  src: SourceLoc,
  reason: string,
  openPeek: (src: SourceLoc) => void,
  opts: NoticeOptions = {},
): void {
  clearHighlight();
  const panel = buildPanel('Can’t edit this here');
  const body = panel.querySelector('[data-body]') as HTMLElement;

  // A package-owned `src` cannot be opened — /open refuses it, the same way
  // /peek and /classify do. So every jump this panel offers goes to the usage
  // site when there is one, and the button below says which file that is.
  const jumpTo = opts.usedAt ?? src;

  if (opts.clickedTag) {
    const lead = styled('p', 'atx-notice-lead');
    lead.textContent =
      `The <${opts.clickedTag}> you clicked isn’t written in this file — a component or ` +
      'slotted content rendered it. The nearest element that is written here is the one ' +
      'described below.';
    body.append(lead);
  }

  const msg = styled('p', 'atx-notice-reason');
  msg.textContent = reason;

  // The location line opens the in-browser source peek — often all that's
  // needed to see *why* this content refused, without leaving the page.
  const where = styled('p', 'atx-notice-loc');
  where.textContent = `${basename(src.file)}:${src.loc}`;
  where.title = 'View the source code';
  where.addEventListener('click', () => {
    close();
    openPeek(src);
  });

  body.append(msg, where);

  if (opts.usedAt) {
    const used = styled('p', 'atx-notice-hint');
    used.textContent =
      `It is used in ${basename(opts.usedAt.file)}:${opts.usedAt.loc} — open that to change ` +
      'what the component is given. The props are edited there, not on the page.';
    body.append(used);
  }

  // On a detail page that declares a backing markdown/MDX file, that file is
  // almost always the *right* place to edit this text — not the template line
  // the source loc points at. Named, not offered as a field: Markdown-backed
  // values are edited in the IDE.
  const contentFile = pageSource();
  if (contentFile) {
    const hint = styled('p', 'atx-notice-hint');
    hint.textContent =
      `This page declares ${basename(contentFile)} as its content file — that's where its ` +
      'title and body text are edited.';
    body.append(hint);
  }

  const close = (): void => {
    state.releaseIf(token);
    releaseFocus();
    panel.remove();
    backdrop.remove();
  };
  const backdrop = buildBackdrop(close);
  const token = state.begin({ kind: 'panel', close });

  // cancel = close; the one action views the code at the loc the refusal is
  // about, and the popup it opens carries Open in editor.
  wirePanelButtons(
    panel,
    close,
    () => {
      close();
      openPeek(jumpTo);
    },
    {
      // Naming the file is the point when it is not the one on the loc line
      // above: "View code" over a package path is the button that used to error.
      confirmLabel: opts.usedAt ? `View ${basename(opts.usedAt.file)}` : 'View code',
    },
  );
  mount(backdrop, panel);
  const releaseFocus = trapFocus(panel);
}
