# Phase 2 · P2-6 Design Note — The Great Station Scale-Up (DRAFT)

**Status:** DRAFT — for the review loop. No build authorized. No implementation is authorized by this note.
**What P2-6 is:** the Station, made gigantic and game-alive. The Station exists in code (P2-3 hull + Profondo, P2-4 mount, P2-5 gates + transit) and is live (D-70). What it is not yet, in the owner's words (2026-10-25): gigantic enough to make sense for a station that houses ships and people and stores, with better coding, better animations, and better accessories around it so it actually looks like a game — EVE Online is the reference. This increment does that, inside the settled recipe and budget, without touching the travel economy, the state machine, or any other world.
**Order:** after P3-2's review loop (Deep Past is next in the roster, D-23); the Station scale-up is a parallel track that touches the live Station, so it follows the same lane — design note → review → owner's settlement → owner's build word → build → full gate → owner's merge tap → post-merge audit. It ships **visible** (D-70 — no more dark shipping).

---

## 1. Settled ground this note obeys

- **The recipe** (`recipe-great-station.md`, settled D-26): R-S1 crown-and-stem form, R-S2 palette (basalt graphite/gunmetal, warm sodium-amber working light, pale cyan = navigation truth only), R-S3 name deferred ("the Great Station" is the working display name — the owner's to give), R-S4 slow ring rotation. Budget **≤88 draw calls / ≤750k triangles — a hard rejection boundary, never a target** (the recipe's own margin note: any run landing *at* the boundary is a warning to investigate, not a pass to celebrate).
- **D-37 (Profondo is the hull):** Profondo by vostok, CC BY 3.0, verified from the file; 132,432 tris after weld + decimate; Draco `profondo.glb`, 596,684 bytes. The crown-and-stem procedural form is retained as BACKUP. The D-37 accessory layer is this increment's core: beacon arrays and approach lane markers, docking extensions and traffic (A17), light rigs in the amber/cyan grammar, solar/antenna dressing, window-light life. The owner's bar: *much more beautiful than the Phase 1 mockup.*
- **D-5:** the Station surfaces journeys and routes, NOT memories. A memory appears here only as visible cargo in transit with the ship (A1–A2).
- **D-2:** fictional megastructure, bigger than the home sun (felt scale), long approach, other traffic; interior is a LATER phase. The real NASA ISS is reserved for the Scale Space.
- **D-48:** the real starfield belongs to the WORLDS spaces; the home galaxy is settled, untouched; the ship is the navigation vehicle and must be able to warp; placeholders yield to real assets as design completes.
- **§11 criteria (fixed, D-3):** ≥50 fps avg, ≥30 fps 1%-low over 5-min sessions incl. warp + approach; no stall >100 ms; ≤200 draw calls (hard fail >500); ≤750k visible tris hard rejection; textures ≤1K (hero ≤2K); cold load ≤5 s; 15-min soak; reduced-motion held to the same bar.
- **Phase 1 evidence (the bar this increment must beat, not just match):** Station device session 1 — fps avg 99.3, 1%-low 59.5, cold load 568 ms, draw calls 16, tris 27,284; P3 longest frame 108.7 ms FAIL → diagnosed → fixed → owner-waived (D-28). The owner also said the mockup "doesn't look too pretty" — a performance/structure proof, never the visual bar.
- **Completeness principle (owner, 2026-10-25):** every world must be complete from every reachable angle. A camera that can reach a place must find it finished; an angle that cannot be finished must be unreachable. The Station is a whole solid — no unfinished underside, no hollow back, no view that reveals the model ends.
- **The cross-phase invariant (P2-4):** nothing about a world may ever affect the ability to access memories, drift, or return home.

## 2. Recon facts (builder-verified in the repo, to be confirmed at build recon)

