import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import { StreakRepo } from "../streak.js";
import { setPreference } from "../agent/notify/policy.js";
import { recentUndertakings } from "../analysis/undertakings.js";

/**
 * IM-64 (streak history on the streak endpoint) + IM-67 (undertaking history).
 * The Soumaya tab's Consistency Constellation must be built on REAL streak
 * data: touch() records each tended day; days before the recorded era read
 * as `null` (no record), never as missed days.
 */

let handle: DbHandle;
let ctx: AppContext;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = { handle, embeddings, llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
  setPreference(handle.sqlite, "s1", "timezone", "UTC");
});
afterEach(() => handle.sqlite.close());

const utcDay = (offset = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

describe("StreakRepo history (IM-64)", () => {
  it("touch() records today and get() exposes it in history", () => {
    const repo = new StreakRepo(handle, "s1");
    repo.touch();
    const s = repo.get();
    expect(s.current).toBe(1);
    expect(s.lastActiveDate).toBe(utcDay());
    expect(s.history).toHaveLength(14);
    const last = s.history![s.history!.length - 1]!;
    expect(last.date).toBe(utcDay());
    expect(last.tended).toBe(true);
    // A day inside the recorded era with no tend is a KNOWN miss, not null:
    // (today is the first recorded day, so yesterday predates the era → null)
    const yesterday = s.history![s.history!.length - 2]!;
    expect(yesterday.date).toBe(utcDay(-1));
    expect(yesterday.tended).toBeNull();
  });

  it("legacy streak (no day records): span days derive from last_active_date, older days are null — never invented misses", () => {
    handle.sqlite
      .prepare(`INSERT OR IGNORE INTO space_meta (space_id) VALUES ('s1')`)
      .run();
    handle.sqlite
      .prepare(`UPDATE space_meta SET streak = 3, streak_best = 3, last_active_date = ?, streak_shields = 2 WHERE space_id = 's1'`)
      .run(utcDay(-1));
    const s = new StreakRepo(handle, "s1").get();
    expect(s.current).toBe(3);
    const byDate = new Map(s.history!.map((h) => [h.date, h.tended]));
    // The 3-day span ending yesterday is the current streak — counted days.
    expect(byDate.get(utcDay(-1))).toBe(true);
    expect(byDate.get(utcDay(-2))).toBe(true);
    expect(byDate.get(utcDay(-3))).toBe(true);
    // Today is knowable: not tended yet.
    expect(byDate.get(utcDay())).toBe(false);
    // Older days predate any record: null, NOT false.
    expect(byDate.get(utcDay(-10))).toBeNull();
  });

  it("history is space-scoped", () => {
    new StreakRepo(handle, "s1").touch();
    const other = new StreakRepo(handle, "s2").get();
    expect(other.current).toBe(0);
    expect(other.history!.every((h) => h.tended !== true)).toBe(true);
  });
});

describe("recentUndertakings (IM-67)", () => {
  it("returns active + completed arcs, newest first, space-scoped", () => {
    const ins = handle.sqlite.prepare(
      `INSERT INTO undertakings (space_id, kind, title, total, done, status) VALUES (?, 'warm_cold_belt', ?, 5, ?, ?)`,
    );
    ins.run("s1", "Old arc", 5, "done");
    ins.run("s1", "Current arc", 2, "active");
    ins.run("s2", "Someone else's arc", 5, "done");
    const list = recentUndertakings(ctx, "s1");
    expect(list.map((u) => u.title)).toEqual(["Current arc", "Old arc"]);
    expect(list[1]!.status).toBe("done");
    expect(recentUndertakings(ctx, "s2")).toHaveLength(1);
  });

  it("returns [] when a brain has never had an undertaking", () => {
    expect(recentUndertakings(ctx, "s1")).toEqual([]);
  });
});
