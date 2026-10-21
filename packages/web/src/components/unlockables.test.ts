import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EMPTY_UNLOCK_STATS,
  UNLOCKABLES,
  UNLOCKABLE_IDS,
  DEV_UNLOCK_ALL_KEY,
  evaluateCondition,
  getUnlockable,
  getUnlockableByEquip,
  isDevUnlockAllEnabled,
  isUnlocked,
  lockedItems,
  newlyUnlocked,
  unlockProgress,
  unlockedItems,
  unlockablesByCategory,
  type UnlockStats,
} from "@brain/shared";
import { TRACKS } from "../graph/audio.js";
import {
  buildUnlockStats,
  firstUnlockedTrackIndex,
  isTrackUnlocked,
  nextUnlockedTrackIndex,
  unlockableForTrack,
} from "./unlockables.js";
import type { GraphNode } from "@brain/shared";

const stats = (over: Partial<UnlockStats> = {}): UnlockStats => ({ ...EMPTY_UNLOCK_STATS, ...over });
const TRACK_IDS = TRACKS.map((t) => t.id);

/**
 * IM-133: the Unlockables enforcement system. Before this cluster there was
 * NO catalog in @brain/shared and NO isUnlocked anywhere — the music list
 * was explicitly ungated and the Hangar gated ad-hoc inline. These tests
 * pin the catalog to the documented-in-code reality (HangarPanel's exact
 * thresholds/achievement ids) so the system CL-12 migrates the Hangar onto
 * can never silently drift from what users already experience.
 */
describe("Unlockables catalog integrity (IM-133)", () => {
  it("has unique ids and unique (category, equipValue) pairs", () => {
    expect(UNLOCKABLES.length).toBe(new Set(UNLOCKABLES.map((i) => i.id)).size);
    const pairs = UNLOCKABLES.map((i) => `${i.category}:${i.equipValue}`);
    expect(pairs.length).toBe(new Set(pairs).size);
    for (const i of UNLOCKABLES) expect(UNLOCKABLE_IDS.has(i.id)).toBe(true);
  });

  it("every item has human requirement copy with no achievement-id leakage", () => {
    for (const i of UNLOCKABLES) {
      expect(i.label.length).toBeGreaterThan(0);
      expect(i.requirementText.length).toBeGreaterThan(0);
      // Requirement copy must not leak raw achievement ids (the Hangar's old
      // "Sector Pioneer path" vocabulary problem, IM-101) — ids are snake_case.
      expect(i.requirementText).not.toMatch(/[a-z]+_[a-z]+/);
    }
  });

  it("every gated value the Hangar offers today resolves in the catalog", () => {
    // CL-12 (IM-133 Hangar portion): the Hangar no longer hard-codes its
    // gated values — it renders FROM this catalog (unlockablesByCategory +
    // isUnlocked), so the drift this test originally scraped HangarPanel's
    // source to catch is impossible by construction. What must still hold:
    // (a) the Hangar really is catalog-driven, and (b) every gated value
    // the pre-migration Hangar offered still resolves in the catalog.
    const src = readFileSync(resolve(process.cwd(), "src/components/HangarPanel.tsx"), "utf8");
    expect(src).toContain("unlockablesByCategory");
    expect(src).toContain("isUnlocked");
    const allEquip = new Set(UNLOCKABLES.map((i) => i.equipValue));
    for (const v of ["organic", "fusion_core", "holographic", "neon", "gold", "purple", "star_center", "dyson_sphere", "blackhole"]) {
      expect(allEquip.has(v), v).toBe(true);
    }
  });

  it("every playlist track resolves to a music catalog item (and vice versa)", () => {
    for (const t of TRACKS) {
      const item = unlockableForTrack(t.id);
      expect(item, `track ${t.id}`).toBeDefined();
      expect(item!.assetPath).toBe(t.src);
    }
    expect(unlockablesByCategory("music").map((i) => i.equipValue)).toEqual(TRACK_IDS);
  });

  it("covers all five doc categories", () => {
    for (const c of ["music", "ship", "trail", "figurine", "scenery"] as const) {
      expect(unlockablesByCategory(c).length, c).toBeGreaterThan(0);
    }
  });

  it("scenery twins agree with their figurine twins (one asset, one rule)", () => {
    for (const equip of ["dyson_sphere", "blackhole"]) {
      const fig = getUnlockableByEquip("figurine", equip)!;
      const scene = getUnlockableByEquip("scenery", equip)!;
      for (const s of [stats(), stats({ memoriesCount: 100 }), stats({ memoriesCount: 250 }), stats({ memoriesCount: 365 }), stats({ codexPct: 100 })]) {
        expect(isUnlocked(scene, s)).toBe(isUnlocked(fig, s));
      }
    }
  });
});

