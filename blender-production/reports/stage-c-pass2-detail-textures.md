# Stage C Pass 2 — Great Station: Detail + Textures

**Status: COMPLETE.** The pilot has been rebuilt to a professional material/detail
standard: real PBR surfaces baked to textures that survive glTF export, detail
modelling in every area, and the pass-1 draw-call overruns fixed by merging
inside holders. All work is inside `~/workspace/Soumaya-Environment-Production/`;
no repo/app asset was touched; nothing was committed or pushed.

Master: `source/soumaya_worlds_master.blend` (scenes `STATION_EXTERIOR`,
`STATION_INTERIOR`). Exports: `exports/great-station-pilot.glb`,
`exports/great-station-interior-pilot.glb`. Renders: `previews/` (pass-1 renders
preserved in `previews/pass1/`).

---

## 1. Materials + textures (the core of this pass)

One shared procedural surface group (**GS_SURFACE**) drives 11 PBR materials:
Voronoi plate breakup (two-tint plate mix), distance-to-edge groove seams
(darkened + recessed via a baked height→normal map), broad grime noise in
colour and roughness, and fine noise in roughness/micro-height. Materials:
basalt plate, basalt light, gunmetal, gunmetal dark, hull pale, deck plate,
interior wall, warm wood, old seam, pale paper, pale marking.

**Export rule honoured:** no raw procedural graph ships. Every textured
surface was **baked** (Cycles: diffuse colour-only, roughness, and
height→normal via Sobel) into image textures that are packed into the .blend
and embedded in the GLBs. Emissive (amber/cyan), glass, planet and star-dome
materials use literal Principled inputs only, so they export losslessly
without baking.

Bake sizes (per holder group, ≤1024 px as specified):

| Resolution | Groups |
|---|---|
| 1024 | rim segment (drives all 48 instances via the shared datablock), wheel rest (hub/spokes/gantries), witness gantry, lunar annex, hangar, commission board, observation deck, hangar floor |
| 512 | drydocks + dressing, witness, colony/stores + annex models, dressing-annex, relic mounts, work-light poles, all 13 exterior ships, fleet deck, floors/ceilings (except hangar floor), lintels, rim arc, interior ships + fleet models |
| 256 | traffic fallback hull |

49 diffuse maps were verified numerically after baking (per-map covered-texel
means all in the expected albedo ranges; zero black/failed bakes).
Weathering comes from the group's own grime/roughness variation baked into
the maps — restrained, working-station wear. **Baked AO was deliberately not
used**: this scene's AO bake is unusable (see §6) and the group's grime does
the weathering job instead.

Grade (both scenes): AgX Medium-High Contrast, exposure 1.45, deep-indigo
world at 0.75, one consolidated key sun (pass 1 had three coincident copies)
plus cool/warm/indigo fills; Fog Glow compositor retained.

## 2. Detail added, per area

- **Wheel/rim:** the rim segment was rebuilt as a real assembly (bevelled main
  plate, outer/inner skins, deck + keel plates, 3 outer ribs, 16 window slits
  per segment — 3 dark, docking-port frame + recess + ring + amber slits on
  the inner face, radiator panels + fins both sides, top hatch/conduit/
  blisters/tank, keel piping) and instanced ×48; beacons rebuilt as fixtures
  (housing + post + dome; 42 amber, 6 cyan navigation); hub gained 8 radiator
  fins, 6 spoke fairings, antenna mast + dish, docking ring + dark disc;
  4 maintenance gantries with amber lamps on the inner rim. The second seam
  remains modelled **sealed**.
- **Drydock:** gantry rails + stops, X-bracing, trolley, second cable + hook,
  scaffold arms ×2, umbilical tower, work-light rigs (3 amber heads each),
  pad marking strips, witness scaffold + markings, dressing crates/drums/
  hose reel.
- **Berth board:** physical board — header plate (still **blank**), frame
  rails, shelf, strut, lamp; 11 amber-lit slots + 1 dark (slot 07), no text
  anywhere.
