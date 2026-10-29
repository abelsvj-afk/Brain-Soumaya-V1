import { describe, expect, it } from "vitest";
import {
  LABEL_SAFE_FRAME,
  PHONE_PORTRAIT_MAX_WIDTH,
  clampLabelCenter,
  isPhonePortraitViewport,
} from "./labelFrame.js";
// Namespace access for the PR #89 follow-up exports: absent on the
// pre-fix tree (undefined), so the new tests fail individually there
// instead of taking the whole file down at import.
import * as labelFrame from "./labelFrame.js";

/**
 * Mobile HUD layout pass (screenshot round 2, S2/S6): the phone-portrait
 * predicate must agree with the stylesheet's one breakpoint, and the
 * label safe-frame clamp must keep a fitting label fully inside the
 * dock-inset frame while never detaching an oversized close-up label.
 */

describe("isPhonePortraitViewport — the ONE breakpoint, shared by CSS and JS", () => {
  it("matches the owner's phone sizes", () => {
    expect(isPhonePortraitViewport(390, 844)).toBe(true);
    expect(isPhonePortraitViewport(360, 640)).toBe(true);
    expect(isPhonePortraitViewport(393, 852)).toBe(true);
  });
  it("rejects desktop, landscape, and square viewports", () => {
    expect(isPhonePortraitViewport(1440, 900)).toBe(false);
    expect(isPhonePortraitViewport(844, 390)).toBe(false); // phone landscape
    expect(isPhonePortraitViewport(560, 560)).toBe(false); // square is not portrait
  });
  it("the width edge is exactly the stylesheet's 560px breakpoint", () => {
    expect(isPhonePortraitViewport(PHONE_PORTRAIT_MAX_WIDTH, 900)).toBe(true);
    expect(isPhonePortraitViewport(PHONE_PORTRAIT_MAX_WIDTH + 1, 900)).toBe(false);
  });
});

describe("LABEL_SAFE_FRAME — insets clear every dock band", () => {
  it("clears the left dock column and the right rail (14 + 46) with a gap", () => {
    expect(LABEL_SAFE_FRAME.left).toBeGreaterThanOrEqual(14 + 46 + 8);
    expect(LABEL_SAFE_FRAME.right).toBeGreaterThanOrEqual(14 + 46 + 8);
  });
  it("clears the brand header band and the bottom FAB row", () => {
    expect(LABEL_SAFE_FRAME.top).toBeGreaterThanOrEqual(110);
    expect(LABEL_SAFE_FRAME.bottom).toBeGreaterThanOrEqual(18 + 46);
  });
});

describe("clampLabelCenter — a fitting label stays fully inside the frame", () => {
  const W = 390;
  const H = 844;
  it("leaves an already-inside label untouched", () => {
    expect(clampLabelCenter(195, 422, 40, 10, W, H)).toEqual({ x: 195, y: 422, clamped: false });
  });
  it("slides a label starting off-screen left back inside (the 'True Covering' case)", () => {
    // Centre at x=30 with half-width 70: the box starts at -40, off-screen.
    const r = clampLabelCenter(30, 700, 70, 10, W, H);
    expect(r.clamped).toBe(true);
    expect(r.x - 70).toBe(LABEL_SAFE_FRAME.left); // box's left edge exactly on the frame
    expect(r.y).toBe(700);
  });
  it("keeps a label off the bottom FAB row and out of the header band", () => {
    const low = clampLabelCenter(195, 830, 40, 10, W, H);
    expect(low.y + 10).toBe(H - LABEL_SAFE_FRAME.bottom);
    const high = clampLabelCenter(195, 60, 40, 10, W, H);
    expect(high.y - 10).toBe(LABEL_SAFE_FRAME.top);
  });
  it("keeps a label off the right rail", () => {
    const r = clampLabelCenter(380, 422, 40, 10, W, H);
    expect(r.x + 40).toBe(W - LABEL_SAFE_FRAME.right);
  });
  it("never detaches a label too big to fit the frame (close-up planet)", () => {
    // Half-width 200 on a 390 screen: frame inner width is 390-68-68=254 < 400.
    expect(clampLabelCenter(60, 422, 200, 10, W, H)).toEqual({ x: 60, y: 422, clamped: false });
    // Same on the vertical axis.
    expect(clampLabelCenter(195, 100, 40, 400, W, H).clamped).toBe(false);
  });
  it("degenerate inputs pass through instead of producing NaNs", () => {
    expect(clampLabelCenter(10, 10, 5, 5, 0, H).clamped).toBe(false);
    expect(clampLabelCenter(10, 10, -1, 5, W, H).clamped).toBe(false);
  });
});

