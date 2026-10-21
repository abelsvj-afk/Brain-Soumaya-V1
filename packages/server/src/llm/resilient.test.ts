import { describe, expect, it, vi } from "vitest";
import type { LlmProvider } from "./adapter.js";
import { ResilientLlmProvider } from "./resilient.js";

/** Minimal fake primary provider whose `answer` call can be scripted to reject. */
function makeFakePrimary(rejectWith?: unknown): LlmProvider {
  return {
    available: true,
    model: "fake-model",
    extract: vi.fn(),
    validateLink: vi.fn(),
    synthesize: vi.fn(),
    detectContradiction: vi.fn(),
    answer: vi.fn(async () => {
      if (rejectWith !== undefined) throw rejectWith;
      return { answer: "ok", citations: [] };
    }),
    research: vi.fn(),
    summarizeSector: vi.fn(),
    generateDailyLog: vi.fn(),
  } as unknown as LlmProvider;
}

describe("ResilientLlmProvider — degradedReason categorization", () => {
  it("reports no reason while healthy", async () => {
    const provider = new ResilientLlmProvider(makeFakePrimary());
    await provider.answer("q", []);
    expect(provider.degraded).toBe(false);
    expect(provider.degradedReason).toBeNull();
  });

  it("classifies an invalid/unauthorized API key as 'auth'", async () => {
    const provider = new ResilientLlmProvider(
      makeFakePrimary(new Error("401 Unauthorized: invalid api key")),
    );
    await provider.answer("q", []);
    expect(provider.degraded).toBe(true);
    expect(provider.degradedReason).toBe("auth");
  });

  it("classifies a quota/billing error as 'quota'", async () => {
    const provider = new ResilientLlmProvider(
      makeFakePrimary(new Error("You exceeded your current quota, please check your billing")),
    );
    await provider.answer("q", []);
    expect(provider.degradedReason).toBe("quota");
  });

  it("classifies a timeout as 'timeout'", async () => {
    const provider = new ResilientLlmProvider(makeFakePrimary(new Error("answer timed out")));
    await provider.answer("q", []);
    expect(provider.degradedReason).toBe("timeout");
  });

  it("does not trip the cooldown on a non-fatal (unrecognized) error", async () => {
    const provider = new ResilientLlmProvider(makeFakePrimary(new Error("boom, unrelated failure")));
    await provider.answer("q", []);
    // A single unrecognized error falls back for THAT call but must not degrade
    // the whole provider — otherwise any transient error would look like an outage.
    expect(provider.degraded).toBe(false);
    expect(provider.degradedReason).toBeNull();
  });

  it("records the per-call fallback reason for answer() (Finding 2 threading)", async () => {
    const provider = new ResilientLlmProvider(makeFakePrimary(new Error("boom, unrelated failure")));
    await provider.answer("q", []);
    // Provider-wide degraded state stays false for a non-fatal error, but the
    // CALL was served by the fallback — chat() reads this to flag that reply.
    expect(provider.degraded).toBe(false);
    expect(provider.lastAnswerDegradedReason).toBe("error");
  });

  it("clears the per-call record after a healthy answer", async () => {
    const provider = new ResilientLlmProvider(makeFakePrimary());
    await provider.answer("q", []);
    expect(provider.lastAnswerDegradedReason).toBeNull();
  });

  it("'budget' takes precedence over a stale caught-error reason", async () => {
    const provider = new ResilientLlmProvider(
      makeFakePrimary(new Error("401 unauthorized")),
      undefined,
      undefined,
      () => true, // isOverBudget always true
    );
    await provider.answer("q", []);
    expect(provider.degraded).toBe(true);
    expect(provider.degradedReason).toBe("budget");
  });
});
