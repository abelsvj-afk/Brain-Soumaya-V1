# Great Station mockup — how to run (throwaway, Phase 1)

Files in this folder: `index.html` (the scene) + `three.module.min.js` **and `three.core.min.js`** (vendored three.js 0.182.0, same version as the product repo — the module build imports the core file; **both are required** or the scene cannot start) + this README.

**On the owner's phone (the §11 grading device):**
1. Serve this folder with any static server, e.g. from a terminal in this folder: `npx serve .` — or copy the folder to any static host the owner controls.
2. Open the page in the phone's browser. The FIXTURE banner must be visible at the top.
3. Run the §18 V2 session script from the builder brief: stages Far → Handoff → Near, Warp, Drift, Capture still at each stage (D-13 evidence), the **300s measurement** (900s soak when time allows), then repeat with **Reduced motion** checked.
4. Run the behavioral checks (fixture level, results print in the log under the buttons): **Load cargo** → **Warp** then **Cancel departure** inside the 1.2s window → Warp again and **Turn back** mid-flight → **Drain fuel** → try Warp (refused) → **Return home (free)**.

**Controls:** stage buttons move the camera; Warp/Drift run the Far→Near travel at the two gaits (warp costs fixture fuel, drift is free); the HUD shows live fps / 1%-low / draw calls + triangles (**both render passes**), cold-load time, fixture fuel and cargo identity, and the local (ET) time; "Run measurement" uses the Length selector (60s = diagnostic only).

**What this is not:** not the product, not merged anywhere, no real data — fixtures only (the "memories" here are stage geometry; the Station surfaces none, per its recipe).
