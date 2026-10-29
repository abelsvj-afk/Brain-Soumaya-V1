/**
 * W3 Milestone 3 — Phase D: run orchestration engine (design Rev 11
 * §3/§5/§7/§9/§11/§14; implementation plan Phase D test list).
 *
 * Covers T-C4–T-C13, T-C15–T-C22, T-C27–T-C41, T-C43, T-C44, T-C47–
 * T-C49, T-C51, T-C53, T-C54, T-C60, T-C62, T-C63. (Amendment 1
 * migration tests + the T-C55 extension live in w3-migration.test.ts.)
 *
 * Real SQLite via createDb(); LLM surfaces are injectable stubs.
 * user_model/node fixtures for adjudication cells are inserted by SQL
 * for full control of origin/valid_at/created_at — the decision engine
 * reads rows, and writer-API seeding cannot express every cell (e.g.
 * recordStated invalidates contradicted consolidated rows on write).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../../db/client.js";
import { captureEpisode, episodeSearch } from "../episodic.js";
import { recordStated, correctUserModel, getUserModel } from "../userModel.js";
import { applyConsolidationMutation } from "../consolidation/boundary.js";
import {
  runConsolidation,
  claimConsolidationRun,
  consolidationWindowDate,
  retireLegacyContradictions,
} from "../consolidation/run.js";
import {
  fileContradiction,
  claimContradictions,
  runAdjudication,
  type ContradictionRow,
} from "../consolidation/adjudicate.js";
import { selectCandidates } from "../consolidation/distill.js";
import {
  recordAccess,
  getAccessStat,
  decayWeight,
  resetAccessCoalescing,
} from "../consolidation/retrievals.js";
import { buildDailyDigest } from "../../synthesis/dailyDigest.js";
import { EMBED_DIM } from "../../db/vec.js";
import type { NotifyPreferences } from "../notify/policy.js";
import { decideWorldChange, listProposals } from "../../worlds/mutation.js";
import "../../worlds/brainAppliers.js"; // side effect: registers the brain_dedup applier for decide/approve
import { HashEmbeddingProvider } from "../../embeddings/hash.js";
import { HeuristicProvider } from "../../llm/heuristic.js";
import { UsageTracker } from "../../usage.js";
import type { AppContext } from "../../context.js";

const SPACE = "w3-m3-space";
const DAY = 86_400_000;

let handle: DbHandle;
let ctx: AppContext;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = { handle, embeddings, llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
  resetAccessCoalescing();
});

afterEach(() => {
  (handle.sqlite as unknown as { close(): void }).close();
});

/* ---------------- helpers ---------------- */

const iso = (ms: number) => new Date(ms).toISOString();
const aged = (days: number) => iso(Date.now() - days * DAY);

function setMeta(patch: Record<string, number | string | null>): void {
  handle.sqlite.prepare(`INSERT OR IGNORE INTO space_meta (space_id) VALUES (?)`).run(SPACE);
  for (const [k, v] of Object.entries(patch)) {
    handle.sqlite.prepare(`UPDATE space_meta SET ${k} = ? WHERE space_id = ?`).run(v, SPACE);
  }
}

function meta(): Record<string, unknown> {
  return handle.sqlite
    .prepare(`SELECT * FROM space_meta WHERE space_id = ?`)
    .get(SPACE) as Record<string, unknown>;
}

let epSeq = 0;
function seedEpisode(lineageKey?: string, occurredAt?: string, excerpt?: string): number {
  epSeq += 1;
  const res = captureEpisode(handle, SPACE, {
    kind: "conversation",
    userExcerpt: excerpt ?? `run test interaction ${epSeq}`,
    topicLabels: [],
    ...(lineageKey ? { lineageKey } : {}),
    ...(occurredAt ? { occurredAt } : {}),
  });
  if (!res) throw new Error("captureEpisode returned null");
  return res.episodeId;
}

function ev(id: number): { type: "episode"; id: number }[] {
  return [{ type: "episode", id }];
}

interface UmFixture {
  slot?: string;
  content: string;
  origin: "stated" | "inferred" | "consolidated";
  confidence?: number;
  strength?: number;
  evidence?: { type: string; id: number }[];
  topics?: string[];
  validAt?: string;
  createdAt?: string;
}

