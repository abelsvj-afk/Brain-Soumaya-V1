# Deep Past Fix — Design Note (2026-10-29)

**What this is:** the design for fixing how the Deep Past looks in the app. Design only — no code in this note, and nothing here authorizes a build, a merge, or a deploy. On main, merge = deploy (Fly auto-deploys), so the build that follows this note still needs the owner's own taps, in his own time.

**Input:** the fix brief from the read-only audit chat (`DEEP-PAST-FIX-BRIEF-2026-10-29`), written on the owner's report — his words in substance: Deep Past in the app looks horrible, none of the GLBs were used how he expected, the spiral going down is inconsistent, nothing looks like the actual files he gave.

**Baseline honesty:** the brief was diagnosed on main `2799bd43`. This pass re-checked every defect against current main, `bab4373f` (2026-10-29). The three Deep Past files (`deepPastScene.ts`, `deepPastLayout.ts`, `deepPastAssets.ts`) are **byte-unchanged** between the two tips, and every defect below was re-read in today's code and reproduces exactly. Nothing has been quietly fixed in the meantime, and no other lane has Deep Past scene work in flight on main. Full evidence: `deep-past-fix-design-record.md` in the worlds workspace.

---

## 1. Step zero — the files are all there (closed before this pass)

All nine asset URLs the scene loads are present in the app and return HTTP 200 live (checked 2026-10-29 against main `bab4373f` and the live app). There is no missing-file problem and no silent fallback hiding one. **The defects are all presentation: slims, placement, stairs, camera.** That is what this note designs.

## 2. What is actually wrong — the defects, in plain words

1. **There is no spiral staircase.** One straight flight of the owner's stair piece sits at the top, covering the first drop only. Below the first level there are no stairs at all — the "spiral" you see is dots of light. The code's own comment admits the flight doesn't even meet the first level cleanly.
2. **The ride down doesn't follow the world.** The descent camera winds three-quarters of a turn while the levels themselves twist just over a full turn; it flies at radius 600 — outside the world's rim (440) — and it stops 180 units short of the basin floor. It is a ride pasted next to the world, not a ride through it.
3. **Every piece appears exactly once across nine levels.** One terrace, one lantern, one crystal — placements copied from the small standalone mockup and multiplied by five. A tight little diorama became a cavern with a few props in it. This was never the owner's component design: his own component list (2026-10-25) specified the terrace, rim, stair, and lantern as **instanced** pieces — "nine strata × several segments each" for the terrace, lanterns "instanced in the dozens." The app build placed each once instead.
4. **The pieces ship as 256-pixel-texture slims, blown up ×5.** Blurry and washed out is the guaranteed outcome — that's why nothing looks like his files. The orb ships as a 70,120-triangle slim of his 539,428-triangle original.
5. **The route bead was never wired.** The bead exists — made 2026-10-28, owner-approved ("Perfect.."), with its 'Flow' animation — and the scene still carries a TODO saying it's missing and draws the route as a bare line.
6. **Four pieces are sized by guessed constants, not measured from the file.** Terrace, rim, stair, and lantern use fixed scale factors (250 / 880 / 250 / 100) assumed from old mockup measurements. Any re-slim silently lands them at wrong sizes — and defect 4's re-slim changes these files, so this must be fixed in the same build.

## 3. Settled decisions (made by King under the owner's delegation — recorded, not re-opened)

### D1 — The stairs are the owner's own stair piece, repeated

One flight per level change, each flight turned with its level's arc, landing on that level's floor. **No procedurally built helical stair** — new invented geometry is exactly what the owner is rejecting ("nothing looks like my files"), and procedural stand-ins as final art are against the standing rules. His straight flight, repeated along the helix, makes a stepped spiral out of his actual piece.

Measured first, as required: his flight's native size is 1.0 long × 0.361 tall × 0.676 wide. Scaled uniformly by 90 ÷ 0.361 ≈ **249.3**, one flight covers a level drop of exactly 90, with a 249-unit run and 168-unit width — **one instance per transition, unstretched, no distortion.** Two-per-transition is not needed. (The build today already scales the piece by 250 — it just places it once.) A straight flight on a curving helix sits as a chord: it deviates from the ideal arc by roughly 18–25 units across its length (under 6% of the radius) — the same effect the mockup itself accepted, and the flight lands centred on the receiving level's ring.

