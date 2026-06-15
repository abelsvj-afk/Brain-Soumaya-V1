import BetterSqlite3 from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import * as schema from "./schema.js";
import { bootstrapVec, type RawDb } from "./vec.js";

export type Schema = typeof schema;
export type Db = BetterSQLite3Database<Schema>;

export interface DbHandle {
  /** Drizzle instance for type-safe relational queries. */
  db: Db;
  /** Raw better-sqlite3 connection for vector + recursive-CTE SQL. */
  sqlite: RawDb;
}

/**
 * Bootstrap the relational schema in raw SQL. Mirrors db/schema.ts and keeps
 * tests fully self-contained (drizzle-kit migrations remain available via
 * `npm run db:generate` for production deploys).
 */
export function bootstrapSchema(sqlite: RawDb): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      emotional_weight REAL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source INTEGER NOT NULL REFERENCES nodes(id),
      target INTEGER NOT NULL REFERENCES nodes(id),
      relationship TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS edges_source_idx ON edges(source);
    CREATE INDEX IF NOT EXISTS edges_target_idx ON edges(target);
  `);
}

/**
 * Open the database, load sqlite-vec, and bootstrap both the relational and
 * vector schemas. Pass ":memory:" for tests.
 */
export function createDb(path: string = process.env.DB_PATH ?? "./brain.db"): DbHandle {
  const sqlite = new BetterSqlite3(path);
  sqliteVec.load(sqlite);
  if (path !== ":memory:") {
    sqlite.pragma("journal_mode = WAL");
  }
  sqlite.pragma("foreign_keys = ON");
  bootstrapSchema(sqlite);
  bootstrapVec(sqlite);
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}
