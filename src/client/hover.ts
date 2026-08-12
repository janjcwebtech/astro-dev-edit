import type { ClassifyResult, SourceLoc } from "../shared/protocol.ts";
import { classifyCached, peekClassification } from "./classify-cache.ts";
import { buildRulesCard, rulesForToken } from "./css-inspect.ts";
import { icon, setIcon } from "./icons.ts";
import { nearestSource, sourceFor } from "./source-map.ts";
import {
  COLOR,
  FONT,
  Z,
  basename,
  chromeInset,
  hexToRgba,
  pillButton,
  setPillLabel,
  styled,
} from "./ui.ts";

/**
 * Hover behaviour: the outline that tracks the hovered source-mapped element
 * and the interactive tooltip pill (file:loc · verdict, plus "open ↗" and
 * "copy ⧉" buttons). Clicking the file:loc label opens the in-browser source
 * peek; "open ↗" jumps to the editor; "copy ⧉" puts the element's context
 * (HTML, CSS, source) on the clipboard. Hover state is self-contained
 * here — it never interacts with the editing slot in state.ts.
 *
 * The pill never guesses. It appears instantly in a neutral "checking" state
 * (no editability claim), and once the pointer has dwelled on one element the
 * server's AST-truth /classify upgrades it to the verdict a click would get:
 * editable, image, or dynamic. Verdicts come through classify-cache.ts, so an
 * element costs one round-trip per file version, not one per mouse pass, and
 * a re-hover of a known element shows its verdict immediately. (spec §7.3)
 */

/** What the pill claims about the highlighted element. */
interface Verdict {
  word: string;
  color: string;
}

/** Neutral pre-verification state — no editability claim yet. */
const CHECKING: Verdict = { word: "loading…", color: COLOR.muted };

/** Collapse the server's classification onto the pill's word + color,
 *  mirroring how router.ts will route the eventual click. (spec §16.1) */
function verdictFor(result: ClassifyResult): Verdict {
  if (result.kind === "text") return { word: "editable", color: COLOR.accent };
  if (result.kind === "image") {
    const attrs = result.attrs ?? { src: "dynamic", alt: "dynamic" };
    // Same rule as the click router: when neither src nor alt is patchable
    // the click ends in a refusal notice, so the pill says dynamic.
    if (attrs.src !== "static" && attrs.alt === "dynamic") {
      return { word: "dynamic", color: COLOR.warn };
    }
    return { word: "image", color: COLOR.image };
  }
  // empty / dynamic / ambiguous / unresolved all route to the refusal notice.
  return { word: "dynamic", color: COLOR.warn };
}

// --- Elements (appended to the body by the composition root at boot) --------

const outline = styled(
  "div",
  "atx-outline",
  {
    position: "fixed",
    pointerEvents: "none",
    zIndex: String(Z),
    border: `2px solid ${COLOR.accent}`,
    borderRadius: "3px",
    background: "rgba(97, 68, 215, 0.08)",
    display: "none",
    transition: "all 60ms ease-out",
  },
  "atx-outline",
);

// The pill is interactive: hovering it keeps it open, and its "open source"
// button jumps to the element's source in the editor. (#3)
const tooltip = styled(
  "div",
  "atx-tooltip",
  {
    position: "fixed",
    pointerEvents: "auto",
    zIndex: String(Z + 1),
    padding: "4px 4px 4px 8px",
    font: `500 12px/1.4 ${FONT.mono}`,
    color: "#fff",
    background: "#1a1a2e",
    borderRadius: "5px",
    boxShadow: "0 2px 10px rgba(0,0,0,0.3)",
    display: "none",
    // Column so the loc line and the class/ID chips row stack; each row sizes
    // to its own content (flex-start) rather than stretching to the widest.
    flexDirection: "column",
    alignItems: "flex-start",
    whiteSpace: "nowrap",
    cursor: "default",
  },
  "atx-tooltip",
);

// Row 1: the file:loc · verdict label and the "open ↗" editor jump, kept on one
// line regardless of the chips row below.
const tooltipRow = styled("span", "atx-tooltip-row", {
  display: "flex",
  alignItems: "center",
});

