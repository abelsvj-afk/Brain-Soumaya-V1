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
import { upsertSourceChunkEmbedding, upsertEmbedding, upsertJourneyEmbedding, upsertProfileEmbedding } from "../db/vec.js";
import {
  SourcesRepo,
  chunkExact,
  searchSourceChunks,
  CONFLICT_OPEN,
} from "../repositories/sources.repo.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { GraphExportRepo } from "../repositories/graphExport.repo.js";
import { SpacesRepo, SPACE_SCOPED_TABLES } from "../auth/spaces.js";
import { forgetSourceByRequest, containsVerbatimSpan, createForgetSourceRequest, approveForgetSourceRequest, rejectForgetSourceRequest, inspectForgetSourceRequest, ForgetSourceRefusal } from "../sources/forgetSource.js";
import { applyForgetRequest } from "../agent/episodic.js";
import { refreshPersona } from "../persona/derive.js";
import { getUserModelHistory } from "../agent/userModel.js";
import { InstructionProfilesRepo } from "../repositories/instructions.repo.js";
import { fileURLToPath } from "node:url";
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

// Fix round 3 (binding, D2/D6): fixtures create BOUND requests —
// via createForgetSourceRequest + approve, never bare approved rows.
// A bare approved row is unbound by definition now and must refuse.
function approvedForgetRequest(spaceId: string, sourceId: number): number {
  const created = createForgetSourceRequest(handle, spaceId, sourceId);
  expect(created.status).toBe("pending");
  expect(created.sourceId).toBe(sourceId);
  const approved = approveForgetSourceRequest(handle, spaceId, created.requestId);
  expect(approved.status).toBe("approved");
  return approved.requestId;
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

  it("fix round 2 (audit P2): RRF fusion returns a vector-only hit in the top-k instead of crowding it out", async () => {
    const repo = new SourcesRepo(handle, SPACE);
    // Three chunks match the FTS query; a fourth matches only by meaning.
    repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "zebra migration notes one" });
    repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "zebra migration notes two" });
    repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "zebra migration notes three" });
    const b = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "quiet harbor logistics" }).source;
    const bChunk = repo.chunksOf(b.id)[0]!;
    // Only B has a vector row, embedded exactly at the query vector.
    const queryVec = await embeddings.embed("quiet harbor logistics");
    upsertSourceChunkEmbedding(handle.sqlite, bChunk.id, queryVec);

    const res = searchSourceChunks(repo, "zebra", { k: 3, queryVec });
    expect(res.mode).toBe("fts+vec");
    expect(res.hits.length).toBe(3);
    // The old FTS-first-then-append code returned the three zebra chunks
    // and sliced B away while still reporting mode "fts+vec".
    expect(res.hits.map((h) => h.chunk.id)).toContain(bChunk.id);
    expect(res.hits.some((h) => h.chunk.text.includes("zebra"))).toBe(true);
  });

  it("fix round 4 (re-audit P2): a vector-only hit reports mode \"vec_only\", not \"fts+vec\"", async () => {
    const repo = new SourcesRepo(handle, SPACE);
    // One chunk, findable only by meaning: its text shares no term
    // with the FTS query, but its vector is exactly the query vector.
    const target = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "harbor lantern keeper's log" }).source;
    const targetChunk = repo.chunksOf(target.id)[0]!;
    const queryVec = await embeddings.embed("harbor lantern keeper's log");
    upsertSourceChunkEmbedding(handle.sqlite, targetChunk.id, queryVec);

    // "vecmodeprobe" matches nothing in FTS; the vector side still finds the chunk.
    const res = searchSourceChunks(repo, "vecmodeprobe", { queryVec });
    expect(res.mode).toBe("vec_only");
    expect(res.degraded).toBe(false); // vector healthy and contributing; 12E is about vector availability
    expect(res.hits.map((h) => h.chunk.id)).toContain(targetChunk.id);

    // Neither path contributes: still "fts_only" with degradation announced.
    const empty = searchSourceChunks(repo, "vecmodeprobe");
    expect(empty.mode).toBe("fts_only");
    expect(empty.degraded).toBe(true);
    expect(empty.hits).toEqual([]);
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

  it("fix round 2: a V1-shaped sources table (pre-fix-2, no capture columns) gains capture_intent/capture_params via migration", async () => {
    // A volume created by the V1 build (PR #104, pre-fix-2) already has
    // a `sources` table WITHOUT the intent columns — the CREATE TABLE
    // in migrateSchema is a no-op for it, so only the PRAGMA-guarded
    // ALTERs can add them. Build exactly that shape, then open it
    // through createDb (bootstrap + migrate, like a real restart).
    const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "verbatim-intent-"));
    const file = nodePath.join(dir, "brain.db");
    try {
      const raw = new BetterSqlite3(file);
      raw.exec(`CREATE TABLE sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT, space_id TEXT NOT NULL, kind TEXT NOT NULL,
        citation_class TEXT NOT NULL DEFAULT 'verbatim_typed', title TEXT, raw_bytes BLOB NOT NULL,
        raw_text TEXT, encoding TEXT NOT NULL DEFAULT 'utf8', content_hash TEXT NOT NULL,
        byte_length INTEGER NOT NULL, speaker TEXT NOT NULL DEFAULT 'owner', occurred_at TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        idempotency_key TEXT, audio_ref TEXT, processing_status TEXT NOT NULL DEFAULT 'preserved',
        processing_attempts INTEGER NOT NULL DEFAULT 0, processing_lease_owner TEXT,
        processing_lease_expires_at TEXT, extraction_hash TEXT
      );`);
      raw.close();
      const h2 = createDb(file);
      try {
        const cols = (h2.sqlite.prepare(`PRAGMA table_info(sources)`).all() as { name: string }[]).map((c) => c.name);
        expect(cols).toContain("capture_intent");
        expect(cols).toContain("capture_params");
        const repo = new SourcesRepo(h2, SPACE);
        const plain = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "migrated intent default" }).source;
        expect(plain.captureIntent).toBe("extract");
        const action = repo.persistText({
          kind: "note", citationClass: "verbatim_typed", text: "action intent",
          captureIntent: "action", captureParams: { expiresAt: "2026-10-25T00:00:00.000Z" },
        }).source;
        expect(action.captureIntent).toBe("action");
        expect(action.captureParams).toEqual({ expiresAt: "2026-10-25T00:00:00.000Z" });
      } finally {
        h2.sqlite.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
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

    const res = forgetSourceByRequest(handle, approvedForgetRequest(SPACE, doomed.id));
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

    const first = forgetSourceByRequest(handle, approvedForgetRequest(SPACE, srcA.id));
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
    const second = forgetSourceByRequest(handle, approvedForgetRequest(SPACE, srcB.id));
    expect(second.nodesErased).toContain(node.id);
    expect(nodes.getById(node.id)).toBeUndefined();
  });

  it("fix round 2 (audit P1): marker seeded across representative downstream records + indexes is fully scrubbed; sweep over the complete E2 inventory finds zero hits", async () => {
    const UNIQUE = "ZQXWUNIQUESTRING54321";
    const repo = new SourcesRepo(handle, SPACE);
    const nodes = new NodesRepo(handle, SPACE);
    const srcA = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: `alpha capture ${UNIQUE} alpha` }).source;
    const srcB = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "bravo capture with ordinary words" }).source;
    const shared = nodes.create(
      { label: "shared", type: "daily", content: "a summary that quotes neither capture word for word" },
      await embeddings.embed("shared summary"),
    );
    repo.linkNodeToAllChunks(shared.id, srcA.id);
    repo.linkNodeToAllChunks(shared.id, srcB.id);
    // Unlinked node quoting the forgotten chunk (no node_sources row at all).
    const quoter = nodes.create(
      { label: "quoter", type: "daily", content: `quoting alpha capture ${UNIQUE} alpha end` },
      await embeddings.embed("quoter"),
    );
    upsertEmbedding(handle.sqlite, quoter.id, await embeddings.embed("quoter"));
    // A true 24-char span of the forgotten chunk: the scrub predicate
    // is containsVerbatimSpan, so seeded rows must quote a full window.
    const SPAN = "alpha capture ZQXWUNIQUE";
    expect(SPAN.length).toBe(24);
    const srcAChunk = repo.chunksOf(srcA.id)[0]!;
    upsertSourceChunkEmbedding(handle.sqlite, srcAChunk.id, await embeddings.embed(`alpha capture ${UNIQUE} alpha`));
    const vec = await embeddings.embed("sweep probe");
    const vecBlob = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
    const run = (sql: string, ...params: unknown[]) => handle.sqlite.prepare(sql).run(...params);
    const nowIso = new Date().toISOString();

    // Representative downstream records, each holding the marker.
    const epInfo = run(
      `INSERT INTO episodes (space_id, kind, summary, occurred_at, recorded_at)
       VALUES (?, 'conversation', ?, ?, ?)`,
      SPACE, `episode summary ${SPAN} here`, nowIso, nowIso,
    );
    const epId = Number(epInfo.lastInsertRowid);
    run(`INSERT INTO episodes_fts (rowid, summary, detail) VALUES (?, ?, ?)`, epId, `episode summary ${SPAN} here`, `episode detail ${SPAN} here`);
    run(`INSERT INTO vec_episodes (episode_id, embedding) VALUES (?, ?)`, BigInt(epId), vecBlob);
    run(`INSERT INTO episode_enrichments (episode_id, space_id, version, detail) VALUES (?, ?, 1, ?)`, epId, SPACE, `enrichment detail ${SPAN} here`);
    run(`INSERT INTO insights (space_id, node_a, node_b, text) VALUES (?, ?, ?, ?)`, SPACE, shared.id, quoter.id, `insight text ${SPAN} here`);
    run(`INSERT INTO daily_logs (space_id, content, date) VALUES (?, ?, '2026-10-24')`, SPACE, `daily log ${SPAN} here`);
    run(`INSERT INTO working_memory (space_id, text) VALUES (?, ?)`, SPACE, `working thought ${SPAN} here`);
    run(`INSERT INTO inquiries (space_id, question, kind, signature) VALUES (?, ?, 'test', 'sweep-probe-1')`, SPACE, `question quoting ${SPAN} here`);
    run(`INSERT INTO timeline_chapters (space_id, title, summary) VALUES (?, ?, ?)`, SPACE, `chapter ${SPAN}`, `chapter summary ${SPAN} here`);
    run(`INSERT INTO telegram_note_drafts (space_id, chat_id, text, part_count) VALUES (?, 99, ?, 1)`, SPACE, `draft words ${SPAN} here`);
    run(`INSERT INTO agent_logs (space_id, agent, action, description, targets) VALUES (?, 'soumaya', 'test_action', ?, '{}')`, SPACE, `log line ${SPAN} here`);
    run(`INSERT INTO attachments (space_id, node_id, filename, data) VALUES (?, ?, 'note.txt', ?)`, SPACE, shared.id, `attachment payload ${SPAN} here`);
    const journeyInfo = run(`INSERT INTO journeys (space_id, title, description) VALUES (?, ?, ?)`, SPACE, `journey ${SPAN}`, `journey description ${SPAN} here`);
    const journeyId = Number(journeyInfo.lastInsertRowid);
    upsertJourneyEmbedding(handle.sqlite, journeyId, vec);
    run(`INSERT INTO lore (space_id, subject_type, subject_id, version, text) VALUES (?, 'memory', ?, 1, ?)`, SPACE, String(shared.id), `lore text ${SPAN} here`);
    run(
      `INSERT INTO contradictions (space_id, domain, old_kind, old_id, new_kind, new_id, category, reported_by, resolution)
       VALUES (?, 'nodes', 'node', ?, 'node', ?, 'duplicate_claim', 'user', ?)`,
      SPACE, shared.id, quoter.id, `resolution quoting ${SPAN} here`,
    );
    run(
      `INSERT INTO consolidation_runs (space_id, window_date, fence, started_at, lease_expires_at, error)
       VALUES (?, '2026-10-24', 'f', ?, ?, ?)`,
      SPACE, nowIso, nowIso, `run error ${SPAN} here`,
    );
    run(`INSERT INTO corrections (space_id, node_id, correction_type, corrected_by, reason) VALUES (?, ?, 'factual_update', 'user', ?)`, SPACE, shared.id, `reason quoting ${SPAN} here`);
    run(`INSERT INTO inbox_notifications (space_id, source, text) VALUES (?, 'insight', ?)`, SPACE, `inbox item ${SPAN} here`);
    run(`INSERT INTO tool_approvals (space_id, principal, tool, args_json, args_hash, status, expires_at) VALUES (?, 'user', 'capture_memory', ?, 'x', 'pending', ?)`, SPACE, JSON.stringify({ text: `approval args ${SPAN} here` }), nowIso);
    run(`INSERT INTO candidate_links (space_id, a, b, reason) VALUES (?, ?, ?, ?)`, SPACE, shared.id, quoter.id, `candidate reason ${SPAN} here`);
    run(`INSERT INTO codex_discoveries (space_id, key, title, lore) VALUES (?, 'sweep-probe', ?, ?)`, SPACE, `discovery ${SPAN}`, `discovery lore ${SPAN} here`);
    // Control rows with no marker: the scrub must be targeted, not a wipe.
    run(`INSERT INTO insights (space_id, node_a, node_b, text) VALUES (?, ?, ?, ?)`, SPACE, shared.id, quoter.id, "a clean insight with ordinary words");
    const cleanEp = run(
      `INSERT INTO episodes (space_id, kind, summary, occurred_at, recorded_at) VALUES (?, 'conversation', ?, ?, ?)`,
      SPACE, "a clean episode summary", nowIso, nowIso,
    );
    const cleanEpId = Number(cleanEp.lastInsertRowid);

    const res = forgetSourceByRequest(handle, approvedForgetRequest(SPACE, srcA.id));
    expect(res.nodesSurvivedClean).toContain(shared.id);
    expect(res.nodesTombstoned).toContain(quoter.id);
    // Tombstoned episode keeps its row, loses the words.
    const epRow = handle.sqlite.prepare(`SELECT summary, forgotten_at FROM episodes WHERE id = ?`).get(epId) as { summary: string; forgotten_at: string | null };
    expect(epRow.summary).not.toContain(UNIQUE);
    expect(epRow.forgotten_at).not.toBeNull();
    // The episode's FTS row (summary + enrichment detail) is gone too.
    const epFts = handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM episodes_fts WHERE rowid = ?`).get(epId) as { c: number };
    expect(epFts.c).toBe(0);
    // Controls survive untouched.
    const cleanInsight = handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM insights WHERE text = 'a clean insight with ordinary words'`).get() as { c: number };
    expect(cleanInsight.c).toBe(1);
    const cleanEpRow = handle.sqlite.prepare(`SELECT summary, forgotten_at FROM episodes WHERE id = ?`).get(cleanEpId) as { summary: string; forgotten_at: string | null };
    expect(cleanEpRow.summary).toBe("a clean episode summary");
    expect(cleanEpRow.forgotten_at).toBeNull();
    expect(repo.getById(srcB.id)).toBeDefined();

    // Sweep the COMPLETE E2 inventory (text tables + FTS + vec tables):
    // zero hits anywhere, not just in the source + correction.
    // Fix round 3: sweep for the seeded SPAN, not UNIQUE. The downstream
    // rows were seeded with the 24-char SPAN; UNIQUE (21 chars) never
    // occurs in them, so the old sweep could not detect a survivor.
    const inventory = [
      "nodes", "episodes", "episode_enrichments", "insights", "daily_logs",
      "knowledge_docs", "knowledge_chunks", "lore", "working_memory",
      "agent_logs", "telegram_note_drafts", "attachments", "timeline_chapters",
      "inquiries", "consolidation_runs", "consolidation_episodes", "contradictions",
      "user_model", "user_persona", "instruction_profiles", "journeys",
      "sources", "source_chunks", "source_corrections", "node_sources",
      "sources_fts", "nodes_fts", "episodes_fts", "corrections", "tts_audio_cache",
      "vec_source_chunks", "vec_nodes", "vec_episodes", "vec_docs", "vec_journeys", "vec_profiles",
      "inbox_notifications", "tool_approvals", "candidate_links", "codex_discoveries",
    ];
    const existing = new Set(
      (handle.sqlite.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table','view')`).all() as { name: string }[]).map((r) => r.name),
    );
    for (const t of inventory) {
      if (!existing.has(t)) continue;
      const rows = handle.sqlite.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[];
      const blob = JSON.stringify(rows, (_k, v) => (Buffer.isBuffer(v) ? v.toString("utf8") : v));
      expect(blob.includes(SPAN), `seeded span survived in ${t}`).toBe(false);
    }
    // Vector rows are embeddings, not text: assert by id that no vec row
    // remains for any erased/tombstoned entity.
    const vecCount = (t: string, col: string, id: number) =>
      (handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE ${col} = ?`).get(BigInt(id)) as { c: number }).c;
    expect(vecCount("vec_source_chunks", "chunk_id", srcAChunk.id)).toBe(0);
    expect(vecCount("vec_nodes", "node_id", quoter.id)).toBe(0);
    expect(vecCount("vec_episodes", "episode_id", epId)).toBe(0);
    expect(vecCount("vec_journeys", "journey_id", journeyId)).toBe(0);
    // Result fields (asserted last so a pre-fix run fails on the
    // surviving marker above, not on the new fields' absence).
    expect(res.episodesTombstoned).toContain(epId);
    expect(res.derivedRowsScrubbed).toBeGreaterThan(0);
  });
  it("fix round 4 (re-audit P1): marker seeded into user_model/user_persona/instruction_profiles/tts_audio_cache — inferred rows scrubbed, persona re-derived clean, TTS purged, stated + profile named in unresolved", async () => {
    const SPAN = "alpha capture ZQXWEXCEPT"; // 24 chars, a true window of the chunk
    expect(SPAN.length).toBe(24);
    const repo = new SourcesRepo(handle, SPACE);
    const nodes = new NodesRepo(handle, SPACE);
    const srcA = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: `alpha capture ZQXWEXCEPT alpha` }).source;
    const run = (sql: string, ...params: unknown[]) => handle.sqlite.prepare(sql).run(...params);
    const nowIso = new Date().toISOString();

    // Marker node: sole origin is srcA (erased with it) and its tag/label
    // carry the marker into the derived persona body.
    const markerNode = nodes.create(
      { label: `marker hub ${SPAN}`, type: "daily", content: "marker node content, clean of the quote", tags: [SPAN] },
      await embeddings.embed("marker"),
    );
    repo.linkNodeToAllChunks(markerNode.id, srcA.id);
    // Three clean nodes so the persona can re-derive after the marker node is gone.
    const cleanNodes = [
      nodes.create({ label: "clean one", type: "daily", content: "first clean memory" }, await embeddings.embed("clean one")),
      nodes.create({ label: "clean two", type: "daily", content: "second clean memory" }, await embeddings.embed("clean two")),
      nodes.create({ label: "clean three", type: "daily", content: "third clean memory" }, await embeddings.embed("clean three")),
    ];

    // Tombstoned episode + enrichment, both quoting the span.
    const epInfo = run(
      `INSERT INTO episodes (space_id, kind, summary, occurred_at, recorded_at) VALUES (?, 'conversation', ?, ?, ?)`,
      SPACE, `episode summary ${SPAN} here`, nowIso, nowIso,
    );
    const epId = Number(epInfo.lastInsertRowid);
    const enrInfo = run(
      `INSERT INTO episode_enrichments (episode_id, space_id, version, detail) VALUES (?, ?, 1, ?)`,
      epId, SPACE, `enrichment detail ${SPAN} here`,
    );
    const enrId = Number(enrInfo.lastInsertRowid);

    // user_model rows (raw inserts: the API validators reject test-shaped content).
    const um = (origin: string, content: string, evidence: unknown[], replacedBy: number | null = null) => {
      const info = run(
        `INSERT INTO user_model (space_id, slot, content, confidence, evidence_ids, valid_at, origin, replaced_by)
         VALUES (?, 'belief', ?, 0.8, ?, ?, ?, ?)`,
        SPACE, content, JSON.stringify(evidence), nowIso, origin, replacedBy,
      );
      return Number(info.lastInsertRowid);
    };
    const inferredQuoting = um("inferred", `I believe the note said ${SPAN} and more`, []);
    const inferredSoleEpisode = um("inferred", "a clean inferred claim about the week", [{ type: "episode", id: epId }]);
    const inferredSoleNode = um("inferred", "another clean inferred claim", [{ type: "node", id: markerNode.id }]);
    const inferredSoleEnrichment = um("inferred", "a third clean inferred claim", [{ type: "enrichment", id: enrId }]);
    const inferredPruned = um("inferred", "a claim with two legs", [
      { type: "episode", id: epId },
      { type: "node", id: cleanNodes[0]!.id },
    ]);
    const statedQuoting = um("stated", `I said ${SPAN} myself`, [{ type: "episode", id: epId }]);
    const chainNew = um("inferred", `the newer claim quoting ${SPAN} here`, []);
    const chainOld = um("inferred", "an older inferred claim", [{ type: "node", id: cleanNodes[0]!.id }], chainNew);

    // Persona derived from the live nodes quotes the span via the marker node's tag.
    const personaBefore = refreshPersona(handle, SPACE, true);
    expect(personaBefore).toContain(SPAN);

    // Owner-pasted instruction profile quoting the span (+ its vec row).
    const profiles = new InstructionProfilesRepo(handle, SPACE);
    const profile = profiles.create({ name: "sweep probe profile", body: `always remember ${SPAN} when answering` });
    upsertProfileEmbedding(handle.sqlite, profile.id, await embeddings.embed("profile probe"));

    // TTS cache: two rows in this space, one in another space.
    run(`INSERT INTO tts_audio_cache (space_id, cache_key, audio, content_type, filename) VALUES (?, 'k1', ?, 'audio/mpeg', 'a.mp3')`, SPACE, Buffer.from([0x01]));
    run(`INSERT INTO tts_audio_cache (space_id, cache_key, audio, content_type, filename) VALUES (?, 'k2', ?, 'audio/mpeg', 'b.mp3')`, SPACE, Buffer.from([0x02]));
    run(`INSERT INTO tts_audio_cache (space_id, cache_key, audio, content_type, filename) VALUES ('other-space', 'k1', ?, 'audio/mpeg', 'a.mp3')`, Buffer.from([0x03]));

    const res = forgetSourceByRequest(handle, approvedForgetRequest(SPACE, srcA.id));

    const umRow = (id: number) =>
      handle.sqlite.prepare(`SELECT * FROM user_model WHERE id = ?`).get(id) as Record<string, unknown> | undefined;

    // (1a) Evidence pass: sole-evidence inferred rows invalidated, never deleted.
    for (const id of [inferredSoleEpisode, inferredSoleNode, inferredSoleEnrichment]) {
      const row = umRow(id)!;
      expect(row.invalid_at, `user_model ${id} invalid_at`).not.toBeNull();
      expect(row.invalid_reason, `user_model ${id} invalid_reason`).toBe("evidence_withdrawn");
    }
    expect(res.userModelInvalidated).toEqual(expect.arrayContaining([inferredSoleEpisode, inferredSoleNode, inferredSoleEnrichment]));
    // (1a) Prune: the two-legged claim survives on its node leg.
    const prunedRow = umRow(inferredPruned)!;
    expect(prunedRow.invalid_at).toBeNull();
    expect(JSON.parse(prunedRow.evidence_ids as string)).toEqual([{ type: "node", id: cleanNodes[0]!.id }]);
    expect(res.userModelPruned).toContain(inferredPruned);
    // (1b) Span pass: quoting inferred rows are DELETED, text gone.
    expect(umRow(inferredQuoting)).toBeUndefined();
    expect(umRow(chainNew)).toBeUndefined();
    expect(res.userModelDeleted).toEqual(expect.arrayContaining([inferredQuoting, chainNew]));
    // (1c) The deleted row's inbound replaced_by is nulled: history still walks.
    expect((umRow(chainOld)!.replaced_by as number | null)).toBeNull();
    expect(getUserModelHistory(handle, SPACE, chainOld).map((e) => e.id)).toEqual([chainOld]);
    // Stated row: untouched by policy (content, evidence, validity all as seeded).
    const statedRow = umRow(statedQuoting)!;
    expect(statedRow.content).toContain(SPAN);
    expect(statedRow.invalid_at).toBeNull();
    expect(JSON.parse(statedRow.evidence_ids as string)).toEqual([{ type: "episode", id: epId }]);

    // (2) Persona: quoting row deleted, re-derived clean from surviving nodes.
    expect(res.personaScrubbed).toBe(true);
    const personaRow = handle.sqlite.prepare(`SELECT body FROM user_persona WHERE space_id = ?`).get(SPACE) as { body: string } | undefined;
    expect(personaRow).toBeDefined();
    expect(personaRow!.body).not.toContain(SPAN);
    expect(personaRow!.body.length).toBeGreaterThan(0);

    // (3) TTS: this space purged, the other space untouched.
    expect(res.ttsCachePurged).toBe(2);
    expect((handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM tts_audio_cache WHERE space_id = ?`).get(SPACE) as { c: number }).c).toBe(0);
    expect((handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM tts_audio_cache WHERE space_id = 'other-space'`).get() as { c: number }).c).toBe(1);

    // Honesty: the result names exactly the quoting rows left in place by policy.
    expect(res.unresolved).toEqual([
      { table: "user_model", rowId: statedQuoting },
      { table: "instruction_profiles", rowId: profile.id },
    ]);
    // The profile itself is untouched, vec row included (disclosed residual).
    const profileRow = handle.sqlite.prepare(`SELECT body FROM instruction_profiles WHERE id = ?`).get(profile.id) as { body: string };
    expect(profileRow.body).toContain(SPAN);
    expect((handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM vec_profiles WHERE profile_id = ?`).get(BigInt(profile.id)) as { c: number }).c).toBe(1);

    // Sweep the COMPLETE E2 inventory for the span: zero hits in every
    // scrubbed representation; the only survivors are the two unresolved rows.
    const inventory = [
      "nodes", "episodes", "episode_enrichments", "insights", "daily_logs",
      "knowledge_docs", "knowledge_chunks", "lore", "working_memory",
      "agent_logs", "telegram_note_drafts", "attachments", "timeline_chapters",
      "inquiries", "consolidation_runs", "consolidation_episodes", "contradictions",
      "user_model", "user_persona", "instruction_profiles", "journeys",
      "sources", "source_chunks", "source_corrections", "node_sources",
      "sources_fts", "nodes_fts", "episodes_fts", "corrections", "tts_audio_cache",
      "vec_source_chunks", "vec_nodes", "vec_episodes", "vec_docs", "vec_journeys", "vec_profiles",
      "inbox_notifications", "tool_approvals", "candidate_links", "codex_discoveries",
    ];
    const existing = new Set(
      (handle.sqlite.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table','view')`).all() as { name: string }[]).map((r) => r.name),
    );
    for (const t of inventory) {
      if (!existing.has(t)) continue;
      const rows = handle.sqlite.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[];
      const quoting = rows
        .filter((r) => JSON.stringify(r, (_k, v) => (Buffer.isBuffer(v) ? v.toString("utf8") : v)).includes(SPAN))
        .map((r) => r.id as number);
      if (t === "user_model") {
        expect(quoting, `quoting rows left in ${t}`).toEqual([statedQuoting]);
      } else if (t === "instruction_profiles") {
        expect(quoting, `quoting rows left in ${t}`).toEqual([profile.id]);
      } else {
        expect(quoting, `seeded span survived in ${t}`).toEqual([]);
      }
    }
    // The marker node went with its sole-origin source.
    expect(res.nodesErased).toContain(markerNode.id);
    expect(nodes.getById(markerNode.id)).toBeUndefined();
  });


  it("fix round 3 (re-review B1): an episode with a CLEAN summary but QUOTING enrichment/FTS detail loses its FTS row + enrichment, not its episode", async () => {
    // Mirrors re-review Probe 2: the old scrub gated on the summary only,
    // so this episode's episodes_fts row stayed MATCH-retrievable.
    const UNIQUE = "ZQXWUNIQUESTRING54321";
    const SPAN = "alpha capture ZQXWUNIQUE"; // 24 chars, a true window of the chunk
    expect(SPAN.length).toBe(24);
    const repo = new SourcesRepo(handle, SPACE);
    const srcA = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: `alpha capture ${UNIQUE} alpha` }).source;
    const nowIso = new Date().toISOString();
    const epInfo = handle.sqlite.prepare(
      `INSERT INTO episodes (space_id, kind, summary, occurred_at, recorded_at) VALUES (?, 'conversation', ?, ?, ?)`,
    ).run(SPACE, "a clean episode summary", nowIso, nowIso);
    const epId = Number(epInfo.lastInsertRowid);
    handle.sqlite.prepare(`INSERT INTO episode_enrichments (episode_id, space_id, version, detail) VALUES (?, ?, 1, ?)`).run(epId, SPACE, `enrichment detail ${SPAN} here`);
    handle.sqlite.prepare(`INSERT INTO episodes_fts (rowid, summary, detail) VALUES (?, ?, ?)`).run(epId, "a clean episode summary", `enrichment detail ${SPAN} here`);
    // Fix round 4 (audit §3 note): seed the vec_episodes row too — the
    // detail-only branch deletes it (its embedding covers summary +
    // detail, so it embeds the quote), and the old test never proved it.
    const vec = await embeddings.embed("b1 detail probe");
    const vecBlob = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
    handle.sqlite.prepare(`INSERT INTO vec_episodes (episode_id, embedding) VALUES (?, ?)`).run(BigInt(epId), vecBlob);

    const res = forgetSourceByRequest(handle, approvedForgetRequest(SPACE, srcA.id));
    // The quoting enrichment row is gone (deleteScrub), the FTS row is gone,
    // and the clean-summary episode itself is NOT tombstoned.
    const enrCount = (handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM episode_enrichments WHERE episode_id = ?`).get(epId) as { c: number }).c;
    expect(enrCount).toBe(0);
    const ftsRows = handle.sqlite.prepare(`SELECT * FROM episodes_fts WHERE rowid = ?`).all(epId) as Record<string, unknown>[];
    expect(ftsRows.length).toBe(0);
    expect(JSON.stringify(ftsRows)).not.toContain(UNIQUE);
    const vecCount = (handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM vec_episodes WHERE episode_id = ?`).get(BigInt(epId)) as { c: number }).c;
    expect(vecCount).toBe(0);
    const epRow = handle.sqlite.prepare(`SELECT summary, forgotten_at FROM episodes WHERE id = ?`).get(epId) as { summary: string; forgotten_at: string | null };
    expect(epRow.summary).toBe("a clean episode summary");
    expect(epRow.forgotten_at).toBeNull();
    expect(res.episodesTombstoned).not.toContain(epId);
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
    const res = forgetSourceByRequest(handle, approvedForgetRequest(SPACE, srcA.id));
    expect(res.nodesTombstoned).toContain(node.id);
    const row = handle.sqlite.prepare(`SELECT content, deleted_at FROM nodes WHERE id = ?`).get(node.id) as { content: string; deleted_at: string | null };
    expect(row.content).not.toContain("distinctive forgotten");
    expect(row.deleted_at).not.toBeNull();
  });

  it("refuses without an approved user forget request (no second door)", () => {
    const repo = new SourcesRepo(handle, SPACE);
    const { source } = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "still here" });
    // A bound but merely pending request refuses (not_approved), and the
    // source survives. (Rejected / nonexistent ids are pinned in T-B3.)
    const pending = createForgetSourceRequest(handle, SPACE, source.id);
    expect(() => forgetSourceByRequest(handle, pending.requestId)).toThrow(/not_approved/);
    expect(repo.getById(source.id)).toBeDefined();
  });

  it("containsVerbatimSpan catches whole-chunk and windowed spans only", () => {
    expect(containsVerbatimSpan("xx a very distinctive forgotten sentence yy", ["a very distinctive forgotten sentence here"])).toBe(true);
    expect(containsVerbatimSpan("nothing alike at all", ["a very distinctive forgotten sentence here"])).toBe(false);
  });

  it("fix round 2 (audit P1): a 24-char span at an UNALIGNED offset is caught — every window, not stride-8 samples", () => {
    // The marker starts at offset 10 of the chunk (10 % 8 = 2): the old
    // stride-8 windows (0, 8, 16, 24, 32, 40) plus the tail window never
    // equal it, so the old checker certified this "scrub-verified clean".
    const MARKER = "QWERTYUNALIGNEDSPAN12345"; // exactly 24 chars
    expect(MARKER.length).toBe(24);
    const chunkText = "0123456789" + MARKER + "tail padding text to push the tail window past it";
    expect(chunkText.indexOf(MARKER)).toBe(10);
    expect(containsVerbatimSpan(`prefix ${MARKER} suffix`, [chunkText])).toBe(true);
    expect(containsVerbatimSpan("nothing alike at all here", [chunkText])).toBe(false);
  });

  it("fix round 2 (audit P1): a multi-source node quoting the forgotten chunk at an unaligned offset is tombstoned, not kept", async () => {
    const MARKER = "QWERTYUNALIGNEDSPAN12345";
    const repo = new SourcesRepo(handle, SPACE);
    const nodes = new NodesRepo(handle, SPACE);
    const srcA = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "0123456789" + MARKER + "tail padding text to push the tail window past it" }).source;
    const srcB = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "an unrelated second capture" }).source;
    const node = nodes.create(
      { label: "unaligned-quote", type: "daily", content: `he said ${MARKER} and moved on` },
      await embeddings.embed("unaligned-quote"),
    );
    repo.linkNodeToAllChunks(node.id, srcA.id);
    repo.linkNodeToAllChunks(node.id, srcB.id);
    const res = forgetSourceByRequest(handle, approvedForgetRequest(SPACE, srcA.id));
    expect(res.nodesTombstoned).toContain(node.id);
    const row = handle.sqlite.prepare(`SELECT content, deleted_at FROM nodes WHERE id = ?`).get(node.id) as { content: string; deleted_at: string | null };
    expect(row.content).not.toContain(MARKER);
    expect(row.deleted_at).not.toBeNull();
  });

  it("fix round 4 (re-audit P1): a 24-char span CROSSING a chunk boundary is caught — joined-text windows, not per-chunk windows", () => {
    // The marker starts at offset 990 of a 2,024-char source: it spans
    // 990..1014, crossing the 1,000-char chunk boundary, so it is a
    // window of NO single chunk. The old per-chunk scan certified a
    // node quoting exactly this span "scrub-verified clean".
    const MARKER = "CROSSBOUNDARYSPAN2026!!!"; // exactly 24 chars
    expect(MARKER.length).toBe(24);
    const text = "x".repeat(990) + MARKER + "y".repeat(1010);
    expect(text.length).toBe(2024);
    expect(text.indexOf(MARKER)).toBe(990);
    const chunkTexts = chunkExact(text).map((c) => c.text);
    expect(chunkTexts.length).toBe(3);
    expect(chunkTexts[0]!.length).toBe(1000);
    expect(chunkTexts[0]!.includes(MARKER)).toBe(false);
    expect(chunkTexts[1]!.includes(MARKER)).toBe(false);
    expect(containsVerbatimSpan(`he said ${MARKER} and moved on`, chunkTexts)).toBe(true);
    // A span fully inside one chunk is still found.
    const inner = text.slice(100, 124);
    expect(inner.length).toBe(24);
    expect(containsVerbatimSpan(`quoting ${inner} here`, chunkTexts)).toBe(true);
    // A non-present span is not found.
    expect(containsVerbatimSpan("nothing alike at all here", chunkTexts)).toBe(false);
  });

  it("fix round 4 (re-audit P1): the short-chunk whole-text check survives the joined scan", () => {
    // A chunk of 4..24 chars is checked whole: its text must still match
    // even when a 24-char window over it would need neighboring-chunk
    // characters. The joined scan alone would miss a short chunk whose
    // only occurrence is verbatim.
    expect(containsVerbatimSpan("he said short phrase here aloud", ["short phrase here"])).toBe(true);
    expect(containsVerbatimSpan("he said short phrase aloud", ["short phrase here"])).toBe(false);
    expect(containsVerbatimSpan("prefix abcd suffix", ["abcd"])).toBe(true);
    // A 3-char chunk is below the whole-text floor: not a quotable span.
    expect(containsVerbatimSpan("prefix abc suffix", ["abc"])).toBe(false);
    // A short chunk at the tail of a longer source still matches whole.
    const chunkTexts = chunkExact("z".repeat(1000) + "tail words here").map((c) => c.text);
    expect(chunkTexts[1]).toBe("tail words here");
    expect(containsVerbatimSpan("quoting tail words here end", chunkTexts)).toBe(true);
  });

  it("fix round 4 (re-audit P1): a multi-source node quoting a cross-boundary span is tombstoned, not kept", async () => {
    const MARKER = "CROSSBOUNDARYSPAN2026!!!";
    expect(MARKER.length).toBe(24);
    const repo = new SourcesRepo(handle, SPACE);
    const nodes = new NodesRepo(handle, SPACE);
    const srcA = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "x".repeat(990) + MARKER + "y".repeat(1010) }).source;
    const srcB = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "an unrelated second capture" }).source;
    // Sanity: the marker really does straddle the chunk boundary.
    const chunks = repo.chunksOf(srcA.id);
    expect(chunks.length).toBe(3);
    expect(chunks.map((c) => c.text).join("").indexOf(MARKER)).toBe(990);
    expect(chunks[0]!.text).not.toContain(MARKER);
    expect(chunks[1]!.text).not.toContain(MARKER);
    const node = nodes.create(
      { label: "cross-boundary-quote", type: "daily", content: `he said ${MARKER} and moved on` },
      await embeddings.embed("cross-boundary-quote"),
    );
    repo.linkNodeToAllChunks(node.id, srcA.id);
    repo.linkNodeToAllChunks(node.id, srcB.id);
    // nodes.create seeds the vec + FTS rows the tombstone must drop.
    const vecBefore = (handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM vec_nodes WHERE node_id = ?`).get(BigInt(node.id)) as { c: number }).c;
    expect(vecBefore).toBe(1);
    const ftsBefore = (handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM nodes_fts WHERE rowid = ?`).get(node.id) as { c: number }).c;
    expect(ftsBefore).toBe(1);
    const res = forgetSourceByRequest(handle, approvedForgetRequest(SPACE, srcA.id));
    expect(res.nodesTombstoned).toContain(node.id);
    const row = handle.sqlite.prepare(`SELECT content, deleted_at FROM nodes WHERE id = ?`).get(node.id) as { content: string; deleted_at: string | null };
    expect(row.content).not.toContain(MARKER);
    expect(row.deleted_at).not.toBeNull();
    const ftsAfter = (handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM nodes_fts WHERE rowid = ?`).get(node.id) as { c: number }).c;
    expect(ftsAfter).toBe(0);
    const vecAfter = (handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM vec_nodes WHERE node_id = ?`).get(BigInt(node.id)) as { c: number }).c;
    expect(vecAfter).toBe(0);
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

