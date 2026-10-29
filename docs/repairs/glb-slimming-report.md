# GLB slimming report — the "very slow" fix

## In plain language: what happened, what it means, what's next

**What happened.** All 13 of the app's big 3D model files were made much
smaller — from about 85.6 MB down to about 17.4 MB in total, roughly an
80% cut — without changing any model's shape, size, position, or animation.
The biggest single win is the home space station, which went from
14.67 MB to 3.99 MB. That station loads at startup, so it was the main
reason the app felt slow to open.

**What it means.** After this lands, each world downloads a lot less data
when it loads (see the before/after world table below). Most worlds dropped
by about half. The models themselves look the same: the number of tiny
flat pieces that make up each shape is unchanged, every named part and
every animation is still there, and every world still passes its health
check with zero errors. One honest exception: the world totals are still
above the original "every world under 10 MB" aim, because a world load
also pulls in other things besides these 13 files (app code, other models
that were not in scope, and so on). The cut is real; the 10 MB aim is not
yet met, and that is stated plainly rather than claimed.

**What's next.** This report and the 13 files go to the branch
`assets/glb-slim`. They are **not merged to main** by this work. Claude
verifies and merges. Before any merge, Sajacous should eyeball the three
hero assets — the station, Eternity's figure, and the black hole — because
a headless test can prove a file decodes, but only a person can judge
whether it still *looks* right. The station's after-check screenshot is
framed from a different camera angle than the before screenshot (the
in-app camera moves), so it is not a same-angle comparison — another
reason for a human look.

## Words used in this report, in plain terms

- **3D model file (.glb):** one file holding a 3D object — its shape,
  its pictures, and its animations.
- **Texture:** the picture wrapped around a 3D shape (for example, the
  surface of a planet). Most of the weight in these files was textures,
  not shape detail.
- **Triangle (tri):** a tiny flat piece. A 3D shape is built from many
  triangles. If the triangle count is unchanged, the shape detail is
  unchanged.
- **Draco:** a way of squeezing 3D shape data smaller. The app already
  knows how to unpack it, so no new software is needed.
- **WebP:** a smaller picture format for textures. The app already knows
  how to read it.
- **Bounding box:** the invisible box around a model. If it is unchanged
  (within 0.5%), the model's size, orientation, and position are unchanged.
- **Node / mesh name:** the internal name of a part of a model. The app's
  code looks parts up by name, so every name must stay exactly the same.
- **Animation clip:** a named movement stored inside a model file.
- **Real, not placeholder:** the app silently swaps in a simple stand-in
  shape if a model fails to decode, with no error. So "it loaded" proves
  nothing on its own — each slimmed file was confirmed to be the real
  model, not the stand-in (see Verification).

Labels used below: **confirmed** = directly measured; **inferred** =
reasonable from the measurements, not directly measured; **unknown** =
not established, stated as such.

## Per-file results (confirmed, unless noted)

Sizes are decimal MB (bytes / 1,000,000). Triangle counts, names, and
clips were compared file-by-file before vs after; all 13 pass.

