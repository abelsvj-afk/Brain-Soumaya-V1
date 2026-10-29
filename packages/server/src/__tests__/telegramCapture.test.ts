import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import type { LlmProvider, LlmToolCallInput, LlmToolResult } from "../llm/adapter.js";
import { handleTelegramUpdate, clearTelegramHistory, type TelegramUpdate } from "../telegram/bot.js";
import { TelegramLinksRepo } from "../telegram/links.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { SourcesRepo } from "../repositories/sources.repo.js";
import { captureMemoryTool } from "../agent/tools/captureMemory.js";
import type { ToolContext } from "../agent/tools/types.js";

/**
 * Parity Phase 2 — conversational capture at the Telegram handler level.
 *
 * The owner can ACT from Telegram in plain conversation — "remember this: …"
 * without the /log prefix — under the D3 approval policy: the bot's
 * proposal writes NOTHING until the owner replies "yes"; "no" writes
 * nothing ever; a capture in one brain never lands in another (and another
 * chat's "yes" cannot confirm it). /log remains the immediate owner-typed
 * command path and is not exercised here.
 *
 * The scripted LLM proposes capture_memory on the capture turn exactly as
 * a real model would (tool call, then the quote-back confirmation
 * question); all approval/ingest machinery under it is the real code.
 */

let handle: DbHandle;
let ctx: AppContext;
let outbox: { chatId: number; text: string }[];

const send = async (chatId: number, text: string) => {
  outbox.push({ chatId, text });
};

const update = (chatId: number, text: string): TelegramUpdate => ({
  message: { chat: { id: chatId }, text },
});

/**
 * LLM that proposes ONE capture_memory call for `captureText` on its first
 * callWithTools, then answers with the quote-back confirmation question;
 * any later call (e.g. another chat's stray "yes" reaching the loop) gets a
 * plain text reply. Object.assign (not spread) so the heuristic prototype
 * methods — extract(), which the ingest pipeline runs on approval — survive.
 */
function captureLlm(captureText: string): LlmProvider {
  let i = 0;
  return Object.assign(new HeuristicProvider(), {
    callWithTools: async (_input: LlmToolCallInput): Promise<LlmToolResult> => {
      i++;
      if (i === 1) {
        return { text: null, calls: [{ id: "c1", name: "capture_memory", args: { text: captureText } }] };
      }
      if (i === 2) {
        return { text: `I'll save this: "${captureText}" — say "yes" to confirm.`, calls: [] };
      }
      return { text: "ok", calls: [] };
    },
  }) as LlmProvider;
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
  clearTelegramHistory();
});
afterEach(() => {
  handle.sqlite.close();
});

const CAPTURE_TEXT = "The landlord raised the rent starting in November";

describe("telegram conversational capture — approval flow end-to-end", () => {
  it("propose → owner 'yes' → the memory is ingested into the correct space", async () => {
    const spaceId = await linkChat(7);
    ctx.llm = captureLlm(CAPTURE_TEXT);

    await handleTelegramUpdate(ctx, update(7, `remember this: ${CAPTURE_TEXT}`), send);
    // The proposal quotes back what will be saved and asks for confirmation…
    expect(outbox.at(-1)!.text).toContain(`I'll save this: "${CAPTURE_TEXT}"`);
    // …and D3: the proposal alone wrote NOTHING.
    expect(new NodesRepo(handle, spaceId).all()).toHaveLength(0);
    const pending = handle.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM tool_approvals WHERE space_id = ? AND tool = 'capture_memory' AND status = 'pending'`)
      .get(spaceId) as { c: number };
    expect(pending.c).toBe(1);

    await handleTelegramUpdate(ctx, update(7, "yes"), send);
    expect(outbox.at(-1)!.text).toContain("Saved");

    // The memory really landed, in this space, via the nodes repository.
    const nodes = new NodesRepo(handle, spaceId).all();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.content).toBe(CAPTURE_TEXT);
  });

  it("propose → owner 'no' → nothing is written", async () => {
    const spaceId = await linkChat(7);
    ctx.llm = captureLlm(CAPTURE_TEXT);

    await handleTelegramUpdate(ctx, update(7, `remember this: ${CAPTURE_TEXT}`), send);
    expect(outbox.at(-1)!.text).toContain("say \"yes\" to confirm");

    await handleTelegramUpdate(ctx, update(7, "no"), send);
    expect(outbox.at(-1)!.text).toContain("won't do that");
    expect(new NodesRepo(handle, spaceId).all()).toHaveLength(0);
    const denied = handle.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM tool_approvals WHERE space_id = ? AND tool = 'capture_memory' AND status = 'denied'`)
      .get(spaceId) as { c: number };
    expect(denied.c).toBe(1);
  });
});

