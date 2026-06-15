import { desc } from "drizzle-orm";
import type { Insight, NodeRef } from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { insights, type InsightRow } from "../db/schema.js";
import { NodesRepo } from "./nodes.repo.js";

export class InsightsRepo {
  private readonly nodes: NodesRepo;
  constructor(private readonly h: DbHandle) {
    this.nodes = new NodesRepo(h);
  }

  create(nodeA: number, nodeB: number, text: string, score: number): InsightRow {
    return this.h.db.insert(insights).values({ nodeA, nodeB, text, score }).returning().get();
  }

  /** True if an insight already exists for this unordered pair (dedupe). */
  existsPair(a: number, b: number): boolean {
    const row = this.h.sqlite
      .prepare(
        `SELECT 1 FROM insights
         WHERE (node_a = ? AND node_b = ?) OR (node_a = ? AND node_b = ?) LIMIT 1`,
      )
      .get(a, b, b, a);
    return row !== undefined;
  }

  /** Recent insights hydrated with their node references for display. */
  recent(limit = 30): Insight[] {
    const rows = this.h.db
      .select()
      .from(insights)
      .orderBy(desc(insights.id))
      .limit(limit)
      .all();
    const ids = Array.from(new Set(rows.flatMap((r) => [r.nodeA, r.nodeB])));
    const refs = new Map<number, NodeRef>(
      this.nodes.byIds(ids).map((n) => [n.id, { id: n.id, label: n.label, type: n.type }]),
    );
    return rows.map((r) => ({
      id: r.id,
      text: r.text,
      score: r.score,
      createdAt: r.createdAt,
      nodes: [refs.get(r.nodeA), refs.get(r.nodeB)].filter((x): x is NodeRef => x !== undefined),
    }));
  }
}
