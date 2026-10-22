# ADR-019 — Bill lifecycle semantics: Paid, Remove, Edit, Skip

**Status:** DESIGN — **the four product decisions in §1 were settled by the owner for
design on 2026-10-22.** This ADR is the design contract. Implementation has **not**
started and is **not authorized** — it awaits the design gate (§7) and the owner's
separate explicit authorization. Merge and deployment remain separate owner decisions.
**Approved by:** Project owner (decisions); design drafted 2026-10-22
**Date:** 2026-10-22
**Design baseline:** deploy branch HEAD `a9ed7c8feebf3f0a621d17afc16e8e6d6ae07e1f`
**Evidence base:** Money-tab trace of 2026-10-22 against `a9ed7c8`
(`~/workspace/ui-audit/money-tab-trace-2026-10-22.md`, defects D1–D17). Load-bearing
claims re-verified against the code at the baseline while drafting this ADR.
**Scope:** the lifecycle of recurring-bill occurrences in the Financial OS — what
Paid, Remove, Edit, and Skip do to occurrences, expenses, and the tracked balance —
plus the corrections in §3 that make the lifecycle's outputs trustworthy.
**Goal (owner's framing):** restore trustworthy financial behavior first. The budget
arithmetic is sound; the lifecycle around it is what misleads.
**Non-goals:** the engagement/rewards system, zero-based budgeting vs Wealth,
multi-account support, and the documented-but-dead features D12–D16 (see §6). None of
those are designed here, and none may be bundled into this repair.

---

## 1. Settled product decisions (owner, 2026-10-22)

### P1 — Mark bill as Paid records a real payment

Marking an occurrence paid **records the payment as a real expense, deducts it from
the tracked balance, and links the expense to the occurrence through
`paid_expense_id` — in one atomic operation.** If the payment already exists as an
expense, the user may **match** that expense instead of creating a duplicate. If the
operation fails, the occurrence is left unpaid (no partial state: no expense without
the link, no deduction without the expense, no status flip without both).

### P2 — Remove a recurring bill cancels its future

Removing a bill **stops future recurrence and cancels its future scheduled
occurrences.** Payment history and already-paid occurrences are preserved.
**Past-due unpaid occurrences remain visible until the user explicitly resolves
them** (pays, skips, or otherwise disposes of them) — they are never silently erased,
because they may represent real obligations.

### P3 — Edit a bill rewrites its eligible future

Editing a bill **applies the new amount and schedule to eligible future unpaid
occurrences, without duplicating them.** Paid occurrences and historical amounts are
preserved exactly as they happened. **Past-due unpaid occurrences are unchanged** —
the app does not retroactively rewrite a missed obligation.

### P4 — Skip is a per-occurrence action

A user may **skip a single occurrence.** A skipped occurrence **stops reserving**,
is **excluded from upcoming unpaid bills**, and **remains in history as skipped.**
Skipping one occurrence **does not disable or alter the recurring bill** — later
occurrences materialize and behave normally.

---

## 2. Occurrence state machine and invariants

Statuses (already the shared type `BillOccurrenceStatus`, `packages/shared/src/types.ts:810`):
`upcoming → paid | skipped`. No other transitions exist. `paid` and `skipped` are
terminal; an occurrence never returns to `upcoming`.

**Definitions.** An occurrence is *eligible-future* iff `status = 'upcoming'` and
`due_date >= today` (space-local day). It is *past-due unpaid* iff
`status = 'upcoming'` and `due_date < today` (space-local day).

**Invariants (normative; every acceptance test in §5 traces to one of these or to a
defect):**

- **I1 — Reservation.** An occurrence contributes to Reserved iff it is `upcoming`,
  its bill is active, and its due date is within the budget horizon. Paid, skipped,
  and cancelled (removed-bill future) occurrences never reserve.
- **I2 — Paying never enriches.** Marking an occurrence paid never increases Safe to
  Spend through the payment itself: the expense deduction and the reservation
  release happen in the same transaction, so the post-pay summary reflects both or
  neither. (Kills D1's "Safe to Spend rises after paying.")
- **I3 — One payment, one expense.** An occurrence has at most one linked expense
  (`paid_expense_id`), and an expense is linked to at most one occurrence. Matching
  an already-linked expense is rejected, not duplicated.
- **I4 — History is immutable.** Paid and skipped occurrences, and the amounts they
  carried, are never rewritten by Edit, Remove, or re-materialization.
- **I5 — No ghost bills.** After Remove, no future occurrence of that bill reserves,
  lists in Upcoming, or renders in the Money Sky. Past-due unpaid occurrences of the
  removed bill remain listed (per P2) until explicitly resolved, and reserve while
  they remain unpaid and unresolved — they are visible obligations, not ghosts.
- **I6 — No duplicates.** At most one occurrence exists per (bill, due date) —
  already enforced by the unique index `fin_occ_unique`
  (`space_id, bill_id, due_date`); Edit and backfill must work *through* it
  (update/replace eligible rows), never around it.
- **I7 — Presence is not navigation-dependent.** Whether a due occurrence exists,
  reserves, lists, and can be warned about never depends on which screens were
  opened (see §3.3 backfill).
- **I8 — One calendar.** Every user-facing day boundary in the money surfaces is the
  space's configured timezone. UTC day slices and device-zone derivations are
  defects wherever they remain (see §3.1, §3.4).

---

## 3. Corrections (confirmed defects — no product decision needed)

### 3.1 Money Sky day is the space's day (kills D6)
`finance/sky.ts` computes `today` via `toDay(now)` — a UTC slice
(`finance/bills.ts`) — while the tab uses `localDay(now, spaceTimezone(...))`
(`finance/summary.ts`). The sky adopts the summary's space-local day for its
current-occurrence selection and overdue state. Tab and galaxy can never disagree
about what "today" is.

### 3.2 Bill-risk due date is threaded through (kills D4)
`agent/tools/billRisk.ts` `detect()` already computes the at-risk occurrence's due
date (used at :127–161), but `run()` passes
`billDueAt: (bill as { dueDate?: string }).dueDate` (:222) — `FinBill` has no such
field, so the outbox `bill_due_at` is always NULL and ADR-018's
urgency-from-due-time classification can never engage for the bill-risk nudge.
Design: `run()` receives the occurrence due date from `detect()`'s result and
passes it as `billDueAt`, so it persists into `bill_due_at` at enqueue (the column
and the boundary logic already exist and are unchanged).

### 3.3 Bounded, repeatable occurrence backfill (kills D5; supports D8)
Materialization becomes a defined server-side step, not a side effect of reads:
- **Window:** from `today − 35 days` through the budget horizon (next-income date,
  at minimum `today + 45 days` — the union of the windows summary and sky use
  today), in space-local days.
- **Idempotent and repeatable:** running it any number of times, from any trigger,
  inserts only missing occurrences (INSERT OR IGNORE under `fin_occ_unique`) and
  never alters existing ones (I4, I6).
- **Triggers:** at minimum, budget-summary computation and a server-side periodic
  path (the same sweep cadence that drives proactive tools), so a bill falling due
  during a period of non-use materializes, reserves, lists, and can be warned about
  without anyone opening the galaxy (I7). Triggers are an implementation choice;
  the window, idempotence, and independence-from-navigation are the contract.

### 3.4 Relative dates in the space timezone (kills D7)
`packages/web/src/components/moneyDates.ts` performs all relative-day math against
device-local midnights and no export accepts a timezone. Design: the module's
relative-date functions take the space timezone (the same `spaceLocalDay` source
`FinancePanel` form defaults already use), and its tests are re-pinned from
device-local to space-local expectations. Money surfaces must not mix the two
calendars on one screen.

### 3.5 Pay-stub deletion is a defined relationship (kills D9)
A pay stub, its generated income row, and the balance adjustment that income caused
form one unit. `fin_paystub.income_id` already links stub → income. Design:
- **Delete stub** performs, in one transaction: delete the stub, delete its linked
  income row (if still present and still linked), and reverse that income's balance
  adjustment. The confirmation copy states all three effects.
- **Re-confirm is duplicate-safe:** `confirmPaystub` gains the same duplicate check
  the manual and paste paths already have (`findDuplicate` on date + net, extended
  with employer/period where available); re-uploading a stub whose income already
  exists flags the duplicate instead of counting the income twice.
- If the linked income was already deleted independently, stub deletion proceeds
  without inventing a reversal (the balance was already corrected by that deletion).

### 3.6 Scheduled vs settled entries are explicit (kills D10)
Income/expense entries carry a date; the balance is a *settled* ledger. Design:
- An entry dated **after** the space-local today is **scheduled**: it is stored,
  listed (visually distinguished as scheduled), and does **not** adjust the tracked
  balance or Safe to Spend until its date arrives.
- An entry dated today or earlier is **settled** and adjusts the balance
  immediately, as today (this preserves the documented manual-ledger model,
  financial-os decision D3, for the backdated direction).
- A scheduled entry becomes settled automatically when its date is reached
  (evaluated whenever the summary is computed — the same read path that
  materializes occurrences), applying its balance adjustment exactly once.
  Editing a scheduled entry's date across the today boundary applies or reverses
  the adjustment accordingly, in the same transaction as the edit.
- The date pickers communicate the distinction at entry time (no silent trap).

### 3.7 Upcoming list: visible truncation, stable scope (kills D8)
The Upcoming list's scope is defined by the backfill window (§3.3), not by which
screens ran. If the list is truncated at its display limit, the UI states the
truncation and the true count ("…and N more"). The scope and ordering (due date
ascending) are identical regardless of navigation history (I7).

---

## 4. Transaction boundaries

All multi-writes below execute in **one SQLite transaction** (the codebase's
`handle.sqlite.transaction(...)` pattern, as already used by `materialize` and by
ADR-018's claim path). A failure anywhere rolls back the whole operation; no
operation leaves a half-applied state.

| Operation | Atomic unit | Failure state |
|---|---|---|
| **Mark paid (create)** | insert expense → adjust balance → `markPaid` with `paid_expense_id` (guarded: `WHERE status='upcoming'`) | Occurrence stays `upcoming`; no expense; balance untouched (P1). |
| **Mark paid (match)** | verify candidate expense is unlinked → adjust nothing (expense already counted when it was logged) → set `paid_expense_id` + status under the same guard | Occurrence stays `upcoming`; expense stays unlinked. |
| **Remove bill** | `active = 0` → delete future `upcoming` occurrences (`due_date >= today`, space-local) | Bill stays active; occurrences intact. Past-due unpaid and paid/skipped rows are never touched by this operation (P2, I4). |
| **Edit bill** | update `fin_bill` → for each eligible-future occurrence: apply new amount; if the schedule changed, replace occurrences whose dates are no longer on the schedule with the new schedule's occurrences (delete + materialize within the transaction, under `fin_occ_unique`) | Bill and occurrences keep the old values together — never new template over old occurrences. Past-due unpaid and paid occurrences untouched (P3, I4). |
| **Skip occurrence** | status flip guarded `WHERE status='upcoming'` | No change. |
| **Delete pay stub** | delete stub → delete linked income → reverse its balance adjustment (§3.5) | Nothing deleted; balance untouched. |
| **Settle scheduled entry** | flip entry to settled → adjust balance | Entry stays scheduled; retried on next summary computation; the guard makes double-settlement impossible. |

**Concurrency.** Two simultaneous mark-paid actions on one occurrence: the guarded
status transition admits exactly one winner; the loser observes "already paid" and
creates no expense (I3). Two simultaneous edits serialize on the transaction; the
result is one complete edit, never an interleave. Retrying any operation after an
ambiguous failure is safe: every operation is idempotent or guarded such that a
retry converges to the same end state (no duplicate expense, no duplicate
occurrence, no double deduction).

**Balance adjustments** always go through `FinAccountRepo.adjustBalance` inside the
same transaction as the row write that justifies them — never as a separate,
separately-failable call (the current routes adjust outside any transaction, which
is part of how D1/D9/D10 drift the balance).

---

## 5. Acceptance tests (mapped to defects)

Each test names the defect it kills. Server tests run under
`TZ=America/New_York` (and the web suite additionally under
`TZ=Pacific/Kiritimati`, per the standing gate) unless a test's point is
timezone-independence.

| # | Test | Kills |
|---|---|---|
| T1 | Mark an occurrence paid → an expense exists, linked via `paid_expense_id`; balance reduced by the amount; summary's Safe to Spend does not exceed its pre-pay value through the payment. | D1, I2 |
| T2 | Log the payment as an expense first, then match it to the occurrence → no second expense, no second deduction; occurrence paid and linked. | D1, I3 |
| T3 | Force a failure mid-mark-paid (fault injection after expense insert) → transaction rolled back: occurrence `upcoming`, no expense, balance unchanged. Retry succeeds cleanly. | D1, P1 failure rule |
| T4 | Remove a bill with future + past-due + paid occurrences → future occurrences gone from Reserved, Upcoming, and Money Sky; paid history intact; past-due occurrence still listed and reserving until resolved (then resolvable via Paid or Skip). Delete-dialog copy matches behavior. | D2, P2, I5 |
| T5 | Edit a bill's amount → eligible future occurrences carry the new amount in Reserved/Upcoming; past-due and paid occurrences keep historical amounts. | D3, P3 |
| T6 | Edit a bill's schedule → the bill appears exactly once per due date in Upcoming/Reserved (no old+new pair); total reserved equals the new schedule only. | D3, I6 |
| T7 | Skip an occurrence → it stops reserving, leaves Upcoming, appears in history as skipped; the bill's next occurrence materializes normally. | D11, P4 |
| T8 | Bill-risk run for an at-risk bill → the enqueued outbox row's `bill_due_at` equals the occurrence's due date (non-NULL); urgency classification engages per ADR-018 boundary rules. | D4 |
| T9 | With no UI/screen reads, advance time past a bill's due date during "non-use" → the occurrence exists, reserves, lists, and is warnable (backfill trigger path exercised directly). Running backfill twice changes nothing the second time. | D5, I7 |
| T10 | At 21:00 space-local (a moment where UTC day ≠ space day), a bill due space-tomorrow is not overdue in the Money Sky, and one due space-today is due today — sky and tab agree. | D6, I8 |
| T11 | With device zone ≠ space zone, Money relative labels ("due today / in 3 days") follow the space zone on every money surface. | D7, I8 |
| T12 | Delete a pay stub → stub, linked income, and its balance adjustment are all reversed in one transaction; re-uploading and confirming the same stub counts the income exactly once (duplicate flagged). | D9 |
| T13 | Log income dated next week → balance and Safe to Spend unchanged today; entry listed as scheduled; when its date arrives, the balance adjusts exactly once (re-running summary does not re-apply). | D10 |
| T14 | Materialize more upcoming occurrences than the display limit → the list states the truncation and true count; the list's contents are identical whether or not the galaxy was opened first. | D8, I7 |
| T15 | Concurrent mark-paid (two callers, one occurrence) → exactly one expense, one deduction, one paid occurrence; the loser gets a clean "already paid" result. | I3, §4 concurrency |
| T16 | Concurrent edit + mark-paid on the same bill → final state equals one of the two serial orders, complete in both dimensions (no lost occurrence, no orphan expense). | §4 concurrency |
| T17 | Double-submit / client retry of mark-paid, skip, and remove → end state identical to a single submission in each case. | §4 idempotence |

Existing coverage that must stay green: the Budget Engine suite, the finance route
tests, the ADR-018 notification suites (T8 touches their boundary, not their rules).

---

## 6. Explicitly out of scope — separate, undecided owner items

Recorded here so the separation is durable; **none of these is designed in this
ADR, and implementation of ADR-019 must not bundle any of them:**

1. **Zero-based budgeting vs Wealth.** Stage 4 Part B (`fin_plan`, "give every
   dollar a job", `toAssign === 0`) is unimplemented, and whether Wealth's
   allocate/deployable model superseded it has never been decided. Owner decision
   pending; the trace records the question (owner question 5).
2. **Multi-account support.** Financial-os decision D2 deferred it "if needed";
   whether it is needed now is an open owner call (trace D13 records that the
   single account's name/currency are additionally unwritable today — `setMeta`
   has no callers — which is noted as status, not fixed here).
3. **The engagement/rewards system.** The trace observes that money actions earn
   nothing (no quest/streak/fuel hook consumes finance events; goal-reached fires
   no celebration). That is a product-design question for the tab-audit program,
   not part of restoring trustworthy behavior.
4. **Documented-but-dead features D12–D16, status noted only:** pay-cadence hint
   (engine parameter exists, no caller, no setting — D12); account name/currency
   editing (D13); per-space finance enable flag + intro (financial-os D7 — D14);
   reconcile flow (financial-os D3 Stage 2, roadmap item 15 — D15); dead table
   `fin_goal_link` (D16). Each needs its own owner decision before any design.

## 7. Design gate

Implementation may be proposed only after the owner confirms, on this ADR:

- [ ] P1–P4 as written are the semantics to build (Paid / Remove / Edit / Skip).
- [ ] The corrections §3.1–§3.7 are in scope as written (in particular the
      scheduled-vs-settled rule §3.6, which changes how future-dated entries
      behave, and the backfill window §3.3).
- [ ] The transaction boundaries and invariants (§2, §4) are accepted as the
      implementation contract, with §5 as the acceptance-test list.
- [ ] §6 remains out of scope — no bundling.
- [ ] No schema change is required (see §8); if implementation discovers one is,
      work stops and returns to design.

## 8. Migration implications — none required

Verified against the baseline schema:

- `fin_bill_occurrence.paid_expense_id` **already exists** (BOOTSTRAP_SQL,
  `packages/server/src/db/schemaSql.ts`, `fin_bill_occurrence` CREATE) and is
  already read/mapped by `FinBillRepo`; it is simply never written with a value.
- The `skipped` status **already exists** in the shared type
  (`BillOccurrenceStatus`, `packages/shared/src/types.ts:810`); the column is
  unconstrained TEXT, so no CHECK amendment is needed. It is simply never written.
- `fin_paystub.income_id` **already exists** and already links a stub to its
  generated income row (§3.5 builds on it).
- **No new tables, no new columns, no `migrateSchema` additions.** The
  dual-registration rule is therefore not engaged. If implementation discovers a
  genuine schema need, §7's last gate item applies: stop and return to design for
  an additive, PRAGMA-guarded amendment to this ADR.

## 9. Doc/code note (D17)

`docs/financial-os/architecture.md` §4 defined Reserved with `due_date <
nextIncomeDate`; the engine implements `<=` (`finance/budget.ts`) — a bill due ON
payday is reserved. The code's behavior is the safer one and is adopted as the
designed behavior; the architecture doc is corrected alongside this ADR.
