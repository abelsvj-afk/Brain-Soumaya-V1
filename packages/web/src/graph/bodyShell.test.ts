import { describe, expect, it } from "vitest";
import { insideShell, pushOutOfShells, SHELL_FACTOR } from "./bodyShell.js";

const planet = { center: [1000, 0, 0] as [number, number, number], radius: 500 };
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe("planets you can approach but never reach", () => {
  it("leaves a point outside the shell untouched", () => {
    expect(pushOutOfShells([0, 0, 0], [planet])).toEqual([0, 0, 0]);
  });
  it("pushes any point that would end inside back out onto the shell, along the line from the centre", () => {
    for (const p of [[900, 0, 0], [1000, 10, 0], [1100, 200, -50], [1000, 0, 0]] as [number, number, number][]) {
      const q = pushOutOfShells(p, [planet]);
      expect(dist(q, planet.center)).toBeGreaterThanOrEqual(planet.radius * SHELL_FACTOR - 1e-6);
      expect(insideShell(q, [planet])).toBe(false);
    }
    // straight at it from the left: ends on the near side of the shell
    const q = pushOutOfShells([800, 0, 0], [planet]);
    expect(q[0]).toBeLessThan(1000);
  });
  it("is idempotent and never reaches the surface however many times you try", () => {
    let p: readonly [number, number, number] = [0, 0, 0];
    for (let i = 0; i < 20; i++) {
      p = pushOutOfShells([p[0] + (1000 - p[0]) * 0.9, p[1], p[2]], [planet]);
      expect(dist(p, planet.center)).toBeGreaterThanOrEqual(planet.radius * SHELL_FACTOR - 1e-6);
    }
    expect(dist(p, planet.center)).toBeGreaterThan(planet.radius * 1.5);
  });
  it("handles several bodies", () => {
    const b = { center: [-1000, 0, 0] as [number, number, number], radius: 400 };
    const q = pushOutOfShells([-900, 0, 0], [planet, b]);
    expect(insideShell(q, [planet, b])).toBe(false);
  });
});
