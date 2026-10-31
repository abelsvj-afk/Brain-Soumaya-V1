import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import BetterSqlite3 from "better-sqlite3";
import { createDb } from "../db/client.js";
import { StoryRepo } from "../story/story.js";
import { RoadsRepo } from "../story/roads.js";
import { TravelRepo } from "../repositories/travel.repo.js";
import { computeFlavor } from "../story/flavor.js";
import { SpacesRepo } from "../auth/spaces.js";
import { countIncludedTables } from "../backup/manifest.js";
import { setPreference } from "../agent/notify/policy.js";
import { isDiscoveryContextActive } from "../discovery/attribution.js";

/**
 * P1-ARCH, A9, A14 (docs/specs/unified-discovery-architecture-2026-10-31.md §15). Two layers, because a text search alone cannot see an indirect query helper:
 *
 *   Layer 1 — static enumeration: where the literal "story_finds" may appear, and which files build SQL with a variable table name (each must be named and justified).
 *   Layer 2 — runtime attribution: a test-only wrapper records every statement that mentions story_finds, with the module that issued it, while real flows run; every one must come
 *             from the Ledger/Reader (carrying the discovery context marker) or from a named exception. Every access site layer 1 finds must be exercised, or the test fails.
 *
 * The context marker is an ARCHITECTURAL TEST AID, not a security boundary: it authorizes nothing (A14), and it is independent of the database capability functions (A15).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, "..");
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

function stripComments(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => "\n".repeat(m.split("\n").length - 1));
  return noBlock
    .split("\n")
    .map((l) => l.replace(/(?<!:)\/\/.*$/, ""))
    .join("\n");
}
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__" || e.name === "node_modules") continue;
      walk(p, out);
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(SRC, p).split(path.sep).join("/");
const files = walk(SRC).map((p) => ({ file: rel(p), code: stripComments(fs.readFileSync(p, "utf8")) }));

/** Where the literal table name may appear, and why. */
const LITERAL_ALLOWLIST: Record<string, string> = {
  "discovery/ledger.ts": "the ledger — the only writer",
  "discovery/reader.ts": "the reader — the read boundary",
  "auth/spaces.ts": "the table is listed in SPACE_SCOPED_TABLES; deleteSpace loops over it — the documented whole-account-deletion exception",
  "backup/inventory.ts": "the backup inventory names the table (table-level classification only)",
  "db/schemaSql.ts": "the table's DDL",
  "db/client.ts": "the table's DDL copy and its additive, PRAGMA-guarded migration",
};
/** Files that build SQL with a variable TABLE name. Each must be named and justified; a new one fails until reviewed. None of these names story_finds (the literal scan above proves it). */
const DYNAMIC_SQL_ALLOWLIST: Record<string, string> = {
  "auth/spaces.ts": "deleteSpace: loops over SPACE_SCOPED_TABLES (the documented exception) and cleans entity/index tables",
  "backup/manifest.ts": "table-level COUNT(*) over the backup inventory — aggregate only, no discovery content",
  "backup/service.ts": "VACUUM INTO — a whole-database copy; the interpolation is the snapshot path, not a table",
  "db/client.ts": "schema migrations over fixed table lists",
  "db/vec.ts": "vector index tables chosen from a fixed pair",
  "agent/userModel.ts": "evidence tables from the fixed EVIDENCE_TABLES map",
  "analysis/journeyLinking.ts": "finance tables from fixed specs",
  "repositories/journeys.repo.ts": "journey link specs naming fixed tables",
  "sources/forgetSource.ts": "forget-flag tables from fixed specs",
};
/** SQL (upper-case verbs only, so English prose such as "from ${x}" is not mistaken for SQL) whose table name is a variable. */
const DYNAMIC_SQL = /\b(?:SELECT\b[^`'"\n]*\bFROM|DELETE FROM|INSERT INTO|ALTER TABLE|UPDATE|VACUUM INTO)\s+["'`]?\$\{/;

describe("P1-ARCH layer 1: static enumeration", () => {
  it("the literal table name appears only in the ledger, the reader and the named exceptions", () => {
    const where = files.filter((f) => /\bstory_finds\b/.test(f.code)).map((f) => f.file);
    for (const f of where) expect(Object.keys(LITERAL_ALLOWLIST), `${f} mentions story_finds but is not on the allowlist`).toContain(f);
    // The allowlist is exact: nothing on it is stale.
    for (const f of Object.keys(LITERAL_ALLOWLIST)) expect(where, `${f} is on the allowlist but no longer mentions story_finds`).toContain(f);
  });

  it("every file that builds SQL with a variable table name is named and justified", () => {
    const sites = files.filter((f) => f.code.split("\n").some((l) => DYNAMIC_SQL.test(l))).map((f) => f.file);
    for (const f of sites) expect(Object.keys(DYNAMIC_SQL_ALLOWLIST), `${f} builds SQL with a variable table name — review it and add it here with a justification`).toContain(f);
    for (const f of Object.keys(DYNAMIC_SQL_ALLOWLIST)) expect(sites, `${f} is on the dynamic-SQL allowlist but no longer builds such SQL`).toContain(f);
    for (const why of Object.values(DYNAMIC_SQL_ALLOWLIST)) expect(why.length).toBeGreaterThan(10);
  });

  it("nothing outside the ledger and reader issues SQL against story_finds from the call sites that used to (story, flavor, roads, travel)", () => {
    for (const f of ["story/story.ts", "story/flavor.ts", "story/roads.ts", "repositories/travel.repo.ts"]) {
      const code = files.find((x) => x.file === f)!.code;
      expect(code, f).not.toMatch(/story_finds/);
    }
  });

  it("only the ledger and the reader (and the marker itself) touch the attribution marker (A14)", () => {
    const readers = files.filter((f) => /\bisDiscoveryContextActive\b/.test(f.code)).map((f) => f.file);
    expect(readers).toEqual(["discovery/attribution.ts"]); // production code never reads the marker; only the test-only wrapper below does
    const setters = files.filter((f) => /\bwithDiscoveryContext\b/.test(f.code)).map((f) => f.file).sort();
    expect(setters).toEqual(["discovery/attribution.ts", "discovery/ledger.ts", "discovery/reader.ts"]);
  });

  it("A14: the marker module grants nothing — it imports nothing, touches no database, and only counts", () => {
    const code = files.find((f) => f.file === "discovery/attribution.ts")!.code;
    expect(code).not.toMatch(/^\s*import\b/m);
    expect(code).not.toMatch(/prepare|exec\(|sqlite|\.run\(|\.get\(|\.all\(/);
  });

  it("TERM: no trust identifier is ever paired with the word 'verified' in the discovery code or in a column check", () => {
    for (const f of files.filter((x) => x.file.startsWith("discovery/"))) expect(f.code, f.file).not.toMatch(/verified/i);
    for (const f of files) expect(f.code, f.file).not.toMatch(/trust\W{1,6}verified|verified\W{1,6}trust|['"]verified['"]\s*\)?\s*[,)]\s*(?:trust|accepted|imported)/i);
    const ddl = fs.readFileSync(path.join(SRC, "db/schemaSql.ts"), "utf8");
    expect(ddl).toMatch(/trust IN \('accepted','imported'\)/);
  });
});

// ── Layer 2: runtime attribution ────────────────────────────────────────────

interface Hit {
  sql: string;
  context: boolean;
  file: string | null;
}
const hits: Hit[] = [];
let recording = false;
const proto = BetterSqlite3.prototype as unknown as { prepare: (sql: string, ...a: unknown[]) => unknown; exec: (sql: string, ...a: unknown[]) => unknown };
const original = { prepare: proto.prepare, exec: proto.exec };

/** The src-relative path of the module that called the connection (the first frame inside packages/server/src that is not a test). */
function callerFile(): string | null {
  const stack = new Error().stack ?? "";
  for (const line of stack.split("\n").slice(1)) {
    if (line.includes("node_modules") || line.includes("/__tests__/")) continue;
    const m = /packages\/server\/src\/([^:)\s]+):\d+/.exec(line);
    if (m) return m[1]!;
  }
  return null;
}
function install(): void {
  const wrap = (fn: (sql: string, ...a: unknown[]) => unknown) =>
    function (this: unknown, sql: string, ...rest: unknown[]) {
      if (recording && typeof sql === "string" && /story_finds/i.test(sql)) hits.push({ sql: norm(sql), context: isDiscoveryContextActive(), file: callerFile() });
      return fn.call(this, sql, ...rest);
    };
  proto.prepare = wrap(original.prepare);
  proto.exec = wrap(original.exec);
}
function uninstall(): void {
  proto.prepare = original.prepare;
  proto.exec = original.exec;
}

const T0 = Date.parse("2026-10-30T07:00:00.000Z");
const tmp: string[] = [];

describe("P1-ARCH layer 2: runtime attribution while real flows run", () => {
  beforeAll(() => {
    Error.stackTraceLimit = 40;
    install();

    // Setup (not recorded) → then the flows, recorded.
    const legacyFile = path.join(os.tmpdir(), `discovery-arch-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
    tmp.push(legacyFile);
    const seed = createDb(legacyFile);
    seed.sqlite.exec(`DROP TABLE story_finds`);
    seed.sqlite.exec(`CREATE TABLE story_finds (space_id TEXT NOT NULL, entry_id TEXT NOT NULL, found_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), source TEXT NOT NULL, last_recalled_at TEXT, recall_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (space_id, entry_id))`);
    seed.sqlite.close();

    recording = true;
    // 1. A legacy volume is migrated (db/client.ts: DDL + PRAGMA + ALTER).
    createDb(legacyFile).sqlite.close();
    // 2. A fresh database, and every flow that reads or writes a brain's finds.
    const h = createDb(":memory:");
    h.sqlite.prepare(`INSERT OR IGNORE INTO space_meta (space_id) VALUES ('s')`).run();
    setPreference(h.sqlite, "s", "timezone", "UTC");
    const travel = new TravelRepo(h, "s");
    const j = travel.depart({ clientKey: "k1", kind: "drift", destination: "deep-past" }, T0);
    travel.arrive(j.id, Date.parse(j.cancelDeadline) + 1000);
    const at = Date.parse(j.cancelDeadline) + 5000;
    const story = new StoryRepo(h, "s");
    story.find("sight.missing-stratum", "regard", at); // stillness: reads the pacing rows, then writes
    story.find("sight.missing-stratum", "regard", at + 60_000); // a replay
    story.book();
    story.recall("sight.missing-stratum", at);
    try {
      story.link("sight.missing-stratum", "obj.not-found-yet");
    } catch {
      /* refused — it still read the ledger */
    }
    const j2 = travel.depart({ clientKey: "k2", kind: "drift", destination: "great-station" }, at + 120_000);
    travel.arrive(j2.id, Date.parse(j2.cancelDeadline) + 1000);
    const at2 = Date.parse(j2.cancelDeadline) + 5000;
    story.find("relic.harbor-nail", "relic", at2);
    travel.getState(at2); // the gate reads
    new RoadsRepo(h, "s").set("road.door-closed", "taken");
    try {
      new RoadsRepo(h, "s").set("road.door-closed", "done"); // reads every find the road names
    } catch {
      /* not finished — it still read the ledger */
    }
    computeFlavor(h, "s", at2); // the flavour count
    countIncludedTables(h.sqlite); // the backup inventory's table-level counts
    // 3. Whole-account deletion (the documented exception).
    const spaces = new SpacesRepo(h);
    const made = spaces.authOrCreate("ArchTester", "correct-horse-battery");
    expect(made?.created).toBe(true);
    expect(spaces.deleteSpace(made!.space.id, "correct-horse-battery", "ArchTester")).toBe(true);
    recording = false;
    h.sqlite.close();
  }, 120_000);

  afterAll(() => {
    recording = false;
    uninstall();
    for (const f of tmp.splice(0)) for (const s of ["", "-wal", "-shm"]) fs.rmSync(f + s, { force: true });
  });

  const NAMED_EXCEPTIONS = new Set(["auth/spaces.ts", "backup/manifest.ts", "db/client.ts"]);

  it("every statement that mentions story_finds came from the ledger/reader (with the marker) or a named exception", () => {
    expect(hits.length).toBeGreaterThan(20);
    for (const h of hits) {
      if (h.file === "discovery/reader.ts" || h.file === "discovery/ledger.ts") {
        expect(h.context, `${h.file} issued "${h.sql.slice(0, 80)}" outside the discovery context`).toBe(true);
      } else if (h.file !== null) {
        expect(NAMED_EXCEPTIONS.has(h.file), `${h.file} issued SQL against story_finds: "${h.sql.slice(0, 100)}" — an unreviewed access path`).toBe(true);
        expect(h.context, `${h.file} is an exception, not a ledger/reader call`).toBe(false);
      }
    }
  });

  it("no indirect helper reaches the table: story, flavor, roads and travel issue no such statement themselves", () => {
    const bad = hits.filter((h) => h.file !== null && ["story/story.ts", "story/flavor.ts", "story/roads.ts", "repositories/travel.repo.ts"].includes(h.file));
    expect(bad).toEqual([]);
  });

  it("coverage by enumeration: every statement literal in the ledger and reader was actually run", () => {
    const run = new Set(hits.filter((h) => h.file === "discovery/reader.ts" || h.file === "discovery/ledger.ts").map((h) => h.sql));
    for (const f of ["discovery/reader.ts", "discovery/ledger.ts"]) {
      const code = files.find((x) => x.file === f)!.code;
      const literals = [...code.matchAll(/`([^`]*\bstory_finds\b[^`]*)`/g)].map((m) => norm(m[1]!));
      expect(literals.length, f).toBeGreaterThan(0);
      for (const sql of literals) expect(run.has(sql), `unexercised access site in ${f}: "${sql.slice(0, 90)}"`).toBe(true);
    }
  });

  it("coverage by enumeration: every named exception was exercised (the deletion loop, the backup count, the migration)", () => {
    for (const f of NAMED_EXCEPTIONS) expect(hits.some((h) => h.file === f), `unexercised named exception: ${f}`).toBe(true);
    expect(hits.some((h) => h.file === "auth/spaces.ts" && /^DELETE FROM story_finds WHERE space_id = \?$/.test(h.sql))).toBe(true);
    expect(hits.some((h) => h.file === "backup/manifest.ts" && /COUNT\(\*\)/.test(h.sql))).toBe(true);
    expect(hits.some((h) => h.file === "db/client.ts" && /PRAGMA table_info\(story_finds\)/.test(h.sql))).toBe(true);
  });

  it("falsification: a statement issued outside the ledger/reader would be caught", () => {
    const scratch = new BetterSqlite3(":memory:");
    scratch.exec(`CREATE TABLE story_finds (x)`);
    recording = true;
    const before = hits.length;
    scratch.prepare(`SELECT * FROM story_finds`).all(); // issued from this test file (no src frame), so unattributed…
    recording = false;
    expect(hits.length).toBe(before + 1);
    expect(hits[hits.length - 1]!.context).toBe(false); // …and certainly not carrying the marker
    expect(hits[hits.length - 1]!.file).toBeNull();
    scratch.close();
    hits.pop();
  });
});
