/**
 * W3 Milestone 4 — Phase E: reconciliation sweep (design Rev 11 §5.6,
 * §8.6; implementation plan Phase E test list).
 *
 * Covers T-C71, T-C71b, T-C72–T-C81. Real SQLite via createDb(); the
 * pairwise LLM judge and the deterministic similarity scorer are
 * injectable stubs (the scorer is call-countable and records pair
 * keys, per the design's test contract). user_model fixtures are
 * inserted by SQL for full control of origin/slot/topics/valid_at —
 * reconciliation reads rows, and writer-API seeding cannot express
 * every fixture (recordStated runs its own contradiction handling).
 *
 * Note on T-C80's budget: the design text uses w3_recon_pairs_budget
 * =30 against uniform 5-pair beliefs, which lands the stop exactly
 * ON a belief boundary (30 = 6×5) and so cannot produce the pair-level
 * marker the test exists to pin. These tests use 28 with the same
 * layout, so the budget stops mid-belief; every asserted behavior —
 * exact budget stop, marker contents, exact resume, no pair examined
 * twice, queue inserts ≤ pairs budget, version-mismatch discard — is
 * the design's, exercised at the boundary the design intends.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../../db/client.js";
import { captureEpisode, applyForgetRequest } from "../episodic.js";
import { recordStated, tokenJaccard, type LlmJudge } from "../userModel.js";
import type { ConsolidationRunContext } from "../consolidation/boundary.js";
import {
  runReconciliationPhase,
  selectReconSlice,
  type ReconSimilarityScorer,
  type ReconciliationSummary,
} from "../consolidation/reconciliation.js";

const SPACE = "w3-m4-space";
const DAY = 86_400_000;

let handle: DbHandle;

beforeEach(() => {
  handle = createDb(":memory:");
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

interface UmFixture {
  slot?: string;
  content: string;
  origin: "stated" | "inferred" | "consolidated";
  confidence?: number;
  strength?: number;
  evidence?: { type: string; id: number }[];
  topics?: string[];
  validAt?: string;
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
      // Default evidence points at a nonexistent episode id on
      // purpose: real captured episodes start at id 1, and a fixture
      // default of 1 would silently make every row a dependent of
      // the first real episode (T-C81's forget scope).
      JSON.stringify(f.evidence ?? [{ type: "episode", id: 987654 }]),
      JSON.stringify(f.topics ?? []),
      f.validAt ?? iso(Date.now()),
      f.origin,
      f.validAt ?? iso(Date.now()),
    );
  return Number(r.lastInsertRowid);
}

function umRow(id: number): Record<string, unknown> {
  return handle.sqlite
    .prepare(`SELECT * FROM user_model WHERE id = ?`)
    .get(id) as Record<string, unknown>;
}

function progress(): Record<string, unknown> | undefined {
  return handle.sqlite
    .prepare(`SELECT * FROM w3_recon_progress WHERE space_id = ?`)
    .get(SPACE) as Record<string, unknown> | undefined;
}

function queueRows(): { consolidated_id: number; stated_id: number; attempts: number }[] {
  return handle.sqlite
    .prepare(
      `SELECT consolidated_id, stated_id, attempts FROM w3_recon_semantic_queue
       WHERE space_id = ? ORDER BY consolidated_id, stated_id`,
    )
    .all(SPACE) as { consolidated_id: number; stated_id: number; attempts: number }[];
}

function contradictionRows(): Record<string, unknown>[] {
  return handle.sqlite
    .prepare(`SELECT * FROM contradictions WHERE space_id = ? ORDER BY id`)
    .all(SPACE) as Record<string, unknown>[];
}

function reconCtx(over: Partial<ConsolidationRunContext> = {}): ConsolidationRunContext {
  return { spaceId: SPACE, runId: 1, now: iso(Date.now()), ...over };
}

/** Scorer harness: counts examinations and records pair keys in order. */
function countingScorer() {
  const calls: { consolidatedId: number; statedId: number }[] = [];
  const scorer: ReconSimilarityScorer = (a, b) => {
    calls.push({ consolidatedId: a.id, statedId: b.id });
    return tokenJaccard(a.content, b.content);
  };
  return { scorer, calls };
}

function judgeStub(verdict: "contradiction" | "compatible", throwAlways = false) {
  const calls: { candidate: string; entryId: number }[] = [];
  const judge: LlmJudge = async (input) => {
    calls.push({ candidate: input.candidate, entryId: input.entry.id });
    if (throwAlways) throw new Error("judge unavailable");
    return verdict;
  };
  return { judge, calls };
}

