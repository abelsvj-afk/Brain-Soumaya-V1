import { describe, it, expect } from "vitest";
import { PEOPLE_EXTERNAL_ASSETS, PEOPLE_FORMS, PEOPLE_HEARTH, PEOPLE_PALETTE } from "./peopleAssets.js";
import { PEOPLE_BUDGET } from "./peopleLayout.js";

describe("peopleAssets (P3-3)", () => {
  it("ships no external asset — procedural field + already-credited HYG only", () => {
    expect(PEOPLE_EXTERNAL_ASSETS).toEqual([]);
  });

  it("every light kind has a distinct form, and the heaviest stays inside the budget at scale", () => {
    const forms = Object.values(PEOPLE_FORMS);
    expect(new Set(forms.map((f) => f.geometry)).size).toBe(4);
    const heaviest = Math.max(...forms.map((f) => f.trisPerInstance));
    // 2,000 lights of the heaviest form + hearths must fit the 400k ceiling.
    expect(heaviest * 2000 + PEOPLE_HEARTH.trisPerInstance * 100).toBeLessThanOrEqual(PEOPLE_BUDGET.maxTris);
  });

  it("the palette is amber-warm on dark — one light for every person, no rank in color", () => {
    expect(PEOPLE_PALETTE.hearth).toBe(0xffc98a);
    expect(PEOPLE_PALETTE.memory).toBe(0xffd9a0);
    expect(PEOPLE_PALETTE.ground).toBe(0x1a120c);
    // The ground is dark and the lights are warm: the field reads as lights at dusk.
    expect(PEOPLE_PALETTE.ground).toBeLessThan(PEOPLE_PALETTE.memory);
  });
});