describe("Fix C regression: restore rejects forged derived fields", () => {
  async function buildPayload() {
    const repo = new SourcesRepo(handle, SPACE);
    const nodes = new NodesRepo(handle, SPACE);
    const text = "derived fields must match the bytes exactly";
    const { source } = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text });
    const node = nodes.create({ label: "dc", type: "daily", content: text }, await embeddings.embed(text));
    repo.linkNodeToAllChunks(node.id, source.id);
    return JSON.parse(JSON.stringify(new GraphExportRepo(handle, SPACE).exportGraph()));
  }

  it("chunk-text tamper aborts the whole restore: zero sources, zero nodes restored", async () => {
    const payload = await buildPayload();
    payload.sources[0].chunks[0].text = "forged chunk words that were never said";
    const h2 = createDb(":memory:");
    try {
      expect(() => new GraphExportRepo(h2, SPACE).restoreGraph(payload)).toThrow(/derived-field mismatch/);
      expect(new SourcesRepo(h2, SPACE).count()).toBe(0);
      expect((h2.sqlite.prepare(`SELECT COUNT(*) AS c FROM nodes`).get() as { c: number }).c).toBe(0);
      expect((h2.sqlite.prepare(`SELECT COUNT(*) AS c FROM source_chunks`).get() as { c: number }).c).toBe(0);
    } finally {
      h2.sqlite.close();
    }
  });

  it("rawText tamper aborts the whole restore", async () => {
    const payload = await buildPayload();
    payload.sources[0].rawText = "forged raw text that does not match the bytes";
    const h2 = createDb(":memory:");
    try {
      expect(() => new GraphExportRepo(h2, SPACE).restoreGraph(payload)).toThrow(/derived-field mismatch/);
      expect(new SourcesRepo(h2, SPACE).count()).toBe(0);
    } finally {
      h2.sqlite.close();
    }
  });

  it("chunk offset tamper (partition break) aborts the whole restore", async () => {
    const payload = await buildPayload();
    payload.sources[0].chunks[0].endOffset = payload.sources[0].chunks[0].endOffset - 1;
    const h2 = createDb(":memory:");
    try {
      expect(() => new GraphExportRepo(h2, SPACE).restoreGraph(payload)).toThrow(/derived-field mismatch/);
      expect(new SourcesRepo(h2, SPACE).count()).toBe(0);
    } finally {
      h2.sqlite.close();
    }
  });
});

