# Phase 3 · Scale World — Design Note (DRAFT)

**Status:** DRAFT — filed 2026-10-26 (Rev 123). **Build-authorized by the build-all order (2026-10-26 evening)** — the per-increment tap is suspended; this note authorizes the build in the default lane (build → full gate → merge → audit). No deploy authorized.
**What Scale is:** the world of real size. The roster order is Growing Place → Deep Past → People → Scale → Quiet/Archive (D-23). Scale is PUBLIC (PUBLIC = Great Station + Scale only).
**Settled ground it obeys:** D-2 (the real ISS is reserved to Scale; the Station is a fictional megastructure, never the ISS); the §10.1 stack; §11 budgets; the never-punish invariant; D-1 (fuel buys speed, never access; home always free); no UTC in anything user-facing; the EVE/NMS gate-silhouette amendment (adopted Rev 123).

---

## §1 The emotional core — the actual station, actual size

- **The whole point of Scale is one sentence (owner's direction, filed): "this is the actual station, actual size."** Not a model of the ISS, not a station-like shape — the real International Space Station, at its real size, with your ship beside it so the size is felt, not stated.
- **The asset is filed and waiting:** NASA ISS (A) — the catalog's low-poly model, **6,642 tris** (catalog claims 6,628; triangulation noise), 7,565 verts, 1 mesh, 6 flat materials, 39,708 bytes, bbox 37.77 × 22.67 × 23.54, no embedded images. SHA-256 `70d0619a69312a45cbf740ba9a491fad854e10226dc5936c213fb1f93f063678`. Public domain (NASA 3D Resources). ISS (B) is NOT the candidate — 174,440 tris, ~26× heavier; any use would need heavy decimation. Prefer (A).
- **Insignia check belongs to this build's recon:** neither variant embeds textures, so there is no insignia texture to scrub; geometry-level insignia was NOT checked — the builder checks it before the ISS ships.
- **Scale is felt in sequence, not stated:** you arrive far, the station is a small bright shape; you close, and it keeps growing past every size your brain expects — approach cues (witness objects of known size: your ship, a docked capsule, a passing probe) share the frame so the station's size has witnesses (EVE E5, adapted).

## §2 The probes — real explorers, real distances

- **NASA probes live here:** Kepler, Pioneer 10, Dawn, Voyager — staged locally, deferred to Scale by call budget in the P2-6 build record. They are real spacecraft, real missions, real distances — each one a small, true thing in a vast, true dark, with its real story carried in plain words beside it.
- **Real sky is the identity axis (NMS N6, deliberate divergence):** Scale's sky is *true* — HYG stars (already built, P2-3), real named asteroids (50–100 as static JSON, queried at build time only, never from the client), real-sky backdrops where they fit. A memory galaxy anchored in a real sky feels kept, not generated.
- **What Scale surfaces:** real distance, real scale, real missions. It surfaces no memories of its own (like the Station, it is not a memory-bearing world) — memories appear here only as cargo in transit with the ship, the traveler's own act.

## §3 The scene (product code)

- New modules beside the Station's, the garden's, and the Deep Past's: a layout module (deterministic placement under the recipe seed; budget constants **≤90 draw calls / ≤500k triangles planned**, test-asserted like `stationLayout`) and a scene module (ISS hero + probe dressing + real-sky backdrop, baked glow only, no post-processing, per the settled stack).
- **Arrival vista:** you arrive at distance — the ISS a bright shape against true black and true stars — and close on it in stages (far silhouette → middle witnesses → near 1:1, the station overfilling the view at closest approach).
- **Camera:** arrival at distance, closing glide. Reduced motion: the calm guided glide, same information, same arrival.
- **Gate silhouette (adopted amendment):** Scale's gate is a **survey frame** — a clean rectangular measurement frame of thin light, like a surveyor's mark held against the dark. The gate that measures: you pass through a frame that says, plainly, how big the thing beyond it is.
- **Ships:** the traveler's own ship in transit as usual; NPC ships and real users' ships may pass at distance (Scale is public). No NPC people.

## §4 Travel

- Server allow-list gains `"scale"`; the client chart gains the matching entry (name "Scale"; blurb in plain language). Same economy: warp 10, drift free, bonuses exactly as P2-4 settled — no economy change.
- The Station stays the guaranteed fallback route; direct world-to-world gates are discoverable through use (D-10).

## §5 Acceptance (what "done" looks like when this builds)

- **C1** ISS (A) renders at real relative scale with witness objects; the size reads on the owner's phone without any number being shown.
- **C2** Probes present with true stories in plain words; no invented mission facts.
- **C3** Real-sky identity: HYG stars + named asteroids from static data; no fake starfield.
- **C4** Budgets §11.2 hold; reduced-motion equivalent carries the same information.
- **C5** Full gate before any merge ask; merge is the owner's separate tap (repo lane).
- **C6** Failure honesty: a failed asset load renders its honest fallback and says so (`noteModelFallback`, the Profondo pattern) — never a blank sky.

## §6 Open questions (design, not blockers)

- **Q1** Which probes first — all four, or Voyager + Pioneer first and Kepler/Dawn after?
- **Q2** Does Scale carry any memory content at all (a "missions you have flown" record), or stay purely a place of real size?
- **Q3** The insignia verdict from recon — any geometry-level insignia, and if so, scrubbed or kept with attribution?
