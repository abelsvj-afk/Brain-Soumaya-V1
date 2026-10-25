# P3-2 Audit Brief — The Deep Past (build only, 2026-10-25)

**Build:** P3-2 Deep Past, second memory-bearing world. **Base:** deploy `claude/soumaya-second-brain-v1-m4z4hc` @ `7033909e` (tip re-verified at build start). **Authorization:** D-71 (owner, 2026-10-25). **Scope:** BUILD ONLY — no PR opened, no merge, no deploy, no push. The PR is the owner's next tap.

**Build record:** `~/workspace/worlds-vision/p3-2-build-record.md` (full recon, deviations, gate evidence, file SHAs).

## Files (13 — 9 modified, 4 new; staging `~/workspace/worlds-vision/p3-2-build/`)

- NEW `packages/web/src/graph/deepPastLayout.ts` + test (deterministic helix math, recipe seed `deep-past / first-descent-1`, budget constants test-asserted)
- NEW `packages/web/src/graph/deepPastScene.ts` + test (helix strata, instanced alcoves, lantern glow points, Chronicle thread, anchors, marine-snow particulate, First Light basin, faint HYG above the rim, procedural dressing ships)
- EDIT `packages/server/src/repositories/travel.repo.ts` (+ `"deep-past"` in the allow-list)
- EDIT `packages/server/src/__tests__/travel.test.ts` (+1 admission test)
- EDIT `packages/web/src/lib/routeBoard.ts` + test (board now 4 worlds)
- EDIT `packages/web/src/graph/gateScene.ts` + test (+ deep-past dressing: violet stone ring, lantern-gold beads, violet accent)
- EDIT `packages/web/src/components/WorldsSurface.tsx` + test (registry entry, journeys/links, guided descent)
- EDIT `packages/web/src/components/TravelPanel.test.tsx` (board 4 entries; warp count 3)
- NO CHANGE: App.tsx, WorldCredits.tsx, public/CREDITS.md, travel economy, state machine.

All 13 SHAs verified byte-identical between staging and the gated worktree `~/workspace/gate-run/wt-p32` (git status: exactly 9 modified + 4 new, nothing else).

## Gate evidence (gated tree wt-p32 @ 7033909 + staging files)

- **Typecheck: CLEAN in all three workspaces** (shared, server, web — direct `tsc --noEmit`). *Evidence note (King, honest):* the builder's web re-run log (`p32-typecheck-web2.log`) was 0 bytes — the clean claim was unverified in its files. King re-ran all three workspaces on the gated tree himself: shared exit 0, server exit 0, web exit 0, 0 errors each (logs `p32-typecheck-{shared,server,web}-rerun.log`). The gate stands on King's re-runs.
- **Targeted web: 53/53** (deepPastLayout 11, deepPastScene 7, WorldsSurface 13, TravelPanel 11, gateScene 5, routeBoard 6). Log `p32-targeted-web.log`.
- **Targeted server: 23/23** (travel.test.ts, 22 existing + 1 new Deep Past admission). Log `p32-targeted-server.log`.
- **Full server suite: 1,983 passed / 1 failed / 1,984.** The one failure is `longitudinalIntegration.test.ts` Scenario A ("Possible downstream effect" narrative assertion). **PROVEN PRE-EXISTING:** the same test fails on the CLEAN deploy tree @ 7033909 with no P3-2 changes (1 failed / 4 passed, log `p32-clean-longitudinal.log`). Unrelated to travel/worlds. The two digest failures from the P2-3 gate did NOT recur. Log `p32-server-test.log`.
- **Full web suite: 1,552 passed / 7 failed / 1,559.** The 7 failures are `App.batchB.test.ts` (5), `HudDock.geometry.test.tsx` (1), `localDay.test.ts` (1). **ALL 7 PROVEN PRE-EXISTING:** the exact same 7 failures in the exact same 3 files occur on the CLEAN deploy tree @ 7033909 (7 failed / 57 passed, log `p32-clean-web.log`). None is in a P3-2 file; all P3-2 tests passed in the full run. Log `p32-web-test.log`.
- **Production build: GREEN** (exit 0, 40.21s, service worker stamped `soumaya-bmvo25tm1`). Chunk-size warning pre-existing. Log `p32-build.log`.
- **The gate is NOT fully green** — 8 failures total, all 8 proven pre-existing on the clean tree. Stated plainly, not laundered. No P3-2 file fails.

