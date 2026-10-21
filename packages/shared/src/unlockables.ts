/**
 * The Unlockables catalog — the SINGLE SOURCE OF TRUTH for which cosmetic
 * items exist, what category they belong to, and what earning them takes
 * (IM-133, governing doc: docs/UNLOCKABLES.md).
 *
 * Until this module existed the only gating in the app was ad-hoc inside
 * HangarPanel.tsx (memory-count thresholds + achievement ids read inline),
 * and the music playlist was explicitly ungated ("for now the whole list is
 * available in every brain" — graph/audio.ts). Server + web + the Hangar /
 * Music UIs all read THIS catalog so they can never drift apart again (the
 * IM-93 Codex drift is the cautionary tale; codex.ts in this package is the
 * pattern this file mirrors).
 *
 * Design (from docs/UNLOCKABLES.md):
 *  - Content is earned, not bought. Conditions draw only from signals the
 *    app already computes: memory count (the Pilot Rank ladder), the
 *    daily-tending streak, the earned-achievement set, and Codex completion.
 *  - Unlocked state is computed client-side from those stats — no server
 *    round-trip for a cosmetic gate. `isUnlocked(item, stats)` is pure.
 *  - The user starts with 1 song and unlocks the rest (docs, Music row).
 *  - A dev / owner override (`brain.devUnlockAll` in localStorage) makes
 *    `isUnlocked()` always return true so testing is never blocked. It is
 *    DEV-ONLY: nothing in the normal UI sets it.
 *
 * Threshold provenance — every condition below is one of:
 *  (a) DOC-PINNED: stated in docs/UNLOCKABLES.md (start-with-1-song; streak
 *      milestones; Codex completion → the rarest scenery), or
 *  (b) CODE-PINNED: the exact threshold / achievement id HangarPanel.tsx
 *      already enforced ad-hoc (the documented-in-code reality — this
 *      catalog preserves it verbatim, including the legacy achievement ids
 *      Hangar honours alongside the count thresholds), or
 *  (c) ASSUMPTION: the docs under-specify it; flagged inline with
 *      "ASSUMPTION" and recorded in the CL-17b report. Music thresholds are
 *      the only (c) entries: the docs say tracks unlock via the Pilot Rank
 *      ladder ("each rank can unlock a track") without naming ranks, so
 *      Slow Tide sits at the Pilot rank (25 memories) and Interstellar at
 *      the Captain rank (100 memories) — both are real rank.ts tiers.
 */

/** The unlockable categories (docs/UNLOCKABLES.md, "What's unlockable"). */
export type UnlockCategory = "music" | "ship" | "trail" | "figurine" | "scenery";

/**
 * The stats an unlock condition is evaluated against. Every field is a
 * signal the web app already has in hand (App state: graph nodes/links,
 * the streak endpoint, the persisted achievement set, the live Codex):
 * no new fetch is needed to supply this shape.
 */
export interface UnlockStats {
  /** Real memory count (nodes with kind !== "action" — the count HangarPanel receives as its memoriesCount prop and the achievements context uses). */
  memoriesCount: number;
  /** Total graph edge count. */
  linksCount: number;
  /** Current daily-tending streak in days (Streak.current). */
  streakCurrent: number;
  /** Best daily-tending streak ever (Streak.best). Streak conditions read max(current, best), mirroring achievements.ts consistentDays(). */
  streakBest: number;
  /** Ids of achievements this brain has earned (the persisted set ∪ currently satisfied). */
  achievementIds: ReadonlySet<string> | readonly string[];
  /** Codex completion, 0..100 (codexProgress().pct in the web codex). */
  codexPct: number;
}

/** A zeroed stats snapshot: a brand-new brain. Only `always` items unlock. */
export const EMPTY_UNLOCK_STATS: UnlockStats = {
  memoriesCount: 0,
  linksCount: 0,
  streakCurrent: 0,
  streakBest: 0,
  achievementIds: [],
  codexPct: 0,
};

/**
 * An unlock requirement, expressed against UnlockStats. `anyOf` exists
 * because Hangar's existing gates are disjunctions (a count threshold OR a
 * legacy achievement id for the same item) and that reality must survive
 * the migration onto this system unchanged.
 */
