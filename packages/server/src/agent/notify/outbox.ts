/**
 * Phase 2: Notification outbox.
 *
 * Crash-safe deferred delivery for proactive notifications. Lifecycle:
 *   queued -> sending -> sent | failed | dropped | ambiguous
 *
 * Key safety properties (all signed off):
 * - notif_key UNIQUE: same logical notification never queued twice.
 * - Atomic claim: UPDATE ... WHERE status='queued' AND cap-check. One winner.
 * - Cap derived from outbox rows (status IN ('sending','sent') with cap_day).
 *   No separate counter; crash recovery self-corrects.
 * - send_started_at distinguishes definite non-delivery (NULL on recovery)
 *   from ambiguous outcome (set on recovery) — see recoverExpiredLeases.
 * - ambiguous is terminal: cap retained, never auto-retried. Telegram has no
 *   idempotency key, so a retry after an ambiguous send risks a duplicate.
 */

import type { RawDb } from "../db/vec.js";
import { notifKey, type NotifyMeta, type Urgency } from "./policy.js";

/** Lease duration: a 'sending' row older than this is considered crashed. */
export const LEASE_MS = 5 * 60 * 1000;
/** Max send attempts before terminal 'failed'. */
export const MAX_ATTEMPTS = 3;

export interface OutboxRow {
  id: number;
  notifKey: string;
  spaceId: string;
  tool: string;
  occurrenceId: string;
  message: string;
  priority: string;
  isUrgent: number;
  urgentReason: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  deliverAfter: string;
  billDueAt: string | null;
  capDay: string | null;
  sendStartedAt: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnqueueInput {
  spaceId: string;
  /** occurrenceId must be set (use buildOccurrenceId). Prevents false dedup. */
  meta: NotifyMeta & { occurrenceId: string };
  message: string;
  urgency: Urgency;
  deliverAfter: string; // ISO UTC
  queueReason: string;
}

/**
 * Queue a notification. Idempotent: same notif_key → existing row kept,
 * returns { deduped: true }. Never throws for duplicates.
 */
export function enqueue(sqlite: RawDb, input: EnqueueInput): { id: number; deduped: boolean } {
  const key = notifKey(input.spaceId, input.meta.tool, input.meta.occurrenceId);
  const existing = sqlite.prepare(`SELECT id FROM notification_outbox WHERE notif_key = ?`).get(key) as { id: number } | undefined;
  if (existing) return { id: existing.id, deduped: true };
  const r = sqlite
    .prepare(
      `INSERT INTO notification_outbox
       (notif_key, space_id, tool, occurrence_id, message, priority, is_urgent, urgent_reason, status, deliver_after, bill_due_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`
    )
    .run(
      key,
      input.spaceId,
      input.meta.tool,
      input.meta.occurrenceId,
      input.message,
      "normal",
      input.urgency.isUrgent ? 1 : 0,
      input.urgency.reason ?? null,
      input.deliverAfter,
      input.meta.billDueAt ?? null
    );
  return { id: Number(r.lastInsertRowid), deduped: false };
}

/**
 * Atomically claim a queued row for sending AND reserve a cap slot.
 * Returns true iff this caller won both. Urgent rows bypass the cap
 * (cap_day stays NULL) but still need the atomic status claim.
 */
export function claimForSend(
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
      `UPDATE notification_outbox
       SET status = 'sending', cap_day = ?, claimed_by = ?, claimed_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'queued'
         AND (SELECT COUNT(*) FROM notification_outbox
              WHERE space_id = ? AND cap_day = ? AND status IN ('sending', 'sent')) < ?`
    )
    .run(capDay, workerId, nowIso, id, spaceId, capDay, cap);
  return r.changes === 1;
}

/** Atomic claim for urgent rows: status flip only, no cap interaction. */
export function claimUrgentForSend(sqlite: RawDb, id: number, workerId: string, nowIso: string): boolean {
  const r = sqlite
    .prepare(
      `UPDATE notification_outbox
       SET status = 'sending', claimed_by = ?, claimed_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'queued'`
    )
    .run(workerId, nowIso, id);
  return r.changes === 1;
}

