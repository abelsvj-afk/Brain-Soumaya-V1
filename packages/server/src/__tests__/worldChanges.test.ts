import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { EdgesRepo } from "../repositories/edges.repo.js";
import { JourneysRepo } from "../repositories/journeys.repo.js";
import {
  computeMutationSignals,
  decideWorldChange,
  explainChange,
  getMutationState,
  listProposals,
  listWorldChangeLog,
  proposeWorldChange,
  sweepWorldProposals,
  undoWorldChange,
} from "../worlds/mutation.js";
import { proposeDreamCycle } from "../analysis/dreamCycle.js";
import { maybeRecordStated } from "../agent/userModel.js";
import { runDistillation } from "../agent/consolidation/distill.js";
import "../worlds/brainAppliers.js"; // side-effect registration for decide/sweep

let handle: DbHandle;
let ctx: AppContext;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = { handle, embeddings, llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
});
afterEach(() => handle.sqlite.close());

const SPACE = "legacy";

function count(table: string, where = ""): number {
  return (
    handle.sqlite.prepare(`SELECT COUNT(*) c FROM ${table} ${where}`).get() as { c: number }
  ).c;
}

/** The one pending proposal of a kind (fails the test loudly if absent). */
function pendingProposal(kind: string): number {
  const found = listProposals(handle.sqlite, SPACE, { kind, status: "pending" });
  expect(found).toHaveLength(1);
  return found[0]!.id;
}

/** A hub memory wired to `n` neighbors — a consolidatable cluster. */
async function makeCluster(spaceId: string, n: number): Promise<number> {
  const repo = new NodesRepo(handle, spaceId);
  const edges = new EdgesRepo(handle, spaceId);
  const hub = repo.create(
    { label: "money worry", type: "daily", content: "always anxious about money" } as never,
    await embeddings.embed("money anxiety debt"),
  );
  for (let i = 0; i < n; i++) {
    const m = repo.create(
      { label: `bill ${i}`, type: "daily", content: `stressed about bill ${i}`, emotionalWeight: -0.6 } as never,
      await embeddings.embed(`bill money stress ${i}`),
    );
    edges.create({ source: hub.id, target: m.id, relationship: "relates_to", weight: 0.7 });
  }
  return hub.id;
}

function makeEpisode(summary: string): number {
  const now = new Date().toISOString();
  const info = handle.sqlite
    .prepare(
      `INSERT INTO episodes (space_id, kind, summary, occurred_at, recorded_at, lineage_key)
       VALUES (?, 'conversation', ?, ?, ?, 'test-lineage')`,
    )
    .run(SPACE, summary, now, now);
  const id = Number(info.lastInsertRowid);
  handle.sqlite
    .prepare(
      `INSERT INTO episode_enrichments (episode_id, space_id, version, detail, importance)
       VALUES (?, ?, 1, ?, 0.9)`,
    )
    .run(id, SPACE, summary);
  return id;
}