- `graph/stationScene.ts` renders the proxy hull immediately and self-loads/swaps the Profondo GLB (`createStationScene()` with no hull arg); failure registers `noteModelFallback("profondo.glb")`. `graph/profondoHull.ts` is the loader. `graph/stationLayout.ts` holds the palette consts, the seed `great-station / harbor-1`, APPROACH_STAGES far 900 → handoff 380 → arrival 150, STATION_WHEEL_RADIUS 210, STATION_BUDGET 88 calls / 750k. `graph/hygStars.ts` is the HYG starfield (one draw call). `graph/transitScene.ts` (P2-5) holds the procedural ship; `graph/gateScene.ts` holds the shared gates. `components/WorldsSurface.tsx` mounts the Station scene when state says "great-station".
- **Current traffic is procedural and thin:** instanced beacons/traffic in `stationScene.ts`, no real ship assets. Every ship the Station shows today is a placeholder by the owner's definition.
- **Free-ship shortlist exists** (`docs/worlds/free-spaceship-shortlist.md`, 2026-10-25): Kenney Space Station Kit (90 models, CC0 — dressing + ships), Kenney Space Kit (150 models, CC0 — hero candidates + traffic), Quaternius Ultimate Spaceships Pack (CC0 — varied fleet/traffic), reodesuxz Low Poly Space Pack (26 models, 4,868 tris total — filler), FlexUnit UFO (1,906 polys — odd visitor craft), archfan7411 Stylized Spaceship (CC0 — hero candidate), NASA 3D Resources (public domain, conditional — tri-count check first; Lunar Module 100,628 polys rejected). All no-account downloads, licenses verified from the source. **Nothing ships without a verified license FROM the file + a `public/CREDITS.md` entry + a measured tri count.**
- **The budget ledger, as it stands:** Profondo 132,432 tris is the only measured number. Everything else (dressing, traffic, ships) is unmeasured until import. The recipe's own split sums to the full 750k ceiling — this increment must land materially below it, with the ledger computed from measured counts at build recon (see §3.4).

## 3. Design

### 3.1 Scale — make it gigantic (the owner's direction)

Scale is felt in sequence, not stated (recipe §2). The moves:
- **Approach distances stretched:** the three stages (far 900 → handoff 380 → arrival 150) are re-measured against the hull's real size so the Station overfills the view on final approach and the home sun reads as a backdrop disc the ring can eclipse (the recipe's awe-scale rule). The exact numbers are build-recon work against the Profondo hull's measured dimensions.
- **Ship-to-station ratio made explicit:** the user's ship (and every traffic ship) is sized against the wheel so the ratio reads at a glance — the Station houses ships, so ships must look housed. A fixed ratio (ship length : wheel diameter) is recorded in the layout module and test-asserted.
- **Witnesses in the middle distance:** a hauler and a drydock frame share the frame on the approach (recipe §2) so the Station's size always has something honest beside it. These are the Kenney Station Kit's natural jobs.
- **Docking arms with docked ships of many sizes:** arms crowded with moored ships, cargo pods, fuel lines — the Station reads as a working port, not a monument. Sizes vary so the scale ladder is visible in one look.
- **Open question Q1:** how gigantic, measured how? Proposed: the wheel diameter in ship-lengths, and the far-stage distance, are the two numbers the owner settles. The note recommends the Station read as a city, not a ship — but the owner picks the ratio.

### 3.2 Accessories — the D-37 layer, built out

- **Beacon arrays + approach lane markers** (cyan, navigation truth only, shape-coded + rhythm-coded for color-vision safety).
- **Docking extensions, cargo pods, fuel lines, solar/antenna dressing, window-light life** — amber, seeded from `harbor-1`, never hand-placed decals.
- **Traffic (A17):** instanced ships on curved lanes, arriving/departing vectors, no interaction. Real assets from the shortlist (Quaternius for variety, reodesuxz for filler, Kenney for station craft) replace the procedural traffic — each asset's tri count measured at import and entered in the ledger.
- **Passing scenery:** beacon rings the ship passes through, a skeletal drydock frame off the lane, distant haulers on crossing vectors (recipe §2, middle stage).
- Accessories serve the wheel silhouette, never clutter it. Every light obeys the grammar (amber = inhabited/working, cyan = navigation); no decorative strobes that could be mistaken for signals.

### 3.3 Animation — better, not busier

