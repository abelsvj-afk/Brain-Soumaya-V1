# Phase 3 · P3-1 Design Note — The Growing Place (first memory-bearing world)

**Status:** SETTLED + BUILD AUTHORIZED (owner, 2026-10-24, D-61 — terrace convention approved; "Continue"). Build in progress on branch `worlds/p3-1-garden`; ships dark. Record `chatgpt-review-27.md`; reconciliation filed as design-doc Rev 79 (D-60). Relay package `phase-3-p3-1-review-relay.md`; review record `chatgpt-review-27.md`. Phase 3 OPENED by the owner 2026-10-23 ("Start number 2"); per D-23 the Growing Place is Phase 3's first world. Q1 settled (B, D-59). **No implementation is authorized by this note.** P3-1, when built, ships dark behind the same flag; the Phase 2 launch sequence is unchanged and still the owner's separate call.

**What P3-1 is:** the first world that shows *memories*. The Station (D-5) surfaces journeys and routes; the Growing Place surfaces the brain's own becoming — real memories resting as evidence, real connections drawn as paths, real completed chapters standing as landmarks — inside the settled garden: terraced arcs under eternal dawn, one colossal witness tree, and the kindness rule over everything (nothing wilts, browns, or dies, ever).

---

## 1. Settled ground this note obeys

- **The recipe** (`recipe-growing-place.md`, settled D-26): form/palette/seed `growing-place / first-light-1`; fixed dawn (R-G4); budget **≤95 draw calls / ≤700k triangles planned**; backdrop = HYG stars *dimmed by dawn*.
- **R-G3 (the mapping constraint):** landmark mapping is deterministic and **non-ranking**; unmapped milestones are neutral/unrendered, never guessed.
- **§13 P3 surfacing:** landmarks are *milestones*; memories appear as the evidence/path between them. A plot or path must be able to answer "why are you here?" with the real thing it stands for.
- **§17 rail boundary:** world *structure* changes only through the propose→decide→apply rail — that rail is Phase 4. P3-1 therefore **renders** brain facts; it creates no world-side structural state of its own.
- **Never-punish / kindness rule:** an untouched plot is *resting ground*; an empty garden is honest ground, never a shaming one. No numbers wearing costumes — no progress-bar hedges.
- **Non-ranking rule, per visual channel (review 27):** importance, review strength, progress, emotional weight, and degree must NOT drive plot size, brightness, color, height, density, terrace, or path emphasis — not explicitly, not implicitly. The only placement inputs are age band (chronology) and seeded position (deterministic scatter). A plot's form may say *what kind of thing it is* (memory / action / belief / goal / map) — never *how much it matters*.
- **The cross-phase invariant (P2-4):** nothing about a world may ever affect the ability to access memories, drift, or return home.

## 2. Recon facts (builder-verified in the repo, 2026-10-23)

- Travel admits exactly two worlds: server `TRAVEL_WORLD_KEYS = ["home", "great-station"]` (travel.repo.ts) mirrored by the client chart `WORLD_CHART` (routeBoard.ts). Adding a destination is a known, small, two-sided change — the P2-2/P2-3 pattern.
- `WorldsSurface` (P2-4) mounts exactly one scene (`createStationScene`) when state says "great-station". A second world needs scene *selection*, not a second surface.
- **The web client already loads the brain's graph** for the home galaxy: `getGraph()` → `GraphData { nodes, edges }` (api/client.ts), plus `/graph/edges`. The garden's plots and paths can derive from this same real data — **no new server surface is required for the evidence layer.**
- **The brain already has Journeys** — life chapters the user creates, links objects to, and marks `active / paused / done`, with user-set progress (shared `Journey` type; api/journeys.ts). A journey the user has marked **done** is a user-confirmed completion recorded in the brain itself.
- The Phase 1 mockup (owner-passed, D-29) proves the garden's grammar at budget in a single 33 KB scene: terraces, witness tree, instanced vegetation, A7 connection-forming, A6 landmark-rising, A1–A3 carry-and-place. It is the scene's starting point, as the Station scaffold was for P2-3.
- The HYG starfield module (P2-3/F-02) is reusable as the garden's dimmed dawn sky — same data, presentation-dimmed per the recipe.

## 2.5 The home galaxy vs the garden — same data, different question (verified against the real galaxy)

