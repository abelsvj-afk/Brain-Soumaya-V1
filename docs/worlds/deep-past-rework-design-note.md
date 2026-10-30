# Deep Past REWORK — design note (2026-10-29, evening)

**Status:** DESIGN ONLY. No code, no merge, no deploy is authorized by this note.
The build waits for the owner's tap on this note.

**Owner direction (2026-10-29 ~20:23 EDT, supersedes the 2026-10-29 Deep Past
fix and its design note):** return to the PRE-ASSET GENERATED design — the Deep
Past that was generated procedurally before the owner's GLBs were swapped in —
and go really hard on designing that. His words, compressed: the repeated GLBs
go; only unique one-time individual pieces stay; the stairs don't connect and
have to go; you can't go around in the world; the basin is barely visible and
its glow must be BRIGHT; there's nothing functional to do and the world doesn't
explain itself; the top buttons (Persistent HUD) are PERFECT — do not change
them. The spinning orb in the basin he likes: "it looks pretty good."

**Code read for this note:** app `main` at `ad243423` (verified via
`git ls-remote`, 2026-10-29 evening) — `deepPastLayout.ts`,
`deepPastAssets.ts`, `deepPastScene.ts`, `worldPlaces.ts`, and the Deep Past /
glimmer / dock sections of `WorldsSurface.tsx` and `App.tsx`. Mockup sources:
`~/workspace/worlds-vision/mockups/deep-past/index.html` (identical source at
`~/workspace/worlds-vision/builds/deep-past.mjs`), its `README.md`, and the
settled recipe `~/workspace/worlds-vision/recipe-deep-past.md` (owner-settled
2026-10-22).

---

## 1. The recovered pre-asset design

### 1.1 Recovery statement — read this first

The original pre-asset standalone (built 2026-10-22, owner decision D-30:
"built and kept, testing waived") **does not survive as a file.** Searched:
the mockup folder, `builds/`, `~/workspace/your_files/worlds-mockups-live/`
(standalones v2–v7 — every one carries the "your GLBs" banner),
`~/workspace/ts-spaces/deep-past-mockup/` and `~/workspace/space_data/`
(the v7 standalone), and `~/workspace/deep-past-audit-push/` (v7 again).
`deep-past-phone-test.html` is only the WebGL diagnostic page.

