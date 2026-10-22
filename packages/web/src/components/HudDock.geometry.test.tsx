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
// the phone-portrait block (the LAST block of index.css) at the two
// phone viewports the pass is designed for, including the assertions
// Package B's suite lacked: fan-top vs the header band, gauge vs the
// camera ladder, legend vs the recenter FAB, stack vs the middle band,
// labels inside the safe frame. Safe-area insets are modelled as 0,
// the same convention as the gates above.

import {
  fanLayout,
  fanTopEdge,
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
  { w: 360, h: 640 },
];

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
  const stackBottom = hudVar("hud-cam-toggle-bottom"); // the low slot
  const stackTop = stackBottom + pxIn(stack, "max-height");

  it("docks in the low (below-noticing) slot with a phone cap", () => {
    expect(stack).toContain("bottom: calc(var(--hud-cam-toggle-bottom)");
    expect(pxIn(stack, "max-height")).toBeLessThan(hudVar("hud-status-max-h"));
  });
  it("stays in the lower half of the screen at both phone sizes", () => {
    for (const v of PHONE_VIEWS) {
      expect(stackTop, `stack top at ${v.w}×${v.h}`).toBeLessThanOrEqual(v.h / 2);
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
  // Gauge box: icon row + gap + tube; the meta lines live in the side
  // column INSIDE the tube's band, so the tube band is their superset.
  const gaugeBand = (viewH: number) => {
    const topPct = parseInt(/top:\s*(\d+)%/.exec(gauge)![1]!, 10);
    const tubeH = pxIn(tube, "height");
    const boxH = ICON_ROW + ROW_GAP + tubeH;
    const centreFromBottom = viewH - (topPct / 100) * viewH;
    const boxBottom = centreFromBottom - boxH / 2;
    return { tube: { lo: boxBottom, hi: boxBottom + tubeH }, box: { lo: boxBottom, hi: boxBottom + boxH } };
  };

  it("the tube is shortened and the meta lines move beside it (grid side column)", () => {
    expect(pxIn(tube, "height")).toBeLessThan(pxIn(ruleBody(".fuel-gauge .fg-tube"), "height"));
    expect(gauge).toContain("display: grid");
    expect(ruleBodyIn(phoneCss, ".fuel-gauge .fg-meta")).toContain("grid-column: 2");
  });
  it("the meta band clears the 🎯 and Views bands at both phone sizes", () => {
    const ladder: Array<[number, number]> = [
      [hudVar("hud-cam-views-bottom") - 8, hudVar("hud-cam-views-bottom") + CIRCLE + 8],
      [hudVar("hud-cam-focus-bottom") - 8, hudVar("hud-cam-focus-bottom") + 44 + 8],
    ];
    for (const v of PHONE_VIEWS) {
      const { tube: band } = gaugeBand(v.h);
      for (const [lo, hi] of ladder) {
        expect(
          band.hi <= lo || band.lo >= hi,
          `gauge tube band [${band.lo}, ${band.hi}] must clear ladder band [${lo}, ${hi}] at ${v.w}×${v.h}`,
        ).toBe(true);
      }
    }
  });
  it("the whole gauge clears the phone stack's band at both phone sizes", () => {
    const stackTop = hudVar("hud-cam-toggle-bottom") + pxIn(ruleBodyIn(phoneCss, ".ship-status-stack"), "max-height");
    for (const v of PHONE_VIEWS) {
      expect(gaugeBand(v.h).box.lo).toBeGreaterThanOrEqual(stackTop + 8);
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
