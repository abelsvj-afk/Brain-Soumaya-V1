/**
 * Web push policy deferral (Immersion Round 3 follow-up, owner decision
 * 2026-10-21): web push obeys the SAME Phase-2 notification policy as
 * Telegram — quiet hours and the daily proactive cap, from the same
 * per-space preferences (agent/notify/policy.ts).
 *
 * Design (minimal, stated):
 * - Push gets its OWN pending store (`push_outbox`) and lifecycle, modeled
 *   directly on notification_outbox: pending -> sending ->
 *   sent | failed | dropped | ambiguous, an atomic cap claim, and lease
 *   recovery where send_started_at distinguishes definite non-delivery
 *   (requeue) from an unknown outcome (ambiguous — terminal, cap slot
 *   retained, never auto-retried, so a deferred push is never delivered
 *   twice by recovery).
 * - The policy DECISIONS are shared, not forked: getPreferences /
 *   classifyUrgency / decidePolicy / deliverAfterCapReached are imported
 *   from the Phase-2 policy module unchanged. The Telegram boundary and
 *   outbox code are NOT modified — Telegram-configured brains behave
 *   exactly as before.
 * - Cap accounting is per-channel: the shared cap VALUE from preferences
 *   is enforced against push_outbox rows for push, just as the Telegram
 *   boundary enforces it against notification_outbox rows. Neither
 *   channel's deliveries consume the other's slots (a dual-channel
 *   reminder is one event per channel, not two), and push works with no
 *   Telegram token configured — the drain below runs on the router tick
 *   unconditionally.
 * - A policy-deferred push is stored and delivered when the policy
 *   allows — deferred, never dropped. (The policy's own "drop" outcome
 *   still applies: an event already stale at dispatch is not stored.)
 * - Unconfigured VAPID still means the feature does not exist: dispatch
 *   returns before any row is written — zero sends AND zero storage.
 */

