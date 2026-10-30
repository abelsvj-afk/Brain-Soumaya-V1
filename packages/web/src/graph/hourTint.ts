import type { HourBand } from "@brain/shared";
import type { WorldLightRig } from "./worldLighting.js";

/**
 * The world breathes with the Hours (living-worlds S5): each world's key light and fill lean gently toward the Hour you arrive in — rose at First Light, plain at Measure,
 * gold at Growing, amber at the Hearths, blue at Rest and deep blue while the Standing keep watch. Ambience only: it carries no information (never meaning by colour), changes no
 * rule, and is applied once when a world is built (no motion, nothing to calm under reduced motion). Kept subtle: a third of the way toward the tint, at most a quarter dimmer.
 */
export const HOUR_TINTS: Readonly<Record<HourBand, { color: number; light: number; fill: number }>> = {
  "first-light": { color: 0xffd2b8, light: 0.95, fill: 1.0 },
  measure: { color: 0xffffff, light: 1.0, fill: 1.0 },
  threshold: { color: 0xfff6e8, light: 1.05, fill: 1.0 },
  growing: { color: 0xffe2a8, light: 1.0, fill: 1.0 },
  hearths: { color: 0xffc890, light: 0.9, fill: 0.95 },
  rest: { color: 0xb8c8ff, light: 0.8, fill: 0.85 },
  standing: { color: 0xa8b8e8, light: 0.75, fill: 0.8 },
};

const TOWARD = 0.35;

function mix(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >> s) & 0xff;
  const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t) << s;
  return m(16) | m(8) | m(0);
}

/** The same rig, leaned toward the Hour. Pure. A rig with no key or fill is returned with only what it has. */
export function tintRigForHour(rig: WorldLightRig, band: HourBand): WorldLightRig {
  if (band === "measure") return rig; // the plain hour: the world as it was lit
  const t = HOUR_TINTS[band];
  return {
    env: rig.env,
    ...(rig.hemi ? { hemi: { sky: mix(rig.hemi.sky, t.color, TOWARD), ground: rig.hemi.ground, intensity: rig.hemi.intensity * t.fill } } : {}),
    ...(rig.key ? { key: { color: mix(rig.key.color, t.color, TOWARD), intensity: rig.key.intensity * t.light, from: rig.key.from } } : {}),
  };
}
