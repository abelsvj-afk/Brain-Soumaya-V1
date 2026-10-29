# Worlds design pass — a game-designer's audit (UI, UX, controls, speed, travel)

**Lens:** a lead designer on an EVE-class space game reviewing Soumaya's worlds + travel, 2026-10-29. This is the
standing plan; each item is a small, shippable step under the lighter loop (spec → build → measure → on-device).
Principle: **one universe** — same sky, same ship, same gate, same controls everywhere; and **the first thing the player sees is
always final art** (no placeholders, no pop-in).

## A. Fixed today (see `specs/warp-consistency-2026-10-29.md`)
- No placeholder ship (hidden until her real hull is ready; procedural only on load failure).
- Warp streaks stream *past* the ship toward the camera.
- One sky: every world and the warp use the home galaxy's own stars, Milky Way and baked nebulae (seeded, identical).

## B. Open — ordered by player impact
1. **The real gate.** The generated torus is the weakest asset on screen. Needs the owner's gate GLB (Muse request:
   `specs/muse-gate-asset-2026-10-29.md`); code swap is ~30 lines. Until then keep the procedural fallback.
2. **Travel feel (EVE grammar):** (a) a one-line "intent" HUD (destination · distance · ETA) from first tap; (b) a persistent
   Cancel that never moves; (c) a velocity readout that rises with the burn (speed is felt through numbers + FOV + streak
   length, not only blur); (d) audio: engine spool pitch tied to `engine` heat (the engine-audio module exists, wire it into
   transit), a low thump at the jump; (e) arrival: HUD "Arrived · <world>" for 1.5 s then gone.
3. **Controls consistency:** one dock pattern everywhere (done for worlds); thumb-reach audit — primary actions in the bottom
   third on phones, secondary in the header; tiles ≥56px; a single "← Galaxy" in the same place. Add a **hold-to-fly** gesture
   (long-press a place on the dock = "Fly to" vs tap = "Show"). Reduced motion: every sequence has a no-motion twin (exists).
4. **Wayfinding:** an always-available "where am I / where can I go" strip (current world + next gate). Name signs on gates;
   the destination beacon is labelled in text, never colour alone.
5. **Scale legibility:** the arrival caption states "N across · M× your ship" (done in-world); add the same for the gate and
   a faint ship-silhouette scale bar on the world map.
6. **Lighting + mood per world:** one rig per world (done); Deep Past violet mood and Scale (needs the missing probe/ISS files)
   are still flat. Rule: a world's mood is lighting + fog + palette, not a different sky.
7. **Onboarding of the loop:** first travel gets a 3-line coach ("align → spool → warp"), dismissible, never again.

## C. Speed / performance budget (phone-first)
- **Budget:** ≤ 95 draw calls in any world (garden is pinned by test), ≤ 40 in transit; first interactive world frame ≤ 2.5 s on a
  mid phone over 4G; zero layout shift in the HUD.
- **Weight (biggest lever):** first visit pulls 21 MB home + 6–20 MB per world. The slimming task (Muse, web-slim recipe) targets
  `space_station_3.glb` 14 MB, `sf-lava-planet` 11 MB, `sf-ice-planet-procedural` 10.5 MB, `sf-anchor-spire` 8 MB.
  Returning visitors are already 0 MB (service-worker asset cache; measured).
- **Prefetch:** destination models warm during the 10 s cancel window (done). Next: preload her hull + the gate at app start,
  and the sky bake runs once per scene (≈6 draws) — if it shows on a slow phone, share the baked cubemap across worlds (cache it
  on the renderer) instead of re-baking.
- **Frame budget:** transit and worlds are CSS-overlay for blur/flash (no post pass); keep it that way. Dynamic quality: if
  frame time > 24 ms for 2 s, drop sky star count and DPR to 1.5 — never drop the ship or the gate.
- **Memory:** every world disposes its sky, lights and avatar (done); add a test that mounts/unmounts 10× with no geometry leak.

## D. Missing-asset protocol
Claude cannot upload binaries. When an asset is missing: Claude writes a request in `docs/specs/muse-*.md` naming the exact
file path, format limits and facing/scale, the owner hands it to Muse, Muse uploads via the GitHub website, Claude wires and
verifies. Current list: gate GLB; 5 Scale files; GLB slimming.

## E. Measuring "feels right" (so we are not guessing)
Per change: 412×915 screenshots of each phase, a luminance read, draw-call count, bytes downloaded, and one on-device
confirmation from the owner. Keep the Pending Validation list in `CLAUDE.md` honest.
