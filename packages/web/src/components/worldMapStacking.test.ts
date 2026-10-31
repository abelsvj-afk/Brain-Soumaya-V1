import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The map's full-screen SVG canvas is later in the DOM than its header, so without a z-index of its own the header sat
// UNDER it and a real tap on "Close map" landed on the canvas — the map could not be closed by clicking. Pinned here (the
// jsdom render cannot see stacking); the real-browser proof is `elementFromPoint` over the button.
const css = readFileSync(join(__dirname, "../index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (sel: string) => new RegExp(`${sel.replace(/\./g, "\\.")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

describe("the world map's stacking", () => {
  it.each([".world-map-bar", ".world-map-controls", ".world-map-detail"])("%s sits above the full-screen canvas", (sel) => {
    expect(/z-index:\s*[1-9]/.test(rule(sel)), `${sel} needs its own z-index`).toBe(true);
  });
  it("is translucent over the galaxy, not an opaque slab", () => {
    expect(/background:\s*rgba\(4,\s*6,\s*26,\s*0\.[0-9]+\)/.test(rule(".world-map"))).toBe(true);
  });
});
