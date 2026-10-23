import { describe, it, expect } from "vitest";
import { HYG_STAR_COUNT } from "./hygData.js";
import { hygStarColors, hygStarPositions, buildHygStarfield } from "./hygStars.js";

describe("HYG star data (F-02: the credit must describe the shipped asset)", () => {
  it("ships exactly the credited subset size", () => {
    expect(HYG_STAR_COUNT).toBe(5000);
    expect(hygStarPositions().length).toBe(5000 * 3);
    expect(hygStarColors().length).toBe(5000 * 3);
  });

  it("positions are finite directions on the presentation shell", () => {
    const pos = hygStarPositions();
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i]!, y = pos[i + 1]!, z = pos[i + 2]!;
      expect(Number.isFinite(x + y + z)).toBe(true);
      const r = Math.hypot(x, y, z);
      expect(r).toBeGreaterThan(3799);
      expect(r).toBeLessThan(3801);
    }
  });

  it("colors are valid unit-range RGB derived per star (not one flat tone)", () => {
    const col = hygStarColors();
    let min = 1, max = 0;
    const distinct = new Set<string>();
    for (let i = 0; i < col.length; i++) {
      const v = col[i]!;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      if (v < min) min = v;
      if (v > max) max = v;
      if (i % 150 === 0) distinct.add(col.slice(i, i + 3).join(","));
    }
    expect(max).toBeGreaterThan(0.8); // the brightest stars read bright
    expect(min).toBeLessThan(0.2); // color channels actually vary
    expect(distinct.size).toBeGreaterThan(40); // per-star colors, not a palette of two
  });

  it("builds a Points cloud with one draw call's worth of geometry", () => {
    const pts = buildHygStarfield();
    expect(pts.isPoints).toBe(true);
    expect(pts.geometry.getAttribute("position").count).toBe(5000);
    expect(pts.geometry.getAttribute("color").count).toBe(5000);
  });
});
