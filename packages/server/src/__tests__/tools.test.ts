import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import { runToolRouter } from "../agent/tools/router.js";
import { toolHealthSummary } from "../agent/tools/health.js";
import { TOOLS } from "../agent/tools/registry.js";
import { FinAccountRepo } from "../repositories/finAccount.repo.js";
import { FinBillRepo } from "../repositories/finBill.repo.js";
import { FinIncomeRepo } from "../repositories/finIncome.repo.js";

let handle: DbHandle;
let ctx: AppContext;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = { handle, embeddings, llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
});
afterEach(() => handle.sqlite.close());

const iso = (ms: number) => new Date(ms).toISOString();

/** Insert a memory carrying a reminder at `remindAt` (ISO), returns its id. */
function reminder(label: string, remindAt: string): number {
  const info = handle.sqlite
    .prepare(`INSERT INTO nodes (space_id, label, type, content, remind_at) VALUES ('legacy', ?, 'daily', '', ?)`)
    .run(label, remindAt);
  return Number(info.lastInsertRowid);
}
const firedAt = (id: number) =>
  (handle.sqlite.prepare(`SELECT reminder_fired_at AS f FROM nodes WHERE id = ?`).get(id) as { f: string | null }).f;

describe("Soumaya's tool-router — firing reminders", () => {
  it("fires a due reminder exactly once and marks it fired", async () => {
    const now = Date.UTC(2026, 2, 1, 12, 0, 0);
    const id = reminder("call the landlord", iso(now - 60_000)); // due a minute ago
    const sent: string[] = [];
    const notify = async (_space: string, text: string) => void sent.push(text);

    const r1 = await runToolRouter(ctx, "legacy", { now, notify });
    expect(r1.some((r) => r.ok && r.delivered)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("call the landlord");
    expect(firedAt(id)).not.toBeNull();

    // Second pass: already fired → nothing delivered again.
    const r2 = await runToolRouter(ctx, "legacy", { now: now + 60_000, notify });
    expect(r2).toHaveLength(0);
    expect(sent).toHaveLength(1);
  });

  it("does NOT fire a reminder whose time hasn't arrived", async () => {
    const now = Date.UTC(2026, 2, 1, 12, 0, 0);
    reminder("dentist next week", iso(now + 7 * 86_400_000));
    const sent: string[] = [];
    await runToolRouter(ctx, "legacy", { now, notify: async (_s, t) => void sent.push(t) });
    expect(sent).toHaveLength(0);
  });

  it("retires a badly-overdue reminder silently (marks fired, no spam)", async () => {
    const now = Date.UTC(2026, 2, 1, 12, 0, 0);
    const id = reminder("was due ages ago", iso(now - 10 * 86_400_000)); // 10 days overdue
    const sent: string[] = [];
    const r = await runToolRouter(ctx, "legacy", { now, notify: async (_s, t) => void sent.push(t) });
    expect(r.some((x) => x.ok && !x.delivered)).toBe(true);
    expect(sent).toHaveLength(0); // not delivered
    expect(firedAt(id)).not.toBeNull(); // but marked so it never comes back
  });

  it("never fires a deleted memory's reminder", async () => {
    const now = Date.UTC(2026, 2, 1, 12, 0, 0);
    const id = reminder("deleted thing", iso(now - 60_000));
    handle.sqlite.prepare(`UPDATE nodes SET deleted_at = ? WHERE id = ?`).run(iso(now), id);
    const sent: string[] = [];
    await runToolRouter(ctx, "legacy", { now, notify: async (_s, t) => void sent.push(t) });
    expect(sent).toHaveLength(0);
  });

  // Life Vision (docs/specs/life-vision.md, C2.1/C3.2-locked): a Vision's remind_at is
  // a target date, not a reminder — regression against the exact spurious-reminder bug
  // the C2.1 audit flagged.
  it("never fires a reminder for a life_vision node, even with a past remind_at", async () => {
    const now = Date.UTC(2026, 2, 1, 12, 0, 0);
    const id = reminder("Our first house", iso(now - 60_000));
    handle.sqlite.prepare(`UPDATE nodes SET kind = 'life_vision' WHERE id = ?`).run(id);
    const sent: string[] = [];
    const r = await runToolRouter(ctx, "legacy", { now, notify: async (_s, t) => void sent.push(t) });
    expect(sent).toHaveLength(0);
    expect(r).toHaveLength(0);
    expect(firedAt(id)).toBeNull(); // never even attempted, so never marked fired
  });

  it("logs every action to agent_logs (in-app record even with no channel)", async () => {
    const now = Date.UTC(2026, 2, 1, 12, 0, 0);
    reminder("log me", iso(now - 60_000));
    await runToolRouter(ctx, "legacy", { now }); // no notify → offline path
    const logs = handle.sqlite
      .prepare(`SELECT action FROM agent_logs WHERE space_id = 'legacy' AND action = 'tool:fire_reminder'`)
      .all() as { action: string }[];
    expect(logs.length).toBe(1);
  });
});

describe("Soumaya's tool-router — a tool's `message` logs verbatim", () => {
  it("stores bill_risk's full user-facing text, not the internal summary/reason", async () => {
    const now = Date.parse("2026-01-10T12:00:00Z"); // midday UTC = Sat Jan 10 in the space's Florida timezone too
    new FinAccountRepo(handle, "legacy").setBalance(10000);
    const inc = new FinIncomeRepo(handle, "legacy");
    inc.create({ date: "2026-01-01", netCents: 1000 });
    inc.create({ date: "2026-01-10", netCents: 1000 });
    new FinBillRepo(handle, "legacy").create({ name: "Rent", amountCents: 25000, frequency: "monthly", anchorDate: "2026-01-18" });

    await runToolRouter(ctx, "legacy", { now });
    const row = handle.sqlite
      .prepare(`SELECT description FROM agent_logs WHERE space_id = 'legacy' AND action = 'tool:bill_risk'`)
      .get() as { description: string } | undefined;

    expect(row?.description).toMatch(/Rent/);
    expect(row?.description).toMatch(/\$/);
    // NOT the old "summary — reason" shape — the real nudge text Soumaya would say.
    expect(row?.description).not.toMatch(/bill-risk nudge for/);
  });

  // bill_risk was the FIRST instance of this bug fixed; the same fix generalizes to
  // every other tool sharing the shape (see agent/tools/{reminder,taskCreator,orphan,
  // reviewNudge,checkin,webLookup,weeklyReview,chartDiscovery}.ts). Spot-check one more
  // (already has good fixtures in this file) to confirm the generalization actually
  // stuck, not just the one tool it was first found on.
  it("generalizes to fire_reminder too — the exact toast text, not an internal summary", async () => {
    const now = Date.UTC(2026, 2, 1, 12, 0, 0);
    reminder("call the landlord", iso(now - 60_000));
    await runToolRouter(ctx, "legacy", { now });
    const row = handle.sqlite
      .prepare(`SELECT description FROM agent_logs WHERE space_id = 'legacy' AND action = 'tool:fire_reminder'`)
      .get() as { description: string } | undefined;
    expect(row?.description).toBe('⏰ Reminder: "call the landlord"');
  });
});

/** A plain memory with content + timestamp (for the task / orphan tools). */
function memory(label: string, content: string, createdAt: string): number {
  const info = handle.sqlite
    .prepare(`INSERT INTO nodes (space_id, label, type, content, importance, created_at) VALUES ('legacy', ?, 'daily', ?, 0.5, ?)`)
    .run(label, content, createdAt);
  return Number(info.lastInsertRowid);
}
const edgeCount = (id: number) =>
  (handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM edges WHERE space_id='legacy' AND (source=? OR target=?)`).get(id, id) as { c: number }).c;

describe("Soumaya's tool-router — task creation", () => {
  it("turns a first-person commitment into a linked action, once", async () => {
    const now = Date.UTC(2026, 2, 10, 12, 0, 0);
    const m = memory("landlord", "I need to call the landlord about the lease", iso(now - 3600_000));
    const sent: string[] = [];
    await runToolRouter(ctx, "legacy", { now, notify: async (_s, t) => void sent.push(t) });

    const actions = handle.sqlite
      .prepare(`SELECT id, label FROM nodes WHERE space_id='legacy' AND kind='action'`)
      .all() as { id: number; label: string }[];
    expect(actions.length).toBe(1);
    expect(sent.some((t) => t.includes("action"))).toBe(true);
    // Linked back to the source memory.
    expect(edgeCount(m)).toBeGreaterThan(0);

    // Second pass: already has a derived action → no duplicate.
    await runToolRouter(ctx, "legacy", { now: now + 120_000 });
    expect((handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM nodes WHERE space_id='legacy' AND kind='action'`).get() as { c: number }).c).toBe(1);
  });

  it("does NOT create a task from a plain memory with no commitment", async () => {
    const now = Date.UTC(2026, 2, 10, 12, 0, 0);
    memory("walk", "had a nice quiet walk in the park", iso(now - 3600_000));
    await runToolRouter(ctx, "legacy", { now });
    expect((handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM nodes WHERE space_id='legacy' AND kind='action'`).get() as { c: number }).c).toBe(0);
  });
});

describe("Soumaya's tool-router — orphan surfacing", () => {
  it("surfaces one long-drifting unlinked memory per day", async () => {
    const now = Date.UTC(2026, 2, 10, 12, 0, 0);
    memory("orphan", "a thought I never connected to anything", iso(now - 5 * 86_400_000));
    const sent: string[] = [];
    await runToolRouter(ctx, "legacy", { now, notify: async (_s, t) => void sent.push(t) });
    expect(sent.some((t) => t.includes("drifting"))).toBe(true);

    // Same day → no second orphan nudge.
    const before = sent.length;
    memory("orphan2", "another disconnected note", iso(now - 6 * 86_400_000));
    await runToolRouter(ctx, "legacy", { now: now + 120_000, notify: async (_s, t) => void sent.push(t) });
    expect(sent.length).toBe(before);
  });

  it("does not surface a memory that's too new (still had time to link)", async () => {
    const now = Date.UTC(2026, 2, 10, 12, 0, 0);
    memory("fresh", "just wrote this", iso(now - 3600_000));
    const sent: string[] = [];
    await runToolRouter(ctx, "legacy", { now, notify: async (_s, t) => void sent.push(t) });
    expect(sent.some((t) => t.includes("drifting"))).toBe(false);
  });
});

function heavyMem(label: string, weight: number, createdAt: string): void {
  handle.sqlite
    .prepare(`INSERT INTO nodes (space_id, label, type, content, emotional_weight, created_at) VALUES ('legacy', ?, 'daily', ?, ?, ?)`)
    .run(label, label, weight, createdAt);
}

describe("Soumaya's tool-router — proactive check-ins", () => {
  it("checks in on a heavy emotional stretch, once per day", async () => {
    const now = Date.UTC(2026, 2, 10, 12, 0, 0);
    heavyMem("rough", -0.6, iso(now - 1 * 86_400_000));
    heavyMem("hard", -0.5, iso(now - 2 * 86_400_000));
    heavyMem("low", -0.7, iso(now - 3 * 86_400_000));
    const sent: string[] = [];
    await runToolRouter(ctx, "legacy", { now, notify: async (_s, t) => void sent.push(t) });
    expect(sent.some((t) => t.includes("heavy"))).toBe(true);

    const before = sent.length;
    await runToolRouter(ctx, "legacy", { now: now + 120_000, notify: async (_s, t) => void sent.push(t) });
    expect(sent.length).toBe(before);
  });

  it("does not check in when the mood is fine", async () => {
    const now = Date.UTC(2026, 2, 10, 12, 0, 0);
    heavyMem("good", 0.6, iso(now - 1 * 86_400_000));
    heavyMem("great", 0.5, iso(now - 2 * 86_400_000));
    heavyMem("nice", 0.4, iso(now - 3 * 86_400_000));
    const sent: string[] = [];
    await runToolRouter(ctx, "legacy", { now, notify: async (_s, t) => void sent.push(t) });
    expect(sent.some((t) => t.includes("heavy"))).toBe(false);
  });
});

describe("Soumaya's tool-router — agentic LLM curation", () => {
  it("with Research Mode + a route() brain, executes ONLY the chosen candidates", async () => {
    const now = Date.UTC(2026, 2, 10, 12, 0, 0);
    reminder("call A", iso(now - 60_000));
    reminder("call B", iso(now - 60_000));
    // Enable Research Mode and give the llm a router that keeps only the first candidate.
    handle.sqlite.prepare(`INSERT OR IGNORE INTO space_meta (space_id) VALUES ('legacy')`).run();
    handle.sqlite.prepare(`UPDATE space_meta SET research_enabled='true' WHERE space_id='legacy'`).run();
    (ctx.llm as unknown as { route: (b: string, c: unknown[]) => Promise<number[]> }).route = async () => [0];

    const sent: string[] = [];
    await runToolRouter(ctx, "legacy", { now, notify: async (_s, t) => void sent.push(t) });
    // Only one reminder should have fired (the router suppressed the other).
    expect(sent.filter((t) => t.includes("Reminder")).length).toBe(1);
  });
});

describe("Soumaya's tool-router — web lookup (gated)", () => {
  it("stays dormant offline (no webLookup capability, Research Mode off) — no note, no crash", async () => {
    const now = Date.UTC(2026, 2, 10, 12, 0, 0);
    memory("lookup", "look up the current population of Tokyo", iso(now - 3600_000));
    await runToolRouter(ctx, "legacy", { now }); // heuristic llm has no webLookup → guarded off
    const notes = handle.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM nodes WHERE space_id='legacy' AND label LIKE 'Looked up:%'`)
      .get() as { c: number };
    expect(notes.c).toBe(0);
  });
});

