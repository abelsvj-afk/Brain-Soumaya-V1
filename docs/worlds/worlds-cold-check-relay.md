# Worlds Cold Check — Relay Package for ChatGPT

**From:** King (owner's agent) — prepared 2026-10-25
**To:** ChatGPT (GitHub-connected reviewer)
**What this is:** a cold, fine-detail pitfall hunt over ALL of the worlds work now live in the app. Not a design review. Not a feature proposal. Hunt for bugs, pitfalls, and any type of issue, as if you had never seen this code before.
**Why now:** the owner just turned the worlds layer ON (flag flip PR #107 merged 2026-10-25). Everything below is live in the app on his next redeploy. The last increment (P2-5) shipped with a caveated gate — the web suite and production build never ran in this sandbox — so the web code deserves extra suspicion.

## Where to read (exact branches — do not use the default branch)

- **Code:** branch `claude/soumaya-second-brain-v1-m4z4hc`, head `7033909e118c5b4a2a845bdb25662ecd26208424` (PR #108 P2-5 + PR #107 flag flip both merged).
- **Design docs:** branch `design/worlds-vision`, head Rev 88 — start with `docs/worlds/design-exploration-1.md` (the governing design doc, §0–§20) and `docs/worlds/README.md` (the reviewer brief, items 1–80). Phase notes: `docs/worlds/phase-2-p2-2-design-note.md`, `phase-2-p2-3-*.md`, `phase-2-p2-4-design-note.md`, `phase-2-p2-5-design-note.md`, `phase-3-p3-1-design-note.md`. Audit briefs: `docs/worlds/phase-2-p2-3-f02-audit-brief.md`, `phase-2-p2-4-audit-brief.md`, `phase-2-p2-5-audit-brief.md`, `phase-3-p3-1-audit-brief.md` (the P2-5 brief states the gate caveat plainly).
- **Out of scope:** the Man-God world. Another chat is working on it; its concept note (`docs/worlds/man-god-world-concept.md`) is context only — do not review it, do not propose changes to it.

## What is live (the inventory — check all of it)

**Server — travel + economy:**
- `packages/server/src/economy.ts` — fuel constants (FUEL_START 25, FUEL_CAP 200, WARP_COST 10, EARN_JOURNEY_COMPLETE 5, EARN_JOURNEY_DRIFT 3), `JourneyBonusCreditor.creditJourneyBonus`.
- `packages/server/src/db/travel.repo.ts` — TravelRepo: atomic departure admission (partial unique index `travel_journeys_one_active`), lazy cancel-window settlement, arrival + bonus in one transaction, drift gate (elapsed ≥ 30 s, ≤ 2 drift bonuses per day in the space's own timezone via `spaceTimezone` + `localDateKey`), `bonusOutcome`, legacy-arrival crediting.
- `packages/server/src/routes/api/travel.ts` — POST depart / cancel / turn-back / arrive, GET `/api/travel/state`.
- `packages/server/src/db/schemaSql.ts` + `packages/server/src/db/client.ts` — travel tables DDL in both places, `SPACE_SCOPED_TABLES`.
- `packages/shared/src/economy.ts`, `packages/shared/src/worlds.ts` (`WORLDS_TRAVEL_ENABLED = true` — the flag is ON), `packages/shared/src/types.ts` (`GraphNode`).

**Web — client + scenes:**
- `packages/web/src/api/travel.ts`, `packages/web/src/hooks/useTravel.ts` (departure-key lifecycle in localStorage `worlds.departureKey` / `worlds.departureJourneyId`, arming poll 2000 ms, `worlds.traversedRoutes`), `packages/web/src/lib/routeBoard.ts` (`WORLD_CHART`), `packages/web/src/components/TravelPanel.tsx` (TRANSIT_MS warp 12 s / drift 45 s, skip if traversed), `packages/web/src/components/WorldCredits.tsx`, `packages/web/src/components/WorldsSurface.tsx` (scene registry: Station / garden / transit; transit mode when the journey is `in_transit` or `returning`; engine audio; WebGL fallback).
- `packages/web/src/graph/stationLayout.ts` (palette, seed `great-station / harbor-1`, APPROACH_STAGES far 900 → handoff 380 → arrival 150, budget 88 calls / 750k tris), `stationScene.ts` (proxy hull + Profondo self-load/swap, instanced beacons/traffic), `profondoHull.ts`, `gltf.ts` (DRACOLoader + bundled `/public/draco` decoder), `hygStars.ts` + `hygData.ts` (real HYG star data, brightest 5,000), `gardenLayout.ts` + `gardenScene.ts` (terraces, witness tree, plots = real memories, paths = real edges, landmarks = presence-only for done Journeys), `gateScene.ts` (shared gate, 3 draw calls), `transitScene.ts` (HYG sky, procedural ship, departure + arrival gates, 120 warp streaks), `engineAudio.ts`, `soumaya.ts` (her ship), `public/profondo.glb` (Draco, 596,684 bytes, 132,432 tris), `public/CREDITS.md`.
- `packages/web/src/App.tsx` — mounts `TravelPanel` and `WorldsSurface` (each in its own ErrorBoundary).

**Rules that must hold (check each against the code, not the docs):**
- The brain is authoritative; worlds are a layer on it, never a second brain. The garden renders the graph data the app already holds; it never fetches its own copy, stores nothing, edits nothing.
- Fuel buys speed/spectacle, never access. Home and slow drift are always free. Bonus eligibility must never affect the ability to access memories, drift, or return home.
- The server — never the browser — enforces the cancel window and prevents duplicate charges/rewards. Bonuses credit server-side at arrival, exactly once per journey (journeyId = idempotency key).
- Nothing ever punishes: no decay, loss, shame visuals, or streak logic in disguise. An ineligible bonus is a plain server reason, never an error and never a lock.
- No UTC in anything user-facing; space-local days in the space's own timezone.
- Reduced motion: same destination, state, controls, and completion — presentation only.
- Every failure is honest: no empty garden on a failed load, no ghosted content, no silent fallback that pretends success. No raw error codes in UI, plain language.

## Hunt list — the owner's own concerns first, then everything else

1. **The garden underside (owner-named).** Can the camera go underneath the garden and see an unfinished bottom — a scene with no covering underneath, like a bare model? Check the garden's camera bounds, orbit limits, and geometry: is there a finished underside, a ground plane, or a hard bound that prevents going under? Then check the SAME question for every world: Station (can you fly under/through the hull?), transit (can you leave the corridor?), garden terraces. Anywhere the user can reach a place the builders never finished is a defect.
2. **Station scale (owner-named).** Is the Great Station actually gigantic in felt scale — a megastructure that houses ships and people, not a model that reads as a toy? Check the approach stages, the wheel radius (210), the hull size vs. the camera, traffic, beacons, and whether the Profondo hull (132k tris) renders at a scale that makes sense against the ship. If the numbers say big but the experience says small, say so precisely.
3. **Ships: placeholders vs real assets.** Where does the app still show a placeholder or procedural stand-in for a ship? Inventory every ship appearance (transit procedural hull, `soumaya.ts`, fleet, Station traffic) and say which are real assets and which are placeholders. Known open item: `soumaya-ship.glb` has in-file copyright (3DHaupt) but NO license statement in the repo and no credit line — confirm that P2-5 and the transit scene do not load it, and flag anywhere else its provenance is still unproven.
4. **Transit integrity.** Gates at each world's edge, Station as guaranteed fallback route, direct world-to-world gates only where authorized. Turn-back, skip, cancel, and repeated journeys must preserve server-authoritative rules and never duplicate an arrival, lose the destination, or double-charge. Check the `in_transit` / `returning` / `arming` states in `WorldsSurface` against the journey states the server can actually produce.
5. **Economy and bonuses.** Re-derive the fuel math from the code: warp cost 10, warp bonus 5, drift bonus 3, cap 200, regen 3.5/hr, cancel window 10 s, drift floor 30 s, 2-per-local-day cap. Hunt for: double-charge paths, double-credit paths, cap-saturation edge cases, timezone-boundary bugs (midnight in a non-UTC space timezone), race conditions between two concurrent transitions (the review-22 barrier), and any client-side path that trusts the browser for money.
6. **Flag-on first run.** The flag just went from false to true. Read the mount paths as a first-time user: what mounts on first load, what calls the API, what happens with no journeys, no graph data, a failed graph load, no WebGL, or a slow connection? Any crash, blank surface, or infinite spinner is a defect.
7. **Dispose and leaks.** RAF loops, resize listeners, audio (`makeEngineAudio`), GPU buffers (`disposeObject3D`), scene swaps (Profondo self-load), repeated journeys and mount/unmount cycles. Anything that accumulates, double-disposes, or keeps running after unmount is a defect.
8. **Performance budgets vs. reality.** §11 thresholds (≤200 draw calls, ≤750k visible tris, textures ≤1K, cold load ≤5 s, ≥50 fps avg / ≥30 fps 1%-low). Check the static assertions and the draw-call/tris sketches in the code (Station ≤88, garden ≤95, transit sketch 12). Where the code ASSERTS a budget but never MEASURES it on a device, say so — that is a gap, not a pass. The owner's device check is still pending.
9. **Kindness and honesty.** Read every user-facing string in the travel/garden/transit UI. Any urgency, countdown-as-pressure, silence-as-consent, fabricated reward, locked-door taunt, or ranking-by-worth (plot size/brightness/height driven by importance, review strength, progress, or emotional weight) is a defect. The garden's non-ranking rule is per visual channel — check all of them.
10. **The P2-5 caveat, verified independently.** The web suite and production build never ran in the builder's sandbox. Read `WorldsSurface.tsx`, `gateScene.ts`, `transitScene.ts`, and `TravelPanel.tsx` as if the tests do not exist: type errors the tests would have caught, wrong imports, stale references, a transit mode that can never trigger, a gate that never renders, a test that passes while the product is wrong. If you find a defect the targeted tests missed, that is the most valuable finding in this review.

## How to report (grave detail — this is the standard)

- **Verdict first:** READY / READY WITH CHANGES / NOT READY.
- **CONFIRMED DEFECTS:** file + line, what breaks, who it hits, and the test that FAILS before the fix and PASSES after (write the test, or give exact repro steps when a test cannot express it). Order by severity. No defect without evidence.
- **CLEARED SUSPICIONS:** things you checked hard and found sound, with the evidence (file + line or the reasoning). This is as valuable as the defects — it closes the hunt.
- **MERE SUSPICIONS:** things you could not confirm from the code (needs a device run, a live deploy, or more info). Label them as suspicions, never as defects.
- **Do not** invent facts, propose new features, redesign anything, or repeat the design doc back. Verify every claim against the merged code, not against what the docs say the code does. If a doc and the code disagree, the code wins and the disagreement itself is a finding.