/** Atomically upgrade a queued billRisk row to urgent. One winner. */
export function tryUpgradeToUrgent(sqlite: RawDb, id: number, reason: string): boolean {
  const r = sqlite
    .prepare(
      `UPDATE notification_outbox SET is_urgent = 1, urgent_reason = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND is_urgent = 0 AND status = 'queued'`
    )
    .run(reason, id);
  return r.changes === 1;
}

/** Set immediately BEFORE the Telegram HTTP request. */
export function markSendStarted(sqlite: RawDb, id: number, nowIso: string): void {
  sqlite.prepare(`UPDATE notification_outbox SET send_started_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(nowIso, id);
}

/** Definite success: record immediately after the API returns. */
export function markSent(sqlite: RawDb, id: number): void {
  sqlite.prepare(`UPDATE notification_outbox SET status = 'sent', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
}

/**
 * Definite failure (API error). Releases the cap slot (cap_day=NULL) and either
 * re-queues with backoff or marks terminal 'failed' after MAX_ATTEMPTS.
 */
export function markFailed(sqlite: RawDb, id: number, error: string, retryAfterIso: string | null): void {
  if (retryAfterIso) {
    sqlite
      .prepare(
        `UPDATE notification_outbox
         SET status = 'queued', cap_day = NULL, send_started_at = NULL,
             attempts = attempts + 1, last_error = ?, deliver_after = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(error, retryAfterIso, id);
  } else {
    sqlite
      .prepare(
        `UPDATE notification_outbox
         SET status = 'failed', cap_day = NULL, last_error = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(error, id);
  }
}

/** Stale or otherwise intentionally not delivered. Releases the cap slot. */
export function markDropped(sqlite: RawDb, id: number, reason: string): void {
  sqlite
    .prepare(
      `UPDATE notification_outbox SET status = 'dropped', cap_day = NULL, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    )
    .run(reason, id);
}

/**
 * Ambiguous outcome: send may have succeeded. Terminal. Cap slot RETAINED
 * (cap_day untouched) — the daily cap contract takes precedence over
 * delivery completeness. Never auto-retried.
 */
export function markAmbiguous(sqlite: RawDb, id: number): void {
  sqlite
    .prepare(
      `UPDATE notification_outbox
       SET status = 'ambiguous', last_error = 'send outcome unknown after crash; not retried to avoid duplicate', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(id);
}

export interface RecoveryStats {
  requeued: number;
  ambiguous: number;
}

/**
 * Recover rows stuck in 'sending' past the lease. Two distinct cases:
 * - send_started_at IS NULL: crashed before the request → definite
 *   non-delivery → back to 'queued', cap released.
 * - send_started_at IS NOT NULL: outcome unknown → 'ambiguous', cap retained.
 */
export function recoverExpiredLeases(sqlite: RawDb, now: Date): RecoveryStats {
  const cutoff = new Date(now.getTime() - LEASE_MS).toISOString();
  const stuck = sqlite
    .prepare(`SELECT id, send_started_at FROM notification_outbox WHERE status = 'sending' AND claimed_at < ?`)
    .all(cutoff) as { id: number; send_started_at: string | null }[];
  let requeued = 0;
  let ambiguous = 0;
  for (const row of stuck) {
    if (row.send_started_at) {
      markAmbiguous(sqlite, row.id);
      ambiguous++;
    } else {
      sqlite
        .prepare(
          `UPDATE notification_outbox
           SET status = 'queued', cap_day = NULL, claimed_by = NULL, claimed_at = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .run(row.id);
      requeued++;
    }
  }
  return { requeued, ambiguous };
}

/** Rows due for delivery, urgent first then oldest. */
export function dueRows(sqlite: RawDb, nowIso: string, limit = 20): OutboxRow[] {
  return sqlite
    .prepare(
      `SELECT * FROM notification_outbox
       WHERE status = 'queued' AND deliver_after <= ?
       ORDER BY is_urgent DESC, deliver_after ASC LIMIT ?`
    )
    .all(nowIso, limit) as OutboxRow[];
}

export function getRow(sqlite: RawDb, id: number): OutboxRow | undefined {
  return sqlite.prepare(`SELECT * FROM notification_outbox WHERE id = ?`).get(id) as OutboxRow | undefined;
}

/** Backoff for retries: 2^attempts minutes, capped at 60. */
export function retryAfter(attempts: number, now: Date): string {
  const minutes = Math.min(60, Math.pow(2, attempts));
  return new Date(now.getTime() + minutes * 60000).toISOString();
}