export type UnlockCondition =
  | { kind: "always" }
  | { kind: "memories"; count: number }
  | { kind: "streak"; days: number }
  | { kind: "links"; count: number }
  | { kind: "achievement"; achievementId: string }
  | { kind: "codex"; pct: number }
  | { kind: "anyOf"; conditions: readonly UnlockCondition[] };

export interface UnlockableItem {
  /** Stable catalog id, `<category>-<equipValue-ish>` — never reuse. */
  id: string;
  category: UnlockCategory;
  /** Human label, as shown in the picker / Hangar. */
  label: string;
  /** Short human description of the item itself. */
  description: string;
  /**
   * The value the consuming UI stores / selects by: the TRACKS id for
   * music, the localStorage ship/trail/figurine value for Hangar items.
   * This is the join key between the catalog and the existing UI state.
   */
  equipValue: string;
  /** Bundled asset path, where the item has one of its own. */
  assetPath?: string;
  /** What earning this item takes. */
  condition: UnlockCondition;
  /** Human requirement copy for locked states ("Unlock at 150 memories."). Never leaks achievement-id vocabulary. */
  requirementText: string;
}

const always: UnlockCondition = { kind: "always" };
const memories = (count: number): UnlockCondition => ({ kind: "memories", count });
const achievement = (achievementId: string): UnlockCondition => ({ kind: "achievement", achievementId });
const codex = (pct: number): UnlockCondition => ({ kind: "codex", pct });
const anyOf = (...conditions: UnlockCondition[]): UnlockCondition => ({ kind: "anyOf", conditions });

/**
 * The catalog. Order matters within a category: it is the display order
 * (music: playlist order; ships/trails/figurines: HangarPanel's order).
 */
