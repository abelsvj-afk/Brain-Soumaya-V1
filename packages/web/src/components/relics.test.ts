import { describe, it, expect } from "vitest";
import {
  RELICS,
  RELIC_ANCHOR_POINTS,
  RELIC_ANCHOR_RADIUS,
  RELIC_BY_ID,
  RELIC_CODEX_KEYS,
  RELIC_THREADS,
  WORLD_BEARING_SECTORS,
  discoverableRelics,
  eternityGateOpen,
  relicCodexKey,
  relicsForWorld,
} from "@brain/shared";

/**
 * The relic registry contract: fifteen relics, one gate key, the B-01
 * gate rule, and the discoverable/deferred split (10 findable today in
 * the four built worlds + the Witness in the Deep Past; 5 waiting for
 * Scale / Quiet-Archive to exist — People opened with PR #114).
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
    expect(relicsForWorld("people").map((r) => r.id)).toEqual([
      "hearth-ember",
      "thread-of-many",
    ]);
  });

  it("names exactly one gate key: the Witness Without a Name", () => {
    const keys = RELICS.filter((r) => r.gateKey);
    expect(keys.map((r) => r.id)).toEqual(["witness-without-a-name"]);
  });

  it("marks ten relics discoverable and five deferred to unbuilt worlds", () => {
    expect(discoverableRelics().map((r) => r.id)).toEqual([
      "harbor-nail",
      "mooring-ring",
      "dawn-leaf",
      "witness-seed",
      "first-light-shard",
      "basin-stone",
      "lantern-of-keeping",
      "witness-without-a-name",
      "hearth-ember",
      "thread-of-many",
    ]);
    const deferred = RELICS.filter((r) => !r.discoverable);
    expect(deferred.map((r) => `${r.id}@${r.world}`).sort()).toEqual([
      "star-hanger@scale",
      "stillness-seal@quiet-archive",
      "sunward-compass@scale",
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

/**
 * The I-1 vocabulary (implementation design §3): tier classes, lore-layer
 * structures, and server-known anchor points — data only, shipped dark.
 * NO lore text exists yet anywhere in the new structures (O-R1: the
 * owner approves every canon line before it becomes text). The tier
 * classes themselves were ruled by the O-R5 worksheet session (tier
 * decisions, 2026-10-30): all fifteen are assigned — 4 Keystones,
 * 3 Seeds, 8 Legacies — and this parity test now pins the full map.
 */
describe("relic vocabulary (I-1)", () => {
  it("assigns every relic its ruled tier class — the full O-R5 map, none null", () => {
    expect(RELICS.map((r) => `${r.id}:${r.tierClass}`)).toEqual([
      "harbor-nail:keystone",
      "mooring-ring:seed",
      "dawn-leaf:seed",
      "witness-seed:keystone",
      "first-light-shard:legacy",
      "basin-stone:legacy",
      "lantern-of-keeping:legacy",
      "witness-without-a-name:keystone",
      "hearth-ember:legacy",
      "thread-of-many:keystone",
      "star-hanger:legacy",
      "sunward-compass:legacy",
      "stillness-seal:seed",
      "unopened-fold:legacy",
      "unnumbered-fragment:legacy",
    ]);
    for (const r of RELICS) {
      // The field is PRESENT on every def — a stated value, never a
      // missing property a consumer could misread as a class.
      expect("tierClass" in r, r.id).toBe(true);
      expect(r.tierClass, r.id).not.toBeNull();
    }
    // The naming trap, ruled: class follows nature, not name — the
    // relic NAMED Witness Seed is a Keystone, and no relic with
    // "Seed" in its name is in the Seed class.
    expect(RELIC_BY_ID.get("witness-seed")!.tierClass).toBe("keystone");
  });

  it("carries no lore text in the new structures (structure only)", () => {
    for (const r of RELICS) {
      expect(r.loreStirring, r.id).toBeUndefined();
      expect(r.lore.length, r.id).toBeGreaterThan(0); // L2 predates I-1
    }
    expect(RELIC_THREADS).toEqual([]);
    const worlds = Object.keys(WORLD_BEARING_SECTORS).sort();
    expect(worlds).toEqual([
      "deep-past",
      "great-station",
      "growing-place",
      "people",
      "quiet-archive",
      "scale",
    ]);
    for (const sectors of Object.values(WORLD_BEARING_SECTORS)) {
      expect(sectors).toEqual([]);
    }
  });

  it("gives every placed relic a server-known anchor SET (I-2); the unplaced get empty sets", () => {
    // The FIRST anchor key per relic is a stable id — provenance records
    // cite anchor keys, so the first entries are pinned exactly, not just
    // by prefix. Set sizes follow the design's §3.2 minimums: a set must
    // hold at least the definition's copy limit (7 public, 3
    // Eternity-class) or at least 3 for private-class relics, and every
    // pair of anchors in a set sits at least a claim diameter apart
    // (2 × RELIC_ANCHOR_RADIUS) so two copies never overlap.
    const expectedKeys: Record<string, string> = {
      "harbor-nail": "harbor-nail:lower-rim",
      "mooring-ring": "mooring-ring:harbor-road",
      "dawn-leaf": "dawn-leaf:witness-roots",
      "witness-seed": "witness-seed:trunk-base",
      "first-light-shard": "first-light-shard:basin-floor",
      "basin-stone": "basin-stone:basin-floor",
      "lantern-of-keeping": "lantern-of-keeping:lowest-alcove",
      "witness-without-a-name": "witness-without-a-name:basin-center",
      "hearth-ember": "hearth-ember:first-hearths",
      "thread-of-many": "thread-of-many:field-edge",
    };
    const minSizes: Record<string, number> = {
      "harbor-nail": 7, "mooring-ring": 7,
      "witness-without-a-name": 3, "unnumbered-fragment": 3,
    };
    for (const r of RELICS) {
      const points = RELIC_ANCHOR_POINTS[r.id];
      expect(points, r.id).toBeDefined();
      if (!r.discoverable) {
        expect(points, r.id).toEqual([]);
        continue;
      }
      expect(points!.length, r.id).toBeGreaterThanOrEqual(minSizes[r.id] ?? 3);
      const keys = points!.map((p) => p.anchorKey);
      expect(new Set(keys).size, r.id).toBe(keys.length);
      const a = points![0]!;
      expect(a.anchorKey).toBe(expectedKeys[r.id]);
      expect(a.world).toBe(r.world);
      // The first anchor's placeName is the registry's own place words.
      expect(a.placeName).toBe(r.place);
      for (const p of points!) {
        expect(p.world, r.id).toBe(r.world);
        expect(p.radius, r.id).toBe(RELIC_ANCHOR_RADIUS);
        expect(p.placeText, r.id).toBeUndefined();
        for (const v of p.position) expect(Number.isFinite(v)).toBe(true);
      }
      for (let i = 0; i < points!.length; i++) {
        for (let j = i + 1; j < points!.length; j++) {
          const d = Math.hypot(
            points![i]!.position[0] - points![j]!.position[0],
            points![i]!.position[1] - points![j]!.position[1],
            points![i]!.position[2] - points![j]!.position[2],
          );
          expect(d, `${r.id} anchors ${i}/${j}`).toBeGreaterThanOrEqual(2 * RELIC_ANCHOR_RADIUS);
        }
      }
    }
  });

  it("the anchor-points record covers exactly the fifteen relics — no stray keys", () => {
    expect(Object.keys(RELIC_ANCHOR_POINTS).sort()).toEqual(
      RELICS.map((r) => r.id).sort(),
    );
  });
});
