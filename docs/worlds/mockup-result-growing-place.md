# Mockup Result Record — Growing Place, Landmark Rising (Phase 1, Mockup 2 of 3)

**Status: UNRESOLVED — no PASS claimed.** Opened 2026-10-22 when the sequence advanced under **D-28** (Station: P3 failed → diagnosed → fixed → owner-waived re-test; review 17 closed the diagnosis loop). Advancement to this mockup is **not** evidence the Station passed its gates — the Station's acceptance remains UNRESOLVED on its own record.

**Grading authority:** the §11 criteria (unchanged, not renegotiable): the verdict requires a measurement session **on the owner's phone** — fps average / 1% low / longest frame / draw calls / triangles / cold load, plus the visual criteria and the owner's **V6**. Sandbox numbers are harness checks only.

## 1. What was built (builder statement)
A throwaway single-page scene (`mockups/growing-place/index.html` + vendored three.js 0.182.0 — **both** `three.module.min.js` and `three.core.min.js`, the Station smoke lesson applied from the start): terraced garden arcs climbing to a colossal **witness tree** under a fixed **eternal dawn** (dawn-gradient sky, low sun glow, palette-matched haze), 300 seeded **instanced** trees (the recipe's named perf risk, instanced per the settled technique), resting-ground plots, the cyan gate + route (cyan = navigation truth only), and the ship. Signature motions: **A6 — a landmark rises** (staged fixture milestone, form by kind: completion → arch; the on-screen log declares it staged — nothing claims to be a real milestone) and **A7 — a connection forms** (a trail of light between two plots). The scene also carries the **A1–A3 chain** the Station deferred: **carry** the fixture memory aboard → **transit** with it visible → **place** it at a plot, atomically (a turn-back mid-transit holds the placement; the cargo stays aboard; a placement in progress cannot be interrupted). The travel grammar is the trio's shared chassis: armed-departure cancel window (only Cancel live), turn-back to the captured origin **pose**, return home always free, zero-fuel warp refusal, fuel floored at 0, elapsed-time animation, warm-up compile at load (the Station P3 lesson — the arch, orb and trail all start hidden), and the harness records the **longest frame's context**. Kindness rule in the fixture: nothing wilts or browns; untouched plots are *resting ground*; the un-grown landmark simply isn't there yet — never rubble. Fixtures only; the world is seeded from **`growing-place / terrace-1`** (scatter, plot dressing, vegetation), with recipe-fixed proportions (terrace count/radii/heights, tree form, palette, dawn) documented rather than improvised.

**Unshippable / mock-only elements (for the §11 visual review):** canvas-gradient sky and glow sprites stand in for production dawn art; vegetation is two instanced primitives (production gets real variety); the arch is untextured stone-colored geometry; no sound; the backdrop's horizon hill is layered scenery (this scene does not use the Station's impostor-swap handoff — flight smoothness is this scene's approach evidence).

## 2. Builder smoke run (sandbox, headless Chromium/SwiftShader — NOT §11 evidence)
Run 2026-10-22 after construction (driver: `builds/growing_smoke.py`; frames in `builds/smoke-growing/`). **Zero page errors.** Verified assertions and signature sequences observed in-environment:
- **CHECK placement (A3): PASS** — the fixture memory rests at its plot; identity/home unchanged (`fixture-memory-01` / `fixture-home`); placed atomically.
- **A6 landmark rising: complete** — the staged-fixture declaration printed before the rise; the arch stands.
- **A7 connection forming: complete** — trail drawn from the placed memory's plot.
- **CHECK return-home: PASS** at fuel 0 (arrived home, fuel unchanged).
- 60 s diagnostic (non-evidence, software renderer): peak **30 draw calls** / **19,480 triangles**; sandbox cold load 778–1,062 ms across runs (warm-up included).
- **Not reached in this run (driver sequencing, recorded honestly):** the cancel-before-departure and zero-fuel warp-refusal checks — a long drift flight was still in progress when the driver clicked, so both attempts correctly returned INCONCLUSIVE/no-op guards instead of verdicts. Both checks remain on the device session script; their code paths are the Station chassis the owner's phone already exercised.
- **Sandbox visual observation (illustrative only):** in software-rendered frames the dawn reads weakly — the sky above the hill renders near-black and the dawn is felt mainly through the glow sprites. Two builder adjustments were tried (dawn band lifted, near stage pulled back); the read persists in the sandbox. **Not chased further blind** — color response differs on real hardware; flagged for the device session's visual review.

## 3. §11 criteria — all UNRESOLVED pending the owner's phone session
| # | Criterion | Bar | Evidence | Status |
|---|---|---|---|---|
| P1 | fps average | ≥50 | — | ⬜ UNRESOLVED |
| P2 | fps 1% low | ≥30 | — | ⬜ UNRESOLVED |
| P3 | longest stall | ≤100 ms | harness prints frame context | ⬜ UNRESOLVED |
| P4 | draw calls | ≤200 (hard fail >500) | sandbox diagnostic peak 30 (non-evidence); device peak TBD | ⬜ UNRESOLVED |
| P5 | visible triangles | ≤750k = hard rejection boundary, never a target | sandbox diagnostic peak 19,480 (non-evidence); device peak TBD | ⬜ UNRESOLVED |
| P6 | textures ≤1K (hero ≤2K) | canvas-generated only | by construction | ✅ SUPPORTED |
| P7 | cold load | ≤5 s | — | ⬜ UNRESOLVED |
| P8 | 15-min soak | no degradation | — | ⬜ UNRESOLVED |
| V1 | blind distinctness | 3/3 vs the trio | needs all three + owner's review | ⬜ UNRESOLVED |
| V2 | landmark silhouette | recognizable at distance | the arch, mid-rise, against the tree/dawn | ⬜ UNRESOLVED |
| V3 | artifact-free approach | warp/approach holds together | device flight | ⬜ UNRESOLVED |
| V4 | seed traceability | derivation table | §3b | ✅ SUPPORTED |
| V5 | content honesty | labeled fixture | FIXTURE banner + staged-milestone declaration in the log | ✅ SUPPORTED |
| V6 | owner's call | explicit pass/fail | — | ⬜ AWAITING OWNER |

## 3b. Derivation table (V4)
| Parameter | Value | Source |
|---|---|---|
| Terrace levels / radii / heights | 5 levels, base r 128, −19/level, +3.2 height/level | recipe-fixed proportions |
| Eternal dawn palette & haze | gradient stops + fog `0xe8a37c` @ 0.0016 | recipe-fixed (R-G2/R-G4: dawn band only) |
| Witness tree form | trunk taper, 5 canopy masses, proportions | recipe-fixed (R-G1) |
| Vegetation scatter (300) | positions/scale/rotation per instance | **seed-derived** |
| Plot positions | terrace 2 rim | recipe-fixed |
| Arch form | completion → arch (two pillars + lintel) | recipe grammar (R-G3, non-ranking) |
| Trail path | quadratic curve between the plots | recipe-fixed endpoints |
| Travel timings / fuel | trio chassis (Station) | shared grammar |
| Sun size/position | scenery backdrop | recipe-fixed |

## 4. Advancement rule
Deep Past is built only after this mockup's gates resolve on the owner's phone — or by an explicit owner decision of the same kind as D-28, recorded as such. Nothing in this record claims a pass.
