/**
 * G0 increment B3 — scheduler + status. Maps to G0-AC-11 (backup
 * status distinguishes the latest attempt from latest-good and renders
 * time in the viewer's local timezone — the report carries ISO
 * instants + a duration age; the panel's local rendering is covered
 * by BackupPanel.test.tsx) and plan §1 K1 (daily 03:30
 * America/New_York, Sunday = weekly keeper, RPO ≤ 24h with missed-run
 * catch-up, stale latest-good visible).
 *
 * DST pins are externally grounded (US rules, 2026): spring forward
 * Sun 2026-03-08 (03:30 EST Mar 7 = 08:30Z; 03:30 EDT Mar 8 = 07:30Z);
 * fall back Sun 2026-11-01 (03:30 EDT Oct 31 = 07:30Z; 03:30 EST
 * Nov 1 = 08:30Z). Both transition days are Sundays → weekly tier.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import express from "express";
import type { AddressInfo } from "node:net";
import BetterSqlite3 from "better-sqlite3";
import { createDb, type DbHandle } from "../db/client.js";
import { EMBED_DIM } from "../db/vec.js";
import { listBackupAttempts, listVerifiedBackups, type BackupTrigger } from "../backup/service.js";
import {
  decideBackupRun,
  nextScheduledRun,
  nyLocalToInstant,
  scheduledSlotFor,
  type BackupDecision,
  type BackupRunFacts,
} from "../backup/schedule.js";
import { runBackupPipeline } from "../backup/runner.js";
import { buildBackupStatus } from "../backup/status.js";
import { startBackupScheduler } from "../backup/scheduler.js";
import { InMemoryBackupStore, BACKUP_INDEX_KEY } from "../backup/store.js";
import { writeBackupIndex } from "../backup/index.js";
import { backupRoutes } from "../api/routes/backup.js";
import { requireSpace } from "../api/middleware.js";
import type { AppContext } from "../context.js";

const TEST_KEY_B64 = Buffer.alloc(32, 0x42).toString("base64");
const HOUR = 3_600_000;

let handle: DbHandle;
let dir: string;
let savedEnv: NodeJS.ProcessEnv;

/**
 * A minimal WORKING brain: one honest row in every MUST-BE-NONEMPTY
 * table of inventory v5 (26 tables), inserted through the real schema.
 * This fixture used to seed only `spaces` — enough while the pipeline
 * held MUST enforcement OFF. Since inventory v5 the pipeline enforces
 * by default, so a fixture that runs the real pipeline must be a brain
 * that would legitimately pass the guard: every MUST table populated.
 * (The three tables v5 reclassified — episodes_fts, vec_episodes,
 * fin_expense — stay empty here, which v5 makes a legitimate state.)
 */
