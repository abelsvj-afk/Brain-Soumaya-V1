# Environment Recipe — The People (Phase 3, P3-3)

**Status:** Recipe for the P3-3 build, filed with the build (branch `worlds/p3-3-people`).
Settled ground: P3-3 design note Rev 122 (`docs/worlds/people-design-note.md`,
design branch `design/worlds-vision` @ `48d8ece5`); Q1–Q7 settled by the
build-all delegation (2026-10-26 evening — the owner's "build it all" order,
which suspended the per-increment tap ritual). **Scope:** the People space
only. Nothing here authorizes a merge or a deploy.

## Settlements (Q1–Q7, by the build-all delegation)

- **Q1 Gate threshold:** the People gate appears when the brain holds **≥3
  people with ≥2 linked memories each, plus ≥1 memory shared between two
  people**. Enforced server-side (`TravelRepo.peopleGateOpen`, re-checked
  against the database on every departure); the route board offers People
  only when the server's travel state says the gate is open.
- **Q2 Station connection:** People **orbits the Station as a close moon** —
  a short hop from the Station (direct gate from the Station once discovered)
  plus a direct gate from home once discovered; the Station stays the
  guaranteed fallback route. Travel between any two chart worlds is already
  permitted, so no new route mechanism was needed; the map places People
  beside the Station (845, 335).
- **Q3 Who counts:** every person the brain knows with **≥1 linked memory**
  gets one cluster; **strictly one cluster per person** — no shared family
  treatment, no kids-as-a-circle, no brothers together.
- **Q4 Archived people:** archiving removes the cluster from People entirely;
  the material rests in Quiet/Archive. Quiet/Archive has not landed yet, so
  for now archived people simply have no cluster; the archive path is wired
  when Quiet lands (the graph payload already excludes archived rows, and the
  layout excludes them again in defense in depth).
- **Q5 Other travelers:** **never** — People is private by definition; no
  other real user's ship ever enters, no NPC people ever stand in.
- **Q6 Recipe:** warm clustered orbits, amber-warm light on dark, seed
  `people / first-circle-1`. This file.
- **Q7 Open threads and dates:** shown as quiet notes/dates in the cluster,
  no badges, no overdue states, all dates in local time.

## 1. Identity & visual grammar

**One-line identity:** *The people of your life, gathered warm — who is with
you, and what do you owe each other?*

**Form:** a **warm field of clusters** — like lights in a neighborhood at
dusk. Each person is a small system of their own: a warm hearth with their
shared memories, notes, dates that matter, and open threads orbiting it as
lights. Travel between people shows how relationships connect: a memory
shared between two people is a fine **bridge of light** between their
clusters. The field is walked among, not flown through at speed — you arrive
at the field's edge and the clusters open outward.

**Seed & palette:**
- **Seed string:** `people / first-circle-1` — cluster placement and light
  scatter derive deterministically from it.
- **Key light:** the hearths themselves — each cluster carries its own small
  warm amber glow (real: the glow marks a real person with real linked
  memories). Ambient light is low and calm. Distinct on sight from harbor
  amber (industrial, horizontal), garden dawn (green, upward), and Deep Past
  violet (vertical, quiet): this world is *amber, low, and near*.
- **Backdrop:** no sky — the field is the subject; beyond it, darkness
  textured with slow ember motes and the faintest HYG points far above.
- **Silhouette:** the field itself — a spread of warm hearths, read in one
  look from the arrival edge.

