import { SUN_RADIUS_MAX } from "./sun.js";
import { isPhonePortraitViewport } from "./labelFrame.js";

/**
 * Sun-proximity rules for labels, sector titles, and the MANUAL camera
 * (Screenshot Fixes Package D, finding #7 — sun whiteout + giant labels).
 *
 * Everything here is a pure function of distances so the geometry is
 * unit-testable without a WebGL context (same extraction pattern as
 * computeGlowFar / linkDrawWidth in graph3dHelpers.ts). Graph3D.tsx wires
 * the results into the per-frame label/title pass and the manual-controls
 * path; nothing in this module touches programmatic flight.
 *
 * Measured sun geometry (sun.ts, `makeSun` / `applyRadius`):
 * - The sun body's radius is hard-clamped at SUN_RADIUS_MAX = 600 — the
 *   same worst-case radius the orbit system clears (orbits.ts SUN_CLEAR)
 *   and the label occlusion test already uses (isOccludedBySun).
 * - The corona is a sprite scaled to `currentRadius * 2.8`, so its
 *   half-extent is 1.4 × the body radius.
 * - The corona texture's radial gradient reaches alpha 0 at 58px of its
 *   64px half-canvas, i.e. the VISIBLE glow ends at 58/64 ≈ 0.906 of the
 *   sprite's half-extent.
 * So the visible glow radius at the sun's maximum size is
 *   600 × 1.4 × 0.90625 = 761.25 world units.
 * Sizing every band below off the MAXIMUM radius (not the sun's current
 * grown size) keeps the bands stable as the sun grows with the brain —
 * the same reason isOccludedBySun uses SUN_RADIUS_MAX.
 */
export const SUN_CORONA_SPRITE_FACTOR = 2.8; // corona.scale = radius × this (sun.ts applyRadius)
export const SUN_CORONA_GRADIENT_EDGE = 58 / 64; // gradient alpha hits 0 at 58 of 64 half-canvas px
export const SUN_GLOW_RADIUS =
  SUN_RADIUS_MAX * (SUN_CORONA_SPRITE_FACTOR / 2) * SUN_CORONA_GRADIENT_EDGE; // 761.25

/**
 * The fade band: ~1.5× the glow radius, per the finding's sized fix.
 * Inside SUN_GLOW_RADIUS (standing in the visible corona) titles/labels
 * are fully faded; at SUN_FADE_OUTER and beyond, behaviour is EXACTLY as
 * before this change. The falloff is a smoothstep — deliberately NOT the
 * hard sun-occlusion gate that was removed from sector titles because it
 * blinked on/off as hubs grazed the sun's limb. A smooth function of the
 * CAMERA's distance to the sun cannot blink: it has no threshold edge to
 * oscillate across, and it answers the actual screenshot condition
 * (the camera inside the glow), not whether a hub is behind the sun.
 */
export const SUN_FADE_OUTER = SUN_GLOW_RADIUS * 1.5; // 1141.875

/**
 * The manual-camera floor sits exactly at the corona's visible edge:
 * the fade completes (factor 0) at the same radius the hand-steered
 * camera stops at, so as you steer toward the sun the titles/labels
 * have already dissolved before the gentle stop — the stop itself
 * never pops a label in or out.
 */
export const SUN_CAMERA_FLOOR_RADIUS = SUN_GLOW_RADIUS; // 761.25

/**
 * Contrast band for planet labels whose ANCHOR sits near the sun: full
 * help at the corona edge, easing to none at 2.5× the glow radius. The
 * band has to reach that far because the innermost top-level orbit ring
 * sits at SUN_RADIUS_MAX + SUN_GAP + size + MARGIN ≈ 1232+ (orbits.ts) —
 * the washed-out labels in the owner's shots (God, Jesus, The Holy
 * Spirit) live on that ring, well outside the corona but squarely in
 * front of its wash when viewed from across the sun.
 */
export const SUN_CONTRAST_OUTER = SUN_GLOW_RADIUS * 2.5; // 1903.125
/** Opacity floor a near-sun label is raised to at the corona edge. */
export const SUN_CONTRAST_OPACITY_FLOOR = 0.9;

