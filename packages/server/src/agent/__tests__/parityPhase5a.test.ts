import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDb, type DbHandle } from "../../db/client.js";
import { HashEmbeddingProvider } from "../../embeddings/hash.js";
import { HeuristicProvider } from "../../llm/heuristic.js";
import { EMBED_DIM } from "../../db/vec.js";
import type { AppContext } from "../../context.js";
import { UsageTracker } from "../../usage.js";
import type { ToolContext } from "../tools/types.js";
import { AGENT_TOOLS } from "../tools/registry.js";
import { validateArgs } from "../tools/validation.js";
import { briefMeTool } from "../tools/briefMe.js";
import { relationshipRadarTool } from "../tools/relationshipRadar.js";
import { onThisDayTool } from "../tools/onThisDay.js";
import { prepareMeTool } from "../tools/prepareMe.js";
import { FinAccountRepo } from "../../repositories/finAccount.repo.js";
import { FinBillRepo } from "../../repositories/finBill.repo.js";
import { FinIncomeRepo } from "../../repositories/finIncome.repo.js";
import { FinBucketRepo } from "../../repositories/finBucket.repo.js";
import { FinGoalRepo } from "../../repositories/finGoal.repo.js";
import { StreakRepo } from "../../streak.js";

/**
 * Telegram Parity Phase 5-A — assembled READ tools.
 *
 * brief_me / relationship_radar / on_this_day / prepare_me compose ONLY
 * existing sources (Budget Engine, goalAllocationChange, agenda/reminder
 * rows, StreakRepo, analysis/people, entity_lookup). Each test seeds a
 * brain and asserts the assembled output reflects the seeds exactly —
 * including the deterministic focus rule, the longest-silent ordering,
 * a space-timezone edge for on_this_day, and an honest empty dossier.
 */

let handle: DbHandle;
let ctx: AppContext;
const SPACE = "p5a-space";
const NOW = Date.parse("2026-10-15T16:00:00.000Z"); // noon in America/New_York
const DAY_MS = 86_400_000;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = { handle, embeddings, llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
});
afterEach(() => {
  vi.useRealTimers();
  handle.sqlite.close();
});

const tc = (now = NOW, spaceId = SPACE): ToolContext => ({ ctx, spaceId, now, notify: async () => {} });

