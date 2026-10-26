/**
 * Batch C (H-3 / H-4) regression tests — notification honesty.
 *
 * H-3 (REG-192): sweep stats must distinguish sent / retried / failed on
 * both channels. The old Telegram sweep counted every non-ambiguous outcome
 * as `sent`; the old push sweep counted a terminal failure as `deferred`.
 * These tests FAIL on the pre-fix tree (stats.sent inflates / the `failed`
 * bucket does not exist) and PASS after.
 *
 * H-4 (REG-193): an on-demand command reply whose send throws once must
 * still be delivered (bounded retry), and a /log whose confirmation send
 * fails must still save the memory exactly once.
 *
 * Run: npx vitest run packages/server/src/__tests__/batchCNotifyHonesty.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import {
  handleTelegramUpdate,
  sendTelegramReplyWithRetry,
  type TelegramUpdate,
} from "../telegram/bot.js";
import { AmbiguousSendError } from "../agent/notify/sendErrors.js";
import {
  enqueue,
  getRow,
  MAX_ATTEMPTS,
} from "../agent/notify/outbox.js";
import {
  createPolicyNotify,
  sweepNotifications,
  type BoundaryDeps,
} from "../agent/notify/boundary.js";
import { PushSubscriptionsRepo } from "../repositories/pushSubscriptions.repo.js";
import {
  dispatchPush,
  sweepPendingPushes,
  getPushRow,
} from "../push/outbox.js";
import type { PushSender, VapidConfig } from "../push/service.js";

// ---------------------------------------------------------------------------
// Item 2 — Telegram sweep stats (H-3)
// ---------------------------------------------------------------------------

describe("H-3 telegram sweep stats distinguish sent / retried / failed", () => {
  let handle: DbHandle;
  let sqlite: any;

  function makeDeps(shouldFail: boolean): BoundaryDeps {
    return {
      sqlite,
      handle,
      send: async () => {
        if (shouldFail) throw new Error("telegram down");
        // H-2: the send reports per-chat outcomes; this double stands in
        // for a one-chat space that accepted.
        return { attempted: [{ chatId: 1, outcome: "sent" as const }] };
      },
      audit: () => {},
      workerId: "batch-c-test",
    };
  }

  beforeEach(() => {
    handle = createDb(":memory:");
    sqlite = handle.sqlite;
  });
  afterEach(() => handle.sqlite.close());

  it("a failing send is counted retried (not sent), then failed at MAX_ATTEMPTS", async () => {
    const deps = makeDeps(true);
    const { id } = enqueue(sqlite, {
      spaceId: "s1",
      meta: { tool: "checkin", occurrenceId: "h3-retry" },
      message: "morning checkin",
      urgency: { isUrgent: false },
      deliverAfter: "2026-10-20T09:00:00.000Z",
      queueReason: "test",
    });
    // Sweep 1 at 05:00 NY (not quiet): attempt 1 < 3 → re-queued, backoff +2m.
    const t0 = new Date("2026-10-20T09:00:00.000Z");
    const s1 = await sweepNotifications(deps, t0);
    expect(s1).toEqual({ sent: 0, queued: 0, ambiguous: 0, retried: 1, failed: 0, dropped: 0 });
    expect(getRow(sqlite, id)!.status).toBe("queued");

    // Sweep 2 after the +2m backoff: attempt 2 < 3 → re-queued, backoff +4m.
    const s2 = await sweepNotifications(deps, new Date(t0.getTime() + 3 * 60_000));
    expect(s2).toEqual({ sent: 0, queued: 0, ambiguous: 0, retried: 1, failed: 0, dropped: 0 });
    expect(getRow(sqlite, id)!.status).toBe("queued");

    // Sweep 3 after the +4m backoff: attempt 3 = MAX_ATTEMPTS → terminal.
    const s3 = await sweepNotifications(deps, new Date(t0.getTime() + 8 * 60_000));
    expect(s3).toEqual({ sent: 0, queued: 0, ambiguous: 0, retried: 0, failed: 1, dropped: 0 });
    expect(getRow(sqlite, id)!.status).toBe("failed");
    expect(MAX_ATTEMPTS).toBe(3);
  });

  it("a successful send still counts exactly one sent and nothing else", async () => {
    const deps = makeDeps(false);
    const { id } = enqueue(sqlite, {
      spaceId: "s1",
      meta: { tool: "checkin", occurrenceId: "h3-sent" },
      message: "morning checkin",
      urgency: { isUrgent: false },
      deliverAfter: "2026-10-20T09:00:00.000Z",
      queueReason: "test",
    });
    const stats = await sweepNotifications(deps, new Date("2026-10-20T09:00:00.000Z"));
    expect(stats).toEqual({ sent: 1, queued: 0, ambiguous: 0, retried: 0, failed: 0, dropped: 0 });
    expect(getRow(sqlite, id)!.status).toBe("sent");
  });

  it("a dropped row counts as dropped, not sent", async () => {
    const deps = makeDeps(false);
    // D-1: a legacy fire_reminder with no persisted due time is dropped.
    const { id } = enqueue(sqlite, {
      spaceId: "s1",
      meta: { tool: "fire_reminder", occurrenceId: "h3-drop" },
      message: "unverifiable reminder",
      urgency: { isUrgent: false },
      deliverAfter: "2026-10-20T09:00:00.000Z",
      queueReason: "test",
    });
    const stats = await sweepNotifications(deps, new Date("2026-10-20T09:00:00.000Z"));
    expect(stats).toEqual({ sent: 0, queued: 0, ambiguous: 0, retried: 0, failed: 0, dropped: 1 });
    expect(getRow(sqlite, id)!.status).toBe("dropped");
  });

  it("createPolicyNotify is exported and still builds (smoke: no shape change to callers)", () => {
    expect(typeof createPolicyNotify).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Item 2 — Push sweep stats (H-3, push half)
// ---------------------------------------------------------------------------

describe("H-3 push sweep stats: terminal failure is failed, not deferred", () => {
  const CONFIG: VapidConfig = {
    publicKey: "BTestPublicKey123",
    privateKey: "test-private-key",
    subject: "mailto:test@example.com",
  };
  const SPACE = "batch-c-push-space";
  const MIDDAY = new Date("2026-10-21T16:00:00Z"); // 12:00 NY
  const payload = { title: "⏰ Soumaya reminder", body: "⏰ Reminder: test", url: "/" };
  const metaFor = (nodeId: number, remindAt: Date) => ({
    tool: "fire_reminder",
    nodeId,
    remindAt: remindAt.toISOString(),
  });

  let handle: DbHandle;
  beforeEach(() => {
    handle = createDb(":memory:");
    handle.sqlite
      .prepare(
        `INSERT INTO space_meta (space_id, timezone, quiet_start, quiet_end, digest_time, daily_proactive_cap)
         VALUES (?, 'America/New_York', '21:00', '04:30', '06:00', ?)`,
      )
      .run(SPACE, 5);
    new PushSubscriptionsRepo(handle, SPACE).upsert({
      endpoint: "https://push.example.com/dev1",
      p256dh: "pk",
      auth: "au",
    });
  });
  afterEach(() => handle.sqlite.close());

  it("a terminally failed push is counted failed (not deferred), after retries count deferred", async () => {
    const failing = vi.fn<PushSender>(async () => {
      throw new Error("push endpoint down");
    });
    const meta = metaFor(901, new Date(MIDDAY.getTime() - 2 * 3600_000));
    const res = await dispatchPush(handle, SPACE, payload, meta, { now: MIDDAY, config: CONFIG, sender: failing });
    // Immediate dispatch: attempt 1 < 3, re-queued with backoff — deferred is honest here.
    expect(res).toMatchObject({ sent: 0, deferred: true });
    const rowId = handle.sqlite.prepare(`SELECT id FROM push_outbox`).get() as { id: number };
    expect(getPushRow(handle.sqlite, rowId.id)?.status).toBe("pending");

    // Sweep 1 after the +2m backoff: attempt 2 < 3 → still retryable → deferred.
    const s1 = await sweepPendingPushes(handle, { now: new Date(MIDDAY.getTime() + 3 * 60_000), config: CONFIG, sender: failing });
    expect(s1).toEqual({ sent: 0, deferred: 1, dropped: 0, ambiguous: 0, failed: 0 });
    expect(getPushRow(handle.sqlite, rowId.id)?.status).toBe("pending");

    // Sweep 2 after the +4m backoff: attempt 3 = MAX_ATTEMPTS → terminal failed.
    const s2 = await sweepPendingPushes(handle, { now: new Date(MIDDAY.getTime() + 8 * 60_000), config: CONFIG, sender: failing });
    expect(s2).toEqual({ sent: 0, deferred: 0, dropped: 0, ambiguous: 0, failed: 1 });
    expect(getPushRow(handle.sqlite, rowId.id)?.status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// Item 3 — On-demand reply retry (H-4)
// ---------------------------------------------------------------------------

describe("H-4 on-demand command replies retry a failed send", () => {
  let handle: DbHandle;
  let ctx: AppContext;
  let delivered: { chatId: number; text: string }[];
  let calls: number;

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
    delivered = [];
    calls = 0;
  });
  afterEach(() => handle.sqlite.close());

  /** Link the chat with a working sender, then log one memory so the digest has content. */
  async function linkAndSeed() {
    const good = async (chatId: number, text: string) => {
      delivered.push({ chatId, text });
    };
    await handleTelegramUpdate(ctx, update(1, "/link alice alicepass"), good);
    await handleTelegramUpdate(ctx, update(1, "/log alice went for a long run today"), good);
    delivered = [];
  }

  function countMemories(text: string): number {
    const links = handle.sqlite.prepare(`SELECT space_id FROM telegram_links WHERE chat_id = 1`).get() as { space_id: string };
    const r = handle.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM nodes WHERE space_id = ? AND content LIKE ?`)
      .get(links.space_id, `%${text}%`) as { c: number };
    return r.c;
  }

  it("/digest: sender throws AmbiguousSendError once → reply still delivered", async () => {
    await linkAndSeed();
    const flaky = async (chatId: number, text: string) => {
      calls++;
      if (calls === 1) throw new AmbiguousSendError("transient blip: no response received");
      delivered.push({ chatId, text });
    };
    await handleTelegramUpdate(ctx, update(1, "/digest"), flaky);
    expect(calls).toBe(2);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.text).toMatch(/alice/);
  });

  it("/log: sender throws once → confirmation delivered and memory saved exactly once", async () => {
    await linkAndSeed();
    const flaky = async (chatId: number, text: string) => {
      calls++;
      if (calls === 1) throw new Error("telegram down");
      delivered.push({ chatId, text });
    };
    await handleTelegramUpdate(ctx, update(1, "/log batch c retry probe memory"), flaky);
    expect(calls).toBe(2);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.text).toMatch(/Logged/);
    expect(countMemories("batch c retry probe memory")).toBe(1);
  });

  it("retry is bounded: an always-failing sender is tried exactly 3 times, then the handler rejects", async () => {
    await linkAndSeed();
    const failing = async (_chatId: number, _text: string) => {
      calls++;
      throw new Error("telegram down");
    };
    await expect(handleTelegramUpdate(ctx, update(1, "/digest"), failing)).rejects.toThrow("telegram down");
    expect(calls).toBe(3);
  });

  it("/log with an always-failing sender still saves the memory exactly once", async () => {
    await linkAndSeed();
    const failing = async (_chatId: number, _text: string) => {
      calls++;
      throw new Error("telegram down");
    };
    await expect(
      handleTelegramUpdate(ctx, update(1, "/log batch c bounded probe memory"), failing),
    ).rejects.toThrow("telegram down");
    expect(calls).toBe(3);
    expect(delivered).toHaveLength(0);
    expect(countMemories("batch c bounded probe memory")).toBe(1);
  });

  it("per-chunk retry: a failure on chunk 2 does not re-send chunk 1", async () => {
    const seen: string[] = [];
    let n = 0;
    const sender = async (_chatId: number, text: string) => {
      n++;
      if (n === 2) throw new Error("chunk 2 blip");
      seen.push(text);
    };
    // Two chunks: first call delivers chunk 1, second call (chunk 2) throws,
    // third call retries chunk 2 only. (4000 a's + blank line + 4000 b's
    // splits exactly at the blank line into [a…\n\n, b…].)
    const long = `${"a".repeat(4000)}\n\n${"b".repeat(4000)}`;
    await sendTelegramReplyWithRetry(sender, 1, long, { backoffMs: [0, 0] });
    expect(n).toBe(3);
    expect(seen).toHaveLength(2);
    expect(seen[0]!.startsWith("a")).toBe(true);
    expect(seen[1]!.startsWith("b")).toBe(true);
  });
});
