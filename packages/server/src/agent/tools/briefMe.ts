import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import { getBudgetSummary } from "../../finance/summary.js";
import { FinBillRepo } from "../../repositories/finBill.repo.js";
import { FinGoalRepo } from "../../repositories/finGoal.repo.js";
import { goalAllocationChange } from "../../analysis/temporalChange.js";
import { NodesRepo } from "../../repositories/nodes.repo.js";
import { StreakRepo } from "../../streak.js";

/**
 * Telegram Parity Phase 5-A: an on-demand assembled briefing (`brief_me`).
 *
 * Composes ONLY existing sources — no new data store:
 *  - Reminders due: the agenda/digest source (live nodes carrying
 *    `remind_at`, the same source `agenda_list` reads).
 *  - Bills at risk: the Budget Engine via `getBudgetSummary()` plus the
 *    FinBill autopay map — the exact conversational `bill_risk` source.
 *  - Goal funding pace: `goalAllocationChange()` per financial goal — the
 *    exact conversational `goal_trend` source.
 *  - Streaks: `StreakRepo` (the daily-tending streak machinery; its days
 *    are already space-local).
 *
 * SUGGESTED FOCUS RULE (deterministic, stated in the output — never an
 * invented priority; the pick is labeled as Soumaya's):
 *  1. If the budget is SHORT for the reserved bills, the earliest-due
 *     reserved bill is the focus (money already at risk).
 *  2. Else the MOST OVERDUE due reminder (earliest `remind_at`).
 *  3. Else the earliest non-autopay reserved bill when safe-to-spend is no
 *     larger than that bill (the tight-cushion risk `bill_risk` flags).
 *  4. Else the highest-importance active action item.
 *  5. Else there is no focus — the briefing says so.
 *
 * Every section with no data says so honestly; no section fabricates.
 * Read-only. No approval required. Space-scoped via tc.spaceId throughout.
 */

const dollars = (cents: number): string => `$${Math.round(Math.abs(cents) / 100)}`;

interface ReminderRow {
  id: number;
  label: string;
  remind_at: string;
}