| file | MB before → after | tris before → after | textures (n, MB) before → after | Draco / WebP (after) | names identical? | clips identical? | real, not placeholder? | notes |
|---|---|---|---|---|---|---|---|---|
| space_station_3.glb | 14.67 → 3.99 | 68,268 → 68,268 | 13, 13.97 → 13, 3.29 | Draco yes / WebP yes | yes | yes | yes | Hero asset. Its 13 textures were KTX2 (a format the app only loads after the home renderer is up), transcoded to WebP at 1024, quality 85. Draco re-applied after WebP (the WebP step drops Draco, so order matters). Target ≤ 4 met. |
| sf-lava-planet.glb | 11.58 → 1.15 | 7,936 → 7,936 | 5, 11.30 → 5, 0.87 | Draco no / WebP yes | yes | yes | yes | Texture-only: resize to 1024 + WebP 85, geometry untouched. Target ≤ 1.5 met. |
| sf-ice-planet-procedural.glb | 11.01 → 0.76 | 60,160 → 60,160 | 5, 8.74 → 5, 0.58 | Draco yes / WebP yes | yes | yes | yes | Deviation from the texture-only plan, stated plainly: texture-only alone would have left 2.85 MB, because the shape data alone is about 2.3 MB. Draco was added; triangle count unchanged. Target ≤ 2 met. |
| sf-anchor-spire.glb | 8.58 → 2.02 | 80,210 → 80,210 | 1, 6.64 → 1, 0.08 | Draco no / WebP yes | yes | yes | yes | Texture-only: resize to 1024 + WebP 85. Target ≤ 2 missed by 0.02 MB (20 KB). Kept the texture quality rather than degrade it for 20 KB — quality wins over the number, per the spec. |
| blackhole.glb | 7.01 → 3.23 | 534,196 → 534,196 | 15, 5.28 → 15, 1.51 | Draco yes / WebP yes | yes | yes | yes | Hero asset. KTX2 textures → WebP 85, Draco re-applied, triangles untouched (no simplification — it is a hero, and 534k triangles were left alone). Target ≤ 3 missed by about 8%. |
| sf-supernova-remnant-slim.glb | 6.09 → 2.62 | 216,902 points → 216,902 points | 0, 0 → 0, 0 | Draco no / WebP n/a (no textures) | yes | yes | yes | This file is made of points (dots), not triangles, so the triangle column is points instead. Draco does nothing for points and simplification does not apply, so `quantize` was used instead — it adds KHR_mesh_quantization, which three.js reads natively with no extra decoder. Its local bounding-box numbers look wild after quantize, but the scene bounding box measured through the app's own inspector matches the original to under 0.01% — the wild local numbers are a quantize artifact, not a moved model (confirmed). Target ≤ 2.5 missed by about 5%. |
| dyson-sphere.glb | 5.84 → 1.46 | 30,953 → 30,953 | 8, 5.58 → 8, 0.87 | Draco yes, sequential / WebP yes | yes | yes | yes | KTX2 → WebP 85 + Draco. **Defect found and fixed (confirmed):** the standard Draco method (edgebreaker) broke this file's look — its central sphere went dark (7.31% of pixels differing by more than 10 vs the original, where every other file was under 1.96%). The WebP version before Draco rendered correctly, isolating Draco as the cause. Switching only this file to Draco's sequential method renders pixel-identical to the WebP version (0.00% difference). All other files keep the standard method, which was visually confirmed for them. Target ≤ 2.5 met. |
| man-god-halo.glb | 5.65 → 0.50 | 222,118 → 222,118 | 0, 0 → 0, 0 | Draco yes / WebP n/a (no textures) | yes | yes | yes | Hero asset — Eternity himself. Draco only, the safest possible change: triangles, body/halo split meshes, and names all unchanged. Target ≤ 2.5 met. |
| sf-planetary-nebula.glb | 4.60 → 0.57 | 146,636 → 146,636 | 4, 0.21 → 4, 0.21 | Draco yes / WebP no | yes | yes | yes | Draco only; its textures were already tiny, so they were left alone. Target ≤ 1.5 met. |
| wato-spaceship.glb | 3.62 → 0.55 | 730 → 730 | 6, 3.56 → 6, 0.53 | Draco yes / WebP yes | yes | yes | yes | Resize to 1024 + WebP 85 + Draco. A quality-70 test reached 0.27 MB but was rejected — quality wins. Target ≤ 0.5 missed by about 10%. |
| pp-planets-set.glb | 2.73 → 0.16 | 1,164 → 1,164 | 2, 2.64 → 2, 0.07 | Draco no / WebP yes | yes | yes | yes | Texture-only: resize to 1024 + WebP 85. Target ≤ 0.5 met. |
| sf-pulsar.glb | 2.15 → 0.30 | 11,520 → 11,520 | 1, 1.81 → 1, 0.28 | Draco yes / WebP yes | yes | yes | yes | Resize to 1024 + WebP 85 + Draco. Target ≤ 0.5 met. |
| nasa-pillars-1b.glb | 2.07 → 0.09 | 24,576 → 24,576 | 0, 0 → 0, 0 | Draco yes / WebP n/a (no textures) | yes | yes | yes | Draco only. Target ≤ 1 met. |

**Totals (confirmed): about 85.6 MB → about 17.4 MB, roughly an 80% cut.**
No file was slimmed by simplification: every triangle count is identical,
so no shape detail was removed anywhere. The savings come from smaller
textures and Draco squeezing, not from cutting geometry.

**Two file-level notes that apply to several rows:**

- The slimming tool rewrites a model's stored position/rotation/scale
  information from a single matrix into separate position, rotation, and
  scale parts. That looks like a change in the file, but the resulting
  transforms were verified mathematically equivalent (difference under
  2e-8) for the files checked — it is not a rotation or scale change.
- Embedded licences and asset metadata were kept, and
  `packages/web/public/CREDITS.md` was not touched (confirmed by not
  modifying it; the slimming steps only re-encode textures and geometry).

## Worlds-check: before vs after (confirmed)

Run the same way both times, on a local throwaway server with a throwaway
brain (never a real brain key), phone viewport, using the repo's
`scripts/worlds-check.mjs`. A world PASSES only if its 3D canvas appears,
there is no "needs graphics support" fallback, and there are zero console
errors and zero failed (4xx/5xx) requests. Canvas times come from a
headless software renderer — compare worlds against each other, not
against a phone.

| world | before: verdict, canvas, download | after: verdict, canvas, download |
|---|---|---|
| great-station | PASS, 2,933 ms, 42.5 MB | PASS, 4,596 ms, 17.2 MB |
| growing-place | PASS, 2,769 ms, 34.7 MB | PASS, 2,521 ms, 12.5 MB |
| deep-past | PASS, 2,748 ms, 42.5 MB | PASS, 1,940 ms, 25.1 MB |
| people | PASS, 2,051 ms, 21.8 MB | PASS, 2,100 ms, 11.6 MB |
| quiet-archive | PASS, 1,794 ms, 21.7 MB | PASS, 1,520 ms, 11.5 MB |
| scale | PASS, 2,296 ms, 40.1 MB | PASS, 1,843 ms, 20.0 MB |
| eternity | PASS, 2,659 ms, 8.6 MB | PASS, 2,685 ms, 15.1 MB |

