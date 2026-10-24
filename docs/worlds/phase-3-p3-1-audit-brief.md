# P3-1 Audit Brief — for the reviewing agent (ChatGPT)

**Repository:** `abelsvj-afk/Brain-Soumaya-V1` · **PR:** #106 · **Branch:** `worlds/p3-1-garden` · **Base:** `claude/soumaya-second-brain-v1-m4z4hc` @ `00fdd63`
**Design of record:** `docs/worlds/phase-3-p3-1-design-note.md` (this branch), as revised after review 27 (READY WITH CHANGES) and settled by the owner (D-59 Q1 = B, D-61 terrace convention + build authorization).
**Ships dark:** `WORLDS_TRAVEL_ENABLED` remains `false`. The launch flip, deployment, and device checks are separate, later, owner-run steps — not part of this PR.

## What to review (11 files)

**Server**
1. `packages/server/src/repositories/travel.repo.ts` — one line: `TRAVEL_WORLD_KEYS` gains `"growing-place"`. No other server change.
2. `packages/server/src/__tests__/travel.test.ts` — one new test: warp to the Growing Place and drift home through the same ledger.

**Web**
3. `packages/web/src/lib/routeBoard.ts` (+test) — `WORLD_CHART` gains the Growing Place entry; the panel names it from here.
4. `packages/web/src/graph/gardenLayout.ts` (+test) — NEW, pure: the eligibility contract (active nodes of every kind; `moc` hubs as gathering plots; archived excluded), canonical id ordering, terrace banding by local-year age (arrival = present, crown = oldest), seeded placement, identity-level outputs (plot→node id, path→edge id + endpoints, landmark→Journey id), edges with excluded/missing endpoints omitted.
5. `packages/web/src/graph/gardenScene.ts` (+test) — NEW: renders exactly the layout (terraces, witness tree, instanced vegetation, instanced plots by form, one LineSegments for paths, presence-only landmark arches, HYG sky dimmed to 0.35 by dawn); update sways gently, frozen under reduced motion; dispose via `disposeObject3D`.
6. `packages/web/src/components/WorldsSurface.tsx` (+test) — generalized from Station-only to a scene registry keyed by current world (Station values unchanged); takes the App's graph as its only data source (no second fetch); fetches Journeys on garden entry for landmarks, with an honest line if that fetch fails; shows a loading line until the graph arrives; unknown worlds render nothing.
7. `packages/web/src/App.tsx` — one line: passes its graph state (`data`) to `WorldsSurface`.

## Claims to verify

- The garden renders only what the layout returns, and the layout derives only from the graph data the app holds (the same window the home galaxy sees) plus done Journeys — nothing fetched, stored, or invented world-side.
- No ranking signal leaks into any visual channel: importance, review strength, progress, emotional weight, and degree drive nothing in placement or styling (check the layout code and the scene's instancing for any such use).
- Determinism and traceability hold as specified: canonical ordering, tie-breaks, seeded placement, identity-level correspondence (tests cover shuffled input, duplicates, missing endpoints, stale references).
- The Station path is behavior-identical (registry refactor): same camera, fog, fallback, close, credits.
- The flag is untouched; with the flag off, no garden code loads.
- The home galaxy renderer is not in the diff.

## Gate evidence (builder-reported, sandbox, byte-identical files)

Root typecheck clean across shared/server/web. FULL suites with zero failures: server **1902 passed**, web **1460 passed** (incl. 7 new garden-layout tests, 3 garden-scene tests, 3 new surface tests, route-board and travel admission tests, and 3 TravelPanel tests re-scoped per destination after the chart gained a third world). Web production build green.

## Known limitations

- Gate ran in the builder's sandbox clone, not CI; the auditor's independent rerun remains the lane's check, as with P2-3/P2-4.
- Runtime performance (C4's measured half — draw calls, tris, FPS on the owner's phone with the large fixture) belongs to the launch device check, not this PR; the static half (budget constants) is asserted in tests.
- The garden renders the graph data the app holds; when the brain outgrows the galaxy's fetch window, garden and galaxy see the same window — one truth, shared.
