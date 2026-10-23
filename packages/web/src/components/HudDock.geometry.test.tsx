import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Package B (finding #6) — HUD dock geometry gates.
 *
 * No prior HUD test pins a viewport; these use the owner's phone size from
 * the screenshot findings, ~390×780. Layout here is CSS, so the gates read
 * the real stylesheet (comments stripped), resolve the shared HUD slot
 * variables, and assert the negotiated geometry numerically — the same
 * numbers a browser would lay out. If a future change reintroduces a
 * private fixed position or an overlapping slot, these fail.
 */

function readRepoFile(rel: string): string {
  const candidates = [
    resolve(process.cwd(), rel),
    resolve(process.cwd(), "packages/web", rel),
  ];
  for (const c of candidates) if (existsSync(c)) return readFileSync(c, "utf8");
  throw new Error(`cannot find ${rel}`);
}

const cssRaw = readRepoFile("src/index.css");
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, ""); // strip comments before parsing rules
const appSrc = readRepoFile("src/App.tsx");

/** Body of the FIRST rule for an exact selector (post comment-strip). */
function ruleBody(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`${esc}\\s*\\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`rule not found: ${selector}`);
  return m[1]!;
}

function hudVar(name: string): number {
  const m = new RegExp(`--${name}:\\s*(\\d+)`).exec(css);
  if (!m) throw new Error(`missing HUD variable --${name}`);
  return parseInt(m[1]!, 10);
}

function bottomPx(selector: string): number {
  const m = /bottom:\s*(-?\d+)px/.exec(ruleBody(selector));
  if (!m) throw new Error(`no px bottom in rule: ${selector}`);
  return parseInt(m[1]!, 10);
}

const VIEW_H = 780;
const CIRCLE = 46;

describe("HUD dock — z-ladder is consolidated and ordered", () => {
  it("defines one ladder: passive < camera < views < status < noticed", () => {
    expect(hudVar("hud-z-passive")).toBeLessThan(hudVar("hud-z-camera"));
    expect(hudVar("hud-z-camera")).toBeLessThan(hudVar("hud-z-views"));
    expect(hudVar("hud-z-views")).toBeLessThan(hudVar("hud-z-status"));
    expect(hudVar("hud-z-status")).toBeLessThan(hudVar("hud-z-noticed"));
  });
  it("every dock element takes its layer from the ladder, not a private constant", () => {
    expect(ruleBody(".streak-ember")).toContain("z-index: var(--hud-z-passive)");
    expect(ruleBody(".focus-cluster")).toContain("z-index: var(--hud-z-camera)");
    expect(ruleBody(".fab-focus-toggle")).toContain("z-index: var(--hud-z-camera)");
    expect(ruleBody(".gv-wrap")).toContain("z-index: var(--hud-z-views)");
    expect(ruleBody(".ship-status-stack")).toContain("z-index: var(--hud-z-status)");
    expect(ruleBody(".noticing-card")).toContain("z-index: var(--hud-z-noticed)");
  });
});

describe("HUD dock — left column slots at 390×780", () => {
  // The bottom-left column: corner FABs (unchanged) + the camera cluster.
  const slots = () => ({
    dock: { bottom: bottomPx(".fab-dock"), h: CIRCLE },
    recenter: { bottom: bottomPx(".fab-recenter"), h: CIRCLE },
    music: { bottom: bottomPx(".fab-music"), h: CIRCLE },
    focusToggle: { bottom: hudVar("hud-cam-toggle-bottom"), h: CIRCLE },
    views: { bottom: hudVar("hud-cam-views-bottom"), h: CIRCLE },
    focus: { bottom: hudVar("hud-cam-focus-bottom"), h: 44 },
  });

  it("no two circles in the column overlap (≥8px gaps on the ladder)", () => {
    const s = Object.entries(slots()).sort((a, b) => a[1].bottom - b[1].bottom);
    for (let i = 1; i < s.length; i++) {
      const [prevName, prev] = s[i - 1]!;
      const [name, cur] = s[i]!;
      expect(cur.bottom - (prev.bottom + prev.h), `${name} must clear ${prevName}`).toBeGreaterThanOrEqual(8);
    }
  });

  it("camera cluster order top→bottom is 🎯 → Views circle → focus toggle, above the corner FABs", () => {
    const s = slots();
    expect(s.focus.bottom).toBeGreaterThan(s.views.bottom);
    expect(s.views.bottom).toBeGreaterThan(s.focusToggle.bottom);
    expect(s.focusToggle.bottom).toBeGreaterThan(s.music.bottom + s.music.h);
  });

  it("every camera-cluster element anchors to the shared slot variables", () => {
    expect(ruleBody(".focus-cluster")).toContain("var(--hud-cam-focus-bottom)");
    expect(ruleBody(".gv-wrap")).toContain("var(--hud-cam-views-bottom)");
    expect(ruleBody(".fab-focus-toggle")).toContain("var(--hud-cam-toggle-bottom)");
    expect(ruleBody(".gv-wrap")).toContain("left: var(--hud-dock-left)");
    expect(ruleBody(".gv-toggle")).toContain("border-radius: 50%");
    expect(ruleBody(".gv-toggle")).toContain("width: 46px");
  });

  it("the fan's reserved column fits the viewport and touches nothing else in the dock", () => {
    const s = slots();
    // 7 possible fan items × 54px steps above the 🎯 (App.helpers focusItemStyle).
    const fanTop = s.focus.bottom + 7 * 54 + s.focus.h;
    expect(fanTop).toBeLessThanOrEqual(VIEW_H);
    // The fan's x-band is the camera column (left 14, width ≤46 → ends at 60);
    // the status stack starts right of it.
    expect(hudVar("hud-status-left")).toBeGreaterThanOrEqual(14 + CIRCLE);
    // While the fan is open the passive readouts in its path step aside…
    expect(css).toMatch(/\.focus-menu-open \.streak-ember/);
    expect(css).toMatch(/\.focus-menu-open \.fuel-gauge/);
    // …but the focus-mode toggle (below the 🎯, outside the fan's path) has
    // NO fade-out rule — the old burial must not come back.
    expect(css).not.toMatch(/\.focus-menu-open \.fab-focus-toggle\s*\{[^}]*opacity:\s*0/);
  });

  it("the focus-mode toggle is a real App element wired to focusMode (not orphan CSS)", () => {
    expect(appSrc).toContain("fab-focus-toggle");
    expect(appSrc).toMatch(/fab-focus-toggle[\s\S]{0,400}setFocusMode/);
  });
});

describe("HUD dock — ship-status stack", () => {
  it("is one anchored container with a negotiated max height", () => {
    const body = ruleBody(".ship-status-stack");
    expect(body).toContain("position: fixed");
    expect(body).toContain("left: calc(var(--hud-status-left)");
    expect(body).toContain("bottom: calc(var(--hud-status-bottom)");
    expect(body).toContain("max-height: var(--hud-status-max-h)");
    // Sits above the 🎯 slot with a gap, and its capped top stays on screen.
    const stackBottom = hudVar("hud-status-bottom");
    const focusTop = hudVar("hud-cam-focus-bottom") + 44;
    expect(stackBottom - focusTop).toBeGreaterThanOrEqual(8);
    expect(stackBottom + hudVar("hud-status-max-h")).toBeLessThanOrEqual(VIEW_H - 60);
  });

  it("the three readouts are in-flow lines of the stack — no private fixed positions", () => {
    for (const sel of [".beacon-readout", ".visitor-chip", ".audio-state-chip"]) {
      expect(ruleBody(sel), sel).not.toContain("position: fixed");
      expect(ruleBody(sel), sel).not.toMatch(/bottom:\s*\d+px/);
    }
    // Overflow policy: header + footer never shrink; the beacon body
    // shrinks/clips first instead of painting over a neighbour.
    expect(ruleBody(".visitor-chip")).toContain("flex: none");
    expect(ruleBody(".audio-state-chip")).toContain("flex: none");
    expect(ruleBody(".beacon-readout")).toContain("flex: 0 1 auto");
    expect(ruleBody(".beacon-readout")).toContain("overflow: hidden");
  });

  it("below-noticing coordination docks the stack in its low slot", () => {
    expect(ruleBody(".ship-status-stack.below-noticing")).toContain("var(--hud-cam-toggle-bottom)");
    expect(appSrc).toContain("belowNoticing={noticingOpen}");
  });

  it("App renders the stack in header → body → footer order", () => {
    const open = appSrc.indexOf("<ShipStatusStack");
    const close = appSrc.indexOf("</ShipStatusStack>");
    expect(open).toBeGreaterThan(-1);
    const inner = appSrc.slice(open, close);
    expect(inner.indexOf("VisitorChip")).toBeLessThan(inner.indexOf("BeaconReadout"));
    expect(inner.indexOf("BeaconReadout")).toBeLessThan(inner.indexOf("AudioStateChip"));
  });
});

describe("HUD dock — Views dropdown sheet", () => {
  it("opens into the reserved lower-left panel slot, never across the 🎯 or under the stack", () => {
    const sheet = ruleBody(".gv-sheet");
    const left = parseInt(/left:\s*(-?\d+)px/.exec(sheet)![1]!, 10);
    const bottomOff = parseInt(/bottom:\s*(-?\d+)px/.exec(sheet)![1]!, 10);
    const maxH = parseInt(/max-height:\s*(\d+)px/.exec(sheet)![1]!, 10);
    const viewsBottom = hudVar("hud-cam-views-bottom");
    // Sheet's screen-space box (its wrap is the Views circle's slot).
    const sheetLeft = 14 + left; // right of the 46px camera column
    const sheetBottom = viewsBottom + bottomOff;
    const sheetTop = sheetBottom + maxH;
    expect(sheetLeft).toBeGreaterThanOrEqual(14 + CIRCLE);
    expect(sheetBottom).toBeGreaterThanOrEqual(0);
    expect(sheetTop).toBeLessThanOrEqual(hudVar("hud-status-bottom") - 8); // never reaches the stack
    expect(sheetTop).toBeLessThanOrEqual(viewsBottom); // never rises across the circles above it
    // The sheet is below the stack in the ladder, and the stack is not in its box anyway.
    expect(hudVar("hud-z-views")).toBeLessThan(hudVar("hud-z-status"));
  });
});

// ── Mobile HUD layout pass (screenshot round 2) ─────────────────────────
//
// The gates above pin the ONE desktop ladder at 390×780. The round-2
// diagnosis proved the HUD had no phone layout at all — these gates pin
// the phone-portrait block (the LAST block of index.css) at the phone
// viewports the pass is designed for, including the assertions
// Package B's suite lacked: fan-top vs the header band, gauge vs the
// camera ladder, legend vs the recenter FAB, stack vs the middle band,
// labels inside the safe frame.
//
// PR #89 follow-up (trace: ~/workspace/ui-audit/pr89-review-trace-
// 2026-10-21.md): the first pass modelled safe-area insets as 0 — a
// device class that doesn't ship. The CSS anchors add
// env(safe-area-inset-bottom) (fan cluster, phone stack, the whole
// camera ladder) while window.innerHeight already includes the
// gesture strip, so every bottom-anchored guarantee below is now
// parameterized over insets {0, 16, 24, 34} (0 kept as the regression
// baseline) at 360×640, 390×780 (the owner's phone class — only 4px of
// fan slack at inset 0) and 390×844. The models DERIVE each element's
// inset behaviour from the stylesheet text (does its anchor carry the
// env term? does its cap shrink?), so an inset-blind tree fails these
// gates on the numbers, not on a modelling promise. The four elements
// the trace DISPROVED (Views sheet, legend, streak, dock ladder) are
// inset-invariant by construction — every anchor in each relation
// carries the same inset term, so their relative gaps cannot move —
// and their existing gates stand unchanged.

import {
  fanLayout,
  fanTopEdge,
  fanTargetCaption,
  FAN_CLUSTER_BOTTOM_PX,
  FAN_HEADER_BAND_PX,
} from "../App.helpers.js";
import { LABEL_SAFE_FRAME } from "../graph/labelFrame.js";

/** Body of the @media block whose prelude matches exactly (brace-matched). */
function mediaBlock(prelude: string): string {
  const start = css.indexOf(prelude);
  if (start < 0) throw new Error(`media block not found: ${prelude}`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated media block: ${prelude}`);
}