The owner asked that this be understood properly before anything is built, so it was checked against the galaxy's actual code (`graph/Graph3D.tsx`, `shared/types.ts` `GraphNode`, `graph/journeyHubs.ts`, `graph/sun.ts`, `graph/fleet.ts`), not assumed.

**The home galaxy is the brain itself, working.** It renders the same graph as a sky: every node is a body whose class (star / planet / moon) comes from its derived mass (importance, degree, emotional weight); a node's spaced-repetition strength drives its brightness; Journey hubs, the money sky, and the fleet (Escort, scouts, defenders, tenders — followable) are layers over it; a sun sits at the center with its own proximity rules, and rank-ups fire celebratory salvos around it. You **work** there: click a star, read it, act on it, navigate by citation. It is the second brain's home, settled design, and **worlds work never touches it** (D-48).

**The garden is the same data, asked a different question.** The galaxy answers *"what do I know, and how does it connect?"* The garden answers *"what is it all adding up to?"* — and it answers by arrangement, not by a second truth:

| | Home galaxy | The garden |
|---|---|---|
| What it is | The brain, working — sky | A visit — ground you stand on |
| Space | Free 3D, bodies by mass, sun at center | Terraces rising to one tree; dawn, no sun |
| What a node is | A star/planet/moon, brightness by review strength | A plot of resting ground, placed by age and seeded position |
| What a link is | A constellation line | A path of light between two plots |
| What a journey is | A hub in the sky (isolatable layer) | A standing landmark — **only** when the user marked it done (Q1, settled B) |
| What you do there | Read, navigate, act (tools, chat, fleet) | Walk through what it adds up to; nothing is edited from the garden |
| What it stores | The brain | Nothing — it re-reads the brain on every visit |

Three guardrails this comparison sets for the build:

1. **One truth, two arrangements.** The galaxy already encodes progress (goal nodes carry `progress`), strength (brightness), and importance (body class). The garden must never re-encode the same signal differently — no progress-bar hedges, no second brightness. A goal's progress is shown, if at all, as a number in words; the garden's structure comes only from what the brain confirms (a journey done, a link real).
2. **The garden is a lens, not a second brain.** It adds no node, no link, no edit surface. Delete a memory in the brain and its plot is gone next visit. This is the failure-independence invariant stated for this world.
3. **Sky vs ground is the identity.** The galaxy is flown through; the garden is walked in. If a garden scene starts to feel like a second galaxy — stars, orbits, a sun — it has lost the plot (literally) and the design is wrong.

## 3. Design

### 3.1 Travel extension
- Server allow-list gains `"growing-place"`; the client chart gains the matching entry (name "The Growing Place"; blurb in plain language). Same economy: warp 10, drift free, bonuses exactly as P2-4 settled — **no economy change**.
- `WorldsSurface` generalizes to a small scene registry keyed by the current world: `great-station` → Station scene, `growing-place` → garden scene. Title, close (view-only), credits, WebGL-failure honesty: unchanged behavior per world.

### 3.2 The garden scene (product code)
- New modules beside the Station's: a layout module (deterministic garden math under the recipe seed; budget constants ≤95 calls / ≤700k tris, test-asserted like `stationLayout`) and a scene module (terraces, witness tree, instanced vegetation, dawn light, dimmed HYG sky, mist planes — baked glow only, no post-processing, per the settled stack).
- Camera: the arrival vista from the mockup (settle at the lowest terrace, garden opening upward, tree off-axis). Reduced motion: the garden *held* — no sway, no drift; information identical (recipe §4).

### 3.3 Content mapping — evidence, paths (the heart of P3-1)

