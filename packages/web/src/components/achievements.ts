import type { GraphNode, Fuel, Streak } from "@brain/shared";
import { buildCodex, codexProgress } from "./codex.js";

/** Codex completion % from an achievement context (the one meta-badge hook). */
function codexPctFrom(c: { memories: GraphNode[]; links: number }): number {
  const codex = buildCodex({
    memories: c.memories.filter((n) => n.kind !== "moc" && n.kind !== "action"),
    constellations: c.memories.filter((n) => n.kind === "moc"),
    links: c.links,
  });
  return codexProgress(codex).pct;
}

/**
 * Achievements = FEATS — things you actively did (kept deliberately disjoint from
 * the Codex, which covers discoveries: see a thing once → entry + lore + fuel).
 * No predicate may exist in both systems, and Pilot Rank is the single
 * memory-count ladder (rank-up is the only count celebration; the Hangar gates
 * its count-based cosmetics on raw counts directly).
 * Pure client-side + offline-safe: each is a predicate over the current
 * galaxy/fuel state. Unlocks are detected in App, persisted per-brain in
 * localStorage, and announced with a toast.
 */
export interface AchievementCtx {
  memories: GraphNode[]; // non-action nodes
  links: number; // edge count
  fuel: Fuel | null;
  linkObjects?: any[]; // full link array for pathfinding
  /** Server-side daily-tending streak (device-independent when available). */
  streak?: Streak | null;
}

/**
 * The active brain id used for per-brain localStorage stats. Mirrors api/client's
 * `brain.spaceId` (set synchronously at login, and the same id the writer in
 * Graph3D keys its `stat.*` counters by), so stat-based achievements always read
 * the bucket the stats were written to. Reading the effect-written `current_space_id`
 * instead caused a startup race + a "demo-space" fallback that never matched the
 * writer — so those achievements could never unlock from real play.
 */
export function statsSpaceId(): string {
  // "default" matches every other signed-out localStorage bucket (Toasts, Inbox,
  // RightDock) — a "legacy" fallback here filed stats in a bucket nothing read.
  try {
    return localStorage.getItem("brain.spaceId") || "default";
  } catch {
    return "default";
  }
}

export interface Achievement {
  id: string;
  name: string;
  icon: string;
  desc: string;
  test: (c: AchievementCtx) => boolean;
  /** Optional numeric progress toward the unlock, for the locked-card hint. */
  progress?: (c: AchievementCtx) => { cur: number; target: number };
}

/**
 * Longest simple path (in nodes) found in the link graph, capped at `cap` —
 * the Pathfinder progress hint. Same defensive shape as the Pathfinder
 * predicate itself: depth-capped DFS with a hard step budget, so a dense
 * brain can never hang the panel; worst case the hint under-reports.
 */
export function pathDepth(c: AchievementCtx, cap = 5): number {
  if (!c.linkObjects || c.linkObjects.length === 0) return 0;
  const adj = new Map<number, Set<number>>();
  for (const l of c.linkObjects) {
    const s = typeof l.source === "object" && l.source !== null ? l.source.id : l.source;
    const t = typeof l.target === "object" && l.target !== null ? l.target.id : l.target;
    if (s == null || t == null) continue;
    if (!adj.has(s)) adj.set(s, new Set());
    if (!adj.has(t)) adj.set(t, new Set());
    adj.get(s)!.add(t);
    adj.get(t)!.add(s);
  }
  let best = adj.size > 0 ? 1 : 0;
  let budget = 20000;
  const visited = new Set<number>();
  const dfs = (node: number, depth: number): boolean => {
    if (depth > best) best = depth;
    if (depth >= cap) return true;
    if (--budget <= 0) return false;
    visited.add(node);
    for (const n of adj.get(node) || []) {
      if (!visited.has(n) && dfs(n, depth + 1)) {
        visited.delete(node);
        return true;
      }
    }
    visited.delete(node);
    return false;
  };
  for (const start of adj.keys()) {
    if (budget <= 0 || best >= cap) break;
    dfs(start, 1);
  }
  return best;
}

