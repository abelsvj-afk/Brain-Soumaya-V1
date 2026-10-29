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
 *   from the Phase-2 policy module unchanged.
 * - Cap accounting is GLOBAL (ADR-018 D1, superseding the original
 *   per-channel design): the shared cap VALUE from preferences is one
 *   allowance across BOTH channels, counted only in the shared
 *   `notification_cap_claims` ledger (agent/notify/capClaims.ts) — a
 *   slot is reserved atomically with the outbox claim, retained after
 *   confirmed or ambiguous delivery, and released on definite failure.
 *   Neither this file's rows nor the Telegram outbox's rows count the cap
 *   themselves (the `cap_day` columns are inert legacy). A dual-channel
 *   event delivered to both channels consumes two slots — one per actual
 *   channel delivery. Push works with no Telegram token configured —
 *   the drain below runs on the router tick unconditionally.
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
import { tryClaim, transitionClaim } from "../agent/notify/capClaims.js";
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
  /** ADR-018 A2b: immutable original due times (NotifyMeta at enqueue;
   *  NULL on pre-migration legacy rows). Retry reclassification reads
   *  these — never created_at, never occurrence_id. */
  remindAt: string | null;
  billDueAt: string | null;
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
  remind_at: string | null;
  bill_due_at: string | null;
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
    remindAt: r.remind_at ?? null,
    billDueAt: r.bill_due_at ?? null,
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
       (push_key, space_id, tool, occurrence_id, title, body, url, status, is_urgent, deliver_after, remind_at, bill_due_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
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
      input.deliverAfter,
      // ADR-018 A2b: first enqueue only — the dedup path above preserves
      // the originals; retries never rewrite the due-time columns.
      input.meta.remindAt ?? null,
      input.meta.billDueAt ?? null
    );
  return { id: Number(r.lastInsertRowid), deduped: false };
}

/**
 * Atomically claim a pending row for sending AND reserve a cap slot for
 * the space-local day in the shared ledger (ADR-018 D1/A2) — the same
 * claim shape as the Telegram outbox's claimForSend, counted over
 * `notification_cap_claims` for BOTH channels. One winner. No cap
 * subquery over push_outbox and no cap_day write: the ledger is the only
 * counting authority.
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
  const row = sqlite.prepare(`SELECT push_key FROM push_outbox WHERE id = ?`).get(id) as
    | { push_key: string }
    | undefined;
  if (!row) return false;
  return tryClaim(
    sqlite,
    { spaceId, channel: "push", deliveryKey: row.push_key, localDay: capDay, cap, capExempt: false },
    () => {
      const r = sqlite
        .prepare(
          `UPDATE push_outbox
           SET status = 'sending', claimed_by = ?, claimed_at = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'pending'`
        )
        .run(workerId, nowIso, id);
      return r.changes === 1;
    }
  );
}

/**
 * Atomic claim for urgent rows: ledger claim with capExempt — recorded
 * for idempotency/audit, consumes no slot, never blocked by the cap
 * (ADR-018 Option A). Still exactly one winner via the status flip.
 */
export function claimUrgentPushForSend(
  sqlite: RawDb,
  id: number,
  spaceId: string,
  localDay: string,
  workerId: string,
  nowIso: string
): boolean {
  const row = sqlite.prepare(`SELECT push_key FROM push_outbox WHERE id = ?`).get(id) as
    | { push_key: string }
    | undefined;
  if (!row) return false;
  return tryClaim(
    sqlite,
    { spaceId, channel: "push", deliveryKey: row.push_key, localDay, cap: 0, capExempt: true },
    () => {
      const r = sqlite
        .prepare(
          `UPDATE push_outbox
           SET status = 'sending', claimed_by = ?, claimed_at = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'pending'`
        )
        .run(workerId, nowIso, id);
      return r.changes === 1;
    }
  );
}

/**
 * Persist a delivery-time reclassification (ADR-018 A2b) — the push
 * mirror of the Telegram outbox's setUrgency. Bidirectional; the bit is
 * an ordering hint only, never authority. Pending rows only. (push_outbox
 * carries no urgent_reason column.)
 */
export function setPushUrgency(sqlite: RawDb, id: number, isUrgent: boolean): boolean {
  const r = sqlite
    .prepare(
      `UPDATE push_outbox SET is_urgent = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'pending'`
    )
    .run(isUrgent ? 1 : 0, id);
  return r.changes === 1;
}

/**
 * Transition this row's ledger claim inside the caller's transaction.
 * Legacy in-flight rows (no ledger claim) no-op silently (A2/Q1).
 */
