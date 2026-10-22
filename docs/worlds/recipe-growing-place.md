# Environment Recipe — The Growing Place (Phase 0 draft)

**Status:** Phase 0 recipe — ✅ **SETTLED by the owner (2026-10-22)**: R-G1 approve form, R-G2 approve palette, **R-G3 approved with the review's constraint** (deterministic, non-ranking landmark mapping; unmapped milestones neutral/unrendered, never guessed — §7), R-G4 approve fixed dawn. ChatGPT-reviewed 2026-10-22 (no architectural blocker). Settlement authorizes **no** mockup construction (D-21). **Scope:** the Growing Place space and its §18 mockup scene (the rising). **Settled ground it must obey:** roster/purpose (§12/D-4: goals, milestones, and the memories linked to them), §13 P3 surfacing (landmarks are *milestones*; memories appear as the evidence/path between them), §17 rail (landmark creation is **structural** — it happens only on an approved, real milestone), §9.4 never-punish, §10.1 stack (D-3, conditional), §11 criteria (fixed), §14 Animation Gate. Nothing here authorizes a build.

---

## 1. Identity & visual grammar

**One-line identity:** *The garden where your becoming is kept* — terraced living ground under first light, where progress is something you can walk through.

**Form (King's proposal, owner settles):** a **terraced garden-world** — broad concentric terraces rising like a shallow amphitheater toward a single colossal **witness tree** at the crown: a trunk you could lose a ship inside, a canopy dome wide enough to shade the top terraces, its branches carrying the garden's oldest light. The silhouette — *rising green arcs under one great tree* — is readable at a glance and shares nothing with the Station's crown-and-stem or the home galaxy's star-field sprawl. Terraces hold **plots** (where evidence memories rest, §3), **paths** (the connections between them), and **landmarks** (milestones, §3) grown at their terrace edges.

**Seed & palette:**
- **Seed string:** `growing-place / first-light-1` — greens, mist, vegetation scatter, and terrace planting derive deterministically from it (§10.1). The tree, terrace architecture, and landmark grammar are fixed form language, never seed-randomized.
- **Key light:** dawn gold, low and warm — the whole space is lit like the first hour of a good day. No other hour exists here (R-G4 proposes this as identity, not limitation).
- **Living palette:** layered greens (seed-varied per terrace so the arcs read as distinct plantings), warm soil, pale grown stone, gold mist in the hollows.
- **Backdrop:** deep teal-green dark, HYG stars *dimmed by dawn* — present, humbled. Against the Station's indigo and home's black, this sky alone nearly passes the blind test.
- **Glow grammar:** baked light only (§10.1): sun-gold on edges, soft lamp-light at plots and landmarks — light means *something is kept here*.

**The kindness rule (this space's constitution):** nothing in the Growing Place wilts, browns, rots, or dies — on screen, ever (§9.4; §17 M5). An untouched plot is **resting ground**: soft cover, quiet light, no judgment in its rendering. Growth is the only direction the garden's *structure* moves; presentation may breathe (sway, mist, light drift) but never declines. Show this space to a user in the worst week of their year and it must read as *a place that is patiently holding their progress* — because it is.

## 2. Spatial composition & the mockup scene

The mockup scene (§18 V1) is **the rising**, composed in three movements:

1. **Arrival vista:** the flight settles at the lowest terrace and the garden opens upward — arcs of green climbing to the witness tree, paths of soft light stitching plot to plot, landmarks standing at terrace edges like a history you can count from a distance.
2. **A connection forms (A7):** along one path, light draws itself between two evidence stones as a real link is confirmed — the garden quietly showing *these two things belong to one story*.
3. **A landmark rises (A6):** on the next terrace, a milestone landmark grows — pale stone and living branch weaving upward into an arch while gathered light settles into it. Sequence-length, skippable, unhurried: construction as celebration (§14), and it plays **only** for the mockup's staged real milestone (§3's honesty rule — in production this animation is the rail's (§17), never a screensaver).

**Composition rules:** the tree is off-axis from arrival (the garden is discovered by looking *across*, then up); paths, not grids — nothing in this space is arranged like a spreadsheet; every terrace must be visually reachable from the vista (progress you can see is the point), with the upper terraces present but quieter — invitation, never a locked-door taunt (undiscovered/unbuilt terraces are simply *ground*, honestly unplanted).

## 3. Meaningful content & visual honesty

- **Real (fact):** landmarks are **real milestones only** — each one exists because an approved structural change put it there (§17 M1/M2), and each can answer "why are you here?" with the milestone it marks (P6). Evidence plots hold **real linked memories** (visits under §13 P3 — the memory lives canonically elsewhere; here it rests as evidence on the path). Paths are **real confirmed connections** (P7 tier i); a *suggested* connection renders as a faint, unfinished trail — visibly a hypothesis (tier ii), never a paved road.
- **Atmosphere (never fact):** swaying planting, drifting mist, floating light-motes, birdsong-adjacent motion if any — all presentation, all within §17 M2's bounds, none of it implying growth, decline, or activity that didn't happen.
- **The growth rule, stated plainly:** the garden's structure changes **only** through the rail, **only** upward (a landmark rising, a path confirmed, a plot planted) — and correction works by the §17 rules (a mistaken landmark is removed by a compensating change with its own quiet animation, never by silently unwinding the garden's history). A landmark is grounded in an **actual milestone** — never inferred from ambient activity, never invented by the world (§7's mapping constraint).
- **No numbers wearing costumes:** no progress bars disguised as hedges, no percentage vines. If a quantity matters, it is shown as a quantity, in words (§15's honesty about information).

## 4. Performance & accessibility budget (against §11.2's fixed ceilings)

Ceilings: ≤200 draw calls · ≤750k triangles (**hard rejection boundary, not a target** — per the Station recipe's review note) · textures ≤1K (hero ≤2K) · cold load ≤5 s · ≥50 fps avg / ≥30 fps 1%-low.

**Proposed allocation:**
| Consumer | Draw calls | Triangles | Notes |
|---|---|---|---|
| Witness tree (hero) | ≤15 | ≤250k | Canopy as layered instanced foliage cards; silhouette LOD separate |
| Terraces + paths | ≤20 | ≤120k | Shared geometry, per-terrace tint from seed |
| Vegetation (instanced) | ≤15 | ≤180k | The perf risk of this space — instancing mandatory; density is the fallback dial |
| Landmarks + plots | ≤15 | ≤80k | Landmark meshes by grammar type (§7), reused |
| Backdrop + mist | ≤10 | ≤40k | Mist as layered planes (§10.1), never volumetrics |
| Ship + UI overlay | ≤20 | ≤30k | Shared assets |
| **Total** | **≤95** | **≤700k planned** | Graded against the ceilings; landing *at* 750k is a warning, not a pass |

**Accessibility:** reduced-motion = the garden *held*: no sway, no drifting mist, the rising (A6) becomes a gentle fade-and-settle between before/after states with the same explanation attached — the milestone is honored, the information identical. Dawn palette checked for color-vision safety: terrace distinction is carried by height, path light, and planting *shape* families, never by green-vs-gold alone. The kindness rule applies to accessibility too — reduced motion must never look like the garden cared less.

## 5. Animation inventory slice (§14.1 fields; combined load + fallback)

| # | Animation | Trigger | Actors | Motion (plain) | Duration | Reduced-motion equivalent | Cost |
|---|---|---|---|---|---|---|---|
| A6 | Landmark rising | Approved real milestone (§17 rail) | World | Branch and pale stone weave upward into the landmark's form; light gathers and settles; a soft chime of stillness at completion | Sequence | Fade-and-settle between states, explanation attached | Heavy |
| A7 | Connection forming | A link is confirmed (P7 tier i) | World | Light draws itself along the ground between two plots, becoming a path | Sequence | Path appears with a soft pulse | Moderate |
| A6b | Landmark removal (correction) | Approved compensating change (§17) | World | The landmark is *unwoven* — lowered gently back into the ground, its place becoming resting ground (never rubble, never a scar) | Sequence | Fade-and-settle | Moderate |
| A1–A3 | Evidence placement | A memory is linked as evidence (visit, §13) | Ship, world | The ship carries the memory in; it settles into its plot with a ring of soft root-light | Sequence | Direct settle with fade | Moderate |
| A8 | Atmosphere drift | Ambient presentation (§17 M2) | World | Mist thins and gathers; light warms and cools within the dawn band — weather, never progress or decline | Continuous | Static dawn | Cheap |
| A15 | First arrival | First ever visit | Ship, world | The vista opens slowly — terraces revealed arc by arc up to the tree | Journey | Single gentle fade-in of the whole vista | Moderate |
| A20 | Focus/selection | Touch on plot/landmark | User | The plot or landmark answers with a ring of light; explanation available | Moment | Identical | Cheap |

**Combined load (worst honest case):** A6 rising + A7 forming + full vegetation sway + mist during free flight. **Fallback ladder:** vegetation density → motes/mist layers → sway amplitude → backdrop star density. **Never degraded:** the tree silhouette, landmarks, paths, evidence plots, or any explanation. **Interruption:** the rising can be left mid-animation by navigating away; the landmark's *state* follows §14 atomicity — it is either risen (log entry applied) or not yet, regardless of where the user was standing when it happened.

## 6. Shared vs distinct (D-18)

**Shared:** ship + carry/place grammar · gate language · memory objects (evidence stones use the same visual identity as memories everywhere) · UI voice/naming · the explanation system ("why is this here?").
**Distinct:** the witness tree silhouette · dawn-gold key light and teal-dawn sky · terraces/paths/plots as the spatial language · growth as the space's only structural verb · the kindness rule as a rendering constitution.

## 7. Seed parameter table (V4 traceability reference)

| Parameter | Derivation |
|---|---|
| Greens per terrace, planting scatter | Seed palette math + scatter, within fixed terrace architecture |
| Mist density & drift | Seed, within the dawn band; presentation-only (§17 M2) |
| Terrace count & radii | Fixed ratios (form language) |
| Witness tree form | Fixed — one tree, authored proportions |
| Landmark form | **By milestone kind, from a fixed rule table** (e.g., completion → arch; a sustained practice → tower; a first step → gate-stone) — never random; the table is part of this recipe's settled text once the owner approves it. **Constraint (review, 2026-10-22): the mapping is a language, not a ranking** — a landmark's shape must never imply a greater achievement, importance, or duration than the underlying milestone actually supports; forms differ in *kind*, never in implied worth. A milestone that fits **no defined kind is never guessed into one**: it renders in a neutral representation, or stays unrendered, until the mapping is settled through the design process. |
| Path routing | Derived from actual confirmed connections (real data, never decorative) |
| Plot assignment | Derived from actual goal/memory links (P3) |

## 8. The mockup scene — in / out

**In:** arrival vista · one A7 connection forming · one A6 landmark rising (staged milestone, declared as staged in the record — the mockup tests the *animation and budget*, and its record says so, §18 V5) · A1–A3 evidence placement · the §18 V2 script (incl. cancel/turn-back where supported, drift repeat, reduced-motion run).
**Out:** real goal data (fixtures only, labeled) · seasons/time passage · any decay state (none exists) · the rail's UI (proposals are §17's design; the mockup borrows only its outcome — an approved milestone).

## 9. Recipe settlement — ✅ SETTLED by the owner (2026-10-22, all four as recommended, R-G3 with its constraint)

*ChatGPT reviewed this recipe (2026-10-22; record: `chatgpt-review-8-2026-10-22.md`) — no architectural blocker. Outcomes: **R-G1 approved**, **R-G2 approved**, **R-G3 approved with constraint**, **R-G4 approved**. The recommendations as recorded before settlement:*
- **R-G1** The form: terraced garden + witness tree — right body for this space? *ChatGPT recommends: approve — proportions fixed, not seed-randomized; the tree must survive every performance fallback (vegetation detail is expendable, the defining shape is not).*
- **R-G2** The palette: eternal dawn (gold/teal/living green) — right identity, distinct enough from harbor and home? *ChatGPT recommends: approve — with the kindness rule governing the whole palette: no lighting/mist effect may ever accidentally imply fading progress or a disappointed garden.*
- **R-G3** Landmark grammar: grown forms by milestone kind (arch/tower/gate-stone rule table) — right language for progress? *ChatGPT recommends: approve with the §7 constraint — deterministic, non-ranking, evidence-backed mapping; unmapped milestones render neutral or not at all, never guessed.*
- **R-G4** The dawn: fixed first-light identity (weather varies, the hour never does) — or should presentation be allowed a wider day arc within the dawn band? *ChatGPT recommends: approve fixed dawn — mist/light/movement breathe within the band; no noon, sunset, or night cycles, so the world never implies time or activity progressing when neither is.*

*Recipe draft ends. Settlement flow: owner review (ChatGPT pass welcome) → owner settles or amends → recipe joins the settled Phase 0 set. The Deep Past recipe follows the same template and completes Phase 0's paper.*
