# Financial OS — User Stories (Phase 4)

> Concrete scenarios that the module must satisfy, with acceptance criteria. Depends on
> [requirements.md](./requirements.md). Read next: [architecture.md](./architecture.md). Stage tags
> match the requirements doc (**Stage 1 = MVP**).

Persona: **Ray**, a gig worker (GoPuff + DoorDash), irregular weekly income, fixed bills (rent, car,
insurance, phone), a goal to move into an apartment. Talks to Soumaya already.

---

## Epic A — Get money in without typing (Stage 1)

### A1. Log gig earnings from a screenshot
*As Ray, I snap my GoPuff weekly-earnings screen so my income is counted without typing numbers.*
- **Given** I'm on the Financial tab, **when** I add income and pick a screenshot,
  **then** the system extracts date, amount, platform, and hours and shows them for confirmation.
- **When** I tap Confirm, the income is recorded, the source image is retained and linked, and my
  live budget updates immediately.
- **If** no OCR provider is configured, I get the manual-entry form instead (never a dead end).
- **If** the same screenshot is uploaded twice, I'm warned about a likely duplicate before it commits.

### A2. Log a pay stub (PDF)
*As Ray, I upload a pay stub PDF and get gross, net, taxes, and hours parsed.*
- Extraction shows each field with a confidence hint; low-confidence fields are flagged for review.
- Missing fields (e.g. no hours on the stub) are allowed; the record still saves.

### A3. Capture an expense from a bank screenshot / receipt
*As Ray, I screenshot my bank transactions (or snap a receipt) and the purchases are categorized.*
- Each extracted transaction gets a suggested category I can change in one tap.
- When I correct a payee's category, the system remembers it for next time.
- Amounts are stored in cents; direction (in/out) is detected.

### A4. Paste Cash App / Venmo history
*As Ray, I paste my Cash App history as text and the line items are parsed into income/expenses.*
- The paste parser works even with **no** OCR/vision key (it's plain text).

### A5. Manual entry always works
*As Ray, offline on the subway, I add a $12 cash lunch by hand.*
- The manual form commits without any network, OCR, or LLM call.

---

## Epic B — Bills, once (Stage 1)

### B1. Create a recurring bill
*As Ray, I enter rent once so I never re-type it.*
- I set name, amount, due date, frequency, autopay; optionally grace period / late fee / payee.
- The system knows the **next** due occurrence and shows it in the budget's Reserved breakdown.

### B2. Mark a bill paid
*As Ray, I mark the car payment paid, or it auto-matches an ingested expense.*
- A paid occurrence leaves Reserved; the next occurrence is scheduled.
- Autopay bills are assumed to clear on their due date unless the balance can't cover them (then flagged).
- **Semantics settled 2026-10-22 (D8 / ADR-019):** marking paid records a real
  expense, deducts it from my balance, and links the two — all at once, or not at
  all. If I already logged the payment, I match it instead of double-counting.
  Paying a bill never makes my Safe to Spend go *up*.

### B3. Remove a bill I no longer have
*As Ray, I cancel a subscription so it stops shadowing my budget.*
- The bill stops recurring and its future charges stop reserving immediately.
- What I already paid stays in my history. A charge that's already past due stays
  visible until I deal with it — it's never silently erased.

### B4. Edit a bill
*As Ray, my rent went up — I change it once and my budget believes me.*
- The new amount/schedule applies to future unpaid charges; the bill never
  appears twice or reserves twice. Charges already paid (or already past due)
  keep the amounts they actually had.

### B5. Skip one occurrence
*As Ray, I'm not paying the gym this month, but the bill itself lives on.*
- This month's charge stops reserving and leaves my upcoming list; it stays in
  history marked skipped. Next month's charge arrives normally.

---

## Epic C — Know what's safe to spend (Stage 1, the core)

### C1. See Safe to Spend
*As Ray, I open the Financial tab and immediately see what's actually mine to spend.*
- I see **Current Balance**, an itemized **Reserved** list (Rent $600, Insurance $250, Car $210, Phone
  $70), and **Safe to Spend** (e.g. $10).
- The number recomputes live as I add income/expenses.
- A shortfall is shown as an explicit labeled "short by $X" (with icon + text, not color alone), never a
  misleading positive number.

### C2. The weekly picture
*As Ray, I see "You've earned $743 · Bills due this week: Insurance, Car · Safe to Spend $Y".*
- This summary is the module's home view and matches the live numbers.

---

## Epic D — Be coached before I slip (Stage 1 nudge → Stage 2 more)

### D1. Overspend warning before it happens
*As Ray, before I overspend, Soumaya warns me a bill will be short.*
- **Given** insurance ($250) is due Friday and my pace leaves it short, **when** the daily check runs,
  **then** Soumaya says, in her voice, *"If you spend more than $42 today, your insurance payment will be
  short."*
- The nudge fires **at most once/day**, is dismissible, and never blocks the UI.
- **If** no LLM key is set, the same warning is delivered from a deterministic template (still useful).

### D2. (Stage 2) Gentle prompts
- Low Safe-to-Spend heads-up; a "log this week's earnings?" prompt on my gig cadence; a bill-due-tomorrow
  reminder for non-autopay bills. All gentle, rate-limited, non-punishing.

---

## Epic E — Ask questions in plain language (Stage 2 → Stage 3)

### E1. (Stage 2) "How much do I need to earn this week to stay on track?"
- Soumaya answers from the computed snapshot + my bills, citing the numbers. The math is deterministic;
  she explains it.

### E2. (Stage 3) Scenario forecasting
*As Ray, I ask "if I work three extra shifts, can I pay off this credit card this month?"*
- She projects cash flow from my earning cadence + bills and answers against my goals.
- Also supports: *"can I afford a PS6 next month?"*, *"when can I move into an apartment?"* — answered in
  the context of the apartment goal that already lives in my knowledge graph.

---

## Epic F — Trust & safety (all stages)

### F1. My money data is private and scoped
*As Ray, my finances live only in my space and are treated as sensitive.*
- Every record is `space_id`-scoped; nothing leaks across brains.
- Financial values are redacted from logs; raw statement images aren't sent to any third party except the
  provider I configured, and aggregated snapshots are preferred over raw docs for LLM Q&A.

### F2. Every number is traceable and correctable
*As Ray, when a number looks wrong, I can find why.*
- Each committed record links to its source (image/paste/manual) with a timestamp, so I can open the
  original and fix the extraction.

---

## Acceptance summary (MVP / Stage 1 "definition of done")
- Ray reaches a trustworthy **Safe to Spend** in under 5 minutes having typed **zero** dollar amounts.
- Income + expenses ingest from screenshots/paste/manual; duplicates are caught; sources are retained.
- Recurring bills drive an itemized Reserved; Safe to Spend is live and honest.
- At least one real overspend nudge fires in Ray's voice before a bill is missed.
- The entire flow works with no OCR key and no LLM key (manual + deterministic paths).
