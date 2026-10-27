# Environment Recipe — Quiet/Archive (Phase 0 recipe)

**Status:** Phase 0 recipe — **SETTLED by the build-all order (2026-10-26, Rev 123)**: R-Q1 approve form, R-Q2 approve palette, R-Q3 approve seed `quiet-archive / still-water-1`. **Scope:** the Quiet/Archive space. **Settled ground it must obey:** the Quiet/Archive design note (Rev 123); the P4 archive invariant; §10.1 stack; §11 criteria; §14 Animation Gate; §15 utility-first; §17 presentation safeguards. Nothing here authorizes a build beyond the build-all order's lane.

---

## 1. Identity & visual grammar

**One-line identity:** *The resting place* — a still field where archived things rest, low and even in light, nothing asking anything of you.

**Form:** a still field — archived clusters resting like quiet lamps, far apart, low light, nothing moving fast. The field is walked among, slowly. No center, no sun, no monument. Rest is the form.

**Seed & palette (traceability — every value below derives from the seed recipe, §8):**
- **Seed string:** `quiet-archive / still-water-1` — all palette math, fog, cluster rhythm, and proportion ratios derive deterministically from it. Changing the seed changes the field's *weather*, never its form language.
- **Structure:** dim cool stone and still water tones — slate, deep blue-gray, the quiet end of the palette. Nothing bright, nothing warm enough to hurry you.
- **Working light (the field's signature):** soft low lamplight — each archived cluster a small, steady lamp. The light is low and even; no cluster outshines another.
- **Guidance light:** pale cyan — gate-side beacons only. Cyan always means *navigation truth*.
- **Backdrop:** dim cool stillness — a dark, even sky with faint stars, far and quiet. No nebula color, no dawn, no dusk drama.
- **Fog:** palette-matched, thin and even — the field's stillness made visible; cluster lamps must read through it at any distance.

**Light grammar:** one key light (dim, cool, even), the clusters' own baked lamplight (no post-processing bloom, §10.1), cyan guidance accents. Nothing else emits. Stillness is the identity.

## 2. Spatial composition & the arrival

1. **Far (arrival):** you arrive at the edge of a still field — low, even light, archived clusters resting like quiet lamps, far apart.
2. **Middle (walking among):** clusters pass slowly; each one holds a whole story, old lights and new lights together. The spacing rule keeps the field readable at any size — the field grows without bound as the brain archives, and the spacing grows with it.
3. **Near (a cluster):** the archived person's whole story, held together. Touching a presence surfaces it through the app's existing memory mechanisms — reuse, never a parallel viewer.

**Composition rules:** deterministic seeded placement (mulberry32 over recipe seed + archived id) — same archived thing, same place, every visit, every device. No cluster is nearer, larger, or brighter for recency, importance, or any other rank. Restoring in the brain removes the cluster quietly on the next visit.

## 3. Meaningful content & visual honesty

- **Real (fact, §14.2):** the archived people and memories, exactly as archived — whole story held, nothing added, nothing taken away. Dates as quiet records.
- **Atmosphere (never fact):** the stillness itself, the even lamplight. Stillness implies no state and no judgment.
- **Absent by design:** scores, judgments, comparisons, "last visited" counters, counts presented as a burden, restore/delete suggestions, notifications, nudges, NPCs. Nothing here ever pulls you here, and nothing here ever asks you to act.
- **Gate silhouette (adopted amendment, Rev 123):** Quiet/Archive's gate is a **low still threshold** — a quiet doorway of dim light, low and wide, that you pass through without ceremony. No fanfare, no kindling, no reveal animation. The gate does not announce itself.

## 4. Performance & accessibility budget (against §11.2's fixed ceilings)

Ceilings (not targets): ≤200 draw calls · ≤750k visible triangles · textures ≤1K (hero ≤2K) · backdrop ≤2048×1024 · cold load ≤5 s · ≥50 fps avg / ≥30 fps 1%-low.

**Proposed allocation (the build is graded against the ceilings, not this split):**
| Consumer | Draw calls | Triangles | Notes |
|---|---|---|---|
| Clusters (instanced lamps) | ≤20 | ≤150k | InstancedMesh; spacing rule is the fallback dial |
| Backdrop (dim sky) | ≤6 | ≤20k | Faint stars only |
| Ship + arrival | ≤10 | ≤50k | Shared asset (universe-wide) |
| UI overlay | ≤10 | ≤20k | Names and dates in plain words |
| **Total** | **≤46** | **≤240k** | Planned ≤60 calls / ≤300k tris (Quiet/Archive note §3) |

**Accessibility:** reduced motion = the field *held* — no drift at all; information identical. Guidance meaning is never carried by color alone. All text in the brain's naming and plain language; no UTC, ever.

## 5. Animation inventory slice

| # | Animation | Trigger | Actors | Motion (plain) | Duration | Reduced-motion equivalent | Cost |
|---|---|---|---|---|---|---|---|
| A-Q1 | Slow drift | Ambient, always | World | The field breathes, barely | Continuous | Held still | Cheap |
| A-Q2 | Quiet arrival | A thing is archived | World | A lamp kindles, quietly, on the next visit | Moment | Instant state change | Cheap |
| A-Q3 | Quiet departure | A thing is restored | World | A lamp goes out, quietly, on the next visit | Moment | Instant state change | Cheap |

**Combined load (worst honest case):** A-Q1 + A-Q2 + A-Q3 on a large archive. **Fallback ladder:** lamp count → fog density. **Never degraded:** cluster identity, or the honesty of what rests here.

## 6. Shared vs distinct (D-18)

**Shared (universe-wide, cohesion):** the ship and its carry/place grammar · gate design language · UI voice, naming, plain-language summaries · the cyan = navigation-truth convention.
**Distinct (this space only):** the still field · dim cool lamplight · rest as the form · the low still threshold · deliberate visits only.

## 7. Seed parameter table (V4 traceability reference)

| Parameter | Derivation |
|---|---|
| Palette hues (slate/lamplight/cyan) | Seed `still-water-1` palette math, fixed offsets per role |
| Fog color & density | Field stillness from seed; thin and even |
| Cluster proportions (lamp : spacing) | Fixed ratios in the recipe (form language — not seed-varied) |
| Cluster placement | mulberry32 over recipe seed + archived id |
| Lamp brightness | Fixed, even across clusters — never seed-varied, never rank-driven |

## 8. Recipe settlement — SETTLED by the build-all order (2026-10-26, Rev 123)

- **R-Q1** The form: a still field of resting lamps — approved.
- **R-Q2** The palette: dim cool stillness, soft low lamplight — approved.
- **R-Q3** The seed: `quiet-archive / still-water-1` — approved.
