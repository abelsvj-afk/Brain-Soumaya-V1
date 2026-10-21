/**
 * W3 Milestone 1 tests — Phase A: W2 hardening + stated_set_version wiring.
 *
 * Design: docs/wisdom/w3-design.md (Revision 11, owner-approved).
 * - §1.2 hardening: stated entries are excluded from updateUserModel
 *   contradiction invalidation at ANY confidence (the 0.95 carve-out is
 *   removed), and sweepStaleEmotions never expires a stated row — it flags
 *   it for review instead (T-C23/T-C25 assert the hardening holds while the
 *   authorized correction path still works).
 * - §8.6 write contract: space_meta.stated_set_version increments in the
 *   same transaction as every stated-row write — recordStated,
 *   correctUserModel, updateUserModel (defensive wiring), and the forget
 *   flow (T-C26 Milestone-1 portion; T-C81 forget-path portion — the
 *   reconciliation-marker behavior completes in Milestone 4).
 *
 * Real SQLite via createDb(":memory:"); no mocked transactional outcomes.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../../db/client.js";
import { captureEpisode, applyForgetRequest } from "../episodic.js";
import {
  recordStated,
  updateUserModel,
  correctUserModel,
  sweepStaleEmotions,
  type EvidenceInput,
} from "../userModel.js";

const SPACE = "w3-m1-hardening-space";

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

function seedEpisode(excerpt = "test interaction"): number {
  const res = captureEpisode(handle, SPACE, {
    kind: "conversation",
    userExcerpt: excerpt,
    topicLabels: [],
  });
  if (!res) throw new Error("captureEpisode returned null in seedEpisode");
  return res.episodeId;
}

function ev(id: number): EvidenceInput[] {
  return [{ type: "episode", id }];
}

/** stated_set_version for the space (0 when no space_meta row exists yet). */
function statedVersion(): number {
  const row = handle.sqlite
    .prepare(`SELECT stated_set_version FROM space_meta WHERE space_id = ?`)
    .get(SPACE) as { stated_set_version: number } | undefined;
  return row?.stated_set_version ?? 0;
}

function userModelRowJson(id: number): string {
  const row = handle.sqlite
    .prepare(`SELECT * FROM user_model WHERE id = ?`)
    .get(id) as Record<string, unknown>;
  return JSON.stringify(row);
}

function userModelRow(id: number): Record<string, unknown> {
  return handle.sqlite
    .prepare(`SELECT * FROM user_model WHERE id = ?`)
    .get(id) as Record<string, unknown>;
}

function createForgetRequest(targetEpisodeId: number): number {
  const r = handle.sqlite
    .prepare(
      `INSERT INTO forget_requests
         (space_id, target_episode_id, target_node_id, target_query)
       VALUES (?, ?, NULL, NULL)`,
    )
    .run(SPACE, targetEpisodeId);
  return Number(r.lastInsertRowid);
}

function approveForgetRequest(id: number, episodeIds: number[]): void {
  handle.sqlite
    .prepare(
      `UPDATE forget_requests
       SET status = 'approved', target_query = NULL,
           scope_episode_ids = ?, scope_node_ids = '[]', scope_topics = '[]'
       WHERE id = ?`,
    )
    .run(JSON.stringify(episodeIds), id);
}

// ---------------------------------------------------------------------------
// T-C23: stated protection (the §1.2 0.95 carve-out regression)
// ---------------------------------------------------------------------------

