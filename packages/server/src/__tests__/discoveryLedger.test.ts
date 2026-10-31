import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, type DbHandle } from "../db/client.js";
import { StoryRepo } from "../story/story.js";
import { TravelRepo } from "../repositories/travel.repo.js";
import { setPreference } from "../agent/notify/policy.js";
import { DiscoveryLedger } from "../discovery/ledger.js";
import { DiscoveryReader, READ_SQL } from "../discovery/reader.js";
import { runParityFixtures } from "./fixtures/discoveryParity.js";

/** P1-ADM, P1-SQL, TS-1 and the P1-PAR falsification (docs/specs/unified-discovery-architecture-2026-10-31.md §15). */
const here = path.dirname(fileURLToPath(import.meta.url));
const T0 = Date.parse("2026-10-30T07:00:00.000Z");
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

let h: DbHandle;
beforeEach(() => {
  h = createDb(":memory:");
  h.sqlite.prepare(`INSERT OR IGNORE INTO space_meta (space_id) VALUES ('s')`).run();
  setPreference(h.sqlite, "s", "timezone", "UTC");
});
afterEach(() => h.sqlite.close());

const row = (id: string) => h.sqlite.prepare(`SELECT found_at, source, last_recalled_at, recall_count, trust, trust_at, trust_basis FROM story_finds WHERE space_id = 's' AND entry_id = ?`).get(id) as
  | { found_at: string; source: string; last_recalled_at: string | null; recall_count: number; trust: string | null; trust_at: string | null; trust_basis: string | null }
  | undefined;
function placeShip(world: string): void {
  const t = new TravelRepo(h, "s");
  const j = t.depart({ clientKey: `k-${world}`, kind: "drift", destination: world }, T0);
  t.arrive(j.id, Date.parse(j.cancelDeadline) + 1000);
}

describe("P1-ADM: what a live find writes, and what it leaves alone", () => {
  it("a new find is written as accepted / live:v1, with server-made ISO times", () => {
    placeShip("great-station");
    const at = T0 + 600_000;
    const res = new StoryRepo(h, "s").find("relic.harbor-nail", "relic", at);
    expect(res).toEqual({ entryId: "relic.harbor-nail", foundAt: new Date(at).toISOString(), isNew: true });
    const r = row("relic.harbor-nail")!;
    expect(r.trust).toBe("accepted");
    expect(r.trust_basis).toBe("live:v1");
    expect(r.trust_at).toBe(r.found_at); // admission time
    // TS-1: the times round-trip through Date#toISOString — they were made by the server, never taken from a client.
    for (const v of [r.found_at, r.trust_at!]) expect(new Date(v).toISOString()).toBe(v);
    expect(r.source).toBe("relic");
  });

  it("an existing legacy (NULL-trust) row is left untouched, in both the stillness path and the other paths", () => {
    placeShip("great-station");
    h.sqlite.prepare(`INSERT INTO story_finds (space_id, entry_id, found_at, source) VALUES ('s','relic.harbor-nail','2026-10-01T00:00:00.000Z','relic'), ('s','companion.dock-1','2026-10-02T00:00:00.000Z','companion')`).run();
    const repo = new StoryRepo(h, "s");
    const a = repo.find("relic.harbor-nail", "relic", T0 + 1000);
    const b = repo.find("companion.dock-1", "companion", T0 + 2000);
    expect(a).toEqual({ entryId: "relic.harbor-nail", foundAt: "2026-10-01T00:00:00.000Z", isNew: false });
    expect(b.isNew).toBe(false);
    for (const id of ["relic.harbor-nail", "companion.dock-1"]) {
      const r = row(id)!;
      expect([r.trust, r.trust_at, r.trust_basis]).toEqual([null, null, null]); // a live admission never classifies a legacy row (spec §4, T18)
    }
  });

  it("an existing row of any trust keeps its found_at, source and trust metadata", () => {
    placeShip("great-station");
    h.sqlite.prepare(`INSERT INTO story_finds (space_id, entry_id, found_at, source, trust, trust_at, trust_basis) VALUES ('s','relic.harbor-nail','2026-10-01T00:00:00.000Z','import','imported','2026-10-01T00:00:00.000Z','client-report')`).run();
    const before = row("relic.harbor-nail");
    const res = new StoryRepo(h, "s").find("relic.harbor-nail", "relic", T0 + 5000);
    expect(res.isNew).toBe(false);
    expect(row("relic.harbor-nail")).toEqual(before); // the imported branch (upgrade) arrives with import in P3; Phase 1 never rewrites a row
  });

  it("is idempotent: the second call for the same entry writes nothing and reports the first time", () => {
    placeShip("great-station");
    const repo = new StoryRepo(h, "s");
    const first = repo.find("relic.harbor-nail", "relic", T0 + 1000);
    const again = repo.find("relic.harbor-nail", "relic", T0 + 99_000);
    expect(again.isNew).toBe(false);
    expect(again.foundAt).toBe(first.foundAt);
    expect(h.sqlite.prepare(`SELECT COUNT(*) AS n FROM story_finds`).get()).toEqual({ n: 1 });
  });

  it("recall bumps the counters and leaves the trust metadata alone", () => {
    new DiscoveryLedger(h, "s").admit("sight.a", "regard", T0);
    new DiscoveryLedger(h, "s").markRecalled("sight.a", T0 + 1000);
    new DiscoveryLedger(h, "s").markRecalled("sight.a", T0 + 2000);
    const r = row("sight.a")!;
    expect(r.recall_count).toBe(2);
    expect(r.last_recalled_at).toBe(new Date(T0 + 2000).toISOString());
    expect([r.trust, r.trust_basis]).toEqual(["accepted", "live:v1"]);
  });

  it("a find made inside an outer transaction still works (nested transactions are savepoints)", () => {
    placeShip("great-station");
    const repo = new StoryRepo(h, "s");
    expect(() => h.sqlite.transaction(() => repo.find("relic.harbor-nail", "relic", T0 + 1000))()).not.toThrow();
    expect(row("relic.harbor-nail")?.trust).toBe("accepted");
  });

  it("one brain's find is never visible to another", () => {
    h.sqlite.prepare(`INSERT OR IGNORE INTO space_meta (space_id) VALUES ('t')`).run();
    new DiscoveryLedger(h, "s").admit("sight.a", "regard", T0);
    expect(new DiscoveryReader(h, "s").has("sight.a")).toBe(true);
    expect(new DiscoveryReader(h, "t").has("sight.a")).toBe(false);
    expect(new DiscoveryReader(h, "t").list()).toEqual([]);
  });
});