describe("isUnlocked evaluator (IM-133)", () => {
  it("a new brain starts with exactly the always items — including exactly 1 song", () => {
    const s = stats();
    const music = unlockablesByCategory("music").filter((i) => isUnlocked(i, s));
    expect(music.map((i) => i.equipValue)).toEqual(["deep-space"]);
    expect(isUnlocked("ship-default", s)).toBe(true);
    expect(isUnlocked("trail-blue", s)).toBe(true);
    for (const equip of ["none", "station", "satellite"]) {
      expect(isUnlocked(getUnlockableByEquip("figurine", equip)!, s)).toBe(true);
    }
    expect(unlockedItems(s).length).toBeGreaterThan(0);
    expect(lockedItems(s).length).toBeGreaterThan(0);
  });

  it("preserves HangarPanel's memory-count thresholds exactly", () => {
    const cases: [string, number][] = [
      ["ship-organic", 150],
      ["figurine-star-center", 100],
      ["figurine-dyson-sphere", 250],
      ["figurine-blackhole", 365],
    ];
    for (const [id, at] of cases) {
      expect(isUnlocked(id, stats({ memoriesCount: at - 1 })), `${id} @ ${at - 1}`).toBe(false);
      expect(isUnlocked(id, stats({ memoriesCount: at })), `${id} @ ${at}`).toBe(true);
    }
  });

  it("preserves HangarPanel's achievement gates exactly", () => {
    const cases: [string, string][] = [
      ["ship-fusion-core", "cosmic_voyager"],
      ["ship-holographic", "sentinel_command"],
      ["trail-neon", "consistent_pilot"],
      ["trail-gold", "sector_pioneer"],
      ["trail-purple", "grand_restorer"],
      ["figurine-quantum-core", "deep_cluster"],
      ["figurine-hyper-array", "galactic_megastructure"],
      ["figurine-shield-spire", "pathfinder_quest"],
    ];
    for (const [id, achv] of cases) {
      expect(isUnlocked(id, stats()), `${id} locked`).toBe(false);
      expect(isUnlocked(id, stats({ achievementIds: [achv] })), `${id} via ${achv}`).toBe(true);
      // A different achievement must not open it.
      expect(isUnlocked(id, stats({ achievementIds: ["connector"] })), `${id} wrong achv`).toBe(false);
    }
  });

  it("honours the legacy achievement ids Hangar honours alongside counts", () => {
    expect(isUnlocked("ship-organic", stats({ achievementIds: ["organic_ship_skin"] }))).toBe(true);
    expect(isUnlocked("figurine-star-center", stats({ achievementIds: ["star_center_figurine"] }))).toBe(true);
    expect(isUnlocked("figurine-dyson-sphere", stats({ achievementIds: ["dyson_sphere_figurine"] }))).toBe(true);
    expect(isUnlocked("figurine-blackhole", stats({ achievementIds: ["singularity"] }))).toBe(true);
  });

  it("opens the rarest scenery at Codex completion (docs capstone)", () => {
    expect(isUnlocked("scenery-blackhole", stats({ codexPct: 99 }))).toBe(false);
    expect(isUnlocked("scenery-blackhole", stats({ codexPct: 100 }))).toBe(true);
    expect(isUnlocked("scenery-dyson-sphere", stats({ codexPct: 100 }))).toBe(true);
  });

  it("music unlocks the rest of the playlist as the galaxy grows (docs: start with 1)", () => {
    expect(isTrackUnlocked("slow-tide", stats({ memoriesCount: 24 }))).toBe(false);
    expect(isTrackUnlocked("slow-tide", stats({ memoriesCount: 25 }))).toBe(true);
    expect(isTrackUnlocked("interstellar", stats({ memoriesCount: 99 }))).toBe(false);
    expect(isTrackUnlocked("interstellar", stats({ memoriesCount: 100 }))).toBe(true);
  });

  it("streak conditions read max(current, best), links conditions read the edge count", () => {
    expect(evaluateCondition({ kind: "streak", days: 7 }, stats({ streakCurrent: 2, streakBest: 7 }))).toBe(true);
    expect(evaluateCondition({ kind: "streak", days: 7 }, stats({ streakCurrent: 6, streakBest: 6 }))).toBe(false);
    expect(evaluateCondition({ kind: "links", count: 50 }, stats({ linksCount: 50 }))).toBe(true);
    expect(evaluateCondition({ kind: "links", count: 50 }, stats({ linksCount: 49 }))).toBe(false);
  });

  it("fails closed on unknown ids, and the dev flag opens everything (dev-only)", () => {
    expect(isUnlocked("no-such-item", stats({ memoriesCount: 9999 }))).toBe(false);
    expect(isUnlocked("music-interstellar", stats(), { devUnlockAll: true })).toBe(true);
    expect(isUnlocked("no-such-item", stats(), { devUnlockAll: true })).toBe(true); // docs: isUnlocked() always returns true under the flag
    expect(unlockedItems(stats(), { devUnlockAll: true }).length).toBe(UNLOCKABLES.length);
  });

  it("unlockProgress reports the closest path in for anyOf gates", () => {
    const organic = getUnlockable("ship-organic")!;
    expect(unlockProgress(organic, stats({ memoriesCount: 112 }))).toEqual({ cur: 112, target: 150 });
    expect(unlockProgress(organic, stats({ memoriesCount: 150 }))).toBeNull(); // already unlocked
    expect(unlockProgress(getUnlockable("ship-default")!, stats())).toBeNull();
  });
});

