import type { WorldLightRig } from "./worldLighting.js";
import { LONG_SKY } from "./longScene.js";

/**
 * The look of each story world — light, background, fog and where the camera looks — as plain data (docs/specs/worlds-redesign-2026-11-14.md). It lives outside the host so a world's
 * mood can be tuned (and previewed, and tested) without touching the 3,000-line surface component. A world's mood is light + fog + palette; the scene supplies the shapes.
 *
 * Rule of thumb used below: the fill is LOW and cool, the key is warm and comes from one side, and the scene's own lamps do the rest. An evenly lit world has no shape.
 */
export interface WorldMood {
  light: WorldLightRig;
  background: number;
  fogDensity: number;
  lookAtY: number;
  /** false = this world keeps its own sky (no shared starfield). */
  sky?: boolean;
}

export const WORLD_MOOD: Readonly<Record<string, WorldMood>> = {
  // Quiet/Archive: still water under a cold night. Low, even, nothing warm but the resting lamps.
  "quiet-archive": {
    light: { env: 0.55, hemi: { sky: 0x8fb0cc, ground: 0x0c1218, intensity: 0.7 }, key: { color: 0xbfd4ee, intensity: 0.5, from: [-400, 300, -500] } },
    background: 0x0d1117,
    fogDensity: 0.00042,
    lookAtY: 0,
  },
  // The People: dusk over warm earth; the hearths are the light.
  people: {
    light: { env: 0.35, hemi: { sky: 0xe0a070, ground: 0x2a1a10, intensity: 0.75 }, key: { color: 0xff9a58, intensity: 0.9, from: [-600, 160, -300] } },
    background: 0x1a120c,
    fogDensity: 0.00042,
    lookAtY: 0,
  },
  "faded-ward": {
    // After the lore paintings: warm lantern light on pale weathered walls, cold starlight only at the windows, mist on the floor.
    light: { env: 0.25, hemi: { sky: 0xb0a890, ground: 0x1a1612, intensity: 0.75 }, key: { color: 0x9db8ee, intensity: 0.5, from: [-300, 420, 200] } },
    background: 0x0a0c0c,
    fogDensity: 0.0011,
    lookAtY: 42,
  },
  "road-to-the-seam": {
    light: { env: 0.18, hemi: { sky: 0x5c6a8c, ground: 0x14161c, intensity: 0.5 }, key: { color: 0x9db4e0, intensity: 0.9, from: [-300, 500, -260] } },
    background: 0x07090e,
    fogDensity: 0.0011,
    lookAtY: 38,
  },
  "the-village": {
    light: { env: 0.5, hemi: { sky: 0x9aaac8, ground: 0x1c2420, intensity: 0.9 }, key: { color: 0xffd9a0, intensity: 0.9, from: [-200, 420, 300] } },
    background: 0x0a0e14,
    fogDensity: 0.0003,
    lookAtY: 40,
  },
  "the-unmade-hour": {
    light: { env: 0.7, hemi: { sky: 0xb8b4d8, ground: 0x3a3648, intensity: 1.0 }, key: { color: 0xf0e8ff, intensity: 1.0, from: [-150, 400, 200] } },
    background: 0x14121e,
    fogDensity: 0.0004,
    lookAtY: 30,
  },
  "the-siege": {
    light: { env: 0.8, hemi: { sky: 0xd8d4e8, ground: 0x4a4638, intensity: 1.0 }, key: { color: 0xfff0d0, intensity: 1.1, from: [-200, 420, 260] } },
    background: 0x1a1620,
    fogDensity: 0.0004,
    lookAtY: 24,
  },
  "the-yard": {
    light: { env: 0.8, hemi: { sky: 0xb8c0d8, ground: 0x4a4238, intensity: 1.0 }, key: { color: 0xffe8c8, intensity: 1.1, from: [-220, 400, 200] } },
    background: 0x12141c,
    fogDensity: 0.0004,
    lookAtY: 26,
  },
  "the-long-morning": {
    light: { env: 1.0, hemi: { sky: 0xfff4d8, ground: 0xe8cc90, intensity: 1.0 }, key: { color: 0xfff6e0, intensity: 0.8, from: [-200, 400, 220] } },
    background: LONG_SKY,
    fogDensity: 0.0011,
    lookAtY: 40,
    sky: false,
  },
  "the-folded-letter": {
    light: { env: 0.4, hemi: { sky: 0x8890a8, ground: 0x4a3f34, intensity: 0.7 }, key: { color: 0xffd9a0, intensity: 0.8, from: [-60, 300, 120] } },
    background: 0x0a0a10,
    fogDensity: 0.0003,
    lookAtY: 14,
  },
};
