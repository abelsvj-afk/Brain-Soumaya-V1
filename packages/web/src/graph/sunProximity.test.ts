import { describe, expect, it } from "vitest";
import {
  SECTOR_TITLE_GROWTH_CAP,
  SUN_CAMERA_FLOOR_RADIUS,
  SUN_CONTRAST_OPACITY_FLOOR,
  SUN_CONTRAST_OUTER,
  SUN_FADE_OUTER,
  SUN_GLOW_RADIUS,
  clampCameraToSunFloor,
  labelOpacityNearSun,
  sectorLabelBoost,
  sectorTitleScaleK,
  sectorTitleWidthCapK,
  sunContrastOpacityFloor,
  sunProximityFade,
} from "./sunProximity.js";

/**
 * Package D (finding #7): the sun-proximity math behind the sector-title
 * cap, the title/label fade, the near-sun label contrast floor, and the
 * manual-camera corona floor. All pure — the falsification contract is
 * that these tests fail if the corresponding source rule is removed.
 */

const MACRO_DIST = 1200; // Graph3D.tsx's MACRO_DIST at this tree

describe("sun geometry constants — measured from sun.ts", () => {
  it("glow radius = max body radius × corona half-extent × gradient edge", () => {
    // SUN_RADIUS_MAX 600 × (2.8 / 2) sprite half-extent × (58 / 64) gradient edge.
    expect(SUN_GLOW_RADIUS).toBeCloseTo(761.25, 6);
  });

  it("fade band is 1.5× the glow radius and the floor sits at the corona edge", () => {
    expect(SUN_FADE_OUTER).toBeCloseTo(SUN_GLOW_RADIUS * 1.5, 6);
    expect(SUN_CAMERA_FLOOR_RADIUS).toBe(SUN_GLOW_RADIUS);
  });
});

describe("sunProximityFade — smooth falloff, not the old blinking occlusion gate", () => {
  it("far from the sun the factor is EXACTLY today's behaviour (1)", () => {
    expect(sunProximityFade(SUN_FADE_OUTER)).toBe(1);
    expect(sunProximityFade(2000)).toBe(1);
    expect(sunProximityFade(20000)).toBe(1);
  });

  it("is continuous at the band edge — no jump as the camera crosses it", () => {
    const justInside = sunProximityFade(SUN_FADE_OUTER - 0.5);
    expect(justInside).toBeLessThan(1);
    expect(justInside).toBeGreaterThan(0.99);
  });

  it("deep inside the glow, titles/labels are invisible (factor exactly 0)", () => {
    expect(sunProximityFade(SUN_GLOW_RADIUS)).toBe(0);
    expect(sunProximityFade(SUN_GLOW_RADIUS / 2)).toBe(0);
    expect(sunProximityFade(0)).toBe(0);
  });

  it("is continuous at the corona edge too — no pop as the fade completes", () => {
    const justOutside = sunProximityFade(SUN_GLOW_RADIUS + 0.5);
    expect(justOutside).toBeGreaterThan(0);
    expect(justOutside).toBeLessThan(0.01);
  });

  it("falls monotonically through the band (a smooth slide, never a flicker)", () => {
    let prev = 0;
    for (let d = SUN_GLOW_RADIUS; d <= SUN_FADE_OUTER; d += 25) {
      const f = sunProximityFade(d);
      expect(f).toBeGreaterThanOrEqual(prev);
      expect(f).toBeLessThanOrEqual(1);
      prev = f;
    }
    expect(prev).toBeGreaterThan(0.99); // last in-band sample before the edge
    expect(sunProximityFade(SUN_FADE_OUTER)).toBe(1);
  });
});

describe("sectorTitleScaleK — growth cap over the deliberate uncapped map rule", () => {
  it("below the cap it returns today's formula EXACTLY", () => {
    for (const dist of [0, 600, MACRO_DIST, 2400, 6000, 12000, 18000]) {
      for (const boost of [1, 1.4]) {
        expect(sectorTitleScaleK(dist, MACRO_DIST, boost)).toBe(
          Math.max(1, dist / MACRO_DIST) * boost,
        );
      }
    }
  });

  it("never exceeds the cap at ANY distance, however far the camera pulls out", () => {
    for (const dist of [19200, 25000, 100000, 1e9]) {
      for (const boost of [1, 1.4]) {
        expect(sectorTitleScaleK(dist, MACRO_DIST, boost)).toBe(SECTOR_TITLE_GROWTH_CAP * boost);
      }
    }
  });

  it("the cap clears the worst whole-galaxy framing demand (portrait far-rim ≈ 15.3)", () => {
    // frameGalaxy portrait fit ≈ 14,900 from centre + 3,500 far-rim hub.
    const demand = (14900 + 3500) / MACRO_DIST;
    expect(SECTOR_TITLE_GROWTH_CAP).toBeGreaterThan(demand);
    expect(sectorTitleScaleK(14900 + 3500, MACRO_DIST, 1.4)).toBe(demand * 1.4);
  });
});

