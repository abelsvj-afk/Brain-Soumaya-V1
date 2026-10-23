import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { createDb, bootstrapSchema, migrateSchema, type DbHandle } from "../db/client.js";
import { BOOTSTRAP_SQL } from "../db/schemaSql.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { EMBED_DIM } from "../db/vec.js";
import { upsertSourceChunkEmbedding } from "../db/vec.js";
import {
  SourcesRepo,
  chunkExact,
  searchSourceChunks,
  CONFLICT_OPEN,
} from "../repositories/sources.repo.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { GraphExportRepo } from "../repositories/graphExport.repo.js";
import { SpacesRepo, SPACE_SCOPED_TABLES } from "../auth/spaces.js";
import { forgetSourceByRequest, containsVerbatimSpan } from "../sources/forgetSource.js";
import { backfillChunkVec } from "../sources/recovery.js";

/**
 * Verbatim-Recall V1 — storage-layer acceptance tests.
 * Criterion map (design note Rev 1-3):
 *   14.1 exact preservation (repo level) · 14.5 correction integrity ·
 *   14.6 adversarial isolation · 14.7 offline FTS retrieval ·
 *   14.10 forget cascade · 18.4.1 bootstrap/migration agreement ·
 *   18.4.2 space erasure · 18.5.11 dependency-aware erasure + sweep ·
 *   18.5.12 byte fidelity / binary · 18.5.13 correction determinism ·
 *   18.5.15 export/restore round-trip · legacy-DB migration rehearsal.
 */

const SPACE = "legacy";
let handle: DbHandle;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => handle.sqlite.close());

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

function approvedForgetRequest(spaceId: string): number {
  const info = handle.sqlite
    .prepare(`INSERT INTO forget_requests (space_id, requested_by, status) VALUES (?, 'user', 'approved')`)
    .run(spaceId);
  return Number(info.lastInsertRowid);
}

describe("14.1 exact preservation (repo level)", () => {
  it("preserves awkward whitespace, CRLF, tabs and emoji byte-for-byte; chunks are an exact partition", () => {
    const text = "  leading\r\n\r\n  tabbed\there 😀 emoji\n\ntrailing spaces  \n";
    const repo = new SourcesRepo(handle, SPACE);
    const { source, created } = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text });
    expect(created).toBe(true);
    expect(source.rawText).toBe(text);
    expect(source.rawBytes.equals(Buffer.from(text, "utf8"))).toBe(true);
    expect(source.contentHash).toBe(sha(Buffer.from(text, "utf8")));
    expect(source.byteLength).toBe(Buffer.from(text, "utf8").length);
    expect(repo.verifyHash(source)).toBe(true);
    const chunks = repo.chunksOf(source.id);
    expect(chunks.map((c) => c.text).join("")).toBe(text);
    for (const c of chunks) {
      expect(text.slice(c.startOffset, c.endOffset)).toBe(c.text);
    }
  });

  it("chunkExact never normalizes: CRLF and blank-line runs survive", () => {
    const text = "a\r\n\r\n\r\nb".repeat(300);
    const parts = chunkExact(text, 100);
    expect(parts.map((p) => p.text).join("")).toBe(text);
    expect(parts[0]!.text).toContain("\r\n\r\n\r\n");
  });
});

describe("18.5.12 byte fidelity across transports + binary", () => {
  it("the same text submitted three ways produces one hash; non-UTF-8 bytes stay binary with a valid hash", () => {
    const text = "same words — every transport ✓";
    const repo = new SourcesRepo(handle, SPACE);
    const a = repo.persistText({ kind: "telegram", citationClass: "verbatim_typed", text }).source;
    const b = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text }).source;
    const c = repo.persistText({ kind: "document", citationClass: "imported_text", text }).source;
    expect(a.contentHash).toBe(b.contentHash);
    expect(b.contentHash).toBe(c.contentHash);
    expect(a.rawText).toBe(text);

    const raw = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x41]);
    const bin = repo.persist({ kind: "document", citationClass: "imported_text", rawBytes: raw }).source;
    expect(bin.encoding).toBe("binary");
    expect(bin.rawText).toBeNull();
    expect(bin.contentHash).toBe(sha(raw));
    expect(bin.byteLength).toBe(raw.length);
    expect(repo.verifyHash(bin)).toBe(true);
    expect(repo.chunksOf(bin.id)).toEqual([]);
  });
});