- **Annexes** (the weakest pass-1 render): lunar cluster — walkway tube +
  3 rib rings, door frame/lintel/step, 7 + 3 dome windows on the sphere
  surfaces, vent/tank/antenna/pipe runs; colony ring — 14 window slits around
  the torus, spoke conduits, foot pads, X-braces, door frame; stores —
  covered walkway, roof vents, pipe run, dock crane + crates, second window
  row; the three scale models got door/window/roof detail.
- **Ships/traffic:** hull-local detail children (fins, side stripes, engine
  housings) on hero + bay ship; traffic ×6, docked ×3 (with docking arms
  toward station centre), hauler + 2 cargo pods, controller + mast, shuttle,
  user ship. Engine glow amber/white; cyan only on navigation fixtures.
  Hull lengths unchanged (hero 12 units + fittings).
- **Interior hangar:** pilasters, girts, overhead crane (rails, bridge,
  hoist, cable, hook, lamp), ceiling panels, floor guide markings as
  geometry (pale centreline dashes + chevrons, amber berth outline — no
  letters/numbers), hero ship floating at centre with panelled hull and
  blank nameplate.
- **Observation deck:** 2 extra viewport mullions + mid-rail, cove light,
  2 benches, 2 side tables, console extensions with glow.
- **Commission board + fleet deck:** board frame, 3 overhead light panels,
  desk lamps/modesty panels, cable trunk, wall panels, floor trims;
  fleet-deck railings + blank placards around both model displays, spot
  discs, crate straps.

## 3. Draw calls — fixed

Merging was done **within** holders only; every holder remains a distinct
named node with its correct bounds.

| Scene | Pass 1 | Pass 2 | Target |
|---|---|---|---|
| Exterior | 176 | **54** | ≤72 ✓ |
| Interior | 122 | **33** | ≤64 ✓ |

(Draw figures are the pass-1 estimator: mesh objects after instancing
accounting, measured on the live scenes; GLB primitive counts are 104
exterior / 34 interior.)

## 4. Triangles + file sizes

| Export | Pass 1 | Pass 2 | Budget |
|---|---|---|---|
| Exterior GLB | 21,832 tris / 755,056 B | **83,536 tris / 19,865,564 B** | ≤500k tris ✓ |
| Interior GLB | 4,500 tris / 357,392 B | **6,800 tris / 16,914,344 B** | — |

Detail raised exterior geometry ~4× while staying at 17% of the triangle
budget. **The file-size growth is textures, not geometry**: 18.32 MB of the
exterior GLB and 16.44 MB of the interior GLB are embedded PNG textures
(89 + 60 images, max dimension 1024 ✓). Fine for a production master; a
future app-integration stage should re-encode (basis/KTX2 or JPEG) before
shipping to the web.

## 5. Validation (mechanical, from the exported files)

- **Anchor diff: zero missing** in both GLBs (32 exterior + 25 interior
  anchor names), root purity asserted (`station-world` only in exterior,
  `station-interior` only in interior, no REF/CAMERA leakage).
- **Bounding boxes re-measured from the GLBs:** wheel centreline Ø **420.7**
  (420 spec + bevel allowance), centred on origin; hero ship centre at
  radius **228.8** (mooring 228.5), length 13.2 incl. fittings; gantry
  holder spans x 63.6–122.4 at z≈195; backdrop planet centre ≈ **3,878**
  units out; interior bay ship centred (−0.6, 8.5) size 13.3.
- **Cyan audit:** exactly 3 objects use the cyan emissive material —
  `wheel_cyan_emit` (6 merged beacon domes), `controller_nav_marker`,
  `nav_markers_cyan` (8 merged interior markers) = the same 15 navigation
  fixtures as pass 1, nothing else. Cyan discipline holds.
- **Text audit:** zero text/font objects in the file; hero nameplate blank;
  berth-board header blank; second seam sealed.
- **GLB re-import check:** PASSED — see §7.

