import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../../db/client.js";
import { HashEmbeddingProvider } from "../../embeddings/hash.js";
import { HeuristicProvider } from "../../llm/heuristic.js";
import { EMBED_DIM } from "../../db/vec.js";
import type { AppContext } from "../../context.js";
import { UsageTracker } from "../../usage.js";
import type { LlmProvider, LlmToolCallInput, LlmToolResult } from "../../llm/adapter.js";
import type { ToolContext } from "../tools/types.js";
import { AGENT_TOOLS } from "../tools/registry.js";
import { validateArgs } from "../tools/validation.js";
import { runToolRouter } from "../tools/router.js";
import { billRiskTool } from "../tools/billRisk.js";
import { goalFundingTrendTool } from "../tools/goalFundingTrend.js";
import { financeFreshnessTool } from "../tools/financeFreshness.js";
import { weeklyReviewTool } from "../tools/weeklyReview.js";
import { orphanTool } from "../tools/orphan.js";
import { chartDiscoveryTool } from "../tools/chartDiscovery.js";
import { reviewNudgeTool } from "../tools/reviewNudge.js";
import { agendaListTool } from "../tools/agendaList.js";
import { journeysListTool } from "../tools/journeysList.js";
import { insightsListTool } from "../tools/insightsList.js";
import { FinAccountRepo } from "../../repositories/finAccount.repo.js";
import { FinBillRepo } from "../../repositories/finBill.repo.js";
import { FinIncomeRepo } from "../../repositories/finIncome.repo.js";
import { FinBucketRepo } from "../../repositories/finBucket.repo.js";
import { FinGoalRepo } from "../../repositories/finGoal.repo.js";
import { JourneysRepo } from "../../repositories/journeys.repo.js";
import { InsightsRepo } from "../../repositories/insights.repo.js";
import { CodexDiscoveriesRepo } from "../../repositories/codexDiscoveries.repo.js";
import { handleTelegramUpdate, clearTelegramHistory, type TelegramUpdate } from "../../telegram/bot.js";
import { TelegramLinksRepo } from "../../telegram/links.js";
import { chunkTelegramText, TELEGRAM_MESSAGE_LIMIT } from "../../telegram/chunking.js";

/**
 * Telegram Parity Phase 4 — tab parity (findings §7 Phase 4).
 *
 * The seven analysis tools existed only behind the deterministic router —
 * the conversational model could never call them — and Agenda / Journeys /
 * Insights had no list tool at all. These tests pin the promotion: every
 * promoted/new tool returns grounded data from a seeded brain when called
 * the way the LOOP calls it (no detector-shaped args), the router path is
 * unchanged, and a Telegram turn per tab reaches a grounded tool answer.
 */

let handle: DbHandle;
let ctx: AppContext;
const SPACE = "p4-space";
const NOW = Date.parse("2026-10-15T16:00:00.000Z"); // noon in America/New_York
const DAY_MS = 86_400_000;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = { handle, embeddings, llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
});
afterEach(() => handle.sqlite.close());

const tc = (now = NOW, spaceId = SPACE): ToolContext => ({ ctx, spaceId, now, notify: async () => {} });

