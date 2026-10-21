import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createZoomSettleScheduler,
  createFlightCompletionLatch,
  ZOOM_SETTLE_DELAY_MS,
} from "./zoomSettle.js";

/**
 * Galaxy line-latch Fix B (2026-10-21, rendering investigation at aa86529):
 * the link admission test (`linkVisibility`'s ~650-unit LOD) and the render
 * gate's ~800-unit latch sample the live camera distance ONLY during
 * three-forcegraph digests, and digests run only on React re-renders.
 * Pinch/wheel zoom runs through OrbitControls with no React state change, so
 * after zooming in, the zoomed-OUT admission set persists indefinitely (S2).
 * Graph3D wires OrbitControls' user-gesture 'end' event to this scheduler;
 * when the gesture stream goes quiet for ZOOM_SETTLE_DELAY_MS, exactly one
 * settle fires and Graph3D answers with its existing pulse-tick re-render —
 * one digest at the settled distance. These tests pin the scheduler's timing
 * contract in isolation (fake timers, no DOM/WebGL needed).
 */
describe("createZoomSettleScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a single notify fires exactly once, only after the full quiet delay", () => {
    const onSettle = vi.fn();
    const s = createZoomSettleScheduler(onSettle);
    s.notify();
    vi.advanceTimersByTime(ZOOM_SETTLE_DELAY_MS - 1);
    expect(onSettle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onSettle).toHaveBeenCalledTimes(1);
    // No repeat fire afterwards — one settle per gesture, not a poll.
    vi.advanceTimersByTime(ZOOM_SETTLE_DELAY_MS * 5);
    expect(onSettle).toHaveBeenCalledTimes(1);
    s.dispose();
  });

  it("a burst of notifies yields exactly one fire, after the LAST notify", () => {
    const onSettle = vi.fn();
    const s = createZoomSettleScheduler(onSettle);
    // A wheel-zoom burst: OrbitControls dispatches 'end' per wheel tick.
    // (No advance after the last notify, so the assertions below measure the
    // quiet window from the final tick exactly.)
    for (let i = 0; i < 10; i++) {
      s.notify();
      if (i < 9) vi.advanceTimersByTime(50);
    }
    expect(onSettle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(ZOOM_SETTLE_DELAY_MS - 1);
    expect(onSettle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onSettle).toHaveBeenCalledTimes(1);
    s.dispose();
  });

  it("continuous notifies never fire until the stream goes quiet", () => {
    const onSettle = vi.fn();
    const s = createZoomSettleScheduler(onSettle);
    // 3 seconds of steady gesture events, always inside the quiet window.
    for (let i = 0; i < 30; i++) {
      s.notify();
      vi.advanceTimersByTime(100);
    }
    expect(onSettle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(ZOOM_SETTLE_DELAY_MS);
    expect(onSettle).toHaveBeenCalledTimes(1);
    s.dispose();
  });

  it("dispose cancels a pending settle, and later notifies are ignored", () => {
    const onSettle = vi.fn();
    const s = createZoomSettleScheduler(onSettle);
    s.notify();
    s.dispose();
    vi.advanceTimersByTime(ZOOM_SETTLE_DELAY_MS * 3);
    expect(onSettle).not.toHaveBeenCalled();
    s.notify();
    vi.advanceTimersByTime(ZOOM_SETTLE_DELAY_MS * 3);
    expect(onSettle).not.toHaveBeenCalled();
  });

  it("settles again for a later gesture (one fire per quiet period)", () => {
    const onSettle = vi.fn();
    const s = createZoomSettleScheduler(onSettle);
    s.notify();
    vi.advanceTimersByTime(ZOOM_SETTLE_DELAY_MS);
    expect(onSettle).toHaveBeenCalledTimes(1);
    s.notify();
    vi.advanceTimersByTime(ZOOM_SETTLE_DELAY_MS);
    expect(onSettle).toHaveBeenCalledTimes(2);
    s.dispose();
  });

  it("honors a custom delay", () => {
    const onSettle = vi.fn();
    const s = createZoomSettleScheduler(onSettle, 40);
    s.notify();
    vi.advanceTimersByTime(39);
    expect(onSettle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onSettle).toHaveBeenCalledTimes(1);
    s.dispose();
  });
});

