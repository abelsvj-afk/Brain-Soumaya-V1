import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import type { LlmProvider, LlmToolCallInput, LlmToolResult } from "../llm/adapter.js";
import { composeSystem, formatNowLine } from "../llm/prompts.js";
import { agentLoop } from "../agent/loop.js";
import { setPreference } from "../agent/notify/policy.js";

/**
 * Date & Time Accuracy workstream (audit 2026-10-20) — regression pins.
 * Item 1 (audit gap #10): the model must be grounded in the SPACE's timezone.
 * Later items append their own describes to this file.
 */

// 20:15 UTC on Oct 20 = 10:15 on Oct 21 in Kiritimati (UTC+14) — a full local
// calendar day ahead of UTC, the sharpest possible grounding check.
const NOW_MS = Date.parse("2026-10-20T20:15:00.000Z");

describe("item 1 — formatNowLine / composeSystem time grounding", () => {
  it("presents now in the space timezone: local time + zone name + UTC instant", () => {
    const line = formatNowLine(NOW_MS, "Pacific/Kiritimati");
    expect(line).toContain("October 21, 2026"); // the LOCAL date, not UTC's Oct 20
    expect(line).toContain("(Pacific/Kiritimati)");
    expect(line).toContain("2026-10-20T20:15:00.000Z"); // the UTC instant, unambiguous
    expect(line).toContain("LOCAL time");
  });

  it("without a timezone, keeps the historical UTC-only rendering", () => {
    const line = formatNowLine(NOW_MS);
    expect(line).toContain("October 20, 2026");
    expect(line).toContain("UTC");
    expect(line).not.toContain("user's timezone");
    // composeSystem embeds exactly that line when no timezone is supplied.
    expect(composeSystem({ nowMs: NOW_MS })).toContain(line);
  });

  it("an invalid timezone falls back to UTC instead of throwing", () => {
    const line = formatNowLine(NOW_MS, "Not/AZone");
    expect(line).toContain("October 20, 2026");
    expect(line).toContain("UTC");
  });
});

describe("item 1 — the agent loop injects the space-local now", () => {
  let handle: DbHandle;
  let ctx: AppContext;
  let captured: LlmToolCallInput[];

  function capturingLlm(): LlmProvider {
    const base = new HeuristicProvider();
    return {
      ...base,
      callWithTools: async (input: LlmToolCallInput): Promise<LlmToolResult> => {
        captured.push(input);
        return { text: "ok", calls: [] };
      },
    } as LlmProvider;
  }

  beforeEach(() => {
    handle = createDb(":memory:");
    captured = [];
    ctx = {
      handle,
      embeddings: new HashEmbeddingProvider(EMBED_DIM),
      llm: capturingLlm(),
      usage: new UsageTracker(handle),
    };
  });
  afterEach(() => handle.sqlite.close());

  it("loop system instruction carries the space's local time (user-set timezone)", async () => {
    setPreference(handle.sqlite, "tzspace", "timezone", "Pacific/Kiritimati");
    const res = await agentLoop({
      ctx,
      spaceId: "tzspace",
      principal: "web:tzspace",
      userMessage: "what day is it for me?",
      history: [],
      now: NOW_MS,
      notify: async () => {},
    });
    expect(res.text).toBe("ok");
    expect(captured).toHaveLength(1);
    const sys = captured[0]!.systemInstruction;
    expect(sys).toContain("(Pacific/Kiritimati)");
    expect(sys).toContain("October 21, 2026"); // local date at the turn's clock
    expect(sys).toContain("2026-10-20T20:15:00.000Z");
  });

  it("a space with no timezone set gets the shared default (America/New_York)", async () => {
    await agentLoop({
      ctx,
      spaceId: "plainspace",
      principal: "web:plainspace",
      userMessage: "hello",
      history: [],
      now: NOW_MS,
      notify: async () => {},
    });
    const sys = captured[0]!.systemInstruction;
    expect(sys).toContain("(America/New_York)");
    expect(sys).toContain("October 20, 2026"); // 20:15 UTC = 16:15 EDT, same local date
  });
});