describe("world-change rail (§17)", () => {
  it("creates the four tables", () => {
    for (const t of ["world_proposals", "world_change_log", "world_landmarks", "world_paths"]) {
      expect(count("sqlite_master", `WHERE type='table' AND name='${t}'`)).toBe(1);
    }
  });

  it("landmark: done journey → proposal → approve applies landmark + log atomically", async () => {
    const journey = new JourneysRepo(handle, SPACE).create({ title: "First marathon", status: "done" });
    const signals = computeMutationSignals(handle, SPACE);
    expect(signals.proposedLandmarks).toBe(1);
    const found = listProposals(handle.sqlite, SPACE, { kind: "landmark" });
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe("landmark");
    expect(found[0]?.targetId).toBe(String(journey.id)); // targetId is stored as text by design

    const decided = await decideWorldChange(ctx, SPACE, pendingProposal("landmark"), "approve", SPACE);
    expect(decided.ok).toBe(true);
    expect(decided.proposal?.status).toBe("applied");
    expect(count("world_landmarks", `WHERE space_id='${SPACE}' AND journey_id=${journey.id}`)).toBe(1);
    expect(count("world_change_log", `WHERE space_id='${SPACE}' AND proposal_id=${decided.proposal!.id}`)).toBe(1);

    const state = getMutationState(ctx, SPACE);
    expect(state.appliedCount).toBe(1);
    expect(state.landmarks).toHaveLength(1);
    expect(state.landmarks[0]?.journeyId).toBe(journey.id);
    expect(state.paths).toHaveLength(0);
  });

  it("dedup: the same proposal twice returns the standing one", () => {
    const first = proposeWorldChange(handle.sqlite, SPACE, {
      kind: "landmark",
      targetKind: "journey",
      targetId: 7,
      title: "Landmark",
      reason: "A milestone.",
      payload: { journeyId: 7, label: "Seven" },
      dedupKey: "landmark:journey:7",
    });
    const second = proposeWorldChange(handle.sqlite, SPACE, {
      kind: "landmark",
      targetKind: "journey",
      targetId: 7,
      title: "Landmark",
      reason: "A milestone.",
      payload: { journeyId: 7, label: "Seven" },
      dedupKey: "landmark:journey:7",
    });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.proposal.id).toBe(first.proposal.id);
    expect(count("world_proposals")).toBe(1);
  });

  it("M5: warm memories move warmth only — no structural proposal from emotion alone", async () => {
    const repo = new NodesRepo(handle, SPACE);
    repo.create(
      { label: "warm day", type: "daily", content: "a golden afternoon", emotionalWeight: 0.9 } as never,
      await embeddings.embed("warm golden afternoon"),
    );
    repo.create(
      { label: "cold note", type: "daily", content: "a flat tuesday", emotionalWeight: 0.1 } as never,
      await embeddings.embed("flat tuesday"),
    );
    const signals = computeMutationSignals(handle, SPACE);
    expect(signals.warmth).toBeCloseTo(0.5, 5);
    expect(signals.proposedLandmarks).toBe(0);
    expect(signals.proposedPaths).toBe(0);
    expect(listProposals(handle.sqlite, SPACE)).toHaveLength(0);
  });

  it("path: a real edge between two real memories → proposal → approve draws the path", async () => {
    const repo = new NodesRepo(handle, SPACE);
    const a = repo.create(
      { label: "first run", type: "daily", content: "ran at dawn" } as never,
      await embeddings.embed("ran at dawn"),
    );
    const b = repo.create(
      { label: "marathon plan", type: "daily", content: "signed up" } as never,
      await embeddings.embed("signed up marathon"),
    );
    const edge = new EdgesRepo(handle, SPACE).create({
      source: a.id,
      target: b.id,
      relationship: "relates_to",
      weight: 0.8,
    });
    const signals = computeMutationSignals(handle, SPACE);
    expect(signals.proposedPaths).toBe(1);

    const decided = await decideWorldChange(ctx, SPACE, pendingProposal("path"), "approve", SPACE);
    expect(decided.ok).toBe(true);
    expect(count("world_paths", `WHERE space_id='${SPACE}' AND edge_id=${edge.id}`)).toBe(1);
    const state = getMutationState(ctx, SPACE);
    expect(state.paths).toHaveLength(1);
    expect(state.paths[0]?.sourceId).toBe(a.id);
    expect(state.paths[0]?.targetId).toBe(b.id);
  });

  it("atomic apply failure: a second landmark for the same journey fails whole — proposal stands approved, no log, no duplicate", async () => {
    const journey = new JourneysRepo(handle, SPACE).create({ title: "Done thing", status: "done" });
    computeMutationSignals(handle, SPACE);
    await decideWorldChange(ctx, SPACE, pendingProposal("landmark"), "approve", SPACE);
    expect(count("world_landmarks")).toBe(1);
    expect(count("world_change_log")).toBe(1);

    // A second proposal for the same journey (different dedup key) applies
    // into the UNIQUE(space_id, journey_id) wall.
    const retry = proposeWorldChange(handle.sqlite, SPACE, {
      kind: "landmark",
      targetKind: "journey",
      targetId: journey.id,
      title: "Landmark again",
      reason: "Same milestone, second proposal.",
      payload: { journeyId: journey.id, label: "Done thing" },
      dedupKey: "landmark:journey:second-try",
    });
    const decided = await decideWorldChange(ctx, SPACE, retry.proposal.id, "approve", SPACE);
    expect(decided.ok).toBe(false);
    expect(decided.error).toMatch(/UNIQUE constraint failed/);
    expect(decided.proposal?.status).toBe("approved"); // still standing
    expect(count("world_landmarks")).toBe(1); // no duplicate landmark
    expect(count("world_change_log")).toBe(1); // no false 'applied' entry
  });

  it("malformed payload fails the proposal instead of applying half a change", async () => {
    const { proposal } = proposeWorldChange(handle.sqlite, SPACE, {
      kind: "landmark",
      targetKind: "journey",
      targetId: 99,
      title: "Broken",
      reason: "No payload fields.",
      payload: {},
      dedupKey: "landmark:broken",
    });
    const decided = await decideWorldChange(ctx, SPACE, proposal.id, "approve", SPACE);
    expect(decided.ok).toBe(false);
    expect(decided.proposal?.status).toBe("failed");
    expect(count("world_change_log")).toBe(0);
    // A failed proposal cannot be decided again.
    const again = await decideWorldChange(ctx, SPACE, proposal.id, "approve", SPACE);
    expect(again.ok).toBe(false);
  });

  it("undo: applied landmark is removed with a compensating log entry; undo twice is refused", async () => {
    const journey = new JourneysRepo(handle, SPACE).create({ title: "Done thing", status: "done" });
    computeMutationSignals(handle, SPACE);
    const decided = await decideWorldChange(ctx, SPACE, pendingProposal("landmark"), "approve", SPACE);
    const undone = undoWorldChange(ctx, SPACE, decided.proposal!.id);
    expect(undone.ok).toBe(true);
    expect(undone.proposal?.status).toBe("undone");
    expect(count("world_landmarks")).toBe(0);
    const entries = listWorldChangeLog(handle.sqlite, SPACE);
    expect(entries).toHaveLength(2);
    expect(entries[1]?.kind).toBe("undo");
    expect(entries[1]?.supersedesLogId).toBe(entries[0]?.id);
    // The original log row is never rewritten.
    expect(entries[0]?.kind).toBe("landmark");

    const again = undoWorldChange(ctx, SPACE, decided.proposal!.id);
    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/undone, not applied/);
  });

  it("undo conflict: a later change to the same target blocks the undo in plain language", async () => {
    const journey = new JourneysRepo(handle, SPACE).create({ title: "Done thing", status: "done" });
    computeMutationSignals(handle, SPACE);
    const decided = await decideWorldChange(ctx, SPACE, pendingProposal("landmark"), "approve", SPACE);
    const appliedLogs = listWorldChangeLog(handle.sqlite, SPACE);
    expect(appliedLogs).toHaveLength(1);
    expect(appliedLogs[0]?.kind).toBe("landmark");
    // A synthetic later change to the same landmark target.
    handle.sqlite
      .prepare(
        `INSERT INTO world_change_log (space_id, proposal_id, kind, summary, reason, applied_at)
         VALUES (?, ?, 'landmark', 'later change', 'synthetic', datetime('now', '+1 minute'))`,
      )
      .run(SPACE, decided.proposal!.id);
    const undone = undoWorldChange(ctx, SPACE, decided.proposal!.id);
    expect(undone.ok).toBe(false);
    expect(undone.error).toMatch(/later change/);
    expect(undone.proposal?.status).toBe("applied");
  });

  it("decide: reject and defer are terminal-ish; deciding a decided proposal is refused", async () => {
    const { proposal } = proposeWorldChange(handle.sqlite, SPACE, {
      kind: "tone",
      targetKind: "space",
      targetId: null,
      title: "Warmer light",
      reason: "Warm memories accumulated.",
      payload: {},
      dedupKey: "tone:test",
    });
    const rejected = await decideWorldChange(ctx, SPACE, proposal.id, "reject", SPACE);
    expect(rejected.ok).toBe(true);
    expect(rejected.proposal?.status).toBe("rejected");
    const again = await decideWorldChange(ctx, SPACE, proposal.id, "approve", SPACE);
    expect(again.ok).toBe(false);
    expect(again.error).toMatch(/not decidable/);
    const missing = await decideWorldChange(ctx, SPACE, 99999, "approve", SPACE);
    expect(missing.proposal).toBeNull();
  });

  it("explainChange gives the legible 'this changed because…' lines", () => {
    const { proposal } = proposeWorldChange(handle.sqlite, SPACE, {
      kind: "path",
      targetKind: "edge",
      targetId: 3,
      title: "A new bridge",
      reason: "Two memories are linked.",
      evidence: [{ type: "edge", id: 3 }],
      payload: { edgeId: 3, sourceId: 1, targetId: 2 },
      dedupKey: "path:edge:3",
    });
    const explained = explainChange(handle.sqlite, SPACE, proposal.id);
    expect(explained).not.toBeNull();
    expect(explained!.lines.join(" ")).toMatch(/Nothing has changed yet/);
    expect(explained!.lines.join(" ")).toMatch(/Two memories are linked/);
    expect(explainChange(handle.sqlite, SPACE, 99999)).toBeNull();
  });

  it("sweep: pending proposals never expire; approved-but-unapplied are retried once", async () => {
    // Pending proposal (stays pending through the sweep).
    proposeWorldChange(handle.sqlite, SPACE, {
      kind: "tone",
      targetKind: "space",
      targetId: null,
      title: "Warmer light",
      reason: "Warm memories.",
      payload: {},
      dedupKey: "tone:sweep",
    });
    // Approved-but-unapplied: a landmark whose apply will fail (UNIQUE).
    const journey = new JourneysRepo(handle, SPACE).create({ title: "Done", status: "done" });
    computeMutationSignals(handle, SPACE);
    await decideWorldChange(ctx, SPACE, pendingProposal("landmark"), "approve", SPACE);
    const retry = proposeWorldChange(handle.sqlite, SPACE, {
      kind: "landmark",
      targetKind: "journey",
      targetId: journey.id,
      title: "Again",
      reason: "Second try.",
      payload: { journeyId: journey.id, label: "Done" },
      dedupKey: "landmark:sweep-retry",
    });
    await decideWorldChange(ctx, SPACE, retry.proposal.id, "approve", SPACE);
    expect(listProposals(handle.sqlite, SPACE, { status: "approved" })).toHaveLength(1);

    const swept = await sweepWorldProposals(ctx, SPACE);
    expect(swept.pending).toBe(1); // still standing, never expired
    expect(swept.approvedUnapplied).toBe(1);
    expect(swept.retried).toBe(1);
    expect(swept.failed).toBe(1); // the retry failed the same way (UNIQUE)
    expect(listProposals(handle.sqlite, SPACE, { status: "pending" })).toHaveLength(1);
  });
});