// The label is clickable too — the whole file:loc line opens the in-browser
// source peek (the "open ↗" button next to it is the editor jump). (#3)
const tooltipLabel = styled("span", "atx-tooltip-label", {
  cursor: "pointer",
});
// The label is two spans so the verdict sits in a fixed-width slot: the pill
// must not resize (distracting) when "loading…" upgrades to the real verdict.
// 8ch fits the longest words ("editable", "loading…") in the pill's monospace
// font; shorter verdicts leave a little slack instead of shrinking the pill.
const tooltipLoc = styled("span", "atx-tooltip-loc", {});
const tooltipVerdict = styled("span", "atx-tooltip-verdict", {
  display: "inline-block",
  width: "8ch",
});
tooltipLabel.append(tooltipLoc, tooltipVerdict);
tooltipLabel.title = "Peek at the source code";
tooltipLabel.addEventListener("mouseenter", () => (tooltipLabel.style.textDecoration = "underline"));
tooltipLabel.addEventListener("mouseleave", () => (tooltipLabel.style.textDecoration = "none"));
const tooltipOpen = pillButton(
  "atx-tooltip-open",
  "open",
  "Open this location in your editor",
  {},
  icon("external", 12),
);

// The context copy: everything we know about this element as one markdown
// block, for pasting into an AI assistant. Its label swaps through
// copying…/copied, so it holds a fixed width — the pill must not resize
// mid-interaction (the verdict slot next to it exists for the same reason).
const COPY_IDLE = "copy";
const copyIcon = icon("copy", 12);
const tooltipCopy = pillButton(
  "atx-tooltip-copy",
  COPY_IDLE,
  "Copy this element's HTML, CSS and source as context for an AI assistant",
  { minWidth: "86px" },
  copyIcon,
);
tooltipRow.append(tooltipLabel, tooltipOpen, tooltipCopy);

let copyResetTimer: number | null = null;

/** Back to the idle label, cancelling any pending flash. Runs on every
 *  highlight change too, so a "copied" never carries onto another element. */
function resetCopy(): void {
  if (copyResetTimer !== null) {
    clearTimeout(copyResetTimer);
    copyResetTimer = null;
  }
  tooltipCopy.disabled = false;
  setPillLabel(tooltipCopy, COPY_IDLE);
  setIcon(copyIcon, "copy", 12);
}

function flashCopy(label: string): void {
  setPillLabel(tooltipCopy, label);
  setIcon(copyIcon, "check", 12);
  copyResetTimer = window.setTimeout(resetCopy, 1200);
}

// Row 2: one chip per class + the id. Hovering a chip pops a rules card (see
// css-inspect.ts). Wraps within a cap; hidden when the element has neither.
const tooltipChips = styled("div", "atx-tooltip-chips", {
  display: "none",
  flexWrap: "wrap",
  gap: "4px",
  maxWidth: "340px",
  marginTop: "5px",
  paddingTop: "5px",
  whiteSpace: "normal",
  borderTop: "1px solid rgba(255,255,255,0.10)",
});

tooltip.append(tooltipRow, tooltipChips);

// --- Hover state -------------------------------------------------------------

// Set once by initHover. Notifies an observer (the element-tree panel) whenever
// the highlighted page element changes, so it can mirror the highlight onto its
// matching row (page → tree sync). Lives at module scope because clearHighlight
// — which also changes the target — is exported and runs outside initHover.
let onTargetCb: ((el: HTMLElement | null) => void) | null = null;