/**
 * Flight-end settle (2026-10-21, the flagged addition to Fix B): programmatic
 * flights (fly-to, follow-engage) emit no OrbitControls 'end', so Fix B's
 * gesture-only trigger never fired for them and the distance latches stayed
 * sampled mid-flight — the owner's total-disappearance event. The flight
 * paths report completion into the same scheduler; the latch below is the
 * per-frame half for the follow-engage fly-in, whose end Graph3D's render
 * loop already tracks. These tests pin the latch's contract and the
 * composition (latch → scheduler): exactly one settle per flight, and a
 * gesture 'end' coinciding with a flight completion still yields ONE.
 */
describe("createFlightCompletionLatch", () => {
  it("poll is false before begin, and false while the flight is still running", () => {
    const latch = createFlightCompletionLatch();
    expect(latch.poll(1000)).toBe(false);
    latch.begin(2000);
    expect(latch.poll(1000)).toBe(false);
    expect(latch.poll(1999)).toBe(false);
  });

  it("poll fires exactly once — on the first poll at or after the flight's end", () => {
    const latch = createFlightCompletionLatch();
    latch.begin(2000);
    expect(latch.poll(2000)).toBe(true);
    expect(latch.poll(2000)).toBe(false);
    expect(latch.poll(5000)).toBe(false);
  });

  it("a second begin supersedes the first (only the latest flight's arrival matters)", () => {
    const latch = createFlightCompletionLatch();
    latch.begin(1000);
    latch.begin(5000); // re-targeted mid-flight
    expect(latch.poll(1500)).toBe(false); // the superseded flight's end passes silently
    expect(latch.poll(5000)).toBe(true);
    expect(latch.poll(5001)).toBe(false);
  });

  it("cancel disarms without firing", () => {
    const latch = createFlightCompletionLatch();
    latch.begin(1000);
    latch.cancel();
    expect(latch.poll(2000)).toBe(false);
  });

  it("composition: a flight completion notifies the scheduler exactly once, after the quiet delay", () => {
    vi.useFakeTimers();
    try {
      const onSettle = vi.fn();
      const settle = createZoomSettleScheduler(onSettle);
      const latch = createFlightCompletionLatch();
      // The Graph3D wiring, in miniature: flight begins (armed with its end),
      // the render loop polls per frame, and a true poll notifies the settle.
      latch.begin(880);
      for (const now of [0, 300, 600, 879]) {
        if (latch.poll(now)) settle.notify();
      }
      expect(onSettle).not.toHaveBeenCalled();
      if (latch.poll(880)) settle.notify();
      vi.advanceTimersByTime(ZOOM_SETTLE_DELAY_MS - 1);
      expect(onSettle).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onSettle).toHaveBeenCalledTimes(1);
      // Later polls stay silent — no repeat settle for the same flight.
      if (latch.poll(2000)) settle.notify();
      vi.advanceTimersByTime(ZOOM_SETTLE_DELAY_MS * 3);
      expect(onSettle).toHaveBeenCalledTimes(1);
      settle.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("composition: a gesture 'end' coinciding with a flight completion yields ONE settle, not two", () => {
    vi.useFakeTimers();
    try {
      const onSettle = vi.fn();
      const settle = createZoomSettleScheduler(onSettle);
      const latch = createFlightCompletionLatch();
      latch.begin(880);
      settle.notify(); // the user's gesture ends at ~the same moment…
      if (latch.poll(900)) settle.notify(); // …as the flight completes
      vi.advanceTimersByTime(ZOOM_SETTLE_DELAY_MS);
      expect(onSettle).toHaveBeenCalledTimes(1); // one scheduler, one debounce — one digest
      settle.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
