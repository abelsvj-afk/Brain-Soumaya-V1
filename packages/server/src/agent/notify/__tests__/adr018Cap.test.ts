/**
 * ADR-018 Phase B: global notification cap (shared ledger) + retry
 * freshness reclassification. Criteria map (ADR §4):
 *   1  cap=1 across channels — one non-exempt send per space-local day
 *   2  same occurrence claimed twice → one slot
 *   3  cap=5 mixed 3+2; 6th blocked; exempt urgent tracked, not counted
 *   4  local-day accounting in the space timezone (Pacific/Kiritimati)
 *   5  deferred items consume nothing; cap exhaustion defers, never drops
 *   6  definite failure releases exactly once; same-day retry reactivates
 *      the SAME ledger row; cross-day retry creates a new-day row
 *   7  successful delivery retains its slot
 *   8  ambiguous outcome retains its slot and is terminal
 *   9  fresh urgent reminder bypasses quiet hours AND a full cap (exempt)
 *   10/12 outage timeline: aged-out reminder loses the exemption, is
 *      re-deferred by quiet hours, and is dropped from DUE time when stale
 *   11 billRisk urgency only inside the due-in window (+ per-bill dedup)
 *   D-1 legacy fire_reminder with remind_at NULL → dropped, never sent
 *   10-push / push-D-1: the same freshness rules on the push channel
 *   14 unconfigured VAPID → zero push rows AND zero ledger claims;
 *      a push-only space drains through the push sweep alone
 *
 * All instants are America/New_York (EDT, UTC-4) unless a test says else.
 */
import { describe, it, expect } from "vitest";
import { createDb, type DbHandle } from "../../../db/client.js";
import type { RawDb } from "../../../db/vec.js";
import { countActiveClaims, tryClaim, transitionClaim } from "../capClaims.js";
import {
  enqueue,
  claimForSend,
  claimUrgentForSend,
  markSendStarted,
  markSent,
  markFailed,
  markAmbiguous,
  dueRows,
  getRow,
} from "../outbox.js";
import { sweepNotifications, type BoundaryDeps } from "../boundary.js";
import { classifyUrgency, localDay } from "../policy.js";
import {
  enqueuePendingPush,
  claimPushForSend,
  dispatchPush,
  sweepPendingPushes,
  getPushRow,
} from "../../../push/outbox.js";
import { PushSubscriptionsRepo } from "../../../repositories/pushSubscriptions.repo.js";
import type { VapidConfig } from "../../../push/service.js";

const NY = "America/New_York";
const MIDDAY = new Date("2026-10-21T16:00:00Z"); // 12:00 EDT
const DAY = "2026-10-21";
const CONFIG: VapidConfig = { publicKey: "BTestPublicKey", privateKey: "test-private", subject: "mailto:test@example.com" };

function setPrefs(sqlite: RawDb, spaceId: string, cap: number, tz = NY): void {
  sqlite
    .prepare(
      `INSERT INTO space_meta (space_id, timezone, quiet_start, quiet_end, digest_time, daily_proactive_cap)
       VALUES (?, ?, '21:00', '04:30', '06:00', ?)`
    )
    .run(spaceId, tz, cap);
}

interface ClaimRow {
  local_day: string;
  channel: string;
  delivery_key: string;
  state: string;
  cap_exempt: number;
}

function claims(sqlite: RawDb, spaceId: string): ClaimRow[] {
  return sqlite
    .prepare(
      `SELECT local_day, channel, delivery_key, state, cap_exempt FROM notification_cap_claims
       WHERE space_id = ? ORDER BY local_day, channel, delivery_key`
    )
    .all(spaceId) as ClaimRow[];
}

function makeDeps(handle: DbHandle, sent: string[], auditLog: string[]): BoundaryDeps {
  return {
    sqlite: handle.sqlite,
    handle,
    send: async (spaceId: string, text: string) => {
      sent.push(`${spaceId}:${text}`);
      // H-2: the send reports per-chat outcomes; this double stands in for
      // a one-chat space that accepted.
      return { attempted: [{ chatId: 1, outcome: "sent" as const }] };
    },
    audit: (_spaceId: string, action: string, detail: string) => {
      auditLog.push(`${action}:${detail}`);
    },
    workerId: "adr018-test",
  };
}

function tgEnqueue(
  sqlite: RawDb,
  spaceId: string,
  meta: { tool: string; occurrenceId: string; remindAt?: string; billDueAt?: string; billId?: number },
  opts: { urgent?: boolean; deliverAfter?: string } = {}
): number {
  const { id } = enqueue(sqlite, {
    spaceId,
    meta,
    message: `msg:${meta.occurrenceId}`,
    urgency: opts.urgent ? { isUrgent: true, reason: "fresh" } : { isUrgent: false },
    deliverAfter: opts.deliverAfter ?? new Date(MIDDAY.getTime() - 60_000).toISOString(),
    queueReason: "test",
  });
  return id;
}

