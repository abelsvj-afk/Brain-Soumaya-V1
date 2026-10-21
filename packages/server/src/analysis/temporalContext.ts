import type { TemporalContext, TemporalFact, ChangeResult } from "@brain/shared";
import { visionRequirementCents } from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import type { AppContext } from "../context.js";
import { getBudgetSummary } from "../finance/summary.js";
import { getWealthSummary } from "../finance/wealth.js";
import { FinIncomeRepo } from "../repositories/finIncome.repo.js";
import { FinAllocationRepo } from "../repositories/finAllocation.repo.js";
import { FinGoalRepo } from "../repositories/finGoal.repo.js";
import { JourneysRepo } from "../repositories/journeys.repo.js";
import { listCognitive } from "./cognitive.js";
import { dueForReview } from "./review.js";
import { recentPeopleSummaries } from "./people.js";
import {
  classifyDeadline,
  classifyFreshness,
  BILL_SOON_DAYS,
  INCOME_STALE_DAYS,
  GOAL_ALLOCATION_STALE_DAYS,
  VISION_APPROACHING_DAYS,
  JOURNEY_INACTIVE_DAYS,
  RECENT_WINDOW_DAYS,
} from "./temporal.js";
import { incomeChange, netWorthChange, goalAllocationChange } from "./temporalChange.js";
import { spaceTimezone, localDay } from "../agent/notify/policy.js";
import { localDateOfStored } from "../lib/time.js";

/**
 * Cross-domain temporal context assembly (docs/specs/temporal-contextual-reasoning.md). This is
 * the "Context Snapshot" — computed fresh from authoritative data on every call, NEVER
 * persisted (per the spec's own instruction: prefer computing over storing). It reads Money,
 * Wealth, Life Vision, Journeys, Mind, and People through their EXISTING repositories/summary
 * functions exactly as every other feature in this codebase already does — this module adds no
 * new tables, no new source-of-truth data, only a temporal REFRAMING of what's already there.
 *
 * Bounded by construction: each bucket is capped at `MAX_FACTS_PER_BUCKET`, matching this
 * codebase's existing "context-building read, not a hot path" discipline (the same reasoning
 * `journeyLinking.ts`'s link hydration and `peopleSnapshotText`'s 20-row cap already use) — this
 * function does one bounded query per domain, no N+1, no unbounded scan.
 */
const MAX_FACTS_PER_BUCKET = 5;

function push(buckets: { upcoming: TemporalFact[]; overdue: TemporalFact[]; stale: TemporalFact[]; recent: TemporalFact[] }, fact: TemporalFact): void {
  const bucket =
    fact.state === "upcoming" ? buckets.upcoming :
    fact.state === "overdue" ? buckets.overdue :
    fact.state === "stale" ? buckets.stale :
    fact.state === "recently_changed" ? buckets.recent :
    null; // "past"/"current" facts aren't notable enough to surface in the bounded snapshot
  if (bucket && bucket.length < MAX_FACTS_PER_BUCKET) bucket.push(fact);
}

/**
 * Takes a raw `DbHandle` (not `AppContext`) — matching `financialSnapshotText`/
 * `peopleSnapshotText`/`cognitiveSnapshotText`'s own signatures exactly, since all four are
 * called from `chat()`, which only has a handle. `listCognitive`/`dueForReview` need an
 * `AppContext` but only ever read `ctx.handle.sqlite` internally, so the same minimal shim
 * `cognitiveSnapshotText` already uses is safe here too.
 */
