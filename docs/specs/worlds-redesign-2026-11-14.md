# Worlds redesign — the travel worlds as places (2026-11-14, owner: "my 3D worlds are shitty … redesign according to what the worlds were intended to be")

**Scope:** only the worlds you travel to (the Station, Growing Place, Deep Past, People, Quiet/Archive, Scale, Eternity and the eight story worlds). The second brain (home galaxy) is not touched.
No lore, gate, route, find or holder name changes — only how the places look.

## 1. Audit (every world captured in a real headless browser at 412×915, 2026-11-14)

| World | What it was meant to be | What is on screen today |
|---|---|---|
| Great Station | A harbour you arrive at | A good model alone in black space; nothing around it gives scale or mood |
| Growing Place | A living terraced garden | Flat green stripes, low-poly trees, no ground detail, no light |
| Deep Past | Strata you descend through to the First Light | Flat purple slabs; the basin model is the only thing with surface |
| People | A hearth-field of the people in your life | A flat grey disc floating in space with a few dots |
| Quiet/Archive | A still field where things rest, low even light | A flat grey disc floating in space, one plank |
| Scale | Feeling small beside real bodies | Planets now shader-drawn (good); probes/ISS missing files |
| Faded Ward | A hall of cots receding past sight, ember lanterns | Flat boxes on a flat floor, flat walls |
| Road to the Seam | A lamplit road cut under the Station | Flat lane between two flat grey sheets |
| Village, Unmade Hour, Siege, Unlit Hulls, Long Morning, Folded Letter | (see each seam spec) | Same vocabulary: untextured boxes and planes, even lighting |
| Eternity | A white void with one figure | Reads as intended; not in this pass |

**One root cause across all of them:** every surface is a single flat colour, every shape is a box or a plane, the light is even, and there is no air. The content is right; nothing has material, form, light or atmosphere.

## 2. The kit (`packages/web/src/graph/worldCraft.ts`) — built once, used by every world

No downloads, no post-processing pass, runs under the unit tests (DataTextures, not canvas).

- **Surface** — tileable rock, flagstone, plaster, wood, metal, soil, pale stone, brass (colour + normal map, 256 px, cached and shared).
- **Form** — noise-displaced rock walls with an uneven crest, rolled ground that stays flat where you walk, baked contact shadow in vertex colours, turned shapes (lantern, cup, post).
- **Light** — pools of light on the ground under lamps, a wash on the wall behind them, shafts of light through openings, a graded horizon. At most four real point lights, placed where the visitor stands.
- **Air** — drifting dust and low mist. Everything that moves holds still under reduced motion.
- **Mood as data** — `graph/worldMood.ts` holds each story world's light, background, fog and look height, so a mood can be tuned without touching the host. Rule: low cool fill, one-sided key, the scene's own lamps do the rest.

## 3. Per-world direction (order of work)

Done in this pass:
1. **Road to the Seam** — rock cut, paved lane worn pale in the middle, scree at the wall feet, iron lanterns on brackets with pools and wall wash, voussoir arch with the Station's light in it, timber door-frame on a stone sill, turned post + worn bench, the Station's underside overhead with far lights, dust and mist.
2. **Faded Ward** — plank floor, limewashed walls over a dark dado, pilasters + roof ribs + ridge and purlins, real iron cots (frame, mattress, blanket in seven faded colours, pillow, stool), lanterns on chains, a mullioned window with a shaft of starlight, dust and mist.

Next, in this order (most-seen first):
3. **Growing Place** — grass/soil surfaces on the terraces with stone risers, ground cover, warm low light, mist in the hollows.
4. **Deep Past** — rock strata surfaces, lit descent, dust, the basin as the light source.
5. **People** and **Quiet/Archive** — give the field ground, an edge and a horizon instead of a disc in space.
6. **Great Station** exterior — approach traffic lanes, rim light, a planet limb for scale.
7. **Village, Unlit Hulls, Unmade Hour, Siege, Long Morning, Folded Letter** — same treatment as the Road and Ward.

## 4. Rules kept
Holder names, layouts, spots, passages and tests' draw budgets are unchanged (Road ≤ 30 meshes, Ward ≤ 40). No text or figures added. Reduced motion holds lamps, dust and mist. Meaning is never carried by colour alone.

## 5. Verification
Each rebuilt scene is rendered in a real browser from several angles before it is accepted; phone GPU behaviour (frame rate, how additive glows read) still needs on-device confirmation.

## 6. The Blender branch (`blender/worlds-production`) — looked at 2026-11-14, not adopted
Eight exported models (Station exterior 19.9 MB and interior 16.9 MB, Growing Place 16.7 MB, Eternity surround 10.2 MB, Faded Ward 6.7 MB, Deep Past 6.7 MB, People 1.6 MB, Quiet/Archive 1.2 MB — about 80 MB in all) and their preview renders were reviewed.
They are the same block-out shapes as the code scenes with baked noise textures; the glow and reflections in the previews come from Blender's renderer and would not survive into the app, which has no post-processing pass.
Verdict: not worth the download weight. The Station model is plainer than the one already in the app. Ideas kept from them: the Deep Past's glossy lit basin and the Growing Place's dusk horizon.
The Faded Ward follows the lore paintings instead (`docs/lore/art/23-…`, `42-…`): the Faded are pale see-through people in the beds, lying and sitting.

## 7. Second pass (same day)
- **Faded Ward** — the Faded drawn as whole translucent figures (two-pass, so each reads as one body), windows down both walls, warmer palette.
- **Quiet/Archive** — the disc in space is now still water to a horizon, with a pale horizon band, a sheen and far mist.
- **The People** — the disc is now warm earth to a dusk horizon with ember skyline and haze.

## 8. Growing Place (third pass) — Blender and code together
Slimming changes the weight verdict in §6: `growing-place.glb` 16.7 MB → 626 KB and `deep-past.glb` 6.7 MB → 313 KB (weld, simplify, 512 px WebP, Draco). But the Blender garden is a fixed snapshot with made-up groves, while the app builds groves and plots from the brain's own Journeys and memories — so it cannot replace the scene whole.
Used from Blender: the witness tree alone (`public/garden-witness-tree.glb`, 58 KB), scaled 1.45× to the app's tree height; the simple tree stays as placeholder and load-failure fallback.
In code: turf terraces with dry-stone risers, soft three-lobed forest crowns, a dusk horizon, a rolling hillside below the lowest terrace, soft-edged mist (the old mist planes showed as grey slabs).
Groves, plots, paths, walking and tending are unchanged.

## 9. Deep Past (fourth pass)
The strata hold the brain's own memories, so the Blender model was not brought in; its best idea was. Strata and stair wear the kit's rock surface laid by world position (each stratum keeps its colour), the basin floor is polished so it takes the First Light's reflection, and the basin's rock wall is textured.

## 10. The Village (fifth pass)
Rolling night turf reaching past sight (flat down the way and in the square), a trodden way from gate to doorway, limewashed houses in four wall tones under true pitched roofs, lit window panes each spilling light on the ground, stone gate and well, a hearth that really lights the square, a deep-blue horizon, low mist and warm motes over the square. Holders, hooks and the doorway are unchanged.
