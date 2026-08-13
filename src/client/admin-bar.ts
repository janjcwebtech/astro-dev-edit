import { type IconName, icon, setIcon } from './icons.ts';
import * as state from './state.ts';
import { COLOR, FONT, Z, setChromeInset, styled } from './ui.ts';

/**
 * The admin bar — the overlay's one piece of persistent chrome.
 *
 * A full-width strip docked to the top (or bottom) of the viewport holding every
 * global action: the element tree, edit mode, the CMS entry drawer, the bar's own
 * pin/dock controls, and the exit button that doubles as the save indicator.
 * Modelled on the WordPress admin bar with three deliberate differences:
 *
 *  - it **overlays** the page rather than pushing it down. The top edge belongs
 *    to the host site (sticky headers live there), so reflowing it would change
 *    the very layout the user is editing;
 *  - it is **translucent at rest** and opaque on approach, so it reads as a tool
 *    over the page instead of part of it;
 *  - it can be **unpinned** — retracting off-screen until the pointer reaches
 *    that edge, leaving only a hairline — or **docked to the bottom** when the
 *    top is where the page's own chrome lives. Both persist across reloads.
 *
 * Items come from a registry: `register()` takes a spec and the bar renders it,
 * either inline or in the overflow menu behind the brand mark. Adding an action
 * is one entry, not more layout code — and `refresh()` re-evaluates every item's
 * label/icon/visibility/lit-state from the live app state, so specs stay
 * declarative.
 *
 * What the bar does NOT own: edit mode, the tree, and the entry drawer all live
 * elsewhere and are reached through `AdminBarDeps`. The bar is a view.
 */

/** Which viewport edge the bar is docked to. */
export type BarEdge = 'top' | 'bottom';

/** A control on the bar (or in its overflow menu). Everything dynamic is a
 *  getter, evaluated on every `refresh()`. */
export interface BarItemSpec {
  /** DOM id, and the registry key. `atx-`-prefixed by convention. */
  id: string;
  label: string | (() => string);
  icon: IconName | (() => IconName);
  /** Tooltip; defaults to the label. */
  title?: string | (() => string);
  /** Inline in the bar (default) or behind the overflow menu. */
  place?: 'bar' | 'menu';
  /** Which end of the bar. Ignored for menu items. */
  side?: 'left' | 'right';
  /** Icon only — the label becomes the tooltip. Bar items only. */
  compact?: boolean;
  /** Per-item style trim. */
  extra?: Partial<CSSStyleDeclaration>;
  /** Hidden entirely when this returns false. */
  visible?(): boolean;
  /** Rendered lit (accent background) when this returns true. */
  active?(): boolean;
  /** Rendered unclickable when this returns true. */
  disabled?(): boolean;
  /** Last word on appearance — used by the exit button, whose colour is the
   *  save state. Runs after the standard paint; return the resting/hover
   *  backgrounds to keep the hover behaviour in step. */
  paint?(btn: HTMLButtonElement): { bg: string; bgHover: string } | void;
  onSelect(): void;
}

export interface AdminBarDeps {
  isEditMode(): boolean;
  /** Turn edit mode on. */
  enterEdit(): void;
  /** Leave edit mode — committing anything pending first, never discarding. */
  exitEdit(): void;
  /** Show the element tree (turning edit mode on if it is off). */
  showTree(): void;
  /** Hide the element tree, staying in edit mode. */
  hideTree(): void;
  isTreeOpen(): boolean;
  /** Whether this page declares a backing content entry. */
  hasEntry(): boolean;
  openEntry(): void;
  /** Open the file this page is written in, in the user's editor. */
  openPageSource(): void;
  /** Open the integration settings panel (currently: the Unsplash access key).
   *  Injected because admin-bar.ts imports nothing from `editors/`. */
  openSettings(): void;
}

export interface AdminBarHandle {
  /** Nodes for the composition root to append at boot. */
  elements: HTMLElement[];
  /** Add an item. Rendered immediately, in registration order. */
  register(item: BarItemSpec): void;
  /** Re-evaluate every item's label, icon, visibility and lit state. */
  refresh(): void;
  /** Recompute whether the bar is out or retracted. For changes the bar can't
   *  see coming from a pointer event — edit mode turning on or off. */
  syncVisibility(): void;
  /** The right-aligned note (hold-to-navigate); null hides it. */
  setHint(text: string | null): void;
}

