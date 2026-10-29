import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import { buildHygStarfield } from "./hygStars.js";
import { buildGate } from "./gateScene.js";
import { loadSoumayaShip } from "./soumayaShip.js";

/**
 * Transit scene (Phase 2, P2-5) — the space you fly through between
 * worlds. Her ship, visible in chase, flies from the departure gate to
 * the arrival gate over the transit duration; the HYG sky is the same
 * real data as the Station's. Warp is fast and rich (streaks, motion);
 * drift is slow and plain (no streaks, steady ship) — both arrive, both
 * are dignified (D-1). Reduced motion holds the corridor: no streaks,
 * no bobbing, same duration, same arrival.
 *
 * The ship is HER ship — `soumaya-ship.glb`, loaded through the same
 * `loadSoumayaShip()` treatment as the home galaxy (blue-steel tint,
 * cyan sheen, scaled to a 12-unit forward length, nose at −z down the
 * corridor). The procedural hull below is the load-failure fallback
 * only: it renders until the GLB lands, and stays if the load fails.
 * Provenance: "Intergalactic Spaceship Version 2" by 3DHaupt (Dennis
 * Haupt), CC-BY-NC (non-commercial use only) — identified from the
 * file itself; before any commercial use of the worlds the hero must
 * be replaced with the verified CC-BY-4.0 fallback
 * (`organic-spaceship.glb`). Full record in the P2-6 provenance
 * inventory and `public/CREDITS.md`.
 *
 * No reflection content in the MVP (review 28, Q2): HYG stars and motion
 * only. The §2.2 reflection allowance stays a future option, not built
 * here.
 *
 * Draw-call sketch (ceiling 40): sky 1 · ship 10 · gates 6 · streaks 1 =
 * 18. Tris: ship 37,026 · gates ~7k · streaks ~1.4k — ~45k, far inside
 * the 150k ceiling. Runtime measurement belongs to the device check
 * (C4's measured half); these constants are the static half.
 */

export const TRANSIT_BUDGET = { maxDrawCalls: 40, maxTris: 150_000 };
export const TRANSIT_LENGTH = 1100;
export const TRANSIT_STREAK_COUNT = 120;

export type TransitKind = "warp" | "drift";

export interface TransitScene {
  group: THREE.Group;
  /** The latest camera/overlay state (fov, shake, flash, blur, phase, countdown) — the host applies it. */
  view: TransitView;
  update: (elapsedMs: number, opts?: { reducedMotion?: boolean }) => void;
  dispose: () => void;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The procedural ship: fuselage + wings + engine glow, her colors.
 *  The load-failure fallback — the holder is named "transit-ship",
 *  this child is named for what it is. */
export function buildProceduralShip(): THREE.Group {
  const ship = new THREE.Group();
  ship.name = "transit-ship-procedural";
  const hullMat = new THREE.MeshStandardMaterial({
    color: 0xc2d4f5,
    emissive: 0x7af9ff,
    emissiveIntensity: 0.15,
    metalness: 0.55,
    roughness: 0.4,
  });
  const fuselage = new THREE.Mesh(new THREE.OctahedronGeometry(3, 0), hullMat);
  fuselage.name = "ship-fuselage";
  fuselage.scale.set(1, 0.55, 3.2);
  fuselage.rotation.x = Math.PI / 2;
  ship.add(fuselage);
  const wingMat = new THREE.MeshStandardMaterial({
    color: 0x9fb4d8,
    metalness: 0.55,
    roughness: 0.45,
  });
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(7, 0.35, 2.6), wingMat);
    wing.name = `ship-wing-${side < 0 ? "port" : "starboard"}`;
    wing.position.set(side * 4.2, -0.4, 2.2);
    wing.rotation.z = side * -0.12;
    ship.add(wing);
  }
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(1.1, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0x7af9ff }),
  );
  glow.name = "ship-engine-glow";
  glow.position.set(0, 0, 9.2);
  ship.add(glow);
  return ship;
}

