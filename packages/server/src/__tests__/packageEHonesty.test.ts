import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import type { LlmProvider, LlmToolCallInput, LlmToolResult } from "../llm/adapter.js";
import { agentLoop, maybeConfirmPending, resolveAgentTimezone } from "../agent/loop.js";
import { composeSystem, formatNowUnavailableLine, relativeTime, buildAnswerPrompt } from "../llm/prompts.js";
import { setPreference } from "../agent/notify/policy.js";
import { requestApproval } from "../agent/approvals.js";
import { taskCreatorTool } from "../agent/tools/taskCreator.js";
import type { ToolContext } from "../agent/tools/types.js";

/**
 * Package E — agent-loop honesty (Screenshot Fixes, from the owner's
 * ChatGPT audit of the merged deploy branch):
 *  E1 — raw internal error text never reaches the user on any surface.
 *  E2 — agent time grounding never silently falls back to UTC.
 *  E3 — relativeTime() memory tags follow the space-local calendar.
 *  E4 — orphan nudge renders the creation date in the space timezone.
 *  E5 — bill-risk Inbox mirror dedupes by the space-local day.
 */

let handle: DbHandle;
let ctx: AppContext;
const SPACE = "e-space";
const NOW = Date.parse("2026-10-21T12:00:00.000Z");

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = {
    handle,
    embeddings: new HashEmbeddingProvider(EMBED_DIM),
    llm: new HeuristicProvider(),
    usage: new UsageTracker(handle),
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  handle.sqlite.close();
});

function llmReturning(impl: (input: LlmToolCallInput) => Promise<LlmToolResult>): LlmProvider {
  const base = new HeuristicProvider();
  return { ...base, callWithTools: impl } as LlmProvider;
}

