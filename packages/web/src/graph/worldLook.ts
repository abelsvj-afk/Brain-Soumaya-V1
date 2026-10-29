/**
 * Free look for the worlds — the traveller's own drag / pinch / scroll, layered ON TOP of each
 * world's camera pose.
 *
 * Until now a world was a picture: the camera was a slow automatic orbit the traveller could not
 * touch (the only input the scene listened for was a tap to skip the arrival glide). Each world
 * computes its own camera pose every frame and some script it (the Station's arrival glide, the
 * Deep Past's guided descent), so a stock orbit-controls object would fight those scripts. This
 * works as an OFFSET instead: take the pose the world just computed, and swing it around the
 * world's pivot by the traveller's yaw / pitch and scale its distance by their zoom. The world's
 * own motion keeps running underneath and scripted moments simply don't apply the offset.
 *
 * Pure (no three.js, no DOM) so the math is unit-tested; WorldsSurface owns the input.
 */

export interface LookState {
  /** Radians swung around the vertical axis, + = the camera moves to the traveller's right. */
  yaw: number;
  /** Radians added to the camera's elevation angle above/below the pivot. */
  pitch: number;
  /** Distance multiplier: 1 = the world's own framing, < 1 closer, > 1 further. */
  zoom: number;
}

export const NO_LOOK: LookState = { yaw: 0, pitch: 0, zoom: 1 };

/** Never look straight down/up (the camera would flip), nor press into the pivot or drift away. */
export const LOOK_LIMITS = {
  maxElevation: 1.35, // ~77° — absolute elevation of the camera above/below the pivot
  zoomMin: 0.3,
  zoomMax: 2.6,
} as const;

/** Radians of turn per pixel dragged. ~a full screen width swings the view about 1.3 rad. */
export const DRAG_RADIANS_PER_PX = 0.006;

type Vec3 = readonly [number, number, number];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** True once the traveller has moved the view at all. */
export function isLooked(s: LookState): boolean {
  return s.yaw !== 0 || s.pitch !== 0 || s.zoom !== 1;
}

/** A finger/mouse drag of (dx, dy) pixels. Dragging right turns the world with the finger,
 *  i.e. the camera swings left — the direct-manipulation feel of every map and globe. */
export function dragLook(s: LookState, dx: number, dy: number, radPerPx = DRAG_RADIANS_PER_PX): LookState {
  return { ...s, yaw: s.yaw - dx * radPerPx, pitch: s.pitch + dy * radPerPx };
}

/** A pinch / wheel: factor > 1 brings the camera closer (zoom in), < 1 pulls it back. */
export function zoomLook(s: LookState, factor: number): LookState {
  if (!Number.isFinite(factor) || factor <= 0) return s;
  return { ...s, zoom: clamp(s.zoom / factor, LOOK_LIMITS.zoomMin, LOOK_LIMITS.zoomMax) };
}

/**
 * Apply the offset to a pose. `pos` is where the world put the camera, `pivot` the point it
 * orbits and looks at. The result keeps the camera on a sphere around the pivot: radius scaled by
 * zoom, azimuth shifted by yaw, elevation shifted by pitch (clamped). `minY` is the world's camera
 * floor (the garden's), if it has one — no pose may end below it.
 */
export function applyLook(pos: Vec3, pivot: Vec3, s: LookState, minY?: number): [number, number, number] {
  const vx = pos[0] - pivot[0];
  const vy = pos[1] - pivot[1];
  const vz = pos[2] - pivot[2];
  const r0 = Math.hypot(vx, vy, vz);
  if (r0 < 1e-6) return [pos[0], pos[1], pos[2]];

  const r = r0 * clamp(s.zoom, LOOK_LIMITS.zoomMin, LOOK_LIMITS.zoomMax);
  const azimuth = Math.atan2(vx, vz) + s.yaw;
  const elevation = clamp(Math.asin(clamp(vy / r0, -1, 1)) + s.pitch, -LOOK_LIMITS.maxElevation, LOOK_LIMITS.maxElevation);

  const horizontal = Math.cos(elevation) * r;
  let y = pivot[1] + Math.sin(elevation) * r;
  if (minY !== undefined) y = Math.max(minY, y);
  return [pivot[0] + Math.sin(azimuth) * horizontal, y, pivot[2] + Math.cos(azimuth) * horizontal];
}

/** Two touch points' distance, for pinch. */
export function pinchDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
