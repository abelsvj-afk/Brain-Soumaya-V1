# Mockup Result Record — 1 · The Great Station (the approach)

**Phase 1 · D-27 authorization · Brief:** `phase-1-builder-brief.md` · **Recipe:** `recipe-great-station.md` (✅ settled)
**Builder status: SCENE BUILT + review-10 fixes applied — NOT YET MEASURED ON DEVICE. Overall verdict: ⬜ UNRESOLVED (no PASS claimed).**
**Review 10 (ChatGPT, code-level) — dispositions:** Finding 1 (counter undercount) ✅ fixed in code · Finding 2 (V4 accounting) ✅ documented (§3b below) · Finding 3 (handoff/V3) ⬜ open by design · Finding 4 (harness ≠ §11 test) ✅ harness extended (300 s session / 900 s soak / cold-load) · Finding 5 (behavioral gap) ✅ reconciled — behavioral grammar now exercised in-scene at fixture level (§4). Record: `chatgpt-review-10-2026-10-22.md`.
**Review 11 (Revision 28 review) — dispositions:** peak render counts ✅ now tracked across the whole measured session (report prints PEAK + final-frame) · behavioral checks ✅ upgraded from scripted logs to **verified assertions** — before-state snapshots compared after the act, PASS only on a match (FAIL/INCONCLUSIVE otherwise), overlap case closed (arming refused during a transition; inputs ignored while armed). Record: `chatgpt-review-11-2026-10-22.md`. **Scripted logs ≠ verified assertions** — this record quotes only the assertion form as checks.
**Review 12 (Revision 29 review) — disposition:** the remaining overlap paths ✅ closed by an **armed-departure policy** enforced across *all* controls (during the cancel window only Cancel is live; everything else is inert and logs why) + **fuel floored at 0** at every mutation site. Record: `chatgpt-review-12-2026-10-22.md`.
**Review 13 (Revision 30 review) — disposition:** Review 12's fix verified closed by the reviewer; one added caution ✅ fixed — camera/cargo animation progress now advances by **measured elapsed time**, not per-frame counts, so the settled transit durations hold at any refresh rate. Record: `chatgpt-review-13-2026-10-22.md`. The builder side knows of **no remaining code-level items**; all remaining acceptance work is device-side.
**Review 14 (Revision 31 verification) — confirmed:** the reviewer inspected the actual Rev 31 commit: timing fix present and correct, **no new code-level blocker**. One precision note recorded: the 100 ms delta cap intentionally *stretches* an animation after a long stall instead of teleporting it forward — during stall-heavy moments a transit may exceed its nominal duration by design; P3 grades the stall itself. Record: `chatgpt-review-14-2026-10-22.md`.
**Review 15 (Revision 32 independent verification) — confirmed:** the reviewer checked commit `3116e80` directly (scene byte-identical to Rev 31; record updated; no code-level blocker) and fixed the **acceptance checklist** as the grading frame: behavior · 300 s performance · 900 s soak · reduced-motion repeat · Far/Handoff/Near stills + approach recording · full environment record · independent grading, any failure blocks, bar never lowered. A step-by-step **phone-run sheet** now accompanies this record (`phone-run-sheet-station.md`). Record: `chatgpt-review-15-2026-10-22.md`. The mockup review series (10–15) is closed; the phone run is the only evidence-producing next action.
*Per the review standard (brief §7): a claimed PASS is not a supported PASS. Every §11 criterion below is graded only on evidence in this record; anything unmeasured is UNRESOLVED, and the sequence does not advance on unresolved criteria.*

## 1. What was built

A single self-contained throwaway scene (`index.html` + vendored `three.module.min.js` v0.182.0, the product repo's three version), fixtures only, outside the product build, nothing merged. **Code location:** built in the worlds workspace (`~/workspace/worlds-vision/mockups/station/`) and **mirrored to this branch at `docs/worlds/mockups/station/`** (owner's decision, 2026-10-22) so the implementation itself is reviewable alongside this record:
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
| Grading device (§11.2) | Owner's phone — **NOT YET RUN.** Model / OS / browser: *to be recorded at the device run.* |
| Sandbox rendering | Not performed (no GPU/WebGL session in the builder sandbox; no numbers claimed from here). |

## 3. Criteria grading (§11.2 performance / §11.3 visual)

| Criterion | Threshold | Evidence | Status |
|---|---|---|---|
| P1 fps average | ≥50 over 5-min session incl. warp + approach | — | ⬜ UNRESOLVED (device run pending) |
| P2 fps 1%-low | ≥30 | — | ⬜ UNRESOLVED |
| P3 longest stall | ≤100 ms | — | ⬜ UNRESOLVED |
| P4 draw calls | ≤200 (hard fail >500) | Counter accounting **corrected after review 10** (both passes accumulated); **peak-across-session tracking added after review 11** (the graded figure is the session PEAK, not the final frame); value must be read on device | ⬜ UNRESOLVED |
| P5 visible triangles | ≤750k (hard boundary) | Same corrections as P4 (both passes; session peak) | ⬜ UNRESOLVED |
| P6 texture sizes | ≤1K (hero ≤2K); backdrop ≤2048×1024 | By construction: all textures are 256×256 canvas-generated glow discs; **no image textures at all** | ✅ SUPPORTED (construction evidence; device record should still confirm) |
| P7 cold load | ≤5 s | — | ⬜ UNRESOLVED |
| P8 soak | 15 min, criteria hold | — | ⬜ UNRESOLVED |
| V1 blind distinctness | 3/3 identifiable + one-universe | Owner's blind review of device captures | ⬜ UNRESOLVED |
| V2 landmark silhouette | Station identifiable at max distance | Far-stage capture (device) | ⬜ UNRESOLVED |
| V3 artifact-free approach | No visible pop/stitch in signature sequence | Device recording of Warp/Drift approach | ⬜ UNRESOLVED — **risk pre-flagged:** the handoff here is a distance blend (§4), the exact failure surface V3 grades |
| V4 seed traceability | Every visible parameter traceable to the recipe (seed table or fixed form language) | Derivation table at §3b: seed-derived values via one seeded RNG from `great-station / harbor-1`; recipe-fixed values listed as fixed (they are traceable to the *recipe*, which is what V4 grades). **Device-side confirmation still required** | 🟡 PARTIAL — accounting complete, device confirmation pending |
| V5 content honesty | Nothing on screen claims to be what it isn't | Fixture banner on screen at all times; traffic labeled atmosphere in recipe/record; no memories surface; sun at current size | ✅ SUPPORTED (design/construction) |
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

**Owner device run (corrected scene):** serve `mockups/station/` (see its README), run the session script including the behavioral checks (load cargo → warp with a cancel first, then a real warp with a turn-back, drain fuel → refused warp → free return home), capture the three D-13 stills (Far / Handoff / Near, sun + station in frame) + an approach recording for V3, run the **300 s** measurement (and the 900 s soak when time allows), repeat the script under reduced motion, record phone model / OS / browser here — then this record returns to review. **Growing Place remains parked until the Station's criteria resolve and V6 is the owner's PASS.**