describe("telegram conversational capture — cross-space isolation", () => {
  it("a capture in space A never lands in space B, and chat B's 'yes' cannot confirm it", async () => {
    const spaceA = await linkChat(1, "alice", "alicepass");
    const spaceB = await linkChat(2, "bob", "bobpassword");
    expect(spaceA).not.toBe(spaceB);
    ctx.llm = captureLlm(CAPTURE_TEXT);

    // Alice's chat proposes the capture.
    await handleTelegramUpdate(ctx, update(1, `remember this: ${CAPTURE_TEXT}`), send);
    expect(new NodesRepo(handle, spaceA).all()).toHaveLength(0);

    // Bob says "yes" in HIS chat: he has no pending approval, so this must
    // NOT execute Alice's capture (principal + space are both bound).
    await handleTelegramUpdate(ctx, update(2, "yes"), send);
    expect(new NodesRepo(handle, spaceA).all()).toHaveLength(0);
    expect(new NodesRepo(handle, spaceB).all()).toHaveLength(0);
    const stillPending = handle.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM tool_approvals WHERE space_id = ? AND tool = 'capture_memory' AND status = 'pending'`)
      .get(spaceA) as { c: number };
    expect(stillPending.c).toBe(1);

    // Alice's own "yes" executes it — into Alice's space only.
    await handleTelegramUpdate(ctx, update(1, "yes"), send);
    const aNodes = new NodesRepo(handle, spaceA).all();
    expect(aNodes).toHaveLength(1);
    expect(aNodes[0]!.content).toBe(CAPTURE_TEXT);
    expect(new NodesRepo(handle, spaceB).all()).toHaveLength(0);
  });
});

describe("chat capture — verbatim whitespace (fix round 4, re-audit P1)", () => {
  const sha = (t: string) => createHash("sha256").update(Buffer.from(t, "utf8")).digest("hex");

  /** The persisted source behind a node: rawBytes are the contract (§18.2). */
  function sourceOf(spaceId: string, nodeId: number) {
    const repo = new SourcesRepo(handle, spaceId);
    const links = repo.activeLinksForNode(nodeId);
    expect(links.length).toBeGreaterThan(0);
    const source = repo.getById(links[0]!.sourceId);
    expect(source).toBeDefined();
    return source!;
  }

  it("capture_memory persists the submitted text byte-for-byte, leading AND trailing spaces", async () => {
    const spaceId = await linkChat(7);
    const text = "  padded memory with leading and trailing spaces  ";
    const tc: ToolContext = { ctx, spaceId, now: Date.now(), notify: async () => {} };

    const r = await captureMemoryTool.run(tc, { text });
    expect(r.ok).toBe(true);

    const nodes = new NodesRepo(handle, spaceId).all();
    expect(nodes).toHaveLength(1);
    const source = sourceOf(spaceId, nodes[0]!.id);
    expect(source.rawText).toBe(text);
    expect(source.rawBytes.equals(Buffer.from(text, "utf8"))).toBe(true);
    expect(source.contentHash).toBe(sha(text));
    expect(source.byteLength).toBe(Buffer.from(text, "utf8").length);
  });

  it("capture_memory still rejects whitespace-only text", async () => {
    const spaceId = await linkChat(7);
    const tc: ToolContext = { ctx, spaceId, now: Date.now(), notify: async () => {} };
    const r = await captureMemoryTool.run(tc, { text: "   \n  " });
    expect(r.ok).toBe(false);
    expect(new NodesRepo(handle, spaceId).all()).toHaveLength(0);
  });
});
