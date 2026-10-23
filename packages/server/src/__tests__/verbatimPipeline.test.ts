import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import { buildContext } from "../context.js";
import { createApp } from "../api/server.js";
import { ingest, ingestWithContext, processSourceExtraction } from "../ingestion/pipeline.js";
import { SourcesRepo, MAX_EXTRACTION_ATTEMPTS } from "../repositories/sources.repo.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { mergeMemories } from "../analysis/dedup.js";
import { supersede } from "../agent/temporal.js";
import { recoverPendingSources } from "../sources/recovery.js";
import { saveTelegramNote } from "../telegram/notes.js";

/**
 * Verbatim-Recall V1 — pipeline/processing acceptance tests.
 * Criterion map: 14.1 typed/Telegram/chat exact preservation ·
 * 14.2 extraction independence · 14.3 regeneration independence ·
 * 14.4 idempotent replay incl. crash mid-extraction · 14.8 honest
 * persistence failure · 14.9 timezone-clean user-facing strings ·
 * 18.3 state machine (permanent failure + Inbox) ·
 * 18.5.14 single-winner race + kill/lease/boot-scan completion.
 */

const SPACE = "legacy";
const embeddings = new HashEmbeddingProvider(EMBED_DIM);
const sha = (s: string) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

let handle: DbHandle;
let ctx: AppContext;

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = { handle, embeddings, llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
});
afterEach(() => handle.sqlite.close());

class FlakyLlm extends HeuristicProvider {
  fail = true;
  async extract(text: string, context: never) {
    if (this.fail) throw new Error("extraction forced to fail");
    return super.extract(text, context);
  }
}

describe("14.1 exact preservation via typed / telegram / chat pipeline paths", () => {
  it("typed capture: source is byte-identical, hash matches, node carries an origin link", async () => {
    const text = "  awkward   spacing 😀\r\nand\ttabs  ";
    const result = await ingest(handle, { embeddings, llm: new HeuristicProvider() }, text, SPACE);
    const repo = new SourcesRepo(handle, SPACE);
    expect(repo.count()).toBe(1);
    const source = repo.list()[0]!;
    expect(source.kind).toBe("note");
    expect(source.rawText).toBe(text);
    expect(source.contentHash).toBe(sha(text));
    expect(source.processingStatus).toBe("extracted");
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.nodes[0]!.hasOriginSource).toBe(true);
    // Node reads expose the provenance flag too.
    expect(new NodesRepo(handle, SPACE).getById(result.nodes[0]!.id)?.hasOriginSource).toBe(true);
    const chunks = repo.chunksOf(source.id);
    expect(chunks.map((c) => c.text).join("")).toBe(text);
    expect(repo.activeLinksForNode(result.nodes[0]!.id).length).toBe(chunks.length);
  });

  it("telegram channel and chat channel stamp their source kinds", async () => {
    await ingestWithContext(handle, { embeddings, llm: new HeuristicProvider() }, ctx, "telegram words here", SPACE, { channel: "telegram" });
    await ingestWithContext(handle, { embeddings, llm: new HeuristicProvider() }, ctx, "chat words here", SPACE, { channel: "chat" });
    const kinds = new SourcesRepo(handle, SPACE).list().map((s) => s.kind).sort();
    expect(kinds).toEqual(["chat", "telegram"]);
  });

  it("telegram notes: saveTelegramNote persists a verbatim source + origin link for the assembled draft", async () => {
    const text = "first part\nsecond part — exactly as dictated 😀";
    const node = await saveTelegramNote(ctx, SPACE, text);
    expect(node.content).toBe(text);
    const repo = new SourcesRepo(handle, SPACE);
    const source = repo.list()[0]!;
    expect(source.kind).toBe("telegram");
    expect(source.rawText).toBe(text);
    expect(source.contentHash).toBe(sha(text));
    expect(source.processingStatus).toBe("extracted");
    expect(repo.nodeIdsWithOriginFrom(source.id)).toContain(node.id);
  });
});

