import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import type { DbHandle } from "../../db/client.js";
import { FinGoalRepo } from "../../repositories/finGoal.repo.js";
import { goalAllocationChange } from "../../analysis/temporalChange.js";
import { buildCommunicationContext } from "../../communication/context.js";

/**
 * Goal-funding-trend proactive pilot (Phase X,
 * docs/specs/soumaya-goal-trend-proactive-pilot.md) — Soumaya's first PROACTIVE
 * conversation candidate, not just a smarter notification. Reuses the exact existing
 * `goalAllocationChange()` intelligence (Phase W's audited recommendation) — this file
 * adds ZERO new financial calculation, zero new trend algorithm. It only decides WHEN
 * that already-computed, already-honest signal (it refuses to fabricate a trend from
 * thin history — `status: "insufficient_history"`) is meaningful and fresh enough to
 * surface, then hands it to the exact same CommunicationContext/delivery pipeline
 * every other tool-router pilot already uses.
 *
 * Two-consecutive-period evidence (Phase X §2): `goalAllocationChange()` is called
 * TWICE — once at `now` and once at `now` shifted back by one full allocation window —
 * reusing the SAME function to read the prior period's own trend, not a new comparison.
 * Both calls must be `status: "compared"` (never "insufficient_history") with the SAME
 * direction before this tool considers a goal eligible.
 */

const DAY_MS = 86_400_000;
// Mirrors `goalAllocationChange()`'s own private ALLOCATION_WINDOW_DAYS (analysis/
// temporalChange.ts) — shifting `now` back by exactly one window lets the SAME function
// report the prior period's own trend, so the two-period check reuses one function
// twice rather than inventing a second comparison algorithm.
const PRIOR_PERIOD_OFFSET_DAYS = 30;
// A goal-funding swing under this is noise-level, not conversation-worthy — deliberately
// a single, clearly-documented dollar threshold (not a percent) since goal allocations
// are often modest in absolute terms; a percent-only bar would over-fire on small goals.
const MIN_MEANINGFUL_DELTA_CENTS = 5_000; // $50
// The underlying signal itself only moves at a 30-day cadence — re-surfacing the SAME
// goal more often than that cannot reflect genuinely NEW evidence, so this cooldown
// mirrors the signal's own natural period rather than an arbitrary notification cadence.
const GOAL_TREND_COOLDOWN_DAYS = 30;

/**
 * Has THIS specific goal already been surfaced by this tool recently? Reuses
 * `agent_logs` directly (Phase X §4/§5) — no new table. Scoped to this tool's own rows
 * and to the one goal id, so a real change to a DIFFERENT goal is never suppressed by
 * this goal's own recent firing (Phase X §5's explicit "Goal A must not suppress Goal
 * B" requirement) — bounded to this tool's own recent row count, cheap.
 */
function wasGoalRecentlySurfaced(handle: DbHandle, spaceId: string, goalId: number, now: Date): boolean {
  const since = new Date(now.getTime() - GOAL_TREND_COOLDOWN_DAYS * DAY_MS).toISOString();
  // agent_logs.created_at MIXES formats in one column: rows written through the
  // column default are SQLite's "YYYY-MM-DD HH:MM:SS", while the tool router
  // writes explicit ISO-Z. A raw string `>=` compares " " (0x20) < "T" (0x54),
  // so same-day space-format rows sorted BEFORE an ISO-Z cutoff and were
  // silently excluded — the cooldown effectively stretched to the next UTC
  // midnight. julianday() parses both shapes as instants (date/time accuracy
  // audit gap #6), so the comparison is format-blind.
  const rows = handle.sqlite
    .prepare(`SELECT targets FROM agent_logs WHERE space_id = ? AND action = 'tool:goal_trend' AND julianday(created_at) >= julianday(?)`)
    .all(spaceId, since) as { targets: string }[];
  return rows.some((r) => {
    try {
      return (JSON.parse(r.targets) as unknown[]).includes(goalId);
    } catch {
      return false;
    }
  });
}