/** Best-known distinct-day engagement: server streak first, created-days fallback. */
function consistentDays(c: AchievementCtx): number {
  const fromStreak = Math.max(c.streak?.best ?? 0, c.streak?.current ?? 0);
  if (fromStreak > 0) return fromStreak;
  return new Set(
    c.memories.map((m) => m.createdAt?.split("T")[0] || m.occurredAt?.split(" ")[0]).filter(Boolean),
  ).size;
}

export const ACHIEVEMENTS: Achievement[] = [
  // (First memory / first link / star class / 365 count / all-sectors all live in
  // the CODEX as discoveries now — they were double-rewarded here.)
  {
    id: "galaxy_reader",
    name: "Galaxy Reader",
    icon: "🗺️",
    desc: "Explored memories across 6+ types — you can read your galaxy at a glance.",
    test: () => {
      try {
        const seen = JSON.parse(localStorage.getItem(`stat.types_seen.${statsSpaceId()}`) || "[]");
        return Array.isArray(seen) && seen.length >= 6;
      } catch {
        return false;
      }
    },
    progress: () => {
      try {
        const seen = JSON.parse(localStorage.getItem(`stat.types_seen.${statsSpaceId()}`) || "[]");
        return { cur: Math.min(Array.isArray(seen) ? seen.length : 0, 6), target: 6 };
      } catch {
        return { cur: 0, target: 6 };
      }
    },
  },
  {
    id: "connector",
    name: "Connector",
    icon: "🕸️",
    desc: "25 connections across your brain",
    test: (c) => c.links >= 25,
    progress: (c) => ({ cur: Math.min(c.links, 25), target: 25 }),
  },
  {
    id: "nexus",
    name: "Nexus",
    icon: "🧠",
    desc: "A memory grew to 8+ connections",
    test: (c) => c.memories.some((n) => (n.degree ?? 0) >= 8),
    progress: (c) => ({
      cur: Math.min(c.memories.reduce((m, n) => Math.max(m, n.degree ?? 0), 0), 8),
      target: 8,
    }),
  },
  {
    // Renamed from "Gardener" — the Codex phenomenon "The Gardener" (tend 10
    // cooling memories) shared the name with a different rule.
    id: "gardener",
    name: "Keeper of the Flame",
    icon: "🌿",
    desc: "10+ memories and none gone cold",
    test: (c) => c.memories.length >= 10 && c.memories.every((n) => (n.entropy ?? 0) < 0.45),
    // IM-92 distance hint: warm (not-gone-cold) memories toward the 10 needed;
    // the "none cold" half of the condition is spelled out in the drill-in.
    progress: (c) => ({
      cur: Math.min(c.memories.filter((n) => (n.entropy ?? 0) < 0.45).length, 10),
      target: 10,
    }),
  },
  {
    // Repurposed from "Fully Fueled" (which rewarded hitting the cap — i.e. NOT spending):
    // now rewards actually USING Fuel on Soumaya's on-demand help (a real sink).
    id: "full_tank",
    name: "Patron",
    icon: "⚡",
    desc: "Commission Soumaya to warm your galaxy on demand.",
    test: () => {
      try {
        return (parseInt(localStorage.getItem(`stat.commissions.${statsSpaceId()}`) || "0", 10) || 0) >= 1;
      } catch {
        return false;
      }
    },
    progress: () => {
      try {
        const v = parseInt(localStorage.getItem(`stat.commissions.${statsSpaceId()}`) || "0", 10) || 0;
        return { cur: Math.min(v, 1), target: 1 };
      } catch {
        return { cur: 0, target: 1 };
      }
    },
  },

  // === NEW GAMIFICATION WAVE 3 ACHIEVEMENTS ===
  {
    id: "pathfinder_quest",
    name: "Pathfinder Quest",
    icon: "🧭",
    desc: "Create a path of 5+ connected memories. Unlocks Aegis Shield Spire.",
    test: (c) => {
      if (!c.linkObjects || c.linkObjects.length < 4) return false;
      // Build adjacency list
      const adj = new Map<number, Set<number>>();
      for (const l of c.linkObjects) {
        const s = typeof l.source === "object" && l.source !== null ? l.source.id : l.source;
        const t = typeof l.target === "object" && l.target !== null ? l.target.id : l.target;
        if (s == null || t == null) continue;
        if (!adj.has(s)) adj.set(s, new Set());
        if (!adj.has(t)) adj.set(t, new Set());
        adj.get(s)!.add(t);
        adj.get(t)!.add(s);
      }

      // We only need to know a SIMPLE PATH of NEED+ connected memories EXISTS — not
      // the longest one. The old code computed the maximum by exploring EVERY simple
      // path from EVERY node (finding the longest simple path is NP-hard), which on a
      // dense brain is astronomically many paths — it pegged the main thread and froze
      // the whole app. Fix: short-circuit the instant we reach depth NEED, and hard-cap
      // total DFS steps so a pathological graph can never hang (worst case: the badge
      // just doesn't unlock — the app never freezes).
      const NEED = 5;
      let budget = 20000;
      const visited = new Set<number>();
      const dfs = (node: number, depth: number): boolean => {
        if (depth >= NEED) return true;
        if (--budget <= 0) return false;
        visited.add(node);
        for (const n of adj.get(node) || []) {
          if (!visited.has(n) && dfs(n, depth + 1)) {
            visited.delete(node);
            return true;
          }
        }
        visited.delete(node);
        return false;
      };

      for (const start of adj.keys()) {
        if (budget <= 0) break;
        if (dfs(start, 1)) return true;
      }
      return false;
    },
    progress: (c) => ({ cur: Math.min(pathDepth(c, 5), 5), target: 5 }),
  },
  {
    id: "consistent_pilot",
    name: "Consistent Pilot",
    icon: "📅",
    desc: "Keep a 3-day tending streak. Unlocks Hyperdrive Neon Trail.",
    // The server streak is the source of truth (device-independent); the
    // distinct-created-days set is the offline/legacy fallback.
    test: (c) => consistentDays(c) >= 3,
    progress: (c) => ({ cur: Math.min(consistentDays(c), 3), target: 3 }),
  },
  {
    id: "sector_pioneer",
    name: "Sector Pioneer",
    icon: "🌌",
    desc: "Catalog memories in 4+ distinct type categories. Unlocks Solar Gold Exhaust.",
    test: (c) => {
      const types = new Set(c.memories.map((m) => m.type).filter(Boolean));
      return types.size >= 4;
    },
    progress: (c) => {
      const types = new Set(c.memories.map((m) => m.type).filter(Boolean));
      return { cur: Math.min(types.size, 4), target: 4 };
    }
  },
  {
    id: "sentinel_command",
    name: "Sentinel Command",
    icon: "📡",
    desc: "Deploy 5+ Aura Beacons over cooling memories. Unlocks Holographic Sentinel Hull.",
    test: (c) => {
      // Checked via stats loaded from localStorage in App
      try {
        const spaceId = statsSpaceId();
        const val = parseInt(localStorage.getItem(`stat.beacons_deployed.${spaceId}`) || "0", 10);
        return val >= 5;
      } catch {
        return false;
      }
    },
    progress: (c) => {
      try {
        const spaceId = statsSpaceId();
        const val = parseInt(localStorage.getItem(`stat.beacons_deployed.${spaceId}`) || "0", 10);
        return { cur: Math.min(val, 5), target: 5 };
      } catch {
        return { cur: 0, target: 5 };
      }
    }
  },
  {
    // Renamed from "Deep Cluster" — the Codex phenomenon "Deep Cluster" (a memory
    // with 6+ connections) shared the name with a different rule.
    id: "deep_cluster",
    name: "Sector Dominion",
    icon: "🧲",
    desc: "Grow a single sector category to 6+ memories. Unlocks Quantum Singularity Core.",
    test: (c) => {
      const counts = new Map<string, number>();
      for (const m of c.memories) {
        const t = m.type || "unknown";
        counts.set(t, (counts.get(t) || 0) + 1);
      }
      return Array.from(counts.values()).some((v) => v >= 6);
    },
    progress: (c) => {
      const counts = new Map<string, number>();
      for (const m of c.memories) {
        const t = m.type || "unknown";
        counts.set(t, (counts.get(t) || 0) + 1);
      }
      const maxVal = Array.from(counts.values()).reduce((max, val) => Math.max(max, val), 0);
      return { cur: Math.min(maxVal, 6), target: 6 };
    }
  },
  {
    id: "cosmic_voyager",
    name: "Cosmic Voyager",
    icon: "💫",
    desc: "Soumaya completes 15+ travel hops on maintenance rounds. Unlocks Fusion Core Destroyer.",
    test: (c) => {
      try {
        const spaceId = statsSpaceId();
        const val = parseInt(localStorage.getItem(`stat.travel_hops.${spaceId}`) || "0", 10);
        return val >= 15;
      } catch {
        return false;
      }
    },
    progress: (c) => {
      try {
        const spaceId = statsSpaceId();
        const val = parseInt(localStorage.getItem(`stat.travel_hops.${spaceId}`) || "0", 10);
        return { cur: Math.min(val, 15), target: 15 };
      } catch {
        return { cur: 0, target: 15 };
      }
    }
  },
  {
    id: "galactic_megastructure",
    name: "Megastructure",
    icon: "🏟️",
    desc: "Form 50+ total synapses/connections. Unlocks Synapse Hyper-Array.",
    test: (c) => c.links >= 50,
    progress: (c) => ({ cur: Math.min(c.links, 50), target: 50 }),
  },
  {
    // The one meta-badge bridging the two systems: completing the whole Codex is
    // itself a feat. (Individual codex entries never appear as achievements.)
    id: "galactic_atlas",
    name: "Galactic Atlas",
    icon: "📖",
    desc: "Discover the entire Codex — every sector, body, constellation, phenomenon.",
    test: (c) => codexPctFrom(c) >= 100,
    progress: (c) => ({ cur: codexPctFrom(c), target: 100 }),
  },
  {
    id: "grand_restorer",
    name: "Grand Restorer",
    icon: "🌟",
    desc: "Tend/restore old high-entropy memories 10+ times. Unlocks Void Purple Trail.",
    test: (c) => {
      try {
        const spaceId = statsSpaceId();
        const val = parseInt(localStorage.getItem(`stat.memories_tended.${spaceId}`) || "0", 10);
        return val >= 10;
      } catch {
        return false;
      }
    },
    progress: (c) => {
      try {
        const spaceId = statsSpaceId();
        const val = parseInt(localStorage.getItem(`stat.memories_tended.${spaceId}`) || "0", 10);
        return { cur: Math.min(val, 10), target: 10 };
      } catch {
        return { cur: 0, target: 10 };
      }
    }
  },

  // === LIFETIME LADDER (Wave 4) — feats that keep unlocking for years. Kept disjoint
  //     from the Codex (discoveries) and from Pilot Rank (the memory-COUNT ladder). ===

  // Tending streaks — the long game of showing up.
  { id: "streak_week", name: "Weekly Ritual", icon: "🗓️", desc: "Hold a 7-day tending streak.",
    test: (c) => consistentDays(c) >= 7, progress: (c) => ({ cur: Math.min(consistentDays(c), 7), target: 7 }) },
  { id: "streak_month", name: "Monthly Devotion", icon: "🌙", desc: "Hold a 30-day tending streak.",
    test: (c) => consistentDays(c) >= 30, progress: (c) => ({ cur: Math.min(consistentDays(c), 30), target: 30 }) },
  { id: "streak_100", name: "Centurion", icon: "💯", desc: "Hold a 100-day tending streak.",
    test: (c) => consistentDays(c) >= 100, progress: (c) => ({ cur: Math.min(consistentDays(c), 100), target: 100 }) },
  { id: "streak_year", name: "Year of the Mind", icon: "🎆", desc: "Hold a 365-day tending streak — a full year of showing up.",
    test: (c) => consistentDays(c) >= 365, progress: (c) => ({ cur: Math.min(consistentDays(c), 365), target: 365 }) },

  // Connection depth — the web keeps growing.
  { id: "weaver_100", name: "Weaver", icon: "🕸️", desc: "Weave 100 connections across your brain.",
    test: (c) => c.links >= 100, progress: (c) => ({ cur: Math.min(c.links, 100), target: 100 }) },
  { id: "web_250", name: "Web of Mind", icon: "🌐", desc: "Weave 250 connections — a densely-woven galaxy.",
    test: (c) => c.links >= 250, progress: (c) => ({ cur: Math.min(c.links, 250), target: 250 }) },
  { id: "living_nexus", name: "Living Nexus", icon: "🌟", desc: "A single memory reaches 15+ connections.",
    test: (c) => c.memories.some((n) => (n.degree ?? 0) >= 15),
    progress: (c) => ({ cur: Math.min(c.memories.reduce((m, n) => Math.max(m, n.degree ?? 0), 0), 15), target: 15 }) },

  // Constellations — curating maps of content.
  { id: "cartographer", name: "Cartographer", icon: "🗺️", desc: "Chart 5 constellations from your clusters.",
    test: (c) => c.memories.filter((n) => n.kind === "moc").length >= 5,
    progress: (c) => ({ cur: Math.min(c.memories.filter((n) => n.kind === "moc").length, 5), target: 5 }) },

  // The mind layer — direction, not just memory.
  { id: "goal_achiever", name: "Goal Achiever", icon: "🏁", desc: "Carry a goal all the way to done.",
    test: (c) => c.memories.some((n) => n.kind === "goal" && (n.progress ?? 0) >= 0.999),
    // Distance hint: your furthest-along goal, as a percentage of done.
    progress: (c) => ({
      cur: Math.round(c.memories.filter((n) => n.kind === "goal").reduce((m, n) => Math.max(m, n.progress ?? 0), 0) * 100),
      target: 100,
    }) },
  { id: "skill_advanced", name: "Practiced Hand", icon: "🎓", desc: "Grow a skill to Skilled through real practice.",
    test: (c) => c.memories.some((n) => n.kind === "skill" && (n.progress ?? 0) >= 0.6),
    progress: (c) => ({
      cur: Math.round(c.memories.filter((n) => n.kind === "skill").reduce((m, n) => Math.max(m, n.progress ?? 0), 0) * 100),
      target: 60,
    }) },
  { id: "skill_master", name: "Master", icon: "🥋", desc: "Grow a skill all the way to Expert.",
    test: (c) => c.memories.some((n) => n.kind === "skill" && (n.progress ?? 0) >= 0.85),
    progress: (c) => ({
      cur: Math.round(c.memories.filter((n) => n.kind === "skill").reduce((m, n) => Math.max(m, n.progress ?? 0), 0) * 100),
      target: 85,
    }) },
  { id: "inner_circle", name: "Inner Circle", icon: "👥", desc: "Map 5 people you orbit.",
    test: (c) => c.memories.filter((n) => n.kind === "person_entity").length >= 5,
    progress: (c) => ({ cur: Math.min(c.memories.filter((n) => n.kind === "person_entity").length, 5), target: 5 }) },
  { id: "idea_garden", name: "Idea Garden", icon: "💡", desc: "Cultivate 5 living ideas at once.",
    test: (c) => c.memories.filter((n) => n.kind === "idea").length >= 5,
    progress: (c) => ({ cur: Math.min(c.memories.filter((n) => n.kind === "idea").length, 5), target: 5 }) },

  // Curation — saving reusable views of your galaxy (Smart Lenses).
  { id: "lenscrafter", name: "Lenscrafter", icon: "⧉", desc: "Save 3 Smart Lenses — reusable views of your galaxy.",
    test: () => { try { return (parseInt(localStorage.getItem(`stat.lenses_made.${statsSpaceId()}`) || "0", 10) || 0) >= 3; } catch { return false; } },
    progress: () => { try { const v = parseInt(localStorage.getItem(`stat.lenses_made.${statsSpaceId()}`) || "0", 10) || 0; return { cur: Math.min(v, 3), target: 3 }; } catch { return { cur: 0, target: 3 }; } } },

  // Emotional range + longevity — the texture of a lived-in galaxy.
  { id: "light_bringer", name: "Light Bringer", icon: "☀️", desc: "Hold 15 joyful memories in your sky.",
    test: (c) => c.memories.filter((n) => (n.emotionalWeight ?? 0) > 0.25).length >= 15,
    progress: (c) => ({ cur: Math.min(c.memories.filter((n) => (n.emotionalWeight ?? 0) > 0.25).length, 15), target: 15 }) },
  { id: "enduring_light", name: "Enduring Light", icon: "🕯️", desc: "Keep a memory alive for 180+ days.",
    test: (c) => c.memories.some((n) => memAgeDays(n) >= 180),
    progress: (c) => ({ cur: Math.min(c.memories.reduce((m, n) => Math.max(m, memAgeDays(n)), 0), 180), target: 180 }) },
  { id: "time_capsule", name: "Time Capsule", icon: "⌛", desc: "Keep a memory alive for a full year (365+ days).",
    test: (c) => c.memories.some((n) => memAgeDays(n) >= 365),
    progress: (c) => ({ cur: Math.min(c.memories.reduce((m, n) => Math.max(m, memAgeDays(n)), 0), 365), target: 365 }) },
];

