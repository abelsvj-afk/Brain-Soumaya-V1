/**
 * Throttle for Soumaya's server job fetches (GET /api/maintenance/next-job).
 *
 * The planner refills its 3-job queue every second and the idle loop asks for
 * a job each time she finishes one. On a small brain the server keeps handing
 * back the same target, which the planner rejects as a duplicate and asks
 * again, so a normal session sent ~1.5 next-job requests a second (119 of 193
 * /api calls in 80s) and tripped the per-IP rate limit. The gate allows one
 * server fetch per `minIntervalMs`; in between, callers use a local patrol
 * (exactly what they already do when the server is offline).
 */
export interface JobFetchGate {
  /** True (and records the attempt) when a server fetch may go out now. */
  tryAcquire(now?: number): boolean;
}

export const NEXT_JOB_MIN_INTERVAL_MS = 15_000;

export function createJobFetchGate(minIntervalMs = NEXT_JOB_MIN_INTERVAL_MS): JobFetchGate {
  let last = -Infinity;
  return {
    tryAcquire(now = Date.now()) {
      if (now - last < minIntervalMs) return false;
      last = now;
      return true;
    },
  };
}
