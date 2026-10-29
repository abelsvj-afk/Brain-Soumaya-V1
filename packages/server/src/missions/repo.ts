import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { spaceTimezone } from "../agent/notify/policy.js";
import {
  MISSION_FLEET_SHIPS,
  type Mission,
  type MissionKind,
  type MissionLogEntry,
  type MissionState,
} from "@brain/shared";
import { localDateKey } from "../npcs/repo.js";

/**
 * Fleet missions — persistence. The mission ledger, the log, and the
 * fleet stop flag.
 *
 * Everything here is space-scoped: another space's missions are
 * invisible, and brain deletion removes them (SPACE_SCOPED_TABLES).
 * The log is append-only — no update, no delete path exists in this
 * module. Counts run on absolute durations and the space-local day
 * where a calendar day is meant — never a UTC boundary.
 *
 * Missions NEVER write to a brain: the only tables this module
 * touches are the mission_* tables plus the read-only travel ledger
 * and node counts the scouting reports need.
 */

export interface MissionRow {
  id: string;
  clientKey: string;
  kind: MissionKind;
  destination: string;
  origin: string;
  fleetSize: number;
  ships: string[];
  durationMinutes: number;
  fuelCost: number;
  state: MissionState;
  createdAt: string;
  departedAt: string | null;
  arriveAt: string | null;
  departBackAt: string | null;
  completeAt: string | null;
  completedAt: string | null;
  outcome: string | null;
  report: string | null;
}

/** Phase boundaries, from departure + duration: three equal legs —
 *  outbound, on station (working), return. One source of truth; the
 *  row stores departure + duration and these are computed. */
export function missionPhaseTimes(departedAtMs: number, durationMinutes: number): {
  arriveAtMs: number;
  departBackAtMs: number;
  completeAtMs: number;
} {
  const leg = (durationMinutes * 60_000) / 3;
  return {
    arriveAtMs: departedAtMs + leg,
    departBackAtMs: departedAtMs + 2 * leg,
    completeAtMs: departedAtMs + 3 * leg,
  };
}

const MISSION_MAX_FLEET_SIZE = 3;

/** The ships for a dispatch: deterministic rotation by how many
 *  missions this space has ever sent, so missions fly different
 *  hulls and the log can name them. */
export function shipsForDispatch(missionCount: number, fleetSize: number): string[] {
  const offset = (missionCount * MISSION_MAX_FLEET_SIZE) % MISSION_FLEET_SHIPS.length;
  const ships: string[] = [];
  for (let i = 0; i < fleetSize; i++) {
    ships.push(MISSION_FLEET_SHIPS[(offset + i) % MISSION_FLEET_SHIPS.length]!);
  }
  return ships;
}

export interface ScoutFacts {
  /** Journeys of the owner's that arrived at this world (travel ledger). */
  arrivals: number;
  lastArrivalMs: number | null;
  /** The world's own server-side count, when it has one — and what it counts. */
  worldCount: number | null;
  worldCountLabel: string | null;
  /** Station only: arrivals today + inbound journeys. */
  arrivalsToday: number | null;
  inbound: number | null;
  /** People only: how many people are gathered. */
  peopleCount: number | null;
}

export class MissionRepo {
  constructor(
    private h: DbHandle,
    private spaceId: string = DEFAULT_SPACE,
  ) {}

  // --- missions ---

  missionById(id: string): MissionRow | undefined {
    const r = this.h.sqlite
      .prepare(`SELECT * FROM mission_missions WHERE space_id = ? AND id = ?`)
      .get(this.spaceId, id) as Record<string, unknown> | undefined;
    return r ? this.mapRow(r) : undefined;
  }

  missionByClientKey(clientKey: string): MissionRow | undefined {
    const r = this.h.sqlite
      .prepare(`SELECT * FROM mission_missions WHERE space_id = ? AND client_key = ?`)
      .get(this.spaceId, clientKey) as Record<string, unknown> | undefined;
    return r ? this.mapRow(r) : undefined;
  }

