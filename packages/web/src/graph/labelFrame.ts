/**
 * Phone-portrait screen geometry for galaxy labels (Mobile HUD layout pass,
 * screenshot round 2 — findings S2/S6 in
 * ~/workspace/ui-audit/screenshot-round2-diagnosis-2026-10-21.md).
 *
 * Two things live here, both pure so they are unit-testable without a WebGL
 * context (same extraction pattern as sunProximity.ts):
 *
 * 1. THE phone-portrait predicate. The whole pass hangs off ONE breakpoint —
 *    CSS `@media (max-width: 560px) and (orientation: portrait)` — and the
 *    JS side (fan compression in App.helpers, title/cap/clamp wiring in
 *    Graph3D) must agree with it exactly, or the chrome and the canvas
 *    would lay out for different devices. 560px is the stylesheet's
 *    existing small-screen breakpoint (chat dock full-width).
 *
 * 2. The label SAFE FRAME: a rectangle inset from every screen edge by the
 *    dock bands, inside which a planet label's projected centre is clamped
 *    (Graph3D's per-frame label pass). Before this, labels were projected
 *    at their anchor with no clamp at all — a label could start off-screen
 *    or slide under a dock button ("True Covering" losing its T under the
 *    ☰ FAB, the corner fragment in shot 1). The clamp slides the label
 *    along the frame edge instead of letting it leave; a label too big to
 *    fit the frame at all (a close-up planet's name) is left anchored to
 *    its body — dragging it to frame centre would detach it from the
 *    planet it names, which is worse than the overlap.
 */

export const PHONE_PORTRAIT_MAX_WIDTH = 560;

/** True exactly when the CSS phone-portrait breakpoint applies. */
export function isPhonePortraitViewport(viewW: number, viewH: number): boolean {
  return viewW <= PHONE_PORTRAIT_MAX_WIDTH && viewH > viewW;
}

export interface SafeFrameInsets {
  /** px kept clear on the left — the dock column (left 14 + 46px circle = 60) + 8 gap. */
  left: number;
  /** px kept clear on the right — the right rail (right 14 + 46px circle = 60) + 8 gap. */
  right: number;
  /** px kept clear at the top — the brand header band (~110) + margin. */
  top: number;
  /** px kept clear at the bottom — the bottom FAB row (18 + 46 = 64) + margin. */
  bottom: number;
}

export const LABEL_SAFE_FRAME: SafeFrameInsets = { left: 68, right: 68, top: 118, bottom: 76 };

export interface ClampedCentre {
  x: number;
  y: number;
  clamped: boolean;
}

/**
 * Clamp a label's projected centre (screen px, y down) so the whole label
 * box (centre ± half extents) stays inside the safe frame. Returns the
 * input unchanged (`clamped: false`) when the label already fits, and
 * also when the label is LARGER than the frame on either axis — a
 * close-up label that cannot fit stays anchored to its body (see the
 * module doc). Degenerate inputs (non-positive viewport/extents) are
 * returned unchanged rather than producing NaNs.
 */
export function clampLabelCenter(
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  viewW: number,
  viewH: number,
  insets: SafeFrameInsets = LABEL_SAFE_FRAME,
): ClampedCentre {
  if (!(viewW > 0) || !(viewH > 0) || !(halfW >= 0) || !(halfH >= 0)) {
    return { x: cx, y: cy, clamped: false };
  }
  const minX = insets.left + halfW;
  const maxX = viewW - insets.right - halfW;
  const minY = insets.top + halfH;
  const maxY = viewH - insets.bottom - halfH;
  if (minX > maxX || minY > maxY) {
    // The label cannot fit the frame on at least one axis — leave it
    // anchored to its body instead of dragging it to a frame centre.
    return { x: cx, y: cy, clamped: false };
  }
  const x = Math.min(maxX, Math.max(minX, cx));
  const y = Math.min(maxY, Math.max(minY, cy));
  return { x, y, clamped: x !== cx || y !== cy };
}
