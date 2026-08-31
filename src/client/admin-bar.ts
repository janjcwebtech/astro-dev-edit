import { has } from './features.ts';
import { type IconName, icon, setIcon } from './icons.ts';
import * as state from './state.ts';
import { BAR_CHIP, BAR_CHIP_HOVER, COLOR, lift, setChromeInset, styled } from './ui.ts';
import { overlayActiveElement } from './shadow.ts';

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
  /** Open the collection and field designer. */
  openCollections(): void;
  /** Open the integration settings drawer. Injected because admin-bar.ts
   *  imports nothing from `editors/`. */
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
/** The save button's label while writing — reads as busy without dropping below
 *  AA on the button's own hover background (white at 0.20 over the bar). */
const SAVING_INK = COLOR.mutedFg;

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
  clean: COLOR.success,
  dirty: COLOR.primary,
  saving: BAR_CHIP,
  saved: COLOR.success,
  error: COLOR.destructive,
};

// --- Persisted preferences ---------------------------------------------------

interface BarPrefs {
  edge: BarEdge;
  pinned: boolean;
}

const PREFS_KEY = 'astroDevEditBar';
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
  /** Whether `spec.paint` supplied this node's colours — the only nodes whose
   *  background is written from JS rather than matched in styles.ts. */
  painted: boolean;
}

