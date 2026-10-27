# Environment Recipe — The People (Phase 0 recipe)

**Status:** Phase 0 recipe — **SETTLED by the build-all order (2026-10-26, Rev 123)**: R-P1 approve form, R-P2 approve palette, R-P3 approve seed `people / first-circle-1`. This recipe settles P3-3 Q6 (Rev 122). **Scope:** the People space. **Settled ground it must obey:** the P3-3 design note (Rev 122 + Rev 123 decisions); the non-ranking rule (per visual channel); §10.1 stack; §11 criteria; §14 Animation Gate; §15 utility-first; §17 presentation safeguards. Nothing here authorizes a build beyond the build-all order's lane.

---

## 1. Identity & visual grammar

**One-line identity:** *Lights in a neighborhood at dusk* — a warm field of clusters, each person a small system of their own, walked among, not flown through.

**Form:** a warm central presence per person with linked memories as lights in slow orbit; fine bridges of light between people who share a memory. The field is a neighborhood, not a galaxy — no sun, no stars-as-nodes, no orbits around a center. If the scene starts to feel like a second galaxy, the design is wrong.

**Seed & palette (traceability — every value below derives from the seed recipe, §8):**
- **Seed string:** `people / first-circle-1` — all palette math, fog, cluster rhythm, and proportion ratios derive deterministically from it. Changing the seed changes the field's *weather*, never its form language.
- **Structure:** dark ground, warm amber cluster light — the field is dark so the warmth reads.
- **Working light (the field's signature):** amber-warm — cluster centers, memory-lights, bridges. Warmth is the identity; nothing here is cold.
- **Guidance light:** pale cyan — gate-side beacons only. Cyan always means *navigation truth*.
- **Backdrop:** dark dusk, no stars-as-content (the galaxy is the sky; People is a visit among people). Faint warm haze low over the field.
- **Fog:** palette-matched exponential fog in the field's dusk; cluster warmth must visibly *win* against it as you walk closer.

**Light grammar:** one key light (warm, low, dusk), the clusters' own baked amber glow (no post-processing bloom, §10.1), cyan guidance accents. Nothing else emits. Restraint is the identity.

## 2. Spatial composition & the arrival

1. **Far (arrival):** you arrive at the edge of a warm field — clusters spread before you like lights in a neighborhood at dusk.
2. **Middle (walking among):** clusters open outward as you walk; bridges of light become visible between people who share memories. A person with no bridges stands alone, honestly — alone is not lesser.
3. **Near (a cluster):** the warm central presence with its memory-lights in slow orbit; dates that matter rest as quiet dates; open threads rest as quiet notes. Touching a presence surfaces the person through the app's existing memory mechanisms — reuse, never a parallel viewer.

**Composition rules:** deterministic seeded placement (mulberry32 over recipe seed + person id) — same person, same place, every visit, every device. No cluster is nearer, larger, or brighter for recency, importance, or any other rank. The count of memory-lights orbiting a cluster is a true count of linked memories — a fact, not a judgment — and is the only thing that varies between clusters.

## 3. Meaningful content & visual honesty

- **Real (fact, §14.2):** the clusters (one per eligible person: ≥1 linked memory), the memory-lights (true count), the bridges (a memory shared between two people, or a confirmed link), the dates, the open threads. Form by kind, never by rank: a memory-light's shape says what kind of thing it is (memory / note / date / open thread) — never how much it matters.
- **Atmosphere (never fact):** the slow orbit of the lights, the warm haze. Orbit implies no activity and no brain state.
- **Absent by design:** scores, judgments, comparisons, "last contacted" counters, contact suggestions, feeds, NPC people, invented people. Nothing in People may ever affect access to memories, drift, or return home.
- **Gate silhouette (adopted amendment, Rev 123):** People's gate is a **warm low arch of clustered light** — a small arch made of the same warm lights as the clusters, low enough to walk through, lit amber. The gate that gathers: you pass under the same light the people are made of.

## 4. Performance & accessibility budget (against §11.2's fixed ceilings)

Ceilings (not targets): ≤200 draw calls · ≤750k visible triangles · textures ≤1K (hero ≤2K) · backdrop ≤2048×1024 · cold load ≤5 s · ≥50 fps avg / ≥30 fps 1%-low.

**Proposed allocation (the build is graded against the ceilings, not this split):**
| Consumer | Draw calls | Triangles | Notes |
|---|---|---|---|
| Clusters (instanced lights + centers) | ≤30 | ≤200k | InstancedMesh; count is the fallback dial |
| Bridges | ≤10 | ≤50k | Fine lines, instanced where possible |
| Backdrop (dusk haze) | ≤8 | ≤30k | ≤3 haze planes |
| Ship + arrival | ≤10 | ≤50k | Shared asset (universe-wide) |
| UI overlay | ≤15 | ≤30k | Names, dates, threads in plain words |
| **Total** | **≤73** | **≤360k** | Planned ≤80 calls / ≤400k tris (P3-3 note §3.2) |

**Accessibility:** reduced motion = the field *held* — no orbit drift, no sway; information identical. Guidance meaning is never carried by color alone. All text in the brain's naming and plain language; no UTC, ever; minimum text sizes follow the core app's rules.

## 5. Animation inventory slice

| # | Animation | Trigger | Actors | Motion (plain) | Duration | Reduced-motion equivalent | Cost |
|---|---|---|---|---|---|---|---|
| A-P1 | Memory-light orbit | Ambient, always | World | Lights circle their cluster slowly | Continuous | Held still | Cheap |
| A-P2 | Cluster arrival | New person grows a cluster | World | A quiet arrival, no fanfare | Moment | Instant state change | Cheap |
| A-P3 | Bridge kindling | A shared memory is found | World | A fine bridge of light appears between two clusters | Moment | Instant state change | Cheap |
| A-P4 | Quiet re-derivation | Data changes mid-visit | World | The field re-derives quietly | Moment | Identical | Cheap |

**Combined load (worst honest case):** A-P1 + A-P2 + A-P3 simultaneously on a large fixture graph. **Fallback ladder:** orbit density → haze plane count → bridge rendering. **Never degraded:** cluster identity, bridge truth, or the names/dates/threads.

## 6. Shared vs distinct (D-18)

**Shared (universe-wide, cohesion):** the ship and its carry/place grammar · gate design language (the corridor's entry gate is the same gate family as everywhere) · UI voice, naming, plain-language summaries · the cyan = navigation-truth convention.
**Distinct (this space only):** the warm clustered orbits · amber-warm light on dark · the neighborhood-at-dusk composition · bridges as shared chapters · the quiet-notes treatment of dates and threads.

## 7. Seed parameter table (V4 traceability reference)

| Parameter | Derivation |
|---|---|
| Palette hues (amber/dusk/cyan) | Seed `first-circle-1` palette math, fixed offsets per role |
| Fog color & density | Field dusk from seed; density set by arrival-stage table |
| Cluster proportions (center : orbit : lights) | Fixed ratios in the recipe (form language — not seed-varied) |
| Orbit period | Seed-derived within a calm band (never faster than stately) |
| Cluster placement | mulberry32 over recipe seed + person id |
| Bridge rendering | Derived from endpoint ids only |
| Haze plane selection/tint | Seed-chosen from the §10 verified backdrop set |

## 8. Recipe settlement — SETTLED by the build-all order (2026-10-26, Rev 123)

- **R-P1** The form: warm clustered orbits, one cluster per person — approved.
- **R-P2** The palette: amber-warm light on dark — approved.
- **R-P3** The seed: `people / first-circle-1` — approved.
