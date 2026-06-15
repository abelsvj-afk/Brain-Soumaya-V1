import { sql } from "drizzle-orm";
import { sqliteTable, integer, text, real, index } from "drizzle-orm/sqlite-core";

/**
 * Relational tables for the knowledge graph. Vectors live in the separate
 * `vec_nodes` vec0 table (db/vec.ts), JOINed on node id.
 */

export const nodes = sqliteTable("nodes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
  type: text("type").notNull(),
  content: text("content").notNull(),
  emotionalWeight: real("emotional_weight"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const edges = sqliteTable(
  "edges",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: integer("source")
      .notNull()
      .references(() => nodes.id),
    target: integer("target")
      .notNull()
      .references(() => nodes.id),
    relationship: text("relationship").notNull(),
    weight: real("weight").notNull().default(1),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("edges_source_idx").on(t.source), index("edges_target_idx").on(t.target)],
);

export type NodeRow = typeof nodes.$inferSelect;
export type EdgeRow = typeof edges.$inferSelect;
