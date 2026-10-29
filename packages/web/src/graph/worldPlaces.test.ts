import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { findPlaces, MAX_PLACES, MIN_PLACE_RADIUS, PLACE_RULES, prettify } from "./worldPlaces.js";

const holder = (name: string, at: [number, number, number], size: number, withModel = true) => {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(...at);
  if (withModel) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshBasicMaterial());
    m.name = `${name}-model`;
    g.add(m);
  }
  return g;
};
const rootWith = (...objs: THREE.Object3D[]) => {
  const r = new THREE.Group();
  objs.forEach((o) => r.add(o));
  r.updateMatrixWorld(true);
  return r;
};

describe("prettify", () => {
  it("names a place by what it is, not by the scene's key", () => {
    expect(prettify("planet-planet-jupiter")).toBe("Jupiter");
    expect(prettify("centerpiece-sf-black-hole")).toBe("Black hole");
    expect(prettify("probe-voyager-a")).toBe("Voyager a");
    expect(prettify("backdrop-pp-planet-2")).toBe("2");
    expect(prettify("planet-sun")).toBe("Sun");
    expect(prettify("probe")).toBe("Probe"); // never empty
  });
});

describe("findPlaces", () => {
  it("finds named holders with their true centre and bounding-sphere radius, biggest first", () => {
    const root = rootWith(holder("station-rotating", [100, 0, 0], 400), holder("witness-drydock-gantry", [0, 0, 600], 60));
    const places = findPlaces("great-station", root);
    expect(places.map((p) => p.label)).toEqual(["The Station", "Drydock"]);
    expect(places[0]!.center).toEqual([100, 0, 0]);
    expect(places[0]!.radius).toBeCloseTo((Math.sqrt(3) * 400) / 2, 4);
  });

  it("skips a holder whose model hasn't loaded (empty bounds) — it appears when the model lands", () => {
    const empty = holder("glb-rim", [0, 0, 0], 100, false);
    const root = rootWith(empty);
    expect(findPlaces("deep-past", root)).toEqual([]);
    const m = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), new THREE.MeshBasicMaterial());
    empty.add(m);
    root.updateMatrixWorld(true);
    expect(findPlaces("deep-past", root).map((p) => p.label)).toEqual(["The rim"]);
  });

  it("skips dressing too small to be a destination, and model children (…-model) are never places themselves", () => {
    const root = rootWith(holder("probe-voyager", [0, 0, 0], MIN_PLACE_RADIUS), holder("probe-big", [50, 0, 0], 30));
    const labels = findPlaces("scale", root).map((p) => p.label);
    expect(labels).toEqual(["Big"]);
  });

  it("generic kinds carry their name (Planet earth, not 'Planet' ×3); a world with no rules has no places", () => {
    const root = rootWith(holder("planet-earth", [0, 0, 0], 200), holder("planet-mars", [500, 0, 0], 100));
    expect(findPlaces("scale", root).map((p) => p.label)).toEqual(["Earth", "Mars"]);
    const scenery = rootWith(holder("backdrop-lava", [0, 0, 0], 200));
    expect(findPlaces("great-station", scenery).map((p) => p.label)).toEqual(["Lava planet"]);
    expect(findPlaces("eternity", root)).toEqual([]);
    expect(findPlaces("growing-place", root)).toEqual([]);
  });

  it("is capped, deterministic, and has unique ids", () => {
    const objs = Array.from({ length: 14 }, (_, i) => holder(`planet-p${i}`, [i * 100, 0, 0], 20 + i));
    const a = findPlaces("scale", rootWith(...objs));
    const b = findPlaces("scale", rootWith(...objs));
    expect(a).toHaveLength(MAX_PLACES);
    expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id));
    expect(new Set(a.map((p) => p.id)).size).toBe(a.length);
  });

  it("every rule has an icon and a label, and every world's rule set is non-empty", () => {
    for (const [world, rules] of Object.entries(PLACE_RULES)) {
      expect(rules.length, world).toBeGreaterThan(0);
      for (const r of rules) {
        expect(r.icon.length, `${world} ${r.label}`).toBeGreaterThan(0);
        expect(r.label.length).toBeGreaterThan(0);
      }
    }
  });
});
