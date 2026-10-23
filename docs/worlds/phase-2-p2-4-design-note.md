# Phase 2 · P2-4 Design Note — Journey Rewards + Dark Launch

**Status:** DRAFT for the review loop (owner + ChatGPT + Gemini). No implementation authorized. Sequencing: P2-4's BUILD waits for (a) the P2-3 post-merge audit to return and its findings to be triaged, and (b) the owner's separate implementation word — the lane discipline that held for P2-1…P2-3.

**What P2-4 is:** the last Phase 2 increment. (1) Journey bonuses start paying — server-side, at arrival, exactly once per journey, implementing the contract P2-1 defined. (2) The worlds travel layer launches: the dark flag flips, and the owner verifies on his device. Everything else about Phase 2 is already built and merged (P2-1 fuel primitives, P2-2 ledger, P2-3 web layer + Station).

## 1 · The crediting contract (already settled in P2-1 — implemented, not redesigned)

From `packages/server/src/economy.ts`:

- `JourneyBonusCreditor.creditJourneyBonus(journeyId, kind) → { credited, amount, balance }` — server-side, at arrival, **exactly once per journey**; `journeyId` is the idempotency key, so a retried arrival returns the original outcome instead of paying twice (reward honesty).
- Amounts are the shared constants: warp arrival **+5** (`EARN_JOURNEY_COMPLETE`), drift arrival **+3** (`EARN_JOURNEY_DRIFT`). P2-4 does not retune them.
- Crediting composes with the existing economy: `EconomyRepo.add()` (clamps at `FUEL_CAP`), lazy regen untouched, streak semantics untouched (worlds never touch them — standing rule).

## 2 · Where crediting hooks in

- Inside `TravelRepo`'s **arrival transition**, in the same `BEGIN IMMEDIATE` transaction that marks the journey `arrived` — the bonus and the arrival commit or fail together (the C2 atomicity pattern from P2-2). A crash between arrival and credit must be impossible, not merely unlikely.
- **Idempotency record — design decision for review.** Two honest shapes:
  - **(A, recommended) A marker on the journey row** (`bonus_credited_at`, plus `bonus_amount`): the guarded arrival update sets both; a retried arrival sees the marker and returns the recorded outcome. No new table, no census change (the travel tables joined `SPACE_SCOPED_TABLES` in P2-3).
  - (B) A separate `travel_journey_bonuses` table keyed by journey id: a purer ledger, at the cost of a new table, a census entry, and a join on every read.
  - Either way the schema touch follows the repo's dual-DDL rule (bootstrap + migration mirror) and is flagged here as the increment's one red-zone-adjacent change.
- The arrive **response** gains a sibling field — `{ journey, bonus }` — with `TravelJourney` itself unchanged. The P2-3 client reads `journey` and ignores the sibling today; P2-4's client work (§5) starts consuming it.

## 3 · THE DESIGN GATE — drift anti-farming (review 19 carry-forward, binding)

Drift travel is free and pays +3. Without an eligibility rule, looping drifts prints fuel. The gate designed here constrains **the bonus only — never the travel** (D-1: drift stays free and always available, farmed or not; a capped-out traveler simply earns nothing on further drifts that day, and is told so plainly if the UI surfaces it at all).

**Warp bonus (+5): no eligibility rule needed.** A warp costs 10 and pays 5 — farming it loses fuel by construction. Every completed warp arrival pays. (Turn-backs and cancels never arrive, so never pay.)

**Drift bonus (+3) pays only when ALL of these hold:**

1. **First credit for this journey** (the §2 marker) — retries and duplicate arrivals never re-pay.
2. **Honest elapsed time:** the server's own timestamps show `arrivedAt − departedAt ≥ 30 seconds`. The client cannot shorten server time; the floor sits below the client's 45 s drift presentation so an honest traveler always qualifies, while depart→arrive scripting earns nothing.
3. **Daily cap:** at most **2 drift bonuses per day, counted in the space's own timezone** (`getPreferences(...).timezone` — the same accessor the Chronicle uses; NO UTC boundaries anywhere, per the standing rule). Counted from credited drift arrivals in `travel_journeys`.

**Semantics at the edges (decided here, for review):**

- At fuel cap, an arrival still marks the journey credited with the amount recorded; the balance saturates as `add()` already does. No banking, no carry-over — the simpler, honest rule.
- An ineligible drift arrival is **not an error**: the journey completes normally, `bonus.credited` is false, and the amount is 0. Nothing about the traveler is punished, flagged, or shamed (never-punish invariant) — the bonus simply doesn't pay, and §5's UI says nothing celebratory about it.
- Eligibility is computed from the journey ledger alone — no new tracking of the user, no behavior profiles. The ledger already holds every fact used.

## 4 · Server confirmation before UI feedback (GH-19)

The P2-3 panel's arrival state is presentation only. P2-4 adds bonus feedback **only** from the server's `bonus` result in the arrive response: credited → a quiet "+N fuel — journey bonus" line with the new balance; not credited → no bonus line at all (never a fake celebration, never raw codes). If the arrive call fails, the panel shows the P2-2 plain-language error path and no bonus state — the next state refresh reconciles from the server, which is the only authority.

## 5 · Client work (small, bounded)

- `api/travel.ts`: type the `bonus` sibling on the arrive response.
- `useTravel`: expose the last arrival's bonus result from the arrive action's return (no polling changes; state refresh already reconciles balances).
- `TravelPanel`: render the §4 feedback line; nothing else changes. Route board prices/affordability already read server fuel, so the post-bonus balance appears on the next state load.

## 6 · The launch (separate, owner-run steps — not part of the build)

1. **Build lands dark:** crediting + client feedback merge with `WORLDS_TRAVEL_ENABLED` still `false`. Full gate.
2. **Launch commit:** the one-line flip to `true`, its own tiny PR, owner's merge tap.
3. **Deploy:** the owner deploys (his call, his timing — Fly).
4. **Device check (owner):** first live warp round trip home ↔ Great Station; the Station's §11 device numbers (owed since P2-3's disclosures) are taken here; drift bonus observed paying once, then the daily-cap behavior spot-checked against §3.

## 7 · Acceptance criteria

- **C1 — Exactly once:** retried, duplicated, and raced arrivals credit at most one bonus per journey; the recorded outcome is what retries return.
- **C2 — Atomicity:** no observable state has an arrived journey whose bonus outcome is undecided; killing the server mid-arrival leaves both or neither.
- **C3 — Gate integrity:** scripted instant drifts earn 0; a third eligible drift in one local day earns 0 and travels fine; the cap resets at local midnight in the space's timezone (test with a non-UTC space timezone).
- **C4 — Honesty:** the UI displays a bonus only when the server's response for that arrival says `credited`; balances shown always come from server state.
- **C5 — No regressions:** economy/streak/travel suites green; full web + server suites run (not targeted subsets — the P2-3 census catch is the standing lesson).

## 8 · Scope boundaries

No new worlds, no route-chart changes, no fuel retuning, no streak contact, no Station scene changes (its device numbers are a launch-check item, not a build item). Phase 3 (memory-bearing spaces) remains separately gated.

## 9 · Open questions for review

- Q1: §2 shape (A) marker-on-row vs (B) separate table — settled by review, implemented once.
- Q2: Is 2/day the right drift cap, and 30 s the right honesty floor? (Owner's feel for his own economy; the numbers are proposals, the structure is the gate.)
- Q3: Should an ineligible-bonus arrival be *silently* bonus-less (recommended) or carry a plain reason the UI may show ("today's drift bonuses are done — travel's still free")? The reason string, if any, is server-authored plain language.
