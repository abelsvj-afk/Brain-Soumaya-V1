/**
 * Phase 2: The notification policy boundary.
 *
 * This is the SINGLE choke point for all proactive sends. index.ts wraps its
 * raw Telegram sender with `createPolicyNotify()`; every tool notification
 * flows through here. The sweeper (`sweepNotifications()`) delivers queued
 * items and recovers crashed leases.
 *
 * Audit: every decision is logged via the injected log function, content-free
 * (tool, occurrence_id, decision, reason — never message text).
 */

import type { RawDb } from "../../db/vec.js";
import type { DbHandle } from "../../db/client.js";
import { captureEpisode } from "../episodic.js"; // W2: proactive_msg capture (§5.1)
import {
  getPreferences,
  decidePolicy,
  classifyUrgency,
  buildOccurrenceId,
  deliverAfterCapReached,
  localDay,
  stalenessLimitMs,
  type NotifyMeta,
  type PolicyDecision,
} from "./policy.js";
import {
  enqueue,
  claimForSend,
  claimUrgentForSend,
  setUrgency,
  markSendStarted,
  markFailed,
  markDropped,
  markAmbiguous,
  recoverExpiredLeases,
  dueRows,
  getRow,
  retryAfter,
  applySendReport,
  pendingChatIds,
  deliveredChildCount,
  MAX_ATTEMPTS,
  type OutboxRow,
} from "./outbox.js";
import { AmbiguousSendError, NoRecipientsError } from "./sendErrors.js";
import type { TelegramSpaceSendReport } from "../../telegram/bot.js";

export interface BoundaryDeps {
  sqlite: RawDb;
  /**
   * Raw send to the space's linked chats. Outcome contract (H-2, REG-191):
   * returns a per-chat report — one entry per attempted chat — instead of
   * collapsing to a single throw. The boundary retries only the chats
   * still pending (see executeSend), so a chat that already accepted never
   * receives the same proactive message twice from one send.
   * - report entry "sent": Telegram accepted for that chat.
   * - "refused": a response refused that chat (definite, retryable).
   * - "ambiguous": no response for that chat (terminal for that chat,
   *   never retried — Batch A, now per-chat).
   * - "skipped": the chat unlinked between attempts (terminal, not a
   *   failure).
   * - `onlyChatIds` restricts the attempt set (a retry); omitted means
   *   all currently linked chats (first attempt).
   * - Throws ONLY NoRecipientsError: zero linked chats — recorded
   *   dropped, cap claim released, and re-thrown to the notify caller so
   *   a firing tool can defer instead of consuming its event.
   * - Any OTHER throw is unexpected (a bug, a DB error reading links):
   *   executeSend keeps today's definite-failure handling for it
   *   (re-queue / terminal via row attempts). No children exist in that
   *   path, so there is nothing to reconcile.
   */
  send: (spaceId: string, text: string, onlyChatIds?: number[]) => Promise<TelegramSpaceSendReport>;
  /** Content-free audit log: (spaceId, action, detail). */
  audit: (spaceId: string, action: string, detail: string) => void;
  /** Unique ID for this worker (for claim attribution). */
  workerId: string;
  /** W2: DbHandle for episode capture (captureEpisode takes a handle, not raw sqlite). */
  handle: DbHandle;
}

function nowIso(d: Date): string {
  return d.toISOString();
}

/**
 * Create the policy-wrapped notify function. Drop-in replacement for the raw
 * `(spaceId, text) => Promise<void>` closure in index.ts.
 */