// ---------------------------------------------------------------------------
// capClaims unit tests (criteria 2, 3-ledger, 5-ledger, 6-ledger, 7, 8-ledger)
// ---------------------------------------------------------------------------

describe("capClaims ledger", () => {
  it("countActiveClaims counts reserved/sent/ambiguous non-exempt only (criteria 3/7/8 ledger semantics)", () => {
    const h = createDb(":memory:");
    const s = h.sqlite;
    const claim = (key: string, exempt = false) =>
      tryClaim(s, { spaceId: "sp", channel: "telegram", deliveryKey: key, localDay: DAY, cap: 5, capExempt: exempt }, () => true);

    expect(claim("k1")).toBe(true);
    expect(countActiveClaims(s, "sp", DAY)).toBe(1); // reserved counts
    expect(transitionClaim(s, { spaceId: "sp", channel: "telegram", deliveryKey: "k1" }, "sent")).toBe(true);
    expect(countActiveClaims(s, "sp", DAY)).toBe(1); // sent retains (criterion 7)

    expect(claim("k2")).toBe(true);
    expect(transitionClaim(s, { spaceId: "sp", channel: "telegram", deliveryKey: "k2" }, "ambiguous")).toBe(true);
    expect(countActiveClaims(s, "sp", DAY)).toBe(2); // ambiguous retains (criterion 8)

    expect(claim("k3")).toBe(true);
    expect(transitionClaim(s, { spaceId: "sp", channel: "telegram", deliveryKey: "k3" }, "released")).toBe(true);
    expect(countActiveClaims(s, "sp", DAY)).toBe(2); // released frees

    expect(claim("k4", true)).toBe(true); // exempt urgent
    expect(countActiveClaims(s, "sp", DAY)).toBe(2); // exempt never counted

    expect(countActiveClaims(s, "sp", "2026-10-22")).toBe(0); // other day
    expect(countActiveClaims(s, "other-space", DAY)).toBe(0); // other space
    h.sqlite.close();
  });

  it("criterion 2: the same delivery claimed twice reserves exactly one slot", () => {
    const h = createDb(":memory:");
    const s = h.sqlite;
    const input = { spaceId: "sp", channel: "telegram" as const, deliveryKey: "dup-key", localDay: DAY, cap: 5, capExempt: false };
    expect(tryClaim(s, input, () => true)).toBe(true);
    expect(tryClaim(s, input, () => true)).toBe(false); // already reserved
    expect(transitionClaim(s, { spaceId: "sp", channel: "telegram", deliveryKey: "dup-key" }, "sent")).toBe(true);
    expect(tryClaim(s, input, () => true)).toBe(false); // sent is terminal for claiming
    expect(claims(s, "sp")).toHaveLength(1);
    expect(countActiveClaims(s, "sp", DAY)).toBe(1);
    h.sqlite.close();
  });

  it("criterion 6 (ledger): release happens exactly once; same-day retry reactivates the SAME row; cross-day retry is a new row", () => {
    const h = createDb(":memory:");
    const s = h.sqlite;
    const input = { spaceId: "sp", channel: "push" as const, deliveryKey: "retry-key", localDay: DAY, cap: 5, capExempt: false };
    expect(tryClaim(s, input, () => true)).toBe(true);
    expect(transitionClaim(s, { spaceId: "sp", channel: "push", deliveryKey: "retry-key" }, "released")).toBe(true);
    expect(countActiveClaims(s, "sp", DAY)).toBe(0);
    // Second release is a no-op — the slot was freed exactly once.
    expect(transitionClaim(s, { spaceId: "sp", channel: "push", deliveryKey: "retry-key" }, "released")).toBe(false);
    expect(countActiveClaims(s, "sp", DAY)).toBe(0);

    // Same-day retry: reactivates the released row — still ONE ledger row.
    expect(tryClaim(s, input, () => true)).toBe(true);
    expect(claims(s, "sp")).toHaveLength(1);
    expect(claims(s, "sp")[0]!.state).toBe("reserved");
    expect(countActiveClaims(s, "sp", DAY)).toBe(1);

    // Cross-day retry: release, then claim under the new local day.
    expect(transitionClaim(s, { spaceId: "sp", channel: "push", deliveryKey: "retry-key" }, "released")).toBe(true);
    expect(tryClaim(s, { ...input, localDay: "2026-10-22" }, () => true)).toBe(true);
    expect(claims(s, "sp")).toHaveLength(2);
    expect(countActiveClaims(s, "sp", DAY)).toBe(0);
    expect(countActiveClaims(s, "sp", "2026-10-22")).toBe(1);
    h.sqlite.close();
  });

  it("transitionClaim with no reserved claim is a silent no-op (Q1: legacy in-flight rows)", () => {
    const h = createDb(":memory:");
    const s = h.sqlite;
    expect(transitionClaim(s, { spaceId: "sp", channel: "telegram", deliveryKey: "ghost" }, "sent")).toBe(false);
    expect(transitionClaim(s, { spaceId: "sp", channel: "push", deliveryKey: "ghost" }, "released")).toBe(false);
    expect(claims(s, "sp")).toHaveLength(0);
    h.sqlite.close();
  });

  it("flip=false writes no claim; a throwing flip rolls back BOTH the flip and the claim", () => {
    const h = createDb(":memory:");
    const s = h.sqlite;
    const id = tgEnqueue(s, "sp", { tool: "checkin", occurrenceId: "day:flip" });
    const key = getRow(s, id)!.notifKey;
    const input = { spaceId: "sp", channel: "telegram" as const, deliveryKey: key, localDay: DAY, cap: 5, capExempt: false };

    expect(tryClaim(s, input, () => false)).toBe(false);
    expect(claims(s, "sp")).toHaveLength(0);

    expect(() =>
      tryClaim(s, input, () => {
        s.prepare(`UPDATE notification_outbox SET status = 'sending' WHERE id = ?`).run(id);
        throw new Error("flip boom");
      })
    ).toThrow("flip boom");
    expect(getRow(s, id)!.status).toBe("queued"); // the flip was rolled back too
    expect(claims(s, "sp")).toHaveLength(0);
    h.sqlite.close();
  });

  it("criterion 4: claims are keyed by the SPACE-LOCAL day, and two local days sharing a UTC date count separately", () => {
    const h = createDb(":memory:");
    const s = h.sqlite;
    setPrefs(s, "kiri", 1, "Pacific/Kiritimati");
    const now = new Date("2026-10-21T11:30:00Z");
    expect(localDay(now, "UTC")).toBe("2026-10-21");
    expect(localDay(now, "Pacific/Kiritimati")).toBe("2026-10-22"); // UTC+14 — already tomorrow

    const id = tgEnqueue(s, "kiri", { tool: "checkin", occurrenceId: "day:kiri" });
    expect(claimForSend(s, id, "kiri", localDay(now, "Pacific/Kiritimati"), 1, "w", now.toISOString())).toBe(true);
    expect(claims(s, "kiri")[0]!.local_day).toBe("2026-10-22"); // LOCAL day, not the UTC slice

    // Same UTC date, two different local days → separate allowances
    // (fresh space so the claim above doesn't consume either slot).
    const a = { spaceId: "days", channel: "push" as const, deliveryKey: "d1", cap: 1, capExempt: false };
    expect(tryClaim(s, { ...a, localDay: "2026-10-21" }, () => true)).toBe(true);
    expect(tryClaim(s, { ...a, deliveryKey: "d2", localDay: "2026-10-22" }, () => true)).toBe(true);
    expect(countActiveClaims(s, "days", "2026-10-21")).toBe(1);
    expect(countActiveClaims(s, "days", "2026-10-22")).toBe(1);
    h.sqlite.close();
  });
});

