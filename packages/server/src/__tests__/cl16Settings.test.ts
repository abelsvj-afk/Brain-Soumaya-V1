import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";

/**
 * CL-16 (IM-129a/b/c): Settings' user-life controls need REAL backing —
 * the space timezone + proactive-notification preferences (previously only
 * reachable inside agent/notify/policy.ts, with no HTTP route at all) and a
 * graph-JSON export (previously only client-side Markdown in Browse).
 * These tests pin the routes' existence, validation, and space isolation.
 */

let ctx: AppContext;
let server: Server;
let base: string;
let spaceId: string;
let otherSpaceId: string;

async function auth(gamerTag: string): Promise<string> {
  const res = await fetch(`${base}/api/space/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gamerTag, passcode: "secret123", name: gamerTag }),
  });
  return ((await res.json()) as { id: string }).id;
}

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
  spaceId = await auth("cl16main");
  otherSpaceId = await auth("cl16other");
});

afterAll(() => {
  server?.close();
  ctx.handle.sqlite.close();
});

/* eslint-disable @typescript-eslint/no-explicit-any */
async function req(method: string, path: string, id: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-space-id": id },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json() };
}

describe("IM-129a/b — space preferences route", () => {
  it("serves the signed-off defaults for a fresh space", async () => {
    const { status, body } = await req("GET", "/api/space/preferences", spaceId);
    expect(status).toBe(200);
    expect(body.timezone).toBe("America/New_York");
    expect(body.quietStart).toBe("21:00");
    expect(body.quietEnd).toBe("04:30");
    expect(body.digestTime).toBe("06:00");
    expect(body.dailyProactiveCap).toBe(5);
  });

  it("writes a timezone + notification prefs and reads them back", async () => {
    const w = await req("PATCH", "/api/space/preferences", spaceId, {
      timezone: "Europe/London",
      quietStart: "22:30",
      digestTime: "07:15",
      dailyProactiveCap: 3,
    });
    expect(w.status).toBe(200);
    expect(w.body.timezone).toBe("Europe/London");
    const r = await req("GET", "/api/space/preferences", spaceId);
    expect(r.body.timezone).toBe("Europe/London");
    expect(r.body.quietStart).toBe("22:30");
    expect(r.body.digestTime).toBe("07:15");
    expect(r.body.dailyProactiveCap).toBe(3);
    // Untouched field keeps its default.
    expect(r.body.quietEnd).toBe("04:30");
  });

  it("rejects an invalid timezone WITHOUT corrupting the stored one", async () => {
    const w = await req("PATCH", "/api/space/preferences", spaceId, { timezone: "Not/AZone", quietStart: "23:00" });
    expect(w.status).toBe(400);
    const r = await req("GET", "/api/space/preferences", spaceId);
    expect(r.body.timezone).toBe("Europe/London");
    // The whole patch is validated first — the valid sibling field was NOT applied either.
    expect(r.body.quietStart).toBe("22:30");
  });

  it("rejects a malformed quiet-hours time", async () => {
    const w = await req("PATCH", "/api/space/preferences", spaceId, { quietEnd: "25:99" });
    expect(w.status).toBe(400);
  });

  it("is space-scoped: the other brain still sees defaults", async () => {
    const r = await req("GET", "/api/space/preferences", otherSpaceId);
    expect(r.body.timezone).toBe("America/New_York");
    expect(r.body.dailyProactiveCap).toBe(5);
  });

  it("requires a valid space", async () => {
    const res = await fetch(`${base}/api/space/preferences`);
    expect(res.status).toBe(401);
  });
});

describe("IM-129c — graph JSON export", () => {
  it("exports only the requesting space's live nodes and their internal edges", async () => {
    const ins = ctx.handle.sqlite.prepare(
      `INSERT INTO nodes (space_id, label, type, content) VALUES (?, ?, 'knowledge', ?)`,
    );
    const a = Number(ins.run(spaceId, "Export Alpha", "alpha body").lastInsertRowid);
    const b = Number(ins.run(spaceId, "Export Beta", "beta body").lastInsertRowid);
    const gone = Number(ins.run(spaceId, "Export Deleted", "gone body").lastInsertRowid);
    const other = Number(ins.run(otherSpaceId, "Other Brain Node", "not yours").lastInsertRowid);
    ctx.handle.sqlite
      .prepare(`UPDATE nodes SET deleted_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), gone);
    const edge = ctx.handle.sqlite.prepare(
      `INSERT INTO edges (space_id, source, target, relationship, weight) VALUES (?, ?, ?, 'related', 1)`,
    );
    edge.run(spaceId, a, b);
    edge.run(spaceId, a, gone); // endpoint soft-deleted -> must not ship
    edge.run(otherSpaceId, other, other);

    const { status, body } = await req("GET", "/api/graph/export", spaceId);
    expect(status).toBe(200);
    expect(body.spaceId).toBe(spaceId);
    expect(typeof body.exportedAt).toBe("string");
    const labels = (body.nodes as { label: string }[]).map((n) => n.label);
    expect(labels).toContain("Export Alpha");
    expect(labels).toContain("Export Beta");
    expect(labels).not.toContain("Export Deleted");
    expect(labels).not.toContain("Other Brain Node");
    // Exactly one edge survives: alpha<->beta (both endpoints exported).
    expect(body.edges).toHaveLength(1);
    expect(body.edges[0].source).toBe(a);
    expect(body.edges[0].target).toBe(b);
    const alpha = (body.nodes as { content: string; label: string }[]).find((n) => n.label === "Export Alpha");
    expect(alpha?.content).toBe("alpha body");
  });
});
