# Deep Past — Asset Components to Generate

**Status:** COMPONENT LIST — filed 2026-10-25, owner's direction. The owner generates each component as a GLB (reference image → GLB, same flow as the relics); King assembles them in place per the P3-2 layout constants. No build authorized beyond assembly in the P3-2 increment's own lane.
**Source direction (owner, 2026-10-25):** generate 3D assets for the Deep Past world — the spiraling helix, the bottom of it, all of it — and glue the individual pieces together and put them in place, just like the original mockups were designed from scratch. Tell him all the different components needed.
**Ground (P3-2 design note, built):** descending helix of lit strata around the warm First Light basin; violet dusk lit by the memories' own lanterns; seed `deep-past / first-descent-1`; budget ≤90 draw calls / ≤440k tris **for the whole scene** — every component below must be slimmed to fit inside it (the relic pipeline: measure, decimate, textures to 1024, Draco, render-check). Scale constants: **9 strata**, DROP 90 per stratum, stratum radius 440 − i·17.5, **basin y=−830, radius 320**, rim camera orbit 850/150 lookAtY −200, guided descent 90 s. Completeness: the basin IS the finished bottom (solid rock below, camera cannot pass it); the rim is a boundary (finished darkness + faint HYG points above).
**Generation flow (same as the relics):** ChatGPT image generation first (owner's pick), Gemini backup; one component per image, single centered object, pure black background, no text/watermark/scenery; then image → GLB; then the slim pipeline. Ships are NOT generated — they come from the free-ship shortlist (Kenney / Quaternius, CC0, no account).

## The components

### 1. The First Light basin (the bottom of the world)
- **What:** a wide, shallow stone basin, the finished floor the whole descent ends in. Solid rock below — this is the piece that makes "you cannot go underneath" true.
- **Where:** y=−830, radius 320, center of the helix.
- **Prompt:** Generate one wide, shallow ancient stone basin approximately 12 meters across, a single piece of dark violet-gray rock with a gently dished center and a thick rounded rim. The stone is matte, fine-grained, worn smooth in the middle where light has rested. At its center sits a shallow hollow that holds a warm golden glow, as if light itself pools there. The underside is solid, finished rock — a complete bottom, not a hollow shell. Show the entire basin at a three-quarter angle from slightly above, so the dished face and the thickness of the rim are visible. Single centered object, pure black background, realistic stone material, soft warm light from the center, no text, no watermark, no scenery, no other objects.

### 2. The First Light orb (the light in the basin)
- **What:** the warm glowing light itself — a soft, round, radiant presence hovering just above the basin's center. Distinct from the First Light Shard relic (a small shard the user carries); this is the world's own light.
- **Where:** basin center, just above the hollow.
- **Prompt:** Generate one soft, round, radiant orb of warm golden light, approximately 2 meters across, hovering as if held just above a surface. It has no hard edge — a bright warm core fading into a soft halo, with faint slow filaments of light inside, like light moving in water. It is clearly a light, not a solid object: no stone, no metal, no glass shell. Show the full orb centered, pure black background, the glow itself lighting nothing else in frame, no text, no watermark, no scenery, no other objects.

### 3. A stratum terrace segment (repeatable — the helix is built from these)
- **What:** one curved terrace section of the descending helix — a stone shelf with a lit front edge and an alcove niche cut into its back wall. Nine strata × several segments each; the same segment is instanced around the helix at radius 440 − i·17.5, dropping 90 per stratum.
- **Where:** instanced around the helix, one per segment per stratum.
- **Prompt:** Generate one curved stone terrace segment, approximately 6 meters long along its curve and 2 meters deep, a single piece of dark violet-gray rock forming a shelf. Its front edge is a clean, slightly rounded lip that catches a faint warm light from below. Cut into its back wall is one shallow arched alcove niche, empty, about 1 meter tall, its inner surface smooth. The top surface is worn flat where feet would pass. The segment's ends are clean cuts, made to join the next segment. Show the entire segment at a three-quarter angle, front edge and alcove both visible. Single centered object, pure black background, realistic stone material, dim violet dusk light with a warm edge glow, no text, no watermark, no scenery, no other objects.

### 4. The rim (the top boundary)
- **What:** the top edge ring of the descent — a heavy stone ring that marks where the world begins and where the camera stops. Finished darkness above it, faint stars beyond.
- **Where:** the top of the helix, radius ~440.
- **Prompt:** Generate one heavy stone ring segment, approximately 6 meters long, a single piece of dark violet-gray rock forming the top edge of a descending shaft. Its upper face is flat and worn; its inner face drops away in a clean vertical cut. A thin line of faint cool light runs along its inner lip, like a guide. The ends are clean cuts, made to join the next segment into a full ring. Show the entire segment at a three-quarter angle, upper face and inner drop both visible. Single centered object, pure black background, realistic stone material, dim violet dusk light, no text, no watermark, no scenery, no other objects.

### 5. The descent stair (connects one stratum to the next)
- **What:** a short flight of worn stone steps curving down from one terrace to the next — the path the guided descent follows.
- **Where:** between strata, drop 90 per flight, placed along the helix.
- **Prompt:** Generate one short flight of worn stone steps, approximately 3 meters long, curving gently downward — five broad, shallow steps cut from a single piece of dark violet-gray rock. Each step's front edge is rounded by age and catches a faint warm light. The sides are solid rock, not railings. Show the entire flight at a three-quarter angle from the side, all five steps visible. Single centered object, pure black background, realistic stone material, dim violet dusk light with a warm edge glow, no text, no watermark, no scenery, no other objects.

### 6. A stratum lantern (the memories' own light)
- **What:** a small lantern that hangs or sits on a terrace — one of the many lights that make the violet dusk readable. Distinct from the Lantern of Keeping relic (a hero object the user carries); these are scene dressing, instanced in the dozens, so keep each one light.
- **Where:** instanced along terraces, dozens of them.
- **Prompt:** Generate one small ancient lantern, approximately 40 cm tall, a simple dark iron frame with four short corner ribs and a domed cap, holding frosted ivory glass panels that glow softly warm from within. A small loop sits on top for hanging. The iron is matte and dark; the glow is gentle, never bright. Show the complete lantern at a three-quarter angle. Single centered object, pure black background, realistic materials, soft warm light from within, no text, no watermark, no scenery, no other objects.

### 7. An anchor spire (where a line of light rises)
- **What:** a thin, tall stone spire standing on a terrace — the foot of a D-8 anchor. The line of light itself is procedural (a light, not a mesh); the spire is the physical thing it rises from.
- **Where:** on terraces, one per anchor (an anchor = an edge from a Deep Past member to a non-member).
- **Prompt:** Generate one thin, tall stone spire, approximately 3 meters high, a single tapering piece of dark violet-gray rock, slightly irregular, its tip worn to a soft point. A faint warm light seems to gather at its tip, as if something rises from it. Its base is a small, solid footing of the same stone. Show the complete spire at a three-quarter angle, full height visible. Single centered object, pure black background, realistic stone material, dim violet dusk light with a faint warm glow at the tip, no text, no watermark, no scenery, no other objects.

### 8. A route bead (the Chronicle thread marker)
- **What:** a small floating bead that marks one stop on a Chronicle route (a done Journey's linked memories, in chronological order, ARE the route). The thread itself is a line of light; the beads are the stops.
- **Where:** floating above the terrace at each route stop.
- **Prompt:** Generate one small floating bead, approximately 20 cm across, a smooth sphere of pale warm gold stone with a soft satin finish and a faint inner glow, as if it holds a small light. It has no engraving, no hole, no fitting — a plain, quiet marker. Show the complete bead centered. Single centered object, pure black background, realistic material, soft warm glow from within, no text, no watermark, no scenery, no other objects.

## Assembly notes (for the build, in P3-2's lane)

- Components 3, 4, 5, 6 are **instanced**: one GLB each, placed per the layout constants (stratum radius 440 − i·17.5, drop 90, basin y=−830 r=320). Instancing keeps the draw-call budget (≤90) intact.
- Components 1, 2, 7, 8 are **placed**: basin and orb once (the bottom); spires and beads per anchor / per route stop.
- The whole scene must stay ≤440k tris: each component's slim is budgeted against the total, and the layout test asserts the total (same pattern as the P3-2 scene test's 2,000-node fixture).
- The procedural scene already built in P3-2 stays the fallback: if a component GLB fails to load, the scene renders its procedural form and says so honestly (`noteModelFallback`, the Profondo pattern) — never a blank descent.
- Order of generation: **basin → terrace segment → rim → stair → lantern → spire → orb → bead**. The basin first because it is the completeness fix (the finished bottom); the terrace segment second because everything else hangs off it.