function ruleBodyIn(src: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`${esc}\\s*\\{([^}]*)\\}`).exec(src);
  if (!m) throw new Error(`rule not found: ${selector}`);
  return m[1]!;
}

function pxIn(body: string, prop: string): number {
  const m = new RegExp(`${prop}:\\s*(-?\\d+)px`).exec(body);
  if (!m) throw new Error(`no px ${prop} in rule: ${body.slice(0, 60)}`);
  return parseInt(m[1]!, 10);
}

// On the base tree there is no phone block at all: phoneCss stays empty
// and every Mobile HUD describe below fails on its own assertions, while
// the pre-existing gates in this file still run — that contrast is the
// falsification record for this pass.
let phoneCss = "";
try {
  phoneCss = mediaBlock("@media (max-width: 560px) and (orientation: portrait)");
} catch {
  phoneCss = "";
}
const PHONE_VIEWS = [
  { w: 390, h: 844 },
  { w: 390, h: 780 },
  { w: 360, h: 640 },
];
/** Bottom safe-area insets spanning real gesture hardware (Android
 *  gesture bar 16–24, iOS home indicator 34); 0 = the baseline. */
const INSETS = [0, 16, 24, 34];

/** The phone stack's TRUE geometry, derived from the stylesheet: its
 *  anchor is the low slot PLUS the inset, and its cap is either the
 *  flat px value (pre-fix tree — the model that broke) or the shrink
 *  formula min(cap, 50dvh − slot − inset) once the stylesheet carries
 *  it. Deriving both from the CSS text is what makes the parameterized
 *  gates below falsify the inset-blind tree. */
