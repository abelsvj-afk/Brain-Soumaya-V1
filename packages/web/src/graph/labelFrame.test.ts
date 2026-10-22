import { describe, expect, it } from "vitest";
import {
  LABEL_SAFE_FRAME,
  PHONE_PORTRAIT_MAX_WIDTH,
  clampLabelCenter,
  isPhonePortraitViewport,
} from "./labelFrame.js";

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