function umInsert(f: UmFixture): number {
  const r = handle.sqlite
    .prepare(
      `INSERT INTO user_model (space_id, slot, content, confidence, evidence_strength,
         evidence_ids, topic_labels, valid_at, origin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      SPACE,
      f.slot ?? "belief",
      f.content,
      f.confidence ?? 0.5,
      f.strength ?? 0.3,
      JSON.stringify(f.evidence ?? [{ type: "episode", id: 1 }]),
      JSON.stringify(f.topics ?? ["work"]),
      f.validAt ?? f.createdAt ?? iso(Date.now()),
      f.origin,
      f.createdAt ?? f.validAt ?? iso(Date.now()),
    );
  return Number(r.lastInsertRowid);
}

function umRow(id: number): Record<string, unknown> {
  return handle.sqlite.prepare(`SELECT * FROM user_model WHERE id = ?`).get(id) as Record<
    string,
    unknown
  >;
}

function nodeInsert(f: {
  label: string;
  content: string;
  importance?: number;
  createdAt?: string;
  validFrom?: string | null;
}): number {
  const r = handle.sqlite
    .prepare(
      `INSERT INTO nodes (space_id, label, type, content, importance, valid_from, created_at)
       VALUES (?, ?, 'concept', ?, ?, ?, ?)`,
    )
    .run(SPACE, f.label, f.content, f.importance ?? 0.5, f.validFrom ?? null, f.createdAt ?? iso(Date.now()));
  return Number(r.lastInsertRowid);
}

function nodeRow(id: number): Record<string, unknown> {
  return handle.sqlite.prepare(`SELECT * FROM nodes WHERE id = ?`).get(id) as Record<string, unknown>;
}

function contradictionRow(id: number): ContradictionRow {
  return handle.sqlite.prepare(`SELECT * FROM contradictions WHERE id = ?`).get(id) as ContradictionRow;
}

function resolutionOf(id: number): { outcome: string; rule_applied: string } {
  const row = contradictionRow(id);
  const parsed = JSON.parse(row.resolution ?? "{}") as { outcome: string; rule_applied: string };
  return { outcome: parsed.outcome, rule_applied: parsed.rule_applied };
}

function inquiriesFor(recordId: number): Record<string, unknown>[] {
  return handle.sqlite
    .prepare(`SELECT * FROM inquiries WHERE space_id = ? AND contradiction_id = ?`)
    .all(SPACE, recordId) as Record<string, unknown>[];
}

async function adjudicateOnce(): Promise<void> {
  const runId = 9901;
  await runAdjudication(handle, {
    boundary: { spaceId: SPACE, runId },
    runId,
    fence: 1,
    now: new Date(),
  });
}

/**
 * Phase 4: approve the run's single pending brain_dedup proposal through
 * the world-change rail. The applier replays the consolidation mutation
 * via the boundary and records the episode outcomes — this is the step
 * that used to happen inside the run itself.
 */
async function approvePendingDedup(): Promise<number> {
  const proposals = listProposals(handle.sqlite, SPACE, { kind: "brain_dedup", status: "pending" });
  expect(proposals).toHaveLength(1);
  const decided = await decideWorldChange(ctx, SPACE, proposals[0]!.id, "approve", SPACE);
  expect(decided.ok).toBe(true);
  expect(decided.proposal?.status).toBe("applied");
  return proposals[0]!.id;
}

/* ---------------- claim & window (T-C4–T-C8, T-C22) ---------------- */

describe("T-C4/T-C22: claim atomicity and fencing", () => {
  it("two claims for the same (space, window): exactly one wins; the loser sees the live lease and the fence does not move", () => {
    const now = new Date();
    const first = claimConsolidationRun(handle.sqlite, SPACE, "2026-01-14", now);
    expect(first.claimed).toBe(true);
    if (first.claimed) expect(first.fence).toBe(1);
    const second = claimConsolidationRun(handle.sqlite, SPACE, "2026-01-14", now);
    expect(second.claimed).toBe(false);
    if (!second.claimed) {
      expect(second.reason).toBe("live_lease");
      expect(second.fence).toBe(1);
    }
    const rows = handle.sqlite
      .prepare(`SELECT * FROM consolidation_runs WHERE space_id = ?`)
      .all(SPACE) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    // A different window claims independently.
    const other = claimConsolidationRun(handle.sqlite, SPACE, "2026-01-15", now);
    expect(other.claimed).toBe(true);
  });

  it("reclaim after failure bumps the fence; a finalize guarded by the old fence cannot complete the run", () => {
    const now = new Date();
    const first = claimConsolidationRun(handle.sqlite, SPACE, "2026-01-14", now);
    if (!first.claimed) throw new Error("claim failed");
    handle.sqlite
      .prepare(`UPDATE consolidation_runs SET status = 'failed', error = 'boom' WHERE id = ?`)
      .run(first.runId);
    const second = claimConsolidationRun(handle.sqlite, SPACE, "2026-01-14", now);
    expect(second.claimed).toBe(true);
    if (second.claimed) {
      expect(second.runId).toBe(first.runId);
      expect(second.fence).toBe(2);
    }
    const staleFinalize = handle.sqlite
      .prepare(`UPDATE consolidation_runs SET status = 'completed' WHERE id = ? AND fence = ?`)
      .run(first.runId, 1);
    expect(staleFinalize.changes).toBe(0);
    const row = handle.sqlite
      .prepare(`SELECT status, fence FROM consolidation_runs WHERE id = ?`)
      .get(first.runId) as { status: string; fence: string };
    expect(row.status).toBe("running");
    expect(Number(row.fence)).toBe(2);
  });
});

describe("T-C5: window_date is the space-local window-opening date", () => {
  const prefs: NotifyPreferences = {
    timezone: "America/New_York",
    quietStart: "21:00",
    quietEnd: "04:30",
    digestTime: "06:00",
    dailyProactiveCap: 5,
  };
  it("evening and after-midnight portions share the opening date; outside the window is null", () => {
    // 21:00 EST on Jan 14 = 02:00Z Jan 15.
    expect(consolidationWindowDate(new Date("2026-01-15T02:00:00Z"), prefs)).toBe("2026-01-14");
    // 03:00 EST on Jan 15 = 08:00Z — after midnight, same window.
    expect(consolidationWindowDate(new Date("2026-01-15T08:00:00Z"), prefs)).toBe("2026-01-14");
    // 07:00 EST — outside quiet hours.
    expect(consolidationWindowDate(new Date("2026-01-15T12:00:00Z"), prefs)).toBeNull();
    // 20:59 EST — just before the window.
    expect(consolidationWindowDate(new Date("2026-01-15T01:59:00Z"), prefs)).toBeNull();
  });
});

describe("T-C7: DST transition nights", () => {
  const prefs: NotifyPreferences = {
    timezone: "America/New_York",
    quietStart: "21:00",
    quietEnd: "04:30",
    digestTime: "06:00",
    dailyProactiveCap: 5,
  };
  it("spring-forward (2026-03-08) and fall-back (2026-11-01) keep the opening-date math", () => {
    // Spring forward: 01:30 EST Mar 8 = 06:30Z (clocks jump 02:00→03:00).
    expect(consolidationWindowDate(new Date("2026-03-08T06:30:00Z"), prefs)).toBe("2026-03-07");
    // 03:30 EDT Mar 8 = 07:30Z — still inside the window (ends 04:30).
    expect(consolidationWindowDate(new Date("2026-03-08T07:30:00Z"), prefs)).toBe("2026-03-07");
    // Fall back: first 01:30 (EDT) Nov 1 = 05:30Z.
    expect(consolidationWindowDate(new Date("2026-11-01T05:30:00Z"), prefs)).toBe("2026-10-31");
    // Second 01:30 (EST) Nov 1 = 06:30Z — same window.
    expect(consolidationWindowDate(new Date("2026-11-01T06:30:00Z"), prefs)).toBe("2026-10-31");
    // 05:00 EST Nov 1 = 10:00Z — window closed.
    expect(consolidationWindowDate(new Date("2026-11-01T10:00:00Z"), prefs)).toBeNull();
  });
});

describe("T-C6/T-C39: skip and freeze short-circuits", () => {
  it("w3_enabled = 0 skips with no run row", async () => {
    setMeta({ w3_enabled: 0 });
    const out = await runConsolidation(handle, SPACE, { force: true });
    expect(out).toEqual({ status: "skipped", reason: "w3_disabled" });
    const n = handle.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM consolidation_runs WHERE space_id = ?`)
      .get(SPACE) as { n: number };
    expect(n.n).toBe(0);
  });

  it("w3_frozen = 1 short-circuits with no run row", async () => {
    setMeta({ w3_frozen: 1 });
    const out = await runConsolidation(handle, SPACE, { force: true });
    expect(out).toEqual({ status: "frozen", reason: "w3_frozen" });
    const n = handle.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM consolidation_runs WHERE space_id = ?`)
      .get(SPACE) as { n: number };
    expect(n.n).toBe(0);
  });
});

/* ---------------- run lifecycle (T-C9–T-C13, T-C15) ---------------- */

function samsoniteExtractor(ids: number[]) {
  return async () => [
    {
      content: "works at Samsonite warehouse",
      slot: "belief",
      topicLabels: ["work"],
      route: "self" as const,
      episodeIds: ids,
    },
  ];
}

describe("T-C9/T-C10/T-C13: happy path, idempotence, counters", () => {
  it("completes, proposes the consolidated entry, advances the date, counters exact; approval writes it via the boundary", async () => {
    const e1 = seedEpisode("conv:a");
    const e2 = seedEpisode("conv:b");
    const out = await runConsolidation(handle, SPACE, {
      force: true,
      now: new Date(),
      extractor: samsoniteExtractor([e1, e2]),
    });
    expect(out.status).toBe("completed");
    if (out.status !== "completed") return;
    // Phase 4: the run PROPOSES instead of applying — no entry yet, one
    // pending brain_dedup proposal covering both episodes, and no outcome
    // rows (distill marks episodes processed in-memory only).
    expect(out.phases.distillation?.proposed).toBe(2);
    expect(out.consolidationsWritten).toBe(0);
    const none = handle.sqlite
      .prepare(`SELECT * FROM user_model WHERE space_id = ? AND origin = 'consolidated'`)
      .get(SPACE);
    expect(none).toBeUndefined();
    expect(
      handle.sqlite
        .prepare(`SELECT COUNT(*) AS n FROM consolidation_episodes WHERE space_id = ?`)
        .get(SPACE) as { n: number },
    ).toEqual({ n: 0 });
    // Approval through the rail replays the boundary insert.
    await approvePendingDedup();
    const entry = handle.sqlite
      .prepare(`SELECT * FROM user_model WHERE space_id = ? AND origin = 'consolidated'`)
      .get(SPACE) as Record<string, unknown>;
    expect(entry).toBeDefined();
    expect(entry.content).toBe("works at Samsonite warehouse");
    // §4.4: two fresh independent groups → strength = 1-(1-0.34)^2 ≈ 0.5644;
    // confidence = min(0.69, 0.30 + 0.39*strength) ≈ 0.52.
    expect(Number(entry.evidence_strength)).toBeCloseTo(0.5644, 2);
    expect(Number(entry.confidence)).toBeCloseTo(0.3 + 0.39 * 0.5644, 2);
    expect(Number(entry.confidence)).toBeLessThanOrEqual(0.69);
    // Bookkeeping rows exist with the group set recorded.
    const book = handle.sqlite
      .prepare(`SELECT * FROM consolidation_episodes WHERE space_id = ? ORDER BY episode_id`)
      .all(SPACE) as Record<string, unknown>[];
    expect(book).toHaveLength(2);
    expect(book[0]!.outcome).toBe("consolidated");
    expect(book[0]!.resulting_entry_id).toBe(entry.id);
    expect(JSON.parse(book[0]!.evidence_group_set as string)).toEqual(["conv:a", "conv:b"]);
    // Counters exact (run-time: proposed, not written).
    expect(out.llmCalls).toBe(1);
    expect(out.itemsProcessed).toBe(2); // two distillation candidates
    const runRow = handle.sqlite
      .prepare(`SELECT * FROM consolidation_runs WHERE id = ?`)
      .get(out.runId) as Record<string, unknown>;
    expect(runRow.status).toBe("completed");
    expect(runRow.consolidations_written).toBe(0);
    expect(runRow.llm_calls).toBe(1);
    expect(runRow.items_processed).toBe(out.itemsProcessed);
    expect(meta().last_consolidation_date).toBe(out.windowDate);

    // T-C10: a second claim for the same window is already_ran; nothing duplicates.
    const again = await runConsolidation(handle, SPACE, {
      force: true,
      now: new Date(),
      extractor: samsoniteExtractor([e1, e2]),
    });
    expect(again).toEqual({ status: "skipped", reason: "already_ran" });
    const entries = handle.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM user_model WHERE space_id = ? AND origin = 'consolidated'`)
      .get(SPACE) as { n: number };
    expect(entries.n).toBe(1);
    const runs = handle.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM consolidation_runs WHERE space_id = ?`)
      .get(SPACE) as { n: number };
    expect(runs.n).toBe(1);
  });
});

describe("T-C11/T-C12: phase failure aborts; next window re-enters safely", () => {
  it("a throwing phase marks the run failed with the error recorded, date unchanged; the reclaim completes", async () => {
    const e1 = seedEpisode("conv:a");
    const e2 = seedEpisode("conv:b");
    // Sabotage Phase A's world: user_model vanishes after boot.
    handle.sqlite.exec(`ALTER TABLE user_model RENAME TO user_model_gone`);
    const failed = await runConsolidation(handle, SPACE, {
      force: true,
      extractor: samsoniteExtractor([e1, e2]),
    });
    expect(failed.status).toBe("failed");
    if (failed.status === "failed") expect(failed.error).toBeTruthy();
    const runRow = handle.sqlite
      .prepare(`SELECT * FROM consolidation_runs WHERE space_id = ?`)
      .get(SPACE) as Record<string, unknown>;
    expect(runRow.status).toBe("failed");
    expect(runRow.error).toBeTruthy();
    expect(meta().last_consolidation_date).toBeNull();
    // Repair and re-enter the SAME window (same force date): reclaim
    // bumps the fence and the run completes.
    handle.sqlite.exec(`ALTER TABLE user_model_gone RENAME TO user_model`);
    const ok = await runConsolidation(handle, SPACE, {
      force: true,
      extractor: samsoniteExtractor([e1, e2]),
    });
    expect(ok.status).toBe("completed");
    const row2 = handle.sqlite
      .prepare(`SELECT * FROM consolidation_runs WHERE space_id = ?`)
      .get(SPACE) as Record<string, unknown>;
    expect(Number(row2.fence)).toBe(2); // fence is a TEXT column (M1 schema)
    expect(meta().last_consolidation_date).not.toBeNull();
  });
});

describe("T-C15: budget exhaustion → aborted_budget, date not advanced", () => {
  it("budget 0 with an extractor configured and candidates waiting: extractor never runs, status aborted_budget", async () => {
    setMeta({ w3_llm_budget: 0 });
    seedEpisode("conv:a");
    seedEpisode("conv:b");
    let extractorCalled = false;
    const out = await runConsolidation(handle, SPACE, {
      force: true,
      extractor: async () => {
        extractorCalled = true;
        return [];
      },
    });
    expect(extractorCalled).toBe(false);
    expect(out.status).toBe("aborted_budget");
    if (out.status === "aborted_budget") expect(out.llmCalls).toBe(0);
    expect(meta().last_consolidation_date).toBeNull();
  });
});

describe("T-C8: W3 state is independent of the dream cycle's state", () => {
  it("a W3 run does not touch last_dream_date or create belief nodes", async () => {
    setMeta({ last_dream_date: "2026-01-01" });
    const out = await runConsolidation(handle, SPACE, { force: true });
    expect(out.status).toBe("completed");
    expect(meta().last_dream_date).toBe("2026-01-01");
    expect(meta().last_consolidation_date).not.toBeNull();
    const beliefs = handle.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM nodes WHERE space_id = ? AND kind = 'belief'`)
      .get(SPACE) as { n: number };
    expect(beliefs.n).toBe(0);
  });
});