function transitionClaimForRow(sqlite: RawDb, id: number, to: "sent" | "released" | "ambiguous"): void {
  const row = sqlite.prepare(`SELECT space_id, push_key FROM push_outbox WHERE id = ?`).get(id) as
    | { space_id: string; push_key: string }
    | undefined;
  if (!row) return;
  transitionClaim(sqlite, { spaceId: row.space_id, channel: "push", deliveryKey: row.push_key }, to);
}

/** Set immediately BEFORE the send fan-out. */
export function markPushSendStarted(sqlite: RawDb, id: number, nowIso: string): void {
  sqlite.prepare(`UPDATE push_outbox SET send_started_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(nowIso, id);
}

export function markPushSent(sqlite: RawDb, id: number): void {
  sqlite.transaction(() => {
    sqlite.prepare(`UPDATE push_outbox SET status = 'sent', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
    transitionClaimForRow(sqlite, id, "sent");
  })();
}

/**
 * Partial delivery (REG-029): at least one subscription accepted the push
 * but at least one definitively failed. Recorded as its own terminal state
 * — never indistinguishable from full delivery — with the counts in
 * last_error. The cap claim transitions to 'sent': the occurrence WAS
 * delivered (to some devices) and consumed its slot. NOT re-queued: a
 * retry of the whole row would re-deliver to the subscriptions that
 * already accepted it (the duplicate-delivery harm); a retry scoped to
 * only the failed subscriptions would need per-subscription outcome
 * tracking, which this store does not have — so the honest record is the
 * fix, and the failed devices simply miss this occurrence.
 */
