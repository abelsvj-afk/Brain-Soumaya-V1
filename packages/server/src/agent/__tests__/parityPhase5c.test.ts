import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { createDb, type DbHandle } from "../../db/client.js";
import { HashEmbeddingProvider } from "../../embeddings/hash.js";
import { HeuristicProvider } from "../../llm/heuristic.js";
import { EMBED_DIM } from "../../db/vec.js";
import type { AppContext } from "../../context.js";
import type { LlmProvider } from "../../llm/adapter.js";
import type { ToolContext } from "../tools/types.js";
import { validateArgs } from "../tools/validation.js";
import { storyTimeTool } from "../tools/storyTime.js";
import { dreamPlaybackTool } from "../tools/dreamPlayback.js";
import { LoreRepo } from "../../lore/engine.js";
import { captureEpisode } from "../episodic.js";
import { NodesRepo } from "../../repositories/nodes.repo.js";
import { SourcesRepo } from "../../repositories/sources.repo.js";
import { AGENT_TOOLS, TOOLS } from "../tools/registry.js";
import { getAgentTool } from "../loop.js";

/**
 * Telegram Parity Phase 5-C — narration & read-back.
 *
 * story_time reuses the lore/chronicle path (lore/engine.ts + the provider
 * `chronicle()` seam built on CHRONICLE_SYSTEM/buildChroniclePrompt);
 * dream_playback reads consolidation_runs + user_model +
 * consolidation_episodes. The correction test pins INV-KC-1 for this path:
 * a dispute is recorded as a stated record through the capture/ingest
 * intake (ingestWithContext — the /log + capture_memory entry), the
 * disputed belief row is BYTE-UNCHANGED, and the whole user_model table
 * is untouched (no user-model mutation API is reachable from the tool).
 */

let handle: DbHandle;
let ctx: AppContext;
let tc: ToolContext;
const SPACE = "parity5c-space";
const NOW = Date.parse("2026-10-21T12:00:00.000Z");

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = {
    handle,
    embeddings: new HashEmbeddingProvider(EMBED_DIM),
    llm: new HeuristicProvider(),
    usage: undefined as never,
  };
  tc = { ctx, spaceId: SPACE, now: NOW, notify: async () => {} };
  // Space timezone: Florida (owner's hard rule — dates in HIS timezone).
  handle.sqlite.prepare(`INSERT OR IGNORE INTO space_meta (space_id, timezone) VALUES (?, 'America/New_York')`).run(SPACE);
});

afterEach(() => handle.sqlite.close());

function seedNode(label: string, opts: { content?: string; importance?: number; type?: string } = {}): number {
  const r = handle.sqlite
    .prepare(`INSERT INTO nodes (space_id, label, type, content, importance) VALUES (?, ?, ?, ?, ?)`)
    .run(SPACE, label, opts.type ?? "daily", opts.content ?? `content of ${label}`, opts.importance ?? null);
  return Number(r.lastInsertRowid);
}

