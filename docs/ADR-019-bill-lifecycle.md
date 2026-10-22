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

**Revision history.**
- **R1 — design review round 1 (2026-10-22).** The owner's design review upheld
  P1–P4 and §6 but returned four blocking contract findings; all four were
  re-verified against this ADR and the baseline code before revising, and all
  four were confirmed. R1 changes: §3.6 now specifies a durable, idempotent
  settlement mechanism (a `balance_applied_at` marker) and **§8's original
  no-schema-change claim is replaced** by one additive migration (§8 records
  the change openly); I1 is rewritten as a single reservation-eligibility rule
  that resolves its contradiction with I5/P2; §4 respecifies Mark-paid as
  claim-first so a losing concurrent claim cannot leave an orphan expense or
  balance change; I2 is split into I2a/I2b because the matched-expense path
  legitimately raises Safe to Spend; §5 gains T18–T20. The gate (§7) remains
  OPEN pending re-review of R1.

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
`status = 'upcoming'` and `due_date < today` (space-local day). An occurrence is
*live* iff `status = 'upcoming'` and (its bill is active **or** it is past-due
unpaid) — the single eligibility predicate defined by I1 and used identically
by Reserved, Upcoming, and the Money Sky.

**Invariants (normative; every acceptance test in §5 traces to one of these or to a
defect):**

- **I1 — Reservation eligibility (one rule for Reserved, Upcoming, and Money
  Sky).** An occurrence contributes to Reserved iff it is *live* (see
  Definitions) and its due date is within the budget horizon
  (`due_date <= next-income date`, §9); a past-due unpaid occurrence always
  satisfies the horizon test. The same *live* predicate, without the horizon
  test, governs listing in Upcoming and rendering in the Money Sky — the three
  consumers never apply different eligibility rules. Consequences, by this one
  rule: paid and skipped occurrences are never live; Remove deletes the bill's
  today-and-future `upcoming` occurrences and deactivates the bill, so nothing
  future of it can be live; past-due unpaid occurrences survive Remove and stay
  live — reserving, listing, and rendering — until explicitly resolved (P2).
  An occurrence of a bill deactivated by any other path behaves identically:
  future-dated ones are not live, past-due unpaid ones are. (R1: this replaces
  the original I1, whose "bill is active" condition contradicted I5/P2.)