function seedWorkingBrain(h: DbHandle): void {
  const s = h.sqlite;
  const vec = Buffer.from(new Float32Array(EMBED_DIM).fill(0.5).buffer);
  s.prepare(
    `INSERT INTO spaces (id, name, gamer_tag, passcode_hash, passcode_salt)
     VALUES ('space-test', 'Test Brain', 'tester', 'h', 's')`,
  ).run();
  s.prepare(`INSERT INTO settings (key, value) VALUES ('seed', '1')`).run();
  s.prepare(`INSERT INTO space_meta (space_id) VALUES ('space-test')`).run();
  s.prepare(`INSERT INTO user_persona (space_id, body) VALUES ('space-test', 'test persona')`).run();
  const node = s
    .prepare(
      `INSERT INTO nodes (space_id, label, type, content)
       VALUES ('space-test', 'A memory', 'note', 'something worth keeping')`,
    )
    .run();
  const nodeId = Number(node.lastInsertRowid);
  s.prepare(`INSERT INTO edges (space_id, source, target, relationship) VALUES ('space-test', ?, ?, 'relates')`).run(nodeId, nodeId);
  const source = s
    .prepare(
      `INSERT INTO sources (space_id, kind, raw_bytes, content_hash, byte_length)
       VALUES ('space-test', 'note', ?, 'seedhash', 4)`,
    )
    .run(Buffer.from("seed"));
  const sourceId = Number(source.lastInsertRowid);
  const schunk = s
    .prepare(
      `INSERT INTO source_chunks (space_id, source_id, ordinal, text, start_offset, end_offset)
       VALUES ('space-test', ?, 0, 'seed text', 0, 9)`,
    )
    .run(sourceId);
  const sourceChunkId = Number(schunk.lastInsertRowid);
  s.prepare(`INSERT INTO sources_fts (rowid, text) VALUES (?, 'seed text')`).run(sourceChunkId);
  s.prepare(`INSERT INTO node_sources (space_id, node_id, source_id, chunk_id) VALUES ('space-test', ?, ?, ?)`).run(nodeId, sourceId, sourceChunkId);
  const doc = s.prepare(`INSERT INTO knowledge_docs (space_id, name) VALUES ('space-test', 'seed doc')`).run();
  const docId = Number(doc.lastInsertRowid);
  const kchunk = s
    .prepare(`INSERT INTO knowledge_chunks (space_id, doc_id, ordinal, content) VALUES ('space-test', ?, 0, 'seed chunk')`)
    .run(docId);
  const knowledgeChunkId = Number(kchunk.lastInsertRowid);
  s.prepare(
    `INSERT INTO episodes (space_id, kind, summary, occurred_at, recorded_at)
     VALUES ('space-test', 'session', 'seed episode', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
  ).run();
  s.prepare(`INSERT INTO nodes_fts (rowid, label, content) VALUES (?, 'A memory', 'something worth keeping')`).run(nodeId);
  s.prepare(`INSERT INTO vec_nodes (node_id, embedding) VALUES (?, ?)`).run(BigInt(nodeId), vec);
  s.prepare(`INSERT INTO vec_docs (chunk_id, embedding) VALUES (?, ?)`).run(BigInt(knowledgeChunkId), vec);
  s.prepare(`INSERT INTO vec_source_chunks (chunk_id, embedding) VALUES (?, ?)`).run(BigInt(sourceChunkId), vec);
  const profile = s
    .prepare(`INSERT INTO instruction_profiles (space_id, name, body) VALUES ('space-test', 'seed profile', 'be nice')`)
    .run();
  s.prepare(`INSERT INTO vec_profiles (profile_id, embedding) VALUES (?, ?)`).run(BigInt(Number(profile.lastInsertRowid)), vec);
  s.prepare(
    `INSERT INTO user_model (space_id, slot, content, confidence, valid_at, origin)
     VALUES ('space-test', 'belief', 'seed belief', 0.9, '2026-01-01T00:00:00Z', 'stated')`,
  ).run();
  s.prepare(`INSERT INTO daily_logs (space_id, content) VALUES ('space-test', 'seed log')`).run();
  s.prepare(`INSERT INTO fin_account (space_id) VALUES ('space-test')`).run();
  s.prepare(`INSERT INTO fin_source (space_id) VALUES ('space-test')`).run();
  s.prepare(`INSERT INTO fin_income (space_id, date) VALUES ('space-test', '2026-01-01')`).run();
  const bill = s
    .prepare(`INSERT INTO fin_bill (space_id, name, anchor_date) VALUES ('space-test', 'seed bill', '2026-01-01')`)
    .run();
  s.prepare(`INSERT INTO fin_bill_occurrence (space_id, bill_id, due_date) VALUES ('space-test', ?, '2026-01-01')`).run(Number(bill.lastInsertRowid));
  s.prepare(`INSERT INTO fin_paystub (space_id, net_cents) VALUES ('space-test', 100)`).run();
}

beforeEach(() => {
  savedEnv = { ...process.env };
  delete process.env.BACKUP_ENCRYPTION_KEY;
  handle = createDb(":memory:");
  seedWorkingBrain(handle);
  dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "g0-b3-"));
});

afterEach(() => {
  process.env = savedEnv;
  handle.sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const facts = (over: Partial<BackupRunFacts> = {}): BackupRunFacts => ({
  latestAttemptMs: null,
  ...over,
});

// ── Schedule math ────────────────────────────────────────────────────

describe("schedule math — 03:30 America/New_York across DST", () => {
  it("pins the 03:30 instant on both sides of both 2026 transitions", () => {
    // Spring forward (Sun 2026-03-08): EST → EDT overnight.
    expect(nyLocalToInstant(2026, 3, 7, 3, 30).toISOString()).toBe("2026-03-07T08:30:00.000Z");
    expect(nyLocalToInstant(2026, 3, 8, 3, 30).toISOString()).toBe("2026-03-08T07:30:00.000Z");
    expect(nyLocalToInstant(2026, 3, 9, 3, 30).toISOString()).toBe("2026-03-09T07:30:00.000Z");
    // Fall back (Sun 2026-11-01): EDT → EST overnight.
    expect(nyLocalToInstant(2026, 10, 31, 3, 30).toISOString()).toBe("2026-10-31T07:30:00.000Z");
    expect(nyLocalToInstant(2026, 11, 1, 3, 30).toISOString()).toBe("2026-11-01T08:30:00.000Z");
    expect(nyLocalToInstant(2026, 11, 2, 3, 30).toISOString()).toBe("2026-11-02T08:30:00.000Z");
  });

  it("names the current slot and its tier on transition days", () => {
    // 01:00 EST on spring-forward Sunday: today's slot hasn't happened;
    // the current slot is Saturday's, a daily.
    let slot = scheduledSlotFor(new Date("2026-03-08T06:00:00.000Z"));
    expect(slot.dateKey).toBe("2026-03-07");
    expect(slot.tier).toBe("daily");
    // 04:00 EDT that Sunday: the slot is Sunday's → the weekly keeper.
    slot = scheduledSlotFor(new Date("2026-03-08T08:00:00.000Z"));
    expect(slot.dateKey).toBe("2026-03-08");
    expect(slot.tier).toBe("weekly");
    // 02:00 EST on fall-back Sunday (after the repeat): still before
    // 03:30, so the current slot is Saturday Oct 31.
    slot = scheduledSlotFor(new Date("2026-11-01T07:00:00.000Z"));
    expect(slot.dateKey).toBe("2026-10-31");
    expect(slot.tier).toBe("daily");
    // 04:00 EST: Sunday's slot, weekly.
    slot = scheduledSlotFor(new Date("2026-11-01T09:00:00.000Z"));
    expect(slot.dateKey).toBe("2026-11-01");
    expect(slot.tier).toBe("weekly");
    // Ordinary Monday.
    slot = scheduledSlotFor(new Date("2026-11-02T12:00:00.000Z"));
    expect(slot.dateKey).toBe("2026-11-02");
    expect(slot.tier).toBe("daily");
  });

  it("computes the next run across the transitions", () => {
    expect(nextScheduledRun(new Date("2026-03-08T06:00:00.000Z")).toISOString()).toBe(
      "2026-03-08T07:30:00.000Z",
    );
    expect(nextScheduledRun(new Date("2026-03-08T08:00:00.000Z")).toISOString()).toBe(
      "2026-03-09T07:30:00.000Z",
    );
    expect(nextScheduledRun(new Date("2026-11-01T07:00:00.000Z")).toISOString()).toBe(
      "2026-11-01T08:30:00.000Z",
    );
    expect(nextScheduledRun(new Date("2026-11-01T09:00:00.000Z")).toISOString()).toBe(
      "2026-11-02T08:30:00.000Z",
    );
  });

  // The load-bearing DST property: ticking every 20 minutes across a
  // transition week, the decision fires exactly once per New York day —
  // the 23-hour spring day and the 25-hour fall day included.
  const simulateWeek = (startIso: string, endIso: string): string[] => {
    const fired: string[] = [];
    let latestAttemptMs: number | null = null;
    for (let t = Date.parse(startIso); t < Date.parse(endIso); t += 20 * 60_000) {
      const decision = decideBackupRun(new Date(t), { latestAttemptMs });
      if (decision.run) {
        fired.push(decision.slotDateKey);
        latestAttemptMs = t;
      }
    }
    return fired;
  };

  it("fires exactly once per New York day across spring forward", () => {
    const fired = simulateWeek("2026-03-05T00:00:00.000Z", "2026-03-11T00:00:00.000Z");
    expect(fired).toEqual([
      "2026-03-04", // in-flight slot when the simulation starts (catch-up)
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08", // the 23-hour day — still exactly one
      "2026-03-09",
      "2026-03-10",
    ]);
  });

  it("fires exactly once per New York day across fall back", () => {
    const fired = simulateWeek("2026-10-29T00:00:00.000Z", "2026-11-04T00:00:00.000Z");
    expect(fired).toEqual([
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01", // the 25-hour day — still exactly one
      "2026-11-02",
      "2026-11-03",
    ]);
  });
});

// ── The decision ─────────────────────────────────────────────────────

describe("decideBackupRun", () => {
  it("an on-time evaluation at the slot fires 'schedule'", () => {
    const slotMs = Date.parse("2026-03-09T07:30:00.000Z"); // Mon 03:30 EDT
    const d = decideBackupRun(new Date(slotMs + 5 * 60_000), facts());
    expect(d.run).toBe(true);
    if (d.run) {
      expect(d.trigger).toBe("schedule");
      expect(d.tier).toBe("daily");
      expect(d.slotDateKey).toBe("2026-03-09");
    }
  });

  it("a slot that passed with no attempt fires 'catch_up' with the SLOT's tier", () => {
    // Sunday 2026-03-08's slot was 07:30Z; evaluating at noon UTC the
    // run is a catch-up but still the weekly keeper.
    const d = decideBackupRun(new Date("2026-03-08T12:00:00.000Z"), facts());
    expect(d.run).toBe(true);
    if (d.run) {
      expect(d.trigger).toBe("catch_up");
      expect(d.tier).toBe("weekly");
      expect(d.slotDateKey).toBe("2026-03-08");
    }
  });

  it("before today's slot, an uncovered yesterday slot is a catch-up (the boot case)", () => {
    // 01:00 EST on Mar 9 — fresh deployment, nothing ever ran.
    const d = decideBackupRun(new Date("2026-03-09T06:00:00.000Z"), facts());
    expect(d.run).toBe(true);
    if (d.run) {
      expect(d.trigger).toBe("catch_up");
      expect(d.slotDateKey).toBe("2026-03-08");
    }
  });

  it("any attempt at/after the slot covers it — the schedule does not duplicate a manual run", () => {
    const slotMs = Date.parse("2026-03-09T07:30:00.000Z");
    const manualAt = slotMs + 30 * 60_000;
    const d = decideBackupRun(new Date(slotMs + 2 * HOUR), facts({ latestAttemptMs: manualAt }));
    expect(d.run).toBe(false);
  });

  it("the fall-back window: a covered slot does not refire at 24h+ of age — the next slot is the run", () => {
    // Oct 31's run fired at 07:40Z (03:40 EDT). On Nov 1 at 07:50Z
    // (02:50 EST) that backup is 24h10m old, but Nov 1's slot (08:30Z)
    // is the next run — an age-based trigger here would double-fire
    // the same local day boundary. Age is a status signal, not a
    // trigger (see schedule.ts).
    const oct31Run = Date.parse("2026-10-31T07:40:00.000Z");
    const d = decideBackupRun(
      new Date("2026-11-01T07:50:00.000Z"),
      facts({ latestAttemptMs: oct31Run }),
    );
    expect(d.run).toBe(false);
    // …and the Nov 1 slot itself fires on time, as 'schedule'.
    const d2 = decideBackupRun(
      new Date("2026-11-01T08:35:00.000Z"),
      facts({ latestAttemptMs: oct31Run }),
    );
    expect(d2.run).toBe(true);
    if (d2.run) {
      expect(d2.trigger).toBe("schedule");
      expect(d2.slotDateKey).toBe("2026-11-01");
    }
  });

  it("down across a Sunday AND the next slot: the single coalesced run is still the weekly keeper (review P2-1)", () => {
    // Last attempt: Sat Oct 31's run. The app is then down through
    // Sunday's slot (Nov 1, weekly) AND Monday's slot (Nov 2, daily),
    // and comes back Monday 04:00 EST. Missed slots coalesce into ONE
    // run — they never queue — but that run carries the tier of the
    // OLDEST slot it covers: Sunday's weekly keeper must not be
    // silently downgraded to a daily.
    const oct31Run = Date.parse("2026-10-31T07:40:00.000Z");
    const d = decideBackupRun(
      new Date("2026-11-02T09:00:00.000Z"),
      facts({ latestAttemptMs: oct31Run }),
    );
    expect(d.run).toBe(true);
    if (d.run) {
      expect(d.trigger).toBe("catch_up");
      expect(d.tier).toBe("weekly");
      expect(d.slotDateKey).toBe("2026-11-02");
    }
  });

  it("a week of failed slots still fires once per slot — failures never suppress the cadence", () => {
    // Attempts exist (all failed — decide() only sees the record of
    // attempts, outcomes live on the rows) for Mon/Tue slots; Wed's
    // slot is due on time.
    const mon = Date.parse("2026-03-09T07:35:00.000Z");
    const tue = Date.parse("2026-03-10T07:35:00.000Z");
    const d = decideBackupRun(
      new Date("2026-03-11T07:32:00.000Z"),
      facts({ latestAttemptMs: tue }),
    );
    expect(d.run).toBe(true);
    if (d.run) expect(d.trigger).toBe("schedule");
  });
});

// ── The pipeline ─────────────────────────────────────────────────────

describe("runBackupPipeline — one path for every trigger", () => {
  it("local-only: verified locally, off-volume recorded NOT CONFIGURED — not a failure, not a promotion", async () => {
    const result = await runBackupPipeline(handle, { dir, trigger: "manual", store: null });
    expect(result.offVolume).toBe("not_configured");
    expect(result.failureStage).toBeNull();
    expect(result.attempt.state).toBe("verified_local");
    expect(result.attempt.offvolumeOutcome).toBe("not_configured");
    expect(result.attempt.failureStage).toBeNull();
    expect(result.attempt.failureDetail).toBeNull();
    expect(result.attempt.trigger).toBe("manual");
    expect(result.attempt.tier).toBe("daily");
    expect(result.attempt.pinned).toBe(false);
    // The outcome is on the recorded row, not just the return value.
    const rows = listBackupAttempts(handle);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.offvolumeOutcome).toBe("not_configured");
  });

  it("golden: tier golden + pinned from creation, even on the local-only path", async () => {
    const result = await runBackupPipeline(handle, { dir, trigger: "golden", store: null });
    expect(result.attempt.tier).toBe("golden");
    expect(result.attempt.pinned).toBe(true);
    expect(result.attempt.trigger).toBe("golden");
    expect(result.attempt.state).toBe("verified_local");
  });

  it("trigger parity: every trigger produces the same attempt shape", async () => {
    const triggers: BackupTrigger[] = ["schedule", "catch_up", "manual", "golden"];
    for (const trigger of triggers) {
      const result = await runBackupPipeline(handle, { dir, trigger, store: null });
      const a = result.attempt;
      expect(a.trigger).toBe(trigger);
      expect(a.state).toBe("verified_local");
      expect(a.offvolumeOutcome).toBe("not_configured");
      expect(a.snapshotSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(a.snapshotBytes).toBeGreaterThan(0);
      expect(a.finishedAt).not.toBeNull();
      expect(a.failureStage).toBeNull();
      expect(a.tier).toBe(trigger === "golden" ? "golden" : "daily");
      expect(a.pinned).toBe(trigger === "golden");
    }
    expect(listBackupAttempts(handle)).toHaveLength(4);
  });

  it("configured: promotes through the B2 chain, records the trigger, runs retention", async () => {
    process.env.BACKUP_ENCRYPTION_KEY = TEST_KEY_B64;
    const store = new InMemoryBackupStore();
    const retentionFn = vi.fn(async (_s: unknown, index: never) => ({
      index,
      planned: [],
      pruned: [],
    }));
    const result = await runBackupPipeline(handle, {
      dir,
      trigger: "schedule",
      tier: "weekly",
      store,
      retentionFn: retentionFn as never,
    });
    expect(result.offVolume).toBe("promoted");
    expect(result.attempt.state).toBe("promoted");
    expect(result.attempt.trigger).toBe("schedule");
    expect(result.attempt.tier).toBe("weekly");
    expect(result.attempt.offvolumeOutcome).toBeNull();
    expect(retentionFn).toHaveBeenCalledTimes(1);
    expect(result.retention).toEqual({ prunedCount: 0 });
    expect(result.retentionError).toBeNull();
  });

  it("configured store + missing key: fails CLOSED at encrypt — never downgraded to not-configured", async () => {
    const store = new InMemoryBackupStore();
    const result = await runBackupPipeline(handle, { dir, trigger: "manual", store });
    expect(result.offVolume).toBe("failed");
    expect(result.failureStage).toBe("encrypt");
    expect(result.attempt.state).toBe("failed");
    expect(result.attempt.offvolumeOutcome).toBeNull();
  });

  it("a retention failure after promotion does not fail the backup", async () => {
    process.env.BACKUP_ENCRYPTION_KEY = TEST_KEY_B64;
    const store = new InMemoryBackupStore();
    const retentionFn = vi.fn(async () => {
      throw new Error("index write exploded");
    });
    const result = await runBackupPipeline(handle, {
      dir,
      trigger: "manual",
      store,
      retentionFn: retentionFn as never,
    });
    expect(result.offVolume).toBe("promoted");
    expect(result.attempt.state).toBe("promoted");
    expect(result.retention).toBeNull();
    expect(result.retentionError).toContain("index write exploded");
  });

  it("a second run while one is in flight is refused — runs never interleave (review P2)", async () => {
    process.env.BACKUP_ENCRYPTION_KEY = TEST_KEY_B64;
    const store = new InMemoryBackupStore();
    const realPut = store.putObject.bind(store);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let puts = 0;
    store.putObject = async (key: string, body: Buffer) => {
      puts += 1;
      if (puts === 1) await gate; // hold the first run mid-upload
      return realPut(key, body);
    };
    const first = runBackupPipeline(handle, { dir, trigger: "manual", store });
    await vi.waitFor(() => expect(puts).toBe(1));
    await expect(runBackupPipeline(handle, { dir, trigger: "golden", store })).rejects.toThrow(
      /already in progress/,
    );
    release();
    const firstResult = await first;
    expect(firstResult.offVolume).toBe("promoted");
    // The lock is released once the run settles: a later run proceeds.
    const third = await runBackupPipeline(handle, { dir, trigger: "manual", store });
    expect(third.offVolume).toBe("promoted");
    expect(listBackupAttempts(handle)).toHaveLength(2);
  });
});

// ── MUST enforcement (inventory v5) — the pipeline default is ON ────

describe("runBackupPipeline — MUST enforcement defaults ON (inventory v5)", () => {
  function seedPartialBrain(h: DbHandle): void {
    h.sqlite
      .prepare(
        `INSERT INTO spaces (id, name, gamer_tag, passcode_hash, passcode_salt)
         VALUES ('space-partial', 'Partial Brain', 'partial', 'h', 's')`,
      )
      .run();
  }

  it("a partial brain fails at the verify stage BY DEFAULT, naming an empty MUST table, recorded as a failed attempt", async () => {
    const partial = createDb(":memory:");
    try {
      seedPartialBrain(partial);
      // No enforceMustNonempty passed: since v5 the pipeline default
      // enforces, and this brain (nearly every MUST table empty) must
      // NOT produce a backup.
      const result = await runBackupPipeline(partial, { dir, trigger: "manual", store: null });
      expect(result.offVolume).toBe("failed");
      expect(result.failureStage).toBe("verify");
      expect(result.failureDetail).toContain("must-be-nonempty table is empty in snapshot: sources");
      expect(result.attempt.state).toBe("failed");
      expect(result.attempt.failureStage).toBe("verify");
      expect(listVerifiedBackups(partial)).toHaveLength(0);
      expect(listBackupAttempts(partial)).toHaveLength(1);
    } finally {
      partial.sqlite.close();
    }
  });

  it("the explicit opt-out remains available: the same partial brain verifies with enforceMustNonempty: false", async () => {
    const partial = createDb(":memory:");
    try {
      seedPartialBrain(partial);
      const result = await runBackupPipeline(partial, {
        dir,
        trigger: "manual",
        store: null,
        enforceMustNonempty: false,
      });
      expect(result.offVolume).toBe("not_configured");
      expect(result.attempt.state).toBe("verified_local");
    } finally {
      partial.sqlite.close();
    }
  });

  it("the standard working-brain fixture passes under the default (enforcement ON, no option passed)", async () => {
    const result = await runBackupPipeline(handle, { dir, trigger: "manual", store: null });
    expect(result.offVolume).toBe("not_configured");
    expect(result.attempt.state).toBe("verified_local");
    expect(result.failureStage).toBeNull();
  });
});

// ── The scheduler ────────────────────────────────────────────────────

describe("startBackupScheduler", () => {
  it("the boot evaluation fires a catch-up for a missed slot", async () => {
    const calls: { trigger: string; tier?: string }[] = [];
    const scheduler = startBackupScheduler({
      handle,
      dir,
      tickMs: 3_600_000,
      now: () => new Date("2026-03-09T15:00:00.000Z"), // Mon 11:00 EDT — slot was 07:30Z
      runPipeline: (async (_h: unknown, opts: { trigger: string; tier?: string }) => {
        calls.push({ trigger: opts.trigger, tier: opts.tier });
        return { offVolume: "not_configured" };
      }) as never,
      log: () => {},
    });
    expect(scheduler).not.toBeNull();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.trigger).toBe("catch_up");
    expect(calls[0]?.tier).toBe("daily");
    scheduler!.stop();
  });

  it("does not fire when the current slot already has an attempt", async () => {
    handle.sqlite
      .prepare(
        `INSERT INTO backup_attempts (id, created_at, state, trigger)
         VALUES ('a1', '2026-03-09T08:30:00.000Z', 'verified_local', 'manual')`,
      )
      .run();
    const calls: unknown[] = [];
    const scheduler = startBackupScheduler({
      handle,
      dir,
      tickMs: 3_600_000,
      now: () => new Date("2026-03-09T15:00:00.000Z"),
      runPipeline: (async () => {
        calls.push(1);
        return { offVolume: "not_configured" };
      }) as never,
      log: () => {},
    });
    await new Promise((r) => setTimeout(r, 50));
    const decision = await scheduler!.evaluate();
    expect(decision?.run).toBe(false);
    expect(calls).toHaveLength(0);
    scheduler!.stop();
  });

  it("BACKUP_SCHEDULER=off disables the scheduler", () => {
    const scheduler = startBackupScheduler({
      handle,
      dir,
      env: { BACKUP_SCHEDULER: "off" },
      log: () => {},
    });
    expect(scheduler).toBeNull();
  });

  it("end to end: a REAL pipeline run records the attempt that suppresses the next evaluation (review P2-7)", async () => {
    // No runPipeline override: the boot evaluation drives the real
    // pipeline (local-only in this environment — no store configured),
    // and the attempt it records is what covers the slot afterwards.
    // This is the once-per-day claim as production actually runs it.
    const scheduler = startBackupScheduler({
      handle,
      dir,
      tickMs: 3_600_000,
      now: () => new Date("2026-03-09T15:00:00.000Z"), // Mon 11:00 EDT — slot was 07:30Z
      log: () => {},
    });
    expect(scheduler).not.toBeNull();
    await vi.waitFor(() => expect(listBackupAttempts(handle)).toHaveLength(1));
    const rows = listBackupAttempts(handle);
    expect(rows[0]?.trigger).toBe("catch_up");
    expect(rows[0]?.state).toBe("verified_local");
    expect(rows[0]?.offvolumeOutcome).toBe("not_configured");
    // Wait out the boot run's overlap guard, then a fresh evaluation
    // sees the slot covered by the real attempt and does not refire.
    let again: BackupDecision | null = null;
    await vi.waitFor(async () => {
      again = await scheduler!.evaluate();
      expect(again).not.toBeNull();
    });
    expect(again!.run).toBe(false);
    expect(listBackupAttempts(handle)).toHaveLength(1);
    scheduler!.stop();
  });

  it("a broken attempt record can never crash the process — the evaluation logs and skips (review P1)", async () => {
    // Regression: the facts read used to sit OUTSIDE evaluate()'s
    // try/catch, so a throw here (locked DB, missing table, disk
    // error) escaped as an unhandled rejection from the fire-and-
    // forget boot/interval calls — Node's default crashes the whole
    // server. The scheduler must absorb it: log, skip, stay alive.
    handle.sqlite.exec("DROP TABLE backup_attempts");
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const scheduler = startBackupScheduler({
        handle,
        dir,
        tickMs: 3_600_000,
        runPipeline: (async () => ({ offVolume: "not_configured" })) as never,
        log: () => {},
      });
      expect(scheduler).not.toBeNull();
      // The boot evaluation already hit the broken table. An explicit
      // evaluation must RESOLVE (null), never reject.
      await expect(scheduler!.evaluate()).resolves.toBeNull();
      await new Promise((r) => setTimeout(r, 50));
      expect(unhandled).toHaveLength(0);
      scheduler!.stop();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

// ── Status ───────────────────────────────────────────────────────────

describe("buildBackupStatus (G0-AC-11)", () => {
  it("empty brain: no attempt, no good, stale by definition, off-volume not configured", async () => {
    const now = new Date("2026-03-09T15:00:00.000Z");
    const status = await buildBackupStatus(handle, { store: null, now });
    expect(status.latestAttempt).toBeNull();
    expect(status.latestGood).toBeNull();
    expect(status.latestGoodAgeMs).toBeNull();
    expect(status.latestGoodStale).toBe(true);
    expect(status.latestLocalVerified).toBeNull();
    expect(status.offVolume.configured).toBe(false);
    expect(status.offVolume.index.status).toBe("not_configured");
    expect(status.schedule.nextRunAt).toBe(nextScheduledRun(now).toISOString());
    expect(status.schedule.catchUpDue).toBe(true); // a slot is uncovered right now
    expect(status.schedule.timezone).toBe("America/New_York");
  });

  it("the latest attempt and latest-good are different rows, and the failure never hides the good", async () => {
    process.env.BACKUP_ENCRYPTION_KEY = TEST_KEY_B64;
    const store = new InMemoryBackupStore();
    const good = await runBackupPipeline(handle, { dir, trigger: "schedule", store });
    expect(good.offVolume).toBe("promoted");
    // Age the good backup to 30h ago.
    handle.sqlite
      .prepare(`UPDATE backup_attempts SET created_at = ?, promoted_at = ? WHERE id = ?`)
      .run("2026-03-08T09:00:00.000Z", "2026-03-08T09:00:00.000Z", good.attempt.id);
    // A newer attempt that fails (key now missing).
    delete process.env.BACKUP_ENCRYPTION_KEY;
    const failed = await runBackupPipeline(handle, { dir, trigger: "manual", store });
    expect(failed.offVolume).toBe("failed");

    const status = await buildBackupStatus(handle, {
      store,
      now: new Date("2026-03-09T15:00:00.000Z"),
    });
    expect(status.latestAttempt?.id).toBe(failed.attempt.id);
    expect(status.latestAttempt?.state).toBe("failed");
    expect(status.latestAttempt?.failureStage).toBe("encrypt");
    expect(status.latestGood?.id).toBe(good.attempt.id);
    expect(status.latestGood?.id).not.toBe(status.latestAttempt?.id);
    expect(status.latestGoodAgeMs).toBe(30 * HOUR);
    expect(status.latestGoodStale).toBe(true);
    expect(status.offVolume.index.status).toBe("ok");
    expect(status.offVolume.index.latestGoodId).toBe(good.attempt.id);
  });

  it("a fresh latest-good is not stale, and its age is a duration", async () => {
    process.env.BACKUP_ENCRYPTION_KEY = TEST_KEY_B64;
    const store = new InMemoryBackupStore();
    const good = await runBackupPipeline(handle, { dir, trigger: "manual", store });
    const promotedMs = Date.parse(good.attempt.promotedAt!);
    const status = await buildBackupStatus(handle, {
      store,
      now: new Date(promotedMs + 1 * HOUR),
    });
    expect(status.latestGoodStale).toBe(false);
    expect(status.latestGoodAgeMs).toBe(1 * HOUR);
    expect(status.schedule.catchUpDue).toBe(false);
  });

  it("a local-only attempt shows as verified-local + not-configured, never as latest-good", async () => {
    const local = await runBackupPipeline(handle, { dir, trigger: "manual", store: null });
    const status = await buildBackupStatus(handle, { store: null, now: new Date() });
    expect(status.latestAttempt?.id).toBe(local.attempt.id);
    expect(status.latestAttempt?.state).toBe("verified_local");
    expect(status.latestAttempt?.offVolumeOutcome).toBe("not_configured");
    expect(status.latestGood).toBeNull();
    expect(status.latestLocalVerified?.id).toBe(local.attempt.id);
  });

  it("a corrupt index is reported loudly in status — the builder never throws (B2 ride-along)", async () => {
    process.env.BACKUP_ENCRYPTION_KEY = TEST_KEY_B64;
    const store = new InMemoryBackupStore();
    const good = await runBackupPipeline(handle, { dir, trigger: "manual", store });
    expect(good.offVolume).toBe("promoted");
    await store.putObject(BACKUP_INDEX_KEY, Buffer.from("this is not json{{{", "utf8"));
    const status = await buildBackupStatus(handle, { store, now: new Date() });
    expect(status.offVolume.index.status).toBe("corrupt");
    expect(status.offVolume.index.detail).toMatch(/corrupt/i);
    // The local record still answers: latest-good survives the report.
    expect(status.latestGood?.id).toBe(good.attempt.id);
    // Structurally invalid (valid JSON, wrong shape) is corrupt too.
    await store.putObject(BACKUP_INDEX_KEY, Buffer.from('{"version": 2}', "utf8"));
    const status2 = await buildBackupStatus(handle, { store, now: new Date() });
    expect(status2.offVolume.index.status).toBe("corrupt");
  });

  it("an unreadable store is 'unreadable', distinct from corrupt", async () => {
    const brokenStore = {
      putObject: async () => {},
      getObject: async () => {
        throw new Error("network down");
      },
      deleteObject: async () => {},
      listObjects: async () => [],
    };
    const status = await buildBackupStatus(handle, { store: brokenStore, now: new Date() });
    expect(status.offVolume.index.status).toBe("unreadable");
    expect(status.offVolume.index.detail).toContain("network down");
  });

  it("latest-good is chosen by PROMOTED time, not creation time (review P2-7)", async () => {
    // 'created-first' was created Mar 1 but only promoted Mar 9 (an
    // interleaved run); 'created-later' was created AND promoted
    // earlier. Latest-good is the one that promoted LAST.
    handle.sqlite
      .prepare(
        `INSERT INTO backup_attempts (id, created_at, state, tier, promoted_at) VALUES
         ('created-first', '2026-03-01T07:30:00.000Z', 'promoted', 'daily', '2026-03-09T07:35:00.000Z'),
         ('created-later', '2026-03-05T07:30:00.000Z', 'promoted', 'daily', '2026-03-06T07:35:00.000Z')`,
      )
      .run();
    const status = await buildBackupStatus(handle, {
      store: null,
      now: new Date("2026-03-09T12:00:00.000Z"),
    });
    expect(status.latestGood?.id).toBe("created-first");
    expect(status.latestGoodAgeMs).toBe(4 * HOUR + 25 * 60_000);
    expect(status.latestGoodStale).toBe(false);
  });

  it("a configured store with no index yet reads ok with zero entries (review P2-7)", async () => {
    const store = new InMemoryBackupStore();
    const status = await buildBackupStatus(handle, { store, now: new Date() });
    expect(status.offVolume.configured).toBe(true);
    expect(status.offVolume.index.status).toBe("ok");
    expect(status.offVolume.index.entryCount).toBe(0);
    expect(status.offVolume.index.latestGoodId).toBeNull();
    expect(status.latestGoodDiverged).toBe(false);
  });

  it("when the index names a different latest-good than the local record, the divergence is explicit (review P2-6)", async () => {
    // The crash window B2 documents: the promote index write landed,
    // the local row update did not. Recovery (store-only) would use
    // the INDEX's latest-good — status must not quietly present the
    // local record as the whole truth.
    handle.sqlite
      .prepare(
        `INSERT INTO backup_attempts (id, created_at, state, tier, promoted_at) VALUES
         ('db-good', '2026-03-09T08:00:00.000Z', 'promoted', 'daily', '2026-03-09T08:05:00.000Z')`,
      )
      .run();
    const store = new InMemoryBackupStore();
    await writeBackupIndex(store, {
      version: 1,
      latestGoodId: "idx-good",
      entries: [
        {
          backupId: "idx-good",
          createdAt: "2026-03-09T09:00:00.000Z",
          tier: "daily",
          pinned: false,
          state: "promoted",
          failureStage: null,
          failureDetail: null,
          snapshotKey: "backups/idx-good.db.enc",
          manifestKey: "backups/idx-good.manifest.json",
          ciphertextSha256: "a".repeat(64),
          promotedAt: "2026-03-09T09:05:00.000Z",
          prunedAt: null,
        },
      ],
      pruneLog: [],
    });
    const status = await buildBackupStatus(handle, {
      store,
      now: new Date("2026-03-09T12:00:00.000Z"),
    });
    expect(status.latestGood?.id).toBe("db-good"); // the local record, as recorded
    expect(status.latestGoodIndexId).toBe("idx-good"); // what recovery would use
    expect(status.latestGoodDiverged).toBe(true);
  });
});

// ── Routes (owner gate) ──────────────────────────────────────────────

describe("backup routes — owner-only surface", () => {
  let base = "";
  let server: import("node:http").Server;

  beforeEach(async () => {
    handle.sqlite
      .prepare(
        `INSERT INTO spaces (id, name, gamer_tag, passcode_hash, passcode_salt)
         VALUES ('space-owner', 'Owner Brain', 'owner', 'h', 's'),
                ('space-other', 'Other Brain', 'other', 'h', 's')`,
      )
      .run();
    process.env.OWNER_SPACE_IDS = "space-owner";
    process.env.BACKUP_DIR = dir;
    const app = express();
    app.use(express.json());
    app.use("/api/backup", requireSpace(handle), backupRoutes({ handle } as AppContext));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}/api/backup`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const call = (path: string, spaceId?: string, init: RequestInit = {}) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(spaceId ? { "x-space-id": spaceId } : {}),
        ...(init.headers ?? {}),
      },
    });

  it("status: 401 without a brain, 403 for a non-owner brain, 200 for the owner", async () => {
    expect((await call("/status")).status).toBe(401);
    expect((await call("/status", "space-other")).status).toBe(403);
    const res = await call("/status", "space-owner");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("latestAttempt");
    expect(body).toHaveProperty("latestGood");
    expect(body).toHaveProperty("latestGoodStale");
    expect(body).toHaveProperty("schedule");
    expect(body).toHaveProperty("offVolume");
  });

  it("run: non-owner is refused; the owner's manual + golden runs record their triggers", async () => {
    expect((await call("/run", "space-other", { method: "POST", body: "{}" })).status).toBe(403);

    const manual = await call("/run", "space-owner", { method: "POST", body: "{}" });
    expect(manual.status).toBe(200);
    const manualBody = (await manual.json()) as {
      offVolume: string;
      attempt: { trigger: string; tier: string; state: string; offVolumeOutcome: string };
    };
    expect(manualBody.offVolume).toBe("not_configured"); // no R2 secrets in the test env
    expect(manualBody.attempt.trigger).toBe("manual");
    expect(manualBody.attempt.state).toBe("verified_local");
    expect(manualBody.attempt.offVolumeOutcome).toBe("not_configured");

    const golden = await call("/run", "space-owner", {
      method: "POST",
      body: JSON.stringify({ golden: true }),
    });
    expect(golden.status).toBe(200);
    const goldenBody = (await golden.json()) as {
      attempt: { trigger: string; tier: string; pinned: boolean };
    };
    expect(goldenBody.attempt.trigger).toBe("golden");
    expect(goldenBody.attempt.tier).toBe("golden");
    expect(goldenBody.attempt.pinned).toBe(true);
  });
});