const dollars = (cents: number): string => `$${Math.round(Math.abs(cents) / 100)}`;

/**
 * Deterministic message selection — domain-owned, same precedent as every other pilot's
 * own `build*Message()`. Never invents a CAUSE for the change (Phase X §7) — only what
 * the intelligence actually established: which goal, which direction, how much.
 */
function buildGoalTrendMessage(input: {
  goalName: string;
  direction: "increased" | "decreased";
  deltaCents: number;
  preferConcise: boolean;
  preferDirect: boolean;
  leadGently: boolean;
}): string {
  const { goalName, direction, deltaCents, preferConcise, preferDirect, leadGently } = input;
  const amt = dollars(deltaCents);
  const verb = direction === "decreased" ? "putting less toward" : "putting more toward";

  if (preferConcise) return `💰 "${goalName}": ${direction} ~${amt}/mo.`;

  const opener = leadGently && direction === "decreased" ? "💰 No pressure, but I noticed" : "💰 I noticed";
  if (direction === "decreased") {
    const closer = preferDirect
      ? `That's about ${amt} less than the period before.`
      : `That's about ${amt} less than the period before — just flagging it, not asking you to change anything.`;
    return `${opener} you've been ${verb} "${goalName}" over the last couple of periods. ${closer}`;
  }
  const closer = preferDirect ? `About ${amt} more than the period before.` : `That's about ${amt} more than the period before — nice momentum.`;
  return `${opener} you've been ${verb} "${goalName}" over the last couple of periods. ${closer}`;
}

