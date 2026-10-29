import { describe, it, expect } from "vitest";
import {
  ETERNITY_BUDGET,
  ETERNITY_GESTURES,
  ETERNITY_GESTURE_NAMES,
  ETERNITY_INTERNAL_TARGETS,
  ETERNITY_STAGES,
  FAR_SHELL_MAX,
  FAR_SHELL_MIN,
  GOD_SCALE,
  eternityPlannedDrawCalls,
  eternityPlannedVisibleTris,
  isEternityGestureName,
  isEternityToolName,
  visitorSlots,
} from "./eternityLayout.js";

describe("eternityLayout", () => {
  it("the figure's scale makes him cosmic: ×170, ~323 units tall", () => {
    expect(GOD_SCALE).toBe(170);
    expect(323 / GOD_SCALE).toBeCloseTo(1.9, 1);
  });

  it("visitor slots are deterministic and in range: 12 slots, radii 190–450", () => {
    const a = visitorSlots();
    const b = visitorSlots();
    expect(a).toEqual(b);
    expect(a).toHaveLength(12);
    for (const s of a) {
      expect(s.radius).toBeGreaterThanOrEqual(190);
      expect(s.radius).toBeLessThanOrEqual(450);
      expect(s.height).toBeGreaterThanOrEqual(-110);
      expect(s.height).toBeLessThanOrEqual(190);
    }
  });

  it("the far colour lives on a shell the camera can never reach", () => {
    expect(FAR_SHELL_MIN).toBe(3800);
    expect(FAR_SHELL_MAX).toBe(4600);
    // The app's orbit (620) and the mockup's furthest stage (1560) both
    // sit far inside the shell.
    expect(ETERNITY_STAGES.threshold.pos[2]).toBeLessThan(FAR_SHELL_MIN);
  });

  it("every gesture has a personal line and a broadcast line", () => {
    expect(ETERNITY_GESTURE_NAMES).toEqual([
      "stillness",
      "regard",
      "blessing",
      "sorrow",
      "joy",
      "warning",
    ]);
    for (const name of ETERNITY_GESTURE_NAMES) {
      const g = ETERNITY_GESTURES[name];
      expect(g.personal.length).toBeGreaterThan(0);
      expect(g.broadcast.length).toBeGreaterThan(0);
      expect(g.personal).not.toBe(g.broadcast);
    }
    expect(isEternityGestureName("blessing")).toBe(true);
    expect(isEternityGestureName("smite")).toBe(false);
  });

  it("the tools are wonder / protection / reordering — destruction is out", () => {
    expect(isEternityToolName("reorder")).toBe(true);
    expect(isEternityToolName("part-veil")).toBe(true);
    expect(isEternityToolName("shield")).toBe(true);
    expect(isEternityToolName("comet")).toBe(true);
    expect(isEternityToolName("smite")).toBe(false);
  });

  it("the budget plan fits inside the internal targets", () => {
    expect(eternityPlannedDrawCalls()).toBeLessThanOrEqual(ETERNITY_INTERNAL_TARGETS.drawCalls);
    expect(eternityPlannedVisibleTris()).toBeLessThanOrEqual(ETERNITY_INTERNAL_TARGETS.visibleTris);
    expect(ETERNITY_INTERNAL_TARGETS.drawCalls).toBeLessThanOrEqual(ETERNITY_BUDGET.drawCalls);
    expect(ETERNITY_INTERNAL_TARGETS.visibleTris).toBeLessThanOrEqual(ETERNITY_BUDGET.visibleTris);
  });

  it("the speech tablet sits just below his chin, in front of his chest", () => {
    // god-local (0, 92, 48) — below the chin, never over his face.
    expect(ETERNITY_STAGES.presence.look[1]).toBe(74);
  });
});
