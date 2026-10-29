import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { LensesRepo } from "../repositories/lenses.repo.js";
import { evalLens, evalLensDetailed, LENS_EVAL_CAPS } from "../analysis/lenses.js";
import { linkOptionsFor, DEFAULT_LINK_OPTIONS } from "../ingestion/associativeLink.js";
import { categoryCounts, categoryIds, type CategoryKey } from "../analysis/categories.js";
import { createApp } from "../api/server.js";
import { buildContext } from "../context.js";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

let handle: DbHandle;
let ctx: AppContext;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = { handle, embeddings, llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
});
afterEach(() => handle.sqlite.close());

async function mem(space: string, label: string, over: Record<string, unknown> = {}) {
  return new NodesRepo(handle, space).create(
    { label, type: "daily", content: label, importance: 0.5, ...over } as never,
    await embeddings.embed(label),
  );
}

/** Bulk-insert `n` plain nodes straight into the table (no embeddings/FTS — the
 *  empty-query lens leg never touches either). */
function bulkNodes(space: string, n: number, over: Record<string, unknown> = {}) {
  const stmt = handle.sqlite.prepare(
    `INSERT INTO nodes (space_id, label, type, content, importance, status) VALUES (?, ?, ?, ?, ?, 'active')`,
  );
  const tx = handle.sqlite.transaction(() => {
    for (let i = 0; i < n; i++) stmt.run(space, `bulk ${i}`, "daily", `bulk ${i}`, 0.5);
  });
  tx();
}

describe("REG-208 — lens evaluation discloses its caps (CN-09)", () => {
  it("exposes the documented caps (500 FTS / 500 due / 2000 final)", () => {
    expect(LENS_EVAL_CAPS).toEqual({ fts: 500, due: 500, final: 2000 });
  });

  it("uncapped lens: total == shown, capped is false", async () => {
    await mem("legacy", "one");
    await mem("legacy", "two");
    const r = evalLensDetailed(ctx, "legacy", {});
    expect(r.total).toBe(2);
    expect(r.ids).toHaveLength(2);
    expect(r.capped).toBe(false);
    expect(r.ftsCapped).toBe(false);
    expect(r.dueCapped).toBe(false);
    expect(r.finalCapped).toBe(false);
    // evalLens keeps its old contract: just the (capped) id list.
    expect(evalLens(ctx, "legacy", {})).toEqual(r.ids);
  });

  it("final cap: a 2,001-match lens reports total 2001 and shows 2000", () => {
    bulkNodes("legacy", 2001);
    const r = evalLensDetailed(ctx, "legacy", {});
    expect(r.total).toBe(2001);
    expect(r.ids).toHaveLength(2000);
    expect(r.finalCapped).toBe(true);
    expect(r.capped).toBe(true);
    expect(r.ftsCapped).toBe(false);
    expect(r.dueCapped).toBe(false);
  });

  it("FTS cap: a keyword matching past the FTS leg is flagged (small caps prove the leg)", async () => {
    // Same word in every node so one keyword matches all of them.
    for (let i = 0; i < 4; i++) await mem("legacy", `quokka ${i}`, { content: "quokka quokka quokka" });
    const r = evalLensDetailed(ctx, "legacy", { text: "quokka" }, Date.now(), { fts: 2, due: 500, final: 2000 });
    expect(r.ftsCapped).toBe(true);
    expect(r.capped).toBe(true);
    expect(r.ids).toHaveLength(2);
    // The inner leg truncated the set, so the total is a lower bound, not exact.
    expect(r.totalIsLowerBound).toBe(true);
  });

  it("due cap: a due lens past the due leg is flagged (small caps prove the leg)", async () => {
    const old = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString();
    for (let i = 0; i < 4; i++) {
      const n = await mem("legacy", `due ${i}`);
      handle.sqlite.prepare(`UPDATE nodes SET created_at = ? WHERE id = ?`).run(old, n.id);
    }
    const r = evalLensDetailed(ctx, "legacy", { state: "due" }, Date.now(), { fts: 500, due: 2, final: 2000 });
    expect(r.dueCapped).toBe(true);
    expect(r.capped).toBe(true);
    expect(r.ids).toHaveLength(2);
    expect(r.totalIsLowerBound).toBe(true);
  });
});

