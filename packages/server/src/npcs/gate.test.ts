import { describe, it, expect } from "vitest";
import { checkNpcEternityGate } from "./gate.js";

/**
 * The NPC side of B-01 (design note §5): the gate rule applies to NPCs
 * too — the Witness Without a Name plus any two other relics opens the
 * gate, and once opened it stays open. Pure checks: holdings in, verdict
 * out. The holdings themselves live in the NPC's own separate pool
 * (repo.test coverage in loop.test.ts); this file proves the rule.
 */
describe("checkNpcEternityGate", () => {
  it("closed with no holdings — and says so honestly", () => {
    const g = checkNpcEternityGate([], false);
    expect(g.open).toBe(false);
    expect(g.hasKey).toBe(false);
    expect(g.othersHeld).toBe(0);
    expect(g.othersNeeded).toBe(2);
    expect(g.missingPlain).toContain("no relics at all");
  });

  it("closed with the key but no others", () => {
    const g = checkNpcEternityGate(["witness-without-a-name"], false);
    expect(g.open).toBe(false);
    expect(g.hasKey).toBe(true);
    expect(g.othersNeeded).toBe(2);
    expect(g.missingPlain).toContain("still need 2 more relics");
  });

  it("closed with others but no key — the key is not optional", () => {
    const g = checkNpcEternityGate(["mooring-ring", "harbor-nail", "dawn-leaf"], false);
    expect(g.open).toBe(false);
    expect(g.hasKey).toBe(false);
    expect(g.othersHeld).toBe(3);
    expect(g.missingPlain).toContain("not the Witness Without a Name");
  });

  it("opens with the key plus any two others", () => {
    const g = checkNpcEternityGate(["witness-without-a-name", "mooring-ring", "dawn-leaf"], false);
    expect(g.open).toBe(true);
    expect(g.othersHeld).toBe(2);
    expect(g.othersNeeded).toBe(0);
  });

  it("duplicate holdings count once", () => {
    const g = checkNpcEternityGate(
      ["witness-without-a-name", "mooring-ring", "mooring-ring", "mooring-ring"],
      false,
    );
    expect(g.open).toBe(false);
    expect(g.othersHeld).toBe(1);
  });

  it("stays open once opened, even with empty holdings", () => {
    const g = checkNpcEternityGate([], true);
    expect(g.open).toBe(true);
    expect(g.missingPlain).toContain("stays open");
  });
});
