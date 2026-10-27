import { describe, it, expect } from "vitest";
import { QUIET_ARCHIVE_FORMS, QUIET_ARCHIVE_PALETTE } from "./quietArchiveAssets.js";
import { QUIET_ARCHIVE_BUDGET } from "./quietArchiveLayout.js";

describe("quietArchiveAssets (Wave 2)", () => {
  it("every light kind has a distinct form, and the heaviest stays inside the budget at scale", () => {
    const forms = Object.values(QUIET_ARCHIVE_FORMS);
    expect(new Set(forms.map((f) => f.geometry)).size).toBe(4);
    const heaviest = Math.max(...forms.map((f) => f.trisPerInstance));
    // 2,000 lights of the heaviest form + 20 lamp spheres (192 tris each)
    // must fit the 300k ceiling.
    expect(heaviest * 2000 + 192 * 20).toBeLessThanOrEqual(QUIET_ARCHIVE_BUDGET.maxTris);
  });

  it("the palette is dim cool stillness — one light for every person, no rank in color", () => {
    expect(QUIET_ARCHIVE_PALETTE.lamp).toBe(0xd8c9a3);
    expect(QUIET_ARCHIVE_PALETTE.memory).toBe(0xd8c9a3);
    expect(QUIET_ARCHIVE_PALETTE.ground).toBe(0x141a22);
    // The ground is dark and the lamps are low lamplight: the field reads as lamps at night.
    expect(QUIET_ARCHIVE_PALETTE.ground).toBeLessThan(QUIET_ARCHIVE_PALETTE.memory);
    // Guidance is cyan, and only cyan means navigation truth.
    expect(QUIET_ARCHIVE_PALETTE.guidance).toBe(0x7af9ff);
  });
});