  /** Active missions, oldest first (the settle order). */
  activeMissions(): MissionRow[] {
    const rows = this.h.sqlite
      .prepare(
        `SELECT * FROM mission_missions WHERE space_id = ? AND state IN ('outbound','arrived','returning') ORDER BY created_at ASC, rowid ASC`,
      )
      .all(this.spaceId) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  /** Recent missions, active first, then terminal newest first. */
  recentMissions(limit = 20): MissionRow[] {
    const rows = this.h.sqlite
      .prepare(
        `SELECT * FROM mission_missions WHERE space_id = ?
         ORDER BY CASE WHEN state IN ('outbound','arrived','returning') THEN 0 ELSE 1 END,
           created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(this.spaceId, limit) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  missionCount(): number {
    const row = this.h.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM mission_missions WHERE space_id = ?`)
      .get(this.spaceId) as { n: number };
    return row.n;
  }

  activeCount(): number {
    const row = this.h.sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM mission_missions WHERE space_id = ? AND state IN ('outbound','arrived','returning')`,
      )
      .get(this.spaceId) as { n: number };
    return row.n;
  }

  activeTo(destination: string): number {
    const row = this.h.sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM mission_missions WHERE space_id = ? AND destination = ? AND state IN ('outbound','arrived','returning')`,
      )
      .get(this.spaceId, destination) as { n: number };
    return row.n;
  }