/* Fixture texts (token-verified against contentTokens/tokenJaccard):
 * AMBIG pair: token sets {user,work,samsonite,warehouse,jacksonville}
 * vs the same + {daily} → Jaccard 5/6 ≈ 0.833 ≥ 0.75; no deterministic
 * rule fires (shared entity but no negation/termination/succession);
 * topic labels are disjoint so the Tier 1 predicate cannot fire. */
const AMBIG_CONS = "user works at Samsonite warehouse in Jacksonville";
const AMBIG_STATED = "user works at Samsonite warehouse in Jacksonville daily";

/* ---------------- T-C71 / T-C71b ---------------- */

describe("T-C71: tail contradiction discovered by the semantic pass", () => {
  it("inconclusive pair ≥ threshold is queued, judged, filed; the belief is untouched", async () => {
    const consId = umInsert({ origin: "consolidated", content: AMBIG_CONS, topics: ["shift"] });
    const statedId = umInsert({ origin: "stated", content: AMBIG_STATED, topics: ["routine"] });
    const { judge, calls } = judgeStub("contradiction");
    const out = await runReconciliationPhase(
      handle,
      reconCtx({ llmJudge: judge, llmBudget: { remaining: 15 } }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.candidate).toBe(AMBIG_CONS);
    expect(calls[0]!.entryId).toBe(statedId);
    expect(out.queued).toBe(1);
    expect(out.semanticJudged).toBe(1);
    expect(out.semanticFiled).toBe(1);
    const rows = contradictionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      domain: "user_model",
      old_kind: "user_model_entry",
      old_id: statedId,
      new_kind: "user_model_entry",
      new_id: consId,
      reported_by: "reconciliation",
      report_ref: `recon:${consId}`,
      state: "pending",
    });
    expect(queueRows()).toHaveLength(0);
    // Discovery only: the consolidated belief itself is untouched.
    expect(umRow(consId).invalid_at).toBeNull();
    expect(umRow(consId).content).toBe(AMBIG_CONS);
  });

  it("companion: judge says no_contradiction → nothing filed, entry deleted (no hallucinated records)", async () => {
    umInsert({ origin: "consolidated", content: AMBIG_CONS, topics: ["shift"] });
    umInsert({ origin: "stated", content: AMBIG_STATED, topics: ["routine"] });
    const { judge, calls } = judgeStub("compatible");
    const out = await runReconciliationPhase(
      handle,
      reconCtx({ llmJudge: judge, llmBudget: { remaining: 15 } }),
    );
    expect(calls).toHaveLength(1);
    expect(out.semanticFiled).toBe(0);
    expect(contradictionRows()).toHaveLength(0);
    expect(queueRows()).toHaveLength(0);
  });
});

describe("T-C71b: deterministic-only contradiction — zero LLM calls", () => {
  it("Tier 1 coverage pair is filed by the deterministic pass; the judge is never invoked", async () => {
    // Same slot + shared topic label (Tier 1 fires); contents share no
    // entities or tokens, so no deterministic verdict and sim ≈ 0.
    const consId = umInsert({
      origin: "consolidated",
      content: "the depot rotation calendar changes every week",
      topics: ["work"],
    });
    const statedId = umInsert({
      origin: "stated",
      content: "quiet mornings at home begin with coffee",
      topics: ["work"],
    });
    setMeta({ w3_recon_semantic_budget: 10 });
    const { judge, calls } = judgeStub("contradiction", true); // throws if called
    const out = await runReconciliationPhase(
      handle,
      reconCtx({ llmJudge: judge, llmBudget: { remaining: 15 } }),
    );
    expect(calls).toHaveLength(0);
    expect(out.filedDeterministic).toBe(1);
    expect(queueRows()).toHaveLength(0);
    const rows = contradictionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      old_id: statedId,
      new_id: consId,
      reported_by: "reconciliation",
      category: "false_belief",
      state: "pending",
    });
  });
});

/* ---------------- T-C72 / T-C79 ---------------- */

function seedManyConsolidated(count: number): number[] {
  const ids: number[] = [];
  const base = Date.now();
  for (let i = 0; i < count; i++) {
    ids.push(
      umInsert({
        origin: "consolidated",
        content: `consolidated belief number ${i} about depot logistics`,
        topics: [],
        validAt: iso(base - i * 60_000), // ids[0] is the newest
      }),
    );
  }
  return ids;
}

