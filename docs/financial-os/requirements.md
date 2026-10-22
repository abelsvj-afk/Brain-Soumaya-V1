# Financial OS — Requirements (Phase 3)

> Detailed requirements for the Financial OS module. Depends on [idea.md](./idea.md) +
> [vision.md](./vision.md). Read next: [user-stories.md](./user-stories.md) →
> [architecture.md](./architecture.md). Requirements are staged; **Stage 1 = MVP**.

Legend: **[M]** must-have for its stage · **[S]** should-have · **[C]** could-have/later.

## 1. Inputs & ingestion (the make-or-break)

### 1.1 Supported inputs — Stage 1
- **[M]** Image upload / camera capture of: pay stubs, gig-earnings screenshots (GoPuff, DoorDash, Uber,
  Spark), bank-transaction screenshots, receipts, utility/loan/insurance statements.
- **[M]** PDF upload (pay stubs, statements, bills).
- **[M]** Pasted text (Venmo / Cash App / bank export lines).
- **[M]** Manual entry form for a single income event or expense (the always-available fallback + offline
  path).
- **[C]** Bank-link import (Plaid-style) as an *optional* input adapter — explicitly deferred; must not be
  a dependency of any core feature.

### 1.2 Extraction (OCR + structuring) — Stage 1
- **[M]** For income, extract: `date`, `gross_amount`, `net_amount`, `platform_or_employer`, `hours`
  (if present), `taxes` (if present). Missing fields are allowed and flagged, never blocked.
- **[M]** For expenses/transactions, extract: `date`, `amount`, `merchant_or_payee`, `direction`
  (in/out), and a **suggested category**.
- **[M]** Every extraction is **confirmed by the user in one tap** before it is committed; the raw source
  (image/text) is retained and linked so a correction is always possible.
- **[M]** Auto-categorization of expenses into a fixed starter taxonomy (housing, transport, food,
  utilities, insurance, debt, subscriptions, childcare/support, healthcare, misc). Category is editable;
  the system remembers a payee→category correction.
- **[S]** Confidence score per extracted field; low-confidence fields are highlighted for review.
- **[M]** **Offline/no-key fallback:** if no vision provider is configured, ingestion falls back to
  manual entry (the paste parser still works for structured text). No feature may hard-fail without OCR.

### 1.3 Deduplication & integrity — Stage 1
- **[M]** Detect and warn on likely duplicate income/expense entries (same amount + date + source) so a
  re-uploaded screenshot doesn't double-count.
- **[M]** All amounts stored as **integer minor units (cents)**; a single currency per space in Stage 1.

## 2. Recurring bills — Stage 1
- **[M]** Create a recurring bill once with: `name`, `amount`, `due_day`/`due_date`, `frequency`
  (weekly / biweekly / monthly / custom), `autopay` (bool), `category`.
- **[S]** Optional: `grace_period_days`, `late_fee`, `payee`, linked account/last-4 (never a full number).
- **[M]** The system materializes the **next occurrence(s)** of each bill and tracks paid/unpaid.
- **[M]** Mark a bill occurrence paid (manually, or matched to an ingested expense).
  **Lifecycle semantics settled 2026-10-22 (decision D8 / ADR-019):** marking paid
  records the payment as a real expense, deducts it from the tracked balance, and
  links it via `paid_expense_id` in one atomic operation; an existing payment may
  be matched instead of duplicated; failure leaves the occurrence unpaid.
- **[M]** Removing a bill stops recurrence **and** cancels its future scheduled
  occurrences; payment history is preserved; past-due unpaid occurrences remain
  visible until the user explicitly resolves them (D8 / ADR-019).
- **[M]** Editing a bill applies the new amount/schedule to eligible future unpaid
  occurrences without duplication; paid occurrences, historical amounts, and
  past-due unpaid occurrences are unchanged (D8 / ADR-019).
- **[M]** A single occurrence may be **skipped**: it stops reserving, leaves
  upcoming-unpaid, remains in history as skipped, and the recurring bill is
  unaffected (D8 / ADR-019).
- **[M]** Occurrence materialization is bounded, repeatable, and independent of
  which screens were visited (backfill window: today − 35d through the budget
  horizon) — ADR-019 §3.3.
- **[M]** Entries dated after the space-local today are **scheduled**: stored and
  listed as scheduled, they do not move the tracked balance until their date
  arrives, when they settle exactly once — ADR-019 §3.6.
