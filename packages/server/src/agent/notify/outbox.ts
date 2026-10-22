/**
 * Phase 2: Notification outbox.
 *
 * Crash-safe deferred delivery for proactive notifications. Lifecycle:
 *   queued -> sending -> sent | failed | dropped | ambiguous
 *
 * Key safety properties (all signed off):
 * - notif_key UNIQUE: same logical notification never queued twice.
 * - Atomic claim: the shared cap-claim ledger (capClaims.ts) reserves the
 *   slot and flips the row to 'sending' in ONE transaction. One winner.
 * - Cap counting lives ONLY in the shared ledger (ADR-018 D1/A2):
 *   `notification_cap_claims` rows in reserved|sent|ambiguous with
 *   cap_exempt = 0, shared across Telegram + push. This outbox's `cap_day`
 *   column is inert legacy — never written by claim paths, never read for
 *   counting. Ambiguous outcomes retain their ledger slot (markAmbiguous).
 * - send_started_at distinguishes definite non-delivery (NULL on recovery)
 *   from ambiguous outcome (set on recovery) — see recoverExpiredLeases.
 * - ambiguous is terminal: cap retained, never auto-retried. Telegram has no
 *   idempotency key, so a retry after an ambiguous send risks a duplicate.
 */

import type { RawDb } from "../../db/vec.js";
import { notifKey, type NotifyMeta, type Urgency } from "./policy.js";
import { tryClaim, transitionClaim } from "./capClaims.js";

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
  /** ADR-018 B1: immutable original reminder due time (meta.remindAt at
   *  enqueue; NULL on pre-migration legacy rows). Retry reclassification
   *  reads this — never created_at, never occurrence_id. */
  remindAt: string | null;
  capDay: string | null;
  sendStartedAt: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Raw notification_outbox row as better-sqlite3 returns it (snake_case). */