- **A17 traffic lanes:** continuous, ambient; reduced motion halves density with no near-lane passes.
- **A13 approach:** the three-stage closing, with the handoff graded for pop-in/flicker/depth artifacts (the recipe's named technical risk, §11.3 V3).
- **R-S4 ring rotation:** slow and real, stately enough never to compete with route information; reduced motion suppresses visible rotation while preserving the same scene information.
- **New, small, in-scope:** docking sequences (a ship easing onto an arm), blinking work lights, a slow orbit reveal on first arrival (A15). **Out of scope:** any animation that implies a user, a brain event, or a reward — traffic implies no users and no brain activity (§14.2).
- **Fallback ladder (in order):** traffic count → nebula plane count → passing-scenery density → approach particle haze. **Never degraded:** the station silhouette and its LOD handoff, guidance lights, route information, or the arrival itself.

### 3.4 Performance ledger — measured, not asserted

At build recon the builder measures every candidate asset (glTF-Transform inspect, same as Profondo) and records a ledger: Profondo 132,432 (known) + dressing + traffic + ships + backdrop + UI, with the total landing **materially below** 750k tris and ≤88 draw calls. Any asset that would push the total to the boundary is cut or LOD'd — the boundary is a warning, not a target. The ledger is filed in the build record and the scene module test-asserts the constants.
- **Ship assets:** the hero candidate (Kenney Space Kit or OGA stylized ship — owner's pick, Q2) gets the material pass Profondo got (re-expressed in-app by material name, mutated in place). Traffic ships are instanced; one InstancedMesh per model.
- **Textures:** ≤1K (hero ≤2K), per §11. Kenney/Quaternius models are low-poly with small or no textures — verify at import.

### 3.5 Completeness — the garden-underside lesson, applied here

- The Station is a whole solid: Profondo hull + dressing read as a complete object from every angle the camera allows — including from below and behind. Any angle the builders cannot finish is outside the camera's allowed range, by construction — and the range is tested (see §4 C7).
- The approach corridor is bounded: the camera cannot leave the lane into unbuilt space.

### 3.6 Loading, error, and staleness behavior

- Profondo load failure keeps the existing honest behavior (`noteModelFallback`, proxy hull renders). A dressing-asset failure degrades to the previous accessory level — never a crash, never a blank Station, never a silent missing piece presented as complete.
- No new server surface. No economy change. No state-machine change.

## 4. Acceptance criteria (for the build, when authorized)

- **C1 Scale (measured, not asserted):** on the owner's phone, the Station overfills the view on final approach; the ship-to-station ratio reads at a glance; a witness (hauler/drydock) shares the middle-distance frame. Recorded as stills + the approach recording, with the settled ratio (Q1) visible in the layout constants.
- **C2 Accessories:** the D-37 layer is present and legible — beacons, lane markers, docking arms with docked ships of varied sizes, cargo, work lights — each obeying the amber/cyan grammar. No placeholder procedural traffic remains in the Station scene.
- **C3 Animation:** A17 traffic, A13 approach, R-S4 rotation, and the new docking/work-light motions run; the handoff is graded for pop-in/flicker/depth artifacts (V3); reduced motion preserves the same information, destination, and arrival with no rotation and no near-lane passes.
- **C4 Budget — static and measured:** the ledger (§3.4) is filed with measured tri counts; static constants assert ≤88 calls / ≤750k; *measured* on the owner's phone (warp + approach, 5-min session): draw calls, tris, cold load ≤5 s, fps avg ≥50, 1%-low ≥30, no stall >100 ms. A measured miss triggers optimization or a design return — never a silent relaxation.
- **C5 Flag-on behavior (no more dark shipping, D-70):** the scale-up ships visible. The build verifies the Station works with the flag on and the home galaxy and other worlds are unchanged.
- **C6 Full gate:** complete suites + typecheck + production build, evidence stated exactly. (P2-5's gate was caveated by the sandbox; if the environment still cannot run the web suite at P2-6 build time, that caveat is stated plainly again — never laundered.)
- **C7 Completeness (owner direction, 2026-10-25):** for every camera position the controls allow, the scene is finished — hull, dressing, underside, and approach corridor all read as complete. Tested by driving the camera to every allowed extreme and recording that each view is finished. Any angle that cannot be finished is outside the allowed range, and the range itself is tested.
- **C8 Asset honesty:** every shipped asset has a license verified FROM the file, a `public/CREDITS.md` entry, and a measured tri count in the ledger. No asset ships on a roundup's word. `soumaya-ship.glb` is not used (license unverified — open audit item, unchanged).

## 5. Open questions for the owner

- **Q1 Scale, measured how?** Proposed: wheel diameter in ship-lengths + the far-stage distance are the two settled numbers. How big should the Station feel — a city, a town, a mountain? Pick the ratio and the note records it.
- **Q2 Which hero ship?** From the shortlist: Kenney Space Kit ships (stylized, consistent with the Station Kit) or the OGA stylized spaceship (clean form, needs the material pass)? Or keep the procedural hull as the hero and use real assets for traffic only?
- **Q3 Animation scope.** Docking sequences + work lights + first-arrival orbit reveal — in, or ambient traffic only? Recommended: in, small.
- **Q4 Name (R-S3, still deferred).** "The Great Station" is the working display name. Still yours to give — or still deferred?

## 6. Sequencing & non-scope

- This note → review loop (ChatGPT + the cold-check findings, which may change this note — the cold check hunts Station scale as item #2) → owner's settlement of Q1–Q4 → owner's separate implementation word → build → full gate → owner's merge tap → post-merge audit. The lane that built Phase 2 and P3-1, unchanged.
- **Not in P2-6:** the Station interior (later phase, D-2); any change to the travel economy or state machine; any change to the home galaxy; People, Scale, Quiet/Archive; the Man-God (other chat); NPCs and the autonomous agent (separate design track — §16 fence); the P3-2 Deep Past build (separate increment, separate authorization).