export function buildTemporalContext(handle: DbHandle, spaceId: string = DEFAULT_SPACE, now: Date = new Date()): TemporalContext {
  const nowMs = now.getTime();
  const buckets = { upcoming: [] as TemporalFact[], overdue: [] as TemporalFact[], stale: [] as TemporalFact[], recent: [] as TemporalFact[] };
  const recentChanges: ChangeResult[] = [];

  // ---- Money: upcoming/overdue bills (reuses the Budget Engine's own "reserved" list and its
  // existing SOON_DAYS horizon), income freshness (reuses financeFreshness.ts's own threshold).
  const budget = getBudgetSummary(handle, spaceId, now);
  for (const r of budget.reserved) {
    const state = classifyDeadline(r.dueDate, nowMs, BILL_SOON_DAYS);
    if (state) push(buckets, { domain: "money", kind: "bill_due", label: r.name, date: r.dueDate, state, detail: `$${(r.amountCents / 100).toFixed(2)}` });
  }
  const lastIncomeDate = new FinIncomeRepo(handle, spaceId).mostRecentDate();
  if (lastIncomeDate) {
    const state = classifyFreshness(lastIncomeDate, nowMs, INCOME_STALE_DAYS);
    if (state === "stale" || state === "recently_changed") {
      push(buckets, { domain: "money", kind: "income_freshness", label: "Income", date: lastIncomeDate, state });
    }
  }
  const incomeTrend = incomeChange(handle, spaceId, now);
  recentChanges.push(incomeTrend);

  // ---- Wealth: goal target dates + allocation-freshness + funding velocity. Target-date
  // "approaching" reuses the same VISION_APPROACHING_DAYS horizon as Life Vision below — both
  // are "a target date on a financial commitment," and this feature's audit found no existing,
  // goal-specific horizon to reuse instead.
  const goalRepo = new FinGoalRepo(handle, spaceId);
  const allocationRepo = new FinAllocationRepo(handle, spaceId);
  const goals = goalRepo.list();
  for (const g of goals) {
    if (g.targetDate) {
      const state = classifyDeadline(g.targetDate, nowMs, VISION_APPROACHING_DAYS);
      if (state) push(buckets, { domain: "wealth", kind: "goal_target", label: g.name, date: g.targetDate, state });
    }
    const lastAllocation = allocationRepo.list(g.id, 1)[0]?.createdAt ?? null;
    const activityDate = lastAllocation ?? g.createdAt;
    const freshness = classifyFreshness(activityDate, nowMs, GOAL_ALLOCATION_STALE_DAYS);
    if (freshness === "stale") push(buckets, { domain: "wealth", kind: "goal_allocation_freshness", label: g.name, date: activityDate, state: "stale" });
    recentChanges.push(goalAllocationChange(handle, spaceId, { id: g.id, name: g.name }, now));
  }
  recentChanges.push(netWorthChange(handle, spaceId, now));

  // ---- Life Vision: target-date classification + funding narrative (reuses the shared, pure
  // `visionRequirementCents` — the one deterministic Vision/Goal calculation this whole feature
  // is locked to, per docs/specs/life-vision.md §2 — never redefined here).
  const shimCtx = { handle } as AppContext;
  const visions = listCognitive(shimCtx, spaceId, "life_vision");
  for (const v of visions) {
    if (v.remindAt) {
      const state = classifyDeadline(v.remindAt, nowMs, VISION_APPROACHING_DAYS);
      if (state) {
        const linkedGoals = goalRepo.list({ visionNodeId: v.id });
        const req = visionRequirementCents(linkedGoals);
        let detail: string | undefined;
        if (req.hasLinkedGoals && req.countedGoals > 0) {
          const totals = allocationRepo.totalsByGoal(linkedGoals.map((g) => g.id));
          const fundedCents = linkedGoals.reduce((sum, g) => sum + (totals.get(g.id) ?? 0), 0);
          detail = `funded $${(fundedCents / 100).toFixed(0)} of $${(req.totalCents / 100).toFixed(0)} across ${req.countedGoals} goal${req.countedGoals === 1 ? "" : "s"}`;
        }
        push(buckets, { domain: "life_vision", kind: "vision_target", label: v.label, date: v.remindAt, state, detail });
      }
    }
  }

  // ---- Journeys: activity recency off `updatedAt` (the only date Journeys have — confirmed by
  // this feature's audit: no start/end date fields exist on the Journey type at all).
  const journeys = new JourneysRepo(handle, spaceId).list(false); // exclude "done"
  for (const j of journeys) {
    const state = classifyFreshness(j.updatedAt, nowMs, JOURNEY_INACTIVE_DAYS);
    if (state === "stale" || state === "recently_changed") {
      push(buckets, { domain: "journey", kind: "journey_activity", label: j.title, date: j.updatedAt, state });
    }
  }

  // ---- Mind: memories due for active-recall review right now (analysis/review.ts's own
  // spaced-repetition schedule — reused, not reimplemented).
  const due = dueForReview(shimCtx, spaceId, nowMs, MAX_FACTS_PER_BUCKET);
  for (const r of due) {
    push(buckets, { domain: "mind", kind: "review_due", label: r.label, date: r.next_review_at ?? r.created_at, state: "current" });
  }

  // ---- People: recent interactions only (no invented "stale person" threshold — this
  // feature's audit found no existing precedent for one, and the task's own People section
  // asks only to reuse existing relationships, not to add new temporal policy for them).
  for (const p of recentPeopleSummaries(handle, spaceId).slice(0, MAX_FACTS_PER_BUCKET)) {
    if (!p.lastAt) continue;
    const state = classifyFreshness(p.lastAt, nowMs, Number.POSITIVE_INFINITY, RECENT_WINDOW_DAYS);
    if (state === "recently_changed") push(buckets, { domain: "people", kind: "person_interaction", label: p.label, date: p.lastAt, state });
  }

  return {
    now: now.toISOString(),
    recentFacts: buckets.recent,
    upcomingFacts: buckets.upcoming,
    overdueFacts: buckets.overdue,
    staleFacts: buckets.stale,
    recentChanges,
  };
}