describe("Soumaya's tool-router — weekly review", () => {
  it("composes a once-a-week reflection when the week has enough moments", async () => {
    const now = Date.UTC(2026, 3, 15, 9, 0, 0);
    for (let i = 0; i < 4; i++) memory(`moment ${i}`, `something that happened ${i}`, iso(now - (i + 1) * 86_400_000));
    const sent: string[] = [];
    const r = await runToolRouter(ctx, "legacy", { now, notify: async (_s, t) => void sent.push(t) });

    expect(r.some((x) => x.summary.includes("Looking back on your week"))).toBe(true);
    expect(sent.some((t) => t.includes("Looking back on your week"))).toBe(true);
    // Logged in-app for Night Replay.
    const logs = handle.sqlite
      .prepare(`SELECT 1 FROM agent_logs WHERE space_id='legacy' AND action='tool:weekly_review'`)
      .all();
    expect(logs.length).toBe(1);
  });

  it("stays quiet a second time within the same week (rate-limited)", async () => {
    const now = Date.UTC(2026, 3, 15, 9, 0, 0);
    for (let i = 0; i < 4; i++) memory(`moment ${i}`, `content ${i}`, iso(now - (i + 1) * 86_400_000));
    await runToolRouter(ctx, "legacy", { now });
    const sent: string[] = [];
    const r = await runToolRouter(ctx, "legacy", { now: now + 2 * 86_400_000, notify: async (_s, t) => void sent.push(t) });
    expect(r.some((x) => x.summary.includes("Looking back on your week"))).toBe(false);
    expect(sent.some((t) => t.includes("Looking back on your week"))).toBe(false);
  });

  it("does nothing on a near-empty week", async () => {
    const now = Date.UTC(2026, 3, 15, 9, 0, 0);
    memory("only one", "a single note", iso(now - 86_400_000));
    const r = await runToolRouter(ctx, "legacy", { now });
    expect(r.some((x) => x.summary.includes("Looking back on your week"))).toBe(false);
  });
});