describe("T-C72: cursor progress across runs (200 / 200 / 50, then reset)", () => {
  it("each run processes exactly one batch, disjoint, and the third completes the pass", async () => {
    const ids = seedManyConsolidated(450);
    const r1 = await runReconciliationPhase(handle, reconCtx());
    expect(r1.beliefsExamined).toBe(200);
    expect(r1.passCompleted).toBe(false);
    expect(progress()!.cursor_id).toBe(ids[199]);
    expect(progress()!.cursor_valid_at).toBe(umRow(ids[199]!).valid_at);
    const r2 = await runReconciliationPhase(handle, reconCtx());
    expect(r2.beliefsExamined).toBe(200);
    expect(r2.passCompleted).toBe(false);
    expect(progress()!.cursor_id).toBe(ids[399]);
    const r3 = await runReconciliationPhase(handle, reconCtx());
    expect(r3.beliefsExamined).toBe(50);
    expect(r3.passCompleted).toBe(true);
    expect(progress()!.cursor_id).toBeNull();
    expect(progress()!.cursor_valid_at).toBeNull();
    expect(progress()!.last_pass_completed_at).not.toBeNull();
  });
});

describe("T-C79: fresh-pass and resume query paths are executable on real SQLite", () => {
  it("Path 1 with no progress row and with a NULL-cursor row; Path 2 strictly below the cursor", async () => {
    const ids = seedManyConsolidated(250);
    // (a) No w3_recon_progress row at all → Path 1, newest 200.
    const a = selectReconSlice(handle.sqlite, SPACE, 200);
    expect(a.path).toBe(1);
    expect(a.beliefs).toHaveLength(200);
    expect(a.beliefs[0]!.id).toBe(ids[0]);
    // (b) A progress row whose cursor columns are NULL (post-completion
    // state) → still Path 1 with identical results (a single nullable
    // query would return zero rows here — the Rev 8 finding).
    handle.sqlite
      .prepare(
        `INSERT INTO w3_recon_progress (space_id, updated_at) VALUES (?, ?)`,
      )
      .run(SPACE, iso(Date.now()));
    const b = selectReconSlice(handle.sqlite, SPACE, 200);
    expect(b.path).toBe(1);
    expect(b.beliefs.map((r) => r.id)).toEqual(a.beliefs.map((r) => r.id));
    // (c) A full Phase D run advances the cursor to belief #200; the
    // resume path then returns the disjoint remaining 50, and a second
    // run completes the pass (cursor resets to NULL).
    handle.sqlite.prepare(`DELETE FROM w3_recon_progress WHERE space_id = ?`).run(SPACE);
    await runReconciliationPhase(handle, reconCtx());
    expect(progress()!.cursor_id).toBe(ids[199]);
    const c = selectReconSlice(handle.sqlite, SPACE, 200);
    expect(c.path).toBe(2);
    expect(c.beliefs).toHaveLength(50);
    expect(c.beliefs[0]!.id).toBe(ids[200]);
    expect(c.beliefs.map((r) => r.id).filter((id) => a.beliefs.some((x) => x.id === id))).toHaveLength(0);
    await runReconciliationPhase(handle, reconCtx());
    expect(progress()!.cursor_id).toBeNull();
    expect(progress()!.last_pass_completed_at).not.toBeNull();
  });
});

/* ---------------- T-C73 ---------------- */

describe("T-C73: no duplicates on re-scan (crash between slice end and cursor advance)", () => {
  it("re-running the same slice files exactly one record for the pair", async () => {
    umInsert({
      origin: "consolidated",
      content: "the depot rotation calendar changes every week",
      topics: ["work"],
    });
    umInsert({
      origin: "stated",
      content: "quiet mornings at home begin with coffee",
      topics: ["work"],
    });
    await runReconciliationPhase(handle, reconCtx());
    expect(contradictionRows()).toHaveLength(1);
    // Simulate the crash: the slice committed but the cursor advance
    // was lost → the next run re-selects from the top.
    handle.sqlite
      .prepare(
        `UPDATE w3_recon_progress SET cursor_valid_at = NULL, cursor_id = NULL,
           partial_valid_at = NULL, partial_id = NULL WHERE space_id = ?`,
      )
      .run(SPACE);
    await runReconciliationPhase(handle, reconCtx());
    expect(contradictionRows()).toHaveLength(1);
  });
});

/* ---------------- T-C74 ---------------- */

