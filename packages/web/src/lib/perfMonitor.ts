/**
 * Sustained-lag detector behind the "Soumaya noticed some lag — switch to
 * Performance Mode?" offer.
 *
 * Why this exists as its own module: the previous detector lived inline in
 * App.tsx and cried wolf. Forensics (2026-10-30, load-perf build record):
 *  - It armed on a wall clock 8 s after App MOUNT, so its sampling windows sat
 *    inside the load-in period (scene build, shader compiles, GLB streaming)
 *    on exactly the cold loads where the offer was reported as constant.
 *  - It had no tab-visibility handling: rAF halts while hidden, but the
 *    window clock kept running, so the first window after returning to the
 *    app measured ≈0 fps and counted as "low" on a healthy device.
 *  - A dismissal was never remembered, so every fresh load re-armed it.
 *
 * This detector fixes the proven causes, and only those:
 *  - It samples ONLY after `arm()` (App arms it when the scene has actually
 *    rendered — the load gate's readiness signal — or, in lite/error paths,
 *    when boot has otherwise settled) PLUS a settle window, so load-in jank
 *    is never measured.
 *  - Hidden time never enters a measurement window: going hidden pauses the
 *    sampler, and returning resets the current window from zero.
 *  - An offer requires SUSTAINED low frame rate: consecutive visible windows
 *    under the threshold (defaults: 3 × 2 s windows under 24 fps).
 *  - It is one-shot per session arming and checks `isSuppressed()` at offer
 *    time (dismissed earlier this session, or already in Performance Mode),
 *    so a dismissal is never nagged again in the same session.
 *
 * It measures the main thread's rAF cadence (vsync rate while visible),
 * which is what the offer has always measured; it is a lag heuristic, not a
 * GPU profiler. Everything time/frame/DOM related is injected via `deps` so
 * the logic is unit-testable without a browser.
 */

export interface PerfMonitorDeps {
  now: () => number;
  requestFrame: (cb: () => void) => number;
  cancelFrame: (id: number) => void;
  isVisible: () => boolean;
  /** Subscribe to visibility flips; returns an unsubscribe function. */
  onVisibilityChange: (cb: () => void) => () => void;
  setTimer: (cb: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
}

export interface PerfMonitorConfig {
  /** Quiet period after arming before any sampling (load-in/settle jank is not lag). */
  settleMs?: number;
  /** Length of one measurement window. */
  windowMs?: number;
  /** Windows strictly below this fps count as "low". */
  fpsThreshold?: number;
  /** Consecutive low windows required before offering. */
  lowWindowsNeeded?: number;
  /** Checked at offer time: true = stay silent (dismissed / already in Performance Mode). */
  isSuppressed: () => boolean;
  /** Called at most once, when sustained lag is proven. */
  onOffer: () => void;
}

export const PERF_SETTLE_MS = 5000;
export const PERF_WINDOW_MS = 2000;
export const PERF_FPS_THRESHOLD = 24;
export const PERF_LOW_WINDOWS_NEEDED = 3;

export interface PerfMonitor {
  /** Begin the settle countdown. Idempotent; a no-op after dispose/offer. */
  arm: () => void;
  dispose: () => void;
}

export function createPerfMonitor(deps: PerfMonitorDeps, config: PerfMonitorConfig): PerfMonitor {
  const settleMs = config.settleMs ?? PERF_SETTLE_MS;
  const windowMs = config.windowMs ?? PERF_WINDOW_MS;
  const fpsThreshold = config.fpsThreshold ?? PERF_FPS_THRESHOLD;
  const lowWindowsNeeded = config.lowWindowsNeeded ?? PERF_LOW_WINDOWS_NEEDED;

  let disposed = false;
  let armed = false;
  let settled = false;
  let finished = false; // offered (or suppress-checked) — one-shot
  let settleTimer: number | null = null;
  let rafId: number | null = null;
  let frames = 0;
  let windowStart = 0;

  const stopLoop = () => {
    if (rafId !== null) {
      deps.cancelFrame(rafId);
      rafId = null;
    }
  };

  const finish = () => {
    finished = true;
    stopLoop();
    if (settleTimer !== null) {
      deps.clearTimer(settleTimer);
      settleTimer = null;
    }
    if (!config.isSuppressed()) config.onOffer();
  };

  let lowStreak = 0;

  const sample = () => {
    rafId = null;
    if (disposed || finished || !settled) return;
    if (!deps.isVisible()) {
      // Defensive: the visibility listener normally pauses us first, but a
      // frame that lands while hidden must never be counted. Keep the chain
      // alive WITHOUT counting it — returning silently here would kill the
      // sampler for good if the hidden reading was a transient flicker with
      // no matching visibilitychange event to restart it (observed in the
      // load-perf harness, 2026-10-30).
      rafId = deps.requestFrame(sample);
      return;
    }
    frames++;
    const now = deps.now();
    if (now - windowStart >= windowMs) {
      const fps = (frames * 1000) / (now - windowStart);
      lowStreak = fps < fpsThreshold ? lowStreak + 1 : 0;
      frames = 0;
      windowStart = now;
      if (lowStreak >= lowWindowsNeeded) {
        finish();
        return;
      }
    }
    rafId = deps.requestFrame(sample);
  };

  const startLoop = () => {
    if (disposed || finished || !settled || rafId !== null) return;
    if (!deps.isVisible()) {
      // Hidden (or a transient hidden flicker): retry shortly instead of
      // relying solely on a visibilitychange event that may never come.
      settleTimer = deps.setTimer(() => {
        settleTimer = null;
        startLoop();
      }, 250);
      return;
    }
    frames = 0;
    windowStart = deps.now();
    rafId = deps.requestFrame(sample);
  };

  const unsubscribeVisibility = deps.onVisibilityChange(() => {
    if (disposed || finished) return;
    if (!deps.isVisible()) {
      // Going hidden: pause. The partial window is discarded — hidden time
      // must never be measured as a low frame rate.
      stopLoop();
    } else {
      // Back visible: restart the window from zero (startLoop resets it).
      startLoop();
    }
  });

  return {
    arm() {
      if (disposed || armed || finished) return;
      armed = true;
      settleTimer = deps.setTimer(() => {
        settleTimer = null;
        settled = true;
        startLoop();
      }, settleMs);
    },
    dispose() {
      disposed = true;
      stopLoop();
      if (settleTimer !== null) {
        deps.clearTimer(settleTimer);
        settleTimer = null;
      }
      unsubscribeVisibility();
    },
  };
}

const DISMISS_KEY = "brain.perfOfferDismissed";

/** True once the pilot has said "Not now" in this browser session. */
export function perfOfferDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Remember the dismissal for the rest of this session (never nag twice). */
export function dismissPerfOffer(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* storage unavailable — the in-session banner state still hides it */
  }
}

/** Real-browser deps for createPerfMonitor (window/document/performance). */
export function browserPerfMonitorDeps(): PerfMonitorDeps {
  return {
    now: () => performance.now(),
    requestFrame: (cb) => window.requestAnimationFrame(cb),
    cancelFrame: (id) => window.cancelAnimationFrame(id),
    isVisible: () => document.visibilityState !== "hidden",
    onVisibilityChange: (cb) => {
      document.addEventListener("visibilitychange", cb);
      return () => document.removeEventListener("visibilitychange", cb);
    },
    setTimer: (cb, ms) => window.setTimeout(cb, ms),
    clearTimer: (id) => window.clearTimeout(id),
  };
}