// ---------------------------------------------------------------------------
// Cross-channel cap (criteria 1, 3)
// ---------------------------------------------------------------------------

describe("global cap across channels", () => {
  it("criterion 1: cap=1 — a Telegram claim blocks the push claim for the same space-day (and vice versa)", () => {
    const h = createDb(":memory:");
    const s = h.sqlite;
    setPrefs(s, "sp1", 1);

    const tgId = tgEnqueue(s, "sp1", { tool: "checkin", occurrenceId: "day:c1-a" });
    expect(claimForSend(s, tgId, "sp1", DAY, 1, "w", MIDDAY.toISOString())).toBe(true);

    const { id: pushId } = enqueuePendingPush(s, {
      spaceId: "sp1",
      meta: { tool: "checkin", occurrenceId: "day:c1-b" },
      payload: { title: "t", body: "b", url: "/" },
      isUrgent: false,
      deliverAfter: MIDDAY.toISOString(),
    });
    expect(claimPushForSend(s, pushId, "sp1", DAY, 1, "w", MIDDAY.toISOString())).toBe(false);
    expect(getPushRow(s, pushId)!.status).toBe("pending"); // deferred, untouched
    expect(countActiveClaims(s, "sp1", DAY)).toBe(1);
    expect(claims(s, "sp1")[0]!.channel).toBe("telegram");
    h.sqlite.close();
  });

  it("criterion 3: cap=5 admits any 3+2 mix; the 6th is blocked; an exempt urgent is recorded but not counted", () => {
    const h = createDb(":memory:");
    const s = h.sqlite;
    setPrefs(s, "sp", 5);
    for (let i = 0; i < 3; i++) {
      const id = tgEnqueue(s, "sp", { tool: "checkin", occurrenceId: `day:c3-t${i}` });
      expect(claimForSend(s, id, "sp", DAY, 5, "w", MIDDAY.toISOString())).toBe(true);
    }
    for (let i = 0; i < 2; i++) {
      const { id } = enqueuePendingPush(s, {
        spaceId: "sp",
        meta: { tool: "checkin", occurrenceId: `day:c3-p${i}` },
        payload: { title: "t", body: "b", url: "/" },
        isUrgent: false,
        deliverAfter: MIDDAY.toISOString(),
      });
      expect(claimPushForSend(s, id, "sp", DAY, 5, "w", MIDDAY.toISOString())).toBe(true);
    }
    expect(countActiveClaims(s, "sp", DAY)).toBe(5);

    const sixth = tgEnqueue(s, "sp", { tool: "checkin", occurrenceId: "day:c3-sixth" });
    expect(claimForSend(s, sixth, "sp", DAY, 5, "w", MIDDAY.toISOString())).toBe(false);

    // Fresh urgent: exempt claim succeeds despite the full cap, is tracked
    // with cap_exempt = 1, and does not move the count.
    const urgent = tgEnqueue(s, "sp", { tool: "fire_reminder", occurrenceId: "node:3:at:x", remindAt: MIDDAY.toISOString() }, { urgent: true });
    expect(claimUrgentForSend(s, urgent, "sp", DAY, "w", MIDDAY.toISOString())).toBe(true);
    const urgentClaim = claims(s, "sp").find((c) => c.delivery_key === getRow(s, urgent)!.notifKey)!;
    expect(urgentClaim.cap_exempt).toBe(1);
    expect(countActiveClaims(s, "sp", DAY)).toBe(5);
    h.sqlite.close();
  });
});

