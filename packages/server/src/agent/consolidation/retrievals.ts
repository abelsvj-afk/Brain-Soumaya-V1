/**
 * W3 retrievals & decay (design Rev 11 §7.1, §7.2, §8.5; implementation
 * plan Milestone 3). Two halves:
 *
 * 1. ACCESS TELEMETRY (§8.5): retrieval-serving reads record access into
 *    access_stats — at most one write per entity per hour per process
 *    (in-memory coalescing map), failures swallowed (telemetry never
 *    breaks a read). Maintenance/internal reads (sweeps, adjudication
 *    candidate fetches, reconciliation prefetch, digest inputs) do NOT
 *    record access: only the two retrieval-serving read paths call
 *    recordAccess (episodeSearch hits, getUserModel results — wired by
 *    the callers in episodic.ts / userModel.ts).
 *
 * 2. DECAY (§7.1/§7.2): decay is a READ-TIME weight, never a stored
 *    mutation — retrieval ranking consults it and nothing else does.
 *    Refresh events (access) reset the decay clock via access_stats.
 *    Stated-origin user_model rows never decay, regardless of access.
 *    Invalidated/superseded rows are excluded BEFORE decay (§7.3).
 *
 * This module writes access_stats ONLY — never episodes, user_model, or
 * nodes rows (T-C44: reads leave the belief/episode tables byte-identical).
 */
import type { RawDb } from "../../db/vec.js";

/** Stored vocabulary (Milestone 1 access_stats CHECK). */
export type AccessEntityType = "episode" | "user_model_entry" | "node";

/** §7.1 half-lives in days, by user_model slot class. Infinity = no decay. */
const SLOT_HALF_LIFE_DAYS: Record<string, number> = {
  emotion_state: 7,
  desire: 90,
  intention: 90,
  belief: 180,
  current_fact: 180,
  goal_state: 180,
  relationship: 180,
  identity: Infinity,
  preference: Infinity,
  constraint: Infinity,
};

const EPISODE_HALF_LIFE_DAYS = 7;
const NODE_HALF_LIFE_DAYS = 180;

/** In-memory write coalescing: entity key -> last write epoch ms (§8.5). */
const lastWriteAt = new Map<string, number>();
const COALESCE_MS = 60 * 60 * 1000;

/**
 * Record one retrieval access. Coalesced to <= 1 write per entity per
 * hour per process. Never throws.
 */
export function recordAccess(
  sqlite: RawDb,
  entityType: AccessEntityType,
  entityId: number,
  now: Date = new Date(),
): void {
  try {
    const key = `${entityType}:${entityId}`;
    const nowMs = now.getTime();
    const last = lastWriteAt.get(key);
    if (last !== undefined && nowMs - last < COALESCE_MS) return;
    lastWriteAt.set(key, nowMs);
    sqlite
      .prepare(
        `INSERT INTO access_stats (entity_type, entity_id, last_accessed_at, access_count)
         VALUES (?, ?, ?, 1)
         ON CONFLICT(entity_type, entity_id) DO UPDATE SET
           last_accessed_at = excluded.last_accessed_at,
           access_count = access_count + 1`,
      )
      .run(entityType, entityId, now.toISOString());
  } catch {
    // Telemetry is never load-bearing (§8.5).
  }
}

/** Test seam: reset the coalescing map between cases. */
export function resetAccessCoalescing(): void {
  lastWriteAt.clear();
}

export interface AccessStat {
  lastAccessedAt: string | null;
  accessCount: number;
}

export function getAccessStat(
  sqlite: RawDb,
  entityType: AccessEntityType,
  entityId: number,
): AccessStat {
  const row = sqlite
    .prepare(
      `SELECT last_accessed_at, access_count FROM access_stats WHERE entity_type = ? AND entity_id = ?`,
    )
    .get(entityType, entityId) as { last_accessed_at: string; access_count: number } | undefined;
  return {
    lastAccessedAt: row?.last_accessed_at ?? null,
    accessCount: row?.access_count ?? 0,
  };
}

/** Pure half-life decay factor: 0.5 ^ (ageDays / halfLifeDays). */
export function decayFactor(ageDays: number, halfLifeDays: number): number {
  if (!Number.isFinite(halfLifeDays)) return 1;
  if (ageDays <= 0) return 1;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

export interface DecayInput {
  /** Slot for user_model rows; null for episodes/nodes. */
  slot?: string | null;
  /** 'stated' rows never decay (§7.2). */
  origin?: string | null;
  /** The row's own recency anchor (valid_at for user_model; occurred_at for episodes). */
  validAt: string;
  /** Last retrieval access (refresh resets the clock), if any. */
  lastAccessedAt?: string | null;
  /** Entity kind for the half-life table. */
  entityType: "episode" | "user_model" | "node";
}

/**
 * The §7.1/§7.2 decay weight for one CURRENT row. (Invalidated/superseded
 * rows are excluded by callers before decay — §7.3.) Age is measured
 * from the LATER of the row's anchor and its last access, so a refresh
 * restarts the clock.
 */
export function decayWeight(input: DecayInput, now: Date = new Date()): number {
  if (input.origin === "stated") return 1;
  let halfLife: number;
  if (input.entityType === "episode") halfLife = EPISODE_HALF_LIFE_DAYS;
  else if (input.entityType === "node") halfLife = NODE_HALF_LIFE_DAYS;
  else halfLife = SLOT_HALF_LIFE_DAYS[input.slot ?? ""] ?? 180;
  if (!Number.isFinite(halfLife)) return 1;
  const anchorMs = Date.parse(input.validAt);
  const accessMs = input.lastAccessedAt ? Date.parse(input.lastAccessedAt) : NaN;
  const fromMs = Number.isFinite(accessMs) && accessMs > anchorMs ? accessMs : anchorMs;
  if (!Number.isFinite(fromMs)) return 1;
  const ageDays = Math.max(0, (now.getTime() - fromMs) / 86_400_000);
  return decayFactor(ageDays, halfLife);
}
