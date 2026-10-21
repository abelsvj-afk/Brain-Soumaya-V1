import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { FinGoalRepo } from "../repositories/finGoal.repo.js";
import { FinBillRepo } from "../repositories/finBill.repo.js";
import { goalAllocationChange } from "./temporalChange.js";
import { getBudgetSummary } from "../finance/summary.js";
import { parseDay } from "../finance/bills.js";
import { spaceTimezone, localDay } from "../agent/notify/policy.js";

/**
 * Proactive → Chat context handoff (Phase Y, docs/specs/soumaya-proactive-chat-handoff.md;
 * Phase Z, docs/specs/soumaya-bill-risk-proactive-source.md). When the user opens Chat from
 * a proactive toast (Phase X's `goal_trend` pilot, Phase Z's `bill_risk` pilot), Chat must
 * know WHY the conversation exists without the user re-explaining it, and without a second
 * copy of the intelligence that triggered it.
 *
 * This module deliberately does NOT recompute a different trigger algorithm for either
 * source — `goal_trend` calls the SAME `goalAllocationChange()` Phase X's `detect()` uses;
 * `bill_risk` calls the SAME `getBudgetSummary()` bill_risk's own `detect()` uses — fresh, at
 * the moment Chat asks (exactly like `analysis/causal.ts` already re-derives
 * `incomeChange`/`netWorthChange`/`goalAllocationChange` fresh on every chat turn — the SAME
 * established pattern, not a new one). If the target no longer exists (wrong space, deleted,
 * or a stale/forged id) or the underlying evidence no longer holds, this returns `null` —
 * Chat proceeds completely normally with no proactive framing, never a broken turn.
 *
 * `proactiveContextSnapshotText()` itself remains ephemeral by construction: nothing in it is
 * ever written to `nodes`, `agent_logs`, or any other table — it's a pure read, computed fresh
 * per call, never persisted. (Phase AB's `recordProactiveDiscussion()`, below, is the one
 * deliberate exception — see its own doc comment.)
 *
 * Phase Z confirms `{source, targetId}` generalizes cleanly: both sources reduce to "a
 * space-scoped integer id on a table with its own `get(id)` repo method." Only the dispatch
 * below and the route's zod literal needed to grow — no new payload shape, no framework.
 *
 * Phase AB (docs/specs/soumaya-proactive-discussion-occurrence.md) adds exactly one durable
 * fact on top of all this: `recordProactiveDiscussion()` writes a single `agent_logs` row —
 * `action = 'chat:proactive_discussion'`, `targets = [targetId]` — the moment a REAL,
 * successfully-answered `/api/chat` exchange carried a validated proactive context. This is
 * NOT a transcript, NOT a summary, and NOT proof of anything beyond "this exchange happened
 * for this entity at this time." It is entirely separate from, and never interferes with, the
 * proactive tools' own `tool:goal_trend`/`tool:bill_risk` firing/dedup rows.
 */

export type ProactiveContextSource = "goal_trend" | "bill_risk";

export interface ProactiveContextInput {
  source: ProactiveContextSource;
  targetId: number;
}

/**
 * Returns a short, clearly-labeled `systemExtra` block naming WHY this conversation
 * was proactively initiated, or `null` when the context can't be honestly asserted
 * (unknown source, wrong space, deleted target, or the underlying signal no longer holds).
 * Never invents a cause beyond what the existing intelligence actually established.
 */
export function proactiveContextSnapshotText(
  handle: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  input: ProactiveContextInput | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!input) return null;
  if (input.source === "goal_trend") return goalTrendContextText(handle, spaceId, input.targetId, now);
  if (input.source === "bill_risk") return billRiskContextText(handle, spaceId, input.targetId, now);
  return null; // unknown/future source — silently ignored, never guessed at
}

function goalTrendContextText(handle: DbHandle, spaceId: string, goalId: number, now: Date): string | null {
  // Space-scoped by construction (FinGoalRepo.get only ever reads THIS space's rows) —
  // a cross-space or stale goal id simply resolves to null, same "invalid → silently
  // contributes nothing" contract chat()'s existing journeyId parameter already uses.
  const goal = new FinGoalRepo(handle, spaceId).get(goalId);
  if (!goal) return null;

  // Re-derive the SAME comparison Phase X's detect() used — not a new algorithm, the
  // one that already exists. If it no longer compares (e.g. the goal's history
  // changed since the toast fired), don't assert a claim the intelligence no longer
  // supports.
  const change = goalAllocationChange(handle, spaceId, goal, now);
  if (change.status !== "compared" || change.direction === "unchanged") return null;

  const amt = `$${Math.round(Math.abs(change.deltaCents) / 100)}`;
  return `PROACTIVE CONTEXT (why this conversation was initiated): You reached out to the user first this conversation because "${goal.name}"'s funding allocation ${change.direction} by about ${amt} across two consecutive periods — a real, sustained change, not a one-off. This is why you're speaking with them right now. Explain naturally in your own words if they ask; don't force the topic if they've clearly come to talk about something else.`;
}

const DAY_MS = 86_400_000;
const dollars = (cents: number): string => `$${Math.round(cents / 100)}`;

/**
 * Re-derives whether THIS SPECIFIC bill is still the reason bill_risk fired — using the
 * exact same authoritative read (`getBudgetSummary`) and the exact same "tight" condition
 * `agent/tools/billRisk.ts`'s own `detect()` uses, just targeted at one bill instead of
 * scanning for "the earliest at-risk one." This is a parameterization of the same evidence,
 * not a second risk algorithm — mirrors `goalTrendContextText` re-deriving one specific
 * goal's comparison rather than re-running goal_trend's own candidate-selection loop.
 *
 * `billRiskTool.detect()` itself is NOT called here: its own once-a-day gate would return
 * `[]` on the very day it just fired (the day Chat is most likely to be asked "why?"), which
 * would make this always report "not at risk" right when it matters most. Re-deriving the
 * risk condition directly avoids that false negative while still asserting nothing beyond
 * what the same underlying numbers show right now.
 */
