# P2-6 Provenance Inventory — The Great Station Scale-Up

Every asset the Station scene ships, with source, license evidence,
modifications, measured tri count, and final file identity. Credit record +
ledger match the actual shipped files. Full 49-row source:
`~/workspace/worlds-vision/p2-6-assets/PROVENANCE.md` (+ `LEDGER-INPUTS.md`,
`delta-verification-log.txt`).

## Hero — Soumaya's own ship (IDENTIFIED — CC-BY-NC, commercial-use constraint)

| Field | Value |
|---|---|
| Final file | `packages/web/public/soumaya-ship.glb` (already in the repo) |
| Source | Already shipped in the home galaxy; loaded by `graph/soumaya.ts` |
| Measured | 37,026 tris, 10 meshes, 3 materials (Material.001/002/003), KTX2 1024×1024, Draco + clearcoat + BasisU, 2,364,720 B |
| SHA-256 | `24c4c9df6582b06aed6fe6fa5efc326c16255888faace2e4fa1548d62dda5a24` |
| Forward | Nose at glTF +Z, engine rings at −Z; forward length 13.53; scaled to 12 in-app |
| License | **IDENTIFIED — CC-BY-NC (non-commercial use only).** The model is 3DHaupt's "Intergalactic Spaceship Version 2": the GLB's own node is named `Intergalactic_Spaceships_Version_2`, the in-file copyright reads "Modeled and Textured by 3DHaupt aka DennisH2010 (Dennis Haupt)", and BlendSwap lists the model as cc-by-nc (multiple listings, consistent); the author himself on Free3D: "Personal use license means you can use it for your non-commercial personal projects!" Identification verified 2026-10-26 (inventory Job 2 §2). **Constraint: before any commercial use of the worlds, the hero must be replaced with the verified CC-BY-4.0 fallback (`organic-spaceship.glb`, ricksticky, already in the repo).** Recorded in `public/CREDITS.md` and the in-app `WorldCredits` list. |
| Modifications | Recompressed (Draco + KTX2), materials re-tinted in-app (tint #c2d4f5, sheen #2f7bff, emissiveIntensity 0.3, metalness 0.35, roughness 0.45) |

## Traffic — Quaternius Ultimate Spaceships, native glTF source (11 hulls)

Source pack: `yolanother/QuaterniusUltimateSpaceships` (mirror of
quaternius.com/packs/ultimatespaceships.html), archive SHA-256
`8a3fb2c17ad866092f13a0b369756e9b0c65610849e796ec1f7b257f78d0d17a`
(262,762,185 B). In-file `License.txt`: "License: CC0 1.0 Universal (CC0 1.0)
Public Domain Dedication https://creativecommons.org/publicdomain/zero/1.0/ —
LowPoly Models by @Quaternius" (copy: `LICENSE-quaternius-ultimate-spaceships-pack.txt`;
SHA-256 `20b983ae0e2e555817495a65c37519bfcb2231825269db6a57d72c51ed6006e3`,
byte-identical to the Godot pack's License.txt).

Conversion: native glTF → GLB (`scripts/convert_quaternius_native.py`,
deterministic, re-runnable); textures resized 2048×2048 → 1024×1024 JPEG q85,
embedded; forward baked to −Z; **Draco-compressed** (3,674,500 → 2,295,644 B,
−37%) with tri counts exactly preserved on all 11 — the first run's Draco
rejection does not apply here, because it welded degenerate exhaust-apex
tris and the native hulls have no exhausts. Blender decoded Draco
`quaternius-bob.glb` and read back 938 tris / exact extents. Forward verified
empirically (`scripts/forward_check_quaternius.py`): native POSITION vs Godot
hull POSITION under all 24 proper rotations — all 11 hulls map
(x,y,z) → (−x,+y,−z) with unique-vertex match 1.0000 in both directions
(second-best rotation ≤0.057). Texture reuse: each assigned-color native PNG
is SHA-256 byte-identical to the Godot pack's PNG, all fully opaque; the
existing `tex/*.jpg` 1024 JPEG q85 resizes were reused, no PNG re-resized.
The native `.gltf` embedded image is the Orange colorway in every file —
discarded, replaced by the assigned color. Each hull: 1 mesh, 1 primitive,
1 material (`Texture`, doubleSided). **No exhaust meshes** — the exhausts were
a Godot-conversion addition; the native hulls ship without them. All 11 tri
counts match recon §3.3 exactly; all pass `gltf-transform validate` clean.

| Hull | Final file | Tris | Bytes | SHA-256 (first 16) | Texture |
|---|---|---|---|---|---|
| bob | `quaternius-bob.glb` | 938 | 175,260 | `540779a5669fc900` | Bob_Blue |
| challenger | `quaternius-challenger.glb` | 1,748 | 228,896 | `49624fd071684f33` | Challenger_Green |
| dispatcher | `quaternius-dispatcher.glb` | 748 | 183,220 | `4673746e31c8beae` | Dispatcher_Orange |
| executioner | `quaternius-executioner.glb` | 3,388 | 203,648 | `0e6c6a77f4fbd3a3` | Executioner_Red |
| imperial | `quaternius-imperial.glb` | 2,642 | 206,744 | `2950d798020d8005` | Imperial_Purple |
| insurgent | `quaternius-insurgent.glb` | 8,292 | 216,576 | `d0af8503a433f9ce` | Insurgent_Blue |
| omen | `quaternius-omen.glb` | 1,426 | 222,820 | `ad8fe5f3c7768b02` | Omen_Green |
| pancake | `quaternius-pancake.glb` | 2,688 | 222,876 | `ea933965ab2152a6` | Pancake_Orange |
| spitfire | `quaternius-spitfire.glb` | 3,512 | 207,036 | `05318cac77efd68c` | Spitfire_Red |
| striker | `quaternius-striker.glb` | 4,530 | 229,648 | `b0264bde7fe6bc23` | Striker_Purple |
| zenith | `quaternius-zenith.glb` | 2,152 | 198,920 | `02a5ebaa94c67b4c` | Zenith_Blue |
| **Total** | | **32,064** | **2,295,644** | | |

Fallback (NOT shipped in the app): the Godot conversion (11 files in
`p2-6-assets/glb-fallback/`, hulls 32,064 + 33 exhausts × 36 = 33,252 tris,
44 prims, 3,610,108 B; archive SHA
`84af1dfc9578d97be1bf80b70435309019710985164b0d5e417128fd885d0e2d`).
If the native source ever disappears, re-derive from the Godot conversion —
but note the fallback hulls carry exhaust prims the native set lacks, so the
ledger would move (traffic 64,128 → 66,504 tris, 11 → 44 calls).

## Traffic regular — WATO spaceship (XCVG Systems, OGA)

| Field | Value |
|---|---|
| Final file | `wato-spaceship.glb` (3,616,288 B) |
| SHA-256 (first 16) | `d9dcd28b1182d9f4` |
| Source | `ships-hunt/oga/wato/` (zip `wato_spaceship.zip`, SHA `4ed20928027ca6c919af4ffbb994cde9191030f301bc8b047aaafdd710924481`, 6,291,333 B) |
| License | CC-BY 3.0 **in-file** (full legal text + README in the zip). README: "distributed under the CC-BY 3.0 or OGA-BY 3.0 license, with later versions permitted" — "At a minimum, credit me as XCVG or XCVG Systems." **Attribution required: credit "XCVG" / "XCVG Systems"** (in `public/CREDITS.md` and `WorldCredits`). Copies: `LICENSE-wato-CC-BY-3.0.txt`, `LICENSE-wato-OGA-BY-3.0.txt`, `LICENSE-wato-README.txt`. |
| Measured | 730 tris, 18 meshes / 18 prims, 7 materials, 6 PNG textures embedded (1024, one 480), bbox 3.757 × 3.881 × 15.428, forward −Z |
| Materials | `MainMaterial`, `EngineBellMaterial`, `AftHullMaterial`, `AftHullMaterialC`, `FrontBitMaterial`, `PodMaterial`, `TopBitMaterial` — 7 distinct GLB materials. The hunt's "6 materials" counts AftHullMaterial(C) as one family; as GLB materials they are 2. Ledger: 7 calls (corrected during this build). |
| Modifications | Materials rebuilt as Principled BSDF + Image Texture nodes from the `.dae` effect map (the `.blend` materials are legacy non-node with no texture linkage); `PodMaterial.001` merged into `PodMaterial` (identical); three 2048 PNGs resized to 1024; forward normalized to −Z (rotation baked into vertex data); parents cleared; no Draco (3.6 MB is the six embedded PNGs, not geometry). `.blend` used because this Blender build has no Collada importer; the hunt cross-validated `.dae` and `.blend` at exactly 730 tris. |

## Docked ships, dressing, witnesses — Kenney Space Kit + Station Kit

License (both packs, in-file `License.txt`): "License: (Creative Commons Zero,
CC0) http://creativecommons.org/publicdomain/zero/1.0/ — This content is free
to use in personal, educational and commercial projects." Attribution
requested, not required. Space Kit (2.0) archive SHA
`d5d7cdf2635ed5a43a9187deaf409b6f47484e402321128341d3c3698e9ef4d9`
(6,677,531 B); Station Kit (1.0) archive SHA
`215e79bd5415cff93665183390f0343ed9acf87780306331013b78520170c6d8`
(1,835,875 B). Copies: `LICENSE-kenney-space-kit.txt`,
`LICENSE-kenney-space-station-kit.txt`.

