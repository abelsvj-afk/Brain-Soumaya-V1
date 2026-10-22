import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import type { MoneyStar, MoneyStarState } from "@brain/shared";
import { getBudgetSummary } from "./summary.js";
import { getWealthSummary } from "./wealth.js";
import { FinBillRepo } from "../repositories/finBill.repo.js";
import { parseDay, toDay } from "./bills.js";
import { spaceTimezone, localDay } from "../agent/notify/policy.js";

/**
 * Money-sky (Stage 4 Part A) — turns bills into "stars" with a STATE the galaxy renders as
 * colour/glow/glyph (cooling = blue). Deterministic, from the Budget Engine (offline). The web
 * moneySky layer draws one small star per entry; the `glyph` is the on-focus status icon.
 * See docs/financial-os/stage-4-galaxy-and-zero-based.md §A2.
 *
 * Also emits one `kind: "goal"` star per active Wealth goal (docs/specs/wealth-goals-allocation.md
 * §11) — this activates MoneyStar.kind/"goal_filling"/"goal_reached"/fillPct, which were declared
 * on the type but never produced before this. Bill logic and goal logic are two independent
 * branches that never share state; a goal's state is progress-driven (fillPct), never date-driven
 * like a bill's. Archived goals are excluded automatically — getWealthSummary()'s goal list
 * already only returns non-archived goals, the same "excluded by default" convention bills use.
 */

const DAY_MS = 86_400_000;
// Exported so analysis/temporal.ts reuses the same "due soon" horizon for bill-deadline
// classification rather than defining a second one (docs/specs/temporal-contextual-reasoning.md).
export const SOON_DAYS = 7;

const GLYPH: Record<MoneyStarState, string> = {
  calm: "•",
  approaching: "◐",
  cooling: "❄",
  overdue: "!",
  paid: "✓",
  goal_filling: "◔",
  goal_reached: "✦",
};

export function moneySky(handle: DbHandle, spaceId: string = DEFAULT_SPACE, now: Date = new Date()): MoneyStar[] {
  const budget = getBudgetSummary(handle, spaceId, now);
  const bills = new FinBillRepo(handle, spaceId);
  // ADR-019 §3.1/I8: "today" is the SPACE's local day (the same source the
  // Money tab's summary uses) — never a UTC slice. Tab and galaxy can
  // never disagree about what today is (trace D6 / DB-1).
  const today = localDay(now, spaceTimezone(handle.sqlite, spaceId));
  // Materialize a window AROUND today (the §3.3 backfill window, derived
  // from the space-local today), so a just-overdue occurrence exists too,
  // then pick each bill's CURRENT-period occurrence (closest to today).
  // Occurrence selection reads the single LIVE predicate (I1).
  const from = toDay(new Date(parseDay(today).getTime() - 35 * DAY_MS));
  const horizon = toDay(new Date(parseDay(today).getTime() + 45 * DAY_MS));
  bills.materializeAll(from, horizon);
  const autopay = new Map(bills.list().map((b) => [b.id, b.autopay]));

  const current = new Map<number, { billId: number; name: string; amountCents: number; dueDate: string; abs: number }>();
  for (const occ of bills.upcoming(300, today)) {
    const abs = Math.abs(parseDay(occ.dueDate).getTime() - parseDay(today).getTime());
    const prev = current.get(occ.billId);
    if (!prev || abs < prev.abs) current.set(occ.billId, { billId: occ.billId, name: occ.name, amountCents: occ.amountCents, dueDate: occ.dueDate, abs });
  }

  const stars: MoneyStar[] = [];
  for (const occ of current.values()) {
    const dueInDays = Math.round((parseDay(occ.dueDate).getTime() - parseDay(today).getTime()) / DAY_MS);

    let state: MoneyStarState;
    if (dueInDays < 0) {
      state = "overdue";
    } else if (budget.shortfallCents > 0 || budget.safeToSpendCents < occ.amountCents) {
      // Can't comfortably cover it → cooling (the user's blue). Autopay bills are assumed to
      // clear, so they don't cool unless we're genuinely short.
      state = !autopay.get(occ.billId) || budget.shortfallCents > 0 ? "cooling" : "calm";
    } else if (dueInDays <= SOON_DAYS) {
      state = "approaching";
    } else {
      state = "calm";
    }

    // Intensity: overdue/cooling = high; approaching ramps as the date nears; calm low.
    const intensity =
      state === "overdue" || state === "cooling" ? 1
      : state === "approaching" ? Math.max(0.4, 1 - dueInDays / SOON_DAYS)
      : 0.3;

    stars.push({ kind: "bill", id: occ.billId, label: occ.name, amountCents: occ.amountCents, state, glyph: GLYPH[state], intensity, dueInDays });
  }

  const wealth = getWealthSummary(handle, spaceId, budget);
  for (const g of wealth.goals) {
    // Reached goals glow at full intensity; a filling goal's glow scales with its own
    // progress (a fresh $0 goal shouldn't outshine one that's nearly there); an open-ended
    // goal (no fillPct) gets a modest, steady presence — there's no ceiling to ramp toward.
    const intensity = g.state === "goal_reached" ? 1 : g.fillPct != null ? Math.max(0.3, g.fillPct) : 0.5;
    stars.push({ kind: "goal", id: g.id, label: g.name, amountCents: g.totalCents, state: g.state, glyph: GLYPH[g.state], intensity, fillPct: g.fillPct ?? undefined });
  }

  return stars;
}