describe("item 3 — agent_logs readers compare instants across mixed formats (gap #6)", () => {
  let handle: DbHandle;
  let ctx: AppContext;
  const NOW3 = Date.parse("2026-06-01T00:00:00.000Z");
  const DAY = 86_400_000;

  beforeEach(() => {
    handle = createDb(":memory:");
    ctx = {
      handle,
      embeddings: new HashEmbeddingProvider(EMBED_DIM),
      llm: new HeuristicProvider(),
      usage: new UsageTracker(handle),
    };
  });
  afterEach(() => handle.sqlite.close());

  it("recentActionCount counts BOTH the space-format and the ISO-Z row in the window", async () => {
    const { recentActionCount } = await import("../communication/context.js");
    const ins = (createdAt: string) =>
      handle.sqlite
        .prepare(`INSERT INTO agent_logs (space_id, action, description, targets, created_at) VALUES ('s3', 'tool:x', 'd', '[]', ?)`)
        .run(createdAt);
    // The cutoff instant is 2026-05-02T00:00:00.000Z (NOW3 − 30d). The bug
    // bites SAME-DATE rows: "2026-05-02 10:00:00" is 10h AFTER the cutoff,
    // but as a raw string it sorts BEFORE it (" " < "T" at position 10).
    ins("2026-05-02 10:00:00"); // column-default shape (approvals/consolidation writes)
    ins("2026-05-02T10:00:00.000Z"); // tool-router shape, same instant
    ins("2026-05-01 23:00:00"); // before the cutoff in either shape — must NOT count
    // Pre-fix, the raw string comparison counted only the ISO-Z row (1).
    expect(recentActionCount(handle, "s3", "tool:x", 30, new Date(NOW3))).toBe(2);
  });

  it("goal_trend cooldown honors a space-format agent_logs row (was silently invisible)", async () => {
    const { goalFundingTrendTool } = await import("../agent/tools/goalFundingTrend.js");
    const { FinBucketRepo } = await import("../repositories/finBucket.repo.js");
    const { FinGoalRepo } = await import("../repositories/finGoal.repo.js");
    const spaceId = "s3";
    const bucket = new FinBucketRepo(handle, spaceId).create({ name: "B" });
    const goal = new FinGoalRepo(handle, spaceId).create({ bucketId: bucket.id, name: "Emergency Fund" });
    const alloc = (amountCents: number, daysAgo: number) => {
      const createdAt = new Date(NOW3 - daysAgo * DAY).toISOString().replace("T", " ").slice(0, 19);
      handle.sqlite
        .prepare(`INSERT INTO fin_allocation (space_id, goal_id, amount_cents, created_at) VALUES (?, ?, ?, ?)`)
        .run(spaceId, goal.id, amountCents, createdAt);
    };
    alloc(30_000, 75);
    alloc(15_000, 45);
    alloc(5_000, 15);
    const tc = { ctx, spaceId, now: NOW3, notify: async () => {} };
    // Control: with no prior surfacing, the two-period decrease IS eligible.
    expect(goalFundingTrendTool.detect(tc)).toHaveLength(1);
    // Surfaced on the cutoff's own calendar date (2026-05-02 09:00 UTC, 9h
    // after the 30-day cutoff instant), stamped in the column-default space
    // format — inside the cooldown, so the goal must now be suppressed.
    // Pre-fix the string cutoff ("2026-05-02T00:00:00.000Z") sorted after
    // "2026-05-02 09:00:00" (" " < "T") and the row was never seen.
    handle.sqlite
      .prepare(`INSERT INTO agent_logs (space_id, action, description, targets, created_at) VALUES (?, 'tool:goal_trend', 'd', ?, '2026-05-02 09:00:00')`)
      .run(spaceId, JSON.stringify([goal.id]));
    expect(goalFundingTrendTool.detect(tc)).toEqual([]);
  });
});