describe("14.2 extraction independence", () => {
  it("forced extraction failure leaves the source exact and retryable; later extraction succeeds without re-capture", async () => {
    const llm = new FlakyLlm();
    const text = "words that must survive a broken extractor";
    await expect(ingest(handle, { embeddings, llm }, text, SPACE)).rejects.toThrow(/forced to fail/);
    const repo = new SourcesRepo(handle, SPACE);
    expect(repo.count()).toBe(1);
    const source = repo.list()[0]!;
    expect(source.rawText).toBe(text);
    expect(source.contentHash).toBe(sha(text));
    // 18.3's retryable state (14's 'preserved_unprocessed' concept).
    expect(source.processingStatus).toBe("extraction_failed");
    expect(repo.searchChunksFts("broken extractor").length).toBe(1); // still exact-searchable

    llm.fail = false;
    const recovered = await recoverPendingSources(handle, { embeddings, llm });
    expect(recovered.resumed).toBe(1);
    const after = repo.getById(source.id)!;
    expect(after.processingStatus).toBe("extracted");
    expect(after.extractionHash).toBeTruthy();
    expect(repo.count()).toBe(1); // no re-capture, no duplicate source
    expect(repo.nodeIdsWithOriginFrom(source.id).length).toBeGreaterThan(0);
  });

  it("a source persisted but never extracted sits at 'preserved' until the boot scan resumes it", async () => {
    const repo = new SourcesRepo(handle, SPACE);
    const { source } = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "pending words awaiting processing" });
    expect(source.processingStatus).toBe("preserved");
    const rec = await recoverPendingSources(handle, { embeddings, llm: new HeuristicProvider() });
    expect(rec.resumed).toBe(1);
    expect(repo.getById(source.id)!.processingStatus).toBe("extracted");
  });
});

describe("14.3 regeneration independence (merge / supersede)", () => {
  it("merge inherits origin links to the survivor; supersession copies them forward; the source never changes", async () => {
    const text = "merge me but keep my words intact";
    const result = await ingest(handle, { embeddings, llm: new HeuristicProvider() }, text, SPACE);
    const node = result.nodes[0]!;
    const repo = new SourcesRepo(handle, SPACE);
    const source = repo.list()[0]!;
    const hashBefore = source.contentHash;

    // Merge with a second, unrelated node: survivor inherits the links.
    const nodes = new NodesRepo(handle, SPACE);
    const other = nodes.create({ label: "other", type: "daily", content: "unrelated content" }, await embeddings.embed("unrelated content"));
    const ok = await mergeMemories(ctx, SPACE, other.id, node.id, "combined content");
    expect(ok).toBe(true);
    expect(repo.hasActiveOriginLink(other.id)).toBe(true);
    expect(repo.hasActiveOriginLink(node.id)).toBe(false); // deactivated, not erased
    const inactive = handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM node_sources WHERE node_id = ? AND active = 0`).get(node.id) as { c: number };
    expect(inactive.c).toBeGreaterThan(0);

    // Supersede the survivor (W1 writer): links copy forward.
    const sup = supersede(handle, SPACE, {
      oldNodeId: other.id,
      origin: "user_statement",
      correctionType: "factual_update",
      correctedBy: "user",
      newNode: { label: "replacement", type: "daily", content: "replacement content" },
    });
    const newId = sup.newNodeId!;
    expect(repo.hasActiveOriginLink(newId)).toBe(true);

    // The source is byte-identical throughout; quotes render chunk text.
    const after = repo.getById(source.id)!;
    expect(after.contentHash).toBe(hashBefore);
    expect(after.rawText).toBe(text);
    expect(repo.chunksOf(source.id)[0]!.text).toBe(text.slice(0, 1000));
  });
});

describe("14.4 idempotency: replay x3 incl. crash mid-extraction -> exactly one source", () => {
  it("replaying the same idempotency_key returns the one source and one node set", async () => {
    const deps = { embeddings, llm: new HeuristicProvider() };
    const meta = { idempotencyKey: "capture-key-1" };
    const r1 = await ingest(handle, deps, "replayable words", SPACE, meta);
    const r2 = await ingest(handle, deps, "replayable words", SPACE, meta);
    const r3 = await ingest(handle, deps, "replayable words", SPACE, meta);
    const repo = new SourcesRepo(handle, SPACE);
    expect(repo.count()).toBe(1);
    expect(r2.nodes.map((n) => n.id)).toEqual(r1.nodes.map((n) => n.id));
    expect(r3.nodes.map((n) => n.id)).toEqual(r1.nodes.map((n) => n.id));
    const nodeCount = (handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM nodes WHERE space_id = ?`).get(SPACE) as { c: number }).c;
    expect(nodeCount).toBe(r1.nodes.length);
  });

  it("crash mid-extraction: a dead claim blocks duplicates; boot scan completes it exactly once", async () => {
    const repo = new SourcesRepo(handle, SPACE);
    const { source } = repo.persistText({
      kind: "note", citationClass: "verbatim_typed", text: "crashed capture words",
      idempotencyKey: "crash-key",
    });
    // Simulate the crashed worker: claimed, lease already expired, no nodes.
    handle.sqlite
      .prepare(`UPDATE sources SET processing_status = 'extracting', processing_attempts = 1, processing_lease_owner = 'dead-worker', processing_lease_expires_at = ? WHERE id = ?`)
      .run(new Date(Date.now() - 1000).toISOString(), source.id);
    // A replayed capture with the same key must not duplicate the source.
    const replay = await ingest(handle, { embeddings, llm: new HeuristicProvider() }, "crashed capture words", SPACE, { idempotencyKey: "crash-key" });
    expect(repo.count()).toBe(1);
    expect(replay.nodes).toEqual([]); // lease still 'live' in the claim's eyes? — expired: reclaim path below is the completer

    const rec = await recoverPendingSources(handle, { embeddings, llm: new HeuristicProvider() });
    expect(rec.reclaimed).toBe(1);
    const done = repo.getById(source.id)!;
    expect(done.processingStatus).toBe("extracted");
    expect(repo.nodeIdsWithOriginFrom(source.id).length).toBe(1);
    // And a further replay still creates nothing new.
    await ingest(handle, { embeddings, llm: new HeuristicProvider() }, "crashed capture words", SPACE, { idempotencyKey: "crash-key" });
    expect(repo.count()).toBe(1);
    expect(repo.nodeIdsWithOriginFrom(source.id).length).toBe(1);
  });
});