describe("14.5 / 18.5.13 corrections: deterministic replay, original untouched", () => {
  it("replays overlapping corrections in seq order, later wins, conflict marked, original intact", () => {
    const repo = new SourcesRepo(handle, SPACE);
    const original = "0123456789ABCDEF";
    const { source } = repo.persistText({ kind: "note", citationClass: "transcript_machine", text: original });
    const c1 = repo.addCorrection({ sourceId: source.id, startOffset: 2, endOffset: 6, correctedText: "XX", correctedBy: "user" });
    const c2 = repo.addCorrection({ sourceId: source.id, startOffset: 4, endOffset: 10, correctedText: "YYY", correctedBy: "user" });
    expect(c1.seq).toBe(1);
    expect(c2.seq).toBe(2);
    const reading = repo.currentReading(source.id)!;
    expect(reading.hasConflicts).toBe(true);
    expect(reading.text).toBe(`01X${CONFLICT_OPEN}YYY⟦/conflict⟧ABCDEF`);
    expect(reading.correctionsApplied).toBe(2);
    // Both classes labeled (12C): original machine transcript, reading corrected.
    expect(reading.originalCitationClass).toBe("transcript_machine");
    expect(reading.readingCitationClass).toBe("transcript_corrected");
    // The original is always retrievable untouched.
    expect(repo.getById(source.id)!.rawText).toBe(original);
  });

  it("a single non-overlapping correction renders the corrected reading with no conflict", () => {
    const repo = new SourcesRepo(handle, SPACE);
    const { source } = repo.persistText({ kind: "note", citationClass: "transcript_machine", text: "hello world" });
    repo.addCorrection({ sourceId: source.id, startOffset: 6, endOffset: 11, correctedText: "there" });
    const reading = repo.currentReading(source.id)!;
    expect(reading.text).toBe("hello there");
    expect(reading.hasConflicts).toBe(false);
    expect(repo.getById(source.id)!.rawText).toBe("hello world");
  });
});

describe("14.6 adversarial cross-space isolation", () => {
  it("a planted near-neighbor chunk in another space never surfaces via FTS, vector, or links", async () => {
    const repoA = new SourcesRepo(handle, "space-a");
    const repoB = new SourcesRepo(handle, "space-b");
    const plantText = "quixotic zebra liquidation protocol nine";
    const b = repoB.persistText({ kind: "note", citationClass: "verbatim_typed", text: plantText }).source;
    const a = repoA.persistText({ kind: "note", citationClass: "verbatim_typed", text: "quixotic zebra liquidation protocol" }).source;

    // FTS from A: only A's chunk (space filtered in WHERE before LIMIT).
    const fts = repoA.searchChunksFts("quixotic zebra liquidation protocol nine");
    expect(fts.every((h) => h.source.spaceId === "space-a")).toBe(true);
    expect(fts.map((h) => h.source.id)).not.toContain(b.id);

    // Vector: index B's chunk with the exact query vector — A's search
    // must still return nothing for B (join re-verification, 12B).
    const bChunk = repoB.chunksOf(b.id)[0]!;
    const vec = await embeddings.embed(plantText);
    upsertSourceChunkEmbedding(handle.sqlite, bChunk.id, vec);
    const vecHits = repoA.searchChunksVector(vec, 10);
    expect(vecHits).toEqual([]);

    // Links: A's nodes never resolve to B's source.
    expect(repoA.nodeIdsWithOriginFrom(b.id)).toEqual([]);
    expect(repoA.getById(b.id)).toBeUndefined();
    expect(a.id).not.toBe(b.id);
  });
});

