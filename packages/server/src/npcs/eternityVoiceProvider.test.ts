import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../context.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { createEternityVoice } from "./eternityVoiceProvider.js";

const ctx = (llm: unknown = new HeuristicProvider()) =>
  ({ llm, usage: { record: () => {}, overBudget: () => false } }) as unknown as AppContext;

afterEach(() => vi.unstubAllEnvs());

describe("createEternityVoice (owner: Eternity uses the free Gemini key)", () => {
  it("prefers his own Gemini line even when an OpenAI key also exists (the shared provider would pick OpenAI)", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    expect((await createEternityVoice(ctx()))!.via).toBe("gemini");
  });
  it("falls back to the shared provider when there is no Gemini key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const shared = { available: true, eternalVoice: async () => "Rise." };
    expect((await createEternityVoice(ctx(shared)))!.via).toBe("shared");
  });
  it("no key anywhere → null (his offline lines)", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(await createEternityVoice(ctx())).toBeNull();
  });
});
