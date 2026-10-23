# Mockup Result Record — 1 · The Great Station (the approach)

**Phase 1 · D-27 authorization · Brief:** `phase-1-builder-brief.md` · **Recipe:** `recipe-great-station.md` (✅ settled)
**Builder status: SCENE BUILT + review-10 fixes applied — NOT YET MEASURED ON DEVICE. Overall verdict: ⬜ UNRESOLVED (no PASS claimed).**
**Review 10 (ChatGPT, code-level) — dispositions:** Finding 1 (counter undercount) ✅ fixed in code · Finding 2 (V4 accounting) ✅ documented (§3b below) · Finding 3 (handoff/V3) ⬜ open by design · Finding 4 (harness ≠ §11 test) ✅ harness extended (300 s session / 900 s soak / cold-load) · Finding 5 (behavioral gap) ✅ reconciled — behavioral grammar now exercised in-scene at fixture level (§4). Record: `chatgpt-review-10-2026-10-22.md`.
**Review 11 (Revision 28 review) — dispositions:** peak render counts ✅ now tracked across the whole measured session (report prints PEAK + final-frame) · behavioral checks ✅ upgraded from scripted logs to **verified assertions** — before-state snapshots compared after the act, PASS only on a match (FAIL/INCONCLUSIVE otherwise), overlap case closed (arming refused during a transition; inputs ignored while armed). Record: `chatgpt-review-11-2026-10-22.md`. **Scripted logs ≠ verified assertions** — this record quotes only the assertion form as checks.
**Review 12 (Revision 29 review) — disposition:** the remaining overlap paths ✅ closed by an **armed-departure policy** enforced across *all* controls (during the cancel window only Cancel is live; everything else is inert and logs why) + **fuel floored at 0** at every mutation site. Record: `chatgpt-review-12-2026-10-22.md`.
**Review 13 (Revision 30 review) — disposition:** Review 12's fix verified closed by the reviewer; one added caution ✅ fixed — camera/cargo animation progress now advances by **measured elapsed time**, not per-frame counts, so the settled transit durations hold at any refresh rate. Record: `chatgpt-review-13-2026-10-22.md`. The builder side knows of **no remaining code-level items**; all remaining acceptance work is device-side.
**Review 14 (Revision 31 verification) — confirmed:** the reviewer inspected the actual Rev 31 commit: timing fix present and correct, **no new code-level blocker**. One precision note recorded: the 100 ms delta cap intentionally *stretches* an animation after a long stall instead of teleporting it forward — during stall-heavy moments a transit may exceed its nominal duration by design; P3 grades the stall itself. Record: `chatgpt-review-14-2026-10-22.md`.
**Review 15 (Revision 32 independent verification) — confirmed:** the reviewer checked commit `3116e80` directly (scene byte-identical to Rev 31; record updated; no code-level blocker) and fixed the **acceptance checklist** as the grading frame: behavior · 300 s performance · 900 s soak · reduced-motion repeat · Far/Handoff/Near stills + approach recording · full environment record · independent grading, any failure blocks, bar never lowered. A step-by-step **phone-run sheet** now accompanies this record (`phone-run-sheet-station.md`). Record: `chatgpt-review-15-2026-10-22.md`. The mockup review series (10–15) is closed; the phone run is the only evidence-producing next action.
**Review 16 (Revision 34 verification) — confirmed:** the reviewer fetched the actual scene, both three.js files, this record, and the smoke record from commit `fe5f803`: both fixes present in the source; verdict UNRESOLVED. One documentation cleanup (the §1 package description omitting `three.core.min.js`) ✅ fixed. Record: `chatgpt-review-16-2026-10-22.md`.
**Builder smoke test (2026-10-22, owner's "Run it") — two real defects found by RUNNING the package, both fixed + verified in-environment:** (1) `three.core.min.js` was never vendored — the scene could not start anywhere (the "no code-level blocker" findings covered the scene logic; this lived in the library's own import). File added from the repo's three 0.182.0. (2) Turn-back targeted the origin *stage*, not the captured origin *pose* — FAIL on chained departures; `flyTo` now takes an explicit pose target and the identical sequence PASSes. Cancel / zero-fuel / return-home assertions all observed PASS; console errors 0. Sandbox figures (SwiftShader VM) are **not** §11 evidence. Full record: `smoke-test-station-2026-10-22.md`. Verdict unchanged: **UNRESOLVED** — the phone run remains the critical path.
*Per the review standard (brief §7): a claimed PASS is not a supported PASS. Every §11 criterion below is graded only on evidence in this record; anything unmeasured is UNRESOLVED, and the sequence does not advance on unresolved criteria.*

