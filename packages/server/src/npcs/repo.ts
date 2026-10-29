import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { spaceTimezone } from "../agent/notify/policy.js";
import {
  NPC_ACT_KINDS,
  NPC_MAX_ACTS_PER_DAY,
  NPC_MAX_SPEAKS_PER_DAY,
  type NpcActKind,
  type NpcId,
  type NpcLogEntry,
} from "@brain/shared";

/**
 * NPC persistence (Wave 2, NPC autonomy): the append-only log, the
 * per-NPC state row (kill switch, tick throttle, last welcome, last
 * explore day), the separate-pool relic holdings, and the gate record.
 *
 * Everything here is space-scoped: another space's NPC rows are
 * invisible, and brain deletion removes them (SPACE_SCOPED_TABLES).
 * The log is append-only — no update, no delete path exists in this
 * module. Counts are per space-local day (the space's own timezone),
 * never a UTC boundary.
 */

export interface NpcStateRow {
  npcId: NpcId;
  stopped: boolean;
  lastTickAt: string | null;
  lastWelcomeJourneyId: string | null;
  lastExploreDay: string | null;
}

const EMPTY_STATE: Omit<NpcStateRow, "npcId"> = {
  stopped: false,
  lastTickAt: null,
  lastWelcomeJourneyId: null,
  lastExploreDay: null,
};

/** YYYY-MM-DD of an instant in a timezone (the space-local day key —
 *  never a UTC boundary). Falls back to the UTC date when the zone
 *  name is unusable. */
