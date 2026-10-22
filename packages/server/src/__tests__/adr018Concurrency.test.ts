/**
 * ADR-018 criterion 13 — the concurrency harness AS DEFINED in the ADR:
 * two interleaved drain loops in ONE process on ONE SQLite handle, with
 * coordination barriers at the send await. A sequential simulation does
 * NOT satisfy the criterion, so each test below parks one channel's loop
 * at its send await (after it has claimed), runs the other channel's
 * loop to its claim attempt, and only then releases the parked send.
 *
 * Setup: cap = 1, one due row per channel, same space-local day. Exactly
 * one total send may happen, exactly one active non-exempt ledger claim
 * may exist afterwards, and the losing row must be DEFERRED (not dropped,
 * not sent).
 */
import { describe, it, expect } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { sweepNotifications, type BoundaryDeps } from "../agent/notify/boundary.js";
import { enqueue, getRow } from "../agent/notify/outbox.js";
import { enqueuePendingPush, sweepPendingPushes, getPushRow } from "../push/outbox.js";
import { countActiveClaims } from "../agent/notify/capClaims.js";
import { PushSubscriptionsRepo } from "../repositories/pushSubscriptions.repo.js";
import type { VapidConfig } from "../push/service.js";

const MIDDAY = new Date("2026-10-21T16:00:00Z"); // 12:00 EDT
const DAY = "2026-10-21";
const SPACE = "race-space";
const CAP_DEFERRED_TO = "2026-10-22T10:00:00.000Z"; // next day 06:00 EDT (digest)
const CONFIG: VapidConfig = { publicKey: "BTestPublicKey", privateKey: "test-private", subject: "mailto:test@example.com" };

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** One handle, cap=1, one due row per channel for the same space-day. */
function setup(): { handle: DbHandle; tgId: number; pushId: number } {
  const handle = createDb(":memory:");
  const s = handle.sqlite;
  s.prepare(
    `INSERT INTO space_meta (space_id, timezone, quiet_start, quiet_end, digest_time, daily_proactive_cap)
     VALUES (?, 'America/New_York', '21:00', '04:30', '06:00', 1)`
  ).run(SPACE);
  new PushSubscriptionsRepo(handle, SPACE).upsert({ endpoint: "https://push.example.com/race", p256dh: "pk", auth: "au" });

  const dueAt = new Date(MIDDAY.getTime() - 60_000).toISOString();
  const createdAt = new Date(MIDDAY.getTime() - 30 * 60_000).toISOString();
  const { id: tgId } = enqueue(s, {
    spaceId: SPACE,
    meta: { tool: "checkin", occurrenceId: "day:race-tg" },
    message: "telegram row",
    urgency: { isUrgent: false },
    deliverAfter: dueAt,
    queueReason: "test",
  });
  s.prepare(`UPDATE notification_outbox SET created_at = ? WHERE id = ?`).run(createdAt, tgId);

  const { id: pushId } = enqueuePendingPush(s, {
    spaceId: SPACE,
    meta: { tool: "checkin", occurrenceId: "day:race-push" },
    payload: { title: "t", body: "push row", url: "/" },
    isUrgent: false,
    deliverAfter: dueAt,
  });
  s.prepare(`UPDATE push_outbox SET created_at = ? WHERE id = ?`).run(createdAt, pushId);
  return { handle, tgId, pushId };
}