export const UNLOCKABLES: readonly UnlockableItem[] = [
  // ---- Music (docs: start with 1 song, unlock the rest) -------------------
  {
    id: "music-deep-space",
    category: "music",
    label: "Deep Space",
    description: "The first loop every pilot starts with.",
    equipValue: "deep-space",
    assetPath: "/ambient-loop.mp3",
    condition: always,
    requirementText: "Available from the start.",
  },
  {
    // ASSUMPTION (docs under-specify the exact rank): Pilot rank tier, 25 memories (rank.ts).
    id: "music-slow-tide",
    category: "music",
    label: "Slow Tide",
    description: "A slower, warmer ambient loop.",
    equipValue: "slow-tide",
    assetPath: "/slow-tide.mp3",
    condition: memories(25),
    requirementText: "Unlock at 25 memories (Pilot rank).",
  },
  {
    // ASSUMPTION (docs under-specify the exact rank): Captain rank tier, 100 memories (rank.ts).
    id: "music-interstellar",
    category: "music",
    label: "Interstellar",
    description: "The deep-space loop for seasoned pilots.",
    equipValue: "interstellar",
    assetPath: "/interstellar.mp3",
    condition: memories(100),
    requirementText: "Unlock at 100 memories (Captain rank).",
  },

  // ---- Ships (HangarPanel "Spaceship Hull"; thresholds CODE-PINNED) -------
  {
    id: "ship-default",
    category: "ship",
    label: "Default Scout Craft",
    description: "Standard reconnaissance vessel.",
    equipValue: "default",
    condition: always,
    requirementText: "Available from the start.",
  },
  {
    id: "ship-organic",
    category: "ship",
    label: "Organic Specimen Hull",
    description: "Biomechanical living ship shell.",
    equipValue: "organic",
    assetPath: "/organic-spaceship.glb",
    // Hangar: unlocked.has("organic_ship_skin") || memoriesCount >= 150
    condition: anyOf(memories(150), achievement("organic_ship_skin")),
    requirementText: "Unlock at 150 memories.",
  },
  {
    id: "ship-fusion-core",
    category: "ship",
    label: "Fusion Core Destroyer",
    description: "Heavy explorer ship with sun reactor.",
    equipValue: "fusion_core",
    // Hangar: unlocked.has("cosmic_voyager")
    condition: achievement("cosmic_voyager"),
    requirementText: "Unlock via the Cosmic Voyager feat (15 travel hops).",
  },
  {
    id: "ship-holographic",
    category: "ship",
    label: "Holographic Sentinel",
    description: "A futuristic wireframe energy projection.",
    equipValue: "holographic",
    // Hangar: unlocked.has("sentinel_command")
    condition: achievement("sentinel_command"),
    requirementText: "Unlock via the Sentinel Command feat (5 beacons).",
  },

  // ---- Trails (HangarPanel "Cosmic Trails"; CODE-PINNED) ------------------
  {
    id: "trail-blue",
    category: "trail",
    label: "Blue Nebula",
    description: "The standard engine trail.",
    equipValue: "blue",
    condition: always,
    requirementText: "Available from the start.",
  },
  {
    id: "trail-neon",
    category: "trail",
    label: "Hyperdrive Neon",
    description: "Pink-cyan hyperdrive flare.",
    equipValue: "neon",
    // Hangar: unlocked.has("consistent_pilot")
    condition: achievement("consistent_pilot"),
    requirementText: "Unlock via the Consistent Pilot feat (3-day streak).",
  },
  {
    id: "trail-gold",
    category: "trail",
    label: "Solar Gold Exhaust",
    description: "Golden solar exhaust.",
    equipValue: "gold",
    // Hangar: unlocked.has("sector_pioneer")
    condition: achievement("sector_pioneer"),
    requirementText: "Unlock via the Sector Pioneer feat (4 memory types).",
  },
  {
    id: "trail-purple",
    category: "trail",
    label: "Void Purple Flare",
    description: "Deep void-purple flare.",
    equipValue: "purple",
    // Hangar: unlocked.has("grand_restorer")
    condition: achievement("grand_restorer"),
    requirementText: "Unlock via the Grand Restorer feat (tend 10 memories).",
  },

  // ---- Figurines (HangarPanel "Deep Space Figurines"; CODE-PINNED) -------
  {
    id: "figurine-none",
    category: "figurine",
    label: "None (Empty Void)",
    description: "An empty slot — just deep space.",
    equipValue: "none",
    condition: always,
    requirementText: "Available from the start.",
  },
  {
    id: "figurine-station",
    category: "figurine",
    label: "Waystation Figurine",
    description: "A miniature of the waystation, mounted in deep space.",
    equipValue: "station",
    assetPath: "/space_station_3.glb",
    condition: always,
    requirementText: "Available from the start.",
  },
  {
    id: "figurine-satellite",
    category: "figurine",
    label: "Aura Beacon Figurine",
    description: "A miniature Aura Beacon, mounted in deep space.",
    equipValue: "satellite",
    assetPath: "/aura-satellite.glb",
    condition: always,
    requirementText: "Available from the start.",
  },
  {
    id: "figurine-star-center",
    category: "figurine",
    label: "Solar Monument (Star Center)",
    description: "A colossal solar monument.",
    equipValue: "star_center",
    assetPath: "/star-center.glb",
    // Hangar: unlocked.has("star_center_figurine") || memoriesCount >= 100
    condition: anyOf(memories(100), achievement("star_center_figurine")),
    requirementText: "Unlock at 100 memories.",
  },
  {
    id: "figurine-quantum-core",
    category: "figurine",
    label: "Quantum Singularity Core",
    description: "A contained quantum singularity.",
    equipValue: "quantum_core",
    // Hangar: unlocked.has("deep_cluster")
    condition: achievement("deep_cluster"),
    requirementText: "Unlock via the Sector Dominion feat (a sector of 6+ memories).",
  },
  {
    id: "figurine-hyper-array",
    category: "figurine",
    label: "Synapse Hyper-Array",
    description: "A vast synapse relay array.",
    equipValue: "hyper_array",
    // Hangar: unlocked.has("galactic_megastructure")
    condition: achievement("galactic_megastructure"),
    requirementText: "Unlock via the Megastructure feat (50 connections).",
  },
  {
    id: "figurine-shield-spire",
    category: "figurine",
    label: "Aegis Shield Spire",
    description: "A protective shield spire.",
    equipValue: "shield_spire",
    // Hangar: unlocked.has("pathfinder_quest")
    condition: achievement("pathfinder_quest"),
    requirementText: "Unlock via the Pathfinder Quest feat (a path of 5+ connected memories).",
  },

  // ---- Scenery (docs: the rarest scenery as capstone rewards) ------------
  // The black hole and Dyson sphere ARE the Hangar figurines of the same
  // equipValue (both are selectable gated figurines today, rendered as
  // distant background scenery) — one asset, two surfaces, ONE rule: the
  // scenery entry's condition is identical to its figurine twin's, with
  // the docs' Codex-completion capstone path added as an extra way in
  // (an OR branch can only unlock earlier, never re-lock anything).
  {
    id: "figurine-dyson-sphere",
    category: "figurine",
    label: "Dyson Megastructure (Dyson Sphere)",
    description: "A civilization-scale Dyson sphere monument.",
    equipValue: "dyson_sphere",
    assetPath: "/dyson-sphere.glb",
    // Hangar: unlocked.has("dyson_sphere_figurine") || memoriesCount >= 250; docs: Codex completion → rarest scenery.
    condition: anyOf(memories(250), achievement("dyson_sphere_figurine"), codex(100)),
    requirementText: "Unlock at 250 memories, or by completing the Codex.",
  },
  {
    id: "scenery-dyson-sphere",
    category: "scenery",
    label: "Dyson Sphere",
    description: "The Dyson sphere as distant background scenery — the same asset as the Hangar monument.",
    equipValue: "dyson_sphere",
    assetPath: "/dyson-sphere.glb",
    condition: anyOf(memories(250), achievement("dyson_sphere_figurine"), codex(100)),
    requirementText: "Unlock at 250 memories, or by completing the Codex.",
  },
  {
    id: "figurine-blackhole",
    category: "figurine",
    label: "The Singularity (Black Hole)",
    description: "A real black hole with a glowing accretion disk — the rarest monument.",
    equipValue: "blackhole",
    assetPath: "/blackhole.glb",
    // Hangar: unlocked.has("singularity") || memoriesCount >= 365; docs: Codex completion → rarest scenery.
    condition: anyOf(memories(365), achievement("singularity"), codex(100)),
    requirementText: "Unlock at 365 memories, or by completing the Codex.",
  },
  {
    id: "scenery-blackhole",
    category: "scenery",
    label: "Black Hole",
    description: "The Singularity as distant background scenery — the same asset as the Hangar monument.",
    equipValue: "blackhole",
    assetPath: "/blackhole.glb",
    condition: anyOf(memories(365), achievement("singularity"), codex(100)),
    requirementText: "Unlock at 365 memories, or by completing the Codex.",
  },
];

