import { describe, it, expect, afterEach } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type DbHandle } from "../db/client.js";
import type { RawDb } from "../db/vec.js";

/**
 * ADR-018 schema layer (criteria 4/15/16/22/25/26): fresh bootstrap and
 * migrated legacy volumes must converge on the same contract for
 * `notification_cap_claims`, `tts_audio_cache` (owned rebuild),
 * `notification_outbox.remind_at`, and `push_outbox.remind_at/bill_due_at`.
 * Fixtures follow the repo's table-level legacy-fixture pattern
 * (migration.test.ts): hand-build ONLY the legacy tables under test in a
 * temp file, then let createDb run its full boot over them.
 */

const dirs: string[] = [];
const handles: DbHandle[] = [];

function tmpDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "brain-adr018-"));
  dirs.push(dir);
  return join(dir, "test.db");
}

function open(path: string): DbHandle {
  const h = createDb(path);
  handles.push(h);
  return h;
}

afterEach(() => {
  while (handles.length) handles.pop()?.sqlite.close();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

interface ColRow {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

function tableInfo(sqlite: RawDb, table: string): ColRow[] {
  return sqlite.prepare(`PRAGMA table_info(${table})`).all() as ColRow[];
}

function col(sqlite: RawDb, table: string, name: string): ColRow | undefined {
  return tableInfo(sqlite, table).find((c) => c.name === name);
}

function indexNames(sqlite: RawDb, table: string): string[] {
  return (
    sqlite.prepare(`PRAGMA index_list(${table})`).all() as { name: string }[]
  ).map((r) => r.name);
}

function indexCols(sqlite: RawDb, table: string, index: string): string[] {
  return (
    sqlite.prepare(`PRAGMA index_info(${index})`).all() as { name: string }[]
  ).map((r) => r.name);
}

/** Order-insensitive schema shape: columns sorted by name (columns added by
 *  guarded ALTERs land at the end on migrated volumes; the contract is the
 *  column SET with its types/nullability/defaults/PK positions, plus the
 *  index inventory with its column lists). */
function shapeOf(sqlite: RawDb, table: string) {
  const cols = tableInfo(sqlite, table)
    .map((c) => ({
      name: c.name,
      type: c.type,
      notnull: c.notnull,
      dflt_value: c.dflt_value,
      pk: c.pk,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const idx = indexNames(sqlite, table)
    .map((name) => {
      const row = (
        sqlite.prepare(`PRAGMA index_list(${table})`).all() as {
          name: string;
          unique: number;
        }[]
      ).find((r) => r.name === name)!;
      return { name, unique: row.unique, cols: indexCols(sqlite, table, name) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { cols, idx };
}

// ---- Legacy (pre-ADR-018) DDL fixtures -------------------------------------

const LEGACY_TTS_DDL = `
  CREATE TABLE tts_audio_cache (
    cache_key TEXT PRIMARY KEY,
    audio BLOB NOT NULL,
    content_type TEXT NOT NULL,
    filename TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
`;

const LEGACY_NOTIFICATION_OUTBOX_DDL = `
  CREATE TABLE notification_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    notif_key TEXT NOT NULL UNIQUE,
    space_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    occurrence_id TEXT NOT NULL,
    message TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal',
    is_urgent INTEGER NOT NULL DEFAULT 0,
    urgent_reason TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    deliver_after TEXT NOT NULL,
    bill_due_at TEXT,
    cap_day TEXT,
    send_started_at TEXT,
    claimed_by TEXT,
    claimed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

const LEGACY_PUSH_OUTBOX_DDL = `
  CREATE TABLE push_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    push_key TEXT NOT NULL UNIQUE,
    space_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    occurrence_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    url TEXT NOT NULL DEFAULT '/',
    status TEXT NOT NULL DEFAULT 'pending',
    is_urgent INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    deliver_after TEXT NOT NULL,
    cap_day TEXT,
    send_started_at TEXT,
    claimed_by TEXT,
    claimed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
`;

function seedLegacy(path: string, ddl: string, inserts: string[] = []): void {
  const raw = new BetterSqlite3(path);
  raw.exec(ddl);
  for (const sql of inserts) raw.exec(sql);
  raw.close();
}

// ---- Fresh bootstrap --------------------------------------------------------

describe("ADR-018 fresh bootstrap", () => {
  it("creates notification_cap_claims with the A2 contract", () => {
    const h = open(tmpDbPath());
    const s = h.sqlite;
    const cols = tableInfo(s, "notification_cap_claims");
    expect(cols.map((c) => c.name)).toEqual([
      "space_id",
      "local_day",
      "channel",
      "delivery_key",
      "state",
      "cap_exempt",
      "created_at",
      "updated_at",
    ]);
    // PRIMARY KEY (space_id, channel, delivery_key, local_day)
    expect(col(s, "notification_cap_claims", "space_id")?.pk).toBe(1);
    expect(col(s, "notification_cap_claims", "channel")?.pk).toBe(2);
    expect(col(s, "notification_cap_claims", "delivery_key")?.pk).toBe(3);
    expect(col(s, "notification_cap_claims", "local_day")?.pk).toBe(4);
    expect(col(s, "notification_cap_claims", "cap_exempt")?.notnull).toBe(1);
    // Count index in sqlite_master with the A2 column list.
    const idx = s
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND name='notification_cap_claims_count_idx'`,
      )
      .get();
    expect(idx).toBeDefined();
    expect(indexCols(s, "notification_cap_claims", "notification_cap_claims_count_idx")).toEqual([
      "space_id",
      "local_day",
      "state",
      "cap_exempt",
    ]);
    // CHECK constraints are live: bad channel / bad local_day are rejected.
    expect(() =>
      s
        .prepare(
          `INSERT INTO notification_cap_claims (space_id, local_day, channel, delivery_key, state)
           VALUES ('sp1', '2026-10-21', 'sms', 'k1', 'reserved')`,
        )
        .run(),
    ).toThrow();
    expect(() =>
      s
        .prepare(
          `INSERT INTO notification_cap_claims (space_id, local_day, channel, delivery_key, state)
           VALUES ('sp1', '10/21/2026', 'push', 'k1', 'reserved')`,
        )
        .run(),
    ).toThrow();
  });

  it("creates the owned tts_audio_cache shape (criterion 15)", () => {
    const h = open(tmpDbPath());
    const s = h.sqlite;
    expect(col(s, "tts_audio_cache", "space_id")?.notnull).toBe(1);
    expect(col(s, "tts_audio_cache", "space_id")?.pk).toBe(1);
    expect(col(s, "tts_audio_cache", "cache_key")?.pk).toBe(2);
    expect(indexNames(s, "tts_audio_cache")).toContain(
      "tts_audio_cache_space_created_idx",
    );
    expect(indexCols(s, "tts_audio_cache", "tts_audio_cache_space_created_idx")).toEqual([
      "space_id",
      "created_at",
    ]);
  });

  it("has remind_at on notification_outbox and remind_at + bill_due_at on push_outbox", () => {
    const h = open(tmpDbPath());
    const s = h.sqlite;
    expect(col(s, "notification_outbox", "remind_at")?.type).toBe("TEXT");
    expect(col(s, "push_outbox", "remind_at")?.type).toBe("TEXT");
    expect(col(s, "push_outbox", "bill_due_at")?.type).toBe("TEXT");
  });
});

// ---- Legacy fixtures ---------------------------------------------------------

describe("ADR-018 legacy migration", () => {
  it("(a) rebuilds legacy tts_audio_cache owned, purges rows, and is idempotent (criteria 16/26)", () => {
    const path = tmpDbPath();
    seedLegacy(path, LEGACY_TTS_DDL, [
      `INSERT INTO tts_audio_cache (cache_key, audio, content_type, filename)
       VALUES ('k1', X'0102', 'audio/ogg', 'a.ogg'), ('k2', X'0304', 'audio/ogg', 'b.ogg')`,
    ]);

    const h = open(path);
    const s = h.sqlite;
    expect(col(s, "tts_audio_cache", "space_id")?.notnull).toBe(1);
    expect(col(s, "tts_audio_cache", "space_id")?.pk).toBe(1);
    expect(col(s, "tts_audio_cache", "cache_key")?.pk).toBe(2);
    expect(indexNames(s, "tts_audio_cache")).toContain(
      "tts_audio_cache_space_created_idx",
    );
    // Legacy unowned rows are purged, never reassigned (ADR D2).
    const n = s.prepare(`SELECT COUNT(*) AS c FROM tts_audio_cache`).get() as { c: number };
    expect(n.c).toBe(0);
    // No leftover legacy table.
    const leftover = s
      .prepare(`SELECT name FROM sqlite_master WHERE name='tts_audio_cache_legacy_unowned'`)
      .get();
    expect(leftover).toBeUndefined();
    const shapeBefore = shapeOf(s, "tts_audio_cache");
    h.sqlite.close();
    handles.splice(handles.indexOf(h), 1);

    // Second boot on the same file: no drift, no throw.
    const h2 = open(path);
    expect(shapeOf(h2.sqlite, "tts_audio_cache")).toEqual(shapeBefore);
    const n2 = h2.sqlite.prepare(`SELECT COUNT(*) AS c FROM tts_audio_cache`).get() as {
      c: number;
    };
    expect(n2.c).toBe(0);
  });

  it("(b) adds remind_at to a legacy notification_outbox and preserves its rows", () => {
    const path = tmpDbPath();
    seedLegacy(path, LEGACY_NOTIFICATION_OUTBOX_DDL, [
      `INSERT INTO notification_outbox (notif_key, space_id, tool, occurrence_id, message, deliver_after)
       VALUES ('nk-legacy', 'sp1', 'reminder', 'occ-1', 'legacy msg', '2026-01-01T00:00:00Z')`,
    ]);
    const h = open(path);
    expect(col(h.sqlite, "notification_outbox", "remind_at")?.type).toBe("TEXT");
    const row = h.sqlite
      .prepare(`SELECT notif_key, message, remind_at FROM notification_outbox`)
      .get() as { notif_key: string; message: string; remind_at: string | null };
    expect(row.notif_key).toBe("nk-legacy");
    expect(row.message).toBe("legacy msg");
    expect(row.remind_at).toBeNull();
  });

  it("(c) adds remind_at + bill_due_at to a legacy push_outbox and preserves its rows", () => {
    const path = tmpDbPath();
    seedLegacy(path, LEGACY_PUSH_OUTBOX_DDL, [
      `INSERT INTO push_outbox (push_key, space_id, tool, occurrence_id, title, body, deliver_after)
       VALUES ('pk-legacy', 'sp1', 'reminder', 'occ-1', 't', 'b', '2026-01-01T00:00:00Z')`,
    ]);
    const h = open(path);
    expect(col(h.sqlite, "push_outbox", "remind_at")?.type).toBe("TEXT");
    expect(col(h.sqlite, "push_outbox", "bill_due_at")?.type).toBe("TEXT");
    const row = h.sqlite.prepare(`SELECT push_key, title FROM push_outbox`).get() as {
      push_key: string;
      title: string;
    };
    expect(row.push_key).toBe("pk-legacy");
    expect(row.title).toBe("t");
  });

  it("(d) fresh-bootstrap schema equals migrated-legacy schema for all three tables (criterion 25)", () => {
    const fresh = open(tmpDbPath());

    const legacyPath = tmpDbPath();
    const raw = new BetterSqlite3(legacyPath);
    raw.exec(LEGACY_TTS_DDL);
    raw.exec(LEGACY_NOTIFICATION_OUTBOX_DDL);
    raw.exec(LEGACY_PUSH_OUTBOX_DDL);
    raw.close();
    const migrated = open(legacyPath);

    for (const t of ["tts_audio_cache", "notification_outbox", "push_outbox"]) {
      expect(shapeOf(migrated.sqlite, t), `schema parity for ${t}`).toEqual(
        shapeOf(fresh.sqlite, t),
      );
    }
    // The ledger is created identically on the migrated volume too.
    expect(shapeOf(migrated.sqlite, "notification_cap_claims")).toEqual(
      shapeOf(fresh.sqlite, "notification_cap_claims"),
    );
  });

  it("(e) fails closed on an unexpected tts_audio_cache shape, leaving source rows intact", () => {
    const path = tmpDbPath();
    seedLegacy(
      path,
      `
      CREATE TABLE tts_audio_cache (
        cache_key TEXT PRIMARY KEY,
        audio BLOB NOT NULL,
        content_type TEXT NOT NULL,
        filename TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        mystery_col TEXT
      );
      `,
      [
        `INSERT INTO tts_audio_cache (cache_key, audio, content_type, filename, mystery_col)
         VALUES ('k1', X'0102', 'audio/ogg', 'a.ogg', 'keep-me')`,
      ],
    );

    expect(() => createDb(path)).toThrow(/tts_audio_cache/);

    const raw = new BetterSqlite3(path);
    const rows = raw
      .prepare(`SELECT cache_key, mystery_col FROM tts_audio_cache`)
      .all() as { cache_key: string; mystery_col: string }[];
    expect(rows).toEqual([{ cache_key: "k1", mystery_col: "keep-me" }]);
    raw.close();
  });
});
