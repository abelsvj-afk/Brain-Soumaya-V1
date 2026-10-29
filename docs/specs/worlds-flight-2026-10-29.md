# Worlds flight: fly your ship to places, feel the scale

**Status:** owner direction 2026-10-29 ("I want to feel like you can navigate around the spaces … don't know if anything is
scaled up yet … when you go somewhere it should be like EVE: the ship turns slowly toward it, engines go red, then it takes off
fast, everything blurry, and you stop there"). Builds on `docs/specs/eve-travel-2026-10-29.md` (travel *between* worlds); this is
travel *inside* one.

## What exists (measured)
- The space worlds (Station, Deep Past, People, Quiet/Archive, Scale) are a camera orbiting a still scene; the only input is drag/pinch
  look. You can't go anywhere, so you never see how big anything is next to your ship (the ship is 12 units; the Station is 35× that —
  `STATION_SCALE_RATIO` — ≈ 420 across, but nothing ever shows them together).
- The garden alone has a walkable avatar (tap to walk).

## Design

**Places.** Every world that opts in exposes *places*: named objects found in its scene (the Station, a drydock, a planet, a probe, the
First Light basin, the rim, the stair…) — discovered at runtime from the scene's named holders and their bounding boxes, so a model
that loads late appears when it lands, and a world gains places when a model is added. A dock group **Places** lists them as tiles
(icon + word); **Overview** returns to the orbit camera.

**Flight (EVE-style, the same grammar as the long jump, shorter).** Tapping a place: the ship, which stays at true size,
1. **ALIGN** (~1.4 s) turns smoothly to face it (yaw + pitch eased — never a snap), engines idle → warming;
2. **SPOOL** (~0.8 s) engines go deep red;
3. **BURN** (2.4–6.5 s by distance) takes off hard (ease-in), edge blur and streak feel rise with speed, then eases down;
4. **ARRIVE** stops at a stand-off (~1.35× the place's radius) and the engines cool. A caption states the scale:
   "The Station — 420 across · 35× your ship".
The camera chases behind and above the ship; drag/pinch still turn/zoom around her. No loading screen: it is one scene.

**Rules.** Reduced motion: the same steps in the same order, no easing sweep — the ship faces the place at once and *jumps* to the
stand-off (the caption and cooling engines carry the meaning). The caption is text, not colour. Tiles are ≥56px, icon + word. A world
with no places shows no Places group (Eternity, the garden — it has its own walk). Pure math (`worldFlight.ts`) is unit-tested; the scene
only applies it.

## Build plan
1. `worldFlight.ts` (pure state machine + chase pose) + tests. 2. `shipAvatar.ts` (her hull + engine glow, shared). 3. `worldPlaces.ts`
(discovery + labels) + tests. 4. Host wiring (dock Places, chase camera, caption, blur). 5. Measure each world at 412×915: places
found, flight to one, the scale caption — screenshots.