import type { RawDb } from "../db/vec.js";
import type { DbHandle } from "../db/client.js";
import {
  getPreferences,
  classifyUrgency,
  decidePolicy,
  buildOccurrenceId,
  deliverAfterCapReached,
  localDay,
  stalenessLimitMs,
  notifKey,
  type NotifyMeta,
} from "../agent/notify/policy.js";
import { LEASE_MS, MAX_ATTEMPTS, retryAfter } from "../agent/notify/outbox.js";
import {
  getVapidConfig,
  sendPushToSpace,
  type PushPayload,
  type PushSender,
  type VapidConfig,
} from "./service.js";
import { PushSubscriptionsRepo } from "../repositories/pushSubscriptions.repo.js";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface PushOutboxRow {
  id: number;
  pushKey: string;
  spaceId: string;
  tool: string;
  occurrenceId: string;
  title: string;
  body: string;
  url: string;
  status: string;
  isUrgent: number;
  attempts: number;
  lastError: string | null;
  deliverAfter: string;
  capDay: string | null;
  sendStartedAt: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RawPushRow {
  id: number;
  push_key: string;
  space_id: string;
  tool: string;
  occurrence_id: string;
  title: string;
  body: string;
  url: string;
  status: string;
  is_urgent: number;
  attempts: number;
  last_error: string | null;
  deliver_after: string;
  cap_day: string | null;
  send_started_at: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(r: RawPushRow): PushOutboxRow {
  return {
    id: r.id,
    pushKey: r.push_key,
    spaceId: r.space_id,
    tool: r.tool,
    occurrenceId: r.occurrence_id,
    title: r.title,
    body: r.body,
    url: r.url,
    status: r.status,
    isUrgent: r.is_urgent,
    attempts: r.attempts,
    lastError: r.last_error,
    deliverAfter: r.deliver_after,
    capDay: r.cap_day,
    sendStartedAt: r.send_started_at,
    claimedBy: r.claimed_by,
    claimedAt: r.claimed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface EnqueuePushInput {
  spaceId: string;
  meta: NotifyMeta & { occurrenceId: string };
  payload: PushPayload;
  isUrgent: boolean;
  deliverAfter: string; // ISO UTC
}

/**
 * Store a push for later (or imminent) delivery. Idempotent: the same
 * logical occurrence (push_key = the Phase-2 notif_key derivation) is
 * never stored twice — a crash-retry of the firing path dedups here.
 */
export function enqueuePendingPush(sqlite: RawDb, input: EnqueuePushInput): { id: number; deduped: boolean } {
  const key = notifKey(input.spaceId, input.meta.tool, input.meta.occurrenceId);
  const existing = sqlite.prepare(`SELECT id FROM push_outbox WHERE push_key = ?`).get(key) as { id: number } | undefined;
  if (existing) return { id: existing.id, deduped: true };
  const r = sqlite
    .prepare(
      `INSERT INTO push_outbox
       (push_key, space_id, tool, occurrence_id, title, body, url, status, is_urgent, deliver_after)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    )
    .run(
      key,
      input.spaceId,
      input.meta.tool,
      input.meta.occurrenceId,
      input.payload.title,
      input.payload.body,
      input.payload.url ?? "/",
      input.isUrgent ? 1 : 0,
      input.deliverAfter
    );
  return { id: Number(r.lastInsertRowid), deduped: false };
}

/**
 * Atomically claim a pending row for sending AND reserve a cap slot for
 * the space-local day — the same claim shape as the Telegram outbox's
 * claimForSend, counted over push_outbox rows. One winner.
 */
export function claimPushForSend(
  sqlite: RawDb,
  id: number,
  spaceId: string,
  capDay: string,
  cap: number,
  workerId: string,
  nowIso: string
): boolean {
  const r = sqlite
    .prepare(
      `UPDATE push_outbox
       SET status = 'sending', cap_day = ?, claimed_by = ?, claimed_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'pending'
         AND (SELECT COUNT(*) FROM push_outbox
              WHERE space_id = ? AND cap_day = ? AND status IN ('sending', 'sent', 'ambiguous')) < ?`
    )
    .run(capDay, workerId, nowIso, id, spaceId, capDay, cap);
  return r.changes === 1;
}

/** Atomic claim for urgent rows: status flip only, no cap interaction. */
export function claimUrgentPushForSend(sqlite: RawDb, id: number, workerId: string, nowIso: string): boolean {
  const r = sqlite
    .prepare(
      `UPDATE push_outbox
       SET status = 'sending', claimed_by = ?, claimed_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'pending'`
    )
    .run(workerId, nowIso, id);
  return r.changes === 1;
}

/** Set immediately BEFORE the send fan-out. */
export function markPushSendStarted(sqlite: RawDb, id: number, nowIso: string): void {
  sqlite.prepare(`UPDATE push_outbox SET send_started_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(nowIso, id);
}

export function markPushSent(sqlite: RawDb, id: number): void {
  sqlite.prepare(`UPDATE push_outbox SET status = 'sent', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
}

/**
 * Definite failure. Releases the cap slot and either re-queues with
 * backoff (row returns to 'pending') or marks terminal 'failed'.
 */
export function markPushFailed(sqlite: RawDb, id: number, error: string, retryAfterIso: string | null): void {
  if (retryAfterIso) {
    sqlite
      .prepare(
        `UPDATE push_outbox
         SET status = 'pending', cap_day = NULL, send_started_at = NULL,
             attempts = attempts + 1, last_error = ?, deliver_after = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(error, retryAfterIso, id);
  } else {
    sqlite
      .prepare(
        `UPDATE push_outbox
         SET status = 'failed', cap_day = NULL, last_error = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(error, id);
  }
}

/** Nothing deliverable remains (stale, or every subscription is gone). Releases the cap slot. */
export function markPushDropped(sqlite: RawDb, id: number, reason: string): void {
  sqlite
    .prepare(
      `UPDATE push_outbox SET status = 'dropped', cap_day = NULL, last_error = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(reason, id);
}

/**
 * Ambiguous outcome (crashed after the send may have started): terminal,
 * cap slot RETAINED, never auto-retried — the same signed-off contract as
 * the Telegram outbox, so recovery can never produce a duplicate push.
 */
export function markPushAmbiguous(sqlite: RawDb, id: number): void {
  sqlite
    .prepare(
      `UPDATE push_outbox
       SET status = 'ambiguous', last_error = 'send outcome unknown after crash; not retried to avoid duplicate', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(id);
}

export interface PushRecoveryStats {
  requeued: number;
  ambiguous: number;
}

/** Recover rows stuck in 'sending' past the lease — mirrors recoverExpiredLeases. */
export function recoverPushLeases(sqlite: RawDb, now: Date): PushRecoveryStats {
  const cutoff = new Date(now.getTime() - LEASE_MS).toISOString();
  const stuck = sqlite
    .prepare(`SELECT id, send_started_at FROM push_outbox WHERE status = 'sending' AND claimed_at < ?`)
    .all(cutoff) as { id: number; send_started_at: string | null }[];
  let requeued = 0;
  let ambiguous = 0;
  for (const row of stuck) {
    if (row.send_started_at) {
      markPushAmbiguous(sqlite, row.id);
      ambiguous++;
    } else {
      sqlite
        .prepare(
          `UPDATE push_outbox
           SET status = 'pending', cap_day = NULL, claimed_by = NULL, claimed_at = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .run(row.id);
      requeued++;
    }
  }
  return { requeued, ambiguous };
}

/** Pending rows due for delivery, urgent first then oldest. */
export function duePushRows(sqlite: RawDb, nowIso: string, limit = 50): PushOutboxRow[] {
  const rows = sqlite
    .prepare(
      `SELECT * FROM push_outbox
       WHERE status = 'pending' AND deliver_after <= ?
       ORDER BY is_urgent DESC, deliver_after ASC LIMIT ?`
    )
    .all(nowIso, limit) as RawPushRow[];
  return rows.map(mapRow);
}

export function getPushRow(sqlite: RawDb, id: number): PushOutboxRow | undefined {
  const row = sqlite.prepare(`SELECT * FROM push_outbox WHERE id = ?`).get(id) as RawPushRow | undefined;
  return row ? mapRow(row) : undefined;
}

// ---------------------------------------------------------------------------
// Dispatch + sweep
// ---------------------------------------------------------------------------

export interface PushDeliveryOptions {
  /** Injectable clock (tests + the router tick's injected `now`). */
  now?: Date;
  /** Override VAPID resolution (tests). Undefined = read env per call. */
  config?: VapidConfig | null;
  /** Injectable transport, forwarded to sendPushToSpace (tests). */
  sender?: PushSender;
  workerId?: string;
}

export interface PushDispatchResult {
  /** True when VAPID is unconfigured or the space has no subscriptions — nothing attempted, nothing stored. */
  skipped: boolean;
  /** Subscriptions delivered immediately (0 when deferred). */
  sent: number;
  /** Stored (or re-queued) for delivery when the policy allows. */
  deferred: boolean;
  /** The same occurrence was already stored/sent — this dispatch changed nothing. */
  deduped: boolean;
  /** Policy drop reason (stale at dispatch), when the event is not stored at all. */
  dropped: string | null;
}

type SendOutcome = { outcome: "sent"; sentCount: number } | { outcome: "retry" | "dropped" };

/**
 * Execute the send for a CLAIMED row (claimed_by/at already set by the
 * claim). Shared by the immediate dispatch path and the sweeper so both
 * apply identical outcome handling.
 */
async function executePushSend(
  handle: DbHandle,
  row: PushOutboxRow,
  opts: { config: VapidConfig; sender?: PushSender; now: Date }
): Promise<SendOutcome> {
  const sqlite = handle.sqlite;
  markPushSendStarted(sqlite, row.id, opts.now.toISOString());
  let sentCount = 0;
  let failure: string | null = null;
  try {
    const res = await sendPushToSpace(
      handle,
      row.spaceId,
      { title: row.title, body: row.body, url: row.url },
      { config: opts.config, sender: opts.sender }
    );
    sentCount = res.sent;
    if (res.sent === 0) {
      if (res.failed > 0) {
        failure = `push send failed for ${res.failed} subscription(s)`;
      } else if (res.pruned > 0) {
        // Every endpoint was dead and got pruned — nothing can ever
        // receive this push. Terminal, like the outbox's dropped rows.
        markPushDropped(sqlite, row.id, "all subscriptions pruned as dead");
        return { outcome: "dropped" };
      } else {
        // No subscriptions remain (unsubscribed after enqueue).
        markPushDropped(sqlite, row.id, "no subscriptions remain");
        return { outcome: "dropped" };
      }
    }
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
  }
  if (failure !== null) {
    const attempts = row.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      markPushFailed(sqlite, row.id, failure, null);
    } else {
      markPushFailed(sqlite, row.id, failure, retryAfter(attempts, opts.now));
    }
    return { outcome: "retry" };
  }
  markPushSent(sqlite, row.id);
  return { outcome: "sent", sentCount };
}

/**
 * The policy-evaluating push entry point (the reminder tool calls this at
 * the real firing site). Mirrors the Telegram boundary's deliverNow:
 * decide -> (drop | store-for-later | claim-and-send-now, re-queueing to
 * the next allowed time when the cap claim fails). Never throws.
 */
export async function dispatchPush(
  handle: DbHandle,
  spaceId: string,
  payload: PushPayload,
  meta: NotifyMeta,
  opts: PushDeliveryOptions = {}
): Promise<PushDispatchResult> {
  const none: PushDispatchResult = { skipped: true, sent: 0, deferred: false, deduped: false, dropped: null };
  const config = opts.config !== undefined ? opts.config : getVapidConfig();
  if (!config) return none; // unconfigured: zero sends AND zero storage

  const repo = new PushSubscriptionsRepo(handle, spaceId);
  if (repo.listForSpace().length === 0) return none; // nobody to deliver to

  const sqlite = handle.sqlite;
  const now = opts.now ?? new Date();
  const workerId = opts.workerId ?? `push-${process.pid}`;
  const occurrenceId = buildOccurrenceId(sqlite, spaceId, meta, now);
  const fullMeta: NotifyMeta & { occurrenceId: string } = { ...meta, occurrenceId };
  const urgency = classifyUrgency(sqlite, spaceId, fullMeta, now);
  const decision = decidePolicy(sqlite, spaceId, fullMeta, urgency, now);

  if (decision.action === "drop") {
    return { ...none, skipped: false, dropped: decision.reason };
  }
  if (decision.action === "queue") {
    const { deduped } = enqueuePendingPush(sqlite, {
      spaceId,
      meta: fullMeta,
      payload,
      isUrgent: urgency.isUrgent,
      deliverAfter: decision.deliverAfter,
    });
    return { skipped: false, sent: 0, deferred: true, deduped, dropped: null };
  }

  // action === "send": store (idempotent), claim a cap slot, send now.
  const { id, deduped } = enqueuePendingPush(sqlite, {
    spaceId,
    meta: fullMeta,
    payload,
    isUrgent: urgency.isUrgent,
    deliverAfter: now.toISOString(),
  });
  if (deduped) {
    // The same occurrence is already pending/sent — a crash-retry of the
    // firing path. Exactly-once: do not send again here; a pending row
    // (if that is its state) is the sweeper's to deliver.
    const existing = getPushRow(sqlite, id);
    return { skipped: false, sent: 0, deferred: existing?.status === "pending", deduped: true, dropped: null };
  }

  const prefs = getPreferences(sqlite, spaceId);
  const day = localDay(now, prefs.timezone);
  const claimed = urgency.isUrgent
    ? claimUrgentPushForSend(sqlite, id, workerId, now.toISOString())
    : claimPushForSend(sqlite, id, spaceId, day, prefs.dailyProactiveCap, workerId, now.toISOString());
  if (!claimed) {
    const deliverAfter = deliverAfterCapReached(now, prefs);
    sqlite
      .prepare(`UPDATE push_outbox SET deliver_after = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(deliverAfter, id);
    return { skipped: false, sent: 0, deferred: true, deduped: false, dropped: null };
  }

  const row = getPushRow(sqlite, id);
  if (!row) return { ...none, skipped: false };
  const outcome = await executePushSend(handle, row, { config, sender: opts.sender, now });
  if (outcome.outcome === "sent") {
    return { skipped: false, sent: outcome.sentCount, deferred: false, deduped: false, dropped: null };
  }
  return { skipped: false, sent: 0, deferred: outcome.outcome === "retry", deduped: false, dropped: null };
}

export interface PushSweepStats {
  sent: number;
  deferred: number;
  dropped: number;
  ambiguous: number;
}

/**
 * Sweeper: recover crashed leases, then deliver due pending pushes under
 * the same policy (staleness re-check + atomic cap claim). Runs on the
 * router tick for every space — deliberately NOT gated on a Telegram
 * token, so push-only brains receive their deferred pushes. Idempotent;
 * a strict no-op when VAPID is unconfigured.
 */
export async function sweepPendingPushes(
  handle: DbHandle,
  opts: PushDeliveryOptions = {}
): Promise<PushSweepStats> {
  const stats: PushSweepStats = { sent: 0, deferred: 0, dropped: 0, ambiguous: 0 };
  const config = opts.config !== undefined ? opts.config : getVapidConfig();
  if (!config) return stats;

  const sqlite = handle.sqlite;
  const now = opts.now ?? new Date();
  const workerId = opts.workerId ?? `push-sweep-${process.pid}`;

  const recovered = recoverPushLeases(sqlite, now);
  stats.ambiguous += recovered.ambiguous;

  const due = duePushRows(sqlite, now.toISOString());
  for (const row of due) {
    // Staleness at delivery time — mirrors the boundary sweeper's
    // re-check for rows that waited a long time (e.g. through an outage).
    const limit = stalenessLimitMs(row.tool);
    if (limit !== null) {
      const age = now.getTime() - new Date(row.createdAt).getTime();
      if (age > limit) {
        markPushDropped(sqlite, row.id, `stale at delivery (${Math.round(age / 3600000)}h old)`);
        stats.dropped++;
        continue;
      }
    }

    const prefs = getPreferences(sqlite, row.spaceId);
    const day = localDay(now, prefs.timezone);
    const claimed =
      row.isUrgent === 1
        ? claimUrgentPushForSend(sqlite, row.id, workerId, now.toISOString())
        : claimPushForSend(sqlite, row.id, row.spaceId, day, prefs.dailyProactiveCap, workerId, now.toISOString());
    if (!claimed) {
      const deliverAfter = deliverAfterCapReached(now, prefs);
      sqlite
        .prepare(`UPDATE push_outbox SET deliver_after = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(deliverAfter, row.id);
      stats.deferred++;
      continue;
    }
    const fresh = getPushRow(sqlite, row.id);
    if (!fresh) continue;
    const outcome = await executePushSend(handle, fresh, { config, sender: opts.sender, now });
    if (outcome.outcome === "sent") stats.sent++;
    else if (outcome.outcome === "dropped") stats.dropped++;
    else stats.deferred++;
  }
  return stats;
}
