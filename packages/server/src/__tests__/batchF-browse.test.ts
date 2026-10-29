import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { ExtractionResult } from "@brain/shared";
import { createDb, type DbHandle } from "../db/client.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { GraphService } from "../graph/service.js";
import { keywordSearch } from "../db/fts.js";
import { getEmbedding, deleteEmbedding } from "../db/vec.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { EMBED_DIM } from "../db/vec.js";
import { ingest } from "../ingestion/pipeline.js";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import type { ContextNode, LinkCandidate, LinkValidation, LlmProvider } from "../llm/adapter.js";

const embeddings = new HashEmbeddingProvider(EMBED_DIM);

let handle: DbHandle;

const add = async (label: string, content: string, spaceId = "legacy", tags?: string[]) => {
  const repo = new NodesRepo(handle, spaceId);
  return repo.create(
    { label, type: "daily", content, tags } as never,
    await embeddings.embed(`${label}. ${content}`),
  );
};

beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => handle.sqlite.close());

describe("Batch F — REG-185 (SP-02): no invented match score", () => {
  it("keyword-only hits carry no cosine and no fake 50%", async () => {
    const target = await add("Harbor ledger", "notes about the boats");
    // No vector row: BM25-only by construction, so the hit can only come
    // from the keyword side.
    deleteEmbedding(handle.sqlite, target.id);
    const svc = new GraphService(handle, "legacy");
    const { hits } = await svc.search(embeddings, "Harbor", 5);
    const hit = hits.find((h) => h.id === target.id);
    expect(hit).toBeDefined();
    expect(hit!.matchKind).toBe("keyword");
    expect(hit!.similarity).toBeNull();
    // The old code shipped `similarity: simById.get(id) ?? 0.5` — no hit may
    // wear that invented constant, and every keyword-only hit is null-scored.
    for (const h of hits) {
      if (h.matchKind === "keyword") expect(h.similarity).toBeNull();
      expect(h.similarity).not.toBe(0.5);
    }
  });

  it("a hit on both sides keeps its real cosine and is marked as such", async () => {
    const target = await add("Zanzibar protocol", "the thing we agreed in March");
    const svc = new GraphService(handle, "legacy");
    const { hits } = await svc.search(embeddings, "Zanzibar protocol", 5);
    const hit = hits.find((h) => h.id === target.id);
    expect(hit).toBeDefined();
    expect(hit!.matchKind).toBe("both");
    expect(typeof hit!.similarity).toBe("number");
  });
});

describe("Batch F — REG-186 (SP-03): top-k honesty + no slot theft", () => {
  it("reports total/hasMore for a query matching more than the page", async () => {
    for (let i = 0; i < 12; i++) await add(`Quixotic note ${i}`, `a quixotic musing number ${i}`);
    const svc = new GraphService(handle, "legacy");
    const res = await svc.search(embeddings, "quixotic", 10);
    expect(res.hits).toHaveLength(10);
    expect(res.total).toBe(12);
    expect(res.hasMore).toBe(true);
    expect(res.totalCapped).toBe(false);
  });

  it("superseded nodes never shrink the page below the cap", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 12; i++) ids.push((await add(`Quixotic note ${i}`, `a quixotic musing number ${i}`)).id);
    const svc = new GraphService(handle, "legacy");
    handle.sqlite
      .prepare(`UPDATE nodes SET superseded_at = datetime('now') WHERE id IN (?, ?)`)
      .run(ids[0]!, ids[1]!);
    const res = await svc.search(embeddings, "quixotic", 10);
    expect(res.hits).toHaveLength(10);
    expect(res.total).toBe(10);
    expect(res.hasMore).toBe(false);
    expect(res.hits.map((h) => h.id)).not.toContain(ids[0]);
    expect(res.hits.map((h) => h.id)).not.toContain(ids[1]);
  });
});

describe("Batch F — REG-118 (BR-07): tags are searchable on the Search side", () => {
  it("a tag-only query finds the node through the tag path", async () => {
    const n = await add("Trip notes", "scribbles from the road", "legacy", ["paris-trip"]);
    deleteEmbedding(handle.sqlite, n.id); // isolate the tag path: no vector row
    const svc = new GraphService(handle, "legacy");
    const { hits } = await svc.search(embeddings, "paris", 5);
    const hit = hits.find((h) => h.id === n.id);
    expect(hit).toBeDefined();
    expect(hit!.matchKind).toBe("keyword");
  });
});

describe("Batch F — REG-190: one embedding composition on every write path", () => {
  it("ingest embeds 'label. content', the canonical composition", async () => {
    // Deterministic extraction stand-in (same shape as pipeline.test.ts).
    const llm = new FakeLlm({
      nodes: [{ label: "Zanzibar protocol", type: "daily", content: "the thing we agreed in March" }],
      edges: [],
    });
    const res = await ingest(handle, { embeddings, llm }, "the thing we agreed in March");
    expect(res.nodes).toHaveLength(1);
    const id = res.nodes[0]!.id;
    const stored = getEmbedding(handle.sqlite, id);
    expect(stored).toBeDefined();
    const expected = await embeddings.embed("Zanzibar protocol. the thing we agreed in March");
    expect(Array.from(stored!)).toEqual(Array.from(expected));
    const contentOnly = await embeddings.embed("the thing we agreed in March");
    expect(Array.from(stored!)).not.toEqual(Array.from(contentOnly));
  });
});

/** Deterministic LLM stand-in: research always relabels to a fixed new label,
 * so the FTS-label tests can tell the old title from the new one. */
