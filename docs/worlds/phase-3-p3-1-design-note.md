# Phase 3 · P3-1 Design Note — The Growing Place (first memory-bearing world)

**Status:** DRAFT for the review loop (owner + ChatGPT + Gemini). Phase 3 OPENED by the owner 2026-10-23 ("Start number 2"); per D-23 the Growing Place is Phase 3's first world. **No implementation is authorized by this note.** P3-1, when built, ships dark behind the same flag; the Phase 2 launch sequence is unchanged and still the owner's separate call.

**What P3-1 is:** the first world that shows *memories*. The Station (D-5) surfaces journeys and routes; the Growing Place surfaces the brain's own becoming — real memories resting as evidence, real connections drawn as paths, real completed chapters standing as landmarks — inside the settled garden: terraced arcs under eternal dawn, one colossal witness tree, and the kindness rule over everything (nothing wilts, browns, or dies, ever).

---

## 1. Settled ground this note obeys

- **The recipe** (`recipe-growing-place.md`, settled D-26): form/palette/seed `growing-place / first-light-1`; fixed dawn (R-G4); budget **≤95 draw calls / ≤700k triangles planned**; backdrop = HYG stars *dimmed by dawn*.
- **R-G3 (the mapping constraint):** landmark mapping is deterministic and **non-ranking**; unmapped milestones are neutral/unrendered, never guessed.
- **§13 P3 surfacing:** landmarks are *milestones*; memories appear as the evidence/path between them. A plot or path must be able to answer "why are you here?" with the real thing it stands for.
- **§17 rail boundary:** world *structure* changes only through the propose→decide→apply rail — that rail is Phase 4. P3-1 therefore **renders** brain facts; it creates no world-side structural state of its own.
- **Never-punish / kindness rule:** an untouched plot is *resting ground*; an empty garden is honest ground, never a shaming one. No numbers wearing costumes — no progress-bar hedges.
- **The cross-phase invariant (P2-4):** nothing about a world may ever affect the ability to access memories, drift, or return home.

## 2. Recon facts (builder-verified in the repo, 2026-10-23)

- Travel admits exactly two worlds: server `TRAVEL_WORLD_KEYS = ["home", "great-station"]` (travel.repo.ts) mirrored by the client chart `WORLD_CHART` (routeBoard.ts). Adding a destination is a known, small, two-sided change — the P2-2/P2-3 pattern.
- `WorldsSurface` (P2-4) mounts exactly one scene (`createStationScene`) when state says "great-station". A second world needs scene *selection*, not a second surface.
- **The web client already loads the brain's graph** for the home galaxy: `getGraph()` → `GraphData { nodes, edges }` (api/client.ts), plus `/graph/edges`. The garden's plots and paths can derive from this same real data — **no new server surface is required for the evidence layer.**
- **The brain already has Journeys** — life chapters the user creates, links objects to, and marks `active / paused / done`, with user-set progress (shared `Journey` type; api/journeys.ts). A journey the user has marked **done** is a user-confirmed completion recorded in the brain itself.
- The Phase 1 mockup (owner-passed, D-29) proves the garden's grammar at budget in a single 33 KB scene: terraces, witness tree, instanced vegetation, A7 connection-forming, A6 landmark-rising, A1–A3 carry-and-place. It is the scene's starting point, as the Station scaffold was for P2-3.
- The HYG starfield module (P2-3/F-02) is reusable as the garden's dimmed dawn sky — same data, presentation-dimmed per the recipe.

## 3. Design

### 3.1 Travel extension
- Server allow-list gains `"growing-place"`; the client chart gains the matching entry (name "The Growing Place"; blurb in plain language). Same economy: warp 10, drift free, bonuses exactly as P2-4 settled — **no economy change**.
- `WorldsSurface` generalizes to a small scene registry keyed by the current world: `great-station` → Station scene, `growing-place` → garden scene. Title, close (view-only), credits, WebGL-failure honesty: unchanged behavior per world.

### 3.2 The garden scene (product code)
- New modules beside the Station's: a layout module (deterministic garden math under the recipe seed; budget constants ≤95 calls / ≤700k tris, test-asserted like `stationLayout`) and a scene module (terraces, witness tree, instanced vegetation, dawn light, dimmed HYG sky, mist planes — baked glow only, no post-processing, per the settled stack).
- Camera: the arrival vista from the mockup (settle at the lowest terrace, garden opening upward, tree off-axis). Reduced motion: the garden *held* — no sway, no drift; information identical (recipe §4).

