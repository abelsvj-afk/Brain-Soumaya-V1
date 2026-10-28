import { describe, it, expect } from "vitest";
import {
  GALAXY_DRIFTER_DRAW_CALLS,
  GALAXY_DRIFTER_SPECS,
  GALAXY_DRIFTER_TRIS_TOTAL,
  createGalaxyDrifters,
  galaxyDrifterPose,
} from "./galaxyDrifters.js";

const dist = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("galaxyDrifterSpecs", () => {
  it("is six drifters, in drop priority order, all GLBs flat in public/", () => {
    expect(GALAXY_DRIFTER_SPECS.map((s) => s.key)).toEqual([
      "alien",
      "astronaut",
      "ufo",
      "asteroid_small",
      "comet",
      "nebula-traveller",
    ]);
    expect(new Set(GALAXY_DRIFTER_SPECS.map((s) => s.url)).size).toBe(6);
    expect(
      GALAXY_DRIFTER_SPECS.every(
        (s) =>
          s.url.startsWith("/lowpoly-") ||
          s.url.startsWith("/pp-") ||
          s.url.startsWith("/sf-"),
      ),
    ).toBe(true);
    expect(GALAXY_DRIFTER_SPECS.map((s) => s.tris)).toEqual([144, 128, 304, 20, 518, 3968]);
    expect(GALAXY_DRIFTER_TRIS_TOTAL).toBe(5082);
    expect(GALAXY_DRIFTER_DRAW_CALLS).toBe(6);
    // The traveller is the one drifter that loads as-is: its glass and
    // morph clip survive only unmerged.
    expect(GALAXY_DRIFTER_SPECS.find((s) => s.key === "nebula-traveller")!.asIs).toBe(true);
    expect(GALAXY_DRIFTER_SPECS.filter((s) => s.asIs)).toHaveLength(1);
  });

  it("is slow: a crossing takes minutes, a loop takes 10–14 minutes", () => {
    for (const spec of GALAXY_DRIFTER_SPECS) {
      if (spec.kind === "crossing") {
        // One crossing is half the round-trip period.
        expect(spec.periodMs / 2).toBeGreaterThanOrEqual(360_000);
      } else {
        expect(spec.periodMs).toBeGreaterThanOrEqual(600_000);
      }
    }
  });
});

describe("galaxyDrifterPose", () => {
  it("is deterministic — same elapsed time, same pose", () => {
    for (const spec of GALAXY_DRIFTER_SPECS) {
      expect(galaxyDrifterPose(spec, 123_456)).toEqual(galaxyDrifterPose(spec, 123_456));
    }
  });

  it("returns to the same pose after one full period (loops and round trips)", () => {
    for (const spec of GALAXY_DRIFTER_SPECS) {
      const a = galaxyDrifterPose(spec, 50_000);
      const b = galaxyDrifterPose(spec, 50_000 + spec.periodMs);
      expect(b.position[0]).toBeCloseTo(a.position[0], 5);
      expect(b.position[1]).toBeCloseTo(a.position[1], 5);
      expect(b.position[2]).toBeCloseTo(a.position[2], 5);
    }
  });

  it("moves, but slowly — ten seconds carries a drifter under 200 units", () => {
    for (const spec of GALAXY_DRIFTER_SPECS) {
      const a = galaxyDrifterPose(spec, 100_000);
      const b = galaxyDrifterPose(spec, 110_000);
      expect(dist(a.position, b.position)).toBeLessThan(200);
      expect(dist(a.position, b.position)).toBeGreaterThan(0);
    }
  });

  it("stays bounded: every path inside radius 2,200, within the visitors' 2,400 shell", () => {
    for (const spec of GALAXY_DRIFTER_SPECS) {
      for (let t = 0; t <= spec.periodMs; t += 10_000) {
        const pose = galaxyDrifterPose(spec, t);
        expect(Math.hypot(...pose.position)).toBeLessThanOrEqual(2200);
      }
    }
  });

  it("never flies through the Sun: crossings stay ~950+ from the center", () => {
    for (const spec of GALAXY_DRIFTER_SPECS) {
      if (spec.kind !== "crossing") continue;
      let nearest = Infinity;
      for (let t = 0; t <= spec.periodMs; t += 5_000) {
        const pose = galaxyDrifterPose(spec, t);
        nearest = Math.min(nearest, Math.hypot(...pose.position));
      }
      // The Sun's solid body reaches 600; the chords clear it by 300+.
      expect(nearest).toBeGreaterThan(900);
    }
  });

  it("stays sparse: no two drifters come within 250 units of each other", () => {
    // Sample a full 12-minute cycle every 10 seconds.
    for (let t = 0; t <= 720_000; t += 10_000) {
      const poses = GALAXY_DRIFTER_SPECS.map((s) => galaxyDrifterPose(s, t).position);
      for (let i = 0; i < poses.length; i++) {
        for (let j = i + 1; j < poses.length; j++) {
          expect(dist(poses[i]!, poses[j]!), `t=${t} pair ${i}/${j}`).toBeGreaterThan(250);
        }
      }
    }
  });
});

describe("createGalaxyDrifters", () => {
  it("builds six holders synchronously — empty until the GLBs land, never a stand-in", () => {
    const drifters = createGalaxyDrifters();
    expect(drifters.group.name).toBe("galaxy-drifters");
    for (const spec of GALAXY_DRIFTER_SPECS) {
      const holder = drifters.group.getObjectByName(`galaxy-drifter-${spec.key}`);
      expect(holder).toBeTruthy();
      expect(holder!.children.length).toBe(0);
    }
    drifters.dispose();
  });

  it("drifts the holders along their paths; reduced motion holds them still", () => {
    const drifters = createGalaxyDrifters();
    const alien = drifters.group.getObjectByName("galaxy-drifter-alien")!;
    const at0 = alien.position.clone();
    drifters.update(100_000);
    expect(alien.position.equals(at0)).toBe(false);
    const before = alien.position.clone();
    drifters.update(200_000, { reducedMotion: true });
    expect(alien.position.equals(before)).toBe(true);
    drifters.dispose();
  });

  it("dispose is safe, including twice, and update after dispose does not throw", () => {
    const drifters = createGalaxyDrifters();
    expect(() => {
      drifters.dispose();
      drifters.dispose();
      drifters.update(1_000);
    }).not.toThrow();
  });
});