function billRiskContextText(handle: DbHandle, spaceId: string, billId: number, now: Date): string | null {
  const bill = new FinBillRepo(handle, spaceId).get(billId);
  if (!bill) return null;
  if (bill.autopay) return null; // autopay bills are never the risk target (detect()'s own rule)

  const budget = getBudgetSummary(handle, spaceId, now);
  const reserved = budget.reserved.find((r) => r.billId === billId);
  if (!reserved) return null; // no longer reserved/relevant — don't assert stale info

  const tight = budget.shortfallCents > 0 || budget.safeToSpendCents <= reserved.amountCents;
  if (!tight) return null; // the cushion is no longer thin — the risk that triggered this has resolved

  if (budget.shortfallCents > 0) {
    return `PROACTIVE CONTEXT (why this conversation was initiated): You reached out to the user first this conversation because their budget is currently ${dollars(budget.shortfallCents)} short to cover "${bill.name}" (due ${reserved.dueDate}) — a real cushion shortfall, not a guess. This is why you're speaking with them right now. Explain naturally in your own words if they ask; don't force the topic if they've clearly come to talk about something else.`;
  }
  // Days until due counted on the SPACE's local calendar (owner rule
  // 2026-10-21), from the same space_meta timezone source as everywhere else.
  const today = localDay(now, spaceTimezone(handle.sqlite, spaceId));
  const days = Math.max(1, Math.round((parseDay(reserved.dueDate).getTime() - parseDay(today).getTime()) / DAY_MS));
  const perDay = Math.floor(budget.safeToSpendCents / days);
  return `PROACTIVE CONTEXT (why this conversation was initiated): You reached out to the user first this conversation because their spending pace needs to stay under ${dollars(perDay)}/day to keep "${bill.name}" (due ${reserved.dueDate}) covered — the cushion is genuinely thin right now, not a guess. This is why you're speaking with them right now. Explain naturally in your own words if they ask; don't force the topic if they've clearly come to talk about something else.`;
}

/**
 * Phase AB — the durable discussion-occurrence primitive
 * (docs/specs/soumaya-proactive-discussion-occurrence.md). Closes the gap the Phase AA audit
 * identified: `{source, targetId}` explains WHY a Chat turn was opened, but until now that
 * fact vanished the instant the response was sent — nothing recorded that the exchange ever
 * happened. This function is the one deliberate exception to this module's ephemeral design.
 *
 * Call this ONLY after `chat()` has already returned a real answer for this turn — i.e. from
 * `api/routes/chat.ts`, once `await chat(...)` has resolved without throwing, never from
 * inside `chat/graphrag.ts` itself. `chat()`'s final `deps.llm.answer(...)` call is NOT
 * wrapped in a try/catch — a provider failure there throws out of `chat()` and the route never
 * reaches `res.json()` — so recording any earlier (e.g. inside `proactiveContextSnapshotText`,
 * which runs BEFORE that call) would risk a false "discussion occurred" record for a turn that
 * actually failed. Calling this after `chat()` succeeds is the smallest defensible definition
 * of "a real proactive-context Chat interaction occurred."
 *
 * Reuses the EXACT SAME validation `proactiveContextSnapshotText()` already performs (space
 * scoping via each source's own repo `.get()`, the same "does the signal still hold" check) —
 * not a second resolution path. An invalid/stale/cross-space/unknown-source context therefore
 * produces the same `null` outcome here as it does for the chat framing itself, and no
 * `agent_logs` row is written — never a false record.
 *
 * Stores ONLY `{space_id, action: 'chat:proactive_discussion', targets: [targetId], created_at}`
 * — the source name in `description` for a human skimming `agent_logs`, nothing else. No bill
 * name, no amount, no message text, no LLM answer, no transcript. This proves exactly one
 * thing — "a real, successfully-answered proactive-context exchange happened for this entity
 * at this time" — and nothing more: not that the user agreed, took action, resolved the issue,
 * or even read the reply. It is entirely separate from the originating `tool:goal_trend`/
 * `tool:bill_risk` row (a different `action` string, read by no existing dedup query — see the
 * repo-wide `agent_logs` action inventory in the Phase AB spec) and must never be confused with
 * or substituted for it.
 *
 * Best-effort by design: any failure here (including a failure inside the reused validation)
 * is swallowed — an observational record must never turn an otherwise-successful chat reply
 * into a broken response.
 */
export function recordProactiveDiscussion(
  handle: DbHandle,
  spaceId: string = DEFAULT_SPACE,
  input: ProactiveContextInput | null | undefined,
  now: Date = new Date(),
): void {
  if (!input) return;
  try {
    const text = proactiveContextSnapshotText(handle, spaceId, input, now);
    if (!text) return; // same invalid/stale/cross-space outcome as the chat framing — no record
    handle.sqlite
      .prepare(`INSERT INTO agent_logs (space_id, action, description, targets, created_at) VALUES (?, 'chat:proactive_discussion', ?, ?, ?)`)
      .run(spaceId, `proactive-context Chat exchange occurred (${input.source})`, JSON.stringify([input.targetId]), now.toISOString());
  } catch {
    /* observational only — must never affect the chat response it's attached to */
  }
}