describe("brain consent surface (Phase 4)", () => {
  it("dream belief is proposed, not written — approve writes the node", async () => {
    await makeCluster(SPACE, 5);
    const proposed = await proposeDreamCycle(ctx, SPACE, false);
    expect(proposed).not.toBeNull();
    expect(proposed!.duplicate).toBe(false);
    expect(proposed!.proposal.kind).toBe("brain_belief");
    // Nothing was written to the graph yet.
    expect(count("nodes", `WHERE kind='belief'`)).toBe(0);

    const decided = await decideWorldChange(ctx, SPACE, proposed!.proposal.id, "approve", SPACE);
    expect(decided.ok).toBe(true);
    expect(decided.proposal?.status).toBe("applied");
    expect(count("nodes", `WHERE kind='belief'`)).toBe(1);
  });

  it("dream belief rejected: no node is ever written", async () => {
    await makeCluster(SPACE, 5);
    const proposed = await proposeDreamCycle(ctx, SPACE, false);
    const decided = await decideWorldChange(ctx, SPACE, proposed!.proposal.id, "reject", SPACE);
    expect(decided.ok).toBe(true);
    expect(count("nodes", `WHERE kind='belief'`)).toBe(0);
    // A second night does not re-propose while the first waits — but after a
    // rejection the hub is free to propose again (new day, new key).
    expect(count("world_proposals", `WHERE kind='brain_belief'`)).toBe(1);
  });

  it("stated assertion is proposed, not recorded — the episode id still returns", async () => {
    const episodeId = maybeRecordStated(handle, SPACE, "I want to run a marathon");
    expect(episodeId).not.toBeNull();
    expect(typeof episodeId).toBe("number");
    // The episode was captured (evidence), but no stated fact was written.
    expect(count("episodes", `WHERE id=${episodeId}`)).toBe(1);
    expect(count("user_model", `WHERE slot='desire'`)).toBe(0);
    const proposals = listProposals(handle.sqlite, SPACE, { kind: "brain_stated" });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.status).toBe("pending");
    expect(proposals[0]?.payload.episodeId).toBe(episodeId);

    // Approve: the stated fact lands with the same evidence.
    const decided = await decideWorldChange(ctx, SPACE, proposals[0]!.id, "approve", SPACE);
    expect(decided.ok).toBe(true);
    expect(decided.proposal?.status).toBe("applied");
    const rows = handle.sqlite
      .prepare(`SELECT id, content FROM user_model WHERE slot='desire' AND origin='stated'`)
      .all() as { id: number; content: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content).toBe("I want to run a marathon");
  });

  it("distill proposes the insert instead of writing it — approve writes the entry", async () => {
    const ep1 = makeEpisode("I ran five miles at dawn");
    const ep2 = makeEpisode("I signed up for a marathon");
    const summary = await runDistillation(
      handle,
      { spaceId: SPACE, runId: null, now: new Date().toISOString() },
      {
        extractor: async (candidates) => [
          {
            content: "I enjoy running",
            slot: "desire",
            topicLabels: [],
            route: "self",
            episodeIds: candidates.map((c) => c.episodeId),
          },
        ],
        budget: { remaining: 5 },
        maxItems: 10,
      },
    );
    expect(summary.candidates).toBe(2);
    expect(summary.proposed).toBe(2);
    expect(summary.created).toBe(0);
    expect(count("user_model")).toBe(0);
    const proposals = listProposals(handle.sqlite, SPACE, { kind: "brain_dedup" });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.status).toBe("pending");
    expect(proposals[0]?.payload.episodeIds).toEqual(expect.arrayContaining([ep1, ep2]));

    const decided = await decideWorldChange(ctx, SPACE, proposals[0]!.id, "approve", SPACE);
    expect(decided.ok).toBe(true);
    const rows = handle.sqlite
      .prepare(`SELECT id, content FROM user_model WHERE slot='desire' AND origin='consolidated'`)
      .all() as { id: number; content: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content).toBe("I enjoy running");
    // Both episodes are marked consolidated against the new entry.
    expect(count("consolidation_episodes", `WHERE outcome='consolidated'`)).toBe(2);
  });

  it("brain undo is refused in plain language (not supported in this increment)", async () => {
    await makeCluster(SPACE, 5);
    const proposed = await proposeDreamCycle(ctx, SPACE, false);
    await decideWorldChange(ctx, SPACE, proposed!.proposal.id, "approve", SPACE);
    const undone = undoWorldChange(ctx, SPACE, proposed!.proposal.id);
    expect(undone.ok).toBe(false);
    expect(undone.error).toMatch(/not supported for brain/);
    expect(count("nodes", `WHERE kind='belief'`)).toBe(1);
  });
});

