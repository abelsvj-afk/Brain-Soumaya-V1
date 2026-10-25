# Phase 3 · P3-2 Design Note — The Deep Past (second memory-bearing world)

**Status:** DRAFT — for the review loop. No build authorized. No implementation is authorized by this note.
**What P3-2 is:** the second world that shows *memories* — the deep water where the earlier life is kept. The Growing Place answers "what is it all adding up to?"; the Deep Past answers "what did I live through, and is it still mine?" — by descent: you go down to the past, and going down is gentle. Older, quieter, dimmer light; the First Light basin at the bottom is where the light is oldest and steadiest, never a grave or a pit.
**Order:** Deep Past is next per D-23 (Growing Place → Deep Past → People → Scale → Quiet/Archive). P3-1 merged (D-63); P2-5 merged (D-69); the worlds layer is ON (D-70) — P3-2 ships **visible**, not dark. There is no more dark shipping.
**Owner direction folded in (2026-10-25, his words):** every world must be complete from every reachable angle — the garden-underside lesson generalized. If a camera can reach a place, that place must be finished; if it cannot be finished, the angle must be unreachable. Ships belong in the Deep Past too. The Station scale-up (gigantic, EVE-like, accessories) is a separate increment, not this one.

---

## 1. Settled ground this note obeys

- **The recipe** (`recipe-deep-past.md`, settled D-26): form/palette/seed `deep-past / first-descent-1`; descending helix of lit strata around the warm First Light basin; violet dusk lit by the memories' own lanterns, warming with depth; budget **≤90 draw calls / ≤440k triangles planned** — deliberately the lightest of the three worlds.
- **R-D3 (the depth rule):** depth is **never** neglect. A memory resting deep is not buried, lost, fading, or lesser — it is *kept at depth*, with the same light and the same reachability as anything at the rim. **Chronological monotonicity:** depth is chronology, not a score. Resurfacing context determines *membership* and may bring a memory forward (the rise), but context can **never** make a newer memory appear chronologically older than an earlier one.
- **D-7 membership:** an explainable rule combining age with meaningful resurfacing context, with user controls — never a silent fixed threshold, and nothing is classified as forgotten merely because it is old. The word "forgotten" does not exist in this space's vocabulary.
- **D-6 Chronicle Path:** a **guided mode** of the Deep Past, not a separate destination. A21 (the descent) and A22 (the resurfacing rise) are ratified into the §14 inventory.
- **§13 P3 surfacing:** this space surfaces members + anchors. A resting memory must answer "why are you in the Deep Past?" in one plain line (P6), naming the rule inputs, with the user's controls reachable from that explanation.
- **§17 rail boundary:** world *structure* changes only through the propose→decide→apply rail — that rail is Phase 4. P3-2 therefore **renders** brain facts; it creates no world-side structural state of its own. The rise (A22) is a derived, explainable change in *presentation* within the Deep Past, not a canonical change — see §3.4 and open question Q2.
- **Never-punish / kindness rule:** nostalgia can tip into rumination (§1 Candidate A risk). This space lets the user enter and leave freely, and never auto-pulls them into painful material without their choice. No dimming with age, no sinking, no visual that says old matters less.
- **Non-ranking rule, per visual channel (P3-1 precedent):** importance, review strength, progress, emotional weight, and degree must NOT drive alcove size, brightness, color, height, density, stratum, or thread emphasis. Depth is chronology (by the D-7 mapping); form says *what kind of thing it is*, never *how much it matters*.
- **The cross-phase invariant (P2-4):** nothing about a world may ever affect the ability to access memories, drift, or return home.
- **P4 archive invariant:** archiving removes a memory from *every* surface — home, Deep Past, People, tours, resurfacing — including derived clusters, route suggestions, cached scenes, and in-flight animations. The archive state wins, mid-flight.
- **Completeness principle (owner, 2026-10-25):** every world must be complete from every reachable angle. A camera that can reach a place must find it finished; an angle that cannot be finished must be unreachable. The garden's unfinished underside is the case that taught this — it must not recur here or anywhere else.

## 2. Recon facts (builder-verified in the repo, to be confirmed at build recon)

