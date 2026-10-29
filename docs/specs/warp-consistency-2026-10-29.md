# Warp consistency: no placeholders, streaks go past you, one sky, the real gate

**Status:** owner direction 2026-10-29. Four defects found by the owner on the phone and confirmed in code.

## Defects (measured in code)
1. **A placeholder ship is shown while the real hull loads.** `transitScene.ts` and `shipAvatar.ts` add
   `buildProceduralShip()` at once and swap in `soumaya-ship.glb` when it lands. On the departure cinematic the
   player sees the fake hull first. Rule: *nobody sees a placeholder.* The procedural hull is a load-FAILURE
   fallback only.
2. **Warp streaks fly forward.** `placeStreaks` writes `position.z = -z` while `z` grows with distance flown, so
   streaks move toward −z (the way the nose points) — away from the camera. They must stream past the ship
   toward the camera (+z).
3. **Each world invents its own sky.** The warp and four worlds add `buildHygStarfield()` on a flat colour; the home
   galaxy uses `makeStarfield` + `makeMilkyWay` + a baked nebula/galaxy cubemap, and they are built with
   `Math.random()`, so no two sessions match either. One universe → one sky.
4. **The gate is a generated ring/torus.** `gateScene.ts` is procedural. The repo has no gate model (checked all
   remote branches: the only ring is `relics/mooring-ring-slim.glb`, a relic, not a gate). The real gate asset
   is missing → request to Muse (`muse-gate-asset-2026-10-29.md`). Until it lands the procedural gate stays, as the
   one allowed fallback, and `buildGate` will load `/warp-gate.glb` when present.

## Design
- **Shared sky (`graph/homeSky.ts`).** A seeded build (fixed seed, so every world, the warp and the home galaxy
  show the same stars/nebulae) of the home recipe: live `makeStarfield` + `makeMilkyWay`, plus the nebula/galaxy
  sprites baked once into a cubemap installed as `scene.background`. The sky group follows the camera (it is at
  infinity). The host installs it in every world except the Growing Place (keeps its own backdrop, owner-approved)
  and Eternity (the white void). During the warp, the sky group and the background rotate with the ship's yaw
  (`scene.backgroundRotation`). `Graph3D` builds its pieces through the same seed helper so home matches.
- **No placeholder.** The transit ship and avatar are invisible until the hull is ready; if the load fails they
  show the procedural hull. The hull is preloaded when the worlds layer mounts.
- **Streaks** run +z (toward the camera, past the ship); pinned by a test of the placement function.

## Verify
Unit: seed determinism; streak direction. Browser at 412×915: warp frames show streaks radiating past the camera,
no procedural hull in the first frames (hull node count / `ship-fuselage` absent), same star pattern in Station
and warp (pixel compare of a sky patch).
