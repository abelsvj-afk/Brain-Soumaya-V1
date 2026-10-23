# P2-2 Design Note — Server Journey Ledger & Travel State Machine (Phase 2, increment 2)

**Status: DESIGN ONLY.** Prepared at the owner's direction (2026-10-22): the plan comes back for review before any code; **implementation requires the owner's separate explicit authorization.** Lane when authorized: default (build → full gate → owner's merge tap → post-merge ChatGPT audit).
**Scope discipline (binding):** server-side ledger + state machine ONLY — departure, cancellation, turn-back, arrival, with atomic persistence and retry-safe behavior. No frontend travel (P2-3), no bonus crediting (P2-4), no flag. Acceptance criteria are review 19's four journey-integrity requirements, made testable below.

## Architecture fit (inspected against the repo, deploy head `0d95fda`)
- **Schema:** new tables go into `BOOTSTRAP_SQL` (`packages/server/src/db/schemaSql.ts`), which `createDb` executes on every boot with `CREATE TABLE IF NOT EXISTS` — fresh and existing databases both get the tables on next open. No migration machinery, no guarded ALTERs (those are for columns on existing tables).
- **Naming collision, avoided:** `journeys` already exists — it means **life chapters** (Vision 2.0: `journeys` + `journey_link` tables, `JourneysRepo`, `/api/journeys`, shared `Journey` types). Worlds travel therefore uses **`travel_journeys`** / **`travel_journey_events`**, `TravelRepo`, `/api/travel/*`, shared `TravelJourney` types. P2-1's merged bonus contract keeps its `journeyId` parameter name — it carries a *travel* journey id; the note in that file's comment will say so when P2-4 implements it.
- **Patterns followed:** repos are classes over `DbHandle` in `repositories/*.repo.ts`; routes are thin Express routers `xxxRoutes(ctx)` registered in `api/server.ts` behind the space `guard`, resolving the caller via `spaceOf(res)`; multi-write atomicity uses `sqlite.transaction(...)`; time-based state (fuel regen) is evaluated **lazily on read/action** — the window-close below uses the same pattern, no background timers.

## Data model (BOOTSTRAP_SQL additions)
```sql
CREATE TABLE IF NOT EXISTS travel_journeys (
  id TEXT PRIMARY KEY,                -- server-generated UUID
  space_id TEXT NOT NULL,
  client_key TEXT NOT NULL,           -- client-supplied departure-intent key (idempotency)
  kind TEXT NOT NULL CHECK (kind IN ('warp','drift')),
  origin TEXT NOT NULL,               -- world key, server-derived (never client-supplied)
  destination TEXT NOT NULL,          -- world key, allow-listed
  state TEXT NOT NULL CHECK (state IN ('arming','in_transit','returning','arrived','returned','cancelled')),
  fuel_charged REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  cancel_deadline TEXT NOT NULL,      -- created_at + TRAVEL_CANCEL_WINDOW_SECONDS
  departed_at TEXT, arrived_at TEXT, ended_at TEXT,
  UNIQUE (space_id, client_key)
);
CREATE TABLE IF NOT EXISTS travel_journey_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journey_id TEXT NOT NULL, space_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('departure_armed','departed','cancelled','turned_back','arrived','returned')),
  detail TEXT,                        -- small JSON: {"fuelCharged":10} / {"reason":"insufficient_at_window_close"}
  created_at TEXT NOT NULL
);
-- + indexes on travel_journey_events(journey_id) and travel_journeys(space_id, created_at)
```
The events table is the append-only record (review 19 / plan §5): every state transition writes exactly one event, in the same transaction as the transition. **Current world is derived, never stored:** the latest terminal journey decides it (`arrived` → its destination; `returned`/`cancelled` → its origin; none → `home`). The log can never disagree with a pointer, because there is no pointer.

## The state machine (TravelRepo; every public method settles the window first)
- **depart(clientKey, kind, destination)** → creates a journey in `arming` with event **`departure_armed`** — the cancellable *intent*, not a departure (review 20: the ledger must never claim a departure that hasn't happened; a window-cancelled journey's history reads `departure_armed` → `cancelled`, truthfully). Origin = derived current world. A retry with the same `(space, clientKey)` returns the existing journey unchanged — **including when the retry carries different kind/destination parameters: the original intent stands, the new one is not applied** — the UNIQUE constraint is the backstop; on conflict, re-read and return. Departing while another journey is active (`arming`/`in_transit`/`returning`) is refused with a typed error — the active journey must resolve first. Destination must be on the Phase 2 allow-list (`home`, `great-station`) — the codex-claim lesson: never trust client-invented keys, an invented destination would corrupt the derived current world.
- **Window close (the charge point).** While `arming` and before the deadline, nothing is charged and cancel is free. The first action or read at/after the deadline **settles** the journey, lazily, in ONE `sqlite.transaction`: re-read the row (must still be `arming`) → if warp, `EconomyRepo.spendWarp()` on the same connection (so it joins the transaction) → set `in_transit`, `fuel_charged`, `departed_at`, and insert the **`departed`** event (detail carries `fuelCharged`) — actual departure is recorded here, atomically with the debit, never earlier. **If the balance can no longer cover the warp** (it changed after departure), the same transaction instead marks the journey `cancelled` with reason `insufficient_at_window_close` and charges nothing — never a negative balance, never a charge without transit, never transit on an unpayable charge, and no `departed` event for a journey that never left. Drift settles identically with a charge of 0.
- **cancel(journeyId)** → settles first. Still `arming` → `cancelled`, event, no charge ever. Already settled → returns the journey as `in_transit` with `cancellable: false` (not an error — the honest state). Terminal → returns current state. Idempotent throughout.
- **turnBack(journeyId)** → from `in_transit`: event `turned_back`, state `returning` (no refund, no second charge — §15). From `arming`: equivalent to cancel (event `cancelled`, detail `via: "turn_back"`). Terminal → current state.
- **arrive(journeyId)** → settles first. **Still `arming` after settling (the deadline has not passed): arrival is explicitly REJECTED** with a typed `JOURNEY_NOT_DEPARTED` outcome — no state change, no event, no charge (review 20: this case must never be ambiguous). Fast-forwarding the window instead would erase the user's cancel protection and let a stray or double-fired request force a charge; the honest outcome is rejection, and the client retries once the journey has actually departed. From `in_transit` → `arrived` (+`arrived_at`, event with kind + duration — the facts P2-4 will pay bonuses on; **P2-2 credits nothing**). From `returning` → `returned`, event `returned`, current world = origin again. Terminal → current state (a retried arrival is a no-op — P2-4's duplicate protection builds on this single transition). Unknown id, or another space's journey → 404; cross-space journeys are invisible, not forbidden-with-a-hint.
- **Time is the server's.** The deadline is computed and compared server-side from server timestamps; any client-sent timing fields are ignored. Repo methods take an injectable `now` (defaulting to the real clock) so tests drive time explicitly — no sleeping, no forgery surface. Transit *duration* is deliberately NOT server-enforced (D-11 durations are experience targets rendered client-side); the server validates state and existence, and records the true duration as evidence. Arrival pays nothing in P2-2, so instant arrival farms nothing here; duration/eligibility gating for bonuses is P2-4's recorded design gate.