export const goalFundingTrendTool: Tool = {
  name: "goal_trend",
  description:
    "Report how the user's financial goals' funding pace is trending (allocations in the last 30 days vs the 30 days before, per goal). Call with NO arguments in conversation (\"how are my goals trending?\") — every goal is assessed fresh, and goals without enough history are reported as such, never invented. Optionally pass goalId to focus on one goal. (The router's detector-shaped call, with goalId/goalName/direction/deltaCents, still works exactly as before.)",
  parameters: {
    type: "object",
    properties: {
      goalId: { type: "number", description: "Optional: focus on one financial goal by id. Omit in conversation to assess all goals." },
      goalName: { type: "string", description: "Router-internal; omit in conversation." },
      direction: { type: "string", enum: ["increased", "decreased"], description: "Router-internal; omit in conversation." },
      deltaCents: { type: "number", description: "Router-internal; omit in conversation." },
    },
    required: [],
    additionalProperties: false,
  },

  detect(tc: ToolContext): ToolInvocation[] {
    const goals = new FinGoalRepo(tc.ctx.handle, tc.spaceId).list();
    const now = new Date(tc.now);
    const priorNow = new Date(tc.now - PRIOR_PERIOD_OFFSET_DAYS * DAY_MS);
    const out: ToolInvocation[] = [];

    for (const goal of goals) {
      if (wasGoalRecentlySurfaced(tc.ctx.handle, tc.spaceId, goal.id, now)) continue;

      // Reuse the EXACT existing intelligence — zero new calculation. `status:
      // "insufficient_history"` (thin data) is a hard stop: never fabricate a candidate.
      const current = goalAllocationChange(tc.ctx.handle, tc.spaceId, goal, now);
      if (current.status !== "compared" || current.direction === "unchanged") continue;
      if (Math.abs(current.deltaCents) < MIN_MEANINGFUL_DELTA_CENTS) continue;

      // Two-consecutive-period gate: the SAME function, called for the prior period,
      // must ALSO show a real (non-fabricated) change in the SAME direction.
      const prior = goalAllocationChange(tc.ctx.handle, tc.spaceId, goal, priorNow);
      if (prior.status !== "compared" || prior.direction !== current.direction) continue;

      out.push({
        tool: "goal_trend",
        args: { goalId: goal.id, goalName: goal.name, direction: current.direction, deltaCents: current.deltaCents },
        reason: `"${goal.name}" allocation ${current.direction} by ${dollars(current.deltaCents)} across two consecutive periods`,
      });
    }
    return out;
  },

  async run(tc: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    // Telegram Parity Phase 4 — conversational path: the router's call is
    // the only one carrying direction/deltaCents (it computed them in
    // detect()). A conversation call (no direction) is assessed FRESH here
    // via the same goalAllocationChange() intelligence — read-only, no
    // notify, no surfacing cooldown (the user asked explicitly), and
    // insufficient history is reported honestly, never fabricated.
    if (typeof args.direction !== "string") {
      const goals = new FinGoalRepo(tc.ctx.handle, tc.spaceId).list();
      const focus = typeof args.goalId === "number" ? goals.filter((g) => g.id === args.goalId) : goals;
      if (goals.length === 0) {
        return {
          ok: true,
          summary: "goal_trend (conversational): no financial goals",
          message: "GOAL TRENDS (exact, from the allocation ledger): the user has no financial goals set up, so there is no funding trend to report. Say so honestly.",
        };
      }
      if (focus.length === 0) {
        return {
          ok: true,
          summary: "goal_trend (conversational): goal not found",
          message: `GOAL TRENDS: no financial goal with id ${String(args.goalId)} exists in this brain. Say so — do not invent one.`,
        };
      }
      const now = new Date(tc.now);
      const lines = ["GOAL TRENDS (exact, from the allocation ledger — allocations in the last 30 days vs the 30 days before; report as-is):"];
      for (const g of focus) {
        const c = goalAllocationChange(tc.ctx.handle, tc.spaceId, g, now);
        if (c.status === "compared") {
          lines.push(
            `  - "${g.name}": ${c.direction} — ${dollars(c.currentCents)} allocated in the last 30 days vs ${dollars(c.previousCents)} in the 30 days before (change of ${dollars(c.deltaCents)}).`,
          );
        } else {
          lines.push(`  - "${g.name}": not enough history to establish a trend (${c.reason}).`);
        }
      }
      return {
        ok: true,
        summary: `goal_trend (conversational): ${focus.length} goal(s) assessed`,
        message: lines.join("\n"),
      };
    }
    const goalId = Number(args.goalId);
    const goalName = String(args.goalName);
    const direction = args.direction === "increased" ? "increased" : "decreased";
    const deltaCents = Number(args.deltaCents);

    // Phase X: the SAME shared boundary billRisk/check_in/daily_digest/weekly_review
    // already use. `emotionalPatterns` is opt-in (full-space — this is a background
    // firing, not chat's hot path) and, per the Phase W/X lock, only ever softens the
    // OPENER of an already-detected financial signal — it is never the reason this
    // tool fires (detect() above never reads it at all).
    const comm = buildCommunicationContext(tc.ctx.handle, tc.spaceId, { includeFullSpaceEmotionalTrajectory: true });
    const preferConcise = comm.preferences.some((p) => p.signal === "verbosity" && /concise|brief|short/i.test(p.value));
    const preferDirect = comm.preferences.some((p) => p.signal === "directness" && /direct|blunt/i.test(p.value));
    const leadGently = comm.emotionalPatterns?.some((p) => p.type === "Stress cycle" || p.type === "Burnout risk" || p.type === "Downswing") ?? false;

    const msg = buildGoalTrendMessage({ goalName, direction, deltaCents, preferConcise, preferDirect, leadGently });

    let delivered = false;
    try {
      // REG-027: tool identity + a stable per-goal-per-day occurrence so
      // the outbox's notif_key dedup and audit attribution apply here.
      await tc.notify(msg, { tool: "goal_trend", goalId });
      delivered = true;
    } catch {
      /* router logs it regardless */
    }
    return {
      ok: true,
      summary: `goal funding trend nudge for "${goalName}" (${direction})`,
      delivered,
      message: msg,
      targets: [goalId], // Phase X's per-entity dedup — read back by wasGoalRecentlySurfaced()
    };
  },
};
