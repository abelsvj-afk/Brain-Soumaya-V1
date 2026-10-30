import { describe, expect, it } from "vitest";
import { PLACE_LORE, PLACE_LORE_FOR } from "./placeLore.js";
import { STORY_TRIGGERS } from "./storyTriggers.js";

describe("places with a past", () => {
  it("has unique ids, a short passage, no numbers, nothing that scores or gates", () => {
    expect(new Set(PLACE_LORE.map((p) => p.id)).size).toBe(PLACE_LORE.length);
    for (const p of PLACE_LORE) {
      expect(p.text.split(/\s+/).length, p.id).toBeLessThanOrEqual(55);
      expect(p.text, p.id).not.toMatch(/\d/);
      expect(p.text + p.title, p.id).not.toMatch(/\b(locked|unlocked|complete|percent|score|reward|quest)\b|%/i);
    }
  });
  it("is anchored only to landmarks the lore spots already measured in a real scene (or the garden's tree)", () => {
    for (const p of PLACE_LORE) {
      if (p.origin) continue;
      const measured = STORY_TRIGGERS.some((t) => t.world === p.world && t.spot?.place === p.place);
      expect(measured, `${p.id}: ${p.place} is not a measured landmark in ${p.world}`).toBe(true);
    }
  });
  it("every world with a landmark lore has at least one passage, and Eternity (no landmarks) has none", () => {
    for (const w of ["great-station", "deep-past", "scale", "quiet-archive", "people", "growing-place"]) expect(PLACE_LORE_FOR(w).length, w).toBeGreaterThan(0);
    expect(PLACE_LORE_FOR("eternity")).toHaveLength(0);
  });
});