One honest exception: the last drop, from the deepest level (−720) to the basin (−830), is **110, not 90** — the layout's own constants make the basin sit deeper. That flight gets a uniform scale of 110 ÷ 0.361 ≈ 304.7: same piece, same proportions, one bigger final flight down to the First Light. Rejected alternatives: a standard flight floating 20 units short of the basin floor, and two flights (180 of drop for a 110 hole — overshoots).

### D2 — A spire at every anchor's foot: DROPPED

The scene carries a second TODO proposing a spire standing at each anchor's foot. **Dropped.** The spire that actually arrived from the owner is a 120-unit landmark nail at the top of the descent — a landmark, and landmarks stay singular under the brief's own placement rule; copying it to every anchor turns it into wallpaper. (The small terrace spire in the owner's 2026-10-25 component list was a different, 3-metre piece that was never made; the piece that exists is the landmark.) The route bead marks the journey stops instead — that's its job. The build removes this TODO and leaves the reason in its place. The anchor lines themselves stay exactly as they are: lines of light, presentation unchanged in meaning.

## 4. The descent — stairs all the way down

Constants (read from `deepPastLayout.ts` on current main — the build derives everything from these, never from new literals): 9 strata; radii 440 → 300 (−17.5 per stratum); floors at Y = 0, −90, …, −720; each stratum's arc starts 0.85 rad past the one above (`STRATUM_ARC_START`); arc length 4.4 rad; basin at Y = −830, radius 320.

**Flights:** nine — one per transition (stratum 0→1 through 7→8) plus the basin flight (8→basin). Flight *k* (k = 1…9):

- **Angle:** k × 0.85 rad — it leaves from where the receiving level's arc begins, following the same twist as the levels.
- **Radius:** the midpoint ring between the two levels it joins — (R_upper + R_lower) ÷ 2; for the basin flight, (300 + 320) ÷ 2 = 310.
- **Height:** centred on the drop's midpoint (upper floor − 45; basin flight −775), spanning exactly floor to floor.
- **Scale:** uniform, fitted by measured height (see §8) — ≈249.3 for the eight standard flights, ≈304.7 for the basin flight.
- **Rotation:** tangent to the arc at its midpoint angle, using the scene's established holder convention (position (cos·r, ·, sin·r), rotation.y = −angle − π/2 — the terrace's pattern).
- **Rendering:** one `InstancedMesh`, nine instances, one draw call. Per-instance matrices carry the basin flight's larger scale — instancing does not require identical scales.

Room check: consecutive arc starts are 0.85 rad apart ≈ 263–366 tangential units at ring radius; the flight's 249-unit run fits inside one stratum's twist segment at every level (tightest at the bottom, ~14 units to spare).

**What the rider sees:** a continuous stepped spiral of the owner's stone flights, one per level, turning with the levels, all the way down to a final longer flight into the basin's light.

## 5. The camera ride — derived from the same constants

The descent camera (`DEEP_PAST_DESCENT` + `deepPastDescentCamera`) is re-specified as a **derived path**: every number computed from the layout constants, so the ride can never drift out of sync with the world again.