**Eligibility contract (review 27, finding 2).** A plot exists for every node in the *eligible set*, defined exactly:
- **Eligible:** `status` active (or absent — active is the default) AND `kind` in {memory, action, belief, cognitive kinds (goal / idea / skill / …)} AND maps-of-content (`moc`) hubs, rendered distinctly as *gathering plots* (a map is a real thing the brain keeps; it stands for its member set, never for itself alone).
- **Excluded, deliberately:** `status` archived (the type's own rule: archived "rests out of the galaxy + retrieval" — the garden follows the galaxy here); nothing else is excluded.
- **Counts reconcile against the eligible set, never against all graph nodes.** Exclusions are deliberate and testable: a test asserts the eligible count for a fixture graph and the plot count equals it exactly.
- **Form by kind, never by rank:** a plot's shape/label says what kind of thing it is. Size, brightness, color, and height are the same across kinds (see the non-ranking rule, §1).

**Plots.** The garden renders the graph data the app holds — the same window the home galaxy sees (build record, D-62). When the brain outgrows the galaxy's fetch window, garden and galaxy see the same window: one truth, shared, never a second fetch. Placement is a deterministic function of the node itself. **Terrace band by age** (proposed convention, owner confirms at settlement): you arrive at the lowest terrace — the present — and climb toward the crown, where the oldest light lives under the witness tree. Chronology only; no band reads as superior, and the review cases (§4 C3) check exactly that. **Placement timestamp** is the node's creation timestamp as exposed by the graph payload — to be confirmed at build recon; fallbacks, in order: `lastTendedAt`, then node-id order as the final tie-break. A node with no usable timestamp rests on the arrival terrace — never guessed, never hidden. **Position within a band** is seeded (mulberry32 over recipe seed + node id) — same node, same place, every visit, every device.

**Scale strategy (review 27, finding 1).** "All eligible memories as plots" is retained — the garden never silently discards a memory — with an explicit rendering strategy: instanced plots (one InstancedMesh per kind-form), batched paths, level of detail by distance (distant plots render as instanced markers that remain individually inspectable on approach — aggregation is a *presentation* technique, never deletion). A large-graph fixture (synthetic graph, ~2,000 nodes) is part of the build gate (see §4 C4). No plot is ever dropped because the camera is far away.

**Paths.** Every graph edge renders as a path of soft light between its two plots. *Recon caveat, stated plainly:* the graph payload does not visibly distinguish *confirmed* from *suggested* connections — so P3-1 renders the connections that exist and claims nothing finer. The recipe's faint-hypothesis trail (tier ii) is **deferred** until the data carries the distinction; inventing it would violate the honesty rule. **Edge semantics (review 27, finding 6):** at build recon the builder verifies what the edge payload actually means (a real relationship, both endpoints present); edges whose endpoints are excluded from the plot set or missing are **omitted** — never rendered with an invented endpoint, never drawn to imply a confirmation the data does not establish. The verification is recorded in the build record.

**Touching a plot** surfaces its memory through the app's existing memory mechanisms (the same focus/citation path the galaxy uses) — reuse, never a parallel viewer.

**Empty or young brain:** terraces stand as resting ground — honestly unplanted, quietly lit. The garden never fabricates a plot to look fuller.

### 3.6 Loading, error, and staleness behavior (review 27, findings 10–11)

- **Graph load fails:** the garden renders an honest error with a retry path — **never an empty garden**. A failed fetch presented as an empty brain would be a technically plausible but emotionally misleading result, and it is forbidden by name.
- **Inconsistent data:** edges with missing/excluded endpoints are omitted (see §3.3); stale references are dropped from the render, never drawn as ghosts. If the data is unusable as a whole, the error state above applies.
- **Data changes while visiting:** the garden re-derives from the live graph on data change (the same refresh the galaxy already performs); a plot's disappearance mid-visit is a quiet re-derivation, never an animation of loss — nothing in the garden is ever shown wilting or leaving.
- **Long absence / bad week:** the garden is identical on return. Absence changes nothing — no dimming, no thinning, no "while you were away" state. Review cases in §4 C3 verify this.

### 3.4 Landmarks — settled: presence-only for completed Journeys (Q1 = B, D-59)
Landmarks are milestones, and milestones are structural (§17) — but the garden in P3-1 *renders*; it does not *decide*. Two honest readings:
- **(A) Defer landmarks entirely to Phase 4.** P3-1 ships terraces + plots + paths only; landmarks arrive with the rail, rising animation and all.
- **(B) Presence-only landmarks for user-completed Journeys.** A journey the user themselves marked **done** in the brain is a user-confirmed milestone already recorded; the garden renders a standing landmark for it (deterministic placement, form by the recipe's grammar, can answer "why are you here?" with the journey's title). **No rising animation** — A6 stays Phase 4, when a completion can be *celebrated* through the rail; in P3-1 the landmark is simply, truthfully, *there*, the way a plot is there. Nothing is inferred: active/paused journeys render nothing (non-ranking, unmapped = unrendered, per R-G3).
**SETTLED by the owner 2026-10-24 (D-59): (B).** Landmarks render, presence-only, for Journeys the user has marked done in the brain — the garden's translation of the galaxy's journey hubs, filtered to done, rendered in garden grammar. It grounds every landmark in the user's own confirmed record, applies nothing, stores nothing, and keeps the rising ceremony for the phase that owns it.

### 3.5 Honesty rails (acceptance-level, not aspirations)
- Every rendered plot/path/landmark traces to a real node/edge/journey in the fetched data — testable by construction (the layout consumes only that data).
- The garden derives everything per-visit from live brain data; delete a memory in the brain and its plot is gone next visit (failure-independence: the world holds nothing the brain doesn't).
- No streaks, no decline, no "your garden missed you." Absence renders as rest.

## 4. Acceptance criteria (for the build, when authorized)

- **C1 Determinism (specified, review 27 finding 3):** same *logical* graph data → identical garden layout. Canonical input ordering (nodes sorted by id ascending before layout), stable tie-breakers (tied timestamps → id), seeded placement (mulberry32 over recipe seed + node id), deterministic edge routing (path control points derived from endpoint ids only). Tests: shuffled input order, repeated runs, tied timestamps, same fixture across supported runtimes where practical.
- **C2 Traceability (identity-level, review 27 finding 4):** every rendered plot carries its source node ID; every path records its source edge ID and both endpoint IDs; every landmark records its completed Journey ID. Tests assert identity correspondence — not just totals — including duplicate nodes, missing endpoints, and stale references.
- **C3 Kindness (review cases, review 27 findings 9, 11):** no rendering state represents decline, death, or neglect — by construction (no such state exists in the scene's vocabulary) **and by review case**: long absence, bad-week use, archived memories, reduced motion, empty brain, one memory, disconnected graph. Absence never changes the world into a visibly worse state; accessibility preserves the same information.
- **C4 Budget — static and measured (review 27 findings 7, 8):** *Static:* layout/scene constants assert the recipe budget (≤95 calls, ≤700k planned tris). *Measured:* on a defined representative device (the owner's phone, per §11) with a defined graph size (including the ~2,000-node large fixture) and the worst credible combined animation load, record actual draw calls, triangle count, cold-load time, average FPS, and 1%-low FPS. A constant passing is **not** described as proof of performance. A measured miss triggers optimization or a design return — never a silent relaxation of the limits. Fallback keeps the tree silhouette and meaningful content intact.
- **C5 Dark + reversible (both sides, review 27 finding 12):** flag off → no garden scene module or garden assets are loaded, and no new destination is admitted; flag on → the garden works, and the home galaxy and existing Phase 2 behavior are unchanged. Tested both ways.
- **C6 Full gate:** complete suites + typecheck + production build, evidence stated exactly.
- **C7 Failure honesty:** a failed graph load renders the error/retry state, never an empty garden; inconsistent data is omitted, never ghosted (§3.6). Tested with a failing fetch and a fixture containing missing endpoints.
- **C8 Empty/sparse fixtures:** zero memories, one memory, disconnected memories, no edges, no completed Journeys — each renders clear, gentle, honest ground with no fabricated content, no locked-door taunts, no misleading progress cues.

## 5. Open questions for the owner

- **Q1 Landmarks: SETTLED (B, D-59)** — presence-only landmarks for your completed Journeys (see §3.4).
- **Q2 Plot scale: recommended settled — all *eligible* memories as plots, with the §3.3 scale strategy (instancing, LOD, large-graph fixture).** The review (finding 1) endorses retaining all eligible memories with a defined strategy over any curated subset. Owner confirms at settlement.
- **Q3 (settled by recipe, recorded so it isn't re-litigated):** the dawn sky is the HYG field dimmed — no new star data, no new credits beyond the existing HYG entry's reuse.

## 6. Sequencing & non-scope

- This note → review loop → owner's settlement of Q1/Q2 → owner's separate implementation word → build → full gate → owner's merge tap → post-merge audit. The lane that built Phase 2, unchanged.
- **Not in P3-1:** the §17 rail and A6 rising (Phase 4); Deep Past (next, only on the owner's word after P3-1's arc); People, Scale, Quiet/Archive; any change to the home galaxy; the launch (flag flip + deploy + device check remains its own pending sequence).