describe("sunContrastOpacityFloor — help only for anchors near the sun", () => {
  it("is zero at and beyond the contrast band edge (today's behaviour, continuous)", () => {
    expect(sunContrastOpacityFloor(SUN_CONTRAST_OUTER)).toBe(0);
    expect(sunContrastOpacityFloor(4000)).toBe(0);
    expect(sunContrastOpacityFloor(SUN_CONTRAST_OUTER - 0.5)).toBeGreaterThan(0);
    expect(sunContrastOpacityFloor(SUN_CONTRAST_OUTER - 0.5)).toBeLessThan(0.01);
  });

  it("reaches the full floor at the corona edge", () => {
    expect(sunContrastOpacityFloor(SUN_GLOW_RADIUS)).toBe(SUN_CONTRAST_OPACITY_FLOOR);
    expect(sunContrastOpacityFloor(100)).toBe(SUN_CONTRAST_OPACITY_FLOOR);
  });

  it("gives the innermost orbit ring (≈1232 units) a meaningful raise", () => {
    // orbits.ts: top-level minR = SUN_RADIUS_MAX + SUN_GAP(600) + size + MARGIN(32) ≥ 1232.
    // A distance-faded label there sits at ~0.3 opacity against the wash; the
    // floor must lift it past half so the name stays readable.
    expect(sunContrastOpacityFloor(1232)).toBeGreaterThan(0.5);
  });
});

describe("labelOpacityNearSun — composition of fade + contrast + exemption", () => {
  it("far from the sun on both axes returns the base opacity EXACTLY", () => {
    expect(labelOpacityNearSun(0.42, 5000, 1, false)).toBe(0.42);
    expect(labelOpacityNearSun(0.42, 5000, 1, true)).toBe(0.42);
  });

  it("a near-sun anchor raises a dim label to at least the contrast floor", () => {
    const out = labelOpacityNearSun(0.28, 1232, 1, false);
    expect(out).toBe(sunContrastOpacityFloor(1232));
    expect(out).toBeGreaterThan(0.5);
  });

  it("never lowers a label that is already brighter than the floor", () => {
    expect(labelOpacityNearSun(0.95, 1232, 1, false)).toBe(0.95);
  });

  it("the camera fade still wins deep inside the glow — unless exempt", () => {
    expect(labelOpacityNearSun(0.95, 1232, 0, false)).toBe(0);
    // Selected/followed exemption (mirrors the sun-occlusion exemption):
    // you flew to this body, its name stays readable.
    expect(labelOpacityNearSun(0.28, 1232, 0, true)).toBe(sunContrastOpacityFloor(1232));
  });

  it("partial camera fade scales the raised opacity smoothly", () => {
    const raised = sunContrastOpacityFloor(1232);
    expect(labelOpacityNearSun(0.28, 1232, 0.5, false)).toBeCloseTo(raised * 0.5, 10);
  });
});

