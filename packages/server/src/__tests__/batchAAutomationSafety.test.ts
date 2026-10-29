import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import {
  handleTelegramUpdate,
  sendDailyDigests,
  tgSend,
  createTelegramSpaceSender,
  type TelegramUpdate,
} from "../telegram/bot.js";
import { TelegramLinksRepo } from "../telegram/links.js";
import { sweepNotifications, type BoundaryDeps } from "../agent/notify/boundary.js";
import { enqueue, getRow } from "../agent/notify/outbox.js";
import { countActiveClaims } from "../agent/notify/capClaims.js";
import { runToolRouter } from "../agent/tools/router.js";

/**
 * Batch A (automation safety) — RE-01 / RE-02 / TG-05 / TG-06 / TG-09 /
 * TG-10 behavioural tests. These use only seams that already exist on the
 * base (tgSend, the boundary, the digest sweep, the router, the bot
 * handler) so every failure below is a behaviour failure, not an import
 * failure. New-seam unit tests live in batchANewSeams.test.ts.
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

const MIDDAY = new Date("2026-10-19T15:00:00Z"); // 11:00 EDT — outside quiet hours
const DAY = "2026-10-19";

function fetchOk() {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, result: {} }),
  }));
}
function fetchRefused(status = 403) {
  return vi.fn(async () => ({
    ok: false,
    status,
    json: async () => ({ ok: false, description: "Forbidden: bot was blocked by the user" }),
  }));
}
function fetchOkFalseBody() {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: false, description: "chat not found" }),
  }));
}
function fetchNetworkDown() {
  return vi.fn(async () => {
    throw new Error("fetch failed: network unreachable");
  });
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
});
afterEach(() => {
  vi.unstubAllGlobals();
  handle.sqlite.close();
});

async function linkChat(chatId: number, name = "soumaya", passcode = "hunter222"): Promise<string> {
  await handleTelegramUpdate(ctx, update(chatId, `/link ${name} ${passcode}`), send);
  const link = new TelegramLinksRepo(handle).get(chatId);
  expect(link).toBeDefined();
  outbox = [];
  return link!.spaceId;
}

function nodeCount(spaceId: string): number {
  return (
    handle.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM nodes WHERE space_id = ?`)
      .get(spaceId) as { c: number }
  ).c;
}

// ---------------------------------------------------------------------------
// RE-01 — tgSend must report outcomes honestly
// ---------------------------------------------------------------------------

describe("RE-01 tgSend honesty", () => {
  it("resolves when Telegram accepts the message", async () => {
    vi.stubGlobal("fetch", fetchOk());
    await expect(tgSend("TOKEN", 42, "hello")).resolves.toBeUndefined();
  });

  it("rejects when Telegram refuses the message (HTTP 403)", async () => {
    vi.stubGlobal("fetch", fetchRefused(403));
    await expect(tgSend("TOKEN", 42, "hello")).rejects.toThrow(/403/);
  });

  it("rejects when the response body says ok:false even with HTTP 200", async () => {
    vi.stubGlobal("fetch", fetchOkFalseBody());
    await expect(tgSend("TOKEN", 42, "hello")).rejects.toThrow();
  });

  it("rejects (does not silently resolve) when the network fails", async () => {
    vi.stubGlobal("fetch", fetchNetworkDown());
    await expect(tgSend("TOKEN", 42, "hello")).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// RE-01 — the boundary, composed exactly as index.ts wires it (links loop
// over tgSend), must not record a refused send as sent
// ---------------------------------------------------------------------------

function boundaryDepsWithRealSender(spaceId: string): BoundaryDeps {
  return {
    sqlite: handle.sqlite,
    handle,
    // The index.ts rawSend composition: the production sender, reporting
    // per-chat outcomes (H-2). tgSend's honesty is what the boundary sees.
    send: createTelegramSpaceSender(handle, "TOKEN"),
    audit: () => {},
    workerId: "batch-a-test",
  };
}

function enqueueCheckin(spaceId: string): number {
  const { id } = enqueue(handle.sqlite, {
    spaceId,
    meta: { tool: "checkin", occurrenceId: `day:${DAY}` },
    message: "morning checkin",
    urgency: { isUrgent: false },
    deliverAfter: new Date(MIDDAY.getTime() - 60_000).toISOString(),
    queueReason: "test",
  });
  return id;
}

function claimState(spaceId: string): string | undefined {
  const rows = handle.sqlite
    .prepare(`SELECT state FROM notification_cap_claims WHERE space_id = ?`)
    .all(spaceId) as { state: string }[];
  return rows[0]?.state;
}

describe("RE-01 boundary records with the real sender", () => {
  it("a Telegram-refused send is NOT recorded as sent and its cap claim is released for retry", async () => {
    const spaceId = await linkChat(11);
    vi.stubGlobal("fetch", fetchRefused(403));
    const id = enqueueCheckin(spaceId);
    await sweepNotifications(boundaryDepsWithRealSender(spaceId), MIDDAY);
    const row = getRow(handle.sqlite, id)!;
    expect(row.status).not.toBe("sent");
    expect(row.status).toBe("queued"); // definite failure → retry path
    expect(row.attempts).toBe(1);
    expect(claimState(spaceId)).toBe("released");
    expect(countActiveClaims(handle.sqlite, spaceId, DAY)).toBe(0);
  });

  it("a network-failed send is NOT a clean success and NOT a definite failure: it lands ambiguous, cap retained, never resent", async () => {
    const spaceId = await linkChat(12);
    const fetchSpy = fetchNetworkDown();
    vi.stubGlobal("fetch", fetchSpy);
    const id = enqueueCheckin(spaceId);
    const deps = boundaryDepsWithRealSender(spaceId);
    await sweepNotifications(deps, MIDDAY);
    const row = getRow(handle.sqlite, id)!;
    expect(row.status).toBe("ambiguous");
    expect(claimState(spaceId)).toBe("ambiguous");
    expect(countActiveClaims(handle.sqlite, spaceId, DAY)).toBe(1);
    const callsAfterFirst = fetchSpy.mock.calls.length;
    await sweepNotifications(deps, new Date(MIDDAY.getTime() + 3600_000));
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst); // never resent
    expect(getRow(handle.sqlite, id)!.status).toBe("ambiguous");
  });

  it("a delivered send still records exactly as today: sent + claim sent", async () => {
    const spaceId = await linkChat(13);
    vi.stubGlobal("fetch", fetchOk());
    const id = enqueueCheckin(spaceId);
    await sweepNotifications(boundaryDepsWithRealSender(spaceId), MIDDAY);
    expect(getRow(handle.sqlite, id)!.status).toBe("sent");
    expect(claimState(spaceId)).toBe("sent");
    expect(countActiveClaims(handle.sqlite, spaceId, DAY)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// RE-01 — the digest is marked sent only when delivery actually succeeded
// (production wiring: index.ts passes (chatId, text) => tgSend(...))
// ---------------------------------------------------------------------------

describe("RE-01 digest marking", () => {
  // V1 follow-up item 4c — pin the clock (Date only; real timers
  // keep flowing) for the whole describe. sendDailyDigests reads
  // the real clock and skips before the space's 06:00
  // America/New_York digest time: pre-06:00 the "delivered" test
  // failed outright and the two refusal tests passed vacuously
  // (the digest was never even attempted). 15:00Z is 11:00 in
  // New York — the sweep really runs, at any real hour.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T15:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a refused digest is not marked sent and does not count as sent", async () => {
    await linkChat(21);
    await handleTelegramUpdate(ctx, update(21, "/log a run in the park"), send);
    outbox = [];
    vi.stubGlobal("fetch", fetchRefused(403));
    const sent = await sendDailyDigests(ctx, (chatId, text) => tgSend("TOKEN", chatId, text));
    expect(sent).toBe(0);
    expect(new TelegramLinksRepo(handle).get(21)!.lastDigestDate).toBeNull();
  });

  it("a network-failed digest is not marked sent either", async () => {
    await linkChat(22);
    vi.stubGlobal("fetch", fetchNetworkDown());
    const sent = await sendDailyDigests(ctx, (chatId, text) => tgSend("TOKEN", chatId, text));
    expect(sent).toBe(0);
    expect(new TelegramLinksRepo(handle).get(22)!.lastDigestDate).toBeNull();
  });

  it("a delivered digest is still marked sent (regression pin)", async () => {
    await linkChat(23);
    const sent = await sendDailyDigests(ctx, send);
    expect(sent).toBe(1);
    expect(new TelegramLinksRepo(handle).get(23)!.lastDigestDate).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RE-02(b) — a reminder that reaches no channel is deferred, not consumed
// (router run with NO notify configured — the no-token production shape)
// ---------------------------------------------------------------------------

describe("RE-02 reminder with no channel defers", () => {
  it("router without notify: reminder is not consumed as fired and fires once a channel exists", async () => {
    const now = Date.UTC(2026, 2, 1, 12, 0, 0);
    const info = handle.sqlite
      .prepare(
        `INSERT INTO nodes (space_id, label, type, content, remind_at) VALUES ('s1', 'Call mom', 'knowledge', 'Call mom', ?)`,
      )
      .run(new Date(now - 60_000).toISOString());
    const id = Number(info.lastInsertRowid);
    const firedAt = () =>
      (
        handle.sqlite.prepare(`SELECT reminder_fired_at AS f FROM nodes WHERE id = ?`).get(id) as {
          f: string | null;
        }
      ).f;

    const first = await runToolRouter(ctx, "s1", { now });
    const reminderResult = first.find((r) => r.summary.includes("Call mom"));
    expect(reminderResult).toBeDefined();
    expect(reminderResult!.delivered).toBe(false);
    expect(firedAt()).toBeNull(); // deferred — still deliverable later

    // A channel appears: the same reminder now fires and is consumed.
    const sent: string[] = [];
    const second = await runToolRouter(ctx, "s1", {
      now: now + 60_000,
      notify: async (_s, t) => void sent.push(t),
    });
    expect(second.find((r) => r.summary.includes("Call mom"))).toBeDefined();
    expect(sent.some((t) => t.includes("Call mom"))).toBe(true);
    expect(firedAt()).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TG-05 — only the real /log command saves a memory
// ---------------------------------------------------------------------------

describe("TG-05 /log command token", () => {
  it("/logistics does NOT save a memory", async () => {
    const spaceId = await linkChat(31);
    await handleTelegramUpdate(ctx, update(31, "/logistics call with Sam on Friday"), send);
    expect(nodeCount(spaceId)).toBe(0);
    expect(outbox.at(-1)!.text).not.toMatch(/Logged "/);
  });

  it("bare /log replies with usage and saves nothing", async () => {
    const spaceId = await linkChat(32);
    await handleTelegramUpdate(ctx, update(32, "/log"), send);
    expect(outbox.at(-1)!.text).toMatch(/Add the memory after \/log/);
    expect(nodeCount(spaceId)).toBe(0);
  });

  it("/log <thought> still saves (regression pin)", async () => {
    const spaceId = await linkChat(33);
    await handleTelegramUpdate(ctx, update(33, "/log bought concert tickets"), send);
    expect(outbox.at(-1)!.text).toMatch(/Logged "/);
    expect(nodeCount(spaceId)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// TG-06 — a throw inside /log or /digest replies instead of silence
// (failure induced by dropping the nodes table after linking: ingestion
// and digest-building both read it and throw)
// ---------------------------------------------------------------------------

describe("TG-06 command failures are answered, never silent", () => {
  it("/log failure → plain-language failure reply", async () => {
    await linkChat(41);
    handle.sqlite.exec(`DROP TABLE nodes`);
    await handleTelegramUpdate(ctx, update(41, "/log this will fail to save"), send);
    expect(outbox.at(-1)!.text).toMatch(/couldn't save/i);
  });

  it("/digest failure → plain-language failure reply", async () => {
    await linkChat(42);
    handle.sqlite.exec(`DROP TABLE nodes`);
    await handleTelegramUpdate(ctx, update(42, "/digest"), send);
    expect(outbox.at(-1)!.text).toMatch(/couldn't put your digest together/i);
  });
});

// ---------------------------------------------------------------------------
// TG-09 — the 24-hour note-draft lifetime is disclosed up front
// ---------------------------------------------------------------------------

describe("TG-09 note draft lifetime disclosure", () => {
  it("/note start message states the 24-hour lifetime", async () => {
    await linkChat(51);
    await handleTelegramUpdate(ctx, update(51, "/note"), send);
    expect(outbox.at(-1)!.text).toMatch(/24 hours/);
  });

  it("/note start with a first part also states the lifetime", async () => {
    await linkChat(52);
    await handleTelegramUpdate(ctx, update(52, "/note first part here"), send);
    expect(outbox.at(-1)!.text).toMatch(/24 hours/);
  });

  it("the already-in-progress (resume) message states the lifetime", async () => {
    await linkChat(53);
    await handleTelegramUpdate(ctx, update(53, "/note"), send);
    await handleTelegramUpdate(ctx, update(53, "/note"), send);
    expect(outbox.at(-1)!.text).toMatch(/already in progress/i);
    expect(outbox.at(-1)!.text).toMatch(/24 hours/);
  });

  it("HELP's /note line states the lifetime", async () => {
    await handleTelegramUpdate(ctx, update(54, "/help"), send);
    const help = outbox.at(-1)!.text;
    const noteLine = help.split("\n").find((l) => l.includes("/note"));
    expect(noteLine).toBeDefined();
    expect(noteLine).toMatch(/24 hours/);
  });
});

// ---------------------------------------------------------------------------
// TG-10 / RE-05 — /cap copy states the digest is separate from the cap
// ---------------------------------------------------------------------------

describe("TG-10 cap copy", () => {
  it("/cap success reply states the daily digest doesn't count against the cap", async () => {
    await linkChat(61);
    await handleTelegramUpdate(ctx, update(61, "/cap 5"), send);
    const reply = outbox.at(-1)!.text;
    expect(reply).toMatch(/Daily cap set to 5/);
    expect(reply).toMatch(/digest/i);
    expect(reply).toMatch(/doesn't count|does not count|not counted|separate/i);
  });

  it("HELP's /cap line states the digest doesn't count", async () => {
    await handleTelegramUpdate(ctx, update(62, "/help"), send);
    const capLine = outbox.at(-1)!.text.split("\n").find((l) => l.includes("/cap"));
    expect(capLine).toBeDefined();
    expect(capLine).toMatch(/digest/i);
    expect(capLine).toMatch(/doesn't count|does not count|not counted|separate/i);
  });
});
