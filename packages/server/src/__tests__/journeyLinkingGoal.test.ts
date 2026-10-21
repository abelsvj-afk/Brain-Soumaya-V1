import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { UsageTracker } from "../usage.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { hydrateJourneyLinks } from "../analysis/journeyLinking.js";
import { JourneysRepo } from "../repositories/journeys.repo.js";
import { FinBucketRepo } from "../repositories/finBucket.repo.js";
import { FinGoalRepo } from "../repositories/finGoal.repo.js";

/** The one new case added for docs/specs/wealth-goals-allocation.md §10 — a Goal is
 *  linkable to a Journey and hydrates to a plain label (no amount; a goal isn't a
 *  dated transaction). Pre-existing kinds are already covered elsewhere and untouched. */

let handle: DbHandle;
let ctx: AppContext;
beforeEach(() => {
  handle = createDb(":memory:");
  ctx = { handle, embeddings: new HashEmbeddingProvider(EMBED_DIM), llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
});
afterEach(() => { handle.sqlite.close(); });

describe("hydrateJourneyLinks — goal kind", () => {
  it("hydrates a linked goal to its name, with no amount/occurredAt", () => {
    const buckets = new FinBucketRepo(handle, "s1");
    const goals = new FinGoalRepo(handle, "s1");
    const journeys = new JourneysRepo(handle, "s1");
    const bucket = buckets.create({ name: "Trucking" });
    const goal = goals.create({ bucketId: bucket.id, name: "First Truck", targetCents: 100000 });
    const journey = journeys.create({ title: "Become an Owner-Operator" });
    const link = journeys.link(journey.id, "goal", goal.id)!;

    const out = hydrateJourneyLinks(ctx, "s1", [link]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "goal", refId: goal.id, label: "First Truck" });
    expect(out[0]?.amount).toBeUndefined();
    expect(out[0]?.occurredAt).toBeUndefined();
    expect(out[0]?.linkedAt).toBe(link.createdAt); // CL-10: link date rides along
  });

  it("silently skips a dangling goal link (the goal was archived/deleted's row removed since linking)", () => {
    const buckets = new FinBucketRepo(handle, "s1");
    const goals = new FinGoalRepo(handle, "s1");
    const journeys = new JourneysRepo(handle, "s1");
    const bucket = buckets.create({ name: "Trucking" });
    const goal = goals.create({ bucketId: bucket.id, name: "First Truck" });
    const journey = journeys.create({ title: "Become an Owner-Operator" });
    const link = journeys.link(journey.id, "goal", goal.id)!;
    handle.sqlite.prepare(`DELETE FROM fin_goal WHERE id = ?`).run(goal.id);

    expect(hydrateJourneyLinks(ctx, "s1", [link])).toEqual([]);
  });

  it("never hydrates another space's goal", () => {
    const buckets = new FinBucketRepo(handle, "alice");
    const goals = new FinGoalRepo(handle, "alice");
    const journeys = new JourneysRepo(handle, "alice");
    const bucket = buckets.create({ name: "Trucking" });
    const goal = goals.create({ bucketId: bucket.id, name: "First Truck" });
    const journey = journeys.create({ title: "Become an Owner-Operator" });
    const link = journeys.link(journey.id, "goal", goal.id)!;

    expect(hydrateJourneyLinks(ctx, "bob", [link])).toEqual([]);
  });
});
