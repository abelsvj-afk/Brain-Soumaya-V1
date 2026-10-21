import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import type { Journey, JourneyLink, JourneyLinkKind, JourneyStatus } from "@brain/shared";

/**
 * Owns all SQL for `journeys` + `journey_link` (Vision 2.0). A Journey is a life chapter
 * everything can belong to; we LINK objects to it (a ref into their own table) rather than
 * copying them — so the knowledge graph + fin_* tables stay the source of truth. Space-scoped.
 */
export class JourneysRepo {
  constructor(private handle: DbHandle, private spaceId: string = DEFAULT_SPACE) {}

  private map(r: any): Journey {
    return {
      id: r.id, title: r.title, description: r.description, status: r.status as JourneyStatus,
      color: r.color ?? undefined, icon: r.icon ?? undefined, progress: r.progress,
      createdAt: r.created_at, updatedAt: r.updated_at,
      linkCount: r.link_count != null ? Number(r.link_count) : undefined,
    };
  }

  list(includeDone = true): Journey[] {
    const rows = this.handle.sqlite
      .prepare(`SELECT j.*, (SELECT COUNT(*) FROM journey_link l WHERE l.space_id = j.space_id AND l.journey_id = j.id) AS link_count
                FROM journeys j WHERE j.space_id = ? ${includeDone ? "" : "AND j.status != 'done'"}
                ORDER BY (j.status = 'active') DESC, j.updated_at DESC`)
      .all(this.spaceId) as any[];
    return rows.map((r) => this.map(r));
  }

  get(id: number): Journey | null {
    const r = this.handle.sqlite.prepare(`SELECT * FROM journeys WHERE id = ? AND space_id = ?`).get(id, this.spaceId);
    return r ? this.map(r) : null;
  }

  create(input: { title: string; description?: string; color?: string; icon?: string; status?: JourneyStatus }): Journey {
    const info = this.handle.sqlite
      .prepare(`INSERT INTO journeys (space_id, title, description, status, color, icon) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(this.spaceId, input.title.trim(), input.description ?? "", input.status ?? "active", input.color ?? null, input.icon ?? null);
    return this.get(Number(info.lastInsertRowid))!;
  }

  update(id: number, patch: Partial<Pick<Journey, "title" | "description" | "status" | "color" | "icon" | "progress">>): Journey | null {
    const cur = this.get(id);
    if (!cur) return null;
    const n = { ...cur, ...patch };
    this.handle.sqlite
      .prepare(`UPDATE journeys SET title=?, description=?, status=?, color=?, icon=?, progress=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND space_id=?`)
      .run(n.title, n.description, n.status, n.color ?? null, n.icon ?? null, Math.max(0, Math.min(1, n.progress)), id, this.spaceId);
    return this.get(id);
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

  /** Which journeys a given object belongs to (for "this memory is part of…"). */
  journeysFor(kind: JourneyLinkKind, refId: number): Journey[] {
    const rows = this.handle.sqlite
      .prepare(`SELECT j.* FROM journeys j JOIN journey_link l ON l.journey_id = j.id AND l.space_id = j.space_id
                WHERE j.space_id = ? AND l.kind = ? AND l.ref_id = ? ORDER BY j.updated_at DESC`)
      .all(this.spaceId, kind, refId) as any[];
    return rows.map((r) => this.map(r));
  }
}
