/**
 * Zoom-settle scheduler — Galaxy line-latch Fix B (2026-10-21, rendering
 * investigation at aa86529).
 *
 * The problem it solves: the galaxy's link admission test (`linkVisibility`'s
 * ~650-unit LOD cutoff) and the render gate's ~800-unit latch
 * (`shouldRenderLink`) sample the live camera-to-look-target distance ONLY
 * during three-forcegraph digests, and digests run only when React
 * re-renders Graph3D. Camera gestures run through OrbitControls with no
 * React state change at all, so after zooming IN, the zoomed-OUT admission
 * set persisted indefinitely — weak links that should return at close zoom
 * stayed missing with the camera completely still (S2), until some ambient
 * re-render happened to re-sample.
 *
 * The wiring (Graph3D.tsx): OrbitControls dispatches its 'end' event ONLY
 * for user gestures — verified against the installed three.js source, where
 * `onPointerUp` and `onMouseWheel` are the sole `_endEvent` dispatch sites
 * (its `update()`, which the per-frame damping loop calls, dispatches only
 * 'change'), and the programmatic fly-to tween (`cameraPosition` in
 * three-render-objects) writes `camera.position` / `controls.target`
 * directly and dispatches no controls events at all. So 'end' is a clean
 * user-gesture signal. Each 'end' calls `notify()` here; when the gesture
 * stream has been quiet for ZOOM_SETTLE_DELAY_MS, `onSettle` fires EXACTLY
 * once, and Graph3D answers with the same pulse-tick re-render `fireLink`
 * uses (the sanctioned cheap digest — NO `fg.refresh()`, no mapper clear, no
 * selection change), so both hysteresis latches re-sample at the settled
 * camera distance.
 *
 * Debounce (not throttle) is the point: OrbitControls' wheel handler
 * dispatches 'end' once PER WHEEL TICK, so a zoom burst is a stream of
 * 'end' events — each one restarts the quiet window, and nothing fires
 * mid-gesture.
 */
export const ZOOM_SETTLE_DELAY_MS = 200;

export interface ZoomSettleScheduler {
  /** A user camera gesture ended (or a wheel tick landed): (re)start the quiet window. */
  notify(): void;
  /** Cancel any pending settle; subsequent notify() calls are ignored. */
  dispose(): void;
}

export function createZoomSettleScheduler(
  onSettle: () => void,
  delayMs: number = ZOOM_SETTLE_DELAY_MS,
): ZoomSettleScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  return {
    notify() {
      if (disposed) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (!disposed) onSettle();
      }, delayMs);
    },
    dispose() {
      disposed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

/**
 * Flight-completion latch — Galaxy line-latch flight-end settle (2026-10-21,
 * the flagged addition to Fix B).
 *
 * Fix B's scheduler above is driven by OrbitControls' 'end' event, which
 * programmatic camera flights never emit (the fly-to tween writes
 * camera.position/controls.target directly — see this file's header). So
 * after a flight, the distance latches kept whatever they sampled mid-flight
 * until an ambient digest happened along (the owner's total-disappearance
 * event: ~4 s gone, partial return). The flight paths therefore report their
 * completion into the SAME scheduler — one scheduler, one debounce, so a
 * gesture 'end' and a flight completion that coincide still produce exactly
 * one settle digest.
 *
 * This latch is the per-frame half of that reporting for the one flight
 * whose completion is observed by polling rather than by a scheduled
 * callback: Graph3D's follow-engage fly-in, whose end the render loop
 * already tracks via `followFlyUntilRef`. `begin()` arms it with the
 * flight's end timestamp (the caller's clock — `performance.now()` in
 * Graph3D); the loop calls `poll(now)` each frame, and poll returns `true`
 * EXACTLY once, on the first call at or after the armed end. A second
 * `begin()` supersedes the first (only the latest flight's arrival matters
 * — the camera ends wherever the newest flight takes it). `cancel()` disarms
 * without firing (the flight's owner was released; its own engage path, if
 * any, reports completion itself). Pure and clock-injected, like the
 * scheduler above is timer-injected — no DOM, no timers, unit-testable.
 */
export interface FlightCompletionLatch {
  /** A programmatic flight began; it completes at `untilMs` (caller's clock). */
  begin(untilMs: number): void;
  /** Forget any armed flight without firing. */
  cancel(): void;
  /** Per-frame check: `true` exactly once — the first poll at/after the flight's end. */
  poll(nowMs: number): boolean;
}

export function createFlightCompletionLatch(): FlightCompletionLatch {
  let until: number | null = null;
  return {
    begin(untilMs: number) {
      until = untilMs;
    },
    cancel() {
      until = null;
    },
    poll(nowMs: number) {
      if (until !== null && nowMs >= until) {
        until = null;
        return true;
      }
      return false;
    },
  };
}