describe("14.7 offline retrieval: FTS exact with announced degradation", () => {
  it("exact phrase and exact word retrieval work with no vector data; degradation + vec-lag signals present", async () => {
    const repo = new SourcesRepo(handle, SPACE);
    repo.persistText({
      kind: "note",
      citationClass: "verbatim_typed",
      text: "the liquidation risk meeting moved to Friday",
    });
    const phrase = searchSourceChunks(repo, "liquidation risk", { phrase: true });
    expect(phrase.hits.length).toBe(1);
    expect(phrase.degraded).toBe(true);
    expect(phrase.mode).toBe("fts_only");
    expect(phrase.vecLag).toBe(true); // chunks exist, none vec-indexed yet

    const word = searchSourceChunks(repo, "liquidation");
    expect(word.hits.length).toBe(1);

    // After boot backfill, the same search can fuse vectors.
    const indexed = await backfillChunkVec(handle, embeddings);
    expect(indexed).toBeGreaterThan(0);
    const fused = searchSourceChunks(repo, "liquidation", {
      queryVec: await embeddings.embed("liquidation"),
    });
    expect(fused.vecLag).toBe(false);
    expect(fused.mode).toBe("fts+vec");
    expect(fused.degraded).toBe(false);
  });
});

describe("18.4.1 bootstrap vs migration schema agreement", () => {
  const norm = (sql: string) => sql.replace(/\s+/g, " ").trim().toLowerCase();
  function ddlOf(sqlite: InstanceType<typeof BetterSqlite3>): Map<string, string> {
    const rows = sqlite
      .prepare(`SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL AND (name LIKE 'sources%' OR name LIKE 'source_%' OR name LIKE 'node_sources%' OR name LIKE 'idx_sources%' OR name LIKE 'idx_source_chunks%' OR name LIKE 'idx_node_sources%')`)
      .all() as { name: string; sql: string }[];
    return new Map(rows.map((r) => [r.name, norm(r.sql)]));
  }

  it("fresh bootstrap and legacy-shaped migration produce identical V1 schemas", () => {
    const fresh = new BetterSqlite3(":memory:");
    bootstrapSchema(fresh);
    const freshDdl = ddlOf(fresh);
    fresh.close();

    const legacy = new BetterSqlite3(":memory:");
    const marker = BOOTSTRAP_SQL.indexOf("-- === VERBATIM_RECALL_V1 ===");
    expect(marker).toBeGreaterThan(0);
    legacy.exec(BOOTSTRAP_SQL.slice(0, marker)); // the pre-V1 bootstrap, exactly
    expect(ddlOf(legacy).size).toBe(0); // no V1 objects yet
    migrateSchema(legacy);
    const migratedDdl = ddlOf(legacy);
    legacy.close();

    expect([...migratedDdl.keys()].sort()).toEqual([...freshDdl.keys()].sort());
    for (const [name, sql] of freshDdl) {
      expect(migratedDdl.get(name), `DDL mismatch for ${name}`).toBe(sql);
    }
    expect(freshDdl.has("sources")).toBe(true);
    expect(freshDdl.has("source_chunks")).toBe(true);
    expect(freshDdl.has("node_sources")).toBe(true);
    expect(freshDdl.has("source_corrections")).toBe(true);
    expect(freshDdl.has("sources_fts")).toBe(true);
  });

  it("registers all four tables in SPACE_SCOPED_TABLES", () => {
    for (const t of ["sources", "source_chunks", "node_sources", "source_corrections"]) {
      expect(SPACE_SCOPED_TABLES).toContain(t);
    }
  });
});