// ---------------------------------------------------------------------------
// Telegram lifecycle through the ledger (criteria 5, 6, 7, 8)
// ---------------------------------------------------------------------------

describe("telegram lifecycle + ledger", () => {
  it("criterion 6: definite failure releases exactly once; same-day retry reactivates the same ledger row", () => {
    const h = createDb(":memory:");
    const s = h.sqlite;
    setPrefs(s, "sp", 1);
    const id = tgEnqueue(s, "sp", { tool: "checkin", occurrenceId: "day:c6" });
    expect(claimForSend(s, id, "sp", DAY, 1, "w", MIDDAY.toISOString())).toBe(true);
    expect(countActiveClaims(s, "sp", DAY)).toBe(1);

    markFailed(s, id, "telegram down", new Date(MIDDAY.getTime() + 120_000).toISOString());
    expect(getRow(s, id)!.status).toBe("queued");
    expect(countActiveClaims(s, "sp", DAY)).toBe(0);
    expect(claims(s, "sp")[0]!.state).toBe("released");

    // Retry on the same day reclaims through the SAME ledger row.
    expect(claimForSend(s, id, "sp", DAY, 1, "w", MIDDAY.toISOString())).toBe(true);
    expect(claims(s, "sp")).toHaveLength(1);
    expect(claims(s, "sp")[0]!.state).toBe("reserved");
    expect(countActiveClaims(s, "sp", DAY)).toBe(1);
    h.sqlite.close();
  });

  it("criteria 7+8: sent retains its slot; ambiguous retains and is never re-offered", async () => {
    const h = createDb(":memory:");
    const s = h.sqlite;
    setPrefs(s, "sp", 5);

    const sentId = tgEnqueue(s, "sp", { tool: "checkin", occurrenceId: "day:c7" });
    expect(claimForSend(s, sentId, "sp", DAY, 5, "w", MIDDAY.toISOString())).toBe(true);
    markSendStarted(s, sentId, MIDDAY.toISOString());
    markSent(s, sentId);
    expect(claims(s, "sp").find((c) => c.delivery_key === getRow(s, sentId)!.notifKey)!.state).toBe("sent");
    expect(countActiveClaims(s, "sp", DAY)).toBe(1);
    expect(claimForSend(s, sentId, "sp", DAY, 5, "w", MIDDAY.toISOString())).toBe(false);

    const ambId = tgEnqueue(s, "sp", { tool: "checkin", occurrenceId: "day:c8" });
    expect(claimForSend(s, ambId, "sp", DAY, 5, "w", MIDDAY.toISOString())).toBe(true);
    markSendStarted(s, ambId, MIDDAY.toISOString());
    markAmbiguous(s, ambId);
    expect(claims(s, "sp").find((c) => c.delivery_key === getRow(s, ambId)!.notifKey)!.state).toBe("ambiguous");
    expect(countActiveClaims(s, "sp", DAY)).toBe(2); // ambiguous still counts
    expect(dueRows(s, MIDDAY.toISOString()).map((r) => r.id)).not.toContain(ambId);

    const sent: string[] = [];
    const stats = await sweepNotifications(makeDeps(h, sent, []), MIDDAY);
    expect(sent).toHaveLength(0); // the ambiguous row is never re-sent
    expect(stats.sent).toBe(0);
    expect(getRow(s, ambId)!.status).toBe("ambiguous");
    h.sqlite.close();
  });

  it("criterion 5: a queued row consumes nothing; cap exhaustion defers (never drops); raising the cap lets it send", async () => {
    const h = createDb(":memory:");
    const s = h.sqlite;
    setPrefs(s, "sp", 1);
    const sent: string[] = [];
    const deps = makeDeps(h, sent, []);

    // Never-claimed rows consume no slot.
    const a = tgEnqueue(s, "sp", { tool: "checkin", occurrenceId: "day:c5-a" });
    const b = tgEnqueue(s, "sp", { tool: "checkin", occurrenceId: "day:c5-b" });
    expect(countActiveClaims(s, "sp", DAY)).toBe(0);

    const first = await sweepNotifications(deps, MIDDAY);
    expect(first.sent).toBe(1); // exactly one fits cap=1
    expect(sent).toHaveLength(1);
    expect(countActiveClaims(s, "sp", DAY)).toBe(1);

    // The loser was deferred, NOT dropped, and holds no claim.
    const loser = getRow(s, getRow(s, a)!.status === "sent" ? b : a)!;
    expect(loser.status).toBe("queued");
    expect(loser.deliverAfter).toBe("2026-10-22T10:00:00.000Z"); // next day 06:00 EDT (digest)
    expect(claims(s, "sp")).toHaveLength(1);

    // Raise the cap; after the deferral instant the row sends.
    s.prepare(`UPDATE space_meta SET daily_proactive_cap = 2 WHERE space_id = 'sp'`).run();
    const second = await sweepNotifications(deps, new Date("2026-10-22T11:00:00Z")); // 07:00 EDT next day
    expect(second.sent).toBe(1);
    expect(sent).toHaveLength(2);
    expect(getRow(s, loser.id)!.status).toBe("sent");
    h.sqlite.close();
  });
});

