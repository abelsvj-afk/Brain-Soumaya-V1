# Stage C — Great Station Pilot: Build Report

**Date:** 2026-10-31 · **Builder:** Blender production agent (Blender 4.2.23 LTS via MCP)
**Basis:** Stage B brief §1 + Part 13 pilot plan; Stage A inventory §1; OWNER-CONSTRAINTS.md
**Master file:** [soumaya_worlds_master.blend](sandbox://workspace/Soumaya-Environment-Production/source/soumaya_worlds_master.blend) (4.02 MB, two scenes: `STATION_EXTERIOR` / `STATION_INTERIOR`, collections mirror holder names 1:1)
**Build scripts (rerunnable, in order):** `worlds/great-station/gs_lib.py`, `build_00_setup.py` … `build_08_export_validate.py` (+ fix passes `06b`, `07b–07e`); machine-readable results in `worlds/great-station/validation_results.json`.

> **Status: pilot complete.** All Part 13 build steps were executed; the six required preview renders exist on disk; both pilot GLBs are exported and validated **as files**. Per Part 13 the GLBs are validation artifacts — integration is a separate authorized stage and has **not** been touched. Nothing in the repo was modified; no production GLB was overwritten.

---

## 1. What was built, step by step (Part 13.2 order)

**Step 1 — Blockout at true scale.** Grey-box volumes for every exterior anchor; bounding boxes verified *before* detail: wheel Ø 420 centred on origin; hero mooring radius 228.5; gantry at Blender (88, −195, ·) = three.js [88, 20, 195]; hauler at [30, 10, 220]; backdrop planets at 3,805–3,878 units. A source check against `stationScene.ts` settled the wheel's orientation (torus rotated flat → ring in the Blender XY plane; the "lower rim" of lore is the rim's underside).

**Step 2 — The wheel.** 48 rim segments (1 authored mesh — main plate + outer gunmetal plate + deck/keel strips — and 47 linked duplicates sharing the datablock), hub + 6 spokes + truss diagonals + inner band. **48 beacons, every 8th pale cyan** (6 cyan / 42 amber, verified by material audit). The **second seam is modelled SEALED** on the rim underside: an older-finish band with two groove lines — no opening, no glow, no mechanism. Relic resting places dressed under `relic-mounts` only (Harbor Nail plinth at the seam; Mooring Ring mount stone at the harbour edge) — no relic models in this export, per plan.

**Step 3 — Drydock complex.** Gantry as its own compact holder (twin legs, beam, hoist + cable + hook, cabin with lit glass, twin work lights) at [88, 20, 195]; witness drydock and main drydock pads with cradle arms and keel blocks; dressing (containers, pipe run, drums, crates) merged under `dressing-drydock`; four emissive work-light poles under `station-work-lights`. **The berth-board stands beside the gantry: 12 slots, 11 lit amber, slot 07 dark — the missing berth — all faces blank.**

