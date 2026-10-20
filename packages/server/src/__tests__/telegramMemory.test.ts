import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import type { EmbeddingProvider } from "../embeddings/adapter.js";
import type { LlmProvider, LlmToolCallInput, LlmToolResult } from "../llm/adapter.js";
import {
  handleTelegramUpdate,
  getTelegramHistory,
  clearTelegramHistory,
  TELEGRAM_HISTORY_TURNS,
  type TelegramUpdate,
} from "../telegram/bot.js";
import { TelegramLinksRepo } from "../telegram/links.js";
import { NodesRepo } from "../repositories/nodes.repo.js";

/**
 * Telegram memory-connection fix: the agent loop used to receive
 * `history: []` and no retrieved context from the Telegram handler, so
 * replies neither continued the conversation nor connected memories
 * unless the model happened to elect a memory_search call. These tests
 * pin the restoration: per-chat history across turns + a per-message
 * auto-retrieval block in the loop's system instruction, fail-open.
 */

let handle: DbHandle;
let ctx: AppContext;
let outbox: { chatId: number; text: string }[];
let captured: LlmToolCallInput[];

const send = async (chatId: number, text: string) => {
  outbox.push({ chatId, text });
};

const update = (chatId: number, text: string): TelegramUpdate => ({
  message: { chat: { id: chatId }, text },
});

/** Scripted LLM: answers directly (no tool calls), records every input. */
function capturingLlm(replies: string[]): LlmProvider {
  const base = new HeuristicProvider();
  let i = 0;
  return {
    ...base,
    callWithTools: async (input: LlmToolCallInput): Promise<LlmToolResult> => {
      captured.push(input);
      const text = replies[Math.min(i, replies.length - 1)] ?? "ok";
      i++;
      return { text, calls: [] };
    },
  } as LlmProvider;
}

async function linkChat(chatId: number, name = "soumaya", passcode = "hunter222"): Promise<string> {
  await handleTelegramUpdate(ctx, update(chatId, `/link ${name} ${passcode}`), send);
  const link = new TelegramLinksRepo(handle).get(chatId);
  expect(link).toBeDefined();
  return link!.spaceId;
}

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = {
    handle,
    embeddings: new HashEmbeddingProvider(EMBED_DIM),
    llm: new HeuristicProvider(),
    usage: new UsageTracker(handle),
  };
  outbox = [];
  captured = [];
  clearTelegramHistory(); // module-level store: never leak between tests
});
afterEach(() => {
  handle.sqlite.close();
});