/* ---------------- access telemetry & decay (T-C16–T-C18, T-C44) ---------------- */

describe("T-C16: access telemetry", () => {
  it("recordAccess coalesces to ≤1 write per entity per hour; getUserModel and episodeSearch record their hits", async () => {
    const t0 = Date.now();
    recordAccess(handle.sqlite, "episode", 4242, new Date(t0));
    recordAccess(handle.sqlite, "episode", 4242, new Date(t0 + 30 * 60_000));
    expect(getAccessStat(handle.sqlite, "episode", 4242).accessCount).toBe(1);
    recordAccess(handle.sqlite, "episode", 4242, new Date(t0 + 61 * 60_000));
    expect(getAccessStat(handle.sqlite, "episode", 4242).accessCount).toBe(2);

    // getUserModel serving read records the served entry.
    const E = seedEpisode("conv:acc");
    const stated = recordStated(handle, SPACE, "belief", "works at Samsonite warehouse", ev(E));
    const served = getUserModel(handle, SPACE);
    expect(served.map((s) => s.id)).toContain(stated.id);
    expect(getAccessStat(handle.sqlite, "user_model_entry", stated.id).accessCount).toBeGreaterThanOrEqual(1);

    // episodeSearch serving read records the served episode.
    const vec = new Float32Array(EMBED_DIM);
    vec[0] = 1;
    handle.sqlite
      .prepare(`INSERT INTO vec_episodes (episode_id, embedding) VALUES (?, ?)`)
      .run(BigInt(E), Buffer.from(vec.buffer));
    const hits = episodeSearch(handle, SPACE, vec, 5);
    expect(hits.map((h) => h.episodeId)).toContain(E);
    expect(getAccessStat(handle.sqlite, "episode", E).accessCount).toBeGreaterThanOrEqual(1);
  });
});

describe("T-C17/T-C18: decay weights and exclusion-before-decay", () => {
  it("half-lives by kind; stated never decays; access refresh resets the clock; invalidated rows are excluded before decay", () => {
    const now = new Date();
    const mk = (over: Partial<Parameters<typeof decayWeight>[0]>) => ({
      entityType: "user_model" as const,
      validAt: aged(0),
      ...over,
    });
    // Episodes: 7-day half-life.
    expect(decayWeight({ entityType: "episode", validAt: aged(7) }, now)).toBeCloseTo(0.5, 5);
    expect(decayWeight({ entityType: "episode", validAt: aged(14) }, now)).toBeCloseTo(0.25, 5);
    // desire: 90-day. belief: 180-day.
    expect(decayWeight(mk({ slot: "desire", validAt: aged(90) }), now)).toBeCloseTo(0.5, 5);
    expect(decayWeight(mk({ slot: "belief", validAt: aged(180) }), now)).toBeCloseTo(0.5, 5);
    // constraint: never decays.
    expect(decayWeight(mk({ slot: "constraint", validAt: aged(3650) }), now)).toBe(1);
    // Stated origin: never decays regardless of slot or age.
    expect(decayWeight(mk({ slot: "emotion_state", origin: "stated", validAt: aged(365) }), now)).toBe(1);
    // Access refresh resets the clock: an old belief accessed today has weight ~1.
    expect(
      decayWeight(mk({ slot: "belief", validAt: aged(180), lastAccessedAt: iso(Date.now()) }), now),
    ).toBeCloseTo(1, 2);

    // Exclusion before decay: invalidated rows never reach ranking —
    // getUserModel (the serving read) returns current rows only.
    const E = seedEpisode("conv:decay");
    const dead = umInsert({
      content: "an invalidated belief",
      origin: "inferred",
      topics: ["misc"],
    });
    handle.sqlite
      .prepare(`UPDATE user_model SET invalid_at = ?, invalid_reason = 'superseded' WHERE id = ?`)
      .run(iso(Date.now()), dead);
    const alive = recordStated(handle, SPACE, "belief", "works at Samsonite warehouse", ev(E));
    const served = getUserModel(handle, SPACE);
    expect(served.map((s) => s.id)).toContain(alive.id);
    expect(served.map((s) => s.id)).not.toContain(dead);
  });
});

describe("T-C44: retrieval reads never write belief/episode rows", () => {
  it("user_model and episodes are byte-identical after serving reads (access_stats is the only write)", () => {
    const E = seedEpisode("conv:t44");
    recordStated(handle, SPACE, "belief", "works at Samsonite warehouse", ev(E));
    const dump = () =>
      JSON.stringify({
        um: handle.sqlite.prepare(`SELECT * FROM user_model ORDER BY id`).all(),
        ep: handle.sqlite.prepare(`SELECT * FROM episodes ORDER BY id`).all(),
      });
    const before = dump();
    getUserModel(handle, SPACE);
    getUserModel(handle, SPACE, { slot: "belief" });
    expect(dump()).toBe(before);
  });
});

/* ---------------- filing, claims, legacy (T-C21, T-C27, T-C28) ---------------- */