## 6. Defects found and fixed during this pass (not just reported)

Three real defects were found in my own pass-2 pipeline and fixed in the
build; earlier intermediate renders/bakes that showed their symptoms were
discarded and redone:

1. **Hollow shader group.** A Blender 4.2 API difference (`feature_type` vs
   `feature` on the Voronoi node) killed the original GS_SURFACE build
   part-way; an existence-check then kept reusing the shell, so procedural
   colour/roughness baked black. Fixed the property name, rebuilt the group
   (28 nodes, outputs verified linked), re-pointed every material.
2. **AO multiply crush.** The scene AO bake returns near-zero for enclosed
   positions (the star dome + neighbouring structures occlude every ray;
   the rim segment, surrounded by its 47 siblings, baked AO ≈ 0.00), and
   multiplying it into diffuse annihilated the maps (rim diffuse went to
   0.2% coverage). Baked-AO weathering was dropped entirely; the group's
   baked-in grime/roughness variation does the weathering instead. Verified
   by controlled A/B bakes (segment diffuse 0.234 linear / 99.9% coverage
   without AO vs 0.000 with).
3. **Inverted groove mix.** The groove-darkening MixRGB had its two colours
   swapped for Blender's Fac convention, so plate interiors were darkened
   and the seams glowed bright (a cracked-glaze look). Swapped; seams are
   now dark, plates carry the tint.

Also fixed from pass 1: three coincident sun lights (combined 8.3 energy)
consolidated to one; the duplicate orphan cube from an aborted diagnostic
was removed.

## 7. GLB re-import check — PASSED

Both exported GLBs were imported into clean, empty Blender scenes (headless,
no master-file state) and rendered (`pass2/reimport_ext_overview.png`,
`reimport_ext_closeup.png`, `reimport_int_hangar.png`, `reimport_int_obs.png`):

- Exterior imports as 134 objects with the full baked texture set embedded
  (per-group diffuse/normal/roughness at 1024/512/256 as baked). The
  close-up still shows the rim's baked plate-and-seam texture, amber beacon
  domes and a cyan navigation beacon — texturing is in the file, not an
  in-Blender effect.
- Interior imports as 63 objects; hangar still shows the bay ship's
  panelled hull, wall/floor textures and crane; observation still shows
  the textured viewport lintel and mullions.
- No missing-texture (magenta) surfaces anywhere in any still.

## 8. Still short of the bar — stated plainly

- **Plate pattern shape.** The baked panel breakup is Voronoi-polygonal, so
  at close range the hull reads as irregular plates with a slightly
  "quilted" normal relief (most visible in the hangar, shot 05) rather than
  the crisp rectangular panel grid of a built ship. It reads correctly as
  paneling at overview/drydock distances (shots 01–03). Rectangular UV-space
  paneling is the known next refinement if the owner wants it.
- **Shot 04 (annexes) is still the weakest render.** The annexes are now
  detailed and textured (colony-ring window slits read clearly), but the
  inherited camera is far away and the clusters sit on their unlit side, so
  the shot under-sells them. A camera/lighting adjustment for that one shot
  is recommended before any owner beauty pass.
- **Shot 02 framing** leaves much of the frame empty — the file's cam02 sits
  farther from the rim than the pass-1 render suggested; cameras were kept
  as-found per the brief.
- **Witness scaffold material** was simplified to uniform basalt when its
  merged mesh was re-based (its original multi-material mix did not survive
  the pass-1-era merge); it is a distant background prop and reads fine.
- **Backdrop planets** still use their pass-1 procedural materials in
  Blender; as in pass 1, their shaders do not survive glTF (they export as
  plain tinted spheres) — unchanged known limitation, out of this pass's
  scope.
- **Texture weight** (§4): the GLBs are production masters, not web-ready
  assets; compression is an integration-stage task.
- Eternity was not touched in this pass (Great Station only); his GOB figure
  remains exactly as established, per the owner's constraint.
