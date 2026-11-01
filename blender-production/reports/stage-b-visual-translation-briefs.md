# Stage B — Visual Translation Briefs
## Soumaya World Environment Reconstruction

**Prepared:** 2026-10-31 (Stage B, design translation only — no geometry built, no repo files touched)
**Foundation:** `reports/stage-a-location-inventory.md` (Stage A inventory, read at `origin/main` = `265b6422`) and `reports/OWNER-CONSTRAINTS.md` (binding). Every position, scale figure, anchor name, budget and never-rule below is carried from the inventory; nothing here invents lore, adds a location, renames an anchor, or resolves a discrepancy. Where Stage A recorded a disagreement between documents, the brief carries it as a **flagged open item** for the owner.

**How to read each brief.** Sections 1–10 follow the mission's ten points in order: (1) composition, (2) spatial layout, (3) architecture & terrain, (4) landmarks, (5) material palette, (6) lighting & atmosphere, (7) existing assets vs new assets, (8) named anchor hierarchy, (9) mobile performance plan, (10) mysteries protected. Anchor names are quoted exactly as the inventory records them; holder names in the exported GLB must match character-for-character, because fly-to places, lore spots, place passages, story props and relics all discover their locations by matching those names.

---

## Part 0 — Cross-world art direction

### 0.1 The shared language
All twelve worlds are one game and must read as one hand's work. The shared language, translated per world and never pasted identically:

- **Base tonality:** deep indigo-black space and shadow (`0x0b1026` family) as the universal dark; no world is lit from a white or neutral sky except where its own identity demands it (Eternity's void, the Unmade floor, Scale's true black).
- **Warm gold / amber** is the colour of *keeping* — lanterns, hearths, ember light, gold trim, the halo. It marks what is held, tended, remembered.
- **Pale cyan** is reserved as *navigation truth* and stillness — nav markers, still motes, quiet light. It is never used as general decoration outside the worlds where the inventory assigns it (Station nav, Quiet/Archive).
- **Painterly cinematic realism:** soft volumetric-feeling light, heavy atmosphere, monumental scale, restrained palettes. In 3D terms: soft-edged shadowless or single-shadow lighting, gradient sky domes or fog-matched backgrounds instead of hard CG contrast, large smooth forms with detail concentrated at landmark silhouettes, and texture work that reads as painted surface (broad value shapes, limited high-frequency noise) rather than photogrammetry.
- **Material grammar:** a small shared library — dark basalt/stone, warm worn metal, pale luminous mineral, wood-and-cloth (ward/village only), living green (garden only) — each world takes a different subset and a different dominant. Shared *grammar*, different *sentences*: no two worlds share the same dominant material + dominant light combination (see the per-world palettes).
- **Scale cueing:** every world states its size honestly through one fixed reference — the 12-unit ship (Station, Scale), the person-height edge (Siege), the hand-thick step (Unmade, Deep Past), the cot (Ward), the stride (Road). Rebuilds preserve those references exactly; they are how the player measures the world.
- **Wordlessness:** no text, signage, labels, numbers or UI in any geometry, texture or decal, anywhere. Chalk, tallies, tags and boards are strokes and marks only. This is a build rule, not a style preference.

### 0.2 What keeps the worlds distinct
| World | Dominant material | Dominant light | Silhouette signature |
|---|---|---|---|
| Great Station | basalt + gunmetal | sodium amber work light, cyan nav points | the 420 wheel |
| Growing Place | living green + terrace stone | warm dawn gold | six rising terraces, one great tree |
| Deep Past | layered strata stone | basin light rising from below | the descending stair of discs |
| People | field earth + hearth stone | hearth amber, point-clustered | rings of small lights on an open field |
| Quiet/Archive | pale still stone | soft cyan-grey stillness | one threshold on an empty field |
| Scale | real hardware (NASA) | true black, hard starlight | the ISS truss at honest size |
| Eternity | white (his) | sourceless white | one standing figure in a void |
| Faded Ward | worn ward stone/wood | ember lantern points | one endless hall of cots |
| Village | night stone + roof timber | every window lit, gold path | hillside rows climbing to one doorway |
| Siege | pale edge-mineral | thin morning light | a field of crescent smiles leaning one way |
| Unmade Hour | pale unmarked stone | held, faint, sourceless | seven hands around an empty ring |
| Road to the Seam | cut rock | lamp points at stride rhythm | one lane between walls, no end |

### 0.3 Global flagged open items (carried from Stage A §15/§17 — NOT resolved here)
- **G-1 (D-1):** `packages/shared/src/relics.ts` cites `docs/worlds/eternity-lore.md` and `docs/worlds/relic-buffs-design-note.md` as its lore ground; neither exists on any branch. Briefs follow the registry's facts (names, worlds, resting places) because the registry is what ships; the missing ground documents are the owner's to supply or strike.
- **G-2 (D-4):** Draft 5's lock status differs between `LORE_CANON.md` (proposed) and the Continuity Bible (written from "locked lore, Drafts 1–6"). No brief depends on Draft 5/6 content for geometry; flagged for the owner.
- **G-3 (D-6):** Relic names differ between the registry of record (Mooring Ring, Basin Stone, Lantern of Keeping, Star Hanger, Sunward Compass, Stillness Seal, Unopened Fold) and `LORE_CANON.md` prose (Drift Ring, Waterline stone, Quiet Lantern, Star Hook, Sun Compass, Rest Seal, Folded Letter). Briefs use **registry names** throughout (that is what the app ships); the split itself is unresolved.
- **G-4 (D-7):** Scale's three relics (Star Hanger, Sunward Compass, Unnumbered Fragment) are registered `discoverable: false` under comments written before the Scale world existed. Briefs design their resting places as physical locations regardless; discoverability is a code state, not a visual one, and is not changed here.
- **G-5 (D-9):** `npc-autonomy-design-note.md` and `eternity-world-design-note.md` are cited by the eternity-autonomy spec but absent from `main`. Eternity's brief follows the inventory's recorded behaviour (gesture / reorder-light / wait only) and flags the missing notes.
- **G-6 (§17.4):** No budget constant exists for Eternity or the five seam worlds. Those briefs carry **PROPOSED** budgets (§9 of each), set in line with the seven stated budgets, for the owner to ratify.
- **G-7 (§17.7 / §14):** The 15 relic display models total roughly 30 MB of download for 14–22k tris each. Any re-derivation is an owner decision — GLB slimming stands **cancelled by owner order (2026-10-30)**; no brief proposes slimming any working model. Recorded here because it is the largest single weight in first-visit downloads.
- **G-8 (§17.8):** Draft 8 (side roads, ambient traffic) and Draft 9 (sky gazetteer, constellation decals) are PROPOSED and not in the scenes. No brief designs them as existing locations.

---

## 1. Great Station (`great-station`) — PILOT WORLD

**Identity carried:** the harbour of the world, Hour III — Arrival. Journeys begin here; the wheel, the drydock, the annexes, her ship at its mooring, and the four-room interior are one world in two surfaces.

**⚠ Flagged open item — D-3 (station size).** The layout code builds wheel radius **210 / diameter 420** at a **35:1** ratio to the 12-unit ship (`stationLayout.ts`). `docs/specs/worlds-scale-lanes-2026-10-30.md` §1 states "the Station is 879 across (73× the ship)". **Working basis of this brief and of the Stage C pilot: the layout figure — wheel diameter 420, ratio 35:1** — because that is what the scene builds and what the anchors' measured radii (place radius 384 for `station-rotating`) agree with. The 879 figure is **not** adopted and **not** deleted; it presumably includes orbit/traffic extent or is stale. Owner to rule.

**⚠ Flagged open item — D-8.** The spots spec §9's browser measurement reports `hero-ship` and `backdrop-*` "not in the scene" during that run, while the scene source creates both holders and `worldPlaces.ts` carries place rules for them. This brief designs both as present (source of record); whether the measurement caught a load failure is untested — flagged, not resolved.

### 1.1 Composition
- **Exterior hero shot:** the wheel fills the middle ground, seen slightly off-axis so the ring's rotation reads against the static drydock gantry in the foreground right and a backdrop planet low in the background. The eye lands first on the **rim beacon ring** — 48 amber points, every 8th cyan — because it is the only perfect circle in the frame.
- **Foreground:** dock dressing and traffic lanes (small hulls in motion lanes) giving parallax against the wheel; the hero ship at its mooring (radius 228) sits foreground-left at true 12-unit length so the 35:1 ratio is *felt*, not stated.
- **Background:** cold indigo depth, backdrop planets hung ≈4,000 units out, never competing with the wheel's silhouette.
- **Interior composition (per room):** hangar bay — the ship floating at the exact centre, lintel and rim arc framing it; observation deck — the viewport lintel is the frame, the wheel/planet beyond it is the picture; commission board and fleet deck — wall-anchored compositions, eye drawn to their lit working surfaces.

### 1.2 Spatial layout
- Wheel centred on origin, radius 210; hero mooring at radius 228; drydock gantry at **[88, 20, 195]**, witness drydock at [105, 20, 177]; hauler at [30, 10, 220]; annex cluster (`lunar-annex`, `colony-ring`, `station-stores`) placed as built by the current scene — the rebuild keeps every holder's existing position and footprint; only the geometry inside each holder is re-authored.
- The **second seam** is not a place: it is a surface condition on the lower rim of `station-rotating` (spot offset [0, −0.85, 0]). The rim's lower arc must carry a visible, *sealed* seam line in the hull modelling — a closed joint, older in finish than the surrounding plating — with no opening, no glow from within, no mechanism.
- Interior: four separate room volumes under root `station-interior`, reached by jump navigation (no corridors, no walking space between rooms — do not model connective space that does not exist). Each room is a self-contained set: hangar bay (ship centred), commission board, fleet deck, observation deck.

### 1.3 Architecture & terrain
- Modular harbour architecture built from a kit: rim segments (instanced, 48-beacon rhythm), spoke/gantry trusses, drydock cradle arms, annex blocks. Kenney Station Kit and Quaternius hulls may supply raw kit geometry, re-materialed into the basalt/gunmetal system (§1.5) and bevelled/edge-worn so the flat low-poly read is gone; flat-shaded kit facets must not survive to the render.
- The wheel is the hero build — custom Blender modelling: a continuous rim with panel rhythm, docking details and beacon seats, not a torus with boxes. `space_station_3.glb` is the compositional reference for the existing silhouette, not the final mesh (§1.7).
- No terrain (orbital world); "ground" is deck plating in the drydock and interior floors (`interior-floor-<space.id>`).