export function createPolicyNotify(deps: BoundaryDeps) {
  const { sqlite } = deps;
  return async (spaceId: string, text: string, meta?: NotifyMeta): Promise<void> => {
    const now = new Date();
    // No meta (old call sites): treat as generic normal notification.
    // Occurrence ID is time-based so it won't dedup unrelated sends.
    const m: NotifyMeta = meta ?? { tool: "generic", occurrenceId: `at:${nowIso(now)}` };
    const occurrenceId = buildOccurrenceId(sqlite, spaceId, m, now);
    const fullMeta: NotifyMeta & { occurrenceId: string } = { ...m, occurrenceId };

    const urgency = classifyUrgency(sqlite, spaceId, fullMeta, now);
    const decision: PolicyDecision = decidePolicy(sqlite, spaceId, fullMeta, urgency, now);

    if (decision.action === "drop") {
      deps.audit(spaceId, "notify:dropped", `${fullMeta.tool} ${decision.reason}`);
      return;
    }
    if (decision.action === "queue") {
      const { deduped } = enqueue(sqlite, {
        spaceId,
        meta: fullMeta,
        message: text,
        urgency,
        deliverAfter: decision.deliverAfter,
        queueReason: decision.reason,
      });
      deps.audit(spaceId, deduped ? "notify:deduped" : "notify:queued", `${fullMeta.tool} ${decision.reason}`);
      return;
    }
    // action === "send": try immediate delivery with atomic cap claim.
    const outcome = await deliverNow(deps, spaceId, text, fullMeta, urgency, now);
    // Zero recipients: the drop is already recorded (claim released), but
    // the caller must not mistake this for acceptance — a firing tool
    // (reminder) defers its event instead of consuming it. Every other
    // outcome stays internal: sent/queued/failed-retry/ambiguous are all
    // states the outbox now owns.
    if (outcome === "no-recipients") {
      throw new NoRecipientsError("no linked chats for this space");
    }
  };
}

/** What executeSend concluded about one claimed row. */
type SendOutcome = "sent" | "retry" | "failed" | "ambiguous" | "no-recipients" | "partial-retry" | "partial" | "dropped";

/**
 * Attempt immediate delivery: atomic cap claim → send → record.
 * On cap-claim failure, queues for the next allowed time.
 */
