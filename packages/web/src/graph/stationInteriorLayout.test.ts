import { describe, it, expect } from "vitest";
import {
  INTERIOR_BAY_DOOR,
  INTERIOR_BAY_LANE,
  INTERIOR_DECK_VIEWPORT,
  INTERIOR_GATE,
  INTERIOR_NAV_COLOR,
  INTERIOR_RIM_ARC,
  INTERIOR_WORK_COLOR,
  STATION_INTERIOR_BUDGET,
  buildStationInteriorLayout,
  interiorCameraSweep,
  interiorSpaceCamera,
} from "./stationInteriorLayout.js";
import { STATION_PALETTE, STATION_WHEEL_RADIUS } from "./stationLayout.js";
import { INTERIOR_MODELS, STATION_INTERIOR_ASSET_URLS } from "./stationInteriorAssets.js";

describe("buildStationInteriorLayout", () => {
  it("builds four rooms, no others — hangar bay, commission board, fleet deck, observation deck", () => {
    const layout = buildStationInteriorLayout();
    expect(layout.spaces.map((s) => s.id)).toEqual([
      "hangar-bay",
      "commission-board",
      "fleet-deck",
      "observation-deck",
    ]);
    for (const space of layout.spaces) {
      expect(space.title.length).toBeGreaterThan(0);
      expect(space.blurb.length).toBeGreaterThan(0);
      expect(space.pieces.length).toBeGreaterThan(0);
      expect(space.ceilingY).toBeGreaterThan(0);
      expect(space.orbit.radius).toBeGreaterThan(0);
    }
  });

  it("the rooms are adjacent, not scattered — one hall", () => {
    const layout = buildStationInteriorLayout();
    const centers = layout.spaces.map((s) => s.center);
    // Hangar bay at +64, board at 0, fleet deck at −64, observation deck at −128.
    const xs = centers.map((c) => c[0]).sort((a, b) => a - b);
    expect(xs).toEqual([-128, -64, 0, 64]);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]! - xs[i - 1]!).toBeLessThanOrEqual(90);
    }
  });

  it("every placed piece names a model from the manifest — no piece without a real GLB behind it", () => {
    const layout = buildStationInteriorLayout();
    const keys = new Set(INTERIOR_MODELS.map((m) => m.key));
    for (const space of layout.spaces) {
      for (const piece of space.pieces) {
        expect(keys.has(piece.model)).toBe(true);
      }
    }
  });

  it("every manifest URL is already in the app — the interior adds no new GLB", () => {
    // The manifest is the upload list; each URL is a file the Station
    // already ships (P2-6) or the ship the brain already flies. No new
    // upload, no new license.
    for (const url of STATION_INTERIOR_ASSET_URLS) {
      expect(url.startsWith("/")).toBe(true);
      expect(url.endsWith(".glb")).toBe(true);
    }
    // The visitor craft is gone: the bay is the hangar now, and its
    // center belongs to the user's ship, not a berthed visitor.
    expect(STATION_INTERIOR_ASSET_URLS).not.toContain("/kenney-space-craft_cargoB.glb");
    expect(STATION_INTERIOR_ASSET_URLS).toContain("/soumaya-ship.glb");
    expect(STATION_INTERIOR_ASSET_URLS).toContain("/organic-spaceship.glb");
  });

  it("the hangar bay carries no visitor craft — its center is the user's ship, placed by the scene", () => {
    const layout = buildStationInteriorLayout();
    const bay = layout.spaces.find((s) => s.id === "hangar-bay")!;
    expect(bay.pieces.some((p) => p.model === "craft_cargoB")).toBe(false);
    // The bay shell is still the room's bones.
    expect(bay.pieces.some((p) => p.model === "hangar_largeA")).toBe(true);
  });

  it("the budget is the Station's own internal targets", () => {
    expect(STATION_INTERIOR_BUDGET.maxDrawCalls).toBe(64);
    expect(STATION_INTERIOR_BUDGET.maxTris).toBe(500_000);
  });

  it("the observation deck is quiet: its own words promise no task, no counter, nothing to earn", () => {
    const layout = buildStationInteriorLayout();
    const deck = layout.spaces.find((s) => s.id === "observation-deck")!;
    expect(deck.blurb).toMatch(/nothing to do/);
    expect(deck.blurb).not.toMatch(/earn|count|task|reward|quest/i);
  });

  it("the rooms' own words contain no walking — movement is a jump from a list, not a walk", () => {
    const layout = buildStationInteriorLayout();
    for (const space of layout.spaces) {
      expect(`${space.title} ${space.blurb}`).not.toMatch(/walk/i);
    }
  });

  it("the rim arc is the Station's own wheel at its real radius, out the deck viewport", () => {
    expect(INTERIOR_RIM_ARC.radius).toBe(STATION_WHEEL_RADIUS);
    expect(INTERIOR_RIM_ARC.center[0]).toBe(-128);
    expect(INTERIOR_DECK_VIEWPORT.center[0]).toBe(-128);
  });

  it("the bay door and its passing lane belong to the hangar bay", () => {
    expect(INTERIOR_BAY_DOOR.center[0]).toBe(64);
    expect(INTERIOR_BAY_LANE.fromX).toBeLessThan(64);
    expect(INTERIOR_BAY_LANE.toX).toBeGreaterThan(64);
  });

  it("the gate frame stands at the main hall's far end", () => {
    expect(INTERIOR_GATE.center).toEqual([0, 0, -14]);
  });

  it("palette discipline: cyan is navigation truth only, amber is working light", () => {
    expect(INTERIOR_NAV_COLOR).toBe(STATION_PALETTE.cyan);
    expect(INTERIOR_WORK_COLOR).toBe(STATION_PALETTE.amber);
  });

  it("the camera sweep covers four rooms plus the two framed openings", () => {
    const sweep = interiorCameraSweep();
    const orbits = sweep.filter((p) => p.kind === "orbit");
    expect(orbits).toHaveLength(16);
    for (const id of ["hangar-bay", "commission-board", "fleet-deck", "observation-deck"] as const) {
      expect(orbits.filter((p) => p.space === id)).toHaveLength(4);
    }
    expect(sweep.filter((p) => p.kind === "opening")).toEqual([
      { space: "hangar-bay", kind: "opening", azimuth: Math.PI / 2 },
      { space: "observation-deck", kind: "opening", azimuth: -Math.PI / 2 },
    ]);
  });

  it("interiorSpaceCamera returns the room's own orbit", () => {
    const layout = buildStationInteriorLayout();
    const bay = layout.spaces.find((s) => s.id === "hangar-bay")!;
    const cam = interiorSpaceCamera(bay);
    expect(cam.center).toEqual([64, 0, 0]);
    expect(cam.radius).toBe(bay.orbit.radius);
    expect(cam.height).toBe(bay.orbit.height);
    expect(cam.lookAtY).toBe(bay.orbit.lookAtY);
  });
});
