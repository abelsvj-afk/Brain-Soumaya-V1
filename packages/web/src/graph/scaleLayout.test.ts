import { describe, it, expect } from "vitest";
import {
  buildScaleLayout,
  SCALE_APPROACH,
  SCALE_ASTEROID_NAMES,
  SCALE_BUDGET,
  SCALE_ISS_SCALE,
  SCALE_ISS_TRUSS_SPAN,
  SCALE_ORBIT,
  SCALE_PROBES,
  SCALE_RELIC_ANCHORS,
  SCALE_RELIC_SIZE,
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

  it("the budget is the recipe's planned ceiling (≤90 calls / ≤500k tris)", () => {
    expect(SCALE_BUDGET.maxDrawCalls).toBe(90);
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
});