**Reading this table honestly:**

- Six of seven worlds download much less after (cuts of roughly
  41–64%). All seven still PASS with zero errors.
- **Eternity's world total went up (8.6 → 15.1 MB) even though Eternity's
  own file shrank from 5.65 MB to 0.50 MB — this is unknown, not explained
  away.** A world total also includes shared assets and varies with what
  the page happens to load, so a world total is a different measure from
  a single file's size, and the file-level result stands (the figure
  itself is confirmed identical in the before/after screenshots, same
  pose, same halo). But the cause of the eternity total increase was not
  established, and it is flagged here rather than smoothed over.
- The home-startup aim (about 9 MB, from 21.6 MB) is **inferred, not
  confirmed** by this check: worlds-check measures world loads, not a
  home-only load, and its main evidence is the station file itself
  (14.67 → 3.99 MB). The real test is Sajacous's phone after merge and
  deploy, as the spec itself says.
- **Real, not placeholder, in the world screenshots (confirmed):**
  Eternity's figure is visibly the same figure before and after; Scale
  shows real planets and structures; the Great Station screenshot shows
  real station geometry, but from a different camera angle than before
  (the in-app camera moves), so it is not a same-angle visual proof.
  Hero eyeballing before merge is still required, especially for the
  station.

## How this was verified (confirmed)

- Every slimmed file passes `gltf-transform validate` cleanly.
- Node names, mesh names, animation names and durations, triangle/point
  counts, and bounding boxes were compared before vs after for all 13
  files (all identical except the supernova local-bbox artifact explained
  above, where the scene box matches).
- All 13 slimmed files were rendered headlessly in three.js with zero
  console errors, proving real-model decode of the WebP, Draco, and
  quantized data — not silent stand-ins. File-level pixel comparisons
  were done for the files where a visual question arose (notably dyson,
  above).
- Worlds-check was run on the original files first (the "before" table),
  then the slimmed files were swapped in, the app was rebuilt, and the
  same check was run again (the "after" table), on the same throwaway
  brain. No real brain was used, and no real brain key appears anywhere
  in this work.

## Local test-setup deviations (confirmed, do not affect the shipped files)

- The unmodified worlds-check script failed twice at its screenshot step
  (30-second timeout; the software renderer is slow at capturing, even
  after fonts had loaded). The check was run with a copy of the script
  that changes only the screenshot timeout, from 30 seconds to 120
  seconds. The PASS criteria, canvas check, error check, and download
  counting are untouched. The unmodified script's failures are preserved
  in the working notes; the report tables above come from the
  timeout-adjusted runs.
- Plain `npm ci` failed twice while downloading one large package
  (onnxruntime's GPU package: first a network reset, then out-of-space).
  The local test install used `npm ci --ignore-scripts`, then rebuilt
  only the one native piece the server actually needs (better-sqlite3).
  This changes only the local test setup, not the app code or the model
  files, and the web build and server otherwise ran as the spec describes.
- Disk space was tight during this work (a quota error blocked writes
  for a time, and the user confirmed the same error independently). The
  cleanup that cleared it removed only regenerable `node_modules`
  folders under dead worktrees; no worktree, source file, or model file
  was deleted for space. The slimmed set itself was never lost: every
  file is reproducible from the originals plus the saved slimming steps,
  and the final set was re-verified by hash and comparison after landing.

## What could not be slimmed without visible loss

Nothing in this batch required stopping for visible loss. The closest
calls, stated plainly, are the four target misses above (anchor, blackhole,
supernova, wato), where pushing further would have meant degrading
texture quality for a small numerical gain, and the dyson Draco method,
where the standard method *did* cause visible loss and was replaced
rather than pushed past. If Claude's verification finds a visual
regression this report missed, the affected file should be held back
rather than merged with the rest.

## Delivery

- Branch: `assets/glb-slim` (to be created from current main at upload
  time). At upload time, main is `1b14d1b` (confirmed by fetch, 2026-10-28
  evening). All 13 model files on that main tip are byte-identical to
  the spec commit's originals (git blob hashes match exactly), so
  replacing them on a branch from that tip is clean for these files.
  Note for the verifier: main has moved past the spec commit since this
  work was verified — commit `503e5de` ("stop re-downloading models,
  defer the 14 MB station, prefetch the destination") landed separately.
  The worlds-check numbers in this report were measured on the
  spec-commit code, not on that perf-commit code, so download totals
  after merge may differ again for reasons unrelated to these files.
- Files: the 13 `.glb` files in this report, same filenames, in
  `packages/web/public/`, plus this report at
  `docs/repairs/glb-slimming-report.md`.
- **Do not merge to main.** A merge auto-deploys to production, and
  these files affect every screen. Claude verifies and merges.
