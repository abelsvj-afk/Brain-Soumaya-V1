import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createDb,
  type DbHandle,
} from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM, upsertSourceChunkEmbedding } from "../db/vec.js";
import type { EmbeddingProvider } from "../embeddings/adapter.js";
import type { AppContext } from "../context.js";
import type { ToolContext } from "../agent/tools/types.js";
import {
  SourcesRepo,
  searchSourceChunks,
  CONFLICT_OPEN,
  CONFLICT_CLOSE,
} from "../repositories/sources.repo.js";
import { localDayBoundsForDate } from "../lib/time.js";
import { searchMyWordsTool } from "../agent/tools/searchMyWords.js";
import { AGENT_TOOLS, TOOLS } from "../agent/tools/registry.js";
import { validateArgs } from "../agent/tools/validation.js";
import {
  createForgetSourceRequest,
  approveForgetSourceRequest,
  forgetSourceByRequest,
} from "../sources/forgetSource.js";

/**
 * Verbatim-Recall V2 — `search_my_words` acceptance tests.
 * Criterion map (design note Rev 4, §7): T-V2-1 … T-V2-13.
 * Written before the implementation (fail-before), per the exit gate.
 */

const SPACE = "v2-space";
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
let handle: DbHandle;

beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => handle.sqlite.close());

/** A semantic-provider test double: real vectors (hash math underneath),
 *  but NOT the production fallback model — the D2 rule keys on the model
 *  name "hash-bow", which in production means "the real embedder failed
 *  to start", so a healthy-provider double must not carry it. */
class SemanticFakeProvider implements EmbeddingProvider {
  readonly dim = EMBED_DIM;
  readonly model = "test-semantic";
  private inner = new HashEmbeddingProvider(EMBED_DIM);
  async embed(text: string): Promise<Float32Array> {
    return this.inner.embed(text);
  }
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return this.inner.embedBatch(texts);
  }
}

class ThrowingProvider implements EmbeddingProvider {
  readonly dim = EMBED_DIM;
  readonly model = "test-throwing";
  async embed(): Promise<Float32Array> {
    throw new Error("embedder unavailable");
  }
  async embedBatch(): Promise<Float32Array[]> {
    throw new Error("embedder unavailable");
  }
}

const semantic = new SemanticFakeProvider();
const hashProvider = new HashEmbeddingProvider(EMBED_DIM);

function makeTc(spaceId: string, embeddings: EmbeddingProvider): ToolContext {
  const ctx: AppContext = {
    handle,
    embeddings,
    llm: new HeuristicProvider(),
    usage: undefined as never,
  };
  return { ctx, spaceId, now: NOW, notify: async () => {} };
}

interface V2Payload {
  excerpts: Array<Record<string, unknown>>;
  coverage: {
    totalSources: number;
    unchunkedSources: number;
    earliestSourceAt: string | null;
  };
  mode: string;
  degraded: boolean;
  vecLag: boolean;
}

async function runTool(
  tc: ToolContext,
  args: Record<string, unknown>,
): Promise<{ payload: V2Payload; message: string }> {
  const res = await searchMyWordsTool.run(tc, args);
  expect(res.ok).toBe(true);
  const message = res.message ?? "";
  return { payload: JSON.parse(message) as V2Payload, message };
}

function seedNode(label: string, spaceId: string, content: string): number {
  const r = handle.sqlite
    .prepare(`INSERT INTO nodes (space_id, label, type, content) VALUES (?, ?, 'memory', ?)`)
    .run(spaceId, label, content);
  return Number(r.lastInsertRowid);
}

function setSpaceTz(spaceId: string, tz: string): void {
  handle.sqlite
    .prepare(
      `INSERT INTO space_meta (space_id, timezone) VALUES (?, ?)
       ON CONFLICT(space_id) DO UPDATE SET timezone = excluded.timezone`,
    )
    .run(spaceId, tz);
}

// ---------------------------------------------------------------------------
// T-V2-1 — §31 citation pointing
// ---------------------------------------------------------------------------

