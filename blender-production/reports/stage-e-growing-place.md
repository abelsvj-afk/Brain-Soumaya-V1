# Stage E — World 2: THE GROWING PLACE (Blender build report)

Status: IN PROGRESS — bake running; validation + final numbers pending.
Built: 2026-10-31. Production workspace only — repo and app assets untouched,
no commits/pushes. Station scenes (STATION_EXTERIOR / STATION_INTERIOR) not
modified. Pre-build backup:
`source/stage-e-backups/master_pre-growing-place_2026-10-31.blend`.

## What was built

Scene `GROWING_PLACE` in `source/soumaya_worlds_master.blend`, collection root
`growing-place` mirroring the Stage A inventory holder names 1:1.

- **Terraced island** — six terraces as one continuous landscape: radii
  900/780/660/540/400/250, heights 0/18/36/54/72/90, annulus terrain meshes
  with noise relief flattened at paths, groves, ramps and the crown; stone
  riser walls between levels; underside skirt (r 908→615, z −18→−60) and cap,
  so the island reads as a floating landmass from below/side.
- **Paths** — ring path on every terrace + six-step stone ramps crossing each
  riser, stone edging stones along the rings, and `lit-paths`: gold emissive
  inlay strips that catch the dawn light (visible in preview 01).
- **20 journey groves** — never ranked: identical kit, per-grove variation
  only from tree-variant mix (3 trunk/canopy kits), flower accent rotation.
  Each grove: lawn disc (r 52), curved trail to the ring path, merged trunks
  and canopies, flower ring, ground-pulse ring, warm halo sprite cluster.
  Mist ribbons on terraces 1–4 only. Groves sit at ring-path radius −42 so the
  lawn edge meets the path and the trail connects (a 52-radius grove cannot
  fit the 120-wide terrace annulus radially — interpretation, see below).
  Grove signs / landmarks are RUNTIME-generated per journey — the build
  supplies the grove kit + open lawn centres, never invented journeys.
- **9 plots** cycling the four families: gathering (7 seat stones + centre
  disc), sprout (soil mound + 9 sprouts), stone (4 tilted standing stones +
  pebbles), wild (tall tufts + bushes).
- **Seed pods** — 54 scattered near paths + 5 hero pods on the crown meadow.
- **Vegetation** — 650 grass tufts + 70 bushes merged into one holder,
  exclusion zones honoured (paths, grove lawns, crown centre r 30 kept open).
- **Witness tree (hero build)** — root-mound lathe, S-curve trunk (r 13→4.5,
  to z ~140 before the ×1.3 presence scale-up — tree total now ~230 tall),
  7 root flares, 6 limbs, 9 canopy blobs, witness halo (tilted gold ring +
  soft sprites). **The one dead bough is modelled BARE** — GP_deadwood,
  two bare twigs, verified clear of every canopy blob; never leafed.
  Seed-stone at its base; `relic-dawn-leaf` (gold leaf at the roots) and
  `relic-witness-seed` (half-buried stone egg beneath the tree).
  Crown standing room (r 30) kept open per the brief.
- **garden-avatar** — stand-in walker ship on the arrival meadow (hull, fin,
  3 leg struts, GP_hull) with **garden-carried**, a small gold seed pod
  hovering beside it (interpretation — the inventory names the holder but
  does not specify its content).
- **Backdrop holders** — `backdrop-planets-set` and
  `backdrop-quaternius-planet-2` as EMPTY holders at app-matching positions;
  planet visuals are shader-spec in the app and stay out of Blender geometry
  (brief §2). A third known backdrop (Sketchfab ice planet) has no certain
  holder key in the inventory, so no third holder was invented.
- **Sky** — the dawn is a GEOMETRY dome (render-only, radius 6,000, vertex
  colours: deep indigo zenith → mauve → gold horizon band → warm dark below
  horizon). A world-shader gradient was tried first and abandoned: on this
  camera family the shader's Fac varies only ~0.42–0.55 across the frame
  (measured), which crushed the gradient to a flat tan. The dome is
  deterministic in every engine. The world shader remains as ambient light.
- **Lighting** — warm dawn sun (3.6, shadows), indigo fill (0.5), crown point
  glow; AgX, exposure 1.12; Fog Glow compositor.

## Materials & bakes

37 GP_ materials built on a shared GP_SURFACE procedural group (two-tone
base, patch noise, speckle, groove darkening, roughness variation).
29 bake groups registered (`worlds/growing-place/scripts/bake_registry.json`):
diffuse + roughness baked in Cycles, ≤1024 px per holder group, packed, and
materials rewired to the baked pairs so the look survives glTF.
Literal (unbaked) materials by design: gold emissive, mist (alpha 0.13),
halo sprites (in-code radial gradient texture, softened to a (1−r)³ falloff),
flower accents, sprout leaf.

