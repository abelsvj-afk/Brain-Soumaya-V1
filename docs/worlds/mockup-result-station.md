# Mockup Result Record — 1 · The Great Station (the approach)

**Phase 1 · D-27 authorization · Brief:** `phase-1-builder-brief.md` · **Recipe:** `recipe-great-station.md` (✅ settled)
**Builder status: SCENE BUILT — NOT YET MEASURED. Overall verdict: ⬜ UNRESOLVED (no PASS claimed).**
*Per the review standard (brief §7): a claimed PASS is not a supported PASS. Every §11 criterion below is graded only on evidence in this record; anything unmeasured is UNRESOLVED, and the sequence does not advance on unresolved criteria.*

## 1. What was built

A single self-contained throwaway scene (`~/workspace/worlds-vision/mockups/station/index.html` + vendored `three.module.min.js` v0.182.0, the product repo's three version), fixtures only, outside the product build, nothing merged:
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
| P4 draw calls | ≤200 (hard fail >500) | Live counter exists in HUD; value must be read on device | ⬜ UNRESOLVED |
| P5 visible triangles | ≤750k (hard boundary) | Same as P4 | ⬜ UNRESOLVED |
| P6 texture sizes | ≤1K (hero ≤2K); backdrop ≤2048×1024 | By construction: all textures are 256×256 canvas-generated glow discs; **no image textures at all** | ✅ SUPPORTED (construction evidence; device record should still confirm) |
| P7 cold load | ≤5 s | — | ⬜ UNRESOLVED |
| P8 soak | 15 min, criteria hold | — | ⬜ UNRESOLVED |
| V1 blind distinctness | 3/3 identifiable + one-universe | Owner's blind review of device captures | ⬜ UNRESOLVED |
| V2 landmark silhouette | Station identifiable at max distance | Far-stage capture (device) | ⬜ UNRESOLVED |
| V3 artifact-free approach | No visible pop/stitch in signature sequence | Device recording of Warp/Drift approach | ⬜ UNRESOLVED — **risk pre-flagged:** the handoff here is a distance blend (§4), the exact failure surface V3 grades |
| V4 seed traceability | Every visible parameter from the recipe's seed table | Code-level: palette, star scatter, lamp scatter, nebula tint/placement, lane seeds all derive from seed `great-station / harbor-1` via one seeded RNG; form proportions fixed by recipe. **Device-side confirmation still required** (visual parameters on screen must match the table) | 🟡 PARTIAL — construction-supported, device confirmation pending |
| V5 content honesty | Nothing on screen claims to be what it isn't | Fixture banner on screen at all times; traffic labeled atmosphere in recipe/record; no memories surface; sun at current size | ✅ SUPPORTED (design/construction) |
| V6 owner pass/fail | Owner's explicit call | — | ⬜ AWAITING OWNER |

## 4. Honesty notes & known simplifications

- **Handoff simplification:** the recipe's dual-layer handoff is implemented as backdrop/foreground compositing + a distance-driven blend of impostor vs. real station. It is *not* a per-pixel matched crossfade of two full renders of the station. V3 may fail on exactly this; if so the failure class is **implementation** (fixable within the recipe) unless the blend itself proves unworkable, which would make it a **stack** question for the owner.
- **Starfield:** seeded procedural points stand in for the HYG dataset (§10: real HYG file ships separately with CC BY-SA attribution in a production build). For a fixture mockup this is declared, labeled, and sufficient for V1/V2 purposes; it is not the production starfield.
- **Traffic count** (22 instanced shuttles) sits far under the recipe's traffic allocation; draw calls should land near the recipe's ≤88 plan — to be confirmed on device (P4).
- **Session script (§18 V2):** the travel/cancel/turn-back/zero-fuel steps exercise *product* navigation behaviors; in this throwaway scene only the travel gaits and stage moves exist. The behavioral steps are recorded as **not applicable to the scene in isolation** and remain to be evidenced where the brief's harness steps apply — flagged here rather than silently skipped.

## 5. Next step (single, ordered)

**Owner device run:** serve `mockups/station/` (see its README), run the session script, capture the three D-13 stills (Far / Handoff / Near, sun + station in frame), run the 60 s measurement at each stage, record phone model / OS / browser here — then this record returns to review. **Growing Place remains parked until the Station's criteria resolve and V6 is the owner's PASS.**