/** Every catalog id, for integrity checks. */
export const UNLOCKABLE_IDS: ReadonlySet<string> = new Set(UNLOCKABLES.map((i) => i.id));

/** Look a catalog item up by id. */
export function getUnlockable(id: string): UnlockableItem | undefined {
  return UNLOCKABLES.find((i) => i.id === id);
}

/** Look a catalog item up by the value its UI stores/selects by. */
export function getUnlockableByEquip(category: UnlockCategory, equipValue: string): UnlockableItem | undefined {
  return UNLOCKABLES.find((i) => i.category === category && i.equipValue === equipValue);
}

/** All catalog items in one category, in display order. */
export function unlockablesByCategory(category: UnlockCategory): UnlockableItem[] {
  return UNLOCKABLES.filter((i) => i.category === category);
}

// ---- The evaluator --------------------------------------------------------

export interface UnlockOptions {
  /**
   * Dev / owner override (docs/UNLOCKABLES.md): while true, isUnlocked()
   * always returns true. DEV-ONLY — see isDevUnlockAllEnabled().
   */
  devUnlockAll?: boolean;
}

function achievementSet(stats: UnlockStats): ReadonlySet<string> {
  return stats.achievementIds instanceof Set ? stats.achievementIds : new Set(stats.achievementIds);
}

/** Pure evaluation of one condition against stats. */
export function evaluateCondition(condition: UnlockCondition, stats: UnlockStats): boolean {
  switch (condition.kind) {
    case "always":
      return true;
    case "memories":
      return stats.memoriesCount >= condition.count;
    case "streak":
      return Math.max(stats.streakCurrent, stats.streakBest) >= condition.days;
    case "links":
      return stats.linksCount >= condition.count;
    case "achievement":
      return achievementSet(stats).has(condition.achievementId);
    case "codex":
      return stats.codexPct >= condition.pct;
    case "anyOf":
      return condition.conditions.some((c) => evaluateCondition(c, stats));
  }
}