describe("T-C74: bounded work — beliefs, pair examinations, zero semantic spend", () => {
  it("1000 beliefs: one run examines exactly 200 beliefs and ≤ pairs budget, judge never invoked", async () => {
    const ids = seedManyConsolidated(1000);
    for (let k = 0; k < 3; k++) {
      umInsert({
        origin: "stated",
        content: `stated note ${k} about unrelated household matters`,
        topics: ["home"],
      });
    }
    const { scorer, calls } = countingScorer();
    const { judge, calls: judgeCalls } = judgeStub("contradiction", true);
    const out = await runReconciliationPhase(handle, reconCtx({ llmJudge: judge }), { scorer });
    expect(out.beliefsExamined).toBe(200);
    expect(out.pairsExamined).toBe(600); // 200 beliefs × 3 stated
    expect(calls).toHaveLength(600);
    expect(out.pairsExamined).toBeLessThanOrEqual(2000);
    expect(judgeCalls).toHaveLength(0);
    expect(out.queued).toBe(0);
    expect(progress()!.cursor_id).toBe(ids[199]);
  });
});

/* ---------------- T-C75 ---------------- */

describe("T-C75: discovery only — user_model byte-identical after a filing run", () => {
  it("the full user_model hash is unchanged while records are filed and queued pairs judged", async () => {
    umInsert({
      origin: "consolidated",
      content: "the depot rotation calendar changes every week",
      topics: ["work"],
    });
    umInsert({
      origin: "stated",
      content: "quiet mornings at home begin with coffee",
      topics: ["work"],
    });
    umInsert({ origin: "consolidated", content: AMBIG_CONS, topics: ["shift"] });
    umInsert({ origin: "stated", content: AMBIG_STATED, topics: ["routine"] });
    const hashUm = () =>
      JSON.stringify(
        handle.sqlite.prepare(`SELECT * FROM user_model ORDER BY id`).all(),
      );
    const before = hashUm();
    const { judge } = judgeStub("contradiction");
    const out = await runReconciliationPhase(
      handle,
      reconCtx({ llmJudge: judge, llmBudget: { remaining: 15 } }),
    );
    expect(out.filedDeterministic + out.semanticFiled).toBeGreaterThanOrEqual(2);
    expect(hashUm()).toBe(before);
  });
});

/* ---------------- T-C76 ---------------- */

describe("T-C76: semantic budget exhaustion defers, never drops", () => {
  it("15 ambiguous pairs, budget 10: 10 judged, 5 remain queued untouched; second run drains the rest", async () => {
    const statedId = umInsert({ origin: "stated", content: AMBIG_STATED, topics: ["routine"] });
    const consIds: number[] = [];
    const fillers = ["nightly", "weekly", "monthly", "yearly", "hourly", "often", "rarely", "always", "sometimes", "seasonally", "regularly", "frequently", "occasionally", "periodically", "habitually"];
    for (const f of fillers) {
      consIds.push(
        umInsert({
          origin: "consolidated",
          // Stated 6-token set + one extra token → Jaccard 6/7 ≈ 0.857,
          // no deterministic rule fires.
          content: `${AMBIG_STATED} ${f}`,
          topics: ["shift"],
        }),
      );
    }
    setMeta({ w3_recon_semantic_budget: 10 });
    const { judge, calls } = judgeStub("contradiction");
    const r1 = await runReconciliationPhase(
      handle,
      reconCtx({ llmJudge: judge, llmBudget: { remaining: 100 } }),
    );
    expect(calls).toHaveLength(10);
    expect(r1.semanticJudged).toBe(10);
    expect(r1.semanticFiled).toBe(10);
    expect(contradictionRows()).toHaveLength(10);
    const remaining = queueRows();
    expect(remaining).toHaveLength(5);
    expect(remaining.every((q) => q.attempts === 0)).toBe(true);
    // No record exists for any unjudged pair.
    for (const q of remaining) {
      expect(
        contradictionRows().some((r) => r.new_id === q.consolidated_id),
      ).toBe(false);
    }
    expect(remaining.every((q) => q.stated_id === statedId)).toBe(true);

    const r2 = await runReconciliationPhase(
      handle,
      reconCtx({ llmJudge: judge, llmBudget: { remaining: 100 } }),
    );
    expect(calls).toHaveLength(15);
    expect(r2.semanticJudged).toBe(5);
    expect(queueRows()).toHaveLength(0);
    expect(contradictionRows()).toHaveLength(15);
    expect(consIds).toHaveLength(15);
  });
});