- **I2a — Paying with a new expense never enriches.** When Paid records a new
  expense, the deduction and the reservation release land in the same
  transaction (P1, §4). Safe to Spend after the payment therefore never
  exceeds its pre-pay value through the payment itself: it is unchanged when
  the occurrence was reserving (deduction and release cancel) and lower when
  it was not. (Kills D1's "Safe to Spend rises after paying.")
- **I2b — Matching an existing expense counts the obligation once.** When Paid
  matches an expense that already exists, no new expense is created and no new
  deduction is taken: the expense's balance effect stands exactly as its own
  settlement state dictates (§3.6 — already applied, or applied when its date
  arrives). Releasing the reservation may therefore raise Safe to Spend at
  match time, by at most the released reservation, and that rise is correct,
  not an I2a violation: until the match, the same obligation was counted twice
  (once as the expense's deduction, once as the reservation). Across the log
  and the match together, the obligation affects the balance exactly once and
  the reservation exactly once. (R1: I2 was originally written unqualified and
  contradicted this path.)
- **I3 — One payment, one expense.** An occurrence has at most one linked expense
  (`paid_expense_id`), and an expense is linked to at most one occurrence. Matching
  an already-linked expense is rejected, not duplicated.
- **I4 — History is immutable.** Paid and skipped occurrences, and the amounts they
  carried, are never rewritten by Edit, Remove, or re-materialization.
- **I5 — No ghost bills.** After Remove, no future occurrence of that bill reserves,
  lists in Upcoming, or renders in the Money Sky. Past-due unpaid occurrences of
  the removed bill remain *live* under I1's single rule — listed and reserving
  until explicitly resolved (P2). They are visible obligations, not ghosts, and
  I1 (not a separate exception) is what keeps them visible.
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
- **I9 — Settlement state is durable and singular (R1).** An income/expense
  entry's amount is reflected in the tracked balance **iff** its
  `balance_applied_at` marker is set (§3.6, §8). Every balance effect of an
  entry — settle-at-create, settlement, edit delta, un-settle, delete
  reversal — is keyed to a marker transition in the same transaction. An
  entry's date determines when it becomes *eligible* to settle; the date is
  never used to re-derive whether it *has* settled.

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
  adjustment **iff the income's settlement marker is set** (§3.6, I9) — a
  still-scheduled linked income never adjusted the balance, so there is nothing
  to reverse. The confirmation copy states the effects that actually occur.
- **Re-confirm is duplicate-safe:** `confirmPaystub` gains the same duplicate check
  the manual and paste paths already have (`findDuplicate` on date + net, extended
  with employer/period where available); re-uploading a stub whose income already
  exists flags the duplicate instead of counting the income twice.
- If the linked income was already deleted independently, stub deletion proceeds
  without inventing a reversal (the balance was already corrected by that deletion).

### 3.6 Scheduled vs settled entries are explicit — and durable (kills D10)
Income/expense entries carry a date; the balance is a *settled* ledger. Design:
- An entry dated **after** the space-local today is **scheduled**: it is stored,
  listed (visually distinguished as scheduled), and does **not** adjust the tracked
  balance or Safe to Spend until its date arrives.
- An entry dated today or earlier is **settled** and adjusts the balance
  immediately, as today (this preserves the documented manual-ledger model,
  financial-os decision D3, for the backdated direction).
- The date pickers communicate the distinction at entry time (no silent trap).

**The settlement mechanism (R1 — the original text required "exactly once"
settlement but named no durable state that could prove it; the baseline tables
carry dates and amounts only, and the existing edit/delete paths adjust the
balance unconditionally).** Settlement state is a durable marker, not a date
derivation:

- **Marker.** `fin_income.balance_applied_at` and `fin_expense.balance_applied_at`
  (nullable TEXT; the migration is specified in §8). The marker is set iff the
  entry's amount is currently reflected in `fin_account.balance_cents`. It is
  the single authority on applied-ness (I9); an entry's date governs only when
  it becomes *eligible* to settle.
- **Create.** Dated today or earlier: the row is inserted with the marker set
  and the balance adjusted, in one transaction (settled at write). Dated after
  today: inserted with the marker NULL, no balance effect.
- **Settlement sweep.** Evaluated at the same points the summary is computed
  (the read path that materializes occurrences, §3.3) and on the server-side
  periodic path. For each entry with marker NULL and `date <=` space-local
  today: in one transaction, a **guarded claim** — `UPDATE … SET
  balance_applied_at = :now WHERE id = ? AND balance_applied_at IS NULL` —
  must change exactly one row; only then is the balance adjusted by the
  entry's signed amount, in the same transaction. A guard miss (0 rows) means
  another path settled it first: no adjustment, no error. Marker write and
  balance adjustment commit or roll back together, so a crash or retry
  mid-settlement leaves the entry either fully settled or still scheduled,
  and re-running the sweep is a no-op for settled entries.
  **Stated assumption for the gate:** entries become due at the space-local
  start of their date; settlement is *effected* lazily at the first
  evaluation at or after that moment (the summary read path), not by a job
  assumed to fire at exactly midnight. From the user's first view on the
  entry's date, it is settled.
- **Edits** key every balance effect to the marker, never to a date
  re-derivation (this replaces the baseline's unconditional signed-delta /
  undo-the-add behavior in `finance/mutations.ts`):
  - Amount (or direction) edit, marker NULL: no balance change. Marker set:
    adjust by the signed delta, in the edit's transaction.
  - Date edit, marker NULL, new date still future: stays scheduled, no
    balance effect. New date today or earlier: **settles inside the edit
    transaction** (marker claim + full signed adjustment).
  - Date edit, marker set, new date still today or earlier: stays settled;
    only an amount delta (if any) adjusts. New date in the future:
    **un-settles inside the edit transaction** — the full signed adjustment
    is reversed and the marker is cleared; the entry is scheduled again and
    will settle exactly once more when its new date arrives, under the same
    claim rule.
- **Delete.** Marker set: delete + reverse the full signed amount, one
  transaction. Marker NULL: delete only — there is no adjustment to reverse.
- **Exactly-once argument.** The only writers of an entry's balance effect
  are create-with-marker, the settlement claim, edit delta / settle /
  un-settle, and delete reversal — each observes or flips the marker in the
  same transaction as its adjustment. An entry's amount is therefore in the
  balance iff its marker is set, by construction; retries and concurrent
  paths re-read the marker and converge.

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

**Guard rule (R1).** Every guarded transition in this ADR is *asserted*: the
operation must verify the guard changed exactly the rows it claimed, and a
zero-row guard **aborts the transaction** — it never commits-and-continues. (A
conditional SQLite UPDATE that matches zero rows is a successful statement,
not an error; without this rule the failure states below are aspirations, not
guarantees. R1 exists because the original Mark-paid row ordered the guarded
flip *last*, after the expense insert and balance adjustment, so a losing
concurrent claim could have committed both before discovering its loss.)

| Operation | Atomic unit | Failure state |
|---|---|---|
| **Mark paid (create)** | **Claim first:** guarded flip `status → 'paid'` (`WHERE status='upcoming'`, assert exactly 1 row — a miss aborts the transaction before anything else is written) → insert expense (dated the payment day; settled at write per §3.6) → set `paid_expense_id` → adjust balance | Occurrence stays `upcoming`; no expense; balance untouched (P1). A failure at any step rolls back the claim too. |
| **Mark paid (match)** | **Claim first** (same guard, same abort) → verify candidate expense is unlinked (no occurrence references it, I3 — if linked, abort: the claim rolls back and the occurrence stays `upcoming`) → set `paid_expense_id`. **No balance adjustment:** the expense's balance effect is governed by its own settlement marker (§3.6), never by the link | Occurrence stays `upcoming`; expense stays unlinked. |
| **Remove bill** | `active = 0` → delete future `upcoming` occurrences (`due_date >= today`, space-local) | Bill stays active; occurrences intact. Past-due unpaid and paid/skipped rows are never touched by this operation (P2, I4). |
| **Edit bill** | update `fin_bill` → for each eligible-future occurrence: apply new amount; if the schedule changed, replace occurrences whose dates are no longer on the schedule with the new schedule's occurrences (delete + materialize within the transaction, under `fin_occ_unique`) | Bill and occurrences keep the old values together — never new template over old occurrences. Past-due unpaid and paid occurrences untouched (P3, I4). |
| **Skip occurrence** | status flip guarded `WHERE status='upcoming'` | No change. |
| **Delete pay stub** | delete stub → delete linked income → reverse its balance adjustment iff the income's settlement marker is set (§3.5, §3.6) | Nothing deleted; balance untouched. |
| **Settle scheduled entry** | guarded marker claim (`balance_applied_at` NULL → now, assert exactly 1 row) → adjust balance by the signed amount (§3.6) | Entry stays scheduled with marker NULL; retried on next summary computation. A guard miss (already settled by another path) is a silent no-op, never a second adjustment. |

**Concurrency.** Two simultaneous mark-paid actions on one occurrence: the
claim-first order (§4 guard rule) admits exactly one winner *before* any
expense exists — the loser's claim changes zero rows, its transaction aborts,
and it observes "already paid" having written nothing: no orphan expense and
no balance change are possible, by construction rather than by cleanup (I3).
The same claim shape makes settlement safe under concurrent summary
computations (I9). Two simultaneous edits serialize on the transaction; the
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
| T1 | Mark an occurrence paid (new expense) → an expense exists, linked via `paid_expense_id`; balance reduced by the amount; Safe to Spend after equals its pre-pay value when the occurrence was reserving (deduction and release cancel) and never exceeds it (I2a). | D1, I2a |
| T2 | Log the payment as an expense first, then match it to the occurrence → no second expense, no second deduction; occurrence paid and linked; Safe to Spend rises by exactly the released reservation and no more (I2b); the expense's own settlement state is unchanged by the match. | D1, I3, I2b |
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
| T13 | Log income dated next week → balance and Safe to Spend unchanged today; entry listed as scheduled (marker NULL); when its date arrives, the balance adjusts exactly once and the marker is set (re-running summary does not re-apply). | D10, I9 |
| T14 | Materialize more upcoming occurrences than the display limit → the list states the truncation and true count; the list's contents are identical whether or not the galaxy was opened first. | D8, I7 |
| T15 | Concurrent mark-paid (two callers, one occurrence) → exactly one expense, one deduction, one paid occurrence; the loser gets a clean "already paid" result. | I3, §4 concurrency |
| T16 | Concurrent edit + mark-paid on the same bill → final state equals one of the two serial orders, complete in both dimensions (no lost occurrence, no orphan expense). | §4 concurrency |
| T17 | Double-submit / client retry of mark-paid, skip, and remove → end state identical to a single submission in each case. | §4 idempotence |
| T18 | Settlement idempotency across retries and boundary edits (R1): run the settlement sweep twice and concurrently → one adjustment, marker set once. Edit a scheduled entry's amount → no balance change; edit its date into the past → it settles inside the edit (exactly one adjustment). Edit a settled entry's date into the future → adjustment reversed, marker cleared; when the new date arrives it settles exactly once more. Delete a scheduled entry → no balance change; delete a settled entry → exactly one reversal. Fault-inject between the marker claim and the balance adjustment → the transaction rolls back (marker still NULL, balance unchanged) and a retry settles exactly once. | D10, I9 |
| T19 | Reservation eligibility is one rule across consumers (R1): a bill with one past-due unpaid and one future occurrence is removed — and, separately, deactivated without Remove → in both cases Reserved, Upcoming, and the Money Sky agree: the past-due occurrence is live (reserving/listed/rendered) and the future one is not; skipping the past-due occurrence then removes it from all three. | D2, I1, I5 |
| T20 | Losing concurrent Paid claim leaves nothing behind (R1, sharpens T15): two mark-paid (create) calls interleaved so the loser attempts its claim after the winner commits → the loser aborts at the claim; expense count and balance equal the winner-only values exactly (no orphan expense, no second deduction); the loser receives "already paid". Fault-inject the winner after its claim step → the claim rolls back with everything else: occurrence `upcoming`, zero expenses, balance untouched; a clean retry then succeeds exactly once. | I3, §4 guard rule |

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
      scheduled-vs-settled rule and its durable settlement mechanism §3.6,
      which changes how future-dated entries behave, and the backfill window
      §3.3).
- [ ] The transaction boundaries and invariants (§2, §4 — including R1's
      claim-first Mark-paid and the split I2a/I2b) are accepted as the
      implementation contract, with §5 (T1–T20) as the acceptance-test list.
- [ ] §6 remains out of scope — no bundling.
- [ ] The single additive migration specified in §8 (R1) —
      `balance_applied_at` on `fin_income`/`fin_expense`, migrateSchema-only,
      with the legacy backfill — is accepted. Any *further* schema need
      discovered in implementation stops work and returns to design.

## 8. Migration implications — one additive column (REVISED by R1)

**Revision record.** As originally drafted, this section claimed *no schema
change was required*. Design review round 1 (2026-10-22) showed that claim
cannot stand: §3.6's settlement contract needs durable state the baseline
does not have (verified: `fin_income` and `fin_expense` in
`packages/server/src/db/schemaSql.ts` carry dates, amounts, and `created_at`
only). The claim is therefore **replaced, openly**: exactly one additive
migration is required, specified below. The three "already exists" findings
of the original §8 were re-verified and **remain true and unchanged**:

- `fin_bill_occurrence.paid_expense_id` **already exists** (BOOTSTRAP_SQL,
  `packages/server/src/db/schemaSql.ts`, `fin_bill_occurrence` CREATE) and is
  already read/mapped by `FinBillRepo`; it is simply never written with a value.
- The `skipped` status **already exists** in the shared type
  (`BillOccurrenceStatus`, `packages/shared/src/types.ts:810`); the column is
  unconstrained TEXT, so no CHECK amendment is needed. It is simply never written.
- `fin_paystub.income_id` **already exists** and already links a stub to its
  generated income row (§3.5 builds on it).

**The one migration (for §3.6/I9):**

- Add `balance_applied_at TEXT` (nullable) to **`fin_income`** and
  **`fin_expense`**.
- Per the repo's schema rules, the column is added **only** in `migrateSchema`
  (`packages/server/src/db/client.ts`), as an additive, PRAGMA-guarded
  `ALTER TABLE` (`PRAGMA table_info` check per table, so it is idempotent and
  safe on every open). It is **not** added to BOOTSTRAP_SQL's CREATE
  statements — new columns are migration-only in this codebase.
- **Backfill, in the same guarded step:** every pre-existing row receives
  `balance_applied_at = created_at`. This is truthful, not cosmetic: under
  the pre-ADR-019 ledger model (financial-os decision D3) every existing row
  already adjusted the balance at creation, so each legacy row *is* applied.
  The backfill runs only when the column is first added, so it can never
  stomp a live marker.
- No new tables, no other columns, no CHECK changes. Anything beyond this
  migration discovered during implementation triggers §7's last gate item:
  stop and return to design for a further amendment to this ADR.

## 9. Doc/code note (D17)

`docs/financial-os/architecture.md` §4 defined Reserved with `due_date <
nextIncomeDate`; the engine implements `<=` (`finance/budget.ts`) — a bill due ON
payday is reserved. The code's behavior is the safer one and is adopted as the
designed behavior; the architecture doc is corrected alongside this ADR.