Conversion: to GLB; materials re-expressed in-app. Space Kit GLBs needed a
`SCENE_NON_ROOT_NODE` repair (`gltf-transform copy`); tri counts and bboxes
re-measured identical before/after on all 27. **Station Kit GLBs reference
external `Textures/colormap.png` (512×512, 7,440 B)** — the file must ship
alongside them (or be embedded) or the material renders untextured; recon
§3.1 was wrong that the reference does not exist.

| Role | Model | Final file | Tris | Calls |
|---|---|---|---|---|
| Docked | craft_cargoA | `kenney-space-craft_cargoA.glb` | 264 | 1 (merged) |
| Docked | craft_cargoB | `kenney-space-craft_cargoB.glb` | 380 | 1 (merged) |
| Docked | craft_miner | `kenney-space-craft_miner.glb` | 384 | 1 (merged) |
| Docked | craft_racer | `kenney-space-craft_racer.glb` | 280 | 1 (merged) |
| Dressing | container | `kenney-station-container.glb` | 88 | 1 |
| Dressing | pipe | `kenney-station-pipe.glb` | 20 | 1 |
| Dressing | platform_large | `kenney-space-platform_large.glb` | 76 | 1 (merged) |
| Dressing | structure_detailed | `kenney-space-structure_detailed.glb` | 232 | 1 (merged) |
| Dressing | hangar_smallA | `kenney-space-hangar_smallA.glb` | 280 | 1 (merged) |
| Dressing | satelliteDish_large | `kenney-space-satelliteDish_large.glb` | 186 | 1 (merged) |
| Drydock | hangar_largeA | `kenney-space-hangar_largeA.glb` | 412 | 1 |
| Drydock | platform_large | `kenney-space-platform_large.glb` | 76 | 1 |
| Drydock | structure_detailed | `kenney-space-structure_detailed.glb` | 232 | 1 |
| Drydock | structure | `kenney-space-structure.glb` | 168 | 1 |
| Witness | craft_cargoA (hauler) | `kenney-space-craft_cargoA.glb` | 264 | 1 (merged) |

