/**
 * Tube-sync policy — WHEN a link's curved tube geometry gets its full
 * re-shape (Graph3D.tsx's `linkPositionUpdateCb` is the only caller).
 *
 * A re-shape is the galaxy's dominant per-frame CPU cost: Frenet frames over
 * 31 rings + a 200-division arc-length resample + 217 vertex/normal writes +
 * dual GPU buffer uploads, per link (see linkTube.ts). three-forcegraph's
 * animation loop invokes the position callback every NATIVE frame
 * (60/90/120 Hz), but `applyRenderRateCap` (renderRateCap.ts) caps actual
 * GPU submissions at the configured `fpsCap` (30/45/60) — so before this
 * policy, near-target links were re-shaped up to 4× more often than frames
 * were ever drawn, computing tube states no one could see. This module is
 * the CPU-side counterpart of that GPU-side cap: syncs are budgeted to the
 * display cadence, with drift — never the clock — as the correctness
 * authority.
 *
 * The policy (evaluated per link per native frame by the caller):
 *  1. Never synced → sync (first build).
 *  2. Endpoint drift since the last sync beyond TUBE_HARD_EPS → sync, both
 *     tiers, UNGATED. Fast motion (camera flights, drags) tracks exactly as
 *     it did before this policy existed, and endpoint staleness can never
 *     exceed TUBE_HARD_EPS — the correctness floor.
 *  3. Rate gate: a link that synced less than one displayed-frame interval
 *     ago (1000/fpsCap, same 1.5 ms slack convention as renderRateCap.ts)
 *     skips. A non-finite or non-positive cap yields interval 0 — bogus
 *     config must never freeze tubes (renderRateCap's safety rule, mirrored).
 *  4. Near tier (midpoint close to the look-target, camera zoomed in):
 *     drift beyond TUBE_NEAR_EPS syncs; otherwise a 3×50 ms time-shard
 *     backstop guarantees a sync at least every ~150 ms.
 *  5. Far tier: the pre-existing 6×100 ms time-shard backstop (~600 ms),
 *     unchanged except for rule 3 — a slot window no longer re-syncs on
 *     every native frame inside the window.
 *
 * Convergence, stated plainly: position staleness ≤ TUBE_HARD_EPS always
 * (rule 2 has no gate); sub-epsilon staleness is time-bounded by the shard
 * backstops (near ~150 ms, far ~600 ms); the rate gate cannot swallow a
 * backstop sync because both shard windows (50/100 ms) are wider than the
 * largest possible interval (33.3 ms at the lowest shipped cap, 30), and the
 * callback runs every native frame, so a sync still lands inside the
 * window. Width/curvature-only changes ride the same backstops — worst case
 * a tended near link's radius swell lags ~150 ms while its color/particles
 * (digest-driven) update instantly.
 *
 * Pure and clock-injected so the whole contract is unit-testable
 * (tubeSync.test.ts) without a WebGL context.
 */

export type TubeTier = "near" | "far";

/** Endpoint drift (world units) that always forces an immediate sync — the
 *  pre-existing far-tier epsilon, now the shared correctness floor. */
export const TUBE_HARD_EPS = 0.12;
/** Near-tier drift threshold: far sub-pixel at near-tier camera distances
 *  (the far tier ships 0.12); catches gentle orbital drift within a frame or
 *  two while the rate gate absorbs the native-rate redundancy. */
export const TUBE_NEAR_EPS = 0.03;

const NEAR_SHARD_COUNT = 3;
const NEAR_SHARD_MS = 50;
const FAR_SHARD_COUNT = 6;
const FAR_SHARD_MS = 100;
/** Matches renderRateCap.ts's CAP_SLACK_MS — same cap, same tolerance. */
const RATE_SLACK_MS = 1.5;

/** Minimum milliseconds between two syncs of the same link. 0 (never gate)
 *  for a non-finite or non-positive cap. */
export function tubeSyncMinIntervalMs(fpsCap: number): number {
  if (!Number.isFinite(fpsCap) || fpsCap <= 0) return 0;
  return Math.max(0, 1000 / fpsCap - RATE_SLACK_MS);
}

export interface TubeSyncInput {
  tier: TubeTier;
  /** Squared endpoint drift since the last sync (max over both endpoints);
   *  `null` = never synced. */
  driftSq: number | null;
  nowMs: number;
  /** When this link last synced; `null` = never synced. */
  lastSyncMs: number | null;
  /** Stable per-link shard key (the link's id). */
  shardKey: number;
  /** Effective fps cap (`gfxRef.current?.fpsCap ?? 60` at the call site). */
  fpsCap: number;
}

export function decideTubeSync(input: TubeSyncInput): boolean {
  const { tier, driftSq, nowMs, lastSyncMs, shardKey, fpsCap } = input;
  if (driftSq === null || lastSyncMs === null) return true; // rule 1: first build
  if (driftSq > TUBE_HARD_EPS * TUBE_HARD_EPS) return true; // rule 2: drift authority
  if (nowMs - lastSyncMs < tubeSyncMinIntervalMs(fpsCap)) return false; // rule 3: rate gate
  const key = Math.abs(Number(shardKey) || 0);
  if (tier === "near") {
    if (driftSq > TUBE_NEAR_EPS * TUBE_NEAR_EPS) return true; // rule 4: near drift band
    return Math.floor(nowMs / NEAR_SHARD_MS) % NEAR_SHARD_COUNT === key % NEAR_SHARD_COUNT;
  }
  return Math.floor(nowMs / FAR_SHARD_MS) % FAR_SHARD_COUNT === key % FAR_SHARD_COUNT; // rule 5
}
