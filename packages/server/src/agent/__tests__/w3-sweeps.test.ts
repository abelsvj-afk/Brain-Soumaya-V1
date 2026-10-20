/**
 * W3 Milestone 2 — Phase F: the W2 sweeps refactored through the guarded
 * boundary (§6.3 sweep matrix). Design: docs/wisdom/w3-design.md Rev 11.
 * Plan test list: T-C1, T-C2, T-C3, T-C45, T-C46, T-C52.
 *
 * Real SQLite via createDb(). The sweeps are async since Milestone 2
 * (the boundary's insert path can await an LLM judge); they have no
 * production callers yet — the W3 scheduler arrives in Milestone 3.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../../db/client.js";
import { captureEpisode, applyForgetRequest } from "../episodic.js";
import {
  recordStated,
  updateUserModel,
  correctUserModel,
  getUserModel,
  sweepStaleEmotions,
  sweepWithdrawnEvidence,
  type EvidenceInput,
} from "../userModel.js";
import { applyConsolidationMutation } from "../consolidation/boundary.js";

const SPACE = "w3-m2-sweeps-space";
const DAY = 86_400_000;

let handle: DbHandle;

beforeEach(() => {
  handle = createDb(":memory:");
});

afterEach(() => {
  (handle.sqlite as unknown as { close(): void }).close();
});

let seq = 0;
function seedEpisode(lineageKey?: string): number {
  seq += 1;
  const res = captureEpisode(handle, SPACE, {
    kind: "conversation",
    userExcerpt: `sweeps test interaction ${seq}`,
    topicLabels: [],
    ...(lineageKey ? { lineageKey } : {}),
  });
  if (!res) throw new Error("captureEpisode returned null");
  return res.episodeId;
}

function ev(id: number): EvidenceInput[] {
  return [{ type: "episode", id }];
}

function umRow(id: number): Record<string, unknown> {
  return handle.sqlite
    .prepare(`SELECT * FROM user_model WHERE id = ?`)
    .get(id) as Record<string, unknown>;
}

function forgetEpisode(id: number): void {
  handle.sqlite
    .prepare(`UPDATE episodes SET forgotten_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), id);
}

function aged(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString();
}

// ---------------------------------------------------------------------------
// T-C1: sweep matrix — emotion/stale
// ---------------------------------------------------------------------------

describe("T-C1: sweepStaleEmotions matrix (§6.3)", () => {
  it("stale emotions expire (non-stated) or flag (stated); non-emotion rows and fresh emotions are untouched", async () => {
    const E = seedEpisode("t-c1");
    // Inferred stale emotion -> expire.
    const infEmo = updateUserModel(handle, SPACE, "inferred", {
      slot: "emotion_state",
      content: "seemed stressed about money",
      confidence: 0.5,
      evidence: ev(E),
      validAt: aged(8),
    });
    // Consolidated stale emotion -> expire (inserted via the boundary).
    const consEmo = await applyConsolidationMutation(
      handle.sqlite,
      { spaceId: SPACE },
      {
        kind: "InsertConsolidated",
        entry: {
          slot: "emotion_state",
          content: "felt calm after the shift",
          evidence: [{ type: "episode", id: E }],
          topicLabels: ["routine"],
          validAt: aged(8),
        },
      },
    );
    expect(consEmo.status).toBe("applied");
    // Stated stale emotion -> flag, never expire.
    const statedEmo = recordStated(
      handle,
      SPACE,
      "emotion_state",
      "stressed about the fee",
      ev(E),
    );
    // Non-emotion rows, all origins, very stale -> untouched.
    const infBelief = updateUserModel(handle, SPACE, "inferred", {
      slot: "belief",
      content: "believes the diagnosis is serious",
      confidence: 0.5,
      evidence: ev(E),
      validAt: aged(30),
    });
    const statedBelief = recordStated(
      handle,
      SPACE,
      "belief",
      "works at Samsonite",
      ev(E),
    );
    // Fresh emotion -> untouched.
    const freshEmo = updateUserModel(handle, SPACE, "inferred", {
      slot: "emotion_state",
      content: "seemed proud today",
      confidence: 0.5,
      evidence: ev(E),
    });
    // Age the two rows the write paths can't backdate.
    handle.sqlite
      .prepare(`UPDATE user_model SET valid_at = ? WHERE id = ?`)
      .run(aged(8), statedEmo.id);
    handle.sqlite
      .prepare(`UPDATE user_model SET valid_at = ? WHERE id = ?`)
      .run(aged(30), statedBelief.id);

    const res = await sweepStaleEmotions(handle, SPACE);
    expect(res.expiredCount).toBe(2);
    expect(res.flaggedStatedCount).toBe(1);

    expect(umRow(infEmo.id).invalid_reason).toBe("expired");
    expect(umRow(consEmo.entryId!).invalid_reason).toBe("expired");
    const st = umRow(statedEmo.id);
    expect(st.invalid_at).toBeNull();
    expect(st.review_flag).toBe("stale_emotion");
    expect(umRow(infBelief.id).invalid_at).toBeNull();
    expect(umRow(statedBelief.id).invalid_at).toBeNull();
    expect(umRow(statedBelief.id).review_flag).toBeNull();
    expect(umRow(freshEmo.id).invalid_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T-C2: sweep matrix — evidence/withdrawal
// ---------------------------------------------------------------------------

describe("T-C2: sweepWithdrawnEvidence matrix (§6.3)", () => {
  it("all-withdrawn: non-stated invalidates, stated flags; partial: non-stated recomputes via the boundary, stated is left alone", async () => {
    const F = seedEpisode("t-c2-forgotten");
    const K = seedEpisode("t-c2-kept");
    const K2 = seedEpisode("t-c2-kept-2");
    const inferredAll = updateUserModel(handle, SPACE, "inferred", {
      slot: "belief",
      content: "believes the diagnosis is serious",
      confidence: 0.5,
      evidence: ev(F),
    });
    const statedAll = recordStated(handle, SPACE, "belief", "believes rest is needed", ev(F));
    const statedPartial = recordStated(handle, SPACE, "belief", "works at Samsonite", [
      { type: "episode", id: F },
      { type: "episode", id: K2 },
    ]);
    const inferredPartial = updateUserModel(handle, SPACE, "inferred", {
      slot: "belief",
      content: "believes the shift is long",
      confidence: 0.5,
      evidence: [
        { type: "episode", id: F },
        { type: "episode", id: K },
      ],
    });
    const statedPartialBefore = JSON.stringify(umRow(statedPartial.id));

    forgetEpisode(F);
    const res = await sweepWithdrawnEvidence(handle, SPACE);
    expect(res.invalidatedIds).toEqual([inferredAll.id]);
    expect(res.flaggedStatedIds).toEqual([statedAll.id]);

    expect(umRow(inferredAll.id).invalid_reason).toBe("evidence_withdrawn");
    const stAll = umRow(statedAll.id);
    expect(stAll.invalid_at).toBeNull();
    expect(stAll.review_flag).toBe("evidence_withdrawn");
    // Partial on a stated row: nothing at all (§6.3 'none').
    expect(JSON.stringify(umRow(statedPartial.id))).toBe(statedPartialBefore);
    // Partial on a non-stated row: dead evidence withdrawn through the
    // boundary; strength recomputed over the surviving group (§4.4).
    const part = umRow(inferredPartial.id);
    expect(part.invalid_at).toBeNull();
    expect(JSON.parse(part.evidence_ids as string)).toEqual([
      { type: "episode", id: K },
    ]);
    expect(part.evidence_strength as number).toBeCloseTo(0.34, 3);
  });

  it("an entry whose refs are all 'withdrawn' via a missing (deleted) node invalidates like any all-withdrawn entry", async () => {
    const E = seedEpisode("t-c2-node");
    // A node row created directly (the shape the W2 tests use).
    const nodeInfo = handle.sqlite
      .prepare(
        `INSERT INTO nodes (space_id, label, type, content) VALUES (?, ?, ?, ?)`,
      )
      .run(SPACE, "the depot gate code", "memory", "content of the depot gate code");
    const nodeId = Number(nodeInfo.lastInsertRowid);
    const entry = updateUserModel(handle, SPACE, "inferred", {
      slot: "belief",
      content: "believes the gate code is known",
      confidence: 0.5,
      evidence: [
        { type: "episode", id: E },
        { type: "node", id: nodeId },
      ],
    });
    forgetEpisode(E);
    handle.sqlite.prepare(`DELETE FROM nodes WHERE id = ?`).run(nodeId);
    const res = await sweepWithdrawnEvidence(handle, SPACE);
    expect(res.invalidatedIds).toEqual([entry.id]);
    expect(umRow(entry.id).invalid_reason).toBe("evidence_withdrawn");
  });
});

// ---------------------------------------------------------------------------
// T-C3: repeated sweeps and re-flagging across successive forgets
// ---------------------------------------------------------------------------

describe("T-C3: successive forgets accumulate", () => {
  it("an entry with two episodes is invalidated only when both are forgotten; a stated entry is flagged only at full withdrawal", async () => {
    const F1 = seedEpisode("t-c3-a");
    const F2 = seedEpisode("t-c3-b");
    const inferred = updateUserModel(handle, SPACE, "inferred", {
      slot: "belief",
      content: "believes the diagnosis is serious",
      confidence: 0.5,
      evidence: [
        { type: "episode", id: F1 },
        { type: "episode", id: F2 },
      ],
    });
    const stated = recordStated(handle, SPACE, "belief", "believes rest is needed", [
      { type: "episode", id: F1 },
      { type: "episode", id: F2 },
    ]);

    forgetEpisode(F1);
    const first = await sweepWithdrawnEvidence(handle, SPACE);
    expect(first.invalidatedIds).toEqual([]);
    expect(first.flaggedStatedIds).toEqual([]);
    expect(umRow(inferred.id).invalid_at).toBeNull();
    expect(umRow(stated.id).review_flag).toBeNull();

    forgetEpisode(F2);
    const second = await sweepWithdrawnEvidence(handle, SPACE);
    expect(second.invalidatedIds).toEqual([inferred.id]);
    expect(second.flaggedStatedIds).toEqual([stated.id]);
    expect(umRow(stated.id).review_flag).toBe("evidence_withdrawn");
    expect(umRow(stated.id).invalid_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T-C45: flagged stated emotions still expire from READS by age
// ---------------------------------------------------------------------------

describe("T-C45: review flags do not resurrect aged emotions in reads", () => {
  it("a stated emotion older than 7 days is excluded from getUserModel before and after being flagged; a fresh stated emotion remains", async () => {
    const E = seedEpisode("t-c45");
    const stale = recordStated(handle, SPACE, "emotion_state", "stressed about the fee", ev(E));
    const fresh = recordStated(handle, SPACE, "emotion_state", "proud about the job", ev(E));
    handle.sqlite
      .prepare(`UPDATE user_model SET valid_at = ? WHERE id = ?`)
      .run(aged(8), stale.id);

    const before = getUserModel(handle, SPACE, { slot: "emotion_state" }).map(
      (e) => e.content,
    );
    expect(before).toEqual(["proud about the job"]);

    const swept = await sweepStaleEmotions(handle, SPACE);
    expect(swept.flaggedStatedCount).toBe(1);
    expect(umRow(stale.id).review_flag).toBe("stale_emotion");

    const after = getUserModel(handle, SPACE, { slot: "emotion_state" }).map(
      (e) => e.content,
    );
    expect(after).toEqual(["proud about the job"]);
    expect(umRow(fresh.id).review_flag).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T-C46: consolidated rows behave under the W2 flows (forget)
// ---------------------------------------------------------------------------

describe("T-C46: forget flow classifies a boundary-inserted consolidated row", () => {
  it("forgetting its sole episode evidence invalidates the consolidated entry via the forget propagation, not a review flag", async () => {
    const E = seedEpisode("t-c46");
    const ins = await applyConsolidationMutation(
      handle.sqlite,
      { spaceId: SPACE },
      {
        kind: "InsertConsolidated",
        entry: {
          slot: "belief",
          content: "prefers the early shift",
          evidence: [{ type: "episode", id: E }],
          topicLabels: ["routine"],
        },
      },
    );
    expect(ins.status).toBe("applied");

    const req = handle.sqlite
      .prepare(
        `INSERT INTO forget_requests (space_id, target_episode_id, target_node_id, target_query)
         VALUES (?, ?, NULL, NULL)`,
      )
      .run(SPACE, E);
    const reqId = Number(req.lastInsertRowid);
    handle.sqlite
      .prepare(
        `UPDATE forget_requests
         SET status = 'approved', target_query = NULL,
             scope_episode_ids = ?, scope_node_ids = '[]', scope_topics = '[]'
         WHERE id = ?`,
      )
      .run(JSON.stringify([E]), reqId);
    const applied = applyForgetRequest(handle, reqId);
    expect(applied).toBeTruthy();

    const row = umRow(ins.entryId!);
    expect(row.invalid_at).not.toBeNull();
    expect(row.invalid_reason).toBe("evidence_withdrawn");
    expect(row.review_flag).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T-C52: sweep/correction concurrency — correction first wins
// ---------------------------------------------------------------------------

describe("T-C52: a user correction landing first wins; the sweep adapts", () => {
  it("a stated entry corrected before the sweep is not double-processed and keeps the correction's reason", async () => {
    const F = seedEpisode("t-c52");
    const S = recordStated(handle, SPACE, "belief", "believes the fee is $85", ev(F));
    forgetEpisode(F);
    // The user's correction lands FIRST.
    const corr = correctUserModel(handle, SPACE, S.id, {
      text: "the fee is not $85",
      type: "false_belief",
    });
    expect(corr.status).toBe("applied");

    const res = await sweepWithdrawnEvidence(handle, SPACE);
    expect(res.flaggedStatedIds).toEqual([]);
    const row = umRow(S.id);
    expect(row.invalid_reason).toBe("corrected_false_belief");
    expect(row.review_flag).toBeNull();
  });

  it("a factual-update replacement carries fresh evidence; the sweep leaves the replacement untouched", async () => {
    const F = seedEpisode("t-c52-b");
    const S = recordStated(handle, SPACE, "belief", "believes the fee is $85", ev(F));
    forgetEpisode(F);
    const corr = correctUserModel(handle, SPACE, S.id, {
      text: "the $85 fee is actually $90",
      type: "factual_update",
      newContent: "believes the fee is $90",
      evidence: ev(F),
    });
    expect(corr.status).toBe("applied");
    // Give the replacement its own live evidence.
    const live = seedEpisode("t-c52-live");
    handle.sqlite
      .prepare(`UPDATE user_model SET evidence_ids = ? WHERE id = ?`)
      .run(JSON.stringify([{ type: "episode", id: live }]), corr.newEntryId!);

    const res = await sweepWithdrawnEvidence(handle, SPACE);
    expect(res.flaggedStatedIds).toEqual([]);
    const repl = umRow(corr.newEntryId!);
    expect(repl.invalid_at).toBeNull();
    expect(repl.review_flag).toBeNull();
  });

  it("the boundary's in-transaction re-read makes a stale mutation a no-op instead of a lost update", async () => {
    const E = seedEpisode("t-c52-c");
    const entry = updateUserModel(handle, SPACE, "inferred", {
      slot: "belief",
      content: "believes the diagnosis is serious",
      confidence: 0.5,
      evidence: ev(E),
    });
    const first = await applyConsolidationMutation(
      handle.sqlite,
      { spaceId: SPACE },
      { kind: "InvalidateEntry", entryId: entry.id, reason: "expired" },
    );
    expect(first.status).toBe("applied");
    // A second, stale mutation (planned against the pre-invalidation
    // snapshot) re-reads inside its transaction and adapts: no-op, and
    // the original invalidation reason is NOT overwritten.
    const stale = await applyConsolidationMutation(
      handle.sqlite,
      { spaceId: SPACE },
      { kind: "InvalidateEntry", entryId: entry.id, reason: "evidence_withdrawn" },
    );
    expect(stale.status).toBe("noop");
    expect(umRow(entry.id).invalid_reason).toBe("expired");
    const staleWithdraw = await applyConsolidationMutation(
      handle.sqlite,
      { spaceId: SPACE },
      { kind: "WithdrawEvidence", entryId: entry.id, episodeIds: [E] },
    );
    expect(staleWithdraw.status).toBe("rejected");
    expect(staleWithdraw.error).toBe("entry_not_current");
  });
});
