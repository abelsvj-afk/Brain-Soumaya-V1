import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { GraphData } from "@brain/shared";

let ctx: AppContext;
let server: Server;
let base: string;

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
});

afterAll(() => {
  server?.close();
  ctx.handle.sqlite.close();
});

/* eslint-disable @typescript-eslint/no-explicit-any */
async function post(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
async function get(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
}

describe("REST API", () => {
  it("reports health with provider info", async () => {
    const { status, body } = await get("/api/health");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.embeddings.dim).toBe(EMBED_DIM);
    expect(body.llm.available).toBe(false); // heuristic fallback
  });

  it("ingests thoughts and returns them as graph data", async () => {
    const a = await post("/api/ingest", {
      text: "I want to start a coffee subscription business with local roasters",
    });
    expect(a.status).toBe(200);
    expect(a.body.nodes.length).toBeGreaterThanOrEqual(1);

    await post("/api/ingest", {
      text: "I want to start a coffee subscription company with local roasters",
    });

    const graph = (await get("/api/graph")).body as GraphData;
    expect(graph.nodes.length).toBeGreaterThanOrEqual(2);
    // GraphData is directly react-force-graph-3d shaped.
    expect(graph.nodes[0]).toHaveProperty("id");
    expect(graph).toHaveProperty("links");
  });

  it("rejects empty ingest body", async () => {
    const { status } = await post("/api/ingest", { text: "" });
    expect(status).toBe(400);
  });

  it("semantic search returns the relevant node with a similarity score", async () => {
    const { status, body } = await get(`/api/search?q=${encodeURIComponent("coffee subscription")}`);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0]).toHaveProperty("similarity");
    expect(body[0].content.toLowerCase()).toContain("coffee");
  });

  it("returns a node's neighborhood subgraph", async () => {
    const graph = (await get("/api/graph")).body as GraphData;
    const id = graph.nodes[0]!.id;
    const { status, body } = await get(`/api/nodes/${id}/neighbors?depth=2`);
    expect(status).toBe(200);
    expect(body.nodes.some((n: { id: number }) => n.id === id)).toBe(true);
  });

  it("404s for an unknown node", async () => {
    const { status } = await get("/api/nodes/999999");
    expect(status).toBe(404);
  });
});
