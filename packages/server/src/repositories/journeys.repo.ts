import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { parseTolerantMs } from "../lib/time.js";
import { getPreferences, localDay, DEFAULT_PREFS } from "../agent/notify/policy.js";
import type { Journey, JourneyLink, JourneyLinkKind, JourneySpan, JourneyStatus } from "@brain/shared";

/**
 * Owns all SQL for `journeys` + `journey_link` (Vision 2.0). A Journey is a life chapter
 * everything can belong to; we LINK objects to it (a ref into their own table) rather than
 * copying them — so the knowledge graph + fin_* tables stay the source of truth. Space-scoped.
 */
/** Derived journey progress from mission counts (IM-140): the share of all
 *  known missions (completed + still open) that are complete. No missions
 *  known → 0 (nothing has been earned yet; the caller's max() with the
 *  existing progress keeps a user-set value intact). */
export function missionProgress(completed: number, remaining: number): number {
  const total = Math.max(0, completed) + Math.max(0, remaining);
  if (total === 0) return 0;
  return Math.max(0, Math.min(1, completed / total));
}

export class JourneysRepo {
  constructor(private handle: DbHandle, private spaceId: string = DEFAULT_SPACE) {}

  /** The space's timezone for displayed span dates — the shared default
   *  applies when space_meta is unreachable (bare test DB). */
  private spaceTz(): string {
    try {
      return getPreferences(this.handle.sqlite, this.spaceId).timezone;
    } catch {
      return DEFAULT_PREFS.timezone;
    }
  }

  private map(r: any): Journey {
    return {
      id: r.id, title: r.title, description: r.description, status: r.status as JourneyStatus,
      color: r.color ?? undefined, icon: r.icon ?? undefined, progress: r.progress,
      createdAt: r.created_at, updatedAt: r.updated_at,
      linkCount: r.link_count != null ? Number(r.link_count) : undefined,
      // Migration-only columns (IM-132): absent on a pre-migration row shape → undefined.
      startedAt: r.started_at ?? undefined,
      endedAt: r.ended_at ?? undefined,
      missionsCompleted: r.missions_completed != null ? Number(r.missions_completed) : undefined,
    };
  }

  list(includeDone = true): Journey[] {
    const rows = this.handle.sqlite
      .prepare(`SELECT j.*, (SELECT COUNT(*) FROM journey_link l WHERE l.space_id = j.space_id AND l.journey_id = j.id) AS link_count,
                (SELECT COUNT(*) FROM journey_mission_completions c WHERE c.space_id = j.space_id AND c.journey_id = j.id) AS missions_completed
                FROM journeys j WHERE j.space_id = ? ${includeDone ? "" : "AND j.status != 'done'"}
                ORDER BY (j.status = 'active') DESC, j.updated_at DESC`)
      .all(this.spaceId) as any[];
    return rows.map((r) => this.map(r));
  }

  get(id: number): Journey | null {
    const r = this.handle.sqlite
      .prepare(
        `SELECT j.*, (SELECT COUNT(*) FROM journey_mission_completions c WHERE c.space_id = j.space_id AND c.journey_id = j.id) AS missions_completed
         FROM journeys j WHERE j.id = ? AND j.space_id = ?`,
      )
      .get(id, this.spaceId);
    return r ? this.map(r) : null;
  }