async function deliverNow(
  deps: BoundaryDeps,
  spaceId: string,
  text: string,
  meta: NotifyMeta & { occurrenceId: string },
  urgency: { isUrgent: boolean; reason?: string },
  now: Date
): Promise<SendOutcome | "queued" | "deduped"> {
  const { sqlite } = deps;
  const prefs = getPreferences(sqlite, spaceId);
  const day = localDay(now, prefs.timezone);

  // Enqueue first to get a stable row, then claim it. The enqueue is idempotent.
  const { id, deduped } = enqueue(sqlite, {
    spaceId,
    meta,
    message: text,
    urgency,
    deliverAfter: nowIso(now),
    queueReason: "immediate",
  });
  // If deduped, another identical notification is already queued/sent; don't double-send.
  if (deduped) {
    deps.audit(spaceId, "notify:deduped", `${meta.tool} duplicate suppressed`);
    return "deduped";
  }

  const claimed = urgency.isUrgent
    ? claimUrgentForSend(sqlite, id, spaceId, day, deps.workerId, nowIso(now))
    : claimForSend(sqlite, id, spaceId, day, prefs.dailyProactiveCap, deps.workerId, nowIso(now));

  if (!claimed) {
    // Cap full (or lost race): requeue for the next allowed time.
    const deliverAfter = deliverAfterCapReached(now, prefs);
    sqlite
      .prepare(`UPDATE notification_outbox SET deliver_after = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(deliverAfter, id);
    deps.audit(spaceId, "notify:queued", `${meta.tool} cap reached, deferred to ${deliverAfter}`);
    return "queued";
  }

  return executeSend(deps, id, spaceId, text, now);
}

/**
 * Execute the actual send for a claimed row, handling all outcomes.
 *
 * H-2 (REG-191): the sender returns a per-chat report; the row is decided
 * from the child states (outbox.applySendReport, one transaction with the
 * parent transition). A partially-delivered row stays retryable until every
 * chat has a terminal outcome, and the retry attempts ONLY the chats still
 * pending — no chat ever receives the same proactive message twice from
 * one send. Terminality moved from row-attempts to "no pending children
 * remain"; row attempts is now just a counter (backoff input).
 */
async function executeSend(deps: BoundaryDeps, id: number, spaceId: string, text: string, now: Date): Promise<SendOutcome> {
  const { sqlite } = deps;
  markSendStarted(sqlite, id, nowIso(now));
  // W2 §5.1, exactly once: the delivered-child count BEFORE this attempt —
  // the episode fires at first delivery and never again for this row.
  const deliveredBefore = deliveredChildCount(sqlite, id);
  // Retry scoping: pending children only. Empty (first attempt, or a
  // legacy row) → unrestricted send to all currently linked chats.
  const pending = pendingChatIds(sqlite, id);
  let report: TelegramSpaceSendReport;
  try {
    report = await deps.send(spaceId, text, pending.length > 0 ? pending : undefined);
  } catch (err) {
    // No response came back: the outcome is genuinely unknown. Use the
    // outbox's existing ambiguous mechanism — terminal, cap retained,
    // never auto-retried (a retry could deliver a duplicate).
    if (err instanceof AmbiguousSendError) {
      markAmbiguous(sqlite, id);
      deps.audit(spaceId, "notify:ambiguous", `${getRow(sqlite, id)?.tool ?? "?"} send outcome unknown, cap retained`);
      return "ambiguous";
    }
    // Zero recipients: a known non-delivery. Drop the row and release the
    // cap claim — a send to nobody is never recorded as sent and never
    // keeps a slot. (The immediate path re-throws this to its caller.)
    if (err instanceof NoRecipientsError) {
      markDropped(sqlite, id, "no recipients: no linked chat for this space");
      deps.audit(spaceId, "notify:dropped", `${getRow(sqlite, id)?.tool ?? "?"} no recipients`);
      return "no-recipients";
    }
    // Unexpected sender throw (a bug, a DB error reading links — the
    // production sender never throws this): today's definite-failure
    // handling, re-queue / terminal via row attempts. No children exist
    // in this path, so there is nothing to reconcile.
    const msg = err instanceof Error ? err.message : String(err);
    const row = getRow(sqlite, id);
    const attempts = (row?.attempts ?? 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      markFailed(sqlite, id, msg, null);
      deps.audit(spaceId, "notify:failed", `${row?.tool} terminal after ${attempts} attempts`);
      return "failed";
    }
    markFailed(sqlite, id, msg, retryAfter(attempts, now));
    deps.audit(spaceId, "notify:retry", `${row?.tool} attempt ${attempts} failed`);
    return "retry";
  }
  const result = applySendReport(sqlite, id, report.attempted, now);
  const tool = getRow(sqlite, id)?.tool ?? "?";
  // Per-attempt audit: outcome classes + refusal statuses, never message text.
  const refusedDetail = report.attempted
    .filter((a) => a.outcome === "refused")
    .map((a) => `chat ${a.chatId}: ${a.error ?? "refused"}`)
    .join("; ");
  const summary =
    `row ${id}: ${result.sentCount} sent, ${result.failedCount} failed, ` +
    `${result.ambiguousCount} ambiguous, ${result.skippedCount} skipped, ${result.pendingCount} pending` +
    (refusedDetail ? ` (${refusedDetail})` : "");
  if (result.outcome === "sent") {
    deps.audit(spaceId, "notify:sent", `${tool} delivered (${summary})`);
  } else if (result.outcome === "partial-retry") {
    deps.audit(spaceId, "notify:partial-retry", `${tool} partially delivered, retrying pending chats (${summary})`);
  } else if (result.outcome === "partial") {
    deps.audit(spaceId, "notify:partial", `${tool} partially delivered, terminal (${summary})`);
  } else if (result.outcome === "ambiguous") {
    deps.audit(spaceId, "notify:ambiguous", `${tool} send outcome unknown for some chats, cap retained (${summary})`);
  } else if (result.outcome === "failed") {
    deps.audit(spaceId, "notify:failed", `${tool} terminal, no chat accepted (${summary})`);
  } else {
    deps.audit(spaceId, "notify:dropped", `${tool} all recipients unlinked (${summary})`);
  }
  // W2 §5.1: proactive message delivered — capture at FIRST delivery,
  // best-effort, never throws. `executeSend` is the single choke point for
  // both immediate and sweeper-deferred sends, so this covers every path.
  if (deliveredBefore === 0 && result.deliveredCount >= 1) {
    void Promise.resolve()
      .then(() =>
        captureEpisode(deps.handle, spaceId, {
          kind: "proactive_msg",
          summary: `Proactive message delivered via outbox (row ${id}, tool ${tool})`,
        }),
      )
      .catch(() => {});
  }
  return result.outcome;
}

/**
 * What one sweepNotifications() run concluded about each row it touched.
 * H-3 (REG-192): every outcome gets its own bucket — a retry or a terminal
 * failure is never counted as sent, and drops are counted too (previously
 * the sweep only reported {sent, queued, ambiguous}, so failed/retried
 * sends inflated `sent` and dropped rows vanished from the log entirely).
 */
export interface NotifySweepStats {
  /** Rows delivered on this sweep. */
  sent: number;
  /** Rows held for a later sweep (quiet hours, cap full). */
  queued: number;
  /** Rows whose send outcome is unknown (terminal, cap retained). */
  ambiguous: number;
  /** Definite failures re-queued with backoff (attempts < MAX_ATTEMPTS). */
  retried: number;
  /** Definite failures that reached the terminal state (attempts >= MAX_ATTEMPTS). */
  failed: number;
  /** Rows dropped without sending (stale, unverifiable, policy drop, no recipients). */
  dropped: number;
}

/**
 * Sweeper: recover crashed leases, then deliver due queued notifications.
 * Called on the router tick (or a dedicated interval). Idempotent.
 */
export async function sweepNotifications(deps: BoundaryDeps, now: Date = new Date()): Promise<NotifySweepStats> {
  const { sqlite } = deps;
  const stats: NotifySweepStats = { sent: 0, queued: 0, ambiguous: 0, retried: 0, failed: 0, dropped: 0 };

  // 1. Recover crashed leases (two cases).
  const recovered = recoverExpiredLeases(sqlite, now);
  stats.ambiguous += recovered.ambiguous;
  if (recovered.ambiguous > 0) {
    deps.audit("system", "notify:ambiguous", `${recovered.ambiguous} row(s) outcome unknown, cap retained`);
  }

  // 2. Deliver due rows. ADR-018 A2b: EVERY attempt fully reclassifies
  // from the persisted immutable due-time columns (remind_at / bill_due_at)
  // — never from created_at, deliver_after, or the persisted is_urgent bit
  // (an ordering hint only). Reclassification runs in both directions: a
  // row whose freshness window expired is downgraded and loses both the
  // quiet-hours and cap exemptions; quiet hours and the global cap are
  // re-evaluated at delivery time via decidePolicy.
  const due = dueRows(sqlite, nowIso(now));
  for (const row of due) {
    const prefs = getPreferences(sqlite, row.spaceId);
    const day = localDay(now, prefs.timezone);
    const meta = metaFromRow(row);

    // D-1 (verbatim contract): a legacy fire_reminder with no persisted
    // due time is unverifiable — drop it, never send it. created_at,
    // occurrence_id, and the persisted urgency flag are all forbidden as
    // freshness sources.
    if (row.tool === "fire_reminder" && row.remindAt === null) {
      markDropped(sqlite, row.id, "unverifiable legacy reminder: no persisted due time");
      deps.audit(row.spaceId, "notify:dropped", `${row.tool} unverifiable legacy reminder`);
      stats.dropped++;
      continue;
    }

    // Staleness at delivery time. fire_reminder ages from remind_at inside
    // decidePolicy below (no created_at pre-check). billRisk WITH a
    // persisted due time ages explicitly from bill_due_at (decidePolicy's
    // staleness reads remindAt only). All other tools — and legacy
    // billRisk rows lacking bill_due_at — keep the created_at aging check.
    // REG-027: that check measures from EVENT time for these producers —
    // their event IS the detection moment, so enqueue time (created_at) is
    // the event time; there is no earlier event time to measure from. The
    // two producers whose event time differs materially from enqueue time
    // (fire_reminder's remind_at, billRisk's bill_due_at) age from those
    // persisted event times instead, never from created_at.
    if (row.tool === "billRisk" && row.billDueAt) {
      const limit = stalenessLimitMs("billRisk");
      if (limit !== null) {
        const age = now.getTime() - new Date(row.billDueAt).getTime();
        if (age > limit) {
          markDropped(sqlite, row.id, `stale at delivery (${Math.round(age / 3600000)}h old)`);
          deps.audit(row.spaceId, "notify:dropped", `${row.tool} stale at delivery`);
          stats.dropped++;
          continue;
        }
      }
    } else if (row.tool !== "fire_reminder") {
      const limit = stalenessLimitMs(row.tool);
      if (limit !== null) {
        const age = now.getTime() - new Date(row.createdAt).getTime();
        if (age > limit) {
          markDropped(sqlite, row.id, `stale at delivery (${Math.round(age / 3600000)}h old)`);
          deps.audit(row.spaceId, "notify:dropped", `${row.tool} stale at delivery`);
          stats.dropped++;
          continue;
        }
      }
    }

    const urgency = classifyUrgency(sqlite, row.spaceId, meta, now);
    const decision = decidePolicy(sqlite, row.spaceId, meta, urgency, now);

    if (decision.action === "drop") {
      markDropped(sqlite, row.id, decision.reason);
      deps.audit(row.spaceId, "notify:dropped", `${row.tool} ${decision.reason}`);
      stats.dropped++;
      continue;
    }
    if (decision.action === "queue") {
      // Quiet hours re-deferral at delivery time (A2b): a row that lost its
      // urgency exemption while waiting is held until quiet hours end.
      sqlite
        .prepare(`UPDATE notification_outbox SET deliver_after = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(decision.deliverAfter, row.id);
      stats.queued++;
      continue;
    }

    // action === "send": persist the reclassification if it changed (one
    // mechanism, both directions), then claim through the shared ledger.
    if (urgency.isUrgent !== (row.isUrgent === 1)) {
      setUrgency(sqlite, row.id, urgency.isUrgent, urgency.reason ?? null);
      deps.audit(
        row.spaceId,
        "notify:reclassified",
        `${row.tool} ${urgency.isUrgent ? "ordinary->urgent" : "urgent->ordinary"}`
      );
    }

    const claimed = urgency.isUrgent
      ? claimUrgentForSend(sqlite, row.id, row.spaceId, day, deps.workerId, nowIso(now))
      : claimForSend(sqlite, row.id, row.spaceId, day, prefs.dailyProactiveCap, deps.workerId, nowIso(now));
    if (!claimed) {
      // Lost race or cap full: defer, never drop (D1).
      const deliverAfter = deliverAfterCapReached(now, prefs);
      sqlite.prepare(`UPDATE notification_outbox SET deliver_after = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(deliverAfter, row.id);
      stats.queued++;
      continue;
    }
    const outcome = await executeSend(deps, row.id, row.spaceId, row.message, now);
    // H-3 (REG-192): count each outcome in its own bucket. The old code
    // was `if (ambiguous) ambiguous++; else sent++;` — every retry and
    // terminal failure inflated `sent`.
    // H-2 (REG-191): a "partial-retry" row IS queued (truthful — it will
    // be re-attempted for its pending chats only). A terminal "partial"
    // counts as sent (a delivery occurred) — the stats object still has
    // no `partial` bucket, so this overstates full delivery; REG-192/H-3
    // owns the buckets.
    if (outcome === "ambiguous") stats.ambiguous++;
    else if (outcome === "sent") stats.sent++;
    else if (outcome === "retry") stats.retried++;
    else if (outcome === "failed") stats.failed++;
    else if (outcome === "partial-retry") stats.queued++;
    else if (outcome === "partial") stats.sent++;
    else stats.dropped++; // "no-recipients" or "dropped": executeSend marked the row dropped
  }
  return stats;
}

/**
 * Rebuild the classification meta from a persisted outbox row (ADR-018
 * A2b). Timing comes ONLY from the persisted due-time columns. The billId
 * parsed out of occurrence_id ('bill:<id>:…') is IDENTITY ONLY — it feeds
 * classifyUrgency's per-bill dedup query; occurrence_id is never parsed
 * for timing.
 */
function metaFromRow(row: OutboxRow): NotifyMeta {
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