// ---------------------------------------------------------------------------
// Freshness: quiet hours, cap exemption, outage timeline, bills, D-1
// (criteria 9, 10, 11, 12, D-1)
// ---------------------------------------------------------------------------

describe("telegram sweep reclassification", () => {
  it("criterion 9: a fresh reminder sends in quiet hours despite a FULL cap — via an exempt claim", async () => {
    const h = createDb(":memory:");
    const s = h.sqlite;
    setPrefs(s, "sp", 1);
    const QUIET = new Date("2026-10-21T06:00:00Z"); // 02:00 EDT — quiet hours

    // Fill the single slot with a confirmed delivery earlier that local day.
    const filler = tgEnqueue(s, "sp", { tool: "checkin", occurrenceId: "day:c9-fill" });
    expect(claimForSend(s, filler, "sp", DAY, 1, "w", QUIET.toISOString())).toBe(true);
    markSent(s, filler);
    expect(countActiveClaims(s, "sp", DAY)).toBe(1);

    const remindAt = new Date(QUIET.getTime() - 10 * 60_000).toISOString(); // due 10m ago — fresh
    const id = tgEnqueue(
      s,
      "sp",
      { tool: "fire_reminder", occurrenceId: `node:9:at:${remindAt}`, remindAt },
      { urgent: true, deliverAfter: new Date(QUIET.getTime() - 60_000).toISOString() }
    );

    const sent: string[] = [];
    const stats = await sweepNotifications(makeDeps(h, sent, []), QUIET);
    expect(stats.sent).toBe(1);
    expect(sent).toHaveLength(1);
    const claim = claims(s, "sp").find((c) => c.delivery_key === getRow(s, id)!.notifKey)!;
    expect(claim.cap_exempt).toBe(1); // bypassed the cap as an exempt claim
    expect(claim.state).toBe("sent");
    expect(countActiveClaims(s, "sp", DAY)).toBe(1); // ordinary count unchanged
    h.sqlite.close();
  });

  it("criterion 10/12 — outage timeline: a reminder that aged out during an outage is re-deferred by quiet hours, not sent, with no exempt claim", async () => {
    const h = createDb(":memory:");
    const s = h.sqlite;
    setPrefs(s, "sp", 5);
    const DUE = new Date("2026-10-21T18:00:00Z"); // due 14:00 EDT
    const SWEEP = new Date("2026-10-22T03:30:00Z"); // sweep 23:30 EDT — quiet hours, remindAt now 9.5h old

    const id = tgEnqueue(
      s,
      "sp",
      { tool: "fire_reminder", occurrenceId: `node:10:at:${DUE.toISOString()}`, remindAt: DUE.toISOString() },
      { urgent: true, deliverAfter: DUE.toISOString() }
    );
    // 14:00: fresh-urgent claim, send starts, definite failure → released,
    // re-queued with deliver_after at the 23:30 sweep.
    expect(claimUrgentForSend(s, id, "sp", DAY, "w", DUE.toISOString())).toBe(true);
    markSendStarted(s, id, DUE.toISOString());
    markFailed(s, id, "telegram down", SWEEP.toISOString());
    expect(getRow(s, id)!.status).toBe("queued");

    const sent: string[] = [];
    const stats = await sweepNotifications(makeDeps(h, sent, []), SWEEP);
    expect(sent).toHaveLength(0); // NOT sent: freshness expired 8.5h ago
    expect(stats.sent).toBe(0);
    expect(stats.queued).toBe(1); // re-deferred for quiet hours
    const row = getRow(s, id)!;
    expect(row.status).toBe("queued");
    expect(row.deliverAfter).toBe("2026-10-22T08:30:00.000Z"); // 04:30 EDT — quiet end
    // No exempt claim survives: the 14:00 exempt reservation was released
    // by the definite failure, and the sweep made no new claim at all.
    const rowClaims = claims(s, "sp").filter((c) => c.delivery_key === row.notifKey);
    expect(rowClaims.every((c) => c.state === "released")).toBe(true);
    expect(countActiveClaims(s, "sp", DAY)).toBe(0);
    h.sqlite.close();
  });

  it("criterion 10/12: a reminder due 3.5 days ago is dropped from its DUE time even when the row was created 0.6 days ago", async () => {
    const h = createDb(":memory:");
    const s = h.sqlite;
    setPrefs(s, "sp", 5);
    const remindAt = new Date(MIDDAY.getTime() - 3.5 * 24 * 3600_000).toISOString();
    const id = tgEnqueue(
      s,
      "sp",
      { tool: "fire_reminder", occurrenceId: `node:11:at:${remindAt}`, remindAt },
      { deliverAfter: remindAt }
    );
    // The row itself is young — created_at must NOT rescue it.
    s.prepare(`UPDATE notification_outbox SET created_at = ? WHERE id = ?`)
      .run(new Date(MIDDAY.getTime() - 0.6 * 24 * 3600_000).toISOString(), id);

    const sent: string[] = [];
    await sweepNotifications(makeDeps(h, sent, []), MIDDAY);
    expect(sent).toHaveLength(0);
    const row = getRow(s, id)!;
    expect(row.status).toBe("dropped");
    expect(row.lastError).toMatch(/stale/);
    h.sqlite.close();
  });

  it("criterion 12: a persisted is_urgent=1 with remind_at 2h old is downgraded — ordinary claim, cap consumed", async () => {
    const h = createDb(":memory:");
    const s = h.sqlite;
    setPrefs(s, "sp", 5);
    const remindAt = new Date(MIDDAY.getTime() - 2 * 3600_000).toISOString();
    const id = tgEnqueue(
      s,
      "sp",
      { tool: "fire_reminder", occurrenceId: `node:12:at:${remindAt}`, remindAt },
      { urgent: true } // persisted bit says urgent…
    );
    expect(getRow(s, id)!.isUrgent).toBe(1);

    const sent: string[] = [];
    const auditLog: string[] = [];
    const stats = await sweepNotifications(makeDeps(h, sent, auditLog), MIDDAY);
    expect(stats.sent).toBe(1); // …but 2h old is outside the 60m freshness window
    const row = getRow(s, id)!;
    expect(row.isUrgent).toBe(0); // downgrade persisted
    const claim = claims(s, "sp").find((c) => c.delivery_key === row.notifKey)!;
    expect(claim.cap_exempt).toBe(0); // ordinary path — the slot was consumed
    expect(claim.state).toBe("sent");
    expect(countActiveClaims(s, "sp", DAY)).toBe(1);
    expect(auditLog.some((a) => a.startsWith("notify:reclassified"))).toBe(true);
    h.sqlite.close();
  });

  it("criterion 11: billRisk is urgent-exempt inside the due-in window; after the due time it takes the ordinary path; per-bill dedup blocks a second urgent", async () => {
    const h = createDb(":memory:");
    const s = h.sqlite;
    setPrefs(s, "sp", 5);
    const billDueAt = new Date(MIDDAY.getTime() + 2 * 3600_000).toISOString(); // due in 2h

    const id = tgEnqueue(s, "sp", {
      tool: "billRisk",
      occurrenceId: `bill:7:day:${DAY}`,
      billDueAt,
      billId: 7,
    });
    const sent: string[] = [];
    const stats = await sweepNotifications(makeDeps(h, sent, []), MIDDAY);
    expect(stats.sent).toBe(1);
    const claim = claims(s, "sp").find((c) => c.delivery_key === getRow(s, id)!.notifKey)!;
    expect(claim.cap_exempt).toBe(1); // urgent exemption used
    expect(claim.state).toBe("sent");

    // Per-bill dedup: a second urgent classification for bill 7 today is suppressed.
    const again = classifyUrgency(
      s,
      "sp",
      { tool: "billRisk", billId: 7, billDueAt: new Date(MIDDAY.getTime() + 3 * 3600_000).toISOString() },
      new Date(MIDDAY.getTime() + 30 * 60_000)
    );
    expect(again.isUrgent).toBe(false);

    // The same bill, retried (next day's occurrence) after its due time
    // passed: no longer urgent — ordinary, non-exempt claim.
    const retryId = tgEnqueue(
      s,
      "sp",
      { tool: "billRisk", occurrenceId: "bill:7:day:2026-10-22", billDueAt, billId: 7 },
      { deliverAfter: new Date("2026-10-22T15:59:00Z").toISOString() }
    );
    const stats2 = await sweepNotifications(makeDeps(h, sent, []), new Date("2026-10-22T16:00:00Z"));
    expect(stats2.sent).toBe(1);
    const retryClaim = claims(s, "sp").find((c) => c.delivery_key === getRow(s, retryId)!.notifKey)!;
    expect(retryClaim.cap_exempt).toBe(0);
    expect(retryClaim.local_day).toBe("2026-10-22");
    expect(getRow(s, retryId)!.isUrgent).toBe(0);
    h.sqlite.close();
  });

  it("D-1: a legacy fire_reminder (remind_at NULL, is_urgent=1, created fresh) is DROPPED as unverifiable — never sent", async () => {
    const h = createDb(":memory:");
    const s = h.sqlite;
    setPrefs(s, "sp", 5);
    const id = tgEnqueue(
      s,
      "sp",
      { tool: "fire_reminder", occurrenceId: "node:99:at:legacy" }, // no remindAt — pre-migration row
      { urgent: true }
    );
    expect(getRow(s, id)!.remindAt).toBeNull();
    s.prepare(`UPDATE notification_outbox SET created_at = ? WHERE id = ?`)
      .run(new Date(MIDDAY.getTime() - 5 * 60_000).toISOString(), id); // created fresh — must not matter

    const sent: string[] = [];
    const auditLog: string[] = [];
    await sweepNotifications(makeDeps(h, sent, auditLog), MIDDAY);
    expect(sent).toHaveLength(0);
    const row = getRow(s, id)!;
    expect(row.status).toBe("dropped");
    expect(row.lastError).toBe("unverifiable legacy reminder: no persisted due time");
    expect(auditLog.some((a) => a.startsWith("notify:dropped"))).toBe(true);
    expect(claims(s, "sp")).toHaveLength(0); // never claimed
    h.sqlite.close();
  });
});