  create(input: { title: string; description?: string; color?: string; icon?: string; status?: JourneyStatus; startedAt?: string | null; endedAt?: string | null }): Journey {
    const info = this.handle.sqlite
      .prepare(`INSERT INTO journeys (space_id, title, description, status, color, icon, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(this.spaceId, input.title.trim(), input.description ?? "", input.status ?? "active", input.color ?? null, input.icon ?? null, input.startedAt ?? null, input.endedAt ?? null);
    return this.get(Number(info.lastInsertRowid))!;
  }

  update(id: number, patch: Partial<Pick<Journey, "title" | "description" | "status" | "color" | "icon" | "progress">> & { startedAt?: string | null; endedAt?: string | null }): Journey | null {
    const cur = this.get(id);
    if (!cur) return null;
    const n = { ...cur, ...patch };
    this.handle.sqlite
      .prepare(`UPDATE journeys SET title=?, description=?, status=?, color=?, icon=?, progress=?, started_at=?, ended_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND space_id=?`)
      .run(n.title, n.description, n.status, n.color ?? null, n.icon ?? null, Math.max(0, Math.min(1, n.progress)), n.startedAt ?? null, n.endedAt ?? null, id, this.spaceId);
    return this.get(id);
  }

  // ---- Spans (IM-132: Journeys on a real time axis) ----

  /** Date column per link kind for span inference. Kinds with no dated source
   *  table (bill = a recurring schedule, task/chat/achievement = no table) are
   *  omitted — they contribute no dates, exactly as REF_TABLE documents. */
  private static LINK_DATE: Partial<Record<JourneyLinkKind, { table: string; column: string; extra?: string }>> = {
    node: { table: "nodes", column: "created_at", extra: "AND deleted_at IS NULL" },
    income: { table: "fin_income", column: "date" },
    expense: { table: "fin_expense", column: "date" },
    insight: { table: "insights", column: "created_at" },
    doc: { table: "knowledge_docs", column: "created_at" },
    goal: { table: "fin_goal", column: "created_at" },
  };

  /** Earliest/latest dated instants among a journey's links (raw stored strings), or nulls. */
  linkedDateRange(journeyId: number): { min: string | null; max: string | null } {
    let minMs = Infinity, maxMs = -Infinity, min: string | null = null, max: string | null = null;
    const links = this.links(journeyId);
    for (const l of links) {
      const spec = JourneysRepo.LINK_DATE[l.kind];
      if (!spec) continue;
      const row = this.handle.sqlite
        .prepare(`SELECT ${spec.column} AS d FROM ${spec.table} WHERE id = ? AND space_id = ? ${spec.extra ?? ""}`)
        .get(l.refId, this.spaceId) as { d: string } | undefined;
      if (!row?.d) continue;
      const ms = parseTolerantMs(row.d);
      if (!Number.isFinite(ms)) continue;
      if (ms < minMs) { minMs = ms; min = row.d; }
      if (ms > maxMs) { maxMs = ms; max = row.d; }
    }
    return { min, max };
  }

  /** Hybrid span for one journey (spec Option 3, chosen as the minimal faithful
   *  reading of the brief: explicit columns + link inference + safe fallbacks).
   *  A journey with no dates at all still gets a defined span from createdAt —
   *  never a crash/NaN. Dates are exposed as UTC calendar dates (startDate /
   *  endDate) alongside the raw instants, per the fixed-calendar-date rule. */
  spanFor(journey: Journey): JourneySpan {
    const range = this.linkedDateRange(journey.id);
    let start: string, startSource: JourneySpan["startSource"];
    if (journey.startedAt) { start = journey.startedAt; startSource = "explicit"; }
    else if (range.min) { start = range.min; startSource = "links"; }
    else { start = journey.createdAt; startSource = "created"; }

    let end: string | null, endSource: JourneySpan["endSource"];
    if (journey.endedAt) { end = journey.endedAt; endSource = "explicit"; }
    else if (journey.status === "done" && range.max) { end = range.max; endSource = "links"; }
    else if (journey.status === "done") { end = journey.updatedAt; endSource = "updated"; }
    else { end = null; endSource = "open"; }

    // Guard: an inverted explicit pair (end before start) clamps end to start
    // rather than producing a negative-width band on the axis.
    if (end !== null) {
      const sMs = parseTolerantMs(start), eMs = parseTolerantMs(end);
      if (Number.isFinite(sMs) && Number.isFinite(eMs) && eMs < sMs) end = start;
    }
    // Displayed span dates follow the SPACE's local calendar (owner rule
    // 2026-10-21): an explicit bare date stays itself; a stored instant
    // (from linked memories / created / updated) renders as its local day.
    const tz = this.spaceTz();
    const displayDate = (raw: string): string => {
      const t = raw.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
      const ms = parseTolerantMs(t);
      return Number.isFinite(ms) ? localDay(new Date(ms), tz) : t.slice(0, 10);
    };
    return {
      journey,
      start,
      end,
      ongoing: end === null,
      startDate: displayDate(start),
      endDate: end !== null ? displayDate(end) : null,
      startSource,
      endSource,
    };
  }

  /** Spans for every journey in the space, ordered by span start. */
  listSpans(includeDone = true): JourneySpan[] {
    return this.list(includeDone)
      .map((j) => this.spanFor(j))
      .sort((a, b) => (parseTolerantMs(a.start) || 0) - (parseTolerantMs(b.start) || 0));
  }

  remove(id: number): boolean {
    const tx = this.handle.sqlite.transaction(() => {
      this.handle.sqlite.prepare(`DELETE FROM journey_link WHERE journey_id = ? AND space_id = ?`).run(id, this.spaceId);
      return this.handle.sqlite.prepare(`DELETE FROM journeys WHERE id = ? AND space_id = ?`).run(id, this.spaceId).changes > 0;
    });
    return tx();
  }

  // ---- Links (attach any object to a journey; we never copy the object) ----
  private mapLink(r: any): JourneyLink {
    return { id: r.id, journeyId: r.journey_id, kind: r.kind as JourneyLinkKind, refId: r.ref_id, createdAt: r.created_at };
  }

  // Kinds with a direct, single-table mapping we can cheaply verify exist in this space
  // before linking. "task"/"chat"/"achievement" have no dedicated table of their own in
  // this schema (yet) so are left unvalidated rather than risk guessing wrong.
  private static REF_TABLE: Partial<Record<JourneyLinkKind, { table: string; extra?: string }>> = {
    node: { table: "nodes", extra: "AND deleted_at IS NULL" },
    income: { table: "fin_income" },
    expense: { table: "fin_expense" },
    bill: { table: "fin_bill" },
    insight: { table: "insights" },
    doc: { table: "knowledge_docs" },
    goal: { table: "fin_goal" },
  };

  private refExists(kind: JourneyLinkKind, refId: number): boolean {
    const spec = JourneysRepo.REF_TABLE[kind];
    if (!spec) return true; // no known table for this kind — can't validate, don't block it
    const row = this.handle.sqlite
      .prepare(`SELECT 1 FROM ${spec.table} WHERE id = ? AND space_id = ? ${spec.extra ?? ""}`)
      .get(refId, this.spaceId);
    return row != null;
  }

  link(journeyId: number, kind: JourneyLinkKind, refId: number): JourneyLink | null {
    if (!this.get(journeyId)) return null; // journey must exist + be in this space
    // Prevents journey_link from accumulating dangling rows pointing at a ref that was
    // never real (or already belongs to/was deleted from a different space) — this is
    // the write-time guard; readers that hydrate a link still re-check ownership too.
    if (!this.refExists(kind, refId)) return null;
    this.handle.sqlite
      .prepare(`INSERT OR IGNORE INTO journey_link (space_id, journey_id, kind, ref_id) VALUES (?, ?, ?, ?)`)
      .run(this.spaceId, journeyId, kind, refId);
    this.handle.sqlite.prepare(`UPDATE journeys SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND space_id = ?`).run(journeyId, this.spaceId);
    const r = this.handle.sqlite
      .prepare(`SELECT * FROM journey_link WHERE space_id = ? AND journey_id = ? AND kind = ? AND ref_id = ?`)
      .get(this.spaceId, journeyId, kind, refId);
    return r ? this.mapLink(r) : null;
  }

  unlink(journeyId: number, kind: JourneyLinkKind, refId: number): boolean {
    return this.handle.sqlite
      .prepare(`DELETE FROM journey_link WHERE space_id = ? AND journey_id = ? AND kind = ? AND ref_id = ?`)
      .run(this.spaceId, journeyId, kind, refId).changes > 0;
  }

  /** True earned/spent totals over ALL of a journey's income/expense links (IM-87).
   *  Aggregated in SQL over the full link set — never over a display-capped subset —
   *  joining each link to its own finance row in the same space. A dangling link
   *  (target row deleted) contributes nothing, exactly as hydration skips it. */
  linkTotals(journeyId: number): { earnedCents: number; spentCents: number } {
    const row = this.handle.sqlite
      .prepare(`SELECT
                  (SELECT COALESCE(SUM(i.net_cents), 0) FROM journey_link l
                     JOIN fin_income i ON i.id = l.ref_id AND i.space_id = l.space_id
                    WHERE l.space_id = ? AND l.journey_id = ? AND l.kind = 'income') AS earned,
                  (SELECT COALESCE(SUM(e.amount_cents), 0) FROM journey_link l
                     JOIN fin_expense e ON e.id = l.ref_id AND e.space_id = l.space_id
                    WHERE l.space_id = ? AND l.journey_id = ? AND l.kind = 'expense') AS spent`)
      .get(this.spaceId, journeyId, this.spaceId, journeyId) as { earned: number; spent: number };
    return { earnedCents: Number(row.earned), spentCents: Number(row.spent) };
  }

  links(journeyId: number): JourneyLink[] {
    const rows = this.handle.sqlite
      .prepare(`SELECT * FROM journey_link WHERE space_id = ? AND journey_id = ? ORDER BY created_at DESC`)
      .all(this.spaceId, journeyId) as any[];
    return rows.map((r) => this.mapLink(r));
  }

  /** Journeys a mission (action node) is linked to, via either link kind that
   *  can point at a node row: "task" (an action item) or "node". */
  journeysForMission(taskRefId: number): Journey[] {
    const rows = this.handle.sqlite
      .prepare(
        `SELECT DISTINCT j.* FROM journeys j JOIN journey_link l ON l.journey_id = j.id AND l.space_id = j.space_id
          WHERE j.space_id = ? AND l.kind IN ('task', 'node') AND l.ref_id = ?`,
      )
      .all(this.spaceId, taskRefId) as any[];
    return rows.map((r) => this.map(r));
  }

  /**
   * Auto-credit a journey for a completed linked mission (IM-140, Vision 2.0:
   * "Completed missions permanently strengthen the associated Journey").
   *
   * Records the completion durably (the action node itself is deleted on
   * completion, so the link alone can't carry the history), removes the now
   * dangling link, and derives progress as
   *   completed / (completed + still-open linked missions)
   * over REAL rows only. Auto-credit never lowers a journey's progress —
   * a user-set higher value stands ("strengthen" is one-directional).
   * Idempotent: completing the same ref twice credits once.
   * Returns the credited journey with its new progress, or null when the
   * journey isn't in this space.
   */
  creditCompletedMission(journeyId: number, taskRefId: number): { journey: Journey; completedCount: number } | null {
    const journey = this.get(journeyId);
    if (!journey) return null;
    const tx = this.handle.sqlite.transaction(() => {
      this.handle.sqlite
        .prepare(`INSERT OR IGNORE INTO journey_mission_completions (space_id, journey_id, task_ref_id) VALUES (?, ?, ?)`)
        .run(this.spaceId, journeyId, taskRefId);
      // The completed action node is gone; its link would dangle. The
      // completion row above is now the durable record of that mission.
      this.handle.sqlite
        .prepare(`DELETE FROM journey_link WHERE space_id = ? AND journey_id = ? AND kind IN ('task', 'node') AND ref_id = ?`)
        .run(this.spaceId, journeyId, taskRefId);
      const completedCount = (
        this.handle.sqlite
          .prepare(`SELECT COUNT(*) AS n FROM journey_mission_completions WHERE space_id = ? AND journey_id = ?`)
          .get(this.spaceId, journeyId) as { n: number }
      ).n;
      const remaining = (
        this.handle.sqlite
          .prepare(
            `SELECT COUNT(*) AS n FROM journey_link l JOIN nodes n ON n.id = l.ref_id AND n.space_id = l.space_id
              WHERE l.space_id = ? AND l.journey_id = ? AND l.kind IN ('task', 'node')
                AND n.kind = 'action' AND n.deleted_at IS NULL`,
          )
          .get(this.spaceId, journeyId) as { n: number }
      ).n;
      const derived = missionProgress(completedCount, remaining);
      const next = Math.max(journey.progress, derived);
      if (next !== journey.progress) {
        this.handle.sqlite
          .prepare(`UPDATE journeys SET progress = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND space_id = ?`)
          .run(next, journeyId, this.spaceId);
      }
      return completedCount;
    });
    const completedCount = tx();
    const updated = this.get(journeyId);
    return updated ? { journey: updated, completedCount } : null;
  }

  /** Which journeys a given object belongs to (for "this memory is part of…"). */
  journeysFor(kind: JourneyLinkKind, refId: number): Journey[] {
    const rows = this.handle.sqlite
      .prepare(`SELECT j.* FROM journeys j JOIN journey_link l ON l.journey_id = j.id AND l.space_id = j.space_id
                WHERE j.space_id = ? AND l.kind = ? AND l.ref_id = ? ORDER BY j.updated_at DESC`)
      .all(this.spaceId, kind, refId) as any[];
    return rows.map((r) => this.map(r));
  }
}
