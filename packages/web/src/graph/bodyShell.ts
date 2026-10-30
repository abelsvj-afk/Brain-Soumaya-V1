import type { V3 } from "./worldFlight.js";

/**
 * Planets you can approach but never reach (EVE-style; owner 2026-10-31: "you can look like you're approaching it, but you'll just endlessly fly towards it"). Each big body keeps an
 * invisible shell round it; a ship (or any target point) that would end inside is pushed back out to the shell, so the planet grows on screen as you close in and then simply stops
 * growing — never the blurry close-up, never the surface. Pure maths.
 */
export interface Shell {
  center: V3;
  radius: number;
}

/** How many radii from a body's centre you can come at the very closest. */
export const SHELL_FACTOR = 1.6;

/** Project `p` out of every shell it is inside (pushed straight away from that centre, onto the shell). Outside every shell it is returned unchanged. */
export function pushOutOfShells(p: V3, shells: readonly Shell[], factor: number = SHELL_FACTOR): V3 {
  let out: V3 = p;
  for (const s of shells) {
    const dx = out[0] - s.center[0];
    const dy = out[1] - s.center[1];
    const dz = out[2] - s.center[2];
    const d = Math.hypot(dx, dy, dz);
    const min = s.radius * factor;
    if (d >= min) continue;
    if (d < 1e-6) out = [s.center[0], s.center[1], s.center[2] + min];
    else {
      const k = min / d;
      out = [s.center[0] + dx * k, s.center[1] + dy * k, s.center[2] + dz * k];
    }
  }
  return out;
}

/** Is `p` inside any shell? */
export function insideShell(p: V3, shells: readonly Shell[], factor: number = SHELL_FACTOR): boolean {
  return shells.some((s) => Math.hypot(p[0] - s.center[0], p[1] - s.center[1], p[2] - s.center[2]) < s.radius * factor - 1e-6);
}