describe("T-V2-1 citation pointing", () => {
  it("a hit in chunk N cites chunk N's ordinal + offsets; a source-scope link is labeled provenance, never the citation", async () => {
    const repo = new SourcesRepo(handle, SPACE);
    const head = "a".repeat(1000);
    const middle = " needleword " + "b".repeat(988);
    const tail = "c".repeat(500);
    const text = head + middle + tail;
    const { source } = repo.persistText({
      kind: "note",
      citationClass: "verbatim_typed",
      text,
      title: "Three chunk note",
    });
    const nodeId = seedNode("provenance node", SPACE, "node body, not his words");
    repo.linkNode({ nodeId, sourceId: source.id }); // source-scope (no chunk)

    const { payload } = await runTool(makeTc(SPACE, semantic), { query: "needleword" });
    expect(payload.excerpts.length).toBe(1);
    const ex = payload.excerpts[0]!;
    expect(ex.chunkOrdinal).toBe(1);
    expect(ex.startOffset).toBe(1000);
    expect(ex.endOffset).toBe(2000);
    expect(ex.text).toBe(text.slice(1000, 2000));
    expect(ex.quotable).toBe(true);
    const links = ex.linkedNodes as Array<{ id: number; label: string; linkScope: string }>;
    expect(links).toEqual([{ id: nodeId, label: "provenance node", linkScope: "source" }]);
  });
});

// ---------------------------------------------------------------------------
// T-V2-2 — RRF regression at the tool
// ---------------------------------------------------------------------------