describe("18.5.14 single-winner race", () => {
  it("two concurrent claims produce one extraction, one node set, no duplicate links", async () => {
    let extractCalls = 0;
    const slowLlm = new (class extends HeuristicProvider {
      async extract(text: string, context: never) {
        extractCalls++;
        await new Promise((r) => setTimeout(r, 60));
        return super.extract(text, context);
      }
    })();
    const repo = new SourcesRepo(handle, SPACE);
    const { source } = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "race this capture exactly once" });
    const deps = { embeddings, llm: slowLlm as HeuristicProvider };
    await Promise.all([
      processSourceExtraction(handle, deps, source.id, SPACE),
      processSourceExtraction(handle, deps, source.id, SPACE),
    ]);
    expect(extractCalls).toBe(1);
    const nodeIds = repo.nodeIdsWithOriginFrom(source.id);
    expect(nodeIds.length).toBe(1);
    const linkCount = (handle.sqlite.prepare(`SELECT COUNT(*) AS c FROM node_sources WHERE source_id = ? AND active = 1`).get(source.id) as { c: number }).c;
    expect(linkCount).toBe(repo.chunksOf(source.id).length);
    expect(repo.getById(source.id)!.processingStatus).toBe("extracted");
  });
});

describe("18.3 permanent failure surfacing", () => {
  it("after 5 attempts the source is failed_permanent, an Inbox item exists, and the source stays searchable", () => {
    const repo = new SourcesRepo(handle, SPACE);
    const { source } = repo.persistText({ kind: "note", citationClass: "verbatim_typed", text: "doomed but preserved words" });
    for (let i = 0; i < MAX_EXTRACTION_ATTEMPTS; i++) {
      const claimed = repo.claim(source.id, `worker-${i}`);
      expect(claimed).not.toBeNull();
      repo.failExtraction(source.id, `worker-${i}`);
    }
    const after = repo.getById(source.id)!;
    expect(after.processingStatus).toBe("failed_permanent");
    expect(after.processingAttempts).toBe(MAX_EXTRACTION_ATTEMPTS);
    const inbox = handle.sqlite
      .prepare(`SELECT text FROM inbox_notifications WHERE space_id = ? AND dedupe_key = ?`)
      .get(SPACE, `source-failed-permanent:${source.id}`) as { text: string } | undefined;
    expect(inbox).toBeDefined();
    // 14.9: the user-facing string carries no UTC / machine timestamps.
    expect(inbox!.text).not.toMatch(/UTC|Z$|\d{4}-\d{2}-\d{2}T/);
    expect(inbox!.text).toContain("preserved and searchable");
    expect(repo.searchChunksFts("doomed but preserved").length).toBe(1);
    // No further claims are possible from a terminal state.
    expect(repo.claim(source.id, "late-worker")).toBeNull();
  });

  it("14.9: occurred_at is stored verbatim as supplied (no timezone rewriting at the storage layer)", () => {
    const repo = new SourcesRepo(handle, SPACE);
    const { source } = repo.persistText({
      kind: "note", citationClass: "verbatim_typed", text: "tz check",
      occurredAt: "2026-10-23T09:15:00.000Z",
    });
    expect(source.occurredAt).toBe("2026-10-23T09:15:00.000Z");
  });
});

