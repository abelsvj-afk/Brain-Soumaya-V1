# P2-1 Design Note — Fuel Primitives (Phase 2, increment 1)

**Lane:** default (design note → build → full gate → owner's merge tap → ChatGPT audit of the increment). Additive only: no schema change, no migration, no route, no UI.
**Authorized:** D-34 (owner, 2026-10-22) — P2-1 only, per `phase-2-planning.md` §6–§7 (Rev 44 boundaries). Base: deploy branch `claude/soumaya-second-brain-v1-m4z4hc` @ `d7493eb`; every touched file verified byte-identical to that head before editing (types.ts had drifted — its live text is the base).

## Changes
1. **`packages/shared/src/economy.ts`** — three constants beside the existing ones:
   - `WARP_COST = 10` — priced against the live yardsticks: `EARN_MEMORY` 15 (one captured memory funds a warp with change), regen 3.5/hr (~84/day: several warps a day on regen alone — a quiet week cannot strand a brain, D-33's bad-week rule), `FUEL_JOB_COST` 2 (warp is a major act, priced like one).
   - `EARN_JOURNEY_COMPLETE = 5` — warp-arrival rebate. A warp never nets positive (10 out, 5 back): journeys rebate travel, they don't farm it.
   - `EARN_JOURNEY_DRIFT = 3` — drift-arrival bonus, on the scale of `EARN_LINK`/`EARN_REVIEW`; the slow free gait still counts as a journey.
2. **`packages/shared/src/types.ts`** — `Fuel` gains a required `warpCost: number` (the shared-numbers rule: web labels read it, never restate it). The one typed literal in the web tests is updated to match (below).
3. **`packages/server/src/economy.ts`** — re-export the three constants; `EconomyRepo` gains `spendWarp(): boolean` (the existing `spend()` refusal semantics: no partial debit, never negative) and `canWarp(): boolean`; `toFuel()` includes `warpCost`. Plus the **journey-bonus contract as types only** — `JourneyKind`, `JourneyBonusResult`, `JourneyBonusCreditor` (`creditJourneyBonus(journeyId, kind)`; `journeyId` is the idempotency key). **Defined here, implemented in P2-4 against the P2-2 ledger** — no runtime crediting path exists after P2-1, by design (review 18).
4. **Web test fixtures** — `cl1a.test.tsx`'s typed `Fuel` literal and `FuelGauge.smoke.test.tsx`'s factory gain `warpCost` (contract consistency only; no component changes).
5. **`packages/server/src/__tests__/economyWarp.test.ts`** (new) — warp spend debits exactly `WARP_COST`; refusal at insufficient balance leaves the balance untouched; repeated spends never drive the balance negative; `canWarp` tracks the balance; `add()` still saturates at `FUEL_CAP`; the D-33 economics as constant invariants (`WARP_COST < EARN_MEMORY`; `EARN_JOURNEY_COMPLETE < WARP_COST`; `EARN_JOURNEY_DRIFT < EARN_JOURNEY_COMPLETE`). Regen behavior is already covered by `features.test.ts` and is untouched.

## Non-goals (explicit)
No journey ledger (P2-2) · no routes or state machine (P2-2) · no web travel UI (P2-3) · no bonus crediting implementation (P2-4) · no flag, no deploy.

## Gate
Tests authored with the code; typecheck/tests run through the repo's established flow before merge (this sandbox does not run the repo suite — recorded, not waived, per standing practice). Merge is the owner's tap; deployment and everything after remain unauthorized.