describe("toolHealthSummary — the Soumaya tab's 'Autonomous systems' diagnostics", () => {
  it("lists every registered tool, 'never run' by default", () => {
    const summary = toolHealthSummary(handle, "legacy");
    expect(summary).toHaveLength(TOOLS.length);
    expect(summary.every((s) => s.lastRanAt === null)).toBe(true);
    expect(summary.map((s) => s.tool)).toEqual(expect.arrayContaining(TOOLS.map((t) => t.name)));
  });

  it("reflects a tool's last real run once it fires", async () => {
    const now = Date.UTC(2026, 2, 1, 12, 0, 0);
    reminder("call the landlord", iso(now - 60_000));
    await runToolRouter(ctx, "legacy", { now });
    const summary = toolHealthSummary(handle, "legacy");
    const fired = summary.find((s) => s.tool === "fire_reminder");
    expect(fired?.lastRanAt).not.toBeNull();
    // Every other tool still reads as never-run.
    expect(summary.filter((s) => s.tool !== "fire_reminder").every((s) => s.lastRanAt === null)).toBe(true);
  });

  it("is space-scoped", async () => {
    const now = Date.UTC(2026, 2, 1, 12, 0, 0);
    handle.sqlite.prepare(`INSERT INTO nodes (space_id, label, type, content, remind_at) VALUES ('alice', 'x', 'daily', '', ?)`).run(iso(now - 60_000));
    await runToolRouter(ctx, "alice", { now });
    expect(toolHealthSummary(handle, "alice").find((s) => s.tool === "fire_reminder")?.lastRanAt).not.toBeNull();
    expect(toolHealthSummary(handle, "bob").find((s) => s.tool === "fire_reminder")?.lastRanAt).toBeNull();
  });
});
