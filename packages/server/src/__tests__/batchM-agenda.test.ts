import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { ExtractionResult } from "@brain/shared";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { EMBED_DIM } from "../db/vec.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import type { ContextNode, LinkCandidate, LinkValidation, LlmProvider } from "../llm/adapter.js";
import { ingest } from "../ingestion/pipeline.js";
import { JourneysRepo } from "../repositories/journeys.repo.js";

/**
 * Batch M (Agenda/Journeys) regression tests.
 * REG-143 (AG-04): one "add reminder" must stamp remindAt on exactly one node.
 * REG-162 (JN-05): span start/end compare space-local calendar days, not instants.
 */

/** Deterministic LLM stand-in returning a fixed multi-node extraction. */
class FakeLlm implements LlmProvider {
  readonly available = true;
  readonly model = "fake";
  constructor(private readonly extraction: ExtractionResult) {}
  async extract(_text: string, _ctx: ContextNode[]): Promise<ExtractionResult> {
    return this.extraction;
  }
  async validateLink(_s: LinkCandidate, _t: LinkCandidate, similarity: number): Promise<LinkValidation> {
    return { linked: true, relationship: "relates_to", weight: similarity };
  }
  async synthesize(_a: LinkCandidate, _b: LinkCandidate, _s: number): Promise<{ text: string; score: number }> {
    return { text: "x ~ y", score: 0.5 };
  }
  async detectContradiction(_a: LinkCandidate, _b: LinkCandidate, _s: number): Promise<{ conflict: boolean; text: string; score: number }> {
    return { conflict: false, text: "", score: 0 };
  }
  async interpretClarificationAnswer(): Promise<{ answers: boolean; confirmedStatement: string; confidence: number }> {
    return { answers: false, confirmedStatement: "", confidence: 0 };
  }
  async answer(_q: string, context: ContextNode[]): Promise<{ answer: string; citations: number[] }> {
    return { answer: "ok", citations: context.map((c) => c.id) };
  }
  async research(node: LinkCandidate): Promise<{ label: string; content: string }> {
    return { label: node.label, content: node.content };
  }
  async summarizeSector(_nodes: LinkCandidate[]): Promise<string> {
    return "calm";
  }
  async generateDailyLog(_n: LinkCandidate[], _a: string[]): Promise<string> {
    return "log";
  }
}

let handle: DbHandle;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => {
  handle.sqlite.close();
});

