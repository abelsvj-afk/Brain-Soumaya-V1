import { describe, it, expect } from "vitest";
import { deriveCoolingConcern, connectionReaction, MASS_COOLING_MIN_COUNT } from "./coolingConcern.js";
import { COOLING_ENTROPY } from "@brain/shared";

const cold = { entropy: COOLING_ENTROPY + 0.1 };
const warm = { entropy: 0 };

describe("deriveCoolingConcern (IM-139 — real data only)", () => {
  it("no cooling memories → no concern, no fabricated message", () => {
    const c = deriveCoolingConcern([warm, warm, warm]);
    expect(c).toMatchObject({ coolingCount: 0, total: 3, massCooling: false, message: null });
  });

  it("a few cooling memories is not a MASS event", () => {
    const nodes = [cold, cold, ...Array.from({ length: 8 }, () => warm)];
    const c = deriveCoolingConcern(nodes);
    expect(c.coolingCount).toBe(2);
    expect(c.massCooling).toBe(false);
    expect(c.message).toBeNull();
  });

  it("many cooling but a small share of a big galaxy is not mass cooling", () => {
    const nodes = [...Array.from({ length: 6 }, () => cold), ...Array.from({ length: 40 }, () => warm)];
    expect(deriveCoolingConcern(nodes).massCooling).toBe(false);
  });

  it("mass cooling fires with the real count in her message", () => {
    const nodes = [...Array.from({ length: MASS_COOLING_MIN_COUNT }, () => cold), warm, warm];
    const c = deriveCoolingConcern(nodes);
    expect(c.massCooling).toBe(true);
    expect(c.message).toContain(String(MASS_COOLING_MIN_COUNT));
    expect(c.coolingFrac).toBeCloseTo(MASS_COOLING_MIN_COUNT / (MASS_COOLING_MIN_COUNT + 2));
  });

  it("action items never count as cooling memories", () => {
    const nodes = Array.from({ length: 6 }, () => ({ kind: "action", entropy: 1 }));
    const c = deriveCoolingConcern(nodes);
    expect(c.total).toBe(0);
    expect(c.massCooling).toBe(false);
  });

  it("empty galaxy → zeros, no message", () => {
    expect(deriveCoolingConcern([])).toMatchObject({ coolingCount: 0, total: 0, message: null });
  });
});

describe("connectionReaction", () => {
  it("scales with the real link count and stays silent at zero", () => {
    expect(connectionReaction(0)).toBeNull();
    expect(connectionReaction(1)).toContain("new thread");
    expect(connectionReaction(3)).toContain("3 of your memories");
  });
});
