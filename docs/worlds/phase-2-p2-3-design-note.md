# P2-3 Design Note — Web Travel Layer + The Great Station (Phase 2, Increment 3)

**Status:** DESIGN ONLY (opened by the owner, 2026-10-23 — "Start p2 3"). This note authorizes nothing: no code, no asset download into the repo, no flag, no deployment. Implementation requires the owner's separate authorization after review, per the standing lane.
**Basis:** D-22 (Phase 2 = travel skeleton + Great Station) · `phase-2-planning.md` (P2-3 line: gate, transit, Station arrival + route board, gauge labels from shared constants, budgets verified on the owner's device class) · the P2-2 server contract as merged (`94f2817` + F-01 fix `ba595e7`) · the Great Station recipe as amended by **D-37** (hull = Profondo, CC-BY; accessory layer designed by King; crown-and-stem procedural form = backup) · D-1/D-33 fuel guarantees · §11 budgets · §14 Animation Gate · review 18's binding rule (the server — never the browser — enforces the cancel window and prevents duplicate charges).

---

## 1. What P2-3 is — and is not

**Is:** the visible half of the travel skeleton. (a) The Great Station scene: Profondo's hull dressed with a designed accessory layer, in a real starfield, approached in three stages. (b) The travel layer: gate, departure, the cancel window, transit (warp/drift), turn-back, arrival, return — bound honestly to the P2-2 API. (c) The route board at the Station. (d) The attribution surface the licenses require. (e) Budget + device verification.

**Is not:** journey bonuses or any reward feedback (P2-4) · carrying memories as cargo (Phase 3) · a Station interior (later phase) · any other world · flag activation (P2-4's dark launch) · deployment. The increment ships **dark**: complete, tested, invisible while the worlds flag is off.

## 2. Gate 0 — Profondo inspection (runs first; everything else waits)

No scene code is written until the hull is proven. Steps, in order, each with a hard stop:

1. **Obtain the file.** BlendSwap downloads require an account (verified 2026-10-23: the download endpoint returns a login page to anonymous requests). The file is obtained through the owner's BlendSwap account (his download, or the browser's secure login flow with his credentials) — never a re-upload mirror, which would muddy the license chain. The downloaded `.blend` is stored outside the repo; only the converted, optimized glTF ever enters it, alongside its license record.
2. **Measure.** True triangle count, object/material inventory, and geometry sanity (normals, stray scene objects, the author's light rig and compositing setup are discarded — we keep geometry + material groupings only). **Fail line:** >150k triangles after a reasonable decimation pass, or geometry that cannot survive conversion intact → backup form.
3. **Convert.** `.blend` → glTF via headless Blender (the build environment gains a Blender install as a prep step; it is not currently present). Cycles materials are re-expressed as PBR under the recipe's grammar: basalt/graphite hull tones, amber working light zones, cyan reserved for navigation.
4. **Look test.** The converted hull, lit our way, in the sandbox scene harness (the Phase 1 grading rig): silhouette read at approach distance, surface read at arrival distance. **Fail line:** the owner's eye — if it does not clearly beat the mockup's look, the backup form takes over. (Owner, D-37: the mockup is not the visual bar.)
5. **Register.** License entry completed (asset · source · author · CC-BY · slot: Great Station hull · attribution text) before the asset is used anywhere else.

**GATE 0 RECORD (2026-10-23, King):** the owner downloaded the file through his own BlendSwap account and sent it in — license chain clean. Steps 1–3 and 5 are DONE. **COMPLETED 2026-10-23 (D-43): step 4 PASSED — the owner's tap passed the look-test and merged PR #97 (`583a3d3`). The shipped asset is the Draco-compressed encoding (596,684 bytes; geometry identical — 132,432 tris), wired in `graph/profondoHull.ts` with the proxy as fallback. P2-3 COMPLETE.**
- **File:** `Profondo.blend`, 6,892,000 bytes, Blender **2.68**, 66 mesh objects + the author's camera/light (discarded). Archive also carried the license page and a preview image.
- **License (verified from the file itself, not just the web page):** "Profondo by vostok — **Creative Commons Attribution 3.0** — You MUST give attribution/credit to vostok." No textures; Cycles materials only — as the page said.
- **Measure:** **333,563 evaluated triangles** (359,556 verts — heavy EDGE_SPLIT duplication), bounds 11.11 × 11.14 × 8.07 units. Weight: three circular structures (~98k) + eight identical 9,154-tri greeble blocks (~73k).
- **Convert:** headless Blender 4.2.3 (installed as build prep): weld (merge-by-distance 0.0005) → Decimate-collapse at ratio **0.40** → joined to ONE object, 5 material groups preserved (Material · arancione · luci · plastica grigia · plastica nera). **Result: 132,432 triangles — under the 150k line with headroom; GLB 3,468,496 bytes.** Verified by re-import (1 mesh, 132,432 tris, bounds intact). Note: §11's hard ceiling is 750k visible tris; the 150k Gate 0 line is the stricter headroom bar, and the conversion clears both.
- **Materials:** the raw glTF export is unfaithful to the 2014 Cycles setup (black base colors, broad emissive wash) — as this note predicted, materials are re-expressed in-app under the recipe grammar, by material name, mutated in place (replacing loaded materials breaks the mesh's rendering — found in smoke testing; same lesson family as run-the-package).
- **Look-test:** a single-file harness (hull + recipe lighting + beacon ring preview) was smoke-tested headless (loads clean, station reads at approach framing; screenshot on file) and sent to the owner. **Gate 0 closes on his verdict.** If he fails it, the crown-and-stem backup takes over per this section — the travel layer and scene scaffold are unaffected either way (the hull is a seam in `stationScene.ts`).

## 3. The Station scene

Built fresh as production code (mockup code carries over *nothing* but the lessons), three.js 0.182 (the web package's existing version), under the recipe:

- **Composition:** the recipe's three-stage approach — far silhouette against the backdrop → dual-layer handoff (the named V3 risk; graded artifact-free) → near arrival arc beneath the wheel. Profondo's wheel is the hero at every stage.
- **Accessory layer (§14 inventory):** A13 station approach dressing · A16 gate reveal markers · A17 ambient traffic (atmosphere, never fact — implies no users, no brain activity) · beacon arrays and lane markers in pale cyan (navigation truth only) · docking extensions seated on the hull's own spindle/rim logic · light rigs: baked amber glow (no post-processing bloom, per D-3), window-light life on the rim · A15 first-arrival moment. Every accessory is procedural and instanced where repeated; accessories serve the silhouette, never clutter it.
- **Sky:** HYG v4.2 subset — brightest ~5,000 stars as a build-time-generated static data file, true colors from B−V (CC BY-SA 4.0 — data file + attribution, per the corrected Research-1 reading) · backdrop: NASA (public domain, insignia-free selections) and/or ESA/Hubble (CC BY 4.0, credited) imagery, per-image terms checked at selection, ≤2048×1024.
- **Budgets (inherited, not renegotiated):** Station scene ≤88 draw calls planned (hard fail >500, target ≤200 total scene) · visible triangles ≤750k hard boundary, planned far below · textures ≤1K (hero ≤2K) · cold load ≤5 s · the §11 performance bars on the owner's device class (≥50 fps avg, ≥30 fps 1%-low, no stall >100 ms over the session script) · reduced motion: rotation and transit spectacle get real equivalents that preserve meaning, held to the same bar.

## 4. The travel layer

Placement follows the web package's existing shape: an `api/travel.ts` client beside the other per-domain API modules, travel UI alongside the galaxy experience, three.js scene code with the Station scene.

- **Contract binding (P2-2 as merged):** `GET /api/travel/state` (current world, active journey, fuel incl. `warpCost`) · `POST depart / cancel / turn-back / arrive`. The client renders the server's `TravelJourney` — it never computes settlement, charges, or arrival locally. Client timing decides *nothing*: the cancel countdown is drawn from the server-issued `cancelDeadline` for display; whether a cancel is free is the server's answer, not the client's guess.
- **Departure integrity:** the client generates a `clientKey` per departure intent and persists it across the request's retries (a double-tap, a dropped connection, a re-render) — the F-01-hardened replay contract is what makes this safe. A *new* intent gets a new key; a *retry* never does.
- **State rhythm:** fetch state on mount, after every action, and on return to the tab; during `arming`, a light poll keeps the presented window honest (presentation only — the server settles lazily regardless). During transit, presentation runs on the D-11 durations (warp 10–20 s class / drift 30–60 s class); `arrive` is called at presentation end — and if the server disagrees (already arrived, turned back), the UI adopts the server's returned state without argument.
- **Skip rule (D-11):** transit is skippable **after the first traversal** of a route. Traversal memory is client-side presentation state (which routes this device has completed) — explicitly non-authoritative, worth nothing, decides nothing but whether a Skip affordance appears.
- **Honesty rules:** no arrival is *shown* before the server confirms it; an `insufficient_at_window_close` cancellation is presented plainly as what it is (the journey didn't depart; nothing was charged); errors surface in plain language, never raw codes (the audit program's GH-19 rule, applied here from the start).

## 5. The route board

At the Station (and mirrored at the gate): the chart is the server's allow-list — in Phase 2, `home` and `great-station`. Discovered routes render lit with name, kind, and warp cost from shared constants (`WARP_COST`, drift = free); undiscovered destinations — none exist yet in Phase 2 — are specified now so Phase 3 inherits the mechanic: an unlit marker, labeled undiscovered in plain language, presence without fake content (recipe §3, N4). The board surfaces **journeys and routes only — never memories** (D-5).

## 6. Attribution surface

A credits view reachable from the app's existing settings/about area, carrying at minimum: **Profondo** — "Profondo" by vostok, source link (blendswap.com/blend/11999), "Licensed under CC-BY", plus the modifications note ("converted to glTF; materials re-authored; textures optimized") · **HYG star data** attribution (CC BY-SA 4.0) · per-image credits for any ESA/Hubble backdrop (CC BY 4.0) · NASA imagery noted as public domain. The surface ships in this increment — it is part of the license, not a polish item.

## 7. Shipping shape

The travel layer and Station mount only when the worlds flag is on, following the app's existing flag conventions (verified file-by-file at build). With the flag off, nothing in this increment is reachable, renderable, or loaded — the dark-launch posture P2-4 will activate deliberately, after its own device check.

## 8. Acceptance criteria (for the build's gate)

1. Gate 0 record complete: measured triangle count, conversion notes, look-test verdict — or the backup form invoked, with the reason recorded.
2. Contract tests: the travel client against a mocked P2-2 API — depart/cancel/turn-back/arrive flows, retry-with-same-key behavior, server-state adoption on disagreement, plain-language error surfaces.
3. Honesty tests: no arrival UI before server confirmation; insufficient-at-window-close presented as a no-charge cancellation.
4. Budget measurements: draw calls, visible triangles, texture inventory, cold load — recorded with environment (device class, runtime, method), per §11's evidence discipline.
5. Device run: the §18-style session script (cold load → idle → warp + approach → arrival → route board → return home → drift) on the owner's phone class, plus the reduced-motion run.
6. Attribution surface present and complete (manual check against the license register).
7. Flag-off check: with the flag off, no travel UI, no scene load, no API calls.
8. Full repo gate: web tests + typechecks (server/shared/web) green; no changes outside the increment's scope.

## 9. Open questions & risks

- **BlendSwap access** — the one step that may need the owner's hands (his account, his download). Everything else in Gate 0 waits on the file.
- **Blender in the build environment** — not present today; installing it (or an equivalent conversion path) is build prep, sized in the implementation plan.
- **Profondo's real triangle count** — unknown until Gate 0; the 150k fail line protects the budgets either way.
- **Dual-layer handoff (V3)** — the approach's named technical risk since Phase 1; the scene design keeps the recipe's mitigation (palette-matched fog + staged distances), and criterion 5 grades it on device.

## 10. Authorization boundary

This note + its review settle the design. Building requires the owner's explicit implementation authorization (which will also name the Gate 0 outcome handling). Merging stays his tap; the post-merge audit follows per the lane. Deployment and flag activation remain unauthorized — flag activation belongs to P2-4.

**ADDENDUM (2026-10-23, post-merge audit review 25, F-01): the Station scene's host.** The scene factory (`graph/stationScene.ts`) ships unmounted in P2-3 — deliberate, per this note's dark-launch posture (the scene mounts only when the worlds flag is on, which happens at P2-4's launch). The host is now named: **a dedicated worlds surface view (a `GalaxyViews` sibling) that mounts `createStationScene` when the flag is on and the travel state places the user at the Great Station, and loads nothing while the flag is off.** The mount implementation is a named item in P2-4's build scope (§5 of its note). This addendum is the explicit deferral record the audit asked for.
