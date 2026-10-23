# F-02 Fix Audit Brief — for the reviewing agent (ChatGPT)

**Repository:** `abelsvj-afk/Brain-Soumaya-V1` · **PR:** #98 · **Branch:** `worlds/p2-3-f02-hyg` · **Base:** `claude/soumaya-second-brain-v1-m4z4hc` @ `583a3d3`
**Commits on the branch:** `0c859f7` (the fix) and a second commit adding a malformed-data guard (self-review hardening).
**Finding under audit:** review 25 finding **F-02** — `WorldCredits` credited the HYG star database while the Station scene shipped a seeded procedural scaffold. The owner chose INTEGRATION (make the credit true) over removing the credit. Design record: Rev 68, entries D-47 (fix) and D-48 (owner direction: this starfield belongs to the worlds spaces; the home galaxy is settled and untouched).

## Read these files (PR #98 diff — exactly five files)

1. `packages/web/src/graph/hygData.ts` — NEW, GENERATED (header carries provenance: source file `hygdata_v41.csv` from github.com/astronexus/HYG-Database `hyg/CURRENT/`, its sha256, 119,626 rows, subset rule, magnitude range). Two base64 Float32 payloads: positions and colors for 5,000 stars.
2. `packages/web/src/graph/hygStars.ts` — NEW. Decodes the payloads (with caches), validates decoded length against the declared count (throws a named error on malformed data), and `buildHygStarfield()` returns one `THREE.Points` with vertex colors.
3. `packages/web/src/graph/hygStars.test.ts` — NEW tests: subset size, finite positions on the 3,800 shell, per-star color variance (3,083 distinct colors in the data), build shape.
4. `packages/web/src/graph/stationScene.ts` — MODIFIED. The scaffold `starfield()` function is deleted; the scene now adds `buildHygStarfield()`. The diff is exactly: scaffold removed, one import swapped (`rngFromSeed` out, `buildHygStarfield` in), one call-site line changed. Nothing else in the scene.
5. `packages/web/public/CREDITS.md` — MODIFIED. HYG registered under a new "Data" section (CC BY-SA 4.0, adaptation note).

`WorldCredits.tsx` is deliberately UNCHANGED — its HYG text ("Star positions and colors derived from the HYG database (Astronexus). Licensed CC BY-SA 4.0. A subset of the brightest stars is used.") is the claim this PR makes true.

## Generation provenance (copies on THIS docs branch)

- `docs/worlds/generate_hyg.py` — the generator (subset rule, axis mapping, color approximation, all documented in its header).
- `docs/worlds/hyg-build-record.json` — the run record (source sha256 `d9f69fd8…`, totals, magnitude range −1.44…5.99, 22 stars in the subset lacked a B-V value and took a documented default of 0.65).
- Subset rule: brightest 5,000 by apparent magnitude; the Sun's row (proper name "Sol", mag −26.7) excluded. Positions: HYG's own equatorial Cartesian columns normalized to directions, mapped to three.js axes as (x, z, −y), placed on a 3,800-unit shell (the radius is presentation; the directions are the data). Colors: from each star's B-V index via a standard temperature approximation; per-star brightness scaling by magnitude is presentation, documented in the generator.

## Builder's own verification (for cross-checking, not as gospel)

- All five branch files verified byte-identical to the gated build (blob SHAs).
- Data geometry re-derived independently: angular separations Sirius↔Betelgeuse 27.10° and Sirius↔Rigel 23.67° match the source CSV exactly; the signed triple product of the three stars matches (0.1262) — the sky is not mirrored.
- Color spot checks: Sirius (B-V 0.009) → blue-white RGB (0.79, 0.85, 1.0); Betelgeuse (B-V 1.5) → warm (0.91, 0.71, 0.55).
- Disposal: the scene's `disposeObject3D` releases GPU buffers only; it never mutates the cached JS arrays the starfield geometry is built from, so unmount/remount is safe.

## Gate evidence — stated exactly

- BEFORE the hardening commit: full web suite **1437/1437** (150 files) + web typecheck clean + web production build green, run in the builder's sandbox against byte-identical copies of the branch files.
- AFTER the hardening commit (guard added to `hygStars.ts` only): targeted suites 11/11 (hygStars, stationLayout, WorldCredits) + typecheck clean. **The full suite was NOT re-run after the hardening commit** — weigh that as you will.
- The malformed-data guard is defensive: with the committed data it cannot trigger (the tests assert the exact lengths), and there is no injection seam to test the bad-payload path without refactoring. It is disclosed here rather than dressed up as covered.

## Scope checks requested

1. The diff touches ONLY the five files above; in particular the home galaxy (`graph/Graph3D*`) and all server/shared code are untouched (owner direction D-48).
2. No procedural star generation remains anywhere in the worlds layer (the scaffold is gone, not bypassed).
3. The credits (in-app + CREDITS.md) describe the shipped artifact truthfully, including the CC BY-SA 4.0 terms for the adapted data.
4. The scene's draw-call budget is unchanged: the starfield is one Points object (the layout's budget line already read "starfield (HYG subset)", 1 call).

## Known limitations (not findings to discover)

- The Station scene remains unmounted in production until the P2-4 launch (review 25, F-01, reconciled by design) — this PR changes the scene's sky, not its mounting. Device visuals are pending the owner's redeploy.
- The generator and build record live with the worlds design records (copies on this branch); they are not part of the app repo's build.
