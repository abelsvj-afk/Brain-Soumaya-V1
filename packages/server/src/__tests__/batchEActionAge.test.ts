import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import { EconomyRepo } from "../economy.js";
import { actionEarnsFuel } from "../economy.js";

/**
 * REG-141 (AG-02): the +3 action-completion reward is promised by a 10-minute
 * age rule but paid by a previous-UTC-day rule — the server gate was a string
 * comparison between ISO `created_at` (`T` separator) and SQLite
 * `datetime()` output (space separator). Same-day completions never paid.
 *
 * Fail-before: on the old code the 5-hour-old same-day action pays 0 (HTTP
 * case A) and the pure-predicate cases fail outright.
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
    body: JSON.stringify({ gamerTag: "reviewer", passcode: "secret123", name: "reviewer" }),
  });
  spaceId = ((await auth.json()) as { id: string }).id;
});

afterAll(() => {
  server?.close();
  ctx.handle.sqlite.close();
});

function fuel(): number {
  return new EconomyRepo(ctx.handle, spaceId).get();
}

function insertAction(label: string, createdAt: string): number {
  const info = ctx.handle.sqlite
    .prepare(
      `INSERT INTO nodes (space_id, label, type, content, kind, importance, created_at) VALUES (?, ?, 'daily', ?, 'action', 0.5, ?)`,
    )
    .run(spaceId, label, label, createdAt);
  return Number(info.lastInsertRowid);
}

async function deleteNode(id: number): Promise<number> {
  const res = await fetch(`${base}/api/nodes/${id}`, {
    method: "DELETE",
    headers: { "x-space-id": spaceId },
  });
  return res.status;
}

describe("REG-141 — action-completion age gate (pure predicate)", () => {
  // Fixed "now": 2026-10-23T14:00:00Z.
  const NOW = Date.UTC(2026, 9, 23, 14, 0, 0);
  it("a 5-hour-old same-day action earns", () => {
    expect(actionEarnsFuel("2026-10-23T09:00:00.000Z", NOW)).toBe(true);
  });
  it("a 5-minute-old action does not earn", () => {
    expect(actionEarnsFuel("2026-10-23T13:55:00.000Z", NOW)).toBe(false);
  });
  it("a 15-minute-old action across UTC midnight earns", () => {
    expect(actionEarnsFuel("2026-10-22T23:50:00.000Z", Date.UTC(2026, 9, 23, 0, 5, 0))).toBe(true);
  });
  it("exactly 10 minutes old earns; a minute under does not", () => {
    expect(actionEarnsFuel("2026-10-23T13:50:00.000Z", NOW)).toBe(true);
    expect(actionEarnsFuel("2026-10-23T13:50:01.000Z", NOW)).toBe(false);
  });
  it("a legacy space-separated SQLite timestamp parses the same way", () => {
    expect(actionEarnsFuel("2026-10-23 09:00:00", NOW)).toBe(true);
  });
  it("a missing created_at never earns", () => {
    expect(actionEarnsFuel(null, NOW)).toBe(false);
    expect(actionEarnsFuel(undefined, NOW)).toBe(false);
  });
});

describe("REG-141 — DELETE /api/nodes/:id pays the stated +3", () => {
  it("a same-day action older than 10 minutes pays +3 (the ordinary to-do case)", async () => {
    // Created 5h ago, same UTC calendar day at any gate hour past 05:00 UTC;
    // clamped to 30 min ago when the run is near UTC midnight so the
    // created date stays on the same UTC day as now.
    const now = Date.now();
    const startOfUtcDay = Date.UTC(
      new Date(now).getUTCFullYear(),
      new Date(now).getUTCMonth(),
      new Date(now).getUTCDate(),
    );
    const ageMs = Math.min(5 * 3_600_000, now - startOfUtcDay - 60_000);
    const created = new Date(now - Math.max(ageMs, 11 * 60_000)).toISOString();
    const id = insertAction("buy milk", created);
    const before = fuel();
    expect(await deleteNode(id)).toBe(200);
    expect(fuel()).toBeCloseTo(before + 3, 5);
  });

  it("an action cleared 5 minutes after creation pays nothing", async () => {
    const id = insertAction("just made this", new Date(Date.now() - 5 * 60_000).toISOString());
    const before = fuel();
    expect(await deleteNode(id)).toBe(200);
    expect(fuel()).toBeCloseTo(before, 5);
  });
});