Bake results: PENDING (job gp-bake3, checkpointed).
Black bakes: the first run produced three — lawn_t0/t1/t2 at exactly 0.0 —
and diagnosing them found TWO geometry/material bugs, both since fixed in
the meshes, in the checkpoint, and in the build library (`gp_lib.py`):

1. **Flipped winding in the Geo kernel.** The `annulus` and `wall`
   primitives emitted faces facing down/inward, so every terrace top,
   riser, ring path, lit-path, grove lawn disc, pulse ring, plot base disc
   and the underside skirt had inverted normals (mean normal z = −1.0 on
   the tops). 18 meshes flipped in the master + checkpoint; kernel winding
   corrected in `gp_lib.py` (annulus/wall) with the disc builder's
   flip=True documented as underside-only. (The underside cap correctly
   faces down and was left alone.) EEVEE previews had hidden this — the
   materials render double-sided and the lawns were quietly lit by ambient
   only.
2. **Tiling UVs cannot be baked.** The kernel writes world-tiling UVs
   (position/220, wrapping ~9×); Cycles bake with tiled UVs returns pure
   black (proven by isolation test: same mesh + plain green material =
   black; same mesh + Smart UV = mean 0.397). Fix, matching the pass-2
   discipline of separating pattern coords from bake coords: GP_SURFACE
   now samples **Object coordinates** through a 1/220 mapping (identical
   pattern scale; the group patch is in `gp_lib.py` too), and every
   not-yet-baked mesh got a dedicated **GPB_UV** Smart-UV layer
   (66°, margin 0.003) as its bake/export UV. Groups baked before the fix
   (bark, foliage, hull, grove lawns — all on normalized UVs) are
   unaffected. A post-fix test bake of terrace_t3 measured mean 0.196 with
   the real lawn pattern (was 0.0).

Known accepted degradations (from the bake design): four bake groups share
one image across two same-family objects (stone_under: skirt+cap;
foliage_veg: vegetation+plots-wild; stone_witness: seed-stone+relic seed;
soil: sprout soil+plot discs) — overlapping UVs share texture space inside
the group; all are same-family noise materials so the sharing is invisible.

## Budgets (Stage B brief §2)

Brief budget: 95 draw calls / 700,000 visible triangles.
Actuals: PENDING validation.

## Previews

- `previews/growing-place-01-terraces-overview.png` — DONE (1280×720 EEVEE,
  64 samples, pre-bake procedural materials). Dawn dome, six terraces, lit
  paths, witness tree + halo at the crown.
- 02 arrival meadow / 03 grove path / 04 witness tree — to be rendered from
  the BAKED scene: pre-bake close-range renders are pathologically slow on
  this machine because the procedural GP_SURFACE group is evaluated per
  pixel on a software rasteriser (a 320×180 probe of cam03 exceeded
  6 minutes pre-bake). Baking first is also the pass-2 order of operations.
- Shot 02 was reframed after its first render came back as a view of the
  island's flank: the camera now stands ON the arrival meadow.

## Validation

PENDING — batch job job_validate.py against exports/growing-place.glb:
anchor diff vs the inventory list (runtime-generated grove-sign/landmark
patterns excluded by design), triangle/draw counts, bounding boxes
(extent ≈1,816 across; z −60…~230), witness-tree bbox, re-import Cycles
still + magenta (missing-texture) pixel check.

## Batch-worker usage

PENDING final tally. Jobs so far: gp-bake (failed at group 2 — script bug:
colorspace set on the texture node instead of the image; fixed),
gp-bake2 (killed by the OOM-victim policy at ~126 s while the GUI was
concurrently rendering — batch + GUI renders do not mix on this 7 GB
machine), gp-bake3 (checkpointed re-run).

## Interpretations & shortfalls (stated plainly)

- Groves at path-radius −42 (see above) — geometry forced it; trails connect
  grove to path exactly as the brief's "connecting paths" require.
- garden-carried = a carried gold seed pod (holder content unspecified in
  the inventory).
- No water feature: the Growing Place brief does not include one.
- Backdrop planets are empty holders (app shader spec), not geometry.
- The witness tree was scaled ×1.3 about its base for crown presence
  (visual-art choice inside the brief's "hero build" mandate; layout facts
  unchanged — origin, crown r 30 clear, relic positions carried along).
- Pre-bake preview 01 vs baked previews 02–04 may differ subtly in surface
  response; the GLB ships the baked look.
