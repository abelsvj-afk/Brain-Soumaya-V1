import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import {
  composeWave,
  type FleetDefenseInvader,
  type FleetDefenseLogEntry,
  type FleetDefenseRelease,
  type FleetDefenseReleaseKind,
  type FleetDefenseReleaseSize,
  type FleetDefenseReleaseStatus,
  type FleetDefenseState,
  type FleetDefenseStatus,
  type FleetDefenseTickMode,
} from "@brain/shared";

/**
 * Fleet defense persistence (Wave 2, fleet defense): the releases
 * the user marked, the defenses flown against them, and the
 * append-only log of everything that happened.
 *
 * Everything here is space-scoped: another space's releases and
 * defenses are invisible, and brain deletion removes them
 * (SPACE_SCOPED_TABLES). The log is append-only — no update, no
 * delete path exists in this module. The linked brain record
 * (`node_id`) is a pointer only: this module never writes to the
 * nodes table, never deletes a node, never changes a memory. A
 * world event never rewrites the brain facts that triggered it.
 */

export interface OfferReleaseInput {
  kind: FleetDefenseReleaseKind;
  size: FleetDefenseReleaseSize;
  label: string;
  nodeId: number | null;
}

interface ReleaseRow {
  id: number;
  kind: string;
  size: string;
  label: string;
  node_id: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface DefenseRow {
  id: number;
  release_id: number;
  status: string;
  invaders_json: string;
  tick_count: number;
  last_mode: string | null;
  last_line: string | null;
  outcome_line: string | null;
  created_at: string;
  updated_at: string;
}

interface LogRow {
  id: number;
  defense_id: number | null;
  release_id: number | null;
  kind: string;
  text: string;
  created_at: string;
}

function mapRelease(r: ReleaseRow): FleetDefenseRelease {
  return {
    id: r.id,
    kind: r.kind as FleetDefenseReleaseKind,
    size: r.size as FleetDefenseReleaseSize,
    label: r.label,
    nodeId: r.node_id,
    status: r.status as FleetDefenseReleaseStatus,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapDefense(r: DefenseRow): FleetDefenseState {
  return {
    id: r.id,
    releaseId: r.release_id,
    status: r.status as FleetDefenseStatus,
    invaders: JSON.parse(r.invaders_json) as FleetDefenseInvader[],
    tickCount: r.tick_count,
    lastMode: r.last_mode as FleetDefenseTickMode | null,
    lastLine: r.last_line,
    outcomeLine: r.outcome_line,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapLog(r: LogRow): FleetDefenseLogEntry {
  return {
    id: r.id,
    defenseId: r.defense_id,
    releaseId: r.release_id,
    kind: r.kind as FleetDefenseLogEntry["kind"],
    text: r.text,
    createdAt: r.created_at,
  };
}

export class FleetDefenseRepo {
  constructor(
    private h: DbHandle,
    private spaceId: string = DEFAULT_SPACE,
  ) {}

  /** Does this brain record exist in this space? A release may only
   *  link to a real node — a dangling pointer would be a release
   *  about nothing. */
  nodeExists(nodeId: number): boolean {
    const row = this.h.sqlite
      .prepare(`SELECT 1 AS x FROM nodes WHERE id = ? AND space_id = ?`)
      .get(nodeId, this.spaceId) as { x: number } | undefined;
    return !!row;
  }

  // --- releases ---

  offerRelease(input: OfferReleaseInput, nowMs: number = Date.now()): FleetDefenseRelease {
    const at = new Date(nowMs).toISOString();
    const res = this.h.sqlite
      .prepare(
        `INSERT INTO fleet_defense_releases (space_id, kind, size, label, node_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'offered', ?, ?)`,
      )
      .run(this.spaceId, input.kind, input.size, input.label, input.nodeId, at, at);
    const row = this.h.sqlite
      .prepare(`SELECT * FROM fleet_defense_releases WHERE id = ?`)
      .get(Number(res.lastInsertRowid)) as ReleaseRow;
    return mapRelease(row);
  }

  getRelease(id: number): FleetDefenseRelease | null {
    const row = this.h.sqlite
      .prepare(`SELECT * FROM fleet_defense_releases WHERE space_id = ? AND id = ?`)
      .get(this.spaceId, id) as ReleaseRow | undefined;
    return row ? mapRelease(row) : null;
  }

  listReleases(): FleetDefenseRelease[] {
    const rows = this.h.sqlite
      .prepare(`SELECT * FROM fleet_defense_releases WHERE space_id = ? ORDER BY id DESC`)
      .all(this.spaceId) as ReleaseRow[];
    return rows.map(mapRelease);
  }

  setReleaseStatus(id: number, status: FleetDefenseReleaseStatus, nowMs: number = Date.now()): void {
    this.h.sqlite
      .prepare(`UPDATE fleet_defense_releases SET status = ?, updated_at = ? WHERE space_id = ? AND id = ?`)
      .run(status, new Date(nowMs).toISOString(), this.spaceId, id);
  }

  // --- defenses ---

  createDefense(releaseId: number, size: FleetDefenseReleaseSize, nowMs: number = Date.now()): FleetDefenseState {
    const at = new Date(nowMs).toISOString();
    const res = this.h.sqlite
      .prepare(
        `INSERT INTO fleet_defense_defenses (release_id, space_id, status, invaders_json, tick_count, created_at, updated_at)
         VALUES (?, ?, 'active', ?, 0, ?, ?)`,
      )
      .run(releaseId, this.spaceId, JSON.stringify(composeWave(size)), at, at);
    const row = this.h.sqlite
      .prepare(`SELECT * FROM fleet_defense_defenses WHERE id = ?`)
      .get(Number(res.lastInsertRowid)) as DefenseRow;
    return mapDefense(row);
  }

  getDefense(id: number): FleetDefenseState | null {
    const row = this.h.sqlite
      .prepare(`SELECT * FROM fleet_defense_defenses WHERE space_id = ? AND id = ?`)
      .get(this.spaceId, id) as DefenseRow | undefined;
    return row ? mapDefense(row) : null;
  }

  /** The active defense for one release, if it has one. One release
   *  defends one fleet at a time. */
  activeDefenseForRelease(releaseId: number): FleetDefenseState | null {
    const row = this.h.sqlite
      .prepare(
        `SELECT * FROM fleet_defense_defenses WHERE space_id = ? AND release_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`,
      )
      .get(this.spaceId, releaseId) as DefenseRow | undefined;
    return row ? mapDefense(row) : null;
  }

  /** The newest active defense in the space, if any — the panel's
   *  one live board. */
  activeDefense(): FleetDefenseState | null {
    const row = this.h.sqlite
      .prepare(
        `SELECT * FROM fleet_defense_defenses WHERE space_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`,
      )
      .get(this.spaceId) as DefenseRow | undefined;
    return row ? mapDefense(row) : null;
  }

  /** Resolved defenses, newest first — the history the panel shows. */
  history(limit = 10): FleetDefenseState[] {
    const rows = this.h.sqlite
      .prepare(
        `SELECT * FROM fleet_defense_defenses WHERE space_id = ? AND status IN ('won', 'lost') ORDER BY id DESC LIMIT ?`,
      )
      .all(this.spaceId, limit) as DefenseRow[];
    return rows.map(mapDefense);
  }

  saveDefense(d: FleetDefenseState, nowMs: number = Date.now()): void {
    this.h.sqlite
      .prepare(
        `UPDATE fleet_defense_defenses
         SET status = ?, invaders_json = ?, tick_count = ?, last_mode = ?, last_line = ?, outcome_line = ?, updated_at = ?
         WHERE space_id = ? AND id = ?`,
      )
      .run(
        d.status,
        JSON.stringify(d.invaders),
        d.tickCount,
        d.lastMode,
        d.lastLine,
        d.outcomeLine,
        new Date(nowMs).toISOString(),
        this.spaceId,
        d.id,
      );
  }

  // --- log (append-only) ---

  appendLog(
    kind: FleetDefenseLogEntry["kind"],
    text: string,
    opts: { defenseId?: number | null; releaseId?: number | null } = {},
    nowMs: number = Date.now(),
  ): FleetDefenseLogEntry {
    if (!text.trim()) throw new Error("A fleet defense log entry needs plain words.");
    const res = this.h.sqlite
      .prepare(
        `INSERT INTO fleet_defense_log (defense_id, release_id, space_id, kind, text, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        opts.defenseId ?? null,
        opts.releaseId ?? null,
        this.spaceId,
        kind,
        text,
        new Date(nowMs).toISOString(),
      );
    const row = this.h.sqlite
      .prepare(`SELECT * FROM fleet_defense_log WHERE id = ?`)
      .get(Number(res.lastInsertRowid)) as LogRow;
    return mapLog(row);
  }

  recentLog(limit = 20): FleetDefenseLogEntry[] {
    const rows = this.h.sqlite
      .prepare(`SELECT * FROM fleet_defense_log WHERE space_id = ? ORDER BY id DESC LIMIT ?`)
      .all(this.spaceId, limit) as LogRow[];
    return rows.map(mapLog);
  }
}
