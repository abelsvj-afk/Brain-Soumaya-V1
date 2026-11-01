// ============================================================================
// P1-1 regression — the home anchor on a PRE-P1 volume (independent
// review finding F-1 / P1-1).
//
// Every other captain suite boots a FRESH database, where the CREATE
// TABLE already carries the anchor columns and ensureState writes the
// definition anchor at row creation. The live volume is different:
// L1 created Bex's npc_player_state row BEFORE the anchor columns
// existed. The guarded ALTER in migrateSchema adds the columns with
// placeholder defaults ('berth' / ''), SQLite fills the existing row
// with those placeholders, ensureState returns an existing row
// unchanged, and patch() then enforces the stored (placeholder)
// anchor forever under write-once. Without a backfill, Bex keeps
// kind='berth', label='' on the only volume that already exists —
// A8-1 fails there and every homecoming reads "Came home to .".
//
// These tests build the L1-shaped table exactly as L1 left it (the
// ef7b2c79 DDL: no home_anchor_* columns, no leg_* columns), insert
// Bex's row the way L1's ensureState inserted it, then open the file
// through createDb — bootstrap + migrateSchema, the migration path
// the server actually runs at boot — and assert the stored anchor is
// her definition anchor.
// ============================================================================
import { describe, it, expect, afterEach } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type DbHandle } from "../db/client.js";
import { captainDefinition } from "@brain/shared";
import { CaptainRepo } from "./repo.js";

const SPACE = "spaceA";
const OTHER_SPACE = "spaceB";

/** The npc_player_state DDL exactly as L1 (ef7b2c79) created it. */
const L1_STATE_DDL = `
  CREATE TABLE npc_player_state (
    npc_id TEXT NOT NULL,
    space_id TEXT NOT NULL,
    home_world TEXT NOT NULL,
    current_world TEXT,
    session_key TEXT,
    session_world TEXT,
    session_started_at TEXT,
    session_ends_at TEXT,
    last_meeting_visit_key TEXT,
    last_greet_visit_key TEXT,
    fuel REAL NOT NULL DEFAULT 60,
    credits REAL NOT NULL DEFAULT 120,
    stopped INTEGER NOT NULL DEFAULT 0,
    last_advanced_at TEXT,
    PRIMARY KEY (space_id, npc_id)
  );
`;

/** Insert a state row the way L1's ensureState did (no anchor columns). */
function insertL1Row(
  raw: InstanceType<typeof BetterSqlite3>,
  npcId: string,
  spaceId: string,
  homeWorld: string,
): void {
  raw
    .prepare(
      `INSERT INTO npc_player_state
         (npc_id, space_id, home_world, fuel, credits, last_advanced_at)
       VALUES (?, ?, ?, 60, 120, '2026-10-22T12:00:00.000Z')`,
    )
    .run(npcId, spaceId, homeWorld);
}

function storedAnchor(
  handle: DbHandle,
  spaceId: string,
  npcId: string,
): { home_anchor_kind: string; home_anchor_label: string } | undefined {
  return handle.sqlite
    .prepare(
      `SELECT home_anchor_kind, home_anchor_label FROM npc_player_state
       WHERE space_id = ? AND npc_id = ?`,
    )
    .get(spaceId, npcId) as
    | { home_anchor_kind: string; home_anchor_label: string }
    | undefined;
}

let dir: string | undefined;
let handle: DbHandle | undefined;