## 1. What was built

A single self-contained throwaway scene (`index.html` + vendored three.js v0.182.0 — **both** files of the module build, `three.module.min.js` **and** `three.core.min.js`; the module imports the core file, and both are required for the scene to start — see the smoke-test record), fixtures only, outside the product build, nothing merged. **Code location:** built in the worlds workspace (`~/workspace/worlds-vision/mockups/station/`) and **mirrored to this branch at `docs/worlds/mockups/station/`** (owner's decision, 2026-10-22) so the implementation itself is reviewable alongside this record:
- **Crown-and-stem station** at the recipe's fixed proportions: tapered spire + tip + cyan beacon, habitat ring (slow rotation, R-S4; suppressed under reduced motion), four docking arms with cyan guidance lamps at the tips (cyan = navigation truth only), 420 instanced amber window lamps (seeded placement).
- **Dual-layer compositing:** separate backdrop scene/camera (seeded star points, nebula glow planes, the sun disc, and a dark station **impostor** with amber lamp points) rendered under the foreground scene with a depth clear between layers.
- **Handoff (simplified — see §4 honesty):** camera distance drives a blend — far stage reads the impostor against the sun; approaching, the real station slides in from the backdrop position and the impostor fades.
- **Traffic (A17):** 22 instanced shuttles on seeded lanes converging on the arm tips. **Route (A19):** gate ring + cyan route line. **Ship:** procedural craft riding the arrival arc at the near stage.
- **Travel:** stage cuts + Warp (≈2.6 s eased) and Drift (≈12 s) Far→Near; **reduced-motion mode** = instant cuts, ring still, traffic frozen, ship bob off.
- **HUD:** live fps avg / 1%-low / draw calls / triangles (renderer.info), stage, seed, local time in America/New_York (never UTC). **Measurement harness:** 60 s sampler printing a labeled block (this-device numbers are harness checks, **not** §11 evidence).
- **D-13 capture:** "Capture still" button downloads a PNG of the current stage — the evidence mechanism for the owner's device run.

## 2. Test environment

| Field | Value |
|---|---|
| Build check (done) | Scene script extracted and syntax-validated with Node v24.20.0 (`node --check`, pass). **A parse check is not a render, a measurement, or evidence under §11.** |
| Grading device (§11.2) | Owner's phone — **RUN (session 1, 2026-10-22 ~21:46–22:01 ET)**, via the standalone single-file build of the Rev 34 scene (byte-identical logic; delivery route recorded per the run sheet). Model / OS / runtime: **still to be supplied by the owner** — the environment record is incomplete until then. Viewport 384×716, devicePixelRatio 2 (from the measurement block). |
| Sandbox rendering | Builder smoke test only (SwiftShader, 2026-10-22) — explicitly **not** §11 evidence (§2 of `smoke-test-station-2026-10-22.md`). |

## 2b. Device evidence — session 1 (owner's phone, 2026-10-22)

**300 s measurement block (primary run, reduced motion OFF), as printed on device:** duration 300 s · cold load 568 ms · frames 29,803 · **fps avg 99.3** · **1% low 59.5** · **longest frame 108.7 ms** · **draw calls PEAK 16** (both passes) · **triangles PEAK 27,284** · final-frame 16 / 27,284 · DPR 2 · viewport 384×716.

**Behavioral verdicts observed on device (log screenshots):** A1 carry complete (identity unchanged) · **cancel-before-departure: PASS** (all five sub-assertions true) · **turn-back: PASS ×2** (origin pose restored; cargo identity/home match the pre-transit snapshot; aboard-state preserved — the Rev 34 pose fix verified on a real device) · **return-home: PASS at zero fuel** (earlier partial session, reduced motion ON) · one return-home **FAIL** in that earlier session is explained by the log order: fuel was drained *during* the return flight, so the fuel-unchanged sub-assertion tripped on an external mutation, not on the return charging fuel — the immediate clean re-run PASSed · the zero-fuel **refusal** line itself is not yet in the captured evidence (drain + context captured; refusal verdict pending a clean capture) · two "cannot arm during an active transition" INCONCLUSIVE lines = the armed-guard working as designed, not failures.

**Still outstanding after session 1:** the P3 diagnosis (single 108.7 ms frame — see §3) · D-13 stills (Far / Handoff / Near) · the approach recording (V3) · the 900 s soak (P8) · the reduced-motion measurement block (an RM-on partial session ran; its completed block was not captured) · the environment record (phone model / OS / runtime) · V1/V2 (owner's review of the stills) · V6 (owner's call).

## 3. Criteria grading (§11.2 performance / §11.3 visual)

| Criterion | Threshold | Evidence | Status |
|---|---|---|---|
| P1 fps average | ≥50 over 5-min session incl. warp + approach | **99.3** avg over the device 300 s session (29,803 frames, warp + drift + approach included) | ✅ **PASS** (device, session 1) |
| P2 fps 1%-low | ≥30 | **59.5** | ✅ **PASS** (device, session 1) |
| P3 longest stall | ≤100 ms | **108.7 ms** — a single longest frame over the bar | ❌ **FAIL** (device, session 1) — narrow (8.7 ms over, 1 frame of 29,803); blocks advancement pending diagnosis per the failure protocol; the threshold is not negotiable |
| P4 draw calls | ≤200 (hard fail >500) | **Peak 16** (both passes, session peak) | ✅ **PASS** (device, session 1) |
| P5 visible triangles | ≤750k (hard boundary) | **Peak 27,284** | ✅ **PASS** (device, session 1) |
| P6 texture sizes | ≤1K (hero ≤2K); backdrop ≤2048×1024 | By construction: all textures are 256×256 canvas-generated glow discs; **no image textures at all** | ✅ SUPPORTED (construction evidence; device record should still confirm) |
| P7 cold load | ≤5 s | **568 ms** (session 1; 618 ms on the first open) | ✅ **PASS** (device) |
| P8 soak | 15 min, criteria hold | — | ⬜ UNRESOLVED (not yet run) |
| V1 blind distinctness | 3/3 identifiable + one-universe | Owner's blind review of device captures | ⬜ UNRESOLVED |
| V2 landmark silhouette | Station identifiable at max distance | Far-stage capture (device) | ⬜ UNRESOLVED |
| V3 artifact-free approach | No visible pop/stitch in signature sequence | Device recording of Warp/Drift approach | ⬜ UNRESOLVED — **risk pre-flagged:** the handoff here is a distance blend (§4), the exact failure surface V3 grades |
| V4 seed traceability | Every visible parameter traceable to the recipe (seed table or fixed form language) | Derivation table at §3b: seed-derived values via one seeded RNG from `great-station / harbor-1`; recipe-fixed values listed as fixed (they are traceable to the *recipe*, which is what V4 grades). **Device-confirmed session 1:** the on-device HUD shows the seed line and the rendered scene matches the table (amber lamp field, cyan navigation only, recipe stages) | ✅ **SUPPORTED** (accounting + device) |
| V5 content honesty | Nothing on screen claims to be what it isn't | Fixture banner on screen at all times; traffic labeled atmosphere in recipe/record; no memories surface; sun at current size — **banner visible in the owner's own device screenshots** | ✅ SUPPORTED (design/construction + device) |
| V6 owner pass/fail | Owner's explicit call | — | ⬜ AWAITING OWNER |

## 3b. V4 derivation table (added after review 10, Finding 2)

| Parameter | Class | Derivation |
|---|---|---|
| Hull color lightness | Seed-derived | HSL(0.62, 0.10, 0.16 + rng×0.03) — fixed hue/sat band, seeded lightness |
| Hull highlight lightness | Recipe-fixed | HSL(0.62, 0.08, 0.24) |
| Amber lamp hue | Seed-derived | HSL(0.09 + rng×0.02, 0.95, 0.60) |
| Cyan (beacon, arm tips, route) | **Recipe-fixed, deliberately unseeded** | #7FE7FF — navigation truth never varies (R-S2) |
| Fog color | Recipe-fixed | HSL(0.66, 0.42, 0.08), palette-matched indigo; density 0.0016 fixed |
| Nebula tints | Seed-derived | Two HSL bands (hue 0.66/0.72 fixed, lightness 0.10/0.13 + rng×0.03); plane placement seeded |
| Star positions/counts | Seed-derived | Seeded scatter (2,600 backdrop + 500 near) — procedural stand-in for HYG (declared, §4) |
| Window-lamp placement | Seed-derived | 420 instanced lamps, seeded spire/ring scatter |
| Traffic lanes/speeds | Seed-derived | Seeded from arm-tip anchors (fixed) + rng offsets |
| Form proportions (spire/ring/arms) | **Recipe-fixed** | Settled recipe §1 — never seed-randomized (R-S1) |
| Camera stages, lighting rig | Design-fixed | Recipe approach composition (§2); key/rim/ambient constants |
| Ring rotation speed | Recipe-fixed | 0.05 rad/s "slow" (R-S4); suppressed under reduced motion |
| Fuel cost (fixture warp = 20) | Fixture-fixed | Behavioral-layer constant, labeled fixture |

## 4. Honesty notes & known simplifications

- **Handoff simplification:** the recipe's dual-layer handoff is implemented as backdrop/foreground compositing + a distance-driven blend of impostor vs. real station. It is *not* a per-pixel matched crossfade of two full renders of the station. V3 may fail on exactly this; if so the failure class is **implementation** (fixable within the recipe) unless the blend itself proves unworkable, which would make it a **stack** question for the owner.
- **Starfield:** seeded procedural points stand in for the HYG dataset (§10: real HYG file ships separately with CC BY-SA attribution in a production build). For a fixture mockup this is declared, labeled, and sufficient for V1/V2 purposes; it is not the production starfield.
- **Traffic count** (22 instanced shuttles) sits far under the recipe's traffic allocation; draw calls should land near the recipe's ≤88 plan — to be confirmed on device (P4).
- **Behavioral checks (review 10 F5 reconciled; review 11 hardened):** the scene exercises the §18 script's behavioral grammar **at fixture level, in-scene**: a fixture cargo (`fixture-memory-01`, home `fixture-home`) is carried aboard (A1) and rides visibly in transit (A2); warp departure opens a 1.2 s **cancel window**; **turn back** mid-transit returns to origin; a fixture fuel gauge (warp 20, drift free) supports the **zero-fuel checks** (drain fuel → warp refused with reason; **return home works, free**). **Since review 11, these are verified assertions, not scripted logs:** each check captures its before-state (camera pose/look, fuel, cargo identity/home/aboard, transition state) and computes PASS/FAIL from explicit comparisons — cancel also closes the overlap hole (arming during an active transition is refused as INCONCLUSIVE; stage/drift inputs are inert while a departure is armed). **Since review 12, an armed-departure policy is enforced as a state machine, not just detected after the fact:** during the cancel window the *only* live control is Cancel — stages, drift, re-arm, cargo load, turn back, return home, and fuel drain are all inert and log why — and fuel is floored at 0 at every mutation site, so the countdown can never drive the tank negative. The Station rule holds throughout: cargo is never *placed* here — A3 placement is exercised by the Growing Place and Deep Past scenes, and the product-level canonical identity/home verification remains **integration-level, not yet evidenced anywhere** — stated plainly rather than substituted.

## 5. Next step (single, ordered)

**Session 1 is in (§2b):** performance passes everywhere except **P3 (single 108.7 ms frame vs the 100 ms bar — FAIL as written)**. Next, in order: (1) **P3 diagnosis** — the failure protocol classifies before anything advances: one isolated frame in 29,803 at ~2× the session's typical frame time; a reproduction session is the cheapest diagnostic (if it recurs, find where; if it doesn't, the record carries both sessions and the owner decides what the gate does with them — the threshold does not move). (2) The remaining captures: D-13 stills, approach recording (V3), 900 s soak (P8), the reduced-motion measurement block, the zero-fuel refusal line, and the environment record (phone model / OS / runtime). (3) Owner's V1/V2 review of the stills, then **V6 — the owner's call**. **Growing Place remains parked until the Station's criteria resolve and V6 is the owner's PASS.**
