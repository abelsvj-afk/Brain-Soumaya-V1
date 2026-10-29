import { describe, expect, it } from "vitest";
import { makeStarfield } from "./starfield.js";
import { withSkySeed } from "./homeSky.js";

describe("withSkySeed — one sky for every world", () => {
  it("builds identical stars every time", () => {
    const a = withSkySeed(() => makeStarfield(200), 1).geometry.getAttribute("position").array;
    const b = withSkySeed(() => makeStarfield(200), 1).geometry.getAttribute("position").array;
    expect([...a]).toEqual([...b]);
  });
  it("restores Math.random, even when the builder throws", () => {
    const real = Math.random;
    expect(() => withSkySeed(() => { throw new Error("x"); })).toThrow();
    expect(Math.random).toBe(real);
  });
});
