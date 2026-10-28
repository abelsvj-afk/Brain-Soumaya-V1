import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Same cwd-relative reader App.batchB.test.ts uses. */
function readRepoFile(rel: string): string {
  const candidates = [resolve(process.cwd(), rel), resolve(process.cwd(), "packages/web", rel)];
  for (const c of candidates) if (existsSync(c)) return readFileSync(c, "utf8");
  throw new Error(`cannot find ${rel}`);
}

/**
 * Batch O — touch-target CSS pins (happy-dom loads no stylesheets, so
 * sizes are pinned textually, the App.batchB.test.ts pattern).
 *
 *  REG-168 (SF-03): the task reorder controls meet the 46px standard.
 *  REG-179 (HN-05): Hangar action buttons meet the 46px standard.
 */
const css = readRepoFile("src/index.css");

function ruleBlock(src: string, selector: string): string {
  const a = src.indexOf(selector);
  expect(a, `selector ${selector}`).toBeGreaterThan(-1);
  const close = src.indexOf("}", a);
  expect(close).toBeGreaterThan(-1);
  return src.slice(a, close);
}

describe("REG-168 (SF-03) — reorder controls meet the touch standard", () => {
  it(".task-btn is 46px on both axes", () => {
    const block = ruleBlock(css, ".task-btn {");
    expect(block).toContain("min-height: 46px");
    expect(block).toContain("min-width: 46px");
  });
});

describe("REG-179 (HN-05) — Hangar action buttons meet the touch standard", () => {
  it(".hangar-action is at least 46px tall", () => {
    const block = ruleBlock(css, ".hangar-action");
    expect(block).toContain("min-height: 46px");
  });
});
