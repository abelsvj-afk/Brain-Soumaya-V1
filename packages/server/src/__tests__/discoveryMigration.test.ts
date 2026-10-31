import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import BetterSqlite3 from "better-sqlite3";
import { createDb } from "../db/client.js";

/**
 * P1-MIG (docs/specs/unified-discovery-architecture-2026-10-31.md §3, §15): the three provenance columns arrive additively, with no default, on a fresh database AND on a legacy
 * volume, idempotently, and the two copies of the DDL stay identical.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const cols = (db: BetterSqlite3.Database) => db.prepare(`PRAGMA table_info(story_finds)`).all() as { name: string; notnull: number; dflt_value: string | null; type: string }[];

const LEGACY_DDL = `CREATE TABLE story_finds (
  space_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  found_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  source TEXT NOT NULL,
  last_recalled_at TEXT,
  recall_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (space_id, entry_id)
)`;

const tmpFiles: string[] = [];
afterEach(() => {
  for (const f of tmpFiles.splice(0)) for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(f + suffix, { force: true });
});
const tmpDb = () => {
  const f = path.join(os.tmpdir(), `discovery-mig-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
  tmpFiles.push(f);
  return f;
};

describe("P1-MIG: trust columns on story_finds", () => {
  it("a fresh database has the three columns, nullable, with no default", () => {
    const h = createDb(":memory:");
    const byName = new Map(cols(h.sqlite).map((c) => [c.name, c]));
    for (const name of ["trust", "trust_at", "trust_basis"]) {
      const c = byName.get(name);
      expect(c, name).toBeDefined();
      expect(c!.notnull, `${name} must be nullable`).toBe(0);
      expect(c!.dflt_value, `${name} must have no default`).toBeNull();
    }
    h.sqlite.close();
  });

  it("the trust column accepts only 'accepted' or 'imported' (or NULL)", () => {
    const h = createDb(":memory:");
    const ins = (trust: string | null) => h.sqlite.prepare(`INSERT INTO story_finds (space_id, entry_id, source, trust) VALUES ('s', ?, 'regard', ?)`);
    expect(() => ins("accepted").run("e1", "accepted")).not.toThrow();
    expect(() => ins("imported").run("e2", "imported")).not.toThrow();
    expect(() => ins(null).run("e3", null)).not.toThrow();
    expect(() => ins("verified").run("e4", "verified")).toThrow(/CHECK/i); // "accepted" is never "verified"
    h.sqlite.close();
  });

  it("a legacy volume gains the columns in place: old rows read NULL, nothing is lost, a repeat boot is a no-op", () => {
    const file = tmpDb();
    // 1. Boot once to create a full schema, then put story_finds back into its pre-Phase-1 shape with real rows (what a Fly volume looks like today).
    const first = createDb(file);
    first.sqlite.exec(`DROP TABLE story_finds`);
    first.sqlite.exec(LEGACY_DDL);
    first.sqlite
      .prepare(`INSERT INTO story_finds (space_id, entry_id, found_at, source, last_recalled_at, recall_count) VALUES ('s','sight.a','2026-10-01T00:00:00.000Z','regard','2026-10-02T00:00:00.000Z',3), ('s','relic.b','2026-10-03T00:00:00.000Z','relic',NULL,0)`)
      .run();
    expect(cols(first.sqlite).map((c) => c.name)).not.toContain("trust");
    first.sqlite.close();

    // 2. The next boot upgrades it in place.
    const second = createDb(file);
    expect(cols(second.sqlite).map((c) => c.name)).toEqual(expect.arrayContaining(["trust", "trust_at", "trust_basis"]));
    const rows = second.sqlite.prepare(`SELECT entry_id, found_at, source, last_recalled_at, recall_count, trust, trust_at, trust_basis FROM story_finds ORDER BY entry_id`).all();
    expect(rows).toEqual([
      { entry_id: "relic.b", found_at: "2026-10-03T00:00:00.000Z", source: "relic", last_recalled_at: null, recall_count: 0, trust: null, trust_at: null, trust_basis: null },
      { entry_id: "sight.a", found_at: "2026-10-01T00:00:00.000Z", source: "regard", last_recalled_at: "2026-10-02T00:00:00.000Z", recall_count: 3, trust: null, trust_at: null, trust_basis: null },
    ]);
    const shape = JSON.stringify(cols(second.sqlite));
    second.sqlite.close();

    // 3. A further boot changes nothing.
    const third = createDb(file);
    expect(JSON.stringify(cols(third.sqlite))).toBe(shape);
    expect(third.sqlite.prepare(`SELECT COUNT(*) AS n FROM story_finds`).get()).toEqual({ n: 2 });
    third.sqlite.close();
  }, 60_000);

  it("a VACUUM INTO copy (how backups are made) keeps the columns and every row", () => {
    const file = tmpDb();
    const snap = tmpDb();
    const h = createDb(file);
    h.sqlite
      .prepare(`INSERT INTO story_finds (space_id, entry_id, found_at, source, trust, trust_at, trust_basis) VALUES ('s','relic.a','2026-10-01T00:00:00.000Z','relic','accepted','2026-10-01T00:00:00.000Z','live:v1'), ('s','relic.b','2026-10-02T00:00:00.000Z','import','imported','2026-10-02T00:00:00.000Z','client-report')`)
      .run();
    h.sqlite.prepare(`INSERT INTO story_finds (space_id, entry_id, found_at, source) VALUES ('s','sight.c','2026-10-03T00:00:00.000Z','regard')`).run();
    h.sqlite.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`);
    h.sqlite.close();
    const copy = new BetterSqlite3(snap, { readonly: true });
    expect(cols(copy).map((c) => c.name)).toEqual(expect.arrayContaining(["trust", "trust_at", "trust_basis"]));
    expect(copy.prepare(`SELECT entry_id, trust, trust_at, trust_basis FROM story_finds ORDER BY entry_id`).all()).toEqual([
      { entry_id: "relic.a", trust: "accepted", trust_at: "2026-10-01T00:00:00.000Z", trust_basis: "live:v1" },
      { entry_id: "relic.b", trust: "imported", trust_at: "2026-10-02T00:00:00.000Z", trust_basis: "client-report" },
      { entry_id: "sight.c", trust: null, trust_at: null, trust_basis: null },
    ]);
    copy.close();
  });

  it("the two copies of the story_finds DDL (schemaSql.ts and db/client.ts) are identical", () => {
    const ddl = (file: string) => {
      const src = fs.readFileSync(path.join(here, "..", "db", file), "utf8");
      const m = /CREATE TABLE IF NOT EXISTS story_finds \([\s\S]*?\n\s*\);/.exec(src);
      expect(m, `${file} must contain the story_finds DDL`).not.toBeNull();
      return m![0].replace(/\s+/g, " ").trim();
    };
    expect(ddl("client.ts")).toBe(ddl("schemaSql.ts"));
  });

  it("is purely additive: the migration contains no DROP/DELETE/UPDATE against story_finds", () => {
    const src = fs.readFileSync(path.join(here, "..", "db", "client.ts"), "utf8");
    const block = src.slice(src.indexOf("const storyFindsCols"), src.indexOf("const storyFindsCols") + 900);
    expect(block).toMatch(/ADD COLUMN trust /);
    expect(block).not.toMatch(/DROP|DELETE|UPDATE\s+story_finds/i);
  });
});
