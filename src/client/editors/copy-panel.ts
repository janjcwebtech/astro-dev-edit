import { clearHighlight } from '../hover.ts';
import * as state from '../state.ts';
import { COLOR, FONT, INPUT_STYLE, buildBackdrop, buildPanel, footButton, styled, toast } from '../ui.ts';

/**
 * Clipboard fallback for the hover pill's `copy ⧉`: the gathered context shown
 * in a read-only, preselected textarea with its own Copy button.
 *
 * Needed because `navigator.clipboard` is not always there to write to. A dev
 * server opened over the network (http://192.168.x.x:4321, for a phone or a
 * second machine) is not a secure context, so the API is simply absent; a
 * permission policy or the lost user-activation after our `await` can also
 * reject the write. The panel's own button is a fresh user gesture, and
 * ⌘A/⌘C works even where every programmatic path is blocked.
 */

/** Show the context text for manual copying. `title` names the element. */
export function openCopyPanel(title: string, text: string): void {
  clearHighlight();
  const panel = buildPanel(`Element context — ${title}`);
  panel.style.width = 'min(640px, 94vw)';
  const body = panel.querySelector('[data-body]') as HTMLElement;

  const note = styled('p', 'atx-copy-note', {
    margin: '0 0 10px', font: '13px/1.5 system-ui', color: COLOR.warning,
  });
  note.textContent =
    'Your browser would not let the page write to the clipboard — over a network address the dev server is not a secure context. Copy it from here instead:';

  const area = styled('textarea', 'atx-copy-text', {
    ...INPUT_STYLE,
    height: '300px',
    font: `12px/1.5 ${FONT.mono}`,
    whiteSpace: 'pre',
    resize: 'vertical',
  });
  area.readOnly = true;
  area.value = text;
  body.append(note, area);

  const close = (): void => {
    state.releaseIf(token);
    panel.remove();
    backdrop.remove();
  };
  const backdrop = buildBackdrop(close);
  const token = state.begin({ kind: 'panel', close });

  /** Try both paths from a real click: the modern API first, then the legacy
   *  command, which is the one that still works in an insecure context. */
  const copyNow = async (): Promise<void> => {
    area.focus();
    area.select();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      if (!document.execCommand('copy')) {
        toast('Still blocked — select the text and press ⌘C / Ctrl+C', 'err');
        return;
      }
    }
    toast('Copied element context', 'ok');
    close();
  };

  const foot = panel.querySelector('[data-foot]') as HTMLElement;
  foot.append(
    footButton('Close', 'ghost', close),
    footButton('Copy', 'default', () => void copyNow()),
  );

  document.body.append(backdrop, panel);
  // Preselected, so ⌘C works the moment the panel opens.
  requestAnimationFrame(() => {
    area.focus();
    area.select();
  });
}