/* ---------------- T-C77 ---------------- */

describe("T-C77: semantic judge failure does not block deterministic progress", () => {
  it("throwing judge: deterministic record filed, cursor advanced, entry stays queued with attempts=1; recovery next run", async () => {
    umInsert({
      origin: "consolidated",
      content: "the depot rotation calendar changes every week",
      topics: ["work"],
    });
    umInsert({
      origin: "stated",
      content: "quiet mornings at home begin with coffee",
      topics: ["work"],
    });
    const ambCons = umInsert({ origin: "consolidated", content: AMBIG_CONS, topics: ["shift"] });
    const ambStated = umInsert({ origin: "stated", content: AMBIG_STATED, topics: ["routine"] });
    const failing = judgeStub("contradiction", true);
    const r1 = await runReconciliationPhase(
      handle,
      reconCtx({ llmJudge: failing.judge, llmBudget: { remaining: 15 } }),
    );
    expect(r1.filedDeterministic).toBe(1);
    expect(contradictionRows()).toHaveLength(1);
    // The slice completed despite the judge failure.
    expect(progress()!.cursor_id).toBeNull();
    expect(progress()!.last_pass_completed_at).not.toBeNull();
    const q = queueRows();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ consolidated_id: ambCons, stated_id: ambStated, attempts: 1 });

    const working = judgeStub("contradiction");
    const r2 = await runReconciliationPhase(
      handle,
      reconCtx({ llmJudge: working.judge, llmBudget: { remaining: 15 } }),
    );
    expect(r2.semanticFiled).toBe(1);
    expect(queueRows()).toHaveLength(0);
    expect(contradictionRows()).toHaveLength(2);
    expect(
      contradictionRows().some(
        (r) => r.new_id === ambCons && r.old_id === ambStated && r.reported_by === "reconciliation",
      ),
    ).toBe(true);
  });
});

/* ---------------- T-C78 ---------------- */

describe("T-C78: below-threshold pair is outside the detection envelope", () => {
  it("sim 0.60 < 0.75: never filed, never queued, pass completes; lowering the threshold brings it inside", async () => {
    // Token sets: {alpha,bravo,charlie,delta,echo,foxtrot,golf,hotel}
    // vs {alpha,bravo,charlie,delta,echo,foxtrot,india,juliet} →
    // Jaccard 6/10 = 0.60. No rule fires; topics disjoint (no Tier 1).
    const consId = umInsert({
      origin: "consolidated",
      content: "alpha bravo charlie delta echo foxtrot golf hotel",
      topics: ["a"],
      validAt: aged(3),
    });
    const statedId = umInsert({
      origin: "stated",
      content: "alpha bravo charlie delta echo foxtrot india juliet",
      topics: ["b"],
    });
    // Two newer filler beliefs force a multi-run pass at batch=1.
    umInsert({ origin: "consolidated", content: "filler belief one about gardening", topics: [], validAt: aged(1) });
    umInsert({ origin: "consolidated", content: "filler belief two about cooking", topics: [], validAt: aged(2) });
    setMeta({ w3_recon_batch: 1, w3_recon_pairs_budget: 10 });
    const { judge } = judgeStub("contradiction");
    let out: ReconciliationSummary | null = null;
    for (let i = 0; i < 5 && !(out?.passCompleted ?? false); i++) {
      out = await runReconciliationPhase(
        handle,
        reconCtx({ llmJudge: judge, llmBudget: { remaining: 15 } }),
      );
      expect(contradictionRows().some((r) => r.new_id === consId)).toBe(false);
      expect(queueRows().some((q) => q.consolidated_id === consId)).toBe(false);
    }
    expect(out!.passCompleted).toBe(true);
    expect(progress()!.cursor_id).toBeNull();
    // The pair was examined (its similarity really is 0.60 — pinned,
    // not assumed) yet produced no record and no queue entry, ever.
    expect(tokenJaccard("alpha bravo charlie delta echo foxtrot golf hotel",
      "alpha bravo charlie delta echo foxtrot india juliet")).toBeCloseTo(0.6, 10);

    // Lower the threshold below the pair's similarity: the SAME pair
    // is now inside the envelope → queued and (judge: contradiction)
    // filed. The boundary is exactly the threshold.
    setMeta({ w3_recon_sim_threshold: 0.5, w3_recon_batch: 200 });
    handle.sqlite.prepare(`DELETE FROM w3_recon_progress WHERE space_id = ?`).run(SPACE);
    const out2 = await runReconciliationPhase(
      handle,
      reconCtx({ llmJudge: judge, llmBudget: { remaining: 15 } }),
    );
    expect(out2.semanticFiled).toBe(1);
    expect(
      contradictionRows().some(
        (r) => r.new_id === consId && r.old_id === statedId && r.reported_by === "reconciliation",
      ),
    ).toBe(true);
  });
});