export function initAdminBar(deps: AdminBarDeps): AdminBarHandle {
  const prefs = loadPrefs();
  let overBar = false;
  let retractTimer: number | null = null;

  // Z+4: above the element tree (Z+3) and the hover pill, below the modal
  // backdrop (Z+5) — an open drawer covers the bar, as it should.
  const bar = styled('div', 'atx-bar', undefined, 'atx-bar');

  // What an unpinned bar leaves behind: a 3px accent line with a wider nub in
  // the middle, so the bar is discoverable once it has slid away.
  const hairline = styled('div', 'atx-hairline', undefined, 'atx-hairline');
  const nub = styled('div', 'atx-hairline-nub');
  hairline.append(nub);

  const leftGroup = styled('div', 'atx-bar-group');
  const rightGroup = styled('div', 'atx-bar-group atx-bar-group-right');

  // The brand mark is also the overflow menu's anchor: as the item registry
  // grows past the width of the bar, items land in the menu instead of
  // squeezing the row.
  const brand = styled('button', 'atx-bar-brand', undefined, 'atx-bar-brand');
  brand.type = 'button';
  brand.title = 'astro-dev-edit — menu';
  brand.setAttribute('aria-haspopup', 'menu');
  brand.append(icon('cursor', 15));

  const separator = styled('div', 'atx-bar-sep');

  const hint = styled('span', 'atx-bar-hint', undefined, 'atx-bar-hint');

  leftGroup.append(brand, separator);
  rightGroup.append(hint);
  bar.append(leftGroup, rightGroup);

  const menu = styled('div', 'atx-menu', undefined, 'atx-menu');
  menu.setAttribute('role', 'menu');
  const menuItems = styled('div', 'atx-menu-items');
  const menuFoot = styled('div', 'atx-menu-foot');
  const liveDot = styled('span', 'atx-menu-live');
  menuFoot.append(liveDot);
  menuFoot.append(document.createTextNode('dev server connected'));
  menu.append(menuItems, menuFoot);

  // --- Visibility ----------------------------------------------------------

  function inHotZone(y: number): boolean {
    return prefs.edge === 'top' ? y <= HOT_ZONE : y >= window.innerHeight - HOT_ZONE;
  }

  function menuOpen(): boolean {
    return menu.hasAttribute('data-on');
  }

  /** The one place the bar's opacity/transform is decided. Pinned: it stays put
   *  and only fades in. Unpinned: it slides off the edge entirely — except while
   *  edit mode is on, when it behaves as pinned no matter the preference. In edit
   *  mode the bar carries the save state and the way out, so it must never be
   *  off-screen; unpinning is about keeping it out of the way while you browse. */
  function applyVisibility(approached: boolean): void {
    // overlayActiveElement, not document.activeElement: the latter reports the
    // shadow host for anything focused in here, so the bar would dim while you
    // were typing in it.
    const open = approached || overBar || menuOpen() || bar.contains(overlayActiveElement());
    // Both flags, then let styles.ts decide. Docked means "never retracts", and
    // the resting opacity, the slide-off, the dead pointer-events on a bar that
    // is off-screen and the hairline all follow from the pair rather than from
    // five writes split across two branches here.
    const docked = prefs.pinned || deps.isEditMode();
    bar.toggleAttribute('data-docked', docked);
    bar.toggleAttribute('data-open', open);
    hairline.toggleAttribute('data-on', !docked && !open);
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
    // One flag on each of the two fixed elements; the nub follows its parent.
    // Which edge a border, a shadow and a corner belong to is layout, and
    // saying it twice in JS is how the two used to drift.
    bar.dataset.edge = prefs.edge;
    hairline.dataset.edge = prefs.edge;
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
    menu.toggleAttribute('data-on', true);
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
    menu.toggleAttribute('data-on', false);
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
    if (menuOpen() && !e.composedPath().includes(menu)) closeMenu();
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
    btn.toggleAttribute('data-hidden', !visible);
    if (!visible) return;

    const text = typeof spec.label === 'function' ? spec.label() : spec.label;
    if (label) label.textContent = text;
    setIcon(ico, typeof spec.icon === 'function' ? spec.icon() : spec.icon, spec.place === 'menu' ? 15 : 14);
    const title = typeof spec.title === 'function' ? spec.title() : spec.title;
    btn.title = title ?? text;
    btn.setAttribute('aria-label', text);

    btn.toggleAttribute('data-active', spec.active?.() ?? false);
    const off = spec.disabled?.() ?? false;
    btn.disabled = off;
    btn.toggleAttribute('data-off', off);
    // `paint` is a caller-supplied hook returning arbitrary colours — the save
    // button runs its phase through it — so a painted node keeps the JS hover
    // path and its own inline background. Every other node hovers in CSS.
    const painted = spec.paint?.(btn);
    node.painted = !!painted;
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
      // Only the caller's own trim; the box is .atx-menu-item / .atx-bar-btn,
      // and a compact button is the -icon modifier rather than two ternaries.
      spec.extra,
      spec.id,
    );
    btn.type = 'button';
    const ico = icon(typeof spec.icon === 'function' ? spec.icon() : spec.icon, inMenu ? 15 : 14);
    btn.append(ico);
    let label: HTMLElement | null = null;
    if (!spec.compact) {
      label = styled('span', 'atx-bar-btn-label');
      btn.append(label);
    }
    const node: BarNode = { spec, btn, ico, label, bg: BAR_CHIP, bgHover: BAR_CHIP_HOVER, painted: false };
    btn.addEventListener('mouseenter', () => {
      if (node.painted && !btn.disabled) btn.style.background = node.bgHover;
    });
    btn.addEventListener('mouseleave', () => {
      if (node.painted) btn.style.background = node.bg;
    });
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
      btn.style.color = phase === 'saving' ? SAVING_INK : COLOR.foreground;
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
    // The whole item is a launch-my-editor action, so it goes when that is off.
    visible: () => has('openInEditor'),
    onSelect: () => deps.openPageSource(),
  });

  // Collections is a *peer* of Settings, not a tab inside it: a collection's
  // shape is the project's own committed source, while an option is a switch on
  // this tool. Reaching the designer should not mean going through settings.
  register({
    id: 'atx-menu-collections',
    place: 'menu',
    label: 'Collections',
    icon: 'collections',
    title: 'Design your content collections — fields, types and entries',
    // The whole designer sits behind the entry editor server-side, so the item
    // goes when that is off rather than opening a drawer that can only refuse.
    visible: () => has('entryEditor'),
    onSelect: () => deps.openCollections(),
  });

  register({
    id: 'atx-menu-settings',
    place: 'menu',
    label: 'Settings',
    icon: 'settings',
    title: 'Integration settings — every option, editable here',
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
      hint.toggleAttribute('data-on', !!text);
    },
  };
}
