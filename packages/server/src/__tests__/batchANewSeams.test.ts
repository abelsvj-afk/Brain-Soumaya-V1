import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import {
  AmbiguousSendError,
  NoRecipientsError,
} from "../agent/notify/sendErrors.js";
import {
  createPolicyNotify,
  sweepNotifications,
  type BoundaryDeps,
} from "../agent/notify/boundary.js";
import { enqueue, getRow, listDeliveryChildren } from "../agent/notify/outbox.js";
import { countActiveClaims } from "../agent/notify/capClaims.js";
import { createTelegramSpaceSender, tgSend } from "../telegram/bot.js";
import { TelegramLinksRepo } from "../telegram/links.js";
import { reminderTool } from "../agent/tools/reminder.js";
import type { ToolContext } from "../agent/tools/types.js";

/**
 * Batch A — NEW-seam unit tests (RE-01 classification, RE-02 zero
 * recipients). These import the seams the fix introduces
 * (agent/notify/sendErrors.ts, createTelegramSpaceSender), so on the
 * base this file fails at import — recorded as the fail-before for the
 * new seam; the behavioural fail-before pairs live in
 * batchAAutomationSafety.test.ts.
 */

let handle: DbHandle;
let ctx: AppContext;

const MIDDAY = new Date("2026-10-19T15:00:00Z"); // 11:00 EDT
const DAY = "2026-10-19";

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = {
    handle,
    embeddings: new HashEmbeddingProvider(EMBED_DIM),
    llm: new HeuristicProvider(),
    usage: new UsageTracker(handle),
  };
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
});
afterEach(() => {
  vi.unstubAllGlobals();
  handle.sqlite.close();
});

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
    json: async () => ({ ok: false, description: "Forbidden" }),
  }));
}
function fetchNetworkDown() {
  return vi.fn(async () => {
    throw new Error("fetch failed: network unreachable");
  });
}

// ---------------------------------------------------------------------------
// RE-01 classification at the sender: response-received = definite,
// no-response = ambiguous
// ---------------------------------------------------------------------------

describe("RE-01 tgSend classification", () => {
  it("network failure (no response) throws AmbiguousSendError", async () => {
    vi.stubGlobal("fetch", fetchNetworkDown());
    const err = await tgSend("TOKEN", 42, "hi").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AmbiguousSendError);
  });

  it("HTTP refusal (response received) throws a definite error, NOT ambiguous", async () => {
    vi.stubGlobal("fetch", fetchRefused(403));
    const err = await tgSend("TOKEN", 42, "hi").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(AmbiguousSendError);
    expect((err as Error).message).toMatch(/403/);
  });
});

// ---------------------------------------------------------------------------
// RE-02(a) — the production raw sender (index.ts seam): zero recipients
// ---------------------------------------------------------------------------

