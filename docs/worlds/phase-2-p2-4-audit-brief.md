# P2-4 Audit Brief — for the reviewing agent (ChatGPT)

**Repository:** `abelsvj-afk/Brain-Soumaya-V1` · **PR:** #102 · **Branch:** `worlds/p2-4-rewards` · **Base:** `claude/soumaya-second-brain-v1-m4z4hc` @ `570128c`
**Design of record:** `docs/worlds/phase-2-p2-4-design-note.md` (this branch). The three open questions were settled by the owner on 2026-10-23, unadjusted from the note's recommendations: **Q1** marker-on-row idempotency · **Q2** 30-second floor, max 2 drift bonuses per space-local day · **Q3** a server-authored plain reason the UI may show.
**Ships dark:** `WORLDS_TRAVEL_ENABLED` remains `false`. The launch flip, deployment, and device checks are separate, later, owner-run steps — not part of this PR.

## What to review (16 files)

**Server**
1. `packages/server/src/repositories/travel.repo.ts` — crediting inside `arrive()`: the transition winner calls `decideBonus` and records `bonus_credited_at / bonus_amount / bonus_reason` in the SAME guarded update as the arrival; `EconomyRepo.add()` runs in the same transaction. `bonusOutcome()` reads the record; `creditJourneyBonus()` satisfies the P2-1 `JourneyBonusCreditor` interface (recorded outcome returned; legacy pre-P2-4 arrivals decided once, guarded on `bonus_credited_at IS NULL`).
2. `packages/server/src/db/schemaSql.ts` + `packages/server/src/db/client.ts` — the three columns in both CREATE TABLEs (dual-DDL rule) plus a PRAGMA-guarded ALTER block in `migrateSchema` for existing volumes.
3. `packages/server/src/api/routes/travel.ts` — POST /arrive returns `{ journey, bonus }`; other acts unchanged.
4. `packages/server/src/economy.ts` — comment-only: the contract is now marked implemented.
5. `packages/server/src/__tests__/travelBonus.test.ts` — NEW (11 tests): exactly-once incl. retry + contract entry point + legacy row; instant drift pays 0 with reason and travels; honest drift pays; daily cap; **cap counted in America/New_York** (a 01:00Z arrival is still capped — a UTC boundary would wrongly pay; reset after 04:00Z); cross-space cap isolation; turn-back pays nothing; cap saturation records the full amount; HTTP test asserting the bonus sibling over a real window wait.

**Web**
6. `packages/web/src/api/travel.ts` (+test) — `arriveJourney` returns `{ journey, bonus }`; a missing sibling defaults to no-bonus, never an invented one.
7. `packages/web/src/hooks/useTravel.ts` (+test) — `lastBonus` from the arrive response only; cleared on depart.
8. `packages/web/src/components/TravelPanel.tsx` (+test) — credit line when `credited`; the server's reason when gated; nothing otherwise.
9. `packages/web/src/components/WorldsSurface.tsx` (+test) — NEW, the F-01 mount: overlay mounting `createStationScene` only when the flag is on and server state places the brain at the Great Station with no active journey; host-owned renderer/camera/fog; slow orbit, frozen under reduced motion; WebGL failure degrades to a plain message; close is view-only; unmount disposes scene + renderer.
10. `packages/web/src/App.tsx` — mounts `WorldsSurface` beside `TravelPanel` in its own ErrorBoundary. `packages/web/src/index.css` — functional overlay styles only.
11. `packages/web/src/hooks/useTravel.test.ts` — ALSO carries a 2-line repair of PRE-EXISTING TS2532 errors that arrived with the P2-3 merge (deploy tip failed web typecheck on them; flagged in the project record as worlds-side repair pending). Verify the repair is test-only and behavior-neutral.

## Claims to verify

- Exactly-once holds under retry and under the recorded-outcome read; the race loser never re-decides (the decision lives inside the guarded transition).
- The drift gate can never gate travel: every ineligible path still completes the arrival.
- The daily cap uses the space's timezone via the sanctioned `spaceTimezone` resolver — no UTC boundary anywhere in the bonus logic.
- No streak/economy semantics touched beyond `EconomyRepo.add()`; `TravelJourney` (shared) unchanged; the flag untouched.
- The UI shows bonus state only from the server's sibling payload (GH-19).

## Gate evidence (builder-reported, sandbox, byte-identical files)

Root typecheck clean across shared/server/web (the pre-existing useTravel.test errors above are why web typecheck passes now — on the base tip it did not). Full suites with zero failures: server **1907 passed**, web **1454 passed**; web production build green. The two daily-digest tests that failed in the P2-3 sandbox run did NOT fail in this run — reported as observed, not explained away.

## Known limitations

- Gate ran in the builder's sandbox clone, not CI; the auditor's independent rerun remains the lane's check, as with P2-3.
- The Station's §11 device numbers are still owed — they belong to the launch device check (owner, post-deploy), not this PR.
- `creditJourneyBonus`'s legacy path uses wall-clock `Date.now()` for its decision (it serves rows that predate injected-time flows); production arrivals never take it.