export function localDateKey(tz: string, ms: number): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(ms));
    const get = (type: string) => parts.find((x) => x.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

export class NpcRepo {
  constructor(
    private h: DbHandle,
    private spaceId: string = DEFAULT_SPACE,
  ) {}

  // --- log (append-only) ---

  /** Append one log entry. The kind must be on the framework's
   *  allow-list — anything else is not a tool and cannot be logged
   *  as an act. Returns the stored entry. */
  appendLog(npcId: NpcId, kind: NpcActKind, act: string, cause: string, nowMs: number = Date.now()): NpcLogEntry {
    if (!NPC_ACT_KINDS.includes(kind)) {
      throw new Error(`Refused to log an act outside the allow-list: ${kind}`);
    }
    if (!act.trim() || !cause.trim()) {
      throw new Error("An NPC log entry needs both an act and a cause, in plain words.");
    }
    const createdAt = new Date(nowMs).toISOString();
    const res = this.h.sqlite
      .prepare(
        `INSERT INTO npc_log (npc_id, space_id, kind, act, cause, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(npcId, this.spaceId, kind, act, cause, createdAt);
    return {
      id: Number(res.lastInsertRowid),
      npcId,
      kind,
      act,
      cause,
      createdAt,
    };
  }

  /** The most recent log entries for one NPC, newest first. */
  recentLog(npcId: NpcId, limit = 20): NpcLogEntry[] {
    const rows = this.h.sqlite
      .prepare(
        `SELECT id, npc_id, kind, act, cause, created_at FROM npc_log
         WHERE space_id = ? AND npc_id = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(this.spaceId, npcId, limit) as {
      id: number;
      npc_id: string;
      kind: string;
      act: string;
      cause: string;
      created_at: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      npcId: r.npc_id as NpcId,
      kind: r.kind as NpcActKind,
      act: r.act,
      cause: r.cause,
      createdAt: r.created_at,
    }));
  }

  /** How many acts this NPC performed on the space-local day of nowMs. */
  actsToday(npcId: NpcId, nowMs: number = Date.now()): number {
    return this.countLogOnDay(npcId, nowMs, null);
  }

  /** How many of today's acts were speaks. */
  speaksToday(npcId: NpcId, nowMs: number = Date.now()): number {
    return this.countLogOnDay(npcId, nowMs, "speak");
  }

  private countLogOnDay(npcId: NpcId, nowMs: number, kind: NpcActKind | null): number {
    const tz = spaceTimezone(this.h.sqlite, this.spaceId);
    const today = localDateKey(tz, nowMs);
    const rows = this.h.sqlite
      .prepare(
        `SELECT created_at FROM npc_log WHERE space_id = ? AND npc_id = ?${kind ? ` AND kind = ?` : ""}`,
      )
      .all(this.spaceId, npcId, ...(kind ? [kind] : [])) as { created_at: string }[];
    return rows.filter((r) => localDateKey(tz, Date.parse(r.created_at)) === today).length;
  }

  /** Whether the daily budgets still have room for one more act (and,
   *  for a speak, one more speak). */
  budgetAllows(
    npcId: NpcId,
    kind: NpcActKind,
    nowMs: number = Date.now(),
    limits: { maxActsPerDay?: number; maxSpeaksPerDay?: number } = {},
  ): boolean {
    if (this.actsToday(npcId, nowMs) >= (limits.maxActsPerDay ?? NPC_MAX_ACTS_PER_DAY)) return false;
    if (kind === "speak" && this.speaksToday(npcId, nowMs) >= (limits.maxSpeaksPerDay ?? NPC_MAX_SPEAKS_PER_DAY)) return false;
    return true;
  }

  // --- state (kill switch, throttle, welcome/explore markers) ---

  state(npcId: NpcId): NpcStateRow {
    const row = this.h.sqlite
      .prepare(`SELECT stopped, last_tick_at, last_welcome_journey_id, last_explore_day FROM npc_state WHERE space_id = ? AND npc_id = ?`)
      .get(this.spaceId, npcId) as
      | { stopped: number; last_tick_at: string | null; last_welcome_journey_id: string | null; last_explore_day: string | null }
      | undefined;
    if (!row) return { npcId, ...EMPTY_STATE };
    return {
      npcId,
      stopped: row.stopped === 1,
      lastTickAt: row.last_tick_at,
      lastWelcomeJourneyId: row.last_welcome_journey_id,
      lastExploreDay: row.last_explore_day,
    };
  }

  private upsertState(npcId: NpcId, patch: Partial<Omit<NpcStateRow, "npcId">>): void {
    const cur = this.state(npcId);
    const next = { ...cur, ...patch };
    this.h.sqlite
      .prepare(
        `INSERT INTO npc_state (npc_id, space_id, stopped, last_tick_at, last_welcome_journey_id, last_explore_day)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(space_id, npc_id) DO UPDATE SET
           stopped = excluded.stopped,
           last_tick_at = excluded.last_tick_at,
           last_welcome_journey_id = excluded.last_welcome_journey_id,
           last_explore_day = excluded.last_explore_day`,
      )
      .run(
        npcId,
        this.spaceId,
        next.stopped ? 1 : 0,
        next.lastTickAt,
        next.lastWelcomeJourneyId,
        next.lastExploreDay,
      );
  }

  /** The kill switch (note §3): the owner can stop any NPC at any
   *  time. A stopped NPC ticks to nothing. */
  setStopped(npcId: NpcId, stopped: boolean): void {
    this.upsertState(npcId, { stopped });
  }

  markTick(npcId: NpcId, nowMs: number = Date.now()): void {
    this.upsertState(npcId, { lastTickAt: new Date(nowMs).toISOString() });
  }

  markWelcome(npcId: NpcId, journeyId: string): void {
    this.upsertState(npcId, { lastWelcomeJourneyId: journeyId });
  }

  markExploreDay(npcId: NpcId, dayKey: string): void {
    this.upsertState(npcId, { lastExploreDay: dayKey });
  }

  // --- holdings: the NPC's OWN separate pool (note §3) ---

  /** Relic ids this NPC holds from its own pool. Never the player
   *  scarce pool — this table is the only place NPC holdings live. */
  holdings(npcId: NpcId): string[] {
    const rows = this.h.sqlite
      .prepare(`SELECT relic_id FROM npc_relic_holdings WHERE space_id = ? AND npc_id = ?`)
      .all(this.spaceId, npcId) as { relic_id: string }[];
    return rows.map((r) => r.relic_id);
  }

  /** Record a found relic in the NPC's own pool. Idempotent: finding
   *  the same relic twice holds one copy. */
  addHolding(npcId: NpcId, relicId: string, foundInWorld: string, nowMs: number = Date.now()): void {
    this.h.sqlite
      .prepare(
        `INSERT OR IGNORE INTO npc_relic_holdings (npc_id, space_id, relic_id, found_at, found_in_world)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(npcId, this.spaceId, relicId, new Date(nowMs).toISOString(), foundInWorld);
  }

  // --- gate: once opened for an NPC, it stays open (note §5) ---

  gateOpen(npcId: NpcId): boolean {
    const row = this.h.sqlite
      .prepare(`SELECT 1 AS x FROM npc_gate WHERE space_id = ? AND npc_id = ?`)
      .get(this.spaceId, npcId) as { x: number } | undefined;
    return !!row;
  }

  markGateOpen(npcId: NpcId, nowMs: number = Date.now()): void {
    this.h.sqlite
      .prepare(`INSERT OR IGNORE INTO npc_gate (npc_id, space_id, opened_at) VALUES (?, ?, ?)`)
      .run(npcId, this.spaceId, new Date(nowMs).toISOString());
  }
}
