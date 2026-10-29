# Growing Place v2: a garden you walk, built from your Journeys

**Status:** APPROVED by the owner 2026-10-29 ("Yes to Seed Pods, paused under mist, last 30 days"). Building in the steps below.
**Written:** 2026-10-29 · **Owner decisions captured:** 2026-10-29 (listed under "Settled by the owner").
**Supersedes, for content and movement only:** P3-1's "plots for every eligible node, by age". The recipe's identity and
constitution still hold: dawn light, the witness tree, terraces, the kindness rule, and changes only through the rail.

## Why

The owner's verdict on v1 is that it is "sorta no real use compared to your home galaxy … redundant … needs to not act as a
scene but a space you can move and travel around in", while still serving what the world is for.

He is right, and the cause is in the code. `buildGardenLayout` places **every eligible memory** as a plot. That is the same
set the galaxy shows, only sorted by age. The recipe's settled purpose (§12 / D-4) was different all along: *goals,
milestones, and the memories linked to them*. v1 never delivered it.

## Settled by the owner (2026-10-29)

| Question | Answer |
|---|---|
| What lives here | **Journeys plus loose memories.** Each Journey is a grove. Memories that belong to no Journey grow wild in a meadow, and you can carry them into a grove. |
| Movement | **Tap the ground to walk.** Soumaya glides along the paths to the tapped spot and the camera follows. Tapping a grove's name travels there. |
| Actions in a grove | **All four:** tend a mission, plant a next step, place a memory, ask Soumaya here. |
| Plus | **"Something unique and fun, game style, for this world"** (proposed below as Seed Pods). |

## The world

```
                 crown: the witness tree (the oldest light, unchanged)
          ┌───────────── grove ─────────────┐
   grove ─┤  paths link groves the way       ├─ grove      one grove per active/paused Journey,
          │  Journeys share memories         │             on the terraces, seeded placement
          └───────────── grove ─────────────┘
        the meadow (lowest terrace, where you arrive): loose memories growing wild + Seed Pods
```

- **Grove = one Journey** (status `active` or `paused`). A `done` Journey stays as a completed grove, crowned in gold and
  never removed.
  - At its centre is the **Journey tree**. It grows one visible ring or branch tier per completed mission
    (`missionsCompleted`), and only ever upward (kindness rule).
  - Its name and icon float on a sign you can tap to travel there.
  - Its accent colour tints the grove's flowers, always **paired with the icon and name**, never colour alone.
- **Missions = sprouts** in the grove: the action nodes linked to the Journey (`kind` `task` or `node`). A completed mission
  is a flowering plant. An open one is a sprout. An untouched one is "resting ground", never wilted.
- **Linked memories = stones** along the grove's path, the evidence that already exists today (§13 P3).
- **Milestones = landmarks** that rise. This keeps the existing rail and mutation path exactly as it is.
- **Paths between groves** = Journeys that share at least one linked memory. These are confirmed links only. Nothing is
  inferred.
- **The meadow** is the arrival terrace. It holds memories that link to no Journey, as low wildflowers. To keep the frame
  rate on a phone it shows only those from the last 30 days (owner, 2026-10-29), with a 120 safety ceiling. This is the one place where the
  galaxy's content appears, and it appears for a purpose, which is to be given a home.

Rule kept from v1: nothing is placed, sized or lit by importance, strength or degree, except that a tree's height counts
**completed missions**, which is the Journey's own progress and only grows.

## Movement: tap to walk

- **Walkable ground** is the terrace tops plus ramps between terraces. Paths are drawn as gold trails. It is a simple
  analytic "navmesh" (rings + ramps): no library, and no route that leads off the world.
- **Tap the ground:** Soumaya's ship skims along the route at ~4 m above the ground, and the camera follows behind and
  above her.
- **Tap an object** (a sprout, stone, wildflower, pod or sign): she walks there and the object's sheet opens on arrival.
- **Drag** turns the view around her, **pinch** zooms (both reusing `worldLook.ts`), and **double-tap** recentres.
- **Grove list chip** (top-left, "🌳 Groves ▾"): pick a Journey to glide there. Under reduced motion she jumps there
  instantly instead of gliding.
- The camera never goes below the ground (the `cameraFloorY` clamp is kept).

## Actions (all in one bottom sheet, opened at the thing you tapped)

