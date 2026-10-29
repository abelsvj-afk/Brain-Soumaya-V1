# Muse task — slim the 3D models (the "very slow" fix)

**From:** Claude · **For:** Muse (via Sajacous) · **Written:** 2026-10-29
**Type:** asset work (binary) — Muse-sized by the CLAUDE.md delegation rules. No app code changes.
**Branch to use:** `assets/glb-slim` (NOT `main` — a merge to `main` auto-deploys to production).

## Why

The owner says the app is "very slow". Measured (headless browser against a real build, phone viewport):

| Load | Assets downloaded |
|---|---|
| Home galaxy alone, at startup | **21.6 MB** (`space_station_3.glb` is 14.0 MB of it) |
| + Great Station | 40.2 MB total (≈ +19) |
| + Growing Place | 34.7 MB total (≈ +13) |
| + Deep Past | 41.5 MB total (≈ +20) |
| + Scale | 40.2 MB total (≈ +19) |
| + Eternity | 27.9 MB total (≈ +6) |
| + People | 21.8 MB total (≈ +0.2) |

The weight is **textures and unslimmed meshes**, not geometry count. Example: `sf-lava-planet.glb` is 11.0 MB
for 7,936 triangles — 10.8 MB of it is 5 embedded textures. These files are also served `max-age=0`
(Claude is fixing that server-side; you don't touch it).

## What you are changing

Replace the files below **in place, same filename** — the code references them by name, so a same-name
replacement needs no code change. Current facts (read from each file's GLB header):

| File | MB now | Textures (MB) | Tris | Draco | Used by (code) | Target MB |
|---|---|---|---|---|---|---|
| `space_station_3.glb` | 14.0 | 13 (13.3) | 68k | yes | home galaxy, `spaceStation.ts` — **loads at startup** | ≤ 4 |
| `sf-lava-planet.glb` | 11.0 | 5 (10.8) | 7.9k | no | Station (`stationAssets.ts`) | ≤ 1.5 |
| `sf-ice-planet-procedural.glb` | 10.5 | 5 (8.3) | 60k | no | Growing Place (`gardenAssets.ts`) | ≤ 2 |
| `sf-anchor-spire.glb` | 8.2 | 1 (6.3) | 80k | no | Deep Past (`deepPastAssets.ts`) | ≤ 2 |
| `blackhole.glb` | 6.7 | 15 (5.0) | **534k** | yes | home, Help preview, Scale | ≤ 3 |
| `sf-supernova-remnant-slim.glb` | 5.8 | 0 | 72k | no | Deep Past | ≤ 2.5 |
| `dyson-sphere.glb` | 5.6 | 8 (5.3) | 31k | yes | home (`graph3dHelpers.ts`) | ≤ 2.5 |
| `man-god-halo.glb` | 5.4 | 0 | **222k** | no | Eternity (`eternityAssets.ts`) | ≤ 2.5 |
| `sf-planetary-nebula.glb` | 4.4 | 4 (0.2) | 147k | no | Scale | ≤ 1.5 |
| `wato-spaceship.glb` | 3.4 | 6 (3.4) | 730 | no | Station | ≤ 0.5 |
| `pp-planets-set.glb` | 2.6 | 2 (2.5) | 1.2k | no | Scale, Growing Place | ≤ 0.5 |
| `sf-pulsar.glb` | 2.0 | 1 (1.7) | 11k | no | Scale | ≤ 0.5 |
| `nasa-pillars-1b.glb` | 2.0 | 0 | 25k | no | Scale | ≤ 1 |

Targets are goals, not quotas: **quality wins over the number.** Overall aim: home startup ≈ 9 MB
(from 21.6), every world ≈ ≤ 10 MB total (from 28–42). Do them in this order — safest and biggest win first:

1. **Texture-only wins** (geometry untouched): lava planet, ice planet, anchor spire, wato-spaceship,
   pp-planets-set, sf-pulsar. Resize textures to what a phone screen can show (1024 for big surfaces,
   512/256 for small props) and re-encode as **WebP**.
2. **`space_station_3.glb`** — the single biggest startup cost and a hero asset: resize/WebP its 13 textures.
3. **Mesh-heavy:** blackhole (534k tris), man-god-halo (222k), supernova remnant, planetary nebula, dyson
   sphere — weld/simplify gently and Draco-compress. `man-god-halo` is **Eternity himself** — simplify
   conservatively and compare closely; he must still read as the same figure.

Your verified web-slim recipe (weld → simplify → resize → draco; the 256-texture variants) applies. The
codebase-specific rules below override it where they conflict.

## Hard rules (the app breaks silently if these are violated)

1. **Same filename, same place** (`packages/web/public/`). Do not rename, do not add suffixes.
2. **Preserve every node/mesh name and every animation clip.** The code looks things up by name —
   confirmed ones inside GLBs: mesh `halo` in `man-god-halo.glb` (`eternityAssets.ts`: body + halo are
   split meshes and must stay split) and mesh `luci` in the Station hull (`profondoHull.ts`; not one of the
   files in the table, but don't touch it). Others may exist, so dump and preserve ALL names. (The garden's
   `plots-gathering` / `paths` are built in code, not stored in a GLB — not a concern.) The code also plays all embedded clips
   (`mixer.clipAction(clip).play()` in sun, station, deepPast, scale, drifters). Before/after: dump the
   node-name list and clip names/durations and confirm they are identical. Do **not** use operations that
   merge, flatten, rename, instance or re-centre nodes (`flatten`, `join`, `instance`, `center`) on these.
3. **Same scale, orientation and pivot.** Bounding box within 0.5% of the original; origin unmoved.
4. **Decoders the app already has — nothing else.** Draco (`/draco/`), and three's native WebP
   (`EXT_texture_webp`). KTX2 (`/basis/`) exists but is only initialised once the home renderer is up;
   prefer **WebP** for anything a world loads. No Meshopt, no new decoder, no new dependency.
5. **A failed decode is SILENT.** If a model can't be decoded, the app swaps in a procedural stand-in shape
   with no error. So "it loaded" proves nothing — you must confirm it is the *real* model (see Verify).
6. **Licences stay.** Keep embedded asset metadata (copyright/extras) and don't touch
   `packages/web/public/CREDITS.md`. Several of these are CC-BY (e.g. `wato-spaceship.glb`, CC-BY 3.0) —
   re-encoding is fine, stripping attribution is not.
7. **Keep the originals recoverable** — they stay in git history; do not delete them from any branch's history.

## How to deliver (the binary-push limit)

Your GitHub connector pushes text only, so binaries go through the GitHub website:
1. Create branch `assets/glb-slim` from the current `main` (`7502ba9` or later).
2. Upload the slimmed `.glb` files to `packages/web/public/` on that branch via the website, replacing in place.
3. Add `docs/repairs/glb-slimming-report.md` on the branch (connector is fine for text) with the table below.
4. **Do not merge to `main`.** Tell Sajacous it's ready; Claude verifies and merges (a merge deploys to
   production, and these files affect every screen).

## Verify (you can run all of this in your VM)

```bash
git checkout assets/glb-slim && npm ci && npm run build
# a throwaway server with a throwaway brain (never a real brain key):
DB_PATH=/tmp/t.db WEB_DIR=$PWD/packages/web/dist PORT=4818 AUTONOMY=off npx tsx packages/server/src/index.ts &
curl -s -X POST localhost:4818/api/space/auth -H 'content-type: application/json' \
  -d '{"gamerTag":"slimcheck","passcode":"slimcheck-1"}'          # → {"id":"<KEY>",...}
# restart the server with OWNER_SPACE_IDS=<KEY> so People + Eternity are reachable, then:
BASE_URL=http://localhost:4818 SPACE_ID=<KEY> node scripts/worlds-check.mjs
```

`scripts/worlds-check.mjs` (new, on `main`) visits all 7 worlds for real, prints PASS/FAIL, canvas time and
**MB downloaded per world**, and saves a screenshot per world to `./worlds-check-out/`. Needs `playwright`.
Run it on `main` first (the "before") and on your branch (the "after"). Then also:

- **Real, not placeholder:** for each replaced file, confirm the model in the screenshot is the real
  design, not the procedural stand-in (your real-vs-placeholder detection). Console must show **0 errors**
  and no failed (4xx/5xx) requests.
- **Names + clips identical** (Hard rule 2) — attach the before/after lists.
- **Visual comparison:** same camera, before/after, for every file; flag anything a person would notice.
- **Hero assets need Sajacous's eyes before merge:** the station, Eternity's figure, the black hole.

## Report (`docs/repairs/glb-slimming-report.md`)

One row per file: `file | MB before → after | tris before → after | textures (n, MB) before → after |
Draco/WebP | names identical? | clips identical? | real-not-placeholder? | notes`. Then the before/after
`worlds-check` tables. Label **confirmed / inferred / unknown** as usual — and say so plainly for any file you
could not slim without visible loss, and stop there rather than pushing past it.

## Out of scope (Claude's side — DONE 2026-10-29, don't touch)

These landed on `main` while you work, so your "before" numbers on `main` already include them:
- **Persistent model cache + background validation** in the service worker, and the fixed
  immutable rule for hashed bundles. A *returning* visitor now downloads ~0 MB (was 24.5 MB).
  This does **not** shrink first-visit weight — that is your job.
- **Station model deferred** off the startup path (starts no earlier than 6 s after load).
- **Destination-world prefetch** during the 10 s cancel window and flight (all of a world's models
  are now ready on arrival). Smaller files make this finish sooner, especially on a phone connection.
- Any app code, CSS, or `CREDITS.md`.

**One consequence for you:** because models are now kept in a persistent cache and re-validated by
ETag, a file you replace *in place* is picked up on the **next launch after** a user's first visit
post-deploy (they see the old model once, then the new one). That is expected, not a bug.

## Not guaranteed

The headless renderer here is software (≈1 fps); download size and load order are reliable, **frame rate
and "feels fast" are not**. The real test is Sajacous's phone after merge + deploy.