describe("Fix A regression: travel_journeys bonus columns present on a fresh DB", () => {
  it("PRAGMA table_info(travel_journeys) includes bonus_credited_at / bonus_amount / bonus_reason", () => {
    const cols = (handle.sqlite.prepare(`PRAGMA table_info(travel_journeys)`).all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("bonus_credited_at");
    expect(cols).toContain("bonus_amount");
    expect(cols).toContain("bonus_reason");
  });
});

describe("Fix 3: forget-request binding (D1–D10) — T-B1…T-B10", () => {
  function sourceCount(): number {
    return (handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM sources`).get() as { c: number }).c;
  }

  function refusedAudits(requestId: number): { description: string; targets: string }[] {
    const rows = handle.sqlite
      .prepare(`SELECT description, targets FROM agent_logs WHERE action = 'forget_source_refused'`)
      .all() as { description: string; targets: string }[];
    return rows.filter((r) => {
      try {
        return (JSON.parse(r.targets) as { request_id?: number }).request_id === requestId;
      } catch {
        return false;
      }
    });
  }

  it("T-B1 — bound apply erases exactly its source; the other source is byte-identical", () => {
    const repo = new SourcesRepo(handle, SPACE);
    const a = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "forgettable alpha words here" }).source;
    const b = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "keeper bravo words here" }).source;
    const bBefore = repo.getById(b.id)!;
    const bChunksBefore = repo.chunksOf(b.id).map((c) => c.text).join("");
    const res = forgetSourceByRequest(handle, approvedForgetRequest(SPACE, a.id));
    expect(res.sourceId).toBe(a.id);
    expect(res.requestId).toBeGreaterThan(0);
    expect(repo.getById(a.id)).toBeUndefined();
    expect(repo.chunksOf(a.id)).toEqual([]);
    const bAfter = repo.getById(b.id)!;
    expect(bAfter.rawText).toBe(bBefore.rawText);
    expect(bAfter.contentHash).toBe(bBefore.contentHash);
    expect(bAfter.byteLength).toBe(bBefore.byteLength);
    expect(repo.chunksOf(b.id).map((c) => c.text).join("")).toBe(bChunksBefore);
  });

  it("T-B2 — an approved episodic request cannot drive a source forget", () => {
    const repo = new SourcesRepo(handle, SPACE);
    const { source } = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "episodic must not forget me" });
    const info = handle.sqlite.prepare(
      `INSERT INTO forget_requests (space_id, requested_by, status, scope_episode_ids) VALUES (?, 'user', 'approved', ?)`,
    ).run(SPACE, "[1]");
    const reqId = Number(info.lastInsertRowid);
    expect(() => forgetSourceByRequest(handle, reqId)).toThrow(/unbound_legacy_request/);
    expect(repo.getById(source.id)).toBeDefined();
    expect(sourceCount()).toBe(1);
  });

  it("T-B3 — unapproved requests refuse: pending, rejected, nonexistent", () => {
    const repo = new SourcesRepo(handle, SPACE);
    const { source } = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "not yet approved words" });
    const pending = createForgetSourceRequest(handle, SPACE, source.id);
    expect(() => forgetSourceByRequest(handle, pending.requestId)).toThrow(/not_approved/);
    const rejected = rejectForgetSourceRequest(handle, SPACE, pending.requestId);
    expect(rejected.status).toBe("rejected");
    expect(() => forgetSourceByRequest(handle, pending.requestId)).toThrow(/not_approved/);
    expect(() => forgetSourceByRequest(handle, 999999)).toThrow(/not_found/);
    expect(repo.getById(source.id)).toBeDefined();
  });

  it("T-B4 — a legacy unbound row (NULL target_source_id) refuses and deletes nothing; the refusal is audited, content-free", () => {
    const repo = new SourcesRepo(handle, SPACE);
    const { source } = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "legacy survivor words" });
    const info = handle.sqlite.prepare(
      `INSERT INTO forget_requests (space_id, requested_by, status) VALUES (?, 'user', 'approved')`,
    ).run(SPACE);
    const reqId = Number(info.lastInsertRowid);
    expect(() => forgetSourceByRequest(handle, reqId)).toThrow(/unbound_legacy_request/);
    expect(repo.getById(source.id)).toBeDefined();
    expect(sourceCount()).toBe(1);
    const audits = refusedAudits(reqId);
    expect(audits.length).toBe(1);
    expect(audits[0]!.description).toContain("unbound_legacy_request");
    expect(JSON.stringify(audits[0])).not.toContain("legacy survivor");
  });

  it("T-B5 — cross-space binding holds: a request in S1 cannot forget a source in S2", () => {
    const repoB = new SourcesRepo(handle, "space-b");
    const other = repoB.persistText({ kind: "note", citationClass: "verbatim_typed", text: "other space words" }).source;
    // Hand-crafted: creation would refuse source_not_found, so a
    // cross-space row can only exist by direct insert — which is
    // exactly the shape the apply check must still refuse.
    const info = handle.sqlite.prepare(
      `INSERT INTO forget_requests (space_id, requested_by, status, target_source_id) VALUES (?, 'user', 'approved', ?)`,
    ).run(SPACE, other.id);
    const reqId = Number(info.lastInsertRowid);
    expect(() => forgetSourceByRequest(handle, reqId)).toThrow(/space_mismatch/);
    expect(repoB.getById(other.id)).toBeDefined();
  });

  it("T-B6 — double-apply refuses: the second apply sees status 'applied'", () => {
    const repo = new SourcesRepo(handle, SPACE);
    const { source } = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "apply me once only" });
    const reqId = approvedForgetRequest(SPACE, source.id);
    const res = forgetSourceByRequest(handle, reqId);
    expect(res.sourceId).toBe(source.id);
    const row = handle.sqlite.prepare(`SELECT status FROM forget_requests WHERE id = ?`).get(reqId) as { status: string };
    expect(row.status).toBe("applied");
    expect(() => forgetSourceByRequest(handle, reqId)).toThrow(/not_approved/);
    expect(repo.getById(source.id)).toBeUndefined();
  });

  it("T-B7 — a mixed-scope row is invalid at both doors", () => {
    const repo = new SourcesRepo(handle, SPACE);
    const { source } = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "mixed scope survivor" });
    // Creation door: there is no scope parameter, so a created row is
    // always source-only — assert the created row's shape directly.
    const created = createForgetSourceRequest(handle, SPACE, source.id);
    const createdRow = handle.sqlite.prepare(
      `SELECT target_query, scope_episode_ids, scope_node_ids, scope_topics FROM forget_requests WHERE id = ?`,
    ).get(created.requestId) as {
      target_query: string | null; scope_episode_ids: string; scope_node_ids: string; scope_topics: string;
    };
    expect(createdRow.target_query).toBeNull();
    expect(createdRow.scope_episode_ids).toBe("[]");
    expect(createdRow.scope_node_ids).toBe("[]");
    expect(createdRow.scope_topics).toBe("[]");
    // Apply door: a hand-crafted mixed row refuses.
    const { source: source2 } = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "second mixed survivor" });
    const info = handle.sqlite.prepare(
      `INSERT INTO forget_requests (space_id, requested_by, status, target_source_id, scope_episode_ids) VALUES (?, 'user', 'approved', ?, '[1]')`,
    ).run(SPACE, source2.id);
    const reqId = Number(info.lastInsertRowid);
    expect(() => forgetSourceByRequest(handle, reqId)).toThrow(/mixed_scope/);
    expect(repo.getById(source.id)).toBeDefined();
    expect(repo.getById(source2.id)).toBeDefined();
  });

  it("T-B8 — one live request per source: second create refuses; after reject/apply the live window closes", () => {
    const repo = new SourcesRepo(handle, SPACE);
    const { source } = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "one live request only" });
    const first = createForgetSourceRequest(handle, SPACE, source.id);
    let secondErr: unknown;
    try {
      createForgetSourceRequest(handle, SPACE, source.id);
    } catch (err) {
      secondErr = err;
    }
    expect(secondErr).toBeInstanceOf(ForgetSourceRefusal);
    expect((secondErr as ForgetSourceRefusal).reason).toBe("already_pending");
    expect((secondErr as ForgetSourceRefusal).existingRequestId).toBe(first.requestId);
    // The partial unique index is the backstop: a raw duplicate insert fails too.
    expect(() =>
      handle.sqlite.prepare(
        `INSERT INTO forget_requests (space_id, requested_by, status, target_source_id, target_query, scope_episode_ids, scope_node_ids, scope_topics)
         VALUES (?, 'user', 'pending', ?, NULL, '[]', '[]', '[]')`,
      ).run(SPACE, source.id),
    ).toThrow(/UNIQUE constraint/);
    // After the first is rejected, a new request may be created…
    rejectForgetSourceRequest(handle, SPACE, first.requestId);
    const recreated = createForgetSourceRequest(handle, SPACE, source.id);
    expect(recreated.requestId).not.toBe(first.requestId);
    // …and after it is applied, the live window closes: a raw pending
    // row for the same source id inserts cleanly (the index guards
    // live rows only). Creating through the door then refuses
    // source_not_found — the source is gone, which is correct.
    approveForgetSourceRequest(handle, SPACE, recreated.requestId);
    forgetSourceByRequest(handle, recreated.requestId);
    expect(repo.getById(source.id)).toBeUndefined();
    handle.sqlite.prepare(
      `INSERT INTO forget_requests (space_id, requested_by, status, target_source_id) VALUES (?, 'user', 'pending', ?)`,
    ).run(SPACE, source.id);
    expect(() => createForgetSourceRequest(handle, SPACE, source.id)).toThrow(/source_not_found/);
  });

  it("T-B9 — static enforcement pins: source DELETEs live only in forgetSource.ts; the helper is called in production only from the apply route", () => {
    const srcDir = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "..");
    const prodFiles: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "__tests__") continue;
        const p = nodePath.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.isFile() && p.endsWith(".ts")) prodFiles.push(p);
      }
    };
    walk(srcDir);
    expect(prodFiles.length).toBeGreaterThan(0);
    const deleteRe = /DELETE\s+FROM\s+(sources|source_chunks|source_corrections|node_sources)/;
    const deleteHolders = prodFiles.filter((f) => deleteRe.test(fs.readFileSync(f, "utf8")));
    expect(deleteHolders.map((f) => nodePath.relative(srcDir, f))).toEqual(["sources/forgetSource.ts"]);
    const callers = prodFiles.filter((f) => /forgetSourceByRequest/.test(fs.readFileSync(f, "utf8")));
    expect(callers.map((f) => nodePath.relative(srcDir, f)).sort()).toEqual([
      "api/routes/forgetRequests.ts",
      "sources/forgetSource.ts",
    ]);
  });

  it("T-B10 — migration rehearsal: pre-binding DB opens, episodic still applies, legacy refuses, bound flow works, reopen idempotent, fresh DB agrees", async () => {
    const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "verbatim-binding-"));
    const file = nodePath.join(dir, "brain.db");
    try {
      // Seed a pre-binding DB: boot the file, then remove the binding
      // column + index — the exact shape pre-binding code produced —
      // and seed an approved episodic request and an approved
      // NULL-target (legacy) request while the column is absent.
      const h0 = createDb(file);
      const h0Cols = (h0.sqlite.prepare(`PRAGMA table_info(forget_requests)`).all() as { name: string }[]).map((c) => c.name);
      // Index first: SQLite refuses DROP COLUMN while an index
      // references the column.
      h0.sqlite.exec(`DROP INDEX IF EXISTS idx_forget_requests_live_source`);
      if (h0Cols.includes("target_source_id")) {
        h0.sqlite.exec(`ALTER TABLE forget_requests DROP COLUMN target_source_id`);
      }
      const seededCols = (h0.sqlite.prepare(`PRAGMA table_info(forget_requests)`).all() as { name: string }[]).map((c) => c.name);
      expect(seededCols).not.toContain("target_source_id");
      const ep = h0.sqlite.prepare(
        `INSERT INTO episodes (space_id, kind, summary, occurred_at, recorded_at)
         VALUES ('legacy', 'conversation', 'legacy episode words', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
      ).run();
      const epId = Number(ep.lastInsertRowid);
      const epiReq = h0.sqlite.prepare(
        `INSERT INTO forget_requests (space_id, requested_by, status, scope_episode_ids) VALUES ('legacy', 'user', 'approved', ?)`,
      ).run(JSON.stringify([epId]));
      const epiReqId = Number(epiReq.lastInsertRowid);
      const legacyReq = h0.sqlite.prepare(
        `INSERT INTO forget_requests (space_id, requested_by, status) VALUES ('legacy', 'user', 'approved')`,
      ).run();
      const legacyReqId = Number(legacyReq.lastInsertRowid);
      h0.sqlite.close();

      const h2 = createDb(file);
      try {
        // (1) The DB opens under the new code; the PRAGMA-guarded ALTER
        // adds target_source_id (NULL on every pre-existing row) and
        // the live-source index; assertW2Schema passes (createDb
        // would throw otherwise).
        const cols = (h2.sqlite.prepare(`PRAGMA table_info(forget_requests)`).all() as { name: string }[]).map((c) => c.name);
        expect(cols).toContain("target_source_id");
        const legacyTarget = (h2.sqlite.prepare(`SELECT target_source_id FROM forget_requests WHERE id = ?`).get(legacyReqId) as { target_source_id: number | null }).target_source_id;
        expect(legacyTarget).toBeNull();
        const idx = h2.sqlite.prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_forget_requests_live_source'`).get() as { sql: string } | undefined;
        expect(idx?.sql).toContain("WHERE status IN ('pending','approved')");
        // (2) A pre-existing approved EPISODIC row still applies via
        // applyForgetRequest exactly as before.
        const epiRes = applyForgetRequest(h2, epiReqId);
        expect(epiRes.episodesTombstoned).toContain(epId);
        const epRow = h2.sqlite.prepare(`SELECT summary, forgotten_at FROM episodes WHERE id = ?`).get(epId) as { summary: string; forgotten_at: string | null };
        expect(epRow.summary).not.toBe("legacy episode words");
        expect(epRow.forgotten_at).not.toBeNull();
        // (3) A pre-existing approved row with target_source_id NULL
        // refuses (unbound_legacy_request) and deletes nothing.
        const repo2 = new SourcesRepo(h2, SPACE);
        const { source } = repo2.persistText({ kind: "note", citationClass: "verbatim_typed", text: "legacy survivor words" });
        expect(() => forgetSourceByRequest(h2, legacyReqId)).toThrow(/unbound_legacy_request/);
        expect(repo2.getById(source.id)).toBeDefined();
        // (4) A fresh bound request created, approved, and applied on
        // the migrated DB erases exactly its source.
        const created = createForgetSourceRequest(h2, SPACE, source.id);
        expect(created.sourceId).toBe(source.id);
        const inspected = inspectForgetSourceRequest(h2, SPACE, created.requestId);
        expect(inspected?.source?.contentHash).toBe(source.contentHash);
        const approved = approveForgetSourceRequest(h2, SPACE, created.requestId);
        expect(approved.status).toBe("approved");
        const res = forgetSourceByRequest(h2, approved.requestId);
        expect(res.sourceId).toBe(source.id);
        expect(repo2.getById(source.id)).toBeUndefined();
        // (5) Second open is idempotent (the ALTER is a no-op; the
        // index already exists).
        h2.sqlite.close();
        const h3 = createDb(file);
        try {
          const cols3 = (h3.sqlite.prepare(`PRAGMA table_info(forget_requests)`).all() as { name: string }[]).map((c) => c.name);
          expect(cols3).toContain("target_source_id");
          const idx3 = h3.sqlite.prepare(`SELECT 1 AS x FROM sqlite_master WHERE type = 'index' AND name = 'idx_forget_requests_live_source'`).get() as { x: number } | undefined;
          expect(idx3?.x).toBe(1);
        } finally {
          h3.sqlite.close();
        }
        // (6) Fresh-DB bootstrap produces the identical column (via
        // migrateSchema, per D1).
        const fresh = createDb(":memory:");
        try {
          const freshCols = (fresh.sqlite.prepare(`PRAGMA table_info(forget_requests)`).all() as { name: string }[]).map((c) => c.name);
          expect(freshCols).toContain("target_source_id");
        } finally {
          fresh.sqlite.close();
        }
      } finally {
        try {
          h2.sqlite.close();
        } catch {
          /* already closed at step (5) */
        }
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("T-B11 — cross-connection double-apply refuses: B applies first via a second handle, A refuses, exactly one successful apply", async () => {
    // Fix round 4 (audit P1, D7): the binding checks must be verified
    // in the same transaction as the erasure. This test drives two
    // handles on the SAME temp-file database (:memory: handles are
    // separate DBs, so a file is required) and changes the request
    // from connection B, then applies from connection A.
    const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "verbatim-d7-race-"));
    const file = nodePath.join(dir, "brain.db");
    const hA = createDb(file);
    const hB = createDb(file);
    try {
      const repoA = new SourcesRepo(hA, SPACE);
      const s1 = repoA.persistText({ kind: "note", citationClass: "verbatim_typed", text: "race one words here" }).source;
      const s2 = repoA.persistText({ kind: "note", citationClass: "verbatim_typed", text: "race two words here" }).source;
      const s3 = repoA.persistText({ kind: "note", citationClass: "verbatim_typed", text: "race three words here" }).source;
      const approveOn = (h: DbHandle, sourceId: number): number => {
        const created = createForgetSourceRequest(h, SPACE, sourceId);
        return approveForgetSourceRequest(h, SPACE, created.requestId).requestId;
      };
      const r1 = approveOn(hA, s1.id);
      const r2 = approveOn(hA, s2.id);
      const r3 = approveOn(hA, s3.id);
      const appliedAudits = (h: DbHandle, requestId: number): number =>
        (h.sqlite.prepare(
          `SELECT COUNT(*) AS c FROM agent_logs WHERE action = 'forget_source_applied' AND targets LIKE ?`,
        ).get(`%\"request_id\":${requestId}%`) as { c: number }).c;

      // Scenario 1 — B applies first; A's apply must refuse, and the
      // request must produce exactly ONE successful apply outcome.
      const resB = forgetSourceByRequest(hB, r1);
      expect(resB.sourceId).toBe(s1.id);
      expect(repoA.getById(s1.id)).toBeUndefined();
      expect(() => forgetSourceByRequest(hA, r1)).toThrow(/not_approved/);
      expect(appliedAudits(hA, r1)).toBe(1);
      expect(repoA.getById(s2.id)).toBeDefined();
      expect(repoA.getById(s3.id)).toBeDefined();

      // Scenario 2 — B flips the status out from under A (raw UPDATE
      // stands in for any concurrent status change); A refuses and
      // erases nothing.
      hB.sqlite.prepare(`UPDATE forget_requests SET status = 'rejected' WHERE id = ?`).run(r2);
      expect(() => forgetSourceByRequest(hA, r2)).toThrow(/not_approved/);
      expect(repoA.getById(s2.id)).toBeDefined();
      expect(appliedAudits(hA, r2)).toBe(0);

      // Scenario 3 — B rebinds the request to a source that does not
      // exist; A refuses and the originally bound source survives.
      hB.sqlite.prepare(`UPDATE forget_requests SET target_source_id = 999999 WHERE id = ?`).run(r3);
      expect(() => forgetSourceByRequest(hA, r3)).toThrow(/source_not_found/);
      expect(repoA.getById(s3.id)).toBeDefined();
      expect(appliedAudits(hA, r3)).toBe(0);
    } finally {
      hA.sqlite.close();
      hB.sqlite.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("T-B12 — mid-erasure race refuses: a concurrent apply landing between validation and the applied-marking must not produce a second success", () => {
    // Fix round 4 (audit P1, D7): the pre-transaction checks pass and
    // the final UPDATE ... WHERE status='approved' never checked its
    // .changes, so a second concurrent apply that passed the
    // pre-transaction check ran the whole erasure and returned
    // success. The race window is INSIDE one synchronous call, so it
    // cannot be driven by interleaving two handles in sequence — the
    // second handle's change would be visible to the first handle's
    // pre-transaction read. Instead this test simulates the
    // cross-connection race deterministically with a trigger: the
    // trigger stands in for connection B's apply landing after A's
    // validation but before A's applied-marking (the exact window the
    // audit names). No timing is involved.
    const repo = new SourcesRepo(handle, SPACE);
    const { source } = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "mid erasure race words" });
    const reqId = approvedForgetRequest(SPACE, source.id);
    handle.sqlite.exec(`
      CREATE TRIGGER d7_race_sim_flip
      BEFORE DELETE ON sources
      BEGIN
        UPDATE forget_requests SET status = 'applied', applied_at = '2026-10-25T00:00:00.000Z'
        WHERE target_source_id = OLD.id AND status = 'approved';
      END;
    `);
    try {
      // The simulated second apply already won: A's apply must refuse
      // (not_approved — the conditional marking found 0 rows), the
      // transaction must roll back, and the source must survive.
      expect(() => forgetSourceByRequest(handle, reqId)).toThrow(/not_approved/);
      expect(repo.getById(source.id)).toBeDefined();
      expect(sourceCount()).toBe(1);
      // The rolled-back erasure left no applied audit row; the refusal
      // itself is audited exactly once, content-free.
      const applied = handle.sqlite.prepare(
        `SELECT COUNT(*) AS c FROM agent_logs WHERE action = 'forget_source_applied' AND targets LIKE ?`,
      ).get(`%"request_id":${reqId}%`) as { c: number };
      expect(applied.c).toBe(0);
      expect(refusedAudits(reqId).length).toBe(1);
      // The request row is untouched by the rolled-back race: still
      // approved, still bound to the surviving source.
      const row = handle.sqlite.prepare(`SELECT status, target_source_id FROM forget_requests WHERE id = ?`).get(reqId) as {
        status: string; target_source_id: number | null;
      };
      expect(row.status).toBe("approved");
      expect(row.target_source_id).toBe(source.id);
    } finally {
      handle.sqlite.exec(`DROP TRIGGER IF EXISTS d7_race_sim_flip`);
    }
  });
});
