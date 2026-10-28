import { describe, it, expect } from "vitest";
import {
  ANIMATION_INVENTORY,
  PHASE_4_ANIMATION_IDS,
  animationById,
  phase4Animations,
} from "./animationInventory.js";

/**
 * Animation inventory gate (§14.1): an entry counts as gate-passed only
 * when every field is filled — trigger · actors · what moves and how ·
 * duration class · reduced-motion equivalent · cost class · user control.
 * The Phase 4 entries must match the reviewed inventory doc exactly
 * (A6/A7/A8/A23/A24/A25/A26).
 */

const DURATION_CLASSES = ["moment", "sequence", "journey", "ambient"] as const;
const COST_CLASSES = ["cheap", "moderate", "heavy", "cheap-moderate"] as const;
const STATUSES = ["seeded", "exists", "phase-4", "built"] as const;

describe("animation inventory (§14.1 gate)", () => {
  it("covers A1–A26 exactly once each, in order", () => {
    expect(ANIMATION_INVENTORY).toHaveLength(26);
    expect(ANIMATION_INVENTORY.map((e) => e.id)).toEqual(
      Array.from({ length: 26 }, (_, i) => `A${i + 1}`),
    );
  });

  it("every entry carries all seven §14.1 fields, filled", () => {
    for (const e of ANIMATION_INVENTORY) {
      expect(e.trigger.trim().length, `${e.id} trigger`).toBeGreaterThan(0);
      expect(e.actors.trim().length, `${e.id} actors`).toBeGreaterThan(0);
      expect(e.moves.trim().length, `${e.id} moves`).toBeGreaterThan(0);
      expect(DURATION_CLASSES, `${e.id} durationClass`).toContain(e.durationClass);
      expect(e.reducedMotion.trim().length, `${e.id} reducedMotion`).toBeGreaterThan(0);
      expect(COST_CLASSES, `${e.id} costClass`).toContain(e.costClass);
      expect(e.control.trim().length, `${e.id} control`).toBeGreaterThan(0);
      expect(STATUSES, `${e.id} status`).toContain(e.status);
    }
  });

  it("Phase 4 entries match the reviewed doc (A6/A7/A8/A23/A24/A25/A26)", () => {
    expect([...PHASE_4_ANIMATION_IDS]).toEqual(["A6", "A7", "A8", "A23", "A24", "A25", "A26"]);
    const byId = new Map(ANIMATION_INVENTORY.map((e) => [e.id, e]));
    // Duration classes per the reviewed inventory.
    expect(byId.get("A6")?.durationClass).toBe("sequence"); // ~8s
    expect(byId.get("A7")?.durationClass).toBe("sequence"); // ~4s
    expect(byId.get("A8")?.durationClass).toBe("sequence"); // crossfade
    expect(byId.get("A23")?.durationClass).toBe("ambient"); // continuous while pending
    expect(byId.get("A24")?.durationClass).toBe("moment"); // ~2s firming
    expect(byId.get("A25")?.durationClass).toBe("sequence"); // ~4–8s compensation
    expect(byId.get("A26")?.durationClass).toBe("moment"); // tend gesture <2s
    // Cost classes per the reviewed inventory.
    expect(byId.get("A6")?.costClass).toBe("moderate");
    expect(byId.get("A7")?.costClass).toBe("cheap");
    expect(byId.get("A8")?.costClass).toBe("cheap");
    expect(byId.get("A23")?.costClass).toBe("cheap");
    expect(byId.get("A24")?.costClass).toBe("cheap");
    expect(byId.get("A25")?.costClass).toBe("cheap-moderate");
    expect(byId.get("A26")?.costClass).toBe("cheap");
    // Statuses per the inventory's S9 table: A6/A7/A8/A23/A24/A25 are the
    // Phase 4 build; A26 is inventoried here but built in Verb 1.
    for (const id of ["A6", "A7", "A8", "A23", "A24", "A25"] as const) {
      expect(byId.get(id)?.status).toBe("phase-4");
    }
    expect(byId.get("A26")?.status).toBe("built"); // built in Verb 1 — inventoried, not Phase 4
    // One landing per log entry: A6/A7 say so in their own words.
    expect(byId.get("A6")?.moves).toMatch(/generic A24 firming does not also play/);
    expect(byId.get("A7")?.moves).toMatch(/generic A24 firming does not also play/);
    expect(byId.get("A24")?.moves).toMatch(/that animation IS the landing/);
    // A23 previews only for proposals already in the batched calm-review queue.
    expect(byId.get("A23")?.control).toMatch(/batched calm-review queue/);
    // A6 rises only newly approved landmarks — presence-only ones never re-rise.
    expect(byId.get("A6")?.moves).toMatch(/never re-risen/);
    // A3 placement commits on arrival (the atomicity anchor A6/A7 inherit).
    expect(byId.get("A3")?.control).toMatch(/commits on arrival/);
  });

  it("animationById / phase4Animations look entries up", () => {
    expect(animationById("A8")?.durationClass).toBe("sequence");
    expect(animationById("A99")).toBeUndefined();
    expect(phase4Animations().map((e) => e.id)).toEqual([...PHASE_4_ANIMATION_IDS]);
  });
});
