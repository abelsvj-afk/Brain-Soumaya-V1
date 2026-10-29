import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import type { AgentLoopInput, AgentLoopResult } from "../agent/loop.js";
import {
  handleTelegramUpdate,
  getTelegramHistory,
  clearTelegramHistory,
  type TelegramUpdate,
} from "../telegram/bot.js";
import { TelegramLinksRepo } from "../telegram/links.js";

/**
 * Companion to telegramMemory.test.ts: when the agent loop itself throws,
 * the handler falls back to single-shot GraphRAG — and that exchange must
 * ALSO land in the chat's history store, so the next loop turn continues
 * the thread instead of starting cold. The loop is stubbed at the module
 * seam so the throw is deterministic; everything else (linking, fallback
 * chat, history store) is the real code.
 */

const loopStub = vi.hoisted(() => ({
  impl: null as null | ((input: AgentLoopInput) => Promise<AgentLoopResult>),
  inputs: [] as AgentLoopInput[],
}));

vi.mock("../agent/loop.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../agent/loop.js")>();
  return {
    ...orig,
    agentLoop: async (input: AgentLoopInput): Promise<AgentLoopResult> => {
      loopStub.inputs.push(input);
      if (!loopStub.impl) throw new Error("loop stub not configured");
      return loopStub.impl(input);
    },
  };
});

let handle: DbHandle;
let ctx: AppContext;
let outbox: { chatId: number; text: string }[];

const send = async (chatId: number, text: string) => {
  outbox.push({ chatId, text });
};

const update = (chatId: number, text: string): TelegramUpdate => ({
  message: { chat: { id: chatId }, text },
});

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = {
    handle,
    embeddings: new HashEmbeddingProvider(EMBED_DIM),
    llm: new HeuristicProvider(),
    usage: new UsageTracker(handle),
  };
  outbox = [];
  loopStub.impl = null;
  loopStub.inputs = [];
  clearTelegramHistory();
});
afterEach(() => {
  handle.sqlite.close();
});

describe("telegram GraphRAG fallback history", () => {
  it("a fallback exchange is recorded and reaches the next loop turn's history", async () => {
    await handleTelegramUpdate(ctx, update(9, "/link soumaya hunter222"), send);
    const spaceId = new TelegramLinksRepo(handle).get(9)!.spaceId;

    // Turn 1: the loop throws → GraphRAG fallback answers.
    loopStub.impl = async () => {
      throw new Error("provider exploded");
    };
    await handleTelegramUpdate(ctx, update(9, "what do you remember about my running?"), send);
    const fallbackReply = outbox.at(-1)!.text;
    expect(fallbackReply.length).toBeGreaterThan(0);
    expect(fallbackReply).not.toMatch(/isn't linked/i);
    // REG-033: a fallback-delivered reply is distinguishable as such —
    // the full agent was unavailable for that turn, and the reply says so.
    expect(fallbackReply).toMatch(/simpler answer/i);
    expect(fallbackReply).toMatch(/couldn't take actions/i);

    // The fallback exchange is in the store: user turn + the sent reply.
    const stored = getTelegramHistory(spaceId, 9);
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({ role: "you", text: "what do you remember about my running?" });
    expect(stored[1]).toMatchObject({ role: "soumaya", text: fallbackReply });

    // Turn 2: the loop works again and RECEIVES the fallback exchange as history.
    loopStub.impl = async () => ({ text: "loop answer" });
    await handleTelegramUpdate(ctx, update(9, "and what about my lifting?"), send);
    expect(outbox.at(-1)!.text).toBe("loop answer");
    expect(loopStub.inputs).toHaveLength(2);
    expect(loopStub.inputs[1]!.history).toEqual(stored);
    expect(loopStub.inputs[1]!.history[0]!.text).toContain("running");
  });

  it("loop turns receive exactly the prior exchanges (seam-level history check)", async () => {
    await handleTelegramUpdate(ctx, update(9, "/link soumaya hunter222"), send);
    loopStub.impl = async (input) => ({ text: `echo: ${input.userMessage}` });

    await handleTelegramUpdate(ctx, update(9, "first message"), send);
    await handleTelegramUpdate(ctx, update(9, "second message"), send);

    expect(loopStub.inputs[0]!.history).toEqual([]);
    expect(loopStub.inputs[1]!.history).toEqual([
      { role: "you", text: "first message" },
      { role: "soumaya", text: "echo: first message" },
    ]);
  });
});
