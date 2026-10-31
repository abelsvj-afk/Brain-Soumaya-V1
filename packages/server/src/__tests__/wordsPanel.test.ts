import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import { SourcesRepo } from "../repositories/sources.repo.js";
import { SpacesRepo } from "../auth/spaces.js";

/**
 * Your Words panel — acceptance tests for the read-only /api/words
 * routes (design `WORDS-PANEL-DESIGN-2026-10-31.md`). Proven through
 * the HTTP surface (buildContext + createApp + fetch), the same door
 * the panel uses:
 *
 * - overview: totals, per-channel counts, recents, open-flag count —
 *   all scoped to the caller's space;
 * - list: newest first, channel + kind filters, id-cursor paging;
 * - detail: the current reading (a seeded correction is APPLIED),
 *   corrections as stored, derived nodes from ORIGIN links only;
 * - search: with the hash-fallback embedder the route must report
 *   the tool's honest degradation (mode fts_only, degraded true);
 * - two-space isolation on every route: another space's sources are
 *   absent from lists/search and 404 by id.
 *
 * The context's embedder is HashEmbeddingProvider on purpose: its
 * model name IS "hash-bow", the D2 signal — production's real
 * embedder failing to start looks exactly like this to the route.
 */

let ctx: AppContext;
let server: Server;
let base: string;
let tmpDir: string;

let spaceCounter = 0;
function freshSpace(): string {
  spaceCounter += 1;
  const tag = `words-tester-${spaceCounter}`;
  const created = new SpacesRepo(ctx.handle).authOrCreate(tag, "secret123", tag);
  expect(created).not.toBeNull();
  return created!.space.id;
}

async function get(path: string, space: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, { headers: { "x-space-id": space } });
  return { status: res.status, body: await res.json() };
}

function repo(space: string): SourcesRepo {
  return new SourcesRepo(ctx.handle, space);
}

function seedNode(space: string, label: string): number {
  const r = ctx.handle.sqlite
    .prepare(`INSERT INTO nodes (space_id, label, type, content) VALUES (?, ?, 'memory', ?)`)
    .run(space, label, `content of ${label}`);
  return Number(r.lastInsertRowid);
}