describe("T-C27: pair uniqueness at filing", () => {
  it("the same pair filed twice (either order) yields one record; a pair sharing one side is distinct", () => {
    const a = umInsert({ content: "works at Samsonite warehouse", origin: "consolidated", createdAt: aged(2) });
    const b = umInsert({ content: "does not work at Samsonite warehouse", origin: "consolidated", createdAt: aged(1) });
    const c = umInsert({ content: "the fee is $85", origin: "consolidated", createdAt: aged(1) });
    const first = fileContradiction(handle.sqlite, SPACE, {
      domain: "user_model", oldKind: "user_model", oldId: a, newKind: "user_model", newId: b,
      category: "factual_update", reportedBy: "knowledge_check",
    });
    expect(first.created).toBe(true);
    const dupe = fileContradiction(handle.sqlite, SPACE, {
      domain: "user_model", oldKind: "user_model", oldId: b, newKind: "user_model", newId: a,
      category: "factual_update", reportedBy: "consolidation",
    });
    expect(dupe.created).toBe(false);
    expect(dupe.id).toBe(first.id);
    const other = fileContradiction(handle.sqlite, SPACE, {
      domain: "user_model", oldKind: "user_model", oldId: a, newKind: "user_model", newId: c,
      category: "factual_update", reportedBy: "knowledge_check",
    });
    expect(other.created).toBe(true);
    expect(other.id).not.toBe(first.id);
  });
});

describe("T-C21: stale claimed records are claimable by a later run", () => {
  it("an expired lease with an older fence releases the record; the same fence cannot reclaim it", () => {
    const a = umInsert({ content: "works at Samsonite warehouse", origin: "consolidated", createdAt: aged(2) });
    const b = umInsert({ content: "does not work at Samsonite warehouse", origin: "stated", createdAt: aged(1) });
    const { id } = fileContradiction(handle.sqlite, SPACE, {
      domain: "user_model", oldKind: "user_model", oldId: a, newKind: "user_model", newId: b,
      category: "factual_update", reportedBy: "knowledge_check",
    });
    const now = new Date();
    const claim1 = claimContradictions(handle.sqlite, SPACE, 501, 5, now);
    expect(claim1.map((r) => r.id)).toContain(id);
    // Lease expires (crashed run).
    handle.sqlite
      .prepare(`UPDATE contradictions SET lease_expires_at = ? WHERE id = ?`)
      .run(iso(Date.now() - 60_000), id);
    // Same fence cannot reclaim; a newer fence can.
    expect(claimContradictions(handle.sqlite, SPACE, 502, 5, now).map((r) => r.id)).not.toContain(id);
    const claim2 = claimContradictions(handle.sqlite, SPACE, 503, 6, now);
    expect(claim2.map((r) => r.id)).toContain(id);
    expect(Number(contradictionRow(id).claim_fence)).toBe(6);
  });
});

describe("T-C28: legacy potential_contradiction rows retire, never retro-file", () => {
  it("first run appends exactly one legacy_moot marker; no contradictions are created from legacy rows", async () => {
    for (let i = 0; i < 2; i++) {
      handle.sqlite
        .prepare(
          `INSERT INTO agent_logs (space_id, agent, action, description, targets, result)
           VALUES (?, 'soumaya', 'potential_contradiction', ?, ?, 'pending_w3')`,
        )
        .run(SPACE, `potential_contradiction old_node_id=${100 + i} why=ambiguous_flag`, JSON.stringify({ old_id: 100 + i }));
    }
    expect(retireLegacyContradictions(handle.sqlite, SPACE)).toBe(2);
    expect(retireLegacyContradictions(handle.sqlite, SPACE)).toBe(0);
    const markers = handle.sqlite
      .prepare(`SELECT * FROM agent_logs WHERE space_id = ? AND action = 'w3_legacy_retired'`)
      .all(SPACE) as Record<string, unknown>[];
    expect(markers).toHaveLength(1);
    expect(markers[0]!.result).toBe("legacy_moot");
    const originals = handle.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM agent_logs WHERE space_id = ? AND result = 'pending_w3'`)
      .get(SPACE) as { n: number };
    expect(originals.n).toBe(2); // append-only: originals untouched
    const contra = handle.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM contradictions WHERE space_id = ?`)
      .get(SPACE) as { n: number };
    expect(contra.n).toBe(0);
    const out = await runConsolidation(handle, SPACE, { force: true });
    expect(out.status).toBe("completed");
  });
});

describe("T-C29: lineage backfill is wired into the run", () => {
  it("a NULL-lineage episode with a recoverable transcript ref gains its key; unrecoverable stays NULL", async () => {
    const recoverable = seedEpisode(undefined, undefined, "backfill target one");
    const stuck = seedEpisode(undefined, undefined, "backfill target two");
    const before = handle.sqlite
      .prepare(`SELECT lineage_key FROM episodes WHERE id IN (?, ?) ORDER BY id`)
      .all(recoverable, stuck) as { lineage_key: string | null }[];
    expect(before[0]!.lineage_key).toBeNull();
    handle.sqlite
      .prepare(
        `INSERT INTO episode_enrichments (episode_id, space_id, version, detail, source_transcript_ref)
         VALUES (?, ?, 1, 'detail', 'conv:sess-backfill:turn:3')`,
      )
      .run(recoverable, SPACE);
    const out = await runConsolidation(handle, SPACE, { force: true });
    expect(out.status).toBe("completed");
    const rows = handle.sqlite
      .prepare(`SELECT id, lineage_key, lineage_basis FROM episodes WHERE id IN (?, ?) ORDER BY id`)
      .all(recoverable, stuck) as { id: number; lineage_key: string | null; lineage_basis: string | null }[];
    // Backfill stores the full per-turn ref — the same key shape
    // capture-time derivation mints (conv:<session>:turn:<turn>).
    expect(rows[0]!.lineage_key).toBe("conv:sess-backfill:turn:3");
    expect(rows[1]!.lineage_key).toBeNull();
  });
});

/* ---------------- decision table (T-C30–T-C38, T-C60, T-C62, T-C63) ---------------- */

describe("T-C34: cell 1 — same proposition, compatible", () => {
  it("resolves 'compatible' with no mutation and no inquiry", async () => {
    const a = umInsert({ content: "works at Samsonite warehouse", origin: "consolidated", createdAt: aged(2) });
    const b = umInsert({ content: "works at Samsonite warehouse", origin: "consolidated", createdAt: aged(1) });
    const { id } = fileContradiction(handle.sqlite, SPACE, {
      domain: "user_model", oldKind: "user_model", oldId: a, newKind: "user_model", newId: b,
      category: "duplicate_claim", reportedBy: "knowledge_check",
    });
    await adjudicateOnce();
    expect(resolutionOf(id)).toEqual({ outcome: "compatible", rule_applied: "#1" });
    expect(umRow(a).invalid_at).toBeNull();
    expect(umRow(b).invalid_at).toBeNull();
    expect(inquiriesFor(id)).toHaveLength(0);
  });
});

describe("T-C35: cell 2 — nodes, both system, newer wins via the W1 writer", () => {
  it("the older node is superseded by the newer with reason 'update' and a system corrections row", async () => {
    const older = nodeInsert({ label: "job", content: "works at Samsonite warehouse", importance: 0.4, createdAt: aged(2) });
    const newer = nodeInsert({ label: "job", content: "does not work at Samsonite warehouse", importance: 0.9, createdAt: aged(1) });
    const { id } = fileContradiction(handle.sqlite, SPACE, {
      domain: "nodes", oldKind: "node", oldId: older, newKind: "node", newId: newer,
      category: "factual_update", reportedBy: "temporal_propose",
    });
    await adjudicateOnce();
    expect(resolutionOf(id)).toEqual({ outcome: "newer_wins", rule_applied: "#2" });
    const oldRow = nodeRow(older);
    expect(oldRow.superseded_at).not.toBeNull();
    expect(oldRow.superseded_by).toBe(newer);
    expect(oldRow.supersede_reason).toBe("update");
    const corr = handle.sqlite
      .prepare(`SELECT * FROM corrections WHERE node_id = ?`)
      .get(older) as Record<string, unknown>;
    expect(corr.corrected_by).toBe("system");
    expect(nodeRow(newer).superseded_at).toBeNull();
  });
});

describe("T-C36: cell 3 — nodes, older strictly stronger", () => {
  it("older retained: no mutation, older flagged for review via audit", async () => {
    const older = nodeInsert({ label: "job", content: "works at Samsonite warehouse", importance: 0.9, createdAt: aged(2) });
    const newer = nodeInsert({ label: "job", content: "does not work at Samsonite warehouse", importance: 0.4, createdAt: aged(1) });
    const { id } = fileContradiction(handle.sqlite, SPACE, {
      domain: "nodes", oldKind: "node", oldId: older, newKind: "node", newId: newer,
      category: "factual_update", reportedBy: "temporal_propose",
    });
    await adjudicateOnce();
    expect(resolutionOf(id)).toEqual({ outcome: "older_retained", rule_applied: "#3" });
    expect(nodeRow(older).superseded_at).toBeNull();
    expect(nodeRow(newer).superseded_at).toBeNull();
    const flags = handle.sqlite
      .prepare(`SELECT * FROM agent_logs WHERE space_id = ? AND action = 'w3_flagged_for_review'`)
      .all(SPACE) as Record<string, unknown>[];
    expect(flags).toHaveLength(1);
    expect(JSON.parse(flags[0]!.targets as string).node_id).toBe(older);
  });
});

