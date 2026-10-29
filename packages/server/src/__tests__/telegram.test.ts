import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { GraphService } from "../graph/service.js";
import { UsageTracker } from "../usage.js";
import { handleTelegramUpdate, sendDailyDigests, formatLogConfirmation, type TelegramUpdate } from "../telegram/bot.js";
import { TelegramLinksRepo } from "../telegram/links.js";
import { setChatVoiceEnabled, clearChatVoiceModes } from "../telegram/voiceReply.js";
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
  // The digest sends only once the space's local digest time (06:00 by
  // default) has passed; pin the clock to mid-afternoon so this tests
  // delivery, not the hour the suite happens to run at.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T15:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

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

// REG-031 (CAP-11): a /log confirmation accounts for every node the capture
// created — the count always, labels where they fit.
describe("REG-031 /log confirmation accounts for every node", () => {
  it("a single-node capture keeps the existing one-label form", () => {
    expect(formatLogConfirmation([{ label: "Call mom Sunday" }], 2, 3.5, "")).toBe(
      `✦ Logged "Call mom Sunday" — 2 links formed · +3.5 ⛽`,
    );
  });
  it("a multi-node capture names every node and states the count", () => {
    const text = formatLogConfirmation(
      [{ label: "Call mom Sunday" }, { label: "Buy oat milk" }, { label: "Dentist at 3pm" }],
      1,
      4.5,
      " · 🔥 day 2",
    );
    expect(text).toMatch(/Logged 3 memories/);
    expect(text).toContain(`"Call mom Sunday"`);
    expect(text).toContain(`"Buy oat milk"`);
    expect(text).toContain(`"Dentist at 3pm"`);
    expect(text).toMatch(/1 link formed/);
    expect(text).toMatch(/\+4\.5 ⛽/);
    expect(text).toContain("🔥 day 2");
  });
  it("many nodes are capped with a (+N more) tail, never silently dropped", () => {
    const nodes = Array.from({ length: 8 }, (_, i) => ({ label: `node ${i + 1}` }));
    const text = formatLogConfirmation(nodes, 0, 1, "");
    expect(text).toMatch(/Logged 8 memories/);
    expect(text).toMatch(/\(\+3 more\)/);
  });
  it("an end-to-end /log still confirms the one node the heuristic extractor makes", async () => {
    await handleTelegramUpdate(ctx, update(1, "/link alice alicepass"), send);
    await handleTelegramUpdate(ctx, update(1, "/log alice went for a long run today"), send);
    expect(outbox.at(-1)!.text).toMatch(/Logged "/);
    expect(outbox.at(-1)!.text).toMatch(/links? formed/);
  });
});

// REG-032 (TG-14): one command reports link target, voice state,
// note-in-progress state, and notification settings together.
describe("REG-032 /settings reports the whole chat state", () => {
  beforeEach(() => {
    clearChatVoiceModes();
  });

  it("reports the linked brain, voice OFF, and no note when idle", async () => {
    await handleTelegramUpdate(ctx, update(1, "/link soumaya hunter222"), send);
    outbox = [];
    await handleTelegramUpdate(ctx, update(1, "/settings"), send);
    const text = outbox.at(-1)!.text;
    expect(text).toMatch(/Linked brain: "soumaya"/i);
    expect(text).toMatch(/Voice replies: OFF/i);
    expect(text).toMatch(/no note in progress/i);
    expect(text).toMatch(/Timezone:/);
    expect(text).toMatch(/Quiet hours:/);
    expect(text).toMatch(/Digest time:/);
    expect(text).toMatch(/Daily cap:/);
  });

  it("reports voice ON and an open note with its size", async () => {
    await handleTelegramUpdate(ctx, update(1, "/link soumaya hunter222"), send);
    const spaceId = new TelegramLinksRepo(handle).get(1)!.spaceId;
    setChatVoiceEnabled(spaceId, 1, true);
    await handleTelegramUpdate(ctx, update(1, "/note"), send);
    await handleTelegramUpdate(ctx, update(1, "first draft line"), send);
    outbox = [];
    await handleTelegramUpdate(ctx, update(1, "/settings"), send);
    const text = outbox.at(-1)!.text;
    expect(text).toMatch(/Linked brain: "soumaya"/i);
    expect(text).toMatch(/Voice replies: ON/i);
    expect(text).toMatch(/note is in progress \(1 part, 16 characters\)/i);
  });
});

// REG-034 (TG-13, HELP half): HELP's /note line states the typed-text-only flow.
describe("REG-034 HELP describes /note as typed-text only", () => {
  it("an unlinked chat sees the /note line with the voice limitation", async () => {
    await handleTelegramUpdate(ctx, update(1, "hello"), send);
    const text = outbox.at(-1)!.text;
    expect(text).toMatch(/\/note/);
    expect(text).toMatch(/Typed messages only/i);
    expect(text).toMatch(/voice notes can't join a note yet/i);
  });
});