- **[S]** Autopay bills are surfaced but assumed to clear on the due date unless balance can't cover them.

## 3. Live budget — Stage 1 (the core deliverable)
- **[M]** Maintain a **current balance** (user-set/adjustable; later reconcilable against ingested data).
- **[M]** Compute **Reserved** = sum of bill occurrences due before the next expected income date (with a
  clear, itemized breakdown: Rent $600, Insurance $250, …).
- **[M]** Compute **Safe to Spend** = current balance − reserved − any user-set buffer, never below 0 in
  display (but the true negative shortfall is shown explicitly as "short by $X").
- **[M]** Present the "You've earned $X this week / Bills due this week / Safe to Spend $Y" summary from
  the idea doc as the module's home view.
- **[M]** Recompute live as income and expenses are recorded; the number is never stale.
- **[S]** A user-configurable **buffer** ("always keep $50 untouched").

## 4. Proactive coaching — Stage 1 (one nudge) → Stage 2 (more)
- **[M, Stage 1]** A single tool-router tool that fires at most once/day: when today's spending pace would
  make an upcoming bill short, Soumaya says so in her voice
  (*"If you spend more than $42 today, your insurance payment will be short"*).
- **[S, Stage 2]** Low-Safe-to-Spend heads-up; "log this week's earnings?" prompt on a gig-work cadence;
  bill-due-tomorrow reminder for non-autopay bills.
- **[M]** All nudges are gentle, rate-limited, non-punishing, dismissible, and never block the UI
  (consistent with the app's toast/gamification rules).

## 5. Conversational Q&A over finances — Stage 2
- **[M]** Soumaya chat can answer questions grounded in a computed **financial snapshot** and the user's
  goals from the knowledge graph: *"how much do I need to earn this week to stay on track?"*
- **[M]** Answers cite the underlying numbers (like memory citations today). The **math is deterministic**;
  the LLM explains, it does not compute the totals.
- **[S]** Redaction: the snapshot handed to a cloud LLM is aggregated (balances, totals, upcoming bills),
  not raw statement images or full transaction logs, unless the user opts in.

## 6. Forecasting — Stage 3
- **[C→M by Stage 3]** Cash-flow projection over N weeks/months from recurring bills + expected income
  (modeled from historical earning cadence).
- **[M, Stage 3]** Scenario questions: *"can I afford a PS6 next month?"*, *"if I work three extra shifts,
  can I pay off this credit card?"*, *"when can I move into an apartment?"* — answered against the forecast
  and the user's goals.
- **[S]** Debt-payoff planning (snowball/avalanche) and savings-goal projection with a target date.

## 7. Cross-cutting / non-functional
- **[M] Multi-tenancy:** every table carries `space_id`; all queries space-scoped (per the repo
  convention). No query ever crosses spaces.
- **[M] Security & privacy (sensitive-by-default):** raw uploaded statements/screenshots are stored
  space-scoped and access-controlled; financial values are redacted from logs; no third-party egress of
  raw source documents except to the explicitly-configured OCR/LLM provider, and even then aggregated
  where possible. At-rest protection strategy defined in [architecture.md](./architecture.md).
- **[M] Offline-safe:** the whole module (manual entry, bills, live budget, deterministic forecast math)
  works with **no** OCR key and **no** LLM key. Cloud providers only *enhance* (auto-extraction, natural
  language) and degrade gracefully on quota/credit errors (mirror `ResilientLlmProvider`).
- **[M] Additive & idempotent migrations:** new tables/columns via bootstrap `CREATE TABLE IF NOT EXISTS`
  + guarded `ALTER TABLE`, so an existing volume upgrades in place and a deploy can never crash boot.
- **[M] Thin, validated routes:** every endpoint validates its body with zod and returns 400 with issue
  detail on bad input; routes delegate to services; services compose repositories.
- **[M] Accessibility:** honor `prefers-reduced-motion`; never encode meaning in color alone (a shortfall
  is shown with a label/icon + number, not just red). Amounts have text alternatives.
- **[S] Auditability:** every committed financial record links back to its source (image/paste/manual) and
  records who/when, so a wrong number is always traceable and correctable.

## 8. Explicit out-of-scope (this module)
- Full double-entry accounting / GAAP.
- Investment portfolio tracking, crypto, real-time market data.
- Tax filing (Stage-later "tax estimate" is a summary, not a return).
- Money movement / payments execution (the app never *pays* a bill; it advises).
