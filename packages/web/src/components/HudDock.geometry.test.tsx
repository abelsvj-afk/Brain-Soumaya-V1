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
