# Great Station mockup — how to run (throwaway, Phase 1)

Files in this folder: `index.html` (the scene) + `three.module.min.js` (vendored three.js 0.182.0, same version as the product repo) + this README.

**On the owner's phone (the §11 grading device):**
1. Serve this folder with any static server, e.g. from a terminal in this folder: `npx serve .` — or copy the folder to any static host the owner controls.
2. Open the page in the phone's browser. The FIXTURE banner must be visible at the top.
3. Run the §18 V2 session script from the builder brief: stages Far → Handoff → Near, Warp, Drift, the 60s measurement button at each stage, Capture still at each stage (D-13 evidence), then repeat with **Reduced motion** checked.

**Controls:** stage buttons move the camera; Warp/Drift run the Far→Near travel at the two gaits; the HUD shows live fps / 1%-low / draw calls / triangles and the local (ET) time; "Run 60s measurement" prints a labeled device measurement block.

**What this is not:** not the product, not merged anywhere, no real data — fixtures only (the "memories" here are stage geometry; the Station surfaces none, per its recipe).
