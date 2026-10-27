import { describe, it, expect } from "vitest";
import {
  RELICS,
  RELIC_BY_ID,
  RELIC_CODEX_KEYS,
  discoverableRelics,
  eternityGateOpen,
  relicCodexKey,
  relicsForWorld,
} from "@brain/shared";

/**
 * The relic registry contract: fifteen relics, one gate key, the B-01
 * gate rule, and the discoverable/deferred split (8 findable today in
 * the three built worlds + the Witness in the Deep Past; 7 waiting for
 * People / Scale / Quiet-Archive to exist).
 */
describe("relic registry", () => {
  it("holds all fifteen relics, each with lore, place, asset, and tris", () => {
    expect(RELICS).toHaveLength(15);
    const ids = new Set<string>();
    for (const r of RELICS) {
      expect(r.id).toBeTruthy();
      expect(ids.has(r.id)).toBe(false);
      ids.add(r.id);
      expect(r.name).toBeTruthy();
      expect(r.lore).toBeTruthy();
      expect(r.place).toBeTruthy();
      expect(r.glimmer).toBeTruthy();
      expect(r.assetUrl).toBe(`/relics/${r.id}-slim.glb`);
      expect(r.tris).toBeGreaterThan(0);
      expect(RELIC_BY_ID.get(r.id)).toBe(r);
      expect(relicCodexKey(r.id)).toBe(`relic-${r.id}`);
    }
    expect(new Set(RELIC_CODEX_KEYS).size).toBe(15);
  });

  it("places two relics per built world, three + the Witness in the Deep Past", () => {
    expect(relicsForWorld("great-station").map((r) => r.id)).toEqual([
      "harbor-nail",
      "mooring-ring",
    ]);
    expect(relicsForWorld("growing-place").map((r) => r.id)).toEqual([
      "dawn-leaf",
      "witness-seed",
    ]);
    expect(relicsForWorld("deep-past").map((r) => r.id)).toEqual([
      "first-light-shard",
      "basin-stone",
      "lantern-of-keeping",
      "witness-without-a-name",
    ]);
  });

  it("names exactly one gate key: the Witness Without a Name", () => {
    const keys = RELICS.filter((r) => r.gateKey);
    expect(keys.map((r) => r.id)).toEqual(["witness-without-a-name"]);
  });

  it("marks eight relics discoverable and seven deferred to unbuilt worlds", () => {
    expect(discoverableRelics().map((r) => r.id)).toEqual([
      "harbor-nail",
      "mooring-ring",
      "dawn-leaf",
      "witness-seed",
      "first-light-shard",
      "basin-stone",
      "lantern-of-keeping",
      "witness-without-a-name",
    ]);
    const deferred = RELICS.filter((r) => !r.discoverable);
    expect(deferred.map((r) => `${r.id}@${r.world}`).sort()).toEqual([
      "hearth-ember@people",
      "star-hanger@scale",
      "stillness-seal@quiet-archive",
      "sunward-compass@scale",
      "thread-of-many@people",
      "unnumbered-fragment@scale",
      "unopened-fold@quiet-archive",
    ]);
  });

  it("B-01: the gate opens on the Witness plus any two other relics", () => {
    expect(eternityGateOpen([])).toBe(false);
    expect(eternityGateOpen(["witness-without-a-name"])).toBe(false);
    expect(
      eternityGateOpen(["witness-without-a-name", "harbor-nail"]),
    ).toBe(false);
    expect(
      eternityGateOpen([
        "witness-without-a-name",
        "harbor-nail",
        "dawn-leaf",
      ]),
    ).toBe(true);
    expect(
      eternityGateOpen(
        new Set(["witness-without-a-name", "basin-stone", "star-hanger"]),
      ),
    ).toBe(true);
    // Two relics without the key never open it.
    expect(eternityGateOpen(["harbor-nail", "dawn-leaf"])).toBe(false);
    // Unknown ids do not count toward the two.
    expect(
      eternityGateOpen(["witness-without-a-name", "harbor-nail", "not-a-relic"]),
    ).toBe(false);
  });
});