function insertNode(o: {
  label: string;
  type?: string;
  content?: string;
  kind?: string | null;
  importance?: number;
  emotionalWeight?: number;
  createdAt?: string;
  remindAt?: string;
  spaceId?: string;
}): number {
  const r = handle.sqlite
    .prepare(
      `INSERT INTO nodes (space_id, label, type, content, kind, importance, emotional_weight, created_at, remind_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      o.spaceId ?? SPACE,
      o.label,
      o.type ?? "daily",
      o.content ?? `content of ${o.label}`,
      o.kind ?? null,
      o.importance ?? 0.5,
      o.emotionalWeight ?? null,
      o.createdAt ?? "2026-10-01T00:00:00.000Z",
      o.remindAt ?? null,
    );
  return Number(r.lastInsertRowid);
}

function insertEdge(source: number, target: number, relationship: string): void {
  handle.sqlite
    .prepare(`INSERT INTO edges (space_id, source, target, relationship, weight) VALUES (?, ?, ?, ?, 1)`)
    .run(SPACE, source, target, relationship);
}

/** The Phase 4 telegram-seed finance shape, relative to NOW: Rent reserved
 *  before next income, balance short by $150. */
function seedAtRiskFinances(): void {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  new FinAccountRepo(handle, SPACE).setBalance(10000);
  const inc = new FinIncomeRepo(handle, SPACE);
  inc.create({ date: day(NOW - 9 * DAY_MS), netCents: 1000 });
  inc.create({ date: day(NOW), netCents: 1000 });
  new FinBillRepo(handle, SPACE).create({ name: "Rent", amountCents: 25000, frequency: "monthly", anchorDate: day(NOW + 8 * DAY_MS) });
}

function seedGoalTrend(): void {
  const bucket = new FinBucketRepo(handle, SPACE).create({ name: "Bucket" });
  const goal = new FinGoalRepo(handle, SPACE).create({ bucketId: bucket.id, name: "Emergency Fund" });
  for (const [amount, daysAgo] of [[30000, 75], [20000, 45], [5000, 15]] as const) {
    handle.sqlite
      .prepare(`INSERT INTO fin_allocation (space_id, goal_id, amount_cents, created_at) VALUES (?, ?, ?, ?)`)
      .run(SPACE, goal.id, amount, new Date(NOW - daysAgo * DAY_MS).toISOString().replace("T", " ").slice(0, 19));
  }
}

// ---------------------------------------------------------------------------
// brief_me
// ---------------------------------------------------------------------------

describe("brief_me", () => {
  it("assembles reminders, bills, streak, and goal pace from the seeds — and the focus rule picks the short bill (rule 1)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    seedAtRiskFinances();
    seedGoalTrend();
    insertNode({ label: "Call the dentist", kind: "memory", remindAt: "2026-10-14T15:00:00.000Z" });
    insertNode({ label: "Pay the water bill", kind: "memory", remindAt: "2026-10-15T10:00:00.000Z" });
    insertNode({ label: "Future thing", kind: "memory", remindAt: "2026-10-20T15:00:00.000Z" });
    new StreakRepo(handle, SPACE).touch(); // tends today (fake clock = NOW) → streak 1

    let notified = 0;
    const res = await briefMeTool.run({ ctx, spaceId: SPACE, now: NOW, notify: async () => void notified++ }, {});
    expect(res.ok).toBe(true);
    expect(notified).toBe(0);
    // Reminders section reflects the seeds.
    expect(res.message).toContain("REMINDERS DUE: 2 due at or before now (1 more upcoming)");
    expect(res.message).toContain('"Call the dentist"');
    // Bills section reflects the Budget Engine state.
    expect(res.message).toContain("BILLS AT RISK");
    expect(res.message).toContain('"Rent"');
    expect(res.message).toContain("shortfall: $150");
    expect(res.message).toMatch(/SHORT of covering/);
    // Streak section reflects StreakRepo.
    expect(res.message).toContain("STREAK: 1 day(s)");
    expect(res.message).toContain("tended today: yes");
    // Goal pace reflects goalAllocationChange.
    expect(res.message).toContain("GOAL FUNDING PACE");
    expect(res.message).toContain('"Emergency Fund": decreased');
    // Focus: rule 1 — the short bill beats the overdue reminders.
    expect(res.message).toContain("SUGGESTED FOCUS (Soumaya's pick");
    const focusLine = res.message!.split("\n").find((l) => l.startsWith("SUGGESTED FOCUS"))!;
    expect(focusLine).toContain('"Rent"');
    expect(focusLine).toContain("rule 1");
    expect(focusLine).not.toContain("dentist");
  });

  it("with no bill at risk, the focus is the MOST OVERDUE reminder (rule 2), and empty sections say so", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    insertNode({ label: "Newer overdue", kind: "memory", remindAt: "2026-10-14T15:00:00.000Z" });
    insertNode({ label: "Older overdue", kind: "memory", remindAt: "2026-10-10T15:00:00.000Z" });

    const res = await briefMeTool.run(tc(), {});
    expect(res.message).toContain("no bills are reserved before the next income");
    expect(res.message).toContain("no financial goals are set up");
    expect(res.message).toContain("STREAK: no active streak right now");
    const focusLine = res.message!.split("\n").find((l) => l.startsWith("SUGGESTED FOCUS"))!;
    expect(focusLine).toContain('"Older overdue"');
    expect(focusLine).toContain("rule 2");
  });

  it("on an empty brain every section is honest and the focus is none (rule 5)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const res = await briefMeTool.run(tc(), {});
    expect(res.ok).toBe(true);
    expect(res.message).toContain("REMINDERS DUE: 0");
    expect(res.message).toContain("(none — no reminders are due right now)");
    expect(res.message).toContain("no bills are reserved");
    expect(res.message).toContain("no financial goals are set up");
    expect(res.message).toContain("SUGGESTED FOCUS");
    expect(res.message).toContain("none — nothing is overdue, at risk, or open right now (rule 5)");
  });
});

// ---------------------------------------------------------------------------
// relationship_radar
// ---------------------------------------------------------------------------

describe("relationship_radar", () => {
  function seedPeople(): void {
    const sara = insertNode({ label: "Silent Sara", type: "person", kind: "person_entity", content: "A friend from school." });
    const omar = insertNode({ label: "Old Omar", type: "person", kind: "person_entity", content: "A former coworker." });
    const rita = insertNode({ label: "Recent Rita", type: "person", kind: "person_entity", content: "A close friend." });
    const omarMem = insertNode({
      label: "Coffee with Omar",
      kind: "memory",
      emotionalWeight: 0.6,
      createdAt: "2026-06-01T12:00:00.000Z",
    });
    const ritaMem = insertNode({
      label: "Hard call with Rita",
      kind: "memory",
      emotionalWeight: -0.6,
      createdAt: "2026-10-10T12:00:00.000Z",
    });
    insertEdge(omarMem, omar, "supports");
    insertEdge(ritaMem, rita, "supports");
    // Another space's person must never leak in.
    insertNode({ label: "Other Space Person", type: "person", kind: "person_entity", spaceId: "other-space" });
    void sara;
  }

  it("ranks longest-silent first (never-interacted leads), each with a one-line last-interaction summary", async () => {
    seedPeople();
    const res = await relationshipRadarTool.run(tc(), {});
    expect(res.ok).toBe(true);
    expect(res.message).toContain("3 tracked in total");
    expect(res.message).not.toContain("Other Space Person");
    const iSara = res.message!.indexOf("Silent Sara");
    const iOmar = res.message!.indexOf("Old Omar");
    const iRita = res.message!.indexOf("Recent Rita");
    expect(iSara).toBeGreaterThanOrEqual(0);
    expect(iSara).toBeLessThan(iOmar);
    expect(iOmar).toBeLessThan(iRita);
    expect(res.message).toContain("no interaction recorded yet — silent the longest");
    expect(res.message).toContain('"Coffee with Omar"');
    expect(res.message).toContain("136 day(s) ago (2026-06-01)");
    expect(res.message).toContain("tone: warm");
    expect(res.message).toContain('"Hard call with Rita"');
    expect(res.message).toContain("5 day(s) ago (2026-10-10)");
    expect(res.message).toContain("tone: heavy");
  });

  it("paginates with honest truncation", async () => {
    seedPeople();
    const page1 = await relationshipRadarTool.run(tc(), { limit: 2 });
    expect(page1.message).toContain("Showing 2 of 3 tracked people");
    expect(page1.message).toContain("offset 2");
    expect(page1.message).not.toContain("Recent Rita");
    const page2 = await relationshipRadarTool.run(tc(), { limit: 2, offset: 2 });
    expect(page2.message).toContain("Showing 1 of 3 tracked people");
    expect(page2.message).toContain("Recent Rita");
  });

  it("says so honestly when no people are tracked", async () => {
    const res = await relationshipRadarTool.run(tc(), {});
    expect(res.message).toContain("does not track any people yet");
  });
});

// ---------------------------------------------------------------------------
// on_this_day — all date math on space-local days
// ---------------------------------------------------------------------------

describe("on_this_day", () => {
  it("matches past-year memories by SPACE-LOCAL day (timezone edge) and surfaces month-old decisions with a did-it-stick prompt", async () => {
    // Timezone edge: 2025-10-16T02:30Z is Oct 16 in UTC but Oct 15 22:30 in
    // America/New_York — it MUST match "on this day" (Oct 15) by local day.
    insertNode({ label: "Zone edge picnic", kind: "memory", createdAt: "2025-10-16T02:30:00.000Z" });
    // The mirror edge: 2025-10-15T02:30Z is Oct 15 in UTC but Oct 14 locally — must NOT match.
    insertNode({ label: "Wrong day market", kind: "memory", createdAt: "2025-10-15T02:30:00.000Z" });
    insertNode({ label: "Old harvest day", kind: "memory", createdAt: "2024-10-15T15:00:00.000Z" });
    // Same local date but THIS year — not a past-year memory.
    insertNode({ label: "Fresh today memory", kind: "memory", createdAt: "2026-10-15T15:00:00.000Z" });
    // Decisions: one inside the 25–35 local-day window, two outside it.
    insertNode({ label: "Decided to take the warehouse job", type: "decision", createdAt: "2026-09-15T15:00:00.000Z" });
    insertNode({ label: "Decided yesterday-ish", type: "decision", createdAt: "2026-10-10T15:00:00.000Z" });
    insertNode({ label: "Decided long ago", type: "decision", createdAt: "2026-08-20T15:00:00.000Z" });

    const res = await onThisDayTool.run(tc(), {});
    expect(res.ok).toBe(true);
    expect(res.message).toContain("ON THIS DAY (2026-10-15, space timezone America/New_York");
    expect(res.message).toContain("Memories from this calendar date (10-15) in past years: 2");
    expect(res.message).toContain('"Zone edge picnic" (2025-10-15)');
    expect(res.message).toContain('"Old harvest day" (2024-10-15)');
    expect(res.message).not.toContain("Wrong day market");
    expect(res.message).not.toContain("Fresh today memory");
    expect(res.message).toContain("Decisions made about a month ago (25-35 local days before today): 1");
    expect(res.message).toContain('"Decided to take the warehouse job" (decided 2026-09-15, 30 day(s) ago)');
    expect(res.message).toContain("Did it stick?");
    expect(res.message).not.toContain("Decided yesterday-ish");
    expect(res.message).not.toContain("Decided long ago");
  });

  it("says so honestly when nothing falls on this day or in the decision window", async () => {
    insertNode({ label: "Unrelated memory", kind: "memory", createdAt: "2025-03-03T15:00:00.000Z" });
    const res = await onThisDayTool.run(tc(), {});
    expect(res.message).toContain("in past years: 0");
    expect(res.message).toContain("(none — no memory is dated with this month and day in a past year)");
    expect(res.message).toContain("(none — no decision falls in that window)");
  });
});

// ---------------------------------------------------------------------------
// prepare_me
// ---------------------------------------------------------------------------

describe("prepare_me", () => {
  function seedPerson(): number {
    const marcus = insertNode({
      label: "Marcus Vale",
      type: "person",
      kind: "person_entity",
      content: "Marcus is the owner's father. He raised the owner and lives nearby.",
    });
    const dinner = insertNode({
      label: "Dinner with Marcus",
      kind: "memory",
      emotionalWeight: 0.6,
      createdAt: "2026-10-05T12:00:00.000Z",
    });
    insertEdge(dinner, marcus, "supports");
    // Open threads: an action mentioning him, a pending reminder mentioning
    // him, and a decision mentioning him.
    insertNode({ label: "Call Marcus about Thanksgiving", kind: "action", content: "Need to call Marcus about Thanksgiving plans." });
    insertNode({ label: "Send Marcus the documents", kind: "memory", remindAt: "2026-10-20T15:00:00.000Z", content: "Documents Marcus asked for." });
    insertNode({ label: "Whether to lend Marcus money", type: "decision", content: "Weighing whether to lend Marcus money." });
    return marcus;
  }

  it("builds a person dossier: profile, tone, history, and open threads", async () => {
    const marcus = seedPerson();
    const res = await prepareMeTool.run(tc(), { personOrTopic: "Marcus Vale" });
    expect(res.ok).toBe(true);
    expect(res.targets).toEqual([marcus]);
    expect(res.message).toContain("DOSSIER — PERSON: Marcus Vale");
    expect(res.message).toContain("owner's father");
    expect(res.message).toContain("Tone of interactions: warm");
    expect(res.message).toContain("Interactions: 1 on record");
    expect(res.message).toContain('"Dinner with Marcus" (2026-10-05)');
    expect(res.message).toContain("OPEN THREADS (unresolved actions / pending reminders / decisions linked to this subject): 3");
    expect(res.message).toContain('"Call Marcus about Thanksgiving" [action');
    expect(res.message).toContain('"Send Marcus the documents" [reminder');
    expect(res.message).toContain('"Whether to lend Marcus money" [decision');
  });

  it("builds a topic dossier from entity_lookup's machinery plus open threads mentioning it", async () => {
    const topic = insertNode({ label: "Nursing School", type: "project", content: "The plan to enroll in nursing school." });
    const mem = insertNode({ label: "Tour of the campus", kind: "memory" });
    insertEdge(mem, topic, "relates_to");
    insertNode({ label: "Submit the application", kind: "action", content: "Submit the Nursing School application." });

    const res = await prepareMeTool.run(tc(), { personOrTopic: "Nursing School" });
    expect(res.ok).toBe(true);
    expect(res.targets).toEqual([topic]);
    expect(res.message).toContain("DOSSIER — TOPIC: Nursing School");
    expect(res.message).toContain("The plan to enroll in nursing school.");
    expect(res.message).toContain("Incoming connections");
    expect(res.message).toContain("Tour of the campus");
    expect(res.message).toContain("OPEN THREADS");
    expect(res.message).toContain('"Submit the application" [action');
  });

  it("unknown name/topic → honest empty, never an invented dossier", async () => {
    seedPerson();
    const res = await prepareMeTool.run(tc(), { personOrTopic: "Zebra Nebula Consortium" });
    expect(res.ok).toBe(true);
    expect(res.message).toContain('nothing in this brain matches "Zebra Nebula Consortium"');
    expect(res.message).toContain("do NOT invent a dossier");
    expect(res.message).not.toContain("DOSSIER");
  });
});

// ---------------------------------------------------------------------------
// Registry / schema pin for the Phase 5-A tools
// ---------------------------------------------------------------------------

describe("Phase 5-A registry", () => {
  const P5A = ["brief_me", "relationship_radar", "on_this_day", "prepare_me"];
  it("every Phase 5-A tool is in AGENT_TOOLS as read-only", () => {
    for (const name of P5A) {
      const entry = AGENT_TOOLS.find((e) => e.tool.name === name);
      expect(entry, name).toBeDefined();
      expect(entry!.isWrite, name).toBe(false);
    }
  });
  it("no-arg tools validate {}; prepare_me requires personOrTopic", () => {
    for (const name of ["brief_me", "relationship_radar", "on_this_day"]) {
      const entry = AGENT_TOOLS.find((e) => e.tool.name === name)!;
      expect(validateArgs(entry.tool, {}).ok, name).toBe(true);
    }
    const prep = AGENT_TOOLS.find((e) => e.tool.name === "prepare_me")!.tool;
    expect(validateArgs(prep, { personOrTopic: "Marcus Vale" }).ok).toBe(true);
    expect(validateArgs(prep, {}).ok).toBe(false);
    expect(validateArgs(prep, { personOrTopic: 42 }).ok).toBe(false);
    const radar = AGENT_TOOLS.find((e) => e.tool.name === "relationship_radar")!.tool;
    expect(validateArgs(radar, { limit: "lots" }).ok).toBe(false);
  });
});
