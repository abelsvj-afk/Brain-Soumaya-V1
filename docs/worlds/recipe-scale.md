# Environment Recipe — Scale (Phase 0 recipe)

**Status:** Phase 0 recipe — **SETTLED by the build-all order (2026-10-26, Rev 123)**: R-C1 approve form, R-C2 approve palette, R-C3 approve seed `scale / actual-size-1`. **Scope:** the Scale space. **Settled ground it must obey:** the Scale design note (Rev 123); D-2 (the real ISS is reserved to Scale); §10.1 stack; §11 criteria; §14 Animation Gate; §15 utility-first; §17 presentation safeguards. Nothing here authorizes a build beyond the build-all order's lane.

---

## 1. Identity & visual grammar

**One-line identity:** *The actual station, actual size* — the real ISS at its real size, with real explorers around it, in a true sky.

**Form:** the ISS (A) as hero — a bright, real structure in true black — with NASA probes (Kepler, Pioneer 10, Dawn, Voyager) as small true things at real distances, and witness objects of known size (your ship, a docked capsule) sharing the frame so the station's size has witnesses.

**Seed & palette (traceability — every value below derives from the seed recipe, §8):**
- **Seed string:** `scale / actual-size-1` — all palette math, fog, probe rhythm, and proportion ratios derive deterministically from it. Changing the seed changes the space's *weather*, never its form language.
- **Structure:** the ISS's own white and solar-panel gold, ungraded — the station is real, and its colors are its own, not the seed's. The seed governs the space around it (backdrop, witnesses, light), never the station's own materials.
- **Working light:** solar gold — the station's panels catching the sun. The station *glows like a thing that works in sunlight*.
- **Guidance light:** pale cyan — lane markers, approach strobes, gate-side beacons. Cyan always means *navigation truth*.
- **Backdrop:** true black + HYG starfield (real positions/colors) + real named asteroids. No nebula planes here — Scale's sky is true, not painted.
- **Fog:** none. Space at this scale has no fog; distance reads through witness objects and the approach stages, not through haze.

**Light grammar:** one key light (the real sun, cool white), the station's own solar gold, cyan guidance accents. Nothing else emits.

## 2. Spatial composition & the approach

1. **Far (arrival):** the ISS a small bright shape against true black and true stars.
2. **Middle (witnesses):** your ship, a docked capsule, a passing probe share the frame — the station keeps growing past every size your brain expects.
3. **Near (1:1):** the station overfills the view at closest approach; individual modules resolve; the scale is felt, not stated.

**Composition rules:** the approach is gently curved, never a sterile straight line; the station is never centered dead-on until the final arc; something with honest size always shares the frame in the middle distance.

## 3. Meaningful content & visual honesty

- **Real (fact, §14.2):** the ISS (real model, real size), the probes (real spacecraft, real missions, real stories in plain words), the named asteroids (real data), the HYG stars (real positions). No invented mission facts, no invented distances.
- **Atmosphere (never fact):** passing traffic at distance. Traffic implies no users and no brain activity.
- **Absent by design:** memories of Scale's own (memories appear only as cargo in transit with the ship); nebula paintings; fog; any size number shown as a label. The size is felt — the numbers live in the build record, not in the world.
- **Gate silhouette (adopted amendment, Rev 123):** Scale's gate is a **survey frame** — a clean rectangular measurement frame of thin light, like a surveyor's mark held against the dark. The gate that measures: you pass through a frame that says, plainly, how big the thing beyond it is.

## 4. Performance & accessibility budget (against §11.2's fixed ceilings)

Ceilings (not targets): ≤200 draw calls · ≤750k visible triangles · textures ≤1K (hero ≤2K) · backdrop ≤2048×1024 · cold load ≤5 s · ≥50 fps avg / ≥30 fps 1%-low.

**Proposed allocation (the build is graded against the ceilings, not this split):**
| Consumer | Draw calls | Triangles | Notes |
|---|---|---|---|
| ISS (hero) | ≤15 | ≤50k | ISS (A) is 6,642 tris; headroom is deliberate |
| Probes (4) | ≤12 | ≤100k | Real models, slimmed; count is the fallback dial |
| Backdrop (HYG stars/asteroids) | ≤8 | ≤30k | One-draw-call Points for stars |
| Witnesses / passing scenery | ≤15 | ≤120k | Instanced/reused |
| Ship + arrival | ≤10 | ≤50k | Shared asset (universe-wide) |
| UI overlay | ≤15 | ≤30k | Probe stories, route info in plain words |
| **Total** | **≤75** | **≤380k** | Planned ≤90 calls / ≤500k tris (Scale note §3) |

**Accessibility:** reduced motion = a calm guided glide: no banking, transitions by gentle fades between staged distances — same information, same arrival. Guidance meaning is never carried by color alone. All text in plain language; no UTC, ever.

## 5. Animation inventory slice

| # | Animation | Trigger | Actors | Motion (plain) | Duration | Reduced-motion equivalent | Cost |
|---|---|---|---|---|---|---|---|
| A-C1 | Scale approach | Arrival flight | Ship, world | Three-stage closing: silhouette → witnesses → 1:1 | Journey | Guided glide with fades | Heavy |
| A-C2 | Probe drift | Ambient, always | World | Probes drift slowly on their true vectors | Continuous | Held still | Cheap |
| A-C3 | Gate reveal | A destination is discovered | World | Its marker kindles from unlit to cyan-lit, once | Moment | Instant state change | Cheap |

**Combined load (worst honest case):** A-C1 + full A-C2 + overlay during the arrival arc. **Fallback ladder:** probe count → witness density → star point count. **Never degraded:** the ISS silhouette, guidance lights, route information, or the arrival itself.

## 6. Shared vs distinct (D-18)

**Shared (universe-wide, cohesion):** the ship and its carry/place grammar · gate design language · HYG starfield rendering · UI voice, naming, plain-language summaries · the cyan = navigation-truth convention.
**Distinct (this space only):** the real ISS at real size · the true sky (no nebula, no fog) · real probes with real stories · scale as the subject itself.

## 7. Seed parameter table (V4 traceability reference)

| Parameter | Derivation |
|---|---|
| Backdrop (star density, asteroid placement) | Seed `actual-size-1` palette math, fixed offsets per role |
| Probe drift vectors | Seed-derived within true mission headings (never invented) |
| Witness placement | Fixed ratios in the recipe (form language — not seed-varied) |
| Approach-stage distances | Fixed by the recipe (scale is the subject — never seed-varied) |
| ISS materials | **Not seed-derived — the real station, its own colors** |

## 8. Recipe settlement — SETTLED by the build-all order (2026-10-26, Rev 123)

- **R-C1** The form: the real ISS at real size, probes as witnesses — approved.
- **R-C2** The palette: true black, solar gold, the station's own white — approved.
- **R-C3** The seed: `scale / actual-size-1` — approved.
