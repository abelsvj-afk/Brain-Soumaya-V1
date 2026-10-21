import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";

let ctx: AppContext; let server: Server; let base: string; let spaceId: string;
beforeAll(async () => {
  ctx = await buildContext({ dbPath: ":memory:", embeddings: new HashEmbeddingProvider(EMBED_DIM), llm: new HeuristicProvider() });
  const app = createApp(ctx);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const auth = await fetch(`${base}/api/space/auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gamerTag: "agenda", passcode: "secret123", name: "agenda" }) });
  spaceId = ((await auth.json()) as { id: string }).id;
});
afterAll(() => { server?.close(); ctx.handle.sqlite.close(); });
/* eslint-disable @typescript-eslint/no-explicit-any */
async function req(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", "x-space-id": spaceId }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function makeAction(text = "buy the milk please"): Promise<number> {
  const { body } = await req("POST", "/api/ingest", { text, kind: "action", ttlHours: 24 });
  return body.nodes[0].id as number;
}

describe("IM-51 PATCH /api/nodes/:id/agenda", () => {
  it("reschedules an action's expiresAt and edits its label/content", async () => {
    const id = await makeAction();
    const when = new Date(Date.now() + 3 * 86400_000).toISOString();
    const { status, body } = await req("PATCH", `/api/nodes/${id}/agenda`, { label: "Buy oat milk", content: "from the shop", expiresAt: when });
    expect(status).toBe(200);
    expect(body.label).toBe("Buy oat milk");
    expect(body.content).toBe("from the shop");
    expect(body.expiresAt).toBe(when);
    const got = await req("GET", `/api/nodes/${id}`);
    expect(got.body.expiresAt).toBe(when);
  });
  it("snoozes a reminder by moving remindAt, and clears it with null", async () => {
    const { body: made } = await req("POST", "/api/ingest", { text: "remember to call the dentist", remindAt: new Date(Date.now() - 60_000).toISOString() });
    const id = made.nodes[0].id as number;
    const later = new Date(Date.now() + 3600_000).toISOString();
    const snoozed = await req("PATCH", `/api/nodes/${id}/agenda`, { remindAt: later });
    expect(snoozed.status).toBe(200);
    expect(snoozed.body.remindAt).toBe(later);
    const cleared = await req("PATCH", `/api/nodes/${id}/agenda`, { remindAt: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.remindAt ?? null).toBeNull();
  });
  it("rejects an empty patch and 404s an unknown node", async () => {
    const id = await makeAction("another task here");
    expect((await req("PATCH", `/api/nodes/${id}/agenda`, {})).status).toBe(400);
    expect((await req("PATCH", `/api/nodes/999999/agenda`, { label: "x" })).status).toBe(404);
  });
  it("is space-scoped: another space cannot reschedule this node", async () => {
    const id = await makeAction("private task here");
    const auth = await fetch(`${base}/api/space/auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gamerTag: "otheragenda", passcode: "secret123", name: "other" }) });
    const other = ((await auth.json()) as { id: string }).id;
    const res = await fetch(`${base}/api/nodes/${id}/agenda`, { method: "PATCH", headers: { "Content-Type": "application/json", "x-space-id": other }, body: JSON.stringify({ label: "hijacked" }) });
    expect(res.status).toBe(404);
  });
});