describe("T-V2-2 RRF at the tool", () => {
  it("a chunk findable only by meaning appears; mode reports the vector contribution", async () => {
    const repo = new SourcesRepo(handle, SPACE);
    const target = repo.persistText({
      kind: "note",
      citationClass: "verbatim_typed",
      text: "quiet harbor logistics",
    }).source;
    const chunk = repo.chunksOf(target.id)[0]!;
    const queryVec = await semantic.embed("maritime freight scheduling");
    upsertSourceChunkEmbedding(handle.sqlite, chunk.id, queryVec);

    const { payload } = await runTool(makeTc(SPACE, semantic), {
      query: "maritime freight scheduling",
    });
    expect(payload.excerpts.map((e) => e.text)).toContain("quiet harbor logistics");
    expect(payload.mode).toBe("vec_only");
    expect(payload.degraded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T-V2-3 — filter-before-LIMIT at the tool (repo halves: verbatimV2Repo)
// ---------------------------------------------------------------------------

describe("T-V2-3 filter-before-LIMIT", () => {
  it("tool: k=2 with the top hits outside the range returns the two in-range hits", async () => {
    const repo = new SourcesRepo(handle, SPACE);
    repo.persistText({
      kind: "note", citationClass: "verbatim_typed", title: "recent one",
      text: "meridian meridian meridian meridian meridian report",
      occurredAt: "2026-09-15T12:00:00.000Z",
    });
    repo.persistText({
      kind: "note", citationClass: "verbatim_typed", title: "recent two",
      text: "meridian meridian meridian meridian meridian bulletin",
      occurredAt: "2026-09-16T12:00:00.000Z",
    });
    repo.persistText({
      kind: "note", citationClass: "verbatim_typed", title: "old one",
      text: "a long meridian reflection written at leisure with many other words around it",
      occurredAt: "2026-06-10T12:00:00.000Z",
    });
    repo.persistText({
      kind: "note", citationClass: "verbatim_typed", title: "old two",
      text: "another lengthy meridian meditation full of unrelated surrounding prose here",
      occurredAt: "2026-06-20T12:00:00.000Z",
    });

    const { payload } = await runTool(makeTc(SPACE, semantic), {
      query: "meridian",
      k: 2,
      date_range: { from: "2026-06-01", to: "2026-06-30" },
    });
    expect(payload.excerpts.length).toBe(2);
    expect(payload.excerpts.map((e) => e.sourceTitle).sort()).toEqual(["old one", "old two"]);
  });
});

// ---------------------------------------------------------------------------
// T-V2-4 — mode honesty
// ---------------------------------------------------------------------------

describe("T-V2-4 mode honesty", () => {
  it("forced FTS-only, vector-only, and fused runs each report their true mode", async () => {
    const repo = new SourcesRepo(handle, SPACE);
    const plain = repo.persistText({
      kind: "note", citationClass: "verbatim_typed", text: "plainword passage",
    }).source;

    const ftsOnly = await runTool(makeTc(SPACE, semantic), { query: "plainword" });
    expect(ftsOnly.payload.mode).toBe("fts_only");
    expect(ftsOnly.payload.excerpts.length).toBe(1);

    // Vector-only: plant the plain chunk's vector at a term-free query.
    const plainChunk = repo.chunksOf(plain.id)[0]!;
    upsertSourceChunkEmbedding(
      handle.sqlite, plainChunk.id, await semantic.embed("termfree semantic probe"),
    );
    const vecOnly = await runTool(makeTc(SPACE, semantic), {
      query: "termfree semantic probe",
    });
    expect(vecOnly.payload.mode).toBe("vec_only");
    expect(vecOnly.payload.excerpts.length).toBe(1);

    // Fused: the query term is in the text AND the chunk's vector is the query's.
    const fusedChunk = repo.persistText({
      kind: "note", citationClass: "verbatim_typed", text: "sharedword harbor",
    }).source;
    const fc = repo.chunksOf(fusedChunk.id)[0]!;
    upsertSourceChunkEmbedding(handle.sqlite, fc.id, await semantic.embed("sharedword"));
    const fused = await runTool(makeTc(SPACE, semantic), { query: "sharedword" });
    expect(fused.payload.mode).toBe("fts+vec");
    expect(fused.payload.degraded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T-V2-5 — degradation (throwing embedder + D2 hash-bow rule)
// ---------------------------------------------------------------------------

describe("T-V2-5 degradation", () => {
  it("a throwing embedder still answers FTS-only with degraded: true", async () => {
    const repo = new SourcesRepo(handle, SPACE);
    repo.persistText({
      kind: "note", citationClass: "verbatim_typed", text: "fallbackword passage",
    });
    const { payload } = await runTool(makeTc(SPACE, new ThrowingProvider()), {
      query: "fallbackword",
    });
    expect(payload.excerpts.length).toBe(1);
    expect(payload.degraded).toBe(true);
    expect(payload.mode).toBe("fts_only");
  });

  it("D2: the hash-bow fallback model is treated as degraded — its vectors are withheld", async () => {
    const repo = new SourcesRepo(handle, SPACE);
    const vecOnlySource = repo.persistText({
      kind: "note", citationClass: "verbatim_typed", text: "vectoronly zqx chunk",
    }).source;
    const c = repo.chunksOf(vecOnlySource.id)[0]!;
    upsertSourceChunkEmbedding(handle.sqlite, c.id, await hashProvider.embed("unfindable query"));

    const { payload } = await runTool(makeTc(SPACE, hashProvider), {
      query: "unfindable query",
    });
    // Without the D2 rule this run would silently report hash-derived
    // semantic hits. With it: FTS-only, degraded, and the vec-only chunk absent.
    expect(payload.degraded).toBe(true);
    expect(payload.mode).toBe("fts_only");
    expect(payload.excerpts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T-V2-6 — two-space isolation, including under every filter
// ---------------------------------------------------------------------------

describe("T-V2-6 two-space isolation under filters", () => {
  const A = "iso-a";
  const B = "iso-b";
  function plant() {
    const repoA = new SourcesRepo(handle, A);
    const repoB = new SourcesRepo(handle, B);
    repoA.persistText({
      kind: "note", citationClass: "verbatim_typed", title: "Alpha record",
      text: "identical twin passage zanzibar", speaker: "owner",
      occurredAt: "2026-06-10T12:00:00.000Z",
    });
    repoB.persistText({
      kind: "telegram", citationClass: "verbatim_typed", title: "Beta record",
      text: "identical twin passage zanzibar", speaker: "guest",
      occurredAt: "2026-07-10T12:00:00.000Z",
    });
  }

  it("no filter combination crosses the space boundary", async () => {
    plant();
    const tc = makeTc(A, semantic);

    const plain = await runTool(tc, { query: "zanzibar" });
    expect(plain.payload.excerpts.length).toBe(1);
    expect(plain.payload.excerpts[0]!.sourceTitle).toBe("Alpha record");

    const wrongKind = await runTool(tc, { query: "zanzibar", kind: "telegram" });
    expect(wrongKind.payload.excerpts).toEqual([]);

    const rightKind = await runTool(tc, { query: "zanzibar", kind: "note" });
    expect(rightKind.payload.excerpts.map((e) => e.sourceTitle)).toEqual(["Alpha record"]);

    const wrongMonth = await runTool(tc, {
      query: "zanzibar",
      date_range: { from: "2026-07-01", to: "2026-07-31" },
    });
    expect(wrongMonth.payload.excerpts).toEqual([]);

    const rightMonth = await runTool(tc, {
      query: "zanzibar",
      date_range: { from: "2026-06-01", to: "2026-06-30" },
    });
    expect(rightMonth.payload.excerpts.map((e) => e.sourceTitle)).toEqual(["Alpha record"]);

    const wrongSpeaker = await runTool(tc, { query: "zanzibar", speaker: "guest" });
    expect(wrongSpeaker.payload.excerpts).toEqual([]);

    const phrase = await runTool(tc, {
      query: "identical twin passage",
      exact_phrase: true,
    });
    expect(phrase.payload.excerpts.map((e) => e.sourceTitle)).toEqual(["Alpha record"]);
  });
});

// ---------------------------------------------------------------------------
// T-V2-7 — legacy honesty + coverage accuracy
// ---------------------------------------------------------------------------

describe("T-V2-7 legacy honesty + coverage", () => {
  it("a space with legacy nodes and no sources: zero excerpts, truthful coverage, no node content anywhere in the output", async () => {
    seedNode("legacy label", SPACE, "LEGACYSECRET node content string");
    const { payload, message } = await runTool(makeTc(SPACE, semantic), {
      query: "LEGACYSECRET",
    });
    expect(payload.excerpts).toEqual([]);
    expect(payload.coverage.totalSources).toBe(0);
    expect(payload.coverage.unchunkedSources).toBe(0);
    expect(payload.coverage.earliestSourceAt).toBeNull();
    expect(message).not.toContain("LEGACYSECRET");
  });

  it("coverage is computed over the whole sources table, never from search results", async () => {
    const repo = new SourcesRepo(handle, SPACE);
    repo.persistText({
      kind: "note", citationClass: "verbatim_typed", text: "qqqwww unfindable chunk one",
      occurredAt: "2026-05-01T09:00:00.000Z",
    });
    repo.persistText({
      kind: "note", citationClass: "verbatim_typed", text: "eeerrr unfindable chunk two",
      occurredAt: "2026-04-01T09:00:00.000Z",
    });
    repo.persist({
      kind: "document", citationClass: "imported_text",
      rawBytes: Buffer.from([0x89, 0x50, 0xff, 0x00]),
    });
    const { payload } = await runTool(makeTc(SPACE, semantic), { query: "zzzz nothing" });
    expect(payload.excerpts).toEqual([]);
    expect(payload.coverage.totalSources).toBe(2);
    expect(payload.coverage.unchunkedSources).toBe(1);
    expect(payload.coverage.earliestSourceAt).toBe("2026-04-01T09:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// T-V2-8 — corrections (incl. R2 boundary cases + §2.1 attribution assertions)
// ---------------------------------------------------------------------------

describe("T-V2-8 corrections", () => {
  it("a corrected source quotes the reading text with the corrected class and corrected: true", async () => {
    const repo = new SourcesRepo(handle, SPACE);
    const { source } = repo.persistText({
      kind: "voice", citationClass: "transcript_machine", text: "hello world",
    });
    repo.addCorrection({ sourceId: source.id, startOffset: 6, endOffset: 11, correctedText: "there" });

    const { payload } = await runTool(makeTc(SPACE, semantic), { query: "hello" });
    expect(payload.excerpts.length).toBe(1);
    const ex = payload.excerpts[0]!;
    expect(ex.text).toBe("hello there");
    expect(ex.corrected).toBe(true);
    expect(ex.conflicted).toBe(false);
    expect(ex.citationClass).toBe("transcript_corrected");
    expect(ex.originalCitationClass).toBe("transcript_machine");
    expect(ex.citationClassLabel).toBe("transcript you corrected");
  });

  it("a conflicted passage quotes the later-seq text with markers and conflicted: true", async () => {
    const repo = new SourcesRepo(handle, SPACE);
    const { source } = repo.persistText({
      kind: "voice", citationClass: "transcript_machine", text: "0123456789ABCDEF",
    });
    repo.addCorrection({ sourceId: source.id, startOffset: 2, endOffset: 6, correctedText: "XX" });
    repo.addCorrection({ sourceId: source.id, startOffset: 4, endOffset: 10, correctedText: "YYY" });

    const { payload } = await runTool(makeTc(SPACE, semantic), { query: "0123456789ABCDEF" });
    expect(payload.excerpts.length).toBe(1);
    const ex = payload.excerpts[0]!;
    expect(ex.text).toBe(`01X${CONFLICT_OPEN}YYY${CONFLICT_CLOSE}ABCDEF`);
    expect(ex.conflicted).toBe(true);
    expect(ex.corrected).toBe(true);
  });

  it("an untouched span's excerpt equals the raw substring at its offsets exactly", async () => {
    const repo = new SourcesRepo(handle, SPACE);
    const text = "firstpart " + "m".repeat(990) + "secondpart " + "n".repeat(90);
    const { source } = repo.persistText({
      kind: "note", citationClass: "verbatim_typed", text,
    });
    // Correction lands entirely inside chunk 0; chunk 1 stays untouched.
    repo.addCorrection({ sourceId: source.id, startOffset: 0, endOffset: 4, correctedText: "1st!" });

    const { payload } = await runTool(makeTc(SPACE, semantic), { query: "secondpart" });
    expect(payload.excerpts.length).toBe(1);
    const ex = payload.excerpts[0]!;
    expect(ex.chunkOrdinal).toBe(1);
    // Chunk 1 spans [1000, 1101) — the whole remainder of the text.
    expect(ex.text).toBe(text.slice(1000));
    expect(ex.corrected).toBe(false);
  });

  it("R2: a boundary-crossing correction shows each chunk only its own anchored portion (slice mechanics: verbatimV2Repo)", async () => {
    const repo = new SourcesRepo(handle, SPACE);
    const text = "startword " + "x".repeat(990) + "y".repeat(400) + " endword";
    const { source } = repo.persistText({
      kind: "note", citationClass: "verbatim_typed", text,
    });
    repo.addCorrection({
      sourceId: source.id, startOffset: 990, endOffset: 1010,
      correctedText: "0123456789ABCDEFGHIJ",
    });
    const { payload } = await runTool(makeTc(SPACE, semantic), { query: "endword" });
    const ex = payload.excerpts.find((e) => e.chunkOrdinal === 1)!;
    expect(ex.text).toBe("ABCDEFGHIJ" + "y".repeat(390) + " endword");
    expect(ex.corrected).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T-V2-9 — date windows in both timezones + DST
// ---------------------------------------------------------------------------

describe("T-V2-9 date windows, both timezones, DST", () => {
  it("the spring-forward day in New York spans 23 hours of stored time", () => {
    const { startMs, endMs } = localDayBoundsForDate("2026-03-08", "America/New_York");
    expect(endMs - startMs).toBe(23 * 3600_000);
  });

  it("sources near local midnight land on the right side of the window in each zone", async () => {
    const ny = "tz-ny-space";
    setSpaceTz(ny, "America/New_York");
    const repoNy = new SourcesRepo(handle, ny);
    repoNy.persistText({
      kind: "note", citationClass: "verbatim_typed", text: "dstprobe alpha",
      occurredAt: "2026-03-08T06:30:00.000Z", // 01:30 EST on spring-forward day
    });
    repoNy.persistText({
      kind: "note", citationClass: "verbatim_typed", text: "dstprobe beta",
      occurredAt: "2026-03-09T04:30:00.000Z", // 00:30 EDT on Mar 9
    });
    const day8 = await runTool(makeTc(ny, semantic), {
      query: "dstprobe",
      date_range: { from: "2026-03-08", to: "2026-03-08" },
    });
    expect(day8.payload.excerpts.map((e) => e.text)).toEqual(["dstprobe alpha"]);
    const day9 = await runTool(makeTc(ny, semantic), {
      query: "dstprobe",
      date_range: { from: "2026-03-09", to: "2026-03-09" },
    });
    expect(day9.payload.excerpts.map((e) => e.text)).toEqual(["dstprobe beta"]);

    const ki = "tz-ki-space";
    setSpaceTz(ki, "Pacific/Kiritimati");
    const repoKi = new SourcesRepo(handle, ki);
    repoKi.persistText({
      kind: "note", citationClass: "verbatim_typed", text: "kiteprobe passage",
      occurredAt: "2026-06-15T10:30:00.000Z", // Jun 16 00:30 in Kiritimati (+14)
    });
    const ki15 = await runTool(makeTc(ki, semantic), {
      query: "kiteprobe",
      date_range: { from: "2026-06-15", to: "2026-06-15" },
    });
    expect(ki15.payload.excerpts).toEqual([]);
    const ki16 = await runTool(makeTc(ki, semantic), {
      query: "kiteprobe",
      date_range: { from: "2026-06-16", to: "2026-06-16" },
    });
    expect(ki16.payload.excerpts.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// T-V2-10 — kind / speaker filters
// ---------------------------------------------------------------------------

describe("T-V2-10 kind/speaker filters", () => {
  it("filters return only matching kinds and speakers, and compose", async () => {
    const repo = new SourcesRepo(handle, SPACE);
    const plant = (kind: string, speaker: string, word: string, title: string) =>
      repo.persistText({
        kind, citationClass: "verbatim_typed", title,
        text: `kindprobe shared ${word}`, speaker,
      });
    plant("note", "owner", "one", "S1");
    plant("telegram", "owner", "two", "S2");
    plant("document", "guest", "three", "S3");
    plant("note", "guest", "four", "S4");

    const tc = makeTc(SPACE, semantic);
    const byKind = await runTool(tc, { query: "kindprobe", kind: "telegram" });
    expect(byKind.payload.excerpts.map((e) => e.sourceTitle)).toEqual(["S2"]);

    const bySpeaker = await runTool(tc, { query: "kindprobe", speaker: "guest" });
    expect(bySpeaker.payload.excerpts.map((e) => e.sourceTitle).sort()).toEqual(["S3", "S4"]);

    const both = await runTool(tc, { query: "kindprobe", kind: "note", speaker: "guest" });
    expect(both.payload.excerpts.map((e) => e.sourceTitle)).toEqual(["S4"]);
  });
});

// ---------------------------------------------------------------------------
// T-V2-11 — exact-phrase purity
// ---------------------------------------------------------------------------

describe("T-V2-11 exact-phrase purity", () => {
  it("a miss stays a miss: non-adjacent words yield zero excerpts even though fused search hits", async () => {
    const repo = new SourcesRepo(handle, SPACE);
    const { source } = repo.persistText({
      kind: "note", citationClass: "verbatim_typed",
      text: "the liquidation committee discussed risk management at length",
    });
    const chunk = repo.chunksOf(source.id)[0]!;
    const queryVec = await semantic.embed("liquidation risk");
    upsertSourceChunkEmbedding(handle.sqlite, chunk.id, queryVec);

    // The fused primitive over the same query DOES return the chunk.
    const fused = searchSourceChunks(repo, "liquidation risk", { queryVec });
    expect(fused.hits.length).toBeGreaterThan(0);

    const { payload } = await runTool(makeTc(SPACE, semantic), {
      query: "liquidation risk",
      exact_phrase: true,
    });
    expect(payload.excerpts).toEqual([]);
    expect(payload.mode).toBe("fts_only");
  });
});

// ---------------------------------------------------------------------------
// T-V2-12 — labels are never quotable
// ---------------------------------------------------------------------------

describe("T-V2-12 labels never quotable", () => {
  it("a linked node's label appears only under linkedNodes; quotable:true fields are exactly the excerpts", async () => {
    const repo = new SourcesRepo(handle, SPACE);
    const { source } = repo.persistText({
      kind: "note", citationClass: "verbatim_typed",
      text: "quotable passage about anchors",
    });
    const chunk = repo.chunksOf(source.id)[0]!;
    const nodeId = seedNode("ZQXWLABEL distinctive", SPACE, "node body words ZQXWBODY");
    repo.linkNode({ nodeId, sourceId: source.id, chunkId: chunk.id });

    const { payload, message } = await runTool(makeTc(SPACE, semantic), { query: "anchors" });
    expect(payload.excerpts.length).toBe(1);
    const ex = payload.excerpts[0]!;
    const links = ex.linkedNodes as Array<{ label: string; linkScope: string }>;
    expect(links).toEqual([
      { id: nodeId, label: "ZQXWLABEL distinctive", linkScope: "chunk" },
    ]);
    expect(ex.text).not.toContain("ZQXWLABEL");
    expect(message).not.toContain("ZQXWBODY");
    // Exactly one quotable:true in the whole payload — the excerpt itself.
    expect(message.match(/"quotable":true/g)?.length).toBe(payload.excerpts.length);
    expect(ex.quotable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T-V2-13 — eligibility and coverage honor forget (R1)
// ---------------------------------------------------------------------------

describe("T-V2-13 eligibility honors forget", () => {
  function approvedForgetRequest(spaceId: string, sourceId: number): number {
    const created = createForgetSourceRequest(handle, spaceId, sourceId);
    expect(created.status).toBe("pending");
    const approved = approveForgetSourceRequest(handle, spaceId, created.requestId);
    expect(approved.status).toBe("approved");
    return approved.requestId;
  }

  it("a forgotten source vanishes from search and coverage; a failed-extraction source stays searchable", async () => {
    const repo = new SourcesRepo(handle, SPACE);
    const early = repo.persistText({
      kind: "note", citationClass: "verbatim_typed", text: "forgetmenot early passage",
      occurredAt: "2026-06-01T10:00:00.000Z",
    }).source;
    const mid = repo.persistText({
      kind: "note", citationClass: "verbatim_typed", text: "persevering middle passage",
      occurredAt: "2026-06-10T10:00:00.000Z",
    }).source;
    repo.persistText({
      kind: "note", citationClass: "verbatim_typed", text: "later surviving passage",
      occurredAt: "2026-06-20T10:00:00.000Z",
    });
    repo.persist({
      kind: "document", citationClass: "imported_text",
      rawBytes: Buffer.from([0x89, 0x50, 0xff, 0x00]),
    });
    // Drive the middle source to extraction_failed through the real
    // state machine — processing status must not gate eligibility.
    const claimed = repo.claim(mid.id, "t13-worker");
    expect(claimed).not.toBeNull();
    expect(repo.failExtraction(mid.id, "t13-worker")).toBe("extraction_failed");

    const tc = makeTc(SPACE, semantic);
    const before = await runTool(tc, { query: "unrelatedprobe" });
    expect(before.payload.coverage.totalSources).toBe(3);
    expect(before.payload.coverage.unchunkedSources).toBe(1);
    expect(before.payload.coverage.earliestSourceAt).toBe("2026-06-01T10:00:00.000Z");

    forgetSourceByRequest(handle, approvedForgetRequest(SPACE, early.id));

    const gone = await runTool(tc, { query: "forgetmenot" });
    expect(gone.payload.excerpts).toEqual([]);
    const goneFiltered = await runTool(tc, {
      query: "forgetmenot",
      kind: "note",
      date_range: { from: "2026-06-01", to: "2026-06-30" },
    });
    expect(goneFiltered.payload.excerpts).toEqual([]);

    const after = await runTool(tc, { query: "unrelatedprobe" });
    expect(after.payload.coverage.totalSources).toBe(2);
    expect(after.payload.coverage.unchunkedSources).toBe(1);
    expect(after.payload.coverage.earliestSourceAt).toBe("2026-06-10T10:00:00.000Z");

    const stillThere = await runTool(tc, { query: "persevering" });
    expect(stillThere.payload.excerpts.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// K5 — registry + validation surface
// ---------------------------------------------------------------------------

describe("K5 registry + validation", () => {
  it("search_my_words is registered as a read tool in both lists", () => {
    expect(TOOLS.map((t) => t.name)).toContain("search_my_words");
    const entry = AGENT_TOOLS.find((e) => e.tool.name === "search_my_words");
    expect(entry).toBeDefined();
    expect(entry!.isWrite).toBe(false);
    expect(searchMyWordsTool.detect(makeTc(SPACE, semantic))).toEqual([]);
  });

  it("the argument schema accepts the §1 inputs and rejects the rest", () => {
    expect(validateArgs(searchMyWordsTool, { query: "hello" }).ok).toBe(true);
    expect(
      validateArgs(searchMyWordsTool, {
        query: "hello",
        date_range: { from: "2026-06-01", to: "2026-06-30" },
        kind: "note",
        speaker: "owner",
        exact_phrase: true,
        k: 10,
      }).ok,
    ).toBe(true);
    expect(validateArgs(searchMyWordsTool, {}).ok).toBe(false);
    expect(validateArgs(searchMyWordsTool, { query: "x", bogus: 1 }).ok).toBe(false);
    expect(validateArgs(searchMyWordsTool, { query: "x", k: 99 }).ok).toBe(false);
  });
});