describe("REG-214 — a corrupt lens query fails closed, never matches-all (CN-16)", () => {
  it("a lens whose stored query JSON is corrupt parses as broken, not {}", () => {
    const repo = new LensesRepo(handle, "legacy");
    const good = repo.create("Good lens", { emotion: "heavy" }, false);
    // Corrupt the stored query the way disk damage would (bypassing the zod-validated route).
    handle.sqlite.prepare(`UPDATE lenses SET query = ? WHERE id = ?`).run("{", good.id);
    const listed = repo.list().find((l) => l.id === good.id)!;
    expect(listed.broken).toBe(true);
    expect(listed.name).toBe("Good lens");
    expect(repo.get(good.id)!.broken).toBe(true);
  });

  it("a broken lens stays flagged through list/get, so no consumer can mistake it for a deliberate all-matching lens", () => {
    const repo = new LensesRepo(handle, "legacy");
    const lens = repo.create("Broken lens", { emotion: "heavy" }, false);
    handle.sqlite.prepare(`UPDATE lenses SET query = ? WHERE id = ?`).run("{", lens.id);
    const listed = repo.list().find((l) => l.id === lens.id)!;
    // The query still parses to {} for type-compat, but broken:true is what
    // stops the routes from ever evaluating it (a bare {} would match all).
    expect(listed.query).toEqual({});
    expect(listed.broken).toBe(true);
    expect(repo.get(lens.id)!.broken).toBe(true);
  });

  it("updating only the pin of a broken lens preserves its stored query verbatim", () => {
    const repo = new LensesRepo(handle, "legacy");
    const lens = repo.create("Broken lens", { emotion: "heavy" }, false);
    handle.sqlite.prepare(`UPDATE lenses SET query = ? WHERE id = ?`).run("{", lens.id);
    const up = repo.update(lens.id, { pinned: true })!;
    expect(up.pinned).toBe(true);
    expect(up.broken).toBe(true);
    const raw = handle.sqlite.prepare(`SELECT query FROM lenses WHERE id = ?`).get(lens.id) as { query: string };
    expect(raw.query).toBe("{"); // not silently rewritten to "{}" (an all-matching lens)
  });
});

describe("REG-215 — the ingest-time gate adapts to the embeddings provider (CN-17)", () => {
  it("linkOptionsFor mirrors contradictionOptionsFor: hash drops the gate, real keeps 0.72", () => {
    expect(linkOptionsFor("hash-bow").threshold).toBe(0.5);
    expect(linkOptionsFor("Hash-BOW").threshold).toBe(0.5);
    expect(linkOptionsFor("text-embedding-3-small").threshold).toBe(0.72);
    expect(linkOptionsFor("all-MiniLM-L6-v2").threshold).toBe(0.72);
    // Everything else (k, maxLinks) is the documented default.
    expect(linkOptionsFor("hash-bow").k).toBe(DEFAULT_LINK_OPTIONS.k);
    expect(linkOptionsFor("hash-bow").maxLinks).toBe(DEFAULT_LINK_OPTIONS.maxLinks);
    expect(DEFAULT_LINK_OPTIONS.threshold).toBe(0.72);
  });
});

describe("REG-207 — Views categories count from the full node set (CN-08)", () => {
  it("counts every category from the full set, mirroring the GalaxyViews predicates", async () => {
    await mem("legacy", "ana", { type: "person", kind: null });
    await mem("legacy", "proj", { type: "project", kind: null });
    await mem("legacy", "goal one", { type: "memory", kind: "goal" });
    await mem("legacy", "idea one", { type: "memory", kind: "idea" });
    await mem("legacy", "belief one", { type: "memory", kind: "belief" });
    await mem("legacy", "doc", { type: "knowledge", kind: null });
    await mem("legacy", "mtg", { type: "meeting", kind: null });
    await mem("legacy", "note", { type: "daily", kind: null });
    await mem("legacy", "action one", { type: "memory", kind: "action" });
    const counts = categoryCounts(ctx, "legacy");
    expect(counts).toEqual({
      people: 1, projects: 1, goals: 1, ideas: 1,
      beliefs: 1, knowledge: 1, meetings: 1, notes: 1,
    });
  });

  it("categoryIds returns the full id list for one category, space-scoped", async () => {
    const a = await mem("legacy", "ana", { type: "person", kind: null });
    await mem("other", "bob", { type: "person", kind: null });
    expect(categoryIds(ctx, "legacy", "people")).toEqual([a.id]);
    expect(categoryIds(ctx, "legacy", "goals")).toEqual([]);
    expect(() => categoryIds(ctx, "legacy", "nope" as CategoryKey)).toThrow(/unknown category/);
  });
});

