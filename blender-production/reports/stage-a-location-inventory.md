# Stage A — Complete Location Inventory
## Soumaya World Environment Reconstruction

**Prepared:** 2026-10-31 (Stage A reconnaissance, read-only)
**Source of truth:** repository `abelsvj-afk/Brain-Soumaya-V1`, branch `main`, read at `origin/main` = `265b6422b1c6ec28d48a0112ce1f2664e68570d5`. Every citation below is a path in that repo at that ref, read via `git show origin/main:<path>` / `git ls-tree`. No repo files were modified; no worktree or checkout was created.
**Purpose:** the factual foundation for the Stage B visual translation briefs. Every location, landmark, named anchor, scale fact and budget below is taken from the repo's locked lore, specs, or shipping code. Where documents disagree, the disagreement is recorded in §15 and **not** resolved.

---

## 0. Cross-cutting facts (all worlds)

### 0.1 The twelve worlds and their registry identities
World keys, chart positions and gates — `packages/shared/src/worlds.ts` (`WORLD_COORDS`, gate constants):

| World (display) | World key | Chart (x, y) | Gate / entry condition |
|---|---|---|---|
| Great Station | `great-station` | 760, 250 | Open (home harbour) |
| Growing Place | `growing-place` | 250, 480 | Open |
| Deep Past | `deep-past` | 300, 180 | Open |
| People | `people` | 845, 335 | Content gate: ≥3 people, ≥2 memories each, ≥1 shared memory (`PEOPLE_GATE_MIN_PEOPLE = 3`, `PEOPLE_GATE_MIN_MEMORIES_EACH = 2`, `PEOPLE_GATE_MIN_SHARED_MEMORIES = 1`) |
| Quiet/Archive | `quiet-archive` | 130, 620 | Open |
| Scale | `scale` | 850, 620 | Open |
| Eternity | `eternity` | 905, 505 | **The Gate:** holding the relic `witness-without-a-name` (the Witness Without a Name) plus any **2** other relics (`ETERNITY_GATE_KEY_RELIC`, `ETERNITY_GATE_OTHER_RELICS = 2`); permanent once opened; reached via a 3-leg chain with 2 intermediate stops (`ETERNITY_CHAIN_LEGS = 3`) |
| Faded Ward | `faded-ward` | 900, 420 | Story door: opens once the People-world spot `sight.tamsins-ward` has been found (`FADED_WARD_GATE_ENTRY`) |
| Road to the Seam | `road-to-the-seam` | 700, 120 | Story door: opens once the relic `harbor-nail` (Harbor Nail) is found (`ROAD_GATE_ENTRY = "relic.harbor-nail"`) |
| Village | `the-village` | 240, 300 | Story door: opens once the relic `thread-of-many` (Thread of Many) is found (`VILLAGE_GATE_ENTRY = "relic.thread-of-many"`) |
| Unmade Hour | `the-unmade-hour` | 110, 420 | Story door: opens once the spot `sight.lullaby-hollow` has been found (`UNMADE_GATE_ENTRY = "sight.lullaby-hollow"`) |
| Siege of the First Light | `the-siege` | 330, 40 | Story door: opens once the object `obj.orus-bead` (Oru's Bead, Deep Past) is found (`SIEGE_GATE_ENTRY = "obj.orus-bead"`) |

Travel: warp cost = ⌈chart distance / 45⌉ fuel, minimum 2 (`WARP_UNITS_PER_FUEL = 45`, `WARP_COST_MIN = 2`, `packages/shared/src/worlds.ts`). Drift and the warp home are free (seam specs, e.g. `docs/specs/seam-road-to-the-seam-2026-10-31.md`).

### 0.2 The anchor system (how places are named and found)
- **Fly-to places** are discovered from named scene holders: `packages/web/src/graph/worldPlaces.ts` holds `PLACE_RULES` per world — regex patterns matched against holder names in the built scene, with `MIN_PLACE_RADIUS = 4` and `MAX_PLACES = 8` per world. A place whose model has not loaded does not exist (fail-closed).
- **Lore spots** (Regard/Listen) anchor to the same holders: `packages/shared/src/storyTriggers.ts` gives each trigger a `spot.place` naming an existing `PLACE_RULES` pattern (`docs/specs/lore-physical-spots-2026-10-31.md` §3). Spots are hidden — no marker, no glow, no list.
- **Place passages** (inspectable lore text) are keyed to holder-name regexes in `packages/shared/src/placeLore.ts` (~65 passages).
- **Story props** anchor to the same holders by name (`packages/web/src/graph/worldProps.ts`, per `docs/specs/world-props-2026-10-31.md`).
- **Relics** stand in scenes under holder names `relic-<def.id>` and `relic-glow-<def.id>`; the relic registry (id, name, world, resting place) is `packages/shared/src/relics.ts` — the single source of truth for all 15 relics.
- **The warp gate** visual (home galaxy and world entries) is built by `packages/web/src/graph/gateScene.ts`: model `/warp-gate.glb`, `GATE_RADIUS = 60`, 24 beads; holder names `gate-ring`, `gate-disc`, `gate-beads`, `gate-model`. The same module builds Scale's survey frame (`gate-scale-survey-frame`, `survey-frame-top/bottom/left/right`, `survey-frame-beacons`, 4 beacons).

### 0.3 Global visual identity (locked)
- **Style:** "mythic space-fantasy concept art, painterly cinematic realism, soft volumetric light, deep indigo-black space with warm gold and pale cyan accents, restrained palette, heavy atmosphere, large sense of scale, no text, no logos, no UI, no watermarks, no real-world religious symbols" (`docs/lore/IMAGE_PROMPTS.md`, global style block, included in every prompt).
- **Continuity authority:** `docs/lore/CONTINUITY_BIBLE.md` (identities, ships, canon rules) and `docs/lore/LORE_CANON.md` (lock status). Drafts 1–4 LOCKED by the owner 2026-10-30; Draft 7 LOCKED 2026-10-31 ("nothing dies, things rest"); Drafts 5, 6, 8, 9 proposed/structure (see discrepancy D-4, §15).
- **The Hush** (the threat in the lore) is a pale grey mist with a soft advance — not an army, not fire-smoke (`docs/lore/CONTINUITY_BIBLE.md`).
- **No faces** for: the Unnamed, the Companion, the Follower, the player (`docs/lore/LORE_CANON.md`). The player is the sixteenth witness: hooded, seen from behind, no face, no gender shown.
- **Ships:** each Firstborn flies exactly one ship — Dawnward (Oru), Plumb (Sethane), Latch (Calend), Slow Bloom (Maren), Ember Ark (Nuaré), Lullaby (Vesh, they/them, with a clean circular hollow in the hull, no gore). Soumaya's own ship is the seventh hull, with a blank rectangular nameplate that is never painted (`docs/lore/CONTINUITY_BIBLE.md`).
- **Wordless rule:** story props and chalk/tally marks carry **no text anywhere** — tags, pages and boards are blank; chalk is strokes, never letters or numbers (`docs/specs/world-props-2026-10-31.md`; seam specs).
- **Reference art:** `docs/lore/art/` holds ~156 canon paintings (PNG), including the eleven "keepers" `lore-01-first-morning` … `lore-11-witness-shore` (`docs/lore/CONTINUITY_BIBLE.md` §10) and Eternity references `03-eternity-v1.png`, `03-eternity-v2.png`, `eternity-reference-1.png` … `eternity-reference-4.png`.

### 0.4 The fifteen relics (registry of record — `packages/shared/src/relics.ts`)
Slim display models ship as `/relics/<slug>-slim.glb` (≈14.3k–22.5k tris each; files 1.56–4.51 MB — heavy for their tri count, see §14). Resting places:

| Relic | World | Resting place (registry wording) |
|---|---|---|
| Harbor Nail | Great Station | the lower rim, at the ancient seam |
| Mooring Ring | Great Station | where harbor stone meets the open road |
| Dawn Leaf | Growing Place | the roots of the witness tree |
| Witness Seed | Growing Place | beneath the witness tree |
| First Light Shard | Deep Past | near the basin |
| Basin Stone | Deep Past | the basin floor |
| Lantern of Keeping | Deep Past | a lowest-stratum alcove above the basin |
| Witness Without a Name | Deep Past | the lowest stratum at the basin — **the Eternity gate key** |
| Hearth Ember | People | near the first hearths |
| Thread of Many | People | between the hearth stones |
| Star Hanger | Scale | (registry: `discoverable: false` — see discrepancy D-6) |
| Sunward Compass | Scale | (registry: `discoverable: false`) |
| Unnumbered Fragment | Scale | (registry: `discoverable: false`) |
| Stillness Seal | Quiet/Archive | the threshold of a quiet alcove |
| Unopened Fold | Quiet/Archive | kept unopened, at the field's heart |

Eternity's world holds **no** relic.

### 0.5 Story props (wordless, per world — `packages/web/src/graph/worldProps.ts`, `docs/specs/world-props-2026-10-31.md`)
Built procedurally in-app (≤3 meshes each, ≤12 per world), anchored to existing holders: **berth-board** beside the drydock gantry (11 of 12 slots lit — one berth missing) · **chalk-tally** at the Deep Past rim (7 strokes, last smudged) + **stair-ribbon** at the stair (a renewed ribbon) · **paper-boats** (5, all pointing the same direction) + **torn-hymnal** (one page cleanly torn out) at the Still Threshold · **table-one-more** (a table laid one place too many) + **button-jar** in the People field · **seed-stone** at the witness tree · **untied-cord** (last knot untied) at the ISS + **probe-notebook** at a probe in Scale · **sixteen-lamps** at Eternity's figure (15 lit in a ring + a 16th with wick but no flame). The Faded Ward holds its own props in-scene (spec: "props for the Ward (its scene already holds its own)" — not in this slice).

### 0.6 Performance ceilings that govern every world
Per-world budgets are stated in each world's layout module (cited per world below). The recipes also reference fixed global ceilings ("§11.2's fixed ceilings", `docs/worlds/recipe-scale.md` §4, `docs/worlds/recipe-quiet-archive.md` §4). First-visit download weight is already the tightest constraint: home ≈21.9 MB, each world +6–20 MB (`docs/specs/worlds-scale-lanes-2026-10-30.md` §1). Android budgets in the code must be respected; conflicts are to be reported, not silently redesigned.

---

## 1. Great Station (`great-station`)

### 1.1 Identity — what it is
The harbour of the world: where Soumaya's ship is kept, where journeys begin, and the hub every other world is reached from. In lore it is **Hour III — Arrival**: "The harbor of the Age of Doors. Calend set the **first nail** in the first seam where 'arrival became possible'; the harbor grew round the nail. The Wardens were founded here, and the Ledger's Drydock." The wrong thing: "a **second seam** on the lower rim, older than the nail and not made by Calend — sealed, never opened, hummed through in the night" (`docs/lore/DRAFT_3_THE_LONG_LORE.md` §3). Sources: `packages/web/src/graph/stationLayout.ts`, `packages/web/src/graph/stationScene.ts`, `packages/web/src/graph/stationInteriorLayout.ts`, `packages/web/src/graph/stationInteriorScene.ts`.

### 1.2 Locations and landmarks (exterior)
- **The rotating wheel/station body** — holder `station-rotating`. A rotating ring station: wheel radius **210**, diameter **420** (`STATION_LAYOUT.wheelRadius`, `packages/web/src/graph/stationLayout.ts`). Palette: hull basalt `0x2b2e35`, hull gunmetal `0x3d4149`, amber `0xffb454`, cyan `0x9fd8e8` (reserved as navigation truth), deep indigo `0x0b1026`. **48 rim beacons**, every 8th a cyan nav marker.
- **The drydock** — holders `witness-drydock-gantry` (gantry at [88, 20, 195]), `drydock-<key>` berths, `dressing-<key>` dock dressing. A witness drydock stands at [105, 20, 177]. The **berth-board** prop stands beside the gantry: 12 slots, 11 lit, **one berth missing** (§0.5).
- **The annexes** — holders `annex-<key>` and `annex-model-<key>`; cluster keys `lunar-annex`, `colony-ring`, `station-stores`. Two lore spots live in two different annexes (the faded ticket; Hesk's locked room) (`docs/specs/lore-physical-spots-2026-10-31.md` §9).
- **Her ship at its mooring** — holder `hero-ship`; hero mooring radius **228** from station centre. The hero ship's forward length is **12** units; station-to-ship scale ratio **35:1** (`STATION_SCALE_RATIO`).
- **Harbour traffic** — holders `traffic-<key>` (moving hulls), `docked-<key>` (docked ships), `docking-shuttle`, `harbor-controller-ship`, `witness-hauler` (hauler at [30, 10, 220]), fallback holder `station-traffic-fallback`, work lights `station-work-lights`.
- **Backdrop planets** — holders `backdrop-<planet.key>`; shipped keys include `lava` (Sketchfab lava planet, CC-BY 4.0) and `quaternius-planet-1`, hung ≈4,000 units out (`packages/web/public/CREDITS.md`).
- **The second seam (lower rim)** — not a separate holder: lore spots anchor to `station-rotating` with offset `[0, -0.85, 0]` (the lower rim) (`docs/specs/lore-physical-spots-2026-10-31.md` §§3, 9). The seam is sealed, never opened — a location that must read as *closed*.

### 1.3 Locations and landmarks (interior — `station-interior`)
Jump-between-rooms interior (no walking; owner-settled design). Root holder `station-interior`. Four rooms (`packages/web/src/graph/stationInteriorLayout.ts`):
- `hangar-bay` — "The Hangar Bay": her ship floating in the centre of the bay; holders `interior-bay-ship`, `interior-user-ship`, `interior-bay-door-lintel`.
- `commission-board` — "The Commission Board".
- `fleet-deck` — "The Fleet Deck".
- `observation-deck` — "The Observation Deck": holder `interior-deck-viewport-lintel`.
Shared interior holders: `interior-gate-lintel`, `interior-gate-lights`, `interior-rim-arc`, `interior-nav-markers`, `interior-work-lights`, `interior-light-strips`, `interior-<model.key>` (model keys include the fleet hulls), `interior-floor-<space.id>`, `interior-ceiling-<space.id>`.

### 1.4 Named anchors (exhaustive)
**PLACE_RULES (`worldPlaces.ts`):** `^station-rotating$`, `^witness-drydock-gantry$`, `^annex-`, `^hero-ship$`, `^backdrop-`.
**Scene holders (exterior):** `station-world` (root), `station-rotating`, `station-work-lights`, `station-traffic-fallback`, `witness-drydock-gantry`, `witness-hauler`, `annex-lunar-annex`, `annex-colony-ring`, `annex-station-stores`, `annex-model-<key>`, `hero-ship`, `backdrop-lava`, `backdrop-quaternius-planet-1` (pattern `backdrop-<planet.key>`), `docking-shuttle`, `harbor-controller-ship`, `traffic-<key>`, `docked-<key>`, `drydock-<key>`, `dressing-<key>`.
**Scene holders (interior):** `station-interior` (root), `hangar-bay`, `commission-board`, `fleet-deck`, `observation-deck`, `interior-bay-ship`, `interior-user-ship`, `interior-bay-door-lintel`, `interior-deck-viewport-lintel`, `interior-gate-lintel`, `interior-gate-lights`, `interior-rim-arc`, `interior-nav-markers`, `interior-work-lights`, `interior-light-strips`, `interior-<model.key>`, `interior-floor-<space.id>`, `interior-ceiling-<space.id>`.
**Story-spot anchors (`storyTriggers.ts` / spots spec §9):** `station-rotating` ×3 entries (second seam at lower rim; the Sleepwalker's lantern; the lane to nowhere — two different edges), `witness-drydock-gantry` ×4 (missing berth, tin soldier, blank nameplate + one), `annex-*` ×5 pattern uses (faded ticket, Hesk's locked room, others).
**Place-passage keys (`placeLore.ts`):** `^station-rotating$`, `^witness-drydock-gantry$`, `^annex-`, `^hero-ship$`, `^backdrop-lava$`, `^backdrop-quaternius-planet-1$`.
**Prop anchors:** berth-board → `witness-drydock-gantry`.
**Anchor count: 5 place rules; ≈37 distinct holder names/patterns (20 exterior + 17 interior).**

### 1.5 Must remain / lore-significant / never depict
- **Must remain:** the wheel at its 35:1 scale against the 12-unit ship; the drydock and its gantry; the three annexes; the hero mooring; the interior's four rooms with the ship floating in the hangar bay's centre.
- **Lore-significant:** the Harbor Nail's seam in the lower rim (relic resting place: "the lower rim, at the ancient seam"); the **second seam** — older than the nail, sealed; the **missing berth** (11 of 12 lit); the hero ship's **blank nameplate** (never painted); the Mooring Ring's resting place "where harbor stone meets the open road".
- **Never depict:** the second seam open; a name on the hero ship's nameplate; any text on the berth-board (slots are blank/lit only).

### 1.6 Reachability
Flight world: ship deploys, Fly-to tiles + tap-to-fly (`docs/specs/lore-physical-spots-2026-10-31.md` §§2, 6). Spots measured in a real browser: `station-rotating` place radius 384, spot reach ≈153–173; `witness-drydock-gantry` radius 7, reach 60 (minimum); `annex-*` radius 30, reach 60 (spots spec §9). The interior is a separate surface reached from the Station (room list, jump navigation).

### 1.7 GLB assets in use
- `soumaya-ship.glb` (2,364,720 B; 37,026 tris; the hero — **CC-BY-NC, non-commercial only**, 3DHaupt "Intergalactic Spaceship Version 2"; forward length 13.53 in file, scaled to 12 in-app) — `docs/worlds/p2-6-provenance-inventory.md`. **Replace candidate on licensing grounds only:** the verified CC-BY-4.0 fallback `organic-spaceship.glb` (ricksticky) already ships in the repo and must be used before any commercial use; the hull's *identity* (seventh hull, blank nameplate) must survive any replacement.
- `space_station_3.glb` (≈3.99 MB) — the station body source.
- Traffic/docked/dressing: Quaternius Ultimate Spaceships, 11 hulls, CC0 (`quaternius-bob/challenger/dispatcher/executioner/imperial/insurgent/omen/pancake/spitfire/striker/zenith.glb`, 748–8,292 tris each, 32,064 total); `wato-spaceship.glb` (3,616,288 B, 730 tris, CC-BY 3.0, XCVG — attribution required); Kenney Space Kit + Station Kit, CC0 (docked `kenney-space-craft_cargoA/B`, `craft_miner`, `craft_racer`; drydock `kenney-space-hangar_largeA`, platforms, structures; dressing containers/pipes/dishes) — full ledger in `docs/worlds/p2-6-provenance-inventory.md`. Kenney Station Kit GLBs reference an external `Textures/colormap.png` that must ship alongside them.
- Annex clusters: `lunar-*` set (29 files) and `colony-*` set (26 files) in `packages/web/public/`.
- **Reusable as-is:** all CC0 Kenney/Quaternius dressing and traffic (low tri counts, proven in budget). **Improve candidates:** `space_station_3.glb` (single 4 MB hero asset carrying the whole wheel) and the CC-BY-NC hero ship (licence, above).

### 1.8 Scale facts and budgets
Wheel radius 210 / diameter 420; ship length 12; ratio 35:1; hero mooring radius 228; 48 rim beacons. **Budget: `STATION_BUDGET { drawCalls 88, visibleTris 750,000 }`, internal targets { 72, 500,000 }** (`stationLayout.ts`). **Interior budget: { maxDrawCalls 64, maxTris 500,000 }** (`stationInteriorLayout.ts`). Note discrepancy D-3 (§15): `docs/specs/worlds-scale-lanes-2026-10-30.md` §1 says "the Station is 879 across (73× the ship)" — the layout's wheel is 420 across.

---

## 2. Growing Place (`growing-place`)

### 2.1 Identity — what it is
The garden of the player's Journeys: a terraced grove that grows from what they are working on, walked on foot (ship-as-walker) rather than flown. In lore it is **Hour IV — Patience**: "Six terraces and a witness tree. Maren's garden; the grove tradition. The wrong thing: **the witness tree has one dead bough** that grows leaves only for people who have kept a Journey through to its end; the bough points toward the hole. Secret: Maren is not gone — she is *tending something under the roots* (the Witness Seed)" (`docs/lore/DRAFT_3_THE_LONG_LORE.md` §3). Design of record: `docs/specs/growing-place-v2-2026-10-29.md` (owner-settled 2026-10-29). Sources: `packages/web/src/graph/gardenLayout.ts`, `packages/web/src/graph/gardenScene.ts`.

### 2.2 Locations and landmarks
- **Six terraces** — holders `terrace-<t>` and `terrace-riser-<t>`, t = 0..5; radii **[900, 780, 660, 540, 400, 250]**, heights **[0, 18, 36, 54, 72, 90]**; underside depth 60 (holders `garden-underside-cap`, `garden-underside-skirt`). The whole garden is ≈1,800 units across (`docs/specs/worlds-scale-lanes-2026-10-30.md` §1).
- **The witness tree** — holders `witness-tree`, `witness-halo`, at the garden's origin/crown. The garden's lore spots anchor to the **origin** (the tree), not to a place rule — the garden has **no PLACE_RULES entry** (`docs/specs/lore-physical-spots-2026-10-31.md` §3: `spot: { origin: true }`).
- **The grove** — holders `grove-trees`, `grove-trunks`, `grove-lawns`, `grove-flowers`, `grove-trails`, `grove-mist`, `grove-pulse`; grove radius 52 (crown/done radius 30). Completed journeys stand on the crown by the witness tree; journey signs `grove-sign-<journeyId>` and landmarks `landmark-<journeyId>` are generated per journey.
- **The meadow** — the lowest terrace; shows only the last 30 days of growth.
- **Journey plots** — holders `plots-gathering`, `plots-sprout`, `plots-stone`, `plots-wild`.
- **Seed pods** — holder `seed-pods` (the garden's game: Seed Pods, `docs/specs/growing-place-v2-2026-10-29.md`).
- **Paths** — holders `paths`, `lit-paths`; **vegetation** `vegetation`; **warm halos** `warm-halos`.
- **The walker** — holders `garden-avatar`, `garden-carried` (her ship walking the terraces).
- **Backdrop planets** — holders `backdrop-<planet.key>`; keys include `planets-set`, `quaternius-planet-2`, and the Sketchfab ice planet ("Ice planet with procedural textures", CC-BY 4.0) hung 4,000 units out (`packages/web/public/CREDITS.md`).

### 2.3 Named anchors (exhaustive)
**PLACE_RULES:** none (origin-based world — see §2.2).
**Scene holders:** `growing-place` (root), `witness-tree`, `witness-halo`, `terrace-0`…`terrace-5`, `terrace-riser-0`…`terrace-riser-5`, `grove-trees`, `grove-trunks`, `grove-lawns`, `grove-flowers`, `grove-trails`, `grove-mist`, `grove-pulse`, `grove-sign-<journeyId>`, `landmark-<journeyId>`, `plots-gathering`, `plots-sprout`, `plots-stone`, `plots-wild`, `seed-pods`, `paths`, `lit-paths`, `vegetation`, `warm-halos`, `garden-avatar`, `garden-carried`, `garden-underside-cap`, `garden-underside-skirt`, `backdrop-<planet.key>`.
**Story-spot anchors:** origin (witness tree) — all garden spots.
**Place-passage keys (`placeLore.ts`):** `^witness-tree$`, `^terrace-`, `^backdrop-` (incl. the ice planet and `planets-set`).
**Prop anchors:** seed-stone → `witness-tree`.
**Anchor count: 0 place rules; ≈27 distinct holder names/patterns.**

### 2.4 Must remain / lore-significant / never depict
- **Must remain:** six terraces at the stated radii/heights; the witness tree at the crown; the meadow as the lowest terrace; walking (not flying) as the movement mode.
- **Lore-significant:** the witness tree's **one dead bough** (leaves only for those who finished a Journey; points toward the hole); the **Witness Seed** beneath the tree (relic); the **Dawn Leaf** at the tree's roots (relic); the seed-stone prop at the tree.
- **Never depict:** Maren herself (she is "not gone" but is never shown — she tends under the roots); the bough leafed for anyone who has not finished a Journey.

### 2.5 Reachability
Walked world: tap-to-walk at 150 units/second (≈12 s edge to edge, `docs/specs/worlds-scale-lanes-2026-10-30.md` §1). All lore spots resolve at the witness-tree origin.

### 2.6 GLB assets in use
The garden is overwhelmingly procedural (terraces, grove, plots built in code). GLB use is limited to backdrop planets (`pp-*` planets set, `quaternius-planet-2`, the Sketchfab ice-planet GLB — per `packages/web/public/CREDITS.md` the lava/ice backdrop planets are "loaded as-is so their materials survive"). **Procedural-planets change (see §9.6):** `docs/specs/procedural-planets-eve-scale-2026-10-31.md` replaces toy planet models with shader planets while keeping holder names (`backdrop-<key>` unchanged).
**Reusable as-is:** the procedural terrace/grove construction. **Improve candidates:** none structural; backdrop toy models are already slated for shader replacement by the spec above.

### 2.7 Scale facts and budgets
Terrace radii 900→250, heights 0→90, underside depth 60; garden ≈1,800 across; walk speed 150 u/s. **Budget: { drawCalls 95, visibleTris 700,000 }** (`gardenLayout.ts`); the 95 draw-call ceiling is pinned by a test (`docs/specs/worlds-scale-lanes-2026-10-30.md` §1).

---

## 3. Deep Past (`deep-past`)

### 3.1 Identity — what it is
The oldest world: a descent through nine strata of deep time to the First Light basin. In lore it is **Hour I — the First Morning**: "Strata, a stair, a rim, and at the bottom the **First Light basin**. The oldest world, the first thing remembered. The wrong thing: the lowest stratum has **no layer for the Sixth Hour** — a clean absence between two strata, exactly one hand's-breadth thick. Secret: the basin does not reflect the sky above; it reflects the one *before* the hole" (`docs/lore/DRAFT_3_THE_LONG_LORE.md` §3). **Owner-settled: Deep Past is private-only** (never a public/shared world). Sources: `packages/web/src/graph/deepPastLayout.ts`, `packages/web/src/graph/deepPastScene.ts`, `packages/web/src/graph/deepPastAssets.ts`.

### 3.2 Locations and landmarks
- **The rim** — holder `place-rim`: the top edge, most recent stratum (stratum 0). The **chalk-tally** prop stands here (7 strokes, last smudged).
- **Nine strata** — strata 0 (rim, most recent) to 8 (oldest); radii **88 → 60**, heights **Y 0 → −144** in −18 steps; disc thickness 2.6. Holder `strata` (one group; see discrepancy D-2 about per-stratum names). **The missing sixth**: between two strata at the bottom there is a clean absence exactly one hand's-breadth thick — no layer for the Sixth Hour. This gap is a *location* and must read as a deliberate absence.
- **The stair** — holder `stair`: the descent; the **stair-ribbon** prop (a renewed ribbon) is tied here. Landings: `place-landing-deepest`, `place-landing-mid`, `place-landing-last`; shelf `place-shelf`.
- **The rise** — holders `rise-shelf` (at angle 5.35, radius 54, y = 9), `rise-columns`, `rise-glow`.
- **The basin** — holders `glb-basin`, `basin-floor`, `basin-rock`; basin at **Y −168, radius 66**. The basin holds the First Light: `glb-orb` (the first-light orb), `pool-glow`, `light-shaft-core`, `light-shaft-outer`. The basin reflects the sky *before* the hole, not the sky above.
- **The spire** — holders `glb-spire`, `glb-spire-glow` (the anchor spire).
- **The supernova remnant** — holder `glb-supernova`.
- **Alcoves** — holders `alcove-pads`, `alcove-ring-<i>`, `alcoves-gathering`, `alcoves-sprout`, `alcoves-stone`: niches in the strata; the lowest-stratum alcove above the basin holds the Lantern of Keeping.
- **Atmosphere/detail holders:** `hero-orbs`, `hero-orb-glow-<stratum>`, `memory-lanterns`, `marine-snow`, `motes`, `anchors`, `bead-rims`, `bead-shells`, `bead-interiors`, `gold-trims`, `thread-bright`, `thread-dim`.
- **Glide system** — holders `glide-column`, `glide-form`, `glide-pad-<id>` (the descent glide between strata).
- **Her ship** — holder `deep-past-ship`.
- **Oru's Bead** — found here (`obj.orus-bead`); it is the story-door key to the Siege.

### 3.3 Named anchors (exhaustive)
**PLACE_RULES (`worldPlaces.ts`):** `^glb-basin$`, `^glb-spire$`, `^glb-supernova$`, `^glb-orb$`, `^place-rim$`, `^place-shelf$`, `^place-landing-` (family).
**Scene holders:** `deep-past` (root), `glb-basin`, `glb-spire`, `glb-spire-glow`, `glb-supernova`, `glb-orb`, `place-rim`, `place-shelf`, `place-landing-deepest`, `place-landing-mid`, `place-landing-last`, `stair`, `strata`, `rise-shelf`, `rise-columns`, `rise-glow`, `basin-floor`, `basin-rock`, `alcove-pads`, `alcove-ring-<i>`, `alcoves-gathering`, `alcoves-sprout`, `alcoves-stone`, `hero-orbs`, `hero-orb-glow-<stratum>`, `memory-lanterns`, `marine-snow`, `motes`, `anchors`, `deep-past-ship`, `glide-column`, `glide-form`, `glide-pad-<id>`, `bead-rims`, `bead-shells`, `bead-interiors`, `gold-trims`, `thread-bright`, `thread-dim`, `light-shaft-core`, `light-shaft-outer`, `pool-glow`.
**Story-spot anchors:** `stair` (the ribbon), the rim/lower strata (the missing stratum) — see discrepancy D-2 on the names used in the spots spec's measurement table.
**Place-passage keys (`placeLore.ts`):** `^glb-basin$`, `^glb-spire$`, `^place-rim$`, `^stair$`, `^glb-orb$`, `^glb-supernova$`.
**Prop anchors:** chalk-tally → rim; stair-ribbon → `stair`.
**Anchor count: 6 place-rule patterns; ≈41 distinct holder names/patterns.**

### 3.4 Must remain / lore-significant / never depict
- **Must remain:** nine strata descending 0 → −144; the basin at −168; the stair with its three landings; the spire; private-only nature.
- **Lore-significant:** the **missing Sixth Hour layer** (a hand's-breadth clean absence — never fill it); the First Light orb and basin; the **Witness Without a Name** at the lowest stratum at the basin (the Eternity gate key — the Unnamed's only physical form; her face/name are never shown anywhere); the First Light Shard near the basin; the Basin Stone on the basin floor; the Lantern of Keeping in the lowest alcove; the chalk tally (7 strokes, last smudged — strokes only, never digits).
- **Never depict:** a sixth-hour layer; the Unnamed as a person; any explanation of the basin's wrong reflection.

### 3.5 Reachability
Flight world (Fly-to + tap-to-fly) plus the glide system for the descent. Spots spec §9 measured (one confirmed pass; the scene loads slowly in software rendering): rim spot reach ≈395, stair reach ≈352 — see D-2.

### 3.6 GLB assets in use (`deepPastAssets.ts` manifest)
- `first-light-basin-web-256.glb` (≈239 KB; basin, 22,500 tris).
- `sf-anchor-spire.glb` (≈2.02 MB; the spire, 80,210 tris).
- `sf-first-light-orb-slim.glb` (≈580 KB; the orb, 24,576 tris).
- `sf-supernova-remnant-slim.glb` (≈2.62 MB; the supernova — a slimmed derivative of the Aiekick point-cloud remnant, which at full size is 2,168,851 points / 0 triangles and cannot ship as-is, `packages/web/public/CREDITS.md`).
- `rim-web-256.glb` (≈228 KB), `descent-stair-web-256.glb` (≈169 KB), `stratum-terrace-web-256.glb` (≈233 KB), `stratum-lantern-web-256.glb` (≈95 KB).
**Reusable as-is:** the four `*-web-256` environment pieces (small, purpose-built). **Improve candidates:** `sf-anchor-spire.glb` (2 MB / 80k tris against a 195k world budget — the single heaviest item in this world) and the supernova slim (2.62 MB).

### 3.7 Scale facts and budgets
9 strata, radii 88→60, Y 0→−144 (−18 steps), disc thickness 2.6; basin Y −168, radius 66; rise shelf r=54 @ angle 5.35, y=9. **Budget: maxTris 195,000** (`deepPastLayout.ts`) — the tightest tri budget of any world.

---

## 4. People (`people`)

### 4.1 Identity — what it is
The world of the player's people: a field of hearths, one cluster per person in their life, joined by bridges of light. In lore it is **Hour V — Love**: "The hearths, ring on ring. Nuaré's warmth. The wrong thing: every hearth is laid for **one more than it holds** — one empty chair, always, in every home, and nobody remembers setting it. Secret: the Thread of Many runs through the stones *toward* the empty chairs" (`docs/lore/DRAFT_3_THE_LONG_LORE.md` §3). Design: `docs/worlds/recipe-people.md`. Sources: `packages/web/src/graph/peopleLayout.ts`, `packages/web/src/graph/peopleScene.ts`, `packages/web/src/graph/peopleAssets.ts`.

### 4.2 Locations and landmarks
- **The field** — holders `field-ground`, `field-ring`; field radius **560**. The field is the universal fallback anchor: three lore spots resolve to offsets on `field-ground` (the empty chair; Tamsin's ward; Kith's drawing) with reaches ≈212–297 (`docs/specs/lore-physical-spots-2026-10-31.md` §9).
- **Person clusters** — holder prefix `people-cluster-<id>`: one hearth-cluster per person. Inside a cluster (all procedural, instanced): **memory lights** (spheres r 2.2), **date rings** (r 3.4), **threads** (cones running between stones), **gathering rings** (r 4.5); holders `cluster-glows`, `cluster-hearths`.
- **Bridges** — holder `bridges`: light-bridges between clusters of people who share memories.
- **Ember motes** — holder `ember-motes` (atmosphere).
- **Dressing ships** — holder `dressing-ships` (ambient hulls at the field's edge).
- **Backdrop planets** — holders `backdrop-<planet.key>`; place lore names `earth-and-moon` and `quaternius-planet-3` (the latter 3,000+ units away — too far to serve as a spot anchor, spots spec §9).
- **Story props:** **table-one-more** (a table laid one place too many) and **button-jar**, anchored in the field (§0.5).
- **Tamsin's ward** is *in* this world as a spot (`sight.tamsins-ward`) — finding it opens the door to the Faded Ward world.

### 4.3 Named anchors (exhaustive)
**PLACE_RULES:** `^field-ground$`, `^bridges$`, `^people-cluster-` (family).
**Scene holders:** `people` (root), `field-ground`, `field-ring`, `bridges`, `cluster-glows`, `cluster-hearths`, `ember-motes`, `dressing-ships`, `people-cluster-<id>`, `person-light-<id>` (per-person light prefix used by `placeLore.ts`), `backdrop-<planet.key>`.
**Story-spot anchors:** `field-ground` ×8 pattern uses in `storyTriggers.ts` (the most-used spot anchor in the game).
**Place-passage keys (`placeLore.ts`):** `^field-ground$`, `^people-cluster-`, `^person-light-`, `^backdrop-earth-and-moon$`, `^backdrop-quaternius-planet-3$`.
**Prop anchors:** table-one-more, button-jar → field holders.
**Anchor count: 3 place-rule patterns; ≈10 distinct holder names/patterns (plus per-person generated instances).**

### 4.4 Must remain / lore-significant / never depict
- **Must remain:** one cluster per person, generated from the player's real people and memories (counts and contents are data-driven, never decorative filler); the bridges only where shared memories exist.
- **Lore-significant:** the **empty chair** at every hearth (one more place laid than held — the table-one-more prop); the **Thread of Many** running between the hearth stones toward the empty chairs (relic; also the Village's door key); the **Hearth Ember** near the first hearths (relic).
- **Never depict:** a person themselves at a hearth (the world shows lights, rings and threads — nobody is shown); a hearth with exactly the right number of chairs.

### 4.5 Reachability
Flight world (Fly-to + tap-to-fly). Content gate on entry (§0.1). Spots resolve to the field, clusters and lights.

### 4.6 GLB assets in use
`peopleAssets.ts` uses **no world GLBs** except backdrop planets — clusters, lights, rings, threads and hearths are procedural/instanced. **Reusable as-is:** the whole procedural system. **Improve candidates:** none identified in code; the world's visual richness is procedural, so a Blender rebuild should treat the *field, ring and bridge* composition as the environment and keep per-person elements data-driven.

### 4.7 Scale facts and budgets
Field radius 560; memory light r 2.2; date ring r 3.4; gathering ring r 4.5. **Budget: { drawCalls 80, visibleTris 400,000 }** (`peopleLayout.ts`).

---

## 5. Quiet/Archive (`quiet-archive`)

### 5.1 Identity — what it is
The world of rest: memories and journeys set down to rest — rest, not loss; nothing here is deleted or mourned as gone. In lore it is **Hour VI — made twice**: "the second making; Vesh's penance; rest-is-not-erasure. The wrong thing: one **alcove is open and empty** with an unopened letter inside. Secret: Vesh visits at the hour the Rending happened and *sets nothing down* — stands before the empty alcove for exactly the length of a lullaby" (`docs/lore/DRAFT_3_THE_LONG_LORE.md` §3). Design: `docs/worlds/quiet-archive-design-note.md` ("§1 The purpose — rest, not loss"; "§2 What it shows — and what it never shows"), `docs/worlds/recipe-quiet-archive.md`. Sources: `packages/web/src/graph/quietArchiveLayout.ts`, `packages/web/src/graph/quietArchiveScene.ts`.

### 5.2 Locations and landmarks
- **The Still Threshold** — holders `still-threshold`, `threshold-lintel`, `threshold-post-left`, `threshold-post-right`: the arrival gate of the world. Three lore spots anchor here (the alcove, the boat, the hymn; reach 64–110, `docs/specs/lore-physical-spots-2026-10-31.md` §9). The **paper-boats** (5, same direction) and **torn-hymnal** (one page cleanly torn out) props stand at the threshold.
- **The empty field** — holders `field-ground`, `field-ring`; empty-field radius **220**. Archive clusters (holder prefix `archive-cluster-<id>`) stand in the field at cluster spacing **90**, with `cluster-glows` and `cluster-lamps`.
- **Bridges** — holder `bridges`.
- **Still motes** — holder `still-motes` (atmosphere).
- **Alcoves:** the **Stillness Seal's alcove** — a threshold alcove by the arrival edge (angle 0.6, at radius 0.5–0.7 × field) where the Seal rests; **the open empty alcove** with the unopened letter inside (lore); **the Unopened Fold** at the field's heart, kept unopened (relic).
- **The Sputnik alcove** — holders `artifact-sputnik`, `artifact-sputnik-model`: a real-world artifact (Sputnik) resting in its own alcove by the arrival edge, off the threshold axis.
- **Backdrop** — holders `backdrop-<planet.key>` (keys include the pixel brown dwarf, `pp-*` set).

### 5.3 Named anchors (exhaustive)
**PLACE_RULES:** `^still-threshold$`, `^field-ground$`, `^bridges$` (family per `worldPlaces.ts`).
**Scene holders:** `quiet-archive` (root), `still-threshold`, `threshold-lintel`, `threshold-post-left`, `threshold-post-right`, `field-ground`, `field-ring`, `bridges`, `cluster-glows`, `cluster-lamps`, `still-motes`, `artifact-sputnik`, `artifact-sputnik-model`, `archive-cluster-<id>`, `backdrop-<planet.key>`.
**Story-spot anchors:** `still-threshold` ×4 pattern uses; `field-ground` (the hollow, the edge).
**Place-passage keys (`placeLore.ts`):** `^still-threshold$`, `^field-ground$`, `^artifact-sputnik$`, `^backdrop-` (incl. pixel brown dwarf).
**Prop anchors:** paper-boats, torn-hymnal → `still-threshold`.
**Anchor count: 3 place-rule patterns; ≈14 distinct holder names/patterns.**

### 5.4 Must remain / lore-significant / never depict
- **Must remain:** the threshold as the single arrival point; the field's emptiness (this world's spareness is its identity — clusters appear only from the player's real archived material); the Sputnik alcove.
- **Lore-significant:** the **open, empty alcove with the unopened letter**; the **Unopened Fold** at the heart — kept unopened, forever; the **Stillness Seal** at its threshold alcove; the torn hymnal's missing page (both Draft 5 and Draft 7 accounts of the tearing stand; nothing may state in plain words which of them tore it — owner ruling 2026-10-31).
- **Never depict:** the Fold opened; the letter read; anything here framed as death or deletion — "nothing dies, things rest" (Draft 7, locked).

### 5.5 Reachability
Flight world (Fly-to + tap-to-fly). Note: on an empty brain the scene has no archive layout to tap (spots spec §11) — the field builds from the player's data.

### 5.6 GLB assets in use
Minimal: the Sputnik model (`artifact-sputnik-model`) and backdrop planet GLBs; clusters, lamps and threshold are procedural. **Reusable as-is:** the procedural threshold/field. **Improve candidates:** none identified in code; as with People, a Blender rebuild should deliver the *threshold + field + alcove* architecture and keep clusters data-driven.

### 5.7 Scale facts and budgets
Empty-field radius 220; cluster spacing 90; Seal alcove at angle 0.6, radius 110–154 (0.5–0.7 × 220). **Budget: { drawCalls 60, visibleTris 300,000 }** (`quietArchiveLayout.ts`) — the smallest draw-call budget of any world.

---

## 6. Scale (`scale`)

### 6.1 Identity — what it is
The world of true size: real space hardware and the solar system at honest relative scale, built around the International Space Station. In lore it is **Hour II — Wonder**: "The ISS, the planets, the Sun at true size. Sethane's measure. The wrong thing: a **star that is not in any catalogue**, catalogued by Sethane alone, titled only 'the one that was hung for someone'. Secret: the Star Hanger (witness 11) hung it, and its light always arrives *late*" (`docs/lore/DRAFT_3_THE_LONG_LORE.md` §3; Draft 9 §5 confirms the planets' "true size" is true *within the scene's own fiction*, not real-world proportion). Design: `docs/worlds/recipe-scale.md`. Sources: `packages/web/src/graph/scaleLayout.ts`, `packages/web/src/graph/scaleScene.ts`, `packages/web/src/graph/scaleAssets.ts`.

**Scale has NO ordinary fog: true black + a true starfield** (recipe/mission rule) — space here is empty and exact, unlike the other worlds' atmosphere.

### 6.2 Locations and landmarks
Scale convention: **1 unit ≈ 1 metre** in the near field.
- **The ISS** — holders `iss-holder`, `iss`, `iss-fallback` (wireframe fallback with `iss-fallback-cross/panel/truss` sub-assemblies). Real truss span **109 units**; the model `ISS-A.glb` spans 37.77 units in file and is scaled by `SCALE_ISS_SCALE` to true span. Her ship (12 units) orbits at radius **320**, height 60.
- **The survey frame — "the gate that measures"** — holder `gate-scale-survey-frame` with `survey-frame-top/bottom/left/right` and `survey-frame-beacons` (4 beacons); positioned at [0, 0, 320], **130 wide × 50 high** (`scaleScene.ts`; built by `gateScene.ts` `buildSurveyFrame()`). Place lore: the frame hangs "beside her truss".
- **The docked capsule** — holder `docked-capsule`, at the frame.
- **The Moon** — holders `moon`, `moon-model`, with **moon outpost** slots `moon-outpost-<slot>` on its surface.
- **The planets** — holders `planet-<key>`; keys: `planet_earth`, `planet_mars`, `planet_jupiter`, `planet_saturn`, `quaternius-planet-1/2/3`, `planets-set`, `earth-and-moon`, `pixel-brown-dwarf`, `sun`, `stars`. Near-field layout sizes (stylised): Earth size 40 at (−220, 60, −260), Jupiter 55, Saturn 45, Mars 30. **Current presentation per `docs/specs/procedural-planets-eve-scale-2026-10-31.md`:** the toy low-poly/pixel bodies are replaced by shader planets and hung **4,400–7,600 units out, 650–2,000 across** (camera far plane 9,000), with invisible body shells at 1.6 radii so a planet grows as you close in but is never reached; holder names unchanged, layout data unchanged (directions preserved), the scene applies the far placement (`FAR_BODY` in `scaleScene.ts`).
- **The probes** — holders `probe-<slug>`: `kepler`, `pioneer-10`, `dawn`, `voyager` (real NASA models). The **probe-notebook** prop stands at a probe.
- **Satellite A** — holder `satellite-a`.
- **Encounters** — holders `encounter-<key>`: `hubble` (Hubble telescope), `pulsar`, `alien`, `astronaut`, `flexunit-ufo`, `ufo` — drifting objects met in the field.
- **Centerpieces** — holders `centerpiece-<key>`: `black-hole`, `sf-black-hole`, `pillars-1b` (Pillars of Creation), `g292` (NASA supernova remnant G292), `gas-cloud`, `planetary-nebula`.
- **The belt** — holders `belt-<key>`, `belt-piece-<key>`; pieces: `belt-strip`, `bennu` (asteroid Bennu), `asteroid-large`, `debris-pile`, `asteroid-toastie`, `rubble-rocks`.
- **Nebula planes** — holders `nebula-plane-<key>`: three Jattenalle nebula renders (CC-BY 3.0) as huge static backdrop planes far outside the orbit — "pictures of nebulas, not 3D nebulas" (`packages/web/public/CREDITS.md`).
- **The untied cord** — prop at the ISS: a cord with its **last knot untied** (§0.5). Story spot: "the cord" anchors to `iss-holder` (reach ≈102, spots spec §9). Story spot: "the hung star" anchors to any of six `planet-*` bodies (reach ≈60) — the uncatalogued star hung for someone.

### 6.3 Named anchors (exhaustive)
**PLACE_RULES:** `^iss-holder$`, `^moon$`, `^planet-` (family).
**Scene holders:** `scale` (root), `iss-holder`, `iss`, `iss-fallback`, `moon`, `moon-model`, `moon-outpost-<slot>`, `planet-<key>` (12 keys above), `probe-kepler`, `probe-pioneer-10`, `probe-dawn`, `probe-voyager`, `satellite-a`, `encounter-hubble`, `encounter-pulsar`, `encounter-alien`, `encounter-astronaut`, `encounter-flexunit-ufo`, `encounter-ufo`, `centerpiece-black-hole`, `centerpiece-sf-black-hole`, `centerpiece-pillars-1b`, `centerpiece-g292`, `centerpiece-gas-cloud`, `centerpiece-planetary-nebula`, `belt-<key>`, `belt-piece-belt-strip`, `belt-piece-bennu`, `belt-piece-asteroid-large`, `belt-piece-debris-pile`, `belt-piece-asteroid-toastie`, `belt-piece-rubble-rocks`, `nebula-plane-<key>`, `docked-capsule`, `gate-scale-survey-frame`, `survey-frame-top`, `survey-frame-bottom`, `survey-frame-left`, `survey-frame-right`, `survey-frame-beacons`.
**Story-spot anchors:** `iss-holder` (the cord), `planet-*` (the hung star).
**Place-passage keys (`placeLore.ts`):** `^iss-holder$`, `^iss$`, `^moon$`, `^planet-` (incl. earth/mars/jupiter/saturn), `^probe-`, `^encounter-`, `^centerpiece-`, `^belt-piece-`.
**Prop anchors:** untied-cord → `iss-holder`; probe-notebook → a `probe-*`.
**Anchor count: 3 place-rule patterns; ≈20 holder families (≈45 literal names with keys expanded).**

### 6.4 Must remain / lore-significant / never depict
- **Must remain:** the ISS at an honest 109-unit span against the 12-unit ship; the survey frame at the orbit point; true black, no fog; the Moon with its outpost slots; the four real probes.
- **Lore-significant:** the **uncatalogued star** ("the one that was hung for someone"; its light arrives late) — the Star Hanger relic belongs to this world; the **untied cord** at the ISS (last knot untied); the Sunward Compass and the Unnumbered Fragment (relics of this world, currently `discoverable: false` — D-6).
- **Never depict:** fog or haze softening the field; real-world-proportion claims beyond the scene's own fiction (planets are stylised sizes; EVE-style far bodies are unreachable by design — never let a visitor land on one).

### 6.5 Reachability
Flight world (Fly-to + tap-to-fly). Planets are Fly-to places; far shader bodies have body shells (stop at 1.6 radii) and widened lore reach (2.4 radii) per the procedural-planets spec.

### 6.6 GLB assets in use (`scaleAssets.ts` manifest; sizes pinned in code, ISS SHA-256 pinned)
- `ISS-A.glb` (39,708 B; 6,642 tris; NASA) — the station. **Keep as-is** (byte-pinned by the manifest).
- `nasa-probes/Dawn.glb` (927,020 B; 32,096 tris), `nasa-probes/Kepler-A.glb` (2,003,276 B; 9,042 tris), `nasa-probes/Pioneer10.glb` (2,049,840 B; 8,189 tris), `nasa-probes/Voyager-A.glb` (285,936 B; 29,911 tris) — NASA originals, **not slimmed** (owner order 2026-10-30: GLB slimming cancelled). Keep as-is.
- `nasa-g292.glb` (≈1.2 MB), `nasa-bennu.glb` (≈330 KB), `pp-hubble.glb` (≈1.18 MB), `blackhole.glb` (≈3.23 MB) + Sketchfab black hole, `dyson-sphere.glb` (≈1.46 MB) held in the wider sky set.
- Toy planet GLBs being retired by the procedural-planets spec: `lowpoly-planet_{earth,mars,jupiter,saturn}.glb` and the `pp-*` planet set — **replace candidates (already specced)**, replaced by shader planets, not by new models.
**Reusable as-is:** all NASA hardware. **Improve candidates:** the retired toy planets (specced replacement); `blackhole.glb` (3.23 MB, heaviest single sky asset).

### 6.7 Scale facts and budgets
1 unit ≈ 1 m near-field; ISS span 109; ship 12; orbit radius 320 @ height 60; relic display size 22; survey frame 130 × 50 at [0, 0, 320]; far bodies 4,400–7,600 units out, 650–2,000 across, shells at 1.6 radii. **Budget: { drawCalls 100, visibleTris 500,000 }** (`scaleLayout.ts`).

---

## 7. Eternity (`eternity`)

### 7.1 Identity — what it is
The Maker's world: a white void at cosmic scale where Eternity stands. In lore it is **Hour VII — the Standing**: "A white void. History: none; it was always. The wrong thing: **he does not look at one place**, and the place he does not look at is *always the same direction from every position you stand*, as though the hole moved with you. Secret: that direction is the way to the player's own hole" (`docs/lore/DRAFT_3_THE_LONG_LORE.md` §3). He is the Maker, male (he/him), was not created, nothing is above him; he has **no ship** — "he is where ships go" (`docs/lore/CONTINUITY_BIBLE.md`). Sources: `packages/web/src/graph/eternityLayout.ts`, `packages/web/src/graph/eternityScene.ts`, `packages/web/src/graph/eternityAssets.ts`.

### 7.2 ⚠ OWNER CONSTRAINT — the figure is never redesigned (binding)
**Record of the existing figure, exactly as found:**
- **Asset:** `man-god-halo.glb` (`packages/web/public/man-god-halo.glb`, 495,572 B, 222,118 tris) — **the owner's own upload; no third-party licence** (`packages/web/public/CREDITS.md`, relics/sky credits section; `eternityAssets.ts` key `man-god-halo`).
- **Form (owner canon, binding):** male, **bare-skinned, all white, no face, no hair, no body detail**, with a **thin golden ring (halo) behind his head**. In the model, body and halo are separate meshes split by the name "halo" (`eternityScene.ts`).
- **Scale in-app:** `GOD_SCALE = 170`; figure height **323 units** (`GOD_HEIGHT`). The visitor's orbit radius is **620**, height 60. The halo ring's centre sits at y ≈ 129 (god units), radius ≈ 41.
- **He never moves.** Eternity's autonomy allows gesture/reorder-light/wait only; "Sorrow and Warning are never autonomous" (`docs/specs/eternity-autonomy-2026-10-29.md`). Free flight was deliberately NOT built — "it would lose his 'he stays put' nature" (`docs/specs/lore-physical-spots-2026-10-31.md` §10).
- **The world around him may change; he may not.** There is no floor, temple or throne in his world, and no religious symbols (mission constraint + `docs/lore/IMAGE_PROMPTS.md` negative block).
- Recorded discrepancy D-5 (§15): `docs/lore/CONTINUITY_BIBLE.md` §0.1's prose describes him as "broad-shouldered… face serene and impossible to describe", while the owner's game-model canon is no face / no body detail; the Bible itself also states "never a clear face". The model of record is the no-face canon above.

### 7.3 Locations and landmarks (the world around him)
- **The figure** — holder `eternity-figure` at the centre; figure reference point [0, 70, 0] for the view-based spots.
- **The speech tablet** — holder `eternity-speech-tablet` at [0, 92, 48], size **150 × 75**: the floating tablet that carries his gesture lines.
- **The far shell** — holder `eternity-far`: a shell at radius **3,800–4,600** carrying **8 neon veils** and **4 liquid-dye clouds**.
- **The shield** — holder `eternity-shield`.
- **The comet** — holder `eternity-comet` (a galaxy drifter; Poly Pizza "Comet", CC-BY 3.0).
- **Motes** — holder `eternity-motes`: **500 motes**.
- **The visitor's ship** — holder `eternity-player-ship` (her ship, parked in orbit — it does not fly here).
- **Visitor hulls** — holders `eternity-visitor-<model.key>`: **12 visitor ship models** in orbit slots at radius **190–450**, heights **−110..190**.
- **The sixteen lamps** — prop anchored to `eternity-figure`: 15 lit in a ring + a 16th with a wick but **no flame** (§0.5).
- **The unlooked direction** — not a holder: a *view* condition. Eternity's lore spots are camera views, not landmarks (`docs/specs/lore-physical-spots-2026-10-31.md` §10): `sight.unlooked-direction` (camera on the far side from the arrival side, +z), `sight.long-room` (camera pulled beyond 1,100 units), `echo.eighth-bell` (camera brought in under 330 units). Camera zoom range 0.3–2.6 × the 620 orbit = 186–1,612 units.

### 7.4 Named anchors (exhaustive)
**PLACE_RULES:** none (no fly-to places; no ship movement).
**Scene holders:** `eternity-world` (root), `eternity-figure`, `eternity-speech-tablet`, `eternity-far`, `eternity-shield`, `eternity-comet`, `eternity-motes`, `eternity-player-ship`, `eternity-visitor-<model.key>` (12 keys).
**Story-spot anchors:** view-based (see §7.3), anchored to the figure at [0, 70, 0].
**Place-passage keys (`placeLore.ts`):** `^eternity-figure$` (incl. the sixteen-lamps passage).
**Prop anchors:** sixteen-lamps → `eternity-figure`.
**Anchor count: 0 place rules; 9 holder families.**

### 7.5 Must remain / lore-significant / never depict
- **Must remain:** the figure exactly as §7.2; the white void; the speech tablet; the orbit-only visit; his stillness.
- **Lore-significant:** the 16th lamp (wick, no flame); the direction he does not look (always the same direction from wherever you stand — the way to the player's own hole); the speech tablet as his only "voice" surface in-world.
- **Never depict:** a redesigned figure (any face, hair, clothing detail, feminine form); a floor, temple, throne or religious iconography; Eternity in a ship; Eternity moving from his place.

### 7.6 Reachability
Not a flight world: the visitor's camera orbits him (drag/pinch, zoom 186–1,612 units). Entry is through the Gate (Witness Without a Name + any 2 other relics, §0.1), via a 3-leg chain. His world holds no relic and no fly-to places.

### 7.7 GLB assets in use
- `man-god-halo.glb` — the figure. **Never replace, never remodel** (§7.2).
- 12 visitor hull GLBs via `eternity-visitor-<model.key>` (drawn from the shared ship sets — Quaternius/Kenney/lowpoly families in `packages/web/public/`).
- The comet GLB (Poly Pizza, CC-BY 3.0).
**Reusable as-is:** everything here; this world's rebuild scope is the *surround* (far shell, veils, clouds, motes, orbit dressing) only.

### 7.8 Scale facts and budgets
Figure height 323 (GOD_SCALE 170 on the source model); orbit radius 620 @ height 60; tablet 150 × 75 at [0, 92, 48]; far shell 3,800–4,600; visitor slots r 190–450, h −110..190; 500 motes. No draw-call/tri budget constant was found stated for Eternity in `eternityLayout.ts` during this pass (the figure alone is 222,118 tris) — flagged as an open item in §16.

---

## 8. Faded Ward (`faded-ward`)

### 8.1 Identity — what it is
A hospital ward that is a whole world: one long hall of narrow cots where the Hush "returns" people — the Faded, kept half-returned. Spec of record: `docs/specs/seam-faded-ward-2026-10-31.md` (Seam S-VII; Draft 7 §6: *the silence it opens:* Tamsin's half-returned · *a region:* a ward that is a whole world · *new cast:* the Faded in full, Ruel, Pip, Linnet · *adds:* how the Hush returns people · **must never say: whether they all return**). It is the saddest seam; it explains Kith, Tamsin and Hesk. Sources: `packages/web/src/graph/wardLayout.ts`, `packages/web/src/graph/wardScene.ts`.

### 8.2 Locations and landmarks
- **The hall** — holders `ward-hall`, `ward-floor`, `ward-wall-left`, `ward-wall-right`: a long hall, halfWidth **150**, running z **−160..2200**, height **150**; roof ribs `ward-roof-ribs`; steam `ward-steam`.
- **The cots** — holders `ward-cot-frames`, `ward-cot-mattresses`, `ward-cot-pillows`, `ward-sleepers`: narrow cots in two rows, spacing **44**, from z=90 to z=2100, heads at |x|=138. ≈66% of ordinary cots hold **faint sleepers** (seeded, still). Each cot is "a person kept, never a count".
- **Ruel's cot** — holder `ward-cot-ruel`: left side, cot index 3.
- **Linnet's cot** — holder `ward-cot-linnet`: right side, cot index 6 — **made up, and empty**.
- **The small bed** — holder `ward-small-bed`: right side, cot index 11 — holds **only a tin soldier** (Pip's bed; Pip is Hesk's son — never stated, only shown).
- **The hush-bowl** — holder `ward-bowl`.
- **The window** — holder `ward-window`: a high window of stars.
- **The hook** — holder `ward-hook` (the coat on the hook).
- **The door** — holder `ward-door` (the way in).
- **Lanterns** — holders `ward-lantern-cores`, `ward-lantern-glows`: ember lanterns every 4th cot at y=70.
- **The far end** — holder `ward-far`: the hall recedes past sight into fog; **the far end is never resolved**.

### 8.3 Named anchors (exhaustive)
**WARD_HOLDERS (the world's canonical holder list, `wardLayout.ts`):** `ward-door`, `ward-cot-ruel`, `ward-cot-linnet`, `ward-small-bed`, `ward-bowl`, `ward-window`, `ward-hook`, `ward-far`.
**Scene holders (additional):** `ward-hall`, `ward-floor`, `ward-wall-left`, `ward-wall-right`, `ward-cot-frames`, `ward-cot-mattresses`, `ward-cot-pillows`, `ward-sleepers`, `ward-lantern-cores`, `ward-lantern-glows`, `ward-roof-ribs`, `ward-steam`.
**PLACE_RULES:** the ward's eight canonical holders serve as its place rules.
**Story-spot anchors (`storyTriggers.ts`):** `ward-window` ×2, `ward-small-bed`, `ward-hook`, `ward-far`, `ward-door`, `ward-cot-ruel`, `ward-cot-linnet`, `ward-bowl`.
**Place-passage keys (`placeLore.ts`):** keyed to the WARD_HOLDERS names.
**Anchor count: 8 canonical holders + 12 scene holders = 20.**

### 8.4 Must remain / lore-significant / never depict
- **Must remain:** one endless hall of cots; ember lanterns; the high star window; fog swallowing the far end.
- **Lore-significant:** Ruel's cot; Linnet's **made-up empty** cot; the small bed with **only the tin soldier**; the hush-bowl; the coat on the hook; cots as people kept — **never a count**.
- **Never depict:** whether they all return; Pip named as Hesk's son (shown only, by the soldier); a resolved far end; the Faded as ghosts/monsters — they are people, half-returned.

### 8.5 Reachability
Flight world (Fly-to, tap-to-fly, spots "for free" per the seam spec). Entry: story door from the People world once `sight.tamsins-ward` is found there (§0.1); warp by chart distance; home warp free; the gate must not strand.

### 8.6 GLB assets in use
None identified — the ward is built procedurally in the manner of the Quiet/People scenes ("built like the Quiet/People scenes (named holders, flight places, spots)", seam spec §1). **Reusable as-is:** the procedural hall/cot construction. **Improve candidates:** a Blender rebuild supplies the hall architecture; cots/sleepers must stay data-consistent (seeded occupancy ≈66%).

### 8.7 Scale facts and budgets
Hall halfWidth 150 (300 wide), length z −160..2200 (2,360 long), height 150; cot spacing 44, z 90..2100 (≈46 cots per row); lanterns every 4th cot @ y=70. No explicit draw-call/tri budget constant was captured for the ward in this pass — see §16.

---

## 9. Village (`the-village`)

### 9.1 Identity — what it is
The village the Many-Handed left: a small hillside village at night where a count is kept at the gate of who stayed and who went. Spec of record: `docs/specs/seam-the-forty-second-2026-10-31.md` (Seam S-V, "The Forty-Second"; Draft 7 §6: *silence:* the one who turned back · *region:* the village the Many-Handed left · *cast:* the Forty-Second; Kith's line · *adds:* what staying costs · **must never say whether staying was right**). Sources: `packages/web/src/graph/villageLayout.ts`, `packages/web/src/graph/villageScene.ts`.

### 9.2 Locations and landmarks
- **The village ground and hill** — holders `village-ground`, `village-hill`: halfWidth **520**, z **−200..1500**.
- **The gate** — holder `village-gate` at z=−40: where a count is kept.
- **The square** — at z=360: the hearth square (holder `village-hearth`); no houses stand in the square or on the path.
- **The well** — holder `village-well` at z=330: a well with **two ropes**.
- **The houses** — holders `village-houses`, `village-roofs`, `village-windows`, `village-window-glows`: two loose rows of houses; **every window lit**.
- **The chair** — holder `village-chair` at z=700, facing the hill: a chair set outside one door.
- **The hooks** — holders `village-hooks`, `village-hook-heads`: a path of small gold hooks, z 440→1320 every 40, rising y 10→100.
- **The doorway** — holder `village-door` with `village-door-halo` at z=1420: a tall luminous doorway at the path's end. **Nothing beyond it is ever shown.**
- **The bread** — holder `village-bread` (a place passage anchor).
- **Ember** — holder `village-ember` (atmosphere).

### 9.3 Named anchors (exhaustive)
**VILLAGE_HOLDERS (`villageLayout.ts`):** `village-gate`, `village-windows`, `village-well`, `village-chair`, `village-hearth`, `village-hooks`, `village-door`, `village-bread`.
**Scene holders (additional):** `village-houses`, `village-roofs`, `village-ground`, `village-hill`, `village-ember`, `village-window-glows`, `village-door-halo`, `village-hook-heads`.
**Story-spot anchors:** `village-gate` ×2, `village-windows`, `village-well`, `village-hooks`, `village-hearth`, `village-door`, `village-chair`, `village-bread`.
**Place-passage keys (`placeLore.ts`):** keyed to the VILLAGE_HOLDERS names.
**Anchor count: 8 canonical holders + 8 scene holders = 16.**

### 9.4 Must remain / lore-significant / never depict
- **Must remain:** night; every window lit; the gate, square, well, chair, hook-path and doorway in their stated order along the path.
- **Lore-significant:** the **count at the gate** (kept, never shown as digits — the words "forty-one"/"forty-two" stay only where locked canon already uses them); the **chair outside the door** facing the hill; the **two ropes** on the well; the gold hooks rising toward the doorway.
- **Never depict:** whether staying (or going) was right; what is beyond the doorway; any figure; any count as digits; any text.

### 9.5 Reachability
Flight world (Fly-to, tap-to-fly, spots). Entry: story door once the Thread of Many is found (§0.1); the Keeper and Tamsin roam into it (seam spec).

### 9.6 GLB assets in use
None identified — procedural construction in the seam machinery style. **Reusable as-is:** procedural village. **Improve candidates:** houses/roofs are the natural Blender-rebuild subject; window-glow behaviour (every window lit, still under reduced motion) must be preserved.

### 9.7 Scale facts and budgets
halfWidth 520; length z −200..1500 (1,700); square z=360; gate z=−40; well z=330; chair z=700; hooks z 440→1320 step 40, y 10→100; doorway z=1420. No explicit budget constant captured for the village in this pass — see §16.

---

## 10. Siege of the First Light (`the-siege`)

### 10.1 Identity — what it is
The battlefield of the First Morning, kept as a field of pale edges: what was defended is never said; only *that it was kept* is shown. Spec of record: `docs/specs/seam-the-siege-2026-10-31.md` (Seam S-IV; Draft 7 §6: *silence:* Oru's blur · *region:* a battlefield made of pale edges · *cast:* Oru young; his army of students · *adds:* what the First Morning was defended from · **must never say Oru's real age** — and by the same discipline, never says what the Morning was defended from). Three tellers disagree and none is wrong: Oru remembers a blur of pale edges, **smiling**; Sethane measured it and says it was **small**; the Surveyor says it was **vast** and never happened. All three tellings are physically present in the scene and none is shown to be right. Sources: `packages/web/src/graph/siegeLayout.ts`, `packages/web/src/graph/siegeScene.ts`.

### 10.2 Locations and landmarks
- **The field** — holders `siege-ground`, `siege-line`: a broad pale field, radius **1300**.
- **The edges** — holder `siege-edges` (+ `siege-edge-marks`): crescent edges, **each the height of a person (30)**, curved like a half-closed smile, standing in concentric arcs r **300–700**, leaning toward the bead.
- **The bead** — at (0, −120): a small bead of light on its plinth; glow holder `siege-bead-glow`. The whole field leans toward it.
- **The smile** — holder `siege-smile` at (−270, 250): one taller edge standing apart, that smiles.
- **The table** — holder `siege-small` at (250, −60): a table holding **the whole field in miniature (4 × 9)** — Sethane's "small" telling.
- **The cups** — holder `siege-line` (the line of cups), glow holder `siege-cup-lights`: 9 cups on low stones at z=105, **no two the same size**, each full of thin morning light.
- **The cord** — at (−230, −190): a cord with its **last knot untied**.
- **The blur** — holder `siege-blur` at (170, 300): a smear of pale light with no edge — Oru's telling.
- **The vast / ghost ranks** — holders `siege-vast`, `siege-ghost-marks`: far faint ranks at r **760–1200** that keep their distance — the Surveyor's "vast" telling.
- **The first light** — holder `siege-first-light`.

### 10.3 Named anchors (exhaustive)
**SIEGE_HOLDERS (`siegeLayout.ts`):** `siege-edges`, `siege-smile`, `siege-line`, `siege-first-light`, `siege-small`, `siege-vast`, `siege-blur`, `siege-cord`.
**Scene holders (additional):** `siege-ground`, `siege-edge-marks`, `siege-ghost-marks`, `siege-cup-lights`, `siege-bead-glow`.
**Story-spot anchors:** `siege-edges` ×2, `siege-vast`, `siege-smile`, `siege-small`, `siege-line`, `siege-first-light`, `siege-cord`, `siege-blur`.
**Place-passage keys (`placeLore.ts`):** keyed to the SIEGE_HOLDERS names (8 passages per the seam spec).
**Anchor count: 8 canonical holders + 5 scene holders = 13.**

### 10.4 Must remain / lore-significant / never depict
- **Must remain:** the three disagreeing tellings present at once (blur / small table / far ranks); every edge leaning toward the bead; the cups all different sizes.
- **Lore-significant:** the bead (the field's centre of gravity); the smiling edge apart; the miniature field on the table (4 × 9); the untied last knot of the cord; Oru's Bead itself is the door key from the Deep Past.
- **Never depict:** Oru, any student, or any attacker; what the First Morning was defended from; Oru's age; the field settled as small **or** vast in fact; any text.

### 10.5 Reachability
Flight world (Fly-to, tap-to-fly, spots). Entry: story door once Oru's Bead (`obj.orus-bead`, Deep Past) is found (§0.1); chart (330, 40), worst warp leg 18 fuel (seam spec).

### 10.6 GLB assets in use
None identified — procedural (edges, cups, bead built in code). **Reusable as-is:** the procedural edge-field. **Improve candidates:** the crescent edges are the world's signature form and the natural Blender subject; their person-height (30) scale and lean toward the bead are fixed facts, not design choices.

### 10.7 Scale facts and budgets
Field radius 1300; edge height 30; edge arcs r 300–700; ghost ranks r 760–1200; bead at (0, −120); table (250, −60); smile (−270, 250); blur (170, 300); cord (−230, −190); 9 cups at z=105. No explicit budget constant captured for the Siege in this pass — see §16.

---

## 11. Unmade Hour (`the-unmade-hour`)

### 11.1 Identity — what it is
The first Sixth Hour, before the second: a wide pale floor that keeps no marks of visitors, where the hour was made twice — and why is never said. Spec of record: `docs/specs/seam-the-unmade-hour-2026-10-31.md` (Seam S-I; Draft 7 §6: *silence:* "the hour made twice" (the Sixth Hour) · *region:* the first Sixth Hour, before the second · *cast:* the first Mercy; the made who weren't kept · *adds:* what unmaking felt like from inside · **must never say why the hour was made twice**). Sources: `packages/web/src/graph/unmadeLayout.ts`, `packages/web/src/graph/unmadeScene.ts`.

### 11.2 Locations and landmarks
- **The floor** — holder `unmade-floor`: a wide pale floor, radius **620**, that keeps no marks of visitors.
- **The hollows** — holders `unmade-hollows`, `unmade-hollow-marks`: shallow hollows that come from every side and **stop at the ring** — none inside it. (The Lullaby's Hollow, the soft gap along Vesh's hull, echoes here; finding `sight.lullaby-hollow` opens this world's door.)
- **The ring** — holder `unmade-ring`: radius **150**.
- **The standing place** — holder `unmade-standing`: at the ring's centre (the world origin), one place **worn smooth by standing**, with a small unlit lamp.
- **The hands** — holders `unmade-hands`, `unmade-hand-lights`: **seven stone hands**, palms up, at radius **95**; six hold a small light; **the seventh (hand index 6) is the same hollow with nothing in it — UNLIT, and never explained**.
- **The step** — holders `unmade-step`, `unmade-step-line`: at z=250, height **3** — exactly one hand thick (the Deep Past's missing-stratum echo).
- **The frame** — holder `unmade-frame`: at z=430, the size of a mirror, **with no glass**.
- **The tally wall** — holder `unmade-tally`: a low wall at radius **300** (arc), cut with finger-wide strokes in groups, **the last group open** (unfinished). Strokes only — never digits.
- **The seam** — holder `unmade-seam`.
- **The held note** — holders `unmade-note`, `unmade-note-glow`: at (260, −80), a held note of faint light.

### 11.3 Named anchors (exhaustive)
**UNMADE_HOLDERS (`unmadeLayout.ts`):** `unmade-hollows`, `unmade-ring`, `unmade-standing`, `unmade-hands`, `unmade-frame`, `unmade-tally`, `unmade-seam`, `unmade-note`.
**Scene holders (additional):** `unmade-floor`, `unmade-step`, `unmade-step-line`, `unmade-hollow-marks`, `unmade-hand-lights`, `unmade-note-glow`.
**Story-spot anchors:** `unmade-hollows` ×2, `unmade-tally`, `unmade-standing`, `unmade-seam`, `unmade-ring`, `unmade-note`, `unmade-hands`, `unmade-frame`.
**Place-passage keys (`placeLore.ts`):** keyed to the UNMADE_HOLDERS names (8 passages per the seam spec).
**Anchor count: 8 canonical holders + 6 scene holders = 14.**

### 11.4 Must remain / lore-significant / never depict
- **Must remain:** the floor that keeps no marks; hollows stopping at the ring; the worn standing place at the exact centre; the step exactly one hand thick.
- **Lore-significant:** the **seventh hand, unlit**; the tally's **last group left open**; the mirror-sized frame **with no glass**; the held note.
- **Never depict:** why the hour was made twice; the made who were not kept (only the shape of where they were); any explanation of the seventh hand; any figure; any digits.

### 11.5 Reachability
Flight world (Fly-to, tap-to-fly, spots). Entry: story door once `sight.lullaby-hollow` is found (§0.1); chart (110, 420), worst warp leg 19 fuel (seam spec).

### 11.6 GLB assets in use
None identified — procedural. **Reusable as-is:** the procedural floor/hands/frame construction. **Improve candidates:** the seven stone hands are the signature form for a Blender rebuild; six-lit/one-unlit is a fixed fact.

### 11.7 Scale facts and budgets
Floor radius 620; ring radius 150; hands at r 95; step z=250, h=3; frame z=430; tally wall r 300; note at (260, −80). No explicit budget constant captured for the Unmade Hour in this pass — see §16.

---

## 12. Road to the Seam (`road-to-the-seam`)

### 12.1 Identity — what it is
A long road under the Station that never ends in view: Teru's walk, marked stride by stride. Spec of record: `docs/specs/seam-road-to-the-seam-2026-10-31.md` (Seam S-III; Draft 7 §6: *silence:* Teru's walk · *region:* a long road under the Station · *cast:* Teru, Mara as a girl, the first Wardens · *adds:* what "someone who isn't here" meant · **must never say: where Teru ended**). Sources: `packages/web/src/graph/roadLayout.ts`, `packages/web/src/graph/roadScene.ts`.

### 12.2 Locations and landmarks
- **The road/hall** — holders `road-hall`, `road-floor`, `road-wall-left`, `road-wall-right`: a flat lane between two rock walls; halfWidth **110** (walls at ±114), z **−120..2400**, wall height **190**; an open dark above with the shared sky.
- **The mouth** — holder `road-mouth`: the road's entrance (under the Station).
- **The lamps** — holders `road-lamps`, `road-lamp-cores`, `road-lamp-glows`: lamps hung on **both walls every 120**, at y=64, at even spacing.
- **The nails** — holders `road-nails`, `road-nail-heads`: nails set in the **right wall every 26**, at height 50 — one to a stride. (Teru's nail is the Harbor Nail's kin; finding the Harbor Nail relic opens this world's door.)
- **The chalk** — holders `road-chalk`, `road-chalk-strokes`: chalk marks **low on the left wall at a child's height (16)**, z 140→1300; the **last group is unfinished — one stroke short**. Strokes only, never letters or numbers.
- **The doorframe** — holder `road-doorframe` at z=560: an empty door-frame with **no door**; its hinges shine.
- **The Wardens' post** — holder `road-post` at z=940: an empty post with a **worn bench**.
- **The chalk end** — holder `road-chalk-end`: where the chalk gives out.
- **The far** — holder `road-far`: the road continues **past the last lamp into fog — the end is never shown**.

### 12.3 Named anchors (exhaustive)
**ROAD_HOLDERS (`roadLayout.ts`):** `road-mouth`, `road-lamps`, `road-nails`, `road-chalk`, `road-doorframe`, `road-post`, `road-chalk-end`, `road-far`.
**Scene holders (additional):** `road-hall`, `road-floor`, `road-wall-left`, `road-wall-right`, `road-lamp-cores`, `road-lamp-glows`, `road-nail-heads`, `road-chalk-strokes`.
**Story-spot anchors:** `road-far` ×2, `road-post` (+ the remaining ROAD_HOLDERS across `storyTriggers.ts`).
**Place-passage keys (`placeLore.ts`):** keyed to the ROAD_HOLDERS names.
**Anchor count: 8 canonical holders + 8 scene holders = 16.**

### 12.4 Must remain / lore-significant / never depict
- **Must remain:** one straight lane between rock walls under an open dark; lamps at even spacing to the last lamp, then fog; nails one to a stride on the right; chalk at a child's height on the left.
- **Lore-significant:** the **unfinished last chalk group** (one stroke short); the **doorframe with no door** and shining hinges; the **worn bench** at the empty Wardens' post; the nail-strides (Teru's measure).
- **Never depict:** where Teru ended; whether Mara found him; what the seam is; chalk as letters or numbers; the road's end.

### 12.5 Reachability
Flight world (Fly-to, tap-to-fly, spots). Entry: story door once the Harbor Nail (`relic.harbor-nail`, Great Station) is found (§0.1); Calend and Hesk roam into it (seam spec).

### 12.6 GLB assets in use
None identified — procedural (walls, lamps, nails, chalk built in code). **Reusable as-is:** the procedural road. **Improve candidates:** the rock walls and lamp rhythm are the natural Blender subject; spacing constants (lamps 120, nails 26, chalk height 16) are fixed facts.

### 12.7 Scale facts and budgets
halfWidth 110 (walls ±114); z −120..2400 (2,520 long); wall height 190; lamps every 120 @ y=64 both walls; nails every 26 @ height 50 (right wall); chalk z 140→1300 @ height 16 (left wall); doorframe z=560; post z=940. No explicit budget constant captured for the Road in this pass — see §16.

---

## 13. Asset inventory — `packages/web/public/*.glb` (≈180 files)
Read via `git ls-tree -l origin/main packages/web/public/`. Grouped as shipped:

| Group | Files | Notes |
|---|---|---|
| Hero / player | `soumaya-ship.glb` (2,364,720 B), `organic-spaceship.glb` (≈943 KB) | Hero + its CC-BY-4.0 fallback (§1.7) |
| Station | `space_station_3.glb` (≈3.99 MB) | Station body source |
| Eternity figure | `man-god-halo.glb` (495,572 B) | **Owner's own upload; never replace (§7.2)** |
| NASA / Scale | `ISS-A.glb` (39,708 B), `nasa-probes/Dawn.glb` (927,020 B), `nasa-probes/Kepler-A.glb` (2,003,276 B), `nasa-probes/Pioneer10.glb` (2,049,840 B), `nasa-probes/Voyager-A.glb` (285,936 B), `nasa-g292.glb` (≈1.2 MB), `nasa-bennu.glb` (≈330 KB) | Byte/size-pinned by `scaleAssets.ts`; not slimmed (owner order) |
| Deep Past set | `first-light-basin-web-256.glb`, `rim-web-256.glb`, `descent-stair-web-256.glb`, `stratum-terrace-web-256.glb`, `stratum-lantern-web-256.glb`, `sf-anchor-spire.glb` (≈2.02 MB), `sf-first-light-orb-slim.glb` (≈580 KB), `sf-supernova-remnant-slim.glb` (≈2.62 MB) + a supernova rework file | §3.6 |
| Relics | `relics/<slug>-slim.glb` × 15 (1.56–4.51 MB each) | Heavy for 14.3k–22.5k tris each — the largest *aggregate* weight in the sky set |
| Gate | `warp-gate.glb` (784,904 B; 9,594 tris) | Owner-supplied Sketchfab "Sci-Fi Stargate Portal", prepped to exactly 100 units across |
| Ship sets | `quaternius-*` (11 hulls), `kenney-space-*` (13), `lowpoly-*` (26), `E45-fleet.glb` (≈649 KB), `wato-spaceship.glb` (3,616,288 B) | Traffic, docked, dressing, visitor hulls |
| Station dressing sets | `colony-*` (26), `lunar-*` (29), `stationpack-*` (26), `kenney-station-*` | Annexes and interior dressing |
| Sky / planets | `sf-*` planet set, `pp-*` (planets, Hubble ≈1.18 MB, etc.), `blackhole.glb` (≈3.23 MB), `dyson-sphere.glb` (≈1.46 MB), `profondo.glb` (≈597 KB) | Toy `lowpoly-planet_*` + `pp-*` planets are being retired for shader planets (§6.2) |

## 14. Licensing and provenance (authorities: `packages/web/public/CREDITS.md`, `docs/worlds/p2-6-provenance-inventory.md`, `docs/specs/stage-3-provenance.md`)
- **Hero ship `soumaya-ship.glb`: CC-BY-NC — non-commercial only** (3DHaupt). Before any commercial use it must be replaced with the in-repo CC-BY-4.0 fallback `organic-spaceship.glb` (ricksticky). This is the single hard licensing constraint in the asset base.
- **CC0 (free use):** Quaternius ships and planets; Kenney Space Kit + Station Kit (Station Kit GLBs need their external `Textures/colormap.png` shipped alongside); FlexUnit UFO.
- **CC-BY (attribution required):** `wato-spaceship.glb` (XCVG / XCVG Systems, CC-BY 3.0); Poly Pizza set (CC-BY 3.0 unless noted); Jattenalle nebula renders (CC-BY 3.0); Sketchfab set (CC-BY 4.0) — Planetary Nebula, SebastianSosnowski black hole, pulsar, nebula traveller, lava planet, ice planet, all downloaded by the owner himself 2026-10-27; `warp-gate.glb` (Indirion Dradnon, CC-BY-4.0); NestaEric (CC-BY-4.0) and vostok (CC-BY-3.0) models per CREDITS headers.
- **Owner's own (no third-party licence):** `man-god-halo.glb` (Eternity's figure).
- **NASA models:** shipped as originals, unpinned by licence text in CREDITS but byte-pinned in code.
- **Held / not shipped (do not use without a new decision):** the animated "Supernova" by tamminen (161,280 tris), "Wormhole Concept" by James Truhlar (20,000 tris), "Evolution of supernova 1987A" (4,573,813 tris — far too heavy as-is); the two Aiekick supernova point clouds (0 triangles at full size). **Dropped by owner order:** alisachen69 "Ice Planet", dannzjs "Ice world".

## 15. Discrepancies found (recorded, NOT resolved)
- **D-1 — `docs/worlds/eternity-lore.md` does not exist, but code cites it as lore ground.** `packages/shared/src/relics.ts` cites `docs/worlds/eternity-lore.md` (and `docs/worlds/relic-buffs-design-note.md`) as the lore source for relic definitions; neither file exists on `main` (nor, per `docs/lore/LORE_CANON.md`, on any branch: eternity-lore.md "is not in this repository (not found on any branch)"). `docs/worlds/` on main contains only: `p2-6-provenance-inventory.md`, `quiet-archive-design-note.md`, `recipe-people.md`, `recipe-quiet-archive.md`, `recipe-scale.md`.
- **D-2 — Deep Past holder names in the spots spec vs the scene.** `docs/specs/lore-physical-spots-2026-10-31.md` §9 names measured Deep Past landmarks `glb-rim`, `glb-stair` and `stratum-0…8`; the scene on main builds `place-rim`, `stair` and a single `strata` group (no per-stratum holders, no `glb-rim`/`glb-stair`). `storyTriggers.ts` agrees with the scene (`^stair$`). The spec's table appears to describe an earlier build.
- **D-3 — Station size: 420 vs 879 across.** `stationLayout.ts` gives wheel radius 210 (diameter 420, ratio 35:1 vs the 12-unit ship). `docs/specs/worlds-scale-lanes-2026-10-30.md` §1 says "the Station is 879 across (73× the ship)". The 879 figure presumably includes orbit/traffic extent or is stale; the layout constant is what the scene builds.
- **D-4 — Draft 5 lock status.** `docs/lore/LORE_CANON.md` lists Draft 5 (The Web) as *proposed, awaiting the owner's lock* and Draft 6 as structure/flavour only; `docs/lore/CONTINUITY_BIBLE.md` describes itself as "Written 2026-10-30 from the locked lore (Drafts 1–6)", implying 5–6 are locked.
- **D-5 — Eternity's description vs the figure canon.** `CONTINUITY_BIBLE.md` §0.1 prose: "broad-shouldered… face serene and impossible to describe". Owner's binding game-model canon (§7.2): no face, no hair, no body detail; the Bible itself elsewhere says "never a clear face". The 2D art rulings also record that the `03-eternity-v2` painting (which shows a face) is **mood art only**, not canon.
- **D-6 — Relic names: registry vs LORE_CANON prose.** `packages/shared/src/relics.ts` (registry of record) names: Mooring Ring, Basin Stone, Lantern of Keeping, Star Hanger, Sunward Compass, Stillness Seal, Unopened Fold. `docs/lore/LORE_CANON.md`'s summary names the same relics: Drift Ring, Waterline stone, Quiet Lantern, Star Hook, Sun Compass, Rest Seal, Folded Letter. The registry names are the ones the app ships; the canon summary uses older/looser names.
- **D-7 — Scale relics registered non-discoverable.** In `relics.ts`, Star Hanger, Sunward Compass and Unnumbered Fragment carry `discoverable: false`, with registry comments written when the Quiet/Scale worlds "did not exist yet" — both worlds now exist and ship. (The two Quiet/Archive relics were under the same comment family.) Worlds-open timing in the comments is stale against current code.
- **D-8 — Spots spec §9 vs station scene contents.** The spots spec's browser measurement reports that the Station's `hero-ship` and a `backdrop-*` planet "are not in the scene" and were replaced as anchors by the rim and drydock; the scene source on main does create `hero-ship` and `backdrop-<planet.key>` holders, and `worldPlaces.ts` still carries place rules for both. Measurement and source disagree (the measurement may predate a scene change, or the models failed to load in that run).
- **D-9 — Two governing design notes cited but absent from main.** `docs/specs/eternity-autonomy-2026-10-29.md` states it obeys `docs/worlds/npc-autonomy-design-note.md` and `eternity-world-design-note.md` §2/§7 (attributed to branch `design/worlds-vision`); neither file exists on `main`.

## 16. Mission-brief files that do NOT exist on main (exact list)
Checked against `git ls-tree -r origin/main`:
1. `docs/worlds/eternity-lore.md` — cited by `packages/shared/src/relics.ts` as lore ground; absent on every branch per `LORE_CANON.md`. (See D-1.)
2. `docs/worlds/relic-buffs-design-note.md` — cited alongside the above; absent from `docs/worlds/` on main.
3. `docs/worlds/npc-autonomy-design-note.md` — cited by the eternity-autonomy spec; lives (per that spec) on branch `design/worlds-vision`, not main. (See D-9.)
4. `eternity-world-design-note.md` (`docs/worlds/eternity-world-design-note.md`) — cited by the eternity-autonomy spec; not on main. (See D-9.)

**Present, contrary to any assumption of absence:** `docs/specs/world-props-2026-10-31.md` EXISTS on main (1,655 B), as does `docs/specs/lore-physical-spots-2026-10-31.md` (7,875 B). All 13 layout/scene module pairs named in the brief exist under `packages/web/src/graph/` (station, stationInterior, garden, deepPast, people, quietArchive, scale, eternity, ward, village, siege, unmade, road). All other brief-named lore/spec files exist.

## 17. Unresolved visual decisions and open items found in the docs
1. **Eternity travel model** — "no ship movement there yet… (open question for the owner)" (`lore-physical-spots` §7); §10 then records the view-based spot system as BUILT and free flight deliberately not built. Whether Eternity ever gets a travel model remains the owner's open question.
2. **Measured placement fine-tuning** — spots are anchored with generous radii; exact positions "need a headless pass per world or the owner's eyes on a phone" (`lore-physical-spots` §7). Deep Past placement rests on one confirmed browser measurement plus the scene's holder list (§9).
3. **Proximity cue** — a faint glint cue for spots was deliberately NOT included ("the owner wants it hard to find. One constant would add it.") — a standing option, not a decision.
4. **No stated budgets for the six seam worlds and Eternity** — this pass found explicit draw-call/tri budgets only for Station (88 / 750k), Station Interior (64 / 500k), Garden (95 / 700k), Deep Past (195k tris), People (80 / 400k), Quiet/Archive (60 / 300k), Scale (100 / 500k). No budget constant was captured for Eternity, Faded Ward, Village, Siege, Unmade Hour or Road — the Stage B briefs should either adopt the recipes' global ceilings (§11.2, referenced by `recipe-scale.md`/`recipe-quiet-archive.md`) or flag the gap to the owner.
5. **Hero ship licence** — the CC-BY-NC hero must be replaced before any commercial use (§14); the replacement's *look* (seventh hull identity) is a visual decision still to be made when that day comes.
6. **Scale's toy-planet replacement is mid-flight** — the procedural-planets spec (2026-10-31) retires the toy GLBs for shader planets with far placement; the layout still carries near-field sizes/positions (directions only). Stage B should treat the **spec** as the current visual truth for Scale's planets.
7. **Relic slim models' weight** — 15 files at 1.56–4.51 MB for 14–22k tris each is disproportionate; whether to re-derive them is an owner decision (GLB slimming was cancelled by owner order 2026-10-30 for working models — do not slim without his word).
8. **Drafts 8–9 content not yet in scenes** — Draft 8 (36 side roads, more ambient traffic) and Draft 9 (sky gazetteer, constellations, sky decals) are PROPOSED; the world-props spec explicitly leaves "constellation sky decals; sky clues" out of its slice. The scenes therefore do not yet contain those layers; Stage B briefs must not invent them as existing locations.

---

*End of Stage A inventory. Next: Stage B visual translation briefs, one per world, built on the anchors, scale facts and never-rules recorded above.*