## Recon findings (verified against deploy @ 7033909)

- **D-7 rule inputs in the payload:** `createdAt` (required, age source), `lastTendedAt` (stillness source + fallback age), edges carry `createdAt` (recent edge = warm context, used for the rise). `entropy` NOT used (neglect-derived; the depth rule forbids it). `reviewStrength`/`degree`/`importance`/`emotionalWeight` present but FORBIDDEN as placement inputs (non-ranking rule). `occurredAt` not used for placement.
- **D-7 rule as built (named constants, owner-correctable):** `DEEP_PAST_MIN_AGE_YEARS = 1`; placement timestamp = `createdAt`, fallback `lastTendedAt`; both unusable → node EXCLUDED (never guessed). Stratum = `clamp(yearsAgo - 1, 0, 8)` — 9 strata, rim 1–2 years, basin 9+ years. Excluded: archived (P4), too-young (<1 year), unreadable-date. The word "forgotten" does not exist here.
- **The rise (A22, Q2):** warm context = `lastTendedAt` within 30 days OR an edge created within 30 days. Risen members render at a rim-side shelf; stratum recorded unchanged; cause visible in the `why` line; return to depth follows the same rule (derived per visit, no timer, no state).
- **Anchors (D-8):** edge member → non-member = a line of light rising toward the rim. Member → member not drawn (the descent already connects them). No fabricated endpoints.
- **Chronicle routes (A21, Q3) — finding:** Journeys ARE saved routes in the client. `GET /journeys/:id/links` returns memory links (`refId`/`nodeRefId`); a done Journey's linked memories, in chronological order, ARE a Chronicle route. Active route = earliest done Journey with ≥2 Deep Past member stops. No such journey → no thread, honestly.
- **C7 failure honesty:** no new `graphError` prop — the app-level recovery card ("Soumaya couldn't finish loading… Your brain is safe — let's try again") is the honest error + retry path for a failed graph load. WorldsSurface builds only from non-null graph data, so a failed load can never present as an empty descent.
- **Completeness (C9):** the basin is the finished bottom (solid rock below, camera cannot pass it); the rim is a boundary (finished darkness + faint HYG above). Camera bounds tested at every allowed extreme.

## Deviations from the design note (all recorded, none silent)

1. No `graphError` prop — the app-level recovery card is the error/retry path.
2. No-timestamp nodes are EXCLUDED from membership (not placed at the rim).
3. No A1–A3 carry/placement chain in the product (mockup-only signature scene).
4. No narration UI and no separate pause control for guided mode (descent is slow; leave/resume anytime; thread shows route title + stop count).
5. No stratum lip torus (mockup alignment unverified); rim bands are self-consistent cylinders.
6. User controls for the D-7 rule (thresholds, manual include/exclude) are future work.
7. Alcove touch-to-focus is not implemented in the surface (same as the P3-1 garden).
8. The mockup's seed label (`helix-1`) is not used; the recipe seed (`first-descent-1`) is.

## What remains the owner's

- Open the PR (branch `worlds/p3-2-deep-past` → deploy) — his tap. Merge is a separate tap after that.
- The D-7 constants (`MIN_AGE_YEARS = 1`, 30-day warm window) are named and correctable with a word.
- The device check (his phone, per §11): measured draw calls/tris/fps on a large fixture, first live descent, guided-mode feel. The static budget check (≤440k for a 2,000-node fixture) passed; the measured half belongs to the device.
- The post-merge audit (ChatGPT, owner's option — the review loop was bypassed at his word for this build; findings reconcile as a fix list).
