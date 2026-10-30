# Worlds scale, lanes and traversal — proposal (docs only, 2026-10-30)

*Owner: "how the scale of the world might need to be bigger, as far as traversal … with the new automated NPCs." Spec before code (Rule #1). Nothing here is built. Lore context: `docs/lore/DRAFT_4_THE_DEEP_READING.md` (lanes, the Lamplighters, the Cartographer, the Hours Clock).*

## 1. What is measured today (from CLAUDE.md Pending Validation — not re-measured here)
- Her ship is 12 units; the Station is 879 across (73× the ship); the garden ≈ 1,800 across; garden walking 150 u/s (≈ 12 s edge to edge).
- World flight burn 2.4–6.5 s; NPC roam ring is capped at 560 units; warp price = ⌈distance/45⌉ + 1 fuel by `WORLD_COORDS`; drift is free.
- Garden draw-call ceiling is 95 (pinned by a test). First-visit weight is already the biggest cost (home 21.9 MB; each world +6–20 MB).
- A world holds up to ~5–6 cast members at once; tags/cards are dense at 4+.

## 2. The problem to solve
More NPCs with jobs, lanes of traffic, a collectible lore layer and "wrong things" to *regard* all want **more places to be, not just more people in the same ring.** But **bigger geometry costs download and draw calls**, which are already the tightest budget. So: more *places*, not more *size*.

## 3. Proposal in four moves (cheapest first)
1. **Reaches (sub-places, not new maps).** Each world is split into named reaches that already exist as landmarks (Station: Drydock / Lower Rim / Harbor Ring; Deep Past: Rim / Stair / Basin; Garden: Meadow + each grove). Reaches reuse the places the Fly-to dock already finds at runtime (`worldPlaces.ts`). An NPC's day is *which reach they are in* (a pure clock function, like `npcLocation`), so a crowded world spreads out without a bigger map. Lore sights live in reaches.
2. **Lanes as places (the big one).** Today a warp is a loading beat. Add **"Drift the lane"** (already free) as an *opt-in scenic route*: the ship flies the lane in the warp scene's existing sky, past a handful of landmarks (Lamplighters' lamps, the Unremembered Fleet's hulks, Brannoch's mooring, the Concord's markers, the Cartographer's survey barge). **Warp stays the fast path and keeps its price; drift stays free.** Landmarks are procedural sprites/instances or reuse existing models — no new GLB required for v1. Lanes carry traffic: NPCs *in transit* appear as lights on the lane. This makes the space *between* worlds feel enormous without building one more world.
3. **Time as scale.** The Hours Clock (lore §9) makes the same place feel different across the day. Scale by *when* rather than *where*; cost is lighting/tint only.
4. **Crowd-aware rings.** The roam radius should grow with the number present (cap by world size, not the 560 constant) and tags/cards should cluster ("3 more here") past 4 so density does not clutter the HUD. Pure presentation.

## 4. What this is NOT
- No bigger world meshes, no new downloads on the first visit, no extra renderers.
- No NPC pathfinding or server state; positions stay pure clock functions (`npcLocation`, `npcDoing`).
- No change to fuel prices, the travel ledger or the NPC fence.

## 5. Measure first (the repo's rule) — before any build
1. Per world: count NPC tags/cards at 2, 4, 6 present at 412×915 and note overlaps (the density limit).
2. Draw-call and frame time on a lane flight prototype (software GL is ~2 fps; judge only counts, not smoothness).
3. Bundle impact of lane landmarks (target: 0 new KB on the entry chunk — lazy like the rest of the worlds layer).

## 6. Order if the owner wants it built
Reaches (data + pure functions + tests) → crowd-aware rings/tag clustering → Hours Clock tint → lane flight with landmarks. Each is independently shippable; none touches Red-Zone files except `shared/npcs.ts` (cast reach data), which Claude keeps.