describe("RE-02 createTelegramSpaceSender", () => {
  it("zero linked chats → NoRecipientsError, no fetch attempted", async () => {
    const fetchSpy = fetchOk();
    vi.stubGlobal("fetch", fetchSpy);
    const rawSend = createTelegramSpaceSender(handle, "TOKEN");
    const err = await rawSend("no-such-space", "hello").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NoRecipientsError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("one linked chat, Telegram accepts → report with one sent entry", async () => {
    new TelegramLinksRepo(handle).link(71, "sp-a", "Brain A");
    vi.stubGlobal("fetch", fetchOk());
    const rawSend = createTelegramSpaceSender(handle, "TOKEN");
    await expect(rawSend("sp-a", "hello")).resolves.toEqual({
      attempted: [{ chatId: 71, outcome: "sent" }],
    });
  });

  it("one linked chat, Telegram refuses → report with one refused entry (no throw)", async () => {
    new TelegramLinksRepo(handle).link(72, "sp-a", "Brain A");
    vi.stubGlobal("fetch", fetchRefused(403));
    const rawSend = createTelegramSpaceSender(handle, "TOKEN");
    await expect(rawSend("sp-a", "hello")).resolves.toEqual({
      attempted: [{ chatId: 72, outcome: "refused", error: expect.stringContaining("403") }],
    });
  });

  it("one linked chat, network down → report with one ambiguous entry (no throw)", async () => {
    new TelegramLinksRepo(handle).link(73, "sp-a", "Brain A");
    vi.stubGlobal("fetch", fetchNetworkDown());
    const rawSend = createTelegramSpaceSender(handle, "TOKEN");
    await expect(rawSend("sp-a", "hello")).resolves.toEqual({
      attempted: [{ chatId: 73, outcome: "ambiguous", error: expect.any(String) }],
    });
  });

  it("two linked chats: every chat is attempted even when one refuses; the report carries both outcomes", async () => {
    new TelegramLinksRepo(handle).link(74, "sp-a", "Brain A");
    new TelegramLinksRepo(handle).link(75, "sp-a", "Brain A");
    const fetchSpy = vi.fn(async (url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as { chat_id?: number };
      if (body.chat_id === 74) {
        return { ok: false, status: 403, json: async () => ({ ok: false, description: "blocked" }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) };
    });
    vi.stubGlobal("fetch", fetchSpy);
    const rawSend = createTelegramSpaceSender(handle, "TOKEN");
    const report = await rawSend("sp-a", "hello");
    expect(fetchSpy.mock.calls.length).toBe(2); // both attempted
    expect(report.attempted).toHaveLength(2);
    expect(report.attempted.find((a) => a.chatId === 74)?.outcome).toBe("refused");
    expect(report.attempted.find((a) => a.chatId === 75)?.outcome).toBe("sent");
  });

  it("retry scoping: onlyChatIds restricts the attempt set; an unlinked requested chat is reported skipped", async () => {
    new TelegramLinksRepo(handle).link(76, "sp-a", "Brain A");
    new TelegramLinksRepo(handle).link(77, "sp-a", "Brain A");
    const fetchSpy = fetchOk();
    vi.stubGlobal("fetch", fetchSpy);
    const rawSend = createTelegramSpaceSender(handle, "TOKEN");
    // 76 still linked, 77 still linked but not requested, 78 requested but unlinked.
    const report = await rawSend("sp-a", "hello", [76, 78]);
    expect(fetchSpy.mock.calls.length).toBe(1); // only 76 attempted
    expect(report.attempted).toEqual([
      { chatId: 76, outcome: "sent" },
      { chatId: 78, outcome: "skipped" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// RE-01 / RE-02 at the boundary: outcome classification drives the ledger
// ---------------------------------------------------------------------------

function depsWith(send: BoundaryDeps["send"]): BoundaryDeps {
  return { sqlite: handle.sqlite, handle, send, audit: () => {}, workerId: "batch-a-seams" };
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

describe("boundary outcome classification", () => {
  // NOTE (H-2): these stubs throw instead of returning a report — that is
  // the production sender's UNEXPECTED-throw path (a bug, a DB error
  // reading links), which executeSend still handles with today's
  // definite-failure / ambiguous / no-recipients handling. The primary
  // report path is covered by the H-2 matrix below.
  it("AmbiguousSendError → row ambiguous, claim retained as ambiguous, never resent", async () => {
    const send = vi.fn(async () => {
      throw new AmbiguousSendError("no response from Telegram");
    });
    const id = enqueueCheckin("sp-amb");
    await sweepNotifications(depsWith(send), MIDDAY);
    expect(getRow(handle.sqlite, id)!.status).toBe("ambiguous");
    expect(claimState("sp-amb")).toBe("ambiguous");
    expect(countActiveClaims(handle.sqlite, "sp-amb", DAY)).toBe(1);
    await sweepNotifications(depsWith(send), new Date(MIDDAY.getTime() + 3600_000));
    expect(send.mock.calls.length).toBe(1);
  });

  it("NoRecipientsError → row dropped, claim released (never sent, no slot kept)", async () => {
    const send = vi.fn(async () => {
      throw new NoRecipientsError("no linked chats");
    });
    const id = enqueueCheckin("sp-none");
    await sweepNotifications(depsWith(send), MIDDAY);
    expect(getRow(handle.sqlite, id)!.status).toBe("dropped");
    expect(claimState("sp-none")).toBe("released");
    expect(countActiveClaims(handle.sqlite, "sp-none", DAY)).toBe(0);
  });

  it("plain definite error → existing retry path (queued, attempts+1, claim released)", async () => {
    const send = vi.fn(async () => {
      throw new Error("Telegram send failed: HTTP 500");
    });
    const id = enqueueCheckin("sp-def");
    await sweepNotifications(depsWith(send), MIDDAY);
    const row = getRow(handle.sqlite, id)!;
    expect(row.status).toBe("queued");
    expect(row.attempts).toBe(1);
    expect(claimState("sp-def")).toBe("released");
  });

  it("createPolicyNotify surfaces NoRecipientsError to its caller after recording the drop", async () => {
    // Keep the immediate path out of quiet hours regardless of wall clock:
    // a 1-hour quiet window six hours from the current UTC hour.
    const nowH = new Date().getUTCHours();
    const qs = String((nowH + 6) % 24).padStart(2, "0") + ":00";
    const qe = String((nowH + 7) % 24).padStart(2, "0") + ":00";
    handle.sqlite
      .prepare(
        `INSERT INTO space_meta (space_id, timezone, quiet_start, quiet_end, digest_time, daily_proactive_cap)
         VALUES ('sp-imm', 'UTC', ?, ?, '06:00', 5)`,
      )
      .run(qs, qe);
    const notify = createPolicyNotify(
      depsWith(async () => {
        throw new NoRecipientsError("no linked chats");
      }),
    );
    const err = await notify("sp-imm", "hello", { tool: "checkin" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NoRecipientsError);
    const rows = handle.sqlite
      .prepare(`SELECT status FROM notification_outbox WHERE space_id = 'sp-imm'`)
      .all() as { status: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("dropped");
  });
});

// ---------------------------------------------------------------------------
// RE-02(b) — reminder whose notify reports zero recipients defers
// ---------------------------------------------------------------------------

describe("RE-02 reminder defer on NoRecipientsError", () => {
  const NOW = Date.parse("2026-01-10T12:00:00Z");

  function makeReminder(spaceId: string, label: string): number {
    const info = handle.sqlite
      .prepare(`INSERT INTO nodes (space_id, label, type, content, remind_at) VALUES (?, ?, 'knowledge', ?, ?)`)
      .run(spaceId, label, label, new Date(NOW - 30_000).toISOString());
    return Number(info.lastInsertRowid);
  }
  const firedAt = (id: number) =>
    (
      handle.sqlite.prepare(`SELECT reminder_fired_at AS f FROM nodes WHERE id = ?`).get(id) as {
        f: string | null;
      }
    ).f;

  it("notify throws NoRecipientsError and push is unconfigured → deferred, still detectable", async () => {
    const id = makeReminder("sp-rem", "Water the plants");
    const tc: ToolContext = {
      ctx,
      spaceId: "sp-rem",
      now: NOW,
      notify: async () => {
        throw new NoRecipientsError("no linked chats");
      },
    };
    const res = await reminderTool.run(tc, { nodeId: id });
    expect(res.ok).toBe(true);
    expect(res.delivered).toBe(false);
    expect(res.summary).toMatch(/deferred/i);
    expect(firedAt(id)).toBeNull();
    // Still deliverable later: detect proposes it again.
    expect(reminderTool.detect(tc).some((i) => i.args.nodeId === id)).toBe(true);
  });

  it("the same reminder fires normally once notify reaches a channel", async () => {
    const id = makeReminder("sp-rem", "Water the plants");
    const bad: ToolContext = {
      ctx,
      spaceId: "sp-rem",
      now: NOW,
      notify: async () => {
        throw new NoRecipientsError("no linked chats");
      },
    };
    await reminderTool.run(bad, { nodeId: id });
    expect(firedAt(id)).toBeNull();

    const sent: string[] = [];
    const good: ToolContext = {
      ctx,
      spaceId: "sp-rem",
      now: NOW + 60_000,
      notify: async (t) => void sent.push(t),
    };
    const res = await reminderTool.run(good, { nodeId: id });
    expect(res.delivered).toBe(true);
    expect(sent.some((t) => t.includes("Water the plants"))).toBe(true);
    expect(firedAt(id)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// H-2 (REG-191) — per-chat outcome tracking: a retry re-attempts ONLY the
// chats still pending; an accepting chat receives the message exactly once.
// Driven through the real boundary + real sender with stubbed fetch, per
// the hunt's driver N1 setup (chats 111 accepts, 222 refuses 403).
// ---------------------------------------------------------------------------

describe("H-2 per-chat outcome tracking (REG-191)", () => {
  type ChatBehavior = "ok" | "refused" | "down";

  function depsWithRealSender(): BoundaryDeps {
    return {
      sqlite: handle.sqlite,
      handle,
      send: createTelegramSpaceSender(handle, "TOKEN"),
      audit: () => {},
      workerId: "h2-test",
    };
  }

  function enqueueH2(spaceId: string, occurrence: string): number {
    const { id } = enqueue(handle.sqlite, {
      spaceId,
      meta: { tool: "checkin", occurrenceId: occurrence },
      message: "morning checkin",
      urgency: { isUrgent: false },
      deliverAfter: new Date(MIDDAY.getTime() - 60_000).toISOString(),
      queueReason: "test",
    });
    return id;
  }

  function claimsFor(notifKey: string) {
    return handle.sqlite
      .prepare(`SELECT state FROM notification_cap_claims WHERE delivery_key = ?`)
      .all(notifKey) as { state: string }[];
  }

  function episodeCount(spaceId: string): number {
    const row = handle.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM episodes WHERE space_id = ? AND kind = 'proactive_msg'`)
      .get(spaceId) as { c: number };
    return row.c;
  }

  /** Flush the fire-and-forget episode capture (a microtask after the sweep). */
  async function flush() {
    await new Promise((resolve) => setImmediate(resolve));
  }

  function makeFetch(behavior: Map<number, ChatBehavior>, counts: Map<number, number>) {
    return vi.fn(async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as { chat_id?: number };
      const chatId = body.chat_id ?? 0;
      counts.set(chatId, (counts.get(chatId) ?? 0) + 1);
      const b = behavior.get(chatId) ?? "ok";
      if (b === "down") throw new Error("fetch failed: network unreachable");
      if (b === "refused") {
        return { ok: false, status: 403, json: async () => ({ ok: false, description: "Forbidden" }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }) };
    });
  }

  function linkBoth(spaceId: string) {
    new TelegramLinksRepo(handle).link(111, spaceId, "Brain");
    new TelegramLinksRepo(handle).link(222, spaceId, "Brain");
  }

  it("acceptance (design §5.1): partial delivery retries only the refused chat — the accepting chat is sent exactly once", async () => {
    const spaceId = "sp-h2-1";
    linkBoth(spaceId);
    const behavior = new Map<number, ChatBehavior>([
      [111, "ok"],
      [222, "refused"],
    ]);
    const counts = new Map<number, number>();
    vi.stubGlobal("fetch", makeFetch(behavior, counts));
    const deps = depsWithRealSender();
    const id = enqueueH2(spaceId, "h2-r1");

    // Round 1: fetch called once per chat. Row re-queued; child 111 sent,
    // child 222 pending; the cap claim released for the retry.
    const s1 = await sweepNotifications(deps, MIDDAY);
    expect(s1).toEqual({ sent: 0, queued: 1, ambiguous: 0, retried: 0, failed: 0, dropped: 0 });
    expect(counts.get(111)).toBe(1);
    expect(counts.get(222)).toBe(1);
    const row1 = getRow(handle.sqlite, id)!;
    expect(row1.status).toBe("queued");
    expect(new Date(row1.deliverAfter).getTime()).toBeGreaterThan(MIDDAY.getTime());
    expect(listDeliveryChildren(handle.sqlite, id)).toEqual([
      { chatId: 111, status: "sent", attempts: 1, lastError: null },
      { chatId: 222, status: "pending", attempts: 1, lastError: null },
    ]);
    expect(countActiveClaims(handle.sqlite, spaceId, DAY)).toBe(0);
    expect(claimsFor(row1.notifKey)).toEqual([{ state: "released" }]); // same ledger row, reactivated on retry

    // Round 2 (222 now accepts, after the +2m backoff): fetch called for
    // 222 ONLY. Totals: 111 ×1, 222 ×2. Row sent; both children sent;
    // exactly one cap claim, in state sent, for the row's notif_key.
    behavior.set(222, "ok");
    const s2 = await sweepNotifications(deps, new Date(MIDDAY.getTime() + 3 * 60_000));
    expect(s2).toEqual({ sent: 1, queued: 0, ambiguous: 0, retried: 0, failed: 0, dropped: 0 });
    expect(counts.get(111)).toBe(1); // never re-attempted
    expect(counts.get(222)).toBe(2);
    const row2 = getRow(handle.sqlite, id)!;
    expect(row2.status).toBe("sent");
    expect(listDeliveryChildren(handle.sqlite, id)).toEqual([
      { chatId: 111, status: "sent", attempts: 1, lastError: null },
      { chatId: 222, status: "sent", attempts: 2, lastError: null },
    ]);
    expect(claimsFor(row2.notifKey)).toEqual([{ state: "sent" }]);
    await flush();
    expect(episodeCount(spaceId)).toBe(1); // captured once, at first delivery
  });

  it("all chats refuse: three sweeps → both children failed, row failed, claim released, zero deliveries", async () => {
    const spaceId = "sp-h2-2";
    linkBoth(spaceId);
    const behavior = new Map<number, ChatBehavior>([
      [111, "refused"],
      [222, "refused"],
    ]);
    const counts = new Map<number, number>();
    vi.stubGlobal("fetch", makeFetch(behavior, counts));
    const deps = depsWithRealSender();
    const id = enqueueH2(spaceId, "h2-r2");

    await sweepNotifications(deps, MIDDAY);
    await sweepNotifications(deps, new Date(MIDDAY.getTime() + 3 * 60_000));
    const s3 = await sweepNotifications(deps, new Date(MIDDAY.getTime() + 8 * 60_000));
    expect(s3).toEqual({ sent: 0, queued: 0, ambiguous: 0, retried: 0, failed: 1, dropped: 0 });
    expect(counts.get(111)).toBe(3);
    expect(counts.get(222)).toBe(3);
    expect(listDeliveryChildren(handle.sqlite, id)).toEqual([
      { chatId: 111, status: "failed", attempts: 3, lastError: "Telegram send failed: HTTP 403" },
      { chatId: 222, status: "failed", attempts: 3, lastError: "Telegram send failed: HTTP 403" },
    ]);
    const row = getRow(handle.sqlite, id)!;
    expect(row.status).toBe("failed");
    expect(countActiveClaims(handle.sqlite, spaceId, DAY)).toBe(0);
    expect(claimsFor(row.notifKey)).toEqual([{ state: "released" }]);
    await flush();
    expect(episodeCount(spaceId)).toBe(0); // no delivery, no episode
  });

  it("all chats accept: row sent after one attempt, one sent claim, episode captured once", async () => {
    const spaceId = "sp-h2-3";
    linkBoth(spaceId);
    const counts = new Map<number, number>();
    vi.stubGlobal("fetch", makeFetch(new Map(), counts));
    const deps = depsWithRealSender();
    const id = enqueueH2(spaceId, "h2-r3");

    const stats = await sweepNotifications(deps, MIDDAY);
    expect(stats).toEqual({ sent: 1, queued: 0, ambiguous: 0, retried: 0, failed: 0, dropped: 0 });
    expect(counts.get(111)).toBe(1);
    expect(counts.get(222)).toBe(1);
    expect(getRow(handle.sqlite, id)!.status).toBe("sent");
    expect(listDeliveryChildren(handle.sqlite, id)).toEqual([
      { chatId: 111, status: "sent", attempts: 1, lastError: null },
      { chatId: 222, status: "sent", attempts: 1, lastError: null },
    ]);
    expect(claimsFor(getRow(handle.sqlite, id)!.notifKey)).toEqual([{ state: "sent" }]);
    await flush();
    expect(episodeCount(spaceId)).toBe(1);
  });

  it("terminal partial: one chat accepts while the other exhausts its refusals → row partial, claim sent, never re-queued", async () => {
    const spaceId = "sp-h2-4";
    linkBoth(spaceId);
    const behavior = new Map<number, ChatBehavior>([
      [111, "ok"],
      [222, "refused"],
    ]);
    const counts = new Map<number, number>();
    vi.stubGlobal("fetch", makeFetch(behavior, counts));
    const deps = depsWithRealSender();
    const id = enqueueH2(spaceId, "h2-r4");

    await sweepNotifications(deps, MIDDAY);
    await sweepNotifications(deps, new Date(MIDDAY.getTime() + 3 * 60_000));
    const s3 = await sweepNotifications(deps, new Date(MIDDAY.getTime() + 8 * 60_000));
    expect(s3).toEqual({ sent: 1, queued: 0, ambiguous: 0, retried: 0, failed: 0, dropped: 0 }); // terminal partial counts as sent (§3.5)
    expect(counts.get(111)).toBe(1); // accepted once, never re-attempted
    expect(counts.get(222)).toBe(3);
    expect(listDeliveryChildren(handle.sqlite, id)).toEqual([
      { chatId: 111, status: "sent", attempts: 1, lastError: null },
      { chatId: 222, status: "failed", attempts: 3, lastError: "Telegram send failed: HTTP 403" },
    ]);
    const row = getRow(handle.sqlite, id)!;
    expect(row.status).toBe("partial");
    expect(row.lastError).toMatch(/chat 222 failed after 3 attempts/);
    expect(claimsFor(row.notifKey)).toEqual([{ state: "sent" }]);
    await flush();
    expect(episodeCount(spaceId)).toBe(1);
    // A later sweep never touches a terminal partial row.
    await sweepNotifications(deps, new Date(MIDDAY.getTime() + 20 * 60_000));
    expect(counts.get(111)).toBe(1);
    expect(counts.get(222)).toBe(3);
    expect(getRow(handle.sqlite, id)!.status).toBe("partial");
  });

  it("ambiguity mixed with refusal: the ambiguous chat is never re-attempted; the refused chat retries alone; row ends ambiguous", async () => {
    const spaceId = "sp-h2-5";
    linkBoth(spaceId);
    const behavior = new Map<number, ChatBehavior>([
      [111, "down"],
      [222, "refused"],
    ]);
    const counts = new Map<number, number>();
    vi.stubGlobal("fetch", makeFetch(behavior, counts));
    const deps = depsWithRealSender();
    const id = enqueueH2(spaceId, "h2-r5");

    await sweepNotifications(deps, MIDDAY);
    expect(listDeliveryChildren(handle.sqlite, id)).toEqual([
      { chatId: 111, status: "ambiguous", attempts: 1, lastError: null },
      { chatId: 222, status: "pending", attempts: 1, lastError: null },
    ]);
    expect(getRow(handle.sqlite, id)!.status).toBe("queued");

    behavior.set(222, "ok");
    await sweepNotifications(deps, new Date(MIDDAY.getTime() + 3 * 60_000));
    expect(counts.get(111)).toBe(1); // never re-attempted
    expect(counts.get(222)).toBe(2);
    const row = getRow(handle.sqlite, id)!;
    expect(row.status).toBe("ambiguous"); // unknown outcome dominates terminal reporting
    expect(listDeliveryChildren(handle.sqlite, id)).toEqual([
      { chatId: 111, status: "ambiguous", attempts: 1, lastError: null },
      { chatId: 222, status: "sent", attempts: 2, lastError: null },
    ]);
    expect(claimsFor(row.notifKey)).toEqual([{ state: "ambiguous" }]);
    expect(countActiveClaims(handle.sqlite, spaceId, DAY)).toBe(1);
    await flush();
    expect(episodeCount(spaceId)).toBe(1); // captured at first delivery, even though the row ends ambiguous
  });

  it("ambiguity mixed with success and no refusals: row ambiguous immediately, never retried", async () => {
    const spaceId = "sp-h2-6";
    linkBoth(spaceId);
    const behavior = new Map<number, ChatBehavior>([
      [111, "ok"],
      [222, "down"],
    ]);
    const counts = new Map<number, number>();
    vi.stubGlobal("fetch", makeFetch(behavior, counts));
    const deps = depsWithRealSender();
    const id = enqueueH2(spaceId, "h2-r6");

    await sweepNotifications(deps, MIDDAY);
    expect(getRow(handle.sqlite, id)!.status).toBe("ambiguous");
    expect(claimsFor(getRow(handle.sqlite, id)!.notifKey)).toEqual([{ state: "ambiguous" }]);
    await sweepNotifications(deps, new Date(MIDDAY.getTime() + 60 * 60_000));
    expect(counts.get(111)).toBe(1);
    expect(counts.get(222)).toBe(1); // never retried
    await flush();
    expect(episodeCount(spaceId)).toBe(1);
  });

  it("no recipients: zero linked chats → row dropped, claim released", async () => {
    const spaceId = "sp-h2-7";
    const counts = new Map<number, number>();
    vi.stubGlobal("fetch", makeFetch(new Map(), counts));
    const deps = depsWithRealSender();
    const id = enqueueH2(spaceId, "h2-r7");

    const stats = await sweepNotifications(deps, MIDDAY);
    expect(stats).toEqual({ sent: 0, queued: 0, ambiguous: 0, retried: 0, failed: 0, dropped: 1 });
    expect(counts.size).toBe(0); // no fetch attempted
    expect(getRow(handle.sqlite, id)!.status).toBe("dropped");
    expect(countActiveClaims(handle.sqlite, spaceId, DAY)).toBe(0);
  });

  it("unlink mid-retry: the refused chat unlinks → retry reports it skipped → row sent, not partial", async () => {
    const spaceId = "sp-h2-8";
    linkBoth(spaceId);
    const behavior = new Map<number, ChatBehavior>([
      [111, "ok"],
      [222, "refused"],
    ]);
    const counts = new Map<number, number>();
    vi.stubGlobal("fetch", makeFetch(behavior, counts));
    const deps = depsWithRealSender();
    const id = enqueueH2(spaceId, "h2-r8");

    await sweepNotifications(deps, MIDDAY);
    expect(getRow(handle.sqlite, id)!.status).toBe("queued");
    new TelegramLinksRepo(handle).unlink(222);
    await sweepNotifications(deps, new Date(MIDDAY.getTime() + 3 * 60_000));
    expect(counts.get(111)).toBe(1);
    expect(counts.get(222)).toBe(1); // no fetch for an unlinked chat
    expect(listDeliveryChildren(handle.sqlite, id)).toEqual([
      { chatId: 111, status: "sent", attempts: 1, lastError: null },
      // attempts 2: refused once (round 1), then reported skipped (round 2)
      { chatId: 222, status: "skipped", attempts: 2, lastError: null },
    ]);
    expect(getRow(handle.sqlite, id)!.status).toBe("sent"); // not partial: delivery completed to the current audience
  });

  it("unlink mid-retry with the other chat refusing 3× → row failed, not partial", async () => {
    const spaceId = "sp-h2-9";
    linkBoth(spaceId);
    const behavior = new Map<number, ChatBehavior>([
      [111, "refused"],
      [222, "refused"],
    ]);
    const counts = new Map<number, number>();
    vi.stubGlobal("fetch", makeFetch(behavior, counts));
    const deps = depsWithRealSender();
    const id = enqueueH2(spaceId, "h2-r9");

    await sweepNotifications(deps, MIDDAY);
    new TelegramLinksRepo(handle).unlink(222);
    await sweepNotifications(deps, new Date(MIDDAY.getTime() + 3 * 60_000));
    await sweepNotifications(deps, new Date(MIDDAY.getTime() + 8 * 60_000));
    expect(counts.get(111)).toBe(3);
    expect(counts.get(222)).toBe(1);
    expect(listDeliveryChildren(handle.sqlite, id)).toEqual([
      { chatId: 111, status: "failed", attempts: 3, lastError: "Telegram send failed: HTTP 403" },
      // attempts 2: refused once (round 1), then reported skipped (round 2)
      { chatId: 222, status: "skipped", attempts: 2, lastError: null },
    ]);
    expect(getRow(handle.sqlite, id)!.status).toBe("failed");
    expect(countActiveClaims(handle.sqlite, spaceId, DAY)).toBe(0);
  });

  it("both chats unlink before any delivery → row dropped", async () => {
    const spaceId = "sp-h2-10";
    linkBoth(spaceId);
    const counts = new Map<number, number>();
    vi.stubGlobal("fetch", makeFetch(new Map(), counts));
    const deps = depsWithRealSender();
    const id = enqueueH2(spaceId, "h2-r10");

    new TelegramLinksRepo(handle).unlink(111);
    new TelegramLinksRepo(handle).unlink(222);
    await sweepNotifications(deps, MIDDAY);
    expect(counts.size).toBe(0);
    expect(getRow(handle.sqlite, id)!.status).toBe("dropped");
    expect(countActiveClaims(handle.sqlite, spaceId, DAY)).toBe(0);
  });

  it("single-chat spaces: refusal retries to terminal failed with no partial row", async () => {
    const spaceId = "sp-h2-11";
    new TelegramLinksRepo(handle).link(111, spaceId, "Brain");
    const counts = new Map<number, number>();
    vi.stubGlobal(
      "fetch",
      makeFetch(new Map<number, ChatBehavior>([[111, "refused"]]), counts),
    );
    const deps = depsWithRealSender();
    const id = enqueueH2(spaceId, "h2-r11");

    await sweepNotifications(deps, MIDDAY);
    expect(getRow(handle.sqlite, id)!.status).toBe("queued");
    await sweepNotifications(deps, new Date(MIDDAY.getTime() + 3 * 60_000));
    await sweepNotifications(deps, new Date(MIDDAY.getTime() + 8 * 60_000));
    expect(counts.get(111)).toBe(3);
    expect(listDeliveryChildren(handle.sqlite, id)).toEqual([
      { chatId: 111, status: "failed", attempts: 3, lastError: "Telegram send failed: HTTP 403" },
    ]);
    expect(getRow(handle.sqlite, id)!.status).toBe("failed"); // never 'partial' from one chat
  });

  it("migration: a fresh DB creates notification_outbox_deliveries with the design's column set", () => {
    const cols = handle.sqlite
      .prepare(`PRAGMA table_info(notification_outbox_deliveries)`)
      .all() as { name: string }[];
    expect(cols.map((c) => c.name)).toEqual([
      "outbox_id",
      "chat_id",
      "status",
      "attempts",
      "last_error",
      "created_at",
      "updated_at",
    ]);
    // And a row with no children (a legacy pre-fix row) sends correctly on
    // its first post-fix attempt — covered by the first-attempt tests above.
    expect(
      handle.sqlite
        .prepare(`SELECT COUNT(*) AS c FROM notification_outbox_deliveries`)
        .get() as { c: number },
    ).toEqual({ c: 0 });
  });
});
