import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import { JourneysRepo } from "../repositories/journeys.repo.js";
import type { JourneyLinksDetail } from "@brain/shared";

/**
 * IM-86 (Round 1, contradiction-kill subset): a journey linked only via kinds the
 * detail view couldn't show used to read "N linked" in its header and
 * "Nothing linked yet" in detail. The /links payload now accounts for EVERY link:
 * hydratable kinds return summaries, the rest are counted in `unshownByKind`, and
 * `totalCount` always matches the header's link count — so the UI can agree with
 * itself without inventing labels for kinds that have no source table
 * (task/chat/achievement have none in this schema; see JourneysRepo.REF_TABLE).
 */

let ctx: AppContext;
let server: Server;
let base: string;
let spaceId: string;

beforeAll(async () => {
  ctx = await buildContext({ dbPath: ":memory:", embeddings: new HashEmbeddingProvider(EMBED_DIM), llm: new HeuristicProvider() });
  const app = createApp(ctx);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const auth = await fetch(`${base}/api/space/auth`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gamerTag: "unshown", passcode: "secret123", name: "unshown" }),
  });
  spaceId = ((await auth.json()) as { id: string }).id;
});
afterAll(() => { server?.close(); ctx.handle.sqlite.close(); });

const getLinks = async (journeyId: number): Promise<JourneyLinksDetail> => {
  const res = await fetch(`${base}/api/journeys/${journeyId}/links`, { headers: { "x-space-id": spaceId } });
  expect(res.status).toBe(200);
  return (await res.json()) as JourneyLinksDetail;
};

function makeGoal(name: string): number {
  const bucketId = Number(
    ctx.handle.sqlite.prepare(`INSERT INTO fin_bucket (space_id, name) VALUES (?, 'B')`).run(spaceId).lastInsertRowid,
  );
  return Number(
    ctx.handle.sqlite
      .prepare(`INSERT INTO fin_goal (space_id, bucket_id, name, target_cents) VALUES (?, ?, ?, 100000)`)
      .run(spaceId, bucketId, name).lastInsertRowid,
  );
}

describe("GET /journeys/:id/links — IM-86 no-silent-links accounting", () => {
  it("a goal-only journey returns the goal's summary and a matching totalCount", async () => {
    const repo = new JourneysRepo(ctx.handle, spaceId);
    const journey = repo.create({ title: "Goal Only" });
    const goalId = makeGoal("First Truck");
    repo.link(journey.id, "goal", goalId);

    const detail = await getLinks(journey.id);
    expect(detail.totalCount).toBe(1);
    expect(detail.links).toEqual([{ kind: "goal", refId: goalId, label: "First Truck" }]);
    expect(detail.unshownByKind).toEqual({});
  });

  it("a task-only journey is counted as unshown, never silently dropped", async () => {
    const repo = new JourneysRepo(ctx.handle, spaceId);
    const journey = repo.create({ title: "Task Only" });
    // task/chat/achievement have no table to validate or hydrate against —
    // link() accepts them unvalidated by design (JourneysRepo.REF_TABLE).
    expect(repo.link(journey.id, "task", 4242)).not.toBeNull();

    const detail = await getLinks(journey.id);
    expect(detail.totalCount).toBe(1); // the header counts this link…
    expect(detail.links).toEqual([]); // …no fabricated summary is invented…
    expect(detail.unshownByKind).toEqual({ task: 1 }); // …and the payload says why
  });

  it("chat + achievement links are likewise accounted, alongside a hydratable link", async () => {
    const repo = new JourneysRepo(ctx.handle, spaceId);
    const journey = repo.create({ title: "Mixed" });
    repo.link(journey.id, "chat", 11);
    repo.link(journey.id, "achievement", 12);
    repo.link(journey.id, "goal", makeGoal("Visible Goal"));

    const detail = await getLinks(journey.id);
    expect(detail.totalCount).toBe(3);
    expect(detail.links.map((l) => l.kind)).toEqual(["goal"]);
    expect(detail.unshownByKind).toEqual({ chat: 1, achievement: 1 });
  });
});
