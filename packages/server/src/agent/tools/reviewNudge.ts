import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import { dueForReview, snoozeReview, memoryStrength } from "../../analysis/review.js";
import { buildCommunicationContext, actionFiredToday } from "../../communication/context.js";

/**
 * Review-nudge (NEURO_ALIGNMENT.md #1) — the active-recall arm of spaced repetition.
 * When a memory's strength has decayed to its review point, Soumaya asks you to RECALL
 * it in her own voice (retrieval practice beats re-reading). Gentle: at most one nudge
 * per space per day, most significant + weakest first. Grading happens via /api/review.
 *
 * Phase U (docs/specs/soumaya-proactive-communication-migration-wave2.md) — detect()'s
 * ranking (via `dueForReview()`) is COMPLETELY UNCHANGED. `run()`'s row re-fetch (already
 * needed to get the label) now also reads `importance`/`review_count`/the columns
 * `memoryStrength()` needs — the SAME already-scheduled row, not a new detector — so the
 * message can explain WHY this particular recall is worth asking for: a genuinely faded
 * memory, one never reviewed before, or one that clearly matters. This is a MORE precise
 * repetition signal than a generic "have we nudged recently" read, since it's specific to
 * THIS memory (a fresh memory's first-ever nudge reads differently from one that keeps
 * coming back) — so this tool deliberately does not also call `recentActionCount`.
 */

const VERY_FADED_STRENGTH = 0.15; // near memoryStrength()'s own 0.05 floor — genuinely faded
const SIGNIFICANT_IMPORTANCE = 0.7; // matches this codebase's existing "matters" bar elsewhere

/**
 * A single reason clause, chosen by priority (most meaningful first), appended to a
 * stable template — compositional, not a hand-written sentence per combination. When
 * none of the three conditions hold, this returns the exact original sentence.
 */
function buildReviewNudgeMessage(input: { label: string; strength: number; importance: number; reviewCount: number; preferConcise: boolean }): string {
  const { label, strength, importance, reviewCount, preferConcise } = input;
  if (preferConcise) return `🧠 Recall check: "${label}"?`;

  let reason = "";
  if (strength <= VERY_FADED_STRENGTH) reason = " It's faded quite a bit since you last touched it.";
  else if (reviewCount === 0) reason = " You haven't circled back to it yet.";
  else if (importance >= SIGNIFICANT_IMPORTANCE) reason = " This one clearly matters to you.";

  if (!reason) return `🧠 Do you still remember what you noted about "${label}"? Take a moment to recall it — then open it to refresh.`;
  return `🧠 Do you still remember "${label}"?${reason} Take a moment to recall it — then open it to refresh.`;
}

export const reviewNudgeTool: Tool = {
  name: "review_nudge",
  description:
    "List the memories that are due for spaced-repetition recall (their memory strength has decayed to the review point). Call with NO arguments in conversation (\"what should I review?\") — the due list is computed fresh and nothing is snoozed or sent. Optionally pass nodeId to nudge recall of one specific memory. (The router's detector-shaped call, with nodeId, still works exactly as before.)",
  parameters: {
    type: "object",
    properties: { nodeId: { type: "number", description: "Optional: a specific memory id to nudge. Omit in conversation to list what is due." } },
    required: [],
    additionalProperties: false,
  },

  detect(tc: ToolContext): ToolInvocation[] {
    // Once per SPACE-local day (owner rule 2026-10-21 — the guard follows
    // the user's own day, never the UTC day of the stored timestamp).
    if (actionFiredToday(tc.ctx.handle, tc.spaceId, "tool:review_nudge", new Date(tc.now))) return [];
    const due = dueForReview(tc.ctx, tc.spaceId, tc.now, 1);
    if (due.length === 0) return [];
    const m = due[0]!;
    return [{ tool: "review_nudge", args: { nodeId: m.id }, reason: `"${m.label}" is due for recall` }];
  },

  async run(tc: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    // Telegram Parity Phase 4 — conversational path: no nodeId means the
    // model is asking what is due for review — answer from dueForReview()
    // (the same ranking detect() uses), read-only: NO snooze and NO notify
    // (snoozing is the proactive path's job, below, unchanged).
    if (typeof args.nodeId !== "number" || !Number.isFinite(args.nodeId)) {
      const due = dueForReview(tc.ctx, tc.spaceId, tc.now, 5);
      if (due.length === 0) {
        return {
          ok: true,
          summary: "review_nudge (conversational): nothing due",
          message: "REVIEW CHECK (exact, from the spaced-repetition schedule): nothing is due for recall right now. Say so honestly — do not invent a review item.",
        };
      }
      const lines = [
        `REVIEW CHECK (exact, from the spaced-repetition schedule): ${due.length} memor${due.length === 1 ? "y is" : "ies are"} due for recall, most significant + weakest first:`,
        ...due.map((m) => `  - #${m.id} "${m.label}" (memory strength ${memoryStrength(m, tc.now).toFixed(2)}, reviewed ${m.review_count ?? 0} time(s))`),
        "Prompt the user to recall the first one from memory before opening it — retrieval practice is the point.",
      ];
      return {
        ok: true,
        summary: `review_nudge (conversational): ${due.length} due`,
        targets: due.map((m) => m.id),
        message: lines.join("\n"),
      };
    }
    const nodeId = Number(args.nodeId);
    const row = tc.ctx.handle.sqlite
      .prepare(
        `SELECT label, importance, created_at, review_interval_days, last_reviewed_at, review_count
         FROM nodes WHERE id = ? AND space_id = ? AND deleted_at IS NULL`,
      )
      .get(nodeId, tc.spaceId) as
      | { label: string; importance: number | null; created_at: string; review_interval_days: number | null; last_reviewed_at: string | null; review_count: number | null }
      | undefined;
    if (!row) return { ok: false, summary: `review target ${nodeId} gone` };

    // Snooze so an un-graded nudge doesn't re-ask tomorrow (grading via /api/review resets it).
    snoozeReview(tc.ctx, tc.spaceId, nodeId, tc.now);

    const strength = memoryStrength(row, tc.now);
    const comm = buildCommunicationContext(tc.ctx.handle, tc.spaceId);
    const preferConcise = comm.preferences.some((p) => p.signal === "verbosity" && /concise|brief|short/i.test(p.value));
    const msg = buildReviewNudgeMessage({
      label: row.label,
      strength,
      importance: row.importance ?? 0.4,
      reviewCount: row.review_count ?? 0,
      preferConcise,
    });
    let delivered = false;
    try {
      await tc.notify(msg, { tool: "reviewNudge" });
      delivered = true;
    } catch {
      /* router logs it regardless */
    }
    return { ok: true, summary: `nudged recall of "${row.label}"`, delivered, message: msg };
  },
};