describe("clampCameraToSunFloor — the manual camera's gentle corona stop", () => {
  it("FALSIFICATION SHAPE: a manual step toward the sun stops AT the boundary", () => {
    // Camera steering straight at the sun from just outside the floor:
    // without the floor this step lands at 500 (deep inside the corona);
    // with it, the camera rests exactly on the floor sphere.
    const step = { x: 500, y: 0, z: 0 };
    const { pos, clamped } = clampCameraToSunFloor(step);
    expect(clamped).toBe(true);
    expect(Math.hypot(pos.x, pos.y, pos.z)).toBeCloseTo(SUN_CAMERA_FLOOR_RADIUS, 6);
  });

  it("preserves the direction from the sun exactly (radial projection, no swing)", () => {
    const inside = { x: 120, y: -300, z: 240 };
    const { pos } = clampCameraToSunFloor(inside);
    const li = Math.hypot(inside.x, inside.y, inside.z);
    const lo = Math.hypot(pos.x, pos.y, pos.z);
    expect(pos.x / lo).toBeCloseTo(inside.x / li, 10);
    expect(pos.y / lo).toBeCloseTo(inside.y / li, 10);
    expect(pos.z / lo).toBeCloseTo(inside.z / li, 10);
    expect(lo).toBeCloseTo(SUN_CAMERA_FLOOR_RADIUS, 6);
  });

  it("navigation outside the floor is UNCHANGED, bit-for-bit", () => {
    for (const p of [
      { x: SUN_CAMERA_FLOOR_RADIUS, y: 0, z: 0 }, // exactly on the boundary
      { x: 1000, y: -2000, z: 500 }, // far outside
      { x: -SUN_CAMERA_FLOOR_RADIUS - 0.001, y: 0, z: 0 }, // a hair outside
    ]) {
      const { pos, clamped } = clampCameraToSunFloor(p);
      expect(clamped).toBe(false);
      expect(pos).toEqual(p);
    }
  });

  it("a tangential position on the sphere is untouched; sliding stays on the sphere", () => {
    // Orbiting the sun itself (target at the origin): each tangential step
    // that dips inward is re-seated on the sphere, so the orbit continues
    // at corona distance instead of spiralling into the wash.
    const onSphere = { x: 0, y: SUN_CAMERA_FLOOR_RADIUS, z: 0 };
    expect(clampCameraToSunFloor(onSphere).clamped).toBe(false);
    const dipped = { x: 60, y: SUN_CAMERA_FLOOR_RADIUS - 40, z: 0 };
    const { pos, clamped } = clampCameraToSunFloor(dipped);
    expect(clamped).toBe(true);
    expect(Math.hypot(pos.x, pos.y, pos.z)).toBeCloseTo(SUN_CAMERA_FLOOR_RADIUS, 6);
    expect(pos.x).toBeGreaterThan(0); // tangential progress is kept, not rewound
  });

  it("the degenerate exact-centre position is left alone (no direction to project along)", () => {
    const { pos, clamped } = clampCameraToSunFloor({ x: 0, y: 0, z: 0 });
    expect(clamped).toBe(false);
    expect(pos).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("sectorLabelBoost — phone portrait loses the narrow-screen boost (round 2, S2)", () => {
  it("phone portrait viewports get 1.0 — titles shrink on phones", () => {
    expect(sectorLabelBoost(390, 844)).toBe(1);
    expect(sectorLabelBoost(360, 640)).toBe(1);
    expect(sectorLabelBoost(560, 900)).toBe(1);
  });
  it("everywhere else today's rule is preserved exactly", () => {
    expect(sectorLabelBoost(700, 900)).toBe(1.4); // narrow but not phone-portrait
    expect(sectorLabelBoost(700, 390)).toBe(1.4); // narrow landscape: width < 760 rule, unchanged
    expect(sectorLabelBoost(759, 500)).toBe(1.4);
    expect(sectorLabelBoost(760, 500)).toBe(1);
    expect(sectorLabelBoost(1440, 900)).toBe(1);
  });
});

describe("sectorTitleWidthCapK — the ~55vw ceiling on phone titles", () => {
  const FOV = 50; // three.js default; Graph3D overrides only `far`
  it("a title scaled by the capped k spans exactly the max fraction of the screen", () => {
    const base = 129.25; // widest title: 470px window × 0.11 world/px × 2.5 sector scale
    const dist = 3000;
    const aspect = 390 / 844;
    const k = sectorTitleWidthCapK(base, dist, FOV, aspect, 0.55);
    const tanH = Math.tan((FOV * Math.PI) / 360) * aspect;
    const fraction = (base * k) / (2 * dist * tanH);
    expect(fraction).toBeCloseTo(0.55, 10);
  });
  it("does not bind at the phone's ordinary map size (boost 1.0 ⇒ ~25% of width)", () => {
    // The uncapped growth rule at dist 6000 gives k = 5; the cap must sit above it.
    const capK = sectorTitleWidthCapK(129.25, 6000, FOV, 390 / 844);
    expect(capK).toBeGreaterThan(5);
  });
  it("binds when the geometry conspires (wide aspect, huge base) — it is a real ceiling", () => {
    const capK = sectorTitleWidthCapK(600, 1200, FOV, 0.75);
    expect(Number.isFinite(capK)).toBe(true);
    expect(capK).toBeLessThan(1);
  });
  it("degenerate inputs return Infinity (the cap simply doesn't bind)", () => {
    expect(sectorTitleWidthCapK(0, 1000, FOV, 0.5)).toBe(Infinity);
    expect(sectorTitleWidthCapK(100, 0, FOV, 0.5)).toBe(Infinity);
    expect(sectorTitleWidthCapK(100, 1000, 0, 0.5)).toBe(Infinity);
  });
});
