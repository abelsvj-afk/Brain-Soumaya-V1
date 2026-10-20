/**
 * W3 Milestone 3 — Design Amendment 1 §2: the user_model.invalid_reason
 * CHECK migration (five values → seven, adding 'stated_conflict' and
 * 'evidence_forgotten') via table rebuild, plus the T-C55 extension
 * (bootstrap-vs-migration equivalence incl. the extended CHECK).
 *
 * The helper is exercised directly on raw better-sqlite3 connections
 * built with the PRE-M3 (five-value) DDL, mirroring a real M1/M2-era
 * volume, and end-to-end through createDb() on a legacy file.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import BetterSqlite3 from "better-sqlite3";
import {
  createDb,
  migrateUserModelInvalidReasonCheck,
  parseInvalidReasonCheckSet,
  USER_MODEL_INVALID_REASONS_V2,
  type DbHandle,
} from "../../db/client.js";

type Raw = InstanceType<typeof BetterSqlite3>;

const LEGACY_DDL = `
  CREATE TABLE user_model (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    space_id TEXT NOT NULL DEFAULT 'legacy',
    slot TEXT NOT NULL CHECK (slot IN (
      'belief','desire','intention','emotion_state','knowledge','constraint'
    )),
    content TEXT NOT NULL,
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    evidence_strength REAL NOT NULL DEFAULT 0 CHECK (evidence_strength >= 0 AND evidence_strength <= 1),
    evidence_ids TEXT NOT NULL DEFAULT '[]',
    topic_labels TEXT NOT NULL DEFAULT '[]',
    valid_at TEXT NOT NULL,
    invalid_at TEXT,
    invalid_reason TEXT CHECK (invalid_reason IN (
      'superseded','corrected_false_belief','evidence_withdrawn','expired','user_override'
    )),
    replaced_by INTEGER,
    origin TEXT NOT NULL CHECK (origin IN ('stated','inferred','consolidated')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    review_flag TEXT,
    review_flagged_at TEXT,
    UNIQUE (space_id, slot, content, valid_at)
  );
  CREATE INDEX idx_user_model_current ON user_model(space_id, slot) WHERE invalid_at IS NULL;
  CREATE INDEX idx_user_model_origin ON user_model(space_id, origin);
  CREATE INDEX idx_user_model_replaced ON user_model(replaced_by);
`;

function legacyDb(reasons?: string[]): Raw {
  const db = new BetterSqlite3(":memory:");
  const ddl = reasons
    ? LEGACY_DDL.replace(
        `'superseded','corrected_false_belief','evidence_withdrawn','expired','user_override'`,
        reasons.map((r) => `'${r}'`).join(","),
      )
    : LEGACY_DDL;
  db.exec(ddl);
  return db;
}

function seedRows(db: Raw): void {
  const ins = db.prepare(
    `INSERT INTO user_model (space_id, slot, content, confidence, evidence_strength,
       evidence_ids, topic_labels, valid_at, invalid_at, invalid_reason, replaced_by,
       origin, review_flag, review_flagged_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  ins.run("s1", "belief", "works at Samsonite warehouse", 0.95, 0.5, '[{"type":"episode","id":1}]', '["work"]',
    "2026-10-01T00:00:00.000Z", null, null, null, "stated", null, null);
  ins.run("s1", "knowledge", "the fee is $85", 0.4, 0.34, '[{"type":"episode","id":2}]', '["fees"]',
    "2026-10-02T00:00:00.000Z", "2026-10-03T00:00:00.000Z", "expired", null, "inferred", "stale_emotion", "2026-10-03T00:00:00.000Z");
  ins.run("s1", "emotion_state", "feels stressed about money", 0.6, 0.2, '[{"type":"episode","id":3}]', '[]',
    "2026-10-04T00:00:00.000Z", null, null, 1, "consolidated", null, null);
}

function allRows(db: Raw): Record<string, unknown>[] {
  return db.prepare(`SELECT * FROM user_model ORDER BY id`).all() as Record<string, unknown>[];
}

function checkSet(db: Raw): string[] | null {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='user_model'`)
    .get() as { sql: string };
  return parseInvalidReasonCheckSet(row.sql);
}

const openDbs: Raw[] = [];
function track<T extends Raw>(db: T): T {
  openDbs.push(db);
  return db;
}
afterEach(() => {
  while (openDbs.length) openDbs.pop()!.close();
});

describe("Amendment 1 §2: invalid_reason CHECK migration", () => {
  it("five→seven migration: zero row loss, zero value change, new reasons admitted", () => {
    const db = track(legacyDb());
    seedRows(db);
    const before = allRows(db);
    expect(checkSet(db)).toHaveLength(5);

    const res = migrateUserModelInvalidReasonCheck(db as never);
    expect(res.migrated).toBe(true);
    expect(checkSet(db)).toEqual(expect.arrayContaining([...USER_MODEL_INVALID_REASONS_V2]));
    expect(checkSet(db)).toHaveLength(7);
    expect(allRows(db)).toEqual(before);

    // The two new values are now lawful.
    db.prepare(
      `UPDATE user_model SET invalid_at = '2026-10-05T00:00:00.000Z', invalid_reason = 'stated_conflict' WHERE id = 1`,
    ).run();
    db.prepare(
      `UPDATE user_model SET invalid_at = '2026-10-05T00:00:00.000Z', invalid_reason = 'evidence_forgotten' WHERE id = 3`,
    ).run();
    expect(allRows(db)[0].invalid_reason).toBe("stated_conflict");
    expect(allRows(db)[2].invalid_reason).toBe("evidence_forgotten");
  });

  it("double-run is a no-op", () => {
    const db = track(legacyDb());
    seedRows(db);
    expect(migrateUserModelInvalidReasonCheck(db as never).migrated).toBe(true);
    const afterFirst = allRows(db);
    expect(migrateUserModelInvalidReasonCheck(db as never).migrated).toBe(false);
    expect(allRows(db)).toEqual(afterFirst);
    expect(checkSet(db)).toHaveLength(7);
  });

  it("partial CHECK set (has 'stated_conflict', lacks 'evidence_forgotten') throws, naming the set", () => {
    const db = track(
      legacyDb(["superseded", "corrected_false_belief", "evidence_withdrawn", "expired", "user_override", "stated_conflict"]),
    );
    seedRows(db);
    expect(() => migrateUserModelInvalidReasonCheck(db as never)).toThrow(/stated_conflict/);
    // Fail closed: the table is untouched.
    expect(checkSet(db)).toHaveLength(6);
    expect(allRows(db)).toHaveLength(3);
  });

  it("entry inside an open transaction throws", () => {
    const db = track(legacyDb());
    seedRows(db);
    db.exec("BEGIN");
    try {
      expect(() => migrateUserModelInvalidReasonCheck(db as never)).toThrow(/transaction/);
    } finally {
      db.exec("ROLLBACK");
    }
    expect(checkSet(db)).toHaveLength(5);
  });

  it("foreign_keys pragma is restored after success (ON and OFF cases)", () => {
    const on = track(legacyDb());
    on.pragma("foreign_keys = ON");
    migrateUserModelInvalidReasonCheck(on as never);
    expect(on.pragma("foreign_keys", { simple: true })).toBe(1);

    const off = track(legacyDb());
    off.pragma("foreign_keys = OFF");
    migrateUserModelInvalidReasonCheck(off as never);
    expect(off.pragma("foreign_keys", { simple: true })).toBe(0);
  });

  it("foreign_keys pragma is restored after a forced mid-rebuild failure; original table intact", () => {
    const db = track(legacyDb());
    seedRows(db);
    db.pragma("foreign_keys = ON");
    // Sabotage: the rebuild's CREATE TABLE user_model_new will collide.
    db.exec(`CREATE TABLE user_model_new (id INTEGER)`);
    expect(() => migrateUserModelInvalidReasonCheck(db as never)).toThrow();
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.inTransaction).toBe(false);
    expect(checkSet(db)).toHaveLength(5);
    expect(allRows(db)).toHaveLength(3);
    expect(allRows(db)[0].content).toBe("works at Samsonite warehouse");
  });

  it("indexes, UNIQUE and sqlite_sequence survive the rebuild", () => {
    const db = track(legacyDb());
    seedRows(db);
    migrateUserModelInvalidReasonCheck(db as never);
    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='user_model' AND sql IS NOT NULL ORDER BY name`)
      .all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toEqual([
      "idx_user_model_current",
      "idx_user_model_origin",
      "idx_user_model_replaced",
    ]);
    const partial = db
      .prepare(`SELECT sql FROM sqlite_master WHERE name='idx_user_model_current'`)
      .get() as { sql: string };
    expect(partial.sql).toContain("WHERE invalid_at IS NULL");
    // UNIQUE(space_id, slot, content, valid_at) still enforced.
    expect(() =>
      db
        .prepare(
          `INSERT INTO user_model (space_id, slot, content, confidence, valid_at, origin)
           VALUES ('s1', 'belief', 'works at Samsonite warehouse', 0.5, '2026-10-01T00:00:00.000Z', 'stated')`,
        )
        .run(),
    ).toThrow(/UNIQUE/);
    // AUTOINCREMENT sequence continues past max(id) — no id reuse.
    const seq = db.prepare(`SELECT seq FROM sqlite_sequence WHERE name='user_model'`).get() as { seq: number };
    expect(seq.seq).toBeGreaterThanOrEqual(3);
    const ins = db
      .prepare(
        `INSERT INTO user_model (space_id, slot, content, confidence, valid_at, origin)
         VALUES ('s1', 'belief', 'a brand new belief', 0.5, '2026-10-06T00:00:00.000Z', 'inferred')`,
      )
      .run();
    expect(Number(ins.lastInsertRowid)).toBeGreaterThan(3);
  });

  it("T-C55 extension: bootstrap-created and migration-created user_model are equivalent incl. the extended CHECK", () => {
    const fresh: DbHandle = createDb(":memory:");
    const migrated = track(legacyDb());
    seedRows(migrated);
    migrateUserModelInvalidReasonCheck(migrated as never);
    try {
      const cols = (db: Raw) =>
        (db.prepare(`PRAGMA table_info(user_model)`).all() as { name: string }[]).map((c) => c.name);
      const idx = (db: Raw) =>
        (db
          .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='user_model' AND sql IS NOT NULL ORDER BY name`)
          .all() as { name: string }[]).map((r) => r.name);
      expect(cols(migrated)).toEqual(cols(fresh.sqlite as Raw));
      expect(idx(migrated)).toEqual(idx(fresh.sqlite as Raw));
      expect(checkSet(migrated)).toEqual(checkSet(fresh.sqlite as Raw));
      expect(checkSet(fresh.sqlite as Raw)).toHaveLength(7);
    } finally {
      (fresh.sqlite as unknown as { close(): void }).close();
    }
  });

  it("createDb() on a legacy five-value file boots migrated, data intact", () => {
    const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "w3-mig-"));
    const file = nodePath.join(dir, "legacy.db");
    const raw = new BetterSqlite3(file);
    raw.exec(LEGACY_DDL);
    seedRows(raw);
    raw.close();
    const h = createDb(file);
    try {
      expect(checkSet(h.sqlite as Raw)).toHaveLength(7);
      const rows = allRows(h.sqlite as Raw);
      expect(rows).toHaveLength(3);
      expect(rows[0].content).toBe("works at Samsonite warehouse");
      // And the cell-7 reason is writable on the booted DB.
      h.sqlite
        .prepare(`UPDATE user_model SET invalid_at = '2026-10-05T00:00:00.000Z', invalid_reason = 'stated_conflict' WHERE id = 1`)
        .run();
    } finally {
      (h.sqlite as unknown as { close(): void }).close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