/* ---------------- T-C80 / T-C81 shared layout ---------------- */

/**
 * 10 consolidated beliefs (B1 newest … B10 oldest) × 5 stated beliefs.
 * Candidate ordering inside a belief is topic-overlap DESC, stated id
 * ASC: B1's topics give S5..S1 overlaps 5,4,3,2,1; every other belief
 * has topics ['z'] (overlap 0 against all stated → id ASC order).
 */
function seedMarkerLayout(over: {
  b6Content?: string;
  b10Content?: string;
  s2Content?: string;
  s2Evidence?: { type: string; id: number }[];
  s3Content?: string;
  s5Content?: string;
} = {}): { B: number[]; S: number[] } {
  const S: number[] = [];
  S.push(umInsert({ origin: "stated", content: "stated note one with plain words", topics: ["e"] }));
  S.push(umInsert({
    origin: "stated",
    content: over.s2Content ?? "stated note two with plain words",
    topics: ["d", "e"],
    ...(over.s2Evidence ? { evidence: over.s2Evidence } : {}),
  }));
  S.push(umInsert({
    origin: "stated",
    content: over.s3Content ?? "stated note three with plain words",
    topics: ["c", "d", "e"],
  }));
  S.push(umInsert({ origin: "stated", content: "stated note four with plain words", topics: ["b", "c", "d", "e"] }));
  S.push(umInsert({
    origin: "stated",
    content: over.s5Content ?? "stated note five with plain words",
    topics: ["a", "b", "c", "d", "e"],
  }));
  const B: number[] = [];
  const base = Date.now();
  for (let i = 0; i < 10; i++) {
    const isB1 = i === 0;
    const isB6 = i === 5;
    const isB10 = i === 9;
    B.push(
      umInsert({
        origin: "consolidated",
        // B1 sits in a different slot than the stated rows so its
        // heavy topic overlap cannot trigger the Tier 1 predicate —
        // its pairs exist to pin the overlap-DESC ordering only.
        slot: isB1 ? "knowledge" : "belief",
        content: isB6 && over.b6Content
          ? over.b6Content
          : isB10 && over.b10Content
            ? over.b10Content
            : `consolidated note ${i + 1} with plain words`,
        topics: isB1 ? ["a", "b", "c", "d", "e"] : ["z"],
        validAt: iso(base - i * 60_000),
      }),
    );
  }
  return { B, S };
}