// ---------------------------------------------------------------------------
// Push side (criteria 10-push, push-D-1, 14)
// ---------------------------------------------------------------------------

describe("push sweep reclassification + dispatch gates", () => {
  function pushSetup(h: DbHandle, spaceId: string, cap = 5): void {
    setPrefs(h.sqlite, spaceId, cap);
    new PushSubscriptionsRepo(h, spaceId).upsert({ endpoint: "https://push.example.com/dev", p256dh: "pk", auth: "au" });
  }
  const okSender = (calls: string[]) => async (target: { endpoint: string }) => {
    calls.push(target.endpoint);
  };

  it("criterion 10-push: a push reminder aged past freshness loses its exemption on sweep (ordinary claim, bit downgraded)", async () => {
    const h = createDb(":memory:");
    pushSetup(h, "sp");
    const remindAt = new Date(MIDDAY.getTime() - 2 * 3600_000).toISOString();
    const { id } = enqueuePendingPush(h.sqlite, {
      spaceId: "sp",
      meta: { tool: "fire_reminder", occurrenceId: `node:55:at:${remindAt}`, remindAt },
      payload: { title: "t", body: "b", url: "/" },
      isUrgent: true, // persisted bit claims urgency…
      deliverAfter: new Date(MIDDAY.getTime() - 60_000).toISOString(),
    });
    const calls: string[] = [];
    const stats = await sweepPendingPushes(h, { now: MIDDAY, config: CONFIG, sender: okSender(calls) });
    expect(stats.sent).toBe(1);
    expect(calls).toHaveLength(1);
    const row = getPushRow(h.sqlite, id)!;
    expect(row.isUrgent).toBe(0); // …downgraded at delivery time
    const claim = claims(h.sqlite, "sp").find((c) => c.delivery_key === row.pushKey)!;
    expect(claim.channel).toBe("push");
    expect(claim.cap_exempt).toBe(0); // ordinary slot consumed
    expect(claim.state).toBe("sent");
    h.sqlite.close();
  });

  it("criterion 10-push: a push reminder due 3.5 days ago is dropped from remind_at, however fresh the row", async () => {
    const h = createDb(":memory:");
    pushSetup(h, "sp");
    const remindAt = new Date(MIDDAY.getTime() - 3.5 * 24 * 3600_000).toISOString();
    const { id } = enqueuePendingPush(h.sqlite, {
      spaceId: "sp",
      meta: { tool: "fire_reminder", occurrenceId: `node:56:at:${remindAt}`, remindAt },
      payload: { title: "t", body: "b", url: "/" },
      isUrgent: false,
      deliverAfter: remindAt,
    });
    const calls: string[] = [];
    const stats = await sweepPendingPushes(h, { now: MIDDAY, config: CONFIG, sender: okSender(calls) });
    expect(stats.dropped).toBe(1);
    expect(calls).toHaveLength(0);
    expect(getPushRow(h.sqlite, id)!.status).toBe("dropped");
    h.sqlite.close();
  });

  it("push D-1 (symmetric fail-closed): a push fire_reminder with remind_at NULL is dropped as unverifiable", async () => {
    const h = createDb(":memory:");
    pushSetup(h, "sp");
    const { id } = enqueuePendingPush(h.sqlite, {
      spaceId: "sp",
      meta: { tool: "fire_reminder", occurrenceId: "node:57:at:legacy" }, // no remindAt
      payload: { title: "t", body: "b", url: "/" },
      isUrgent: true,
      deliverAfter: new Date(MIDDAY.getTime() - 60_000).toISOString(),
    });
    const calls: string[] = [];
    const stats = await sweepPendingPushes(h, { now: MIDDAY, config: CONFIG, sender: okSender(calls) });
    expect(stats.dropped).toBe(1);
    expect(calls).toHaveLength(0);
    const row = getPushRow(h.sqlite, id)!;
    expect(row.status).toBe("dropped");
    expect(row.lastError).toBe("unverifiable legacy reminder: no persisted due time");
    h.sqlite.close();
  });

  it("criterion 14: unconfigured VAPID creates zero push rows AND zero ledger claims; a push-only space drains via the push sweep", async () => {
    const h = createDb(":memory:");
    pushSetup(h, "sp");
    const calls: string[] = [];
    const sender = okSender(calls);
    const payload = { title: "t", body: "b", url: "/" };

    const none = await dispatchPush(
      h,
      "sp",
      payload,
      { tool: "fire_reminder", nodeId: 61, remindAt: new Date(MIDDAY.getTime() - 2 * 3600_000).toISOString() },
      { now: MIDDAY, config: null, sender }
    );
    expect(none.skipped).toBe(true);
    expect(calls).toHaveLength(0);
    expect(h.sqlite.prepare(`SELECT COUNT(*) AS n FROM push_outbox`).get()).toEqual({ n: 0 });
    expect(claims(h.sqlite, "sp")).toHaveLength(0);

    // Push-only drain (no Telegram anywhere in this test): a push deferred
    // by quiet hours is delivered by sweepPendingPushes alone.
    const QUIET = new Date("2026-10-21T06:00:00Z"); // 02:00 EDT
    const deferred = await dispatchPush(
      h,
      "sp",
      payload,
      { tool: "fire_reminder", nodeId: 62, remindAt: new Date(QUIET.getTime() - 2 * 3600_000).toISOString() },
      { now: QUIET, config: CONFIG, sender }
    );
    expect(deferred.deferred).toBe(true);
    expect(calls).toHaveLength(0);

    const swept = await sweepPendingPushes(h, { now: new Date("2026-10-21T09:00:00Z"), config: CONFIG, sender });
    expect(swept.sent).toBe(1);
    expect(calls).toHaveLength(1);
    h.sqlite.close();
  });
});