describe("P1-SQL: the relocated read statements are the baseline's", () => {
  const golden = JSON.parse(fs.readFileSync(path.join(here, "golden/discovery-parity.golden.json"), "utf8")) as { baselineReadSql: string[] };

  it("reader.ts issues exactly the read statements the baseline issued (whitespace-normalised), no more and no fewer", () => {
    const src = fs.readFileSync(path.join(here, "../discovery/reader.ts"), "utf8");
    const found = new Set<string>();
    for (const m of src.matchAll(/`([^`]*\bstory_finds\b[^`]*)`/g)) {
      const sql = norm(m[1]!);
      if (/^SELECT\b/i.test(sql)) found.add(sql);
    }
    expect([...found].sort()).toEqual([...golden.baselineReadSql].sort());
    // …and READ_SQL is what the code actually runs.
    expect(Object.values(READ_SQL).map(norm).sort()).toEqual([...golden.baselineReadSql].sort());
  });

  it("the ledger issues no SELECT on story_finds, and its writes are the only statements that changed", () => {
    const src = fs.readFileSync(path.join(here, "../discovery/ledger.ts"), "utf8");
    const stmts = [...src.matchAll(/`([^`]*\bstory_finds\b[^`]*)`/g)].map((m) => norm(m[1]!));
    expect(stmts.filter((s) => /^SELECT\b/i.test(s))).toEqual([]);
    expect(stmts).toContain("UPDATE story_finds SET last_recalled_at = ?, recall_count = recall_count + 1 WHERE space_id = ? AND entry_id = ?"); // unchanged from the baseline
    expect(stmts.some((s) => /^INSERT INTO story_finds \(space_id, entry_id, found_at, source, trust, trust_at, trust_basis\)/.test(s))).toBe(true);
  });
});

