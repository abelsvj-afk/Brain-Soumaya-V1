import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import { buildCommunicationContext, recentActionCount } from "../../communication/context.js";
import { sendPushToSpace } from "../../push/service.js";

/**
 * Firing reminders — the first tool Soumaya calls on her own. `remind_at` used to be
 * stored and only shown passively; now she DELIVERS it at the time (Telegram if
 * linked, always logged), exactly once. Deterministic, free, offline.
 *
 * Phase U (docs/specs/soumaya-proactive-communication-migration-wave2.md) — detect()'s
 * once-only firing/GRACE_MS retirement logic below is COMPLETELY UNCHANGED. Previously
 * `overdueMs` was computed only to decide silent-retirement, then discarded before the
 * message was built — the message read identically whether a reminder fired a minute
 * late or three days late. `run()` now folds that same already-computed `overdueMs`
 * into the wording (restoring intelligence that was being computed and thrown away, not
 * adding new detection), plus the shared CommunicationContext's verbosity preference and
 * a repetition signal (has more than one reminder already fired today). Zero new LLM
 * calls; the true default (on-time, no preference, first reminder today) is
 * byte-identical to the pre-Phase-U wording.
 */

const MAX_PER_TICK = 5; // don't blast a backlog all at once
const GRACE_MS = 1000 * 60 * 60 * 24 * 3; // a reminder more than 3 days overdue is quietly retired, not spammed

interface DueRow {
  id: number;
  label: string;
  remind_at: string;
}

