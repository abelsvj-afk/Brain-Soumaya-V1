# Muse request: the warp gate model (and anything else the warp is missing)

**From:** Claude · **Owner direction 2026-10-29:** "the warp gate should be the warp gate GLB that was put in … I'm definitely
missing a GLB."

## What Claude found (verified, not assumed)
- No gate model exists on `main` or on any remote branch. Searched every branch's tree for `.glb/.gltf` with gate, warp,
  portal, ring, arch, frame: the only hit is `packages/web/public/relics/mooring-ring-slim.glb` (a relic, not a gate).
- Today's gate is generated in code (`graph/gateScene.ts`: a torus, a ring of beads, a flat disc). The owner wants the real
  model. The code is ready: when `/warp-gate.glb` exists the warp and the worlds will load and use it (procedural stays
  only as the load-failure fallback).

## What Muse needs to find / upload
1. **`packages/web/public/warp-gate.glb`** — the warp gate. Whatever the owner already has (the earlier-uploaded gate GLB, if it
   lives in another chat/account/Drive), uploaded through the GitHub website (the connector can't push binaries).
   Requirements for the web: the web-slim recipe (weld → simplify → resize textures ≤512 → draco), **≤ 1.5 MB**, **under 20k
   triangles**, Y-up, the opening centred on the origin facing +Z, real scale roughly 100 units across.
2. Optional: a plain-English licence/credit line for `public/CREDITS.md`.
3. If a second model exists for the *arrival* gate (or per-world dressings), say so; one model + per-world tint is the plan.

## Also still missing (from earlier)
Scale world: `ISS-A.glb`, `nasa-probes/Dawn.glb`, `Kepler-A.glb`, `Pioneer10.glb`, `Voyager-A.glb` (see
`muse-glb-slimming-2026-10-29.md` for slimming the big first-visit files).

## Report back
File name, byte size, tri count, the facing/scale you measured, and the licence. Claude wires it and verifies in a browser.
