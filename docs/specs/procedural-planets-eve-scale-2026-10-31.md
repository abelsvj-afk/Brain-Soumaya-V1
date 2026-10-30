# Procedural planets + EVE-style scale (spec, 2026-10-31)

*Owner (2026-10-31): "we have planets that look like real planets, and then some that look like toys — replace all the toy ones with real planets … the planets are not scaled properly; I could approach one close enough that its details went low quality and blurry … like EVE: it's gigantic on screen, but you can never get all the way there — you'll just endlessly fly towards it."*

## Findings (measured)
- The toy-looking bodies are the low-poly and pixel-art models: `lowpoly-planet_{earth,mars,jupiter,saturn}.glb` and `pp-*` (Quaternius planets 1–3, the planets set, Earth-and-Moon, the pixel brown dwarf, the sun). The Sketchfab planets (`sf-*`) are real-looking and stay.
- Scale placed its planets 30–55 units wide, ~500 units away: smaller than the ISS beside them and approachable to a few hundred units, where a low-poly texture magnifies into blur.

## Design
1. **Shader planets** (`graph/proceduralPlanet.ts`): one sphere + a thin atmosphere (+ rings) per body, drawn by a fragment shader from 3-D noise — terran (ocean/land/ice/cloud), desert, banded gas (+ storm), ice with fractures, cooled lava with glowing cracks, brown dwarf, star. No textures, no downloads, and detail is evaluated per pixel so it is **sharp at any distance**. Reduced motion: no spin or cloud drift.
2. **Replacement table** (`TOY_REPLACEMENTS`): each toy key → a kind and seed. Holder names stay (`planet-<key>`, `backdrop-<key>`), so the lore passages, spots and Fly-to tiles still find them.
3. **Scale far placement** (`scaleScene.ts` `FAR_BODY`): the replaced bodies hang 4,400–7,600 units out (camera far plane is 9,000) and 650–2,000 across, in the directions the layout already had. The layout data is unchanged.
4. **Body shells** (`graph/bodyShell.ts`): every big body (Scale planets; the Station's and the Hearths' backdrop planets) keeps an invisible shell at 1.6 radii. A flight's stop point and her position every frame are pushed out to it, so a planet grows as you close in, then simply stops growing — never the surface, never a blurry close-up. `WorldsSurface.tsx` refreshes the shells once a second from the scene's own holders.
5. Lore reach for these bodies (place passages, the Hung Star spot) is widened to 2.4 radii so the ring between the shell and the reach is wide enough to park in.

## Measured
- Contact sheet of all 11 looks (headless, swiftshader): all render, none faceted; terran/gas/ice/lava/dwarf/star distinct.
- In the real Scale world (412×915): Fly-to Jupiter arrives and parks at ~3.2 bounding radii; the planet fills the screen with crisp banding; the ship never nears the surface; 0 page errors.
- Budgets: Scale's static half rose to ~75k tris / ~25 draw calls (test updated, ceiling still far under the recipe).

## Not done / look at on a phone
Frame rate with 11 fragment-shader bodies on a real GPU (each is 6-octave noise; reduce octaves per body if needed); whether 1.6 radii is the right stop; the Station's lava and ice Sketchfab planets are unchanged.
