# ChatGPT Review 20 — P2-2 Design Note Review (Rev 49)

**Date:** 2026-10-22 · **Reviewed:** the filed P2-2 design note at verified design-branch head `1b4bd63`, against the repository architecture · **Relayed by:** the owner · **Verdict: direction sound; design-only; TWO design corrections required before P2-2 implementation. No code changed; implementation remains unauthorized.**

## Endorsed as strong
The separate travel namespace (no collision with life-chapter `journeys`) · lazy server-authoritative settlement with the insufficient-funds no-charge collapse · explicit integrity tests (injected time, retries, cross-space isolation, current-world derivation) · scope discipline (no frontend, no bonuses, no flag).

## Correction 1 — the `departed` event is recorded too early (ADOPTED)
The note created the journey in `arming` with a `departed` event, but transit begins only when the cancel window closes — so the append-only history would claim a departure that hadn't happened, and a window-cancelled journey would still carry a `departed` event. **Fix:** the arming-time event is renamed **`departure_armed`** (the cancellable intent); **`departed` is recorded at settlement**, in the same transaction as the fuel debit and the `in_transit` transition (its detail carries `fuelCharged`; the separate `cancel_window_closed` event type is retired — the window closing *is* the departure). Event schema and acceptance tests updated accordingly.

## Correction 2 — arrival while `arming` was undefined (ADOPTED)
`arrive()` specified behavior from `in_transit`, `returning`, and terminal states but not from `arming` before the deadline. **Fix (chosen: explicit rejection):** after settle-first, a journey still `arming` rejects arrival with a typed `JOURNEY_NOT_DEPARTED` outcome — no state change, no event, no charge. Rationale recorded in the note: fast-forwarding the window on an early arrive would erase the user's cancel protection and let a stray/double-fired request force a charge; rejection is the honest, safe outcome (the client retries after the window). Acceptance test added: early arrival → rejected, journey still `arming`, balance untouched, no arrival event; post-deadline arrival then succeeds.

## Other checks (folded into the note's tests)
Atomicity proviso confirmed as designed (`spendWarp()` participates via the same connection) · derivation tests extended to **after cancellation** and during/after a return trip · retry test strengthened: a reused `client_key` with **different requested parameters** returns the original journey and applies none of the new intent · injected time endorsed; P2-2 stays reward-free; P2-4's drift-eligibility gate stands.

**Builder disposition:** both corrections adopted in full (Rev 50). Both were truth-in-the-ledger defects — exactly what an append-only history cannot afford. P2-2 remains design-only, awaiting the owner's separate implementation authorization and the reviewer's re-review of the revised note.

*Review 20 record — the P2-2 design loop.*
