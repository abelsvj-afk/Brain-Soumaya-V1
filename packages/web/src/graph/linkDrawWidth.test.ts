import { describe, it, expect } from "vitest";
import { LINK_HIDDEN_WIDTH, linkDrawWidth } from "./graph3dHelpers.js";

/**
 * Galaxy line-latch Fix A (2026-10-21, rendering investigation at aa86529):
 * three-forcegraph decides a link's Object3D TYPE once, at creation, by
 * `!!widthAccessor(link)` (three-forcegraph.mjs's onCreateObj): falsy width ->
 * a THREE.Line hairline; truthy -> a tube Mesh. Its per-frame layoutTick then
 * branches on that baked-in type (`line.type === 'Line'`) for the object's
 * whole life, so a hairline can NEVER become a tube later, however the width
 * accessor's value changes on later digests. That is the S3 latch ("lines too
 * thin until a planet click"): width was exactly 0 whenever the render gate
 * said "don't draw", so every link gated off at birth was born a hairline and
 * stayed one until a selection change recreated every link object as a tube.
 *
 * Graph3D's width and color accessors share ONE gate (`shouldRenderLink`):
 * `linkColor` returns fully transparent ("rgba(0,0,0,0)") for exactly the
 * outcomes where the gate says "don't draw", so invisibility is already
 * carried by color alone — width never needs to be 0 to hide a link, and must
 * never BE 0, or the object type latches wrong. `linkDrawWidth` is the width
 * accessor's entire decision, extracted pure (same pattern as computeGlowFar
 * in graph3dHelpers.ts) so this contract is testable without a WebGL context.
 */
describe("linkDrawWidth — the width accessor never returns exactly 0", () => {
  // shouldRenderLink's own rule (Graph3D.tsx): draw when the link is lit
  // (selection focus), OR its activity clears 0.4, OR the ~800-unit
  // close-range hysteresis latch is on "close". This mirrors that rule so the
  // matrix below covers the gate's full input space; the component passes the
  // gate's actual boolean into linkDrawWidth, and linkColor keys its
  // transparent return off the same boolean — the agreement pinned here.
  const renderDecision = (lit: boolean, activity: number, closeGate: boolean): boolean =>
    lit || activity > 0.4 || closeGate;

  const activities = [0, 0.1, 0.4, 0.41, 0.75, 1];
  const weights: (number | undefined)[] = [undefined, 0, 0.4, 1];

  it("never returns exactly 0, across the full gate matrix (lit x activity x distance-gate)", () => {
    for (const lit of [true, false]) {
      for (const closeGate of [true, false]) {
        for (const activity of activities) {
          for (const weight of weights) {
            const render = renderDecision(lit, activity, closeGate);
            const w = linkDrawWidth(render, weight, activity);
            expect(w).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("hidden <=> epsilon width; drawn <=> the resting formula (>= 0.7)", () => {
    for (const lit of [true, false]) {
      for (const closeGate of [true, false]) {
        for (const activity of activities) {
          for (const weight of weights) {
            const render = renderDecision(lit, activity, closeGate);
            const w = linkDrawWidth(render, weight, activity);
            if (!render) {
              // Don't-draw: width's only job is staying truthy so the object is
              // born (and stays) a tube mesh; linkColor's transparent return
              // for this same gate outcome carries the invisibility.
              expect(w).toBe(LINK_HIDDEN_WIDTH);
            } else {
              // The pre-fix drawn formula, unchanged:
              // 0.7 + (weight ?? 0.4) * 0.9 + activity^2 * 5.
              expect(w).toBeCloseTo(0.7 + (weight ?? 0.4) * 0.9 + activity * activity * 5, 10);
              expect(w).toBeGreaterThanOrEqual(0.7);
            }
          }
        }
      }
    }
  });

  it("the epsilon still takes the library's cylinder branch after its digest width rounding", () => {
    // three-forcegraph's digest rounds the accessor's value before deciding
    // tube-vs-line, BOTH at creation (onCreateObj: `!!widthAccessor(link)`)
    // and on update digests (onUpdateObj: `linkWidth = Math.ceil(
    // widthAccessor(link) * 10) / 10`, then `!!linkWidth`). Reproduce that
    // rounding verbatim so a future epsilon change that rounded down to 0
    // (silently re-arming the latch) fails here instead of on a device.
    const rounded = Math.ceil(LINK_HIDDEN_WIDTH * 10) / 10;
    expect(rounded).toBeGreaterThan(0);
    expect(!!rounded).toBe(true);
    expect(!!LINK_HIDDEN_WIDTH).toBe(true);
  });
});