export function markPushPartial(sqlite: RawDb, id: number, sent: number, failed: number): void {
  sqlite.transaction(() => {
    sqlite
      .prepare(
        `UPDATE push_outbox SET status = 'partial', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .run(`push delivered to ${sent} subscription(s); ${failed} failed`, id);
    transitionClaimForRow(sqlite, id, "sent");
  })();
}

/**
 * Definite failure. Releases the ledger slot (claim → released,
 * atomically with the outbox update) and either re-queues with backoff
 * (row returns to 'pending') or marks terminal 'failed'.
 */
export function markPushFailed(sqlite: RawDb, id: number, error: string, retryAfterIso: string | null): void {
  sqlite.transaction(() => {
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
    transitionClaimForRow(sqlite, id, "released");
  })();
}

/** Nothing deliverable remains (stale, or every subscription is gone). Releases the ledger slot. */
export function markPushDropped(sqlite: RawDb, id: number, reason: string): void {
  sqlite.transaction(() => {
    sqlite
      .prepare(
        `UPDATE push_outbox SET status = 'dropped', cap_day = NULL, last_error = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(reason, id);
    transitionClaimForRow(sqlite, id, "released");
  })();
}

/**
 * Ambiguous outcome (crashed after the send may have started): terminal,
 * ledger slot RETAINED (claim → ambiguous), never auto-retried — the
 * same signed-off contract as the Telegram outbox, so recovery can never
 * produce a duplicate push.
 */
export function markPushAmbiguous(sqlite: RawDb, id: number): void {
  sqlite.transaction(() => {
    sqlite
      .prepare(
        `UPDATE push_outbox
         SET status = 'ambiguous', last_error = 'send outcome unknown after crash; not retried to avoid duplicate', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(id);
    transitionClaimForRow(sqlite, id, "ambiguous");
  })();
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
      // Pre-send crash: requeue and release the ledger claim in ONE
      // transaction (A2). Legacy rows without a claim no-op (Q1).
      sqlite.transaction(() => {
        sqlite
          .prepare(
            `UPDATE push_outbox
             SET status = 'pending', cap_day = NULL, claimed_by = NULL, claimed_at = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`
          )
          .run(row.id);
        transitionClaimForRow(sqlite, row.id, "released");
      })();
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

type SendOutcome =
  | { outcome: "sent"; sentCount: number }
  | { outcome: "retry" | "dropped" }
  // H-3 (REG-192): a terminal failure is its own outcome — the old code
  // returned "retry" for it too, so the sweep counted a push that will
  // never be delivered as deferred.
  | { outcome: "failed" };

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
    } else if (res.failed > 0) {
      // REG-029: partial delivery — some subscriptions accepted, some
      // definitively failed. Record it as partial (never as full success);
      // the outcome is still "sent" for the caller's counts, since the
      // occurrence did reach devices.
      markPushPartial(sqlite, row.id, res.sent, res.failed);
      return { outcome: "sent", sentCount };
    }
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
  }
  if (failure !== null) {
    const attempts = row.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      markPushFailed(sqlite, row.id, failure, null);
      return { outcome: "failed" };
    }
    markPushFailed(sqlite, row.id, failure, retryAfter(attempts, opts.now));
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
    ? claimUrgentPushForSend(sqlite, id, spaceId, day, workerId, now.toISOString())
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
  /** H-3 (REG-192): pushes that reached the terminal failure state — never deferred, never delivered. */
  failed: number;
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
  const stats: PushSweepStats = { sent: 0, deferred: 0, dropped: 0, ambiguous: 0, failed: 0 };
  const config = opts.config !== undefined ? opts.config : getVapidConfig();
  if (!config) return stats;

  const sqlite = handle.sqlite;
  const now = opts.now ?? new Date();
  const workerId = opts.workerId ?? `push-sweep-${process.pid}`;

  const recovered = recoverPushLeases(sqlite, now);
  stats.ambiguous += recovered.ambiguous;

  const due = duePushRows(sqlite, now.toISOString());
  for (const row of due) {
    // ADR-018 A2b: full reclassification from the persisted due-time
    // columns on every attempt — the persisted is_urgent bit is never
    // authority. Mirrors the Telegram boundary sweep.
    const meta = metaFromPushRow(row);

    // Push legacy reminder rule (symmetric fail-closed with Telegram
    // D-1): a fire_reminder row with remind_at NULL has no verifiable
    // due time — drop it as unverifiable, never send it.
    if (row.tool === "fire_reminder" && row.remindAt === null) {
      markPushDropped(sqlite, row.id, "unverifiable legacy reminder: no persisted due time");
      stats.dropped++;
      continue;
    }

    // Staleness at delivery time: fire_reminder ages from remind_at
    // inside decidePolicy; billRisk WITH bill_due_at ages explicitly
    // from it; everything else (and legacy billRisk without it) keeps
    // the created_at aging check.
    if (row.tool === "billRisk" && row.billDueAt) {
      const limit = stalenessLimitMs("billRisk");
      if (limit !== null) {
        const age = now.getTime() - new Date(row.billDueAt).getTime();
        if (age > limit) {
          markPushDropped(sqlite, row.id, `stale at delivery (${Math.round(age / 3600000)}h old)`);
          stats.dropped++;
          continue;
        }
      }
    } else if (row.tool !== "fire_reminder") {
      const limit = stalenessLimitMs(row.tool);
      if (limit !== null) {
        const age = now.getTime() - new Date(row.createdAt).getTime();
        if (age > limit) {
          markPushDropped(sqlite, row.id, `stale at delivery (${Math.round(age / 3600000)}h old)`);
          stats.dropped++;
          continue;
        }
      }
    }

    const prefs = getPreferences(sqlite, row.spaceId);
    const day = localDay(now, prefs.timezone);
    const urgency = classifyUrgency(sqlite, row.spaceId, meta, now);
    const decision = decidePolicy(sqlite, row.spaceId, meta, urgency, now);

    if (decision.action === "drop") {
      markPushDropped(sqlite, row.id, decision.reason);
      stats.dropped++;
      continue;
    }
    if (decision.action === "queue") {
      // Quiet-hours re-deferral at delivery time (A2b).
      sqlite
        .prepare(`UPDATE push_outbox SET deliver_after = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(decision.deliverAfter, row.id);
      stats.deferred++;
      continue;
    }

    if (urgency.isUrgent !== (row.isUrgent === 1)) {
      setPushUrgency(sqlite, row.id, urgency.isUrgent);
    }

    const claimed = urgency.isUrgent
      ? claimUrgentPushForSend(sqlite, row.id, row.spaceId, day, workerId, now.toISOString())
      : claimPushForSend(sqlite, row.id, row.spaceId, day, prefs.dailyProactiveCap, workerId, now.toISOString());
    if (!claimed) {
      // Cap full or lost race: defer, never drop (D1).
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
    else if (outcome.outcome === "failed") stats.failed++;
    else stats.deferred++;
  }
  return stats;
}

/**
 * Rebuild classification meta from a persisted push row (ADR-018 A2b) —
 * the push mirror of the boundary's metaFromRow. Timing comes ONLY from
 * the persisted due-time columns; the billId from occurrence_id
 * ('bill:<id>:…') is IDENTITY ONLY for the per-bill dedup query.
 */
function metaFromPushRow(row: PushOutboxRow): NotifyMeta {
  let billId: number | undefined;
  if (row.tool === "billRisk") {
    const parts = row.occurrenceId.split(":");
    if (parts[0] === "bill" && parts[1]) {
      const n = Number(parts[1]);
      if (Number.isInteger(n)) billId = n;
    }
  }
  return {
    tool: row.tool,
    occurrenceId: row.occurrenceId,
    remindAt: row.remindAt ?? undefined,
    billDueAt: row.billDueAt ?? undefined,
    billId,
  };
}
