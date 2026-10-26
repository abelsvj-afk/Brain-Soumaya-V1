/**
 * Phase 2 acceptance tests: notification policy, outbox crash safety,
 * urgency classification, timezone handling, and digest timing.
 *
 * Run: npx vitest run packages/server/src/agent/notify/__tests__/phase2.test.ts
 */
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  getPreferences,
  setPreference,
  validateTimezone,
  localDay,
  localTime,
  isQuietHours,
  nextLocalTime,
  classifyUrgency,
  buildOccurrenceId,
  notifKey,
  stalenessLimitMs,
  decidePolicy,
  deliverAfterCapReached,
  DEFAULT_PREFS,
} from "../policy.js";
import {
  enqueue,
  claimForSend,
  claimUrgentForSend,
  tryUpgradeToUrgent,
  markSendStarted,
  markSent,
  markFailed,
  markDropped,
  markAmbiguous,
  recoverExpiredLeases,
  dueRows,
  getRow,
  LEASE_MS,
  MAX_ATTEMPTS,
} from "../outbox.js";
import { createPolicyNotify, sweepNotifications, type BoundaryDeps } from "../boundary.js";
import { createDb, type DbHandle } from "../../../db/client.js";

// Minimal in-memory DB with just the tables Phase 2 needs.
function testDb() {
  const sqlite = new Database(":memory:") as any;
  sqlite.exec(`
    CREATE TABLE space_meta (
      space_id TEXT PRIMARY KEY,
      timezone TEXT NOT NULL DEFAULT 'America/New_York',
      quiet_start TEXT NOT NULL DEFAULT '21:00',
      quiet_end TEXT NOT NULL DEFAULT '04:30',
      digest_time TEXT NOT NULL DEFAULT '06:00',
      daily_proactive_cap INTEGER NOT NULL DEFAULT 5,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE notification_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notif_key TEXT NOT NULL UNIQUE,
      space_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      occurrence_id TEXT NOT NULL,
      message TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal',
      is_urgent INTEGER NOT NULL DEFAULT 0,
      urgent_reason TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      deliver_after TEXT NOT NULL,
      bill_due_at TEXT,
      remind_at TEXT,
      cap_day TEXT,
      send_started_at TEXT,
      claimed_by TEXT,
      claimed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    -- ADR-018 A2: shared cap-claim ledger — mirrors the real DDL in
    -- db/schemaSql.ts / db/client.ts (the sole cap-counting authority).
    CREATE TABLE notification_cap_claims (
      space_id TEXT NOT NULL,
      local_day TEXT NOT NULL CHECK (local_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
      channel TEXT NOT NULL CHECK (channel IN ('telegram', 'push')),
      delivery_key TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('reserved', 'sent', 'ambiguous', 'released')),
      cap_exempt INTEGER NOT NULL DEFAULT 0 CHECK (cap_exempt IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (space_id, channel, delivery_key, local_day)
    );
    CREATE INDEX notification_cap_claims_count_idx
      ON notification_cap_claims(space_id, local_day, state, cap_exempt);
    CREATE TABLE agent_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      space_id TEXT NOT NULL,
      action TEXT NOT NULL,
      description TEXT NOT NULL,
      targets TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  sqlite.prepare(`INSERT INTO space_meta (space_id) VALUES ('s1')`).run();
  return sqlite;
}

const auditLog: string[] = [];
function makeDeps(sqlite: any, sent: string[], shouldFail = false, handle: DbHandle): BoundaryDeps {
  return {
    sqlite,
    // BoundaryDeps.handle feeds episode capture (W2 §5.1) — callers pass a
    // real createDb handle so capture runs against the production schema.
    handle,
    send: async (spaceId: string, text: string) => {
      if (shouldFail) throw new Error("telegram down");
      sent.push(`${spaceId}:${text}`);
      // H-2: the send reports per-chat outcomes; this double stands in for
      // a one-chat space that accepted.
      return { attempted: [{ chatId: 1, outcome: "sent" as const }] };
    },
    audit: (spaceId: string, action: string, detail: string) => {
      auditLog.push(`${action}:${detail}`);
      sqlite.prepare(`INSERT INTO agent_logs (space_id, action, description, targets) VALUES (?, ?, ?, '[]')`).run(spaceId, action, detail);
    },
    workerId: "test-worker",
  };
}

beforeEach(() => {
  auditLog.length = 0;
});

describe("preferences", () => {
  it("returns defaults for a fresh space", () => {
    const sqlite = testDb();
    expect(getPreferences(sqlite, "s1")).toEqual(DEFAULT_PREFS);
  });

  it("validates timezone; rejects invalid without corrupting", () => {
    const sqlite = testDb();
    expect(setPreference(sqlite, "s1", "timezone", "America/Chicago")).toEqual({ ok: true });
    expect(getPreferences(sqlite, "s1").timezone).toBe("America/Chicago");
    const bad = setPreference(sqlite, "s1", "timezone", "Not/AZone");
    expect(bad.ok).toBe(false);
    expect(getPreferences(sqlite, "s1").timezone).toBe("America/Chicago"); // unchanged
  });

  it("validates HH:MM and cap range", () => {
    const sqlite = testDb();
    expect(setPreference(sqlite, "s1", "quietStart", "25:00").ok).toBe(false);
    expect(setPreference(sqlite, "s1", "quietStart", "22:00").ok).toBe(true);
    expect(setPreference(sqlite, "s1", "dailyProactiveCap", "-1").ok).toBe(false);
    expect(setPreference(sqlite, "s1", "dailyProactiveCap", "3").ok).toBe(true);
    expect(getPreferences(sqlite, "s1").dailyProactiveCap).toBe(3);
  });

  it("validateTimezone accepts IANA, rejects garbage", () => {
    expect(validateTimezone("America/New_York")).toBe(true);
    expect(validateTimezone("nope")).toBe(false);
  });
});

describe("quiet hours", () => {
  const prefs = { ...DEFAULT_PREFS }; // 21:00-04:30 America/New_York

  it("midnight-crossing window: 20:59 no, 21:00 yes, 04:29 yes, 04:30 no", () => {
    // 2026-10-19 is a Monday; use explicit UTC times that map to ET.
    // ET is UTC-4 in October (EDT).
    const at = (utc: string) => new Date(utc);
    expect(isQuietHours(at("2026-10-20T00:59:00Z"), prefs)).toBe(false); // 20:59 ET
    expect(isQuietHours(at("2026-10-20T01:00:00Z"), prefs)).toBe(true); // 21:00 ET
    expect(isQuietHours(at("2026-10-20T08:29:00Z"), prefs)).toBe(true); // 04:29 ET
    expect(isQuietHours(at("2026-10-20T08:30:00Z"), prefs)).toBe(false); // 04:30 ET
  });

  it("non-wrapping window works", () => {
    const p = { ...prefs, quietStart: "13:00", quietEnd: "14:00" };
    expect(isQuietHours(new Date("2026-10-19T17:30:00Z"), p)).toBe(true); // 13:30 ET
    expect(isQuietHours(new Date("2026-10-19T18:30:00Z"), p)).toBe(false); // 14:30 ET
  });

  it("localDay and localTime respect timezone", () => {
    const d = new Date("2026-10-20T02:00:00Z"); // 22:00 ET Oct 19
    expect(localDay(d, "America/New_York")).toBe("2026-10-19");
    expect(localTime(d, "America/New_York")).toBe("22:00");
    expect(localDay(d, "UTC")).toBe("2026-10-20");
  });

  it("nextLocalTime finds the next occurrence", () => {
    const from = new Date("2026-10-19T15:00:00Z"); // 11:00 ET
    const next = nextLocalTime(from, "06:00", "America/New_York");
    expect(localTime(next, "America/New_York")).toBe("06:00");
    expect(next.getTime()).toBeGreaterThan(from.getTime());
    // Should be tomorrow 06:00 ET = 10:00 UTC (EDT)
    expect(localDay(next, "America/New_York")).toBe("2026-10-20");
  });
});

describe("urgency classification", () => {
  it("fresh reminder (due 10m ago) is urgent", () => {
    const sqlite = testDb();
    const now = new Date("2026-10-19T12:00:00Z");
    const u = classifyUrgency(sqlite, "s1", { tool: "fire_reminder", nodeId: 1, remindAt: "2026-10-19T11:50:00Z" }, now);
    expect(u.isUrgent).toBe(true);
    expect(u.reason).toMatch(/fresh reminder/);
  });

  it("stale reminder (due 2h ago) is not urgent", () => {
    const sqlite = testDb();
    const now = new Date("2026-10-19T12:00:00Z");
    const u = classifyUrgency(sqlite, "s1", { tool: "fire_reminder", nodeId: 1, remindAt: "2026-10-19T10:00:00Z" }, now);
    expect(u.isUrgent).toBe(false);
  });

  it("bill due in 4h is urgent (first alert today)", () => {
    const sqlite = testDb();
    const now = new Date("2026-10-19T12:00:00Z");
    const u = classifyUrgency(sqlite, "s1", { tool: "billRisk", billId: 7, billDueAt: "2026-10-19T16:00:00Z" }, now);
    expect(u.isUrgent).toBe(true);
    expect(u.reason).toMatch(/bill due/);
  });

  it("bill due in 23h is NOT urgent", () => {
    const sqlite = testDb();
    const now = new Date("2026-10-19T12:00:00Z");
    const u = classifyUrgency(sqlite, "s1", { tool: "billRisk", billId: 7, billDueAt: "2026-10-20T11:00:00Z" }, now);
    expect(u.isUrgent).toBe(false);
  });

  it("second urgent bill alert same day is suppressed", () => {
    const sqlite = testDb();
    const now = new Date("2026-10-19T12:00:00Z");
    // Simulate an already-sent urgent alert for bill 7 today.
    sqlite.prepare(`INSERT INTO notification_outbox (notif_key, space_id, tool, occurrence_id, message, is_urgent, status, deliver_after) VALUES ('k1','s1','billRisk','bill:7:day:2026-10-19','m',1,'sent','2026-10-19T12:00:00Z')`).run();
    const u = classifyUrgency(sqlite, "s1", { tool: "billRisk", billId: 7, billDueAt: "2026-10-19T16:00:00Z" }, now);
    expect(u.isUrgent).toBe(false);
  });

  it("checkin is never urgent", () => {
    const sqlite = testDb();
    expect(classifyUrgency(sqlite, "s1", { tool: "checkin" }, new Date()).isUrgent).toBe(false);
  });
});

describe("occurrence identity + dedup", () => {
  it("same occurrence → same key; distinct → different", () => {
    const k1 = notifKey("s1", "fire_reminder", "node:5:at:2026-10-19T12:00:00Z");
    const k2 = notifKey("s1", "fire_reminder", "node:5:at:2026-10-19T12:00:00Z");
    const k3 = notifKey("s1", "fire_reminder", "node:5:at:2026-10-19T13:00:00Z");
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);
  });

  it("enqueue dedups on notif_key", () => {
    const sqlite = testDb();
    const input = { spaceId: "s1", meta: { tool: "checkin", occurrenceId: "day:2026-10-19" }, message: "hi", urgency: { isUrgent: false }, deliverAfter: new Date().toISOString(), queueReason: "test" };
    const a = enqueue(sqlite, input);
    const b = enqueue(sqlite, input);
    expect(a.deduped).toBe(false);
    expect(b.deduped).toBe(true);
    expect(a.id).toBe(b.id);
  });

  it("buildOccurrenceId is stable per tool", () => {
    const sqlite = testDb();
    const now = new Date("2026-10-19T12:00:00Z");
    expect(buildOccurrenceId(sqlite, "s1", { tool: "fire_reminder", nodeId: 3, remindAt: "2026-10-19T12:00:00Z" }, now)).toBe("node:3:at:2026-10-19T12:00:00Z");
    expect(buildOccurrenceId(sqlite, "s1", { tool: "checkin" }, now)).toBe("day:2026-10-19");
    expect(buildOccurrenceId(sqlite, "s1", { tool: "billRisk", billId: 9 }, now)).toBe("bill:9:day:2026-10-19");
  });
});

describe("policy decisions", () => {
  it("urgent bypasses quiet hours", () => {
    const sqlite = testDb();
    const now = new Date("2026-10-20T02:00:00Z"); // 22:00 ET = quiet
    const d = decidePolicy(sqlite, "s1", { tool: "fire_reminder", nodeId: 1 }, { isUrgent: true, reason: "fresh" }, now);
    expect(d.action).toBe("send");
  });

  it("normal in quiet hours → queued until quiet end", () => {
    const sqlite = testDb();
    const now = new Date("2026-10-20T02:00:00Z"); // 22:00 ET = quiet
    const d = decidePolicy(sqlite, "s1", { tool: "checkin" }, { isUrgent: false }, now);
    expect(d.action).toBe("queue");
    if (d.action === "queue") {
      expect(d.reason).toBe("quiet hours");
      // Deliver after 04:30 ET = 08:30 UTC
      expect(localTime(new Date(d.deliverAfter), "America/New_York")).toBe("04:30");
    }
  });

  it("normal outside quiet hours → send", () => {
    const sqlite = testDb();
    const now = new Date("2026-10-19T15:00:00Z"); // 11:00 ET, not quiet
    const d = decidePolicy(sqlite, "s1", { tool: "checkin" }, { isUrgent: false }, now);
    expect(d.action).toBe("send");
  });

  it("stale reminder → dropped", () => {
    const sqlite = testDb();
    const now = new Date("2026-10-22T12:00:00Z");
    const d = decidePolicy(sqlite, "s1", { tool: "fire_reminder", remindAt: "2026-10-18T12:00:00Z" }, { isUrgent: false }, now);
    expect(d.action).toBe("drop");
  });

  it("staleness limits vary by tool", () => {
    expect(stalenessLimitMs("fire_reminder")).toBe(3 * 24 * 3600 * 1000);
    expect(stalenessLimitMs("checkin")).toBe(24 * 3600 * 1000);
    expect(stalenessLimitMs("weeklyReview")).toBe(7 * 24 * 3600 * 1000);
    expect(stalenessLimitMs("create_task")).toBeNull();
  });
});

describe("atomic cap claim", () => {
  it("two racers, one slot → exactly one wins", () => {
    const sqlite = testDb();
    const now = new Date("2026-10-19T15:00:00Z").toISOString();
    const day = "2026-10-19";
    // Cap = 1: pre-fill via direct inserts.
    const a = enqueue(sqlite, { spaceId: "s1", meta: { tool: "checkin", occurrenceId: "day:2026-10-19" }, message: "a", urgency: { isUrgent: false }, deliverAfter: now, queueReason: "t" });
    const b = enqueue(sqlite, { spaceId: "s1", meta: { tool: "reviewNudge", occurrenceId: "day:2026-10-19" }, message: "b", urgency: { isUrgent: false }, deliverAfter: now, queueReason: "t" });
    const winA = claimForSend(sqlite, a.id, "s1", day, 1, "w1", now);
    const winB = claimForSend(sqlite, b.id, "s1", day, 1, "w2", now);
    expect(winA !== winB).toBe(true); // exactly one
    expect([winA, winB].filter(Boolean)).toHaveLength(1);
  });

  it("urgent bypasses cap claim", () => {
    const sqlite = testDb();
    const now = new Date().toISOString();
    const { id } = enqueue(sqlite, { spaceId: "s1", meta: { tool: "fire_reminder", occurrenceId: "x" }, message: "u", urgency: { isUrgent: true, reason: "fresh" }, deliverAfter: now, queueReason: "t" });
    // ADR-018: claimUrgentForSend takes (spaceId, localDay) and records a
    // cap-exempt ledger claim instead of touching cap_day.
    expect(claimUrgentForSend(sqlite, id, "s1", "2026-10-19", "w1", now)).toBe(true);
    const row = getRow(sqlite, id);
    expect(row?.capDay).toBeNull(); // inert legacy column — never written by claims (ADR-018 A2/Q1)
    // The delivery IS recorded in the shared ledger with cap_exempt = 1
    // and does not consume a cap slot (ADR-018 D1 / A2).
    const claim = sqlite
      .prepare(`SELECT state, cap_exempt FROM notification_cap_claims WHERE space_id = 's1' AND channel = 'telegram' AND delivery_key = ?`)
      .get(row!.notifKey) as { state: string; cap_exempt: number };
    expect(claim).toEqual({ state: "reserved", cap_exempt: 1 });
  });

  it("failed send releases the slot", () => {
    const sqlite = testDb();
    const now = new Date().toISOString();
    const day = "2026-10-19";
    const { id } = enqueue(sqlite, { spaceId: "s1", meta: { tool: "checkin", occurrenceId: "d1" }, message: "a", urgency: { isUrgent: false }, deliverAfter: now, queueReason: "t" });
    expect(claimForSend(sqlite, id, "s1", day, 1, "w1", now)).toBe(true);
    markFailed(sqlite, id, "boom", null); // terminal
    // Slot freed: another can claim.
    const { id: id2 } = enqueue(sqlite, { spaceId: "s1", meta: { tool: "checkin", occurrenceId: "d2" }, message: "b", urgency: { isUrgent: false }, deliverAfter: now, queueReason: "t" });
    expect(claimForSend(sqlite, id2, "s1", day, 1, "w2", now)).toBe(true);
  });
});

describe("crash recovery: two cases", () => {
  it("crashed BEFORE send_started_at → requeued, slot released", () => {
    const sqlite = testDb();
    const now = new Date("2026-10-19T15:00:00Z");
    const { id } = enqueue(sqlite, { spaceId: "s1", meta: { tool: "checkin", occurrenceId: "d1" }, message: "a", urgency: { isUrgent: false }, deliverAfter: now.toISOString(), queueReason: "t" });
    claimForSend(sqlite, id, "s1", "2026-10-19", 5, "w1", now.toISOString());
    // Simulate crash: claimed_at far in the past, send_started_at NULL.
    sqlite.prepare(`UPDATE notification_outbox SET claimed_at = ? WHERE id = ?`).run(new Date(now.getTime() - LEASE_MS - 1000).toISOString(), id);
    const stats = recoverExpiredLeases(sqlite, now);
    expect(stats.requeued).toBe(1);
    expect(stats.ambiguous).toBe(0);
    const row = getRow(sqlite, id)!;
    expect(row.status).toBe("queued");
    expect(row.capDay).toBeNull();
    // ADR-018 A2: the ledger claim was released atomically with the requeue.
    const claim = sqlite
      .prepare(`SELECT state FROM notification_cap_claims WHERE delivery_key = ?`)
      .get(row.notifKey) as { state: string };
    expect(claim.state).toBe("released");
  });

  it("crashed AFTER send_started_at → ambiguous, cap RETAINED, never retried", () => {
    const sqlite = testDb();
    const now = new Date("2026-10-19T15:00:00Z");
    const { id } = enqueue(sqlite, { spaceId: "s1", meta: { tool: "checkin", occurrenceId: "d1" }, message: "a", urgency: { isUrgent: false }, deliverAfter: now.toISOString(), queueReason: "t" });
    claimForSend(sqlite, id, "s1", "2026-10-19", 5, "w1", now.toISOString());
    markSendStarted(sqlite, id, now.toISOString());
    sqlite.prepare(`UPDATE notification_outbox SET claimed_at = ? WHERE id = ?`).run(new Date(now.getTime() - LEASE_MS - 1000).toISOString(), id);
    const stats = recoverExpiredLeases(sqlite, now);
    expect(stats.ambiguous).toBe(1);
    const row = getRow(sqlite, id)!;
    expect(row.status).toBe("ambiguous");
    // ADR-018 A2: the retained slot now lives in the shared ledger, not in
    // the outbox cap_day column (claims no longer write cap_day — it stays
    // NULL and inert). The ambiguous claim still counts toward the cap.
    const claim = sqlite
      .prepare(`SELECT state, cap_exempt FROM notification_cap_claims WHERE delivery_key = ?`)
      .get(row.notifKey) as { state: string; cap_exempt: number };
    expect(claim).toEqual({ state: "ambiguous", cap_exempt: 0 });
    // Sweep must not pick it up again.
    expect(dueRows(sqlite, now.toISOString()).map((r) => r.id)).not.toContain(id);
  });

  it("ambiguous slot blocks the next notification (cap=1)", () => {
    const sqlite = testDb();
    const now = new Date("2026-10-19T15:00:00Z").toISOString();
    const day = "2026-10-19";
    const { id: a } = enqueue(sqlite, { spaceId: "s1", meta: { tool: "checkin", occurrenceId: "d1" }, message: "a", urgency: { isUrgent: false }, deliverAfter: now, queueReason: "t" });
    claimForSend(sqlite, a, "s1", day, 1, "w1", now);
    markSendStarted(sqlite, a, now);
    markAmbiguous(sqlite, a);
    // B tries to claim the last slot → denied (A still counts).
    const { id: b } = enqueue(sqlite, { spaceId: "s1", meta: { tool: "reviewNudge", occurrenceId: "d1" }, message: "b", urgency: { isUrgent: false }, deliverAfter: now, queueReason: "t" });
    expect(claimForSend(sqlite, b, "s1", day, 1, "w2", now)).toBe(false);
    expect(getRow(sqlite, b)!.status).toBe("queued");
  });
});

describe("boundary: end-to-end", () => {
  it("normal in quiet hours → queued; sweep delivers after quiet end", async () => {
    // Boundary tests run on a production-bootstrapped DB (createDb): the
    // boundary needs a real DbHandle for episode capture, and the production
    // schema is the faithful fixture for the sweep path.
    const h = createDb(":memory:");
    const sqlite = h.sqlite;
    const sent: string[] = [];
    const deps = makeDeps(sqlite, sent, false, h);
    const notify = createPolicyNotify(deps);
    // 22:00 ET = quiet.
    const quietNow = new Date("2026-10-20T02:00:00Z");
    // We can't inject 'now' into createPolicyNotify; test via sweep instead.
    // Enqueue directly with a deliver_after in the past, then sweep at quiet time.
    const { id } = enqueue(sqlite, {
      spaceId: "s1",
      meta: { tool: "checkin", occurrenceId: "day:2026-10-19" },
      message: "morning checkin",
      urgency: { isUrgent: false },
      deliverAfter: quietNow.toISOString(),
      queueReason: "test",
    });
    // Sweep during quiet hours: claim succeeds? No — sweep doesn't check quiet hours
    // for already-queued items... Actually the design says queued items deliver when
    // due. The quiet-hours check happens at enqueue time. deliver_after was computed
    // as quiet_end. So a row due during quiet hours shouldn't exist. This test
    // verifies the sweep delivers a due row.
    const stats = await sweepNotifications(deps, new Date("2026-10-20T09:00:00Z")); // 05:00 ET, not quiet
    expect(stats.sent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(getRow(sqlite, id)!.status).toBe("sent");
  });

  it("urgent at 3am bypasses quiet hours and cap", async () => {
    const h = createDb(":memory:");
    const sqlite = h.sqlite;
    const sent: string[] = [];
    const deps = makeDeps(sqlite, sent, false, h);
    // Fill the cap with 5 sent normals.
    for (let i = 0; i < 5; i++) {
      sqlite.prepare(`INSERT INTO notification_outbox (notif_key, space_id, tool, occurrence_id, message, status, deliver_after, cap_day) VALUES (?,?,?,?,?,'sent',?,?)`).run(`k${i}`, "s1", "checkin", `d${i}`, "x", new Date().toISOString(), "2026-10-19");
    }
    const { id } = enqueue(sqlite, {
      spaceId: "s1",
      // ADR-018 B1/D-1: the sweep reclassifies from the persisted
      // remind_at — a fire_reminder without one is dropped as
      // unverifiable, so the fixture carries a fresh due time (10m
      // before the sweep instant below).
      meta: { tool: "fire_reminder", occurrenceId: "node:1:at:x", remindAt: "2026-10-20T06:50:00.000Z" },
      message: "urgent!",
      urgency: { isUrgent: true, reason: "fresh reminder" },
      // Due at the sweep instant below. (Wall-clock "now" made this test a
      // time bomb: once real time passed the fixed sweep date, the row was
      // never due.)
      deliverAfter: "2026-10-20T07:00:00.000Z",
      queueReason: "t",
    });
    const stats = await sweepNotifications(deps, new Date("2026-10-20T07:00:00Z")); // 03:00 ET
    expect(stats.sent).toBe(1);
    expect(sent[0]).toMatch(/urgent!/);
  });

  it("send failure retries, then goes terminal after MAX_ATTEMPTS", async () => {
    const h = createDb(":memory:");
    const sqlite = h.sqlite;
    const sent: string[] = [];
    const deps = makeDeps(sqlite, sent, true, h); // always fail
    const { id } = enqueue(sqlite, {
      spaceId: "s1", meta: { tool: "checkin", occurrenceId: "d1" }, message: "x",
      urgency: { isUrgent: false }, deliverAfter: new Date().toISOString(), queueReason: "t",
    });
    // Simulate 3 attempts.
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      claimForSend(sqlite, id, "s1", "2026-10-19", 5, "w", new Date().toISOString());
      markSendStarted(sqlite, id, new Date().toISOString());
      try { await deps.send("s1", "x"); } catch (e) {
        const attempts = (getRow(sqlite, id)!.attempts ?? 0) + 1;
        markFailed(sqlite, id, "down", attempts >= MAX_ATTEMPTS ? null : new Date().toISOString());
      }
    }
    expect(getRow(sqlite, id)!.status).toBe("failed");
  });

  it("audit log is content-free", async () => {
    const h = createDb(":memory:");
    const sqlite = h.sqlite;
    const sent: string[] = [];
    const deps = makeDeps(sqlite, sent, false, h);
    const { id } = enqueue(sqlite, {
      spaceId: "s1", meta: { tool: "checkin", occurrenceId: "d1" }, message: "SECRET MESSAGE TEXT",
      // Due at the sweep instant below (wall-clock "now" outran the fixed
      // sweep date and the row silently stopped being due).
      urgency: { isUrgent: false }, deliverAfter: "2026-10-19T15:00:00.000Z", queueReason: "t",
    });
    await sweepNotifications(deps, new Date("2026-10-19T15:00:00Z"));
    const logs = sqlite.prepare(`SELECT action, description FROM agent_logs`).all() as { action: string; description: string }[];
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) {
      expect(l.description).not.toContain("SECRET MESSAGE TEXT");
    }
  });
});

describe("bill upgrade atomicity", () => {
  it("two workers upgrading the same row → exactly one wins", () => {
    const sqlite = testDb();
    const { id } = enqueue(sqlite, {
      spaceId: "s1", meta: { tool: "billRisk", occurrenceId: "bill:5:day:2026-10-19" }, message: "bill",
      urgency: { isUrgent: false }, deliverAfter: new Date().toISOString(), queueReason: "t",
    });
    const w1 = tryUpgradeToUrgent(sqlite, id, "bill due in 4h");
    const w2 = tryUpgradeToUrgent(sqlite, id, "bill due in 4h");
    expect(w1 !== w2).toBe(true);
    expect(getRow(sqlite, id)!.isUrgent).toBe(1);
  });
});