describe("P1-PAR falsification: breaking a relocated query is detected", () => {
  const golden = JSON.parse(fs.readFileSync(path.join(here, "golden/discovery-parity.golden.json"), "utf8")) as { payload: Record<string, unknown> };

  it("a deliberately wrong DiscoveryReader makes the parity fixtures diverge from the baseline", { timeout: 120_000 }, () => {
    const spy = vi.spyOn(DiscoveryReader.prototype, "holdsAnySet").mockReturnValue(false);
    try {
      const broken = runParityFixtures() as Record<string, unknown>;
      const differing = Object.keys(golden.payload).filter((k) => JSON.stringify(broken[k]) !== JSON.stringify(golden.payload[k]));
      expect(differing.length).toBeGreaterThan(0);
      expect(differing.some((k) => k.startsWith("gate:"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("…and so does a wrong ordering from list()", { timeout: 120_000 }, () => {
    const real = DiscoveryReader.prototype.list;
    const spy = vi.spyOn(DiscoveryReader.prototype, "list").mockImplementation(function (this: DiscoveryReader) {
      return real.call(this).reverse();
    });
    try {
      const broken = runParityFixtures() as Record<string, unknown>;
      expect(Object.keys(golden.payload).some((k) => JSON.stringify(broken[k]) !== JSON.stringify(golden.payload[k]))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

/**
 * Concurrent admission across PROCESSES. Inside one process better-sqlite3 is synchronous, so two connections cannot interleave; the case that matters is another process (a script, a
 * second writer) holding the write lock while it records the very same entry. The ledger reads state first inside an immediate transaction, so it must WAIT for that lock, then
 * find the existing row and report it as not new — never raise a constraint error, never overwrite the first time, never create a second row.
 */
describe("P1-ADM: admission while another process holds the write lock", () => {
  const FIRST = "2026-10-30T06:00:00.000Z";
  // Plain JavaScript run by a second Node process: take the write lock, report it, hold it, record the same entry, release it.
  const CHILD = [
    'const D = require("better-sqlite3");',
    "const db = new D(process.argv[1]);",
    'db.pragma("busy_timeout = 5000");',
    'db.exec("BEGIN IMMEDIATE");',
    'process.stdout.write("LOCKED\\n");',
    "setTimeout(() => {",
    '  db.prepare("INSERT INTO story_finds (space_id, entry_id, found_at, source, trust, trust_at, trust_basis) VALUES (\'s\', \'relic.harbor-nail\', ?, \'relic\', \'accepted\', ?, \'live:v1\')").run(process.argv[2], process.argv[2]);',
    '  db.exec("COMMIT");',
    '  process.stdout.write("COMMITTED\\n");',
    "  db.close();",
    "}, 700);",
  ].join("\n");

  const files: string[] = [];
  afterEach(() => {
    for (const f of files.splice(0)) for (const sfx of ["", "-wal", "-shm"]) fs.rmSync(f + sfx, { force: true });
  });

  /** Start the lock-holding child; resolves once it reports LOCKED. `done` resolves with its exit code and everything it printed. */
  function startChild(file: string): Promise<{ done: Promise<{ code: number | null; out: string }> }> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["-e", CHILD, file, FIRST], { cwd: path.resolve(here, "../.."), stdio: ["ignore", "pipe", "inherit"] });
      let out = "";
      const done = new Promise<{ code: number | null; out: string }>((res) => child.on("close", (code) => res({ code, out })));
      child.on("error", reject);
      child.stdout.on("data", (d: Buffer) => {
        out += d.toString();
        if (out.includes("LOCKED")) resolve({ done });
      });
    });
  }
  const dbFile = () => {
    const f = path.join(os.tmpdir(), `discovery-admit-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
    files.push(f);
    return f;
  };
  const withDb = (file: string) => {
    const handle = createDb(file);
    handle.sqlite.prepare(`INSERT OR IGNORE INTO space_meta (space_id) VALUES ('s')`).run();
    return handle;
  };

  it("waits for the lock, then reports the other process's row as existing: isNew false, first found_at kept, exactly one row, no error", async () => {
    const file = dbFile();
    const handle = withDb(file);
    const { done } = await startChild(file);
    const t0 = Date.now();
    let result: ReturnType<DiscoveryLedger["admit"]> | undefined;
    expect(() => {
      result = new DiscoveryLedger(handle, "s").admit("relic.harbor-nail", "relic", T0); // blocks on the child's lock
    }).not.toThrow();
    const waited = Date.now() - t0;
    const child = await done;
    expect(child.code).toBe(0);
    expect(child.out).toContain("COMMITTED");
    expect(waited, "admit must have waited for the other process's lock").toBeGreaterThan(300);
    expect(result).toEqual({ entryId: "relic.harbor-nail", foundAt: FIRST, isNew: false });
    expect(handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM story_finds WHERE space_id = 's' AND entry_id = 'relic.harbor-nail'`).get()).toEqual({ n: 1 });
    expect(handle.sqlite.prepare(`SELECT found_at, trust, trust_at, trust_basis FROM story_finds WHERE entry_id = 'relic.harbor-nail'`).get()).toEqual({ found_at: FIRST, trust: "accepted", trust_at: FIRST, trust_basis: "live:v1" });
    handle.sqlite.close();
  }, 30_000);

  it("control: a naive plain INSERT in the same race fails with a constraint error — so this test would catch an implementation that is not state-first", async () => {
    const file = dbFile();
    const handle = withDb(file);
    const { done } = await startChild(file);
    expect(() =>
      handle.sqlite.prepare(`INSERT INTO story_finds (space_id, entry_id, found_at, source) VALUES ('s','relic.harbor-nail',?, 'relic')`).run(new Date(T0).toISOString()),
    ).toThrow(/UNIQUE|constraint/i);
    expect((await done).code).toBe(0);
    handle.sqlite.close();
  }, 30_000);
});
