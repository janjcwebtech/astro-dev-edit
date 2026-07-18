import type { ClassifyResult, SourceLoc } from "../shared/protocol.ts";
import { classifyCached, peekClassification } from "./classify-cache.ts";
import { nearestSource, sourceFor } from "./source-map.ts";
import { COLOR, FONT, Z, basename, hexToRgba, styled } from "./ui.ts";

/**
 * Hover behaviour: the outline that tracks the hovered source-mapped element
 * and the interactive tooltip pill (file:loc · verdict, plus an "open ↗"
 * button). Hover state is self-contained here — it never interacts with the
 * editing slot in state.ts.
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
    background: "rgba(124, 92, 255, 0.08)",
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
    whiteSpace: "nowrap",
    cursor: "default",
  },
  "atx-tooltip",
);

// The label is clickable like the button — the whole file:loc line jumps to
// the source. (#3)
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
tooltipLabel.title = "Open this location in your editor";
tooltipLabel.addEventListener("mouseenter", () => (tooltipLabel.style.textDecoration = "underline"));
tooltipLabel.addEventListener("mouseleave", () => (tooltipLabel.style.textDecoration = "none"));
const tooltipOpen = styled("button", "atx-tooltip-open", {
  marginLeft: "8px",
  padding: "2px 7px",
  font: `600 11px ${FONT.ui}`,
  color: "#fff",
  background: "rgba(255,255,255,0.14)",
  border: "none",
  borderRadius: "4px",
  cursor: "pointer",
});
tooltipOpen.type = "button";
tooltipOpen.textContent = "open ↗";
tooltipOpen.title = "Open this location in your editor";
tooltipOpen.addEventListener("mouseenter", () => (tooltipOpen.style.background = "rgba(255,255,255,0.28)"));
tooltipOpen.addEventListener("mouseleave", () => (tooltipOpen.style.background = "rgba(255,255,255,0.14)"));
tooltip.append(tooltipLabel, tooltipOpen);

// --- Hover state -------------------------------------------------------------

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

export function clearHighlight(): void {
  cancelHide();
  cancelSwitch();
  cancelVerify();
  highlightSeq++; // invalidate any /classify still in flight
  highlighted = null;
  highlightedSrc = null;
  outline.style.display = "none";
  tooltip.style.display = "none";
}

// Keep the pill open while hovered. (#3)
tooltip.addEventListener("mouseenter", cancelHide);
tooltip.addEventListener("mouseleave", scheduleHide);

export interface HoverDeps {
  isEditMode(): boolean;
  openSource(src: SourceLoc): void;
}

/** Wire the hover listeners; returns the elements for the boot code to append
 *  once the server health check passes. */
export function initHover(deps: HoverDeps): HTMLElement[] {
  const openHighlighted = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    if (highlightedSrc) deps.openSource(highlightedSrc);
  };
  tooltipOpen.addEventListener("click", openHighlighted);
  tooltipLabel.addEventListener("click", openHighlighted);

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
    tooltip.style.display = "block";
    // Prefer above the element; if there's no room, sit just below it. Add a
    // little vertical overlap so travelling from element to pill doesn't cross
    // a dead gap that would trigger the hide.
    const top = rect.top - 28 < 4 ? rect.bottom + 4 : rect.top - 28;
    tooltip.style.left = `${Math.max(4, rect.left)}px`;
    tooltip.style.top = `${top}px`;
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
    render(el, verdictFor(result));
  }

  function highlight(el: HTMLElement): void {
    cancelSwitch();
    cancelVerify();
    if (!el.isConnected) return; // HMR may have replaced it during the dwell
    highlighted = el;
    const src = sourceFor(el) ?? null;
    highlightedSrc = src;
    const seq = ++highlightSeq;

    // An already-verified element shows its verdict immediately; otherwise
    // render the neutral state and verify once the pointer has dwelled.
    const cached = src ? peekClassification({ file: src.file, loc: src.loc, tag: el.tagName.toLowerCase() }) : undefined;
    render(el, cached ? verdictFor(cached) : CHECKING);
    if (!src || cached) return;
    verifyTimer = window.setTimeout(() => {
      verifyTimer = null;
      void verify(el, src, seq);
    }, VERIFY_DELAY);
  }

  function onMouseMove(e: MouseEvent): void {
    if (!deps.isEditMode()) return;
    // Moving onto our own pill must NOT count as leaving the element — and it
    // wins over any pending retarget.
    if (e.target instanceof Node && tooltip.contains(e.target)) {
      cancelHide();
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

  return [outline, tooltip];
}
