# ChatGPT Review 11 — Station Mockup, Revision 28 Review (Phase 1)

**Date:** 2026-10-22 · **Reviewed:** the corrected scene + record + brief at commit `b4b6467` · **Relayed by:** the owner · **Verdict: Station remains UNRESOLVED — Growing Place remains parked.** (Reviewer rendered nothing; no device performance verified; no V6.) Review 10's fixes were verified in code as substantially in place; two measurement/assertion weaknesses remained.

## Findings & builder disposition (King, 2026-10-22)

| # | Finding | Disposition |
|---|---|---|
| 1 | Counter reset (review 10 F1) — verified fixed in code: `autoReset=false` + manual reset accumulates both passes. P4/P5 still need device measurements. | ✅ Noted — no action beyond the device run. |
| 2 | V4 traceability — materially clearer; the documentation overclaim is resolved. Rendered palette correspondence still needs visual review. | ✅ Noted — device captures close it. |
| 3 | **Measurement reads only the final frame's render counts.** Frame-time stats span the session, but calls/triangles were read once at the end — and the approach's most expensive frame (impostor + foreground both live) may not be the last. P4/P5 could read better than the worst case. | ✅ **FIXED in code** — the render loop now tracks **peak** draw calls and triangles across every frame while a measurement runs; the report prints PEAK (the §11-relevant figure) alongside final-frame values for transparency. |
| 4 | **Behavioral logs claim PASS without verifying every stated invariant.** Cancel didn't compare camera state against arm-time state (an in-progress transition could keep the camera moving through the cancel window); turn-back printed identity/home without asserting a return to the saved origin pose or matching a pre-transit snapshot. | ✅ **FIXED in code** — all three checks now capture **before-state snapshots** and log PASS only when the comparisons succeed (FAIL otherwise): cancel asserts camera pose, look, fuel, cargo state, and that no transition was running — and the overlap case is closed structurally (arming is refused as INCONCLUSIVE during an active transition; stage/drift inputs are ignored while a departure is armed); turn-back asserts arrival at the saved origin pose + cargo identity/home/aboard against the pre-transit snapshot captured in `flyTo`; return-home asserts arrival pose + fuel unchanged. |
| 5 | Harness duration/cold-load — improved (60 s diagnostic-only; 300 s/900 s available); the phone run must still include the prescribed movement sequence + reduced-motion repeat. | ✅ Noted — stands in the record's next-step instructions. |

## The distinction now carried by the record

**Scripted logs ≠ verified assertions.** After this fix round, the scene's behavioral log lines are *verified assertions* (state captured before, compared after, PASS/FAIL computed) — and the result record says which is which wherever a log is quoted. Anything the scene merely announces (e.g., "warp departed") is narration, not a check.

**Gate state: Station UNRESOLVED; Growing Place parked.** Remaining: the owner's phone run on the corrected scene (300 s session, 900 s soak, reduced-motion repeat, D-13 stills, approach recording, exact device/runtime recorded).

*Review 11 record — the second mockup implementation review. Nothing here authorizes product implementation, merge, or deployment.*