describe("T-C23: stated protection", () => {
  it("a consolidated write contradicting a stated entry at 0.90 leaves it byte-identical", () => {
    const E = seedEpisode();
    const stated = recordStated(handle, SPACE, "belief", "believes the fee is $90", ev(E));
    // The pre-fix carve-out protected ONLY confidence >= 0.95. Drop the
    // stated row to 0.90 — the exact case the old filter let through.
    handle.sqlite
      .prepare(`UPDATE user_model SET confidence = 0.90 WHERE id = ?`)
      .run(stated.id);
    const before = userModelRowJson(stated.id);
    const versionBefore = statedVersion();

    const res = updateUserModel(handle, SPACE, "consolidated", {
      slot: "belief",
      content: "believes the fee is $85",
      confidence: 0.8,
      evidence: ev(E),
    });

    // The consolidated entry itself is written (consolidation is not
    // blocked) — but the stated row is untouched and still current.
    expect(res.invalidatedIds).not.toContain(stated.id);
    expect(userModelRowJson(stated.id)).toBe(before);
    expect(userModelRow(stated.id).invalid_at).toBeNull();
    // No stated-row write happened, so the version does not move.
    expect(statedVersion()).toBe(versionBefore);
  });

  it("stated-vs-stated conflicts still surface via recordStated's conflictingStatedIds", () => {
    const E = seedEpisode();
    recordStated(handle, SPACE, "belief", "believes the fee is $90", ev(E));
    const res = recordStated(handle, SPACE, "belief", "believes the fee is $85", ev(E));
    expect(res.conflictingStatedIds.length).toBeGreaterThan(0);
    // ...and the newer statement does NOT silently invalidate the older one.
    const both = handle.sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM user_model
         WHERE space_id = ? AND origin = 'stated' AND invalid_at IS NULL`,
      )
      .get(SPACE) as { n: number };
    expect(both.n).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// T-C25: authorized path still works
// ---------------------------------------------------------------------------

describe("T-C25: authorized path still works", () => {
  it("correctUserModel still mutates a stated entry (false_belief)", () => {
    const E = seedEpisode();
    const entry = recordStated(handle, SPACE, "belief", "believes the fee is $85", ev(E));
    const res = correctUserModel(handle, SPACE, entry.id, {
      text: "the fee is not $85",
      type: "false_belief",
    });
    expect(res.status).toBe("applied");
    const row = userModelRow(entry.id);
    expect(row.invalid_at).not.toBeNull();
    expect(row.invalid_reason).toBe("corrected_false_belief");
    expect(row.replaced_by).toBeNull();
  });

  it("correctUserModel factual_update writes the stated replacement", () => {
    const E = seedEpisode();
    const entry = recordStated(handle, SPACE, "belief", "believes the fee is $85", ev(E));
    const res = correctUserModel(handle, SPACE, entry.id, {
      text: "the $85 fee is actually $90",
      type: "factual_update",
      newContent: "believes the fee is $90",
      evidence: ev(E),
    });
    expect(res.status).toBe("applied");
    expect(res.newEntryId).not.toBeNull();
    const old = userModelRow(entry.id);
    expect(old.invalid_reason).toBe("superseded");
    expect(old.replaced_by).toBe(res.newEntryId);
    const fresh = userModelRow(res.newEntryId!);
    expect(fresh.content).toBe("believes the fee is $90");
    expect(fresh.origin).toBe("stated");
  });
});

// ---------------------------------------------------------------------------
// T-C26 (Milestone 1 portion): stated_set_version moves on authorized writes
// ---------------------------------------------------------------------------

describe("T-C26 (M1 portion): version bump on authorized stated writes", () => {
  it("recordStated bumps by exactly 1; a correction invalidates any prior snapshot", () => {
    const E = seedEpisode();
    const v0 = statedVersion();
    const entry = recordStated(handle, SPACE, "belief", "believes the fee is $85", ev(E));
    expect(statedVersion()).toBe(v0 + 1);

    // A consumer (e.g. a reconciliation marker) holding v0+1 is stale the
    // moment the authorized correction lands: stated target invalidation
    // (+1) plus the stated replacement insert (+1) = +2.
    const snapshot = statedVersion();
    const res = correctUserModel(handle, SPACE, entry.id, {
      text: "the $85 fee is actually $90",
      type: "factual_update",
      newContent: "believes the fee is $90",
      evidence: ev(E),
    });
    expect(res.status).toBe("applied");
    expect(statedVersion()).toBe(snapshot + 2);
    // The stated set reflects ONLY the correction — no collateral mutation:
    expect(userModelRow(entry.id).invalid_reason).toBe("superseded");
    expect(userModelRow(res.newEntryId!).invalid_at).toBeNull();
  });

  it("false_belief on a stated target bumps by exactly 1 (no replacement)", () => {
    const E = seedEpisode();
    const entry = recordStated(handle, SPACE, "belief", "believes the fee is $85", ev(E));
    const v = statedVersion();
    correctUserModel(handle, SPACE, entry.id, {
      text: "the fee is not $85",
      type: "false_belief",
    });
    expect(statedVersion()).toBe(v + 1);
  });

  it("a correction writing an explicit constraint counts that stated insert too", () => {
    const E = seedEpisode();
    const entry = recordStated(handle, SPACE, "belief", "believes he will always be broke", ev(E));
    const v = statedVersion();
    const res = correctUserModel(handle, SPACE, entry.id, {
      text: "stop assuming I'm always broke",
      type: "preference_override",
      constraintContent: "never assume he is broke",
      constraintEvidence: ev(E),
    });
    expect(res.status).toBe("applied");
    expect(res.constraintEntryId).not.toBeNull();
    // Target invalidation (+1) + constraint insert (+1); no replacement.
    expect(statedVersion()).toBe(v + 2);
  });

  it("non-stated writes do NOT move the version", () => {
    const E = seedEpisode();
    const v = statedVersion();
    updateUserModel(handle, SPACE, "inferred", {
      slot: "belief",
      content: "might prefer morning reminders",
      confidence: 0.5,
      evidence: ev(E),
    });
    expect(statedVersion()).toBe(v);
  });
});

// ---------------------------------------------------------------------------
// T-C81 (partial): forget-path stated write bumps the version exactly once
// ---------------------------------------------------------------------------

describe("T-C81 (partial): forget invalidating a stated entry bumps V → V+1", () => {
  it("tombstoning a stated entry's sole evidence bumps by exactly 1", () => {
    const E = seedEpisode("health discussion to forget");
    const stated = recordStated(
      handle,
      SPACE,
      "belief",
      "believes his health routine needs rest",
      ev(E),
    );
    const v = statedVersion();

    const req = createForgetRequest(E);
    approveForgetRequest(req, [E]);
    const applied = applyForgetRequest(handle, req);

    expect(applied.userModelInvalidated).toContain(stated.id);
    const row = userModelRow(stated.id);
    expect(row.invalid_at).not.toBeNull();
    expect(row.invalid_reason).toBe("evidence_withdrawn");
    expect(statedVersion()).toBe(v + 1);
  });

  it("a forget touching no stated rows leaves the version unchanged", () => {
    const E = seedEpisode("inferred-only evidence");
    const inferred = updateUserModel(handle, SPACE, "inferred", {
      slot: "belief",
      content: "believes the diagnosis is serious",
      confidence: 0.5,
      evidence: ev(E),
    });
    const v = statedVersion();
    const req = createForgetRequest(E);
    approveForgetRequest(req, [E]);
    const applied = applyForgetRequest(handle, req);
    expect(applied.userModelInvalidated).toContain(inferred.id);
    expect(statedVersion()).toBe(v);
  });

  it("pruning a stated entry's evidence (partial withdrawal) also bumps by 1", () => {
    const E = seedEpisode("episode to forget");
    const E2 = seedEpisode("episode that stays");
    const stated = recordStated(handle, SPACE, "belief", "believes two things support this", [
      { type: "episode", id: E },
      { type: "episode", id: E2 },
    ]);
    const v = statedVersion();
    const req = createForgetRequest(E);
    approveForgetRequest(req, [E]);
    const applied = applyForgetRequest(handle, req);
    expect(applied.userModelPruned).toContain(stated.id);
    expect(userModelRow(stated.id).invalid_at).toBeNull();
    expect(statedVersion()).toBe(v + 1);
  });
});

// ---------------------------------------------------------------------------
// E6 (Package E, 2026-10-21): forget-flow transactional pin for the
// user_model side specifically. The W2 rollback pin (w2.test.ts "a fault
// mid-apply rolls back the entire propagation") faults at the tombstone
// UPDATE — step 1, BEFORE any user_model write exists to roll back. This
// pin faults DURING step 5 (evidence propagation), after the first claim
// has already been suspended inside the transaction: no partial
// suspension/pruning may survive — the earlier write, the episode
// tombstone, the version, and the request status all roll back.
// ---------------------------------------------------------------------------

describe("E6: a fault mid-propagation rolls back the forget flow's user_model writes too", () => {
  it("suspension written before the fault is rolled back; nothing is half-applied", () => {
    const E = seedEpisode("episode both claims rest on");
    // Two sole-evidence claims on the same episode: the propagation loop
    // suspends the first, then reaches the second — where the fault fires.
    const first = recordStated(handle, SPACE, "belief", "believes the first thing", ev(E));
    const second = recordStated(handle, SPACE, "belief", "believes the second thing", ev(E));
    const v = statedVersion();

    const req = createForgetRequest(E);
    approveForgetRequest(req, [E]);

    handle.sqlite.exec(
      `CREATE TRIGGER e6_test_fault BEFORE UPDATE ON user_model
       WHEN NEW.id = ${second.id} BEGIN SELECT RAISE(ABORT, 'e6 injected fault'); END;`,
    );
    try {
      expect(() => applyForgetRequest(handle, req)).toThrow(/e6 injected fault/);
    } finally {
      handle.sqlite.exec(`DROP TRIGGER e6_test_fault`);
    }
    // The first claim's suspension (already executed inside the tx) is gone.
    expect(userModelRow(first.id).invalid_at).toBeNull();
    expect(userModelRow(first.id).invalid_reason).toBeNull();
    expect(userModelRow(second.id).invalid_at).toBeNull();
    // Episode side rolled back too: no tombstone.
    const ep = handle.sqlite
      .prepare(`SELECT summary, forgotten_at FROM episodes WHERE id = ?`)
      .get(E) as { summary: string; forgotten_at: string | null };
    expect(ep.forgotten_at).toBeNull();
    expect(ep.summary).not.toContain("[redacted per forget request");
    // No version bump, request still approved (never marked applied).
    expect(statedVersion()).toBe(v);
    const fr = handle.sqlite
      .prepare(`SELECT status FROM forget_requests WHERE id = ?`)
      .get(req) as { status: string };
    expect(fr.status).toBe("approved");
  });
});

// ---------------------------------------------------------------------------
// §6.3 sweep matrix (Phase A wiring): stated emotion rows are flagged,
// never expired, by sweepStaleEmotions.
// ---------------------------------------------------------------------------

describe("sweepStaleEmotions: stated rows flagged, never expired (§6.3)", () => {
  it("expires stale inferred emotions but flags stale stated emotions", async () => {
    const E = seedEpisode();
    const statedRow = recordStated(handle, SPACE, "emotion_state", "stressed about the fee", ev(E));
    const inferredRow = updateUserModel(handle, SPACE, "inferred", {
      slot: "emotion_state",
      content: "seemed stressed about money",
      confidence: 0.5,
      evidence: ev(E),
    });
    // Age both past the 7-day emotion horizon.
    handle.sqlite
      .prepare(`UPDATE user_model SET valid_at = '2026-09-01T00:00:00.000Z' WHERE space_id = ?`)
      .run(SPACE);
    const v = statedVersion();

    const swept = await sweepStaleEmotions(handle, SPACE);
    expect(swept.expiredCount).toBe(1);
    expect(swept.flaggedStatedCount).toBe(1);

    const inferred = userModelRow(inferredRow.id);
    expect(inferred.invalid_at).not.toBeNull();
    expect(inferred.invalid_reason).toBe("expired");

    const stated = userModelRow(statedRow.id);
    expect(stated.invalid_at).toBeNull(); // still current — the user's word stands
    expect(stated.review_flag).toBe("stale_emotion");
    expect(stated.review_flagged_at).not.toBeNull();
    // The flag write is a stated-row write: version bumped by exactly 1.
    expect(statedVersion()).toBe(v + 1);

    // Set-once: a second sweep performs no write and no bump.
    const again = await sweepStaleEmotions(handle, SPACE);
    expect(again.flaggedStatedCount).toBe(0);
    expect(statedVersion()).toBe(v + 1);
  });
});