function seedFlag(space: string, sourceId: number): void {
  ctx.handle.sqlite
    .prepare(
      `INSERT INTO forget_unresolved_flags (space_id, request_id, source_id, table_name, row_id, policy_reason, status)
       VALUES (?, 1, ?, 'user_model', 999, 'stated_user_model', 'open')`,
    )
    .run(space, sourceId);
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "words-panel-"));
  ctx = await buildContext({
    dbPath: nodePath.join(tmpDir, "brain.db"),
    embeddings: new HashEmbeddingProvider(EMBED_DIM),
    llm: new HeuristicProvider(),
  });
  const app = createApp(ctx);
  server = await new Promise<Server>((resolve) => {
    const srv = app.listen(0, () => resolve(srv));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  ctx.handle.sqlite.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("GET /api/words/overview", () => {
  it("reports totals, per-channel counts, recents and open flags for the caller's space only", async () => {
    const a = freshSpace();
    const b = freshSpace();
    const ra = repo(a);
    ra.persistText({ kind: "note", citationClass: "verbatim_typed", text: "first typed words about apples" });
    ra.persistText({ kind: "telegram", citationClass: "verbatim_typed", text: "a telegram note about boats" });
    ra.persistText({ kind: "chat", citationClass: "verbatim_typed", text: "chat words about cars" });
    const doc = ra.persistText({ kind: "document", citationClass: "imported_text", text: "imported words about dates" });
    seedFlag(a, doc.source.id);
    repo(b).persistText({ kind: "note", citationClass: "verbatim_typed", text: "someone else's oranges" });

    const oa = await get("/api/words/overview", a);
    expect(oa.status).toBe(200);
    expect(oa.body.total).toBe(4);
    expect(oa.body.byChannel).toEqual({ typed: 1, telegram: 1, chat: 1, imported: 1 });
    expect(oa.body.openFlags).toBe(1);
    // Recent = newest first, summaries from the current reading.
    expect(oa.body.recent).toHaveLength(4);
    expect(oa.body.recent[0].id).toBe(doc.source.id);
    expect(oa.body.recent[0].channel).toBe("imported");
    expect(oa.body.recent[0].preview).toContain("imported words about dates");
    expect(oa.body.recent[0].wordCount).toBe(4);

    const ob = await get("/api/words/overview", b);
    expect(ob.body.total).toBe(1);
    expect(ob.body.byChannel).toEqual({ typed: 1, telegram: 0, chat: 0, imported: 0 });
    expect(ob.body.openFlags).toBe(0);
    expect(ob.body.recent[0].preview).toContain("oranges");
  });
});

describe("GET /api/words/sources", () => {
  it("lists newest first with channel/kind filters and id-cursor paging, space-scoped", async () => {
    const a = freshSpace();
    const b = freshSpace();
    const ra = repo(a);
    const ids: number[] = [];
    for (let i = 1; i <= 4; i++) {
      ids.push(ra.persistText({ kind: "note", citationClass: "verbatim_typed", text: `paging note number ${i}` }).source.id);
    }
    const tg = ra.persistText({ kind: "telegram", citationClass: "verbatim_typed", text: "a telegram one" }).source.id;
    const other = repo(b).persistText({ kind: "note", citationClass: "verbatim_typed", text: "not yours" }).source.id;

    const all = await get("/api/words/sources?limit=100", a);
    const listed = all.body.sources.map((s: any) => s.id);
    expect(listed).toEqual([...ids, tg].sort((x, y) => y - x));
    expect(listed).not.toContain(other);

    const byChannel = await get("/api/words/sources?channel=telegram", a);
    expect(byChannel.body.sources.map((s: any) => s.id)).toEqual([tg]);
    expect(byChannel.body.sources[0].channel).toBe("telegram");

    const byKind = await get("/api/words/sources?kind=note", a);
    expect(byKind.body.sources.map((s: any) => s.id)).toEqual([...ids].sort((x, y) => y - x));

    const page1 = await get("/api/words/sources?limit=2", a);
    expect(page1.body.sources.map((s: any) => s.id)).toEqual([tg, ids[3]]);
    const cursor = page1.body.sources[1].id;
    const page2 = await get(`/api/words/sources?limit=2&before=${cursor}`, a);
    expect(page2.body.sources.map((s: any) => s.id)).toEqual([ids[2], ids[1]]);
    const page3 = await get(`/api/words/sources?limit=2&before=${ids[1]}`, a);
    expect(page3.body.sources.map((s: any) => s.id)).toEqual([ids[0]]);

    const bad = await get("/api/words/sources?channel=bogus", a);
    expect(bad.status).toBe(400);
  });
});

describe("GET /api/words/sources/:id", () => {
  it("serves the current reading with a correction applied, corrections as stored, origin-linked node labels only", async () => {
    const a = freshSpace();
    const ra = repo(a);
    const original = "the machine heard me wrong at noon";
    const { source } = ra.persistText({ kind: "voice", citationClass: "transcript_machine", text: original });
    const wrongAt = original.indexOf("wrong");
    ra.addCorrection({
      sourceId: source.id,
      startOffset: wrongAt,
      endOffset: wrongAt + "wrong".length,
      correctedText: "right",
    });
    const originNode = seedNode(a, "Derived memory label");
    const supportNode = seedNode(a, "Support only label");
    const derivedNode = seedNode(a, "Derived-from label");
    const chunkId = ra.chunksOf(source.id)[0]!.id;
    ra.linkNode({ nodeId: originNode, sourceId: source.id, chunkId, role: "origin" });
    ra.linkNode({ nodeId: supportNode, sourceId: source.id, chunkId, role: "support" });
    ra.linkNode({ nodeId: derivedNode, sourceId: source.id, chunkId, role: "derived_from" });

    const res = await get(`/api/words/sources/${source.id}`, a);
    expect(res.status).toBe(200);
    expect(res.body.reading).toBe("the machine heard me right at noon");
    expect(res.body.source.capturedVia).toBe("typed");
    // The reading's class reflects the correction (machine -> corrected).
    expect(res.body.source.citationClass).toBe("transcript_corrected");
    expect(res.body.corrections).toHaveLength(1);
    expect(res.body.corrections[0]).toMatchObject({
      startOffset: wrongAt,
      endOffset: wrongAt + 5,
      correctedText: "right",
    });
    // Labels only, origin links only — support/derived_from never surface.
    expect(res.body.derivedNodes).toEqual([{ nodeId: originNode, label: "Derived memory label" }]);
  });

  it("404s a source from another space, and a missing one; 400s a non-integer id", async () => {
    const a = freshSpace();
    const b = freshSpace();
    const { source } = repo(a).persistText({ kind: "note", citationClass: "verbatim_typed", text: "private words" });
    expect((await get(`/api/words/sources/${source.id}`, b)).status).toBe(404);
    expect((await get(`/api/words/sources/999999`, a)).status).toBe(404);
    expect((await get(`/api/words/sources/abc`, a)).status).toBe(400);
  });
});

describe("GET /api/words/search", () => {
  it("reports the hash-fallback degradation honestly (fts_only, degraded) and slices excerpts from the reading", async () => {
    const a = freshSpace();
    const b = freshSpace();
    const mine = repo(a).persistText({
      kind: "note",
      citationClass: "verbatim_typed",
      text: "quixotic apples ferment quietly",
    }).source;
    repo(b).persistText({ kind: "note", citationClass: "verbatim_typed", text: "quixotic oranges ferment loudly" });

    const res = await get("/api/words/search?q=quixotic", a);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("fts_only");
    expect(res.body.degraded).toBe(true);
    expect(typeof res.body.vecLag).toBe("boolean");
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({
      sourceId: mine.id,
      citationClass: "verbatim_typed",
      channel: "typed",
    });
    expect(res.body.results[0].excerpt).toContain("quixotic apples ferment quietly");

    // The other space's matching source never leaks into the results.
    const resB = await get("/api/words/search?q=quixotic", b);
    expect(resB.body.results.map((r: any) => r.sourceId)).not.toContain(mine.id);
    expect(resB.body.results[0].excerpt).toContain("oranges");
  });

  it("applies the local-day date range to the source's instant, and rejects an empty query", async () => {
    const a = freshSpace();
    repo(a).persistText({
      kind: "note",
      citationClass: "verbatim_typed",
      text: "a zeppelin drifted over the harbour",
      occurredAt: "2026-10-15T12:00:00.000Z",
    });
    const inside = await get("/api/words/search?q=zeppelin&from=2026-10-14&to=2026-10-16", a);
    expect(inside.body.results).toHaveLength(1);
    const outside = await get("/api/words/search?q=zeppelin&from=2026-10-16&to=2026-10-17", a);
    expect(outside.body.results).toHaveLength(0);
    expect((await get("/api/words/search?q=", a)).status).toBe(400);
    expect((await get("/api/words/search", a)).status).toBe(400);
  });
});

describe("re-review D1 — conflict markers stay off the plain-text surfaces", () => {
  it("strips ⟦conflict⟧ markers from list previews and search excerpts; the detail reading keeps them for the Source view", async () => {
    const a = freshSpace();
    const ra = repo(a);
    const original = "alpha bravo charlie echo zanzibar";
    const { source } = ra.persistText({ kind: "voice", citationClass: "transcript_machine", text: original });
    const span = (sub: string) => {
      const s = original.indexOf(sub);
      return { startOffset: s, endOffset: s + sub.length };
    };
    ra.addCorrection({ sourceId: source.id, ...span("bravo charlie"), correctedText: "BRAVO CHARLIE-TWO" });
    ra.addCorrection({ sourceId: source.id, ...span("charlie"), correctedText: "CHARLIE-TWO" });

    // The seed really produced a conflicted reading — the detail route
    // serves the markers because the Source view renders them on purpose.
    const detail = await get(`/api/words/sources/${source.id}`, a);
    expect(detail.status).toBe(200);
    expect(detail.body.reading).toContain("⟦conflict⟧");

    // But no plain-text surface (list previews, search excerpts) carries
    // the internal markup.
    const list = await get("/api/words/sources", a);
    const row = list.body.sources.find((s: { id: number }) => s.id === source.id);
    expect(row).toBeDefined();
    expect(row.preview).not.toContain("⟦conflict⟧");
    expect(row.preview).not.toContain("⟦/conflict⟧");

    const search = await get("/api/words/search?q=zanzibar", a);
    expect(search.body.results.length).toBeGreaterThan(0);
    for (const hit of search.body.results) {
      expect(hit.excerpt).not.toContain("⟦conflict⟧");
      expect(hit.excerpt).not.toContain("⟦/conflict⟧");
    }
  });
});

describe("re-review D2 — channel taxonomy edge cell (telegram × imported_text)", () => {
  it("counts and filters the source as telegram only: JS derivation and SQL predicate agree", async () => {
    const a = freshSpace();
    const ra = repo(a);
    const { source } = ra.persistText({ kind: "telegram", citationClass: "imported_text", text: "edge cell words" });

    const overview = await get("/api/words/overview", a);
    expect(overview.body.byChannel.telegram).toBe(1);
    expect(overview.body.byChannel.imported).toBe(0);

    const imported = await get("/api/words/sources?channel=imported", a);
    expect(imported.body.sources.map((s: { id: number }) => s.id)).not.toContain(source.id);
    const telegram = await get("/api/words/sources?channel=telegram", a);
    expect(telegram.body.sources.map((s: { id: number }) => s.id)).toContain(source.id);
  });
});
