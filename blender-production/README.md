# Blender World Production — Soumaya environment reconstruction

Owner-ordered push (2026-10-31): the built worlds go into the repo now so
another chat can expand on them. This folder is the production workspace,
snapshotted from the live build machine. It changes NO app code and NO
existing app assets.

## What's here

- `source/` — the master Blender file (`soumaya_worlds_master.blend`,
  snapshot of the 2026-10-31 7:30 PM ET save; scenes: STATION_EXTERIOR,
  STATION_INTERIOR — Great Station, complete — and GROWING_PLACE, in
  progress) is attached to this repo's **Release
  `blender-worlds-2026-10-31`** as a downloadable asset: at 63 MB it
  exceeds the 25 MB web-upload limit, so it travels as a release asset
  instead of an in-tree file. `source/README.txt` in this folder says
  the same.
- `exports/` — game-ready GLBs validated against the app's anchor system.
  - `great-station-interior-pilot.glb` — Great Station interior, pass 2
    (detail + baked textures), anchor-validated, re-import checked.
  - The Great Station EXTERIOR pass-2 GLB and the Growing Place GLB are
    NOT in this push: the exterior export file was lost locally after
    verification (cause unknown) and its re-export, plus the Growing
    Place bake/export, were still running when this snapshot was taken.
    Both follow in a refresh push to this same branch. The master .blend
    above contains both complete scenes and is the source of truth.
- `previews/` — render stills. Great Station pass 2 set of six;
  `pass1/` holds the first-pass set for comparison. Growing Place 01–02
  (03–04 pending).
- `reports/` — the record: OWNER-CONSTRAINTS (binding), Stage A location
  inventory (every world, every anchor), Stage B visual translation
  briefs, Stage C pilot + pass-2 reports, batch-worker setup, and the
  Growing Place build report (in progress).
- `worlds/` — per-world build scripts. (The loose baked-texture PNGs are
  not in this branch: they are embedded in the master blend and in the
  GLBs; the full texture sets remain in the local production workspace.)
- `tools/batch-blender/` — the headless batch worker (bakes / exports /
  validation) with its README. One job at a time; works on COPIES of
  scenes, never the live master.

## World state at this snapshot

1. **Great Station — COMPLETE** at the pass-2 standard (detail + baked
   textures; draw calls 54 ext / 33 int; anchors zero-missing; cyan =
   navigation only; second seam sealed; nameplate blank).
2. **Growing Place — IN PROGRESS**: terraces/groves/witness tree built,
   previews 01–02 rendered, texture bake + export running.
3. Remaining queue (briefs in `reports/`): Deep Past, People,
   Quiet/Archive, Scale, Eternity (surround ONLY — his figure is
   untouchable, see OWNER-CONSTRAINTS), Faded Ward, Village, Siege,
   Unmade Hour, Road to the Seam.

## Rules that travel with this work

- Anchors are contract: collection/object names mirror the app's named
  holders 1:1; never rename, never merge across holders.
- No lore invention, no removed locations, mysteries stay mysteries
  (see reports/OWNER-CONSTRAINTS.md).
- Integration into the app (swapping these GLBs for the app's current
  models) is a separate stage, not part of this folder's pushes.