- Travel admits three worlds: server `TRAVEL_WORLD_KEYS = ["home", "great-station", "growing-place"]` mirrored by the client chart `WORLD_CHART`. Adding a destination is the known, small, two-sided change — the P2-2/P2-3/P3-1 pattern.
- `WorldsSurface` is a scene registry keyed by the current world (`great-station` → Station, `growing-place` → garden). Deep Past adds a third entry; the transit scene already serves all journeys.
- **The web client already loads the brain's graph** for the home galaxy: `getGraph()` → `GraphData { nodes, edges }`, plus `/graph/edges`. The Deep Past's members and anchors can derive from this same real data — **no new server surface is required for the evidence layer** (to be confirmed at build recon — the D-7 rule's inputs must all be present in the payload; see §3.3).
- **The brain already has Journeys** (life chapters, `active / paused / done`) and Chronicle chapters (era-grouped life history). The guided mode's routes are saved routes (§15 N7) — the thread exists only where a saved route exists.
- **The Phase 1 mockup (D-30) proves the grammar on paper only.** It was built and never run — no sandbox smoke, no device session, no §11 status. Its scene (the descent: rim → guided descent → placement) is the starting point, as the Station scaffold was for P2-3 and the garden mockup was for P3-1 — but its performance and feel are **unproven**, and the build gate's device check matters more here than it did for P3-1. Record: `mockup-result-deep-past.md`.
- The HYG starfield module is reusable as the faint points far above the rim — same data, presentation-dimmed per the recipe. The helix encloses; there is no sky.

## 2.5 The home galaxy vs the Deep Past — same data, different question

The galaxy answers *"what do I know, and how does it connect?"* The Deep Past answers *"what did I live through, and is it still mine?"* — and it answers by descent, not by a second truth:

| | Home galaxy | The Deep Past |
|---|---|---|
| What it is | The brain, working — sky | A visit — down, into kept time |
| Space | Free 3D, bodies by mass, sun at center | Descending helix of strata around a warm basin; violet, vertical, quiet |
| What a node is | A star/planet/moon, brightness by review strength | A resting memory in an alcove, lit by its own lantern |
| What a link is | A constellation line | An anchor line rising out of the depth toward its other appearance (D-8) |
| What a journey is | A hub in the sky | A Chronicle route — a thread of light winding down the strata (guided mode) |
| What you do there | Read, navigate, act | Descend, wander, rediscover — enter and leave freely |
| What it stores | The brain | Nothing — it re-reads the brain on every visit |

Guardrails: one truth, two arrangements (the garden's rule, applied here — the Deep Past must never re-encode a galaxy signal differently); the world is a lens, not a second brain (delete a memory in the brain and its alcove is empty next visit); depth is chronology, never a score.

## 3. Design

### 3.1 Travel extension
- Server allow-list gains `"deep-past"`; the client chart gains the matching entry (name "The Deep Past"; blurb in plain language). Same economy: warp 10, drift free, bonuses exactly as P2-4 settled — **no economy change**.
- `WorldsSurface` registry gains the `deep-past` entry. Title, close (view-only), credits, WebGL-failure honesty: unchanged behavior per world.

### 3.2 The Deep Past scene (product code)
- New modules beside the Station's and the garden's: a layout module (deterministic helix math under the recipe seed; budget constants ≤90 calls / ≤440k tris, test-asserted like `stationLayout` and `gardenLayout`) and a scene module (helix strata + instanced alcoves, memory lanterns, Chronicle thread, marine-snow particulate, First Light basin, faint HYG points above the rim, baked glow only, no post-processing, per the settled stack).
- Camera: the rim arrival vista from the mockup (arrival above the helix, the lit spiral turning away below, the basin's warmth at the center of the depth). Reduced motion: the descent becomes a **stratified fade** (rim → mid → basin cross-fades, same stops, narration, and placement outcome); depth is carried by banding and labels, never by motion alone. Descent speed capped and user-controlled; guided mode can pause indefinitely at any stop.
- **Ships (owner direction, 2026-10-25):** a few small silent ships hover between the strata as set dressing — slow drift, instanced, no interaction, no progression. The user's own ship appears in transit as usual. Which ship assets they use depends on the free-ship hunt now running; if no verified free asset fits, the dressing ships are procedural (same rule as P2-5: no asset ships without a verified license).

### 3.3 Content mapping — members, strata, anchors (the heart of P3-2)

**Membership contract (D-7, to be made exact).** A memory rests in the Deep Past when the explainable rule places it — age *combined with* meaningful resurfacing context. The note proposes the rule's shape; the exact inputs are open question Q1 for the owner:
- **Proposed inputs (from the graph payload, to be confirmed at build recon):** `createdAt` (age — confirmed present, P3-1 recon), `lastTendedAt` (stillness — how long untouched), and a resurfacing-context signal the builder must identify in the payload (e.g. a recent link, a visit, a Journey reference — the builder verifies what the payload actually carries and records it; if no such signal exists in the payload, the rule is age + stillness only, and that limitation is stated, never papered over).
- **Excluded, deliberately:** `status` archived (P4 — the archive wins everywhere); nothing is excluded for age alone, and nothing is labeled "forgotten".
- **Counts reconcile against the member set, never against all graph nodes.** Exclusions are deliberate and testable: a test asserts the member count for a fixture graph and the alcove count equals it exactly.
- **Depth by the D-7 mapping, never by rank:** resting depth derives from the same explainable inputs by a fixed, readable mapping. A plot's form may say *what kind of thing it is* — never *how much it matters* (see the non-ranking rule, §1).

**Strata.** Strata are **bands, not bins**: boundaries are soft light-gradients, because D-7 membership is a rule with context, not a date guillotine. Depth cues are redundant — stratum banding, particulate density, light temperature — so depth reads even in reduced motion and for color-vision differences. The helix winds one consistent direction; descent never confuses up with down.

**Anchors (D-8).** A member with a confirmed anchor elsewhere shows its link as a fine line of light rising out of the depth toward its other appearance — the primary home stays put; the line is a visit-path, not a relocation.

**Chronicle routes (guided mode, A21).** The thread exists only where a saved route exists (§15 N7); its stops are the route's real memories in the route's real order; narration is traceable to node content — where content is thin, the narration is thin, honestly, rather than padded. The user can leave the guided path at any stop and fly free; the thread remains, patient, rejoinable. Leaving mid-descent parks the ship's *view*, never the route or the cargo.

**Touching an alcove** surfaces its memory through the app's existing memory mechanisms (the same focus/citation path the galaxy uses) — reuse, never a parallel viewer.

**Empty or young brain:** the helix stands with its strata lit and empty — honestly unfilled, quietly lit. The Deep Past never fabricates a member to look fuller. A user with no old memories finds an honest, empty descent, not a locked door.

### 3.4 The rise (A22) — presentation, not structure

When life touches a deep memory again (linked, visited from elsewhere, its context returns), the memory **rises** — a gentle ascent to a rim-side resting place while its context is warm. Per the recipe, the rise is a *derived, explainable change in presentation within the Deep Past*: not a change to the canonical memory, its primary home, its chronological stratum, or its historical identity. It never duplicates the memory and never creates a partially applied structural change. Its cause is visible ("risen because…", P6), and its return to depth follows the **same explainable rule** that raised it — never a neglect timer.
- **Open question Q2:** whether the rise ships in P3-2 as derived presentation, or waits for Phase 4 with the rest of the mutation model. The note's recommendation is to include it as presentation only (it needs no rail — it is derived from brain facts per visit, like the garden's arrangement) — but the boundary with §17 is exactly what the review loop should test.

### 3.5 Completeness — the garden-underside lesson, applied here (owner direction, 2026-10-25)

- **The basin is the bottom.** The helix ends at the First Light basin — a finished floor of warm light and stone, not a pit and not a void. There is no "underneath the Deep Past" to fall into: below the basin is solid, finished rock, and the camera cannot pass it.
- **The rim is a boundary.** Above the rim, the camera meets finished darkness with faint HYG points — the present day, far above — not an unbuilt edge. The camera cannot fly out past the rim into nothing.
- **The rule, stated as acceptance (see §4 C9):** for every camera position the controls allow, the scene is finished. Any angle the builders cannot finish is outside the camera's allowed range, by construction — and the range is tested, not assumed.

### 3.6 Loading, error, and staleness behavior (P3-1 precedent)

- **Graph load fails:** the Deep Past renders an honest error with a retry path — **never an empty descent**. A failed fetch presented as an empty past would be a technically plausible but emotionally misleading result, and it is forbidden by name.
- **Inconsistent data:** members with missing data are omitted, never ghosted; stale references are dropped from the render. If the data is unusable as a whole, the error state above applies.
- **Data changes while visiting:** the world re-derives from the live graph on data change; a member's disappearance mid-visit is a quiet re-derivation, never an animation of loss.
- **Long absence / bad week:** the Deep Past is identical on return. Absence changes nothing — no dimming, no thinning, no "while you were away" state.

## 4. Acceptance criteria (for the build, when authorized)

- **C1 Determinism:** same *logical* graph data → identical helix layout. Canonical input ordering (nodes sorted by id ascending before layout), stable tie-breakers (tied timestamps → id), seeded placement (mulberry32 over recipe seed + node id), deterministic thread routing (path derived from route stops and order only). Tests: shuffled input order, repeated runs, tied timestamps.
- **C2 Traceability (identity-level):** every resting member carries its source node ID; every anchor line records its source node and its anchor target; every thread stop records its route ID and memory ID. Tests assert identity correspondence — not just totals — including duplicate nodes, missing endpoints, and stale references.
- **C3 Kindness (review cases):** no rendering state represents decline, death, neglect, or rumination-by-design — by construction (no such state exists in the scene's vocabulary) **and by review case**: long absence, bad-week use, archived memories, reduced motion, empty brain, one memory, disconnected graph, a painful memory (enter and leave freely, no auto-pull). Absence never changes the world into a visibly worse state; accessibility preserves the same information.
- **C4 Budget — static and measured:** *Static:* layout/scene constants assert the recipe budget (≤90 calls, ≤440k planned tris). *Measured:* on a defined representative device (the owner's phone, per §11) with a defined graph size (including a large fixture) and the worst credible combined animation load, record actual draw calls, triangle count, cold-load time, average FPS, and 1%-low FPS. A constant passing is **not** described as proof of performance. A measured miss triggers optimization or a design return — never a silent relaxation of the limits. Fallback keeps the strata, the basin, and the resting members intact.
- **C5 Flag-on behavior (no more dark shipping, D-70):** the world ships visible. The build verifies the world works with the flag on and the home galaxy and existing worlds are unchanged. There is no flag-off test for P3-2 — the era of dark shipping is over.
- **C6 Full gate:** complete suites + typecheck + production build, evidence stated exactly. (P2-5's gate was caveated by the sandbox; if the environment still cannot run the web suite at P3-2 build time, that caveat is stated plainly again — never laundered.)
- **C7 Failure honesty:** a failed graph load renders the error/retry state, never an empty descent; inconsistent data is omitted, never ghosted (§3.6). Tested with a failing fetch and a fixture containing missing endpoints.
- **C8 Empty/sparse fixtures:** zero members, one member, disconnected members, no routes, no anchors — each renders clear, gentle, honest ground with no fabricated content, no locked-door taunts, no misleading progress cues.
- **C9 Completeness (owner direction, 2026-10-25):** for every camera position the controls allow, the scene is finished — basin floor solid, rim bounded, no reachable void. Tested by driving the camera to every allowed extreme (lowest descent, highest rim, widest orbit) and recording that each view is finished. Any angle that cannot be finished is outside the allowed range, and the range itself is tested.

## 5. Open questions for the owner

- **Q1 Membership rule, exact inputs.** Proposed: `createdAt` + `lastTendedAt` + a resurfacing-context signal the builder identifies in the payload (and records). What counts as resurfacing context for you — a new link, a visit, a Journey reference, something else? And what user controls do you want on it (thresholds, manual include/exclude)?
- **Q2 The rise (A22): in P3-2 or Phase 4?** Recommended: include as derived presentation only (no rail needed — it is per-visit arrangement from brain facts). The review loop should test this boundary hard.
- **Q3 Guided mode depth.** Follow-only (ship follows the thread, narration from node content, pause/leave freely) — or full tour machinery (saved-route management UI)? Recommended: follow-only; route management stays in the brain.
- **Q4 Ships as set dressing.** How many, and which assets — pending the free-ship hunt. If no verified free asset fits, procedural dressing ships (same rule as P2-5: no asset ships without a verified license).

## 6. Sequencing & non-scope

- This note → review loop (ChatGPT + the cold-check findings, which may change this note) → owner's settlement of Q1–Q4 → owner's separate implementation word → build → full gate → owner's merge tap → post-merge audit. The lane that built Phase 2 and P3-1, unchanged.
- **Not in P3-2:** the §17 rail (Phase 4); People, Scale, Quiet/Archive; the Station scale-up (separate increment — gigantic, EVE-like, accessories); the Man-God (other chat); NPCs and the autonomous agent (separate design track — §16 fence); any change to the home galaxy; any change to the P2-5 gate caveat (stated, not re-litigated here).