## Shared-contract additions
- `TRAVEL_CANCEL_WINDOW_SECONDS = 10` in `packages/shared/src/economy.ts` — the web countdown (P2-3) reads the same number the server enforces; authority stays server-side regardless.
- Shared types `TravelKind`, `TravelJourneyState`, `TravelJourney` in `packages/shared/src/types.ts`. One deliberate micro-refactor: the server's P2-1 `JourneyKind` becomes an alias of shared `TravelKind`, so the kind vocabulary has exactly one definition.

## Routes (thin; the contract P2-3 integrates against)
`POST /api/travel/depart` · `POST /api/travel/cancel` · `POST /api/travel/turn-back` · `POST /api/travel/arrive` · `GET /api/travel/state` (→ `{ currentWorld, activeJourney, fuel }`). Every response returns the full journey view, so a client recovering from a retry never has to guess state.

## Acceptance tests (`packages/server/src/__tests__/travel.test.ts` — HTTP-level via the app, repo-level where cheaper; time injected, never slept)
- **C1 — server-authoritative window:** cancel before the deadline succeeds with the balance untouched · cancel after it reports not-cancellable, state `in_transit`, exactly `WARP_COST` charged · a request body carrying forged timestamps changes nothing.
- **C2 — atomicity:** balance drained between depart and window-close → journey `cancelled` (reason recorded), balance untouched, no `in_transit`, charge and ledger never half-applied · depart's journey row + `departure_armed` event exist together or not at all · at settlement, the `departed` event, the debit, and the `in_transit` transition exist together or not at all — and a window-cancelled journey's history contains **no** `departed` event.
- **C3 — idempotency:** depart retried ×3 with one `clientKey` → one journey, one event, no charge · a retry with the same key but **different kind/destination** returns the original journey with the original intent, the new parameters unapplied · arrive ×3 → one `arrived` transition, one event · cancel ×2 and turn-back ×2 → single effects, stable responses.
- **C4 — failure safety:** arrive/cancel/turn-back on an unknown id → 404 and no state change · space B acting on space A's journey → 404 · **arrival attempted before the deadline → `JOURNEY_NOT_DEPARTED`, journey still `arming`, balance untouched, no arrival event; the same arrival after the deadline succeeds** · no arrival exists without a prior departure in every scripted sequence.
- **Machine legality & derivation:** second depart while active refused · full warp cycle home → great-station → home with current-world derivation checked at each step, **including after a cancellation (world unchanged) and during/after a return trip** · drift lifecycle charges 0 at every step · turn-back mid-transit → `returning` → arrive → `returned`, `fuel_charged` still `WARP_COST`, no refund.

## Files when built (8)
`db/schemaSql.ts` (tables) · `shared/src/economy.ts` (window constant) · `shared/src/types.ts` (travel types) · `server/src/economy.ts` (`JourneyKind` alias — one line) · `repositories/travel.repo.ts` (new) · `api/routes/travel.ts` (new) · `api/server.ts` (registration) · `__tests__/travel.test.ts` (new).

## Non-goals (explicit)
No web code · no bonus crediting · no flag · no worlds beyond the two-key allow-list · no changes to the life-chapter `JourneysRepo`, the streak, or the economy beyond `TravelRepo`'s use of `spendWarp()`.

*Design note only — filed for review. No code exists until the owner authorizes P2-2 implementation.*
*Rev 49 → review 20 corrections applied (this revision): the arming event renamed `departure_armed` with `departed` recorded at settlement; arrival while `arming` explicitly rejected (`JOURNEY_NOT_DEPARTED`) with a covering test; derivation and reused-key tests strengthened. Record: `chatgpt-review-20-2026-10-22.md`.*