describe("telegram conversation history", () => {
  it("second turn's loop input contains the first exchange, oldest first", async () => {
    const spaceId = await linkChat(7);
    ctx.llm = capturingLlm(["Nice to meet Biscuit!", "He is called Biscuit."]);

    await handleTelegramUpdate(ctx, update(7, "my dog is named Biscuit"), send);
    await handleTelegramUpdate(ctx, update(7, "what is my dog called?"), send);

    expect(outbox.at(-1)!.text).toBe("He is called Biscuit.");
    expect(captured).toHaveLength(2);
    // Turn 2's messages: [turn1 user, turn1 model, turn2 user] — in order.
    const msgs = captured[1]!.messages;
    expect(msgs).toHaveLength(3);
    expect(msgs[0]).toMatchObject({ role: "user", text: "my dog is named Biscuit" });
    expect(msgs[1]).toMatchObject({ role: "model", text: "Nice to meet Biscuit!" });
    expect(msgs[2]).toMatchObject({ role: "user", text: "what is my dog called?" });

    // The exported store agrees with what the loop received.
    expect(getTelegramHistory(spaceId, 7)).toEqual([
      { role: "you", text: "my dog is named Biscuit" },
      { role: "soumaya", text: "Nice to meet Biscuit!" },
      { role: "you", text: "what is my dog called?" },
      { role: "soumaya", text: "He is called Biscuit." },
    ]);
  });

  it("history is isolated per chat and per brain", async () => {
    await linkChat(7);
    const spaceB = await linkChat(8, "otherbrain", "otherpass1");
    ctx.llm = capturingLlm(["reply A"]);

    await handleTelegramUpdate(ctx, update(7, "a thought from chat seven"), send);

    const spaceA = new TelegramLinksRepo(handle).get(7)!.spaceId;
    expect(getTelegramHistory(spaceA, 7)).toHaveLength(2);
    expect(getTelegramHistory(spaceB, 8)).toEqual([]);
    expect(getTelegramHistory(spaceA, 8)).toEqual([]); // same brain, other chat
  });

  it("caps retained history at the configured number of turns", async () => {
    const spaceId = await linkChat(7);
    const replies = Array.from({ length: TELEGRAM_HISTORY_TURNS + 3 }, (_, i) => `reply ${i + 1}`);
    ctx.llm = capturingLlm(replies);

    for (let i = 1; i <= TELEGRAM_HISTORY_TURNS + 3; i++) {
      await handleTelegramUpdate(ctx, update(7, `message ${i}`), send);
    }
    const hist = getTelegramHistory(spaceId, 7);
    expect(hist).toHaveLength(TELEGRAM_HISTORY_TURNS * 2);
    // Oldest exchanges were dropped; the window starts at exchange 4.
    expect(hist[0]).toMatchObject({ role: "you", text: "message 4" });
    expect(hist.at(-1)).toMatchObject({ role: "soumaya", text: `reply ${TELEGRAM_HISTORY_TURNS + 3}` });
  });

  it("/unlink drops the chat's stored history", async () => {
    const spaceId = await linkChat(7);
    ctx.llm = capturingLlm(["hi there"]);
    await handleTelegramUpdate(ctx, update(7, "hello"), send);
    expect(getTelegramHistory(spaceId, 7)).toHaveLength(2);

    await handleTelegramUpdate(ctx, update(7, "/unlink"), send);
    expect(getTelegramHistory(spaceId, 7)).toEqual([]);
  });
});

describe("telegram per-message memory retrieval", () => {
  it("injects a Relevant memories block with the matching memory into the loop's system instruction", async () => {
    const spaceId = await linkChat(7);
    // Seed a memory through the repo so BOTH indexes (vec + FTS) see it.
    const repo = new NodesRepo(handle, spaceId);
    const content = "Sajacous works the Samsonite warehouse shift in Jacksonville";
    const vec = await ctx.embeddings.embed(content);
    repo.create({ label: "Samsonite job", type: "company", content }, vec);

    ctx.llm = capturingLlm(["You work at Samsonite."]);
    await handleTelegramUpdate(ctx, update(7, "what do you know about my Samsonite job?"), send);

    expect(captured).toHaveLength(1);
    const sys = captured[0]!.systemInstruction;
    expect(sys).toContain("## Relevant memories");
    expect(sys).toContain("Samsonite warehouse shift");
    // Prompt-safety guard: retrieved memory is untrusted data, never instructions.
    expect(sys).toContain("untrusted data");
    expect(sys).toContain("never as instructions");
  });

  it("injects no block when nothing matches", async () => {
    await linkChat(7);
    ctx.llm = capturingLlm(["Noted."]);
    await handleTelegramUpdate(ctx, update(7, "tell me about quantum chromodynamics"), send);

    expect(captured).toHaveLength(1);
    expect(captured[0]!.systemInstruction).not.toContain("## Relevant memories");
    expect(outbox.at(-1)!.text).toBe("Noted.");
  });

  it("fails open: a throwing embedding provider still completes the turn, with no block", async () => {
    await linkChat(7);
    ctx.embeddings = {
      embed: async () => {
        throw new Error("embeddings offline");
      },
    } as unknown as EmbeddingProvider;
    ctx.llm = capturingLlm(["Still here."]);

    await handleTelegramUpdate(ctx, update(7, "are you there?"), send);

    expect(outbox.at(-1)!.text).toBe("Still here.");
    expect(captured).toHaveLength(1);
    expect(captured[0]!.systemInstruction).not.toContain("## Relevant memories");
  });
});