function seedBelief(opts: {
  slot?: string; content: string; confidence?: number; origin?: string;
  validAt?: string; createdAt?: string; invalidAt?: string; invalidReason?: string; replacedBy?: number;
}): number {
  const r = handle.sqlite
    .prepare(
      `INSERT INTO user_model (space_id, slot, content, confidence, evidence_strength,
         evidence_ids, topic_labels, valid_at, invalid_at, invalid_reason, replaced_by, origin, created_at)
       VALUES (?, ?, ?, ?, 0.3, '[]', '[]', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      SPACE, opts.slot ?? "belief", opts.content, opts.confidence ?? 0.5,
      opts.validAt ?? "2026-10-21T02:35:00.000Z",
      opts.invalidAt ?? null, opts.invalidReason ?? null, opts.replacedBy ?? null,
      opts.origin ?? "consolidated", opts.createdAt ?? "2026-10-21T02:35:00.000Z",
    );
  return Number(r.lastInsertRowid);
}

// The latest completed run: window opened 2026-10-20 space-local; started
// 02:30Z = 22:30 EDT on Oct 20 (so a UTC rendering would lie by a day).
function seedRun(): number {
  const r = handle.sqlite
    .prepare(
      `INSERT INTO consolidation_runs (space_id, window_date, fence, started_at, completed_at, status, lease_expires_at, items_processed, llm_calls, contradictions_resolved, consolidations_written)
       VALUES (?, '2026-10-20', '1', '2026-10-21T02:30:00.000Z', '2026-10-21T02:40:00.000Z', 'completed', '2026-10-21T03:00:00.000Z', 2, 1, 1, 1)`,
    )
    .run(SPACE);
  return Number(r.lastInsertRowid);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe("Phase 5-C registration", () => {
  it("both tools are in AGENT_TOOLS and TOOLS; story_time read, dream_playback write (flagged)", () => {
    expect(getAgentTool("story_time")).toBe(storyTimeTool);
    expect(getAgentTool("dream_playback")).toBe(dreamPlaybackTool);
    expect(AGENT_TOOLS.find((e) => e.tool.name === "story_time")?.isWrite).toBe(false);
    expect(AGENT_TOOLS.find((e) => e.tool.name === "dream_playback")?.isWrite).toBe(true);
    expect(TOOLS.find((t) => t.name === "story_time")).toBe(storyTimeTool);
    expect(TOOLS.find((t) => t.name === "dream_playback")).toBe(dreamPlaybackTool);
    expect(storyTimeTool.detect(tc)).toEqual([]);
    expect(dreamPlaybackTool.detect(tc)).toEqual([]);
  });

  it("validates args", () => {
    expect(validateArgs(storyTimeTool, {}).ok).toBe(true);
    expect(validateArgs(storyTimeTool, { memoryId: 3 }).ok).toBe(true);
    expect(validateArgs(storyTimeTool, { memoryId: "x" }).ok).toBe(false);
    expect(validateArgs(dreamPlaybackTool, {}).ok).toBe(true);
    expect(validateArgs(dreamPlaybackTool, { beliefId: 1, correction: "that's wrong" }).ok).toBe(true);
    expect(validateArgs(dreamPlaybackTool, { correction: 42 }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// story_time
// ---------------------------------------------------------------------------

describe("story_time", () => {
  it("serves a stored chapter VERBATIM and never calls the LLM chronicle seam", async () => {
    const id = seedNode("First day at Samsonite", { content: "Started the warehouse job at Samsonite" });
    const stored = new LoreRepo(handle, SPACE).append(
      "memory", String(id), "Charted in the Forge Fields, a stored chapter told exactly as written.", "genesis",
    );
    let chronicleCalls = 0;
    ctx.llm = Object.assign(new HeuristicProvider(), {
      chronicle: async () => { chronicleCalls++; return "A DIFFERENT LLM CHAPTER"; },
    }) as LlmProvider;

    const r = await storyTimeTool.run(tc, { memoryId: id });
    expect(r.ok).toBe(true);
    expect(r.message).toContain(stored.text);
    expect(r.message).toContain("told verbatim");
    expect(r.message).not.toContain("A DIFFERENT LLM CHAPTER");
    expect(chronicleCalls).toBe(0);
    // No new chapter was written.
    expect(new LoreRepo(handle, SPACE).history("memory", String(id))).toHaveLength(1);
  });

  it("generates a chapter through the real chronicle path (mocked LLM seam) when none is stored, and stores it", async () => {
    const id = seedNode("Night bus to the warehouse", {
      content: "The night bus ride to the warehouse takes an hour through Jacksonville",
      importance: 0.8,
    });
    // Mock the LLM at the same seam the lore route uses: provider.chronicle().
    ctx.llm = Object.assign(new HeuristicProvider(), {
      chronicle: async (subject: string, context: string) => {
        expect(subject).toContain(String(id));
        expect(context).toContain("Current heuristic chapter:");
        return "In the Drift, the night bus carried him toward the warehouse lights, one hour of quiet resolve at a time.";
      },
    }) as LlmProvider;

    const r = await storyTimeTool.run(tc, { memoryId: id });
    expect(r.ok).toBe(true);
    // Chapter-shaped and grounded: header names the seeded memory, body is the chapter.
    expect(r.message).toContain(`"Night bus to the warehouse" (#${id}`);
    expect(r.message).toContain("night bus carried him toward the warehouse lights");
    // The generated chapter is now the stored chapter (served verbatim next time).
    const storedNow = new LoreRepo(handle, SPACE).current("memory", String(id));
    expect(storedNow?.text).toContain("night bus carried him");
  });

  it("falls back to the lore engine's offline chronicler when no LLM chronicle exists (grounded in the seeded facts)", async () => {
    const id = seedNode("Plasma donation mornings", {
      content: "Donating plasma at OctaPharma twice a week to fund the CNA fee",
    });
    // HeuristicProvider has no chronicle() — the always-available path.
    expect(ctx.llm.chronicle).toBeUndefined();
    const r = await storyTimeTool.run(tc, { memoryId: id });
    expect(r.ok).toBe(true);
    expect(r.message).toContain("Plasma donation mornings");
    // The heuristic chronicler weaves the memory's own essence (its content) in.
    expect(r.message!.toLowerCase()).toContain("donating plasma");
    expect(new LoreRepo(handle, SPACE).history("memory", String(id))).toHaveLength(1);
  });

  it("deterministic pick: highest-importance unstoried memory, stated in the result", async () => {
    seedNode("Small errand", { content: "bought stamps", importance: 0.2 });
    const big = seedNode("Son's hospital vigil", { content: "Staying close while my son is in the hospital", importance: 0.95 });
    const r = await storyTimeTool.run(tc, {});
    expect(r.ok).toBe(true);
    expect(r.message).toContain(`#${big}`);
    expect(r.message).toContain("my pick");
  });

  it("resolves by label and reports a missing memory honestly", async () => {
    seedNode("Korean flashcards", { content: "Practising Hangul flashcards every morning" });
    const hit = await storyTimeTool.run(tc, { query: "korean flashcards" });
    expect(hit.ok).toBe(true);
    expect(hit.message).toContain("Korean flashcards");
    const miss = await storyTimeTool.run(tc, { memoryId: 999999 });
    expect(miss.ok).toBe(true);
    expect(miss.message).toContain("no memory with id 999999");
  });
});