The Station Kit is interior furniture — it supplies dressing only, never the
hauler or drydock witnesses (hauler = Kenney craft_cargoA; drydock = Space Kit
composition above). Kenney ship forward axis UNVERIFIED — docked ships moor
parallel to the arm, so it does not matter for the read.

## Pre-existing (not P2-6, listed for completeness)

- Base hull: Profondo by vostok (BlendSwap), CC-BY 3.0, 132,432 tris after
  decimate, 5 material groups / 5 calls. Attribution in `public/CREDITS.md`.
- Starfield: HYG database (Astronexus), CC BY-SA 4.0, brightest-stars subset.

## Staged but NOT shipped (deferred)

- NASA probes (public domain — repo README: "These assets are free and without
  copyright"; copy `LICENSE-nasa-README.md`; NASA insignia check: none found):
  Kepler-A.glb (9,042 tris, SHA `382014d90e2cf3e1f23e931d233547e652fe3629fddfb5acb8a99e2ceb72ff19`,
  2,003,276 B, world bbox 2.651 × 5.007 × 2.663, scale factor ×1.9972 to ~10
  units) and Pioneer10.glb (8,189 tris, SHA
  `81443a7fa01cca0dda878cd27692b3307f9c332c4eb8e55a844499d7b350573c`,
  2,049,840 B, mesh-local bbox 505.106 × 645.930 × 203.486 but node scale
  0.0124867 makes the world bbox 4.516 × 8.247 × 2.541, scale factor ×1.2126
  to ~10 units — NOT 10/645.93). Deferred to Scale Space by
  call budget. Both validate clean (severity-1 warnings only, pre-existing
  PNG-colorspace notes on the foil-ramp fallbacks and Pioneer's `RTG_AO_new`,
  reported not fixed). Dawn, Voyager, Deep Space 1 stay out entirely.
- Kenney speederA–D (4 ships, converted and measured in
  `p2-6-assets/glb/`, CC0): unwired traffic-variety headroom for a later
  increment.
- Shipped-set totals (`glb/`, 52 GLBs): 58,475 tris, 198 prims, 10,567,232 B
  (+7,440 colormap) — 11.7% of the 500k tri target. The scene itself uses
  246,056 tris (see the build record ledger); the rest is staged headroom.

## Excluded (do not ship)

- OGA stylized spaceship — no license file in the downloaded zip (B-2 hard case).
- Hunt §4 ships — **EXCLUDED, settled 2026-10-26 (build-all delegation)**:
  eleven hulls, 15,539 tris — Luxwing kit (6), Starship Corvette, Star Ship
  low-poly, Space.blend, CWU, archfan7411. Their pages say "free" but no
  license travels with the files. **Rule: a page-only license is not
  enough — the license must be verified FROM the file before a ship can
  sail here.** Recorded in `public/CREDITS.md` ("Not shipped").
- No OGA §4 files anywhere in the outputs; zero OGA files shipped.

## Quaternius license — SETTLED (in-file CC0 governs the files as shipped)

Settled 2026-10-26 (build-all delegation). Then (recon, 2026-10-25):
quaternius.com stated CC0; the Godot Asset Library record (2023-02-19)
says CC0; every downloaded pack carries `License.txt` stating CC0 1.0.
Now (hunt, 2026-10-26): https://quaternius.com/license.html shows a
"Quaternius Asset License (QAL) v1.0 — Last updated: 8/28/2026" (full
text saved at `ships-hunt/quat-license.html`). **Settlement: the in-file
CC0 governs the files as shipped** — the files already downloaded carry
CC0 1.0 in-file (License.txt, SHA `20b983ae…`, identical in the native
mirror and the Godot pack), and the Godot record says CC0. Both CC0 and
QAL permit what the app does — incorporating the ships into the product
with no credit. **The app does not redistribute the raw packs** — only
the converted hulls ship inside the app. What the QAL change DOES mean:
new downloads from quaternius.com now come under QAL rather than CC0,
so any future Quaternius pull must be checked against QAL, not assumed
CC0. The build ships the Quaternius hulls on the strength of their
in-file CC0, with this record attached. If the owner would rather treat
QAL as governing, the hulls come out and any future redistribution of
the raw packs would need to follow QAL instead.