describe("18.4.2 space erasure removes sources + dependent FTS/vec rows", () => {
  it("deleteSpace wipes the space's sources, chunks, FTS and vec rows", async () => {
    const spaces = new SpacesRepo(handle);
    const { space } = spaces.authOrCreate("eraseme", "password123", "Erase Me")!;
    const repo = new SourcesRepo(handle, space.id);
    const { source } = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "erase all of this please" });
    const chunk = repo.chunksOf(source.id)[0]!;
    upsertSourceChunkEmbedding(handle.sqlite, chunk.id, await embeddings.embed("erase all of this please"));
    repo.markChunkVecIndexed(chunk.id);

    expect(spaces.deleteSpace(space.id, "password123", "eraseme")).toBe(true);
    const count = (t: string) =>
      (handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;
    expect(count("sources")).toBe(0);
    expect(count("source_chunks")).toBe(0);
    expect(count("sources_fts")).toBe(0);
    expect(count("vec_source_chunks")).toBe(0);
  });
});

describe("14.10 forget cascade + 18.5.11 dependency-aware erasure", () => {
  it("sole-origin node is erased with its source; other sources untouched", async () => {
    const repo = new SourcesRepo(handle, SPACE);
    const nodes = new NodesRepo(handle, SPACE);
    const doomed = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "forget this exact sentence" }).source;
    const keeper = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "keep this other sentence" }).source;
    const node = nodes.create({ label: "doomed", type: "daily", content: "forget this exact sentence" }, await embeddings.embed("x"));
    repo.linkNodeToAllChunks(node.id, doomed.id);

    const res = forgetSourceByRequest(handle, approvedForgetRequest(SPACE), doomed.id);
    expect(res.nodesErased).toContain(node.id);
    expect(repo.getById(doomed.id)).toBeUndefined();
    expect(repo.chunksOf(doomed.id)).toEqual([]);
    expect(repo.searchChunksFts("forget this exact")).toEqual([]);
    expect(nodes.getById(node.id)).toBeUndefined();
    expect(repo.getById(keeper.id)).toBeDefined();
  });

  it("shared node survives scrub-verified after the first source is forgotten, is erased after the second; unique-string sweep across the E2 inventory finds zero hits", async () => {
    const UNIQUE = "ZQXWUNIQUESTRING54321";
    const repo = new SourcesRepo(handle, SPACE);
    const nodes = new NodesRepo(handle, SPACE);
    const srcA = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: `alpha capture ${UNIQUE} alpha` }).source;
    const srcB = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "bravo capture with ordinary words" }).source;
    // Node distilled from BOTH captures; its content quotes neither verbatim.
    const node = nodes.create(
      { label: "shared", type: "daily", content: "a summary that quotes neither capture word for word" },
      await embeddings.embed("shared summary"),
    );
    repo.linkNodeToAllChunks(node.id, srcA.id);
    repo.linkNodeToAllChunks(node.id, srcB.id);
    repo.addCorrection({ sourceId: srcA.id, startOffset: 0, endOffset: 5, correctedText: `alpha ${UNIQUE}` });

    const first = forgetSourceByRequest(handle, approvedForgetRequest(SPACE), srcA.id);
    expect(first.nodesSurvivedClean).toContain(node.id);
    expect(nodes.getById(node.id)).toBeDefined();
    expect(repo.getById(srcA.id)).toBeUndefined();
    expect(repo.correctionsOf(srcA.id)).toEqual([]);

    // Sweep the full E2 text-bearing inventory for the unique string.
    const inventory = [
      "nodes", "episodes", "episode_enrichments", "insights", "daily_logs",
      "knowledge_docs", "knowledge_chunks", "lore", "working_memory",
      "agent_logs", "telegram_note_drafts", "attachments", "timeline_chapters",
      "inquiries", "consolidation_runs", "consolidation_episodes", "contradictions",
      "user_model", "user_persona", "instruction_profiles", "journeys",
      "sources", "source_chunks", "source_corrections", "node_sources",
      "sources_fts", "nodes_fts", "episodes_fts", "corrections", "tts_audio_cache",
    ];
    const existing = new Set(
      (handle.sqlite.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table','view')`).all() as { name: string }[]).map((r) => r.name),
    );
    for (const t of inventory) {
      if (!existing.has(t)) continue;
      const rows = handle.sqlite.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[];
      const blob = JSON.stringify(rows, (_k, v) => (Buffer.isBuffer(v) ? v.toString("utf8") : v));
      expect(blob.includes(UNIQUE), `unique string survived in ${t}`).toBe(false);
    }

    // Forgetting the second source leaves the node with no origin: erased.
    const second = forgetSourceByRequest(handle, approvedForgetRequest(SPACE), srcB.id);
    expect(second.nodesErased).toContain(node.id);
    expect(nodes.getById(node.id)).toBeUndefined();
  });

  it("a shared node whose content DOES quote the forgotten chunk is tombstoned, not kept", async () => {
    const repo = new SourcesRepo(handle, SPACE);
    const nodes = new NodesRepo(handle, SPACE);
    const srcA = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "a very distinctive forgotten sentence here" }).source;
    const srcB = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "an unrelated second capture" }).source;
    const node = nodes.create(
      { label: "quoting", type: "daily", content: "prefix a very distinctive forgotten sentence here suffix" },
      await embeddings.embed("quoting"),
    );
    repo.linkNodeToAllChunks(node.id, srcA.id);
    repo.linkNodeToAllChunks(node.id, srcB.id);
    const res = forgetSourceByRequest(handle, approvedForgetRequest(SPACE), srcA.id);
    expect(res.nodesTombstoned).toContain(node.id);
    const row = handle.sqlite.prepare(`SELECT content, deleted_at FROM nodes WHERE id = ?`).get(node.id) as { content: string; deleted_at: string | null };
    expect(row.content).not.toContain("distinctive forgotten");
    expect(row.deleted_at).not.toBeNull();
  });

  it("refuses without an approved user forget request (no second door)", () => {
    const repo = new SourcesRepo(handle, SPACE);
    const { source } = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "still here" });
    const pending = handle.sqlite
      .prepare(`INSERT INTO forget_requests (space_id, requested_by, status) VALUES (?, 'user', 'pending')`)
      .run(SPACE);
    expect(() => forgetSourceByRequest(handle, Number(pending.lastInsertRowid), source.id)).toThrow(/approved/);
    expect(repo.getById(source.id)).toBeDefined();
  });

  it("containsVerbatimSpan catches whole-chunk and windowed spans only", () => {
    expect(containsVerbatimSpan("xx a very distinctive forgotten sentence yy", ["a very distinctive forgotten sentence here"])).toBe(true);
    expect(containsVerbatimSpan("nothing alike at all", ["a very distinctive forgotten sentence here"])).toBe(false);
  });
});

