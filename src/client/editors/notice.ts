import type { SourceLoc } from '../../shared/protocol.ts';
import { clearHighlight } from '../hover.ts';
import { pageSource } from '../page-source.ts';
import { trapFocus } from '../focus.ts';
import * as state from '../state.ts';
import { basename, buildBackdrop, buildPanel, styled, wirePanelButtons } from '../ui.ts';
import { openEntryPanel } from './entry.ts';
import { mount } from '../shadow.ts';

/**
 * Refusal notice for content that can't be edited in place (expressions,
 * nested markup, components). Offers "Open source" — and, when the page
 * declares a backing content file, a primary "Edit page content" action that
 * opens the CMS entry drawer for it.
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
}

export function showDynamicNotice(
  src: SourceLoc,
  reason: string,
  openSource: (src: SourceLoc) => void,
  openPeek: (src: SourceLoc) => void,
  opts: NoticeOptions = {},
): void {
  clearHighlight();
  const panel = buildPanel('Can’t edit this here');
  const body = panel.querySelector('[data-body]') as HTMLElement;

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
  where.title = 'Peek at the source code';
  where.addEventListener('click', () => {
    close();
    openPeek(src);
  });

  body.append(msg, where);

  // On a detail page whose content lives in a markdown/MDX file, that file is
  // almost always the *right* place to edit this text — not the template line
  // the source loc points at. Offer a direct jump to it. (spec §16.2)
  const contentFile = pageSource();
  if (contentFile) {
    const hint = styled('p', 'atx-notice-hint');
    hint.textContent = `This page's content comes from ${basename(contentFile)} — that's where its title and body text are edited.`;
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

  // cancel = close, "Open template" = jump to the .astro loc, and (when the
  // page declares a content file) a primary "Edit page content" that opens
  // the entry drawer for it. The drawer claims the state slot itself, so the
  // notice just closes first.
  wirePanelButtons(
    panel,
    close,
    () => {
      close();
      if (contentFile) {
        void openEntryPanel(contentFile);
      } else {
        openSource(src);
      }
    },
    contentFile
      ? {
          confirmLabel: 'Edit page content',
          secondaryLabel: 'Open template',
          onSecondary: () => {
            openSource(src);
            close();
          },
        }
      : { confirmLabel: 'Open source' },
  );
  mount(backdrop, panel);
  const releaseFocus = trapFocus(panel);
}
