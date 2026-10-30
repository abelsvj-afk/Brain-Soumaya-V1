import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { SIXTEEN_STARS, buildSkyClues, sixteenDirections } from "./skyClues.js";

describe("the sixteen in the sky", () => {
  it("are sixteen fixed directions above the horizon, the same every time", () => {
    const d = sixteenDirections();
    expect(d).toHaveLength(SIXTEEN_STARS);
    expect(sixteenDirections()).toEqual(d);
    for (const [x, y, z] of d) {
      expect(Math.hypot(x, y, z)).toBeCloseTo(1);
      expect(y).toBeGreaterThan(0.2);
    }
  });
  it("draws fifteen lit stars, one dark ring, and pencil lines that stop short of the sixteenth", () => {
    const c = buildSkyClues(6000);
    const lit = c.group.getObjectByName("sky-clue-lit") as THREE.Points;
    const pencil = c.group.getObjectByName("sky-clue-pencil") as THREE.Line;
    expect(lit.geometry.getAttribute("position").count).toBe(SIXTEEN_STARS - 1);
    expect(pencil.geometry.getAttribute("position").count).toBe(SIXTEEN_STARS - 1);
    expect(c.group.getObjectByName("sky-clue-dark")).toBeTruthy();
    c.dispose();
  });
});