let highlighted: HTMLElement | null = null;
// Source of the currently-highlighted element, so the pill's "open" button
// knows what to open.
let highlightedSrc: SourceLoc | null = null;
// Grace timer: when the mouse leaves an element we wait briefly before hiding,
// so the user can travel up to the pill and click it without it vanishing. (#3)
let hideTimer: number | null = null;
// Switch timer: travelling from an element up to its pill often crosses a
// *different* annotated element (the parent, or a sibling the pill overlaps).
// Retargeting instantly would yank the pill away mid-travel, so a switch to a
// new element only lands after a short dwell; reaching the pill (or wandering
// back) cancels it. The first highlight is never delayed.
const SWITCH_DELAY = 150;
let switchTimer: number | null = null;
let switchTarget: HTMLElement | null = null;
// Verify dwell: the neutral pill upgrades to a server verdict only after the
// pointer has rested on one element this long — sweeping the mouse across the
// page must not fire a /classify per element crossed.
const VERIFY_DELAY = 500;
let verifyTimer: number | null = null;
// Monotonic token, bumped whenever the highlight changes or clears, so a
// /classify response that lands late can tell its element is no longer
// highlighted and must not repaint the pill.
let highlightSeq = 0;

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

function cancelSwitch(): void {
  if (switchTimer !== null) {
    clearTimeout(switchTimer);
    switchTimer = null;
  }
  switchTarget = null;
}

function cancelVerify(): void {
  if (verifyTimer !== null) {
    clearTimeout(verifyTimer);
    verifyTimer = null;
  }
}

// The rules card popped from a chip. On-demand (like a toast), never in the boot
// append list: at most one exists, rebuilt per chip hover and removed on leave.
let rulesCard: HTMLElement | null = null;
let cardHideTimer: number | null = null;

function cancelCardHide(): void {
  if (cardHideTimer !== null) {
    clearTimeout(cardHideTimer);
    cardHideTimer = null;
  }
}

function removeCard(): void {
  cancelCardHide();
  rulesCard?.remove();
  rulesCard = null;
}

function scheduleCardHide(): void {
  cancelCardHide();
  cardHideTimer = window.setTimeout(removeCard, 200);
}

export function clearHighlight(): void {
  cancelHide();
  cancelSwitch();
  cancelVerify();
  removeCard();
  resetCopy();
  highlightSeq++; // invalidate any /classify still in flight
  const had = highlighted;
  highlighted = null;
  highlightedSrc = null;
  outline.style.display = "none";
  tooltip.style.display = "none";
  if (had) onTargetCb?.(null);
}

// Keep the pill open while hovered. (#3)
tooltip.addEventListener("mouseenter", cancelHide);
tooltip.addEventListener("mouseleave", scheduleHide);

export interface HoverDeps {
  isEditMode(): boolean;
  openSource(src: SourceLoc): void;
  /** Open the in-browser source-peek panel for a loc. */
  openPeek(src: SourceLoc): void;
  /** Whether the CSS class/ID inspector is on — the chips row renders only then. */
  cssInspector(): boolean;
  /** Open a CSS rule's source file at (near) the rule in the editor. */
  openRule(file: string, selector: string): void;
  /** Gather the element's context and put it on the clipboard. Resolves true
   *  only when it actually landed there — a fallback panel or a failure
   *  resolves false, and the button returns to its idle label. */
  copyContext(el: HTMLElement, src: SourceLoc): Promise<boolean>;
  /** Notified whenever the highlighted element changes (element-tree sync). */
  onTarget?(el: HTMLElement | null): void;
}

/** What initHover hands back to the composition root: the DOM nodes to append,
 *  and a programmatic `highlight` so the element-tree panel can drive the same
 *  outline + verdict pill from a row hover (tree → page sync). */
export interface HoverHandle {
  elements: HTMLElement[];
  highlight(el: HTMLElement): void;
}

/** Wire the hover listeners; returns the elements for the boot code to append
 *  once the server health check passes, plus a programmatic highlight. */
