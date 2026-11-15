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
    expect(css).toMatch(/\.nc-action-btn, \.nc-dismiss, \.beacon-target, \.streak-ember \{\s*display: inline-flex; align-items: center; justify-content: center; min-height: 44px;/);
    expect(css).toMatch(/\.toast\.actionable \{ min-height: 44px; \}/);
    expect(css).toMatch(/\.perf-suggest button \{ min-height: 44px; min-width: 44px; \}/);
    expect(css).toMatch(/\.gv-chip \{ min-height: 44px; \}/);
  });
  it("UX review #7: close buttons, ingest links and tag chips reach 44 px", () => {
    expect(css).toMatch(/\.panel-close:not\(\.tab-close\) \{ min-width: 44px; min-height: 44px; \}/);
    // the old `display: inline-flex !important` beat every hide rule — gone
    expect(css).not.toMatch(/\.panel-close \{ min-width: 44px; min-height: 44px; display: inline-flex !important/);
    expect(css).toMatch(/\.legend-close \{ width: 44px; height: 44px; \}/);
    expect(css).toMatch(/\.ingest-more \{ min-height: 44px;/);
    expect(css).toMatch(/\.tag-chip \{ min-height: 44px;/);
  });
  it("UX review #7 (round 2): ingest row, Welcome Help link and Observatory controls reach 44 px", () => {
    expect(css).toMatch(/\.ingest \.row button \{ min-height: 44px; \}/);
    expect(css).toMatch(/\.ingest \.tag-row \.tag-input \{ min-height: 44px; \}/);
    expect(css).toMatch(/\.welcome-help-link \{ min-height: 44px; \}/);
    expect(css).toMatch(/\.obs-chip, \.obs-retry, \.obs-primary, \.obs-enter, \.obs-answer-send, \.obs-quest \{ min-height: 44px; \}/);
    expect(css).toMatch(/\.obs-close, \.obs-search \{ min-width: 44px; min-height: 44px; \}/);
    // phones: the suggested-tag chips scroll in one row instead of stacking
    expect(css).toMatch(/\.ingest \.tag-row \{\s*flex-wrap: nowrap;\s*overflow-x: auto;/);
  });
});
