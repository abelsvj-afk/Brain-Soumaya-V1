import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { EdgesRepo } from "../repositories/edges.repo.js";
import { declutterGraph } from "../analysis/candidates.js";
import { createCognitive } from "../analysis/cognitive.js";
import { isRejected } from "../analysis/rejections.js";

/**
 * Batch G (Recall + Declutter) regression tests.
 * REG-203 (CN-04): declutterGraph must separate wrong-link removals
 * (permanent, rejected) from cap trims (legitimate links over the 12-link
 * anchor cap) — the old single `anchorPruned` lumped both together and the
 * toast called every one of them "wrong".
 */
let handle: DbHandle;
let ctx: AppContext;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = { handle, embeddings, llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
});
afterEach(() => handle.sqlite.close());

async function mem(label: string) {
  return new NodesRepo(handle, "legacy").create({ label, type: "daily", content: label } as never, await embeddings.embed(label));
}

function anchorEdgeCount(anchorId: number): number {
  const row = handle.sqlite
    .prepare(
      `SELECT COUNT(*) AS c FROM edges WHERE space_id = 'legacy' AND (source = ? OR target = ?) AND relationship IN ('supports','relates_to')`,
    )
    .get(anchorId, anchorId) as { c: number };
  return row.c;
}

describe("REG-203 — declutterGraph separates wrong links from cap trims", () => {
  it("a person anchor's non-naming link counts as wrong (permanent + rejected), never as a cap trim", async () => {
    const m = await mem("garden notes about watering tomatoes");
    const personId = await createCognitive(ctx, "legacy", "person_entity", "Mara", "");
    // A bogus supports edge: the memory never names her.
    new EdgesRepo(handle, "legacy").create({ source: m.id, target: personId, relationship: "supports", weight: 0.5 });
    expect(anchorEdgeCount(personId)).toBe(1);

    const result = declutterGraph(ctx, "legacy");
    expect(result.wrongPruned).toBe(1);
    expect(result.capTrimmed).toBe(0);
    expect(result.anchorPruned).toBe(1); // compat: still the sum of the two halves
    expect(result.weakPruned).toBe(0);
    expect(anchorEdgeCount(personId)).toBe(0);
    expect(isRejected(ctx, "legacy", m.id, personId)).toBe(true);
  });

  it("a goal anchor over the 12-link cap counts its trims as cap trims, never as wrong links", async () => {
    const goalId = await createCognitive(ctx, "legacy", "goal", "Ship the app", "");
    const edges = new EdgesRepo(handle, "legacy");
    const ids: number[] = [];
    for (let i = 0; i < 14; i++) {
      const m = await mem(`goal memory ${i}`);
      ids.push(m.id);
      edges.create({ source: m.id, target: goalId, relationship: "supports", weight: 0.01 + i * 0.01 });
    }
    expect(anchorEdgeCount(goalId)).toBe(14);

    const result = declutterGraph(ctx, "legacy");
    expect(result.capTrimmed).toBe(2);
    expect(result.wrongPruned).toBe(0);
    expect(result.anchorPruned).toBe(2);
    expect(anchorEdgeCount(goalId)).toBe(12);
    // The two WEAKEST links were trimmed; the strongest survive.
    const survivors = handle.sqlite
      .prepare(`SELECT source FROM edges WHERE space_id = 'legacy' AND target = ? ORDER BY weight ASC`)
      .all(goalId) as { source: number }[];
    expect(survivors.map((s) => s.source).sort()).toEqual(ids.slice(2).sort());
    // Cap trims are NOT rejections — a trimmed pair may legitimately re-gather.
    expect(isRejected(ctx, "legacy", ids[0]!, goalId)).toBe(false);
  });

  it("a mixed declutter reports both halves and anchorPruned stays their sum", async () => {
    const m = await mem("garden notes about watering tomatoes");
    const personId = await createCognitive(ctx, "legacy", "person_entity", "Mara", "");
    new EdgesRepo(handle, "legacy").create({ source: m.id, target: personId, relationship: "supports", weight: 0.5 });
    const goalId = await createCognitive(ctx, "legacy", "goal", "Ship the app", "");
    const edges = new EdgesRepo(handle, "legacy");
    for (let i = 0; i < 14; i++) {
      const g = await mem(`goal memory ${i}`);
      edges.create({ source: g.id, target: goalId, relationship: "supports", weight: 0.01 + i * 0.01 });
    }

    const result = declutterGraph(ctx, "legacy");
    expect(result.wrongPruned).toBe(1);
    expect(result.capTrimmed).toBe(2);
    expect(result.anchorPruned).toBe(result.wrongPruned + result.capTrimmed);
  });
});