export const briefMeTool: Tool = {
  name: "brief_me",
  description:
    "Assemble an on-demand briefing for the user: reminders due, bills at risk, daily-tending streak, goal funding pace, and ONE suggested focus (Soumaya's pick, chosen by a stated deterministic rule — the earliest bill the budget is short for, else the most overdue reminder, else a tight-cushion bill, else the top action). Use for 'brief me', 'what should I focus on', 'give me my briefing' requests. Every section reports honestly when it has no data.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },

  detect(_tc: ToolContext): ToolInvocation[] {
    // The agent loop invokes this directly; the deterministic router never does.
    return [];
  },

  async run(tc: ToolContext, _args: Record<string, unknown>): Promise<ToolResult> {
    const s = tc.ctx.handle.sqlite;
    const now = new Date(tc.now);
    const lines: string[] = [
      "BRIEFING (assembled on demand from the brain's existing sources — report as-is; sections with no data say so):",
    ];

    // ----- Reminders due (agenda/reminder source, same as agenda_list). -----
    const reminders = s
      .prepare(
        `SELECT id, label, remind_at FROM nodes
         WHERE space_id = ? AND deleted_at IS NULL AND superseded_at IS NULL AND remind_at IS NOT NULL
         ORDER BY remind_at ASC`,
      )
      .all(tc.spaceId) as ReminderRow[];
    const due = reminders.filter((r) => Date.parse(r.remind_at) <= tc.now);
    const upcoming = reminders.filter((r) => Date.parse(r.remind_at) > tc.now);
    lines.push(`REMINDERS DUE: ${due.length} due at or before now (${upcoming.length} more upcoming)`);
    if (due.length === 0) {
      lines.push("  (none — no reminders are due right now)");
    } else {
      for (const r of due.slice(0, 10)) lines.push(`  - ⏰ #${r.id} "${r.label}" — was due ${r.remind_at}`);
      if (due.length > 10) lines.push(`  (and ${due.length - 10} more due — call agenda_list for the full list)`);
    }

    // ----- Bills at risk (Budget Engine, same as conversational bill_risk). -----
    const budget = getBudgetSummary(tc.ctx.handle, tc.spaceId, now);
    const autopay = new Map(new FinBillRepo(tc.ctx.handle, tc.spaceId).list().map((b) => [b.id, b.autopay]));
    const nonAutopayReserved = budget.reserved.filter((r) => !autopay.get(r.billId));
    const tightBill =
      budget.shortfallCents <= 0 && nonAutopayReserved.length > 0 && budget.safeToSpendCents <= nonAutopayReserved[0]!.amountCents
        ? nonAutopayReserved[0]
        : undefined;
    lines.push(
      `BILLS AT RISK: balance ${dollars(budget.balanceCents)}; reserved for upcoming bills: ${dollars(budget.reservedCents)}; safe to spend: ${dollars(budget.safeToSpendCents)}; shortfall: ${dollars(budget.shortfallCents)}; next income expected: ${budget.nextIncomeDate}.`,
    );
    if (budget.reserved.length === 0) {
      lines.push("  (none — no bills are reserved before the next income, so no bill is at risk)");
    } else {
      for (const r of budget.reserved) {
        lines.push(
          `  - "${r.name}" — ${dollars(r.amountCents)}, due ${r.dueDate}${autopay.get(r.billId) ? " (autopay)" : " (NOT autopay — needs manual payment)"}`,
        );
      }
      if (budget.shortfallCents > 0) {
        lines.push(`  RISK: the balance is ${dollars(budget.shortfallCents)} SHORT of covering the reserved bills + buffer.`);
      } else if (tightBill) {
        lines.push(
          `  RISK: the cushion is tight — safe-to-spend (${dollars(budget.safeToSpendCents)}) is no larger than the earliest non-autopay bill ("${tightBill.name}", ${dollars(tightBill.amountCents)}).`,
        );
      } else {
        lines.push("  No shortfall risk right now: the reserved bills are covered by the current balance.");
      }
    }

    // ----- Streak (StreakRepo machinery; space-local days). -----
    let streakLine: string;
    try {
      const streak = new StreakRepo(tc.ctx.handle, tc.spaceId).get();
      streakLine =
        streak.current > 0
          ? `STREAK: ${streak.current} day(s) of daily tending (best: ${streak.best}; tended today: ${streak.today ? "yes" : "not yet"}; nebula shields banked: ${streak.shields}).`
          : `STREAK: no active streak right now (best so far: ${streak.best}).`;
    } catch {
      streakLine = "STREAK: no streak data is recorded for this brain yet.";
    }
    lines.push(streakLine);

    // ----- Goal funding pace (goalAllocationChange, same as goal_trend). -----
    const goals = new FinGoalRepo(tc.ctx.handle, tc.spaceId).list();
    lines.push(`GOAL FUNDING PACE: ${goals.length} financial goal(s)`);
    if (goals.length === 0) {
      lines.push("  (none — no financial goals are set up, so there is no funding pace to report)");
    } else {
      for (const g of goals) {
        const c = goalAllocationChange(tc.ctx.handle, tc.spaceId, g, now);
        if (c.status === "compared") {
          lines.push(
            `  - "${g.name}": ${c.direction} — ${dollars(c.currentCents)} allocated in the last 30 days vs ${dollars(c.previousCents)} in the 30 days before (change of ${dollars(c.deltaCents)}).`,
          );
        } else {
          lines.push(`  - "${g.name}": not enough history to establish a pace (${c.reason}).`);
        }
      }
    }

    // ----- Suggested focus (the deterministic rule in the header). -----
    const actions = new NodesRepo(tc.ctx.handle, tc.spaceId)
      .all()
      .filter((n) => n.kind === "action")
      .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0) || a.id - b.id);
    let focus: string;
    if (budget.shortfallCents > 0 && budget.reserved.length > 0) {
      const b = budget.reserved[0]!;
      focus = `the bill "${b.name}" (${dollars(b.amountCents)}, due ${b.dueDate}) — the budget is ${dollars(budget.shortfallCents)} short for the reserved bills, and this is the earliest due (rule 1: earliest bill the budget is short for)`;
    } else if (due.length > 0) {
      const r = due[0]!;
      focus = `the reminder "${r.label}" (#${r.id}, was due ${r.remind_at}) — it is the most overdue open item (rule 2: most overdue reminder)`;
    } else if (tightBill) {
      focus = `the bill "${tightBill.name}" (${dollars(tightBill.amountCents)}, due ${tightBill.dueDate}) — safe-to-spend does not exceed it, so overspending could leave it short (rule 3: tight-cushion bill)`;
    } else if (actions.length > 0) {
      const a = actions[0]!;
      focus = `the action "${a.label}" (#${a.id}) — the highest-importance open action item (rule 4: top open action)`;
    } else {
      focus = "none — nothing is overdue, at risk, or open right now (rule 5)";
    }
    lines.push(
      `SUGGESTED FOCUS (Soumaya's pick, by the stated deterministic rule — 1: earliest bill the budget is short for; 2: most overdue reminder; 3: tight-cushion bill; 4: highest-importance open action; 5: none): ${focus}.`,
    );

    return {
      ok: true,
      summary: `brief_me: ${due.length} reminder(s) due, shortfall ${dollars(budget.shortfallCents)}, ${goals.length} goal(s), focus: ${focus.slice(0, 80)}`,
      message: lines.join("\n"),
    };
  },
};