describe("T-C80: pairs budget binds with exact continuation", () => {
  it("budget stops mid-belief with an exact marker; the next run resumes at the next pair — no pair examined twice", async () => {
    // Planted deterministic contradiction at the LAST pair of the
    // ordering: B10 (oldest) × S5 (highest stated id). Candidate text
    // terminates the stated side's entity state → explicit_transition.
    const { B, S } = seedMarkerLayout({
      b10Content: "user quit Samsonite last week",
      s5Content: "user works at Samsonite warehouse",
    });
    setMeta({ w3_recon_pairs_budget: 28 });
    const { scorer, calls } = countingScorer();
    const r1 = await runReconciliationPhase(handle, reconCtx(), { scorer });
    expect(calls).toHaveLength(28);
    expect(r1.pairsExamined).toBe(28);
    // B1..B5 complete (25 pairs); B6 examined 3 pairs (S1,S2,S3 in
    // id-ASC order at overlap 0) before the budget bound.
    const p1 = progress()!;
    expect(p1.cursor_id).toBe(B[4]);
    expect(p1.partial_id).toBe(B[5]);
    expect(p1.partial_stated_id).toBe(S[2]);
    expect(p1.partial_stated_overlap).toBe(0);
    expect(p1.partial_stated_version).toBe(meta().stated_set_version);
    // The planted pair (#50) is not yet reached.
    expect(contradictionRows()).toHaveLength(0);

    const before = calls.length;
    const r2 = await runReconciliationPhase(handle, reconCtx(), { scorer });
    const run2Calls = calls.slice(before);
    // Resumed B6 at its 4th pair (S4), then S5, then B7..B10 (20).
    expect(run2Calls[0]).toEqual({ consolidatedId: B[5], statedId: S[3] });
    expect(r2.pairsExamined).toBe(22);
    expect(calls).toHaveLength(50);
    const keys = new Set(calls.map((c) => `${c.consolidatedId}:${c.statedId}`));
    expect(keys.size).toBe(50); // no pair examined twice
    const rec = contradictionRows();
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({
      old_id: S[4],
      new_id: B[9],
      category: "state_transition",
      reported_by: "reconciliation",
      report_ref: `recon:${B[9]}`,
    });
    expect(progress()!.partial_id).toBeNull();
    expect(progress()!.cursor_id).toBeNull(); // pass completed
  });

  it("queue inserts per run never exceed the pairs budget", async () => {
    // 3 beliefs × 2 stated, every pair ambiguous-zone; budget 4.
    const s1 = umInsert({ origin: "stated", content: AMBIG_STATED, topics: ["routine"] });
    umInsert({ origin: "stated", content: "completely different stated words about cooking", topics: ["home"] });
    for (const f of ["nightly", "weekly", "monthly"]) {
      umInsert({
        origin: "consolidated",
        content: `${AMBIG_STATED} ${f}`,
        topics: ["shift"],
      });
    }
    setMeta({ w3_recon_pairs_budget: 4 });
    const out = await runReconciliationPhase(handle, reconCtx());
    expect(out.pairsExamined).toBe(4);
    // Two beliefs reach the budget (2 pairs each); exactly their two
    // ambiguous pairs are queued — inserts never exceed the budget.
    expect(out.queued).toBe(2);
    expect(out.queued).toBeLessThanOrEqual(4);
    expect(queueRows().length).toBe(out.queued);
    expect(queueRows().every((q) => q.stated_id === s1)).toBe(true);
  });

  it("companion: a stated write between runs discards the marker — the belief is re-examined from its first pair, filings deduped", async () => {
    // Deterministic plant inside the marker belief's examined range:
    // B6 × S2 (candidate terminates the Samsonite state S2 states).
    const { B, S } = seedMarkerLayout({
      b6Content: "user quit Samsonite last week",
      s2Content: "user works at Samsonite warehouse",
    });
    setMeta({ w3_recon_pairs_budget: 28 });
    const { scorer, calls } = countingScorer();
    await runReconciliationPhase(handle, reconCtx(), { scorer });
    expect(progress()!.partial_id).toBe(B[5]);
    expect(contradictionRows()).toHaveLength(1); // B6 × S2 filed in run 1
    const v1 = meta().stated_set_version as number;

    // A stated write lands (new stated row) → version bumps.
    const ep = captureEpisode(handle, SPACE, {
      kind: "conversation",
      userExcerpt: "marker companion interaction",
      topicLabels: [],
    });
    if (!ep) throw new Error("captureEpisode returned null");
    recordStated(handle, SPACE, "belief", "a brand new stated fact about weekends", [
      { type: "episode", id: ep.episodeId },
    ]);
    expect(meta().stated_set_version).toBe(v1 + 1);

    const before = calls.length;
    await runReconciliationPhase(handle, reconCtx(), { scorer });
    const run2Calls = calls.slice(before);
    const b6Run2 = run2Calls.filter((c) => c.consolidatedId === B[5]);
    // Marker discarded: B6 re-examined from its FIRST pair (S1 in
    // id-ASC order at overlap 0) — a resume would have started at S4.
    expect(b6Run2[0]).toEqual({ consolidatedId: B[5], statedId: S[0] });
    expect(b6Run2.some((c) => c.statedId === S[1])).toBe(true); // re-examined
    // The re-examined B6 × S2 pair produced no second record.
    expect(
      contradictionRows().filter((r) => r.old_id === S[1] && r.new_id === B[5]),
    ).toHaveLength(1);
    void S;
  });
});