const fmtDelta = (c: ChangeResult): string | null => {
  if (c.status !== "compared" || c.direction === "unchanged") return null;
  const d = (cents: number) => `$${(Math.abs(cents) / 100).toFixed(0)}`;
  const pct = c.percent != null ? ` (${c.percent > 0 ? "+" : ""}${c.percent.toFixed(0)}%)` : "";
  return `${c.label} ${c.direction} by ${d(c.deltaCents)}${pct} vs. the prior period`;
};

/** A fact's date as the user would say it: bare stored dates stay themselves;
 *  stored instants render as their SPACE-local calendar date (owner rule
 *  2026-10-21 — the model must never be handed a UTC date as "the date"). */
const fmtFact = (f: TemporalFact, tz: string): string =>
  `${f.label}${f.detail ? ` — ${f.detail}` : ""} (${localDateOfStored(f.date, tz) ?? f.date.slice(0, 10)})`;

/**
 * Chat-facing renderer — same null-when-empty, `(handle, spaceId, now?)` contract as
 * `financialSnapshotText`/`peopleSnapshotText`/`cognitiveSnapshotText` (chat/graphrag.ts calls
 * all four the same way). Deliberately narrates only `"compared"` changes, never
 * `"insufficient_history"` ones — telling the LLM "there's no trend" adds nothing a bounded
 * snapshot needs to say; the honest behavior is simply not mentioning a trend it can't back up.
 */
export function temporalSnapshotText(handle: DbHandle, spaceId: string = DEFAULT_SPACE, now: Date = new Date()): string | null {
  const t = buildTemporalContext(handle, spaceId, now);
  const tz = spaceTimezone(handle.sqlite, spaceId);
  const fact = (f: TemporalFact) => fmtFact(f, tz);
  const changeLine = t.recentChanges.map(fmtDelta).filter((s): s is string => !!s);
  if (t.overdueFacts.length === 0 && t.upcomingFacts.length === 0 && t.staleFacts.length === 0 && t.recentFacts.length === 0 && changeLine.length === 0) {
    return null;
  }
  const lines = ["TEMPORAL CONTEXT (deterministic, as of " + localDay(now, tz) + " — reason about timing from THIS, never invent or assume a date):"];
  if (t.overdueFacts.length) lines.push(`- Overdue: ${t.overdueFacts.map(fact).join("; ")}.`);
  if (t.upcomingFacts.length) lines.push(`- Upcoming: ${t.upcomingFacts.map(fact).join("; ")}.`);
  if (t.staleFacts.length) lines.push(`- Stale (hasn't been updated in a while): ${t.staleFacts.map(fact).join("; ")}.`);
  if (t.recentFacts.length) lines.push(`- Recently changed: ${t.recentFacts.map(fact).join("; ")}.`);
  if (changeLine.length) lines.push(`- Trends: ${changeLine.join("; ")}.`);
  return lines.join("\n");
}
