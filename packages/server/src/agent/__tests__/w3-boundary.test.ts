/**
 * W3 Milestone 2 — Phase C: the guarded write boundary (§6.1).
 *
 * Design: docs/wisdom/w3-design.md (Revision 11, owner-approved);
 * plan: Phase C of the W3 implementation plan. Test IDs follow the plan's
 * Phase C list (T-C24, T-C14, T-C42, T-C50, T-C57, T-C58, T-C61, T-C64,
 * T-C66, T-C67, T-C68, T-C69, T-C70).
 *
 * Real SQLite via createDb(); the LLM judge is an injectable stub (the
 * repo's LlmJudge shape). No mocked transactional outcomes.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createDb, type DbHandle } from "../../db/client.js";
import { captureEpisode } from "../episodic.js";
import {
  recordStated,
  updateUserModel,
  mapTopics,
  type LlmJudge,
  type LlmJudgment,
} from "../userModel.js";
import {
  applyConsolidationMutation,
  snapshotStatedIntegrity,
  verifyStatedIntegrity,
  finalizeStatedIntegrityCheck,
  type ConsolidationRunContext,
} from "../consolidation/boundary.js";

const SPACE = "w3-m2-boundary-space";

let handle: DbHandle;

beforeEach(() => {
  handle = createDb(":memory:");
});

afterEach(() => {
  (handle.sqlite as unknown as { close(): void }).close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let episodeSeq = 0;
function seedEpisode(lineageKey?: string): number {
  episodeSeq += 1;
  const res = captureEpisode(handle, SPACE, {
    kind: "conversation",
    userExcerpt: `boundary test interaction ${episodeSeq}`,
    topicLabels: [],
    ...(lineageKey ? { lineageKey } : {}),
  });
  if (!res) throw new Error("captureEpisode returned null");
  return res.episodeId;
}

function ctx(extra?: Partial<ConsolidationRunContext>): ConsolidationRunContext {
  return { spaceId: SPACE, ...extra };
}

function umRow(id: number): Record<string, unknown> {
  return handle.sqlite
    .prepare(`SELECT * FROM user_model WHERE id = ?`)
    .get(id) as Record<string, unknown>;
}

function umRowJson(id: number): string {
  return JSON.stringify(umRow(id));
}

function statedVersion(): number {
  const row = handle.sqlite
    .prepare(`SELECT stated_set_version FROM space_meta WHERE space_id = ?`)
    .get(SPACE) as { stated_set_version: number } | undefined;
  return row?.stated_set_version ?? 0;
}

function consolidatedCount(content?: string): number {
  const row = (
    content
      ? handle.sqlite
          .prepare(
            `SELECT COUNT(*) AS n FROM user_model WHERE space_id = ? AND origin = 'consolidated' AND content = ?`,
          )
          .get(SPACE, content)
      : handle.sqlite
          .prepare(
            `SELECT COUNT(*) AS n FROM user_model WHERE space_id = ? AND origin = 'consolidated'`,
          )
          .get(SPACE)
  ) as { n: number };
  return row.n;
}

function canaryRows(): { description: string; targets: string }[] {
  return handle.sqlite
    .prepare(
      `SELECT description, targets FROM agent_logs WHERE space_id = ? AND action = 'w3_stated_write_blocked'`,
    )
    .all(SPACE) as { description: string; targets: string }[];
}

// ---------------------------------------------------------------------------
// T-C24: stated protection at the boundary (cell-level)
// ---------------------------------------------------------------------------

describe("T-C24: boundary stated protection", () => {
  it("InvalidateEntry / AppendEvidence / WithdrawEvidence on a stated row are rejected as stated_protected, the row is byte-identical, and a content-free canary row is logged", async () => {
    const E = seedEpisode("t-c24");
    const S = recordStated(handle, SPACE, "belief", "works at Samsonite", [
      { type: "episode", id: E },
    ]);
    const before = umRowJson(S.id);

    const inv = await applyConsolidationMutation(handle.sqlite, ctx(), {
      kind: "InvalidateEntry",
      entryId: S.id,
      reason: "superseded",
    });
    expect(inv.status).toBe("rejected");
    expect(inv.error).toBe("stated_protected");
    expect(umRowJson(S.id)).toBe(before);

    const E2 = seedEpisode("t-c24-b");
    const app = await applyConsolidationMutation(handle.sqlite, ctx(), {
      kind: "AppendEvidence",
      entryId: S.id,
      evidence: [{ type: "episode", id: E2 }],
    });
    expect(app.status).toBe("rejected");
    expect(app.error).toBe("stated_protected");
    expect(umRowJson(S.id)).toBe(before);

    const wd = await applyConsolidationMutation(handle.sqlite, ctx(), {
      kind: "WithdrawEvidence",
      entryId: S.id,
      episodeIds: [E],
    });
    expect(wd.status).toBe("rejected");
    expect(wd.error).toBe("stated_protected");
    expect(umRowJson(S.id)).toBe(before);

    // Canary: one row per blocked attempt, IDs + kind only — no content.
    const canaries = canaryRows();
    expect(canaries.length).toBe(3);
    for (const c of canaries) {
      expect(c.description).not.toContain("Samsonite");
      expect(c.targets).not.toContain("Samsonite");
      expect(c.targets).toContain(String(S.id));
    }

    // SetReviewFlag is the sole permitted stated-row operation.
    const v = statedVersion();
    const flag = await applyConsolidationMutation(handle.sqlite, ctx(), {
      kind: "SetReviewFlag",
      entryId: S.id,
      flag: "contradiction_pending",
    });
    expect(flag.status).toBe("applied");
    expect(umRow(S.id).review_flag).toBe("contradiction_pending");
    // §8.6: the flag write on a stated row bumps the version by exactly 1.
    expect(statedVersion()).toBe(v + 1);
    // Set-once: a second flag set is a no-op — no write, no bump.
    const again = await applyConsolidationMutation(handle.sqlite, ctx(), {
      kind: "SetReviewFlag",
      entryId: S.id,
      flag: "stale_emotion",
    });
    expect(again.status).toBe("noop");
    expect(umRow(S.id).review_flag).toBe("contradiction_pending");
    expect(statedVersion()).toBe(v + 1);
    // An out-of-vocabulary flag value is structurally rejected.
    const bad = await applyConsolidationMutation(handle.sqlite, ctx(), {
      kind: "SetReviewFlag",
      entryId: S.id,
      flag: "bogus" as never,
    });
    expect(bad.status).toBe("rejected");
    expect(bad.error).toBe("invalid_mutation");
  });
});

// ---------------------------------------------------------------------------
// T-C14: §4.4 evidence-strength formula
// ---------------------------------------------------------------------------

describe("T-C14: §4.4 strength formula at the boundary", () => {
  it("two independent fresh groups: strength = 1-(1-0.34)^2, confidence = 0.30+0.39*strength", async () => {
    const E1 = seedEpisode("thread-a");
    const E2 = seedEpisode("thread-b");
    const res = await applyConsolidationMutation(handle.sqlite, ctx(), {
      kind: "InsertConsolidated",
      entry: {
        slot: "belief",
        content: "prefers the early shift",
        evidence: [
          { type: "episode", id: E1 },
          { type: "episode", id: E2 },
        ],
        topicLabels: ["routine"],
      },
    });
    expect(res.status).toBe("applied");
    const row = umRow(res.entryId!);
    expect(row.origin).toBe("consolidated");
    expect(row.evidence_strength as number).toBeCloseTo(0.5644, 3);
    expect(row.confidence as number).toBeCloseTo(0.5201, 3);
    expect(row.confidence as number).toBeLessThanOrEqual(0.69);
  });

  it("same-lineage episodes count once (newest governs recency); a 90-day-old group contributes c=0.17", async () => {
    const E1 = seedEpisode("thread-a");
    const E2 = seedEpisode("thread-a");
    // Age E1 far past the horizon; E2 (same group) is fresh and governs.
    handle.sqlite
      .prepare(`UPDATE episodes SET occurred_at = ? WHERE id = ?`)
      .run(new Date(Date.now() - 200 * 86_400_000).toISOString(), E1);
    const res = await applyConsolidationMutation(handle.sqlite, ctx(), {
      kind: "InsertConsolidated",
      entry: {
        slot: "belief",
        content: "prefers the early shift",
        evidence: [
          { type: "episode", id: E1 },
          { type: "episode", id: E2 },
        ],
        topicLabels: ["routine"],
      },
    });
    expect(res.status).toBe("applied");
    const row = umRow(res.entryId!);
    expect(row.evidence_strength as number).toBeCloseTo(0.34, 3);
    expect(row.confidence as number).toBeCloseTo(0.4326, 3);

    const E3 = seedEpisode("thread-c");
    handle.sqlite
      .prepare(`UPDATE episodes SET occurred_at = ? WHERE id = ?`)
      .run(new Date(Date.now() - 90 * 86_400_000).toISOString(), E3);
    const res2 = await applyConsolidationMutation(handle.sqlite, ctx(), {
      kind: "InsertConsolidated",
      entry: {
        slot: "belief",
        content: "drinks coffee before the shift",
        evidence: [{ type: "episode", id: E3 }],
        topicLabels: ["routine"],
      },
    });
    expect(res2.status).toBe("applied");
    const row2 = umRow(res2.entryId!);
    expect(row2.evidence_strength as number).toBeCloseTo(0.17, 2);
    expect(row2.confidence as number).toBeCloseTo(0.3663, 2);
  });
});

// ---------------------------------------------------------------------------
// T-C42: mutation atomicity (both-or-neither)
// ---------------------------------------------------------------------------

describe("T-C42: boundary transaction atomicity", () => {
  it("a sabotaged SetReviewFlag (flag write + version bump) persists neither write", async () => {
    const E = seedEpisode("t-c42");
    const S = recordStated(handle, SPACE, "belief", "works at Samsonite", [
      { type: "episode", id: E },
    ]);
    const v = statedVersion();
    handle.sqlite.exec(
      `CREATE TRIGGER w3_sabotage_flag BEFORE UPDATE OF review_flag ON user_model
       BEGIN SELECT RAISE(ABORT, 'sabotage'); END`,
    );
    await expect(
      applyConsolidationMutation(handle.sqlite, ctx(), {
        kind: "SetReviewFlag",
        entryId: S.id,
        flag: "stale_emotion",
      }),
    ).rejects.toThrow(/sabotage/);
    expect(umRow(S.id).review_flag).toBeNull();
    expect(statedVersion()).toBe(v);
    handle.sqlite.exec(`DROP TRIGGER w3_sabotage_flag`);
    const ok = await applyConsolidationMutation(handle.sqlite, ctx(), {
      kind: "SetReviewFlag",
      entryId: S.id,
      flag: "stale_emotion",
    });
    expect(ok.status).toBe("applied");
    expect(statedVersion()).toBe(v + 1);
  });

  it("a sabotaged insert persists no row", async () => {
    const E = seedEpisode("t-c42-b");
    handle.sqlite.exec(
      `CREATE TRIGGER w3_sabotage_ins BEFORE INSERT ON user_model
       BEGIN SELECT RAISE(ABORT, 'sabotage'); END`,
    );
    const res = await applyConsolidationMutation(handle.sqlite, ctx(), {
      kind: "InsertConsolidated",
      entry: {
        slot: "belief",
        content: "prefers the early shift",
        evidence: [{ type: "episode", id: E }],
        topicLabels: ["routine"],
      },
    });
    expect(res.status).toBe("rejected");
    expect(consolidatedCount()).toBe(0);
    handle.sqlite.exec(`DROP TRIGGER w3_sabotage_ins`);
  });
});

// ---------------------------------------------------------------------------
// T-C50 / T-C57 / T-C58: run-level stated integrity
// ---------------------------------------------------------------------------

describe("T-C50: out-of-band stated tampering is detected", () => {
  it("legitimate boundary mutations do not trip the detector; direct SQL on current AND invalidated stated rows does", async () => {
    const E = seedEpisode("t-c50");
    const S = recordStated(handle, SPACE, "belief", "works at Samsonite", [
      { type: "episode", id: E },
    ]);
    const snap = snapshotStatedIntegrity(handle.sqlite, SPACE);
    // A legitimate non-stated boundary mutation leaves the hash intact.
    const ins = await applyConsolidationMutation(handle.sqlite, ctx(), {
      kind: "InsertConsolidated",
      entry: {
        slot: "belief",
        content: "prefers the early shift",
        evidence: [{ type: "episode", id: E }],
        topicLabels: ["routine"],
      },
    });
    expect(ins.status).toBe("applied");
    const E2 = seedEpisode("t-c50-b");
    const app = await applyConsolidationMutation(handle.sqlite, ctx(), {
      kind: "AppendEvidence",
      entryId: ins.entryId!,
      evidence: [{ type: "episode", id: E2 }],
    });
    expect(app.status).toBe("applied");
    expect(verifyStatedIntegrity(handle.sqlite, SPACE, snap.hash).ok).toBe(true);

    // Bypass: direct SQL rewrites a stated row's content.
    handle.sqlite
      .prepare(`UPDATE user_model SET content = 'tampered content' WHERE id = ?`)
      .run(S.id);
    const after = verifyStatedIntegrity(handle.sqlite, SPACE, snap.hash);
    expect(after.ok).toBe(false);
    expect(after.expectedHash).toBe(snap.hash);
    expect(after.actualHash).not.toBe(snap.hash);
    expect(after.rowCount).toBe(snap.rowCount);

    // Invalidated stated rows are covered too (full-set snapshot).
    const snap2 = snapshotStatedIntegrity(handle.sqlite, SPACE);
    const S2 = recordStated(handle, SPACE, "belief", "lives in Jacksonville", [
      { type: "episode", id: E },
    ]);
    handle.sqlite
      .prepare(
        `UPDATE user_model SET invalid_at = '2026-10-01T00:00:00.000Z', invalid_reason = 'superseded' WHERE id = ?`,
      )
      .run(S2.id);
    const snap3 = snapshotStatedIntegrity(handle.sqlite, SPACE);
    expect(snap3.hash).not.toBe(snap2.hash);
    handle.sqlite
      .prepare(`UPDATE user_model SET content = 'lives in Orlando' WHERE id = ?`)
      .run(S2.id);
    expect(verifyStatedIntegrity(handle.sqlite, SPACE, snap3.hash).ok).toBe(false);
  });
});

describe("T-C57: integrity hash semantics", () => {
  it("review-flag sets and non-protected columns leave the hash unchanged; protected-column writes move it", async () => {
    const E = seedEpisode("t-c57");
    const S = recordStated(handle, SPACE, "belief", "works at Samsonite", [
      { type: "episode", id: E },
    ]);
    const S2 = recordStated(handle, SPACE, "belief", "lives in Jacksonville", [
      { type: "episode", id: E },
    ]);
    handle.sqlite
      .prepare(
        `UPDATE user_model SET invalid_at = '2026-10-01T00:00:00.000Z', invalid_reason = 'superseded' WHERE id = ?`,
      )
      .run(S2.id);
    const h0 = snapshotStatedIntegrity(handle.sqlite, SPACE).hash;

    // §6.4 review metadata is NOT protected state.
    const flag = await applyConsolidationMutation(handle.sqlite, ctx(), {
      kind: "SetReviewFlag",
      entryId: S.id,
      flag: "evidence_withdrawn",
    });
    expect(flag.status).toBe("applied");
    expect(snapshotStatedIntegrity(handle.sqlite, SPACE).hash).toBe(h0);

    // evidence_strength is a derived, non-protected column.
    handle.sqlite
      .prepare(`UPDATE user_model SET evidence_strength = 0.99 WHERE id = ?`)
      .run(S.id);
    expect(snapshotStatedIntegrity(handle.sqlite, SPACE).hash).toBe(h0);

    // Protected: content.
    handle.sqlite
      .prepare(`UPDATE user_model SET content = 'works at Amazon' WHERE id = ?`)
      .run(S.id);
    const h1 = snapshotStatedIntegrity(handle.sqlite, SPACE).hash;
    expect(h1).not.toBe(h0);

    // Protected: confidence.
    handle.sqlite
      .prepare(`UPDATE user_model SET confidence = 0.5 WHERE id = ?`)
      .run(S.id);
    const h2 = snapshotStatedIntegrity(handle.sqlite, SPACE).hash;
    expect(h2).not.toBe(h1);

    // Protected: invalid_reason on an invalidated row.
    handle.sqlite
      .prepare(`UPDATE user_model SET invalid_reason = 'expired' WHERE id = ?`)
      .run(S2.id);
    expect(snapshotStatedIntegrity(handle.sqlite, SPACE).hash).not.toBe(h2);
  });
});

describe("T-C58: integrity incident — freeze and alert, no silent restore", () => {
  it("finalize detects the tampered run, sets w3_frozen, writes a content-free alert, and leaves committed work (and the tamper) in place for human review", async () => {
    const E = seedEpisode("t-c58");
    const S = recordStated(handle, SPACE, "belief", "works at Samsonite", [
      { type: "episode", id: E },
    ]);
    const snap = snapshotStatedIntegrity(handle.sqlite, SPACE);
    // Committed earlier in the run — must NOT be rolled back.
    const ins = await applyConsolidationMutation(handle.sqlite, ctx(), {
      kind: "InsertConsolidated",
      entry: {
        slot: "belief",
        content: "prefers the early shift",
        evidence: [{ type: "episode", id: E }],
        topicLabels: ["routine"],
      },
    });
    expect(ins.status).toBe("applied");
    // A defect path rewrites the stated row directly.
    handle.sqlite
      .prepare(`UPDATE user_model SET content = 'works at Amazon' WHERE id = ?`)
      .run(S.id);

    const fin = finalizeStatedIntegrityCheck(
      handle.sqlite,
      ctx({ runId: 42 }),
      snap.hash,
    );
    expect(fin.ok).toBe(false);
    expect(fin.error).toBe("stated_integrity_violation");

    const meta = handle.sqlite
      .prepare(`SELECT w3_frozen FROM space_meta WHERE space_id = ?`)
      .get(SPACE) as { w3_frozen: number } | undefined;
    expect(meta?.w3_frozen).toBe(1);

    const alerts = handle.sqlite
      .prepare(
        `SELECT description, targets FROM agent_logs WHERE space_id = ? AND action = 'w3_stated_integrity_violation'`,
      )
      .all(SPACE) as { description: string; targets: string }[];
    expect(alerts.length).toBe(1);
    expect(alerts[0]!.targets).toContain("42");
    expect(alerts[0]!.targets).toContain(snap.hash);
    expect(alerts[0]!.description).not.toContain("Samsonite");
    expect(alerts[0]!.targets).not.toContain("Samsonite");

    // No silent restore: committed work stands; the tamper stands for a
    // human to review.
    expect(consolidatedCount()).toBe(1);
    expect(umRow(S.id).content).toBe("works at Amazon");
  });
});

// ---------------------------------------------------------------------------
// T-C61: WithdrawEvidence subset validation + escalation
// ---------------------------------------------------------------------------

describe("T-C61: WithdrawEvidence semantics", () => {
  it("subset violations reject without writes; partial withdrawal recomputes; emptying the set escalates to invalidation in the same call", async () => {
    const A = seedEpisode("t-c61-a");
    const B = seedEpisode("t-c61-b");
    const C = seedEpisode("t-c61-c");
    const entry = updateUserModel(handle, SPACE, "inferred", {
      slot: "belief",
      content: "believes the diagnosis is serious",
      confidence: 0.5,
      evidence: [
        { type: "episode", id: A },
        { type: "episode", id: B },
        { type: "episode", id: C },
      ],
    });

    const bad = await applyConsolidationMutation(handle.sqlite, ctx(), {
      kind: "WithdrawEvidence",
      entryId: entry.id,
      episodeIds: [999_999],
    });
    expect(bad.status).toBe("rejected");
    expect(bad.error).toBe("evidence_not_subset");
    expect(umRow(entry.id).invalid_at).toBeNull();

    const partial = await applyConsolidationMutation(handle.sqlite, ctx(), {
      kind: "WithdrawEvidence",
      entryId: entry.id,
      episodeIds: [A, B],
    });
    expect(partial.status).toBe("applied");
    const afterPartial = umRow(entry.id);
    expect(JSON.parse(afterPartial.evidence_ids as string)).toEqual([
      { type: "episode", id: C },
    ]);
    expect(afterPartial.evidence_strength as number).toBeCloseTo(0.34, 3);
    expect(afterPartial.invalid_at).toBeNull();

    const last = await applyConsolidationMutation(handle.sqlite, ctx(), {
      kind: "WithdrawEvidence",
      entryId: entry.id,
      episodeIds: [C],
    });
    expect(last.status).toBe("applied");
    expect(last.detail).toContain("escalated_to_invalidate");
    const afterLast = umRow(entry.id);
    expect(afterLast.invalid_at).not.toBeNull();
    // The schema CHECK admits only 'evidence_withdrawn' here (§6.1 step 4).
    expect(afterLast.invalid_reason).toBe("evidence_withdrawn");
    expect(afterLast.evidence_ids).toBe("[]");
  });
});

// ---------------------------------------------------------------------------
// T-C64: insert guard admits non-conflicting candidates (+ INV-C-4, §4.3)
// ---------------------------------------------------------------------------

describe("T-C64: InsertConsolidated admissions and evidence rules", () => {
  it("a companion belief that does not contradict or duplicate a stated desire is admitted as origin='consolidated'", async () => {
    const E = seedEpisode("t-c64");
    recordStated(handle, SPACE, "desire", "I want to keep working at Samsonite", [
      { type: "episode", id: E },
    ]);
    const E2 = seedEpisode("t-c64-b");
    const res = await applyConsolidationMutation(handle.sqlite, ctx(), {
      kind: "InsertConsolidated",
      entry: {
        slot: "intention",
        content: "plans to save for a car",
        evidence: [{ type: "episode", id: E2 }],
        topicLabels: ["transport"],
      },
    });
    expect(res.status).toBe("applied");
    const row = umRow(res.entryId!);
    expect(row.origin).toBe("consolidated");
    expect(row.confidence as number).toBeLessThanOrEqual(0.69);
  });

  it("empty evidence rejects (INV-C-4); unknown-lineage evidence cannot ground an insert (§4.3)", async () => {
    const empty = await applyConsolidationMutation(handle.sqlite, ctx(), {
      kind: "InsertConsolidated",
      entry: {
        slot: "belief",
        content: "prefers the early shift",
        evidence: [],
        topicLabels: ["routine"],
      },
    });
    expect(empty.status).toBe("rejected");
    expect(empty.error).toBe("empty_evidence");

    // An episode captured with no recoverable lineage keeps lineage NULL.
    const noLineage = seedEpisode(undefined);
    const row = handle.sqlite
      .prepare(`SELECT lineage_key FROM episodes WHERE id = ?`)
      .get(noLineage) as { lineage_key: string | null };
    expect(row.lineage_key).toBeNull();
    const res = await applyConsolidationMutation(handle.sqlite, ctx(), {
      kind: "InsertConsolidated",
      entry: {
        slot: "belief",
        content: "prefers the early shift",
        evidence: [{ type: "episode", id: noLineage }],
        topicLabels: ["routine"],
      },
    });
    expect(res.status).toBe("rejected");
    expect(res.error).toBe("unknown_lineage");
    expect(consolidatedCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T-C66 / T-C67: Tier 2 catches what Tier 1 structurally cannot
// ---------------------------------------------------------------------------

describe("T-C66: Tier 2 deterministic pass catches a cross-topic contradiction", () => {
  it("candidate labeled 'routine' against a stated 'employment' belief: Tier 1 passes it, Tier 2 rejects — without spending an LLM judgment", async () => {
    const E = seedEpisode("t-c66");
    recordStated(handle, SPACE, "belief", "works at Samsonite full time", [
      { type: "episode", id: E },
    ]);
    let judgeCalls = 0;
    const judge: LlmJudge = async () => {
      judgeCalls += 1;
      return "compatible";
    };
    const E2 = seedEpisode("t-c66-b");
    const res = await applyConsolidationMutation(
      handle.sqlite,
      ctx({ llmJudge: judge }),
      {
        kind: "InsertConsolidated",
        entry: {
          slot: "belief",
          content: "unemployed and looking for work",
          evidence: [{ type: "episode", id: E2 }],
          topicLabels: ["routine"],
        },
      },
    );
    expect(res.status).toBe("rejected");
    expect(res.error).toBe("stated_contradiction_detected");
    expect(judgeCalls).toBe(0);
    expect(consolidatedCount("unemployed and looking for work")).toBe(0);
  });
});

describe("T-C67: Tier 2 semantic judgment catches a cross-slot contradiction", () => {
  it("consolidated intention defeating a stated desire: the judge is consulted on the ambiguous pair and its contradiction verdict rejects", async () => {
    const E = seedEpisode("t-c67");
    recordStated(handle, SPACE, "desire", "I want to keep working at Samsonite", [
      { type: "episode", id: E },
    ]);
    const seen: { candidate: string; entryContent: string }[] = [];
    const judge: LlmJudge = async (input) => {
      seen.push({ candidate: input.candidate, entryContent: input.entry.content });
      return "contradiction";
    };
    const E2 = seedEpisode("t-c67-b");
    const candidate = "intends to leave the warehouse for trucking";
    const res = await applyConsolidationMutation(
      handle.sqlite,
      ctx({ llmJudge: judge }),
      {
        kind: "InsertConsolidated",
        entry: {
          slot: "intention",
          content: candidate,
          evidence: [{ type: "episode", id: E2 }],
          topicLabels: mapTopics(candidate).labels,
        },
      },
    );
    expect(res.status).toBe("rejected");
    expect(res.error).toBe("stated_contradiction_detected");
    expect(seen.length).toBe(1);
    expect(seen[0]!.candidate).toBe(candidate);
    expect(seen[0]!.entryContent).toBe("I want to keep working at Samsonite");
    expect(consolidatedCount(candidate)).toBe(0);
  });

  it("an exhausted LLM budget defers the insert as failed_retryable instead of judging unboundedly", async () => {
    const E = seedEpisode("t-c67-budget");
    recordStated(handle, SPACE, "desire", "I want to keep working at Samsonite", [
      { type: "episode", id: E },
    ]);
    let judgeCalls = 0;
    const judge: LlmJudge = async () => {
      judgeCalls += 1;
      return "compatible";
    };
    const E2 = seedEpisode("t-c67-budget-b");
    const res = await applyConsolidationMutation(
      handle.sqlite,
      ctx({ llmJudge: judge, llmBudget: { remaining: 0 } }),
      {
        kind: "InsertConsolidated",
        entry: {
          slot: "intention",
          content: "intends to leave the warehouse for trucking",
          evidence: [{ type: "episode", id: E2 }],
          topicLabels: ["employment"],
        },
      },
    );
    expect(res.status).toBe("rejected");
    expect(res.error).toBe("stated_state_changed");
    expect(res.retryable).toBe(true);
    expect(judgeCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T-C68: no write lock across the LLM call; verdict voided by a concurrent
// stated write; the retry re-evaluates and Tier 1 rejects
// ---------------------------------------------------------------------------

describe("T-C68: optimistic concurrency — no lock held during judgment", () => {
  it("a correction on a second connection succeeds while the judge is in flight; the stale verdict is voided and the retry rejects via Tier 1 (stated_covers)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w3-m2-tc68-"));
    const file = path.join(dir, "test.db");
    const h1 = createDb(file);
    const h2 = createDb(file);
    try {
      const cap = (h: DbHandle, ex: string, lk: string) => {
        const r = captureEpisode(h, SPACE, {
          kind: "conversation",
          userExcerpt: ex,
          topicLabels: [],
          lineageKey: lk,
        });
        if (!r) throw new Error("capture failed");
        return r.episodeId;
      };
      const E1 = cap(h1, "tc68 first", "tc68-a");
      recordStated(h1, SPACE, "desire", "I want to keep working at Samsonite", [
        { type: "episode", id: E1 },
      ]);
      const E2 = cap(h1, "tc68 evidence", "tc68-b");

      let judgeCalls = 0;
      let releaseJudge: ((v: "compatible") => void) | null = null;
      const judge: LlmJudge = () => {
        judgeCalls += 1;
        if (judgeCalls === 1) {
          return new Promise<LlmJudgment>((resolve) => {
            releaseJudge = (v) => resolve(v);
          });
        }
        return Promise.resolve("compatible" as const);
      };

      const candidate = "intends to leave the warehouse for trucking";
      const pending = applyConsolidationMutation(
        h1.sqlite,
        { spaceId: SPACE, llmJudge: judge },
        {
          kind: "InsertConsolidated",
          entry: {
            slot: "intention",
            content: candidate,
            evidence: [{ type: "episode", id: E2 }],
            topicLabels: ["employment"],
          },
        },
      );
      // Wait until the judge is actually in flight.
      for (let i = 0; i < 50 && judgeCalls === 0; i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(judgeCalls).toBe(1);
      // THE lock assertion: Phase A holds no transaction on h1…
      expect(h1.sqlite.inTransaction).toBe(false);
      // …and a stated write on a SECOND connection succeeds immediately
      // (busy_timeout is 0 — a held write lock would throw SQLITE_BUSY).
      const E3 = cap(h2, "tc68 correction", "tc68-c");
      const S2 = recordStated(
        h2,
        SPACE,
        "intention",
        "I will keep working the Samsonite job",
        [{ type: "episode", id: E3 }],
      );
      expect(S2.id).toBeGreaterThan(0);

      releaseJudge!("compatible");
      const res = await pending;
      // The attempt-1 verdict was voided by the fingerprint check; the
      // retry's Tier 1 found S2 (same slot, overlapping topic, current).
      expect(res.status).toBe("rejected");
      expect(res.error).toBe("stated_covers");
      expect(judgeCalls).toBe(2);
      const n = h1.sqlite
        .prepare(
          `SELECT COUNT(*) AS n FROM user_model WHERE space_id = ? AND origin = 'consolidated' AND content = ?`,
        )
        .get(SPACE, candidate) as { n: number };
      expect(n.n).toBe(0);
    } finally {
      (h1.sqlite as unknown as { close(): void }).close();
      (h2.sqlite as unknown as { close(): void }).close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// T-C69: retry exhaustion fails closed
// ---------------------------------------------------------------------------

describe("T-C69: persistent stated-state churn exhausts retries — fail closed", () => {
  it("a stated write landing during every attempt rejects with stated_state_changed (retryable) and inserts nothing; the same insert succeeds once the set is stable", async () => {
    const E = seedEpisode("t-c69");
    recordStated(handle, SPACE, "desire", "I want to keep working at Samsonite", [
      { type: "episode", id: E },
    ]);
    let judgeCalls = 0;
    const churningJudge: LlmJudge = async () => {
      judgeCalls += 1;
      // A user correction lands during EVERY evaluation.
      recordStated(
        handle,
        SPACE,
        "belief",
        `believes the morning briefing covers topic ${judgeCalls}`,
        [{ type: "episode", id: E }],
      );
      return "compatible";
    };
    const candidate = "intends to leave the warehouse for trucking";
    const res = await applyConsolidationMutation(
      handle.sqlite,
      ctx({ llmJudge: churningJudge }),
      {
        kind: "InsertConsolidated",
        entry: {
          slot: "intention",
          content: candidate,
          evidence: [{ type: "episode", id: E }],
          topicLabels: ["employment"],
        },
      },
    );
    expect(res.status).toBe("rejected");
    expect(res.error).toBe("stated_state_changed");
    expect(res.retryable).toBe(true);
    expect(judgeCalls).toBe(3); // 1 initial + 2 retries, then fail closed
    expect(consolidatedCount(candidate)).toBe(0);

    const calmJudge: LlmJudge = async () => "compatible";
    const ok = await applyConsolidationMutation(
      handle.sqlite,
      ctx({ llmJudge: calmJudge }),
      {
        kind: "InsertConsolidated",
        entry: {
          slot: "intention",
          content: candidate,
          evidence: [{ type: "episode", id: E }],
          topicLabels: ["employment"],
        },
      },
    );
    expect(ok.status).toBe("applied");
    expect(consolidatedCount(candidate)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// T-C70: Tier 2 input bounds (50 beliefs / 8K tokens) — Tier 1 and the
// deterministic pass stay unbounded
// ---------------------------------------------------------------------------

describe("T-C70: Tier 2 selection bounds", () => {
  it("with 60 stated beliefs, the judged selection stays within 50 beliefs / 8K tokens, and a covering belief ranked outside the selection still rejects via Tier 1", async () => {
    const E = seedEpisode("t-c70");
    const covering = recordStated(
      handle,
      SPACE,
      "belief",
      "works at the Samsonite warehouse",
      [{ type: "episode", id: E }],
    );
    const locs = ["north", "south", "east", "west", "upper", "lower", "inner", "outer"];
    const descs = ["dock", "bay", "gate", "ramp", "pier", "yard", "depot", "annex"];
    let seeded = 0;
    for (const loc of locs) {
      for (const desc of descs) {
        if (seeded >= 55) break;
        recordStated(
          handle,
          SPACE,
          "knowledge",
          `knows the Samsonite warehouse pays weekly on the paycheck schedule at the ${loc} ${desc}`,
          [{ type: "episode", id: E }],
        );
        seeded += 1;
      }
    }
    // 4 more beliefs to reach 60 stated rows.
    for (const extra of ["alpha", "bravo", "charlie", "delta"]) {
      recordStated(handle, SPACE, "knowledge", `knows the break room code ${extra}`, [
        { type: "episode", id: E },
      ]);
    }
    const total = handle.sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM user_model WHERE space_id = ? AND origin = 'stated' AND invalid_at IS NULL`,
      )
      .get(SPACE) as { n: number };
    expect(total.n).toBe(60);

    const judgedIds: number[] = [];
    const judge: LlmJudge = async (input) => {
      judgedIds.push(input.entry.id);
      return "compatible";
    };
    const E2 = seedEpisode("t-c70-b");
    const res = await applyConsolidationMutation(
      handle.sqlite,
      // Constant estimator: every text "costs" 200 tokens, so the 8K cap
      // binds well before 50 beliefs — the bound logic is what's tested.
      ctx({ llmJudge: judge, estimateTokens: () => 200 }),
      {
        kind: "InsertConsolidated",
        entry: {
          slot: "belief",
          content: "believes the Samsonite warehouse pays weekly",
          evidence: [{ type: "episode", id: E2 }],
          topicLabels: ["employment", "finance"],
        },
      },
    );
    expect(res.status).toBe("rejected");
    expect(res.error).toBe("stated_covers");
    expect(res.entryId).toBe(covering.id);
    expect(res.tier2).toBeDefined();
    expect(res.tier2!.selectedBeliefs).toBeLessThanOrEqual(50);
    expect(res.tier2!.selectedTokens).toBeLessThanOrEqual(8000);
    // The covering belief was never in the judged selection.
    expect(judgedIds).not.toContain(covering.id);
  });

  it("a deterministic contradiction planted in the tail (outside any LLM selection) is still caught — Tier 2's deterministic pass is unbounded", async () => {
    const E = seedEpisode("t-c70-tail");
    const adjs = ["spicy", "sweet", "sour", "salty", "grilled", "baked", "fried", "fresh", "smoked", "pickled", "roasted", "steamed"];
    const styles = ["food", "meals", "dishes", "cooking", "snacks"];
    let seeded = 0;
    for (const a of adjs) {
      for (const s of styles) {
        if (seeded >= 59) break;
        recordStated(handle, SPACE, "belief", `likes ${a} ${s}`, [
          { type: "episode", id: E },
        ]);
        seeded += 1;
      }
    }
    recordStated(handle, SPACE, "belief", "works at Samsonite full time", [
      { type: "episode", id: E },
    ]);
    let judgeCalls = 0;
    const judge: LlmJudge = async () => {
      judgeCalls += 1;
      return "compatible";
    };
    const E2 = seedEpisode("t-c70-tail-b");
    const res = await applyConsolidationMutation(
      handle.sqlite,
      ctx({ llmJudge: judge }),
      {
        kind: "InsertConsolidated",
        entry: {
          slot: "belief",
          content: "unemployed and looking for work",
          evidence: [{ type: "episode", id: E2 }],
          topicLabels: ["routine"],
        },
      },
    );
    expect(res.status).toBe("rejected");
    expect(res.error).toBe("stated_contradiction_detected");
    expect(judgeCalls).toBe(0);
  });
});