describe("T-C37/T-C30: cell 6 — stated older, consolidated newer; inquiry idempotence", () => {
  it("consolidated flagged contradiction_pending, stated untouched, exactly one inquiry ever", async () => {
    const stated = umInsert({ content: "works at Samsonite warehouse", origin: "stated", createdAt: aged(3), validAt: aged(3) });
    const cons = umInsert({ content: "does not work at Samsonite warehouse", origin: "consolidated", createdAt: aged(1), validAt: aged(1) });
    const { id } = fileContradiction(handle.sqlite, SPACE, {
      domain: "user_model", oldKind: "user_model", oldId: stated, newKind: "user_model", newId: cons,
      category: "factual_update", reportedBy: "knowledge_check",
    });
    await adjudicateOnce();
    expect(resolutionOf(id)).toEqual({ outcome: "unresolved_flagged", rule_applied: "#6" });
    expect(umRow(cons).review_flag).toBe("contradiction_pending");
    expect(umRow(cons).invalid_at).toBeNull();
    expect(umRow(stated).invalid_at).toBeNull();
    expect(umRow(stated).review_flag).toBeNull();
    const inqs = inquiriesFor(id);
    expect(inqs).toHaveLength(1);
    expect(inqs[0]!.status).toBe("open");
    expect(inqs[0]!.kind).toBe("contradiction");
    // A second adjudication pass creates no second inquiry (record is
    // resolved; the pair is never re-filed while the first stands).
    await adjudicateOnce();
    expect(inquiriesFor(id)).toHaveLength(1);
  });
});

describe("T-C38: cell 7 — stated newer wins over consolidated older", () => {
  it("consolidated invalidated with reason 'stated_conflict'; stated untouched; no inquiry", async () => {
    const cons = umInsert({ content: "does not work at Samsonite warehouse", origin: "consolidated", createdAt: aged(3), validAt: aged(3) });
    const stated = umInsert({ content: "works at Samsonite warehouse", origin: "stated", createdAt: aged(1), validAt: aged(1) });
    const { id } = fileContradiction(handle.sqlite, SPACE, {
      domain: "user_model", oldKind: "user_model", oldId: cons, newKind: "user_model", newId: stated,
      category: "factual_update", reportedBy: "knowledge_check",
    });
    await adjudicateOnce();
    expect(resolutionOf(id)).toEqual({ outcome: "stated_wins_newer", rule_applied: "#7" });
    expect(umRow(cons).invalid_at).not.toBeNull();
    expect(umRow(cons).invalid_reason).toBe("stated_conflict");
    expect(umRow(stated).invalid_at).toBeNull();
    expect(inquiriesFor(id)).toHaveLength(0);
  });
});

describe("T-C60: cell 7b — the user's correction lands mid-claim and prevails", () => {
  it("consolidated invalidated 'stated_conflict' under rule #7b, with an inquiry", async () => {
    const E = seedEpisode("conv:7b");
    const cons = umInsert({ content: "does not work at Samsonite warehouse", origin: "consolidated", createdAt: aged(3), validAt: aged(3) });
    const stated = recordStated(handle, SPACE, "belief", "works at Samsonite warehouse", ev(E));
    const { id } = fileContradiction(handle.sqlite, SPACE, {
      domain: "user_model", oldKind: "user_model", oldId: cons, newKind: "user_model", newId: stated.id,
      category: "factual_update", reportedBy: "knowledge_check",
    });
    // Run 501 claims the record, then the user corrects the stated row
    // before the decision is applied.
    const claimed = claimContradictions(handle.sqlite, SPACE, 501, 1, new Date());
    expect(claimed.map((r) => r.id)).toContain(id);
    correctUserModel(handle, SPACE, stated.id, {
      text: "no — I work at Samsonite, I confirmed it",
      type: "factual_update",
      newContent: "works at Samsonite warehouse in Jacksonville",
      evidence: ev(E),
    });
    // The crashed claim's lease expires; run 502 (higher fence) reclaims
    // and finds the stated side replaced → race shape.
    handle.sqlite
      .prepare(`UPDATE contradictions SET lease_expires_at = ? WHERE id = ?`)
      .run(iso(Date.now() - 60_000), id);
    await runAdjudication(handle, {
      boundary: { spaceId: SPACE, runId: 502 },
      runId: 502,
      fence: 2,
      now: new Date(),
    });
    expect(resolutionOf(id)).toEqual({ outcome: "stated_wins_race", rule_applied: "#7b" });
    expect(umRow(cons).invalid_reason).toBe("stated_conflict");
    expect(inquiriesFor(id)).toHaveLength(1);
  });
});

describe("T-C62: cells 9 and 10 — both sides stated, both domains", () => {
  it("user_model: no mutation, inquiry created, outcome unresolved_asked", async () => {
    const a = umInsert({ content: "works at Samsonite warehouse", origin: "stated", createdAt: aged(2) });
    const b = umInsert({ content: "does not work at Samsonite warehouse", origin: "stated", createdAt: aged(1) });
    const { id } = fileContradiction(handle.sqlite, SPACE, {
      domain: "user_model", oldKind: "user_model", oldId: a, newKind: "user_model", newId: b,
      category: "factual_update", reportedBy: "knowledge_check",
    });
    await adjudicateOnce();
    expect(resolutionOf(id)).toEqual({ outcome: "unresolved_asked", rule_applied: "#9" });
    expect(umRow(a).invalid_at).toBeNull();
    expect(umRow(b).invalid_at).toBeNull();
    expect(inquiriesFor(id)).toHaveLength(1);
  });

  it("nodes: no mutation, inquiry created, outcome unresolved_asked", async () => {
    const a = nodeInsert({ label: "job", content: "works at Samsonite warehouse", createdAt: aged(2) });
    const b = nodeInsert({ label: "job", content: "does not work at Samsonite warehouse", createdAt: aged(1) });
    for (const n of [a, b]) {
      handle.sqlite
        .prepare(
          `INSERT INTO corrections (space_id, node_id, correction_type, corrected_at, corrected_by, superseding_node_id)
           VALUES (?, ?, 'factual_update', ?, 'user', NULL)`,
        )
        .run(SPACE, n, aged(1));
    }
    const { id } = fileContradiction(handle.sqlite, SPACE, {
      domain: "nodes", oldKind: "node", oldId: a, newKind: "node", newId: b,
      category: "factual_update", reportedBy: "temporal_propose",
    });
    await adjudicateOnce();
    expect(resolutionOf(id)).toEqual({ outcome: "unresolved_asked", rule_applied: "#10" });
    expect(nodeRow(a).superseded_at).toBeNull();
    expect(nodeRow(b).superseded_at).toBeNull();
    expect(inquiriesFor(id)).toHaveLength(1);
  });
});

describe("T-C63: cell 5 — nodes, stated older vs system newer", () => {
  it("stated stands, no currency mutation, user asked", async () => {
    const statedNode = nodeInsert({ label: "job", content: "works at Samsonite warehouse", createdAt: aged(2) });
    const systemNode = nodeInsert({ label: "job", content: "does not work at Samsonite warehouse", createdAt: aged(1) });
    handle.sqlite
      .prepare(
        `INSERT INTO corrections (space_id, node_id, correction_type, corrected_at, corrected_by, superseding_node_id)
         VALUES (?, ?, 'factual_update', ?, 'user', NULL)`,
      )
      .run(SPACE, statedNode, aged(2));
    const { id } = fileContradiction(handle.sqlite, SPACE, {
      domain: "nodes", oldKind: "node", oldId: statedNode, newKind: "node", newId: systemNode,
      category: "factual_update", reportedBy: "temporal_propose",
    });
    await adjudicateOnce();
    expect(resolutionOf(id)).toEqual({ outcome: "unresolved_user_confirmed", rule_applied: "#5" });
    expect(nodeRow(statedNode).superseded_at).toBeNull();
    expect(nodeRow(systemNode).superseded_at).toBeNull();
    expect(inquiriesFor(id)).toHaveLength(1);
  });
});

