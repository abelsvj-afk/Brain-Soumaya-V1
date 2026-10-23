# ChatGPT Review 21 — P2-2 Design Note Re-Review (Rev 50)

**Date:** 2026-10-22 · **Reviewed:** the corrected P2-2 design note at `a7357fa` · **Relayed by:** the owner · **Verdict: both Rev 50 corrections confirmed; ONE remaining design clarification before the reviewer would recommend implementation authorization. Design-only still; no authorization given.**

## Confirmed
The `departure_armed` / `departed` distinction is truthful · rejecting early arrival preserves the user's cancellation window · the strengthened derivation and reused-key tests are appropriate.

## Clarification required — departure admission must be atomic (ADOPTED)
The note must explicitly require the **active-journey check, origin derivation, idempotency-key lookup, and creation of the journey + `departure_armed` event to occur within one SQLite transaction**. Otherwise two concurrent departure requests with *different* keys could both pass the active-journey check before either inserts. The unique `(space_id, client_key)` constraint prevents duplicate keys only — it does not prevent competing journeys under different keys. A concurrency-oriented test (or equivalent transaction-level proof) must show two competing departures cannot create two active journeys for one space.

**Builder disposition (Rev 51):** adopted, with one strengthening of my own added beside it: admission runs in a single **BEGIN IMMEDIATE** transaction (write lock held across check-and-insert, so a competing admission runs entirely before or entirely after — and its in-transaction recheck then sees the committed journey), **plus a partial unique index as a database-level backstop** — `UNIQUE(space_id) WHERE state IN ('arming','in_transit','returning')` — so even an application-logic error cannot create two active journeys; a violating insert fails and rolls back. Tests: a two-connection competing-departures proof against a file-backed DB (second admission refuses after the first commits; exactly one active journey, one `departure_armed` event) and a direct-insert violation test against the partial index. With this recorded, the reviewer sees no other design blocker in the note.

*Review 21 record — the P2-2 design loop. Implementation remains the owner's separate explicit authorization.*