**But the pre-asset scene itself is recoverable, almost completely, from
`mockups/deep-past/index.html`.** The GLB era (v2–v7) never rewrote the
scene: each of the five pieces was swapped in as an *additive loader layered
over the fixture original*, and the fixture originals are still in the file —
the basin's fixture disc survives as the load-failure fallback, both fixture
hero orbs survive as code, and the strata / lanterns / thread / shaft were
never touched at all. `README.md` documents every swap and what it replaced.
What follows is reconstructed from those lines plus the settled recipe; the
one thing not recoverable verbatim is the v1 camera-stage timing table (the
file's Chronicle stage system is the same design, evolved).

### 1.2 What the generated scene actually was

From `index.html` (line numbers are the current file's):

- **The helix** (lines 239–257): 9 strata, `DROP = 18`, radius
  `88 − i·3.5`, arc start `i · 0.85` rad, arc length 4.4 rad. Each stratum is
  a **solid cylinder segment** (height 2.6, capped — it has a top surface you
  stand on), Lambert material, two alternating violet tints, and a **gold
  trim lip**: a partial torus (tube 0.5, same arc) sitting on the segment's
  top edge, plain gold-brown basic material. The spiral read comes from
  these trims winding down, not from any stair.
- **The lantern field** (lines 258–280): 130 small warm spheres (r 0.9,
  basic material `0xffcf8f`), one InstancedMesh, ~15 per stratum scattered
  along the arc just inside the rim. "The memories' own light. Same warmth
  at every depth."
- **The basin** (lines 281–342): fixture form = a warm disc (r 58) at
  `BASIN_Y = −166`; over it, **the light shaft** — two additive open
  cylinders (outer opacity 0.045, core 0.07) rising the full 172-unit height
  of the helix — a pool-glow sprite (scale 70), and **130 gold motes**
  drifting up through the beam. In the GLB era the disc became his dish and
  gained a real point light; the shaft, glow, and motes were there before
  any GLB and stayed.
- **Hero orbs** (lines 447–467): the fixture "lanterns" — a small orb
  (r 2.1) on a short stand with a glow sprite, placed at stratum 3 (beside
  the placement shelf) and stratum 7 (the rise candidate). Singular
  landmarks, generated.
- **The Chronicle thread** (lines 519–530): a CatmullRom spiral curve
  rendered as a gold line (220 points) winding down the strata — the route,
  visible before it is traveled.
- **Atmosphere**: violet fog (`FogExp2 0x1d1430`), a gradient dome, a
  backdrop glow sprite behind the basin, ~900 backdrop stars.
- **The grammar** (recipe, settled): violet dusk lit *by the memories
  themselves*; depth = earlier, never a score; the bottom is the warmest
  place, not a pit; strata are bands, not bins; the descent is gentle,
  capped, user-controlled, pausable forever at any stop.

### 1.3 What the app kept, and what it lost

The shipped app scene (`deepPastScene.ts` @ `ad243423`) kept the arc
parameters, the trim idea (a rim *band*), memory lanterns as points, the
thread line, and the basin glow sprite. It lost: **the floors** (the app's
strata are open cylinder *walls*, 13 tall, no caps — members float on
plinths in open air beside a wall), **the light shaft** (dropped entirely),
**the hero orbs** (replaced by GLB lanterns), and **the scale** (everything
multiplied ×5 — §3). The rework restores the lost half and removes the GLB
architecture that replaced it.

---

## 2. Diagnosis — his QA list, mapped to causes in the shipped code

| His words | Cause in the shipped build |
|---|---|
| "The stairs… need to actually connect and these aren't connecting" | 9 straight 5-step GLB flights placed at tangential midpoints (`deepPastStairFlights()`), ends straddling the receiving stratum's edge — the assets header itself records the overhang caveat "by design." There are no landings; a flight's end meets nothing. At ×249 scale each of the 5 steps is ~18 units tall. |
| "Travel within the world was limited, you couldn't really go around" | The only in-world navigation is the guided descent (a follow-only camera on a fixed derived path) plus a Fly-to dock of GLB holders (`worldPlaces.ts` PLACE_RULES — places exist only where a GLB loaded). There is no way to move *along* a stratum, stop where you choose, or walk between levels. |
| "You can't really see the basin at the bottom; the glow needs to be bright" | Basin point light: intensity 2.2, **distance 500**, at depth −830 — its light never reaches the upper helix, and from the arrival camera (~600 out) the 190-wide glow sprite is a small dim disc. The fixture's full-height light shaft — the thing that made the basin visible from the rim — was dropped in the app build. |
| "Nothing functional to do; you don't know what the world is about or how to interact" | Members render as plinths/forms/glow points but are not tappable in-world — no verb exists on them inside Deep Past. The thread ride is passive. The arrival hint is the generic look-hint, not a statement of what this world is for. |
| The lag banner on arrival (verified tonight) | The supernova cloud: 216,902 points in **34 draw calls**; 467,558 GLB triangles; MeshStandardMaterial under 5 lights for nearly everything; instanced layers with frustum culling off; 190–200-unit additive glow sprites (overdraw). Measured scene total: 102 calls / 618,970 tris / 219,502 points against caps the fix itself raised to fit (110 / 620k / 220k). |
| The garbled glimmer prompts (verified from a page capture) | `WorldsSurface.tsx` (ad243423, lines ~2158–2167) maps every visible relic to its own `<p className="worlds-surface-fallback">` — the single-note fallback styling reused per relic, so four "Something glimmers… Look closer" paragraphs stack on the same spot. |

---

## 3. Scale settlement — return to the mockup's proportions (×1)

**Settled: the rework adopts the pre-asset mockup's proportions as the
world's geometry.** One change surface — the geometry constants in
`deepPastLayout.ts`:

| Constant | App today (×5) | Rework (×1, mockup) |
|---|---|---|
| Stratum radius | 440 → 300 | 88 − i·3.5 (88 → 60) |
| Stratum drop | 90 (basin leg 110) | 18 (basin leg 24, §5.3) |
| Stratum Y | 0 → −720 | 0 → −144 |
| Basin Y | −830 | −168 (floor top −166.7, §5.3) |
| Basin radius | 320 | 66 |
| Arc start / length | 0.85 / 4.4 | 0.85 / 4.4 (unchanged) |

Why: the mockup's proportions are the **only owner-verified composition in
the world's history** — he checked v2–v7 on his own phone at these sizes and
the spiral read, the basin read, and the piece scales all worked. At ×5,
every proportion the design depends on breaks: a lantern becomes a
monument, a 5-step stair becomes a cliff, a 500-distance light covers a
tenth of the world. An intermediate scale (×2.5) was considered and
rejected: it has no evidence base at all — it is a guess between a proven
composition and a failed one.

Composition consequences, stated plainly:

- Deep Past becomes an **intimate well**, not a vast chasm — a private,
  quiet room of a world, which matches what it is (his earliest memories,
  PRIVATE, never a public square). Other worlds keep their scales; worlds
  are not required to share one.
- Everything derived from the layout constants follows automatically:
  alcove positions, the descent path keys, the rise shelf, thread stops,
  anchor lines. Sizes that were tuned as literals at ×5 (plinth radius,
  form sizes, snow field, ship dressing size/speeds, glow spans, light
  distances) re-derive from the stratum radius/drop proportions — the
  build lists each one; none may survive as a ×5 literal.
- Relic anchors in Deep Past derive their Y from `DEEP_PAST_BASIN_Y`
  (good) but carry literal x/z tuned to radius 320 (±120–140). The build
  must re-express them as fractions of `DEEP_PAST_BASIN_RADIUS` and
  re-verify relic visibility registration. (Flagged here so it is a
  planned step, not a discovery.)
- Fog density, camera near/far, and the arrival clearance re-derive from
  the new depth (total drop ~340 including arrival vista, vs 920 today).

*Flagged for veto as V6 (§12).*

---

## 4. Per-piece GLB accounting — every current Deep Past GLB

Rule (owner, 2026-10-29): **a GLB may exist in Deep Past only as a unique,
one-time, individual piece. No GLB is repeated, instanced, or used as
architecture.** Data markers (one per real thing — a route stop, a memory)
are not architecture and not dressing; they are how real data shows itself,
the same class as the memory lanterns.

| # | Piece (file on main) | Today | Verdict | Cause / treatment |
|---|---|---|---|---|
| 1 | First Light Orb (`sf-first-light-orb-slim.glb`, 580,100 B, 24,576 tris) | ×1, basin center, 'FirstLight' clip | **KEEP** | Owner-named keep ("the thing spinning in the center — I like it"). Singular centerpiece; §6 rebuilds its light rig. |
| 2 | Route bead (`route-bead.glb`, 10,200 B, 1,597 tris) | cloned × stops (≤12 budgeted) | **KEEP — as instanced data markers** | **This note's pick for "the other ball shaped thing"** (§4.1). One per real route stop; rendered as ONE InstancedMesh (2 calls total, not 2 per stop). |
| 3 | Basin dish (`first-light-basin-web-256.glb`, 239,224 B, 22,500 tris) | ×1, basin floor | **KEEP, presentation rebuilt** | Singular, but structural — flagged V1. Kept because it is *the* First Light object, his first piece, and the fixture disc it replaced was a plain circle. §6: it sits in a generated basin floor, under the restored shaft, with a real light budget. If he vetoes, the generated floor + pool glow carries the basin alone. |
| 4 | Anchor spire (`sf-anchor-spire.glb`, 2,022,672 B, 80,210 tris) | ×1, stratum 1 landmark | **KEEP** | Singular landmark; the "nail" he referenced approvingly ("keep that if it's only used one time"). Its tip glow stays (his direction). Heaviest keeper per triangle — re-slim option flagged V5. Scale re-fit: 120 tall at ×5 → 24 tall at ×1. |
| 5 | Supernova remnant (`sf-supernova-remnant-slim.glb`, 2,624,476 B, 216,902 pts) | ×1, stratum 7 backdrop | **KEEP, re-slimmed hard** | Singular — "the oldest thing in the descent." But as shipped it is the lag: 34 draw calls and 98% of the scene's points. Rework form: subsample to ≤60,000 points merged into ONE Points cloud (1 call, est. ≤800,000 B). Alternate candidate for "the other ball shaped thing" — flagged V2/V4. |
| 6 | Terrace (`stratum-terrace-web-256.glb`, 233,160 B) | ×24 instanced slices | **REMOVE** | Repeated architecture. The generated strata discs (§5.1) are the terraces. |
| 7 | Stair (`descent-stair-web-256.glb`, 168,844 B) | ×9 instanced flights | **REMOVE** | Repeated architecture that cannot connect. Replaced by the generated stair (§5.2). |
| 8 | Rim (`rim-web-256.glb`, 228,316 B) | ×1 ring at the top | **REMOVE** | Singular but pure architecture; the generated rim (§5.1) grows out of stratum 0's disc + trim vocabulary instead. |
| 9 | Lantern (`stratum-lantern-web-256.glb`, 95,092 B) | ×1 hero + ×24 dressing | **REMOVE** | The dressing repeats are out by the rule. The hero is singular, but its glow is painted into its texture and it needed a bolted-on light rig to read as lit; the fixture's generated hero orbs (§5.4) do this job in the design's own vocabulary. Flagged V3 — his call if he wants the one hero lantern back. |
| 10 | Crystals (`lowpoly-crystal_cluster.glb`, 7,012 B) | ×3 dressing, strata 5–7 | **REMOVE** | Repeated dressing (and third-party). No generated replacement — the deep strata keep the supernova, the members, and the dark. Flagged V8. |

Files removed from the scene's manifest stop loading in Deep Past. (Whether
the files also leave `public/` is a build-time housekeeping call; the relic
files that share names — e.g. `relics/lantern-of-keeping-slim.glb` — are
different files in a different system and are untouched by this note.)

### 4.1 "The other ball shaped thing" — identification

Ball-shaped candidates among the current Deep Past assets: the **route
bead** (a small sphere with a glow shell, floating above each thread stop,
'Flow' clip — he approved this file personally on 2026-10-28: "Perfect.."),
the **supernova remnant** (a spherical shell of stars), and the member
**hero orbs** (generated, not GLBs). **This note's pick: the route bead** —
it is literally a ball, it is his most recently approved Deep Past piece,
and it sits in the same sentence-class as the orb (small, glowing, his).
The supernova is named as the alternate. Both are KEEPs above either way;
the pick only decides which one he meant, and it is flagged V2 for his
veto.

---

## 5. Generated architecture — the stair connects, by construction

All architecture is generated in code from the layout constants (the
fixture scene's method, extended). If a layout constant ever changes, the
architecture regenerates — nothing is baked, nothing is placed by hand.

### 5.1 Strata and rim

- Each stratum is a **solid segment disc** (the fixture's cylinder segment:
  radius R_i, thickness 2.6, arc 4.4 from arc start 0.85·i, capped) — a
  floor you stand on, warming in tint with depth (the app scene's
  rim→basin color lerp, kept). All nine discs merge into ONE generated
  geometry (1 draw call, Lambert). Members rest **on** the disc top:
  alcove Y = floor(i) (see §5.2), replacing today's floating plinths —
  plinths shrink to a low stone pad (height 0.6) under each form.
- **Gold trim**: the fixture's partial-torus lip on each disc's top outer
  edge, all nine merged into one geometry (1 call, basic gold material).
  The trim is the silhouette: from the rim, nine gold arcs winding down.
- **The rim** (generated, replacing the rim GLB): stratum 0's disc gains a
  raised outer band — a short cylinder segment wall (height 6) on its
  outer edge with the same trim on top, and the arrival gap: the band
  breaks where the stair's first flight lands (§5.2) and where the
  Chronicle arrival frames the view. One merged geometry with the strata.

### 5.2 The stair — one continuous helical descent

**Form.** A single generated mesh (1 draw call) containing every flight,
built from the same constants as the discs it joins. Each stratum
transition is a flight of **12 steps, rise 1.5** (12 × 1.5 = 18 = DROP),
winding **1.15 rad** along the helix at the stair band (radial width 14,
hugging the disc's inner face: from R−17 to R−3 at the flight's strata).
Tread depth along the arc ≈ (1.15 × ~74) / 12 ≈ 7 — broad, shallow,
grandmother-stair proportions at this scale; nobody trips on a 1.5 rise
with a 7 tread. Each flight carries **cheek walls**: two ribbon walls
following the step profile on its inner and outer edges (height 2.2 above
the local tread), and a **gold trim strip** along the outer cheek — the
trim vocabulary carried onto the stair, so the flights read as part of
the same building as the discs.

**Connection proof (the heart of this note).** Define
`floor(i) = stratumY(i) + 1.3` (the disc's top surface). Flight k
(k = 1…8) serves stratum k−1 → k:

- Its top step's top surface is at **exactly** `floor(k−1)`, positioned at
  arc-relative angle 3.25 on stratum k−1 — *on* that disc (3.25 < 4.4, so
  the step stands on the disc's own arc, sharing its top plane).
- Step j (j = 0…11) tops at `floor(k−1) − (j+1)·1.5`; the twelfth step
  tops at `floor(k−1) − 18 = floor(k)` — an arithmetic identity, not a
  fit. Its angular end is arc-relative 3.25 + 1.15 − 0.85 = **3.55 on
  stratum k** (< 4.4: it lands on the lower disc's arc, sharing its top
  plane).
- So a traveler walking the disc arc reaches the flight's first step
  without a gap or a lip, and the flight's last step *is* the lower
  disc's floor level at a point on that disc. The walk route (§7) is:
  disc arc → flight → disc arc → flight → … → basin. **Connection is a
  derivation, asserted by tests on the generated geometry's coordinates**
  (top-step plane == upper floor plane; bottom-step plane == lower floor
  plane; angular endpoints inside both discs' arcs) — not a visual hope.

**Geometry budget.** Steps as boxes (12 tris each): 8 flights × 12 + the
basin flight's 16 = 112 steps ≈ 1.4k tris; cheeks as profile ribbons
≈ 3k; trim strips ≈ 1k. Whole stair ≤ 6k tris, 1 call, Lambert stone
with the strata's tint lerp so flights belong to their levels.

### 5.3 The basin leg

The basin floor top sits at `floor(8) − 24` (= −166.7 with
`BASIN_Y = −168` and the discs' +1.3 convention), so the final flight is
**16 steps × 1.5 = 24**, same construction, landing on the generated
basin floor ring that surrounds the dish (§6). Same proof, same tests.

### 5.4 Hero orbs, thread, shaft, weather — the fixture vocabulary, kept whole

- **Hero orbs** (generated, replacing the lantern GLB): orb-on-stand +
  glow sprite at stratum 3 (beside the placement shelf) and stratum 7
  (the rise candidate) — the fixture's exact roles. The stratum-3 orb
  carries one of the scene's two real point lights (§9).
- **The Chronicle thread**: the gold CatmullRom line through the route's
  real stops (exists in the app today — kept verbatim), with the route
  beads (§4 #2) floating above its stops.
- **The light shaft**: restored (§6).
- **Marine snow / motes**: kept, counts cut to the §9 budget; the basin's
  gold motes rise through the shaft as in the fixture.

---

## 6. Basin payoff — visible from the rim, bright at the bottom

The basin is the destination; the whole descent is lit by wanting to
reach it. Spec:

- **The key light**: ONE real PointLight at the orb's position (basin
  center, floor + ~10), warm `0xffc98a`, **distance 0 (unbounded) with
  decay set so stratum 2 and above still catch warm light on their disc
  faces** — the fixture proved this reads: its basin light threw light up
  the whole 172-unit helix and the Lambert strata caught it. Intensity is
  set at build time against the §10 entry render (the render must show
  warm light on the upper discs' inner faces, or the value goes up).
- **The shaft**: the fixture's two additive cylinders, full height from
  the pool to above stratum 0 — the visible column of light that makes
  the basin findable from anywhere in the world. Restored verbatim in
  construction (radii scale to the basin: outer ~ basin radius × 0.25).
- **The pool glow**: a sprite at the dish, span ≈ 0.6 × basin span —
  large enough that from the rim it is the brightest object in frame
  (§10 tests exactly this).
- **The dish**: kept (§4 #3), seated in a **generated basin floor** — a
  stone disc (radius = basin radius) whose top is the walking floor of
  §5.3, with a gold trim ring at its edge (the app fallback's torus,
  promoted to the design). The dish's gold pool aligns with the orb and
  the light: one vertical axis of light — pool → orb → shaft → rim.
- **The orb**: spans ≈ 0.13 × basin span (~17 units), 'FirstLight' clip
  playing (spin + bob + breathing pulse), halo sprite behind it. It is
  the last thing the descent camera settles on (the existing derived
  descent already ends facing it — kept).

---

## 7. Movement — you can actually go around

Today: a follow-only guided camera + a fly-to list of GLB holders. The
rework makes the world *walkable* along its own architecture. Four modes,
all free (in-world movement is not inter-world travel: no fuel, no
timers, no punishment for stopping — the never-punish invariant):

1. **Overview (rim orbit)** — the arrival view, kept: orbit/zoom from
   above the rim, the whole lit helix in frame, basin glowing at the
   bottom. Drag looks, pinch/scroll zooms (the existing look-hint
   grammar).
2. **Walk the descent** — the new primary mode. Enter from the dock
   ("Descend" becomes "Walk the stair" when no Chronicle thread is
   armed; see mode 3) or by tapping the stair in overview. The camera
   rides the **walk curve**: the generated path that follows the disc
   arcs and the stair flights (§5.2's route), eye height floor + 3.2,
   at a calm walking pace (~14 units/s, capped, user-stoppable at any
   moment — tap/hold again to pause, drag at any time to look around
   freely while paused or moving; look returns gently when walking
   resumes). At each stratum landing the walk *offers the stratum*:
   a small in-world label names it ("Depth 4 of 9 — kept since 2019",
   derived from the layout, viewer's local calendar phrasing, no UTC)
   and **stepping off** is one tap — the camera settles onto that disc
   and the mode becomes:
3. **On a stratum (free perch)** — from any landing, a slow free-orbit
   perch anchored to that stratum: drag to look along the arc at the
   memories resting there, tap a memory to approach it (§8), tap
   "Next flight down" / "Flight back up" to rejoin the walk curve at
   this stratum, tap "Rim" to return to overview. Stratum-to-stratum
   stepping is therefore one tap per flight, both directions — the
   "go around" he asked for, on architecture that connects.
4. **Chronicle ride** — when a saved route exists, the guided descent
   (A21) remains as its own mode, entered from the dock ("Descend the
   Chronicle", as today), following the thread, pausing at each stop
   (§8). Leaving it parks your place; re-entering resumes at your stop
   (the recipe's rule, already the design of record).

**Fly-to, demoted to shortcut — and fixed.** The dock's Fly-to group
stays (it earns its place for long jumps: rim → basin is a long walk),
but its places are re-anchored to **generated holders**, not GLBs:
Rim · First Light (the basin — the orb is in this view and stops being
a separate place, ending the "First Light basin" / "First Light orb"
duplication) · the Anchor Spire (kept piece, still a place) · the
Supernova (kept piece, still a place) · and up to three stratum
landings (Deepest stratum with members, the shelf, one mid stratum) —
never more than the dock's existing 8-place cap, every label unique.
What disappears: The stair, Terrace, Crystals, Hero lantern (GLB
holders that no longer exist). The dock itself — position, styling,
tiles — is **not touched** (§11); only the place list's contents change,
because the places themselves changed.

Reduced motion: the walk becomes the existing stratified stage holds
(rim → mid → basin) and stratum stepping becomes fades between perches.
Unchanged rule, applied to the new modes.

---

## 8. Purpose & interaction — what you DO here

**The arrival line.** On first arrival per visit, one line in the
existing look-hint slot (not a panel, never repeated once dismissed by
moving): *"Your earliest memories rest below — the deeper, the longer
ago. Walk the stair, or ride the thread."* — adapted when no thread
exists ("…Walk the stair down."). If the brain has a chosen name the
world's title already carries it; the line itself names no names. This
is the world's whole tutorial: one sentence, in-world, then the verbs
teach themselves.

**The verbs** (all on things that already exist as data):

- **Approach a memory.** On a stratum perch (or in overview), tapping a
  member's alcove — its form or its lantern glow — glides the camera to
  it and opens its card: the memory itself, and beneath it the layout's
  own `why` line ("Kept since 2019 — 7 years old, quiet since 2023,
  resting at depth 6 of 9"; for a risen member, its "risen because…"
  line — the explanation machinery exists in `deepPastLayout.ts` today
  and finally gets a surface). The card is the existing memory card /
  focus flow, not a new panel.
- **Read.** Reading *is* the card + the option the app already offers
  elsewhere (tend, link, fly to its other appearances via its anchor
  line). The anchor lines (§1, member → non-member edges) become
  tappable from the card: "This memory also appears at the rim" follows
  the light line. No new systems.
- **Ride a thread stop.** In Chronicle mode, each stop: the thread
  brightens, the bead pulses, the memory at the stop is approachable
  with one tap (approach, above), and the ride waits — indefinitely.
  "Continue" resumes. This is A21 as designed in the recipe; the rework
  wires the stop interaction the recipe promised ("the memory is
  visitable").
- **Find a glimmer.** Relics stay findable (the Deep Past's four, the
  Witness at the basin center in the First Light). The find flow is
  unchanged; its **presentation is fixed** (below).

**Glimmer UI fix (spec).** Replace the per-relic
`<p className="worlds-surface-fallback">` stack in `WorldsSurface.tsx`
with **one prompt region**: a single container in normal flow (its own
class, not the fallback note's), holding at most **3 rows** — one per
visible glimmer, ordered by the traveler's current depth (nearest
stratum first) — each row the existing line ("Something glimmers
{glimmer}.") with its own "Look closer" button; a fourth line, only
when needed: "+2 more below" (count from data). Rows can never overlap:
they are siblings in one column, rendered once per state change. A row
leaves when its find resolves. No other surface changes.

---

## 9. Performance — hard budget, set at the pre-asset weight class

The pre-asset scene ran the whole world on generated geometry: ~30 draw
calls, roughly 25k triangles, 130 points, zero GLB bytes. The shipped
scene measures 102 calls / 618,970 tris / 219,502 points / ~6.2 MB of
GLBs — and trips the app's own lag banner (`App.tsx`: "Soumaya noticed
some lag — switch to Performance Mode?"). The rework's caps are set at
the pre-asset weight class everywhere except where a *singular kept
piece* (§4) honestly costs more — and those costs are named, not hidden:

| Budget | Cap (hard) | Design's own accounting |
|---|---|---|
| Draw calls, whole scene | **≤ 48** | strata+rim merged 2 · stair 1 · trims (in strata merge) · basin floor+ring 2 · dish 1 · shaft 2 · pool glow 1 · orb 1 + halo 1 · spire 1 + glow 1 · supernova 1 · beads instanced 2 · hero orbs 2 + lights 0 · members ≤ 5 (plinths/pads 1, forms ≤3, lantern points 1) · thread 1 · anchors 1 · shelf 2 · snow 1 · motes 1 · ships 1 · relic glimmers ≈ 4–8 → ≈ 40 |
| Triangles, generated architecture | **≤ 45,000** | discs+trims ≈ 8k · stair ≈ 6k · basin floor/ring ≈ 3k · members scale with the brain (forms are 100–600 tris each instanced — the recipe's own allocation: lanterns/members ≤ 60k at fixture counts; the instanced-form cost is per-*instance* geometry shared, so tris counted once per geometry + per-instance in renderer totals is a build-record measurement, asserted against the total cap below) |
| Triangles, whole scene incl. keeps | **≤ 195,000** | keeps: orb 24,576 + dish 22,500 + spire 80,210 + beads 1,597 (instanced, counted once) = 128,873 + generated ≤ 45k + member forms' geometry ≈ 175k worst honest case |
| Points | **≤ 65,000** | supernova ≤ 60,000 (re-slimmed, §4 #5) + motes 130 + snow ≤ 2,000 + member lantern points = member count (points, not tris — the recipe's pattern) |
| GLB bytes loaded by this scene | **≤ 3,700,000** | orb 580,100 + bead 10,200 + dish 239,224 + spire 2,022,672 + supernova ≤ 800,000 (re-slimmed) = ≤ 3,652,196 |
| Real point lights | **≤ 2** | basin key light (§6) + stratum-3 hero orb. Plus ambient + one directional (rim), as today. Spire tip = glow sprite only (its GLB light goes) |
| Materials | generated architecture on Lambert/Basic (the fixture's materials); Standard only on kept GLBs and member forms |

How the design stays inside it: merging (all static generated
architecture is merged geometry — calls are counted in single digits,
not per stratum); instancing for every repeated *generated* element;
points instead of geometry for lanterns, snow, motes, and the
supernova; frustum culling left ON for generated meshes (they are
bounded, unlike the world-spanning instanced GLB layers that forced it
off); additive sprites capped at 4 surfaces (shaft ×2, pool glow, orb
halo) with spans derived from the basin, not free literals.

**The lag banner is an acceptance input, not a surprise** (§10 A5): the
build runs the entry + full walk + full Chronicle ride on the app's own
performance path, and the Performance Mode offer must not appear. If it
does, the fallback ladder from the recipe applies *before* merge, in
order: snow density → motes → supernova density → ship dressing. Never
degraded: resting memories and their lights, the thread, depth banding,
explanations.

---

## 10. Acceptance criteria — a look now gates like a number

Test counts and budgets alone never ship a look again (standing rule
from the 2026-10-29 failure). The build is gated on ALL of:

- **A1 — Composed-scene renders, reviewed before merge.** The build
  produces renders of the *composed scene* (not per-piece checks) at
  phone aspect (390×844) and wide: **(a) Entry** — rim vista: nine gold
  trims winding down, shaft visible, basin glow the brightest object in
  frame; **(b) Mid-descent** — on the walk at ~stratum 4: flights above
  and below visibly continuous, cheek trims unbroken, members resting
  on the disc beside the path; **(c) Basin** — from the final landing:
  dish, orb spinning over the pool, shaft rising out of frame, trim
  ring lit. Each render is compared line-by-line against §5/§6's
  description; **a render that doesn't match the described composition
  stops the build**, the same way a failing test does.
- **A2 — Connection, proven twice.** Derivation tests assert the §5.2
  equalities for all 9 transitions (top step plane == upper floor
  plane; bottom step plane == lower floor plane; angular endpoints
  inside both discs' arcs), AND the mid-descent render (A1b) shows the
  continuous stair a test can't see.
- **A3 — GLB table conformance.** The scene manifest contains exactly
  the §4 KEEPs; an instancing audit asserts no kept GLB is instanced
  except the bead (data markers); removed pieces' holders and placement
  code are gone, not dormant.
- **A4 — Budgets.** Static assertions at §9's caps (the
  `DEEP_PAST_BUDGET` constant is reset to them — 110/620k/220k was the
  failed build's envelope, not a standard) + the built scene's measured
  renderer totals recorded in the build record.
- **A5 — No lag offer.** Entry + full walk + full ride under the app's
  performance monitor: the Performance Mode offer never appears (§9's
  ladder if it does).
- **A6 — Movement.** The walk runs rim → basin uninterrupted; stepping
  off and rejoining works at every stratum; stratum stepping works both
  directions; fly-to shows no duplicate labels and only §7's places;
  reduced-motion holds substitute as specced.
- **A7 — Interaction.** Tapping a member opens its card with its `why`
  line; the arrival line shows once per visit; a thread stop is
  approachable during the ride; the glimmer region renders N finds as
  N non-overlapping rows (DOM assertion + screenshot at N=4).
- **A8 — Basin brightness.** The entry render (A1a) shows the basin
  glow as the frame's brightest region and warm light visibly catching
  the upper discs — the §6 light values are tuned until the render
  shows it, and the render is the evidence.
- **A9 — Semantics untouched.** Strata assignment, membership, the
  rise, thread selection: the layout module's *rules* are unchanged
  (its tests pass unmodified except the geometry constants and budget
  pin); relic anchors re-derived from basin-radius fractions, relic
  visibility still registers all four Deep Past relics.
- **A10 — HUD untouched.** The build's diff contains no change to the
  Persistent HUD (`App.tsx`'s top buttons) and no restyle/reposition of
  the world dock; the only navigation change is the fly-to place *list*
  (§7), which is content, not chrome.
- **A11 — Full gate.** Typecheck + build clean; web suites in both
  timezones (America/New_York, Pacific/Kiritimati) at the standing
  standard; any failure proven pre-existing on pristine main before it
  is called baseline.
- **A12 — The owner's phone verdict is the final gate** (PENDING-OWNER
  by design, as A8 was): the merge may be fully green and still wait
  for his eyes. His "looks horrible" outranks every number in this
  note — that is the lesson of the build this note replaces.

---

## 11. Invariants and non-goals

- Deep Past stays **PRIVATE**. Strata assignment and member semantics
  unchanged — this note is presentation, architecture, and in-world
  movement only.
- **The top buttons / Persistent HUD are perfect as-is (owner's
  words): not touched, moved, or restyled.** The world dock keeps its
  position and styling; only the fly-to list's contents change (§7).
- Name-bearing UI uses the brain's own chosen name, never a hardcoded
  one. No UTC in anything user-facing — stratum labels phrase years and
  dates in the viewer's local calendar.
- Never-punish: in-world movement is free, pausable forever, resumable;
  nothing decays, nothing is lost for stopping.
- The brain stays authoritative; the world stays a view. An empty brain
  still renders the helix, the basin, and the sky honestly (the current
  scene's rule, kept).
- Out of scope: the other five worlds (their GLB dressing is their own
  lanes' business — this note's no-repeat rule is stated for Deep Past,
  where the owner stated it); inter-world travel and fuel; the relic
  system beyond §8's presentation fix; any server/schema change (none
  is needed — the layout already computes everything this design
  renders).

---

## 12. Flagged for the owner's veto

- **V1 — Basin dish KEEP.** It is singular but structural. Kept for the
  reasons in §4 #3; say the word and the basin becomes generated floor
  + pool glow only, and the dish leaves with the other architecture.
- **V2 — "The other ball shaped thing" = the route bead** (§4.1). The
  supernova remnant is the alternate reading; both are kept either way.
- **V3 — Hero lantern GLB removed** in favor of the fixture's generated
  hero orbs (§4 #9). Singular, so the rule doesn't force this — it's a
  design call (painted glow + bolted-on light vs the design's own orb
  vocabulary). Veto restores the one hero lantern at stratum 3.
- **V4 — Supernova kept but re-slimmed** to ≤60,000 points in one cloud
  (§4 #5). The current file's 216,902 points / 34 calls is the lag; the
  re-slim is part of the keep. Veto = keep the file exactly as-is and
  accept the points budget rising to ~222k with the ladder (§9) armed.
- **V5 — Spire kept at 80,210 tris as-is.** A verify-first re-slim to
  ≤40k would cut the scene's triangle total by ~40k and is recommended
  if the render check passes; as-is is the default because his pieces
  have earned suspicion of re-slims this week.
- **V6 — Scale ×1** (§3). The world becomes intimate. Every other
  choice in this note is built on this one; vetoing it re-opens §5's
  proportions (the stair math is scale-free — it is derived, not
  fitted — but step proportions and light distances would need
  re-settling at the chosen scale).
- **V7 — Fly-to kept as a shortcut** with generated places (§7). If he
  wants it gone entirely — walk or ride, no teleporting inside the
  world — the dock group empties and the design still stands.
- **V8 — Crystals out entirely**, no generated replacement (§4 #10).

---

## Appendix — sources cited

- Pre-asset scene: `~/workspace/worlds-vision/mockups/deep-past/index.html`
  (= `~/workspace/worlds-vision/builds/deep-past.mjs`): helix lines
  239–257; lantern field 258–280; basin + shaft + motes 281–342; hero
  orbs 447–467; thread 519–530. Swap history: mockup `README.md`
  (pieces 1–5, 2026-10-26; D-30 status note).
- Design constitution: `~/workspace/worlds-vision/recipe-deep-past.md`
  (owner-settled 2026-10-22): form, light, silhouette, R-D4 allocations,
  fallback ladder, A21/A22.
- Shipped app @ main `ad243423`: `packages/web/src/graph/
  deepPastLayout.ts` (geometry constants, budget constant, layout
  rules), `deepPastAssets.ts` (manifest, instance counts, measured
  tris), `deepPastScene.ts` (walls without floors, basin light
  2.2/500, descent derivation), `packages/web/src/graph/
  worldPlaces.ts` (PLACE_RULES deep-past), `packages/web/src/
  components/WorldsSurface.tsx` (glimmer stack ~lines 2158–2167, dock
  groups ~2009–2036, look hint ~2139), `packages/web/src/App.tsx`
  (lag offer ~line 2378).
- The failed build: `~/workspace/worlds-vision/
  deep-past-fix-design-note.md` + `deep-past-fix-build-record.md`
  (measured scene budget §4: 467,558 GLB tris · 71 GLB calls ·
  216,902 points; scene total 102 calls / 618,970 tris / 219,502
  points) — this note supersedes both for Deep Past's look.
