# Station Mockup — Builder Smoke Test (2026-10-22)

**What this was:** at the owner's word ("Run it"), the builder ran the mockup for the first time anywhere — headless Chromium (Playwright) with SwiftShader software WebGL on the sandbox VM, serving the mockup folder locally, viewport 420×900, driving the real buttons and reading the real on-page log. **This is not §11 evidence**: a software GPU on a VM says nothing about the phone (fps here was ~5 — the renderer's floor, not the scene's cost; cold load 650 ms, likewise meaningless for grading). Its purpose was narrower and it earned it: *prove the package runs before the owner spends phone time on it.*

## Finding 1 — the package could not run at all (fixed)
The vendored library is a two-file build: `three.module.min.js` imports `./three.core.min.js`. Only the first file was ever copied — here and in the branch mirror — so the scene died on a 404 before its first frame, on any device. Five code reviews (10–15) read the scene logic and could not see it: the defect lived in the library's own import, not in any line under review. **Fix:** `three.core.min.js` added from the same three.js 0.182.0 in the product repo's `node_modules` (the vendored module file is md5-identical to the repo's copy). **Lesson, recorded plainly: run the package, not just the code.**

## Finding 2 — turn-back flew to the origin *stage*, not the origin *pose* (fixed, verified)
A focused test (departure chained mid-flight, so the captured origin was a mid-route pose) produced **CHECK turn-back: FAIL — back at origin pose: false** (cargo identity/home/aboard all true). Cause: the return flight targeted the origin stage's fixed pose. §15 promises the exact origin, state preserved — so `flyTo` now accepts an explicit pose target and turn-back passes the snapshot pose. **Verified:** the identical chained sequence now returns **PASS**, as does the parked-origin case.

## Checks observed firing (post-fix, this environment)
- A1 carry: started + complete, cargo aboard, identity unchanged.
- **Cancel-before-departure: PASS** — all five sub-assertions true.
- **Zero-fuel: warp refused** at fuel 0 with reason; drift and return home available.
- **Return-home: PASS** at zero fuel — arrived home pose, fuel unchanged.
- **Turn-back: PASS** (parked-origin and chained-origin scenarios, post-fix).
- Console/page errors after the fix: **0**. 60 s diagnostic (non-evidence): peak **12 draw calls / 26,548 triangles** — the structure sits far under the §11 ceilings; the phone still decides.

## Not exercised here
V3 handoff appearance on a real GPU · D-13 stills as graded evidence (the sandbox frames are illustrative only — though the Far frame does show the designed composition: sun disc + station impostor silhouette in one frame) · the 900 s soak · reduced-motion performance.

**Illustrative frames** (sandbox smoke run, SwiftShader — **not** evidence; the graded D-13 stills come from the owner's phone): three stage frames (Far / Handoff / Near) are retained in the builder's workspace (`~/workspace/worlds-vision/builds/smoke/`) and were shown to the owner in the worlds chat on 2026-10-22. They are **not** on this branch — the snapshot push tooling carries text only, so binary frames can't be filed through it; the owner's graded phone stills will face the same limit and can be committed via GitHub's web upload or held alongside this record by description + measurements.

**Gate state unchanged: Station UNRESOLVED.** The review series' "no known code-level items" statement covered the scene logic as written; this run found one packaging defect and one behavioral defect *around* that logic, both fixed and verified in-environment. The phone evidence run remains the critical path.

*Smoke record — builder's own run, at the owner's direction. Nothing here authorizes product implementation, merge, or deployment.*