**Step 4 — Annexes.** Three distinct clusters, re-materialed to basalt/gunmetal with amber window slits: lunar annex (two domes + module + tunnel; a **blank pale tag — the faded ticket — beside its door**), colony ring (ring habitat on legs + core), station stores (three slabs + twin tanks; **Hesk's locked-room door: panel + two crossbars**, no text, no lock iconography). Each cluster also has its `annex-model-<key>` representative module; shared clutter under `dressing-annex`.

**Step 5 — Traffic & docked.** Six traffic hulls on lanes at radius 288–330 with stern glows; three docked hulls at the harbour edge; docking shuttle; harbor-controller ship carrying the harbour's one non-beacon cyan nav marker; witness hauler (final build) at [30, 10, 220]; fallback hull populated. All hulls are clean modelled geometry in the shared material system.

**Step 6 — Backdrop.** Lava planet (procedural crust/crack-emission shader) and banded planet at ≈3,900 units on `backdrop-lava` / `backdrop-quaternius-planet-1`; star dome (generated 1024×512 starfield, ~2,600 stars) parented to the root; world background is the locked indigo `0x0b1026`.

**Step 7 — Materials & light pass.** Shared library (basalt, gunmetal, amber emissive, cyan emissive, seam-old, glass, interior set) applied throughout; cold key sun + dim indigo fill; AgX grade with a Fog Glow compositor pass. **Cyan audit and text audit run as checklist items (§3 below).**

**Step 8 — Interior.** Four self-contained room sets under `station-interior` (no corridors — jump navigation, as designed): **hangar bay with her ship floating at the exact centre** (keel ≈7 units clear of the floor, floor guide strips below), bay door lintel + frames, rim arc; **commission board** (32-unit board of 18 abstract lit/unlit cells — no text or numbers — desks, screens, chairs); **fleet deck** (two fleet hulls on display stands under `interior-model-fleet-1/2`, crates, work light); **observation deck** (viewport lintel + mullions + real transparent glass framing a wheel arc, a lit backdrop planet and stars; console and seats warm in the foreground). Shared holders built once: gate lintels/lights over every door, **cyan nav markers at every door (navigation truth)**, work lights, light strips, per-room `interior-floor-<space.id>` / `interior-ceiling-<space.id>`.

**Step 9 — Preview renders.** Six EEVEE renders at 1280×720 (§2). Three grade passes were needed: pass 1 exposed a camera far-plane fault (planets/dome clipped at the default 1,000) and blown interiors; pass 2 overshot dark outside; the final grade holds deep indigo with readable hull form.

**Step 10 — Export + validation.** Two GLBs, verified in-file (§3). *Ordering note:* Part 13 places export after the owner's preview gate; this stage's tasking explicitly ordered export + validation as its step 10, so both are delivered together for the Stage D review. The GLBs remain unintegrated validation artifacts either way.

## 2. The six preview renders (all verified on disk)

| # | Shot | File | Size |
|---|---|---|---|
| 1 | Full exterior overview | [great-station-01-exterior-overview.png](sandbox://workspace/Soumaya-Environment-Production/previews/great-station-01-exterior-overview.png) | 938,980 B |
| 2 | Ring and harbor close-up | [great-station-02-ring-harbor-closeup.png](sandbox://workspace/Soumaya-Environment-Production/previews/great-station-02-ring-harbor-closeup.png) | 915,392 B |
| 3 | Drydock and ships | [great-station-03-drydock-and-ships.png](sandbox://workspace/Soumaya-Environment-Production/previews/great-station-03-drydock-and-ships.png) | 948,209 B |
| 4 | Annexes | [great-station-04-annexes.png](sandbox://workspace/Soumaya-Environment-Production/previews/great-station-04-annexes.png) | 930,159 B |
| 5 | Interior hangar | [great-station-05-interior-hangar.png](sandbox://workspace/Soumaya-Environment-Production/previews/great-station-05-interior-hangar.png) | 932,576 B |
| 6 | Interior observation deck | [great-station-06-interior-observation-deck.png](sandbox://workspace/Soumaya-Environment-Production/previews/great-station-06-interior-observation-deck.png) | 1,071,101 B |

Against §13.3's checks: shot 1 — the beacon circle is the first landing, wheel monumental, drydock foreground, traffic parallax ✓. Shot 3 — gantry a distinct compact silhouette; the berth-board's lit row reads beside it ✓. Shot 5 — ship centred and visibly floating over its guide strips ✓. Shot 6 — the lintel frames arc + planet; interior warm against indigo ✓. **Shot 4 is the weakest of the six** (see §5): the clusters read in silhouette against the rim rather than as three distinct masses.

## 3. Export & validation results (§13.4 checklist, actuals)

**Files:** [great-station-pilot.glb](sandbox://workspace/Soumaya-Environment-Production/exports/great-station-pilot.glb) (exterior) · [great-station-interior-pilot.glb](sandbox://workspace/Soumaya-Environment-Production/exports/great-station-interior-pilot.glb) (interior)

**Anchors — PASS, mechanically diffed.** Exported node names were parsed out of each GLB and diffed against the §1.8 list: **zero missing in either file** (32 exterior names incl. `star_dome`; 25 interior names). In-file root purity is asserted at export time: the exterior GLB contains `station-world` and **not** `station-interior`, and vice versa. `REF_locked` / `CAMERAS_pilot` are absent. `witness-drydock-gantry` is a separate compact node; `station-rotating` is one node. Pattern holders are present for every real key used (`annex-*` ×3 + `annex-model-*` ×3, `backdrop-*` ×2, `traffic-*` ×6, `docked-*` ×3, `drydock-*` ×2, `dressing-*` ×2, `interior-floor/ceiling-*` ×4 rooms).

**Bounding boxes (measured from the exported GLBs, glTF Y-up):**
- `station-rotating`: centre (0, 3.5, 0); footprint 450.2 × 450.2 — **centreline diameter exactly 420** (radius 210 as specified); the 450.2 outer figure is the rim's plate overhang (the app's own shipping torus measures Ø 472 outer, for reference).
- `hero-ship`: centre (80.1, 4.1, 214.0); **mooring radius 228.5** (target 228); longest extent 12.7 = the exact 12-unit hull + its stern-glow fitting.
- `witness-drydock-gantry`: holder centre (91.9, 18.9, 191.0) — the *tower itself stands exactly at [88, 20, 195]*; the holder centre shifts because the berth-board stands inside the same holder beside the tower, exactly as the inventory anchors it. Footprint 24.8 × 14 — compact ✓.
- `backdrop-lava`: centre distance from origin ≈ **3,878** (target ≈4,000) ✓.
- `interior-bay-ship`: hull centred on the hangar's centre (assembly bounds centre −0.6 in x from the stern fitting only); keel ≈7 units above the floor — **floating, as required** ✓.

**Budget & file — tris and size PASS with wide margins; draw calls NOT MET (flagged, §5):**
- Exterior: **21,832 tris** (internal target ≤500,000), **755,056 B** vs the 3.99 MB `space_station_3.glb` baseline. Draw estimate **176** unique mesh+material sets (269 mesh objects) vs internal target 72 — **miss**.
- Interior: **4,500 tris**, **357,392 B**, 147 nodes. Draw estimate **122** vs target 64 — **miss**.
- Textures: no texture over 1024 (the starfield is 1024×512; no 2048 hero textures were spent — the §1.9 line was held; geometry carries the detail).

**Mysteries & discipline — all signed:**
- Second seam **sealed** (underside band + grooves; inspected in-scene; no opening, no light from within, no mechanism) ✓
- Hero **nameplate blank** — a plain untextured plate (`hero_nameplate_BLANK`; same in the hangar) ✓
- Berth-board 12 slots / 11 lit / 1 dark, **no text or numbers** ✓
- **Cyan audit:** exactly 15 objects use the cyan material — beacons 00/08/16/24/32/40 (every 8th), the controller's nav marker, and the 8 interior door nav markers. Navigation only ✓
- **Text audit:** no text objects exist in the file; the only image texture is the starfield (dots); no letterforms in any geometry ✓

## 4. Decisions taken inside the brief's latitude

- **Hero ship = a clean modelled stand-in hull** (length exactly 12, blank nameplate). The CC-BY-NC `soumaya-ship.glb` was **not** imported, and the ship was **not** swapped — §1.7: the pilot does not swap the ship; the stand-in holds the seventh hull's identity (length, mooring, blank plate) for composition and validation. The CC-BY-4.0 `organic-spaceship.glb` swap remains the recorded pre-commercial step.
- Annex/traffic/docked hull forms are original low-detail geometry in the locked material system (no third-party meshes were imported into the pilot, so no new licences attach; Kenney/Quaternius reuse remains available to later stages per §1.7).

## 5. Deviations, misses, and known limitations (nothing here is hidden)

1. **Draw-call internal targets missed** (176 vs 72 exterior; 122 vs 64 interior). The pilot prioritised 1:1 anchor fidelity: every holder is a real node with its own geometry, and statics were not merged. The §1.9 fix is mechanical and identified — merge dressing per holder, merge annex statics per holder, instance repeated smalls — and does not change any anchor or silhouette. Tris and download size, the hard constraints, pass at ~4% and ~19% of budget respectively.
2. **No 1024 hull atlas was authored.** Hull detail is geometry-led (plates, deck/keel strips, bevels) over flat PBR materials. The atlas is post-pilot art work; per §1.9's flagged conflict, no texture spend beyond 1024 was made.
3. **Backdrop planet materials are procedural shader graphs.** They render as designed in Blender (lava cracks glow; banded gas giant), but glTF carries only a base-colour approximation of them. For this world family the app-side direction is already shader planets under the same holder names (Stage B §2.7 carried spec), so the holders — not the shaders — are the deliverable.
4. **Shot 04 (annexes)** reads the clusters in silhouette against the rim; a dedicated camera inside the rim band would present them properly. Recorded as a follow-up rather than re-rendered a third time.
5. **Cosmetic duplication in the .blend:** a crashed first lighting pass left a duplicate key sun in the exterior scene (coincident with the original). All final grades were tuned with it in place; lights do not export. Flagged for cleanup before any further lighting work.
6. **Exporter quirk found and worked around:** this build's glTF exporter silently ignores `use_selection` (a clean exterior-only selection still exported both scenes — caught by the in-file root-purity assert, not by eye). Exports now gate on `use_visible` + global hide flags and assert root purity from the written file. First-pass GLB figures quoted during the build (26,332 tris interior) were from the contaminated merged file and are superseded by §3's numbers.
7. **Build incidents (for the record):** the Blender daemon died twice — a VM service restart wiped the system libEGL install (restored from the workspace's saved .debs, the documented recovery) and the MCP client timed out on long software renders while Blender kept rendering server-side; every render was verified on disk before being claimed. `read_factory_settings` also kills the MCP connection and was avoided thereafter.

## 6. What remains

- **Stage D gate (owner):** review the six renders + this report. Nothing integrates before that word.
- Post-pilot polish backlog (only if the pilot is approved): per-holder static merging to meet draw targets; the 1024 hull trim atlas; a dedicated annex portrait shot; duplicate-sun cleanup.
- The remaining eleven worlds follow the same pattern per §13.5, each with its own brief, blockout checks, budget actuals, and mysteries checklist. **Eternity remains surround-only — his figure is never rebuilt (owner constraint).**