describe("T-C31: moot — a side resolved elsewhere before adjudication", () => {
  it("record resolves 'moot' with no inquiry and no further mutation", async () => {
    const a = umInsert({ content: "works at Samsonite warehouse", origin: "consolidated", createdAt: aged(2) });
    const b = umInsert({ content: "does not work at Samsonite warehouse", origin: "consolidated", createdAt: aged(1) });
    const { id } = fileContradiction(handle.sqlite, SPACE, {
      domain: "user_model", oldKind: "user_model", oldId: a, newKind: "user_model", newId: b,
      category: "factual_update", reportedBy: "knowledge_check",
    });
    // Another writer invalidates side a first (via the boundary).
    const res = await applyConsolidationMutation(
      handle.sqlite,
      { spaceId: SPACE },
      { kind: "InvalidateEntry", entryId: a, reason: "superseded" },
    );
    expect(res.status).toBe("applied");
    await adjudicateOnce();
    expect(resolutionOf(id).outcome).toBe("moot");
    expect(inquiriesFor(id)).toHaveLength(0);
    expect(umRow(b).invalid_at).toBeNull();
  });
});

describe("T-C32/T-C33: cell 0 deferral — bounded, non-blocking", () => {
  it("an indeterminate-relation record defers with deferred_until, sides untouched; after the budget it resolves unresolved with an inquiry; other records in the same pass still decide", async () => {
    // Ambiguous band: token jaccard ≈ 0.6, no deterministic verdict —
    // the relation is indeterminate, so no cell can fire (cell 0).
    const a = umInsert({ content: "works the morning shift at Samsonite", origin: "consolidated", createdAt: aged(2) });
    const b = umInsert({ content: "works the night shift at Samsonite", origin: "consolidated", createdAt: aged(1) });
    const misc = fileContradiction(handle.sqlite, SPACE, {
      domain: "user_model", oldKind: "user_model", oldId: a, newKind: "user_model", newId: b,
      category: "factual_update", reportedBy: "knowledge_check",
    });
    // A decidable record in the same pass (cell 7 shape).
    const cons = umInsert({ content: "the fee is $90", origin: "consolidated", createdAt: aged(3), validAt: aged(3), topics: ["fees"] });
    const stated = umInsert({ content: "the fee is $85", origin: "stated", createdAt: aged(1), validAt: aged(1), topics: ["fees"] });
    const decidable = fileContradiction(handle.sqlite, SPACE, {
      domain: "user_model", oldKind: "user_model", oldId: cons, newKind: "user_model", newId: stated,
      category: "factual_update", reportedBy: "knowledge_check",
    });

    await adjudicateOnce();
    expect(resolutionOf(decidable.id)).toEqual({ outcome: "stated_wins_newer", rule_applied: "#7" });
    const deferred = contradictionRow(misc.id);
    expect(deferred.state).toBe("pending"); // deferral = pending + deferred_until (M1 state vocabulary)
    expect(deferred.attempts).toBe(1);
    const res = JSON.parse(deferred.resolution ?? "{}") as { deferred_until?: string };
    expect(res.deferred_until).toBeTruthy();
    expect(Date.parse(res.deferred_until!)).toBeGreaterThan(Date.now());
    expect(umRow(a).invalid_at).toBeNull();
    expect(umRow(b).invalid_at).toBeNull();

    // Two more deferral cycles exhaust the budget → unresolved + inquiry.
    for (const fence of [2, 3]) {
      handle.sqlite
        .prepare(`UPDATE contradictions SET resolution = ? WHERE id = ?`)
        .run(JSON.stringify({ outcome: "deferred", rule_applied: "#0", deferred_until: iso(Date.now() - 1000) }), misc.id);
      await runAdjudication(handle, {
        boundary: { spaceId: SPACE, runId: 9900 + fence },
        runId: 9900 + fence,
        fence,
        now: new Date(),
      });
    }
    const done = contradictionRow(misc.id);
    expect(done.state).toBe("unresolved");
    expect(resolutionOf(misc.id).outcome).toBe("unresolved_deferred");
    expect(inquiriesFor(misc.id)).toHaveLength(1);
    expect(umRow(a).invalid_at).toBeNull();
    expect(umRow(b).invalid_at).toBeNull();
  });
});

/* ---------------- distillation (T-C20, T-C47–T-C49, T-C51, T-C53, T-C54) ---------------- */

describe("T-C20: abstained bookkeeping", () => {
  it("abstentions are recorded per episode; consolidated episodes leave the candidate set, abstained stay eligible for new evidence", async () => {
    const e1 = seedEpisode("conv:a");
    const e2 = seedEpisode("conv:b");
    const abstain = await runConsolidation(handle, SPACE, {
      force: true,
      extractor: async () => [
        { content: "works at Samsonite warehouse", slot: "belief", topicLabels: ["work"], route: "abstain" as const, episodeIds: [e1, e2] },
      ],
    });
    expect(abstain.status).toBe("completed");
    const rows = handle.sqlite
      .prepare(`SELECT outcome FROM consolidation_episodes WHERE space_id = ? ORDER BY episode_id`)
      .all(SPACE) as { outcome: string }[];
    expect(rows.map((r) => r.outcome)).toEqual(["abstained", "abstained"]);
    expect(selectCandidates(handle.sqlite, SPACE, 50).map((c) => c.episodeId)).toEqual(
      expect.arrayContaining([e1, e2]),
    );
    // Now consolidate them: the run proposes first — the episodes stay
    // eligible (no outcome rows yet) until the owner approves, and only
    // then leave the candidate set.
    const done = await runConsolidation(handle, SPACE, {
      force: true,
      now: new Date(Date.now() + DAY),
      extractor: samsoniteExtractor([e1, e2]),
    });
    expect(done.status).toBe("completed");
    if (done.status === "completed") expect(done.phases.distillation?.proposed).toBe(2);
    expect(selectCandidates(handle.sqlite, SPACE, 50).map((c) => c.episodeId)).toEqual(
      expect.arrayContaining([e1, e2]),
    );
    await approvePendingDedup();
    expect(selectCandidates(handle.sqlite, SPACE, 50)).toHaveLength(0);
  });
});

describe("T-C47: Tier 2 judgment inside a run protects stated beliefs", () => {
  it("a judge reporting contradiction against a covering stated belief blocks the insert; the run still completes", async () => {
    const E = seedEpisode("conv:t47");
    recordStated(handle, SPACE, "belief", "works at Samsonite warehouse", ev(E));
    const e1 = seedEpisode("conv:x");
    const e2 = seedEpisode("conv:y");
    const out = await runConsolidation(handle, SPACE, {
      force: true,
      llmJudge: async () => "contradiction",
      extractor: async () => [
        { content: "unemployed and looking for work", slot: "belief", topicLabels: ["work"], route: "self" as const, episodeIds: [e1, e2] },
      ],
    });
    expect(out.status).toBe("completed");
    if (out.status === "completed") expect(out.consolidationsWritten).toBe(0);
    const n = handle.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM user_model WHERE space_id = ? AND origin = 'consolidated'`)
      .get(SPACE) as { n: number };
    expect(n.n).toBe(0);
  });
});

describe("T-C48: one budget ledger shared by the extractor and Tier 2", () => {
  it("budget 1: the extractor's call exhausts the ledger, Tier 2 rejects at proposal time, total LLM calls = 1, run aborts on budget", async () => {
    setMeta({ w3_llm_budget: 1 });
    const E = seedEpisode("conv:t48");
    recordStated(handle, SPACE, "belief", "works at Samsonite warehouse", ev(E));
    const e1 = seedEpisode("conv:p");
    const e2 = seedEpisode("conv:q");
    let judgeCalls = 0;
    const out = await runConsolidation(handle, SPACE, {
      force: true,
      llmJudge: async () => {
        judgeCalls += 1;
        return "compatible";
      },
      extractor: async () => [
        { content: "unemployed and looking for work", slot: "belief", topicLabels: ["work"], route: "self" as const, episodeIds: [e1, e2] },
      ],
    });
    expect(judgeCalls).toBe(0); // the boundary never spent past the ledger
    // Phase 4 (Tier 2 restoration): the deterministic Tier 2 pass rejects
    // the insert at PROPOSAL time — the same rejection the old auto-apply
    // flow recorded — so no proposal is created, the episodes are counted
    // rejected with no outcome row (staying eligible), and the run aborts
    // on budget exactly as on the pristine tip (rejected > 0 with the
    // ledger empty). Nothing unjudged is proposed or written.
    expect(out.status).toBe("aborted_budget");
    if (out.status === "aborted_budget") {
      expect(out.llmCalls).toBe(1);
      expect(out.phases.distillation?.proposed).toBe(0);
      expect(out.phases.distillation?.rejected).toBe(2);
    }
    const n = handle.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM user_model WHERE space_id = ? AND origin = 'consolidated'`)
      .get(SPACE) as { n: number };
    expect(n.n).toBe(0);
    expect(listProposals(handle.sqlite, SPACE, { kind: "brain_dedup", status: "pending" })).toHaveLength(0);
    // No outcome row for the rejected episodes (they stay eligible).
    // (The seed episode E, which the extractor saw but proposed nothing
    // for, is recorded abstained by the tail loop — as in the old flow.)
    expect(
      handle.sqlite
        .prepare(
          `SELECT COUNT(*) AS n FROM consolidation_episodes WHERE space_id = ? AND episode_id IN (?, ?)`,
        )
        .get(SPACE, e1, e2) as { n: number },
    ).toEqual({ n: 0 });
  });
});