describe("REG-143 (AG-04) — one reminder submission stamps remindAt once", () => {
  it("stamps remindAt on the FIRST extracted node only, never on the rest", async () => {
    const llm = new FakeLlm({
      nodes: [
        { label: "Call the dentist", type: "daily", content: "Call the dentist" },
        { label: "Buy oat milk", type: "daily", content: "Buy oat milk" },
      ],
      edges: [],
    });
    const when = new Date(Date.now() + 3600_000).toISOString();
    const res = await ingest(handle, { embeddings, llm }, "Call the dentist and buy oat milk", "s1", {
      remindAt: when,
    });
    expect(res.nodes).toHaveLength(2);
    expect(res.nodes[0]!.remindAt).toBe(when);
    expect(res.nodes[1]!.remindAt ?? null).toBeNull();
    // Exactly one firing reminder exists in the DB for this submission.
    const stamped = handle.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM nodes WHERE space_id = ? AND remind_at = ?`)
      .get("s1", when) as { n: number };
    expect(stamped.n).toBe(1);
  });

  it("still stamps occurredAt/tags on every node — only remindAt is first-only", async () => {
    const llm = new FakeLlm({
      nodes: [
        { label: "First memory", type: "daily", content: "First memory" },
        { label: "Second memory", type: "daily", content: "Second memory" },
      ],
      edges: [],
    });
    const res = await ingest(handle, { embeddings, llm }, "two memories", "s1", {
      occurredAt: "2026-10-20T10:00:00.000Z",
      tags: ["errand"],
    });
    expect(res.nodes).toHaveLength(2);
    for (const n of res.nodes) {
      expect(n.occurredAt).toBe("2026-10-20T10:00:00.000Z");
      expect(n.tags).toEqual(["errand"]);
    }
  });
});

describe("REG-162 (JN-05) — span edges compare space-local calendar days", () => {
  function makeNodeAt(spaceId: string, createdAt: string): number {
    return Number(
      handle.sqlite
        .prepare(`INSERT INTO nodes (space_id, label, type, content, created_at) VALUES (?, 'n', 'knowledge', 'c', ?)`)
        .run(spaceId, createdAt).lastInsertRowid,
    );
  }
  function makeIncome(spaceId: string, date: string): number {
    return Number(
      handle.sqlite
        .prepare(`INSERT INTO fin_income (space_id, date, net_cents, platform) VALUES (?, ?, 100, 'Gig')`)
        .run(spaceId, date).lastInsertRowid,
    );
  }
  function makeExpense(spaceId: string, date: string): number {
    return Number(
      handle.sqlite
        .prepare(`INSERT INTO fin_expense (space_id, date, amount_cents) VALUES (?, ?, 500)`)
        .run(spaceId, date).lastInsertRowid,
    );
  }

  it("a memory logged 01:00 UTC Jan 1 (Dec 31 evening in New York) beats a Jan 1 income row for the span start", () => {
    // Space "s1" has no space_meta row, so the repo falls back to the shared
    // default zone America/New_York — the owner's space zone.
    const repo = new JourneysRepo(handle, "s1");
    const j = repo.create({ title: "Mixed kinds" });
    repo.link(j.id, "node", makeNodeAt("s1", "2026-01-01 01:00:00"));
    repo.link(j.id, "income", makeIncome("s1", "2026-01-01"));
    const span = repo.spanFor(repo.get(j.id)!);
    // The memory's lived day is Dec 31; the bare Jan 1 income date is Jan 1.
    expect(span.startSource).toBe("links");
    expect(span.startDate).toBe("2025-12-31");
  });

  it("mirrors at the end: a memory logged late-evening Jan 10 (04:30 UTC Jan 11) loses to a bare Jan 11 expense row for the span end", () => {
    const repo = new JourneysRepo(handle, "s1");
    const j = repo.create({ title: "Mixed kinds end", status: "done" });
    // 04:30 UTC Jan 11 is 23:30 Jan 10 in New York — its lived day is Jan 10.
    repo.link(j.id, "node", makeNodeAt("s1", "2026-01-11 04:30:00"));
    repo.link(j.id, "expense", makeExpense("s1", "2026-01-11"));
    const span = repo.spanFor(repo.get(j.id)!);
    // Old instant comparison let the memory (04:30 UTC) win and the span end
    // read Jan 10; the latest SPACE-local day is the expense's Jan 11.
    expect(span.endSource).toBe("links");
    expect(span.endDate).toBe("2026-01-11");
    expect(span.end).toBe("2026-01-11");
  });
});

/* ------------------------------------------------------------------ *
 * Route-level: REG-160 (JN-03) journeyProgress carries the title, and
 * REG-144 (AG-05) the action branch never stores a remindAt.
 * ------------------------------------------------------------------ */
describe("Batch M routes — DELETE /nodes journeyProgress + ingest action backstop", () => {
  let ctx: AppContext;
  let server: Server;
  let base: string;
  let spaceId: string;

  beforeAll(async () => {
    ctx = await buildContext({ dbPath: ":memory:", embeddings: new HashEmbeddingProvider(EMBED_DIM), llm: new HeuristicProvider() });
    const app = createApp(ctx);
    await new Promise<void>((r) => { server = app.listen(0, () => r()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const auth = await fetch(`${base}/api/space/auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gamerTag: "batchm", passcode: "secret123", name: "batchm" }) });
    spaceId = ((await auth.json()) as { id: string }).id;
  });
  afterAll(() => { server?.close(); ctx.handle.sqlite.close(); });

  async function req(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", "x-space-id": spaceId }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }

  it("REG-160: deleting a linked action returns journeyProgress naming the journey, its progress, and its missions completed", async () => {
    const { body: created } = await req("POST", "/api/journeys", { title: "Become an RN" });
    const journeyId = created.id as number;
    const { body: made } = await req("POST", "/api/ingest", { text: "finish the first module please", kind: "action", ttlHours: 24 });
    const actionId = made.nodes[0].id as number;
    const linked = await req("POST", `/api/journeys/${journeyId}/link`, { kind: "task", refId: actionId });
    expect(linked.status).toBe(200);
    const deleted = await req("DELETE", `/api/nodes/${actionId}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.journeyProgress).toHaveLength(1);
    expect(deleted.body.journeyProgress[0]).toMatchObject({
      journeyId,
      title: "Become an RN",
      missionsCompleted: 1,
    });
    expect(deleted.body.journeyProgress[0].progress).toBe(1);
  });

  it("REG-144: an action created with a remindAt stores no remindAt (the backstop)", async () => {
    const when = new Date(Date.now() + 3600_000).toISOString();
    const { body: made } = await req("POST", "/api/ingest", { text: "buy the milk please", kind: "action", ttlHours: 24, remindAt: when });
    expect(made.nodes).toHaveLength(1);
    const got = await req("GET", `/api/nodes/${made.nodes[0].id}`);
    expect(got.body.remindAt ?? null).toBeNull();
  });

  it("REG-144 (AG-05): PATCH /:id/agenda cannot put a remindAt on an action", async () => {
    const when = new Date(Date.now() + 3600_000).toISOString();
    const { body: made } = await req("POST", "/api/ingest", { text: "buy the milk please", kind: "action", ttlHours: 24 });
    const actionId = made.nodes[0].id as number;
    const patched = await req("PATCH", `/api/nodes/${actionId}/agenda`, { label: "buy the milk (rescheduled)", remindAt: when });
    expect(patched.status).toBe(200);
    // The label edit lands, but the remindAt is dropped — an action can never carry one.
    expect(patched.body.label).toBe("buy the milk (rescheduled)");
    expect(patched.body.remindAt ?? null).toBeNull();
    const got = await req("GET", `/api/nodes/${actionId}`);
    expect(got.body.remindAt ?? null).toBeNull();
  });

  it("REG-144 (AG-05): PATCH /:id/agenda still sets remindAt on a memory (kind-scoped, not a blanket drop)", async () => {
    const when = new Date(Date.now() + 3600_000).toISOString();
    const { body: made } = await req("POST", "/api/ingest", { text: "dentist called about the appointment" });
    const memId = made.nodes[0].id as number;
    const patched = await req("PATCH", `/api/nodes/${memId}/agenda`, { remindAt: when });
    expect(patched.status).toBe(200);
    expect(patched.body.remindAt).toBe(when);
  });
});