/* ---------- Live-route probes (same harness as api.test.ts) ---------- */

let rctx: AppContext;
let server: Server;
let base: string;
let spaceId: string;

beforeAll(async () => {
  rctx = await buildContext({
    dbPath: ":memory:",
    embeddings: new HashEmbeddingProvider(EMBED_DIM),
    llm: new HeuristicProvider(),
  });
  const app = createApp(rctx);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const auth = await fetch(`${base}/api/space/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gamerTag: "batchh", passcode: "secret123", name: "batchh" }),
  });
  spaceId = ((await auth.json()) as { id: string }).id;
});
afterAll(() => {
  server?.close();
  rctx.handle.sqlite.close();
});

async function get(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, { headers: { "x-space-id": spaceId } });
  return { status: res.status, body: await res.json() };
}
async function post(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-space-id": spaceId },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe("REG-208/214/207 — routes", () => {
  it("REG-208: GET /api/lenses reports the true total + capped flag, not the truncated count", async () => {
    const created = await post("/api/lenses", { name: "All of it", query: {}, pinned: false });
    expect(created.status).toBe(200);
    // Baseline: the fresh space may already hold seed nodes — measure them,
    // then add 2,001 matching nodes. The list count must be the TRUE total
    // (baseline + 2001), flagged capped, with 2,000 shown.
    const baseline = (rctx.handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM nodes WHERE space_id = ? AND deleted_at IS NULL AND status != 'archived'`).get(spaceId) as { c: number }).c;
    const stmt = rctx.handle.sqlite.prepare(
      `INSERT INTO nodes (space_id, label, type, content, importance, status) VALUES (?, ?, ?, ?, ?, 'active')`,
    );
    const tx = rctx.handle.sqlite.transaction(() => {
      for (let i = 0; i < 2001; i++) stmt.run(spaceId, `bulk ${i}`, "daily", `bulk ${i}`, 0.5);
    });
    tx();
    const listed = await get("/api/lenses");
    const lens = listed.body.find((l: any) => l.id === created.body.id);
    expect(lens.count).toBe(baseline + 2001);
    expect(lens.capped).toBe(true);
    expect(lens.shown).toBe(2000);
    const nodes = await get(`/api/lenses/${created.body.id}/nodes`);
    expect(nodes.body.ids).toHaveLength(2000);
    expect(nodes.body.total).toBe(baseline + 2001);
    expect(nodes.body.capped).toBe(true);
    const preview = await post("/api/lenses/preview", { query: {} });
    expect(preview.body.count).toBe(baseline + 2001);
    expect(preview.body.capped).toBe(true);
    expect(preview.body.shown).toBe(2000);
  });

  it("REG-214: a corrupt lens lists as broken with a null count, and its nodes endpoint refuses", async () => {
    const created = await post("/api/lenses", { name: "Doomed", query: { emotion: "heavy" }, pinned: false });
    expect(created.status).toBe(200);
    rctx.handle.sqlite.prepare(`UPDATE lenses SET query = ? WHERE id = ?`).run("{", created.body.id);
    const listed = await get("/api/lenses");
    const lens = listed.body.find((l: any) => l.id === created.body.id);
    expect(lens.broken).toBe(true);
    expect(lens.name).toBe("Doomed");
    expect(lens.count).toBeNull(); // never the whole-brain count
    const nodes = await get(`/api/lenses/${created.body.id}/nodes`);
    expect(nodes.status).toBe(422);
  });

  it("REG-207: GET /api/graph/categories counts the full set; /:key/ids returns the ids", async () => {
    const cats = await get("/api/graph/categories");
    expect(cats.status).toBe(200);
    expect(cats.body.counts.notes).toBeGreaterThanOrEqual(2001);
    expect(cats.body.counts.people).toBe(0);
    const bad = await get("/api/graph/categories/nope/ids");
    expect(bad.status).toBe(400);
    const ids = await get("/api/graph/categories/notes/ids");
    expect(ids.status).toBe(200);
    expect(ids.body.ids.length).toBeGreaterThanOrEqual(2001);
  });
});
