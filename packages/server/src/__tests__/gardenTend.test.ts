import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import { EconomyRepo, EARN_MIND } from "../economy.js";
import { EARN_MIND_DAILY_CAP } from "@brain/shared";

/**
 * Verb 1 — Tend a plot: the POST /api/garden/tend modes, the fuel rules,
 * and the tend record.
 *
 * Fail-before: on the base tree the route does not exist (404) — the
 * behavior pinned here is entirely new.
 */
let ctx: AppContext;
let server: Server;
let base: string;
let spaceId: string;

beforeAll(async () => {
  ctx = await buildContext({
    dbPath: ":memory:",
    embeddings: new HashEmbeddingProvider(EMBED_DIM),
    llm: new HeuristicProvider(),
  });
  const app = createApp(ctx);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const auth = await fetch(`${base}/api/space/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gamerTag: "gardener", passcode: "secret123", name: "gardener" }),
  });
  spaceId = ((await auth.json()) as { id: string }).id;
});

afterAll(() => {
  server?.close();
  ctx.handle.sqlite.close();
});

const headers = () => ({ "Content-Type": "application/json", "x-space-id": spaceId });

async function createNode(label: string): Promise<number> {
  // POST /api/ingest plants a plain memory node. It pays from the Memory
  // pool (EARN_MEMORY), never the Mind pool — so seeding never consumes
  // the Mind cap these tests measure.
  const res = await fetch(`${base}/api/ingest`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ text: label }),
  });
  const body = (await res.json()) as { nodes?: { id: number }[]; error?: string };
  expect(res.status, JSON.stringify(body)).toBe(200);
  expect(body.nodes?.length).toBeGreaterThan(0);
  return body.nodes![0]!.id;
}

async function tend(body: Record<string, unknown>) {
  const res = await fetch(`${base}/api/garden/tend`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function getTends() {
  const res = await fetch(`${base}/api/garden/tends`, { headers: headers() });
  const body = (await res.json()) as { tends: { nodeId: number; kind: string }[] };
  return body.tends;
}

async function getGraph(h: () => Record<string, string> = headers) {
  const res = await fetch(`${base}/api/graph`, { headers: h() });
  return (await res.json()) as {
    nodes: { id: number; content: string; lastTendedAt?: string }[];
    links: { id: number; source: number; target: number }[];
  };
}

describe("garden tend (Verb 1)", () => {
  it("a line adds a real node linked to the tended plot, warms it, and earns +6 Mind fuel", async () => {
    const plot = await createNode("The garden plot to tend with a line");
    const fuelBefore = new EconomyRepo(ctx.handle, spaceId).get();
    const { status, body } = await tend({ nodeId: plot, mode: "line", text: "A new line added while tending." });
    expect(status).toBe(200);
    expect(body.fuelEarned).toBe(EARN_MIND);
    expect(body.fuel).toBe(fuelBefore + EARN_MIND);
    const newNodeId = body.newNodeId as number;
    expect(newNodeId).toBeGreaterThan(0);
    expect(body.edgeId).toBeGreaterThan(0);
    // The new node is a real node in the graph, linked to the tended plot.
    const graph = await getGraph();
    expect(graph.nodes.some((n) => n.id === newNodeId && n.content === "A new line added while tending.")).toBe(true);
    expect(graph.links.some((e) => e.id === (body.edgeId as number) && e.source === newNodeId && e.target === plot)).toBe(true);
    // The plot is warmed: lastTendedAt is set.
    const tended = graph.nodes.find((n) => n.id === plot)!;
    expect(tended.lastTendedAt).toBeTruthy();
    // The tend record is kept.
    const tends = await getTends();
    expect(tends.some((t) => t.nodeId === plot && t.kind === "line")).toBe(true);
  });

  it("a link creates a real edge to another memory and earns +6", async () => {
    // Deliberately dissimilar texts: the ingest pipeline links related
    // memories on its own, and these two must start unlinked.
    const a = await createNode("Notes on repairing a bicycle chain");
    const b = await createNode("A poem about the winter sea");
    const { status, body } = await tend({ nodeId: a, mode: "link", targetId: b });
    expect(status).toBe(200);
    expect(body.fuelEarned).toBe(EARN_MIND);
    const graph = await getGraph();
    expect(graph.links.some((e) => e.id === (body.edgeId as number) && e.source === a && e.target === b)).toBe(true);
    const tends = await getTends();
    expect(tends.some((t) => t.nodeId === a && t.kind === "link")).toBe(true);
  });

  it("linking two memories that are already linked warms and records, but pays 0 — no relink farm", async () => {
    const a = await createNode("How to pickle red onions");
    const b = await createNode("The history of the lighthouse at Point Reyes");
    const first = await tend({ nodeId: a, mode: "link", targetId: b });
    expect(first.status).toBe(200);
    expect(first.body.fuelEarned).toBe(EARN_MIND);
    const fuelBefore = new EconomyRepo(ctx.handle, spaceId).get();
    const second = await tend({ nodeId: a, mode: "link", targetId: b });
    expect(second.status).toBe(200);
    expect(second.body.fuelEarned).toBe(0);
    expect(second.body.alreadyLinked).toBe(true);
    expect(second.body.edgeId).toBe(first.body.edgeId);
    expect(new EconomyRepo(ctx.handle, spaceId).get()).toBe(fuelBefore);
  });

  it("an affirmation records the judgment and earns +6; a visit warms and earns 0", async () => {
    const plot = await createNode("Plot to affirm and visit");
    const fuelBefore = new EconomyRepo(ctx.handle, spaceId).get();
    const affirmed = await tend({ nodeId: plot, mode: "affirm", changed: true });
    expect(affirmed.status).toBe(200);
    expect(affirmed.body.fuelEarned).toBe(EARN_MIND);
    const visited = await tend({ nodeId: plot, mode: "visit" });
    expect(visited.status).toBe(200);
    expect(visited.body.fuelEarned).toBe(0);
    expect(new EconomyRepo(ctx.handle, spaceId).get()).toBe(fuelBefore + EARN_MIND);
    const tends = await getTends();
    expect(tends.filter((t) => t.nodeId === plot).map((t) => t.kind)).toEqual(expect.arrayContaining(["affirm", "visit"]));
  });

  it("the Mind 10/day cap binds: past the cap a tend still warms and records, and pays 0", async () => {
    // A fresh space so the count is exact: seeding goes through
    // /api/ingest, which pays from the Memory pool, never the Mind pool —
    // so only the affirmation tends draw on the Mind 10/day cap. Ten
    // affirmations = 10 paid Mind earns = the cap; the eleventh pays 0.
    const capAuth = await fetch(`${base}/api/space/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gamerTag: "capgardener", passcode: "secret123", name: "capgardener" }),
    });
    const capSpace = ((await capAuth.json()) as { id: string }).id;
    const capHeaders = () => ({ "Content-Type": "application/json", "x-space-id": capSpace });
    const capCreate = async (label: string): Promise<number> => {
      const res = await fetch(`${base}/api/ingest`, {
        method: "POST",
        headers: capHeaders(),
        body: JSON.stringify({ text: label }),
      });
      const body = (await res.json()) as { nodes?: { id: number }[] };
      return body.nodes![0]!.id;
    };
    const capTend = async (body: Record<string, unknown>) => {
      const res = await fetch(`${base}/api/garden/tend`, {
        method: "POST",
        headers: capHeaders(),
        body: JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    let paid = 0;
    for (let i = 0; i < EARN_MIND_DAILY_CAP; i++) {
      const plot = await capCreate(`Cap filler plot ${i}`);
      const { body } = await capTend({ nodeId: plot, mode: "affirm", changed: false });
      paid += body.fuelEarned as number;
      if ((body.fuelEarned as number) === 0) break;
    }
    expect(paid).toBe(EARN_MIND * EARN_MIND_DAILY_CAP);
    const plot = await capCreate("One more plot past the cap");
    const { status, body } = await capTend({ nodeId: plot, mode: "affirm", changed: false });
    expect(status).toBe(200);
    expect(body.fuelEarned).toBe(0);
    const capGraph = await getGraph(capHeaders);
    expect(capGraph.nodes.find((n) => n.id === plot)!.lastTendedAt).toBeTruthy();
    const tendsRes = await fetch(`${base}/api/garden/tends`, { headers: capHeaders() });
    const tends = ((await tendsRes.json()) as { tends: { nodeId: number; kind: string }[] }).tends;
    expect(tends.some((t) => t.nodeId === plot && t.kind === "affirm")).toBe(true);
  });

  it("rejects bad input without changing anything", async () => {
    const missing = await tend({ nodeId: 999999, mode: "visit" });
    expect(missing.status).toBe(404);
    const plot = await createNode("Plot for bad input checks");
    expect((await tend({ nodeId: plot, mode: "line" })).status).toBe(400);
    expect((await tend({ nodeId: plot, mode: "line", text: "   " })).status).toBe(400);
    expect((await tend({ nodeId: plot, mode: "link" })).status).toBe(400);
    expect((await tend({ nodeId: plot, mode: "link", targetId: plot })).status).toBe(400);
    expect((await tend({ nodeId: plot, mode: "link", targetId: 999999 })).status).toBe(404);
    expect((await tend({ nodeId: plot, mode: "affirm" })).status).toBe(400);
    expect((await tend({ nodeId: plot, mode: "dance" })).status).toBe(400);
  });
});
