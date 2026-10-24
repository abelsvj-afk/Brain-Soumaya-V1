# P2-5 Audit Brief — Warp Gates & the Transit Space

**Branch:** `worlds/p2-5-transit` (from deploy head `aaaeb1a`, commit `cda9b6f`)
**PR:** [#108](https://github.com/abelsvj-afk/Brain-Soumaya-V1/pull/108) — opened 2026-10-24 ~18:43 EDT on the owner's "Move on" (open now with the caveat stated, rather than wait for the machine to recover).
**Status:** Gate caveated, not green — see below. The web suite and production build were never run to green because the sandbox would not start them (environment note).

## What this increment builds

The connective tissue, once, as a shared system, so every world plugs in the same way:

- `graph/gateScene.ts` + test — one shared gate design dressed per world (ring-and-light grammar; amber = working/inhabited, cyan = navigation truth only). 3 draw calls per gate.
- `graph/transitScene.ts` + test — the transit space itself: HYG sky, procedural ship (chase view), departure + arrival gates, warp streaks (hidden on drift and under reduced motion). Draw sketch: sky 1 · ship 4 · gates 6 · streaks 1 = 12.
- `components/WorldsSurface.tsx` (rewritten) — transit mode when the journey is `in_transit` or `returning`; destination scenes unchanged; engine audio wired via `graph/engineAudio.ts`.
- `components/WorldsSurface.test.tsx` — mid-journey now renders the transit dialog; arming still renders nothing.
- `components/WorldCredits.tsx` — "Warp gates and the transit corridor" procedural entry.
- `public/CREDITS.md` — organic-spaceship verified CC-BY-4.0 entry.

No economy change, no state-machine change, no new world authorized. Ships dark (`WORLDS_TRAVEL_ENABLED` stays false).

## Gate evidence (so far)

- Typecheck: **clean** — shared, server, web, verified by running `tsc --noEmit` per workspace directly (logs `p25-tsc-{shared,server,web}.log`, all 0 errors). `npm run typecheck` was bypassed because npm itself flapped with EPERM at startup.
- Targeted tests: **20/20** — gateScene 5, transitScene 6, WorldsSurface 9.
- Full server suite: **1877 passed / 21 failed / 4 skipped (1902 total), 166/176 files passed** — run with `--pool=threads`, log `p25-server-test.log`. All 21 failures are `SqliteError: disk I/O error` at `pragma("journal_mode = WAL")` in file-backed database tests (migration, legacy upgrade, concurrency, durability) — zero assertion failures, zero failures in `:memory:` tests. The 2 `TypeError: Cannot read properties of undefined (reading 'sqlite')` lines are cascading afterAll-hook failures in the same failed travel tests, not separate causes. P2-5 touches no server code. Verdict: **not green, for an environmental reason, proven** (see environment note).
- Full web suite: **NOT RUN** — vitest cannot start (config-bundling EPERM; see environment note). Targeted tests 20/20 are the only web test evidence.
- Web production build: **NOT RUN** — `vite build` dies at the same config-loading step with the same EPERM.

## Environment incident — read before judging the gate

On 2026-10-24 from ~18:12 EDT, this sandbox began failing writes intermittently with `EPERM: operation not permitted` and file-backed SQLite with `SQLITE_IOERR_WRITE`:

- Vitest's default forks pool fails every file with bare `EPERM ... write` (0 tests run).
- Vitest config bundling fails at the temp-file write with the same EPERM (verified: the same write, same path, same API succeeds from plain node — the failure is specific to the vitest process in this degraded state).
- File-backed SQLite fails `pragma("journal_mode = WAL")` with `SQLITE_IOERR_WRITE`, proven environmental with a bare repro (better-sqlite3 alone, no app code, fails on both `/tmp` and `~/workspace/.tmp`).
- The same flap truncated `~/AGENTS.md` to 0 bytes mid-write; restored from the in-context copy and verified byte-complete (5,341 bytes).
- Workaround that works: `--pool=threads` lets suites run; the server suite completed under it (1,877/1,902, failures environmental as recorded above).
- **Rule applied:** 0-test file failures and disk-I/O test failures are NOT presented as code failures. The P2-5 diff touches no server code at all, so any server-suite failure of that shape cannot be caused by this increment.

## Open item carried plainly — ship provenance

`soumaya-ship.glb` (2,364,720 bytes, 10 meshes, 8,558 tris) carries in-file copyright "Modeled and Textured by 3DHaupt aka DennisH2010 (Dennis Haupt)" but **no license statement in the repo and no credit line in `public/CREDITS.md`**. Web search found 3DHaupt's Sketchfab works typically CC-BY-NC / CC-BY-NC-ND, and the shipped file was modified (Draco/KTX2 recompression, textures capped at 1024px, materials re-tinted in-app).

**Decision recorded:** the GLB is NOT loaded in the transit scene; the procedural hull is the ship. `organic-spaceship.glb` IS verified CC-BY-4.0 and is credited. The soumaya-ship provenance gap is an **open audit item for the owner** — the home galaxy's existing use is pre-existing and out of P2-5's scope; P2-5 newly distributes nothing.

## Review lineage

- Design note: `docs/worlds/phase-2-p2-5-design-note.md` (Rev 85).
- Review 28 (ChatGPT, formal): READY WITH CHANGES — reconciled (D-66).
- Q1–Q5 settled as recommended by the owner (D-67) + build authorized in the default lane.
- **D-68 (owner, 2026-10-24 ~18:41 EDT, "Move on"):** open PR #108 now with the gate caveat stated plainly in the body, rather than wait for the machine to recover. Merge remains the owner's tap.