/** Days since a memory was created/occurred (for longevity feats). */
function memAgeDays(n: GraphNode): number {
  const t = Date.parse(n.occurredAt ?? n.createdAt ?? "");
  return Number.isNaN(t) ? 0 : Math.floor((Date.now() - t) / 86_400_000);
}

/** Return the ids of every achievement currently satisfied. */
export function unlockedIds(c: AchievementCtx): string[] {
  return ACHIEVEMENTS.filter((a) => {
    try {
      return a.test(c);
    } catch {
      return false;
    }
  }).map((a) => a.id);
}

/** localStorage key holding the set of achievement ids a brain has earned. */
export function achvKey(spaceId: string): string {
  return `brain.achv.${spaceId}`;
}

/**
 * The persisted earned set, in its current shape: a map of achievement id →
 * ISO unlock timestamp, or `null` when the unlock time is unknown.
 *
 * IM-92 honesty rule: unlock times were never stored before this change, so
 * legacy entries (written as a bare string array) migrate forward with a
 * `null` time — they show NO "earned on" date rather than an invented one.
 * Only unlocks recorded after this change carry a real timestamp.
 */
export type EarnedMap = Record<string, string | null>;

function parseEarned(raw: string | null): EarnedMap {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (Array.isArray(v)) {
      const out: EarnedMap = {};
      for (const id of v) if (typeof id === "string") out[id] = null;
      return out;
    }
    if (v && typeof v === "object") {
      const out: EarnedMap = {};
      for (const [id, at] of Object.entries(v as Record<string, unknown>)) {
        out[id] = typeof at === "string" ? at : null;
      }
      return out;
    }
  } catch {
    /* fall through to empty */
  }
  return {};
}