/**
 * Upper bound on the sector-title DISTANCE-GROWTH factor (the boost for
 * narrow screens multiplies on top, exactly as today).
 *
 * The uncapped rule it bounds: k = max(1, dist / MACRO_DIST) × BOOST,
 * which holds a title at constant on-screen size at any zoom — the
 * deliberate map-label behaviour, preserved untouched below this cap.
 * The old 3.4× cap froze growth past ~4,100 units and titles shrank into
 * specks in the recentered whole-galaxy view, so the cap must sit ABOVE
 * every distance the framing math in this codebase actually produces.
 * (Camera fov is three.js's default 50°: three-render-objects builds
 * `new THREE.PerspectiveCamera()` and Graph3D overrides only `far`.)
 * Title growth is measured camera-to-HUB, so the demand is the framing
 * distance PLUS the galaxy radius for a far-rim hub. frameGalaxy's fit
 * for the largest galaxy the orbit system builds (radius ≈ 3,700 incl.
 * the 1.06 margin) lands the camera ≈ 9,800 units from centre on
 * landscape (vFit = radius / sin(fov/2), × 1.12 margin) — far-rim
 * demand ≈ (9,800 + 3,500) / 1,200 ≈ 11.1 — and ≈ 14,900 on a portrait
 * phone (hFit with the aspect clamped to 0.62) — far-rim demand
 * ≈ (14,900 + 3,500) / 1,200 ≈ 15.3. A growth cap of 16 clears the
 * worst legitimate demand, so whole-galaxy map behaviour stays
 * byte-identical, and the cap bites only past 19,200 units
 * camera-to-hub — beyond even the recenter-raised maxDistance shell
 * (≈ 15,800) parked opposite a far-rim hub (≈ 19,300, demand ≈ 16.1,
 * a ≤ 1% trim) — i.e. only as the galaxy, and with it maxDistance
 * (scenery scaling sets it to ~3.4× the galaxy radius), grows past
 * the size this codebase currently builds. Uncapped, a title's world
 * width (base marquee window 470px × 0.11 world/px × 2.5 sector
 * scale = 129.25 units, × growth × BOOST) grows without bound with
 * that shell; capped at 16 it can never exceed 129.25 × 16 × BOOST
 * ≈ 2,895 units (narrow screens). And because the cap only binds at
 * distances where growth ≥ 16, a capped title's on-screen size is at
 * or below the constant map size the uncapped rule gives it at its
 * hub's distance — the cap can never make a title BIGGER on screen
 * than today's map behaviour, only stop its world geometry growing
 * past the largest framing in the app. (The screenshot's screen-wide
 * title at close range is the fade's job, below: at the far-view
 * latch distances, 1,050–1,350 units, that map size is already
 * ~35–40% of a portrait phone's width at fov 50° — giant next to a
 * planet label — and inside the sun's wash it had no reason to
 * shrink. The fade removes it there; the cap bounds the far end.)
 */
export const SECTOR_TITLE_GROWTH_CAP = 16;

/** Classic smoothstep on [0, 1] — continuous value AND slope at both ends. */
export function smoothstep01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/**
 * Sun-proximity fade factor for a distance to the sun (world origin):
 * 0 at/inside the visible corona edge, 1 at/beyond 1.5× the glow radius,
 * smoothstep between — so at the band edge the factor meets today's
 * behaviour (1) with no jump, and deep inside it is exactly 0.
 */
export function sunProximityFade(distToSun: number): number {
  if (distToSun <= SUN_GLOW_RADIUS) return 0;
  if (distToSun >= SUN_FADE_OUTER) return 1;
  return smoothstep01((distToSun - SUN_GLOW_RADIUS) / (SUN_FADE_OUTER - SUN_GLOW_RADIUS));
}

/**
 * The sector-title scale factor with the growth cap applied. For every
 * distance whose growth factor is under the cap this returns EXACTLY
 * today's formula, `max(1, dist / macroDist) * boost`.
 */
export function sectorTitleScaleK(dist: number, macroDist: number, boost: number): number {
  const growth = Math.min(Math.max(1, dist / macroDist), SECTOR_TITLE_GROWTH_CAP);
  return growth * boost;
}

/**
 * The opacity floor granted to a label whose anchor sits in the
 * sun-contrast band: SUN_CONTRAST_OPACITY_FLOOR at the corona edge,
 * smoothstepping to 0 (no help, today's behaviour) at SUN_CONTRAST_OUTER.
 */
export function sunContrastOpacityFloor(anchorDistToSun: number): number {
  if (anchorDistToSun <= SUN_GLOW_RADIUS) return SUN_CONTRAST_OPACITY_FLOOR;
  if (anchorDistToSun >= SUN_CONTRAST_OUTER) return 0;
  const x = (SUN_CONTRAST_OUTER - anchorDistToSun) / (SUN_CONTRAST_OUTER - SUN_GLOW_RADIUS);
  return SUN_CONTRAST_OPACITY_FLOOR * smoothstep01(x);
}

/**
 * A label's final opacity near the sun, composing the three rules:
 * - the camera fade multiplies everything (a label photographed from
 *   inside the wash dissolves with the rest of the scene), UNLESS the
 *   label is exempt (selected / followed — the same exemption the
 *   sun-occlusion test has always granted: you flew to this body, its
 *   name stays readable);
 * - a near-sun anchor raises the label to at least the contrast floor
 *   (before the camera fade is applied), so the dim distance-faded
 *   labels on the innermost ring read against the wash instead of
 *   washing out at ~0.3 opacity;
 * - far from the sun on both axes this returns baseOpacity EXACTLY.
 */