class FakeLlm implements LlmProvider {
  readonly available = true;
  readonly model = "fake";
  constructor(private readonly extraction?: ExtractionResult) {}
  async extract(text: string, _ctx: ContextNode[]): Promise<ExtractionResult> {
    return (
      this.extraction ?? {
        nodes: [{ label: text.slice(0, 24), type: "daily", content: text }],
        edges: [],
      }
    );
  }
  async validateLink(
    _s: LinkCandidate,
    _t: LinkCandidate,
    similarity: number,
  ): Promise<LinkValidation> {
    return { linked: true, relationship: "relates_to", weight: similarity };
  }
  async synthesize(
    a: LinkCandidate,
    b: LinkCandidate,
    similarity: number,
  ): Promise<{ text: string; score: number }> {
    return { text: `${a.label} ~ ${b.label}`, score: similarity };
  }
  async detectContradiction(
    _a: LinkCandidate,
    _b: LinkCandidate,
    _similarity: number,
  ): Promise<{ conflict: boolean; text: string; score: number }> {
    return { conflict: false, text: "", score: 0 };
  }
  async interpretClarificationAnswer(): Promise<{ answers: boolean; confirmedStatement: string; confidence: number }> {
    return { answers: false, confirmedStatement: "", confidence: 0 };
  }
  async answer(
    _question: string,
    context: ContextNode[],
  ): Promise<{ answer: string; citations: number[] }> {
    return { answer: "ok", citations: context.map((c) => c.id) };
  }
  async research(_node: LinkCandidate): Promise<{ label: string; content: string }> {
    return { label: "Zanzibar protocol", content: "findings about the strait" };
  }
  async summarizeSector(_nodes: LinkCandidate[]): Promise<string> {
    return "calm";
  }
  async generateDailyLog(_n: LinkCandidate[], _a: string[]): Promise<string> {
    return "log";
  }
}

describe("Batch F — REG-104 (DET-02 FTS half) + REG-190 via the HTTP routes", () => {
  let ctx: AppContext;
  let server: Server;
  let base: string;
  let spaceId: string;

  beforeAll(async () => {
    ctx = await buildContext({
      dbPath: ":memory:",
      embeddings,
      llm: new FakeLlm(),
    });
    const app = createApp(ctx);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const auth = await fetch(`${base}/api/space/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gamerTag: "tester", passcode: "secret123", name: "tester" }),
    });
    spaceId = ((await auth.json()) as { id: string }).id;
  });

  afterAll(() => {
    server?.close();
    ctx.handle.sqlite.close();
  });

  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-space-id": spaceId },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it("answer-research indexes the POST-update label (and embeds label. content)", async () => {
    const repo = new NodesRepo(ctx.handle, spaceId);
    const n = repo.create(
      { label: "Harbor ledger", type: "daily", content: "notes about the boats" } as never,
      await embeddings.embed("Harbor ledger. notes about the boats"),
    );
    const { status } = await post(`/api/nodes/${n.id}/answer-research`, {
      answers: { "Which harbor?": "the old one" },
    });
    expect(status).toBe(200);
    const stored = repo.getById(n.id);
    expect(stored?.label).toBe("Zanzibar protocol");
    // Indexed label == stored label: the new title matches on the BM25 path
    // and the old title no longer matches.
    const ftsLabel = (
      ctx.handle.sqlite.prepare(`SELECT label FROM nodes_fts WHERE rowid = ?`).get(n.id) as { label: string }
    ).label;
    expect(ftsLabel).toBe("Zanzibar protocol");
    expect(keywordSearch(ctx.handle.sqlite, spaceId, "Zanzibar", 10).map((h) => h.nodeId)).toContain(n.id);
    expect(keywordSearch(ctx.handle.sqlite, spaceId, "Harbor", 10).map((h) => h.nodeId)).not.toContain(n.id);
    // REG-190 on the same path: the embedding is "label. content".
    const expanded = "notes about the boats\n\n--- Research Deep Dive ---\nfindings about the strait";
    const expected = await embeddings.embed(`Zanzibar protocol. ${expanded}`);
    expect(Array.from(getEmbedding(ctx.handle.sqlite, n.id)!)).toEqual(Array.from(expected));
  });

  it("synthesize indexes the POST-update label too", async () => {
    const repo = new NodesRepo(ctx.handle, spaceId);
    const n = repo.create(
      { label: "Harbor ledger", type: "daily", content: "notes about the boats" } as never,
      await embeddings.embed("Harbor ledger. notes about the boats"),
    );
    const { status } = await post(`/api/nodes/${n.id}/synthesize`, {});
    expect(status).toBe(200);
    const stored = repo.getById(n.id);
    expect(stored?.label).toBe("Zanzibar protocol");
    const ftsLabel = (
      ctx.handle.sqlite.prepare(`SELECT label FROM nodes_fts WHERE rowid = ?`).get(n.id) as { label: string }
    ).label;
    expect(ftsLabel).toBe("Zanzibar protocol");
    expect(keywordSearch(ctx.handle.sqlite, spaceId, "Zanzibar", 10).map((h) => h.nodeId)).toContain(n.id);
    expect(keywordSearch(ctx.handle.sqlite, spaceId, "Harbor", 10).map((h) => h.nodeId)).not.toContain(n.id);
  });

  it("the Details edit path embeds 'label. content' (canonical reference)", async () => {
    const repo = new NodesRepo(ctx.handle, spaceId);
    const n = repo.create(
      { label: "Draft title", type: "daily", content: "draft body" } as never,
      await embeddings.embed("Draft title. draft body"),
    );
    const res = await fetch(`${base}/api/nodes/${n.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-space-id": spaceId },
      body: JSON.stringify({ label: "Edited title", content: "edited body" }),
    });
    expect(res.status).toBe(200);
    const expected = await embeddings.embed("Edited title. edited body");
    expect(Array.from(getEmbedding(ctx.handle.sqlite, n.id)!)).toEqual(Array.from(expected));
  });
});