const BAR_H = 36;
/** How close to the docked edge the pointer must get to reveal an unpinned bar. */
const HOT_ZONE = 4;
/** Grace period before an unpinned bar slides away again. */
const RETRACT_DELAY = 350;
/** Opacity while pinned but not approached — visible, never in the way. */
const REST_OPACITY = '0.5';

const BTN_BG = 'rgba(255,255,255,0.09)';
const BTN_BG_HOVER = 'rgba(255,255,255,0.20)';
const BTN_INK = '#e7e6f2';

const PHASE_LABEL: Record<state.SavePhase, string> = {
  clean: 'Done',
  dirty: 'Save & exit',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed',
};
const PHASE_ICON: Record<state.SavePhase, IconName> = {
  clean: 'check',
  dirty: 'dot',
  saving: 'spinner',
  saved: 'check',
  error: 'alert',
};
const PHASE_TITLE: Record<state.SavePhase, string> = {
  clean: 'Everything is written to disk — leave edit mode',
  dirty: 'Save your change, then leave edit mode',
  saving: 'Writing to the file…',
  saved: 'Written to disk',
  error: 'The last save failed and the change was rolled back — click to leave edit mode',
};
const PHASE_BG: Record<state.SavePhase, string> = {
  clean: COLOR.ok,
  dirty: COLOR.accent,
  saving: BTN_BG,
  saved: COLOR.ok,
  error: COLOR.err,
};

/** Nudge a hex colour toward white for the hover state of a coloured button. */
function lift(hex: string, by = 18): string {
  const v = Number.parseInt(hex.slice(1), 16);
  const channels = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => Math.min(255, c + by));
  return `rgb(${channels.join(', ')})`;
}

// --- Persisted preferences ---------------------------------------------------

interface BarPrefs {
  edge: BarEdge;
  pinned: boolean;
}

const PREFS_KEY = 'astroTextEditBar';
const DEFAULT_PREFS: BarPrefs = { edge: 'top', pinned: true };

function loadPrefs(): BarPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<BarPrefs>;
    return {
      edge: parsed.edge === 'bottom' ? 'bottom' : 'top',
      pinned: parsed.pinned !== false,
    };
  } catch {
    // No localStorage (or junk in it) — the defaults are fine.
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs(prefs: BarPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Preferences just won't persist.
  }
}

// --- Build -------------------------------------------------------------------

interface BarNode {
  spec: BarItemSpec;
  btn: HTMLButtonElement;
  ico: HTMLElement;
  label: HTMLElement | null;
  bg: string;
  bgHover: string;
}