**The kindness rule (this space's constitution):** warmth is **never** a
score. A quiet cluster is a resting person, never a neglected one. No
scores, no judgments, no comparisons, no "last contacted X days ago"
counters, no red badges, no overdue states, no contact suggestions, no
guilt mechanics. Absence changes nothing — People is identical on return,
no dimming, no thinning, no "while you were away" state. A person with no
bridges stands alone, honestly — alone is not lesser.

**The non-ranking rule, per visual channel (P3-1 precedent):** importance,
review strength, progress, emotional weight, and degree must NOT drive
cluster size, brightness, color, height, density, or orbit emphasis. A
cluster's form says *what kind of thing it is* — never *how much it
matters*. The count of memory-lights orbiting a cluster is a true count of
linked memories — a fact, not a judgment — and is the only thing that varies
between clusters.

## 2. Spatial composition

- **Arrival vista:** you arrive at the edge of a warm field — clusters spread
  before you like lights in a neighborhood at dusk, each a warm central
  presence with its memory-lights in slow orbit.
- **Camera:** arrival at the field's edge (orbit radius 700, height 140),
  clusters opening outward. Reduced motion: the field *held* — no orbit
  drift, no sway; information identical.
- **Placement:** deterministic seeded placement (mulberry32 over recipe seed
  + person id) — same person, same place, every visit, every device. Field
  radius 560; light orbit radius 12–30 around each hearth.
- **Ground:** a warm dark disc, finished in every direction the camera can
  reach — the bottom is ground, never a void (C9).
- **Ships:** the traveler's own ship appears in transit as usual. A few small
  silent procedural hulls drift outside the clusters as set dressing (P3-2
  precedent). **No NPC people, ever** — a stranger standing in for a real
  person would be a lie in this space.

## 3. Meaningful content & visual honesty

- **Membership:** a cluster exists for every person the brain knows with ≥1
  linked memory. A "person" is a graph node the brain knows AS a person:
  `kind === "person_entity"` (the tracked person, Cognitive Layer Phase 6 —
  the Mind tab roster) or extraction-typed `type === "person"` (legacy
  `relationship_reflection` included via `normalizeNodeType`). There is no
  separate people table — people ARE graph nodes, and their linked memories
  are the graph's edges incident to them. People with no linked memories get
  no cluster — nothing is invented for a name alone.
- **Lights:** every linked non-person node is a light in its person's orbit.
  Form by kind, never by rank: memory (warm sphere), open thread (pale cone
  — a linked `kind === "action"` node still open), date that matters (gold
  ring — a linked memory with `occurredAt`), gathering hub (cream ring —
  a `moc` hub).
- **Dates & threads (Q7):** dates that matter rest in the cluster as quiet
  dates — the person's own `occurredAt`, and each linked memory's
  `occurredAt` carried on its light. Open threads rest as quiet notes.
  All dates are stored as ISO strings and displayed in the viewer's own
  local time — **NO UTC in anything user-facing, ever**. No countdowns,
  no "missed" states.
- **Bridges:** a memory shared between two people (or a direct edge between
  two people) renders as a fine bridge of light between the clusters. Edges
  with missing or excluded endpoints are omitted, never drawn to an invented
  endpoint.
- **Touching a presence** surfaces the person through the app's existing
  memory mechanisms (the same focus/citation path the galaxy uses) — reuse,
  never a parallel viewer. (Same limitation as P3-1/P3-2: touch-to-focus is
  not implemented in the surface in this increment.)
- **Empty or young brain:** the field stands with its warmth and its empty
  ground — honestly unfilled, quietly lit. A brain with one person holds one
  cluster, warmly, not a locked door. People never fabricates a person to
  look fuller.
- **Graph load fails:** the app-level recovery screen is the honest error +
  retry path (P3-2 precedent — no new prop). A failed fetch is never
  presented as an empty field.
- **Privacy:** People is PRIVATE (PUBLIC = Great Station + Scale only).
  Only the owner ever sees it.

## 4. Performance & accessibility budget (against §11.2's fixed ceilings)

Ceilings: ≤200 draw calls · ≤750k triangles (**hard rejection boundary, not
a target**) · textures ≤1K (hero ≤2K) · cold load ≤5 s · ≥50 fps avg /
≥30 fps 1%-low.

**Proposed allocation:**

| Consumer | Draw calls | Triangles | Notes |
|---|---|---|---|
| Field ground + outer ring | ≤2 | ≤1k | Warm dark disc, finished in every direction |
| Cluster hearths + hearth glows | ≤2 | ≤20k | One instanced sphere + one glow Points per field |
| Memory-lights (4 forms, instanced) | ≤4 | ≤290k | Heaviest form 144 tris × 2,000 lights |
| Bridges of light | ≤1 | 0 | LineSegments |
| Ember motes + HYG sky | ≤2 | 0 | Points, atmosphere only |
| Dressing ships | ≤1 | ≤1k | 3 procedural hulls, outside the clusters |
| **Total** | **≤12** | **≤400k planned** | Deliberately light — warmth is light and air, not geometry |

**Accessibility:** reduced motion = the field held — no light orbit, no mote
rise, no ship drift; the same clusters, lights, and bridges, identical
information. Warmth is carried by form and labels, never by motion alone.

## 5. Animation inventory slice (§14.1 fields; combined load + fallback)

| # | Animation | Trigger | Actors | Motion (plain) | Duration | Reduced-motion equivalent | Cost |
|---|---|---|---|---|---|---|---|
| P1 | Light orbit | Always (ambient) | Memory-lights | Lights circle their hearth slowly | Continuous | Held | Cheap |
| P2 | Ember motes | Always (ambient) | World | Warm motes rise slowly and wrap | Continuous | Static | Cheap |
| P3 | Dressing ships | Always (ambient) | Ships | Small hulls drift slow circles outside the clusters | Continuous | Held | Cheap |
| P4 | First arrival | First ever visit | World | The field's lights warm up from the edge inward | Sequence | Single gentle fade-in | Cheap |

**Combined load (worst honest case):** light orbit + mote rise + ship drift
simultaneously. **Fallback ladder:** mote density → ship detail → hearth
glow size. **Never degraded:** clusters, lights, bridges, ground.
**Interruption:** leaving mid-visit parks nothing — the field re-derives
from the live graph on the next visit; a change mid-visit is a quiet
re-derivation, never an animation of loss.

## 6. Shared vs distinct (D-18)

**Shared:** ship + gate language · memory objects and their identity ·
explanations (P6 `why` lines) · anchor grammar (bridges are D-8's fine
lines of light, between people) · UI voice/naming.
**Distinct:** the warm field silhouette · amber-warm light on dark · the
cluster as the spatial sentence (one person, one hearth) · bridges as
visible relationships · the kindness rule as rendering constitution.

## 7. What People deliberately does NOT do

- No relationship health score, no judgments, no comparisons, no rankings.
- No social feed, no activity stream, no "what they've been up to."
- No contact suggestions, no reminders to reach out, no guilt mechanics.
- No messaging, no contact actions — People is a place to remember, not a
  place to act. Anything the owner wants to do about a person happens in the
  brain, not in the world.
- No NPC people, no invented people, no stand-ins, no faces, no figures.
- Nothing in People may ever affect access to memories, drift, or return home.
- Nothing is edited from People (§17 rail boundary — Phase 4).