describe("14.8 honest persistence failure (pipeline level)", () => {
  it("a broken FTS table rolls the whole capture back: error reported, no source row, nothing claimed", async () => {
    const h2 = createDb(":memory:");
    try {
      h2.sqlite.exec(`DROP TABLE sources_fts`);
      await expect(
        ingest(h2, { embeddings, llm: new HeuristicProvider() }, "words that cannot be kept", SPACE),
      ).rejects.toThrow();
      const count = (h2.sqlite.prepare(`SELECT COUNT(*) AS c FROM sources`).get() as { c: number }).c;
      expect(count).toBe(0);
      const chunkCount = (h2.sqlite.prepare(`SELECT COUNT(*) AS c FROM source_chunks`).get() as { c: number }).c;
      expect(chunkCount).toBe(0);
    } finally {
      h2.sqlite.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Route-level wiring: action branch pre-trim source + file-import class.
// ---------------------------------------------------------------------------
describe("ingest route wiring (action branch + document import)", () => {
  let actx: AppContext;
  let server: Server;
  let base: string;
  let spaceId: string;

  beforeAll(async () => {
    actx = await buildContext({
      dbPath: ":memory:",
      embeddings: new HashEmbeddingProvider(EMBED_DIM),
      llm: new HeuristicProvider(),
    });
    const app = createApp(actx);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const auth = await fetch(`${base}/api/space/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gamerTag: "v1tester", passcode: "secret123", name: "v1tester" }),
    });
    spaceId = ((await auth.json()) as { id: string }).id;
  });
  afterAll(() => {
    server?.close();
    actx.handle.sqlite.close();
  });

  async function post(path: string, body: unknown): Promise<{ status: number; body: never }> {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-space-id": spaceId },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as never };
  }

  it("action branch: source holds the UNTRIMMED text while the node keeps the trimmed content", async () => {
    const { status, body } = await post("/api/ingest", { text: "  buy oat milk  ", kind: "action" });
    expect(status).toBe(200);
    expect((body as { nodes: { content: string }[] }).nodes[0]!.content).toBe("buy oat milk");
    const repo = new SourcesRepo(actx.handle, spaceId);
    const source = repo.list().find((s) => s.rawText?.includes("oat milk"))!;
    expect(source.rawText).toBe("  buy oat milk  ");
    expect(source.processingStatus).toBe("extracted");
  });

  it("file import: sourceKind document lands as kind document / class imported_text over the submitted text", async () => {
    const { status } = await post("/api/ingest", { text: "extracted file contents here", sourceKind: "document" });
    expect(status).toBe(200);
    const repo = new SourcesRepo(actx.handle, spaceId);
    const source = repo.list().find((s) => s.rawText === "extracted file contents here")!;
    expect(source.kind).toBe("document");
    expect(source.citationClass).toBe("imported_text");
    expect(source.contentHash).toBe(sha("extracted file contents here"));
  });

  it("route idempotency: the same idempotencyKey posted twice yields one source", async () => {
    await post("/api/ingest", { text: "route replay words", idempotencyKey: "route-key-9" });
    await post("/api/ingest", { text: "route replay words", idempotencyKey: "route-key-9" });
    const repo = new SourcesRepo(actx.handle, spaceId);
    expect(repo.list().filter((s) => s.idempotencyKey === "route-key-9").length).toBe(1);
  });

  it("graph restore route round-trips an export and rejects a tampered one with 422", async () => {
    const expRes = await fetch(`${base}/api/graph/export`, { headers: { "x-space-id": spaceId } });
    const payload = (await expRes.json()) as { version?: number; sources?: unknown[] };
    expect(payload.version).toBe(2);
    // Restore into the same space would collide on ids; use a fresh space.
    const auth2 = await fetch(`${base}/api/space/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gamerTag: "v1restore", passcode: "secret123", name: "v1restore" }),
    });
    const space2 = ((await auth2.json()) as { id: string }).id;
    const okRes = await fetch(`${base}/api/graph/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-space-id": space2 },
      body: JSON.stringify(payload),
    });
    expect(okRes.status).toBe(200);
    const rep = (await okRes.json()) as { sourcesRestored: number };
    expect(rep.sourcesRestored).toBe(payload.sources?.length ?? 0);

    const tampered = JSON.parse(JSON.stringify(payload));
    tampered.sources[0].rawBytesBase64 = Buffer.from("forged words").toString("base64");
    const auth3 = await fetch(`${base}/api/space/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gamerTag: "v1restore2", passcode: "secret123", name: "v1restore2" }),
    });
    const space3 = ((await auth3.json()) as { id: string }).id;
    const badRes = await fetch(`${base}/api/graph/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-space-id": space3 },
      body: JSON.stringify(tampered),
    });
    expect(badRes.status).toBe(422);
  });
});