- **Angle:** starts at the existing base angle (0.6 — the arrival framing belongs to the host and stays), then advances exactly with the levels: at the floor of stratum *i*, the camera's angle = base + i × 0.85. Total winding rim → deepest floor = 6.8 rad ≈ 1.08 turns — the levels' own twist, not 0.75.
- **Radius:** piecewise through the strata — starts at 600 / Y +150 (today's opening framing, above the rim), eases inside the rim by the first drop, then tracks each stratum's ring 25 units inside it (R_i − 25 at stratum *i*'s floor), settling to basin radius − 60 (260) at the hover. The ride is **inside** the world the whole way down.
- **Height:** Y from +150 to the basin hover at **BASIN_Y + 60 (−770)** — the ride now actually arrives at the basin instead of stopping at −650. Progress maps across the nine drops so time-per-level stays even (the basin leg is 110 deep and gets its proportional share).
- **Look target:** the derived path one level ahead — you look where you are about to be, at the flight you are about to pass — settling at the end to the orb (0, BASIN_Y + 24, 0). The old lookAtFloor clamp is replaced by this derived target (never below the basin's light).
- **Unchanged:** follow-only, user-controlled, leavable and resumable at any moment; reduced motion still holds the descent as rim / mid / basin stage stops — the same three stops, taken on the derived path.
- **No literals:** 0.75 turns, radius 600-as-a-constant, and endY −650 do not survive. A test asserts the derivation (see A1) so a future edit can't quietly re-pin the ride to guessed numbers.

## 6. Placement at app scale — every level dressed

The design target, from the brief: **one of each architectural piece in view, as the mockup read** — not one of each in the world. Architectural pieces repeat as the strata's architecture. Landmarks stay singular. All placements derive from the layout constants by the rules below; stratum 1's existing terrace and the stratum-3 hero lantern keep their exact proven placements (generalised, not moved).

| Where | What | Rule |
|---|---|---|
| Stratum 0 (rim level) | Rim segment ×1 (singular) | As today: the top boundary ring segment, gap at angle 0 (the arrival gap). No terrace here — the rim dresses this level. Rise shelf unchanged. |
| Strata 1–8, each | **Terrace slices ×3** | Angles arcStart(i) + {0.35, 1.82, 3.29} (evenly across the 4.4-rad arc); radius R_i − 62.5; sitting on the stratum floor, wall rising one drop — the stratum-1 pattern with i substituted. Stratum 1's first slice is today's placement, untouched. One InstancedMesh (24 instances, 1 call). |
| Strata 1–8, each | **Lanterns ×3** (one per terrace slice) | At each slice's far end, on the shelf, glow sprite each; all three share the instanced lantern mesh (24 instances, 1 call; glows as one Points cloud, 1 call). |
| Stratum 3 | **Hero lantern** (singular treatment) | Today's exact placement, kept as its own piece: the real warm PointLight + glow sprite, as now. It is additional to stratum 3's three dressing lanterns. |
| Strata 5, 6, 7 | **Crystal ×1 each** (3 total) | See the crystal call below. Stratum 5 keeps today's spot; 6 and 7 take the same pattern at varied angles; sizes 24–36 units. |
| Stratum 1 | **Anchor spire ×1** (landmark, singular) | As today, opposite the terrace, tip glowing. No copies anywhere (D2). |
| Stratum 7 | **Supernova remnant ×1** (landmark, singular) | As today. A dead star is unique by meaning. |
| Basin (−830) | **Basin dish ×1, First Light orb ×1** (landmarks, singular) | As today: dish spanning the basin, orb at its centre, 'FirstLight' clip playing. |
| Route stops | **Route bead ×1 per stop** | See §7. |

**The crystal call: architecture (dressing), not a landmark.** Grounded in the code: the crystal is not one of the owner's pieces and carries no lore — it's a 52-triangle cluster from a free space pack, added by the population increment as set dressing, and its own placement comment calls it "the terrace pattern, one stratum deeper" — the terrace pattern is the architecture pattern. So it repeats modestly (one per deep stratum, 5–7) and stays cheap. The landmarks — spire, orb, basin, supernova, rim — stay singular because singularity is their meaning.

**Density honesty:** 24 terrace slices and 25 lanterns is what "several segments per stratum" and "instanced in the dozens" (the owner's own component list) mean at nine strata. Anything less re-creates the cavern.

## 7. The route bead — wired at last

- **The file (verified by this pass):** `~/workspace/worlds-vision/mockups/deep-past/route-bead.glb` — 180,244 bytes, SHA-256 `e13360e6ba6a88a74c8eaf3f0fdd1322625a50642229cb3acd679663f9752a1b`; 6,144 tris; 2 meshes / 2 materials; no textures; native size exactly 2 × 2 × 2; animation clip **'Flow' (2 channels)** present in the file. Owner-approved 2026-10-28.
- **Placement:** one bead floating above each journey stop on the thread — at the stop's thread point (the thread already rides 8 above each stop) with the bead's centre ~10 units above the stop, sized to span 10 units (measure-first fit, §8). The bead marks the stop; the line stays the route. No thread → no beads: the beads follow the layout exactly, presentation only.
- **Animation:** the 'Flow' clip plays on every bead through the scene's mixer pattern (the orb's pattern: delta clamped, reduced motion holds it still). Loads through the animated loader, like the orb.
- **Slim:** the bead ships slimmed under the same repo rules — target ≤1,600 tris (segment reduction on a smooth 2-unit marker; both meshes, both materials, node names, and the 'Flow' clip preserved; no textures exist to convert). Ships to `public/` as `route-bead.glb` and joins the asset manifest (2 draw calls per stop; budgeted at routes up to 12 stops).
- **The TODO goes.** The build removes the route-bead TODO comment — the interim is over — and replaces the anchor-spire TODO with the D2 reason (see §3).

## 8. Measure-first fit — every piece, no exceptions

Defect 6's rule, made total: **every piece is fitted from its own loaded file against a named target dimension. No bare scale factor survives in the Deep Past load path.** (The re-slim in §9 changes these files; fixed factors would land the new files at wrong sizes silently — that is exactly the failure this rule exists to prevent.)

| Piece | Fit | Target dimension |
|---|---|---|
| Basin | span (as today) | spans the basin diameter, 640 |
| Rim | span, new | outer diameter 880 (2 × rim radius) — replaces the bare 880 factor with the measurement it was guessing |
| Terrace (per slice) | longest-side | arc length 285 (the proven stratum-1 length) |
| Stair (per flight) | **height** — the fitted dimension is the drop | 90 per standard flight; 110 for the basin flight. Scale = drop ÷ measured height, derived per flight |
| Lantern | longest-side (height) | 100 (today's proven hero height), all instances |
| Hero lantern | longest-side (height) | 100, at its existing placement |
| Spire | longest-side | 120 (as today) |
| Crystal | longest-side | 24–36 per stratum (as today, varied) |
| Supernova | longest-side | 100 (as today) |
| Orb | longest-side | 80 (as today) |
| Bead | longest-side | 10 |

The stair's height-fit is the one new fit variant the build adds (fit-to-height, or fit-to-size on the Y axis — the build's choice of mechanism; the spec is the dimension, not the helper's name).

## 9. The new scene budget — stated, not implied

The old budget (layout: ≤90 draw calls / ≤440,000 tris for the whole scene) was written for the procedural scene plus a one-of-each GLB layer — and the scene header's own sketch of the GLB layer (+42 calls / 88,220 tris) is already stale: with the spire and orb, the real GLB layer today is **45 calls / 238,550 tris / 216,902 points**, and the real scene total is ~79 calls. The budget below replaces it; the build updates the layout constant and the scene-header sketch to these numbers so the budget grammar tells the truth again.

**New budget (hard caps, acceptance-tested): ≤110 draw calls · ≤620,000 tris · ≤220,000 points.**

Estimated load at this design's targets:

| Layer | Calls | Tris |
|---|---|---|
| Procedural scene (unchanged) | ~34 | (inside existing counts) |
| Basin 1 · rim 1 | 2 | 22,500 + 14,200 |
| Terrace, instanced ×24 | 1 | 24 × ≤8,000 = ≤192,000 |
| Stair, instanced ×9 | 1 | 9 × ≤8,000 = ≤72,000 |
| Lantern, instanced ×24 + glows (1 Points) + hero (mesh 1, glow in Points, light not a call) | 3 | 25 × ≤6,000 = ≤150,000 |
| Crystal, instanced ×3 (2 materials) | 2 | 156 |
| Supernova (unchanged) | 34 | 0 (216,902 points) |
| Spire 1 + glow sprite 1 | 2 | ≤60,000 (target; hard ≤80,210) |
| Orb 1 | 1 | 24,576 (hard cap 32,000) |
| Bead, per stop ×2 (≤12 stops budgeted) | ≤24 | ≤1,600 per stop |
| **GLB layer total** | **≤104** | **≈ ≤555,000 at targets** |

**Justification, plainly:** draw calls — the number that gates frame rate hardest on the owner's phone — grow modestly (~79 → ~99 estimated, cap 110), because every repeat is an instance of one loaded file: 24 terrace slices cost one call, not 24. Triangles grow because architecture now exists on all nine levels — that growth *is* the fix the owner ordered — and instancing means memory and download cost are the per-piece files, not per-instance copies. The per-piece tri targets (§10) are targets under the repo slimming rule **quality wins over targets**: if a piece cannot hit its target without visible loss, the build reports the delta and the hard caps still bind.

## 10. Re-slim spec — from his originals, at resolutions that survive

Every re-slim follows the repo slimming rules: preserve every node/mesh name and animation clip; same scale, orientation, and pivot; bounding box within 0.5% of source; Draco + WebP only; licences and CREDITS.md entries stay; the originals stay untouched in the workspace and in git history. URLs stay stable (same public filenames, new content) so no other surface breaks. Sources are the highest-fidelity masters on disk (the `*-web.glb` masters in `mockups/deep-past/`, the owner's Tripo-generated artwork; spire and orb from his project files in `ships-hunt/space-hunt-2/`).

| Piece | Source | Textures | Geometry |
|---|---|---|---|
| Basin | first-light-basin-web.glb | **WebP 1024** (hero — the floor of the world) | keep 22,500 tris; the fix is texture, not geometry |
| Rim | rim-web.glb | **WebP 1024** (first surface the ride sees, fills the frame at the start) | keep 14,200 tris |
| Terrace | stratum-terrace-web.glb | **WebP 1024** (architecture at arm's length on every level; one file serves all instances) | simplify target ≤8,000 tris (from 22,500) |
| Stair | descent-stair-web.glb | **WebP 1024** (the ride keeps the stairs in frame continuously — a hero surface in motion, not a passing repeat) | simplify target ≤8,000 tris (from 14,626) |
| Lantern | stratum-lantern-web.glb | **WebP 512** (a 53 × 100-unit lamp; its glow carries it) | simplify target ≤6,000 tris (from 14,342) |
| Spire | anchor-spire.glb (owner original) | **WebP 1024** | target ≤60,000 tris (from 80,210); hard ≤80,210. **Verify first:** the shipped spire was already slimmed once (8.58 MB → 2.02 MB); if that file already meets this spec, it stays — re-slim only if short |
| Orb | first-light-orb.glb (fixed original) | **WebP 2048** — the one exception above the 1024 floor, with its reason: the orb is the focal point of the entire world, the thing the whole descent aims at, and its surface *is* texture | **24,576 tris** (hard cap 32,000) — see below |
| Bead | route-bead.glb (verified, §7) | none exist | target ≤1,600 tris; 'Flow' clip preserved |
| Crystal, supernova | — | — | unchanged (not the owner's pieces; the supernova slim is already verified) |

**The orb's number, grounded in its geometry:** the orb is a smooth radiant sphere (its own design: "clearly a light, not a solid object" — no stone, no shell). Its visible quality is silhouette + texture. At its placed span (80 units, roughly 200 px across on the owner's phone), a UV sphere of 128 × 96 segments puts each silhouette segment at ~1.5 px — faceting disappears. 128 × 96 × 2 = **24,576 triangles**. The original's 539,428 are image→GLB surface noise, not silhouette — twenty times the geometry for the same outline. The 'FirstLight' clip (spin + bob + breathing pulse) animates node transforms, so the geometry swap carries it untouched; the warm-gold emissive treatment from the owner's fix is preserved.

**The gate for this defect (and it is not a sandbox render):** each shipped piece gets a render checked against the owner's original, filed with the build — the anchor-spire render precedent. But sandbox renders have lied about the owner's phone before (the v6/v7 mockup history), so **defect 4 closes only on the owner's eyeball verdict on his phone.** The build report carries the renders and measurements and marks that criterion PENDING-OWNER until he rules.

## 11. What does not change

- **Meaning.** Strata assignment, chronological homes, member placement semantics, the thread's route, the anchors' meaning — untouched. This pass is how the Deep Past *looks*, never what it *means*. `deepPastLayout.ts` changes only in its budget constant, if at all.
- **Privacy.** Deep Past stays PRIVATE.
- **Never-punish.** No decay, no wilting, nothing earned or lost by showing up. Untouched strata stay resting ground.
- **The fallbacks stay honest.** If any GLB fails to load, the scene degrades to its procedural forms / empty holders and notes the failure, exactly as today — never a crash, never a blank descent.
- **No new mechanics, no new invented geometry.** Every visible piece is the owner's file, a verified-licence dressing piece already in the app, or the scene's existing procedural forms.

## 12. Acceptance criteria for the build (numbered — the gate tests these)

- **A1 — Derived ride.** A test asserts the descent path derives from the layout constants: at each stratum floor the camera angle equals base + i × `STRATUM_ARC_START` (±ε); radius during stratum i's band sits inside R_i − 40 … R_i − 10 after the first drop; the end pose is the basin hover (Y = BASIN_Y + 60) with the look target at the orb; no `0.75` / `600` / `−650` literals remain as descent constants.
- **A2 — Stairs continuous.** Nine flights placed (8 standard + basin leg), instanced as one draw call. A geometry test asserts each standard flight's top step lands within one step-rise of the upper floor and its bottom step within one step-rise of the receiving floor; flight k's angle = k × `STRATUM_ARC_START`; the basin flight spans the full −110.
- **A3 — Every level dressed.** Scene-graph assertions: strata 1–8 each carry 3 terrace slices and ≥3 lanterns; the stratum-3 hero lantern sits at its existing placement with its real light; landmarks are exactly singular (spire 1, orb 1, basin 1, supernova 1, rim 1); crystal appears exactly 3 times, on strata 5, 6, 7.
- **A4 — Budget respected.** Measured totals (the existing budget-test pattern, updated constants): ≤110 draw calls, ≤620,000 tris, ≤220,000 points — with per-piece tri deltas against §10 targets reported; quality-first misses are reported, never hidden.
- **A5 — Re-slim fidelity.** Per piece: bbox within 0.5% of its master; node/mesh names and animation clips preserved (orb 'FirstLight', bead 'Flow' — asserted from the shipped files); texture resolutions at or above §10 floors; Draco + WebP only; CREDITS.md updated; a render of each hero piece checked against the owner's original and filed with the build.
- **A6 — Bead on the thread.** With a route fixture of N stops, N beads render, each floating above its stop, 'Flow' advancing under normal motion and held under reduced motion; the route-bead TODO is gone (grep) and the anchor TODO is replaced by the D2 reason (grep).
- **A7 — Measure-first total.** No bare fixed-factor fit call remains in the Deep Past load path (grep-asserted); every piece's fit names its target dimension from §8, the stair fitted by height.
- **A8 — Owner's phone verdict (closing gate for defects 3–4).** Hero pieces recognisable as his actual GLBs at arm's length, on his phone. NOT closable by sandbox render or by any test — the build report marks it PENDING-OWNER until he rules.
- **A9 — No regressions.** `deepPastLayout` semantics unchanged (its tests pass unmodified except budget constants, if touched); web suites green in America/New_York and Pacific/Kiritimati; typecheck clean; production build clean; the both-timezone gate per the standing workflow.
- **A10 — Honest degradation.** With any GLB forced to fail, the scene still renders (fallbacks / empty holders + diagnostics note), including the instanced layers — never a crash, never a blank descent.

**Sequencing note for the build lane:** this design edits no code, so no lane clash exists today; the repo chat has Verb 1's re-check live and Phase 4 touches world code — the build must confirm no other lane is editing `deepPastScene.ts` when it starts, per the brief's one-lane rule. Merge remains the owner's separate tap, and on main, merge = deploy.
