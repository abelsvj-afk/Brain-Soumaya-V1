import { describe, expect, it } from "vitest";
import { HARBOR_RING_HUB, HUB_NPC_IDS, anchorForNpc, crowdAwareRadius } from "./npcBodies.js";

describe("the Harbor Ring hub (Item 4, Stage 1)", () => {
  it("sits on the docking band between the controller's berth and Bex's berth, inside the patrol disc and the anchor cap", () => {
    // Docking arm (π/2, r 228) is [0, 0, 228]; controller's berth (3π/4,
    // r 222) is [-157, 0, 157]; Bex's berth (5π/4, r 222) is [-157, 0, -157].
    // The hub centre sits between them on the band.
    expect(HARBOR_RING_HUB.center[0]).toBeLessThan(0);
    expect(HARBOR_RING_HUB.center[2]).toBeGreaterThan(0);
    expect(Math.hypot(HARBOR_RING_HUB.center[0], HARBOR_RING_HUB.center[2])).toBeLessThan(222);
    expect(HARBOR_RING_HUB.radius).toBeGreaterThanOrEqual(150);
    expect(HARBOR_RING_HUB.radius).toBeLessThanOrEqual(200);
  });

  it("gives hub NPCs the hub anchor and everyone else the whole-world anchor", () => {
    const world = { center: [0, 0, 0] as [number, number, number], radius: 500 };
    for (const id of HUB_NPC_IDS) expect(anchorForNpc(id, world, HARBOR_RING_HUB)).toBe(HARBOR_RING_HUB);
    expect(anchorForNpc("wayfarer", world, HARBOR_RING_HUB)).toBe(world);
    expect(anchorForNpc("harbor-controller", world, HARBOR_RING_HUB)).toBe(world);
    // No hub anchor (another world): hub NPCs fall back to the world anchor.
    expect(anchorForNpc("dockhand", world, null)).toBe(world);
    expect(anchorForNpc("dockhand", null, HARBOR_RING_HUB)).toBe(HARBOR_RING_HUB);
    expect(anchorForNpc("wayfarer", null, HARBOR_RING_HUB)).toBeNull();
  });

  it("crowd-aware radius: unchanged at 4 or fewer, growing past 4, capped at 560", () => {
    expect(crowdAwareRadius(400, 0)).toBe(400);
    expect(crowdAwareRadius(400, 4)).toBe(400);
    expect(crowdAwareRadius(400, 5)).toBeCloseTo(432, 6);
    expect(crowdAwareRadius(400, 10)).toBeCloseTo(560, 6); // 400 * 1.48 = 592, capped
    expect(crowdAwareRadius(200, 10)).toBeCloseTo(296, 6);
    expect(crowdAwareRadius(560, 30)).toBe(560);
  });
});
