import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import type { LlmProvider, LlmToolCallInput, LlmToolResult } from "../llm/adapter.js";
import { handleTelegramUpdate, clearTelegramHistory, type TelegramUpdate } from "../telegram/bot.js";
import { TelegramLinksRepo } from "../telegram/links.js";
import { TelegramNoteDraftsRepo } from "../repositories/telegramNoteDrafts.repo.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { GraphService } from "../graph/service.js";
import { NOTE_MAX_PARTS, NOTE_MAX_CHARS, NOTE_IDLE_EXPIRY_MS } from "../telegram/notes.js";
import { requestApproval } from "../agent/approvals.js";
import { taskCreatorTool } from "../agent/tools/taskCreator.js";
import type { ToolContext } from "../agent/tools/types.js";

/**
 * Parity Phase 3 — open-ended Telegram notes.
 *
 * Pins: verbatim multi-part capture (/note → append → /done) saved as ONE
 * node byte-for-byte; /cancel discards; drafts are durable (DB, survive a
 * reopen); chats/spaces fully isolated; precedence — commands always win
 * over note text, and a pending write-approval "yes" confirms the approval
 * instead of landing in the note; with no draft active, messages are
 * untouched by note code.
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

const drafts = () => new TelegramNoteDraftsRepo(handle);

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
  clearTelegramHistory();
});
afterEach(() => {
  handle.sqlite.close();
});

describe("telegram notes — full verbatim flow", () => {
  it("start → 3 parts → /done saves ONE node with byte-identical content incl. line breaks", async () => {
    const spaceId = await linkChat(7);

    await handleTelegramUpdate(ctx, update(7, "/note"), send);
    expect(outbox.at(-1)!.text).toMatch(/Note started/i);

    const p1 = "\nMy Title Line\nbody starts here";
    const p2 = "second part\nwith a line break  \nand trailing spaces above";
    const p3 = "  indented third part\n\nblank line inside";
    await handleTelegramUpdate(ctx, update(7, p1), send);
    expect(outbox.at(-1)!.text).toMatch(/Part 1 added/i);
    expect(outbox.at(-1)!.text).toContain(`${p1.length} characters so far`);
    await handleTelegramUpdate(ctx, update(7, p2), send);
    expect(outbox.at(-1)!.text).toMatch(/Part 2 added/i);
    await handleTelegramUpdate(ctx, update(7, p3), send);
    expect(outbox.at(-1)!.text).toMatch(/Part 3 added/i);

    // The draft itself holds the accumulated verbatim text.
    const expected = [p1, p2, p3].join("\n");
    const draft = drafts().get(spaceId, 7);
    expect(draft).toBeDefined();
    expect(draft!.partCount).toBe(3);
    expect(draft!.text).toBe(expected);

    await handleTelegramUpdate(ctx, update(7, "/done"), send);
    expect(outbox.at(-1)!.text).toMatch(/Note saved/i);

    // Draft consumed; exactly one node, byte-identical content.
    expect(drafts().get(spaceId, 7)).toBeUndefined();
    const all = new NodesRepo(handle, spaceId).all();
    expect(all).toHaveLength(1);
    const node = all[0]!;
    expect(node.content).toBe(expected);
    expect(node.label).toBe("My Title Line"); // first non-empty line
    expect(node.type).toBe("daily");
    expect(node.tags).toEqual(expect.arrayContaining(["note", "telegram"]));

    // Raw provenance: origin column marks the telegram source.
    const raw = handle.sqlite
      .prepare(`SELECT origin, tags FROM nodes WHERE id = ?`)
      .get(node.id) as { origin: string; tags: string };
    expect(raw.origin).toBe("telegram");
    expect(JSON.parse(raw.tags)).toEqual(expect.arrayContaining(["note", "telegram"]));

    // Findable in-app: the nodes repository/search path (galaxy/Browse/Search
    // all read nodes) returns it — via GraphService.search (hybrid vec+FTS).
    const hits = await new GraphService(handle, spaceId).search(ctx.embeddings, "My Title Line", 10);
    expect(hits.map((h) => h.id)).toContain(node.id);
    expect(new NodesRepo(handle, spaceId).getById(node.id)!.content).toBe(expected);
  });

  it("/note while active reports status and does not restart the draft", async () => {
    const spaceId = await linkChat(7);
    await handleTelegramUpdate(ctx, update(7, "/note"), send);
    await handleTelegramUpdate(ctx, update(7, "keep this line"), send);
    await handleTelegramUpdate(ctx, update(7, "/note"), send);
    expect(outbox.at(-1)!.text).toMatch(/already in progress/i);
    expect(outbox.at(-1)!.text).toMatch(/1 part/);
    const draft = drafts().get(spaceId, 7);
    expect(draft!.partCount).toBe(1);
    expect(draft!.text).toBe("keep this line");
  });

  it("/note <text> starts the draft with that text as part 1", async () => {
    const spaceId = await linkChat(7);
    await handleTelegramUpdate(ctx, update(7, "/note opening words"), send);
    expect(outbox.at(-1)!.text).toMatch(/Note started/i);
    const draft = drafts().get(spaceId, 7);
    expect(draft!.partCount).toBe(1);
    expect(draft!.text).toBe("opening words");
  });

  it("/done with an empty note saves nothing and keeps the draft open", async () => {
    const spaceId = await linkChat(7);
    await handleTelegramUpdate(ctx, update(7, "/note"), send);
    await handleTelegramUpdate(ctx, update(7, "/done"), send);
    expect(outbox.at(-1)!.text).toMatch(/still empty/i);
    expect(new NodesRepo(handle, spaceId).all()).toHaveLength(0);
    expect(drafts().get(spaceId, 7)).toBeDefined();
  });

  it("/done and /cancel with no draft are harmless status replies", async () => {
    await linkChat(7);
    await handleTelegramUpdate(ctx, update(7, "/done"), send);
    expect(outbox.at(-1)!.text).toMatch(/No note in progress/i);
    await handleTelegramUpdate(ctx, update(7, "/cancel"), send);
    expect(outbox.at(-1)!.text).toMatch(/No note in progress/i);
  });
});

describe("telegram notes — cancel", () => {
  it("/cancel discards: no node, no draft", async () => {
    const spaceId = await linkChat(7);
    await handleTelegramUpdate(ctx, update(7, "/note"), send);
    await handleTelegramUpdate(ctx, update(7, "words that will be dropped"), send);
    await handleTelegramUpdate(ctx, update(7, "/cancel"), send);
    expect(outbox.at(-1)!.text).toMatch(/discarded/i);
    expect(drafts().get(spaceId, 7)).toBeUndefined();
    expect(new NodesRepo(handle, spaceId).all()).toHaveLength(0);
  });
});

describe("telegram notes — durability", () => {
  it("a draft survives a fresh repo/handler instance against the same DB", async () => {
    const spaceId = await linkChat(7);
    await handleTelegramUpdate(ctx, update(7, "/note"), send);
    await handleTelegramUpdate(ctx, update(7, "durable words"), send);

    // "Restart": brand-new repository instance (the handler itself is
    // stateless — all note state is the DB row) still sees the draft.
    const freshRepo = new TelegramNoteDraftsRepo(handle);
    const draft = freshRepo.get(spaceId, 7);
    expect(draft).toBeDefined();
    expect(draft!.text).toBe("durable words");
    expect(draft!.partCount).toBe(1);
  });

  it("a draft survives closing and reopening the database file", async () => {
    const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "tg-notes-"));
    const dbPath = nodePath.join(dir, "brain.db");
    try {
      const h1 = createDb(dbPath);
      const ctx1: AppContext = {
        handle: h1,
        embeddings: new HashEmbeddingProvider(EMBED_DIM),
        llm: new HeuristicProvider(),
        usage: new UsageTracker(h1),
      };
      const box1: { chatId: number; text: string }[] = [];
      const send1 = async (chatId: number, text: string) => {
        box1.push({ chatId, text });
      };
      await handleTelegramUpdate(ctx1, update(9, "/link durable passw0rd"), send1);
      const spaceId = new TelegramLinksRepo(h1).get(9)!.spaceId;
      await handleTelegramUpdate(ctx1, update(9, "/note"), send1);
      await handleTelegramUpdate(ctx1, update(9, "written before the restart"), send1);
      h1.sqlite.close();

      // Reopen from disk: the draft must still be there, and /done must save it.
      const h2 = createDb(dbPath);
      try {
        const ctx2: AppContext = {
          handle: h2,
          embeddings: new HashEmbeddingProvider(EMBED_DIM),
          llm: new HeuristicProvider(),
          usage: new UsageTracker(h2),
        };
        const box2: { chatId: number; text: string }[] = [];
        const send2 = async (chatId: number, text: string) => {
          box2.push({ chatId, text });
        };
        const repo2 = new TelegramNoteDraftsRepo(h2);
        expect(repo2.get(spaceId, 9)?.text).toBe("written before the restart");
        await handleTelegramUpdate(ctx2, update(9, "/done"), send2);
        expect(box2.at(-1)!.text).toMatch(/Note saved/i);
        const nodes = new NodesRepo(h2, spaceId).all();
        expect(nodes).toHaveLength(1);
        expect(nodes[0]!.content).toBe("written before the restart");
      } finally {
        h2.sqlite.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("telegram notes — isolation", () => {
  it("two chats in two spaces are fully isolated", async () => {
    const spaceA = await linkChat(1, "alice", "alicepass");
    const spaceB = await linkChat(2, "bob", "bobpassword");
    expect(spaceA).not.toBe(spaceB);

    await handleTelegramUpdate(ctx, update(1, "/note"), send);
    await handleTelegramUpdate(ctx, update(2, "/note"), send);
    await handleTelegramUpdate(ctx, update(1, "alice's secret note"), send);
    await handleTelegramUpdate(ctx, update(2, "bob's own note"), send);

    expect(drafts().get(spaceA, 1)!.text).toBe("alice's secret note");
    expect(drafts().get(spaceB, 2)!.text).toBe("bob's own note");

    await handleTelegramUpdate(ctx, update(1, "/done"), send);
    // Alice's save lands only in Alice's space; Bob's draft is untouched.
    expect(new NodesRepo(handle, spaceA).all()).toHaveLength(1);
    expect(new NodesRepo(handle, spaceB).all()).toHaveLength(0);
    expect(drafts().get(spaceB, 2)!.text).toBe("bob's own note");

    await handleTelegramUpdate(ctx, update(2, "/done"), send);
    expect(new NodesRepo(handle, spaceB).all()[0]!.content).toBe("bob's own note");
  });

  it("two chats linked to the SAME space keep separate drafts", async () => {
    const spaceId = await linkChat(1, "shared", "sharedpass");
    const sameSpace = await linkChat(2, "shared", "sharedpass");
    expect(sameSpace).toBe(spaceId);

    await handleTelegramUpdate(ctx, update(1, "/note"), send);
    await handleTelegramUpdate(ctx, update(1, "chat one's words"), send);
    // Chat two has no draft: its draft slot is empty even in the same space.
    expect(drafts().get(spaceId, 2)).toBeUndefined();
    expect(drafts().get(spaceId, 1)!.text).toBe("chat one's words");
  });
});

describe("telegram notes — precedence", () => {
  it("a pending write-approval 'yes' during an active note confirms the approval and is NOT appended", async () => {
    const spaceId = await linkChat(7);
    // Seed a source memory + a pending create_task approval for this chat's
    // principal, as the agent loop would have proposed on a prior turn.
    const seedVec = await ctx.embeddings.embed("dentist appointment memory");
    const source = new NodesRepo(handle, spaceId).create(
      { label: "dentist", type: "daily", content: "dentist appointment memory" },
      seedVec,
    );
    const tc: ToolContext = { ctx, spaceId, now: Date.now(), notify: async () => {} };
    const req = requestApproval(tc, taskCreatorTool, { nodeId: source.id, label: "call dentist" }, "telegram:7");
    expect(req.ok).toBe(true);

    await handleTelegramUpdate(ctx, update(7, "/note"), send);
    await handleTelegramUpdate(ctx, update(7, "first note part"), send);
    expect(drafts().get(spaceId, 7)!.partCount).toBe(1);

    await handleTelegramUpdate(ctx, update(7, "yes"), send);
    // The reply is the approval's execution result — not a note ack.
    expect(outbox.at(-1)!.text).toContain("call dentist");
    expect(outbox.at(-1)!.text).not.toMatch(/Part \d+ added/);
    // The approval actually executed (one action node created)…
    const actions = handle.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM nodes WHERE space_id = ? AND kind = 'action'`)
      .get(spaceId) as { c: number };
    expect(actions.c).toBe(1);
    // …and "yes" did NOT land in the note.
    const draft = drafts().get(spaceId, 7);
    expect(draft).toBeDefined();
    expect(draft!.partCount).toBe(1);
    expect(draft!.text).toBe("first note part");

    // The note still finalizes cleanly afterwards, without the "yes".
    await handleTelegramUpdate(ctx, update(7, "/done"), send);
    const saved = new NodesRepo(handle, spaceId).all().find((n) => n.tags?.includes("note"));
    expect(saved).toBeDefined();
    expect(saved!.content).toBe("first note part");
  });

  it("a 'yes' with NO pending approval is ordinary note text and appends", async () => {
    const spaceId = await linkChat(7);
    await handleTelegramUpdate(ctx, update(7, "/note"), send);
    await handleTelegramUpdate(ctx, update(7, "yes"), send);
    expect(outbox.at(-1)!.text).toMatch(/Part 1 added/);
    expect(drafts().get(spaceId, 7)!.text).toBe("yes");
  });

  it("/digest during a note runs the digest and is not eaten as note text", async () => {
    const spaceId = await linkChat(7);
    ctx.llm = capturingLlm(["unused"]);
    await handleTelegramUpdate(ctx, update(7, "/note"), send);
    await handleTelegramUpdate(ctx, update(7, "part before digest"), send);

    await handleTelegramUpdate(ctx, update(7, "/digest"), send);
    expect(outbox.at(-1)!.text).toContain("🌌"); // formatDigest header
    expect(outbox.at(-1)!.text).not.toMatch(/Part \d+ added/);
    const draft = drafts().get(spaceId, 7);
    expect(draft!.partCount).toBe(1);
    expect(draft!.text).toBe("part before digest");

    // And the note continues normally after the command.
    await handleTelegramUpdate(ctx, update(7, "part after digest"), send);
    expect(outbox.at(-1)!.text).toMatch(/Part 2 added/);
    expect(drafts().get(spaceId, 7)!.text).toBe("part before digest\npart after digest");
  });

  it("with NO draft active, messages are untouched: they reach the agent loop and no draft appears", async () => {
    const spaceId = await linkChat(7);
    ctx.llm = capturingLlm(["plain chat reply"]);
    await handleTelegramUpdate(ctx, update(7, "just a normal message"), send);
    expect(outbox.at(-1)!.text).toBe("plain chat reply");
    expect(captured).toHaveLength(1);
    expect(drafts().get(spaceId, 7)).toBeUndefined();
  });
});

describe("telegram notes — bounds & expiry", () => {
  it("refuses an append once the part cap is hit, keeping the draft open", async () => {
    const spaceId = await linkChat(7);
    // Seed a draft at the cap directly through the repo (dictating 50 real
    // messages would only test the same counter more slowly).
    drafts().insert(spaceId, 7, "seeded", NOTE_MAX_PARTS, new Date().toISOString());
    await handleTelegramUpdate(ctx, update(7, "one too many"), send);
    expect(outbox.at(-1)!.text).toMatch(/maximum 50 parts/i);
    expect(outbox.at(-1)!.text).toMatch(/NOT added/);
    const draft = drafts().get(spaceId, 7);
    expect(draft!.partCount).toBe(NOTE_MAX_PARTS);
    expect(draft!.text).toBe("seeded");
  });

  it("refuses an append that would cross the character cap", async () => {
    const spaceId = await linkChat(7);
    const almostFull = "x".repeat(NOTE_MAX_CHARS - 10);
    drafts().insert(spaceId, 7, almostFull, 1, new Date().toISOString());
    await handleTelegramUpdate(ctx, update(7, "this will not fit in ten chars"), send);
    expect(outbox.at(-1)!.text).toMatch(/20000-character limit/i);
    expect(outbox.at(-1)!.text).toMatch(/NOT added/);
    expect(drafts().get(spaceId, 7)!.text).toBe(almostFull);
  });

  it("a draft idle over 24h is discarded on next contact, with a warning, and the message flows on", async () => {
    const spaceId = await linkChat(7);
    ctx.llm = capturingLlm(["fresh reply after expiry"]);
    const oldIso = new Date(Date.now() - NOTE_IDLE_EXPIRY_MS - 60_000).toISOString();
    drafts().insert(spaceId, 7, "stale dictated words", 1, oldIso);

    await handleTelegramUpdate(ctx, update(7, "hello again"), send);
    // First the expiry warning, then the message itself was answered normally
    // (it was NOT appended to the dead draft).
    expect(outbox.at(-2)!.text).toMatch(/discarded/i);
    expect(outbox.at(-2)!.text).toMatch(/24 hours/i);
    expect(outbox.at(-1)!.text).toBe("fresh reply after expiry");
    expect(drafts().get(spaceId, 7)).toBeUndefined();
    expect(new NodesRepo(handle, spaceId).all()).toHaveLength(0);
  });
});