describe("cameraDepthFromNdc / labelHalfExtentsPx — depth-true sizing (PR #89 follow-up, trace Finding 2)", () => {
  const FOV = 50; // three.js default, as in Graph3D
  const TAN_V = Math.tan((FOV * Math.PI) / 360);
  const ASPECT = 390 / 844;
  const VW = 390;
  const VH = 844;

  it("on-axis, depth is the distance and the extents reproduce the old Euclidean values exactly", () => {
    const { cameraDepthFromNdc, labelHalfExtentsPx } = labelFrame;
    expect(typeof cameraDepthFromNdc).toBe("function");
    expect(typeof labelHalfExtentsPx).toBe("function");
    const dist = 1200;
    expect(cameraDepthFromNdc(dist, 0, 0, TAN_V, ASPECT)).toBe(dist);
    // The pre-fix inline formulas (Graph3D, Euclidean basis):
    const oldHalfW = ((200 / 2) * VW) / (2 * dist * TAN_V * ASPECT);
    const oldHalfH = ((24 / 2) * VH) / (2 * dist * TAN_V);
    const { halfW, halfH } = labelHalfExtentsPx(200, 24, dist, FOV, ASPECT, VW, VH);
    expect(halfW).toBeCloseTo(oldHalfW, 10);
    expect(halfH).toBeCloseTo(oldHalfH, 10);
  });

  it("at a frame-corner NDC the extents exceed the Euclidean estimate by exactly sec θ", () => {
    const { cameraDepthFromNdc, labelHalfExtentsPx } = labelFrame;
    const dist = 1200;
    const nx = 0.82;
    const ny = -0.86; // a bottom-left frame-corner region (y down ⇒ NDC y up is negative low)
    const secTheta = Math.sqrt(1 + (nx * TAN_V * ASPECT) ** 2 + (ny * TAN_V) ** 2);
    expect(secTheta).toBeGreaterThan(1.05); // the corner really is off-axis
    const depth = cameraDepthFromNdc(dist, nx, ny, TAN_V, ASPECT);
    expect(depth).toBeCloseTo(dist / secTheta, 10);
    const euclid = labelHalfExtentsPx(200, 24, dist, FOV, ASPECT, VW, VH);
    const truth = labelHalfExtentsPx(200, 24, depth, FOV, ASPECT, VW, VH);
    expect(truth.halfW / euclid.halfW).toBeCloseTo(secTheta, 10);
    expect(truth.halfH / euclid.halfH).toBeCloseTo(secTheta, 10);
  });

  it("the regression that would have caught it: a box that fits on Euclidean extents but crosses on true extents is clamped exactly onto the frame edge", () => {
    const { cameraDepthFromNdc, labelHalfExtentsPx } = labelFrame;
    const dist = 900;
    const nx = 0.82;
    const ny = -0.86;
    const depth = cameraDepthFromNdc(dist, nx, ny, TAN_V, ASPECT);
    const euclid = labelHalfExtentsPx(200, 24, dist, FOV, ASPECT, VW, VH);
    const truth = labelHalfExtentsPx(200, 24, depth, FOV, ASPECT, VW, VH);
    // Centre placed so the EUCLIDEAN box just fits inside the left
    // frame edge (2px to spare) — the old code left this label here,
    // its true box hanging ~past the edge into the dock clearance.
    const cx = LABEL_SAFE_FRAME.left + euclid.halfW + 2;
    const cy = 500;
    expect(clampLabelCenter(cx, cy, euclid.halfW, euclid.halfH, VW, VH).clamped).toBe(false);
    // With depth-true extents the clamp engages, and the corrected
    // box lands EXACTLY on the frame edge: the whole label box is
    // inside the safe frame — the guarantee, restored, not a
    // likelihood.
    const r = clampLabelCenter(cx, cy, truth.halfW, truth.halfH, VW, VH);
    expect(r.clamped).toBe(true);
    expect(r.x - truth.halfW).toBeCloseTo(LABEL_SAFE_FRAME.left, 10);
    expect(r.x + truth.halfW).toBeLessThanOrEqual(VW - LABEL_SAFE_FRAME.right);
  });

  it("a wide label (halfW ≥ 90) at a frame corner stays wholly inside the frame on true extents", () => {
    const { cameraDepthFromNdc, labelHalfExtentsPx } = labelFrame;
    const dist = 500;
    const nx = -0.85;
    const ny = 0.88; // top-right corner region
    const depth = cameraDepthFromNdc(dist, nx, ny, TAN_V, ASPECT);
    // World width 100 at this depth projects to halfW ≈ 99 — wide
    // (≥ 90) yet still fittable in the frame (inner half-width 127):
    // the conjunction the trace flagged as the residual-risk case.
    const { halfW, halfH } = labelHalfExtentsPx(100, 30, depth, FOV, ASPECT, VW, VH);
    expect(halfW).toBeGreaterThanOrEqual(90);
    // Centre pushed past the right and top frame edges by the anchor.
    const r = clampLabelCenter(VW - 30, 90, halfW, halfH, VW, VH);
    expect(r.clamped).toBe(true);
    expect(r.x - halfW).toBeGreaterThanOrEqual(LABEL_SAFE_FRAME.left);
    expect(r.x + halfW).toBeLessThanOrEqual(VW - LABEL_SAFE_FRAME.right);
    expect(r.y - halfH).toBeGreaterThanOrEqual(LABEL_SAFE_FRAME.top);
    expect(r.y + halfH).toBeLessThanOrEqual(VH - LABEL_SAFE_FRAME.bottom);
  });

  it("degenerate depth declines via infinite extents (the clamp leaves the label anchored)", () => {
    const { labelHalfExtentsPx } = labelFrame;
    const { halfW, halfH } = labelHalfExtentsPx(200, 24, 0, FOV, ASPECT, VW, VH);
    expect(halfW).toBe(Infinity);
    expect(halfH).toBe(Infinity);
    expect(clampLabelCenter(100, 100, halfW, halfH, VW, VH).clamped).toBe(false);
  });
});