describe("T-C49: w3_max_items overflow defers to the next run", () => {
  it("with cap 2 and 3 eligible episodes, the oldest waits; the next run picks it up", async () => {
    setMeta({ w3_max_items: 2 });
    const t = Date.now();
    const old = seedEpisode("conv:old", iso(t - 3 * DAY), "oldest episode");
    const mid = seedEpisode("conv:mid", iso(t - 2 * DAY), "middle episode");
    const fresh = seedEpisode("conv:new", iso(t - DAY), "newest episode");
    const abstainAll = async (cands: { episodeId: number }[]) => [
      { content: "nothing", slot: "belief", topicLabels: [], route: "abstain" as const, episodeIds: cands.map((c) => c.episodeId) },
    ];
    const first = await runConsolidation(handle, SPACE, {
      force: true,
      now: new Date(t),
      extractor: abstainAll as never,
    });
    expect(first.status).toBe("completed");
    const processed = handle.sqlite
      .prepare(`SELECT episode_id FROM consolidation_episodes WHERE space_id = ? ORDER BY episode_id`)
      .all(SPACE) as { episode_id: number }[];
    expect(processed.map((p) => p.episode_id).sort()).toEqual([mid, fresh].sort());
    const second = await runConsolidation(handle, SPACE, {
      force: true,
      now: new Date(t + DAY),
      extractor: abstainAll as never,
    });
    expect(second.status).toBe("completed");
    const all = handle.sqlite
      .prepare(`SELECT episode_id FROM consolidation_episodes WHERE space_id = ?`)
      .all(SPACE) as { episode_id: number }[];
    expect(all.map((p) => p.episode_id)).toContain(old);
  });
});

describe("T-C51: world-routed propositions go to the world writer, not user_model", () => {
  it("route 'world' creates via the injected writer and records the node id; no user_model row", async () => {
    const e1 = seedEpisode("conv:w1");
    const e2 = seedEpisode("conv:w2");
    let written = 0;
    const out = await runConsolidation(handle, SPACE, {
      force: true,
      worldWriter: async () => {
        written += 1;
        return 777;
      },
      extractor: async () => [
        { content: "the warehouse is in Jacksonville", slot: "knowledge", topicLabels: ["place"], route: "world" as const, episodeIds: [e1, e2] },
      ],
    });
    expect(out.status).toBe("completed");
    expect(written).toBe(1);
    const book = handle.sqlite
      .prepare(`SELECT outcome, resulting_entry_id FROM consolidation_episodes WHERE space_id = ?`)
      .all(SPACE) as { outcome: string; resulting_entry_id: number }[];
    expect(book).toHaveLength(2);
    expect(book[0]!.outcome).toBe("consolidated");
    expect(book[0]!.resulting_entry_id).toBe(777);
    const n = handle.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM user_model WHERE space_id = ?`)
      .get(SPACE) as { n: number };
    expect(n.n).toBe(0);
  });
});

describe("T-C53/T-C54: strengthening — extractor path and no-LLM template path", () => {
  async function seedConsolidatedEntry(): Promise<number> {
    const s1 = seedEpisode("conv:s1");
    const s2 = seedEpisode("conv:s2");
    const res = await applyConsolidationMutation(
      handle.sqlite,
      { spaceId: SPACE },
      {
        kind: "InsertConsolidated",
        entry: {
          slot: "belief",
          content: "prefers morning shifts at the warehouse",
          evidence: ev(s1),
          topicLabels: ["work"],
          validAt: aged(1),
        },
      },
    );
    if (res.status !== "applied" || res.entryId == null) throw new Error("seed insert failed");
    return res.entryId;
  }

  it("T-C53: a matching proposition AppendEvidence-strengthens the existing entry instead of inserting", async () => {
    const entryId = await seedConsolidatedEntry();
    const before = umRow(entryId);
    const e1 = seedEpisode("conv:n1", undefined, "prefers morning shifts at the warehouse again");
    const e2 = seedEpisode("conv:n2", undefined, "prefers morning shifts at the warehouse confirmed");
    const out = await runConsolidation(handle, SPACE, {
      force: true,
      extractor: async () => [
        { content: "prefers morning shifts at the warehouse", slot: "belief", topicLabels: ["work"], route: "self" as const, episodeIds: [e1, e2] },
      ],
    });
    expect(out.status).toBe("completed");
    // Phase 4: the run proposes the strengthen — the entry is untouched
    // until the owner approves.
    if (out.status === "completed") expect(out.phases.distillation?.proposed).toBe(2);
    const unapproved = umRow(entryId);
    expect(JSON.parse(unapproved.evidence_ids as string)).toEqual(JSON.parse(before.evidence_ids as string));
    expect(Number(unapproved.evidence_strength)).toBe(Number(before.evidence_strength));
    await approvePendingDedup();
    const entries = handle.sqlite
      .prepare(`SELECT * FROM user_model WHERE space_id = ? AND origin = 'consolidated'`)
      .all(SPACE) as Record<string, unknown>[];
    expect(entries).toHaveLength(1); // strengthened, not duplicated
    const after = umRow(entryId);
    const evAfter = JSON.parse(after.evidence_ids as string) as { id: number }[];
    expect(evAfter.map((r) => r.id)).toEqual(expect.arrayContaining([e1, e2]));
    expect(Number(after.evidence_strength)).toBeGreaterThan(Number(before.evidence_strength));
    const book = handle.sqlite
      .prepare(`SELECT outcome FROM consolidation_episodes WHERE space_id = ? AND episode_id IN (?, ?)`)
      .all(SPACE, e1, e2) as { outcome: string }[];
    expect(book.map((b) => b.outcome)).toEqual(["strengthened", "strengthened"]);
  });

  it("T-C54: with no LLM at all, a matching episode strengthens the entry and nothing is created", async () => {
    const entryId = await seedConsolidatedEntry();
    const e1 = seedEpisode("conv:tmpl", undefined, "prefers morning shifts at the warehouse");
    const out = await runConsolidation(handle, SPACE, { force: true });
    expect(out.status).toBe("completed");
    // Phase 4: the template path proposes the strengthen — nothing is
    // applied until the owner approves.
    if (out.status === "completed") expect(out.phases.distillation?.proposed).toBe(1);
    const unapproved = umRow(entryId);
    expect(JSON.parse(unapproved.evidence_ids as string).map((r: { id: number }) => r.id)).not.toContain(e1);
    await approvePendingDedup();
    const after = umRow(entryId);
    const evAfter = JSON.parse(after.evidence_ids as string) as { id: number }[];
    expect(evAfter.map((r) => r.id)).toContain(e1);
    const entries = handle.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM user_model WHERE space_id = ? AND origin = 'consolidated'`)
      .get(SPACE) as { n: number };
    expect(entries.n).toBe(1);
  });
});

/* ---------------- no-LLM run, forget, digest, integrity (T-C41, T-C43, T-C19, T-C40) ---------------- */

describe("T-C41: no-LLM path runs Phases A+B fully (§14)", () => {
  it("sweeps and adjudication complete with no judge and no extractor; distillation creates nothing", async () => {
    // Phase A material: a stale non-stated emotion to expire.
    umInsert({ slot: "emotion_state", content: "felt stressed about money", origin: "inferred", validAt: aged(9), createdAt: aged(9), topics: ["money"] });
    // Phase B material: a cell-7 pair.
    const cons = umInsert({ content: "does not work at Samsonite warehouse", origin: "consolidated", createdAt: aged(3), validAt: aged(3) });
    const stated = umInsert({ content: "works at Samsonite warehouse", origin: "stated", createdAt: aged(1), validAt: aged(1) });
    fileContradiction(handle.sqlite, SPACE, {
      domain: "user_model", oldKind: "user_model", oldId: cons, newKind: "user_model", newId: stated,
      category: "factual_update", reportedBy: "knowledge_check",
    });
    seedEpisode("conv:plain");
    const out = await runConsolidation(handle, SPACE, { force: true });
    expect(out.status).toBe("completed");
    const emo = handle.sqlite
      .prepare(`SELECT invalid_reason FROM user_model WHERE space_id = ? AND slot = 'emotion_state'`)
      .get(SPACE) as { invalid_reason: string };
    expect(emo.invalid_reason).toBe("expired");
    expect(umRow(cons).invalid_reason).toBe("stated_conflict");
    if (out.status === "completed") expect(out.consolidationsWritten).toBe(0);
  });
});