/** Soft radial glow (computed, no canvas — builds where there is no DOM). */
function glowTexture(): THREE.Texture {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.min(1, Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2));
      const a = Math.pow(1 - d, 2.2);
      const o = (y * n + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = 255;
      data[o + 3] = Math.round(255 * a);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * The EVE-style departure (docs/specs/eve-travel-2026-10-29.md). The server's
 * cancel window (`armMs`, 10 s) is drawn as the cinematic:
 *   ALIGN  (first 60 %)  the ship turns slowly from the origin gate to face
 *                        the destination beacon;
 *   SPOOL  (last 40 %)   countdown; the engines ramp white → amber → deep red,
 *                        the camera gathers (FOV narrows, a faint shudder);
 *   JUMP                 the instant the server flips to in_transit: a flash,
 *                        FOV kick, streaks accelerate from standstill;
 *   CRUISE               streaks stretched by speed, edge blur;
 *   ARRIVE (last 1.5 s)  deceleration; streaks collapse back to stars.
 * Everything below is a pure function of the clock, so it is testable and a
 * reload resumes mid-sequence. Drift keeps the same align/spool but stays calm
 * (no flash, no blur, no FOV kick) — dignified, per D-1.
 */
export const ALIGN_FRACTION = 0.6;
export const ALIGN_START_YAW = 1.9;
export const WARP_JUMP_MS = 1200;
export const WARP_DECEL_MS = 1500;
export const DRIFT_JUMP_MS = 3000;
export const DRIFT_DECEL_MS = 4000;
export const BASE_FOV = 55;
export const WARP_FOV_KICK = 22;
export const FLASH_MS = 500;
/** How far past the ship (toward the camera) the destination gate ends up: it flies over her. */
export const ARRIVAL_THROUGH = 60;

export type TransitPhase = "align" | "spool" | "jump" | "cruise" | "arrive";

export interface TransitView {
  phase: TransitPhase;
  /** Ship heading offset (radians about y): ALIGN_START_YAW → 0 as it lines up. */
  yaw: number;
  /** 0..1 engine heat: 0.12 idle, rising through the spool to 1 (white → amber → red). */
  engine: number;
  fov: number;
  /** Camera shudder amplitude, world units. */
  shake: number;
  /** 0..1 white flash at the jump. */
  flash: number;
  /** 0..1 edge blur / vignette strength. */
  blur: number;
  /** 0..1 flight speed (streak scroll and stretch). */
  speed: number;
  /** Gentle roll (radians) while the ship swings round — a turn that leans, not a spin on a post. */
  bank: number;
  /** Whole seconds left in the cancel window while arming, else null. */
  countdown: number | null;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeInOut = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/** Flight speed 0..1 at `f` ms after the jump: a ramp up, cruise, a ramp down. */
export function flightSpeed(f: number, kind: TransitKind, totalMs: number): number {
  if (f <= 0 || f >= totalMs) return 0;
  const up = kind === "warp" ? WARP_JUMP_MS : DRIFT_JUMP_MS;
  const down = kind === "warp" ? WARP_DECEL_MS : DRIFT_DECEL_MS;
  return clamp01(easeInOut(f / up) * easeInOut((totalMs - f) / down));
}

/** Distance covered (in speed·ms) by `f` ms into the flight — what the streaks scroll by. */
export function flightDistance(f: number, kind: TransitKind, totalMs: number): number {
  const end = Math.min(Math.max(f, 0), totalMs);
  const step = 40;
  let d = 0;
  for (let t = 0; t < end; t += step) d += flightSpeed(t + step / 2, kind, totalMs) * Math.min(step, end - t);
  return d;
}

export function transitTimeline(
  elapsedMs: number,
  o: { kind: TransitKind; totalMs: number; armMs: number; reducedMotion?: boolean },
): TransitView {
  const { kind, totalMs, armMs } = o;
  const reduced = o.reducedMotion ?? false;
  const t = Math.max(0, elapsedMs);
  if (armMs > 0 && t < armMs) {
    const alignEnd = armMs * ALIGN_FRACTION;
    const spooling = t >= alignEnd;
    const spool = spooling ? clamp01((t - alignEnd) / (armMs - alignEnd)) : 0;
    return {
      phase: spooling ? "spool" : "align",
      // Reduced motion: no sweep — it simply faces its heading from the start.
      yaw: reduced ? 0 : ALIGN_START_YAW * (1 - easeInOut(t / alignEnd)),
      engine: 0.12 + 0.88 * spool,
      fov: reduced ? BASE_FOV : BASE_FOV - 7 * spool,
      shake: reduced ? 0 : 0.35 * spool * spool,
      flash: 0,
      blur: 0,
      speed: 0,
      bank: reduced || spooling ? 0 : -0.28 * Math.sin(Math.PI * clamp01(t / alignEnd)),
      countdown: Math.ceil((armMs - t) / 1000),
    };
  }
  const f = t - armMs;
  const speed = flightSpeed(f, kind, totalMs);
  const warp = kind === "warp";
  const decel = warp ? WARP_DECEL_MS : DRIFT_DECEL_MS;
  const jump = warp ? WARP_JUMP_MS : DRIFT_JUMP_MS;
  const phase: TransitPhase = f < jump ? "jump" : f > totalMs - decel ? "arrive" : "cruise";
  return {
    phase,
    yaw: 0,
    // Red-hot through the jump, then it cools as the ship slows (a settled hull is not a burning one).
    engine: warp ? (f < jump ? 1 : Math.max(0.12, speed)) : 0.45,
    fov: reduced || !warp ? BASE_FOV : BASE_FOV + WARP_FOV_KICK * speed,
    shake: reduced || !warp ? 0 : 0.25 * speed,
    flash: reduced || !warp ? 0 : clamp01(1 - f / FLASH_MS),
    blur: reduced || !warp ? 0 : 0.85 * speed,
    speed,
    bank: 0,
    countdown: null,
  };
}

export function createTransitScene(opts: {
  kind: TransitKind;
  totalMs: number;
  origin: string;
  destination: string;
  /** The cancel window drawn as the align/spool cinematic (0 = none: the flight starts at t=0). */
  armMs?: number;
}): TransitScene {
  const { kind, totalMs, origin, destination } = opts;
  const armMs = opts.armMs ?? 0;
  const group = new THREE.Group();
  group.name = `transit-${kind}`;

  // The sky: stars + both gates + the destination beacon turn together around the ship. The ship holds
  // its heading (nose down −z) and the SKY swings round while she aligns — at the start the origin gate is
  // dead ahead, and it sweeps away as the destination beacon comes round to the centre (the EVE look, and
  // it works on a narrow portrait screen, where a ship turning against a fixed sky would hide the gate).
  const backdrop = new THREE.Group();
  backdrop.name = "transit-backdrop";
  group.add(backdrop);
  backdrop.add(buildHygStarfield());

  const ambient = new THREE.AmbientLight(0x8899bb, 0.7);
  group.add(ambient);
  const key = new THREE.DirectionalLight(0xdfe8ff, 1.1);
  key.position.set(60, 120, 80);
  group.add(key);

  const ship = new THREE.Group();
  ship.name = "transit-ship";
  const proceduralShip = buildProceduralShip();
  // The stand-in is modelled larger than her real hull (12 units long); match it so the swap doesn't jump.
  proceduralShip.scale.setScalar(0.6);
  ship.add(proceduralShip);
  group.add(ship);
  // The engines' heat, independent of which hull is loaded: an additive glow
  // behind the tail whose colour and size ramp white → amber → deep red.
  const engineGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), color: 0x9fe8ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  );
  engineGlow.name = "engine-glow";
  engineGlow.position.set(0, 0, 7.5);
  engineGlow.scale.setScalar(8);
  ship.add(engineGlow);
  // Her ship swaps in when the GLB lands; the procedural hull stays
  // until then (and forever, if the load fails) — the proxy pattern.
  let disposed = false;
  void loadSoumayaShip().then((hero) => {
    if (!hero || disposed) {
      if (hero) disposeObject3D(hero);
      return;
    }
    ship.remove(proceduralShip);
    disposeObject3D(proceduralShip);
    ship.add(hero);
  });

  const departureGate = buildGate(origin);
  // With an arming cinematic the origin gate stands ALIGN_START_YAW round from the destination, 260 out —
  // dead ahead at the start (backdrop turned by −yaw); without one it sits astern as before.
  const DEP =
    armMs > 0
      ? { x: -260 * Math.sin(ALIGN_START_YAW), y: 0, z: -260 * Math.cos(ALIGN_START_YAW) }
      : { x: 0, y: 0, z: 40 };
  departureGate.group.position.set(DEP.x, DEP.y, DEP.z);
  backdrop.add(departureGate.group);
  const arrivalGate = buildGate(destination);
  arrivalGate.group.position.set(0, 0, -TRANSIT_LENGTH);
  backdrop.add(arrivalGate.group);
  // The destination beacon: a bright mark the ship lines up on, riding with the gate.
  const beacon = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff2cc, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  );
  beacon.name = "destination-beacon";
  beacon.scale.setScalar(140);
  arrivalGate.group.add(beacon);

  // Warp streaks: instanced bars streaming past the ship. Drift and
  // reduced motion never show them — the corridor stays calm.
  const streakGeo = new THREE.BoxGeometry(0.6, 0.6, 30);
  const streakMat = new THREE.MeshBasicMaterial({
    color: 0xbfe6ff,
    transparent: true,
    opacity: 0.55,
  });
  const streaks = new THREE.InstancedMesh(streakGeo, streakMat, TRANSIT_STREAK_COUNT);
  streaks.name = "transit-streaks";
  const rand = mulberry32(0x2a5f);
  const streakBase: { x: number; y: number; z: number; speed: number }[] = [];
  for (let i = 0; i < TRANSIT_STREAK_COUNT; i++) {
    const r = 120 + rand() * 700;
    const a = rand() * Math.PI * 2;
    streakBase.push({
      x: Math.cos(a) * r,
      y: Math.sin(a) * r,
      z: 100 - rand() * (TRANSIT_LENGTH + 200),
      speed: 0.9 + rand() * 0.6,
    });
  }
  const dummy = new THREE.Object3D();
  const placeStreaks = (distance: number, speed: number) => {
    // Streaks stretch with speed: at a standstill they are stars, at full warp long bars.
    const stretch = 0.3 + speed * 9;
    for (let i = 0; i < TRANSIT_STREAK_COUNT; i++) {
      const s = streakBase[i];
      if (!s) continue;
      // Stream +z past the ship; recycle to the far end (deterministic:
      // position is a pure function of the distance flown).
      const span = TRANSIT_LENGTH + 300;
      const z = (((s.z + distance * 0.55 * s.speed + 100) % span) + span) % span - 100;
      dummy.position.set(s.x, s.y, -z);
      dummy.scale.set(1, 1, stretch);
      dummy.updateMatrix();
      streaks.setMatrixAt(i, dummy.matrix);
    }
    streaks.instanceMatrix.needsUpdate = true;
  };
  placeStreaks(0, 0);
  streaks.visible = false; // appears once the ship jumps (update)
  group.add(streaks);

  const view = transitTimeline(0, { kind, totalMs, armMs });
  const engineColors = [new THREE.Color(0x9fe8ff), new THREE.Color(0xffb040), new THREE.Color(0xff1a0a)];
  const tmpColor = new THREE.Color();

  return {
    group,
    view,
    update: (elapsedMs: number, opts?: { reducedMotion?: boolean }) => {
      if (disposed) return;
      const reducedMotion = opts?.reducedMotion ?? false;
      Object.assign(view, transitTimeline(elapsedMs, { kind, totalMs, armMs, reducedMotion }));
      const f = Math.max(0, elapsedMs - armMs);
      const p = Math.min(1, f / Math.max(1, totalMs));
      const D = flightDistance(f, kind, totalMs);
      // The sky swings round the holding ship (see `backdrop`); the ship leans into the turn.
      backdrop.rotation.y = -view.yaw;
      ship.rotation.y = 0;
      // Engine heat: white → amber → red, and a bigger, brighter glow as it spools.
      const h = view.engine;
      if (h < 0.5) tmpColor.copy(engineColors[0]!).lerp(engineColors[1]!, h / 0.5);
      else tmpColor.copy(engineColors[1]!).lerp(engineColors[2]!, (h - 0.5) / 0.5);
      (engineGlow.material as THREE.SpriteMaterial).color.copy(tmpColor);
      // Heat reads from colour first, size second — a full-spool glow is a bright halo at the tail, not a wash over the screen.
      engineGlow.scale.setScalar(5 + 6 * h);
      (engineGlow.material as THREE.SpriteMaterial).opacity = 0.55 + 0.35 * h;
      // The origin gate whips away astern once the ship jumps.
      if (armMs === 0) departureGate.group.position.z = DEP.z + p * 260 + (D / 1000) * 400;
      if (armMs > 0) {
        // The destination gate closes by distance flown, so it slows as the ship does, and finally sweeps
        // over her and past the chase camera — the hand-over to the world happens inside it.
        arrivalGate.group.position.z = -TRANSIT_LENGTH + (D / Math.max(1, flightDistance(totalMs, kind, totalMs))) * (TRANSIT_LENGTH + ARRIVAL_THROUGH);
      } else {
        arrivalGate.group.position.z = -TRANSIT_LENGTH + p * (TRANSIT_LENGTH - 20);
      }
      if (kind === "warp" && !reducedMotion) {
        placeStreaks(D, view.speed);
        ship.position.y = Math.sin(elapsedMs * 0.0012) * 0.8;
        ship.rotation.z = Math.sin(elapsedMs * 0.0006) * 0.02 + view.bank;
      } else {
        ship.position.y = 0;
        ship.rotation.z = reducedMotion ? 0 : view.bank;
      }
      streaks.visible = kind === "warp" && !reducedMotion && view.speed > 0.01;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      // disposeObject3D traverses the whole group, gates included.
      disposeObject3D(group);
    },
  };
}
