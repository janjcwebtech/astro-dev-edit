import { styled } from './ui.ts';

/**
 * Layout primitives for grouping: the structural half of the overlay's look,
 * as opposed to the token half in `ui.ts`.
 *
 * A drawer that is a flat run of controls reads as a form dump however well
 * each control is styled — nothing tells the eye which fields belong together,
 * which action is the one to take, or where one concern ends. These are the
 * pieces that say so, and they are deliberately the same small vocabulary
 * shadcn settled on, because it is the one the look is *made* of:
 *
 * - a **card** is a bounded concern: a header that names it, a body, and an
 *   optional footer band holding the action that completes it;
 * - a **field group** is a run of controls that answer one question, separated
 *   from the next run by a rule rather than by guessing from whitespace;
 * - an **item** is one row in a list — media, title, description, actions — so
 *   every list in the overlay is built from the same row rather than each
 *   panel inventing its own.
 *
 * All three are pure DOM: no state, no listeners, no imports beyond `styled`.
 * Callers own behaviour. Styling is `.atx-card*`, `.atx-field-group`,
 * `.atx-item*` and `.atx-sep` in `styles.ts` — internal classes, as ever.
 */

export interface CardHeadOptions {
  /** The concern's name. 16px/500 — the only thing at that size in a drawer. */
  title: string;
  /** One line under it, in muted ink. Where a file path or a caveat goes. */
  description?: string;
  /**
   * The action *this* card offers, pinned to the header's top-right corner —
   * "+ New", "View all". It belongs here rather than in the footer precisely
   * because it does not complete the card: it leaves it.
   */
  action?: HTMLElement;
}

export interface Card {
  root: HTMLElement;
  /** Content slot. */
  body: HTMLElement;
  /**
   * Footer band, created on first read. Lazy because the band is a visible
   * thing — a top rule and a tinted ground — and an empty one reads as a
   * missing action rather than as no action.
   */
  foot(): HTMLElement;
}

/** A bounded concern: header, body, and a footer band if one is asked for. */
export function card(head?: CardHeadOptions): Card {
  const root = styled('div', 'atx-card');
  if (head) root.append(cardHead(head));

  const body = styled('div', 'atx-card-body');
  root.append(body);

  let footEl: HTMLElement | null = null;
  return {
    root,
    body,
    foot: () => {
      if (!footEl) {
        footEl = styled('div', 'atx-card-foot');
        root.append(footEl);
      }
      return footEl;
    },
  };
}

/**
 * The header on its own, for a surface that is card-shaped without being a
 * card — the drawer's own title bar is the case that matters.
 *
 * Two columns when there is an action and one when there is not, which is why
 * it is a grid: the title and the description both have to stop short of the
 * button rather than run under it, and `[data-action]` on the host is what the
 * stylesheet keys the second column off.
 */
export function cardHead(o: CardHeadOptions): HTMLElement {
  const root = styled('div', 'atx-card-head');

  const title = styled('div', 'atx-card-title');
  title.textContent = o.title;
  root.append(title);

  if (o.description) {
    const desc = styled('div', 'atx-card-desc');
    desc.textContent = o.description;
    root.append(desc);
  }
  if (o.action) {
    const slot = styled('div', 'atx-card-action');
    slot.append(o.action);
    root.append(slot);
    root.dataset.action = '';
  }
  return root;
}

/** A run of fields that answer one question. Owns the spacing between them. */
export function fieldGroup(): HTMLElement {
  return styled('div', 'atx-field-group');
}

/** A 1px rule. Separates two groups inside one surface, where a second card
 *  would overstate how far apart they are. */
export function separator(): HTMLElement {
  const el = styled('div', 'atx-sep');
  el.role = 'separator';
  return el;
}

export interface ItemOptions {
  /** Title line, 14px/500. */
  title: string;
  /** Second line, 12px muted. */
  description?: string;
  /** A 16px icon slot ahead of the text. */
  media?: HTMLElement;
  /** Buttons pinned to the row's right edge. */
  actions?: readonly HTMLElement[];
  /**
   * `muted` draws the row as a filled tile — right for a standalone card of
   * one. `plain` leaves it transparent, which is what a row in a list wants:
   * the list is the object, not each row.
   */
  variant?: 'plain' | 'muted';
}

export interface Item {
  root: HTMLElement;
  /** The text column, for a caller that needs to append to it. */
  content: HTMLElement;
  title: HTMLElement;
}

/** One row of a list: media, title over description, actions. */
export function item(o: ItemOptions): Item {
  const root = styled('div', 'atx-item');
  root.dataset.variant = o.variant ?? 'plain';

  if (o.media) {
    const media = styled('div', 'atx-item-media');
    media.append(o.media);
    root.append(media);
  }

  const content = styled('div', 'atx-item-content');
  const title = styled('div', 'atx-item-title');
  title.textContent = o.title;
  content.append(title);
  if (o.description) {
    const desc = styled('div', 'atx-item-desc');
    desc.textContent = o.description;
    content.append(desc);
  }
  root.append(content);

  if (o.actions?.length) {
    const actions = styled('div', 'atx-item-actions');
    actions.append(...o.actions);
    root.append(actions);
  }
  return { root, content, title };
}

export interface ItemGroupOptions {
  /**
   * Run the rows edge to edge in the surface holding them: cancels a card
   * body's horizontal padding so the rules between rows reach the card's own
   * edges and a hover fill covers the whole row. A list sitting directly in a
   * card body wants this; one indented inside other content does not.
   */
  bleed?: boolean;
}

/** The list an `item` belongs to: rows flush, separated by a rule. */
export function itemGroup(o: ItemGroupOptions = {}): HTMLElement {
  const el = styled('div', 'atx-item-group');
  el.role = 'list';
  if (o.bleed) el.dataset.bleed = '';
  return el;
}