describe("E1 — LLM provider failure: clean reply, detail to server logs only", () => {
  it("the reply (and the captured episode) contain NO raw provider error text", async () => {
    const RAW = "OpenAI 400: provider exploded with internal detail ZZZ-INTERNAL-9";
    ctx.llm = llmReturning(async () => {
      throw new Error(RAW);
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await agentLoop({
      ctx,
      spaceId: SPACE,
      principal: "telegram:1",
      userMessage: "hello there",
      history: [],
      now: NOW,
      notify: async () => {},
    });
    expect(r.text).toBe("I hit a snag reaching my tools. Try again in a moment.");
    expect(r.text).not.toContain("ZZZ-INTERNAL-9");
    expect(r.text).not.toContain("OpenAI 400");
    // Detail went to the server log instead — as class/name + bounded summary.
    const logged = errSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).toContain("[agent] llm callWithTools failed (Error)");
    // The captured episode stores the CLEAN reply, not the raw error.
    await new Promise((res) => setTimeout(res, 50));
    const rows = handle.sqlite
      .prepare(`SELECT summary FROM episodes WHERE space_id = ?`)
      .all(SPACE) as { summary: string }[];
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const allSummaries = rows.map((x) => x.summary).join("\n");
    expect(allSummaries).toContain("I hit a snag reaching my tools");
    expect(allSummaries).not.toContain("ZZZ-INTERNAL-9");
  });

  it("log summary is bounded and redacts long token-like runs (keys/ids)", async () => {
    const TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEF"; // 42-char run
    ctx.llm = llmReturning(async () => {
      throw new Error(`auth failed for key ${TOKEN} upstream`);
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await agentLoop({
      ctx,
      spaceId: SPACE,
      principal: "telegram:1",
      userMessage: "hi",
      history: [],
      now: NOW,
      notify: async () => {},
    });
    const logged = errSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).not.toContain(TOKEN);
    expect(logged).toContain("[redacted]");
  });
});

describe("E1 sibling — tool execution failure: model gets a clean generic error, not the exception", () => {
  it("a throwing read tool's raw error never enters the tool-result fed back to the model", async () => {
    // Sabotage: brain_stats counts graph tables — dropping `nodes` makes its
    // run throw a raw SQLite error ("no such table: nodes").
    handle.sqlite.exec(`DROP TABLE nodes`);
    const seenToolResults: string[] = [];
    let call = 0;
    ctx.llm = llmReturning(async (input) => {
      call++;
      for (const m of input.messages) {
        if (m.role === "tool" && typeof m.result === "string") seenToolResults.push(m.result);
      }
      if (call === 1) {
        return { text: null, calls: [{ id: "c1", name: "brain_stats", args: {} }] };
      }
      return { text: "done", calls: [] };
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await agentLoop({
      ctx,
      spaceId: SPACE,
      principal: "telegram:1",
      userMessage: "how much is in my brain?",
      history: [],
      now: NOW,
      notify: async () => {},
    });
    expect(r.text).toBe("done");
    expect(seenToolResults.length).toBeGreaterThanOrEqual(1);
    const fed = seenToolResults.join("\n");
    expect(fed).toContain("hit a snag");
    expect(fed).not.toContain("no such table");
    expect(fed).not.toContain("SQLITE");
  });
});

describe("E1 sibling — approval execution failure: raw tool exception never reaches the user", () => {
  it("maybeConfirmPending returns clean generic copy when the approved tool throws", async () => {
    const nodeId = Number(
      handle.sqlite
        .prepare(`INSERT INTO nodes (space_id, label, type, content) VALUES (?, 'dentist', 'memory', 'x')`)
        .run(SPACE).lastInsertRowid,
    );
    const tc: ToolContext = { ctx, spaceId: SPACE, now: NOW, notify: async () => {} };
    const req = requestApproval(tc, taskCreatorTool, { nodeId, label: "call dentist" }, "telegram:9");
    expect(req.ok).toBe(true);
    // Sabotage AFTER the approval exists: executing create_task inserts a
    // node — with the table gone its run throws a raw SQLite error, which
    // executeApproval embeds in its error ("tool threw: no such table: …").
    handle.sqlite.exec(`DROP TABLE nodes`);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await maybeConfirmPending(ctx, SPACE, "telegram:9", "yes", tc);
    expect(out).toBe("I tried, but it didn't go through. Try again in a moment.");
    expect(out).not.toContain("no such table");
    expect(out).not.toContain("tool threw");
  });
});

// ---------------------------------------------------------------------------
// E2 — time grounding never falls back to UTC
// ---------------------------------------------------------------------------

// 20:15 UTC on Oct 20 = 10:15 on Oct 21 in Kiritimati (UTC+14) — a full
// local calendar day ahead of UTC, the sharpest possible grounding check.
const E2_NOW = Date.parse("2026-10-20T20:15:00.000Z");

function capturingContext(): { capturedSys: () => string | undefined } {
  let sys: string | undefined;
  ctx.llm = llmReturning(async (input) => {
    sys = input.systemInstruction;
    return { text: "ok", calls: [] };
  });
  return { capturedSys: () => sys };
}

/** A sqlite facade whose FULL preferences read throws (any statement that
 *  selects the preferences columns), while every other statement — incl.
 *  the single-column space_meta.timezone read — works against the real DB.
 *  This is the failure injection for the preferences read specifically. */
function prefsFailingCtx(): AppContext {
  const real = handle.sqlite;
  const wrapped = new Proxy(real, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql: string) => {
          if (sql.includes("daily_proactive_cap")) throw new Error("injected preferences failure");
          return target.prepare(sql);
        };
      }
      const v = Reflect.get(target, prop) as unknown;
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
  return { ...ctx, handle: { ...handle, sqlite: wrapped } };
}

describe("E2 — preferences failure still grounds in the STORED local timezone", () => {
  it("resolveAgentTimezone falls through to the stored space_meta.timezone", () => {
    setPreference(handle.sqlite, SPACE, "timezone", "Pacific/Kiritimati");
    const failing = prefsFailingCtx();
    expect(resolveAgentTimezone(failing.handle.sqlite, SPACE)).toBe("Pacific/Kiritimati");
  });

  it("the loop's system instruction renders the stored local day, not UTC", async () => {
    setPreference(handle.sqlite, SPACE, "timezone", "Pacific/Kiritimati");
    const { capturedSys } = capturingContext();
    const failing = prefsFailingCtx();
    const r = await agentLoop({
      ctx: failing,
      spaceId: SPACE,
      principal: "telegram:1",
      userMessage: "what day is it for me?",
      history: [],
      now: E2_NOW,
      notify: async () => {},
    });
    expect(r.text).toBe("ok");
    const sys = capturedSys()!;
    expect(sys).toContain("(Pacific/Kiritimati)");
    expect(sys).toContain("October 21, 2026"); // the LOCAL date
    expect(sys).not.toContain("time are unavailable");
  });
});

describe("E2 — no valid timezone resolvable: unavailable grounding, never UTC", () => {
  it("composeSystem with timezone:null renders the unavailable line and no UTC form", () => {
    const sys = composeSystem({ nowMs: E2_NOW, timezone: null });
    expect(sys).toContain(formatNowUnavailableLine());
    expect(sys).toContain("current local date and time are unavailable");
    expect(sys).not.toContain("in UTC it is");
    expect(sys).not.toContain("2026-10-20T20:15:00.000Z");
    // The historical callers are untouched: omitting the zone keeps the
    // legacy rendering, and a real zone keeps the local rendering.
    expect(composeSystem({ nowMs: E2_NOW })).toContain("October 20, 2026");
    expect(composeSystem({ nowMs: E2_NOW, timezone: "Pacific/Kiritimati" })).toContain("October 21, 2026");
  });

  it("a stored timezone that is not a valid zone resolves to null (no UTC landing)", () => {
    handle.sqlite
      .prepare(`INSERT INTO space_meta (space_id, timezone) VALUES (?, 'Not/AZone')`)
      .run(SPACE);
    expect(resolveAgentTimezone(handle.sqlite, SPACE)).toBeNull();
  });

  it("the loop renders the unavailable line when the stored zone is unusable", async () => {
    handle.sqlite
      .prepare(`INSERT INTO space_meta (space_id, timezone) VALUES (?, 'Not/AZone')`)
      .run(SPACE);
    const { capturedSys } = capturingContext();
    await agentLoop({
      ctx,
      spaceId: SPACE,
      principal: "telegram:1",
      userMessage: "what day is it?",
      history: [],
      now: E2_NOW,
      notify: async () => {},
    });
    const sys = capturedSys()!;
    expect(sys).toContain("current local date and time are unavailable");
    expect(sys).not.toContain("in UTC it is");
    expect(sys).not.toContain("2026-10-20T20:15:00.000Z");
  });

  it("when BOTH storage reads hard-fail, resolution is null — not an assumed default zone", () => {
    const dead = {
      prepare: () => {
        throw new Error("storage gone");
      },
    } as unknown as AppContext["handle"]["sqlite"];
    expect(resolveAgentTimezone(dead, SPACE)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// E3 — relativeTime() tags follow the SPACE-LOCAL calendar, not elapsed hours
// ---------------------------------------------------------------------------

describe("E3 — relativeTime calendar-day tags (America/New_York)", () => {
  const NY = "America/New_York";
  // Read at Oct 22, 07:00 EDT (= 11:00Z).
  const READ = Date.parse("2026-10-22T11:00:00.000Z");

  it("boundary: logged 23:00 local, read 07:00 next local day → 'yesterday' (8 elapsed hours)", () => {
    const logged = "2026-10-22T03:00:00.000Z"; // Oct 21, 23:00 EDT
    expect(relativeTime(logged, NY, READ)).toBe("yesterday");
  });

  it("same-local-day morning/evening pair → 'today'", () => {
    const morning = "2026-10-22T05:00:00.000Z"; // Oct 22, 01:00 EDT
    expect(relativeTime(morning, NY, READ)).toBe("today");
    // And an evening-before-midnight read of a morning memory is still 'today'.
    const readLate = Date.parse("2026-10-23T03:30:00.000Z"); // Oct 22, 23:30 EDT
    expect(relativeTime("2026-10-22T13:00:00.000Z", NY, readLate)).toBe("today"); // Oct 22, 09:00 EDT
  });

  it("calendar buckets for larger gaps keep the previous shape", () => {
    expect(relativeTime("2026-10-19T15:00:00.000Z", NY, READ)).toBe("3 days ago"); // Oct 19 local
    expect(relativeTime("2026-10-08T15:00:00.000Z", NY, READ)).toBe("2 weeks ago"); // 14 calendar days
  });

  it("no timezone → tag omitted (never computed against an assumed zone)", () => {
    expect(relativeTime("2026-10-22T03:00:00.000Z", undefined, READ)).toBeUndefined();
    expect(relativeTime("2026-10-22T03:00:00.000Z", "Not/AZone", READ)).toBeUndefined();
  });

  it("future / clock-skew keeps the say-nothing behavior", () => {
    expect(relativeTime("2026-10-23T15:00:00.000Z", NY, READ)).toBeUndefined();
  });

  it("buildAnswerPrompt stamps the tag from the threaded timezone — and omits it without one", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(READ);
      const node = { id: 7, label: "late thought", type: "daily", content: "x", occurredAt: "2026-10-22T03:00:00.000Z" };
      const withZone = buildAnswerPrompt("q", [node], undefined, undefined, undefined, undefined, undefined, NY);
      expect(withZone).toContain("(daily, yesterday)");
      const noZone = buildAnswerPrompt("q", [node]);
      expect(noZone).toContain("(daily)");
      expect(noZone).not.toContain("yesterday");
      expect(noZone).not.toContain("today");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// E4 — orphan nudge renders the creation date in the SPACE timezone
// ---------------------------------------------------------------------------

describe("E4 — surface_orphan conversational message uses the local creation date", () => {
  it("an instant that is Oct 21 20:00 in America/New_York (= Oct 22 UTC) renders 'created 2026-10-21'", async () => {
    const { orphanTool } = await import("../agent/tools/orphan.js");
    setPreference(handle.sqlite, SPACE, "timezone", "America/New_York");
    handle.sqlite
      .prepare(
        `INSERT INTO nodes (space_id, label, type, content, kind, importance, created_at)
         VALUES (?, 'evening thought', 'daily', 'x', 'memory', 0.9, '2026-10-22T00:00:00.000Z')`,
      )
      .run(SPACE);
    const tcOrphan: ToolContext = {
      ctx,
      spaceId: SPACE,
      now: Date.parse("2026-10-25T16:00:00.000Z"), // 3+ days later — past the orphan grace period
      notify: async () => {},
    };
    const res = await orphanTool.run(tcOrphan, {});
    expect(res.ok).toBe(true);
    expect(res.message).toContain("created 2026-10-21");
    expect(res.message).not.toContain("created 2026-10-22");
  });
});

// ---------------------------------------------------------------------------
// E5 — bill-risk Inbox mirror dedupes by the SPACE-LOCAL day (like the guard)
// ---------------------------------------------------------------------------

describe("E5 — bill-risk Inbox mirror dedupe key is the space-local day", () => {
  it("two local days sharing one UTC date produce TWO Inbox records; same local day dedupes to one", async () => {
    const { billRiskTool } = await import("../agent/tools/billRisk.js");
    const { FinBillRepo } = await import("../repositories/finBill.repo.js");
    const { NotificationsRepo } = await import("../repositories/notifications.repo.js");
    setPreference(handle.sqlite, SPACE, "timezone", "America/New_York");
    const bill = new FinBillRepo(handle, SPACE).create({
      name: "Rent",
      amountCents: 25000,
      frequency: "monthly",
      anchorDate: "2026-11-18",
    });
    const runAt = async (nowMs: number) => {
      const tcBill: ToolContext = { ctx, spaceId: SPACE, now: nowMs, notify: async () => {} };
      const res = await billRiskTool.run(tcBill, { billId: bill.id, mode: "short", threshold: 5000 });
      expect(res.ok).toBe(true);
      expect(res.delivered).toBe(true);
    };
    // Oct 21 21:00 EDT and Oct 22 01:00 EDT — DIFFERENT local days, both
    // UTC Oct 22. Pre-fix both keyed to 2026-10-22 (UTC) → ONE record.
    await runAt(Date.parse("2026-10-22T01:00:00.000Z"));
    await runAt(Date.parse("2026-10-22T05:00:00.000Z"));
    const repo = new NotificationsRepo(handle, SPACE);
    let records = repo.list().filter((n) => n.source === "bill-risk");
    expect(records).toHaveLength(2);
    const keys = records.map((n) => n.dedupeKey).sort();
    expect(keys).toEqual([`bill-risk:${bill.id}:2026-10-21`, `bill-risk:${bill.id}:2026-10-22`]);
    // Same local day as the second run (Oct 22 09:00 EDT) — still deduped.
    await runAt(Date.parse("2026-10-22T13:00:00.000Z"));
    records = repo.list().filter((n) => n.source === "bill-risk");
    expect(records).toHaveLength(2);
  });
});