describe("Batch I — sector titles get the same whole-box clamp as planet labels (REG-061 / GH-02)", () => {
  // A far-view sector title anchored at the right edge on phone portrait:
  // the title is wide (its capped width is ~55% of the screen) and its
  // anchor sits at the screen edge, so the unclamped box runs off-screen.
  // The clamp must slide the CENTRE so the whole box lands inside the
  // safe frame — the same guarantee the planet labels carry.
  it("a wide sector title anchored at the right edge stays wholly inside the frame", () => {
    const W = 390;
    const H = 844;
    // Anchor centre x=360 (near the right edge), half-width 105 (~54% of 390).
    const r = clampLabelCenter(360, 422, 105, 12, W, H);
    expect(r.clamped).toBe(true);
    expect(r.x + 105).toBe(W - LABEL_SAFE_FRAME.right);
    expect(r.x - 105).toBeGreaterThanOrEqual(LABEL_SAFE_FRAME.left);
    expect(r.y - 12).toBeGreaterThanOrEqual(LABEL_SAFE_FRAME.top);
    expect(r.y + 12).toBeLessThanOrEqual(H - LABEL_SAFE_FRAME.bottom);
  });

  it("a wide sector title anchored at the left edge stays wholly inside the frame", () => {
    const W = 390;
    const H = 844;
    const r = clampLabelCenter(30, 422, 105, 12, W, H);
    expect(r.clamped).toBe(true);
    expect(r.x - 105).toBe(LABEL_SAFE_FRAME.left);
    expect(r.x + 105).toBeLessThanOrEqual(W - LABEL_SAFE_FRAME.right);
  });
});