describe("item 4 — streak days are the SPACE's local days (gap #9, owner decision 2026-10-20)", () => {
  let handle: DbHandle;

  beforeEach(() => {
    handle = createDb(":memory:");
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    handle.sqlite.close();
  });

  const lastActive = (spaceId: string) =>
    (handle.sqlite.prepare(`SELECT last_active_date FROM space_meta WHERE space_id = ?`).get(spaceId) as { last_active_date: string }).last_active_date;

  it("23:30 local counts that day; 00:30 local counts the new day (America/New_York)", async () => {
    const { StreakRepo } = await import("../streak.js");
    setPreference(handle.sqlite, "s4", "timezone", "America/New_York");
    const s = new StreakRepo(handle, "s4");
    vi.setSystemTime(Date.parse("2026-10-21T03:30:00.000Z")); // Oct 20, 23:30 EDT
    expect(s.touch().streak.current).toBe(1);
    expect(lastActive("s4")).toBe("2026-10-20"); // the LOCAL day — UTC would say 2026-10-21
    vi.setSystemTime(Date.parse("2026-10-21T04:30:00.000Z")); // Oct 21, 00:30 EDT
    const second = s.touch();
    expect(second.advanced).toBe(true);
    expect(second.streak.current).toBe(2); // consecutive LOCAL days (same UTC day!)
  });

  it("streak continues across the spring-forward DST day (23-hour day)", async () => {
    const { StreakRepo } = await import("../streak.js");
    setPreference(handle.sqlite, "s4dst", "timezone", "America/New_York");
    const s = new StreakRepo(handle, "s4dst");
    vi.setSystemTime(Date.parse("2026-03-08T04:30:00.000Z")); // Mar 7, 23:30 EST
    expect(s.touch().streak.current).toBe(1);
    vi.setSystemTime(Date.parse("2026-03-08T05:30:00.000Z")); // Mar 8, 00:30 EST (jump at 02:00)
    const next = s.touch();
    expect(next.advanced).toBe(true);
    expect(next.streak.current).toBe(2);
    expect(lastActive("s4dst")).toBe("2026-03-08");
  });

  it("the repeated fall-back hour is ONE local day — no double advance", async () => {
    const { StreakRepo } = await import("../streak.js");
    setPreference(handle.sqlite, "s4fb", "timezone", "America/New_York");
    const s = new StreakRepo(handle, "s4fb");
    vi.setSystemTime(Date.parse("2026-11-01T03:30:00.000Z")); // Oct 31, 23:30 EDT
    expect(s.touch().streak.current).toBe(1);
    vi.setSystemTime(Date.parse("2026-11-01T05:30:00.000Z")); // Nov 1, 01:30 EDT (first 1:30)
    expect(s.touch().streak.current).toBe(2);
    vi.setSystemTime(Date.parse("2026-11-01T06:30:00.000Z")); // Nov 1, 01:30 EST (repeated hour)
    const again = s.touch();
    expect(again.advanced).toBe(false); // same local day — already counted
    expect(again.streak.current).toBe(2);
  });

  it("seam: a stored UTC-basis date is interpreted as-is — a stored local-yesterday keeps the streak alive", async () => {
    const { StreakRepo } = await import("../streak.js");
    setPreference(handle.sqlite, "s4seam", "timezone", "America/New_York");
    const s = new StreakRepo(handle, "s4seam");
    s.touch(); // create the meta row
    vi.setSystemTime(Date.parse("2026-10-20T16:00:00.000Z")); // Oct 20, 12:00 EDT
    // A pre-changeover row: stored day strings are NOT rewritten; "2026-10-19"
    // reads as local yesterday and the streak continues across the seam.
    handle.sqlite
      .prepare(`UPDATE space_meta SET streak = 3, streak_best = 3, last_active_date = '2026-10-19' WHERE space_id = ?`)
      .run("s4seam");
    expect(s.get().current).toBe(3); // alive, not lapsed
    expect(s.touch().streak.current).toBe(4); // consecutive — no seam penalty
  });
});

