import { describe, expect, it } from "vitest";
import { WORLD_PURPOSE, purposeSeenKey, worldPurpose } from "./worldPurpose.js";

describe("worldPurpose (audit X4)", () => {
  it("every world that can be visited says what it is for", () => {
    for (const w of ["great-station", "growing-place", "deep-past", "people", "quiet-archive", "scale", "eternity"]) {
      expect(worldPurpose(w)!.length).toBeGreaterThan(30);
    }
    expect(Object.keys(WORLD_PURPOSE)).toHaveLength(12);
  });
  it("home and unknown worlds say nothing", () => {
    expect(worldPurpose("home")).toBeNull();
    expect(worldPurpose(undefined)).toBeNull();
  });
  it("is remembered per world", () => {
    expect(purposeSeenKey("scale")).not.toBe(purposeSeenKey("people"));
  });
});
