/**
 * Web push × Phase-2 notification policy (Immersion Round 3 follow-up,
 * owner decision 2026-10-21): push obeys the same quiet-hours + daily-cap
 * policy as Telegram. A policy-deferred push is stored in push_outbox and
 * delivered when the policy allows — deferred, never dropped — and the
 * whole path works with NO Telegram configuration (push-only brains).
 *
 * The web-push transport is mocked at the module level for the
 * reminder-integration test; the dispatch/sweep unit tests inject their
 * sender + VAPID config directly.
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";

const mockSendNotification = vi.fn(async (..._args: unknown[]) => ({}));
const mockSetVapidDetails = vi.fn((..._args: unknown[]) => {});
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: (...a: unknown[]) => mockSetVapidDetails(...a),
    sendNotification: (...a: unknown[]) => mockSendNotification(...a),
  },
}));

import { createDb, type DbHandle } from "../db/client.js";
import type { AppContext } from "../context.js";
import { PushSubscriptionsRepo } from "../repositories/pushSubscriptions.repo.js";
import { dispatchPush, sweepPendingPushes, getPushRow } from "../push/outbox.js";
import type { PushSender, VapidConfig } from "../push/service.js";
import { reminderTool } from "../agent/tools/reminder.js";
import type { ToolContext } from "../agent/tools/types.js";

const CONFIG: VapidConfig = { publicKey: "BTestPublicKey123", privateKey: "test-private-key", subject: "mailto:test@example.com" };
const SPACE = "push-policy-space";

// Deterministic instants (America/New_York is EDT, UTC-4, on these dates;
// default prefs: quiet 21:00-04:30, digest 06:00, cap 5 unless overridden).
const QUIET_NOW = new Date("2026-10-21T06:00:00Z"); // 02:00 NY — inside quiet hours
const AFTER_QUIET = new Date("2026-10-21T09:00:00Z"); // 05:00 NY — quiet over
const MIDDAY = new Date("2026-10-21T16:00:00Z"); // 12:00 NY
const NEXT_MORNING = new Date("2026-10-22T11:00:00Z"); // 07:00 NY next day

function setPrefs(handle: DbHandle, spaceId: string, cap: number) {
  handle.sqlite
    .prepare(
      `INSERT INTO space_meta (space_id, timezone, quiet_start, quiet_end, digest_time, daily_proactive_cap)
       VALUES (?, 'America/New_York', '21:00', '04:30', '06:00', ?)`
    )
    .run(spaceId, cap);
}

function addSub(handle: DbHandle, spaceId: string) {
  new PushSubscriptionsRepo(handle, spaceId).upsert({ endpoint: "https://push.example.com/dev1", p256dh: "pk", auth: "au" });
}

function pendingRows(handle: DbHandle): { id: number; status: string; deliver_after: string; attempts: number }[] {
  return handle.sqlite.prepare(`SELECT id, status, deliver_after, attempts FROM push_outbox ORDER BY id`).all() as {
    id: number;
    status: string;
    deliver_after: string;
    attempts: number;
  }[];
}

function outboxCount(handle: DbHandle): number {
  const r = handle.sqlite.prepare(`SELECT COUNT(*) AS n FROM push_outbox`).get() as { n: number };
  return r.n;
}

const payload = { title: "⏰ Soumaya reminder", body: "⏰ Reminder: \"Call the dentist\"", url: "/" };
const metaFor = (nodeId: number, remindAt: Date) => ({
  tool: "fire_reminder",
  nodeId,
  remindAt: remindAt.toISOString(),
});

// ---------------------------------------------------------------------------
// Schema / migration
// ---------------------------------------------------------------------------

describe("push_outbox schema", () => {
  let handle: DbHandle;
  beforeEach(() => {
    handle = createDb(":memory:");
  });
  afterEach(() => handle.sqlite.close());

  it("fresh bootstrap creates the table with the expected columns", () => {
    const cols = handle.sqlite.prepare(`PRAGMA table_info(push_outbox)`).all() as { name: string }[];
    expect(cols.map((c) => c.name)).toEqual([
      "id",
      "push_key",
      "space_id",
      "tool",
      "occurrence_id",
      "title",
      "body",
      "url",
      "status",
      "is_urgent",
      "attempts",
      "last_error",
      "deliver_after",
      "cap_day",
      "send_started_at",
      "claimed_by",
      "claimed_at",
      "created_at",
      "updated_at",
      // ADR-018 A2b: remind_at + bill_due_at are migrateSchema-only
      // PRAGMA-guarded ALTERs (never in BOOTSTRAP_SQL), so on a fresh
      // volume they land after the bootstrap columns, in ALTER order.
      "remind_at",
      "bill_due_at",
    ]);
  });

  it("migrateSchema adds the table to a pre-existing volume that lacks it", () => {
    const dir = mkdtempSync(join(tmpdir(), "brain-push-outbox-mig-"));
    const path = join(dir, "old.db");
    const old = new BetterSqlite3(path);
    old.exec(`
      CREATE TABLE nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL, type TEXT NOT NULL, content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    old.close();
    let migrated: DbHandle | undefined;
    try {
      expect(() => {
        migrated = createDb(path);
      }).not.toThrow();
      const t = migrated!.sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='push_outbox'`).get();
      expect(t).toBeDefined();
    } finally {
      migrated?.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Dispatch + sweep under the policy (injected sender; no Telegram anywhere —
// this is the push-only-brain path: nothing in it references a token)
// ---------------------------------------------------------------------------

describe("dispatchPush + sweepPendingPushes", () => {
  let handle: DbHandle;
  let sender: Mock<PushSender>;
  beforeEach(() => {
    handle = createDb(":memory:");
    setPrefs(handle, SPACE, 5);
    addSub(handle, SPACE);
    sender = vi.fn<PushSender>(async () => {});
  });
  afterEach(() => handle.sqlite.close());

  it("quiet hours: deferred (not dropped), delivered exactly once after the window", async () => {
    const res = await dispatchPush(handle, SPACE, payload, metaFor(101, new Date(QUIET_NOW.getTime() - 2 * 3600_000)), {
      now: QUIET_NOW,
      config: CONFIG,
      sender,
    });
    expect(res).toMatchObject({ skipped: false, sent: 0, deferred: true });
    expect(sender).not.toHaveBeenCalled();
    const rows = pendingRows(handle);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.deliver_after).toBe("2026-10-21T08:30:00.000Z"); // 04:30 NY, quiet end

    // Still inside the window and not yet due: the sweep leaves it alone.
    const early = await sweepPendingPushes(handle, { now: new Date("2026-10-21T07:00:00Z"), config: CONFIG, sender });
    expect(early.sent).toBe(0);
    expect(sender).not.toHaveBeenCalled();

    // After the window: delivered.
    const sweep = await sweepPendingPushes(handle, { now: AFTER_QUIET, config: CONFIG, sender });
    expect(sweep.sent).toBe(1);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(getPushRow(handle.sqlite, rows[0]!.id)?.status).toBe("sent");

    // Exactly once: further sweeps never re-send a delivered push.
    const again = await sweepPendingPushes(handle, { now: new Date(AFTER_QUIET.getTime() + 3600_000), config: CONFIG, sender });
    expect(again.sent).toBe(0);
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it("daily cap: the second push of the day is deferred to the next day, then delivered exactly once", async () => {
    setPrefs(handle, "cap-space", 1);
    addSub(handle, "cap-space");
    const remindAt = new Date(MIDDAY.getTime() - 2 * 3600_000);

    const a = await dispatchPush(handle, "cap-space", payload, metaFor(201, remindAt), { now: MIDDAY, config: CONFIG, sender });
    expect(a.sent).toBe(1);
    expect(sender).toHaveBeenCalledTimes(1);

    const b = await dispatchPush(handle, "cap-space", payload, metaFor(202, remindAt), { now: MIDDAY, config: CONFIG, sender });
    expect(b).toMatchObject({ sent: 0, deferred: true });
    expect(sender).toHaveBeenCalledTimes(1); // cap held — no second send
    const rows = pendingRows(handle).filter((r) => r.status === "pending");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deliver_after).toBe("2026-10-22T10:00:00.000Z"); // next day 06:00 NY (digest time)

    // Same-day sweep: deliver_after is tomorrow — nothing moves.
    const sameDay = await sweepPendingPushes(handle, { now: new Date(MIDDAY.getTime() + 3600_000), config: CONFIG, sender });
    expect(sameDay.sent).toBe(0);
    expect(sender).toHaveBeenCalledTimes(1);

    // Next morning: the deferred push delivers, exactly once.
    const next = await sweepPendingPushes(handle, { now: NEXT_MORNING, config: CONFIG, sender });
    expect(next.sent).toBe(1);
    expect(sender).toHaveBeenCalledTimes(2);
    const again = await sweepPendingPushes(handle, { now: new Date(NEXT_MORNING.getTime() + 3600_000), config: CONFIG, sender });
    expect(again.sent).toBe(0);
    expect(sender).toHaveBeenCalledTimes(2);
  });

  it("unconfigured VAPID: dispatch stores nothing and sends nothing; the sweep is a no-op", async () => {
    const res = await dispatchPush(handle, SPACE, payload, metaFor(301, new Date(MIDDAY.getTime() - 2 * 3600_000)), {
      now: MIDDAY,
      config: null,
      sender,
    });
    expect(res.skipped).toBe(true);
    expect(sender).not.toHaveBeenCalled();
    expect(outboxCount(handle)).toBe(0); // zero storage

    // Even with a row somehow pending, an unconfigured sweep touches nothing.
    const ok = await dispatchPush(handle, SPACE, payload, metaFor(302, new Date(QUIET_NOW.getTime() - 2 * 3600_000)), {
      now: QUIET_NOW,
      config: CONFIG,
      sender,
    });
    expect(ok.deferred).toBe(true);
    const sweep = await sweepPendingPushes(handle, { now: AFTER_QUIET, config: null, sender });
    expect(sweep).toEqual({ sent: 0, deferred: 0, dropped: 0, ambiguous: 0 });
    expect(sender).not.toHaveBeenCalled();
    expect(pendingRows(handle)[0]!.status).toBe("pending");
  });

  it("duplicate dispatch of the same occurrence dedups — one row, one send", async () => {
    const meta = metaFor(401, new Date(MIDDAY.getTime() - 2 * 3600_000));
    const first = await dispatchPush(handle, SPACE, payload, meta, { now: MIDDAY, config: CONFIG, sender });
    expect(first.sent).toBe(1);
    const second = await dispatchPush(handle, SPACE, payload, meta, { now: MIDDAY, config: CONFIG, sender });
    expect(second.deduped).toBe(true);
    expect(second.sent).toBe(0);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(outboxCount(handle)).toBe(1);
  });

  it("a fresh reminder is urgent under the shared policy and sends immediately, even in quiet hours", async () => {
    const res = await dispatchPush(handle, SPACE, payload, metaFor(501, new Date(QUIET_NOW.getTime() - 5 * 60_000)), {
      now: QUIET_NOW,
      config: CONFIG,
      sender,
    });
    expect(res.sent).toBe(1);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(outboxCount(handle)).toBe(1);
    expect(pendingRows(handle)[0]!.status).toBe("sent");
  });

  it("a failed send is re-queued with backoff (cap slot released) and delivered by a later sweep", async () => {
    let fail = true;
    const flaky = vi.fn<PushSender>(async () => {
      if (fail) throw new Error("network down");
    });
    const meta = metaFor(601, new Date(MIDDAY.getTime() - 2 * 3600_000));
    const res = await dispatchPush(handle, SPACE, payload, meta, { now: MIDDAY, config: CONFIG, sender: flaky });
    expect(res).toMatchObject({ sent: 0, deferred: true });
    const row = pendingRows(handle)[0]!;
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.deliver_after).toBe(new Date(MIDDAY.getTime() + 2 * 60_000).toISOString()); // 2^1 min backoff

    fail = false;
    const tooEarly = await sweepPendingPushes(handle, { now: new Date(MIDDAY.getTime() + 60_000), config: CONFIG, sender: flaky });
    expect(tooEarly.sent).toBe(0);
    const swept = await sweepPendingPushes(handle, { now: new Date(MIDDAY.getTime() + 3 * 60_000), config: CONFIG, sender: flaky });
    expect(swept.sent).toBe(1);
    expect(flaky).toHaveBeenCalledTimes(2);
    expect(getPushRow(handle.sqlite, row.id)?.status).toBe("sent");
  });

  it("no subscriptions: dispatch is a no-op and stores nothing", async () => {
    const res = await dispatchPush(handle, "no-sub-space", payload, metaFor(701, new Date(MIDDAY.getTime() - 2 * 3600_000)), {
      now: MIDDAY,
      config: CONFIG,
      sender,
    });
    expect(res.skipped).toBe(true);
    expect(sender).not.toHaveBeenCalled();
    expect(outboxCount(handle)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Reminder firing path (integration — web-push mocked, default prefs are
// quiet 21:00-04:30 NY, so a 02:00 NY firing must defer, then deliver)
// ---------------------------------------------------------------------------

describe("reminder firing defers push under the policy", () => {
  const RSPACE = "push-policy-reminder-space";
  let handle: DbHandle;

  beforeEach(() => {
    handle = createDb(":memory:");
    mockSendNotification.mockClear();
    mockSetVapidDetails.mockClear();
    process.env.VAPID_PUBLIC_KEY = CONFIG.publicKey;
    process.env.VAPID_PRIVATE_KEY = CONFIG.privateKey;
    process.env.VAPID_SUBJECT = CONFIG.subject;
  });
  afterEach(() => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
    handle.sqlite.close();
  });

  function toolCtx(now: number): ToolContext {
    return {
      ctx: { handle } as unknown as AppContext,
      spaceId: RSPACE,
      now,
      notify: async () => {},
    };
  }

  it("a reminder firing in quiet hours sends no push now; the sweep delivers it after the window", async () => {
    new PushSubscriptionsRepo(handle, RSPACE).upsert({ endpoint: "https://push.example.com/quiet", p256dh: "pk", auth: "au" });
    const remindAt = new Date(QUIET_NOW.getTime() - 2 * 3600_000); // 2h old — NOT urgent
    const info = handle.sqlite
      .prepare(`INSERT INTO nodes (space_id, label, type, content, remind_at) VALUES (?, 'Call the dentist', 'event', 'ctx', ?)`)
      .run(RSPACE, remindAt.toISOString());
    const nodeId = Number(info.lastInsertRowid);

    const res = await reminderTool.run(toolCtx(QUIET_NOW.getTime()), { nodeId });
    expect(res.ok).toBe(true);
    expect(mockSendNotification).not.toHaveBeenCalled(); // quiet hours held the push back
    const rows = pendingRows(handle);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("pending");

    const sweep = await sweepPendingPushes(handle, { now: AFTER_QUIET });
    expect(sweep.sent).toBe(1);
    expect(mockSendNotification).toHaveBeenCalledTimes(1);
  });
});
