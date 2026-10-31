import { describe, it, expect, vi } from "vitest";
import {
  createPerfMonitor,
  type PerfMonitorDeps,
} from "./perfMonitor.js";

/**
 * Fake environment: a manual clock, a manual timer queue, and a manual rAF
 * pump, so frame cadence is exact — `pumpFrames(n, msEach)` delivers n frame
 * callbacks spaced msEach apart. Visibility flips are explicit.
 */
function makeEnv() {
  let now = 0;
  let visible = true;
  let rafSeq = 0;
  const rafQueue = new Map<number, () => void>();
  const timers = new Map<number, { at: number; cb: () => void }>();
  let timerSeq = 0;
  const visListeners = new Set<() => void>();

  let hiddenReads = 0; // transient hidden flickers: isVisible() lies false, no event fires
  const deps: PerfMonitorDeps = {
    now: () => now,
    requestFrame: (cb) => {
      const id = ++rafSeq;
      rafQueue.set(id, cb);
      return id;
    },
    cancelFrame: (id) => {
      rafQueue.delete(id);
    },
    isVisible: () => {
      if (hiddenReads > 0) {
        hiddenReads--;
        return false;
      }
      return visible;
    },
    onVisibilityChange: (cb) => {
      visListeners.add(cb);
      return () => visListeners.delete(cb);
    },
    setTimer: (cb, ms) => {
      const id = ++timerSeq;
      timers.set(id, { at: now + ms, cb });
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id);
    },
  };

  /** Advance the clock, firing any timers that come due (in order). */
  function advance(ms: number) {
    const target = now + ms;
    for (;;) {
      let nextId: number | null = null;
      let nextAt = Infinity;
      for (const [id, t] of timers) {
        if (t.at <= target && t.at < nextAt) {
          nextAt = t.at;
          nextId = id;
        }
      }
      if (nextId === null) break;
      const t = timers.get(nextId)!;
      timers.delete(nextId);
      now = t.at;
      t.cb();
    }
    now = target;
  }

  /** Deliver n rAF callbacks, each advancing the clock by msEach first. */
  function pumpFrames(n: number, msEach: number) {
    for (let i = 0; i < n; i++) {
      advance(msEach);
      const cbs = [...rafQueue.values()];
      rafQueue.clear();
      for (const cb of cbs) cb();
    }
  }

  function setVisible(v: boolean) {
    if (visible === v) return;
    visible = v;
    for (const cb of [...visListeners]) cb();
  }

  /** Make isVisible() read false for the next n calls WITHOUT firing a
   *  visibilitychange event (a transient occlusion flicker). */
  function flickerHidden(n: number) {
    hiddenReads = n;
  }

  return { deps, advance, pumpFrames, setVisible, flickerHidden, pendingFrames: () => rafQueue.size };
}

const FAST = 16; // ~60fps
const SLOW = 50; // 20fps — below the 24fps threshold

function setup(opts?: { suppressed?: boolean }) {
  const env = makeEnv();
  const onOffer = vi.fn();
  const monitor = createPerfMonitor(env.deps, {
    settleMs: 5000,
    windowMs: 2000,
    fpsThreshold: 24,
    lowWindowsNeeded: 3,
    isSuppressed: () => opts?.suppressed ?? false,
    onOffer,
  });
  return { env, monitor, onOffer };
}

/** Drive one full 2 s window at the given per-frame cost. */
function window(env: ReturnType<typeof makeEnv>, msEach: number) {
  const frames = Math.ceil(2000 / msEach);
  env.pumpFrames(frames, msEach);
}

