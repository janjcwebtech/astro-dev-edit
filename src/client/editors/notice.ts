import type { SourceLoc } from '../../shared/protocol.ts';
import { clearHighlight } from '../hover.ts';
import * as state from '../state.ts';
import { FONT, basename, buildBackdrop, buildPanel, styled, wirePanelButtons } from '../ui.ts';

/**
 * Refusal notice for content that can't be edited in place (expressions,
 * nested markup, components). Offers "Open source" — and, when the page
 * declares a backing content file, a primary "Edit page content" jump.
 */

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
export function pageSource(): string | null {
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="astro-text-edit:page-source"]',
  );
  const content = meta?.content?.trim();
  return content ? content : null;
}

export function showDynamicNotice(
  src: SourceLoc,
  reason: string,
  openSource: (src: SourceLoc) => void,
): void {
  clearHighlight();
  const panel = buildPanel('Can’t edit this here');
  const body = panel.querySelector('[data-body]') as HTMLElement;

  const msg = styled('p', 'atx-notice-reason', {
    margin: '0 0 6px', font: '13px/1.5 system-ui', color: '#ddd',
  });
  msg.textContent = reason;

  const where = styled('p', 'atx-notice-loc', {
    margin: '0 0 12px', font: `12px ${FONT.mono}`, color: '#999',
  });
  where.textContent = `${basename(src.file)}:${src.loc}`;

  body.append(msg, where);

  // On a detail page whose content lives in a markdown/MDX file, that file is
  // almost always the *right* place to edit this text — not the template line
  // the source loc points at. Offer a direct jump to it. (spec §16.2)
  const contentFile = pageSource();
  if (contentFile) {
    const hint = styled('p', 'atx-notice-hint', {
      margin: '0 0 4px', font: '13px/1.5 system-ui', color: '#bda9ff',
    });
    hint.textContent = `This page's content comes from ${basename(contentFile)} — that's where its title and body text are edited.`;
    body.append(hint);
  }

  const close = (): void => {
    state.releaseIf(token);
    panel.remove();
    backdrop.remove();
  };
  const backdrop = buildBackdrop(close);
  const token = state.begin({ kind: 'panel', close });

  // cancel = close, "Open template" = jump to the .astro loc, and (when the
  // page declares a content file) a primary "Edit page content" that opens it.
  wirePanelButtons(
    panel,
    close,
    () => {
      if (contentFile) {
        openSource({ file: contentFile, loc: '' });
      } else {
        openSource(src);
      }
      close();
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
  document.body.append(backdrop, panel);
}
