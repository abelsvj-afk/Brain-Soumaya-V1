import { desc, eq } from "drizzle-orm";
import type { Insight, InsightKind, NodeRef, NodeType } from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { insights, DEFAULT_SPACE, type InsightRow } from "../db/schema.js";
import { NodesRepo } from "./nodes.repo.js";
import { NotificationsRepo } from "./notifications.repo.js";
import { localDayBoundsForDate } from "../lib/time.js";

/** Significance tier (#10) from an insight's kind + the memories it spans.
 *  1 = identity-shaping, 2 = behavioral pattern, 3 = situational. */
function insightTier(kind: InsightKind, types: NodeType[]): 1 | 2 | 3 {
  // A contradiction is, by nature, about a belief/goal/identity tension.
  if (kind === "contradiction") return 1;
  if (types.some((t) => t === "person" || t === "concept")) return 1;
  if (types.some((t) => t === "project" || t === "decision" || t === "daily" || t === "meeting")) return 2;
  return 3;
}

export class InsightsRepo {
  private readonly nodes: NodesRepo;
  constructor(
    private readonly h: DbHandle,
    private readonly spaceId: string = DEFAULT_SPACE,
  ) {
    this.nodes = new NodesRepo(h, spaceId);
  }

  create(
    nodeA: number,
    nodeB: number,
    text: string,
    score: number,
    kind: InsightKind = "synthesis",
  ): InsightRow {
    const row = this.h.db
      .insert(insights)
      .values({ spaceId: this.spaceId, nodeA, nodeB, text, score, kind })
      .returning()
      .get();
    // IM-74 producer: a newly synthesized insight is a real away-event — record
    // it in the server Inbox so it can be reported even if no session was live.
    // Best-effort: a notification failure must never fail insight creation.
    try {
      new NotificationsRepo(this.h, this.spaceId).record({
        source: "insight",
        text,
        icon: kind === "contradiction" ? "⚡" : "💡",
        priority: kind === "contradiction" ? "high" : "normal",
        dedupeKey: `insight:${row.id}`,
      });
    } catch { /* inbox is a mirror, never a gate */ }
    return row;
  }

  /** True if an insight already exists for this unordered pair (dedupe). When `kind`
   *  is given, scope the check to that kind so a connection and a contradiction can
   *  both exist for the same pair. */
  existsPair(a: number, b: number, kind?: InsightKind): boolean {
    const row = this.h.sqlite
      .prepare(
        `SELECT 1 FROM insights
         WHERE space_id = ? AND ((node_a = ? AND node_b = ?) OR (node_a = ? AND node_b = ?))
         ${kind ? "AND kind = ?" : ""} LIMIT 1`,
      )
      .get(...(kind ? [this.spaceId, a, b, b, a, kind] : [this.spaceId, a, b, b, a]));
    return row !== undefined;
  }

  /** Recent insights hydrated with their node references for display. */
  recent(limit = 30): Insight[] {
    const rows = this.h.db
      .select()
      .from(insights)
      .where(eq(insights.spaceId, this.spaceId))
      .orderBy(desc(insights.id))
      .limit(limit)
      .all();
    return this.hydrate(rows);
  }

  /**
   * REG-148 / INS-01: insights created on one SPACE-local calendar day
   * (`YYYY-MM-DD` in zone `tz`) — the digest's "Connections she surfaced
   * today" must be the day's own insights, not the five most recent of all
   * time. Instant-range membership (julianday on both sides) so the stored
   * formats' mix (naive SQLite UTC + ISO-Z) is handled the same way the
   * digest's own expired-actions block already does it. The day string is
   * the caller's (the digest's `today`); `tz` is only used to find that
   * day's real local midnights (DST-safe via `localDayBoundsForDate`).
   */
  recentOnDay(date: string, tz: string, limit = 5): Insight[] {
    const { startMs, endMs } = localDayBoundsForDate(date, tz);
    const rows = this.h.sqlite
      .prepare(
        `SELECT id, node_a AS nodeA, node_b AS nodeB, text, score, kind,
                created_at AS createdAt, space_id AS spaceId
         FROM insights
         WHERE space_id = ?
           AND julianday(created_at) >= julianday(?) AND julianday(created_at) < julianday(?)
         ORDER BY id DESC LIMIT ?`,
      )
      .all(this.spaceId, new Date(startMs).toISOString(), new Date(endMs).toISOString(), limit) as InsightRow[];
    return this.hydrate(rows);
  }

  /** Hydrate raw insight rows with their node references for display. */
  private hydrate(rows: InsightRow[]): Insight[] {
    const ids = Array.from(new Set(rows.flatMap((r) => [r.nodeA, r.nodeB])));
    const refs = new Map<number, NodeRef>(
      this.nodes.byIds(ids).map((n) => [n.id, { id: n.id, label: n.label, type: n.type }]),
    );
    return rows.map((r) => {
      const kind = (r.kind as InsightKind) ?? "synthesis";
      const nodes = [refs.get(r.nodeA), refs.get(r.nodeB)].filter((x): x is NodeRef => x !== undefined);
      return {
        id: r.id,
        text: r.text,
        score: r.score,
        createdAt: r.createdAt,
        kind,
        tier: insightTier(kind, nodes.map((n) => n.type)),
        nodes,
      };
    });
  }
}