describe("distill proposal-time Tier 2 (Phase 4 restoration)", () => {
  /** A current stated row, seeded by direct insert so no extra episode
   * pollutes the candidate set. Mirrors w3-run's T-C47/T-C48 fixture. */
  function seedStatedRow(): number {
    const now = new Date().toISOString();
    const info = handle.sqlite
      .prepare(
        `INSERT INTO user_model (space_id, slot, content, confidence, evidence_strength,
           evidence_ids, topic_labels, valid_at, origin, created_at)
         VALUES (?, 'belief', 'works at Samsonite warehouse', 0.9, 0.9, '[]', '["work"]', ?, 'stated', ?)`,
      )
      .run(SPACE, now, now);
    return Number(info.lastInsertRowid);
  }

  /**
   * Distill one insert proposition through the run ctx, sharing ONE
   * budget object between the extractor (deps.budget) and Tier 2
   * (ctx.llmBudget) exactly as runConsolidation does.
   */
  async function distillInsert(opts: {
    judge?: (input: { candidate: string; entry: unknown }) => Promise<"compatible" | "contradiction">;
    content?: string;
    topicLabels?: string[];
    budget?: number;
  }): Promise<{ summary: Awaited<ReturnType<typeof runDistillation>>; judgeCalls: number }> {
    const budget = { remaining: opts.budget ?? 5 };
    let judgeCalls = 0;
    const summary = await runDistillation(
      handle,
      {
        spaceId: SPACE,
        runId: null,
        now: new Date().toISOString(),
        llmJudge: opts.judge
          ? async (input) => {
              judgeCalls += 1;
              return opts.judge!(input as { candidate: string; entry: unknown });
            }
          : undefined,
        llmBudget: budget,
      },
      {
        extractor: async (candidates) => [
          {
            content: opts.content ?? "I prefer Samsonite warehouse shifts",
            slot: "belief",
            topicLabels: opts.topicLabels ?? [],
            route: "self",
            episodeIds: candidates.map((c) => c.episodeId),
          },
        ],
        budget,
        maxItems: 10,
      },
    );
    return { summary, judgeCalls };
  }

  function pendingDedup(): Record<string, unknown>[] {
    return listProposals(handle.sqlite, SPACE, { kind: "brain_dedup", status: "pending" }).map(
      (p) => p as unknown as Record<string, unknown>,
    );
  }

  it("a judge reporting contradiction rejects at proposal time: no proposal, no outcome row", async () => {
    const statedId = seedStatedRow();
    makeEpisode("first note about shifts");
    makeEpisode("second note about shifts");
    // Ambiguous middle, no deterministic verdict: token similarity 0.4
    // ("Samsonite warehouse" shared) with no negation/transition, so
    // only the judge can decide — and it decides contradiction.
    const { summary, judgeCalls } = await distillInsert({
      judge: async () => "contradiction",
    });
    expect(judgeCalls).toBe(1);
    expect(summary.rejected).toBe(2);
    expect(summary.proposed).toBe(0);
    expect(summary.created).toBe(0);
    expect(pendingDedup()).toHaveLength(0);
    // Old-flow bookkeeping, mirrored exactly: NO outcome row — the
    // episodes stay eligible for a later run.
    expect(count("consolidation_episodes")).toBe(0);
    // Only the stated row stands; nothing consolidated was written.
    expect(count("user_model", `WHERE origin='consolidated'`)).toBe(0);
    expect(statedId).toBeGreaterThan(0);
  });

  it("a judge reporting compatible stores the verdict and approval lands the entry", async () => {
    const statedId = seedStatedRow();
    makeEpisode("first note about shifts");
    makeEpisode("second note about shifts");
    const { summary, judgeCalls } = await distillInsert({
      judge: async () => "compatible",
    });
    expect(judgeCalls).toBe(1);
    expect(summary.proposed).toBe(2);
    expect(summary.rejected).toBe(0);
    const proposals = listProposals(handle.sqlite, SPACE, { kind: "brain_dedup", status: "pending" });
    expect(proposals).toHaveLength(1);
    const tier2 = proposals[0]?.payload.tier2 as Record<string, unknown> | undefined;
    expect(tier2?.verdict).toBe("clean");
    expect(tier2?.detail).toBe("judged:compatible");
    expect(tier2?.judgedEntryId).toBe(statedId);
    expect(tier2?.ambiguousPairs).toBe(1);
    expect(typeof tier2?.snapshotFingerprint).toBe("string");
    expect((tier2?.snapshotFingerprint as string).length).toBeGreaterThan(0);

    const decided = await decideWorldChange(ctx, SPACE, proposals[0]!.id, "approve", SPACE);
    expect(decided.ok).toBe(true);
    expect(decided.proposal?.status).toBe("applied");
    const rows = handle.sqlite
      .prepare(`SELECT id, content FROM user_model WHERE slot='belief' AND origin='consolidated'`)
      .all() as { id: number; content: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content).toBe("I prefer Samsonite warehouse shifts");
    expect(count("consolidation_episodes", `WHERE outcome='consolidated'`)).toBe(2);
  });

  it("a deterministic genuine negation rejects at proposal time with no judge configured", async () => {
    seedStatedRow();
    makeEpisode("first note about work");
    makeEpisode("second note about work");
    // The T-C47/T-C48 pair: "unemployed" vs "works at" is a genuine
    // negation under the deterministic rules, so Tier 2 rejects without
    // spending a judgment — and no proposal is created.
    const { summary, judgeCalls } = await distillInsert({
      content: "unemployed and looking for work",
      topicLabels: ["work"],
    });
    expect(judgeCalls).toBe(0);
    expect(summary.rejected).toBe(2);
    expect(summary.proposed).toBe(0);
    expect(pendingDedup()).toHaveLength(0);
    expect(count("consolidation_episodes")).toBe(0);
    expect(count("user_model", `WHERE origin='consolidated'`)).toBe(0);
  });

  it("with no judge, an ambiguous pair is proposed with a deterministic-only verdict and approval lands it", async () => {
    seedStatedRow();
    makeEpisode("first note about shifts");
    makeEpisode("second note about shifts");
    const { summary, judgeCalls } = await distillInsert({});
    expect(judgeCalls).toBe(0);
    expect(summary.proposed).toBe(2);
    const proposals = listProposals(handle.sqlite, SPACE, { kind: "brain_dedup", status: "pending" });
    expect(proposals).toHaveLength(1);
    const tier2 = proposals[0]?.payload.tier2 as Record<string, unknown> | undefined;
    expect(tier2?.verdict).toBe("clean");
    expect(tier2?.detail).toBe("deterministic_only_no_judge");
    expect(tier2?.judgedEntryId).toBeNull();
    expect(tier2?.ambiguousPairs).toBe(1);

    const decided = await decideWorldChange(ctx, SPACE, proposals[0]!.id, "approve", SPACE);
    expect(decided.ok).toBe(true);
    expect(count("user_model", `WHERE origin='consolidated'`)).toBe(1);
  });

  it("the applier refuses an insert proposal with no stored Tier 2 verdict", async () => {
    const ep1 = makeEpisode("first note about shifts");
    const { proposal } = proposeWorldChange(handle.sqlite, SPACE, {
      kind: "brain_dedup",
      targetKind: "user_model",
      targetId: null,
      title: "New understanding: hand-built",
      reason: "Built by hand, never judged.",
      evidence: [{ type: "episode", id: ep1 }],
      payload: {
        mutations: [
          {
            kind: "InsertConsolidated",
            entry: {
              slot: "belief",
              content: "I prefer Samsonite warehouse shifts",
              evidence: [{ type: "episode", id: ep1 }],
              topicLabels: [],
              validAt: new Date().toISOString(),
            },
          },
        ],
        episodeIds: [ep1],
        groups: ["test-lineage"],
        fingerprint: "hand-built",
        runId: null,
        // NOTE: no tier2 — a pre-fix / hand-built proposal.
      },
      dedupKey: "brain_dedup:hand-built-no-verdict",
    });
    const decided = await decideWorldChange(ctx, SPACE, proposal.id, "approve", SPACE);
    expect(decided.ok).toBe(false);
    expect(decided.error).toMatch(/Tier 2 verdict/);
    expect(count("user_model", `WHERE origin='consolidated'`)).toBe(0);
    expect(count("consolidation_episodes")).toBe(0);
  });
});
