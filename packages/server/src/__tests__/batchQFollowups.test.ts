import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import { getEmbedding } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import { ingest } from "../ingestion/pipeline.js";
import {
  selectJob,
  executeJob,
  requestMaintenance,
} from "../maintenance/agent.js";
import { buildAwayDigest, markSeen } from "../analysis/awayDigest.js";
import { settings } from "../db/schema.js";

/**
 * Batch Q follow-ups — REG-152 (copy half), REG-218 (naming), REG-225
 * (sector-vibe re-embed). REG-152's gap-filling job strings live behind the
 * scored picker inside selectJob's ladder, so those two sites are pinned by
 * source text (the push.test.ts precedent); the on-request string, the
 * executed-research description, and the away-digest verb are pinned by
 * behavior.
 */

let handle: DbHandle;
let ctx: AppContext;

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = {
    handle,
    embeddings: new HashEmbeddingProvider(EMBED_DIM),
    llm: new HeuristicProvider(),
    usage: new UsageTracker(handle),
  };
});
afterEach(() => handle.sqlite.close());

const setResearch = (on: boolean) =>
  handle.db.insert(settings).values({ key: "research_enabled", value: String(on) }).run();

const agentSource = () =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../maintenance/agent.ts"), "utf8");

describe("REG-152 — research-job copy names Research Mode, not a bare deep-dive", () => {
  it("the on-request job description says Research Mode research", async () => {
    const id = (await ingest(handle, { embeddings: ctx.embeddings, llm: ctx.llm }, "tend this memory please", "req-q")).nodes[0]!.id;
    setResearch(true);
    requestMaintenance("req-q", id);
    const job = await selectJob(ctx, "req-q");
    expect(job?.type).toBe("research");
    expect(job?.description).toContain("Research Mode research");
    expect(job?.description).not.toContain("deep-dive");
  });

  it("the agent comments say Research Mode research, never deep-dive", () => {
    const src = agentSource();
    expect(src).toContain("// Richest action first: Research Mode research (if Research Mode + fuel allow).");
    expect(src).toContain("// already researched in Research Mode doesn't get a second stacked dive (mirrors selection).");
    expect(src).not.toContain("deep-dive");
    expect(src).not.toContain("deep-dived");
  });

  it("the gap-filling job strings say Research Mode research at both ladder sites", () => {
    const src = agentSource();
    expect(src.match(/Gap-filling: Research Mode research/g)?.length).toBe(2);
    expect(src).not.toContain("deep-dive research on");
    expect(src).not.toContain("with deep-dive research");
  });

  it("the executed research description says Research Mode research", async () => {
    const id = (await ingest(handle, { embeddings: ctx.embeddings, llm: ctx.llm }, "research me please", "exec-q")).nodes[0]!.id;
    setResearch(true);
    const detail = await executeJob(ctx, "exec-q", { type: "research", targets: [id], description: "" });
    expect(detail).toContain("with Research Mode research");
    expect(detail).not.toContain("deep-dive");
  });

  it("the away digest says researched, singular and plural", () => {
    const NOW = Date.parse("2026-06-30T12:00:00Z");
    const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
    markSeen(handle, "legacy", ago(120));
    handle.sqlite
      .prepare(`INSERT INTO agent_logs (space_id, action, description, targets, created_at) VALUES ('legacy', 'research', 'x', '[]', ?)`)
      .run(ago(30));
    const one = buildAwayDigest(handle, "legacy", NOW);
    expect(one.agentActions.find((a) => a.type === "research")?.label).toBe("researched 1 memory");
    handle.sqlite
      .prepare(`INSERT INTO agent_logs (space_id, action, description, targets, created_at) VALUES ('legacy', 'research', 'x', '[]', ?)`)
      .run(ago(20));
    const two = buildAwayDigest(handle, "legacy", NOW);
    expect(two.agentActions.find((a) => a.type === "research")?.label).toBe("researched 2 memories");
  });
});

describe("REG-225 — sector_vibe re-embeds the node with its new content", () => {
  it("the stored embedding after a sector_vibe job equals the embedding of the new content", async () => {
    const id = (await ingest(handle, { embeddings: ctx.embeddings, llm: ctx.llm }, "sector hub memory", "vibe-q")).nodes[0]!.id;
    setResearch(true);
    const before = getEmbedding(handle.sqlite, id);
    expect(before).not.toBeNull();
    const detail = await executeJob(ctx, "vibe-q", { type: "sector_vibe", targets: [id], description: "" });
    expect(detail).toContain("Charted sector vibe");
    const row = handle.sqlite.prepare(`SELECT label, content FROM nodes WHERE id = ?`).get(id) as { label: string; content: string };
    expect(row.content).toContain("--- Sector Vibe ---");
    const expected = await ctx.embeddings.embed(`${row.label}. ${row.content}`);
    const stored = getEmbedding(handle.sqlite, id);
    expect(stored).not.toBeNull();
    expect(Array.from(stored!)).toEqual(Array.from(expected));
    expect(Array.from(stored!)).not.toEqual(Array.from(before!));
  });
});