### 1.4 Landmarks (all must-remain accounted for)
The rotating wheel at 35:1 · the drydock + `witness-drydock-gantry` · the **berth-board** beside the gantry (12 slots, 11 lit, one dark — the missing berth) · the three annexes with their two lore-spot interiors implied (faded ticket; Hesk's locked room — doors exist, rooms are not entered in the exterior surface) · `hero-ship` at its mooring with a **blank rectangular nameplate** · the Harbor Nail's seam in the lower rim · the **second seam, sealed** · harbour traffic + docked hulls + `docking-shuttle` + `harbor-controller-ship` + `witness-hauler` · backdrop planets · interior: her ship floating in the hangar bay's centre, the gate lintel/lights, rim arc, nav markers, the observation viewport.

### 1.5 Material palette
Locked by the layout: hull **basalt `0x2b2e35`**, **gunmetal `0x3d4149`**, **amber `0xffb454`** (working/inhabited light), **cyan `0x9fd8e8`** (navigation truth only — beacons, nav markers, nothing else), deep indigo `0x0b1026` space. PBR translation: basalt = dark rough stone-metal composite (roughness ~0.85, subtle panel variation); gunmetal = mid metalness panels (roughness ~0.5) for machinery and gantry; amber appears only as emissive fixtures and window points; interior floors reuse basalt with amber light strips (`interior-light-strips`). One shared 1024px trim/atlas for hull panels; emissives untextured.

### 1.6 Lighting & atmosphere
One key "sun" directional (cold, low intensity) + amber point-light *impression* baked into emissive fixtures and light-strip textures — no per-fixture dynamic lights on mobile. Rim beacons and work lights (`station-work-lights`, `interior-work-lights`) are emissive geometry, not lights. Atmosphere: indigo depth fog matched to the backdrop colour so distant traffic fades into `0x0b1026`; no volumetrics, a single gradient sky dome. Interior rooms: warm ambient from baked strip light + one soft directional per room set at build time in the app scene, unchanged by this rebuild.

### 1.7 Assets — reuse vs new
- **Reuse as-is:** all CC0 Kenney Space/Station Kit dressing, docked craft and drydock kit; Quaternius traffic hulls (11, CC0); `wato-spaceship.glb` (CC-BY 3.0, attribution stands); lunar/colony annex model sets; the Sketchfab lava backdrop planet (CC-BY 4.0) and `quaternius-planet-1`. (Kenney Station Kit GLBs require their external `Textures/colormap.png` shipped alongside — carry this into any repack.)
- **New / re-authored in Blender:** the wheel (replaces `space_station_3.glb` as the visual body — the single 4 MB hero asset is re-authored as instanced rim modules, §1.9); gantry and drydock cradle (hero-adjacent, custom); the seam detailing on the lower rim (part of the wheel build).
- **Licence flag (not a design change):** `soumaya-ship.glb` is **CC-BY-NC** (3DHaupt). It remains the hero for now exactly as shipped; the verified CC-BY-4.0 `organic-spaceship.glb` already in the repo is the recorded replacement **before any commercial use**. Whichever hull ships, the identity is fixed: seventh hull, forward length 12, **blank nameplate never painted**. The pilot does not swap the ship.

### 1.8 Named anchor hierarchy (carried exactly)
Root `station-world`; exterior holders: `station-rotating`, `station-work-lights`, `station-traffic-fallback`, `witness-drydock-gantry`, `witness-hauler`, `annex-lunar-annex`, `annex-colony-ring`, `annex-station-stores`, `annex-model-<key>`, `hero-ship`, `backdrop-lava`, `backdrop-quaternius-planet-1` (pattern `backdrop-<planet.key>`), `docking-shuttle`, `harbor-controller-ship`, `traffic-<key>`, `docked-<key>`, `drydock-<key>`, `dressing-<key>`. Interior root `station-interior` with rooms `hangar-bay`, `commission-board`, `fleet-deck`, `observation-deck` and holders `interior-bay-ship`, `interior-user-ship`, `interior-bay-door-lintel`, `interior-deck-viewport-lintel`, `interior-gate-lintel`, `interior-gate-lights`, `interior-rim-arc`, `interior-nav-markers`, `interior-work-lights`, `interior-light-strips`, `interior-<model.key>`, `interior-floor-<space.id>`, `interior-ceiling-<space.id>`.
**Placement-critical anchors:** `station-rotating` (bounding volume drives the place radius ≈384 and three spot offsets incl. the lower-rim seam — the wheel mesh must stay centred on origin at radius 210); `witness-drydock-gantry` (small radius 7, reach 60 — keep the gantry a compact, distinct holder, do not merge it into the drydock mass); `hero-ship` (bounding box must stay ship-sized — spots and the place rule measure the hull, not a mooring field); relic holders `relic-harbor-nail` and `relic-mooring-ring` stand at the lower-rim seam and the harbour-stone/road meeting respectively — the rim and harbour-edge geometry must leave those resting places physically present.
**Totals carried: 5 place rules; ≈37 holder names/patterns (20 exterior + 17 interior).**

### 1.9 Mobile performance plan
Stated budget: **`STATION_BUDGET { drawCalls 88, visibleTris 750,000 }`**, internal targets **{ 72, 500,000 }**; interior **{ maxDrawCalls 64, maxTris 500,000 }**. Plan: design to the *internal* targets. The wheel is 48 instanced rim segments sharing one material + one atlas (target ≤6 draw calls for the whole rim incl. beacons as a second instanced set); annexes merged per-holder into single meshes; traffic hulls instanced per model key; dressing merged into `dressing-<key>` statics. Textures: one 1024 hull atlas, one 512 emissive strip, backdrop planets keep their shipped textures.
**⚠ FLAGGED CONFLICT (not silently designed down):** first-visit download weight — home already ships ≈21.9 MB and `space_station_3.glb` alone is ≈3.99 MB. A painterly-detail wheel at the internal 500k-tri target is achievable with instancing, but a *textured* hero wheel risks pushing the station GLB past the current 4 MB unless texture resolution is held at 1024 and geometry carries the detail. This brief holds that line (geometry-led detail, 1024 atlas); if the pilot's art pass wants 2048 hero textures, the download cost must be put to the owner before it is spent.

### 1.10 Mysteries protected (build rules)
The second seam is modelled **sealed** — a closed, older joint; never open, never lit from within, never given a mechanism or a door's affordance. The hero nameplate is a **blank rectangle** — no name, no letters, no decals. The berth-board's slots are lit/unlit only — **no text, no numbers**. Nothing labels the missing berth. No signage anywhere in the harbour.

---

## 2. Growing Place (`growing-place`)

**Identity carried:** the garden of the player's Journeys, Hour IV — Patience. Six terraces rising to the witness tree; walked, not flown; what grows here is the player's real work.

### 2.1 Composition
The eye lands on the **witness tree at the crown** — the single vertical in a world of concentric horizontals, haloed (`witness-halo`). Foreground: the arrival meadow (lowest terrace) with the last 30 days of growth; middle ground: the five rising terrace rings with their groves, paths and journey plots; background: dawn sky gradient and backdrop planets at 4,000 units, low-saturation so the green terraces hold the frame. From any terrace, the composition is a spiral of rings climbing to the tree — the garden reads as one continuous planted amphitheatre, never as floating rings: risers (`terrace-riser-<t>`) are modelled as planted retaining faces, not cut edges.

### 2.2 Spatial layout
Terraces t = 0..5 at radii **[900, 780, 660, 540, 400, 250]** and heights **[0, 18, 36, 54, 72, 90]**; underside depth 60 (`garden-underside-cap`, `garden-underside-skirt`) — the underside exists and must be finished, since flight approaches see it. The tree stands at the origin/crown. Grove radius 52 (crown/done radius 30): completed journeys stand on the crown by the tree; journey groves elsewhere hold `plots-gathering`, `plots-sprout`, `plots-stone`, `plots-wild`; `paths` and `lit-paths` connect terrace to terrace and grove to grove as walkable ground (the walker moves at 150 u/s; paths must read as the natural walking lines). `seed-pods` distributed as the garden's game objects. All lore spots resolve at the **origin (the tree)** — the tree's position and the crown's openness are placement-critical.

### 2.3 Architecture & terrain
Terrain-led: six sculpted terrace discs with softened rims, planted risers (stone-faced, planted over), lawns (`grove-lawns`), trails (`grove-trails`). Architecture is minimal and organic — stone plot markers, seed-pod forms, path edging. Custom Blender work: the terrace terrain sculpt (one continuous mesh family, watertight underside), the witness tree (hero sculpt, §2.7), riser retaining faces. Grove trees (`grove-trees`, `grove-trunks`) are a custom low-poly-but-painted tree kit (3–4 variants, instanced), *not* Quaternius flat foliage — trunks and canopies re-authored with the painterly material treatment (§2.5).

### 2.4 Landmarks
Six terraces at the stated radii/heights · the **witness tree** at the crown with its halo · the **one dead bough** — bare, leaf-less, pointing toward the hole (a fixed modelling feature of the tree, §2.10) · the arrival meadow (lowest terrace) · journey groves + per-journey signs `grove-sign-<journeyId>` and landmarks `landmark-<journeyId>` (generated — the rebuild supplies the *kit* and the empty plots, never invented journeys) · the four plot families · `seed-pods` · the **seed-stone** prop at the tree · the **Witness Seed** resting place beneath the tree and the **Dawn Leaf** at its roots (relic holders `relic-witness-seed`, `relic-dawn-leaf`) · the walker (`garden-avatar`, `garden-carried` — her ship walking) · backdrop planets.

### 2.5 Material palette
Living green in dawn light: lawn green (mid, warm-shifted), canopy greens in three depths, terrace stone (warm grey, moss-touched at risers), path earth (pale packed soil), dawn-gold accents in `warm-halos` and `lit-paths` emissive edging, the tree's bark a dark warm brown with gold-lit rim. Painterly treatment: broad colour shapes in the canopy textures (512px painted foliage cards), no photographic leaf textures. Sky: dawn gradient (indigo zenith → gold horizon) — the one world whose sky is warm at the horizon line.

### 2.6 Lighting & atmosphere
Warm dawn key light, low angle, long soft shadows (baked into terrace textures where the app light rig is insufficient); gold ambient bounce. `grove-mist` as layered translucent planes in the terrace hollows — cheap, static, reduced-motion safe. Distance haze in the dawn-gold of the horizon, not indigo: the garden's fog colour is what most separates it from the space worlds.

### 2.7 Assets — reuse vs new
- **Reuse as-is:** the procedural terrace/grove construction logic is the layout authority (radii/heights/positions are not redesigned); backdrop planet *holders* are unchanged.
- **⚠ Carried spec change:** per `docs/specs/procedural-planets-eve-scale-2026-10-31.md`, toy backdrop planet models (`pp-*`, `quaternius-planet-2`, the Sketchfab ice planet GLB) are being replaced by **shader planets** under the same `backdrop-<key>` names. The Blender scope therefore **excludes** backdrop planet models for this world — do not remodel them; the holders stay, their content is the shader spec's.
- **New in Blender:** terrace terrain set, witness tree (hero custom sculpt incl. the dead bough), grove tree kit, riser faces, path/plot dressing kit, seed-pod forms.

### 2.8 Named anchor hierarchy (carried exactly)
Root `growing-place`; holders: `witness-tree`, `witness-halo`, `terrace-0`…`terrace-5`, `terrace-riser-0`…`terrace-riser-5`, `grove-trees`, `grove-trunks`, `grove-lawns`, `grove-flowers`, `grove-trails`, `grove-mist`, `grove-pulse`, `grove-sign-<journeyId>`, `landmark-<journeyId>`, `plots-gathering`, `plots-sprout`, `plots-stone`, `plots-wild`, `seed-pods`, `paths`, `lit-paths`, `vegetation`, `warm-halos`, `garden-avatar`, `garden-carried`, `garden-underside-cap`, `garden-underside-skirt`, `backdrop-<planet.key>`.
**Placement-critical:** `witness-tree` — all garden spots anchor to the origin; the tree's bounding volume and the crown's open standing room (radius 30) must remain as built. Per-journey holders are generated at runtime; the rebuild must not bake journey content into static geometry.
**Totals carried: 0 place rules (origin-based world); ≈27 holder names/patterns.**

### 2.9 Mobile performance plan
Stated budget: **{ drawCalls 95, visibleTris 700,000 }** (the 95 draw-call ceiling is pinned by a test). Plan: terraces as 6 + 6 merged meshes; grove trees instanced (one draw call per variant/material); foliage cards alpha-tested, not blended; mist planes ≤6 draws; per-journey generated content is runtime instancing, outside the static budget but sharing the same kits. Textures: 1024 terrain atlas per terrace pair, 512 foliage cards.
**Flag:** no conflict with the stated budget; the risk is runtime-generated grove density on a mature garden, which is the app's instancing concern, not this rebuild's — recorded, not redesigned.

### 2.10 Mysteries protected (build rules)
**Maren is never depicted** — no figure, statue, or likeness anywhere in the garden; what she tends is under the roots and stays under. The **dead bough is modelled bare** — the rebuild must not leaf it, decorate it, or "repair" it; its leaves exist only as a runtime state for finished Journeys, never as baked geometry. Nothing marks the Witness Seed's exact spot beyond its relic holder. No text on plot signs (`grove-sign-<journeyId>` signs are markers, not lettering).

---

## 3. Deep Past (`deep-past`)

**Identity carried:** the oldest world, Hour I — the First Morning. A descent through nine strata to the First Light basin. **Private-only, permanently** (owner-settled): no design choice here may assume a second visitor, a shared view, or a public surface.

**⚠ Flagged open item — D-2 (holder naming).** The spots spec §9's measurement table names Deep Past landmarks `glb-rim`, `glb-stair` and `stratum-0…8`; the scene on main builds `place-rim`, `stair` and a single `strata` group, and `storyTriggers.ts` agrees with the scene. **This brief uses the scene's names** (the shipping truth) and flags the spec table as describing an earlier build. The rebuild must **not** split `strata` into per-stratum holders to match the stale table, and must not rename `place-rim`/`stair` — owner to correct the spec or rule otherwise.

### 3.1 Composition
A vertical composition — the only world composed downward. From the rim: foreground, the rim edge and the chalk-tally; middle ground, the helical fall of nine stratum discs shrinking 88 → 60 as they descend 0 → −144, the stair stitching them; background/depth: the **basin at −168**, radius 66, lit from within by the First Light — the eye's final landing is the orb's glow at the bottom, with `light-shaft-core`/`light-shaft-outer` rising from it past the spire. The Anchor Spire (`glb-spire`) is the vertical counter-line to the descent. The supernova remnant (`glb-supernova`) hangs as the one distant background event.

### 3.2 Spatial layout
Strata 0 (rim, most recent) → 8 (oldest): radii 88 → 60, Y 0 → −144 in −18 steps, disc thickness 2.6, under one `strata` holder. The stair (`stair`) descends with landings `place-landing-deepest`, `place-landing-mid`, `place-landing-last` and shelf `place-shelf`; the glide system (`glide-column`, `glide-form`, `glide-pad-<id>`) parallels it. The rise: `rise-shelf` at angle 5.35, radius 54, y = 9, with `rise-columns`, `rise-glow`. Basin at Y −168: `basin-floor`, `basin-rock` under `glb-basin`; the orb (`glb-orb`), `pool-glow`, light shafts at its heart. Alcoves (`alcove-pads`, `alcove-ring-<i>`, `alcoves-gathering`, `alcoves-sprout`, `alcoves-stone`) niched into the strata walls; the **lowest-stratum alcove above the basin** holds the Lantern of Keeping. **The missing Sixth Hour layer** sits between two strata at the bottom: a clean absence exactly one hand's-breadth thick — in layout terms, a gap in the disc stack where a disc would be; the rebuild keeps the gap's edges clean-cut, as if a layer were removed, not eroded.

### 3.3 Architecture & terrain
Geological architecture: strata as sedimentary discs with distinct banding per age (the deeper, the older and darker), rim rock, basin rock. The stair is the architectural hero — a built stone descent with the ribbon tied at it, worn treads, landing platforms. The spire is ancient worked stone/metal rising from the basin zone. Custom Blender work: strata disc kit (banded, instanced per stratum with per-age material tint), stair flight + landings, basin bowl, rim. Existing `*-web-256` pieces (§3.7) are the proportion reference.

### 3.4 Landmarks
The rim (`place-rim`) with the **chalk-tally** (7 strokes, last smudged) · nine strata · **the missing sixth layer** · the stair + **stair-ribbon** (renewed ribbon prop) + three landings + shelf · the rise (shelf/columns/glow) · the basin + **First Light orb** + pool glow + light shafts · the Anchor Spire + its glow · the supernova remnant · alcoves incl. the Lantern of Keeping's · **relic resting places:** First Light Shard near the basin, Basin Stone on the basin floor, Witness Without a Name at the lowest stratum at the basin (holders `relic-first-light-shard`, `relic-basin-stone`, `relic-lantern-of-keeping`, `relic-witness-without-a-name`) · **Oru's Bead** (`obj.orus-bead`, the Siege's door key, found here) · `deep-past-ship` · atmosphere holders (`hero-orbs`, `memory-lanterns`, `marine-snow`, `motes`, `bead-rims/shells/interiors`, `gold-trims`, `thread-bright/dim`).

### 3.5 Material palette
Layered stone in deep time: stratum bands running warm umber at the rim through slate and indigo-dark at the bottom; gold trim (`gold-trims`) as the kept-metal accent; the basin's light is warm-white First Light (not amber, not cyan — its own colour); lantern glass warm (`memory-lanterns`, `stratum-lantern` family). Painterly treatment: banding painted into 1024 stratum textures with broad value steps, no photographic rock. The basin's reflective surface is a special material (§3.10) — a dark mirror finish, roughness low, tinted toward a sky that is not the sky above.

### 3.6 Lighting & atmosphere
The world is lit **from below**: the basin's First Light is the key light (baked upward glow on the lowest strata, spire base and stair foot), lantern points as emissive accents up the descent, rim daylight faint and cold from above. `marine-snow` and `motes` are slow particle planes/points — static-leaning, reduced-motion safe. Fog: deep indigo, thickening with depth so the descent darkens before the basin's glow re-opens it. No dynamic shadow cascade on mobile; bake the basin's upward light into the lower strata textures.

### 3.7 Assets — reuse vs new
- **Reuse as-is:** `first-light-basin-web-256.glb` (22,500 tris), `rim-web-256.glb`, `descent-stair-web-256.glb`, `stratum-terrace-web-256.glb`, `stratum-lantern-web-256.glb` — small, purpose-built; the four `*-web-256` pieces are the proportion and naming reference for any re-authored versions.
- **Improve candidates (flagged, §3.9):** `sf-anchor-spire.glb` and `sf-supernova-remnant-slim.glb` — re-authoring is a budget decision, not a style preference; the spire's silhouette and the remnant's point-cloud character must survive any re-author.
- **New in Blender:** strata banding textures, stair wear detail, basin bowl finish, alcove niches (if the current pieces are re-authored, they are rebuilt to the same footprints and holder names).

### 3.8 Named anchor hierarchy (carried exactly)
Root `deep-past`; place rules `^glb-basin$`, `^glb-spire$`, `^glb-supernova$`, `^glb-orb$`, `^place-rim$`, `^place-shelf$`, `^place-landing-` (family); holders: `glb-basin`, `glb-spire`, `glb-spire-glow`, `glb-supernova`, `glb-orb`, `place-rim`, `place-shelf`, `place-landing-deepest`, `place-landing-mid`, `place-landing-last`, `stair`, `strata`, `rise-shelf`, `rise-columns`, `rise-glow`, `basin-floor`, `basin-rock`, `alcove-pads`, `alcove-ring-<i>`, `alcoves-gathering`, `alcoves-sprout`, `alcoves-stone`, `hero-orbs`, `hero-orb-glow-<stratum>`, `memory-lanterns`, `marine-snow`, `motes`, `anchors`, `deep-past-ship`, `glide-column`, `glide-form`, `glide-pad-<id>`, `bead-rims`, `bead-shells`, `bead-interiors`, `gold-trims`, `thread-bright`, `thread-dim`, `light-shaft-core`, `light-shaft-outer`, `pool-glow`.
**Placement-critical:** `strata` stays **one group** (D-2 — no per-stratum holders); `place-rim` and `stair` keep their names and positions (spot reaches ≈395 / ≈352 were measured against them); the missing-layer gap is *inside* the `strata` group's span — the group's bounding box must not be "corrected" to close it; `glb-basin` at Y −168 anchors four relic/spot relationships — its floor stays at the built height.
**Totals carried: 6 place-rule patterns; ≈41 holder names/patterns.**

### 3.9 Mobile performance plan
Stated budget: **maxTris 195,000** — the tightest tri budget of any world (no separate draw-call constant recorded; the brief designs to ≤60 draw calls by analogy with Quiet/Archive — marked as a *design target*, not a stated budget).
**⚠ FLAGGED CONFLICT (explicit, per mission rule):** `sf-anchor-spire.glb` alone is **80,210 tris — 41% of the entire world budget** — and `sf-supernova-remnant-slim.glb` is **2.62 MB** of download for a background element, against a 195k-tri world whose other hero pieces total ~130k tris. The painterly intent (a monumental spire, a vast remnant) and the budget cannot both be served by the current assets. Options recorded, **not chosen**: (a) re-author the spire at ≤35k tris with silhouette preserved (custom Blender hero work) and re-derive the remnant as a shader/plane treatment ≤10k tris; (b) raise this world's tri budget by owner ruling. The brief's layout assumes (a)-shaped footprints so the pilot can measure both. Download weight also flags: basin+spire+supernova+orb ≈ 5.4 MB of this world's ≈6–20 MB allowance — re-authoring is where the saving lives.
Plan otherwise: strata = 9 instanced discs on one banded atlas (1024); stair/landings merged per holder; light shafts = additive planes, 2 draws; particles = point clouds, 2 draws.

### 3.10 Mysteries protected (build rules)
The **missing Sixth Hour layer is never filled** — no disc, no rubble, no "ruined" layer: a clean hand's-breadth absence. The basin's reflection is **never explained or corrected** — its surface reflects a sky *before* the hole; the rebuild must not mirror the actual sky above, add an image of what it reflects, or annotate it. The **Unnamed is never depicted** — no figure, face or name at the lowest stratum; the Witness Without a Name's resting place is a place, not a portrait. The chalk tally is **7 strokes, last smudged — never digits**. The stair-ribbon reads as *renewed* (tied fresh), never as a label or marker with writing.

---

## 4. People (`people`)

**Identity carried:** the world of the player's people, Hour V — Love. A field of hearths, one cluster per real person, joined by bridges only where shared memories exist. **The environment is a shell; the content is data.** A Blender rebuild delivers the field, ring, bridge and hearth architecture — cluster contents are generated from the player's real people and must never be baked, faked or filled with decorative "example" people.

### 4.1 Composition
Foreground: the field's near edge and the nearest hearth-cluster's warm lights. Middle ground: `field-ring` on ring — clusters of memory lights (spheres r 2.2), date rings (r 3.4) and gathering rings (r 4.5) distributed across the 560-radius field, each cluster a small constellation with its own centre. Background: `bridges` arcing between clusters that share memories — the eye reads relationships as light-paths across the dark field; backdrop planets (`earth-and-moon`, `quaternius-planet-3`) hang far and dim. The hero "silhouette" is negative: a warm dark field *patterned* by held light, densest where the player's life is densest.

### 4.2 Spatial layout
Field radius **560** under `field-ground`; `field-ring` bounds it. Clusters (`people-cluster-<id>`) are placed by the app's layout from data — the rebuild does not fix cluster positions; it supplies the ground, the ring, the per-cluster kit (hearth base, light seats, ring forms) and the bridge system (`bridges` — catenary light arcs between cluster anchor points). Three lore spots resolve to offsets on `field-ground` itself (the empty chair; Tamsin's ward; Kith's drawing, reaches ≈212–297) — the field surface must remain a valid, uncluttered landing ground at those offsets: no baked props may be scattered across the open field. `dressing-ships` at the field's edge; `ember-motes` throughout as atmosphere.

### 4.3 Architecture & terrain
Terrain: one continuous field disc — gently modelled ground with a worn-earth finish, ringed by `field-ring` (a low boundary ring form). Architecture: the **hearth** is the unit — a small stone hearth base per cluster (custom kit piece, instanced), built to receive the runtime's lights/rings/threads. Bridges are light-constructions, not masonry: emissive arc geometry generated at runtime; the rebuild supplies their material and end-cap seats only. No buildings, no houses — this world is hearths, not dwellings.

### 4.4 Landmarks
The field + ring · per-person clusters with memory lights, date rings, threads, gathering rings (`cluster-glows`, `cluster-hearths`) · bridges between shared-memory clusters · the **empty chair** at every hearth (the table-one-more condition, §4.10) · story props **table-one-more** (a table laid one place too many) and **button-jar** · relic resting places: **Hearth Ember** near the first hearths, **Thread of Many** between the hearth stones (running *toward* the empty chairs) — holders `relic-hearth-ember`, `relic-thread-of-many` · **Tamsin's ward spot** (`sight.tamsins-ward` — the door to the Faded Ward opens from here; its field location must remain findable) · ember motes · dressing ships · backdrop planets.

### 4.5 Material palette
Hearth amber over field dark: ground = deep warm earth (dark umber-green, roughness 1.0, painted wear), hearth stone = warm grey stone, memory lights = warm gold emissive, date rings = pale gold metal, threads = amber light-cones, bridges = soft gold emissive arcs, gathering rings = stone with gold inlay line. Sky/fog: the shared indigo, warmer at the horizon than any other flight world except the garden. No cyan in this world except nothing — cyan stays navigation truth and is absent here by design.

### 4.6 Lighting & atmosphere
The field is lit by its hearths: emissive-driven, with a low warm ambient and one faint directional (moonlight-cool) for ground definition. Glow is faked with additive halo sprites at light positions (runtime), not bloom. `ember-motes`: slow rising points, warm, sparse. Fog: warm indigo, gentle — clusters should emerge from it as the ship crosses the field.

### 4.7 Assets — reuse vs new
- **Reuse as-is:** the entire procedural/instanced cluster system (lights, rings, threads, hearths are runtime-generated — `peopleAssets.ts` uses no world GLBs beyond backdrop planets). Backdrop planet holders unchanged (shader-planet spec applies as in §2.7).
- **New in Blender:** the field terrain + `field-ring` (one hero terrain piece), the hearth base kit (instanced seat for runtime content), bridge end-cap seats. Nothing else — this world's richness is data, and Blender must not manufacture any.

### 4.8 Named anchor hierarchy (carried exactly)
Root `people`; place rules `^field-ground$`, `^bridges$`, `^people-cluster-` (family); holders: `field-ground`, `field-ring`, `bridges`, `cluster-glows`, `cluster-hearths`, `ember-motes`, `dressing-ships`, `people-cluster-<id>`, `person-light-<id>`, `backdrop-<planet.key>` (incl. `backdrop-earth-and-moon`, `backdrop-quaternius-planet-3`).
**Placement-critical:** `field-ground` is the universal fallback anchor (8 spot pattern uses — the most-used in the game) and must remain one field-sized holder whose bounding volume covers the full 560 radius; `people-cluster-<id>` and `person-light-<id>` are per-person generated — the rebuild ships the kit, never instances.
**Totals carried: 3 place-rule patterns; ≈10 holder families (plus per-person generated instances).**

### 4.9 Mobile performance plan
Stated budget: **{ drawCalls 80, visibleTris 400,000 }**. Plan: field + ring = 2 draws; hearth kit instanced (1 draw per kit piece across all clusters); runtime lights/rings/threads are instanced spheres/rings/cones (existing system, shared materials); bridges merged per arc into `bridges` statics where data allows, else instanced segments; backdrop = 2 draws. Textures: one 1024 ground atlas, emissives untextured. **Flag:** cluster count grows with the player's real life; the static environment delivered here is a small fixed slice of the budget and the runtime system owns the rest — recorded so the budget is not misread as environment-only headroom. No art-vs-budget conflict in the environment shell itself.

### 4.10 Mysteries protected (build rules)
**No person is ever depicted** — no figure, portrait, silhouette or avatar at any hearth; people exist as lights, rings and threads only. Every hearth is laid for **one more than it holds** — the empty chair / extra place is a fixed feature of the hearth kit (an unoccupied seat position in every cluster's layout), never "corrected" to match a count, and never explained. Bridges exist **only** where shared memories exist — the rebuild must not add decorative bridges. Tamsin's ward is a *spot*, not a building: nothing ward-like is modelled in this field.

---

## 5. Quiet/Archive (`quiet-archive`)

**Identity carried:** the world of rest, Hour VI — made twice. Rest, not loss; nothing dies, things rest (Draft 7, locked). The emptiness is the identity: this world must be designed to be *finished while nearly empty*.

### 5.1 Composition
Foreground: the **Still Threshold** — lintel (`threshold-lintel`) and two posts (`threshold-post-left/right`) as a single framed opening, the world's only doorway. Middle ground: the empty field (radius **220**) falling away in stillness, with archive clusters (`archive-cluster-<id>`, spacing **90**) appearing only where the player has actually set something down to rest. Background: `field-ring` at the field's edge, the Sputnik alcove off-axis by the arrival edge, backdrop planets (incl. the pixel brown dwarf) dim and far. The eye lands on the threshold, then on *how little there is* — spareness is the composition. The Unopened Fold rests at the field's heart: compositionally central, visually quiet.

### 5.2 Spatial layout
Arrival at `still-threshold`; three lore spots anchor here (the alcove, the boat, the hymn; reach 64–110) and the paper-boats + torn-hymnal props stand at the threshold. Field radius 220; clusters at spacing 90 in the field; `bridges` between shared archived memories; the **Stillness Seal's alcove** at angle 0.6, radius 110–154 (0.5–0.7 × field) by the arrival edge; the **open empty alcove with the unopened letter** as a built location; the **Sputnik alcove** (`artifact-sputnik`, `artifact-sputnik-model`) off the threshold axis by the arrival edge; the Fold at the heart (radius ~0 centre). `still-motes` throughout. On an empty brain there are no clusters — the layout must still resolve: threshold, field, alcoves, Sputnik and Fold are the permanent built world; clusters are data.

### 5.3 Architecture & terrain
Architecture of stillness: the threshold as a single stone gate (custom Blender hero piece — lintel + posts, worn smooth, no ornament, no inscription); alcove forms as shallow stone niches built into a low field-edge arc (the Seal's alcove, the open empty alcove, the Sputnik alcove share one niche kit with different dressing); the field itself a level pale ground disc with `field-ring` boundary. Terrain is deliberately featureless — undulation would be noise here; finish is in the material (§5.5), not the sculpt.

### 5.4 Landmarks
The Still Threshold (+ lintel/posts) · **paper-boats** (5, all pointing the same direction) and **torn-hymnal** (one page cleanly torn out) at the threshold · the empty field + ring · archive clusters (data-driven) with `cluster-glows`, `cluster-lamps` · bridges · the **Stillness Seal's threshold alcove** (relic holder `relic-stillness-seal`) · the **open, empty alcove with the unopened letter inside** · the **Unopened Fold at the field's heart, kept unopened** (relic holder `relic-unopened-fold`) · the Sputnik alcove (real-world artifact, resting) · still motes · backdrop planets.

### 5.5 Material palette
The palest of the flight worlds: still stone in pale slate-grey (roughness ~0.9), threshold stone slightly warmer where hands would touch, field ground a muted pale-earth, lamp glass in soft warm points (`cluster-lamps`) kept few and low, motes pale cyan (the one world where cyan is an atmosphere colour — stillness, per the shared grammar), the Fold's material undyed cloth/paper-toned — plainly *kept*, never jewel-like. Sputnik: real hardware greys, unadorned. Sky: indigo at its palest, fog pale and even — the archive is the brightest of the dark worlds without ever being bright.

### 5.6 Lighting & atmosphere
Soft, even, shadow-leaning-to-none: a high diffuse ambient (hemisphere) with one very soft directional; no dramatic key light anywhere in this world. `still-motes`: slow, pale, sparse points. Fog: pale indigo-grey, long and gentle — distance softens, never threatens. Everything about the light says *kept*, not *kept away*.

### 5.7 Assets — reuse vs new
- **Reuse as-is:** the Sputnik model (`artifact-sputnik-model`) — a real artifact, kept byte-for-byte as the inventory records; the procedural threshold/field/cluster system as layout authority; backdrop planet holders unchanged.
- **New in Blender:** the threshold gate (hero piece), the alcove niche kit (3 dressed variants from one form: Seal's, the open empty one, Sputnik's), the field + ring finish. Cluster content remains runtime data — never baked.

### 5.8 Named anchor hierarchy (carried exactly)
Root `quiet-archive`; place rules `^still-threshold$`, `^field-ground$`, `^bridges$`; holders: `still-threshold`, `threshold-lintel`, `threshold-post-left`, `threshold-post-right`, `field-ground`, `field-ring`, `bridges`, `cluster-glows`, `cluster-lamps`, `still-motes`, `artifact-sputnik`, `artifact-sputnik-model`, `archive-cluster-<id>`, `backdrop-<planet.key>`.
**Placement-critical:** `still-threshold` is the single arrival point (4 spot pattern uses; reach 64–110) — its bounding volume must stay a distinct, compact gate, not absorbed into field geometry; `artifact-sputnik` carries its own place-passage key — keep the alcove a separate holder at its off-axis position; `field-ground` (the hollow, the edge spots) stays field-sized.
**Totals carried: 3 place-rule patterns; ≈14 holder names/patterns.**

### 5.9 Mobile performance plan
Stated budget: **{ drawCalls 60, visibleTris 300,000 }** — the smallest draw-call budget of any world; the design fits it with room to spare (threshold 3–5 draws, alcove kit instanced, field+ring 2, Sputnik as shipped, clusters runtime-instanced, motes 1). Textures: one 1024 stone atlas shared by threshold + alcoves. **Flag:** no conflict — this world's restraint and its budget are the same fact. Recorded explicitly so no later stage "enriches" the archive against either.

### 5.10 Mysteries protected (build rules)
The **Unopened Fold is modelled closed** — no opening state, no contents, no hinge of curiosity; it is *kept unopened*, forever. The letter in the open alcove is **never readable** — an unopened letter form only; no text, no opened envelope. The torn hymnal's missing page is never restored and **nothing states in plain form which account of the tearing is true** (both Draft 5 and Draft 7 accounts stand; owner ruling 2026-10-31) — the rebuild shows the torn book, not a verdict. Nothing in this world may be framed as death, deletion or mourning: no grave forms, no memorial plaques, no wilting. Rest, visibly.

---

## 6. Scale (`scale`)

**Identity carried:** the world of true size, Hour II — Wonder. Real space hardware and the solar system at honest relative scale around the ISS. **Scale has no ordinary fog: true black + a true starfield** (carried rule) — space here is empty and exact, unlike every other world. Planets' "true size" is true *within the scene's own fiction* (Draft 9 §5), not real-world proportion — the brief claims nothing more.

### 6.1 Composition
The hero is the **ISS at honest span** — truss 109 units against her 12-unit ship on its 320-radius orbit: in the hero frame the station's truss crosses the whole middle ground, her ship a small foreground shape that makes the truss's size undeniable. The **survey frame** ("the gate that measures", 130 × 50 at [0, 0, 320]) stands beside the truss as the composition's measuring device — a literal frame within the frame. Background: true black, starfield points, far shader planets (650–2,000 units across at 4,400–7,600 out) as discs of light, nebula planes beyond them as pictures, never as places. No haze anywhere softens an edge.

### 6.2 Spatial layout
Near field at **1 unit ≈ 1 metre**: ISS at centre (`iss-holder`); her ship's orbit radius **320**, height 60; survey frame at [0, 0, 320] with `docked-capsule` at it; the Moon (`moon`, `moon-model`) with `moon-outpost-<slot>` positions on its surface; probes (`probe-kepler`, `probe-pioneer-10`, `probe-dawn`, `probe-voyager`) and `satellite-a` in the field; encounters (`encounter-<key>`: hubble, pulsar, alien, astronaut, flexunit-ufo, ufo) drifting; centerpieces (`centerpiece-<key>`: black-hole, sf-black-hole, pillars-1b, g292, gas-cloud, planetary-nebula) at their stations; the belt (`belt-<key>`, `belt-piece-<key>`) as a debris band. Far field: shader planets on the layout's preserved *directions*, placed 4,400–7,600 out by `FAR_BODY`, with invisible body shells at 1.6 radii (approachable, never reached) — the layout's near-field planet sizes (Earth 40, Jupiter 55, Saturn 45, Mars 30) are **directions data only** per the procedural-planets spec and are **not** the visual truth. The **untied cord** prop is at the ISS; the **hung star** spot may resolve to any of six `planet-*` bodies.

### 6.3 Architecture & terrain
No architecture, no terrain — this world's "construction" is *placement and honesty*: real models at real relative sizes, orbital spacing that lets the ship's orbit read, the survey frame as the one built structure (a measuring gantry — custom-checked geometry, four members + 4 beacons under `gate-scale-survey-frame`). Blender scope here is curation and framing, not modelling: verifying holder placements, the frame, the Moon's outpost slots, and the belt's composition. The starfield is a sky of true points (no painted nebula wash in the near sky; nebula planes are far, flat, and honestly pictures).

### 6.4 Landmarks
The ISS (+ `iss`, `iss-fallback` wireframe with `iss-fallback-cross/panel/truss`) · the survey frame + beacons + docked capsule · the Moon + outpost slots · the four real NASA probes · Satellite A · encounters (Hubble, pulsar, alien, astronaut, flexunit-ufo, ufo) · centerpieces (two black holes, Pillars of Creation, G292, gas cloud, planetary nebula) · the belt (Bennu, asteroid-large, debris-pile, asteroid-toastie, rubble-rocks, belt-strip) · nebula planes · the **untied cord** at the ISS (last knot untied) · the **probe-notebook** at a probe · relic resting places: **Star Hanger**, **Sunward Compass**, **Unnumbered Fragment** (holders `relic-star-hanger`, `relic-sunward-compass`, `relic-unnumbered-fragment`; discoverability state flagged in G-4, resting places designed regardless) · the **uncatalogued star** — "the one that was hung for someone", present among the `planet-*`/star bodies as a spot anchor, visually one star among stars (its lateness is a behaviour, not a look).

### 6.5 Material palette
Real-hardware palette, un-invented: ISS white/grey panels and gold foil as modelled in `ISS-A.glb`; probes in NASA grey/gold; starfield pure white points on **true black (0x000000 working background — the only world permitted a pure-black field)**; planet shaders per the procedural-planets spec (outside Blender scope); nebula planes keep the Jattenalle renders (CC-BY 3.0) as-is. No indigo wash, no fog colour, no amber/cyan accent system — this world does not speak the other worlds' colour grammar, and must not be made to.

### 6.6 Lighting & atmosphere
Hard single-source sunlight (one directional, high contrast, black shadows), no atmosphere, **no fog of any kind** — a hard build rule, restated in §6.10. Starlight ambience minimal. Emissives only where hardware has them (beacons on the survey frame, encounter lights). The black must stay true in every texture and backdrop decision: no gradient dome, no vignette wash.

### 6.7 Assets — reuse vs new
- **Reuse as-is (byte-pinned, do not modify):** `ISS-A.glb` (6,642 tris; SHA-256 pinned in `scaleAssets.ts`); NASA probes `Dawn.glb` (32,096 tris), `Kepler-A.glb` (9,042), `Pioneer10.glb` (8,189), `Voyager-A.glb` (29,911) — shipped as originals, **not slimmed (owner order 2026-10-30)**; `nasa-g292.glb`, `nasa-bennu.glb`, `pp-hubble.glb`.
- **Specced replacement (not Blender's):** toy planet GLBs (`lowpoly-planet_*`, `pp-*` planet set) are retired by the procedural-planets spec in favour of shader planets under the same holder names — this brief does not remodel planets.
- **New in Blender:** the survey frame check-build (geometry verification of the `gateScene.ts`-built frame is code-side; Blender scope is limited to a placement/spacing proof scene if the owner wants one) and belt composition dressing (re-placing existing asteroid models only — no new asteroid models needed).
- **Flag:** `blackhole.glb` (3.23 MB) is the heaviest single sky asset; it is a working model under the no-slimming order — recorded, untouched.

### 6.8 Named anchor hierarchy (carried exactly)
Root `scale`; place rules `^iss-holder$`, `^moon$`, `^planet-` (family); holders: `iss-holder`, `iss`, `iss-fallback`, `moon`, `moon-model`, `moon-outpost-<slot>`, `planet-<key>` (12 keys: `planet_earth`, `planet_mars`, `planet_jupiter`, `planet_saturn`, `quaternius-planet-1/2/3`, `planets-set`, `earth-and-moon`, `pixel-brown-dwarf`, `sun`, `stars`), `probe-kepler`, `probe-pioneer-10`, `probe-dawn`, `probe-voyager`, `satellite-a`, `encounter-hubble`, `encounter-pulsar`, `encounter-alien`, `encounter-astronaut`, `encounter-flexunit-ufo`, `encounter-ufo`, `centerpiece-black-hole`, `centerpiece-sf-black-hole`, `centerpiece-pillars-1b`, `centerpiece-g292`, `centerpiece-gas-cloud`, `centerpiece-planetary-nebula`, `belt-<key>`, `belt-piece-belt-strip`, `belt-piece-bennu`, `belt-piece-asteroid-large`, `belt-piece-debris-pile`, `belt-piece-asteroid-toastie`, `belt-piece-rubble-rocks`, `nebula-plane-<key>`, `docked-capsule`, `gate-scale-survey-frame`, `survey-frame-top`, `survey-frame-bottom`, `survey-frame-left`, `survey-frame-right`, `survey-frame-beacons`.
**Placement-critical:** `iss-holder` — the cord spot's reach (≈102) and the place rule measure the ISS as built; its 109-unit span is the world's scale claim and must not be rescaled by any repack. `planet-<key>` holders carry far-body shells at 1.6 radii — holder positions are *directions*; do not "helpfully" move far bodies to their layout near-field positions. `gate-scale-survey-frame` at [0, 0, 320], 130 × 50 — fixed.
**Totals carried: 3 place-rule patterns; ≈20 holder families (≈45 literal names with keys expanded).**

### 6.9 Mobile performance plan
Stated budget: **{ drawCalls 100, visibleTris 500,000 }**. The NASA set is light in tris (ISS 6.6k; probes ~79k combined) — the budget risk here is **draw calls and download weight**, not tris: ~45 holders of individual models. Plan: keep one draw per shipped model (no splitting), starfield as a single points draw, belt pieces instanced per key, nebula planes 3 draws. Textures as shipped (pinned assets are not re-textured).
**⚠ FLAGGED CONFLICT (recorded, owner-settled, not redesigned):** download weight — Kepler (2.00 MB) + Pioneer (2.05 MB) + Hubble (1.18 MB) + blackhole (3.23 MB) + G292 (1.2 MB) make Scale the heaviest per-world download in the ≈6–20 MB band, and the no-slimming owner order (2026-10-30) forecloses the obvious remedy. The brief records the conflict and proposes **nothing** against the order; any change is the owner's ruling to make.

### 6.10 Mysteries protected (build rules)
**No fog, no haze, no atmosphere** — ever, in any pass, polish or "cinematic" treatment; a softened Scale is a broken Scale. **No real-world-proportion claims**: the scene's sizes are honest *within its fiction*; no texture, decal or composition may present the stylised planet sizes as real astronomy. **Far bodies are never landed on** — shells at 1.6 radii are a hard spatial rule, not a gap to fill with surface detail. The uncatalogued star is **not singled out visually** — no special glow, marker or colour; it is catalogued by Sethane alone and the scene does not point at it. The untied cord's last knot stays **untied**.

---

## 7. Eternity (`eternity`)

**Identity carried:** the Maker's world, Hour VII — the Standing. A white void at cosmic scale where Eternity stands. Entry is through the Gate (the Witness Without a Name + any 2 other relics, permanent once opened) via a 3-leg chain. His world holds no relic and no fly-to places; the visitor does not fly — the camera orbits him.

### ⚠ THE FIGURE — BINDING OWNER CONSTRAINT (restated, governs everything below)
**Eternity himself does NOT change.** The figure asset is **`man-god-halo.glb`** (495,572 B, 222,118 tris; the owner's own upload, no third-party licence), holder `eternity-figure`, **`GOD_SCALE = 170`**, figure height **323 units**. His established form: **male, bare-skinned, all white, no face, no hair, no body detail, thin golden ring behind his head** (in the model, body and halo are separate meshes split by the name "halo"; halo centre y ≈ 129 in god units, radius ≈ 41). **He never moves.** He has no ship — he is where ships go. **The rebuild scope is exclusively the world AROUND him** — the void, the far shell, the veils, the dye clouds, the tablet, the motes, the visitor orbit dressing. Any Blender work on this world imports `man-god-halo.glb` as a **locked reference** (not editable, not re-exported, not re-scaled) purely to compose the surround against his true size.
**⚠ Flagged open item — D-5.** `CONTINUITY_BIBLE.md` §0.1 prose describes him as "broad-shouldered… face serene and impossible to describe", while the owner's game-model canon is no face / no body detail, and the Bible itself elsewhere states "never a clear face"; the faced 2D painting `03-eternity-v2` is already ruled **mood art only**. This brief follows the **owner's model canon** (binding constraint) and flags the prose for the owner — it does not edit the Bible and does not design toward the prose.
**⚠ Flagged open items — G-5 / §17.1.** The autonomy and world design notes cited by the eternity-autonomy spec are absent from `main`; whether Eternity ever gets a travel model remains the owner's open question. This brief designs for the built truth: orbit-only viewing, view-based spots.

### 7.1 Composition
One subject. The figure (323 units) stands at the centre of a **white void**; the visitor's camera orbits at radius **620**, height 60 (zoom 0.3–2.6× = 186–1,612). Foreground: nothing — the void admits no foreground objects; the nearest dressing is the visitor fleet in its orbit slots (r 190–450, h −110..190), small against him. Middle ground: the figure alone, dominant in every frame at every zoom. Background: the **far shell at 3,800–4,600** — 8 neon veils and 4 liquid-dye clouds as *distant colour*, never approaching scenery. The speech tablet (150 × 75 at [0, 92, 48]) floats as the one composed object besides him — placed in frame with the figure, never competing. The eye lands on him first, always; the surround's job is to make sure nothing else is loud enough to land on.

### 7.2 Spatial layout
Figure at centre; figure reference point [0, 70, 0] (the view-spots anchor). Tablet at [0, 92, 48], 150 × 75. Visitor's own ship (`eternity-player-ship`) parked in orbit — it does not fly here. 12 visitor hulls (`eternity-visitor-<model.key>`) in orbit slots r 190–450, heights −110..190. The comet (`eternity-comet`) drifts as a galaxy visitor. The shield (`eternity-shield`). 500 motes (`eternity-motes`) as the void's only texture. The **sixteen lamps** prop rings the figure: 15 lit + the 16th unlit. View-spots are camera conditions, not places: the unlooked direction (camera on the far side from arrival, +z), the long room (camera beyond 1,100), the eighth bell (camera under 330) — the surround must compose correctly at **all** orbit distances, especially under 330 (intimate) and beyond 1,100 (he becomes the small centre of a vast white).

### 7.3 Architecture & terrain
**None — by law of this world.** No floor, no ground plane, no temple, no throne, no steps, no architecture of any kind. The "construction" is the far shell's veil/cloud treatment, the tablet's form, and the orbit dressing. Terrain tools are not opened for this world.

### 7.4 Landmarks
The figure (locked, §above) · the **speech tablet** · the far shell with **8 neon veils** and **4 liquid-dye clouds** · the shield · the comet · 500 motes · the visitor's parked ship · 12 visitor hulls · the **sixteen lamps** (15 lit, 16th with wick but **no flame**) · the **unlooked direction** (a view condition — the direction he does not look, the same from wherever you stand; it is produced by his pose/gaze as shipped in the locked model and the camera geometry, never by adding a marker, object or darkening in that direction).

### 7.5 Material palette
His white is his (locked model — untouched). The surround: void = sourceless flat white (the one world whose background is white; the generator deviation recorded in Stage A — "Eternity white void renders indigo" in 2D art — is precisely what the 3D surround must **not** do). Tablet: pale stone-light, matte, sized to read as a held surface, never a screen with UI. Veils: neon in restrained jewel tones at far distance, translucent; dye clouds: slow liquid colour, translucent, desaturated by distance. Lamps: warm gold flames (15) — the only amber in the world, small against the white. Visitor hulls: the shared ship palettes, muted by scale. **No religious iconography in any material, motif or ornament — none.**

### 7.6 Lighting & atmosphere
Sourceless, shadowless white ambience — the void is evenly lit because it is not a place with weather. No fog (fog would grey the white and shrink him); depth is given by the far shell's distance alone. The veils/clouds drift slowly (reduced-motion safe states required). At under-330 camera distances the surround contributes almost nothing — that intimacy is designed, not a gap.

### 7.7 Assets — reuse vs new
- **Reuse as-is (locked):** `man-god-halo.glb` — **never replace, never remodel, never re-export from the rebuild**. The 12 visitor hull GLBs (shared Quaternius/Kenney/lowpoly families) as-is. The comet GLB (Poly Pizza, CC-BY 3.0) as-is.
- **New in Blender:** the far shell's veil set (8) and dye-cloud set (4) as translucent sculpted planes/shells, the tablet's finished form (same 150 × 75, same position), mote field distribution, lamp ring dressing (the lamps prop exists; the rebuild supplies its finished forms — 15 lit + 1 unlit is fixed). All surround work happens in a scene where the figure is a locked reference object.

### 7.8 Named anchor hierarchy (carried exactly)
Root `eternity-world`; holders: `eternity-figure`, `eternity-speech-tablet`, `eternity-far`, `eternity-shield`, `eternity-comet`, `eternity-motes`, `eternity-player-ship`, `eternity-visitor-<model.key>` (12 keys).
**Placement-critical:** `eternity-figure` — the view-spots anchor to the figure at [0, 70, 0] and the place passage `^eternity-figure$` (incl. the sixteen-lamps passage) measures him; the exported surround GLB must either exclude the figure (delivered as surround-only, composed against the locked reference) or carry `eternity-figure` as an exact, empty reference node at the built transform — **the figure's own geometry is never part of a rebuild export**. `eternity-speech-tablet` at [0, 92, 48] exactly; `eternity-far` must keep the shell at 3,800–4,600 (inside the camera's far range as built).
**Totals carried: 0 place rules; 9 holder families.**

### 7.9 Mobile performance plan
**No stated budget exists for Eternity** (Stage A §7.8/§17.4). **PROPOSED budget (for owner ratification): { drawCalls 40, visibleTris 350,000 }** — set by analogy: the surround is mostly translucent far geometry and points, so draw calls sit below Quiet/Archive's 60; the tri ceiling must accommodate the fixed figure.
**⚠ FLAGGED CONFLICT (explicit):** the locked figure alone is **222,118 tris — 63% of the proposed 350k ceiling** — and it cannot be reduced (owner constraint + no-slimming order). The surround must therefore live in ≈125k tris: veils/clouds as low-segment translucent shells (≤8 draws total, alpha-blended — transparency sorting on mobile is the real cost, keep them few and far), motes as one points draw, tablet ≤5k tris, visitor hulls as shipped (shared sets, instanced where the app already instances). If the owner prefers the figure excluded from the world's tri accounting, the PROPOSED surround-only budget is **{ drawCalls 40, visibleTris 125,000 }** — recorded as the alternative; not chosen here.

### 7.10 Mysteries protected (build rules)
The figure is **never redesigned** — no face, no hair, no clothing, no detail added, no feminine form, no re-posing; he never moves and is never given a ship. **No floor, temple, throne, altar, steps or religious symbol** may be introduced by any pass. The **16th lamp stays unlit** — wick, no flame, never "completed". The unlooked direction is **never marked** — no darkness, object or sign placed where he does not look; it must remain only a direction. The tablet carries his gesture lines as the app renders them — the rebuild adds no text to it.

---

## 8. Faded Ward (`faded-ward`)

**Identity carried:** Seam S-VII — a hospital ward that is a whole world: one long hall of narrow cots where the Hush "returns" people, the Faded, kept half-returned. The saddest seam. It explains Kith, Tamsin and Hesk. **Must never say: whether they all return.** Entry: story door from People once `sight.tamsins-ward` is found there.

### 8.1 Composition
A one-point perspective world: the hall (300 wide, **2,360 long**, z −160..2200, height 150) composed as a vanishing corridor of cots — foreground, the door (`ward-door`) and the nearest cot rows; middle ground, row after row of narrow cots (spacing **44**, z 90..2100) with ember lanterns every 4th cot at y=70 drawing a dotted rhythm into the depth; background: **fog** — the far end (`ward-far`) recedes past sight and is *never resolved*. The high window (`ward-window`, a window of stars) is the composition's one vertical accent. The eye travels the hall and is deliberately never given an end to land on.

### 8.2 Spatial layout
Two cot rows, heads at |x| = 138, hall halfWidth **150**. Named cots are fixed positions in the rows: **Ruel's cot** left side, index 3 (`ward-cot-ruel`); **Linnet's cot** right side, index 6 (`ward-cot-linnet`) — made up and empty; **the small bed** right side, index 11 (`ward-small-bed`) — holding only a tin soldier. ≈66% of ordinary cots hold faint sleepers — **seeded occupancy is data**: the rebuild supplies cot forms and the empty/made/sleeper dressing *system*, and must keep the named cots' states exact (Ruel's occupied as built, Linnet's made-and-empty, the small bed soldier-only). The hush-bowl (`ward-bowl`), the window, the hook with its coat (`ward-hook`), the door — placed as the scene builds them. Roof ribs (`ward-roof-ribs`) and steam (`ward-steam`) run the hall's length.

### 8.3 Architecture & terrain
One architectural gesture: the long hall. Custom Blender work: hall shell (floor, two walls, roof-rib rhythm — instanced ribs down 2,360 units), the cot kit (frame/mattress/pillow as one instanced family under `ward-cot-frames`, `ward-cot-mattresses`, `ward-cot-pillows`), lantern kit (core + glow), the door, the high window. No terrain. The hall must be modelled as *wards repeat*: identical bays, so length reads as institutional endlessness, with wear variation painted, not modelled, per bay.

### 8.4 Landmarks
The door · the hall, floor, walls, roof ribs, steam · the cot rows + sleepers (`ward-sleepers`) · **Ruel's cot** · **Linnet's made-up, empty cot** · **the small bed with only the tin soldier** (Pip's bed — the relationship is shown, never stated, §8.10) · the **hush-bowl** · the **window of stars** · the **coat on the hook** · ember lanterns (`ward-lantern-cores`, `ward-lantern-glows`) · the **far end in fog** (`ward-far`).

### 8.5 Material palette
Worn ward materials in ember light: cot frames in aged painted metal (off-white worn to grey-green), mattresses in plain undyed cloth tones, pillows paler; floor and walls in muted stone/plaster, damp-darkened low on the walls (painted, broad); wood only in the door and the hook. Lantern cores/glows in **ember amber** — the world's only saturated colour, repeated small into the fog. Sleepers: faint, desaturated cloth-and-form — people-shaped stillness, **never ghostly translucency and never monstrous** (build rule, §8.10). Fog colour: warm grey, lit by the lantern rhythm.

### 8.6 Lighting & atmosphere
Lantern-point lighting as emissive rhythm + baked glow pools on floor/cots at build; one faint cool shaft from the high window (stars — night light, not daylight). Steam: slow translucent planes, sparse. Fog is this world's defining render decision: exponential warm-grey, tuned so `ward-far` never resolves at maximum view distance — the far end's unresolution is a tuned constant, not an accident of draw distance.

### 8.7 Assets — reuse vs new
- **Reuse as-is:** no GLBs are in use — the ward is procedural ("built like the Quiet/People scenes"); the procedural layout (positions, spacing, seeded occupancy) is the authority and is not redesigned.
- **New in Blender:** the full architectural kit — hall shell, roof ribs, cot family, lantern family, door, window, bowl, hook, the small bed + tin soldier as a small custom hero prop set (the soldier is a kept object; model it plainly, toy-scale, unpainted-metal). Sleeper forms: a single restful sleeper sculpt, instanced with variation by rotation/scale within a narrow band — one form, many kept people; never individuated faces.

### 8.8 Named anchor hierarchy (carried exactly)
Canonical WARD_HOLDERS (the world's place rules): `ward-door`, `ward-cot-ruel`, `ward-cot-linnet`, `ward-small-bed`, `ward-bowl`, `ward-window`, `ward-hook`, `ward-far`. Scene holders: `ward-hall`, `ward-floor`, `ward-wall-left`, `ward-wall-right`, `ward-cot-frames`, `ward-cot-mattresses`, `ward-cot-pillows`, `ward-sleepers`, `ward-lantern-cores`, `ward-lantern-glows`, `ward-roof-ribs`, `ward-steam`.
**Placement-critical:** the three named cots are individual holders inside instanced rows — the rebuild must keep `ward-cot-ruel` (left, idx 3), `ward-cot-linnet` (right, idx 6), `ward-small-bed` (right, idx 11) as distinct named nodes at their built positions, not dissolved into the instanced cot holders; spots anchor to `ward-window` ×2, `ward-door`, `ward-cot-ruel`, `ward-cot-linnet`, `ward-small-bed`, `ward-hook`, `ward-bowl`, `ward-far` individually. `ward-far`'s bounding volume sits in unresolved fog — keep it at the hall's far reach, do not shorten the hall to make it "reachable-looking".
**Totals carried: 8 canonical + 12 scene holders = 20.**

### 8.9 Mobile performance plan
**No stated budget exists for the Faded Ward** (Stage A §8.7/§17.4). **PROPOSED budget (for owner ratification): { drawCalls 80, visibleTris 400,000 }** — set in line with People (80/400k), the world it is built like. Plan: cots fully instanced (frames/mattresses/pillows = 3 draws for ~92 cots), sleepers instanced (1–2 draws), ribs instanced (1), lanterns instanced cores + one glow draw, hall shell merged (3–4), fog doing the culling argument: geometry beyond ~800 units is fog-hidden, so the far half of the hall can be the cheapest LOD of the same kits — but holders and named cots stay exact regardless of LOD. Textures: one 1024 ward atlas (cloth/metal/plaster). **Flag:** no art-vs-budget conflict at the PROPOSED level; if the owner sets the budget lower, the sleeper count is data (seeded ≈66%) and must not be thinned for performance — the saving would come from cot LOD, recorded here in advance.

### 8.10 Mysteries protected (build rules)
**Whether they all return is never depicted** — no cot is shown emptied-by-return or filled-by-arrival as a statement; Linnet's cot is made up and empty *as a kept fact*, not a clue with an answer. The far end is **never resolved** — no end wall, no final cot, no figure standing there; fog tuning is a build constant (§8.6). The small bed holds **only the tin soldier** — Pip is never modelled, named in-world, or shown as Hesk's son; the showing (a child's bed, a soldier) is all there is. The Faded are **people, half-returned** — never ghosts, monsters, or horrors: no translucency effects, no distortion, no decay. Each cot is **a person kept, never a count** — no numbering, no name tags, no text anywhere in the ward.

---

## 9. Village (`the-village`)

**Identity carried:** Seam S-V, "The Forty-Second" — the village the Many-Handed left: a small hillside village at night where a count is kept at the gate of who stayed and who went. **Must never say whether staying was right.** Entry: story door once the Thread of Many is found.

### 9.1 Composition
A night hillside composed as a climb: foreground, the **gate** (`village-gate`, z=−40) where the count is kept; middle ground, two loose rows of houses with **every window lit** (`village-windows`, `village-window-glows`) stepping up the hill (z −200..1500, halfWidth 520), the **hearth square** at z=360 and the **well** at z=330 beside it; the **gold hooks** path (z 440→1320, rising y 10→100) threading the composition upward as a dotted gold line; background: the **tall luminous doorway** (`village-door` + `village-door-halo`) at z=1420, the brightest object in the world, at the path's end — the eye's final landing, and a door it never sees through. The chair at z=700, facing the hill, is the composition's quiet counterweight: one still object in the climb.

### 9.2 Spatial layout
Ground/hill under `village-ground`, `village-hill`: a continuous hillside the houses step up. Order along the path is fixed and must remain: **gate (−40) → well (330) → hearth square (360) → hooks begin (440) → chair (700) → hooks end (1320) → doorway (1420)**. No houses stand in the square or on the path — the path's emptiness is layout, not a gap. Houses in two loose rows either side; the square is an open hearth-space; the well stands just below it. The bread (`village-bread`) at its recorded place (a place-passage anchor — a loaf's place, by a door/sill as the scene builds it).

### 9.3 Architecture & terrain
Village architecture as a kit: 4–6 house forms (custom Blender, stone base + timber + roof) instanced with variation into `village-houses` / `village-roofs`, each with lit window apertures (`village-windows` frames, `village-window-glows` emissive panes). Terrain: the hillside sculpt — one continuous slope with the path cut in, terraced lightly at house rows. The gate: a village gate form with a counting-place (a kept-count surface with **no digits**, §9.10). The well: stone ring + two rope falls (`village-well`). The doorway: a tall doorframe standing at the path's end, luminous from its edges/halo — a door that is all threshold.

### 9.4 Landmarks
The gate (count kept) · the houses + roofs · **every window lit** · the hearth square (`village-hearth`) · the **well with two ropes** · the **chair outside one door, facing the hill** · the **path of small gold hooks** (`village-hooks`, `village-hook-heads`) rising to the doorway · the **tall luminous doorway** + halo · the **bread** (`village-bread`) · ember atmosphere (`village-ember`).

### 9.5 Material palette
Night village: stone in blue-grey night tones, timber dark, roofs darker (slate/thatch-dark), window panes in **warm amber emissive** — every pane, the same kept warmth. Hooks: **small gold metal** — the path's only precious material, catching light hook by hook. The doorway's luminosity: pale gold-white, halo soft. Ground: night earth, path paler where feet have worn it. Sky: the shared indigo at its deepest; fog light, night-blue, only enough to separate the rows.

### 9.6 Lighting & atmosphere
Night, lit from within: window emissives are the light design (baked glow at sills/paths), the doorway's halo the single strong source, hooks glinting as points along the climb. No moon disc, no stars emphasis — the village's night is roofed by indigo. `village-ember`: drifting warm points near the square. Window-glow behaviour must hold **still under reduced motion** (inventory note) — no flicker animation baked into materials.

### 9.7 Assets — reuse vs new
- **Reuse as-is:** the procedural village (layout authority: positions, the fixed order along the path, hook spacing).
- **New in Blender:** the house kit (the world's main build), gate, well, chair (a single plain chair, hero in its plainness), hook kit (one hook form, instanced ~23 times at the recorded spacing), the doorway (custom hero piece), hillside terrain. Kenney/Quaternius village geometry may seed proportions only; final forms are re-authored — flat low-poly facets must not survive (§0.1).

### 9.8 Named anchor hierarchy (carried exactly)
Canonical VILLAGE_HOLDERS: `village-gate`, `village-windows`, `village-well`, `village-chair`, `village-hearth`, `village-hooks`, `village-door`, `village-bread`. Scene holders: `village-houses`, `village-roofs`, `village-ground`, `village-hill`, `village-ember`, `village-window-glows`, `village-door-halo`, `village-hook-heads`.
**Placement-critical:** `village-windows` is a spot anchor as a *whole set* — the windows holder must remain one named holder spanning the houses (do not split per-house); `village-door` at z=1420 with `village-door-halo` — its bounding volume is measured for spots, and the doorway must remain a *threshold form*, never a room (there is no geometry beyond it, §9.10); the fixed z-order of gate/well/hearth/hooks/chair/door is placement law.
**Totals carried: 8 canonical + 8 scene holders = 16.**

### 9.9 Mobile performance plan
**No stated budget exists for the Village** (Stage A §9.7/§17.4). **PROPOSED budget (for owner ratification): { drawCalls 80, visibleTris 400,000 }** — in line with People/Ward. Plan: houses instanced per form (≤6 draws) + roofs merged per row; windows as one emissive-pane instanced set (1–2 draws — every window lit is a *material* fact, not a light count); hooks instanced (1 draw); terrain 1–2; doorway 2. Textures: one 1024 village atlas (stone/timber/roof), window emissive untextured. **Flag:** no conflict at the PROPOSED level; the doorway halo is an additive plane treatment, not a volumetric — recorded so a later "cinematic" pass does not price it as one.

### 9.10 Mysteries protected (build rules)
**Nothing beyond the doorway is ever shown** — no interior, no beyond-glow figure, no landscape past the frame; the door is luminous threshold only, and the model must contain *no geometry behind it* that a camera angle could discover. **Whether staying or going was right is never depicted** — no imagery of triumph or regret on either side of the gate; the chair faces the hill, unexplained. The count at the gate is **kept, never shown as digits** — no numerals, tallies-as-numbers, or text anywhere; the words "forty-one"/"forty-two" stay only where locked canon already uses them (in text systems, not in this geometry). **No figures** — the village is empty of people; every window lit is a kept fact about the place, not an invitation to show who lit them.

---

## 10. Siege of the First Light (`the-siege`)

**Identity carried:** Seam S-IV — the battlefield of the First Morning, kept as a field of pale edges. **Three tellers disagree and none is wrong:** Oru remembers a blur of pale edges, *smiling*; Sethane measured it and says it was *small*; the Surveyor says it was *vast* and never happened. All three tellings are physically present and none is shown to be right. **Must never say:** what the First Morning was defended from; Oru's real age. Entry: story door once Oru's Bead (`obj.orus-bead`, Deep Past) is found.

### 10.1 Composition
A radial composition on a broad pale field (radius **1300**): everything leans toward one small thing. Foreground: the nearest crescent edges of the inner arcs (r 300–700) — person-height (30 units) crescents curved like half-closed smiles, all tilted toward the centre. Middle ground: the arcs themselves, ring on ring of edges around the **bead of light on its plinth** at (0, −120) — small, bright, the field's centre of gravity and the eye's landing. Background: the **vast/ghost ranks** at r 760–1200, faint, keeping their distance. Three composed counter-claims sit inside the frame: the **blur** at (170, 300) (a smear of pale light with no edge — Oru's telling), the **small table** at (250, −60) holding the whole field in miniature (Sethane's), and one **taller edge standing apart, smiling** at (−270, 250). Nothing in the composition is allowed to out-argue the others (§10.10).

### 10.2 Spatial layout
Field radius 1300 under `siege-ground`; edges (`siege-edges`, marks `siege-edge-marks`) in concentric arcs r 300–700, each edge 30 tall, lean direction uniformly toward the bead at (0, −120). The line of **9 cups** (`siege-line`, glow `siege-cup-lights`) on low stones at z=105 — no two the same size, each full of thin morning light. The cord at (−230, −190) — last knot untied. `siege-first-light` as the world's light relic-presence. Ghost ranks (`siege-vast`, `siege-ghost-marks`) r 760–1200. All positions are composition facts from the layout and are not rebalanced by the rebuild; the lean of every edge toward the bead is geometry, checked at export (§13-style validation applies here too: lean direction is a measurable).

### 10.3 Architecture & terrain
No architecture except the bead's plinth and the small table — both plain, kept forms. Terrain: one broad pale field disc, nearly featureless, its finish doing the work (pale mineral ground with faint arc-wear under the edge rings). The crescent edge is the world's signature sculpt: a custom Blender hero form — a curved tapering crescent, person-height, with the half-closed-smile curvature consistent across every instance (variation by scale/rotation within a narrow band, never by redesigning the curve). The apart-smiling edge is the same form, taller, alone.

### 10.4 Landmarks
The pale field · the **crescent edges in arcs, all leaning toward the bead** · the **bead of light on its plinth** (+ `siege-bead-glow`) · the **taller separate smiling edge** · the **table with the whole field in miniature (4 × 9)** · the **line of 9 cups, no two the same size**, full of thin morning light · the **cord with its last knot untied** · the **blur** (edgeless pale smear) · the **far ghost ranks** · `siege-first-light`.

### 10.5 Material palette
Pale on pale, disciplined: edges in pale luminous mineral (off-white with a morning tint, slight emissive at the crescent's inner curve), field ground a shade darker pale so the edges read, the bead the one true bright (warm-white morning light), cups in varied plain materials (their difference is *size*, not ornament), plinth/table/cord in muted kept tones. The ghost ranks: the same edge material at far-distance faintness — same form, less presence. No saturated colour anywhere; morning thinness is the palette.

### 10.6 Lighting & Atmosphere
Thin morning light: one low, pale directional (early light, long faint shadows), high pale ambience, no fog banks — distance faintness for the ghost ranks is handled by material/LOD treatment, *not* by a fog that would soften the field's edges into a verdict about its size. The blur is a translucent additive smear (planes), edgeless by construction. Reduced-motion: the bead's glow is steady.

### 10.7 Assets — reuse vs new
- **Reuse as-is:** the procedural edge-field layout (arcs, positions, lean, cup sizes) as authority.
- **New in Blender:** the crescent edge hero form + its instancing set, the bead + plinth, the miniature-field table (a tiny second build of the same composition at 4 × 9 — built from the same edge form at miniature scale), cups (9 unique sizes from one form family), the blur treatment, ghost-rank LOD forms (same silhouette, minimal geometry).

### 10.8 Named anchor hierarchy (carried exactly)
Canonical SIEGE_HOLDERS: `siege-edges`, `siege-smile`, `siege-line`, `siege-first-light`, `siege-small`, `siege-vast`, `siege-blur`, `siege-cord`. Scene holders: `siege-ground`, `siege-edge-marks`, `siege-ghost-marks`, `siege-cup-lights`, `siege-bead-glow`.
**Placement-critical:** `siege-edges` is one holder for the whole arc system (spots anchor to it ×2) — instancing lives *inside* the holder; `siege-smile` stays a separate single holder apart at (−270, 250); `siege-small` (the table) and `siege-vast` must both survive as distinct holders — merging either into the field would visually settle the small/vast disagreement (§10.10). The bead itself has no canonical holder name in the list (its glow is `siege-bead-glow`) — do not invent a `siege-bead` anchor; the plinth/bead geometry rides under the existing holders as built.
**Totals carried: 8 canonical + 5 scene holders = 13.**

### 10.9 Mobile performance plan
**No stated budget exists for the Siege** (Stage A §10.7/§17.4). **PROPOSED budget (for owner ratification): { drawCalls 90, visibleTris 500,000 }** — at Scale's level, justified by the 1300-radius field and the edge count: edges are one instanced form (1–2 draws for all arcs), ghost ranks a second cheaper instanced set (1–2), cups instanced-with-scale (1), miniature table a small merged set (2–3), blur additive planes (2), field 1. Textures: one 512 edge/field atlas; emissives untextured. **Flag:** no conflict at the PROPOSED level provided the edge form stays ≤ ~1,500 tris (instancing multiplies honesty: a heavier hero form is affordable *only* because it is drawn once as instances).

### 10.10 Mysteries protected (build rules)
**What the First Morning was defended from is never depicted** — no enemy, no weapon-forms, no damage, no scorch or ruin anywhere on the field; the edges face the bead, not an opponent. **Oru, his students, and any attacker are never shown** — no figures at all. The field is **never settled as small or vast**: the table (small), the blur (Oru's) and the far ranks (vast) are all built at full conviction and equal finish — no telling gets better materials, bigger scale emphasis, or the composition's "answer" position. **Oru's age is never indicated.** The cord's last knot stays **untied**. No text.

---

## 11. Unmade Hour (`the-unmade-hour`)

**Identity carried:** Seam S-I — the first Sixth Hour, before the second: a wide pale floor that keeps no marks of visitors. **Must never say why the hour was made twice.** The made who weren't kept are present only as the shape of where they were. Entry: story door once `sight.lullaby-hollow` is found.

### 11.1 Composition
The most restrained composition of the twelve: a wide pale floor (radius **620**) with almost nothing on it, arranged around an absence. Foreground: the floor itself, unmarked — the first thing the eye registers is that *nothing has left a trace here*. Middle ground: the low tally wall (arc at r **300**), the step at z=250, the mirror-sized frame at z=430. Centre: the **ring** (radius **150**) — and inside it, at the exact centre, the **worn standing place** with its small unlit lamp. Around the ring at r **95**, the **seven stone hands**, palms up — six holding small lights, the seventh holding nothing: the composition's still point, and the eye's final landing is the *empty* hand, precisely because it is the only hand without light. The held note at (260, −80) — a faint note of light — is the one off-centre accent.

### 11.2 Spatial layout
Floor radius 620 (`unmade-floor`). **Hollows** (`unmade-hollows`, `unmade-hollow-marks`) converge from every side and **stop at the ring** — none inside it; the hollows' stop-line is the ring's circumference, a layout law. Ring radius 150 (`unmade-ring`). Standing place at the centre (the world origin) (`unmade-standing`). Hands at r 95 (`unmade-hands`, lights `unmade-hand-lights`): six lit, **hand index 6 unlit**. The step (`unmade-step`, `unmade-step-line`) at z=250, height **3** — exactly one hand thick (the measured echo of the Deep Past's missing stratum). The frame (`unmade-frame`) at z=430, mirror-sized, **no glass**. The tally wall (`unmade-tally`) at r 300: finger-wide strokes in groups, **the last group open**. The seam (`unmade-seam`). The held note (`unmade-note`, `unmade-note-glow`) at (260, −80).

### 11.3 Architecture & terrain
Architecture reduced to instruments: the ring (a low precise circle), the step (one hand thick — its height is a measurement, not a proportion), the frame (a standing mirror-frame with **nothing in it**), the tally wall (low, arc-curved, stroke-cut), seven stone hands (the world's hero sculpt — palms up, stone, each a shallow holding form; the seventh identical in form, empty). Terrain: the floor — one vast pale disc whose finish is *unmarkedness*: no footprints, no wear paths, no visitor traces, anywhere, ever (the standing place's wear is the single exception, and it is at the centre, worn *smooth by standing*). Custom Blender work concentrates on the hands and the floor's material finish.

### 11.4 Landmarks
The wide pale floor · the hollows stopping at the ring · the ring · the **worn standing place + small unlit lamp** at the centre · the **seven stone hands, six lit, the seventh unlit** · the **step exactly one hand thick** · the **mirror-sized frame with no glass** · the **tally wall with its last group open** · the seam · the **held note** of faint light.

### 11.5 Material palette
Pale stone, two values only: floor pale (warm-grey white), hands/ring/step/frame/wall a half-shade deeper pale stone so forms read by value, not colour. The six hand-lights: small, warm, steady. The held note: faint light, barely a colour. The unlit lamp at the standing place: plain dark metal/glass, cold. No gold trim, no cyan, no saturation — this world's palette is the discipline of almost-nothing, distinct from the Siege's pale (which is morning-lit) by being *sourceless* (§11.6).

### 11.6 Lighting & atmosphere
Held, faint, sourceless light: a flat, even, low-contrast ambience with the faintest directional modelling so the hands and ring read as forms; no sky event, no dawn, no night — the hour before the second has no time of day. No fog (distance is not this world's device; emptiness is). The six lights and the held note are steady emissives. Shadows: minimal to none — marks are not kept here, and neither are strong shadows.

### 11.7 Assets — reuse vs new
- **Reuse as-is:** the procedural construction's layout (radii, the hollows' stop-line, hand positions, step height) as authority.
- **New in Blender:** the seven hands (hero sculpt — one hand form, seven placements; the seventh's emptiness is a *state*, not a different model), the floor finish, ring/step/frame/tally-wall forms. Nothing else exists to build — the brief forbids filling the floor (§11.10).

### 11.8 Named anchor hierarchy (carried exactly)
Canonical UNMADE_HOLDERS: `unmade-hollows`, `unmade-ring`, `unmade-standing`, `unmade-hands`, `unmade-frame`, `unmade-tally`, `unmade-seam`, `unmade-note`. Scene holders: `unmade-floor`, `unmade-step`, `unmade-step-line`, `unmade-hollow-marks`, `unmade-hand-lights`, `unmade-note-glow`.
**Placement-critical:** `unmade-hands` is one holder for all seven hands (spots anchor to it) — the unlit seventh (index 6) is distinguished *inside* the holder by `unmade-hand-lights` carrying only six lights; the rebuild must not split the seventh hand into its own holder or "balance" the ring's lighting. `unmade-standing` sits at the exact origin — the floor's centre mark and the world's reference. The step's height (3) is a factual dimension: export validation should measure it like an anchor.
**Totals carried: 8 canonical + 6 scene holders = 14.**

### 11.9 Mobile performance plan
**No stated budget exists for the Unmade Hour** (Stage A §11.7/§17.4). **PROPOSED budget (for owner ratification): { drawCalls 60, visibleTris 300,000 }** — mirroring Quiet/Archive (the other stillness world): floor 1–2 draws, hands instanced (1) + lights (1), ring/step/frame/wall merged per holder (4–6), hollows as floor-material treatment + marks (1–2), note 1. Textures: one 1024 pale-stone atlas for the whole world. **Flag:** no conflict — this is the cheapest world to build well, and the PROPOSED budget is headroom, not a target to spend.

### 11.10 Mysteries protected (build rules)
**Why the hour was made twice is never depicted or hinted** — no second ring, no doubled hands, no "first/second" visual pairing anywhere. The **seventh hand is never explained and never lit** — no glow, no marker, no difference in form; its emptiness is identical in treatment to the others' fullness. The floor **keeps no marks**: no footprints, paths, scuffs or visitor wear may be modelled or textured in — the standing place's smooth wear is the sole exception and belongs to standing, not visiting. The frame holds **no glass and no reflection** — never mirror it, never image it. The tally's last group stays **open** — strokes only, never digits, never "completed" by a closing stroke. The made who weren't kept are **never shown** — only the hollows' shapes, which stop at the ring. No figures.

---

## 12. Road to the Seam (`road-to-the-seam`)

**Identity carried:** Seam S-III — a long road under the Station that never ends in view: Teru's walk, marked stride by stride. **Must never say: where Teru ended.** Entry: story door once the Harbor Nail (`relic.harbor-nail`, Great Station) is found — the road's nails are the Harbor Nail's kin.

### 12.1 Composition
A perspective corridor like the Ward's, but open-roofed and earthen: foreground, the **road mouth** (`road-mouth`) under the Station; middle ground, the lane running straight between two rock walls (halfWidth **110**, walls at ±114, height **190**, z −120..2400) under an **open dark above with the shared sky**; the rhythm that carries the eye is the **lamps** — hung on both walls every **120** at y=64, even spacing, a dotted double line converging — answered on the right wall by the **nails every 26** (one to a stride, at height 50) and on the left by the **chalk at a child's height (16)**. Background: **fog** — the road continues past the last lamp and its **end never appears**. Two still counterpoints: the empty doorframe at z=560 and the Wardens' post with its worn bench at z=940.

### 12.2 Spatial layout
Lane z −120..2400 under `road-hall` (`road-floor`, `road-wall-left`, `road-wall-right`). Lamps (`road-lamps`, `road-lamp-cores`, `road-lamp-glows`) both walls, every 120, y=64 — **even spacing is a fact**: no lamp missing, no lamp added, to the last lamp. Nails (`road-nails`, `road-nail-heads`) right wall, every 26, height 50, the full run — a stride-count in iron. Chalk (`road-chalk`, `road-chalk-strokes`) low on the left wall at height 16, z 140→1300, where `road-chalk-end` marks where the chalk gives out; **the last chalk group is unfinished — one stroke short**. Doorframe (`road-doorframe`) at z=560: an empty frame, **no door**, hinges shining. Post (`road-post`) at z=940: empty, with the worn bench. `road-far`: past the last lamp, fog.

### 12.3 Architecture & terrain
Earthwork architecture: two long rock walls (custom sculpt — cut-rock faces with a tooled regularity low down where hands and lamps work, rougher above), the lane floor (packed road surface, worn along the walking line), lamp brackets + lamp forms (instanced kit), nail forms (one instanced form, hundreds of placements — the count comes from the spacing law, not from a decision), chalk as *material treatment* (stroke decals/painted texture bands on the left wall at height 16 — strokes only, §12.10), the doorframe (a standing frame with hinges, no door leaf — modelled absence), the post (a small roofed/standing post form + bench, worn). The Station's underside is present only as the mouth's context and the shared sky above — the road is *under* the Station; do not build the Station here.

### 12.4 Landmarks
The road mouth · the two rock walls + open dark above · the **lamps at even spacing** to the last lamp · the **nails at every stride** (right wall) · the **chalk strokes at a child's height** (left wall) + chalk end + **unfinished last group** · the **empty doorframe with shining hinges** · the **empty Wardens' post + worn bench** · `road-far` — the road past the last lamp, into fog.

### 12.5 Material palette
Cut rock in two tones (left/right walls share the family; variation painted), road surface in packed dark earth-stone, lamp glass/metal in warm amber light (cores/glows), nails in dark iron with pale heads (`road-nail-heads`) catching lamp light stride by stride, chalk in soft white strokes (the world's only white besides the sky's stars), doorframe wood/metal worn, hinges **bright-worn** (the shine is a fact — polished by use or by keeping), bench wood worn smooth. Sky: the shared indigo night of the Station above.

### 12.6 Lighting & atmosphere
Lamp-point rhythm: emissive lamp cores with baked light pools on the opposite wall/floor at each station of the rhythm; between lamps, the lane falls to rock-dark — the alternation *is* the lighting design. The chalk band sits mostly below lamp height, catching raking light. Fog: indigo-dark, tuned so that past the last lamp the lane dissolves before any end could resolve — the unending is a fog constant, as in the Ward. The doorframe's hinges glint from the nearest lamps (material, not effect).

### 12.7 Assets — reuse vs new
- **Reuse as-is:** the procedural road's layout constants (spacings 120/26, heights 64/50/16, z-positions 560/940, chalk run 140→1300) as unchangeable facts.
- **New in Blender:** wall sculpt (modular 120-unit bays keyed to the lamp rhythm, instanced with painted variation), lane floor, lamp kit, nail kit, chalk texture bands (authored strokes — drawn marks, never letterforms), doorframe + hinges, post + bench.

### 12.8 Named anchor hierarchy (carried exactly)
Canonical ROAD_HOLDERS: `road-mouth`, `road-lamps`, `road-nails`, `road-chalk`, `road-doorframe`, `road-post`, `road-chalk-end`, `road-far`. Scene holders: `road-hall`, `road-floor`, `road-wall-left`, `road-wall-right`, `road-lamp-cores`, `road-lamp-glows`, `road-nail-heads`, `road-chalk-strokes`.
**Placement-critical:** `road-lamps`, `road-nails`, `road-chalk` are *system* holders — spots anchor to the systems (and `road-far` ×2, `road-post` individually); instancing lives inside each holder, and the systems' bounding volumes must span their full built runs (lamps to the last lamp, nails the full stride run, chalk z 140→1300) or spot reach breaks. `road-chalk-end` is a distinct holder at the chalk's end — not the same node as the last chalk stroke. `road-far` stays at the fog end of a 2,520-long lane; do not shorten.
**Totals carried: 8 canonical + 8 scene holders = 16.**

### 12.9 Mobile performance plan
**No stated budget exists for the Road** (Stage A §12.7/§17.4). **PROPOSED budget (for owner ratification): { drawCalls 80, visibleTris 400,000 }** — in line with the Ward (the other long corridor world). Plan: walls as instanced 120-unit bays (2–3 draws total), lamps instanced cores + one glow draw, nails instanced (1 draw for the entire stride run), chalk as texture bands on the left-wall bays (0 extra draws), floor merged in long sections (2–3), doorframe/post bespoke (2–3). Textures: one 1024 rock/road atlas + the chalk band strip. Fog culls the far bays visually; geometry stays whole for anchor integrity. **Flag:** no conflict at the PROPOSED level; nail/lamp counts are spacing-law outputs (≈97 lamp positions, ≈97 nail-stride rows per the constants) and must never be thinned for performance — instancing already makes them nearly free.

### 12.10 Mysteries protected (build rules)
**The road's end never appears** — no terminus, no final wall, no seam-door at the end; fog + continuation past the last lamp, always. **Where Teru ended is never depicted** — no final nail, marker, grave-form or stopped-place; the nails simply continue at stride rhythm as far as the road is built. **Chalk is strokes, never letters or numbers** — authored marks must be unambiguously stroke-groups (like the tally's), reviewed at texture sign-off; the last group is **one stroke short, unfinished**, and is never completed. The doorframe holds **no door** and shows nothing through it that isn't the road itself. The Wardens' post is **empty** — no figure, no left-behind message, no text; the bench's wear is the only testimony. What the seam *is* is never shown.

---

## Part 13 — Great Station Pilot Build Plan (Stage C)

The pilot proves the whole pipeline on the one world that has both an exterior and an interior, a stated budget, and a licensing flag: **build the Great Station first, to §1 of this document, under the working basis wheel diameter 420 / ratio 35:1 (D-3 flagged, §1)**. Nothing in the pilot touches the app: exports are validated as files, and integration is a later, separately-authorized stage.

### 13.1 Blender scene organization
One `.blend`, two scene blocks (Exterior / Interior) sharing one material library and one texture set. Collections mirror the anchor hierarchy **exactly** — collection names = holder names, so the GLB node tree is the anchor tree:

```
STATION_EXTERIOR (scene)
  station-world/                      (root collection)
    station-rotating/                 (wheel assembly — see 13.2 step 2)
    witness-drydock-gantry/
    drydock-<key>/  dressing-<key>/
    annex-lunar-annex/  annex-colony-ring/  annex-station-stores/  annex-model-<key>/
    hero-ship/                        (REFERENCE ONLY — shipped GLB placed, not rebuilt)
    backdrop-lava/  backdrop-quaternius-planet-1/
    traffic-<key>/  docked-<key>/  docking-shuttle/  harbor-controller-ship/  witness-hauler/
    station-work-lights/  station-traffic-fallback/
    relic-mounts/                     (resting-place dressing only: lower-rim seam mount,
                                       harbour-edge mount — relic models themselves are NOT
                                       part of this export)
  REF_locked/                         (never exported: soumaya-ship.glb placement ref,
                                       space_station_3.glb silhouette ref)
STATION_INTERIOR (scene)
  station-interior/
    hangar-bay/  commission-board/  fleet-deck/  observation-deck/
    interior-bay-ship/ (reference placement)  interior-user-ship/
    interior-gate-lintel/  interior-gate-lights/  interior-rim-arc/
    interior-nav-markers/  interior-work-lights/  interior-light-strips/
    interior-<model.key>/  interior-floor-<space.id>/  interior-ceiling-<space.id>/
SHARED
  MAT_library  TEX_atlas (1024 hull atlas, 512 emissive strip)  CAMERAS_pilot
```

Rules: every exported mesh lives under exactly one anchor collection; no mesh is named for an anchor it doesn't belong to; `<key>`/`<space.id>` pattern collections are instantiated per real key from the layout data (annex keys: `lunar-annex`, `colony-ring`, `station-stores`; backdrop keys: `lava`, `quaternius-planet-1`).

### 13.2 Build order
1. **Blockout at true scale.** Origin at station centre; wheel radius 210; hero mooring at 228; gantry at [88, 20, 195]; witness drydock [105, 20, 177]; hauler [30, 10, 220]. Grey-box volumes for every anchor collection; verify bounding boxes against the inventory's measured facts (place radius ≈384 for `station-rotating`; gantry reach geometry) **before any detail**. Ship reference placed at 12-unit forward length — the 35:1 check is a screenshot, not a feeling.
2. **The wheel (hero build).** Rim as 48 instanced segments on one material + one 1024 atlas; beacon seats in the segment; a second instanced set for the 48 beacons (every 8th assigned the cyan material variant). Lower-rim arc receives the seam work: the first nail's seam dressing at the Harbor Nail mount and the **second seam** as a sealed, older-finish joint — modelled in this step while the rim is open, because it can never be retrofitted as an opening.
3. **Drydock complex.** Gantry (compact — its own holder, its own silhouette), cradle arms, berth volumes under `drydock-<key>`, dressing merged into `dressing-<key>`; the **berth-board** prop position beside the gantry reserved and dressed (12 slots, 11 lit emissive, 1 dark — blank faces only).
4. **Annexes.** Three clusters from the lunar/colony/station-stores kit sets, re-materialed to basalt/gunmetal; each cluster merged per holder (`annex-<key>` structure + `annex-model-<key>` where the layout distinguishes them). Two annex doors get the lore-spot dressing implied by §1.4 (a faded ticket's place; a locked room's door) — dressing only, no text, no interiors.
5. **Traffic & docked.** Quaternius/Kenney hulls placed per `traffic-<key>` / `docked-<key>` lanes; shuttle, controller ship, hauler; fallback holder populated. All re-materialed; no new hull designs.
6. **Backdrop.** Lava planet + Quaternius planet placed at ≈4,000 units on their holders; indigo gradient dome + fog colour matched to `0x0b1026`.
7. **Materials & light pass.** Shared library applied (basalt, gunmetal, amber emissive, cyan emissive — cyan audited: nav/beacons only); cold key directional; baked-feel ambient; **cyan audit** and **text audit** (no letterforms anywhere, nameplate blank) as named checklist items, not vibes.
8. **Interior blockout + build.** Four room sets as separate collections under `station-interior`: hangar bay with the ship floating at exact centre (reference hull), bay door lintel; commission board; fleet deck with `interior-<model.key>` hull dressing; observation deck with viewport lintel composed onto the wheel/planet view. Shared holders (`interior-rim-arc`, `interior-gate-lintel`, `interior-light-strips`, floors/ceilings per space) built once, instanced across rooms where the layout does.
9. **Preview renders** (§13.3) → owner review gate.
10. **Export + validation** (§13.4) only after the preview gate — the pilot's GLB is a validation artifact, not an integration.

### 13.3 The six required preview camera shots
Rendered from `CAMERAS_pilot`, at 16:9, painterly grade as §1.5–1.6; each shot is judged against §1.1's composition notes.
1. **Full exterior overview** — off-axis three-quarter view: whole 420 wheel in frame, drydock foreground-right, backdrop planet low in the background, traffic lanes giving parallax. *Checks: the wheel reads monumental; beacon circle is the first landing.*
2. **Ring and harbor close-up** — near the rim at beacon height: rim segments, beacons (amber + every-8th cyan), harbour traffic passing. *Checks: panel/atlas detail holds at close range; cyan discipline visible.*
3. **Drydock and ships** — from beyond the witness drydock looking back through the gantry: cradle, docked hulls, the berth-board beside the gantry (11 lit / 1 dark readable as a *kept* fact, not a glitch). *Checks: gantry stays a distinct compact silhouette.*
4. **Annexes** — along the annex cluster: the three clusters' distinct masses, doors, work lights; the two lore-dressed doors findable by eye without markers. *Checks: clusters distinct, no signage, no text.*
5. **Interior hangar** — from the bay door lintel: her ship floating in the exact centre of the bay, rim arc and light strips framing. *Checks: centred composition; the ship floats (clearance visible below the hull).*
6. **Interior observation deck** — through the viewport lintel: wheel arc + backdrop planet beyond, deck interior warm in the foreground frame. *Checks: the lintel frames the view as §1.1 specifies; interior warmth vs exterior indigo.*

### 13.4 Export & validation checklist (pilot)
**Export:** two GLBs (exterior, interior) from the anchor collections only (`REF_locked` excluded); Y-up/glTF conventions as the app expects; materials PBR from the shared library; textures embedded (1024 hull atlas + 512 emissive strip max).

**Validate — anchors:**
- [ ] Every holder name in §1.8 exists as a node in the exported tree, spelled exactly (diff the node list against the inventory list mechanically, not by eye).
- [ ] No extra top-level holders; no anchor dissolved into a neighbour (esp. `witness-drydock-gantry` kept compact/separate; `station-rotating` one node).
- [ ] Pattern holders present for every real key in the layout data (`annex-*`, `backdrop-*`, `drydock-*`, `dressing-*`, `traffic-*`, `docked-*`, `interior-*` families).

**Validate — bounding boxes & placement:**
- [ ] `station-rotating` bounds: centred on origin, radius ≈210 (diameter 420 ± tolerance), reproducing place radius ≈384 behaviour.
- [ ] `hero-ship` bounds: ship-sized, forward length 12, at mooring radius 228.
- [ ] Gantry at [88, 20, 195]; hauler [30, 10, 220]; backdrop holders at ≈4,000.
- [ ] Interior: ship centred in `hangar-bay` bounds; viewport lintel aligned to the exterior wheel view used in shot 6.
- [ ] Lower-rim seam present in the `station-rotating` geometry at the [0, −0.85, 0] spot offset zone — and **sealed** (visual inspection item, signed).

**Validate — budget & file:**
- [ ] Triangle count ≤ 500,000 exterior (internal target) and ≤ 500,000 interior; hard ceiling 750,000 exterior — report actuals.
- [ ] Draw-call estimate ≤ 72 exterior / ≤ 64 interior (count materials × meshes per holder; instanced sets counted once).
- [ ] File size reported against the current `space_station_3.glb` ≈3.99 MB baseline; **any excess over baseline is a flagged item for the owner, not a silent ship** (§1.9 conflict).
- [ ] Texture audit: no texture >1024; emissive strip ≤512; Kenney colormap dependency noted if any Kenney station geometry is repacked.

**Validate — mysteries & discipline:**
- [ ] Second seam sealed; nameplate blank (render shot 3/5 inspected at zoom).
- [ ] Berth-board: 12 slots, 11 lit, no text/numbers.
- [ ] Cyan appears only on nav/beacon elements (material audit list).
- [ ] Zero text/letterforms in any texture or geometry (full-atlas eyeball pass, signed).

### 13.5 Pilot exit criteria
The pilot is done when: blockout scale checks pass (step 1), the six renders exist and are owner-reviewed, and the §13.4 checklist is run with actuals recorded. The remaining eleven worlds then proceed in the inventory's dependency order (garden → deep past → people → quiet → scale → seam worlds → eternity **surround only**), each repeating this pattern: blockout against its brief's placement-critical anchors, build, budget actuals, mysteries checklist.

---

## Appendix — Open items & flagged conflicts register (nothing below is resolved by this document)

**Discrepancies carried (Stage A §15):** D-1 missing relic lore-ground docs (§0.3 G-1) · D-2 Deep Past holder names, spec vs scene — briefs follow the scene (§3) · **D-3 Station size 420 vs 879 — working basis 420, owner to rule (§1)** · D-4 Draft 5 lock status (G-2) · D-5 Eternity Bible prose vs no-face canon — briefs follow the owner's model canon (§7) · D-6 relic name split, registry vs canon prose — briefs use registry names (G-3) · D-7 Scale relics `discoverable: false` under stale comments (G-4) · D-8 spots spec §9 vs station scene contents (§1) · D-9 missing autonomy/world design notes (G-5).

**Budget flags:** PROPOSED budgets awaiting owner ratification — Eternity {40 draws / 350k tris} (§7.9), Faded Ward {80 / 400k} (§8.9), Village {80 / 400k} (§9.9), Siege {90 / 500k} (§10.9), Unmade Hour {60 / 300k} (§11.9), Road to the Seam {80 / 400k} (§12.9). Deep Past draw-call design target ≤60 is an analogy, not a stated budget (§3.9).

**Art-vs-budget / weight conflicts flagged, not designed down:** Great Station hero-wheel texture ambition vs the 4 MB / 21.9 MB first-visit weight (§1.9) · Deep Past spire at 41% of the world tri budget + 2.62 MB supernova slim (§3.9) · Eternity's locked figure at 222k tris = 63% of its proposed ceiling (§7.9) · Scale's NASA download weight under the standing no-slimming owner order (§6.9) · the 15 relic models' ≈30 MB aggregate (G-7, owner decision only).

**Standing owner orders respected throughout:** GLB slimming cancelled (2026-10-30) — no brief slims a working model · hero ship CC-BY-NC must be replaced with the in-repo CC-BY-4.0 `organic-spaceship.glb` before any commercial use (§1.7) · Deep Past is private-only (§3) · Eternity's figure is never redesigned (§7) · Scale keeps true black and no fog (§6) · integration of any pilot output is a separate authorized stage (Part 13).

*End of Stage B briefs.*