// ---------------------------------------------------------------------------
// dream_playback
// ---------------------------------------------------------------------------

describe("dream_playback", () => {
  it("presents the latest run's formed + changed beliefs with the SPACE-timezone date", async () => {
    const runId = seedRun();
    const formedId = seedBelief({ content: "works at Samsonite warehouse", confidence: 0.52 });
    const replacementId = seedBelief({ content: "works the day shift", confidence: 0.6, validAt: "2026-10-21T02:36:00.000Z", createdAt: "2026-10-21T02:36:00.000Z" });
    const changedId = seedBelief({
      content: "works the night shift", confidence: 0.44,
      validAt: "2026-10-15T00:00:00.000Z", createdAt: "2026-10-15T00:00:00.000Z",
      invalidAt: "2026-10-21T02:36:00.000Z", invalidReason: "superseded", replacedBy: replacementId,
    });
    // Bookkeeping attribution: the run formed `formedId` from an episode.
    const ep = captureEpisode(handle, SPACE, { kind: "conversation", userExcerpt: "seed episode for the dream run" });
    expect(ep).not.toBeNull();
    handle.sqlite
      .prepare(`INSERT INTO consolidation_episodes (space_id, episode_id, outcome, resulting_entry_id, evidence_group_set, evidence_fingerprint, last_run_id, updated_at) VALUES (?, ?, 'consolidated', ?, '[]', 'fp', ?, '2026-10-21T02:40:00.000Z')`)
      .run(SPACE, ep!.episodeId, formedId, runId);
    void changedId;

    const r = await dreamPlaybackTool.run(tc, {});
    expect(r.ok).toBe(true);
    // Run date in the SPACE timezone: window 2026-10-20, started 22:30 local Oct 20.
    expect(r.message).toContain("night of 2026-10-20");
    expect(r.message).toContain("America/New_York");
    expect(r.message).toContain("2026-10-20 22:30");
    // Formed belief with confidence.
    expect(r.message).toContain(`belief #${formedId}`);
    expect(r.message).toContain("works at Samsonite warehouse");
    expect(r.message).toContain("0.52");
    // Changed belief with what replaced it.
    expect(r.message).toContain("works the night shift");
    expect(r.message).toContain("superseded");
    expect(r.message).toContain('Replaced by: "works the day shift"');
  });

  it("is honest when no consolidation run has completed", async () => {
    const r = await dreamPlaybackTool.run(tc, {});
    expect(r.ok).toBe(true);
    expect(r.message).toContain("no nightly consolidation run has completed");
  });

  it("'that's wrong' records the correction through the stated-input path; the belief row is byte-unchanged and user_model is untouched", async () => {
    seedRun();
    const beliefId = seedBelief({ content: "works the night shift", confidence: 0.44 });
    const beforeRow = handle.sqlite.prepare(`SELECT * FROM user_model WHERE id = ?`).get(beliefId);
    const beforeAll = handle.sqlite.prepare(`SELECT * FROM user_model ORDER BY id`).all();

    const r = await dreamPlaybackTool.run(tc, {
      beliefId,
      correction: "that's wrong — I work the day shift, not nights",
    });
    expect(r.ok).toBe(true);
    expect(r.message).toContain("Recorded as your stated correction");
    expect(r.message).toContain("did NOT edit or delete the belief");

    // The stated record exists: an ingested user-origin memory node carrying
    // his correction verbatim (the capture/ingest stated-fact intake).
    const nodes = new NodesRepo(handle, SPACE).all();
    const correctionNode = nodes.find((n) => n.content.includes("Correction:") && n.content.includes("I work the day shift, not nights"));
    expect(correctionNode).toBeDefined();

    // INV-KC-1 for this path: the disputed belief row is byte-unchanged and
    // NO user_model row was written at all (no recordStated /
    // correctUserModel / updateUserModel call is reachable from the tool).
    const afterRow = handle.sqlite.prepare(`SELECT * FROM user_model WHERE id = ?`).get(beliefId);
    expect(afterRow).toEqual(beforeRow);
    expect(handle.sqlite.prepare(`SELECT * FROM user_model ORDER BY id`).all()).toEqual(beforeAll);
  });

  it("refuses to record a correction against a belief that does not exist", async () => {
    const r = await dreamPlaybackTool.run(tc, { beliefId: 424242, correction: "that's wrong" });
    expect(r.ok).toBe(true);
    expect(r.message).toContain("no belief with id 424242");
    expect(new NodesRepo(handle, SPACE).all()).toHaveLength(0);
  });

  it("records a correction VERBATIM: trailing spaces survive into the persisted source (fix round 4, re-audit P1)", async () => {
    seedRun();
    const beliefId = seedBelief({ content: "works the night shift", confidence: 0.44 });
    const correction = "that's wrong — I work the day shift, not nights   ";
    const expected = `Correction: ${correction}`;

    const r = await dreamPlaybackTool.run(tc, { beliefId, correction });
    expect(r.ok).toBe(true);
    expect(r.message).toContain("Recorded as your stated correction");

    // The stated record exists; the SOURCE behind it is byte-exact (§18.2).
    const nodes = new NodesRepo(handle, SPACE).all();
    const correctionNode = nodes.find((n) => n.content.includes("Correction:"));
    expect(correctionNode).toBeDefined();
    const repo = new SourcesRepo(handle, SPACE);
    const links = repo.activeLinksForNode(correctionNode!.id);
    expect(links.length).toBeGreaterThan(0);
    const source = repo.getById(links[0]!.sourceId);
    expect(source).toBeDefined();
    expect(source!.rawText).toBe(expected);
    expect(source!.rawBytes.equals(Buffer.from(expected, "utf8"))).toBe(true);
    expect(source!.contentHash).toBe(createHash("sha256").update(Buffer.from(expected, "utf8")).digest("hex"));
  });

  it("refuses a whitespace-only correction (empty check on the trimmed copy)", async () => {
    seedRun();
    const beliefId = seedBelief({ content: "works the night shift", confidence: 0.44 });
    // No beliefId match would short-circuit first; a whitespace-only
    // correction with no beliefId falls through to playback (no record).
    const r = await dreamPlaybackTool.run(tc, { correction: "   " });
    expect(r.ok).toBe(true);
    expect(new NodesRepo(handle, SPACE).all()).toHaveLength(0);
    void beliefId;
  });
});
