# Unlockables — design (ENFORCED — live since IM-133 / CL-12)

> **Current state:** enforcement is **live**. The shared catalog
> (`packages/shared/src/unlockables.ts`) is the single source of truth, the
> music playlist and the Hangar both gate through `isUnlocked(item, stats)`,
> and a dev / owner override (below) keeps testing unblocked. This doc was
> reconciled with the shipped code in CL-12 (IM-100); where an older draft
> of this doc disagreed with the code, the code's reality won and is what
> is written here.

## Principle

Content is **earned, not bought.** Unlocks reward *using your brain* — logging memories,
keeping streaks, forging real connections, climbing pilot ranks, discovering the Codex —
so progression is intrinsic to the product, never a paywall. A new user starts sparse and
the galaxy visibly grows richer (more music, better ship, cinematic scenery) as they do.

## What's unlockable

| Category | Items (assets that exist today) | Notes |
|---|---|---|
| **Music** | The 3 loops (Deep Space · Slow Tide · Interstellar) | Start with **1** (Deep Space); Slow Tide unlocks at 25 memories, Interstellar at 100. Gated in App's player + the Hangar's music picker (CL-12). `graph/audio.ts` playlist. |
| **Ships** | `soumaya-ship.glb`, `organic-spaceship.glb`, procedural variants | Hangar (`equippedShip`), gated by the catalog. |
| **Trails** | Blue / Void Purple / Hyperdrive Neon / Solar Gold … | Tied to feats (see `packages/shared/src/unlockables.ts` — e.g. "Aegis Shield Spire", "Void Purple Trail"); requirement copy is humanized and never leaks achievement ids. |
| **Figurines** | `equippedFig1/2` — **deep space background monuments** | Hangar slots. Terminology (IM-100): the shipped scene mounts these far in the background at civilization scale (see `graph/graph3dHelpers.ts`), so "background monuments" is the term of record — an older draft of this doc called them "cockpit companions", which the scene never embodied; that term is retired. |
| **Scenery** | `blackhole.glb`, `dyson-sphere.glb` (+ the galaxy's procedural nebulae/galaxies/comets backdrop) | **Wired into the scene today** as the two capstone figurines above — the same assets, rendered as distant background scenery — and catalogued as `scenery` twins with identical conditions to their figurine twins (one asset, one rule). The nebula backdrop is a fixed galaxy layer: it is **not** a gated item and has **no user-facing controls**, and none are promised here. |

## Unlock conditions (drawn from signals we already compute)

- **Memory count** → pilot rank ladder (`components/rank.ts`). Ranks unlock tracks / trails / ships.
- **Streak** (`getStreak`) → milestone unlocks (7-day, 30-day) — supported by the evaluator (`streak` conditions), available to future catalog entries.
- **Achievements** (`components/achievements.ts`) → the natural unlock trigger; several Hangar items gate on feats, and the legacy achievement ids the old ad-hoc Hangar honoured are preserved as `anyOf` branches in the catalog so nothing already earned re-locked during the migration.
- **Codex completion** (`components/codex.ts`) → the rarest scenery (black hole / Dyson sphere) as a capstone reward — an additional way in, alongside the memory-count thresholds the Hangar always enforced.
- **Fuel / research milestones** → optional cosmetic unlocks (evaluator supports `links` conditions today).

## Data model (as enforced)

- Unlocked state is computed **client-side** from the stats above — no server round-trip for a cosmetic gate. `buildUnlockStats` (web `components/unlockables.ts`) assembles the stats from App's live state; the persisted celebrated set lives per brain in `localStorage` (mirroring `achvKey`).
- The **catalog** lives in `packages/shared` (`unlockables.ts`): `{ id, category, label, equipValue, assetPath?, condition, requirementText }`, so server + web + the Hangar/Music UIs all agree. A space-scoped server `unlocks` table remains a possible future step if cross-device authority is ever needed; it does not exist today and nothing here claims it does.

## Dev / owner override (so testing is never blocked)

- A **`dev: unlock everything`** flag: `localStorage` key `brain.devUnlockAll` = `"1"`/`"true"`. While on, `isUnlocked()` always returns true — for the Hangar's items as well as music (CL-12 completed the Hangar side). It is DEV-ONLY: nothing in the normal UI sets it. This is how the owner + partner keep full access while the gating logic is exercised.

## Rollout order (status)

1. ✅ Shared **catalog** + `isUnlocked(item, stats)` helper + the dev-unlock-all flag (IM-133).
2. ✅ **Music** picker + **Hangar** read `isUnlocked` (music in IM-133; the Hangar migrated onto the same system in CL-12, which also gave it the music picker, previews, loadout header, and unlock-progress hints).
3. ✅ **Black hole / Dyson** GLBs are wired as scenery — as the capstone figurines/monuments above — gated as capstone unlocks.
4. ✅ "🔓 Unlocked!" moments (`useUnlockWatcher` + `UnlockCelebration`, reusing the rank-up celebration surface) fire when a new item is earned.