### 3.3 Content mapping — evidence, paths (the heart of P3-1)
- **Plots:** every memory in the graph rests as a plot. Placement is a deterministic function of the memory itself (terrace band by age, position seeded by node id) — same brain, same garden, every visit, on every device. No server state, nothing stored world-side.
- **Paths:** every graph edge renders as a path of soft light between its two plots. *Recon caveat, stated plainly:* the graph payload does not visibly distinguish *confirmed* from *suggested* connections at this layer — so P3-1 renders the connections that exist and claims nothing finer. The recipe's faint-hypothesis trail (tier ii) is **deferred** until the data carries the distinction; inventing it would violate the honesty rule.
- **Touching a plot** surfaces its memory through the app's existing memory mechanisms (the same focus/citation path the galaxy uses) — reuse, never a parallel viewer.
- **Empty or young brain:** terraces stand as resting ground — honestly unplanted, quietly lit. The garden never fabricates a plot to look fuller.

### 3.4 Landmarks — the one real fork (Q1, §5 below)
Landmarks are milestones, and milestones are structural (§17) — but the garden in P3-1 *renders*; it does not *decide*. Two honest readings:
- **(A) Defer landmarks entirely to Phase 4.** P3-1 ships terraces + plots + paths only; landmarks arrive with the rail, rising animation and all.
- **(B) Presence-only landmarks for user-completed Journeys.** A journey the user themselves marked **done** in the brain is a user-confirmed milestone already recorded; the garden renders a standing landmark for it (deterministic placement, form by the recipe's grammar, can answer "why are you here?" with the journey's title). **No rising animation** — A6 stays Phase 4, when a completion can be *celebrated* through the rail; in P3-1 the landmark is simply, truthfully, *there*, the way a plot is there. Nothing is inferred: active/paused journeys render nothing (non-ranking, unmapped = unrendered, per R-G3).
**Recommendation: (B).** It grounds every landmark in the user's own confirmed record, applies nothing, stores nothing, and keeps the ceremony for the phase that owns it.

### 3.5 Honesty rails (acceptance-level, not aspirations)
- Every rendered plot/path/landmark traces to a real node/edge/journey in the fetched data — testable by construction (the layout consumes only that data).
- The garden derives everything per-visit from live brain data; delete a memory in the brain and its plot is gone next visit (failure-independence: the world holds nothing the brain doesn't).
- No streaks, no decline, no "your garden missed you." Absence renders as rest.

## 4. Acceptance criteria (for the build, when authorized)

- **C1 Determinism:** same graph data → identical garden layout (unit-tested layout function, seeded).
- **C2 Traceability:** plots = nodes, paths = edges, landmarks (if Q1-B) = done journeys — counts reconcile exactly with the source data in tests with fixture graphs.
- **C3 Kindness:** no rendering state represents decline, death, or neglect — by construction (no such state exists in the scene's vocabulary) and by review.
- **C4 Budget:** layout/scene constants assert the recipe budget (≤95 calls, ≤700k planned tris); scene builds under happy-dom degrade honestly like the Station's.
- **C5 Dark + reversible:** flag untouched; with the flag off, zero garden code loads; travel to the new world is admitted server-side only when built, and the Phase 2 worlds are unaffected.
- **C6 Full gate:** complete suites + typecheck + production build, evidence stated exactly.

## 5. Open questions for the owner

- **Q1 Landmarks:** (A) defer to Phase 4, or (B) presence-only for your completed Journeys? *(Recommendation: B.)*
- **Q2 Plot scale:** all memories as plots (recommended — the layout bands by age and the garden is built to be walked at brain scale), or a curated subset? If the brain grows to thousands, banding still holds; clustering is a later refinement, not a P3-1 need.
- **Q3 (settled by recipe, recorded so it isn't re-litigated):** the dawn sky is the HYG field dimmed — no new star data, no new credits beyond the existing HYG entry's reuse.

## 6. Sequencing & non-scope

- This note → review loop → owner's settlement of Q1/Q2 → owner's separate implementation word → build → full gate → owner's merge tap → post-merge audit. The lane that built Phase 2, unchanged.
- **Not in P3-1:** the §17 rail and A6 rising (Phase 4); Deep Past (next, only on the owner's word after P3-1's arc); People, Scale, Quiet/Archive; any change to the home galaxy; the launch (flag flip + deploy + device check remains its own pending sequence).