describe("newlyUnlocked — the 🔓 detection diff (IM-133)", () => {
  it("reports exactly the items that flipped locked → unlocked", () => {
    const fresh = newlyUnlocked(stats({ memoriesCount: 24 }), stats({ memoriesCount: 25 }));
    expect(fresh.map((i) => i.id)).toEqual(["music-slow-tide"]);
    const at100 = newlyUnlocked(stats({ memoriesCount: 25 }), stats({ memoriesCount: 100 }));
    expect(at100.map((i) => i.id)).toEqual(["music-interstellar", "figurine-star-center"]);
    expect(newlyUnlocked(stats({ memoriesCount: 100 }), stats({ memoriesCount: 100 }))).toEqual([]);
    expect(newlyUnlocked(stats({ memoriesCount: 100 }), stats({ memoriesCount: 10 }))).toEqual([]);
  });

  it("under dev-unlock-all nothing is ever newly unlocked", () => {
    expect(newlyUnlocked(stats(), stats({ memoriesCount: 500 }), { devUnlockAll: true })).toEqual([]);
  });
});

describe("dev-unlock-all flag (docs: brain.devUnlockAll, dev-only)", () => {
  it("reads only an explicit 1/true from storage", () => {
    const store = (v: string | null) => ({ getItem: (k: string) => (k === DEV_UNLOCK_ALL_KEY ? v : null) });
    expect(isDevUnlockAllEnabled(store("1"))).toBe(true);
    expect(isDevUnlockAllEnabled(store("true"))).toBe(true);
    expect(isDevUnlockAllEnabled(store("0"))).toBe(false);
    expect(isDevUnlockAllEnabled(store(null))).toBe(false);
    expect(isDevUnlockAllEnabled(null)).toBe(false);
    expect(DEV_UNLOCK_ALL_KEY).toBe("brain.devUnlockAll");
  });
});

describe("music gating helpers (IM-133)", () => {
  it("first/next unlocked track skip locked loops and wrap", () => {
    const s0 = stats();
    expect(firstUnlockedTrackIndex(TRACK_IDS, s0)).toBe(0);
    expect(nextUnlockedTrackIndex(0, TRACK_IDS, s0)).toBe(0); // only Deep Space playable
    const s25 = stats({ memoriesCount: 25 });
    expect(nextUnlockedTrackIndex(0, TRACK_IDS, s25)).toBe(1);
    expect(nextUnlockedTrackIndex(1, TRACK_IDS, s25)).toBe(0); // wraps past locked Interstellar
    const s100 = stats({ memoriesCount: 100 });
    expect(nextUnlockedTrackIndex(1, TRACK_IDS, s100)).toBe(2);
    expect(nextUnlockedTrackIndex(2, TRACK_IDS, s100)).toBe(0);
    expect(nextUnlockedTrackIndex(0, TRACK_IDS, s0, { devUnlockAll: true })).toBe(1);
  });

  it("a track with no catalog entry fails closed", () => {
    expect(isTrackUnlocked("no-such-track", stats({ memoriesCount: 9999 }))).toBe(false);
    expect(isTrackUnlocked("no-such-track", stats(), { devUnlockAll: true })).toBe(true);
  });

  it("buildUnlockStats counts memories the way the Hangar prop does (kind !== action)", () => {
    const node = (kind: string) => ({ kind }) as unknown as GraphNode;
    const s = buildUnlockStats({
      nodes: [node("memory"), node("memory"), node("action"), node("moc")],
      linksCount: 7,
      streak: { current: 3, best: 9, today: true },
      achievementIds: new Set(["connector"]),
      codexPct: 42,
    });
    expect(s.memoriesCount).toBe(3);
    expect(s.linksCount).toBe(7);
    expect(s.streakCurrent).toBe(3);
    expect(s.streakBest).toBe(9);
    expect(s.codexPct).toBe(42);
    expect(isUnlocked("trail-gold", s)).toBe(false);
  });
});
