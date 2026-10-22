# Financial OS — Architecture (Phase 5)

> Technical design for the Financial OS module, mapped onto the **existing** Soumaya architecture.
> Depends on all prior docs in this package. **No implementation until this is reviewed + signed off**
> (Rule #1). This is a design; code comes after a roadmap/task-generation phase.

## 0. Design tenets (inherited, non-negotiable)
1. **Provider seams with an offline fallback.** OCR and LLM are swappable interfaces; there is always a
   no-key path (manual entry; deterministic math). Mirrors `embeddings/adapter.ts`, `llm/adapter.ts`,
   and `ResilientLlmProvider`.
2. **Repositories own SQL; services compose repos; routes are thin** (validate → delegate → json).
3. **Space-scoped everything.** Every table carries `space_id`; every repo takes a `spaceId` defaulting
   to `DEFAULT_SPACE`. New tables added to `TABLES_WITH_SPACE` in `auth/spaces.ts`.
4. **Additive, idempotent migrations.** Bootstrap `CREATE TABLE IF NOT EXISTS` in `db/schemaSql.ts` +
   guarded `ALTER TABLE` in `db/client.ts::migrateSchema`. Covered by a migration test.
5. **Money is sensitive by default.** Integer cents; redaction in logs; raw documents never egress except
   to the configured provider; aggregated snapshots preferred for LLM.
6. **Deterministic math, LLM only explains.** Balances/reserved/forecast are computed in plain TypeScript
   and are correct without any model. The LLM narrates and advises over already-correct numbers.

## 1. Where it lives (services within the ecosystem)

```
packages/server/src/
├── db/schemaSql.ts            + new CREATE TABLE bootstrap (fin_* tables)
├── db/client.ts               + migrateSchema guards for fin_* columns
├── ocr/adapter.ts             NEW seam: OcrProvider interface + providers + no-key fallback
│   ├── heuristic.ts           text/paste parser (no vision) — the offline path
│   ├── vision-llm.ts          uses the existing LLM vision capability (Gemini/OpenAI) if keyed
│   └── resilient.ts           degrades to heuristic on quota/credit/parse failure
├── finance/
│   ├── extract.ts             raw source -> structured candidate rows (uses OcrProvider)
│   ├── categorize.ts          payee -> category (rules + learned overrides), deterministic
│   ├── budget.ts              Budget Engine: balance, reserved, safe-to-spend (pure functions)
│   ├── bills.ts               recurring-bill occurrence materialization
│   ├── forecast.ts            Forecast Engine: cash-flow projection (Stage 3, pure functions)
│   └── snapshot.ts            compact financial snapshot for the AI Orchestrator
├── repositories/
│   ├── income.repo.ts         fin_income
│   ├── expenses.repo.ts       fin_expense
│   ├── bills.repo.ts          fin_bill + fin_bill_occurrence
│   ├── accounts.repo.ts       fin_account (balances, buffer, currency)
│   └── finSources.repo.ts     fin_source (retained raw uploads/paste + provenance)
├── agent/tools/
│   └── billRisk.ts            NEW tool-router tool: the overspend/short-bill nudge (Stage 1)
└── api/routes/finance.ts      thin, zod-validated endpoints (ingest, confirm, bills, budget, snapshot)

packages/shared/src/
└── schema.ts                  + FLAT zod schemas: FinIncome, FinExpense, FinBill, ExtractionResult, …

packages/web/src/
├── components/finance/*       Financial tab UI (home = Safe to Spend, ingest flow, bills, confirm)
└── api/finance.ts             typed client for the finance routes
```

## 2. Data model (SQLite, integer cents, space-scoped)

All tables carry `space_id TEXT NOT NULL DEFAULT 'legacy'` and are added to `TABLES_WITH_SPACE`.
Amounts are `INTEGER` **cents**. Dates are `TEXT` ISO-8601 (UTC), matching existing tables.

- **`fin_account`** — `id`, `space_id`, `name`, `currency` (Stage 1: one per space), `balance_cents`,
  `buffer_cents`, `updated_at`.
- **`fin_source`** — retained raw input + provenance. `id`, `space_id`, `kind`
  (`image|pdf|paste|manual`), `blob_ref` (path/opaque handle to the stored file; **not** inline in the
  row), `mime`, `created_at`, `extraction_json` (the raw provider output), `status`
  (`pending|confirmed|discarded`). Every committed income/expense references its `source_id`.
- **`fin_income`** — `id`, `space_id`, `source_id`, `date`, `gross_cents`, `net_cents`, `tax_cents`,
  `hours`, `platform`, `confidence`, `created_at`.
- **`fin_expense`** — `id`, `space_id`, `source_id`, `date`, `amount_cents`, `merchant`, `category`,
  `direction` (`out|in`), `confidence`, `created_at`. A dedup key
  (`amount_cents|date|merchant|source_kind`) guards double-counting.
- **`fin_bill`** — `id`, `space_id`, `name`, `amount_cents`, `frequency`
  (`weekly|biweekly|monthly|custom`), `anchor_date`/`due_day`, `autopay`, `category`,
  `grace_days`, `late_fee_cents`, `payee`, `account_last4` (**last 4 only, never full**), `active`.
- **`fin_bill_occurrence`** — materialized instances. `id`, `space_id`, `bill_id`, `due_date`,
  `amount_cents`, `status` (`upcoming|paid|skipped`), `paid_expense_id` (nullable), `paid_at`.
- **`fin_category_override`** — learned payee→category memory. `space_id`, `payee`, `category`.

**Knowledge-graph link (not denormalization):** financial *facts* stay in these tables. Financial
*intent* ("pay off the car," "save for an apartment") is a **goal/intention node** in the existing graph.
A lightweight join table **`fin_goal_link`** (`space_id`, `node_id`, `kind`, optional `target_cents`,
`target_date`) connects a savings/debt goal to its graph node so the Orchestrator can reason across both
without copying money rows into the graph. This honors the celestial/graph convention (enrich on read,
don't denormalize).

## 3. The OCR / ingestion pipeline

```
upload (image/pdf/paste/manual)
   → api/routes/finance.ts  (zod validate, size cap via express.json / multipart limit)
   → fin_source row created (raw retained, status=pending)
   → finance/extract.ts → OcrProvider.extract(source) → ExtractionResult (candidate rows + confidence)
        OcrProvider:
          - vision-llm  (if a vision-capable LLM key is configured)   [enhances]
          - heuristic   (paste/text parser; regex/line rules)          [always available]
          - resilient wrapper: try vision → on quota/credit/parse-fail → heuristic  [offline-safe]
   → finance/categorize.ts assigns suggested categories (rules + fin_category_override)
   → RETURN candidates to the UI for one-tap CONFIRM  (nothing is committed yet)
   → on confirm: repos write fin_income / fin_expense, link source_id, run dedup guard,
       recompute budget snapshot
```

Key decisions:
- **Confirm-before-commit.** Extraction is a *suggestion*; the user's confirmation is the source of truth.
  This keeps a wrong OCR read from silently corrupting the budget and satisfies "every number traceable."
- **Vision via the existing LLM seam.** We do not add a bespoke OCR SDK first; the initial `vision-llm`
  provider reuses the configured Gemini/OpenAI vision capability with a **flat** zod `responseSchema`
  (deep schemas are fragile with the API — house rule). A dedicated OCR engine (e.g. Tesseract/cloud OCR)
  can be added later as another `OcrProvider` implementation behind the same interface.
- **Raw blobs stored out-of-row** (`blob_ref`), space-scoped, on the same persistent volume as SQLite;
  never inlined into JSON responses; never sent anywhere except the configured provider.

## 4. Budget Engine (deterministic, the core)

Pure functions in `finance/budget.ts`, no LLM:

```
reserved(now, nextIncomeDate)  = Σ occurrence.amount_cents for unpaid fin_bill_occurrence
                                   with due_date <= nextIncomeDate
                                   (corrected 2026-10-22 per ADR-019 §9: the engine's
                                   `<=` — a bill due ON payday is reserved — is the
                                   designed behavior; the earlier `<` here was stale)
safeToSpend                    = account.balance_cents − reserved − account.buffer_cents
shortfall                      = max(0, reserved + buffer − balance)   // shown explicitly if > 0
weekEarned                     = Σ fin_income.net_cents in [weekStart, now]
```

- `nextIncomeDate` in Stage 1 is estimated from the user's recent income cadence (median gap between
  income events) or a user-set pay cadence; Stage 3 replaces the estimate with the Forecast Engine.
- The engine returns a fully **itemized** result (each reserved line) so the UI shows the Rent/Insurance/
  Car/Phone breakdown and the AI can cite it. Recomputed on every income/expense/bill change (cheap;
  it's sums over small per-space sets).

## 4.1 Bill occurrence lifecycle (ADR-019, design settled 2026-10-22)

The occurrence lifecycle is specified by **docs/ADR-019-bill-lifecycle.md** (owner
decisions D8 in decisions.md). Summary of the contract this architecture must honor:

- **State machine:** `upcoming → paid | skipped`, terminal states immutable.
  Eligibility is one rule (ADR-019 I1): an occurrence is *live* iff `upcoming`
  and (bill active **or** past-due unpaid); it *reserves* iff live and within
  the horizon. The same `live` predicate governs Upcoming and the Money Sky.
- **Every lifecycle operation is one SQLite transaction** spanning all of its
  writes (expense insert + balance adjustment + occurrence flip for Paid; template
  deactivation + future-occurrence cancellation for Remove; template update +
  eligible-occurrence rewrite for Edit; stub + linked income + balance reversal
  for pay-stub deletion). Balance adjustments go through `FinAccountRepo` **inside**
  the justifying transaction — never as a separate call.
- **Status flips are guarded and asserted** (`WHERE status = 'upcoming'`, exactly
  one row or the transaction aborts), and Mark-paid claims the occurrence
  *before* creating anything — so concurrent or retried operations admit
  exactly one winner, losers write nothing, and retries converge idempotently
  (ADR-019 §4).
- **Materialization is a defined step,** not a read side effect: bounded window
  (today − 35d … budget horizon), idempotent under the `fin_occ_unique` index,
  triggered independently of which screens were visited.
- **Two calendars are banned:** all user-facing money day boundaries (summary,
  Money Sky, web relative dates) use the space's configured timezone.
- **Scheduled vs settled:** future-dated income/expense rows do not touch the
  balance until their date arrives, then settle exactly once — proven by the
  durable `balance_applied_at` marker, the sole authority on applied-ness;
  edits and deletes key their balance effects to the marker, never to date
  re-derivation (ADR-019 §3.6, I9).
- **One additive migration** is required (ADR-019 §8 as revised by R1):
  `balance_applied_at` on `fin_income`/`fin_expense`, migrateSchema-only,
  PRAGMA-guarded, legacy rows backfilled as applied. `paid_expense_id`,
  `fin_paystub.income_id`, and the `skipped` status value already exist.

## 5. Proactive coaching (tool-router, Stage 1)

A new tool `agent/tools/billRisk.ts` follows the existing tool contract (`detect()` + `run()`,
rate-limited, writes `agent_logs`, notifies in Soumaya's voice), exactly like the memory tools:
- **detect:** at most once/day; true when today's spend pace projects a shortfall on the next unpaid,
  non-autopay bill occurrence.
- **run:** emit the nudge — LLM-phrased if keyed (*"If you spend more than $42 today, your insurance
  payment will be short"*), else a deterministic template with the same numbers. Gentle, dismissible,
  never blocks UI.

## 6. AI Orchestrator integration (Stage 2)

`finance/snapshot.ts` produces a compact, **aggregated** `FinancialSnapshot` (balance, reserved total +
top lines, safe-to-spend, week earned, upcoming bills, active goals from `fin_goal_link`). This is
injected into the GraphRAG system context the same way memory context is today, so chat can answer
money questions with citations. **Only the aggregated snapshot** (not raw statements or full transaction
logs) is handed to a cloud LLM by default; raw-document Q&A is opt-in. The LLM never computes totals — it
reads the snapshot's numbers.

## 7. Forecast Engine (Stage 3)

Pure functions in `finance/forecast.ts`: project weekly cash flow from (a) recurring bill occurrences and
(b) expected income modeled from historical cadence (e.g. trailing median weekly net, optionally
shift-count-scaled). Scenario questions ("three extra shifts," "PS6 next month," "apartment when?") are
answered by running the projection with adjusted inputs and comparing against `fin_goal_link` targets.
Deterministic; the LLM phrases the answer.

## 8. Security & privacy (explicit)
- **Scoping:** `requireSpace` + `spaceOf(res)` on every finance route; every repo query filtered by
  `space_id`; new tables in `TABLES_WITH_SPACE`. A `knn`-style cross-space leak is impossible because
  these are relational lookups, always filtered.
- **At rest:** raw blobs and the SQLite DB live on the persistent volume; document a follow-up for
  volume/at-rest encryption. Store only last-4 of any account/card, never full numbers.
- **In transit / to providers:** raw documents go only to the explicitly-configured OCR/LLM provider;
  aggregated snapshots preferred for LLM Q&A; a per-space toggle governs whether raw-doc Q&A is allowed.
- **Logs:** financial amounts and payees redacted from server logs; the central error handler must not
  echo request bodies containing money data.
- **No secrets/model-ids** in committed files (house rule).

## 9. Migrations & rollout safety
- All `fin_*` tables via bootstrap `CREATE TABLE IF NOT EXISTS`; any later column via guarded
  `ALTER TABLE` in `migrateSchema`. Add coverage to the existing migration test so a deploy can never
  crash boot on an existing Fly volume.
- The module ships behind its own **Financial tab**; if a user never opens it, nothing about the galaxy/
  memory experience changes. Fully additive.

## 10. Staged build sequence (feeds Phase 6/7 roadmap + task generation — NOT built yet)
1. **Schema + repos + migration test** (`fin_*` tables, space-scoped).
2. **Manual entry + bills + Budget Engine + Financial tab** — delivers Safe-to-Spend with zero AI. Proves
   the core loop offline.
3. **Ingestion: paste/heuristic OcrProvider + confirm flow** — screenshots/paste with no cloud key.
4. **Vision OcrProvider (resilient)** — auto-extraction when a key exists; degrades to (3).
5. **billRisk tool-router nudge** — the one proactive coach moment.
6. **Snapshot + chat Q&A (Stage 2)**, then **Forecast Engine + scenarios (Stage 3)**.

## 11. Open questions for sign-off (resolve before roadmap)
1. **Storage of raw blobs:** filesystem on the Fly volume vs. a `BLOB` column — and do we require at-rest
   encryption for Stage 1 or accept it as a fast-follow?
2. **Multi-currency / multi-account:** Stage 1 assumes one currency + one adjustable balance per space.
   When do multiple accounts become required?
3. **Balance source of truth:** user-set-and-adjust (proposed) vs. derived-from-ingested-transactions —
   or a reconcile flow between the two?
4. **Vision provider:** reuse the existing LLM vision path first (proposed), or introduce a dedicated OCR
   provider (Tesseract/cloud) in Stage 1?
5. **UX phase:** this package stops at architecture; a **Phase 4.5 `docs/financial-os/ux-design.md`** is
   required before any screen is built (per the workflow's UI rule).