describe("item 4 — daily_logs are keyed by the SPACE's local day (gap #9)", () => {
  let handle: DbHandle;
  let ctx: AppContext;

  beforeEach(() => {
    handle = createDb(":memory:");
    ctx = {
      handle,
      embeddings: new HashEmbeddingProvider(EMBED_DIM),
      llm: new HeuristicProvider(),
      usage: new UsageTracker(handle),
    };
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    handle.sqlite.close();
  });

  it("the daily-log job writes the row under the local day, not the UTC day", async () => {
    const { selectJob, executeJob } = await import("../maintenance/agent.js");
    const { ingest } = await import("../ingestion/pipeline.js");
    setPreference(handle.sqlite, "s4log", "timezone", "America/New_York");
    vi.setSystemTime(Date.parse("2026-10-21T03:30:00.000Z")); // Oct 20, 23:30 EDT
    await ingest(handle, { embeddings: ctx.embeddings, llm: ctx.llm }, "an evening thought about tides", "s4log");
    const job = await selectJob(ctx, "s4log");
    expect(job?.type).toBe("daily_log");
    await executeJob(ctx, "s4log", job!);
    const row = handle.sqlite.prepare(`SELECT date FROM daily_logs WHERE space_id = 's4log'`).get() as { date: string };
    expect(row.date).toBe("2026-10-20"); // local day — UTC would have said 2026-10-21
  });

  it("membership derives from created_at in the space tz — a pre-changeover UTC-keyed row does not suppress the new local day", async () => {
    const { selectJob, setResearchEnabled } = await import("../maintenance/agent.js");
    const { ingest } = await import("../ingestion/pipeline.js");
    setPreference(handle.sqlite, "s4seam", "timezone", "America/New_York");
    setResearchEnabled(ctx, "s4seam", true);
    for (let i = 0; i < 6; i++) {
      await ingest(handle, { embeddings: ctx.embeddings, llm: ctx.llm }, `seam memory number ${i} about harbors`, "s4seam");
    }
    // A row a PRE-changeover writer stored: date keyed by UTC day, created
    // Oct 20 23:30 EDT (= 2026-10-21 03:30 UTC, column-default format).
    handle.sqlite
      .prepare(`INSERT INTO daily_logs (space_id, content, date, created_at) VALUES ('s4seam', 'old log', '2026-10-21', '2026-10-21 03:30:00')`)
      .run();
    // Later that same LOCAL evening: the row belongs to local Oct 20 = today,
    // so no new log is due yet.
    vi.setSystemTime(Date.parse("2026-10-21T03:45:00.000Z")); // Oct 20, 23:45 EDT
    const evening = await selectJob(ctx, "s4seam");
    expect(evening?.type).not.toBe("daily_log");
    // After local midnight: Oct 21 has no log yet — one is due, even though
    // the stored UTC-keyed date string says "2026-10-21" (the old read would
    // have suppressed it until the next UTC midnight).
    vi.setSystemTime(Date.parse("2026-10-21T04:30:00.000Z")); // Oct 21, 00:30 EDT
    const morning = await selectJob(ctx, "s4seam");
    expect(morning?.type).toBe("daily_log");
  });
});

describe("item 7 — episode occurred_at is normalized at the write boundary (gap #2)", () => {
  let handle: DbHandle;
  beforeEach(() => {
    handle = createDb(":memory:");
  });
  afterEach(() => handle.sqlite.close());

  const storedOccurredAt = (id: number) =>
    (handle.sqlite.prepare(`SELECT occurred_at FROM episodes WHERE id = ?`).get(id) as { occurred_at: string }).occurred_at;

  it("a naive space-format occurred_at is stored as canonical ISO-Z", async () => {
    const { captureEpisode } = await import("../agent/episodic.js");
    const res = captureEpisode(handle, "s7", {
      kind: "conversation",
      userExcerpt: "hi",
      topicLabels: [],
      occurredAt: "2026-10-20 04:30:00",
    });
    expect(res).not.toBeNull();
    expect(storedOccurredAt(res!.episodeId)).toBe("2026-10-20T04:30:00.000Z");
  });

  it("an offset ISO occurred_at is canonicalized to Z; ISO-Z round-trips unchanged", async () => {
    const { captureEpisode } = await import("../agent/episodic.js");
    const a = captureEpisode(handle, "s7", {
      kind: "conversation",
      userExcerpt: "hi",
      topicLabels: [],
      occurredAt: "2026-10-20T06:30:00+02:00",
    });
    expect(storedOccurredAt(a!.episodeId)).toBe("2026-10-20T04:30:00.000Z"); // same instant
    const b = captureEpisode(handle, "s7", {
      kind: "conversation",
      userExcerpt: "hi again",
      topicLabels: [],
      occurredAt: "2026-10-20T04:30:00.000Z",
    });
    expect(storedOccurredAt(b!.episodeId)).toBe("2026-10-20T04:30:00.000Z");
  });

  it("unparseable input keeps the previous behavior — stored verbatim, never invented", async () => {
    const { captureEpisode } = await import("../agent/episodic.js");
    const res = captureEpisode(handle, "s7", {
      kind: "conversation",
      userExcerpt: "hi",
      topicLabels: [],
      occurredAt: "not-a-date",
    });
    expect(res).not.toBeNull();
    expect(storedOccurredAt(res!.episodeId)).toBe("not-a-date");
  });
});