afterEach(() => {
  handle?.sqlite.close();
  handle = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function legacyDbPath(seed: (raw: InstanceType<typeof BetterSqlite3>) => void): string {
  dir = mkdtempSync(join(tmpdir(), "brain-civ-p1-anchor-"));
  const path = join(dir, "brain.db");
  const raw = new BetterSqlite3(path);
  raw.exec(L1_STATE_DDL);
  seed(raw);
  raw.close();
  return path;
}

describe("P1-1 — home-anchor backfill on a pre-P1 volume", () => {
  it("a pre-P1 Bex row gains her definition anchor when the server boots (A8-1 on the live volume)", () => {
    const def = captainDefinition("bex");
    if (!def) throw new Error("bex must be defined");
    const path = legacyDbPath((raw) => insertL1Row(raw, "bex", SPACE, def.homeWorld));

    handle = createDb(path);

    const stored = storedAnchor(handle, SPACE, "bex");
    expect(stored?.home_anchor_kind).toBe(def.homeAnchor.kind);
    expect(stored?.home_anchor_label).toBe(def.homeAnchor.label);
    // The same truth through the repo the engine actually reads.
    const row = new CaptainRepo(handle, SPACE).state("bex");
    expect(row?.homeAnchorKind).toBe(def.homeAnchor.kind);
    expect(row?.homeAnchorLabel).toBe(def.homeAnchor.label);
    expect(row?.homeWorld).toBe(def.homeWorld);
    // The rest of the L1 row is untouched by the heal.
    expect(row?.fuel).toBe(60);
    expect(row?.credits).toBe(120);
  });

  it("heals every space's placeholder row, and only placeholder rows", () => {
    const def = captainDefinition("bex");
    if (!def) throw new Error("bex must be defined");
    const path = legacyDbPath((raw) => {
      insertL1Row(raw, "bex", SPACE, def.homeWorld);
      insertL1Row(raw, "bex", OTHER_SPACE, def.homeWorld);
    });

    handle = createDb(path);

    for (const spaceId of [SPACE, OTHER_SPACE]) {
      const stored = storedAnchor(handle, spaceId, "bex");
      expect(stored?.home_anchor_kind, spaceId).toBe(def.homeAnchor.kind);
      expect(stored?.home_anchor_label, spaceId).toBe(def.homeAnchor.label);
    }
  });

  it("is idempotent: a second boot changes nothing", () => {
    const def = captainDefinition("bex");
    if (!def) throw new Error("bex must be defined");
    const path = legacyDbPath((raw) => insertL1Row(raw, "bex", SPACE, def.homeWorld));

    handle = createDb(path);
    const first = storedAnchor(handle, SPACE, "bex");
    handle.sqlite.close();
    handle = createDb(path);
    const second = storedAnchor(handle, SPACE, "bex");

    expect(second).toEqual(first);
    expect(second?.home_anchor_label).toBe(def.homeAnchor.label);
  });

  it("never overwrites a genuinely written anchor (write-once preserved)", () => {
    // A P1-shaped volume whose row already carries a real anchor:
    // the label is non-empty, so the placeholder predicate must not
    // touch it — even though it differs from today's definition.
    dir = mkdtempSync(join(tmpdir(), "brain-civ-p1-anchor-"));
    const path = join(dir, "brain.db");
    const raw = new BetterSqlite3(path);
    raw.exec(`
      CREATE TABLE npc_player_state (
        npc_id TEXT NOT NULL,
        space_id TEXT NOT NULL,
        home_world TEXT NOT NULL,
        home_anchor_kind TEXT NOT NULL DEFAULT 'berth',
        home_anchor_label TEXT NOT NULL DEFAULT '',
        current_world TEXT,
        session_key TEXT,
        session_world TEXT,
        session_started_at TEXT,
        session_ends_at TEXT,
        last_meeting_visit_key TEXT,
        last_greet_visit_key TEXT,
        fuel REAL NOT NULL DEFAULT 60,
        credits REAL NOT NULL DEFAULT 120,
        stopped INTEGER NOT NULL DEFAULT 0,
        last_advanced_at TEXT,
        leg_from TEXT,
        leg_to TEXT,
        leg_kind TEXT,
        leg_departed_step TEXT,
        leg_arrives_step TEXT,
        leg_steps INTEGER,
        leg_visit_key TEXT,
        PRIMARY KEY (space_id, npc_id)
      );
      INSERT INTO npc_player_state
        (npc_id, space_id, home_world, home_anchor_kind, home_anchor_label, fuel, credits, last_advanced_at)
      VALUES ('bex', '${SPACE}', 'great-station', 'quarter', 'a genuinely written anchor', 60, 120, '2026-10-22T12:00:00.000Z');
    `);
    raw.close();

    handle = createDb(path);

    const stored = storedAnchor(handle, SPACE, "bex");
    expect(stored?.home_anchor_kind).toBe("quarter");
    expect(stored?.home_anchor_label).toBe("a genuinely written anchor");
  });

  it("leaves rows for captains not in the registry untouched", () => {
    const path = legacyDbPath((raw) => insertL1Row(raw, "not-a-captain", SPACE, "great-station"));

    handle = createDb(path);

    // No definition exists to heal from: the placeholder stays as-is.
    const stored = storedAnchor(handle, SPACE, "not-a-captain");
    expect(stored?.home_anchor_kind).toBe("berth");
    expect(stored?.home_anchor_label).toBe("");
  });
});
