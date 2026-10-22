# Financial OS — Roadmap & Task Breakdown (Phase 6/7)

> The implementation plan, staged. This feeds Phase 8 task generation. **Still design** — building starts
> only on the user's go. Every task keeps the gate green (`typecheck && test && build`), is space-scoped,
> additive/idempotent in migrations, and offline-safe. Depends on all prior docs in this package.

## Sequencing principle
Deliver **trustworthy value with zero AI first** (Stage 1a: manual + bills + budget), then layer ingestion
(1b), then the one coach moment (1c), then Q&A (2), then forecasting (3). Each stage is shippable and
useful on its own.

---

## Stage 1a — Core budget, no AI (proves the loop offline)
**Outcome:** a user can set a balance, add bills, and see a live, honest **Safe to Spend** — fully offline.

1. **Schema + migrations.** `fin_account`, `fin_bill`, `fin_bill_occurrence`, `fin_expense`, `fin_income`,
   `fin_source`, `fin_category_override`, `fin_goal_link` via bootstrap `CREATE TABLE IF NOT EXISTS`
   (`db/schemaSql.ts`) + guarded `ALTER` scaffolding (`migrateSchema`). Add all to `TABLES_WITH_SPACE`.
   **Test:** extend the migration test (fresh + existing-volume upgrade both boot clean).
2. **Repositories** (space-scoped, integer cents): `accounts.repo.ts`, `bills.repo.ts` (+ occurrence
   materialization), `expenses.repo.ts`, `income.repo.ts`, `finSources.repo.ts`. **Unit tests** per repo.
3. **Budget Engine** (`finance/budget.ts`, pure): `reserved`, `safeToSpend`, `shortfall`, `weekEarned`,
   `nextIncomeDate` estimate. **Table-driven unit tests** (this is the heart — test it hard).
4. **Bills engine** (`finance/bills.ts`): next-occurrence materialization for each frequency; mark-paid.
5. **Routes** (`api/routes/finance.ts`, thin + zod): account get/set, bill CRUD, occurrence mark-paid,
   manual income/expense create, budget summary. 400-with-issues on bad input. **Shared flat zod schemas.**
6. **Web:** `FinanceTab` + `SafeToSpendHome` + `ManualEntryForm` + `BillsList`/`BillForm`/`BillDetail` +
   `FinanceSettings` (enable flag, buffer, currency). `api/finance.ts` typed client. **Mobile-first**;
   validated on a phone-width render.
**Definition of done:** Safe to Spend is live + honest from manual data, offline, on mobile.

## Stage 1b — Ingestion (screenshots/paste, zero-typing)
**Outcome:** income/expenses come in from screenshots and pasted history; user only confirms.

7. **OCR seam** (`ocr/adapter.ts`): `OcrProvider` interface; `heuristic.ts` (paste/text parser — the
   always-on offline provider); `resilient.ts` wrapper.
8. **Extraction + categorize** (`finance/extract.ts`, `finance/categorize.ts`): source → candidate rows;
   payee→category rules + `fin_category_override` learning; dedup guard.
9. **Ingest routes:** upload/paste → `fin_source` (raw retained, `status=pending`) → extract → return
   candidates; confirm → commit + recompute. Blob storage per **D1** (files on volume, `blob_ref`).
10. **Web:** `AddSheet` (camera-first) + `ExtractionConfirm` (editable draft, source thumbnail, duplicate
    banner) + `PasteImport`. **Tests** for the paste parser + dedup.
**Definition of done:** paste/manual works with **no key**; confirm-before-commit; sources traceable.

## Stage 1c — Vision extraction + the one coach nudge
11. **`vision-llm` OcrProvider** (per **D4**): reuse the LLM vision path with a **flat** zod
    `responseSchema`; resilient fallback to heuristic on quota/parse failure.
12. **`agent/tools/billRisk.ts`** tool-router tool: once/day; detect projected shortfall on the next
    unpaid non-autopay bill; nudge in Soumaya's voice (LLM-phrased if keyed, deterministic template else).
    Follows the existing `detect()/run()` + `agent_logs` + rate-limit contract. **Test** the detect logic.
**Definition of done:** auto-extraction when keyed (degrades cleanly); ≥1 real overspend nudge fires.

## Stage 1d — Bill lifecycle repair (design settled 2026-10-22; ADR-019)

Sequencing rule (owner, 2026-10-22): **fix the bill lifecycle before adding more
features to the Money tab.** The 2026-10-22 trace found Paid/Remove/Edit each
silently corrupting the budget's outputs during ordinary use. This stage restores
trustworthy behavior per **docs/ADR-019-bill-lifecycle.md** (decisions D8):
atomic paid-with-expense-linkage (+ match), remove-cancels-future, edit-rewrites-
eligible-future, per-occurrence skip; plus the no-decision corrections (space-tz
Money Sky day + web relative dates, bill-risk due-date passthrough, bounded
repeatable backfill, pay-stub deletion safety, scheduled-vs-settled entries,
visible/stable Upcoming scope) and the ADR-019 §5 acceptance tests. Includes
one additive migration (`balance_applied_at`, per ADR-019 §8 as revised by
design review R1). **Status:
design only — implementation awaits the ADR-019 design gate and a separate owner
authorization.** Explicitly NOT in this stage: engagement rewards, zero-based
budgeting vs Wealth, multi-account, and the unbuilt D12–D16 features (ADR-019 §6).

## Stage 2 — Conversational Q&A + reconcile
13. **`finance/snapshot.ts`** → aggregated `FinancialSnapshot`; inject into GraphRAG context (like memory
    context). **Redaction per D5** (aggregated only; raw-doc Q&A opt-in, default off).
14. **`fin_goal_link`** wired to knowledge-graph goal nodes so answers use the user's goals.
15. **Reconcile flow (D3):** compare running balance vs. ingested net flow; one-tap "set balance to $X" +
    last-reconciled timestamp.
16. **Stage 2 nudges:** low-Safe-to-Spend heads-up; "log this week's earnings?" on gig cadence; bill-due
    reminders (non-autopay).
**Definition of done:** "how much do I need to earn this week?" answered from real numbers + goals, cited.

## Stage 3 — Forecasting + scenarios
17. **`finance/forecast.ts`** (pure): weekly cash-flow projection from bills + modeled income cadence.
18. **Scenario Q&A:** "PS6 next month?", "three extra shifts → clear the card?", "apartment when?" — run
    the projection with adjusted inputs vs. `fin_goal_link` targets; LLM phrases the answer.
19. **Debt-payoff (snowball/avalanche) + savings-goal projection** with target dates.
20. **Multi-account/currency (D2)** if needed by then (additive: more `fin_account` rows).

## Cross-cutting hardening (fold into each stage, formalize before "GA")
- **Security (D1/D5):** log redaction of amounts/payees; central error handler never echoes money bodies;
  last-4-only for accounts; **Stage 2:** at-rest encryption of raw blobs (Fly-secret key).
- **Accessibility:** never color-only; reduced-motion; SR labels on every amount/state.
- **Observability:** per-stage, add the same lightweight logging/metrics the rest of the app uses.
- **Docs sync:** update `architecture.md`/`requirements.md` on any change (workflow doc standard).

## Suggested first PR (when the user says go)
Stage 1a tasks 1–3 only: **schema + repos + Budget Engine with tests** — no UI, no routes yet. It's the
riskiest correctness surface (the money math) and the cleanest thing to review in isolation, and it can't
regress anything user-facing. UI + routes follow once the engine is proven.
