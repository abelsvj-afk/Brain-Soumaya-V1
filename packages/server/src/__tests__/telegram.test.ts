import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { GraphService } from "../graph/service.js";
import { UsageTracker } from "../usage.js";
import { handleTelegramUpdate, sendDailyDigests, type TelegramUpdate } from "../telegram/bot.js";
import { TelegramLinksRepo } from "../telegram/links.js";
import { SpacesRepo } from "../auth/spaces.js";
import { SourcesRepo } from "../repositories/sources.repo.js";

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
});
afterEach(() => {
  handle.sqlite.close();
});

describe("telegram multi-brain routing", () => {
  it("refuses to log or chat until the chat links to a brain", async () => {
    await handleTelegramUpdate(ctx, update(1, "/log buy milk"), send);
    expect(outbox.at(-1)!.text).toMatch(/isn't linked/i);
    expect(new TelegramLinksRepo(handle).get(1)).toBeUndefined();
  });

  it("/link creates a new brain and binds the chat to it", async () => {
    await handleTelegramUpdate(ctx, update(1, "/link soumaya hunter222"), send);
    expect(outbox.at(-1)!.text).toMatch(/Created and linked/i);

    const link = new TelegramLinksRepo(handle).get(1);
    expect(link).toBeDefined();
    expect(link!.spaceName).toBe("soumaya");
    // The brain really exists in the spaces table.
    expect(new SpacesRepo(handle).getById(link!.spaceId)).toBeDefined();
  });

  it("rejects /link with a wrong passcode for an existing brain", async () => {
    new SpacesRepo(handle).authOrCreate("soumaya", "correctpass");
    await handleTelegramUpdate(ctx, update(1, "/link soumaya wrong"), send);
    expect(outbox.at(-1)!.text).toMatch(/passcode is wrong/i);
    expect(new TelegramLinksRepo(handle).get(1)).toBeUndefined();
  });

  it("routes /log to the linked brain and keeps two chats isolated", async () => {
    await handleTelegramUpdate(ctx, update(1, "/link alice alicepass"), send);
    await handleTelegramUpdate(ctx, update(2, "/link bob bobpassword"), send);

    await handleTelegramUpdate(ctx, update(1, "/log alice secret about sailing"), send);
    expect(outbox.at(-1)!.text).toMatch(/Logged/i);

    const links = new TelegramLinksRepo(handle);
    const aliceSpace = links.get(1)!.spaceId;
    const bobSpace = links.get(2)!.spaceId;
    expect(aliceSpace).not.toBe(bobSpace);

    const aliceNodes = handle.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM nodes WHERE space_id = ?`)
      .get(aliceSpace) as { c: number };
    const bobNodes = handle.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM nodes WHERE space_id = ?`)
      .get(bobSpace) as { c: number };
    expect(aliceNodes.c).toBeGreaterThan(0);
    expect(bobNodes.c).toBe(0);
  });

  it("/unlink disconnects the chat", async () => {
    await handleTelegramUpdate(ctx, update(1, "/link soumaya xpassword"), send);
    await handleTelegramUpdate(ctx, update(1, "/unlink"), send);
    expect(outbox.at(-1)!.text).toMatch(/Unlinked/i);
    expect(new TelegramLinksRepo(handle).get(1)).toBeUndefined();
  });
});

describe("telegram /log — verbatim whitespace (fix round 4, re-audit P1)", () => {
  const sha = (t: string) => createHash("sha256").update(Buffer.from(t, "utf8")).digest("hex");

  /** The persisted source behind the first node in the space (§18.2). */
  function firstSource(spaceId: string) {
    const nodes = handle.sqlite
      .prepare(`SELECT id FROM nodes WHERE space_id = ? ORDER BY id ASC LIMIT 1`)
      .get(spaceId) as { id: number };
    const repo = new SourcesRepo(handle, spaceId);
    const links = repo.activeLinksForNode(nodes.id);
    expect(links.length).toBeGreaterThan(0);
    const source = repo.getById(links[0]!.sourceId);
    expect(source).toBeDefined();
    return source!;
  }

  it("/log persists the body byte-for-byte, trailing spaces included", async () => {
    await handleTelegramUpdate(ctx, update(1, "/link alice alicepass"), send);
    const spaceId = new TelegramLinksRepo(handle).get(1)!.spaceId;

    const body = "call mom on Sunday   ";
    await handleTelegramUpdate(ctx, update(1, `/log ${body}`), send);
    expect(outbox.at(-1)!.text).toMatch(/Logged/i);

    const source = firstSource(spaceId);
    expect(source.rawText).toBe(body);
    expect(source.rawBytes.equals(Buffer.from(body, "utf8"))).toBe(true);
    expect(source.contentHash).toBe(sha(body));
  });

  it("/log with leading whitespace before the token still preserves the body verbatim", async () => {
    await handleTelegramUpdate(ctx, update(1, "/link alice alicepass"), send);
    const spaceId = new TelegramLinksRepo(handle).get(1)!.spaceId;

    const body = "padded body  ";
    await handleTelegramUpdate(ctx, update(1, `  /log ${body}`), send);
    expect(outbox.at(-1)!.text).toMatch(/Logged/i);

    const source = firstSource(spaceId);
    expect(source.rawText).toBe(body);
    expect(source.rawBytes.equals(Buffer.from(body, "utf8"))).toBe(true);
    expect(source.contentHash).toBe(sha(body));
  });

  it("/log with two spaces after the token keeps the second space (one delimiter consumed)", async () => {
    await handleTelegramUpdate(ctx, update(1, "/link alice alicepass"), send);
    const spaceId = new TelegramLinksRepo(handle).get(1)!.spaceId;

    const body = " double-spaced body";
    await handleTelegramUpdate(ctx, update(1, `/log ${body}`), send); // "/log  double-spaced body"
    expect(outbox.at(-1)!.text).toMatch(/Logged/i);

    const source = firstSource(spaceId);
    expect(source.rawText).toBe(body);
    expect(source.contentHash).toBe(sha(body));
  });

  it("/log with only whitespace after the token still asks for the memory", async () => {
    await handleTelegramUpdate(ctx, update(1, "/link alice alicepass"), send);
    await handleTelegramUpdate(ctx, update(1, "/log    "), send);
    expect(outbox.at(-1)!.text).toMatch(/Add the memory after \/log/i);
    const spaceId = new TelegramLinksRepo(handle).get(1)!.spaceId;
    const count = handle.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM nodes WHERE space_id = ?`)
      .get(spaceId) as { c: number };
    expect(count.c).toBe(0);
  });
});

describe("telegram proactive digest sweep", () => {
  it("pushes one digest per linked chat and is idempotent within the day", async () => {
    await handleTelegramUpdate(ctx, update(1, "/link alice alicepass"), send);
    await handleTelegramUpdate(ctx, update(1, "/log alice went for a long run today"), send);
    outbox = [];

    const first = await sendDailyDigests(ctx, send);
    expect(first).toBe(1);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.chatId).toBe(1);
    expect(outbox[0]!.text).toMatch(/alice/); // brain name in the header

    // Running again the same day sends nothing.
    outbox = [];
    const second = await sendDailyDigests(ctx, send);
    expect(second).toBe(0);
    expect(outbox).toHaveLength(0);
  });

  it("does not push to chats that never linked", async () => {
    const sent = await sendDailyDigests(ctx, send);
    expect(sent).toBe(0);
  });
});
