import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Audit U2: small controls keep a ≥ 44 px hit area. The rules live at the end of index.css; this pins that they stay. */
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.css"), "utf8");

describe("tap targets (44 px)", () => {
  it.each([".toast-dismiss::after", ".chip-btn::after", ".ship-status-collapse::after"])("%s expands the hit area", (sel) => {
    expect(css).toContain(`${sel} { content: ""; position: absolute; inset:`);
  });
  it("the growable controls have a 44 px minimum", () => {
    expect(css).toMatch(/\.nc-action-btn, \.nc-dismiss, \.beacon-target, \.audio-state-chip, \.streak-ember \{\s*display: inline-flex; align-items: center; justify-content: center; min-height: 44px;/);
    expect(css).toMatch(/\.toast\.actionable \{ min-height: 44px; \}/);
    expect(css).toMatch(/\.perf-suggest button \{ min-height: 44px; min-width: 44px; \}/);
    expect(css).toMatch(/\.gv-chip \{ min-height: 44px; \}/);
  });
});