export function initAdminBar(deps: AdminBarDeps): AdminBarHandle {
  const prefs = loadPrefs();
  let overBar = false;
  let retractTimer: number | null = null;

  // Z+4: above the element tree (Z+3) and the hover pill, below the modal
  // backdrop (Z+5) — an open drawer covers the bar, as it should.
  const bar = styled(
    'div',
    'atx-bar',
    {
      position: 'fixed',
      left: '0',
      right: '0',
      height: `${BAR_H}px`,
      zIndex: String(Z + 4),
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '0 8px',
      boxSizing: 'border-box',
      background: 'rgba(22, 21, 34, 0.78)',
      backdropFilter: 'blur(12px) saturate(1.3)',
      color: '#fff',
      font: `500 12px ${FONT.ui}`,
      opacity: REST_OPACITY,
      transition: 'opacity 140ms ease, transform 220ms cubic-bezier(0.4, 0, 0.2, 1)',
      // Edit mode sets a page-wide crosshair; the bar is not click-to-edit.
      cursor: 'auto',
    },
    'atx-bar',
  );

  // What an unpinned bar leaves behind: a 3px accent line with a wider nub in
  // the middle, so the bar is discoverable once it has slid away.
  const hairline = styled(
    'div',
    'atx-hairline',
    {
      position: 'fixed',
      left: '0',
      right: '0',
      height: '3px',
      zIndex: String(Z + 3),
      display: 'none',
      pointerEvents: 'none',
      background: `linear-gradient(90deg, transparent, ${COLOR.accent}88, transparent)`,
    },
    'atx-hairline',
  );
  const nub = styled('div', 'atx-hairline-nub', {
    position: 'absolute',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '54px',
    height: '3px',
    background: COLOR.accent,
  });
  hairline.append(nub);

  const leftGroup = styled('div', 'atx-bar-group', {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    minWidth: '0',
  });
  const rightGroup = styled('div', 'atx-bar-group atx-bar-group-right', {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginLeft: 'auto',
  });

  // The brand mark is also the overflow menu's anchor: as the item registry
  // grows past the width of the bar, items land in the menu instead of
  // squeezing the row.
  const brand = styled(
    'button',
    'atx-bar-brand',
    {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flex: '0 0 auto',
      width: '24px',
      height: '24px',
      padding: '0',
      border: 'none',
      borderRadius: '6px',
      background: COLOR.accent,
      color: '#fff',
      cursor: 'pointer',
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.10)',
    },
    'atx-bar-brand',
  );
  brand.type = 'button';
  brand.title = 'astro-text-edit — menu';
  brand.setAttribute('aria-haspopup', 'menu');
  brand.append(icon('cursor', 15));
  brand.addEventListener('mouseenter', () => (brand.style.background = lift(COLOR.accent)));
  brand.addEventListener('mouseleave', () => (brand.style.background = COLOR.accent));

  const separator = styled('div', 'atx-bar-sep', {
    flex: '0 0 auto',
    width: '1px',
    height: '18px',
    margin: '0 3px',
    background: 'rgba(255,255,255,0.14)',
  });

  const hint = styled(
    'span',
    'atx-bar-hint',
    {
      font: `500 10.5px/1 ${FONT.ui}`,
      color: '#9d9ab5',
      paddingRight: '4px',
      whiteSpace: 'nowrap',
      display: 'none',
    },
    'atx-bar-hint',
  );

  leftGroup.append(brand, separator);
  rightGroup.append(hint);
  bar.append(leftGroup, rightGroup);

  const menu = styled(
    'div',
    'atx-menu',
    {
      position: 'fixed',
      zIndex: String(Z + 4),
      minWidth: '208px',
      padding: '5px',
      display: 'none',
      flexDirection: 'column',
      background: 'rgba(28, 27, 42, 0.97)',
      backdropFilter: 'blur(14px)',
      border: `1px solid ${COLOR.panelBorder}`,
      borderRadius: '9px',
      boxShadow: '0 16px 44px rgba(0,0,0,0.5)',
      font: `500 12.5px ${FONT.ui}`,
      color: '#dedded',
      cursor: 'auto',
    },
    'atx-menu',
  );
  menu.setAttribute('role', 'menu');
  const menuItems = styled('div', 'atx-menu-items', { display: 'flex', flexDirection: 'column' });
  const menuFoot = styled('div', 'atx-menu-foot', {
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    margin: '5px 4px 0',
    paddingTop: '7px',
    borderTop: `1px solid ${COLOR.panelDivider}`,
    font: `500 10.5px ${FONT.mono}`,
    color: '#7d7d95',
  });
  const liveDot = styled('span', 'atx-menu-live', {
    width: '6px',
    height: '6px',
    flex: '0 0 auto',
    borderRadius: '50%',
    background: COLOR.image,
  });
  menuFoot.append(liveDot);
  menuFoot.append(document.createTextNode('dev server connected'));
  menu.append(menuItems, menuFoot);

  // --- Visibility ----------------------------------------------------------

  function inHotZone(y: number): boolean {
    return prefs.edge === 'top' ? y <= HOT_ZONE : y >= window.innerHeight - HOT_ZONE;
  }

  function menuOpen(): boolean {
    return menu.style.display !== 'none';
  }

  /** The one place the bar's opacity/transform is decided. Pinned: it stays put
   *  and only fades in. Unpinned: it slides off the edge entirely — except while
   *  edit mode is on, when it behaves as pinned no matter the preference. In edit
   *  mode the bar carries the save state and the way out, so it must never be
   *  off-screen; unpinning is about keeping it out of the way while you browse. */
  function applyVisibility(approached: boolean): void {
    const open = approached || overBar || menuOpen() || bar.contains(document.activeElement);
    if (prefs.pinned || deps.isEditMode()) {
      bar.style.transform = 'none';
      bar.style.opacity = open ? '1' : REST_OPACITY;
      bar.style.pointerEvents = 'auto';
      hairline.style.display = 'none';
      return;
    }
    bar.style.transform = open
      ? 'none'
      : `translateY(${prefs.edge === 'top' ? '-100%' : '100%'})`;
    bar.style.opacity = open ? '1' : '0';
    // A retracted bar must not swallow clicks on the strip it used to cover.
    bar.style.pointerEvents = open ? 'auto' : 'none';
    hairline.style.display = open ? 'none' : 'block';
  }

  function reveal(): void {
    if (retractTimer !== null) {
      clearTimeout(retractTimer);
      retractTimer = null;
    }
    applyVisibility(true);
  }

  function scheduleRetract(): void {
    if (retractTimer !== null) clearTimeout(retractTimer);
    retractTimer = window.setTimeout(() => {
      retractTimer = null;
      applyVisibility(false);
    }, RETRACT_DELAY);
  }

  bar.addEventListener('mouseenter', () => {
    overBar = true;
    reveal();
  });
  bar.addEventListener('mouseleave', () => {
    overBar = false;
    scheduleRetract();
  });
  bar.addEventListener('focusin', reveal);
  bar.addEventListener('focusout', scheduleRetract);
  // Pointer position drives the reveal rather than an invisible hot-zone
  // element, which would sit over the page and eat clicks on the host site.
  // Only *transitions* in and out of the zone do anything — a plain mousemove
  // across the page must not churn timers on every event.
  let inZone = false;
  document.addEventListener(
    'pointermove',
    (e) => {
      const next = inHotZone(e.clientY);
      if (next === inZone) return;
      inZone = next;
      if (next) reveal();
      else if (!overBar) scheduleRetract();
    },
    { passive: true },
  );

  /** Everything positional reads the docked edge — and the bar's strip is
   *  reserved whether it is pinned or not. Retraction is transient: the tree
   *  must not reflow every time the bar slides in, and the bar must never sit
   *  on top of it. */
  function applyEdge(): void {
    if (prefs.edge === 'top') {
      bar.style.top = '0';
      bar.style.bottom = '';
      bar.style.borderTop = 'none';
      bar.style.borderBottom = '1px solid rgba(255,255,255,0.09)';
      bar.style.boxShadow = '0 6px 22px rgba(0,0,0,0.26)';
      hairline.style.top = '0';
      hairline.style.bottom = '';
      nub.style.top = '0';
      nub.style.bottom = '';
      nub.style.borderRadius = '0 0 3px 3px';
    } else {
      bar.style.top = '';
      bar.style.bottom = '0';
      bar.style.borderTop = '1px solid rgba(255,255,255,0.09)';
      bar.style.borderBottom = 'none';
      bar.style.boxShadow = '0 -6px 22px rgba(0,0,0,0.26)';
      hairline.style.top = '';
      hairline.style.bottom = '0';
      nub.style.top = '';
      nub.style.bottom = '0';
      nub.style.borderRadius = '3px 3px 0 0';
    }
    setChromeInset({
      top: prefs.edge === 'top' ? BAR_H : 0,
      bottom: prefs.edge === 'bottom' ? BAR_H : 0,
    });
  }

  /** Edit mode changed: the bar is out for the whole of it, and free to retract
   *  again once it ends. */
  function syncVisibility(): void {
    reveal();
    if (!prefs.pinned && !deps.isEditMode()) scheduleRetract();
  }

  function setPinned(on: boolean): void {
    prefs.pinned = on;
    savePrefs(prefs);
    applyVisibility(on);
    refresh();
  }

  function setEdge(next: BarEdge): void {
    prefs.edge = next;
    savePrefs(prefs);
    applyEdge();
    closeMenu();
    reveal(); // a flip always shows itself once, wherever it landed
    if (!prefs.pinned) scheduleRetract();
    refresh();
  }

  // --- Overflow menu -------------------------------------------------------

  function openMenu(): void {
    menu.style.display = 'flex';
    const anchor = brand.getBoundingClientRect();
    menu.style.left = `${Math.max(6, anchor.left)}px`;
    if (prefs.edge === 'top') {
      menu.style.top = `${anchor.bottom + 7}px`;
      menu.style.bottom = '';
    } else {
      menu.style.bottom = `${window.innerHeight - anchor.top + 7}px`;
      menu.style.top = '';
    }
    brand.setAttribute('aria-expanded', 'true');
    reveal(); // the bar can't retract while its own menu is open
  }

  function closeMenu(): void {
    menu.style.display = 'none';
    brand.setAttribute('aria-expanded', 'false');
  }

  brand.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menuOpen()) closeMenu();
    else {
      refresh();
      openMenu();
    }
  });
  document.addEventListener('click', (e) => {
    if (menuOpen() && e.target instanceof Node && !menu.contains(e.target)) closeMenu();
  });
  // Capture phase + stopPropagation so an open menu consumes the Escape rather
  // than also clearing the tree selection behind it.
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !menuOpen()) return;
      e.stopPropagation();
      closeMenu();
    },
    true,
  );
  closeMenu();

  // --- Item registry -------------------------------------------------------

  const nodes: BarNode[] = [];

  function paintNode(node: BarNode): void {
    const { spec, btn, ico, label } = node;
    const visible = spec.visible ? spec.visible() : true;
    btn.style.display = visible ? (spec.place === 'menu' ? 'flex' : 'inline-flex') : 'none';
    if (!visible) return;

    const text = typeof spec.label === 'function' ? spec.label() : spec.label;
    if (label) label.textContent = text;
    setIcon(ico, typeof spec.icon === 'function' ? spec.icon() : spec.icon, spec.place === 'menu' ? 15 : 14);
    const title = typeof spec.title === 'function' ? spec.title() : spec.title;
    btn.title = title ?? text;
    btn.setAttribute('aria-label', text);

    const on = spec.active?.() ?? false;
    node.bg = on ? COLOR.accent : spec.place === 'menu' ? 'transparent' : BTN_BG;
    node.bgHover = on ? lift(COLOR.accent) : spec.place === 'menu' ? `${COLOR.accent}38` : BTN_BG_HOVER;
    btn.style.background = node.bg;
    btn.style.color = on ? '#fff' : spec.place === 'menu' ? '#dedded' : BTN_INK;
    const off = spec.disabled?.() ?? false;
    btn.disabled = off;
    btn.style.cursor = off ? 'default' : 'pointer';
    const painted = spec.paint?.(btn);
    if (painted) {
      node.bg = painted.bg;
      node.bgHover = painted.bgHover;
    }
  }

  function build(spec: BarItemSpec): BarNode {
    const inMenu = spec.place === 'menu';
    const btn = styled(
      'button',
      inMenu ? 'atx-menu-item' : `atx-bar-btn${spec.compact ? ' atx-bar-btn-icon' : ''}`,
      inMenu
        ? {
            display: 'flex',
            alignItems: 'center',
            gap: '9px',
            width: '100%',
            padding: '7px 9px',
            border: 'none',
            borderRadius: '6px',
            background: 'transparent',
            color: '#dedded',
            font: `500 12.5px ${FONT.ui}`,
            textAlign: 'left',
            cursor: 'pointer',
            ...spec.extra,
          }
        : {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            flex: '0 0 auto',
            height: '24px',
            padding: spec.compact ? '0' : '0 10px',
            width: spec.compact ? '26px' : 'auto',
            justifyContent: 'center',
            border: 'none',
            borderRadius: '6px',
            background: BTN_BG,
            color: BTN_INK,
            font: `600 12px/1 ${FONT.ui}`,
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            transition: 'background 120ms, color 120ms',
            ...spec.extra,
          },
      spec.id,
    );
    btn.type = 'button';
    const ico = icon(typeof spec.icon === 'function' ? spec.icon() : spec.icon, inMenu ? 15 : 14);
    btn.append(ico);
    let label: HTMLElement | null = null;
    if (!spec.compact) {
      label = styled('span', 'atx-bar-btn-label', {});
      btn.append(label);
    }
    const node: BarNode = { spec, btn, ico, label, bg: BTN_BG, bgHover: BTN_BG_HOVER };
    btn.addEventListener('mouseenter', () => {
      if (!btn.disabled) btn.style.background = node.bgHover;
    });
    btn.addEventListener('mouseleave', () => (btn.style.background = node.bg));
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (inMenu) closeMenu();
      spec.onSelect();
    });
    return node;
  }

  function register(spec: BarItemSpec): void {
    const node = build(spec);
    nodes.push(node);
    if (spec.place === 'menu') menuItems.append(node.btn);
    else if (spec.side === 'right') rightGroup.append(node.btn);
    else leftGroup.append(node.btn);
    paintNode(node);
  }

  function refresh(): void {
    for (const node of nodes) paintNode(node);
  }

  // --- Core items ----------------------------------------------------------

  // Elements comes first: it is how you find what you can edit, and the tree's
  // row hover only means anything in edit mode — so it turns edit mode on with
  // it rather than sitting there half-inert.
  register({
    id: 'atx-bar-elements',
    label: 'Elements',
    // Same glyph as the tree's own edge tab (#atx-tree-tab): both open the
    // panel, so they should read as one control from either end.
    icon: 'sidebar',
    title: 'Show the element tree for this page',
    active: () => deps.isTreeOpen(),
    onSelect: () => (deps.isTreeOpen() ? deps.hideTree() : deps.showTree()),
  });

  register({
    id: 'atx-toggle',
    label: () => (deps.isEditMode() ? 'Editing' : 'Edit page'),
    icon: 'pencil',
    title: () =>
      deps.isEditMode() ? 'Leave edit mode (saving anything pending)' : 'Click text and images on the page to edit them',
    active: () => deps.isEditMode(),
    onSelect: () => (deps.isEditMode() ? deps.exitEdit() : deps.enterEdit()),
  });

  register({
    id: 'atx-entry',
    label: 'Edit entry',
    icon: 'file',
    title: 'Edit this page’s content entry',
    visible: () => deps.hasEntry(),
    onSelect: () => deps.openEntry(),
  });

  register({
    id: 'atx-bar-pin',
    label: 'Pin the bar',
    icon: () => (prefs.pinned ? 'pin' : 'pinOff'),
    // Lit means pinned: the button shows the state you are IN, not the one it
    // would take you to. Unpinned mid-edit says so, since the bar visibly
    // ignores the setting until you leave edit mode.
    title: () =>
      prefs.pinned
        ? 'Pinned — click to hide until the pointer nears this edge'
        : deps.isEditMode()
          ? 'Unpinned — but the bar stays out while you are editing'
          : 'Pin the bar open',
    side: 'right',
    compact: true,
    active: () => prefs.pinned,
    onSelect: () => setPinned(!prefs.pinned),
  });

  register({
    id: 'atx-bar-edge',
    label: 'Move the bar',
    icon: () => (prefs.edge === 'top' ? 'panelBottom' : 'panelTop'),
    title: () =>
      prefs.edge === 'top' ? 'Move the bar to the bottom' : 'Move the bar back to the top',
    side: 'right',
    compact: true,
    onSelect: () => setEdge(prefs.edge === 'top' ? 'bottom' : 'top'),
  });

  // The exit control. Its label and colour ARE the save indicator — green only
  // once everything is on disk — so leaving edit mode can never be mistaken for
  // discarding work, and never silently discards it either.
  register({
    id: 'atx-bar-exit',
    label: () => PHASE_LABEL[state.savePhase()],
    icon: () => PHASE_ICON[state.savePhase()],
    title: () => PHASE_TITLE[state.savePhase()],
    side: 'right',
    extra: { minWidth: '96px' },
    visible: () => deps.isEditMode(),
    disabled: () => state.savePhase() === 'saving',
    paint: (btn) => {
      const phase = state.savePhase();
      const bg = PHASE_BG[phase];
      btn.style.background = bg;
      btn.style.color = phase === 'saving' ? '#b9b6cc' : '#fff';
      btn.style.cursor = phase === 'saving' ? 'progress' : 'pointer';
      return { bg, bgHover: bg.startsWith('#') ? lift(bg) : bg };
    },
    onSelect: () => deps.exitEdit(),
  });

  register({
    id: 'atx-menu-page-source',
    place: 'menu',
    label: 'Open page source',
    icon: 'code',
    title: 'Open the file this page is written in, in your editor',
    onSelect: () => deps.openPageSource(),
  });

  register({
    id: 'atx-menu-settings',
    place: 'menu',
    label: 'Settings',
    icon: 'settings',
    title: 'Integration settings — Unsplash access key',
    onSelect: () => deps.openSettings(),
  });

  // The exit button's whole point is to track the save state, so the bar
  // repaints on every phase change.
  state.onSavePhase(() => refresh());

  applyEdge();
  applyVisibility(false);

  return {
    elements: [hairline, bar, menu],
    register,
    refresh,
    syncVisibility,
    setHint(text: string | null): void {
      hint.textContent = text ?? '';
      hint.style.display = text ? 'inline' : 'none';
    },
  };
}