export function initHover(deps: HoverDeps): HoverHandle {
  onTargetCb = deps.onTarget ?? null;
  const onHighlighted = (open: (src: SourceLoc) => void) => (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    if (highlightedSrc) open(highlightedSrc);
  };
  tooltipOpen.addEventListener("click", onHighlighted(deps.openSource));
  tooltipLabel.addEventListener("click", onHighlighted(deps.openPeek));

  tooltipCopy.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const el = highlighted;
    const src = highlightedSrc;
    if (!el || !src) return;
    // Gathering takes a /peek round-trip; hold the pill open across it. The
    // element and loc are captured up front, so the copy still completes if the
    // pointer wanders off and the highlight clears meanwhile.
    cancelHide();
    resetCopy();
    tooltipCopy.disabled = true;
    setPillLabel(tooltipCopy, "copying…");
    setIcon(copyIcon, "spinner", 12);
    void deps.copyContext(el, src).then((copied) => {
      tooltipCopy.disabled = false;
      if (copied) flashCopy("copied");
      else resetCopy();
    });
  });

  /** Sit the pill fully above the element, measured by its actual height (so the
   *  taller chips-row variant never overlaps the element). Only when there's no
   *  room above does it drop just below. The admin bar's strip counts as "no
   *  room" — a pill hidden under it is worse than one below the element. Must run
   *  after the pill's content is in place — including the chips — for
   *  offsetHeight to be right. */
  function positionPill(rect: DOMRect): void {
    const gap = 6;
    const inset = chromeInset();
    const minTop = inset.top + 4;
    const maxBottom = window.innerHeight - inset.bottom - 4;
    const above = rect.top - tooltip.offsetHeight - gap;
    const below = rect.bottom + gap;
    tooltip.style.left = `${Math.max(4, rect.left)}px`;
    const fitsBelow = below + tooltip.offsetHeight <= maxBottom;
    tooltip.style.top = `${above >= minTop ? above : fitsBelow ? below : minTop}px`;
  }

  /** Paint the outline + pill for `el` with the given verdict. */
  function render(el: HTMLElement, verdict: Verdict): void {
    const rect = el.getBoundingClientRect();

    Object.assign(outline.style, {
      display: "block",
      left: `${rect.left - 2}px`,
      top: `${rect.top - 2}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      borderColor: verdict.color,
      background: hexToRgba(verdict.color, 0.08),
    } as Partial<CSSStyleDeclaration>);

    const file = highlightedSrc?.file ?? "";
    const loc = highlightedSrc?.loc || "?";
    tooltipLoc.textContent = `${basename(file)}:${loc} · `;
    tooltipVerdict.textContent = verdict.word;
    tooltip.style.borderLeft = `3px solid ${verdict.color}`;
    tooltip.style.display = "flex";
    positionPill(rect);
  }

  /** Ask the server (through the cache) and, if the pointer is still on the
   *  same element, upgrade the neutral pill to the real verdict. */
  async function verify(el: HTMLElement, src: SourceLoc, seq: number): Promise<void> {
    let result: ClassifyResult;
    try {
      result = await classifyCached({ file: src.file, loc: src.loc, tag: el.tagName.toLowerCase() });
    } catch {
      return; // hover is passive — stay neutral; the click path surfaces errors
    }
    // The mouse may have moved on (or the highlight cleared) mid-round-trip.
    if (seq !== highlightSeq || highlighted !== el) return;
    // Chips stay put on a verdict upgrade — only the loc/verdict line repaints.
    render(el, verdictFor(result));
  }

  // --- Class/ID chips + rules card ------------------------------------------

  /** Place the card below its chip, flipping above / clamping to stay on-screen. */
  function positionCard(card: HTMLElement, anchor: HTMLElement): void {
    const r = anchor.getBoundingClientRect();
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    let left = Math.min(r.left, window.innerWidth - 8 - cw);
    left = Math.max(8, left);
    let top = r.bottom + 6;
    if (top + ch > window.innerHeight - 8) top = Math.max(8, r.top - 6 - ch);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  function showCard(anchor: HTMLElement, token: string, kind: "class" | "id", el: HTMLElement): void {
    removeCard();
    const selector = (kind === "class" ? "." : "#") + token;
    const card = buildRulesCard(selector, rulesForToken(el, token, kind), deps.openRule);
    card.addEventListener("mouseenter", () => {
      cancelHide();
      cancelCardHide();
    });
    card.addEventListener("mouseleave", () => {
      scheduleCardHide();
      scheduleHide();
    });
    document.body.append(card);
    positionCard(card, anchor);
    rulesCard = card;
  }

  function makeChip(label: string, token: string, kind: "class" | "id", el: HTMLElement): HTMLElement {
    const chip = styled("span", "atx-tooltip-chip", {
      font: `500 11px ${FONT.mono}`,
      color: "#c8c8e0",
      background: "rgba(255,255,255,0.09)",
      border: "1px solid transparent",
      borderRadius: "4px",
      padding: "1px 6px",
      cursor: "default",
    });
    chip.textContent = label;
    chip.title = `Show CSS applied via ${label}`;
    chip.addEventListener("mouseenter", () => {
      cancelHide();
      chip.style.borderColor = COLOR.accent;
      showCard(chip, token, kind, el);
    });
    chip.addEventListener("mouseleave", () => {
      chip.style.borderColor = "transparent";
      scheduleCardHide();
    });
    return chip;
  }

  /** Rebuild the chips row for `el` (classes, then id). Hidden when the
   *  inspector is off or the element has neither. Astro's scope class is noise. */
  function renderChips(el: HTMLElement): void {
    tooltipChips.replaceChildren();
    if (!deps.cssInspector()) {
      tooltipChips.style.display = "none";
      return;
    }
    const chips: HTMLElement[] = [];
    el.classList.forEach((c) => {
      if (/^astro-[\w-]+$/.test(c)) return; // Astro scoping class, not authored
      chips.push(makeChip(`.${c}`, c, "class", el));
    });
    if (el.id) chips.push(makeChip(`#${el.id}`, el.id, "id", el));
    if (chips.length === 0) {
      tooltipChips.style.display = "none";
      return;
    }
    tooltipChips.style.display = "flex";
    tooltipChips.append(...chips);
  }

  function highlight(el: HTMLElement): void {
    cancelSwitch();
    cancelVerify();
    removeCard(); // drop any card left over from the previous element
    resetCopy(); // a "copied ✓" belongs to the element it was clicked on
    if (!el.isConnected) return; // HMR may have replaced it during the dwell
    highlighted = el;
    onTargetCb?.(el); // mirror onto the element-tree row (page → tree)
    const src = sourceFor(el) ?? null;
    highlightedSrc = src;
    const seq = ++highlightSeq;

    // An already-verified element shows its verdict immediately; otherwise
    // render the neutral state and verify once the pointer has dwelled.
    const cached = src ? peekClassification({ file: src.file, loc: src.loc, tag: el.tagName.toLowerCase() }) : undefined;
    render(el, cached ? verdictFor(cached) : CHECKING);
    renderChips(el);
    // The chips row changes the pill's height — re-place it so it still clears
    // the element (render's placement used the pre-chips height).
    positionPill(el.getBoundingClientRect());
    if (!src || cached) return;
    verifyTimer = window.setTimeout(() => {
      verifyTimer = null;
      void verify(el, src, seq);
    }, VERIFY_DELAY);
  }

  function onMouseMove(e: MouseEvent): void {
    if (!deps.isEditMode()) return;
    // Moving onto any of our own overlay UI — the pill, the rules card, or the
    // element-tree panel driving highlights of its own — must NOT count as
    // leaving the element, and wins over any pending retarget. (The tree hovers
    // a row to highlight an element; that move must not then hide the pill.)
    if (e.target instanceof Element && e.target.closest('[data-astro-text-edit-ui="1"]')) {
      cancelHide();
      cancelCardHide();
      cancelSwitch();
      return;
    }
    const el = nearestSource(e.target);
    if (!el) {
      cancelSwitch();
      scheduleHide(); // grace period instead of instant hide
      return;
    }
    cancelHide();
    if (el === highlighted) {
      cancelSwitch(); // wandered back onto the current element
      return;
    }
    // First highlight lands instantly; a *switch* waits out the dwell so the
    // pill doesn't jump to the parent while the mouse travels up to it.
    if (highlighted === null) {
      highlight(el);
      return;
    }
    if (el === switchTarget) return; // countdown to this element already runs
    cancelSwitch();
    switchTarget = el;
    switchTimer = window.setTimeout(() => highlight(el), SWITCH_DELAY);
  }

  document.addEventListener("mousemove", onMouseMove, { passive: true });
  window.addEventListener("scroll", clearHighlight, { passive: true });

  return { elements: [outline, tooltip], highlight };
}
