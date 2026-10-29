import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Same cwd-relative reader App.batchB.test.ts uses. */
function readRepoFile(rel: string): string {
  const candidates = [resolve(process.cwd(), rel), resolve(process.cwd(), "packages/web", rel)];
  for (const c of candidates) if (existsSync(c)) return readFileSync(c, "utf8");
  throw new Error(`cannot find ${rel}`);
}

function ruleBlock(src: string, selector: string): string {
  const a = src.indexOf(selector);
  expect(a, `selector ${selector}`).toBeGreaterThan(-1);
  const close = src.indexOf("}", a);
  expect(close).toBeGreaterThan(-1);
  return src.slice(a, close);
}

/**
 * Layering pins for the world map exit + the persistent galaxy chrome
 * (docs/specs/worlds-controls-persistence-2026-10-29.md).
 *
 * happy-dom loads no stylesheets and does no hit-testing, so these are
 * pinned textually, the indexCss.batchO pattern. They exist because the
 * failure they guard is invisible to every component test: the map's
 * full-screen canvas comes after its header in the DOM, and at the same
 * stacking tier it painted over the header and took every tap meant
 * for "Back to your galaxy" — the drawn map had no exit (owner report
 * 2026-10-29), while the click-the-button test passed the whole time.
 */
const css = readRepoFile("src/index.css");

describe("world map — the exit stays on top of the canvas", () => {
  it(".world-map-bar sits above the canvas (z-index 2 over 0)", () => {
    expect(ruleBlock(css, ".world-map-bar {")).toContain("z-index: 2");
    expect(ruleBlock(css, ".world-map-canvas {")).toContain("z-index: 0");
  });

  it(".world-map-controls and .world-map-detail sit above the canvas too", () => {
    expect(ruleBlock(css, ".world-map-controls {")).toContain("z-index: 2");
    expect(ruleBlock(css, ".world-map-detail {")).toContain("z-index: 2");
  });

  it("the map layer itself is above the worlds surface + travel sheet (z-index 74)", () => {
    expect(ruleBlock(css, ".world-map {")).toContain("z-index: 74");
  });
});

describe("persistent galaxy chrome — the home controls rise only inside a world", () => {
  it("the FAB tier rises above the worlds surface (71 over 70)", () => {
    expect(ruleBlock(css, ".app.worlds-open .fab {")).toContain("z-index: 71");
  });

  it("panels opened from the chrome rise with it (75)", () => {
    expect(ruleBlock(css, ".app.worlds-open .panel {")).toContain("z-index: 75");
  });

  it("the Tools button drops below the world's header, and further below its dock", () => {
    expect(ruleBlock(css, ".app.worlds-open .fab-tools {")).toContain("4.5rem");
    expect(ruleBlock(css, ".app.worlds-open.worlds-docked .fab-tools {")).toContain("9.25rem");
  });
});