  insertMission(row: Omit<MissionRow, "arriveAt" | "departBackAt" | "completeAt">): MissionRow {
    const times = missionPhaseTimes(Date.parse(row.departedAt!), row.durationMinutes);
    this.h.sqlite
      .prepare(
        `INSERT INTO mission_missions
           (id, space_id, client_key, kind, destination, origin, fleet_size, ships,
            duration_minutes, fuel_cost, state,
            created_at, departed_at, arrive_at, depart_back_at, complete_at,
            completed_at, outcome, report)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        this.spaceId,
        row.clientKey,
        row.kind,
        row.destination,
        row.origin,
        row.fleetSize,
        JSON.stringify(row.ships),
        row.durationMinutes,
        row.fuelCost,
        row.state,
        row.createdAt,
        row.departedAt,
        new Date(times.arriveAtMs).toISOString(),
        new Date(times.departBackAtMs).toISOString(),
        new Date(times.completeAtMs).toISOString(),
        row.completedAt,
        row.outcome,
        row.report,
      );
    return this.missionById(row.id)!;
  }

  /**
   * Guarded state change — the travel ledger's pattern: the UPDATE
   * carries the expected current state, so a concurrent settle that
   * already moved the mission matches zero rows and nothing is
   * written twice. Returns true iff this call owns the transition.
   */
  claimTransition(id: string, fromState: MissionState, toState: MissionState): boolean {
    const res = this.h.sqlite
      .prepare(`UPDATE mission_missions SET state = ? WHERE space_id = ? AND id = ? AND state = ?`)
      .run(toState, this.spaceId, id, fromState);
    return res.changes === 1;
  }

  setOutcome(id: string, outcome: string | null, report: string | null = null): void {
    this.h.sqlite
      .prepare(`UPDATE mission_missions SET outcome = ?, report = ? WHERE space_id = ? AND id = ?`)
      .run(outcome, report, this.spaceId, id);
  }

  setCompleted(id: string, completedAtMs: number): void {
    this.h.sqlite
      .prepare(`UPDATE mission_missions SET completed_at = ? WHERE space_id = ? AND id = ?`)
      .run(new Date(completedAtMs).toISOString(), this.spaceId, id);
  }

  private mapRow(r: Record<string, unknown>): MissionRow {
    return {
      id: r.id as string,
      clientKey: r.client_key as string,
      kind: r.kind as MissionKind,
      destination: r.destination as string,
      origin: r.origin as string,
      fleetSize: r.fleet_size as number,
      ships: JSON.parse(String(r.ships)) as string[],
      durationMinutes: r.duration_minutes as number,
      fuelCost: r.fuel_cost as number,
      state: r.state as MissionState,
      createdAt: r.created_at as string,
      departedAt: (r.departed_at as string | null) ?? null,
      arriveAt: (r.arrive_at as string | null) ?? null,
      departBackAt: (r.depart_back_at as string | null) ?? null,
      completeAt: (r.complete_at as string | null) ?? null,
      completedAt: (r.completed_at as string | null) ?? null,
      outcome: (r.outcome as string | null) ?? null,
      report: (r.report as string | null) ?? null,
    };
  }

  toMission(r: MissionRow): Mission {
    return {
      id: r.id,
      clientKey: r.clientKey,
      kind: r.kind,
      destination: r.destination,
      origin: r.origin,
      fleetSize: r.fleetSize,
      ships: r.ships,
      durationMinutes: r.durationMinutes,
      fuelCost: r.fuelCost,
      state: r.state,
      createdAt: r.createdAt,
      departedAt: r.departedAt,
      arriveAt: r.arriveAt,
      returnAt: r.departBackAt,
      completedAt: r.completedAt,
      outcome: r.outcome,
      report: r.report,
    };
  }

  // --- log (append-only) ---

  appendLog(
    missionId: string | null,
    kind: string,
    act: string,
    cause: string,
    nowMs: number = Date.now(),
  ): MissionLogEntry {
    if (!act.trim() || !cause.trim()) {
      throw new Error("A mission log entry needs both an act and a cause, in plain words.");
    }
    const createdAt = new Date(nowMs).toISOString();
    const res = this.h.sqlite
      .prepare(
        `INSERT INTO mission_log (mission_id, space_id, kind, act, cause, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(missionId, this.spaceId, kind, act, cause, createdAt);
    return {
      id: Number(res.lastInsertRowid),
      missionId,
      kind,
      act,
      cause,
      createdAt,
    };
  }

  recentLog(limit = 30): MissionLogEntry[] {
    const rows = this.h.sqlite
      .prepare(
        `SELECT id, mission_id, kind, act, cause, created_at FROM mission_log
         WHERE space_id = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(this.spaceId, limit) as {
      id: number;
      mission_id: string | null;
      kind: string;
      act: string;
      cause: string;
      created_at: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      missionId: r.mission_id,
      kind: r.kind,
      act: r.act,
      cause: r.cause,
      createdAt: r.created_at,
    }));
  }

  // --- fleet stop flag ---

  fleetStopped(): boolean {
    const row = this.h.sqlite
      .prepare(`SELECT stopped FROM mission_fleet_state WHERE space_id = ?`)
      .get(this.spaceId) as { stopped: number } | undefined;
    return row?.stopped === 1;
  }

  setFleetStopped(stopped: boolean): void {
    this.h.sqlite
      .prepare(
        `INSERT INTO mission_fleet_state (space_id, stopped) VALUES (?, ?)
         ON CONFLICT(space_id) DO UPDATE SET stopped = excluded.stopped`,
      )
      .run(this.spaceId, stopped ? 1 : 0);
  }

  // --- scouting facts: the travel ledger + each world's own
  // server-side count. Nothing here is invented: a world with no
  // count reports only its journeys. The Growing Place and Deep Past
  // are not mission destinations (AD4), so they have no branch here. ---

  arrivalsTo(destination: string): { count: number; lastArrivalMs: number | null } {
    const rows = this.h.sqlite
      .prepare(
        `SELECT arrived_at FROM travel_journeys
         WHERE space_id = ? AND state = 'arrived' AND destination = ?
         ORDER BY arrived_at DESC, rowid DESC`,
      )
      .all(this.spaceId, destination) as { arrived_at: string }[];
    return {
      count: rows.length,
      lastArrivalMs: rows[0] ? Date.parse(rows[0].arrived_at) : null,
    };
  }

  scoutFacts(destination: string, nowMs: number = Date.now()): ScoutFacts {
    const arrivals = this.arrivalsTo(destination);
    const tz = spaceTimezone(this.h.sqlite, this.spaceId);
    const today = localDateKey(tz, nowMs);
    let worldCount: number | null = null;
    let worldCountLabel: string | null = null;
    let arrivalsToday: number | null = null;
    let inbound: number | null = null;
    let peopleCount: number | null = null;

    if (destination === "quiet-archive") {
      const row = this.h.sqlite
        .prepare(
          `SELECT COUNT(*) AS n FROM nodes WHERE space_id = ? AND deleted_at IS NULL AND status = 'archived'`,
        )
        .get(this.spaceId) as { n: number };
      worldCount = row.n;
      worldCountLabel = "things resting";
    } else if (destination === "great-station") {
      const rows = this.h.sqlite
        .prepare(
          `SELECT arrived_at FROM travel_journeys
           WHERE space_id = ? AND state = 'arrived' AND destination = 'great-station'`,
        )
        .all(this.spaceId) as { arrived_at: string }[];
      arrivalsToday = rows.filter((r) => localDateKey(tz, Date.parse(r.arrived_at)) === today).length;
      inbound = (
        this.h.sqlite
          .prepare(
            `SELECT COUNT(*) AS n FROM travel_journeys
             WHERE space_id = ? AND state IN ('arming','in_transit','returning') AND destination = 'great-station'`,
          )
          .get(this.spaceId) as { n: number }
      ).n;
    } else if (destination === "people") {
      const row = this.h.sqlite
        .prepare(
          `SELECT COUNT(*) AS n FROM nodes WHERE space_id = ? AND deleted_at IS NULL AND status IS NOT 'archived'
           AND (kind = 'person_entity' OR type = 'person' OR type = 'relationship_reflection')`,
        )
        .get(this.spaceId) as { n: number };
      peopleCount = row.n;
    }
    // Scale has no own count: its report is the travel ledger alone.
    return {
      arrivals: arrivals.count,
      lastArrivalMs: arrivals.lastArrivalMs,
      worldCount,
      worldCountLabel,
      arrivalsToday,
      inbound,
      peopleCount,
    };
  }
}