describe("ADR-018 criterion 13: interleaved Telegram + push drains on one handle", () => {
  it("Telegram parks at its send await → push claim is refused → exactly one send, loser deferred", async () => {
    const { handle, tgId, pushId } = setup();
    const tgParked = deferred();
    const tgGate = deferred();
    const tgSends: string[] = [];
    let tgParkedFlag = false;

    const deps: BoundaryDeps = {
      sqlite: handle.sqlite,
      handle,
      send: async (_spaceId: string, text: string) => {
        tgParkedFlag = true;
        tgParked.resolve();
        await tgGate.promise; // ← barrier: Telegram holds its claim, parked mid-send
        tgSends.push(text);
      },
      audit: () => {},
      workerId: "race-telegram",
    };

    // Start the Telegram drain WITHOUT awaiting it: it claims, then parks.
    const tgSweep = sweepNotifications(deps, MIDDAY);
    await Promise.race([tgParked.promise, sleep(3000)]);
    expect(tgParkedFlag).toBe(true); // Telegram is parked at the send await, claim held
    expect(countActiveClaims(handle.sqlite, SPACE, DAY)).toBe(1);

    // While Telegram is parked, run the push drain to its claim attempt.
    const pushCalls: string[] = [];
    const pushStats = await sweepPendingPushes(handle, {
      now: MIDDAY,
      config: CONFIG,
      sender: async (target: { endpoint: string }) => {
        pushCalls.push(target.endpoint);
      },
      workerId: "race-push",
    });
    expect(pushStats.sent).toBe(0);
    expect(pushStats.deferred).toBe(1);
    expect(pushCalls).toHaveLength(0); // push never reached its sender

    // Release Telegram; it completes the only send.
    tgGate.resolve();
    const tgStats = await tgSweep;
    expect(tgStats.sent).toBe(1);
    expect(tgSends).toHaveLength(1); // exactly ONE total send across both channels

    expect(countActiveClaims(handle.sqlite, SPACE, DAY)).toBe(1);
    const rows = handle.sqlite
      .prepare(`SELECT channel, state, cap_exempt FROM notification_cap_claims WHERE space_id = ?`)
      .all(SPACE) as { channel: string; state: string; cap_exempt: number }[];
    expect(rows).toEqual([{ channel: "telegram", state: "sent", cap_exempt: 0 }]);

    expect(getRow(handle.sqlite, tgId)!.status).toBe("sent");
    const loser = getPushRow(handle.sqlite, pushId)!;
    expect(loser.status).toBe("pending"); // deferred — not dropped, not sent
    expect(loser.deliverAfter).toBe(CAP_DEFERRED_TO);
    handle.sqlite.close();
  }, 15000);

  it("mirror order: push parks at its send await → Telegram claim is refused → exactly one send, loser deferred", async () => {
    const { handle, tgId, pushId } = setup();
    const pushParked = deferred();
    const pushGate = deferred();
    const pushSends: string[] = [];
    let pushParkedFlag = false;

    // Start the push drain WITHOUT awaiting it: it claims, then parks
    // inside the sender (the send await of sendPushToSpace).
    const pushSweep = sweepPendingPushes(handle, {
      now: MIDDAY,
      config: CONFIG,
      sender: async (target: { endpoint: string }) => {
        pushParkedFlag = true;
        pushParked.resolve();
        await pushGate.promise; // ← barrier: push holds its claim, parked mid-send
        pushSends.push(target.endpoint);
      },
      workerId: "race-push",
    });
    await Promise.race([pushParked.promise, sleep(3000)]);
    expect(pushParkedFlag).toBe(true);
    expect(countActiveClaims(handle.sqlite, SPACE, DAY)).toBe(1);

    // While push is parked, run the Telegram drain to its claim attempt.
    const tgCalls: string[] = [];
    const deps: BoundaryDeps = {
      sqlite: handle.sqlite,
      handle,
      send: async (_spaceId: string, text: string) => {
        tgCalls.push(text);
      },
      audit: () => {},
      workerId: "race-telegram",
    };
    const tgStats = await sweepNotifications(deps, MIDDAY);
    expect(tgStats.sent).toBe(0);
    expect(tgStats.queued).toBe(1);
    expect(tgCalls).toHaveLength(0); // Telegram never reached its sender

    // Release push; it completes the only send.
    pushGate.resolve();
    const pushStats = await pushSweep;
    expect(pushStats.sent).toBe(1);
    expect(pushSends).toHaveLength(1); // exactly ONE total send across both channels

    expect(countActiveClaims(handle.sqlite, SPACE, DAY)).toBe(1);
    const rows = handle.sqlite
      .prepare(`SELECT channel, state, cap_exempt FROM notification_cap_claims WHERE space_id = ?`)
      .all(SPACE) as { channel: string; state: string; cap_exempt: number }[];
    expect(rows).toEqual([{ channel: "push", state: "sent", cap_exempt: 0 }]);

    expect(getPushRow(handle.sqlite, pushId)!.status).toBe("sent");
    const loser = getRow(handle.sqlite, tgId)!;
    expect(loser.status).toBe("queued"); // deferred — not dropped, not sent
    expect(loser.deliverAfter).toBe(CAP_DEFERRED_TO);
    handle.sqlite.close();
  }, 15000);
});
