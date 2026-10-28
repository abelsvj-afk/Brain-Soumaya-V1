import { describe, it, expect } from "vitest";
import {
  buildScaleLayout,
  SCALE_APPROACH,
  SCALE_ASTEROID_NAMES,
  SCALE_BELT_PIECES,
  SCALE_BELT_SIZES,
  SCALE_CENTERPIECES,
  SCALE_BUDGET,
  SCALE_ENCOUNTERS,
  SCALE_ISS_SCALE,
  SCALE_ISS_TRUSS_SPAN,
  SCALE_MOON,
  SCALE_MOON_OUTPOST_OFFSETS,
  SCALE_MOON_OUTPOST_SIZES,
  SCALE_NEBULA_PLANES,
  SCALE_ORBIT,
  SCALE_HUNT2_PLANETS,
  SCALE_PLANETS,
  SCALE_PROBES,
  SCALE_RELIC_ANCHORS,
  SCALE_RELIC_SIZE,
  SCALE_SATELLITE_A,
  SCALE_SEED,
  SCALE_SHIP_LENGTH,
  SCALE_SURVEY_FRAME,
} from "./scaleLayout.js";

describe("buildScaleLayout", () => {
  it("is deterministic — same seed, same space, every device", () => {
    const a = buildScaleLayout();
    const b = buildScaleLayout();
    expect(a).toEqual(b);
  });

  it("the seed is the recipe seed (scale / actual-size-1)", () => {
    expect(SCALE_SEED).toBe("scale / actual-size-1");
  });

  it("the budget is the recipe's planned ceiling (≤100 calls / ≤500k tris)", () => {
    expect(SCALE_BUDGET.maxDrawCalls).toBe(100);
    expect(SCALE_BUDGET.maxTris).toBe(500_000);
  });

  it("the ISS spans 109 scene units — nine ship-lengths, the real ratio", () => {
    const layout = buildScaleLayout();
    expect(layout.iss.trussSpan).toBe(SCALE_ISS_TRUSS_SPAN);
    expect(SCALE_ISS_TRUSS_SPAN).toBe(109);
    // About nine ship-lengths: 109 / 12 = 9.08, the real ratio of the
    // station (~109 m) to a ~12 m craft.
    expect(SCALE_ISS_TRUSS_SPAN / SCALE_SHIP_LENGTH).toBeCloseTo(109 / 12, 5);
    // The model scale turns the file's 37.77-unit truss into 109.
    expect(SCALE_ISS_SCALE).toBeCloseTo(109 / 37.77, 4);
    expect(layout.iss.scale).toBe(SCALE_ISS_SCALE);
    expect(layout.iss.x).toBe(0);
    expect(layout.iss.y).toBe(0);
    expect(layout.iss.z).toBe(0);
  });

  it("the approach closes in stages: far silhouette → witnesses → near 1:1", () => {
    expect(SCALE_APPROACH.far).toBeGreaterThan(SCALE_APPROACH.middle);
    expect(SCALE_APPROACH.middle).toBeGreaterThan(SCALE_APPROACH.near);
    expect(SCALE_APPROACH).toEqual({ far: 600, middle: 250, near: 140 });
  });

  it("the orbit holds the whole station: radius 320, low, looking at the station", () => {
    expect(SCALE_ORBIT).toEqual({ radius: 320, height: 60, lookAtY: 0 });
  });

  it("carries all four probes (Q1: all four first), Voyager farthest, as in reality", () => {
    const layout = buildScaleLayout();
    expect(layout.probes.map((p) => p.slug)).toEqual(["kepler", "pioneer-10", "dawn", "voyager"]);
    const dist = (p: (typeof layout.probes)[number]) => Math.hypot(p.x, p.y, p.z);
    expect(dist(layout.probes[3]!)).toBeGreaterThan(dist(layout.probes[2]!));
    expect(dist(layout.probes[2]!)).toBeGreaterThan(dist(layout.probes[1]!));
    expect(dist(layout.probes[1]!)).toBeGreaterThan(dist(layout.probes[0]!));
    // Every probe carries its true story in plain words — no invented facts, no empty story.
    for (const probe of layout.probes) {
      expect(probe.story.length).toBeGreaterThan(40);
      expect(probe.story).not.toMatch(/UTC|utc/);
      expect(probe.size).toBeGreaterThan(0);
      expect(probe.drift.length).toBe(3);
    }
    expect(SCALE_PROBES).toHaveLength(4);
  });

  it("carries 60 real named asteroids — the first sixty ever named, each once", () => {
    const layout = buildScaleLayout();
    expect(layout.asteroids).toHaveLength(60);
    expect(SCALE_ASTEROID_NAMES).toHaveLength(60);
    expect(new Set(layout.asteroids.map((a) => a.name)).size).toBe(60);
    expect(layout.asteroids.map((a) => a.name)).toEqual([...SCALE_ASTEROID_NAMES]);
    // A wide shell around the station — far enough to read as vast, near enough to read as things.
    for (const a of layout.asteroids) {
      const r = Math.hypot(a.x, a.z);
      expect(r).toBeGreaterThanOrEqual(900);
      expect(r).toBeLessThanOrEqual(2600);
    }
  });

  it("the survey frame sits on the approach axis, wide enough to frame the truss", () => {
    const layout = buildScaleLayout();
    expect(layout.surveyFrame.position).toEqual(SCALE_SURVEY_FRAME.position);
    expect(layout.surveyFrame.width).toBeGreaterThan(SCALE_ISS_TRUSS_SPAN);
    expect(layout.surveyFrame.width).toBe(130);
    expect(layout.surveyFrame.height).toBe(50);
  });

  it("the docked capsule rests at the truss's end, clear of the station", () => {
    const layout = buildScaleLayout();
    expect(layout.capsule.position[0]).toBeGreaterThan(SCALE_ISS_TRUSS_SPAN / 2);
    expect(layout.capsule.length).toBe(8);
  });

  it("the three Scale relics rest in the registry's anchor shape, clear of the station and inside orbit reach", () => {
    const layout = buildScaleLayout();
    expect(Object.keys(layout.relicAnchors).sort()).toEqual([
      "star-hanger",
      "sunward-compass",
      "unnumbered-fragment",
    ]);
    expect(layout.relicAnchors).toEqual(SCALE_RELIC_ANCHORS);
    for (const [slug, anchor] of Object.entries(layout.relicAnchors)) {
      expect(anchor.size).toBe(SCALE_RELIC_SIZE);
      expect(SCALE_RELIC_SIZE).toBe(22);
      // Clear of the truss (half-span 54.5) and inside the camera's orbit reach (radius 320 + margin).
      const r = Math.hypot(anchor.position[0], anchor.position[2]);
      expect(r, slug).toBeGreaterThan(60);
      expect(r, slug).toBeLessThanOrEqual(400);
    }
    // Sunward Compass on the sunward (+X) side; Unnumbered Fragment far out, at the field's edge.
    expect(SCALE_RELIC_ANCHORS["sunward-compass"]!.position[0]).toBeGreaterThan(0);
    const fragmentR = Math.hypot(
      SCALE_RELIC_ANCHORS["unnumbered-fragment"]!.position[0],
      SCALE_RELIC_ANCHORS["unnumbered-fragment"]!.position[2],
    );
    expect(fragmentR).toBeGreaterThan(300);
  });

  it("carries twelve planets as floating bodies, all smaller than the ISS truss and clear of everything", () => {
    const layout = buildScaleLayout();
    expect(layout.planets.map((p) => p.key)).toEqual([
      "planet_earth",
      "planet_mars",
      "planet_jupiter",
      "planet_saturn",
      "quaternius-planet-1",
      "quaternius-planet-2",
      "quaternius-planet-3",
      "planets-set",
      "earth-and-moon",
      "pixel-brown-dwarf",
      "sun",
      "stars",
    ]);
    expect(layout.planets).toEqual([...SCALE_PLANETS, ...SCALE_HUNT2_PLANETS]);
    const dist3 = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    for (const planet of layout.planets) {
      // Smaller than the 109-unit truss: the ISS stays the hero.
      expect(planet.size).toBeLessThan(SCALE_ISS_TRUSS_SPAN);
      // Clear of the truss (half-span 54.5 + the planet's own radius, with margin).
      expect(Math.hypot(planet.x, planet.y, planet.z)).toBeGreaterThan(
        SCALE_ISS_TRUSS_SPAN / 2 + planet.size / 2 + 100,
      );
      // Clear of the survey frame (at [0, 0, 320], half-width 65).
      expect(dist3(planet, { x: 0, y: 0, z: 320 })).toBeGreaterThan(65 + planet.size / 2 + 50);
      // Clear of every probe (probe size + planet radius, with margin).
      for (const probe of SCALE_PROBES) {
        expect(dist3(planet, probe)).toBeGreaterThan(probe.size + planet.size / 2 + 50);
      }
      // Clear of every other planet.
      for (const other of layout.planets) {
        if (other === planet) continue;
        expect(dist3(planet, other)).toBeGreaterThan(
          planet.size / 2 + other.size / 2 + 50,
        );
      }
      // Clear of every relic anchor.
      for (const anchor of Object.values(SCALE_RELIC_ANCHORS)) {
        expect(dist3(planet, { x: anchor.position[0], y: anchor.position[1], z: anchor.position[2] })).toBeGreaterThan(
          planet.size / 2 + anchor.size / 2 + 25,
        );
      }
    }
    // Planets load as-is: material counts are the draw calls (11 low-poly + 12 hunt-2 = 23).
    expect(layout.planets.reduce((n, p) => n + p.materials, 0)).toBe(23);
    expect(SCALE_PLANETS.map((p) => p.size)).toEqual([40, 30, 55, 45]);
    expect(SCALE_HUNT2_PLANETS.map((p) => p.size)).toEqual([35, 30, 32, 45, 28, 22, 60, 30]);
  });

  it("carries the moon, with its outpost offsets derived from the moon's radius", () => {
    const layout = buildScaleLayout();
    expect(layout.moon).toEqual(SCALE_MOON);
    expect(layout.moon!.size).toBe(25);
    expect(layout.moon!.materials).toBe(2);
    // Clear of the ISS, the probes, and the planets.
    const moon = layout.moon!;
    expect(Math.hypot(moon.x, moon.y, moon.z)).toBeGreaterThan(300);
    for (const probe of SCALE_PROBES) {
      expect(Math.hypot(moon.x - probe.x, moon.y - probe.y, moon.z - probe.z)).toBeGreaterThan(100);
    }
    for (const planet of layout.planets) {
      expect(
        Math.hypot(moon.x - planet.x, moon.y - planet.y, moon.z - planet.z),
      ).toBeGreaterThan(moon.size / 2 + planet.size / 2 + 50);
    }
    // The outpost offsets are fractions of the moon's radius — the dome,
    // rover, and flag sit on the surface (~1 radius out) and ride with
    // the moon when it drifts.
    const radius = moon.size / 2;
    for (const [slot, offset] of Object.entries(SCALE_MOON_OUTPOST_OFFSETS)) {
      const mag = Math.hypot(offset[0], offset[1], offset[2]) * radius;
      expect(mag, slot).toBeGreaterThan(radius * 0.9);
      expect(mag, slot).toBeLessThan(radius * 1.6);
    }
    expect(SCALE_MOON_OUTPOST_SIZES).toEqual({ dome: 10, rover: 8, flag: 6 });
  });

  it("carries six slow-drift encounters and the debris satellite, far out and clear", () => {
    const layout = buildScaleLayout();
    expect(layout.encounters.map((e) => e.key)).toEqual([
      "alien",
      "astronaut",
      "flexunit-ufo",
      "ufo",
      "hubble",
      "pulsar",
    ]);
    expect(layout.encounters).toEqual(SCALE_ENCOUNTERS);
    expect(layout.satellite).toEqual(SCALE_SATELLITE_A);
    const dist3 = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    const far = [...layout.encounters, layout.satellite!];
    for (const body of far) {
      // Far out: beyond the asteroid belt's inner edge is fine, but every
      // encounter sits well clear of the station itself.
      expect(Math.hypot(body.x, body.y, body.z), body.key).toBeGreaterThan(500);
      for (const probe of SCALE_PROBES) {
        expect(dist3(body, probe), body.key).toBeGreaterThan(100);
      }
      for (const planet of layout.planets) {
        expect(dist3(body, planet), body.key).toBeGreaterThan(100);
      }
      for (const other of far) {
        if (other === body) continue;
        expect(dist3(body, other), body.key).toBeGreaterThan(100);
      }
      expect(body.size).toBeGreaterThan(0);
      expect(body.drift.length).toBe(3);
    }
    // The FlexUnit UFO is scaled up on placement: its file measures
    // 0.05 units, so it is fitted to 3 — the smallest encounter.
    expect(layout.encounters.find((e) => e.key === "flexunit-ufo")!.size).toBe(3);
    // The pulsar is the one encounter that is not a craft: a stellar
    // jet, thirty units of light, loaded as-is so its glow survives.
    expect(layout.encounters.find((e) => e.key === "pulsar")!.size).toBe(30);
    expect(layout.encounters.find((e) => e.key === "pulsar")!.material).toBe("as-is");
    expect(SCALE_BELT_SIZES).toEqual({ big: 15, small: 8 });
  });

  it("carries six placed belt pieces at the field's edge, far out and clear", () => {
    const layout = buildScaleLayout();
    expect(layout.beltPieces.map((b) => b.key)).toEqual([
      "belt-strip",
      "bennu",
      "asteroid-large",
      "debris-pile",
      "asteroid-toastie",
      "rubble-rocks",
    ]);
    expect(layout.beltPieces).toEqual(SCALE_BELT_PIECES);
    const dist3 = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    for (const piece of layout.beltPieces) {
      expect(Math.hypot(piece.x, piece.y, piece.z), piece.key).toBeGreaterThan(500);
      for (const probe of SCALE_PROBES) {
        expect(dist3(piece, probe), piece.key).toBeGreaterThan(100);
      }
      for (const planet of layout.planets) {
        expect(dist3(piece, planet), piece.key).toBeGreaterThan(100);
      }
      for (const other of layout.beltPieces) {
        if (other === piece) continue;
        expect(dist3(piece, other), piece.key).toBeGreaterThan(100);
      }
      expect(piece.size).toBeGreaterThan(0);
    }
    // Bennu drifts; the rest hold still.
    expect(layout.beltPieces.find((b) => b.key === "bennu")!.drift).toEqual([0.4, -0.05, -0.5]);
    expect(layout.beltPieces.find((b) => b.key === "belt-strip")!.drift).toBeUndefined();
  });

  it("carries six heavy centerpieces, far out, dim and distant — never central", () => {
    const layout = buildScaleLayout();
    expect(layout.centerpieces.map((c) => c.key)).toEqual([
      "black-hole",
      "pillars-1b",
      "g292",
      "gas-cloud",
      "planetary-nebula",
      "sf-black-hole",
    ]);
    expect(layout.centerpieces).toEqual(SCALE_CENTERPIECES);
    const dist3 = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    for (const piece of layout.centerpieces) {
      // Far out: 1,700+ from the station, and clear of the survey
      // frame's approach corridor.
      expect(Math.hypot(piece.x, piece.y, piece.z), piece.key).toBeGreaterThan(1700);
      expect(dist3(piece, { x: 0, y: 0, z: 320 }), piece.key).toBeGreaterThan(1000);
      for (const probe of SCALE_PROBES) {
        expect(dist3(piece, probe), piece.key).toBeGreaterThan(100);
      }
      for (const planet of layout.planets) {
        expect(dist3(piece, planet), piece.key).toBeGreaterThan(100);
      }
      for (const other of layout.centerpieces) {
        if (other === piece) continue;
        expect(dist3(piece, other), piece.key).toBeGreaterThan(100);
      }
      // Slow turns only: a full turn takes minutes, never seconds.
      expect(piece.spinMs).toBeGreaterThanOrEqual(600_000);
    }
    // Pillars + cloud carry no color of their own — the scene gives
    // them the nebula material. The black hole and G292 keep theirs.
    expect(layout.centerpieces.find((c) => c.key === "pillars-1b")!.material).toBe("nebula");
    expect(layout.centerpieces.find((c) => c.key === "gas-cloud")!.material).toBe("nebula");
    expect(layout.centerpieces.find((c) => c.key === "black-hole")!.material).toBe("as-is");
    expect(layout.centerpieces.find((c) => c.key === "g292")!.material).toBe("as-is");
    // The Sketchfab pair keeps its own materials too — and plays its
    // own animation clips on top of the slow spin.
    expect(layout.centerpieces.find((c) => c.key === "planetary-nebula")!.material).toBe("as-is");
    expect(layout.centerpieces.find((c) => c.key === "planetary-nebula")!.animated).toBe(true);
    expect(layout.centerpieces.find((c) => c.key === "sf-black-hole")!.material).toBe("as-is");
    expect(layout.centerpieces.find((c) => c.key === "sf-black-hole")!.animated).toBe(true);
  });

  it("carries three distant nebula-light planes, far outside the orbit, facing the center", () => {
    const layout = buildScaleLayout();
    expect(layout.nebulaPlanes.map((p) => p.key)).toEqual(["nebula-01", "nebula-02", "nebula-03"]);
    expect(layout.nebulaPlanes).toEqual(SCALE_NEBULA_PLANES);
    for (const plane of layout.nebulaPlanes) {
      // Far outside the orbit (radius 320): distant light, never a body.
      expect(Math.hypot(plane.x, plane.y, plane.z), plane.key).toBeGreaterThan(3000);
      // The renders are 2560x1600 — 16:10.
      expect(plane.width / plane.height).toBeCloseTo(1.6, 5);
    }
  });
});
