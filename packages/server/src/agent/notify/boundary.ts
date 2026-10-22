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
  markSent,
  markFailed,
  markDropped,
  recoverExpiredLeases,
  dueRows,
  getRow,
  retryAfter,
  MAX_ATTEMPTS,
  type OutboxRow,
} from "./outbox.js";

export interface BoundaryDeps {
  sqlite: RawDb;
  /** Raw send to all linked chats. Must throw on definite failure. */
  send: (spaceId: string, text: string) => Promise<void>;
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
  meta: NotifyMeta & { occurrenceId: string },
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
    ? claimUrgentForSend(sqlite, id, spaceId, day, deps.workerId, nowIso(now))
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
  // W2 §5.1: proactive message delivered — capture after delivery,
  // best-effort, never throws. `executeSend` is the single choke point for
  // both immediate and sweeper-deferred sends, so this covers every path.
  void Promise.resolve()
    .then(() =>
      captureEpisode(deps.handle, spaceId, {
        kind: "proactive_msg",
        summary: `Proactive message delivered via outbox (row ${id}, tool ${getRow(sqlite, id)?.tool ?? "?"})`,
      }),
    )
    .catch(() => {});
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
      continue;
    }

    // Staleness at delivery time. fire_reminder ages from remind_at inside
    // decidePolicy below (no created_at pre-check). billRisk WITH a
    // persisted due time ages explicitly from bill_due_at (decidePolicy's
    // staleness reads remindAt only). All other tools — and legacy
    // billRisk rows lacking bill_due_at — keep the created_at aging check.
    if (row.tool === "billRisk" && row.billDueAt) {
      const limit = stalenessLimitMs("billRisk");
      if (limit !== null) {
        const age = now.getTime() - new Date(row.billDueAt).getTime();
        if (age > limit) {
          markDropped(sqlite, row.id, `stale at delivery (${Math.round(age / 3600000)}h old)`);
          deps.audit(row.spaceId, "notify:dropped", `${row.tool} stale at delivery`);
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
          continue;
        }
      }
    }

    const urgency = classifyUrgency(sqlite, row.spaceId, meta, now);
    const decision = decidePolicy(sqlite, row.spaceId, meta, urgency, now);

    if (decision.action === "drop") {
      markDropped(sqlite, row.id, decision.reason);
      deps.audit(row.spaceId, "notify:dropped", `${row.tool} ${decision.reason}`);
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
    await executeSend(deps, row.id, row.spaceId, row.message, now);
    stats.sent++;
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
