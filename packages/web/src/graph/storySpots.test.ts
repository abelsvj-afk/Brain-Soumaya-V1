import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { STORY_TRIGGERS } from "@brain/shared";
import { PLACE_RULES } from "./worldPlaces.js";
import { locateLandmarks, makeReach, worldHasSpots } from "./storySpots.js";

const trig = (id: string) => STORY_TRIGGERS.find((t) => t.entryId === id)!;

function scene(): THREE.Group {
  const root = new THREE.Group();
  const holder = new THREE.Group();
  holder.name = "witness-drydock-gantry";
  const m = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), new THREE.MeshBasicMaterial());
  m.position.set(1000, 0, 0);
  holder.add(m);
  root.add(holder);
  root.updateMatrixWorld(true);
  return root;
}

describe("spots are tied to the scene's own landmarks", () => {
  it("every spot names a real place rule of its world (so it follows the scene, and a typo cannot slip in)", () => {
    for (const t of STORY_TRIGGERS) {
      if (!t.spot?.place) continue;
      const rules = PLACE_RULES[t.world] ?? [];
      expect(rules.some((r) => r.match.source === t.spot!.place), `${t.entryId}: ${t.spot.place} is not a ${t.world} place rule`).toBe(true);
    }
  });
  it("origin spots exist only in the garden (the witness tree is its origin)", () => {
    for (const t of STORY_TRIGGERS) if (t.spot?.origin) expect(t.world).toBe("growing-place");
  });
  it("finds a landmark by its holder's name, once, with its bounding sphere", () => {
    const marks = locateLandmarks(scene(), "^witness-drydock-gantry$");
    expect(marks).toHaveLength(1);
    expect(marks[0]!.center[0]).toBeCloseTo(1000, 3);
    expect(marks[0]!.radius).toBeGreaterThan(50);
  });
});

describe("being at a spot", () => {
  const drydock = trig("sight.missing-berth"); // near 1.4 × radius of the drydock
  it("is true near the landmark and false away from it", () => {
    const root = scene();
    expect(makeReach("great-station", root, [1000, 0, 120])(drydock)).toBe(true);
    expect(makeReach("great-station", root, [0, 0, 0])(drydock)).toBe(false);
  });
  it("a landmark that is not in the scene (its model never loaded) can never be reached", () => {
    expect(makeReach("great-station", new THREE.Group(), [0, 0, 0])(drydock)).toBe(false);
  });
  it("in the garden the witness tree is the origin", () => {
    const bough = trig("sight.dead-bough");
    expect(makeReach("growing-place", null, [90, 0, 40])(bough)).toBe(true);
    expect(makeReach("growing-place", null, [600, 0, 0])(bough)).toBe(false);
  });
  it("a spot in another world is not reachable from this one", () => {
    expect(makeReach("deep-past", scene(), [1000, 0, 0])(drydock)).toBe(false);
  });
  it("worlds with spots demand a deployed viewer; Eternity too, by where the camera is", () => {
    expect(worldHasSpots("great-station")).toBe(true);
    expect(worldHasSpots("growing-place")).toBe(true);
    expect(worldHasSpots("eternity")).toBe(true);
  });
});

describe("Eternity views", () => {
  const byId = (id: string) => STORY_TRIGGERS.find((t) => t.entryId === id)!;
  it("answers from the camera's place round him, not elsewhere", () => {
    expect(makeReach("eternity", null, [0, 60, -620])(byId("sight.unlooked-direction"))).toBe(true);
    expect(makeReach("eternity", null, [0, 60, 620])(byId("sight.unlooked-direction"))).toBe(false);
    expect(makeReach("eternity", null, [0, 60, 1500])(byId("sight.long-room"))).toBe(true);
    expect(makeReach("eternity", null, [0, 60, 620])(byId("sight.long-room"))).toBe(false);
    expect(makeReach("eternity", null, [0, 60, 250])(byId("echo.eighth-bell"))).toBe(true);
    expect(makeReach("eternity", null, [0, 60, 620])(byId("echo.eighth-bell"))).toBe(false);
  });
});

describe("places with a past", () => {
  it("offers a passage only while standing beside its landmark (and fails closed without the model)", async () => {
    const { inspectablesHere } = await import("./storySpots.js");
    const root = new THREE.Group();
    const drydock = new THREE.Mesh(new THREE.BoxGeometry(14, 14, 14), new THREE.MeshBasicMaterial());
    drydock.name = "witness-drydock-gantry";
    drydock.position.set(1000, 0, 0);
    root.add(drydock);
    expect(inspectablesHere("great-station", root, [1000, 0, 60]).map((p) => p.id)).toEqual(["station.gantry"]);
    expect(inspectablesHere("great-station", root, [0, 0, 0])).toEqual([]);
    expect(inspectablesHere("great-station", new THREE.Group(), [1000, 0, 60])).toEqual([]);
    expect(inspectablesHere("growing-place", null, [100, 0, 0]).map((p) => p.id)).toEqual(["garden.tree"]);
    expect(inspectablesHere("growing-place", null, [900, 0, 0])).toEqual([]);
  });
});
