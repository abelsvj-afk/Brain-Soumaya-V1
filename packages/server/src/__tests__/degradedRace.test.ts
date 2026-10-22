import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { EMBED_DIM } from "../db/vec.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { ResilientLlmProvider } from "../llm/resilient.js";
import type { AnswerResult, LlmProvider } from "../llm/adapter.js";
import { chat, DEFAULT_CHAT } from "../chat/graphrag.js";

/**
 * Audit-2 item 1 — degraded-flag race (falsification).
 *
 * `ResilientLlmProvider` used to keep the per-call degraded reason in ONE
 * mutable instance field (`lastAnswerReason`, exposed as
 * `lastAnswerDegradedReason`), and chat() read it AFTER awaiting answer() —
 * a read-after-await of shared mutable state on a process-wide singleton.
 * Concurrent turns could swap Limited-mode flags in either direction.
 *
 * The fix: the reason travels WITH the individual result
 * (`AnswerResult.degradedReason`), and chat() reads it from its own `raw`.
 *
 * These tests put two calls in flight together on ONE shared provider and
 * settle their primaries through deferred gates — the overlap is exact by
 * construction, not timing luck: both primaries are provably invoked (and
 * neither has settled) before any gate is released, and both gates are
 * then released synchronously in one block. Each result/response must
 * carry its OWN flag: the fallback call is degraded/"error", the healthy
 * call is not degraded at all — in BOTH start orders.
 */

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const FALLBACK_Q = "fallback question";
const HEALTHY_Q = "healthy question";
const HEALTHY_ANSWER = "A full healthy cloud answer.";

/** A cloud-shaped primary whose answer() is fully gate-controlled per question. */
function scriptedPrimary(onAnswerStart?: () => void) {
  const base = new HeuristicProvider();
  const gates = new Map<string, Deferred<AnswerResult>>();
  gates.set(FALLBACK_Q, deferred<AnswerResult>());
  gates.set(HEALTHY_Q, deferred<AnswerResult>());
  const provider = {
    available: true,
    model: "fake-cloud",
    extract: base.extract.bind(base),
    validateLink: base.validateLink.bind(base),
    synthesize: base.synthesize.bind(base),
    detectContradiction: base.detectContradiction.bind(base),
    interpretClarificationAnswer: base.interpretClarificationAnswer.bind(base),
    answer: (question: string) => {
      onAnswerStart?.();
      const gate = gates.get(question);
      if (!gate) throw new Error(`unscripted question: ${question}`);
      return gate.promise;
    },
    research: base.research.bind(base),
    summarizeSector: base.summarizeSector.bind(base),
    generateDailyLog: base.generateDailyLog.bind(base),
  } as unknown as LlmProvider;
  return { provider, gates };
}

/** Release both gates in one synchronous block: fallback fails (non-fatal,
 *  so no cooldown trips), healthy succeeds. */
function settleBoth(gates: Map<string, Deferred<AnswerResult>>): void {
  gates.get(FALLBACK_Q)!.reject(new Error("boom, unrelated failure"));
  gates.get(HEALTHY_Q)!.resolve({ answer: HEALTHY_ANSWER, citations: [] });
}

describe("audit-2 item 1 — provider level: concurrent answer() results carry their own degraded reason", () => {
  it("fallback starts first", async () => {
    let started = 0;
    const { provider, gates } = scriptedPrimary(() => started++);
    const resilient = new ResilientLlmProvider(provider);

    const pFallback = resilient.answer(FALLBACK_Q, []);
    const pHealthy = resilient.answer(HEALTHY_Q, []);
    // Both calls are in flight; neither primary has settled.
    expect(started).toBe(2);

    settleBoth(gates);
    const [fallback, healthy] = await Promise.all([pFallback, pHealthy]);

    expect(fallback.degradedReason).toBe("error");
    expect(fallback.answer).toContain("offline mind");
    expect(healthy.degradedReason).toBeNull();
    expect(healthy.answer).toBe(HEALTHY_ANSWER);
    // The non-fatal failure must not have degraded the provider as a whole.
    expect(resilient.degraded).toBe(false);
  });

  it("healthy starts first", async () => {
    let started = 0;
    const { provider, gates } = scriptedPrimary(() => started++);
    const resilient = new ResilientLlmProvider(provider);

    const pHealthy = resilient.answer(HEALTHY_Q, []);
    const pFallback = resilient.answer(FALLBACK_Q, []);
    expect(started).toBe(2);

    settleBoth(gates);
    const [healthy, fallback] = await Promise.all([pHealthy, pFallback]);

    expect(healthy.degradedReason).toBeNull();
    expect(healthy.answer).toBe(HEALTHY_ANSWER);
    expect(fallback.degradedReason).toBe("error");
    expect(fallback.answer).toContain("offline mind");
    expect(resilient.degraded).toBe(false);
  });
});

describe("audit-2 item 1 — chat level: concurrent chat() turns carry their own degraded flag", () => {
  let handle: DbHandle;
  const embeddings = new HashEmbeddingProvider(EMBED_DIM);

  beforeEach(() => {
    handle = createDb(":memory:");
  });
  afterEach(() => {
    handle.sqlite.close();
  });

  async function runConcurrentChats(first: "fallback" | "healthy") {
    let started = 0;
    const bothStarted = deferred<void>();
    const { provider, gates } = scriptedPrimary(() => {
      started++;
      if (started === 2) bothStarted.resolve(undefined);
    });
    const resilient = new ResilientLlmProvider(provider);
    const deps = { embeddings, llm: resilient as LlmProvider };

    const askFallback = () => chat(handle, deps, FALLBACK_Q, DEFAULT_CHAT);
    const askHealthy = () => chat(handle, deps, HEALTHY_Q, DEFAULT_CHAT);
    const pFirst = first === "fallback" ? askFallback() : askHealthy();
    const pSecond = first === "fallback" ? askHealthy() : askFallback();

    // Both turns are now parked inside their gated primary answer() calls.
    await bothStarted.promise;
    settleBoth(gates);

    const [firstRes, secondRes] = await Promise.all([pFirst, pSecond]);
    return first === "fallback"
      ? { fallbackRes: firstRes, healthyRes: secondRes }
      : { fallbackRes: secondRes, healthyRes: firstRes };
  }

  it("fallback starts first: fallback turn is flagged, healthy turn is not", async () => {
    const { fallbackRes, healthyRes } = await runConcurrentChats("fallback");
    expect(fallbackRes.degraded).toEqual({ reason: "error" });
    expect(fallbackRes.answer).toContain("offline mind");
    expect(healthyRes.degraded).toBeUndefined();
    expect(healthyRes.answer).toBe(HEALTHY_ANSWER);
  }, 20_000);

  it("healthy starts first: healthy turn is not flagged, fallback turn is", async () => {
    const { fallbackRes, healthyRes } = await runConcurrentChats("healthy");
    expect(healthyRes.degraded).toBeUndefined();
    expect(healthyRes.answer).toBe(HEALTHY_ANSWER);
    expect(fallbackRes.degraded).toEqual({ reason: "error" });
    expect(fallbackRes.answer).toContain("offline mind");
  }, 20_000);
});
