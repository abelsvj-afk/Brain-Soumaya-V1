# Environment Recipe — The Great Station (Phase 0 draft)

**Status:** Phase 0 recipe, **draft for owner settlement** (per D-21: recipes settle on paper before any mockup build is authorized). ChatGPT-reviewed 2026-10-22 (no architectural blocker; margin + D-13 notes absorbed; R-S1–R-S4 recommendations recorded in §10). **Scope:** the Great Station space and its §18 mockup scene (the approach). **Settled ground it must obey:** D-2 (fictional megastructure), D-5 (home port — journeys, not memories), D-10/D-11 (routes, skippable travel), D-13 (sun deferred — this mockup gathers the evidence), §10.1 stack (D-3, conditional), §11 criteria (fixed), §14 Animation Gate, §15 utility-first, §17 presentation safeguards. Nothing here authorizes a build.

---

## 1. Identity & visual grammar

**One-line identity:** *The harbor at the top of the world* — a monumental working port, warm with labor and light, hanging in cold indigo dark.

**Form (King's proposal, owner settles):** a **vertical crown station** — a tall central spire (command + beacon), a great **habitat ring** turning slowly around its waist, and **four docking arms** reaching outward/downward like roots, their tips lit. Read from any distance, the silhouette is a *crown on a stem*: unmistakable, ownable, and nothing like a planet, a gate, or the real ISS (which stays reserved to the Scale Space, D-2). The owner asked for it **bigger than the home galaxy's current sun** — awe-scale (§15 N5) makes that a composition rule, not a measurement: on final approach the station overfills the view; the sun, when visible, is a backdrop disc the station's ring can eclipse.

**Seed & palette (traceability — every value below derives from the seed recipe, §8):**
- **Seed string:** `great-station / harbor-1` — all palette math, fog, traffic rhythm, and proportion ratios derive deterministically from it (§10.1 seeded palette math). Changing the seed changes the harbor's *weather*, never its form language.
- **Structure:** basalt graphite and weathered gunmetal; panel variation from the seed, never hand-placed decals.
- **Working light (the station's signature):** warm sodium-amber — windows, work lights, docking floods. The station *glows like a city that works nights*.
- **Guidance light:** pale cyan — lane markers, approach strobes, gate-side beacons. Cyan always means *navigation truth* (see §4).
- **Backdrop:** desaturated indigo nebula planes + HYG starfield (§10.1), kept deliberately colder and darker than the station so the warm silhouette separates at maximum distance (V2 silhouette criterion).
- **Fog:** palette-matched exponential fog in the backdrop's indigo; the station's amber must visibly *win* against it as you close — the approach is, visually, a warm thing emerging from cold.

**Light grammar:** one key light (distant star, cool), the station's own baked amber glow (no post-processing bloom, §10.1), cyan guidance accents. Nothing else emits. Restraint is the identity.

## 2. Spatial composition & the approach

The mockup scene is the **approach corridor** (§18 V1), composed in three staged distances so scale is *felt in sequence*, not stated:

1. **Far (backdrop layer):** the station as pure silhouette against the nebula — crown-and-stem readable from the first frame (V2). The home galaxy's sun sits in this layer at its **current, unchanged size** (D-13 evidence, §9).
2. **Middle (the handoff):** dual-layer compositing (§10.1) hands the station from backdrop to foreground as the flight closes. This handoff is the scene's named technical risk — §11.3 V3 grades the approach recording for pop-in, flicker, or depth artifacts *here specifically*. Passing scenery sells the distance: **beacon rings** the ship passes through, a skeletal **drydock frame** off the lane, distant haulers on crossing vectors.
3. **Near (foreground, 1:1):** the arrival arc — the ring's rotation becomes perceptible, individual docking arms resolve, traffic lanes split around the ship, and the flight settles into the arrival glide beneath the ring. **No docking capture, no interior** — arrival is a *place you reach*, and the interior is a later phase (owner's direction, D-2 note).

**Composition rules:** the lane is gently curved (never a sterile straight line); the station is never centered dead-on until the final arc (awe prefers an angle); something with honest size — a hauler, the drydock — always shares the frame in the middle distance so the station's size has a witness.

## 3. Meaningful content & visual honesty

- **Real (fact, §14.2):** the departure/destination information the Station exists to surface (D-5) — gate markers for each destination, route projections (A19), warp costs and time classes (§15 N6), discovery state (an undiscovered destination shows as an *unlit* gate marker labeled as undiscovered in plain language — presence without fake content, N4).
- **Atmosphere (never fact):** ambient traffic (A17) and the ring's slow turn. Traffic implies no users and no brain activity (§14.2); it exists for scale and life. If traffic ever maps to something real, that needs its own rule first.
- **Absent by design:** memories. The Station surfaces **none** (D-5) — a memory appears here only as visible *cargo in transit* with the ship (A1–A2), which is the traveler's own act, not the Station's content.
- **No fake grandeur:** every light on the station corresponds to its grammar (amber = inhabited/working, cyan = navigation); there are no decorative strobes that could be mistaken for signals.

## 4. Performance & accessibility budget (against §11.2's fixed ceilings)

Ceilings (not targets): ≤200 draw calls · ≤750k visible triangles · textures ≤1K (hero ≤2K) · backdrop ≤2048×1024 · cold load ≤5 s · ≥50 fps avg / ≥30 fps 1%-low.

**Proposed allocation (the mockup is graded against the ceilings, not this split — the split is the recipe's own discipline):**
| Consumer | Draw calls | Triangles | Notes |
|---|---|---|---|
| Station (hero) | ≤25 | ≤400k | LOD by approach stage; silhouette LOD is a separate cheap mesh |
| Traffic (instanced) | ≤10 | ≤120k | InstancedMesh; count is the fallback dial (§6) |
| Backdrop (stars/nebula/sun) | ≤8 | ≤30k | HYG shader points + ≤3 nebula planes |
| Passing scenery (rings, drydock, haulers) | ≤20 | ≤120k | Instanced/reused |
| Ship + cargo | ≤10 | ≤50k | Shared asset (universe-wide) |
| UI/route overlay | ≤15 | ≤30k | Route projection, markers, summaries |
| **Total** | **≤88** | **≤750k** | Headroom is deliberate — the margin is where honesty lives |

**Margin note (review, 2026-10-22):** the draw-call plan (~88) holds real headroom under its ceiling; the triangle plan, as tabled, sums to the full 750k ceiling. That asymmetry is corrected in intent here: **750k is a hard rejection boundary, never a target.** The mockup should demonstrate a materially lower actual count where feasible (station LOD discipline is the main lever), and any run that lands *at* the boundary is treated as a warning to investigate, not a pass to celebrate — §11.2's ceiling still governs the verdict, unrelaxed.

**Accessibility:** reduced-motion approach = a calm guided glide: no banking swoops, no ring-rotation in the near field, transitions by gentle fades between staged distances — *same information, same arrival* (§14.2). Guidance meaning is never carried by color alone (cyan markers also pulse in a distinct rhythm and carry shape coding) for color-vision safety. All text summaries in the brain's naming and plain language; no UTC, ever; minimum text sizes follow the core app's rules.

## 5. Animation inventory slice (§14.1 fields; combined load + fallback)

| # | Animation | Trigger | Actors | Motion (plain) | Duration | Reduced-motion equivalent | Cost |
|---|---|---|---|---|---|---|---|
| A13 | Station approach | Arrival flight (warp or drift) | Ship, world | The §2 three-stage closing: silhouette → handoff → arrival arc under the ring | Journey | Guided glide with fades between stages | Heavy |
| A17 | Traffic lanes | Ambient, always in space | World | Instanced ships on curved lanes, arriving/departing vectors, no interaction | Continuous | Halved density, no near-lane passes | Moderate |
| A11/A12 | Warp / drift arrival variants | Travel choice (D-1) | Ship, gate | Warp: fast, bright gate exit into the corridor. Drift: slow emergence, plainer light | Sequence | Crossfade arrival at corridor start | Moderate |
| A15 | First arrival | First ever visit | Ship, world | A13 extended: a slow orbit reveal of the crown before the arc | Journey | The glide, one extra fade stage | Heavy |
| A16 | Gate reveal (discovery) | A destination is discovered (N4) | World | Its marker kindles from unlit to cyan-lit, once | Moment | Instant state change + label update | Cheap |
| A19 | Route plotting | Destination selected | User, world | Route line draws from Station to the chosen gate; summary appears (cost/time class) | Moment | Line appears without draw-on | Cheap |
| A20 | Focus/selection | Touch on marker/gate | User | Marker answers instantly; no travel implied | Moment | Identical (already minimal) | Cheap |

**Combined load (worst honest case):** A13 + full A17 + A19 overlay + A20 simultaneously during the arrival arc. **Fallback ladder** (in order; earlier rungs degrade first): traffic count → nebula plane count → passing-scenery density → approach particle haze. **Never degraded:** the station silhouette and its LOD handoff, guidance lights, route information, or the arrival itself. **Interruption:** cancel/turn-back per §15 N3 — the approach reverses along the corridor with state preserved; nothing about the Station changes because a flight did.

## 6. Shared vs distinct (D-18)

**Shared (universe-wide, cohesion):** the ship and its carry/place grammar · gate design language (the corridor's entry gate is the same gate family as everywhere) · HYG starfield rendering · UI voice, naming, plain-language summaries · the cyan = navigation-truth convention.
**Distinct (this space only):** the crown-and-stem silhouette · amber working-light identity against indigo · the ring and its slow turn · the harbor sounds of scale (passing witnesses: drydock, haulers, beacon rings) · fog that the station's warmth defeats.

## 7. Seed parameter table (V4 traceability reference)

Every visual parameter of the mockup must trace to this table or to §4's budgets — an untraceable tweak fails V4 (§11.3) even if it looks better.
| Parameter | Derivation |
|---|---|
| Palette hues (structure/amber/cyan/indigo) | Seed `harbor-1` palette math, fixed offsets per role |
| Fog color & density | Backdrop indigo from seed; density set by approach-stage table |
| Station proportions (spire : ring : arms) | Fixed ratios in the recipe (form language — not seed-varied) |
| Ring rotation period | Seed-derived within a calm band (never faster than stately) |
| Traffic density & lane curvature | Seed-derived; density capped by §4 fallback ladder |
| Window-light pattern | Seed-procedural on the structure's panel grid |
| Nebula plane selection/tint | Seed-chosen from the §10 verified backdrop set |
| Sun size & position | **Not seed-derived — the real home sun, current size (D-13)** |

## 8. The mockup scene — in / out

**In:** gate exit → corridor → three-stage approach → arrival arc · traffic · route plotting to one real destination marker (plus one unlit undiscovered marker) · the §18 V2 session script incl. cancel, turn-back, zero-fuel return (harness), drift repeat, reduced-motion run · D-13 evidence capture (below).
**Out:** interior/docking · memories surfacing · any fuel economy (harness stub only) · direct-gate arrivals (Station route is the subject) · the other five spaces.

## 9. D-13 evidence this mockup must produce

Stills + the approach recording framed to include **sun and station in one composition** at matched approach stages, with a short relative-appearance note — so the owner's deferred sun decision (D-13) can be made on evidence, not imagination. The mockup neither grows nor shrinks the sun; it *photographs the question*. **D-13 stays genuinely open (review emphasis, 2026-10-22):** neither this recipe's composition rules ("the ring can eclipse the sun" describes the approach framing at the sun's *current* size) nor any review of this recipe settles the sun's eventual size — that decision is made later, on this mockup's evidence, as its own act.

## 10. Open for the owner (recipe settlement)

*ChatGPT reviewed this recipe (2026-10-22; record: `chatgpt-review-7-2026-10-22.md`) — no architectural blocker; recommendations below. The owner settles.*
- **R-S1** The form: crown-and-stem (spire + ring + four arms) — right silhouette, or a different monumental form? *ChatGPT recommends: approve — strong distant silhouette that stays legible through the dual-layer handoff; proportions stay fixed by the recipe, never seed-randomized.*
- **R-S2** The palette: warm amber harbor in cold indigo — right identity for the home port? *ChatGPT recommends: approve — with the cyan = navigation-truth rule preserved in reduced-motion and color-accessibility modes through shape, labeling, and rhythm cues, not color alone.*
- **R-S3** The station's display name: "the Great Station" is this recipe's descriptive title; if you want it to carry a proper name in-world, that's yours to give. *ChatGPT recommends: defer — keep "the Great Station" as the working display name; don't invent a name to fill the slot; revisit when the wider world's voice is clearer.*
- **R-S4** Ring rotation: proposed *slow and real* (it reads as life and scale) — or should the ring be still, with motion left to traffic alone? *ChatGPT recommends: approve — stately enough never to compete with route information; reduced-motion suppresses visible rotation while preserving the same scene information.*

*Recipe draft ends. Settlement flow: owner review (ChatGPT pass done) → owner settles or amends → recipe joins the settled Phase 0 set. Recipe settlement does not authorize mockup construction. The Growing Place recipe follows the same template.*
