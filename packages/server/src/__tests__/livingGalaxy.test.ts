import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { JourneysRepo, missionProgress } from "../repositories/journeys.repo.js";
import { createCognitive } from "../analysis/cognitive.js";
import { formIdentityConstellation, alreadyConstellated } from "../analysis/identityConstellation.js";

/**
 * Living Galaxy (IM-140):
 *  (c) completed linked missions auto-strengthen their Journey;
 *  (b) identity changes form constellations from supporting memories.
 * All assertions are over REAL rows created in an in-memory db — on the
 * pre-change code these APIs do not exist, so the suite cannot pass there.
 */

let handle: DbHandle;
let ctx: AppContext;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = { handle, embeddings, llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
});
afterEach(() => handle.sqlite.close());

function makeAction(spaceId: string, label: string): number {
  return Number(
    handle.sqlite
      .prepare(`INSERT INTO nodes (space_id, label, type, kind, content) VALUES (?, ?, 'daily', 'action', 'c')`)
      .run(spaceId, label).lastInsertRowid,
  );
}

describe("missionProgress (pure)", () => {
  it("is the completed share of all known missions", () => {
    expect(missionProgress(0, 0)).toBe(0);
    expect(missionProgress(1, 3)).toBe(0.25);
    expect(missionProgress(2, 0)).toBe(1);
    expect(missionProgress(5, 5)).toBe(0.5);
  });
});

describe("JourneysRepo.creditCompletedMission (IM-140c)", () => {
  it("credits progress from completed linked missions (task + node link kinds)", () => {
    const repo = new JourneysRepo(handle, "s1");
    const j = repo.create({ title: "Become an RN" });
    const a1 = makeAction("s1", "Apply for CNA reinstatement");
    const a2 = makeAction("s1", "Buy money orders");
    const a3 = makeAction("s1", "Mail the forms");
    repo.link(j.id, "task", a1);
    repo.link(j.id, "node", a2);
    repo.link(j.id, "task", a3);
    expect(repo.get(j.id)!.progress).toBe(0);

    // Complete a1 the way the app does: the node is deleted, then credited.
    handle.sqlite.prepare(`DELETE FROM nodes WHERE id = ?`).run(a1);
    const c1 = repo.creditCompletedMission(j.id, a1)!;
    expect(c1.completedCount).toBe(1);
    expect(c1.journey.progress).toBeCloseTo(1 / 3);
    expect(c1.journey.missionsCompleted).toBe(1);
    // The completed mission's dangling link is gone; the open ones remain.
    expect(repo.links(j.id)).toHaveLength(2);

    handle.sqlite.prepare(`DELETE FROM nodes WHERE id = ?`).run(a2);
    const c2 = repo.creditCompletedMission(j.id, a2)!;
    expect(c2.journey.progress).toBeCloseTo(2 / 3);

    handle.sqlite.prepare(`DELETE FROM nodes WHERE id = ?`).run(a3);
    const c3 = repo.creditCompletedMission(j.id, a3)!;
    expect(c3.journey.progress).toBe(1);
    expect(c3.journey.missionsCompleted).toBe(3);
  });

  it("is idempotent — crediting the same mission twice counts once", () => {
    const repo = new JourneysRepo(handle, "s1");
    const j = repo.create({ title: "Recover" });
    const a1 = makeAction("s1", "One thing");
    repo.link(j.id, "task", a1);
    handle.sqlite.prepare(`DELETE FROM nodes WHERE id = ?`).run(a1);
    repo.creditCompletedMission(j.id, a1);
    const again = repo.creditCompletedMission(j.id, a1)!;
    expect(again.completedCount).toBe(1);
    expect(again.journey.progress).toBe(1);
  });

  it("never lowers a user-set progress (strengthen is one-directional)", () => {
    const repo = new JourneysRepo(handle, "s1");
    const j = repo.create({ title: "Big chapter" });
    repo.update(j.id, { progress: 0.9 });
    const a1 = makeAction("s1", "Small step");
    const a2 = makeAction("s1", "Another step");
    repo.link(j.id, "task", a1);
    repo.link(j.id, "task", a2);
    handle.sqlite.prepare(`DELETE FROM nodes WHERE id = ?`).run(a1);
    const c = repo.creditCompletedMission(j.id, a1)!;
    expect(c.journey.progress).toBe(0.9); // derived 1/2 < user-set 0.9 → stands
  });

  it("journeysForMission finds journeys across both node-pointing link kinds, space-scoped", () => {
    const repo = new JourneysRepo(handle, "s1");
    const other = new JourneysRepo(handle, "s2");
    const j = repo.create({ title: "Mine" });
    const jOther = other.create({ title: "Theirs" });
    const a1 = makeAction("s1", "Task");
    const aOther = makeAction("s2", "Task");
    repo.link(j.id, "task", a1);
    other.link(jOther.id, "task", aOther);
    expect(repo.journeysForMission(a1).map((x) => x.id)).toEqual([j.id]);
    expect(repo.journeysForMission(aOther)).toEqual([]);
    expect(repo.creditCompletedMission(999999, a1)).toBeNull();
  });
});

describe("formIdentityConstellation (IM-140b)", () => {
  async function mem(label: string, content: string) {
    return new NodesRepo(handle, "legacy").create(
      { label, type: "daily", content } as never,
      await embeddings.embed(content),
    );
  }

  it("an identity with 3+ supporting memories forms a constellation hub over them", async () => {
    await mem("a", "spent all day as a builder on the site");
    await mem("b", "proud to be a builder, made real progress");
    await mem("c", "a builder mindset got me through today");
    const id = await createCognitive(ctx, "legacy", "identity", "builder", "");
    const hub = await formIdentityConstellation(ctx, "legacy", id);
    expect(hub).not.toBeNull();
    expect(hub!.kind).toBe("moc");
    const memberEdges = handle.sqlite
      .prepare(`SELECT target FROM edges WHERE source = ? AND relationship = 'summarizes'`)
      .all(hub!.id) as { target: number }[];
    expect(memberEdges.length).toBeGreaterThanOrEqual(3);
  });

  it("below the member floor, no constellation forms", async () => {
    await mem("a", "quiet day, read a book about gardening");
    const id = await createCognitive(ctx, "legacy", "identity", "gardener", "");
    expect(await formIdentityConstellation(ctx, "legacy", id)).toBeNull();
  });

  it("is idempotent: a second formation attempt over the same members is a no-op", async () => {
    await mem("a", "spent all day as a builder on the site");
    await mem("b", "proud to be a builder, made real progress");
    await mem("c", "a builder mindset got me through today");
    const id = await createCognitive(ctx, "legacy", "identity", "builder", "");
    const first = await formIdentityConstellation(ctx, "legacy", id);
    expect(first).not.toBeNull();
    expect(await formIdentityConstellation(ctx, "legacy", id)).toBeNull();
    const hubs = handle.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM nodes WHERE kind = 'moc' AND space_id = 'legacy' AND deleted_at IS NULL`)
      .get() as { n: number };
    expect(hubs.n).toBe(1);
  });

  it("alreadyConstellated: half-or-more coverage counts as existing", () => {
    expect(alreadyConstellated([1, 2, 3, 4], new Set([1, 2]))).toBe(true);
    expect(alreadyConstellated([1, 2, 3, 4], new Set([1]))).toBe(false);
    expect(alreadyConstellated([], new Set([1]))).toBe(false);
  });
});