| Where | Action | Existing API used |
|---|---|---|
| Sprout | **Tend**: mark progress or done. The sprout flowers and the tree grows a tier. | `PATCH /api/nodes/:id` completing the action node, which already auto-credits the Journey (IM-140, `creditCompletedMission`); garden `POST /api/garden/tend` for the warm glow |
| Grove ground | **Plant a next step**: type a step, a seed is planted, and it becomes a mission linked to this Journey. | create action node (`/api/nodes`) + `POST /api/journeys/:id/link` (kind `task`) |
| Wildflower or stone | **Carry**: pick it up (it follows the ship), walk to a grove, and **place** it to link it. | `POST /api/journeys/:id/link` (kind `node`); the server's `/suggest/node/:id` offers the likely grove first |
| Anywhere in a grove | **Ask Soumaya here**: chat scoped to this Journey. | `POST /api/chat` with `journeyId` (already supported) |

Every write goes through the existing validated routes. **No new route contracts and no schema change** are needed for
the core loop. The one possible exception is the Seed Pod "caught today" counter, which can be derived from the review log.

## The game: Seed Pods (the "unique and fun" part)

The north star says memory is made by **retrieval**, not storage. This makes that a game that only this world has.

- Memories that are **due for review** (`GET /api/review/due`) ripen in the meadow and groves as **glowing seed pods**
  that drift gently above the ground. There are up to 5 a day, so it stays a snack and not a chore.
- **Catch one:** walk Soumaya into it, or tap it. She asks a light recall question in her own voice ("Do you remember what
  you decided about …?"). You choose:
  - **"I remember"**: the pod bursts into a bloom that plants itself. If the memory belongs to a Journey, it plants in that
    Journey's grove, and that grove's flowers spread a little.
  - **"Show me"**: the memory is revealed, then you grade it. This is the existing review flow.
  - **"Not today"**: the pod drifts off softly and comes back another day. It never wilts and never costs anything.
- Each catch grades the review (`POST /api/review/:id`), so the real spaced-repetition schedule moves. The game *is* the
  review, not a copy of it.
- **The day's harvest:** a small row of 5 pod icons in the corner fills as you catch them. When all are caught, the
  witness tree releases a brief shower of gold motes over the garden (a still glow under reduced motion).
  - There are no streaks, no losses and no "you missed yesterday" (kindness rule).
  - Caught counts are shown with number + icon, never colour alone.

Why this one: it is the highest-leverage feature in `NEURO_ALIGNMENT.md` (gentle active recall in Soumaya's voice, never
Anki decks), it needs only APIs that already exist, and it gives the garden a reason to visit daily that the galaxy does
not have.

## Budgets and rules

- ≤ 95 draw calls and ≤ 700k tris (recipe).
  - Each kind of object is one instanced mesh (sprouts, flowers, stones, wildflowers, pods), whatever the count.
  - Grove trees are one instanced trunk + one instanced canopy.
  - Labels exist only for nearby groves.
- Reduced motion:
  - The glide becomes a jump.
  - Pods and motes are still.
  - Sway is off.
  - Growth shows its end state with a soft fade, never a pop.
- Offline: everything works with the heuristic LLM. Soumaya's recall line falls back to a template ("Do you remember
  *‹label›*?").
- Kindness rule: no wilting, browning, fading or loss, anywhere. "Not today" is always free.
- Every object answers "why is this here?" (P6) in its sheet: "A mission of *Run a 10k*", "Due for recall today", and so on.

## Build plan (each step ships on its own, gate green, verified in a real browser at 412×915)

1. **Layout v2** (pure, tested): `buildGardenLayoutV2(graph, journeys, links, due)` → groves, sprouts, stones, meadow, pods
   and paths. Deterministic and seeded. Tests pin: no Journey ⇒ meadow only; done Journeys stay; nothing driven by
   importance; meadow = last 30 days (≤ 120); pods ≤ 5.
2. **Walk:** walkable rings + ramps, tap-to-walk glide, camera follow, grove list chip, and object sheets. Tests cover route
   math (never off-world, never through the tree) and tap-vs-drag.
3. **Grove actions:** tend, plant, carry/place, and ask here, wired to the existing routes. Each has a component test
   against mocked routes.
4. **Seed Pods:** due → pods, catch → recall sheet → grade, the harvest row, and the gold shower.
5. **Retire v1's "every memory by age" plots.** Their tend/glow/mutation machinery is reused for sprouts and stones and is
   not deleted.

Each step adds a CLAUDE.md Pending Validation line for on-device confirmation.

## Answered by the owner (2026-10-29)

1. **Seed Pods**: approved as the world's game.
2. **Paused Journeys**: their groves rest **under mist**. They stay soft, quiet and alive, and never wilt.
3. **Meadow**: shows loose memories from the **last 30 days** (replaces the cap of 60; a hard ceiling of 120 stays only as a
   frame-rate safety net, with the rest summarised).