function insertNode(o: {
  label: string;
  type?: string;
  content?: string;
  kind?: string | null;
  importance?: number;
  createdAt?: string;
  remindAt?: string;
  spaceId?: string;
}): number {
  const r = handle.sqlite
    .prepare(
      `INSERT INTO nodes (space_id, label, type, content, kind, importance, created_at, remind_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      o.spaceId ?? SPACE,
      o.label,
      o.type ?? "daily",
      o.content ?? `content of ${o.label}`,
      o.kind ?? null,
      o.importance ?? 0.5,
      o.createdAt ?? "2026-10-01T00:00:00.000Z",
      o.remindAt ?? null,
    );
  return Number(r.lastInsertRowid);
}

// ---------------------------------------------------------------------------
// Promoted tools — conversational (no-arg) path returns grounded data
// ---------------------------------------------------------------------------

describe("bill_risk (conversational)", () => {
  // Midday UTC: since PR #84 the budget runs on the SPACE-local day, and
  // midnight UTC is still Jan 9 in America/New_York — noon keeps the
  // fixture on Jan 10 in both calendars, as the scenario intends.
  const JAN = Date.parse("2026-01-10T12:00:00Z");
  it("reports the exact reserved bills + shortfall, without notifying", async () => {
    new FinAccountRepo(handle, SPACE).setBalance(10000);
    const inc = new FinIncomeRepo(handle, SPACE);
    inc.create({ date: "2026-01-01", netCents: 1000 });
    inc.create({ date: "2026-01-10", netCents: 1000 });
    new FinBillRepo(handle, SPACE).create({ name: "Rent", amountCents: 25000, frequency: "monthly", anchorDate: "2026-01-18" });

    let notified = 0;
    const res = await billRiskTool.run({ ctx, spaceId: SPACE, now: JAN, notify: async () => void notified++ }, {});
    expect(res.ok).toBe(true);
    expect(res.message).toContain("BILL RISK CHECK");
    expect(res.message).toContain('"Rent"');
    expect(res.message).toContain("shortfall: $150");
    expect(res.message).toMatch(/SHORT/);
    expect(notified).toBe(0); // conversational answers return to the model, not a side ping
  });

  it("says so honestly when nothing is reserved", async () => {
    const res = await billRiskTool.run(tc(JAN), {});
    expect(res.ok).toBe(true);
    expect(res.message).toContain("no bills are reserved");
  });

  it("router-shaped call still validates and detect() is unchanged", () => {
    expect(validateArgs(billRiskTool, { billId: 3, mode: "pace", threshold: 100 }).ok).toBe(true);
    expect(validateArgs(billRiskTool, {}).ok).toBe(true);
    expect(billRiskTool.detect(tc(JAN))).toHaveLength(0);
  });
});

describe("goal_trend (conversational)", () => {
  const JUN = Date.parse("2026-06-01T00:00:00Z");
  it("assesses every goal fresh from the allocation ledger", async () => {
    const bucket = new FinBucketRepo(handle, SPACE).create({ name: "Bucket" });
    const goal = new FinGoalRepo(handle, SPACE).create({ bucketId: bucket.id, name: "Emergency Fund" });
    const alloc = (amountCents: number, daysAgo: number) =>
      handle.sqlite
        .prepare(`INSERT INTO fin_allocation (space_id, goal_id, amount_cents, created_at) VALUES (?, ?, ?, ?)`)
        .run(SPACE, goal.id, amountCents, new Date(JUN - daysAgo * DAY_MS).toISOString().replace("T", " ").slice(0, 19));
    alloc(30000, 75);
    alloc(20000, 45);
    alloc(5000, 15);

    const res = await goalFundingTrendTool.run(tc(JUN), {});
    expect(res.ok).toBe(true);
    expect(res.message).toContain("GOAL TRENDS");
    expect(res.message).toContain('"Emergency Fund": decreased');
    expect(res.message).toContain("$50");
    expect(res.message).toContain("$200");
  });

  it("reports insufficient history honestly instead of fabricating a trend", async () => {
    const bucket = new FinBucketRepo(handle, SPACE).create({ name: "Bucket" });
    new FinGoalRepo(handle, SPACE).create({ bucketId: bucket.id, name: "New Goal" });
    const res = await goalFundingTrendTool.run(tc(JUN), {});
    expect(res.message).toContain("not enough history");
  });
});

describe("finance_freshness (conversational)", () => {
  it("reports exact staleness for income, from the same thresholds detect() uses", async () => {
    new FinIncomeRepo(handle, SPACE).create({ date: "2026-09-01", netCents: 1000 }); // 44 days before NOW
    const res = await financeFreshnessTool.run(tc(), {});
    expect(res.ok).toBe(true);
    expect(res.message).toContain("Income: last logged 2026-09-01 (44 day(s) ago) — STALE");
    expect(res.message).toContain("no accounts/assets are tracked");
  });
});

describe("weekly_review (conversational)", () => {
  it("composes the week's reflection from seeded memories", async () => {
    for (let i = 0; i < 4; i++) {
      insertNode({ label: `moment ${i}`, kind: "memory", createdAt: new Date(NOW - (i + 1) * DAY_MS).toISOString() });
    }
    const res = await weeklyReviewTool.run(tc(), {});
    expect(res.ok).toBe(true);
    expect(res.message).toContain("Looking back on your week");
    expect(res.message).toContain("4 moments");
  });

  it("stays honest on a near-empty week", async () => {
    const res = await weeklyReviewTool.run(tc(), {});
    expect(res.ok).toBe(false);
    expect(res.summary).toContain("nothing to review");
  });
});

describe("surface_orphan (conversational)", () => {
  it("names the top long-drifting orphan and the exact unlinked total", async () => {
    insertNode({
      label: "forgotten idea",
      kind: "memory",
      importance: 0.9,
      createdAt: new Date(NOW - 10 * DAY_MS).toISOString(),
    });
    const res = await orphanTool.run(tc(), {});
    expect(res.ok).toBe(true);
    expect(res.message).toContain("ORPHAN CHECK");
    expect(res.message).toContain('"forgotten idea"');
    expect(res.message).toContain("1 live memory is unconnected");
    expect(res.message).toContain("drifting for 10 day(s)");
  });

  it("reports zero orphans when everything is linked", async () => {
    const a = insertNode({ label: "a", kind: "memory", createdAt: new Date(NOW - 10 * DAY_MS).toISOString() });
    const b = insertNode({ label: "b", kind: "memory", createdAt: new Date(NOW - 10 * DAY_MS).toISOString() });
    handle.sqlite.prepare(`INSERT INTO edges (space_id, source, target, relationship, weight) VALUES (?, ?, ?, 'relates_to', 1)`).run(SPACE, a, b);
    const res = await orphanTool.run(tc(), {});
    expect(res.message).toContain("no orphaned (unconnected) memories");
  });
});

describe("chart_discovery (conversational)", () => {
  it("lists recorded Codex entries and writes NOTHING", async () => {
    new CodexDiscoveriesRepo(handle, SPACE).add({
      key: "sector:daily:25",
      title: "A Sector Comes of Age",
      lore: "Your daily region crossed 25 bodies.",
      icon: "🗺️",
      focusId: null,
    });
    const res = await chartDiscoveryTool.run(tc(), {});
    expect(res.ok).toBe(true);
    expect(res.message).toContain("CODEX DISCOVERIES");
    expect(res.message).toContain("A Sector Comes of Age");
    expect(res.message).toContain("1 field note(s) recorded");
    // Read-only: the conversational call recorded no new entry.
    expect(new CodexDiscoveriesRepo(handle, SPACE).list()).toHaveLength(1);
  });
});

describe("review_nudge (conversational)", () => {
  it("lists what is due for recall, without snoozing it", async () => {
    const id = insertNode({
      label: "Spanish vocabulary",
      kind: "memory",
      createdAt: new Date(NOW - 10 * DAY_MS).toISOString(),
    });
    const res = await reviewNudgeTool.run(tc(), {});
    expect(res.ok).toBe(true);
    expect(res.message).toContain("REVIEW CHECK");
    expect(res.message).toContain('"Spanish vocabulary"');
    // Read-only: no snooze was written (next_review_at still null).
    const row = handle.sqlite.prepare(`SELECT next_review_at AS n FROM nodes WHERE id = ?`).get(id) as { n: string | null };
    expect(row.n).toBeNull();
  });

  it("says nothing is due when the schedule is empty", async () => {
    const res = await reviewNudgeTool.run(tc(), {});
    expect(res.message).toContain("nothing is due for recall");
  });
});

// ---------------------------------------------------------------------------
// New list tools
// ---------------------------------------------------------------------------

describe("agenda_list", () => {
  it("returns actions + due/upcoming reminders with exact totals and space-tz 'due today'", async () => {
    insertNode({ label: "Call the landlord", kind: "action", importance: 0.9 });
    insertNode({ label: "Buy stamps", kind: "action", importance: 0.3 });
    insertNode({ label: "Dentist appointment", kind: "memory", remindAt: "2026-10-15T10:00:00.000Z" }); // 06:00 EDT — due today
    insertNode({ label: "Renew license", kind: "memory", remindAt: "2026-10-20T15:00:00.000Z" });

    const res = await agendaListTool.run(tc(), {});
    expect(res.ok).toBe(true);
    expect(res.message).toContain("Active action items: 2");
    expect(res.message).toContain('"Call the landlord"');
    expect(res.message).toContain("Reminders due (at or before now): 1");
    expect(res.message).toContain("due today (2026-10-15, space timezone America/New_York): 1");
    expect(res.message).toContain("Reminders upcoming: 1");
    expect(res.message).toContain('"Renew license"');
  });

  it("paginates with an honest truncation note", async () => {
    for (let i = 0; i < 25; i++) insertNode({ label: `Task ${i}`, kind: "action" });
    const res = await agendaListTool.run(tc(), {});
    expect(res.message).toContain("Active action items: 25");
    expect(res.message).toContain("showing 20 of 25");
    expect(res.message).toContain("offset 20");
    const page2 = await agendaListTool.run(tc(), { offset: 20 });
    expect(page2.message).toContain("showing 5 of 25");
  });

  it("is space-isolated", async () => {
    insertNode({ label: "Other space task", kind: "action", spaceId: "other-space" });
    const res = await agendaListTool.run(tc(), {});
    expect(res.message).toContain("Active action items: 0");
    expect(res.message).not.toContain("Other space task");
  });
});

describe("journeys_list", () => {
  it("lists journeys with status counts, progress, and link counts", async () => {
    const repo = new JourneysRepo(handle, SPACE);
    const j1 = repo.create({ title: "Become a Nurse", description: "LPN to NP", status: "active" });
    repo.create({ title: "Old Chapter", status: "done" });
    repo.create({ title: "Second Active", status: "active" });
    const nodeId = insertNode({ label: "CNA application", kind: "memory" });
    repo.link(j1.id, "node", nodeId);

    const res = await journeysListTool.run(tc(), {});
    expect(res.ok).toBe(true);
    expect(res.message).toContain("3 total: 2 active, 0 paused, 1 done");
    expect(res.message).toContain('"Become a Nurse"');
    expect(res.message).toContain("1 linked item(s)");

    const doneOnly = await journeysListTool.run(tc(), { status: "done" });
    expect(doneOnly.message).toContain('"Old Chapter"');
    expect(doneOnly.message).not.toContain("Become a Nurse");
  });
});

describe("insights_list", () => {
  it("lists insights newest-first with the nodes they connect", async () => {
    const a = insertNode({ label: "Nursing goal", kind: "memory" });
    const b = insertNode({ label: "Warehouse shifts", kind: "memory" });
    const repo = new InsightsRepo(handle, SPACE);
    repo.create(a, b, "Your nursing goal connects to your warehouse shifts", 0.9, "synthesis");
    repo.create(a, b, "You say rest matters but shifts keep expanding", 0.8, "contradiction");

    const res = await insightsListTool.run(tc(), {});
    expect(res.ok).toBe(true);
    expect(res.message).toContain("INSIGHTS");
    expect(res.message).toContain("nursing goal connects");
    expect(res.message).toContain('Connects: #');
    const contra = await insightsListTool.run(tc(), { kind: "contradiction" });
    expect(contra.message).toContain("rest matters");
    expect(contra.message).not.toContain("nursing goal connects");
  });
});

// ---------------------------------------------------------------------------
// Registry: all Phase 4 tools are loop-callable READ tools with valid schemas
// ---------------------------------------------------------------------------

describe("Phase 4 registry", () => {
  const PHASE4 = [
    "bill_risk",
    "goal_trend",
    "finance_freshness",
    "weekly_review",
    "surface_orphan",
    "chart_discovery",
    "review_nudge",
    "agenda_list",
    "journeys_list",
    "insights_list",
  ];
  it("every Phase 4 tool is in AGENT_TOOLS as read-only", () => {
    for (const name of PHASE4) {
      const entry = AGENT_TOOLS.find((e) => e.tool.name === name);
      expect(entry, name).toBeDefined();
      expect(entry!.isWrite, name).toBe(false);
    }
  });
  it("every Phase 4 tool accepts the loop's no-arg call (schema validates {})", () => {
    for (const name of PHASE4) {
      const entry = AGENT_TOOLS.find((e) => e.tool.name === name)!;
      expect(validateArgs(entry.tool, {}).ok, name).toBe(true);
    }
  });
  it("list tools reject malformed args", () => {
    const agenda = AGENT_TOOLS.find((e) => e.tool.name === "agenda_list")!.tool;
    expect(validateArgs(agenda, { limit: 5, offset: 10 }).ok).toBe(true);
    expect(validateArgs(agenda, { limit: "lots" }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Router regression: the deterministic path still fires the promoted tools
// ---------------------------------------------------------------------------

describe("router regression (promoted tools still fire via detect)", () => {
  it("runToolRouter fires a due reminder + the weekly review from the same seeded brain", async () => {
    insertNode({ label: "call mom", kind: "memory", createdAt: new Date(NOW - DAY_MS).toISOString(), remindAt: new Date(NOW - 3600_000).toISOString() });
    for (let i = 0; i < 4; i++) {
      insertNode({ label: `week moment ${i}`, kind: "memory", createdAt: new Date(NOW - (i + 1) * DAY_MS).toISOString() });
    }
    const sent: string[] = [];
    const results = await runToolRouter(ctx, SPACE, { now: NOW, notify: async (_s, t) => void sent.push(t) });
    expect(results.some((r) => r.summary.includes('Reminder: "call mom"') || r.summary.includes("call mom"))).toBe(true);
    expect(results.some((r) => r.summary.includes("Looking back on your week"))).toBe(true);
    expect(sent.some((t) => t.includes("call mom"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

describe("telegram chunking", () => {
  it("passes short text through untouched", () => {
    expect(chunkTelegramText("hello")).toEqual(["hello"]);
    expect(chunkTelegramText("x".repeat(TELEGRAM_MESSAGE_LIMIT))).toHaveLength(1);
  });

  it("splits an over-limit answer into ordered chunks with no content loss", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `Line ${String(i).padStart(3, "0")}: ${"grounded content ".repeat(4)}end-${i}.`);
    const text = lines.join("\n");
    expect(text.length).toBeGreaterThan(TELEGRAM_MESSAGE_LIMIT);
    const chunks = chunkTelegramText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    // No content loss: identical modulo the boundary whitespace the
    // splitter consumes; order preserved (line numbers strictly increase).
    const squash = (s: string) => s.replace(/\s+/g, "");
    expect(squash(chunks.join("\n"))).toBe(squash(text));
    const seen = chunks.join("\n").match(/Line \d{3}/g)!.map((m) => Number(m.slice(5)));
    expect(seen).toEqual(Array.from({ length: 200 }, (_, i) => i));
  });

  it("hard-cuts a single unbroken run longer than the limit", () => {
    const chunks = chunkTelegramText("a".repeat(TELEGRAM_MESSAGE_LIMIT * 2 + 10));
    expect(chunks).toHaveLength(3);
    expect(chunks.join("")).toHaveLength(TELEGRAM_MESSAGE_LIMIT * 2 + 10);
  });
});

// ---------------------------------------------------------------------------
// Telegram handler: one question per tab → a grounded tool path answers
// ---------------------------------------------------------------------------

describe("telegram handler — one grounded tool path per tab", () => {
  let outbox: { chatId: number; text: string }[];
  const send = async (chatId: number, text: string) => {
    outbox.push({ chatId, text });
  };
  const update = (chatId: number, text: string): TelegramUpdate => ({ message: { chat: { id: chatId }, text } });

  const TAB_TOOLS: [string, string][] = [
    ["bills", "bill_risk"],
    ["goals trending", "goal_trend"],
    ["agenda", "agenda_list"],
    ["journeys", "journeys_list"],
    ["insights", "insights_list"],
    ["weekly review", "weekly_review"],
  ];

  function tabLlm(): LlmProvider {
    const base = new HeuristicProvider();
    return {
      ...base,
      callWithTools: async (input: LlmToolCallInput): Promise<LlmToolResult> => {
        const toolMsg = [...input.messages].reverse().find((m) => m.role === "tool");
        if (toolMsg && toolMsg.role === "tool") return { text: `Grounded answer: ${toolMsg.result}`, calls: [] };
        const userText = [...input.messages].reverse().find((m) => m.role === "user")?.text ?? "";
        const hit = TAB_TOOLS.find(([q]) => userText.toLowerCase().includes(q));
        if (!hit) return { text: "no tool needed", calls: [] };
        return { text: null, calls: [{ id: "c1", name: hit[1], args: {} }] };
      },
    } as LlmProvider;
  }

  async function linkAndSeed(chatId: number): Promise<string> {
    await handleTelegramUpdate(ctx, update(chatId, "/link soumaya hunter222"), send);
    const spaceId = new TelegramLinksRepo(handle).get(chatId)!.spaceId;
    const nowMs = Date.now();
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

    // Money/bills: Rent reserved before next income, balance short.
    new FinAccountRepo(handle, spaceId).setBalance(10000);
    const inc = new FinIncomeRepo(handle, spaceId);
    inc.create({ date: day(nowMs - 9 * DAY_MS), netCents: 1000 });
    inc.create({ date: day(nowMs), netCents: 1000 });
    new FinBillRepo(handle, spaceId).create({ name: "Rent", amountCents: 25000, frequency: "monthly", anchorDate: day(nowMs + 8 * DAY_MS) });

    // Goals: Emergency Fund with a decreasing allocation trend.
    const bucket = new FinBucketRepo(handle, spaceId).create({ name: "Bucket" });
    const goal = new FinGoalRepo(handle, spaceId).create({ bucketId: bucket.id, name: "Emergency Fund" });
    for (const [amount, daysAgo] of [[30000, 75], [20000, 45], [5000, 15]] as const) {
      handle.sqlite
        .prepare(`INSERT INTO fin_allocation (space_id, goal_id, amount_cents, created_at) VALUES (?, ?, ?, ?)`)
        .run(spaceId, goal.id, amount, new Date(nowMs - daysAgo * DAY_MS).toISOString().replace("T", " ").slice(0, 19));
    }

    // Agenda + weekly review + insights share seeded nodes.
    const ins = (label: string, kind: string | null, createdMs: number, remindAt?: string) =>
      Number(
        handle.sqlite
          .prepare(`INSERT INTO nodes (space_id, label, type, content, kind, importance, created_at, remind_at) VALUES (?, ?, 'daily', ?, ?, 0.5, ?, ?)`)
          .run(spaceId, label, `content of ${label}`, kind, new Date(createdMs).toISOString(), remindAt ?? null).lastInsertRowid,
      );
    ins("Call the landlord about the lease", "action", nowMs - DAY_MS);
    ins("Dentist reminder", "memory", nowMs - DAY_MS, new Date(nowMs - 3600_000).toISOString());
    const nA = ins("Nursing goal memory", "memory", nowMs - DAY_MS);
    const nB = ins("Warehouse shift memory", "memory", nowMs - 2 * DAY_MS);
    ins("Weekly moment two", "memory", nowMs - 3 * DAY_MS);
    ins("Weekly moment three", "memory", nowMs - 4 * DAY_MS);
    new InsightsRepo(handle, spaceId).create(nA, nB, "Your nursing goal connects to your warehouse shifts", 0.9, "synthesis");

    // Journeys.
    new JourneysRepo(handle, spaceId).create({ title: "Become a Nurse", status: "active" });
    return spaceId;
  }

  beforeEach(() => {
    outbox = [];
    clearTelegramHistory();
  });

  it("answers one question per tab through its grounded tool", async () => {
    await linkAndSeed(7);
    ctx.llm = tabLlm();
    outbox = [];

    const cases: [string, string][] = [
      ["how are my bills looking?", "Rent"],
      ["how are my goals trending?", "Emergency Fund"],
      ["what's on my agenda?", "Call the landlord about the lease"],
      ["what journeys do I have?", "Become a Nurse"],
      ["what insights do you have for me?", "nursing goal connects"],
      ["give me my weekly review", "Looking back on your week"],
    ];
    for (const [question, marker] of cases) {
      await handleTelegramUpdate(ctx, update(7, question), send);
      const reply = outbox.at(-1)!.text;
      expect(reply, question).toContain("Grounded answer:");
      expect(reply, question).toContain(marker);
    }
  });

  it("chunks a long agenda answer into ordered sends under the Telegram limit", async () => {
    await linkAndSeed(9);
    const spaceId = new TelegramLinksRepo(handle).get(9)!.spaceId;
    for (let i = 0; i < 20; i++) {
      handle.sqlite
        .prepare(`INSERT INTO nodes (space_id, label, type, content, kind, importance, created_at) VALUES (?, ?, 'daily', ?, 'action', 0.5, ?)`)
        .run(spaceId, `Long action ${String(i).padStart(2, "0")} ${"with a great deal of descriptive detail ".repeat(6)}`, "x", new Date().toISOString());
    }
    ctx.llm = tabLlm();
    outbox = [];
    await handleTelegramUpdate(ctx, update(9, "what's on my agenda?"), send);
    expect(outbox.length).toBeGreaterThan(1);
    for (const m of outbox) expect(m.text.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    const joined = outbox.map((m) => m.text).join("\n");
    expect(joined).toContain("Long action 00");
    expect(joined).toContain("Long action 18");
    // 21 actions total (1 seeded + 20 long) — the page honestly says so
    // instead of presenting the first 20 as the whole agenda.
    expect(joined).toContain("showing 20 of 21");
  });
});