// ── Schema upgrade (B2-era volume) ───────────────────────────────────

describe("schema upgrade", () => {
  it("a B2-era backup_attempts (no trigger/offvolume_outcome) is upgraded in place, rows intact", () => {
    const dbPath = nodePath.join(dir, "legacy.db");
    const raw = new BetterSqlite3(dbPath);
    raw.exec(`
      CREATE TABLE backup_attempts (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        state TEXT NOT NULL DEFAULT 'created',
        failure_stage TEXT,
        failure_detail TEXT,
        snapshot_path TEXT,
        snapshot_sha256 TEXT,
        snapshot_bytes INTEGER,
        manifest_json TEXT,
        finished_at TEXT,
        tier TEXT NOT NULL DEFAULT 'daily',
        pinned INTEGER NOT NULL DEFAULT 0,
        promoted_at TEXT
      );
      INSERT INTO backup_attempts (id, state) VALUES ('legacy-attempt', 'promoted');
    `);
    raw.close();
    const upgraded = createDb(dbPath);
    try {
      const names = (
        upgraded.sqlite.prepare(`PRAGMA table_info(backup_attempts)`).all() as { name: string }[]
      ).map((c) => c.name);
      expect(names).toContain("trigger");
      expect(names).toContain("offvolume_outcome");
      const rows = listBackupAttempts(upgraded);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.trigger).toBe("manual"); // column default — pre-B3 rows read as manual
      expect(rows[0]?.offvolumeOutcome).toBeNull();
    } finally {
      upgraded.sqlite.close();
    }
  });
});