interface RawOutboxRow {
  id: number;
  notif_key: string;
  space_id: string;
  tool: string;
  occurrence_id: string;
  message: string;
  priority: string;
  is_urgent: number;
  urgent_reason: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  deliver_after: string;
  bill_due_at: string | null;
  remind_at: string | null;
  cap_day: string | null;
  send_started_at: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Map a raw snake_case row to the camelCase OutboxRow contract. */
function mapRow(r: RawOutboxRow): OutboxRow {
  return {
    id: r.id,
    notifKey: r.notif_key,
    spaceId: r.space_id,
    tool: r.tool,
    occurrenceId: r.occurrence_id,
    message: r.message,
    priority: r.priority,
    isUrgent: r.is_urgent,
    urgentReason: r.urgent_reason,
    status: r.status,
    attempts: r.attempts,
    lastError: r.last_error,
    deliverAfter: r.deliver_after,
    billDueAt: r.bill_due_at,
    remindAt: r.remind_at ?? null,
    capDay: r.cap_day,
    sendStartedAt: r.send_started_at,
    claimedBy: r.claimed_by,
    claimedAt: r.claimed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
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
       (notif_key, space_id, tool, occurrence_id, message, priority, is_urgent, urgent_reason, status, deliver_after, bill_due_at, remind_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`
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
      input.meta.billDueAt ?? null,
      // ADR-018 B1: written once here; the dedup path above never updates it.
      input.meta.remindAt ?? null
    );
  return { id: Number(r.lastInsertRowid), deduped: false };
}

/**
 * Atomically claim a queued row for sending AND reserve a cap slot in the
 * shared ledger (ADR-018 D1/A2). Returns true iff this caller won both.
 * The ledger is the only counting authority: no cap subquery here and no
 * cap_day write (the column stays in place for legacy rows, inert).
 * `capDay` is the space-local day the claim counts against.
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
  const row = sqlite.prepare(`SELECT notif_key FROM notification_outbox WHERE id = ?`).get(id) as
    | { notif_key: string }
    | undefined;
  if (!row) return false;
  return tryClaim(
    sqlite,
    { spaceId, channel: "telegram", deliveryKey: row.notif_key, localDay: capDay, cap, capExempt: false },
    () => {
      const r = sqlite
        .prepare(
          `UPDATE notification_outbox
           SET status = 'sending', claimed_by = ?, claimed_at = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'queued'`
        )
        .run(workerId, nowIso, id);
      return r.changes === 1;
    }
  );
}

/**
 * Atomic claim for urgent rows: same ledger claim with capExempt — the
 * delivery is recorded (idempotency/audit) but consumes no cap slot and
 * is never blocked by the cap (ADR-018 Option A). Still exactly one
 * winner via the conditional status flip.
 */
export function claimUrgentForSend(
  sqlite: RawDb,
  id: number,
  spaceId: string,
  localDay: string,
  workerId: string,
  nowIso: string
): boolean {
  const row = sqlite.prepare(`SELECT notif_key FROM notification_outbox WHERE id = ?`).get(id) as
    | { notif_key: string }
    | undefined;
  if (!row) return false;
  return tryClaim(
    sqlite,
    { spaceId, channel: "telegram", deliveryKey: row.notif_key, localDay, cap: 0, capExempt: true },
    () => {
      const r = sqlite
        .prepare(
          `UPDATE notification_outbox
           SET status = 'sending', claimed_by = ?, claimed_at = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'queued'`
        )
        .run(workerId, nowIso, id);
      return r.changes === 1;
    }
  );
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

/**
 * Persist a delivery-time reclassification (ADR-018 A2b): BIDIRECTIONAL —
 * the sweep's downgrade AND upgrade path are this one mechanism. The
 * persisted bit is only an ordering hint for dueRows; authority is the
 * fresh classifyUrgency result the caller computed from the persisted
 * due-time columns. Only queued rows can be reclassified.
 */
export function setUrgency(sqlite: RawDb, id: number, isUrgent: boolean, reason: string | null): boolean {
  const r = sqlite
    .prepare(
      `UPDATE notification_outbox SET is_urgent = ?, urgent_reason = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'queued'`
    )
    .run(isUrgent ? 1 : 0, reason, id);
  return r.changes === 1;
}

/**
 * Transition this row's ledger claim inside the caller's transaction.
 * Legacy in-flight rows (no ledger claim) no-op silently (A2/Q1).
 */
function transitionClaimForRow(sqlite: RawDb, id: number, to: "sent" | "released" | "ambiguous"): void {
  const row = sqlite.prepare(`SELECT space_id, notif_key FROM notification_outbox WHERE id = ?`).get(id) as
    | { space_id: string; notif_key: string }
    | undefined;
  if (!row) return;
  transitionClaim(sqlite, { spaceId: row.space_id, channel: "telegram", deliveryKey: row.notif_key }, to);
}

/** Set immediately BEFORE the Telegram HTTP request. */
export function markSendStarted(sqlite: RawDb, id: number, nowIso: string): void {
  sqlite.prepare(`UPDATE notification_outbox SET send_started_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(nowIso, id);
}

/** Definite success: record immediately after the API returns. The ledger
 *  claim transitions reserved → sent in the SAME transaction (A2). */
export function markSent(sqlite: RawDb, id: number): void {
  sqlite.transaction(() => {
    sqlite.prepare(`UPDATE notification_outbox SET status = 'sent', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
    transitionClaimForRow(sqlite, id, "sent");
  })();
}

/**
 * Definite failure (API error). Releases the ledger slot (claim →
 * released, atomically with the outbox update) and either re-queues with
 * backoff or marks terminal 'failed' after MAX_ATTEMPTS.
 */
export function markFailed(sqlite: RawDb, id: number, error: string, retryAfterIso: string | null): void {
  sqlite.transaction(() => {
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
    transitionClaimForRow(sqlite, id, "released");
  })();
}

/** Stale or otherwise intentionally not delivered. Releases the ledger slot. */
export function markDropped(sqlite: RawDb, id: number, reason: string): void {
  sqlite.transaction(() => {
    sqlite
      .prepare(
        `UPDATE notification_outbox SET status = 'dropped', cap_day = NULL, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      )
      .run(reason, id);
    transitionClaimForRow(sqlite, id, "released");
  })();
}

/**
 * Ambiguous outcome: send may have succeeded. Terminal. Ledger slot
 * RETAINED (claim → ambiguous) — the daily cap contract takes precedence
 * over delivery completeness. Never auto-retried.
 */
export function markAmbiguous(sqlite: RawDb, id: number): void {
  sqlite.transaction(() => {
    sqlite
      .prepare(
        `UPDATE notification_outbox
         SET status = 'ambiguous', last_error = 'send outcome unknown after crash; not retried to avoid duplicate', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .run(id);
    transitionClaimForRow(sqlite, id, "ambiguous");
  })();
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
      // Pre-send crash: definite non-delivery — requeue and release the
      // ledger claim in ONE transaction (A2). Legacy rows without a claim
      // no-op in transitionClaimForRow (Q1).
      sqlite.transaction(() => {
        sqlite
          .prepare(
            `UPDATE notification_outbox
             SET status = 'queued', cap_day = NULL, claimed_by = NULL, claimed_at = NULL, updated_at = CURRENT_TIMESTAMP
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

/** Rows due for delivery, urgent first then oldest. */
export function dueRows(sqlite: RawDb, nowIso: string, limit = 20): OutboxRow[] {
  const rows = sqlite
    .prepare(
      `SELECT * FROM notification_outbox
       WHERE status = 'queued' AND deliver_after <= ?
       ORDER BY is_urgent DESC, deliver_after ASC LIMIT ?`
    )
    .all(nowIso, limit) as RawOutboxRow[];
  return rows.map(mapRow);
}

export function getRow(sqlite: RawDb, id: number): OutboxRow | undefined {
  const row = sqlite.prepare(`SELECT * FROM notification_outbox WHERE id = ?`).get(id) as RawOutboxRow | undefined;
  return row ? mapRow(row) : undefined;
}

/** Backoff for retries: 2^attempts minutes, capped at 60. */
export function retryAfter(attempts: number, now: Date): string {
  const minutes = Math.min(60, Math.pow(2, attempts));
  return new Date(now.getTime() + minutes * 60000).toISOString();
}