describe("T-C43: forget propagation escalates with 'evidence_forgotten'", () => {
  it("an entry whose evidence is entirely forgotten is invalidated 'evidence_forgotten'; partial forget prunes only", async () => {
    const e1 = seedEpisode("conv:f1");
    const e2 = seedEpisode("conv:f2");
    const e3 = seedEpisode("conv:f3");
    const full = await applyConsolidationMutation(handle.sqlite, { spaceId: SPACE }, {
      kind: "InsertConsolidated",
      entry: { slot: "belief", content: "works at Samsonite warehouse", evidence: [...ev(e1), ...ev(e2)], topicLabels: ["work"], validAt: aged(1) },
    });
    const partial = await applyConsolidationMutation(handle.sqlite, { spaceId: SPACE }, {
      kind: "InsertConsolidated",
      entry: { slot: "belief", content: "prefers morning shifts at the warehouse", evidence: [...ev(e1), ...ev(e3)], topicLabels: ["work"], validAt: aged(1) },
    });
    if (full.status !== "applied" || partial.status !== "applied") throw new Error("seed failed");
    // The forget lands (episode side of applyForgetRequest).
    handle.sqlite.prepare(`UPDATE episodes SET forgotten_at = ? WHERE id IN (?, ?)`).run(iso(Date.now()), e1, e2);
    const out = await runConsolidation(handle, SPACE, { force: true });
    expect(out.status).toBe("completed");
    expect(umRow(full.entryId!).invalid_reason).toBe("evidence_forgotten");
    const p = umRow(partial.entryId!);
    expect(p.invalid_at).toBeNull();
    const refs = JSON.parse(p.evidence_ids as string) as { id: number }[];
    expect(refs.map((r) => r.id)).toEqual([e3]);
  });
});

describe("T-C19: the digest line renders only when a run changed something", () => {
  it("zero-change run → no line; a consolidating run → the quiet factual line appears once approved", async () => {
    const quiet = await runConsolidation(handle, SPACE, { force: true });
    expect(quiet.status).toBe("completed");
    const d1 = buildDailyDigest(handle, SPACE);
    expect(d1.closing).not.toContain("Overnight I");

    const e1 = seedEpisode("conv:d1");
    const e2 = seedEpisode("conv:d2");
    const loud = await runConsolidation(handle, SPACE, {
      force: true,
      now: new Date(Date.now() + DAY),
      extractor: samsoniteExtractor([e1, e2]),
    });
    expect(loud.status).toBe("completed");
    // Phase 4: the run only proposes — the digest must not claim a
    // consolidation the owner has not approved yet.
    if (loud.status === "completed") expect(loud.phases.distillation?.proposed).toBe(2);
    const d2 = buildDailyDigest(handle, SPACE);
    expect(d2.closing).not.toContain("Overnight I");
    await approvePendingDedup();
    const d3 = buildDailyDigest(handle, SPACE);
    expect(d3.closing).toContain("Overnight I consolidated 1 new belief");
  });
});

describe("T-C40: a stated-row mutation bypassing every writer freezes the space (§9.4)", () => {
  it("integrity mismatch at finalize: freeze + alert audit + run failed with the incident class; no rollback claimed", async () => {
    const E = seedEpisode("conv:i0");
    recordStated(handle, SPACE, "belief", "works at Samsonite warehouse", ev(E));
    const e1 = seedEpisode("conv:i1");
    const e2 = seedEpisode("conv:i2");
    const out = await runConsolidation(handle, SPACE, {
      force: true,
      extractor: async () => {
        // Simulate an unauthorized writer mutating a stated row mid-run.
        handle.sqlite
          .prepare(`UPDATE user_model SET content = 'works at Gopuff' WHERE space_id = ? AND origin = 'stated'`)
          .run(SPACE);
        return [
          { content: "prefers morning shifts at the warehouse", slot: "belief", topicLabels: ["work"], route: "self" as const, episodeIds: [e1, e2] },
        ];
      },
    });
    expect(out.status).toBe("frozen");
    if (out.status === "frozen") expect(out.reason).toBe("stated_integrity_violation");
    expect(meta().w3_frozen).toBe(1);
    const audits = handle.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM agent_logs WHERE space_id = ? AND action = 'w3_stated_integrity_violation'`)
      .get(SPACE) as { n: number };
    expect(audits.n).toBeGreaterThanOrEqual(1);
    const runRow = handle.sqlite
      .prepare(`SELECT status, error FROM consolidation_runs WHERE space_id = ?`)
      .get(SPACE) as { status: string; error: string };
    expect(runRow.status).toBe("failed");
    expect(runRow.error).toBe("stated_integrity_violation");
    expect(meta().last_consolidation_date).toBeNull();
    // The space stays frozen for the next run until an operator unfreezes.
    const next = await runConsolidation(handle, SPACE, { force: true, now: new Date(Date.now() + DAY) });
    expect(next).toEqual({ status: "frozen", reason: "w3_frozen" });
  });
});

describe("T-C26 (D completion): concurrent correction + full run", () => {
  // Design T-C26: "the stated row reflects the correction only; run
  // completes or fails loudly, never silently overwrites." This
  // interleave deterministically takes the loud branch: §9.4's
  // integrity hash covers the whole stated set and cannot distinguish
  // an authorized mid-run correction from a bypass, so finalize
  // freezes the space for operator review — while the correction
  // itself stands, untouched by anything the run does afterwards.
  it("a correction landing mid-run stands alone in the stated row; the run fails loudly (integrity freeze), never silently overwrites", async () => {
    const E = seedEpisode("conv:c26");
    const stated = recordStated(handle, SPACE, "belief", "works at Gopuff", ev(E));
    const e1 = seedEpisode("conv:c26a");
    const e2 = seedEpisode("conv:c26b");
    let correction: { status: string; newEntryId: number | null } | undefined;
    const out = await runConsolidation(handle, SPACE, {
      force: true,
      extractor: async () => {
        // The user corrects the stated row while the run is in flight
        // (authorized path — correctUserModel, mid-run). The utterance
        // names the old employer so §4.6 targeting scores the explicit
        // target as the unique winner (entity match), as in production.
        correction = correctUserModel(handle, SPACE, stated.id, {
          text: "no — I don't work at Gopuff anymore, I work at Samsonite",
          type: "factual_update",
          newContent: "works at Samsonite warehouse",
          evidence: ev(E),
        });
        // The extractor, working from pre-correction captures, proposes
        // the OLD proposition as a consolidated belief.
        return [
          { content: "works at Gopuff", slot: "belief", topicLabels: ["work"], route: "self" as const, episodeIds: [e1, e2] },
        ];
      },
    });
    // The interleave really happened (no silent abstention), and the
    // run fails loudly: integrity freeze, date not advanced.
    expect(correction?.status).toBe("applied");
    expect(out.status).toBe("frozen");
    if (out.status === "frozen") expect(out.reason).toBe("stated_integrity_violation");
    expect(meta().w3_frozen).toBe(1);
    expect(meta().last_consolidation_date).toBeNull();
    // The current stated set reflects the correction only: exactly one
    // current stated row, and it is the correction's own replacement.
    const current = handle.sqlite
      .prepare(
        `SELECT id, content FROM user_model
         WHERE space_id = ? AND origin = 'stated' AND invalid_at IS NULL ORDER BY id`,
      )
      .all(SPACE) as { id: number; content: string }[];
    expect(current).toEqual([{ id: correction?.newEntryId, content: "works at Samsonite warehouse" }]);
    // Never silently overwritten: the original row's invalidation is
    // the correction's own doing (superseded, replaced_by → the
    // correction's replacement) — no W3 write touched a stated row.
    const original = umRow(stated.id);
    expect(original.invalid_reason).toBe("superseded");
    expect(original.replaced_by).toBe(correction?.newEntryId);
    // Scope note: the extractor's stale proposition may still land as
    // a NEW consolidated row (the boundary rejects stated-COVERS
    // duplicates; a contradicting insert the deterministic detector
    // cannot see is Phase B/E's remit — the documented detection
    // envelope). T-C26's contract is about the stated row, above.
  });
});