const phoneStackRule = (() => {
  try {
    return ruleBodyIn(phoneCss, ".ship-status-stack");
  } catch {
    return "";
  }
})();
const STACK_SLOT = hudVar("hud-cam-toggle-bottom"); // 186, the low slot
const stackCapBase = (() => {
  const m = /max-height:\s*min\((\d+)px/.exec(phoneStackRule) ?? /max-height:\s*(\d+)px/.exec(phoneStackRule);
  return m ? parseInt(m[1]!, 10) : 0;
})();
const stackCapShrinks =
  phoneStackRule.includes("50dvh") && phoneStackRule.includes("env(safe-area-inset-bottom");
const stackBottomAt = (inset: number) => STACK_SLOT + inset;
const stackCapAt = (viewH: number, inset: number) =>
  stackCapShrinks
    ? Math.min(stackCapBase, Math.floor(viewH / 2) - STACK_SLOT - inset)
    : stackCapBase;
const stackTopAt = (viewH: number, inset: number) => stackBottomAt(inset) + stackCapAt(viewH, inset);

describe("Mobile HUD — the phone-portrait block exists and is the pass's one breakpoint", () => {
  it("is present (on the base tree this whole section fails: no block exists)", () => {
    expect(phoneCss.length).toBeGreaterThan(0);
  });
  it("the JS fan geometry agrees with the stylesheet's cluster slot", () => {
    expect(FAN_CLUSTER_BOTTOM_PX).toBe(hudVar("hud-cam-focus-bottom"));
  });
  it("the label safe frame's header inset covers the fan's header band", () => {
    expect(LABEL_SAFE_FRAME.top).toBeGreaterThanOrEqual(FAN_HEADER_BAND_PX);
  });
});

describe("Mobile HUD — ship-status stack leaves the middle band (S1)", () => {
  const stack = ruleBodyIn(phoneCss, ".ship-status-stack");
  const stackBottom = STACK_SLOT; // the low slot (inset-0 anchor)

  it("docks in the low (below-noticing) slot with a phone cap", () => {
    expect(stack).toContain("bottom: calc(var(--hud-cam-toggle-bottom)");
    expect(pxIn(stack, "max-height")).toBeLessThan(hudVar("hud-status-max-h"));
  });
  it("its cap SHRINKS to the true available height instead of modelling the inset as 0", () => {
    // The formula the lower-half promise now stands on: min(132px,
    // 50dvh − slot − env(safe-area-inset-bottom)). On the pre-fix tree
    // the rule is a flat 132px and stackCapShrinks is false.
    expect(stackCapShrinks).toBe(true);
    expect(stackCapBase).toBe(132);
    // The owner's accepted worst case: 640px tall + 34px inset ⇒ ~100px.
    expect(stackCapAt(640, 34)).toBe(100);
    // Wherever the room allows, the full 132 still binds.
    expect(stackCapAt(844, 0)).toBe(132);
    expect(stackCapAt(780, 24)).toBe(132);
  });
  it("stays in the lower half of the screen at every phone size × inset", () => {
    for (const v of PHONE_VIEWS) {
      for (const inset of INSETS) {
        expect(
          stackTopAt(v.h, inset),
          `stack top at ${v.w}×${v.h} inset ${inset}`,
        ).toBeLessThanOrEqual(v.h / 2);
      }
    }
  });
  it("clears the right rail: left + width stops before the rail's band", () => {
    const reserve = parseInt(/100vw - (\d+)px/.exec(stack)![1]!, 10);
    for (const v of PHONE_VIEWS) {
      const width = Math.min(v.w - reserve, 340);
      const rightEdge = hudVar("hud-status-left") + width;
      expect(rightEdge, `stack right edge at ${v.w} wide`).toBeLessThanOrEqual(v.w - 60 - 8);
    }
  });
  it("the Views sheet shrinks below the stack's new band (coordination, item 1→2)", () => {
    const sheet = ruleBodyIn(phoneCss, ".gv-sheet");
    const sheetBottomEdge = hudVar("hud-cam-views-bottom") + pxIn(ruleBody(".gv-sheet"), "bottom");
    const sheetTop = sheetBottomEdge + pxIn(sheet, "max-height");
    expect(sheetTop).toBeLessThanOrEqual(stackBottom - 8);
  });
});

describe("Mobile HUD — stack overflow contract under the shrunken cap (PR #89 follow-up)", () => {
  // The owner's acceptance terms for the shrinking cap: priority is
  // preserved, nothing overlaps, no control is clipped into
  // inaccessibility, and essential status is never silently hidden.
  // The contract is structural (CSS yield order) + one numeric floor.
  it("the yield order is wired in CSS: targets yield first, hint second, head/chip/pill never", () => {
    // 1 — the beacon TARGETS are the yielding element.
    const targets = ruleBody(".beacon-readout-targets");
    expect(targets).toContain("flex: 0 1 auto");
    expect(targets).toContain("min-height: 0");
    expect(targets).toContain("overflow: hidden");
    // On phones the yield is a whole-line clamp with its ellipsis —
    // truncation is MARKED, never a silent mid-glyph slice.
    expect(ruleBodyIn(phoneCss, ".beacon-readout-targets")).toContain("-webkit-line-clamp: 2");
    // 2 — the HINT yields next, ellipsized on a single line.
    expect(ruleBodyIn(phoneCss, ".beacon-readout-hint")).toContain("text-overflow: ellipsis");
    // 3 — the readout HEAD (highest-priority status) never shrinks…
    expect(ruleBody(".beacon-readout-head")).toContain("flex: none");
    // …and neither do the stack's header chip or footer pill
    // (Package B's discipline, restated here because the contract
    // depends on it: the sounds pill stays whole and tappable).
    expect(ruleBody(".visitor-chip")).toContain("flex: none");
    expect(ruleBody(".audio-state-chip")).toContain("flex: none");
  });

  it("at the worst grid point the essential lines still fit whole inside the shrunken cap", () => {
    // Priority floor, modelled from the stylesheet's own metrics
    // (16px rem; line-height at 1.3× font-size — the upper end of
    // 'normal' for the system sans stack): visitor chip (7+7 padding
    // + 2 border + 0.72rem line ≈ 31) + two stack gaps (12) + the
    // footer pill (6+6 + 2 + 0.68rem line ≈ 29) + the readout's head
    // line with its top padding (8 + 0.72rem line ≈ 23) = 95px of
    // never-yielding content. The shrunken cap at 640×34 is 100px —
    // the head text, chip and pill all fit WHOLE; only the targets
    // and hint ever yield. (Targets+hint fully expanded would take
    // ~154px — over every phone cap — which is exactly why the yield
    // order above exists.)
    const line = (rem: number) => Math.ceil(rem * 16 * 1.3);
    const essential =
      (7 + 7 + 2 + line(0.72)) + // visitor chip
      12 + // two stack gaps
      (6 + 6 + 2 + line(0.68)) + // audio pill
      (8 + line(0.72)); // readout top padding + head line
    expect(essential).toBeLessThanOrEqual(stackCapAt(640, 34));
  });
});

describe("Mobile HUD — fan top vs the header band (S3, the assertion Package B lacked)", () => {
  it("at 390×844 all 7 targets fit compressed, top item clear of the header", () => {
    const l = fanLayout(390, 844, 7);
    expect(l.step).toBe(46);
    expect(l.folded).toBe(false);
    expect(fanTopEdge(l)).toBeLessThanOrEqual(844 - FAN_HEADER_BAND_PX);
  });
  it("at 360×640 the fan folds and its highest slot still clears the header", () => {
    const l = fanLayout(360, 640, 7);
    expect(l.folded).toBe(true);
    expect(fanTopEdge(l)).toBeLessThanOrEqual(640 - FAN_HEADER_BAND_PX);
  });
  it("off phones the fan is untouched: desktop step, no fold", () => {
    const l = fanLayout(1440, 900, 7);
    expect(l.step).toBe(54);
    expect(l.folded).toBe(false);
  });
  it("inset-parameterized: the model's top edge IS the device's top edge, and it clears the header at every size × inset", () => {
    // Truth, from the stylesheet: the cluster anchor is slot + inset
    // (index.css .focus-cluster carries env(safe-area-inset-bottom)),
    // and the fan rises slots×step + item above it. The model must
    // reproduce that edge exactly — on the pre-fix tree fanLayout
    // ignores the inset argument, so at every nonzero inset its edge
    // sits one inset BELOW the truth (and the truth breaks the band
    // at 640–800px heights: the trace's Finding 1 table).
    for (const v of PHONE_VIEWS) {
      for (const inset of INSETS) {
        const l = fanLayout(v.w, v.h, 7, inset);
        const slots = l.folded ? l.capacity : l.pageSize;
        const truth = FAN_CLUSTER_BOTTOM_PX + inset + slots * l.step + CIRCLE;
        expect(fanTopEdge(l), `model edge at ${v.w}×${v.h} inset ${inset}`).toBe(truth);
        expect(truth, `true top edge at ${v.w}×${v.h} inset ${inset}`).toBeLessThanOrEqual(
          v.h - FAN_HEADER_BAND_PX,
        );
      }
    }
  });
  it("the owner's 390×780: a 24px gesture inset is what creates the fold (capacity 7 → 6)", () => {
    expect(fanLayout(390, 780, 7, 0).folded).toBe(false);
    const l = fanLayout(390, 780, 7, 24);
    expect(l.folded).toBe(true);
    expect(l.capacity).toBe(6);
    expect(fanTopEdge(l)).toBeLessThanOrEqual(780 - FAN_HEADER_BAND_PX);
  });
});

describe("Mobile HUD — MindSpace legend has a dock slot (S4)", () => {
  it("starts right of the recenter FAB's column, with clearance", () => {
    const legend = ruleBodyIn(phoneCss, ".mindspace-legend");
    const left = pxIn(legend, "left");
    // FAB column: left 14 + 46px circle = 60; the legend must clear it.
    expect(left).toBeGreaterThanOrEqual(14 + CIRCLE + 8);
  });
  it("its band never meets the phone stack's band", () => {
    const legendBottom = pxIn(ruleBody(".mindspace-legend"), "bottom");
    const stackBottom = hudVar("hud-cam-toggle-bottom");
    expect(legendBottom + 30).toBeLessThanOrEqual(stackBottom - 8); // ~30px pill
  });
});

describe("Mobile HUD — fuel gauge vs the camera ladder (S5)", () => {
  const gauge = ruleBodyIn(phoneCss, ".fuel-gauge");
  const tube = ruleBodyIn(phoneCss, ".fuel-gauge .fg-tube");
  const ICON_ROW = 18;
  const ROW_GAP = 2;
  // Whether the stylesheet COMPENSATES the gauge's anchor for the
  // bottom inset (PR #89 follow-up): the gauge hangs from the top and
  // does not ride the inset; the camera ladder does (+inset on every
  // anchor). Without the compensation term the ladder re-enters the
  // gauge's band at 360×640 from inset ≥21 (trace sweep); with it, the
  // gauge rises exactly with the ladder and holds its band. Derived
  // from the CSS text so the pre-fix tree fails on the numbers.
  const gaugeCompensated = /top:\s*calc\(\d+%\s*-\s*env\(safe-area-inset-bottom/.test(gauge);
  // Gauge box: icon row + gap + tube; the meta lines live in the side
  // column INSIDE the tube's band, so the tube band is their superset.
  const gaugeBand = (viewH: number, inset = 0) => {
    const topPct = parseInt(/top:\s*(?:calc\()?(\d+)%/.exec(gauge)![1]!, 10);
    const tubeH = pxIn(tube, "height");
    const boxH = ICON_ROW + ROW_GAP + tubeH;
    const centreFromBottom = viewH - (topPct / 100) * viewH + (gaugeCompensated ? inset : 0);
    const boxBottom = centreFromBottom - boxH / 2;
    return { tube: { lo: boxBottom, hi: boxBottom + tubeH }, box: { lo: boxBottom, hi: boxBottom + boxH } };
  };

  it("the tube is shortened and the meta lines move beside it (grid side column)", () => {
    expect(pxIn(tube, "height")).toBeLessThan(pxIn(ruleBody(".fuel-gauge .fg-tube"), "height"));
    expect(gauge).toContain("display: grid");
    expect(ruleBodyIn(phoneCss, ".fuel-gauge .fg-meta")).toContain("grid-column: 2");
  });
  it("the gauge's anchor compensates the bottom inset so it holds its band as the ladder rides up", () => {
    expect(gaugeCompensated).toBe(true);
  });
  it("the meta band clears the full 🎯 and Views bands at every phone size × inset (incl. 360×640 at 24 and 34)", () => {
    // The FULL ladder bands (the circles' own boxes ± the 8px gate
    // padding), each shifted +inset — every ladder anchor carries
    // env(safe-area-inset-bottom), so the whole ladder rides up.
    for (const v of PHONE_VIEWS) {
      for (const inset of INSETS) {
        const ladder: Array<[number, number]> = [
          [hudVar("hud-cam-views-bottom") - 8 + inset, hudVar("hud-cam-views-bottom") + CIRCLE + 8 + inset],
          [hudVar("hud-cam-focus-bottom") - 8 + inset, hudVar("hud-cam-focus-bottom") + 44 + 8 + inset],
        ];
        const { tube: band } = gaugeBand(v.h, inset);
        for (const [lo, hi] of ladder) {
          expect(
            band.hi <= lo || band.lo >= hi,
            `gauge tube band [${band.lo}, ${band.hi}] must clear ladder band [${lo}, ${hi}] at ${v.w}×${v.h} inset ${inset}`,
          ).toBe(true);
        }
      }
    }
  });
  it("the whole gauge clears the phone stack's band at every phone size × inset", () => {
    for (const v of PHONE_VIEWS) {
      for (const inset of INSETS) {
        expect(
          gaugeBand(v.h, inset).box.lo,
          `gauge bottom at ${v.w}×${v.h} inset ${inset}`,
        ).toBeGreaterThanOrEqual(stackTopAt(v.h, inset) + 8);
      }
    }
  });
});

describe("Mobile HUD — streak ember leaves the mid-left band (S7)", () => {
  const streak = ruleBodyIn(phoneCss, ".streak-ember");
  it("becomes a horizontal chip in the header row, top-right", () => {
    expect(streak).toContain("flex-direction: row");
    expect(streak).toContain("left: auto");
    expect(streak).toMatch(/right:\s*calc\(/);
  });
  it("clears the toolbox FAB above it and stays out of the vertical middle", () => {
    const top = parseInt(/top:\s*calc\((\d+)px/.exec(streak)![1]!, 10);
    const toolsBottom = pxIn(ruleBody(".fab-tools"), "top") + CIRCLE;
    expect(top).toBeGreaterThanOrEqual(toolsBottom + 8);
    for (const v of PHONE_VIEWS) {
      expect((top + 24) / v.h).toBeLessThanOrEqual(0.25); // chip ≈24px tall
    }
  });
});

// ── Component-level gates ────────────────────────────────────────────────

vi.mock("../api/lenses.js", () => ({
  createLens: vi.fn().mockResolvedValue(null),
  getLenses: vi.fn().mockResolvedValue([]),
  lensNodes: vi.fn().mockResolvedValue([]),
}));
vi.mock("../api/finance.js", () => ({ getMoneySky: vi.fn().mockResolvedValue([]) }));
vi.mock("../api/journeys.js", () => ({ getJourneys: vi.fn().mockResolvedValue([]) }));
vi.mock("../api/client.js", () => ({ getSpaceId: () => "hud-dock-test" }));
vi.mock("./Toasts.js", () => ({ pushToast: vi.fn() }));

import { BeaconReadout, ShipStatusStack } from "./GalaxyHud.js";
import { GalaxyViews } from "./GalaxyViews.js";
import type { GraphNode } from "@brain/shared";

afterEach(() => cleanup());
beforeEach(() => {
  localStorage.setItem("brain.viewsSeen.hud-dock-test", "1");
});

describe("ShipStatusStack component", () => {
  it("renders header/body/footer children in order inside one container", () => {
    const { container } = render(
      <ShipStatusStack>
        <div>header</div>
        <div>body</div>
        <div>footer</div>
      </ShipStatusStack>,
    );
    const stack = container.querySelector(".ship-status-stack")!;
    expect(stack).not.toBeNull();
    expect([...stack.children].map((c) => c.textContent)).toEqual(["header", "body", "footer"]);
  });
  it("applies the below-noticing slot only when the noticed card is up", () => {
    const { container, rerender } = render(<ShipStatusStack belowNoticing={false}><div>x</div></ShipStatusStack>);
    expect(container.querySelector(".ship-status-stack.below-noticing")).toBeNull();
    rerender(<ShipStatusStack belowNoticing><div>x</div></ShipStatusStack>);
    expect(container.querySelector(".ship-status-stack.below-noticing")).not.toBeNull();
  });
});

describe("BeaconReadout headline dedupe (finding #6)", () => {
  it("says the dispatching fact ONCE when the detail already carries it", () => {
    const { container } = render(
      <BeaconReadout status={{ beacon: { active: true, detail: "Dispatching 1…", targets: [], pending: 1 } }} />,
    );
    expect((container.textContent!.match(/dispatching/gi) ?? []).length).toBe(1);
  });
  it("still appends the pending count when the detail doesn't mention dispatching", () => {
    render(
      <BeaconReadout status={{ beacon: { active: true, detail: "1 warming a memory", targets: [], pending: 2 } }} />,
    );
    expect(screen.getByText(/dispatching 2/)).toBeTruthy();
  });
});

describe("GalaxyViews circle + sheet", () => {
  const node = { id: 1, label: "goal 1", type: "concept", kind: "goal", content: "", createdAt: "2026-01-01T00:00:00Z" } as GraphNode;
  it("the toggle is a labelled circle; opening shows the chips inside the sheet, inside the wrap", () => {
    const { container } = render(<GalaxyViews nodes={[node]} activeView={null} onOpen={vi.fn()} onExit={vi.fn()} />);
    const toggle = screen.getByRole("button", { name: /Galaxy views/ });
    expect(toggle.classList.contains("gv-toggle")).toBe(true);
    expect(toggle.textContent).toContain("Views");
    fireEvent.click(toggle);
    const sheet = container.querySelector(".gv-wrap .gv-sheet");
    expect(sheet).not.toBeNull();
    expect(sheet!.querySelector(".gv-chips")).not.toBeNull();
  });
});

// ── HUD round 3 — summonable stack + button captions ────────────────────
//
// The owner's round-3 directives: the ship-status stack becomes a button
// he can bring up (collapsed = a one-line mini-bar on the same anchor),
// and every HUD button carries its name INSIDE its 46×46 footprint. The
// design's wager is that captions cost NO geometry — so the headline
// gate is that every assertion above passes UNMODIFIED (this section
// only appends), and the new gates pin the captions' presence, the one
// pulsing caption, and BOTH stack states over the follow-up's inset grid.

describe("HUD round 3 — captions live inside the footprint (source gate)", () => {
  it("the caption size is one pinned var; .fab is a column; no ladder slot moved", () => {
    expect(css).toContain("--hud-cap-size: 9.5px");
    expect(ruleBody(".fab-cap")).toContain("font-size: var(--hud-cap-size)");
    expect(ruleBody(".fab")).toContain("flex-direction: column");
    // The slots every gate above stands on are exactly where Package B
    // and the mobile pass left them — captions spent no geometry.
    expect(hudVar("hud-cam-toggle-bottom")).toBe(186);
    expect(hudVar("hud-cam-views-bottom")).toBe(242);
    expect(hudVar("hud-cam-focus-bottom")).toBe(298);
    expect(hudVar("hud-status-bottom")).toBe(354);
    expect(hudVar("hud-status-max-h")).toBe(196);
  });

  it("exactly one caption pulses — the 🎯's", () => {
    expect(css).toMatch(/\.focus-main \.fab-cap\s*\{[^}]*animation: cappulse/);
    expect((css.match(/animation: cappulse/g) ?? []).length).toBe(1);
    expect(ruleBody(".fab-cap")).not.toContain("animation");
  });

  it("every inventoried rail/menu button carries its caption", () => {
    const nav = readRepoFile("src/components/NavRail.tsx");
    for (const cap of ["Panels", "Recenter", "Zoom +", "Zoom −"]) {
      expect(nav, `NavRail caption ${cap}`).toContain(`fab-cap">${cap}`);
    }
    const actions = readRepoFile("src/components/ActionRail.tsx");
    for (const cap of ["Add", "Home", "Chat", "Settings"]) {
      expect(actions, `ActionRail caption ${cap}`).toContain(`fab-cap">${cap}`);
    }
    expect(readRepoFile("src/components/ToolsMenu.tsx")).toContain('fab-cap">Tools');
    expect(readRepoFile("src/components/NoticingCard.tsx")).toContain('fab-cap">Notices');
  });

  it("the Views caption is un-hidden: same span, dual class, clip rule gone", () => {
    expect(readRepoFile("src/components/GalaxyViews.tsx")).toContain("gv-toggle-text fab-cap");
    expect(css).not.toMatch(/\.gv-toggle-text\s*\{[^}]*width: 1px/);
    expect(ruleBody(".gv-toggle")).toContain("flex-direction: column");
    expect(ruleBody(".gv-toggle")).toContain("border-radius: 50%");
    expect(ruleBody(".gv-toggle")).toContain("width: 46px");
  });

  it("App's own buttons carry captions: focus toggle, fan items, fan-more, 🎯, music", () => {
    const win = (from: string, len: number) => {
      const a = appSrc.indexOf(from);
      expect(a, `anchor ${from}`).toBeGreaterThan(-1);
      return appSrc.slice(a, a + len);
    };
    // GH-06 (Batch B): the 🌌 toggle's caption is "Calm" — "Focus" belongs
    // to the 🎯 fan alone (asserted separately below).
    expect(win("fab-focus-toggle", 1000)).toContain('fab-cap">Calm');
    expect(win("className={t.className}", 400)).toContain("{t.caption}");
    expect(win("fan-more", 700)).toContain("fab-cap");
    // The 🎯's caption is "Focus" (OC-1) — asserted by its exact text so
    // the neighbouring Music caption cannot false-pass this window.
    expect(win("focus-main", 1400)).toContain('fab-cap">Focus');
    expect(win("fab-music", 900)).toContain('fab-cap">Music');
    expect(win("<ShipStatusStack", 300)).toContain("onToggle");
  });
});

describe("HUD round 3 — fan captions follow the space's own name", () => {
  it("the ship caption is whatever the brain's maker named it — never hardcoded", () => {
    expect(fanTargetCaption("ship", "Zephyr")).toBe("Zephyr");
    expect(fanTargetCaption("ship", "Mama's Brain")).toBe("Mama's Brain");
    expect(fanTargetCaption("ship", "Zephyr")).not.toBe("Soumaya");
  });
  it("an unnamed space falls back to the same default name App itself uses", () => {
    expect(fanTargetCaption("ship", null)).toBe("Soumaya");
    expect(fanTargetCaption("ship", undefined)).toBe("Soumaya");
    expect(fanTargetCaption("ship")).toBe("Soumaya");
  });
  it("the fixed targets caption by their job", () => {
    expect(fanTargetCaption("station")).toBe("Station");
    expect(fanTargetCaption("fleet")).toBe("Fleet");
    expect(fanTargetCaption("satellite")).toBe("Beacon");
    expect(fanTargetCaption("visitor")).toBe("Visitor");
    expect(fanTargetCaption("fig1")).toBe("Figurine");
    expect(fanTargetCaption("fig2")).toBe("Figurine");
    expect(fanTargetCaption("more")).toBe("More");
  });
  it("App wires the ship caption from the live space name, not a literal", () => {
    expect(appSrc).toContain('fanTargetCaption("ship", space?.name)');
  });
});

describe("HUD round 3 — both stack states over the inset grid", () => {
  const MINI_H = 34; // --hud-status-mini-h

  it("the mini-bar's height is a pinned var and the bar mirrors the stack's own anchors", () => {
    expect(hudVar("hud-status-mini-h")).toBe(MINI_H);
    const mini = ruleBody(".ship-status-mini");
    expect(mini).toContain("bottom: calc(var(--hud-status-bottom)");
    expect(mini).toContain("height: var(--hud-status-mini-h)");
    expect(mini).toContain("z-index: var(--hud-z-status)");
    const phoneMini = ruleBodyIn(phoneCss, ".ship-status-mini");
    expect(phoneMini).toContain("bottom: calc(var(--hud-cam-toggle-bottom)");
    expect(phoneMini).toContain("100vw - 140px"); // the stack's own right-rail reserve
  });

  it("the collapsed band stays in the lower half at every phone size × inset", () => {
    for (const v of PHONE_VIEWS) {
      for (const inset of INSETS) {
        const collapsedTop = STACK_SLOT + inset + MINI_H;
        expect(
          collapsedTop,
          `collapsed top at ${v.w}×${v.h} inset ${inset}`,
        ).toBeLessThanOrEqual(v.h / 2);
        // Collapsed is strictly below the expanded top at every grid
        // point: summoning only ever frees screen. (The gauge describes
        // above assert against stackTopAt — the EXPANDED, worst-case
        // state — unchanged.)
        expect(collapsedTop).toBeLessThan(stackTopAt(v.h, inset));
      }
    }
    // The note's sharpest case: at 640 + a 34px inset the expanded cap
    // reaches the midline (stackTopAt = 320) while the collapsed top is
    // 254 — the collapsed form is inset-proof where the expanded is not.
    expect(stackTopAt(640, 34)).toBe(320);
    expect(STACK_SLOT + 34 + MINI_H).toBe(254);
  });

  it("the freed height is cap minus one line: 98px on phones, 162px on desktop", () => {
    expect(stackCapAt(844, 0) - MINI_H).toBe(98);
    expect(stackCapAt(640, 34) - MINI_H).toBe(66); // even the shrunken cap frees two-thirds
    expect(hudVar("hud-status-max-h") - MINI_H).toBe(162);
  });
});