describe("18.5.15 export -> wipe -> restore round-trip + pre-V1 exports", () => {
  it("restored sources pass the 14.1 byte checks; tampered exports abort; v1 exports still restore", async () => {
    const repo = new SourcesRepo(handle, SPACE);
    const nodes = new NodesRepo(handle, SPACE);
    const text = "round trip me — exact 😀\r\nwith lines";
    const { source } = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text });
    const node = nodes.create({ label: "rt", type: "daily", content: text }, await embeddings.embed(text));
    repo.linkNodeToAllChunks(node.id, source.id);
    repo.addCorrection({ sourceId: source.id, startOffset: 0, endOffset: 5, correctedText: "ROUND" });

    const exporter = new GraphExportRepo(handle, SPACE);
    const payload = exporter.exportGraph();
    expect(payload.version).toBe(2);
    expect(payload.sources?.length).toBe(1);

    // Wipe: a brand-new database is the restored brain.
    const handle2 = createDb(":memory:");
    try {
      const importer = new GraphExportRepo(handle2, SPACE);
      const report = importer.restoreGraph(JSON.parse(JSON.stringify(payload)));
      expect(report.hashMismatches).toEqual([]);
      expect(report.sourcesRestored).toBe(1);
      const repo2 = new SourcesRepo(handle2, SPACE);
      const restored = repo2.getById(source.id)!;
      expect(restored.rawText).toBe(text);
      expect(restored.contentHash).toBe(sha(Buffer.from(text, "utf8")));
      expect(repo2.verifyHash(restored)).toBe(true);
      expect(repo2.chunksOf(restored.id).map((c) => c.text).join("")).toBe(text);
      expect(repo2.currentReading(restored.id)!.text!.startsWith("ROUND")).toBe(true);
      expect(new NodesRepo(handle2, SPACE).getById(node.id)?.hasOriginSource).toBe(true);

      // Tampered payload: hash verification aborts, nothing is served.
      const tampered = JSON.parse(JSON.stringify(payload));
      tampered.sources[0].contentHash = "0".repeat(64);
      const handle3 = createDb(":memory:");
      try {
        expect(() => new GraphExportRepo(handle3, SPACE).restoreGraph(tampered)).toThrow(/content_hash mismatch/);
        expect(new SourcesRepo(handle3, SPACE).count()).toBe(0);
      } finally {
        handle3.sqlite.close();
      }

      // Pre-V1 export (no version, no sources) restores nodes only.
      const handle4 = createDb(":memory:");
      try {
        const v1 = {
          exportedAt: new Date().toISOString(),
          spaceId: SPACE,
          nodes: [{ id: 42, label: "legacy node", type: "daily", content: "old words", createdAt: new Date().toISOString() }],
          edges: [],
        };
        const rep = new GraphExportRepo(handle4, SPACE).restoreGraph(v1);
        expect(rep.nodesRestored).toBe(1);
        expect(rep.sourcesRestored).toBe(0);
      } finally {
        handle4.sqlite.close();
      }
    } finally {
      handle2.sqlite.close();
    }
  });
});