/** SQLite/ISO timestamp → ms (tolerant of "YYYY-MM-DD HH:MM:SS" and full ISO). */
function toMs(iso: string): number {
  const s = iso.includes("T") ? iso : iso.replace(" ", "T");
  const z = s.endsWith("Z") || /[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z";
  const t = Date.parse(z);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Deterministic message selection — domain-owned, same precedent as every other
 * pilot's own `build*Message` (billRisk/check_in/dailyDigest). Priority, most to
 * least specific: an explicit concise preference wins outright; then genuine
 * lateness (already computed by run(), just newly used); then same-day repetition
 * (a communication-only signal — it never changes whether/when THIS reminder fires).
 */
function buildReminderMessage(input: { label: string; overdueMs: number; preferConcise: boolean; manyRemindersToday: boolean }): string {
  const { label, overdueMs, preferConcise, manyRemindersToday } = input;
  if (preferConcise) return `⏰ ${label}`;

  const overdueHours = overdueMs / 3_600_000;
  if (overdueHours >= 1) {
    const overdueText = overdueHours >= 24 ? `${Math.round(overdueHours / 24)}d overdue` : `${Math.round(overdueHours)}h overdue`;
    return `⏰ Running a little behind on this one — "${label}" (${overdueText}).`;
  }
  if (manyRemindersToday) return `⏰ Another one: "${label}"`;
  return `⏰ Reminder: "${label}"`;
}

export const reminderTool: Tool = {
  name: "fire_reminder",
  description:
    "Deliver a reminder to the user at the moment it comes due. Use for any memory that carries a future remind time that has now arrived.",
  parameters: {
    type: "object",
    properties: { nodeId: { type: "number", description: "The memory whose reminder is due" } },
    required: ["nodeId"],
  },

  detect(tc: ToolContext): ToolInvocation[] {
    const rows = tc.ctx.handle.sqlite
      .prepare(
        `SELECT id, label, remind_at FROM nodes
         WHERE space_id = ? AND deleted_at IS NULL
           AND remind_at IS NOT NULL AND reminder_fired_at IS NULL
           AND (kind IS NULL OR kind != 'life_vision')`,
      )
      .all(tc.spaceId) as DueRow[];
    return rows
      .filter((r) => {
        const at = toMs(r.remind_at);
        return at > 0 && at <= tc.now;
      })
      .sort((a, b) => toMs(a.remind_at) - toMs(b.remind_at))
      .slice(0, MAX_PER_TICK)
      .map((r) => ({ tool: "fire_reminder", args: { nodeId: r.id }, reason: `reminder for "${r.label}" came due` }));
  },

  async run(tc: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const nodeId = Number(args.nodeId);
    // Phase 1 agent loop: the approval id is the idempotency key (0 = the
    // deterministic router path, which never uses approvals).
    const approvalId = typeof args._approvalId === "number" ? args._approvalId : 0;
    const s = tc.ctx.handle.sqlite;
    const row = s
      .prepare(`SELECT id, label, remind_at, reminder_fired_at, fired_by_approval FROM nodes WHERE id = ? AND space_id = ? AND deleted_at IS NULL`)
      .get(nodeId, tc.spaceId) as (DueRow & { reminder_fired_at: string | null; fired_by_approval: number | null }) | undefined;
    if (!row) return { ok: false, summary: `reminder ${nodeId} gone` };
    // Crash-retry of the same approval: we already fired this — dedup success.
    if (approvalId !== 0 && row.fired_by_approval === approvalId) {
      return { ok: true, summary: `reminder "${row.label}" already fired (deduped)` };
    }
    if (row.reminder_fired_at || row.fired_by_approval !== null) {
      return { ok: false, summary: `reminder ${nodeId} already fired` };
    }

    const firedIso = new Date(tc.now).toISOString();
    // Atomic claim: the UPDATE only lands when nobody fired it first, and it
    // records WHO fired it in the same statement. A lost race → changes === 0.
    const claimed = s.prepare(
      `UPDATE nodes SET reminder_fired_at = ?, fired_by_approval = ?
       WHERE id = ? AND space_id = ? AND fired_by_approval IS NULL`
    ).run(firedIso, approvalId, nodeId, tc.spaceId);
    if (claimed.changes === 0) {
      return { ok: false, summary: `reminder ${nodeId} already fired` };
    }

    // Too-stale reminders are retired silently (marked fired, not delivered) so a long
    // downtime doesn't dump a week of overdue pings on the user.
    const overdueMs = tc.now - toMs(row.remind_at);
    if (overdueMs > GRACE_MS) {
      return { ok: true, summary: `retired stale reminder "${row.label}" (${Math.round(overdueMs / 86_400_000)}d overdue)` };
    }

    const comm = buildCommunicationContext(tc.ctx.handle, tc.spaceId);
    const preferConcise = comm.preferences.some((p) => p.signal === "verbosity" && /concise|brief|short/i.test(p.value));
    const manyRemindersToday = recentActionCount(tc.ctx.handle, tc.spaceId, "tool:fire_reminder", 1, new Date(tc.now)) >= 1;
    const msg = buildReminderMessage({ label: row.label, overdueMs, preferConcise, manyRemindersToday });
    let delivered = false;
    try {
      await tc.notify(msg, {
        tool: "fire_reminder",
        nodeId,
        remindAt: row.remind_at,
      });
      delivered = true;
    } catch {
      /* logged below regardless; the in-app bar still surfaces it */
    }
    // Web push (CL3): an independent delivery channel dispatched HERE, at
    // the real firing site — deliberately NOT routed through the Telegram
    // policy boundary above. That boundary only exists when a Telegram
    // token is configured (index.ts passes notify=undefined otherwise),
    // and its outbox queues for quiet hours/caps; push-only brains would
    // otherwise never receive anything. sendPushToSpace is a strict no-op
    // when VAPID is unconfigured and never throws, so this cannot change
    // any existing behavior. Trade-off of the minimal design: push fires
    // immediately at due time rather than being deferred by the policy
    // layer's quiet-hours/cap rules.
    try {
      const push = await sendPushToSpace(tc.ctx.handle, tc.spaceId, {
        title: "⏰ Soumaya reminder",
        body: msg,
        url: "/",
      });
      if (push.sent > 0) delivered = true;
    } catch {
      /* push is best-effort — the firing itself already succeeded */
    }
    return { ok: true, summary: `fired reminder "${row.label}"`, delivered, message: msg };
  },
};