export function labelOpacityNearSun(
  baseOpacity: number,
  anchorDistToSun: number,
  cameraFade: number,
  exemptFromFade: boolean,
): number {
  const raised = Math.max(baseOpacity, sunContrastOpacityFloor(anchorDistToSun));
  return exemptFromFade ? raised : raised * cameraFade;
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * Sector-title boost by viewport (Mobile HUD layout pass, screenshot
 * round 2 S2 — the owner's settled call: titles SHRINK on phones).
 *
 * Today's rule (which this preserves everywhere else): screens narrower
 * than 760px get a 1.4× boost so zoomed-out sector names stay readable.
 * On a phone in portrait that boost is exactly what the round-2 shots
 * show sprawling across the view (~35–40% of the screen width, cut
 * mid-word at the edges), so phone portrait gets NO boost — 1.0. The
 * phone predicate is the pass's one breakpoint (labelFrame.ts), shared
 * with the CSS and the fan so canvas and chrome agree on what a phone
 * is. Desktop and landscape are byte-identical to today.
 */
export function sectorLabelBoost(viewW: number, viewH: number): number {
  if (isPhonePortraitViewport(viewW, viewH)) return 1;
  return viewW < 760 ? 1.4 : 1;
}

/**
 * Widest share of the viewport a sector title may occupy on a phone
 * (Mobile HUD layout pass, S2): ~55% of the screen width. With the
 * phone boost at 1.0 a title's constant map size is ~25% of a portrait
 * phone's width, so this cap is a CEILING, not the sizing rule — it
 * binds only if the base texture, fov, or aspect ever conspire to push
 * a title past the owner's "stops spanning the screen" line.
 */
export const SECTOR_TITLE_PHONE_MAX_FRACTION = 0.55;

/**
 * The largest title scale factor k whose on-screen width stays within
 * `maxFraction` of the viewport width, for a title of world width
 * `baseWidthWorld` (its baseScale.x) at camera-space DEPTH `depth`.
 * Pure projection math: a sprite of world width W at depth d spans
 * W / (2·d·tan(hfov/2)) of the screen, and tan(hfov/2) =
 * tan(vfov/2)·aspect. Returns Infinity for degenerate inputs (the cap
 * simply doesn't bind) so callers can Math.min unconditionally.
 *
 * PR #89 follow-up: the second argument is the hub's camera-space
 * DEPTH, not its Euclidean distance — Graph3D previously fed the
 * Euclidean distance, so the ~55% ceiling really permitted 55%·sec θ
 * (~58–61% at frame corners), the same substitution the label clamp
 * made (trace Finding 2). On-axis depth == distance, so centred
 * titles are unchanged.
 */
export function sectorTitleWidthCapK(
  baseWidthWorld: number,
  depth: number,
  fovDeg: number,
  aspect: number,
  maxFraction: number = SECTOR_TITLE_PHONE_MAX_FRACTION,
): number {
  const tanH = Math.tan((fovDeg * Math.PI) / 360) * aspect;
  if (!(baseWidthWorld > 0) || !(depth > 0) || !(tanH > 0)) return Infinity;
  return (2 * depth * tanH * maxFraction) / baseWidthWorld;
}

/**
 * The manual-camera sun floor as pure position math: if `pos` is inside
 * `floorRadius` of the sun (the world origin), project it radially out
 * to exactly the floor sphere, preserving its direction from the sun
 * exactly; otherwise return it UNCHANGED (bit-for-bit — navigation away
 * from, tangential to, or anywhere outside the floor is untouched).
 *
 * Why radial projection reads as a gentle stop rather than a wall: a
 * hand-driven camera moves in small damped increments, so the first
 * crossing step is projected by a sub-unit amount and every following
 * inward step is projected along the sphere — the camera slides along
 * the corona's edge and stops approaching, with no snap. (A camera
 * teleported deep inside would be projected in one step, but no manual
 * path teleports: OrbitControls gestures and zoomBy both move
 * incrementally.)
 *
 * The orbit TARGET is deliberately not moved: OrbitControls derives its
 * orbit offset from the camera position on every update, so projecting
 * the camera alone re-seats the orbit on the floor sphere — orbiting
 * the sun itself (target at the origin) becomes orbiting at corona
 * distance, and orbiting a body near the sun keeps that body as the
 * pivot, with only the camera's sun-side excursion clipped to the
 * sphere.
 */
export function clampCameraToSunFloor(
  pos: Vec3Like,
  floorRadius: number = SUN_CAMERA_FLOOR_RADIUS,
): { pos: Vec3Like; clamped: boolean } {
  const len = Math.hypot(pos.x, pos.y, pos.z);
  if (len >= floorRadius || len === 0) {
    return { pos: { x: pos.x, y: pos.y, z: pos.z }, clamped: false };
  }
  const s = floorRadius / len;
  return { pos: { x: pos.x * s, y: pos.y * s, z: pos.z * s }, clamped: true };
}
