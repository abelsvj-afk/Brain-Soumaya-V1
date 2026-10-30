# Story props in every world (Draft 9 §5) — 2026-10-31

Owner: "the environment is what immerses you." Each world gets a few small, wordless props that carry the story (a berth-board with one blank slot, chalk tallies with one stroke
smudged, paper boats all pointing the same way, a table laid for one more, a cord with its last knot untied, a sixteenth lamp with no flame). Presentation only — no prop finds,
scores, gates or explains anything.

## How
- `web/src/graph/worldProps.ts`: a table of props per world. Each names an **anchor** (a scene holder the scenes already create — the same names the Fly-to places and lore spots
  use), a position in that holder's **box coordinates** (−1..1 of its half-extents; y = 1 is its top), and a size as a fraction of the holder's radius, so a prop reads at the
  scale of the thing it stands beside whether the world is 200 or 9,000 units across.
- Props are built procedurally (a few boxes, cylinders and lines; ≤ 3 meshes each, ≤ 12 per world) — no downloads. They are placed once the anchor has a real box (a GLB that
  has loaded); an anchor that never loads simply never gets its prop. One call from the world host; disposed with the world.
- Never colour alone (props carry no meaning by colour); no text anywhere (tags, pages and the board are blank); reduced motion: props are static.

## Not in this slice
Constellation sky decals; sky clues (pencil outlines, the dark sixteenth star, the one-lamp-short Earth); props for the Ward (its scene already holds its own). Placement is
measured by unit tests on the math; how each prop LOOKS beside its holder is confirmed only on a screen.
