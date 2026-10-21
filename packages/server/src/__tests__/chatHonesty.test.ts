import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { ResilientLlmProvider } from "../llm/resilient.js";
import { EMBED_DIM } from "../db/vec.js";
import type { EmbeddingProvider } from "../embeddings/adapter.js";
import type { LlmProvider } from "../llm/adapter.js";

/**
 * Screenshot Fixes Package A — Findings 1 (route half), 2, 8 (server half).
 *
 * The deadline constants in chat/graphrag.ts are read from env at module
 * load, so this file sets tiny budgets BEFORE importing it (dynamic import
 * in beforeAll) — the production defaults stay 2.5s embed / 9s turn.
 */
process.env.CHAT_EMBED_TIMEOUT_MS = "60";
process.env.CHAT_TURN_DEADLINE_MS = "700";

type Graphrag = typeof import("../chat/graphrag.js");
let chat: Graphrag["chat"];
let DEFAULT_CHAT: Graphrag["DEFAULT_CHAT"];

beforeAll(async () => {
  const g = await import("../chat/graphrag.js");
  chat = g.chat;
  DEFAULT_CHAT = g.DEFAULT_CHAT;
});

let handle: DbHandle;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => {
  handle.sqlite.close();
  vi.restoreAllMocks();
});

/** A minimal cloud-shaped provider: available, answers directly. */
function cloudLlm(answerImpl?: LlmProvider["answer"]): LlmProvider {
  const base = new HeuristicProvider();
  return {
    ...Object.getPrototypeOf(base),
    available: true,
    model: "fake-cloud",
    extract: base.extract.bind(base),
    validateLink: base.validateLink.bind(base),
    synthesize: base.synthesize.bind(base),
    detectContradiction: base.detectContradiction.bind(base),
    interpretClarificationAnswer: base.interpretClarificationAnswer.bind(base),
    answer: answerImpl ?? (async () => ({ answer: "A full cloud answer.", citations: [] })),
    research: base.research.bind(base),
    summarizeSector: base.summarizeSector.bind(base),
    generateDailyLog: base.generateDailyLog.bind(base),
  } as LlmProvider;
}

describe("Finding 2 — chat() threads the degraded state into ChatResponse", () => {
  it("flags the offline heuristic (no key) as degraded/offline, with no connect-a-key line in the answer", async () => {
    const res = await chat(handle, { embeddings, llm: new HeuristicProvider() }, "what do you know about my car?", DEFAULT_CHAT);
    expect(res.degraded).toEqual({ reason: "offline" });
    expect(res.answer).not.toContain("Connect an OpenAI or Gemini key");
  });

  it("does NOT flag a healthy cloud answer", async () => {
    const res = await chat(handle, { embeddings, llm: cloudLlm() }, "hello there", DEFAULT_CHAT);
    expect(res.answer).toBe("A full cloud answer.");
    expect(res.degraded).toBeUndefined();
  });

  it("flags a quota fallback with reason 'quota' (not the old connect-a-key misdiagnosis)", async () => {
    const failing = cloudLlm(async () => {
      throw new Error("You exceeded your current quota, please check your billing");
    });
    const resilient = new ResilientLlmProvider(failing);
    const res = await chat(handle, { embeddings, llm: resilient }, "hello there", DEFAULT_CHAT);
    expect(res.degraded).toEqual({ reason: "quota" });
    expect(res.answer).not.toContain("Connect an OpenAI or Gemini key");
  });

  it("flags a single non-fatal cloud failure as degraded/error even though the provider never trips its cooldown", async () => {
    const failing = cloudLlm(async () => {
      throw new Error("boom, unrelated failure");
    });
    const resilient = new ResilientLlmProvider(failing);
    const res = await chat(handle, { embeddings, llm: resilient }, "hello there", DEFAULT_CHAT);
    expect(resilient.degraded).toBe(false); // provider-wide state untouched…
    expect(res.degraded).toEqual({ reason: "error" }); // …but THIS turn is honest
  });

  it("flags a budget-blocked provider as degraded/budget", async () => {
    const resilient = new ResilientLlmProvider(cloudLlm(), undefined, undefined, () => true);
    const res = await chat(handle, { embeddings, llm: resilient }, "hello there", DEFAULT_CHAT);
    expect(res.degraded).toEqual({ reason: "budget" });
  });
});

describe("Finding 8 — a chat turn has a real time budget", () => {
  it("a hanging embedding step no longer hangs the turn: it completes degraded/timeout with keyword-only retrieval", async () => {
    const hangingEmbeddings: EmbeddingProvider = {
      dim: EMBED_DIM,
      model: "hanging",
      embed: () => new Promise<Float32Array>(() => {}), // never settles
      embedBatch: async () => [],
    };
    const start = Date.now();
    const res = await chat(handle, { embeddings: hangingEmbeddings, llm: cloudLlm() }, "hello there", DEFAULT_CHAT);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5_000);
    expect(res.answer).toBe("A full cloud answer."); // the turn still completed
    expect(res.degraded).toEqual({ reason: "timeout" }); // …and says retrieval was limited
  });

  it("a hanging answer call is cut at the turn deadline and completes as a flagged offline reply", async () => {
    const hanging = cloudLlm(() => new Promise(() => {})); // never settles
    const start = Date.now();
    const res = await chat(handle, { embeddings, llm: hanging }, "what is happening with my money lately?", DEFAULT_CHAT);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5_000);
    expect(res.degraded).toEqual({ reason: "timeout" });
    expect(res.answer.length).toBeGreaterThan(0);
    expect(res.answer).toContain("offline mind"); // the heuristic fallback answered, leading with its limitation
  });
});

describe("Finding 1 (route) — chat-body 400s are plain-language and log the failing field server-side only", () => {
  let server: Server;
  let base: string;
  let spaceId: string;
  let ctxHandle: DbHandle;

  beforeAll(async () => {
    const { buildContext } = await import("../context.js");
    const { createApp } = await import("../api/server.js");
    const ctx = await buildContext({
      dbPath: ":memory:",
      embeddings: new HashEmbeddingProvider(EMBED_DIM),
      llm: new HeuristicProvider(),
    });
    ctxHandle = ctx.handle;
    const app = createApp(ctx);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const auth = await fetch(`${base}/api/space/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gamerTag: "honesty", passcode: "secret123", name: "honesty" }),
    });
    spaceId = ((await auth.json()) as { id: string }).id;
  }, 60_000);

  afterAll(() => {
    server?.close();
    ctxHandle?.sqlite.close();
  });

  async function postChat(path: string, body: unknown): Promise<{ status: number; body: { error?: string } }> {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-space-id": spaceId },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as { error?: string } };
  }

  it("POST /api/chat with an over-long history entry returns plain language (never the raw contract string) and logs the field", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const secret = "x".repeat(4001);
    const r = await postChat("/api/chat", {
      question: "hi",
      history: [{ role: "you", text: secret }],
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBeTruthy();
    expect(r.body.error).not.toContain("Body must be");
    expect(r.body.error).not.toContain("question: string");
    // The failing field + rule reached the server log; the content never did.
    const logged = warn.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("history.0.text");
    expect(logged).not.toContain(secret);
  });

  it("POST /api/chat/agent validates the same way and also answers in plain language", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await postChat("/api/chat/agent", { question: "q".repeat(2001) });
    expect(r.status).toBe(400);
    expect(r.body.error).not.toContain("Body must be");
    const logged = warn.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("question");
  });
});
