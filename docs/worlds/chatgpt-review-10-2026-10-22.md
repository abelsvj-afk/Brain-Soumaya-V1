# ChatGPT Review 10 — Station Mockup Implementation (Phase 1)

**Date:** 2026-10-22 · **Reviewed:** `docs/worlds/mockups/station/` (the scene code) + `mockup-result-station.md`, against the builder brief and settled rules · **Relayed by:** the owner · **Verdict: UNRESOLVED — do not advance to Growing Place.** (Reviewer rendered nothing and verified no device performance; no V6 issued.) The record's candor was noted approvingly; the scene is a useful first proof — with code-level issues to fix **before its counters can be trusted**.

## Findings & builder disposition (King, 2026-10-22)

| # | Finding | Disposition |
|---|---|---|
| 1 | **Draw-call/triangle counters undercount:** two `render()` passes per frame, `renderer.info` auto-resets between them; HUD read only the foreground pass. P4/P5 untrustworthy as written. | ✅ **FIXED in code** — `renderer.autoReset = false`, manual `info.reset()` once per frame before both passes; HUD/measurement now report combined totals (labeled "both passes"). Device verification still required. Implementation-class, thresholds unchanged. |
| 2 | **V4 claim broader than the implementation:** the code comment implied everything is seed-derived; recipe-fixed constants also exist (legitimately). | ✅ **CLARIFIED** — code comment corrected to the two value classes; the result record now carries a V4 derivation table (seed-derived vs recipe-fixed, per parameter). V4 stays *partial* until device-side visual confirmation. |
| 3 | **Handoff is a known V3 risk** (distance blend, not matched crossfade) — disclosed accurately in the record. | ⬜ **OPEN as designed** — unresolved until the device approach recording shows popping/flicker/artifacts or doesn't; failure would enter the failure-class protocol. |
| 4 | **Harness ≠ acceptance test:** 60 s button vs §11's 5-minute session; no soak, cold-load, or reduced-motion run established. | ✅ **EXTENDED in code** — duration select 60 s (labeled diagnostic-only) / **300 s (§11 session)** / **900 s (soak)**; cold-load time (navigation → first frame) now captured in the HUD and every measurement block; reduced-motion run = same script with RM on (scene behavior already RM-aware; now part of the run instructions). The *runs themselves* remain the owner's device work. |
| 5 | **Shared behavioral checks not implemented in the scene:** brief's session script (cargo, identity/home, cancel, turn-back, zero-fuel return) was recorded as "not applicable" — an unresolved gap, not a silent substitution. | ✅ **RECONCILED + IMPLEMENTED at fixture level** — the scene now exercises the behavioral grammar in-scene: fixture cargo with fixed identity/home (A1 carry, A2 visible transit), warp departure with a cancel window (**cancel check**), **turn-back** mid-transit to origin with state assertions, fixture fuel gauge (warp costs, drift free), **zero-fuel checks** (drain → warp refused; return home free and working), all results written to an on-page checks log. **Scope honesty preserved:** these are scene-level fixture checks; the product's canonical identity/home verification remains integration-level and is still recorded as not-yet-evidenced anywhere. The brief's script stands unamended — the gap was the scene's, and the scene closed its share. |

## Criterion table (reviewer's, as relayed)

P1–P3 unresolved (phone) · P4/P5 unresolved (accounting correction — now made in code) · P6 supported by construction · P7/P8 unresolved · V1/V2 unresolved (owner/captures) · V3 unresolved (handoff risk) · V4 partial (accounting — now documented) · V5 supported by construction (subject to rendered check) · V6 awaiting owner.

**Gate state after this review: Station UNRESOLVED; Growing Place parked.** Next: corrected scene → owner's phone session (exact environment, full measurements, D-13 stills + approach recording) → criterion review.

*Review 10 record — the first mockup implementation review. Nothing here authorizes product implementation, merge, or deployment.*
