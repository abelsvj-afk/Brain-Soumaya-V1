import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { Journey, FinBucket, FinGoal } from "@brain/shared";

/**
 * Regression for the Phase N audit finding, fixed in Phase O
 * (docs/specs/galaxy-entity-citizenship-audit.md §7): journeys.ts's LINK_KINDS omitted
 * "goal" even though the repo/DB layer already supports linking a Financial Goal to a
 * Journey, and WealthPanel.tsx's <JourneyChips kind="goal"> already relies on it — every
 * route that validated against LINK_KINDS 400'd a real, already-supported request.
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
    body: JSON.stringify({ gamerTag: "goallink", passcode: "secret123", name: "goallink" }),
  });
  spaceId = ((await auth.json()) as { id: string }).id;
});
afterAll(() => { server?.close(); ctx.handle.sqlite.close(); });

const H = () => ({ "Content-Type": "application/json", "x-space-id": spaceId });
const req = async (method: string, p: string, b?: unknown) => {
  const res = await fetch(`${base}${p}`, { method, headers: H(), ...(b !== undefined ? { body: JSON.stringify(b) } : {}) });
  return { status: res.status, body: await res.json() };
};
const get = (p: string) => req("GET", p);
const post = (p: string, b: unknown) => req("POST", p, b);

describe("journeys routes — Financial Goal <-> Journey linking", () => {
  it("links a real fin_goal row to a Journey over HTTP (previously 400'd)", async () => {
    const journey = (await post("/api/journeys", { title: "Buy My First Home" })).body as Journey;
    const bucket = (await post("/api/finance/wealth/buckets", { name: "House" })).body as FinBucket;
    const goal = (await post("/api/finance/wealth/goals", { bucketId: bucket.id, name: "Down payment", targetCents: 2_000_000 })).body as FinGoal;

    const link = await post(`/api/journeys/${journey.id}/link`, { kind: "goal", refId: goal.id });
    expect(link.status).toBe(200);

    const forGoal = await get(`/api/journeys/for/goal/${goal.id}`);
    expect(forGoal.status).toBe(200);
    expect((forGoal.body as Journey[]).map((j) => j.id)).toContain(journey.id);

    const links = await get(`/api/journeys/${journey.id}/links`);
    expect(links.status).toBe(200);
    // IM-87: /links now returns a detail object (display-capped `links` + true
    // totals/counts over ALL links), not a bare array.
    expect((links.body as { links: unknown[] }).links).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "goal", refId: goal.id, label: "Down payment" })]));
    expect((links.body as { totalCount: number }).totalCount).toBe(1);

    const unlink = await post(`/api/journeys/${journey.id}/unlink`, { kind: "goal", refId: goal.id });
    expect(unlink.status).toBe(200);
  });

  it("suggest/:kind/:refId accepts goal without 400ing (no crash on the finance-heuristic fallthrough)", async () => {
    const bucket = (await post("/api/finance/wealth/buckets", { name: "Retirement" })).body as FinBucket;
    const goal = (await post("/api/finance/wealth/goals", { bucketId: bucket.id, name: "401k" })).body as FinGoal;
    const { status, body } = await get(`/api/journeys/suggest/goal/${goal.id}`);
    expect(status).toBe(200);
    expect(body).toEqual({ autoLink: [], suggested: [] });
  });
});
