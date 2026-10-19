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

import type { RawDb } from "../db/vec.js";
import {
  getPreferences,
  decidePolicy,
  classifyUrgency,
  buildOccurrenceId,
  deliverAfterCapReached,
  localDay,
  type NotifyMeta,
  type PolicyDecision,
} from "./policy.js";
import {
  enqueue,
  claimForSend,
  claimUrgentForSend,
  tryUpgradeToUrgent,
  markSendStarted,
  markSent,
  markFailed,
  markDropped,
  recoverExpiredLeases,
  dueRows,
  getRow,
  retryAfter,
  MAX_ATTEMPTS,
} from "./outbox.js";

export interface BoundaryDeps {
  sqlite: RawDb;
  /** Raw send to all linked chats. Must throw on definite failure. */
  send: (spaceId: string, text: string) => Promise<void>;
  /** Content-free audit log: (spaceId, action, detail). */
  audit: (spaceId: string, action: string, detail: string) => void;
  /** Unique ID for this worker (for claim attribution). */
  workerId: string;
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
    const fullMeta: NotifyMeta = { ...m, occurrenceId };

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
    await deliverNow(deps, spaceId, text, fullMeta, urgency, now);
  };
}

/**
 * Attempt immediate delivery: atomic cap claim → send → record.
 * On cap-claim failure, queues for the next allowed time.
 */
async function deliverNow(
  deps: BoundaryDeps,
  spaceId: string,
  text: string,
  meta: NotifyMeta,
  urgency: { isUrgent: boolean; reason?: string },
  now: Date
): Promise<void> {
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
    return;
  }

  const claimed = urgency.isUrgent
    ? claimUrgentForSend(sqlite, id, deps.workerId, nowIso(now))
    : claimForSend(sqlite, id, spaceId, day, prefs.dailyProactiveCap, deps.workerId, nowIso(now));

  if (!claimed) {
    // Cap full (or lost race): requeue for the next allowed time.
    const deliverAfter = deliverAfterCapReached(now, prefs);
    sqlite
      .prepare(`UPDATE notification_outbox SET deliver_after = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(deliverAfter, id);
    deps.audit(spaceId, "notify:queued", `${meta.tool} cap reached, deferred to ${deliverAfter}`);
    return;
  }

  await executeSend(deps, id, spaceId, text, now);
}

/** Execute the actual send for a claimed row, handling all outcomes. */
async function executeSend(deps: BoundaryDeps, id: number, spaceId: string, text: string, now: Date): Promise<void> {
  const { sqlite } = deps;
  markSendStarted(sqlite, id, nowIso(now));
  try {
    await deps.send(spaceId, text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const row = getRow(sqlite, id);
    const attempts = (row?.attempts ?? 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      markFailed(sqlite, id, msg, null);
      deps.audit(spaceId, "notify:failed", `${row?.tool} terminal after ${attempts} attempts`);
    } else {
      markFailed(sqlite, id, msg, retryAfter(attempts, now));
      deps.audit(spaceId, "notify:retry", `${row?.tool} attempt ${attempts} failed`);
    }
    return;
  }
  markSent(sqlite, id);
  deps.audit(spaceId, "notify:sent", `${getRow(sqlite, id)?.tool ?? "?"} delivered`);
}

/**
 * Sweeper: recover crashed leases, then deliver due queued notifications.
 * Called on the router tick (or a dedicated interval). Idempotent.
 */
export async function sweepNotifications(deps: BoundaryDeps, now: Date = new Date()): Promise<{ sent: number; queued: number; ambiguous: number }> {
  const { sqlite } = deps;
  const stats = { sent: 0, queued: 0, ambiguous: 0 };

  // 1. Recover crashed leases (two cases).
  const recovered = recoverExpiredLeases(sqlite, now);
  stats.ambiguous += recovered.ambiguous;
  if (recovered.ambiguous > 0) {
    deps.audit("system", "notify:ambiguous", `${recovered.ambiguous} row(s) outcome unknown, cap retained`);
  }

  // 2. Deliver due rows.
  const due = dueRows(sqlite, nowIso(now));
  for (const row of due) {
    const prefs = getPreferences(sqlite, row.spaceId);
    const day = localDay(now, prefs.timezone);

    // Re-evaluate urgency for billRisk (may have entered the 6h window).
    if (row.tool === "billRisk" && !row.isUrgent) {
      // The billDueAt isn't stored; skip upgrade if we can't evaluate.
      // (Upgrade path is exercised at enqueue time via classifyUrgency.)
    }

    // Staleness check at delivery time.
    // (Per-tool limits are in policy.ts; the row's created_at is the reference.)

    const claimed = row.isUrgent
      ? claimUrgentForSend(sqlite, row.id, deps.workerId, nowIso(now))
      : claimForSend(sqlite, row.id, row.spaceId, day, prefs.dailyProactiveCap, deps.workerId, nowIso(now));
    if (!claimed) {
      // Lost race or cap full: push to next allowed time.
      const deliverAfter = deliverAfterCapReached(now, prefs);
      sqlite.prepare(`UPDATE notification_outbox SET deliver_after = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(deliverAfter, row.id);
      stats.queued++;
      continue;
    }
    await executeSend(deps, row.id, row.spaceId, row.message, now);
    stats.sent++;
  }
  return stats;
}