describe("perfMonitor — sustained-lag detector", () => {
  it("never samples before arm(), and jank during the settle window is ignored", () => {
    const { env, monitor, onOffer } = setup();
    // Not armed: heavy jank for a long time → silence.
    window(env, SLOW);
    window(env, SLOW);
    window(env, SLOW);
    expect(onOffer).not.toHaveBeenCalled();

    monitor.arm();
    // During the 5 s settle, even total stalls produce no offer.
    env.pumpFrames(10, 500); // 5 s of 2fps — pure load-in style jank
    expect(onOffer).not.toHaveBeenCalled();
  });

  it("does not fire on healthy frame rates after settle", () => {
    const { env, monitor, onOffer } = setup();
    monitor.arm();
    env.advance(5000);
    for (let i = 0; i < 10; i++) window(env, FAST);
    expect(onOffer).not.toHaveBeenCalled();
  });

  it("fires after 3 consecutive low windows — and only once", () => {
    const { env, monitor, onOffer } = setup();
    monitor.arm();
    env.advance(5000);
    window(env, SLOW);
    window(env, SLOW);
    expect(onOffer).not.toHaveBeenCalled();
    window(env, SLOW);
    expect(onOffer).toHaveBeenCalledTimes(1);
    // One-shot: further jank never re-fires.
    window(env, SLOW);
    window(env, SLOW);
    window(env, SLOW);
    expect(onOffer).toHaveBeenCalledTimes(1);
  });

  it("a single healthy window resets the streak (spikes are not sustained lag)", () => {
    const { env, monitor, onOffer } = setup();
    monitor.arm();
    env.advance(5000);
    window(env, SLOW);
    window(env, SLOW);
    window(env, FAST); // recovery breaks the streak
    window(env, SLOW);
    window(env, SLOW);
    expect(onOffer).not.toHaveBeenCalled();
    window(env, SLOW);
    expect(onOffer).toHaveBeenCalledTimes(1);
  });

  it("hidden time never counts: a long hidden gap mid-window is not a low window", () => {
    const { env, monitor, onOffer } = setup();
    monitor.arm();
    env.advance(5000);
    window(env, SLOW); // low streak 1
    // Start a second window, go hidden for a simulated 10 minutes, return.
    env.pumpFrames(5, FAST);
    env.setVisible(false);
    env.advance(600_000);
    env.setVisible(true);
    // The partial window was discarded: healthy frames now complete a
    // healthy window (streak resets), NOT a ≈0fps window (streak 2).
    window(env, FAST);
    window(env, SLOW); // streak 1 again
    window(env, SLOW); // streak 2
    expect(onOffer).not.toHaveBeenCalled();
    window(env, SLOW); // streak 3 → offer
    expect(onOffer).toHaveBeenCalledTimes(1);
  });

  it("stays silent while hidden even if frames crawl, until visible again", () => {
    const { env, monitor, onOffer } = setup();
    monitor.arm();
    env.advance(5000);
    env.setVisible(false);
    env.advance(60_000);
    env.pumpFrames(3, 1000); // stray frames while hidden must not count
    env.setVisible(true);
    window(env, FAST);
    expect(onOffer).not.toHaveBeenCalled();
  });

  it("a transient hidden flicker (no visibilitychange event) neither counts nor kills the sampler", () => {
    const { env, monitor, onOffer } = setup();
    monitor.arm();
    env.advance(5000);
    window(env, SLOW); // low streak 1
    env.flickerHidden(5); // next 5 frame callbacks read "hidden" — no event
    env.pumpFrames(5, SLOW); // must be skipped, chain must stay alive
    expect(env.pendingFrames()).toBeGreaterThan(0); // chain alive
    window(env, SLOW); // low streak 2 (flicker frames never counted)
    expect(onOffer).not.toHaveBeenCalled();
    window(env, SLOW); // low streak 3 → offer
    expect(onOffer).toHaveBeenCalledTimes(1);
  });

  it("suppression (dismissed / already in Performance Mode) silences the offer", () => {
    const { env, monitor, onOffer } = setup({ suppressed: true });
    monitor.arm();
    env.advance(5000);
    window(env, SLOW);
    window(env, SLOW);
    window(env, SLOW);
    window(env, SLOW);
    expect(onOffer).not.toHaveBeenCalled();
  });

  it("dispose() stops all sampling", () => {
    const { env, monitor, onOffer } = setup();
    monitor.arm();
    env.advance(5000);
    monitor.dispose();
    window(env, SLOW);
    window(env, SLOW);
    window(env, SLOW);
    expect(onOffer).not.toHaveBeenCalled();
    expect(env.pendingFrames()).toBe(0);
  });
});