/**
 * Is this item unlocked for these stats? Accepts the item or its catalog
 * id (an unknown id fails CLOSED — locked). The dev-unlock-all flag
 * short-circuits everything, per the docs.
 */
export function isUnlocked(item: UnlockableItem | string, stats: UnlockStats, opts?: UnlockOptions): boolean {
  if (opts?.devUnlockAll) return true;
  const resolved = typeof item === "string" ? getUnlockable(item) : item;
  if (!resolved) return false;
  return evaluateCondition(resolved.condition, stats);
}

/** Every catalog item currently unlocked for these stats, in catalog order. */
export function unlockedItems(stats: UnlockStats, opts?: UnlockOptions): UnlockableItem[] {
  return UNLOCKABLES.filter((i) => isUnlocked(i, stats, opts));
}

/** Every catalog item currently locked for these stats, in catalog order. */
export function lockedItems(stats: UnlockStats, opts?: UnlockOptions): UnlockableItem[] {
  return UNLOCKABLES.filter((i) => !isUnlocked(i, stats, opts));
}

/**
 * The "🔓 Unlocked!" detection: items that were locked under `prev` stats
 * and are unlocked under `next` stats. Pure — the celebration plumbing
 * (hook/component in the web app) diffs with this and fires once per item.
 * With dev-unlock-all on for both snapshots nothing is ever "newly"
 * unlocked (everything was already available).
 */
export function newlyUnlocked(prev: UnlockStats, next: UnlockStats, opts?: UnlockOptions): UnlockableItem[] {
  return UNLOCKABLES.filter((i) => !isUnlocked(i, prev, opts) && isUnlocked(i, next, opts));
}

/** Numeric progress toward one condition, or null when it has no numeric scale (achievement gates read 0/1). */
export function conditionProgress(
  condition: UnlockCondition,
  stats: UnlockStats,
): { cur: number; target: number } | null {
  switch (condition.kind) {
    case "always":
      return null;
    case "memories":
      return { cur: Math.min(stats.memoriesCount, condition.count), target: condition.count };
    case "streak": {
      const v = Math.max(stats.streakCurrent, stats.streakBest);
      return { cur: Math.min(v, condition.days), target: condition.days };
    }
    case "links":
      return { cur: Math.min(stats.linksCount, condition.count), target: condition.count };
    case "codex":
      return { cur: Math.min(stats.codexPct, condition.pct), target: condition.pct };
    case "achievement":
      return { cur: achievementSet(stats).has(condition.achievementId) ? 1 : 0, target: 1 };
    case "anyOf": {
      // Report the branch the user is closest to finishing (the Hangar's
      // "112/150" style hint picks the most advanced path in).
      let best: { cur: number; target: number } | null = null;
      for (const c of condition.conditions) {
        const p = conditionProgress(c, stats);
        if (!p) return null;
        if (!best || p.cur / p.target > best.cur / best.target) best = p;
      }
      return best;
    }
  }
}

/** Progress toward an item's unlock, for "cur/target" hints. Null when the item needs no progress (always unlocked). */
export function unlockProgress(item: UnlockableItem, stats: UnlockStats): { cur: number; target: number } | null {
  if (evaluateCondition(item.condition, stats)) return null;
  return conditionProgress(item.condition, stats);
}

// ---- Dev / owner override ---------------------------------------------------

/** localStorage key for the dev-unlock-all flag (docs/UNLOCKABLES.md: `brain.devUnlockAll`). */
export const DEV_UNLOCK_ALL_KEY = "brain.devUnlockAll";

/**
 * Read the dev-unlock-all flag from a Storage-like object (defaults to the
 * global localStorage when present). DEV-ONLY: this exists so the owner +
 * partner keep full access while the gating logic is exercised; no normal
 * UI sets it, and it is off unless explicitly stored as "1"/"true".
 */
export function isDevUnlockAllEnabled(
  storage?: { getItem(key: string): string | null } | null,
): boolean {
  try {
    const s =
      storage ??
      (typeof globalThis !== "undefined"
        ? (globalThis as { localStorage?: { getItem(key: string): string | null } }).localStorage
        : undefined);
    if (!s) return false;
    const v = s.getItem(DEV_UNLOCK_ALL_KEY);
    return v === "1" || v === "true";
  } catch {
    return false;
  }
}