/** Read the persisted set of earned achievement ids for a brain. */
export function loadUnlocked(spaceId: string): Set<string> {
  try {
    return new Set(Object.keys(parseEarned(localStorage.getItem(achvKey(spaceId)))));
  } catch {
    return new Set();
  }
}

/**
 * Read the recorded unlock times for a brain. Ids earned before timestamps
 * were stored are simply ABSENT from the result — never backfilled.
 */
export function loadEarnedAt(spaceId: string): Record<string, string> {
  try {
    const out: Record<string, string> = {};
    for (const [id, at] of Object.entries(parseEarned(localStorage.getItem(achvKey(spaceId))))) {
      if (at) out[id] = at;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Persist newly-earned achievement ids, stamping each with `atIso` as its
 * unlock time. Existing entries keep whatever time they already have (or
 * their legacy `null`); re-recording an id never rewrites its first time.
 */
export function recordUnlocked(spaceId: string, ids: string[], atIso: string): void {
  try {
    const cur = parseEarned(localStorage.getItem(achvKey(spaceId)));
    for (const id of ids) {
      if (!(id in cur)) cur[id] = atIso;
    }
    localStorage.setItem(achvKey(spaceId), JSON.stringify(cur));
  } catch {
    /* storage unavailable — the in-memory earned set still renders */
  }
}