describe("legacy-DB migration rehearsal (ADR-019 manner)", () => {
  it("a pre-V1-shaped DB opens under the new code: seed rows unchanged, new capture works", async () => {
    // (file-backed createDb: schema migration + vec load; generous timeout)
    const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "verbatim-legacy-"));
    const file = nodePath.join(dir, "brain.db");
    try {
      // Build the legacy DB with the PRE-V1 bootstrap (V1 block stripped).
      const marker = BOOTSTRAP_SQL.indexOf("-- === VERBATIM_RECALL_V1 ===");
      const raw = new BetterSqlite3(file);
      raw.exec(BOOTSTRAP_SQL.slice(0, marker));
      raw.prepare(`INSERT INTO nodes (space_id, label, type, content) VALUES ('legacy', 'legacy memory', 'daily', 'seeded before V1 existed')`).run();
      raw.prepare(`INSERT INTO knowledge_docs (space_id, name, mime, char_count) VALUES ('legacy', 'seed.md', 'text/markdown', 12)`).run();
      raw.prepare(`INSERT INTO telegram_note_drafts (space_id, chat_id, text, part_count, created_at, updated_at) VALUES ('legacy', 7, 'draft words', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`).run();
      raw.close();

      const h2 = createDb(file);
      try {
        const nodeCount = (h2.sqlite.prepare(`SELECT COUNT(*) AS c FROM nodes`).get() as { c: number }).c;
        expect(nodeCount).toBe(1);
        const content = (h2.sqlite.prepare(`SELECT content FROM nodes WHERE id = 1`).get() as { content: string }).content;
        expect(content).toBe("seeded before V1 existed");
        expect((h2.sqlite.prepare(`SELECT COUNT(*) AS c FROM knowledge_docs`).get() as { c: number }).c).toBe(1);
        expect((h2.sqlite.prepare(`SELECT COUNT(*) AS c FROM telegram_note_drafts`).get() as { c: number }).c).toBe(1);
        // V1 tables arrived via migration; a new capture works.
        const repo = new SourcesRepo(h2, SPACE);
        const { source } = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "first capture after upgrade" });
        expect(repo.getById(source.id)!.rawText).toBe("first capture after upgrade");
        // Knowledge docs untouched and undoubled (Gate 4).
        expect((h2.sqlite.prepare(`SELECT COUNT(*) AS c FROM knowledge_chunks`).get() as { c: number }).c).toBe(0);
        expect(repo.count()).toBe(1);
      } finally {
        h2.sqlite.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
