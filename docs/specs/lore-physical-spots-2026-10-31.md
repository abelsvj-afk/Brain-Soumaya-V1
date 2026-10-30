# The lore lives in physical places — spots, traversal and tap-to-fly (design)

*Owner (2026-10-31): "Fold in a physical spot in a scene … you need to be able to traverse around the area … everything is tied to physical spots and locations." Spec before code (Rule #1). Builds on `lore-storage-…`, `DRAFT_5_THE_WEB.md` (Lateral Rule) and `worlds-flight-2026-10-29.md`.*

## 1. The rule
A **regard** or **listen** only answers when the viewer is **physically at the spot** — a place in the scene, tied to something that exists there. "Stay still anywhere in the world" is gone. To find the lore you must **go somewhere**, and to go somewhere you must be able to **move freely**.

## 2. What counts as "the viewer"
| World mode | The viewer is | How they move |
|---|---|---|
| Station, Deep Past, Scale, People, Quiet/Archive (flight worlds) | **Her ship**, once deployed | NEW: **tap anywhere to fly there** (plus the existing Fly-to tiles) |
| Growing Place | **Her ship walking** the terraces | existing tap-to-walk |
| Eternity | the orbit camera | (no free movement yet — see §7) |
Not deployed (still on the orbit overview) → a plain caption: "Take your ship out into the world first." No spot can be reached from the overview.

## 3. Spots (data, in `shared/storyTriggers.ts`)
Each regard/listen trigger gains `spot`:
```
spot: { place: <PLACE_RULES regex source>, at?: [dx,dy,dz], near: <× place radius>, min?: units }   // flight worlds
spot: { origin: true, near: <units> }                                                           // the garden: the witness tree is the origin
```
- `place` is one of the **existing** `PLACE_RULES[world]` patterns (the scene's own named holders), so spots follow the scene: a model that is not loaded simply has no spot (fail closed), and a test pins that every spot names a real rule.
- `at` shifts the point inside the place (units of its radius), e.g. the Station's **lower rim**: `[0,-0.85,0]`.
- Reach = distance from the viewer to the point ≤ `max(near × radius, min ?? 60)`.
- Hidden: **no marker, no glow, no list.** The Fly-to tiles never include a spot. A place is a *landmark*; the spot is somewhere about it.
- Several entries may share one landmark (the Station's annex holds two); the daily rule (once per world per day) still limits answers.

## 4. What stays server-side (honest limit)
The server still validates entry, trigger, **world** (travel ledger), **Hour / good day** and **once per day per world**. It **cannot** verify position (the client reports it, like a met person) — so the spot is a game rule enforced by the app, not a security boundary. A modified client could skip walking; that costs only that player their own surprise.

## 5. Stillness is physical too
Stillness (8 s) now also requires the ship to be **parked** (flight idle/arrived, or walk route empty). Moving, or any touch/key/scroll, ends it.

## 6. Tap to fly
In flight worlds a tap (≤ 10 px movement, ≤ 400 ms) on the scene raycasts the scene; the hit point (or, on a miss, the point on the ship's altitude plane under the tap) becomes a flight target `{center, radius: 14}`. Same align → spool → burn → stop as the Fly-to flight, so scale feels the same. A tap on the orbit-drag gesture, a pinch, or a double-tap reset never flies.

## 7. Not in this slice
- **Eternity**: no ship movement there yet; its three entries use "the viewer is the camera" with no spot until Eternity gets a travel model (open question for the owner).
- **Measured placement in the 3D scenes**: spots are anchored to named landmarks with generous radii; fine-tuning (exact positions) needs a headless pass per world or the owner's eyes on a phone.
- A faint **proximity cue** (like a glint) is deliberately NOT included — the owner wants it hard to find. One constant would add it.

## 8. Tests
Pure (shared): every spot's `place` names a real rule of its world; no spot for a world without a viewer model except the documented ones; reach maths. Web: locate-by-name over a synthetic Three scene, within/outside reach, "not deployed" answer, and that a stillness away from every spot says "Nothing stirs".

## 9. Measured in a real browser (2026-10-31, headless Chromium 412×915, `scripts/spots-check.mjs`)
Landmarks the spots resolve to in the built scenes (radius, reach in world units).
| World | Entry → landmark | radius | reach |
|---|---|---|---|
| Station | second seam → `station-rotating` lower rim | 384 | ≈173 |
| Station | the Sleepwalker's lantern, the lane to nowhere → `station-rotating` (two different edges) | 384 | ≈153 |
| Station | missing berth, tin soldier, blank nameplate → `witness-drydock-gantry` | 7 | 60 (min) |
| Station | faded ticket, Hesk's locked room → `annex-*` (two annexes) | 30 | 60 (min) |
| Deep Past | missing stratum → `glb-rim` lower strata; the ribbon → `glb-stair` | 564 / 783 | ≈395 / ≈352 |
| Scale | the hung star → any of six `planet-*` bodies; the cord → `iss-holder` | 22–48 / 56 | ≈60 / ≈102 |
| People | empty chair, Tamsin's ward, Kith's drawing → `field-ground` (three offsets) | 849 | ≈297 / ≈255 / ≈212 |
| Quiet/Archive | alcove, boat, hymn → `still-threshold`; hollow, edge → `field-ground` | 64 / 368 | 64–110 |
Guesses that measuring corrected: the Station's `hero-ship` and a Station `backdrop-*` planet are not in the scene (replaced by the rim and the drydock); the People world's only `backdrop-*` is a planet 3,000+ units away (replaced by the field); the Deep Past stair (r = 783) reached nearly the whole world at 1.4× (now 0.45×).
**Deep Past:** its models load slowly in a software renderer. It resolved once in the real browser, then timed out on reruns, so its two spots are confirmed by one measurement plus the scene's own holder list (`glb-rim`, `glb-stair`, `stratum-0…8` present). *Later idea:* the scene has nine named strata — the "missing sixth" could be tied to `stratum-6` itself.
**Not exercised in a real browser:** tap-to-fly (worlds would not mount reliably headless here). Unit-tested at the maths level only.

## 10. Addendum — Eternity (PROPOSED, not built; awaiting owner nod)
Eternity's ship does not fly: `eternity-player-ship` eases to one `ETERNITY_STAGES.presence.ship` anchor. Proposed physical model that fits that scene rather than inventing a flight one:
- **Where you stand = the stage you have chosen** (the same stage/pose control the world already has). Each of Eternity's three entries gets a *stage* it answers at: `sight.unlooked-direction` → the far side (`eternity-far`), `sight.long-room` → the long approach (`eternity-world`), `echo.eighth-bell` → beside him (`eternity-figure`). Regard/Listen answer only from that stage, same stillness (8 s), same once-per-day, same uniform "Nothing stirs."
- Moving between stages = a slow glide of the ship (existing easing), not free flight; the figure stays at cosmic scale and never moves toward you.
- Cost: one `stage` field on `StorySpot`, the viewer-position provider in WorldsSurface returning the current stage, and a glide target per stage. No server change.
- Open for the owner: do you want free flight in Eternity (bigger scene work, changes his "he stays put" feel) or the three stages above (recommended)?
