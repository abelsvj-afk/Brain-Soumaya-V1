import { HealthUnavailableError, type Health } from "../api/client.js";

export interface HealthRetryOptions {
  /** Total attempts including the first (default 4). */
  attempts?: number;
  /** First backoff delay in ms; doubles each retry (default 2000). */
  baseDelayMs?: number;
  /** Upper bound for any single wait in ms (default 30000). */
  maxDelayMs?: number;
  /** Injectable sleep (tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Stop early (e.g. the component unmounted or a newer load started). */
  isCancelled?: () => boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Load /api/health, retrying with exponential backoff when it is temporarily
 * unavailable (429 rate-limit, 5xx, network error, malformed body). Honors a
 * 429's Retry-After when the server sends one. Resolves to `null` — "status
 * unknown" — instead of throwing once attempts run out, so callers can never
 * crash on a missing health body.
 */
export async function loadHealthWithBackoff(
  getHealth: () => Promise<Health>,
  opts: HealthRetryOptions = {},
): Promise<Health | null> {
  const attempts = Math.max(1, opts.attempts ?? 4);
  const base = opts.baseDelayMs ?? 2000;
  const max = opts.maxDelayMs ?? 30000;
  const sleep = opts.sleep ?? defaultSleep;
  for (let i = 0; i < attempts; i++) {
    if (opts.isCancelled?.()) return null;
    try {
      return await getHealth();
    } catch (err) {
      if (i === attempts - 1) break;
      // A 4xx other than 429 won't fix itself by waiting.
      if (err instanceof HealthUnavailableError && err.status >= 400 && err.status < 500 && err.status !== 429) break;
      const hinted = err instanceof HealthUnavailableError ? err.retryAfterMs : null;
      await sleep(Math.min(max, hinted ?? base * 2 ** i));
    }
  }
  return null;
}