describe("T-C81: the forget flow invalidates the partial marker", () => {
  function seedForgetLayout() {
    // S2 is backed SOLELY by episode E2 — forgetting E2 removes S2
    // from the current stated set via applyForgetRequest.
    const ep = captureEpisode(handle, SPACE, {
      kind: "conversation",
      userExcerpt: "the interaction S2 rests on",
      topicLabels: [],
    });
    if (!ep) throw new Error("captureEpisode returned null");
    const layout = seedMarkerLayout({
      // B6 × S1 is ambiguous-zone (queued in run 1, re-examined in
      // run 2 → queue dedup evidence); B6 × S3 is a deterministic
      // genuine_negation (filed in run 1, re-examined in run 2 →
      // filing dedup evidence).
      b6Content: "user works at Samsonite warehouse daily",
      s2Evidence: [{ type: "episode", id: ep.episodeId }],
      s3Content: "user does not work at Samsonite warehouse",
    });
    // B6 × S1 must be ambiguous: S1 is the layout's plain note, so
    // replace its content with the near-duplicate of B6's text.
    handle.sqlite
      .prepare(`UPDATE user_model SET content = ? WHERE id = ?`)
      .run("user works at Samsonite warehouse daily extra", layout.S[0]);
    return { ...layout, episodeId: ep.episodeId };
  }

  it("forget bumps stated_set_version by exactly 1; the stale marker is discarded and S2 is never paired again", async () => {
    const { B, S, episodeId } = seedForgetLayout();
    setMeta({ w3_recon_pairs_budget: 28 });
    const { scorer, calls } = countingScorer();
    // No judge configured on purpose: the queued pair must persist
    // into run 2 so re-examination dedup is observable.
    await runReconciliationPhase(handle, reconCtx(), { scorer });
    expect(calls).toHaveLength(28);
    expect(progress()!.partial_id).toBe(B[5]);
    const v = meta().stated_set_version as number;
    expect(progress()!.partial_stated_version).toBe(v);
    // Run 1 filed B6 × S3 (deterministic) and queued B6 × S1.
    expect(contradictionRows()).toHaveLength(1);
    expect(queueRows()).toHaveLength(1);

    // The authorized forget flow lands on S2's backing episode.
    const req = handle.sqlite
      .prepare(
        `INSERT INTO forget_requests (space_id, target_episode_id, target_node_id, target_query)
         VALUES (?, ?, NULL, NULL)`,
      )
      .run(SPACE, episodeId);
    const reqId = Number(req.lastInsertRowid);
    handle.sqlite
      .prepare(
        `UPDATE forget_requests SET status = 'approved', target_query = NULL,
           scope_episode_ids = ?, scope_node_ids = ?, scope_topics = ?
         WHERE id = ?`,
      )
      .run(JSON.stringify([episodeId]), JSON.stringify([]), JSON.stringify([]), reqId);
    applyForgetRequest(handle, reqId);
    expect(umRow(S[1]!).invalid_at).not.toBeNull(); // S2 left the current set
    expect(meta().stated_set_version).toBe(v + 1); // exactly one bump

    const before = calls.length;
    await runReconciliationPhase(handle, reconCtx(), { scorer });
    const run2Calls = calls.slice(before);
    // (c) The forgotten row appears in NO pair examination in run 2.
    expect(run2Calls.some((c) => c.statedId === S[1])).toBe(false);
    // (a)+(b) The stale marker was discarded: B6 re-examined from its
    // first pair of the post-forget candidate set (S1 — a resume from
    // the stale marker would have started at S4).
    const b6Run2 = run2Calls.filter((c) => c.consolidatedId === B[5]);
    expect(b6Run2[0]).toEqual({ consolidatedId: B[5], statedId: S[0] });
    // (d) Dedup across the re-examination: still exactly one record
    // (B6 × S3) and one queue row (B6 × S1).
    expect(contradictionRows()).toHaveLength(1);
    expect(queueRows()).toHaveLength(1);
    expect(progress()!.partial_id).toBeNull();
  });

  it("negative control: without the forget step, the same marker resumes exactly", async () => {
    const { B, S } = seedForgetLayout();
    setMeta({ w3_recon_pairs_budget: 28 });
    const { scorer, calls } = countingScorer();
    await runReconciliationPhase(handle, reconCtx(), { scorer });
    expect(progress()!.partial_id).toBe(B[5]);
    const before = calls.length;
    await runReconciliationPhase(handle, reconCtx(), { scorer });
    const run2Calls = calls.slice(before);
    const b6Run2 = run2Calls.filter((c) => c.consolidatedId === B[5]);
    // Exact resume: B6's remaining pairs are S4, S5 — S1..S3 are NOT
    // re-examined, proving the run-2 behavior above was caused by the
    // forget-driven version bump, not unconditional re-examination.
    expect(b6Run2).toEqual([
      { consolidatedId: B[5], statedId: S[3] },
      { consolidatedId: B[5], statedId: S[4] },
    ]);
  });
});
