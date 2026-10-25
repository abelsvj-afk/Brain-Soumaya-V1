import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import { buildHygStarfield } from "./hygStars.js";
import { buildGate } from "./gateScene.js";

/**
 * Transit scene (Phase 2, P2-5) — the space you fly through between
 * worlds. Her ship, visible in chase, flies from the departure gate to
 * the arrival gate over the transit duration; the HYG sky is the same
 * real data as the Station's. Warp is fast and rich (streaks, motion);
 * drift is slow and plain (no streaks, steady ship) — both arrive, both
 * are dignified (D-1). Reduced motion holds the corridor: no streaks,
 * no bobbing, same duration, same arrival.
 *
 * The ship is the procedural hull, tinted the way the home galaxy tints
 * her (blue-steel body, cyan sheen). The `soumaya-ship.glb` is NOT
 * loaded here: its license is unconfirmed (author 3DHaupt/Dennis Haupt
 * per the file's own copyright; his Sketchfab works are typically
 * CC-BY-NC / CC-BY-NC-ND; the shipped file was recompressed and
 * re-tinted, i.e. modified) and no credit line exists for it — see the
 * P2-5 audit brief. The procedural hull is the design's own fallback,
 * and the GLB stays out of transit until provenance clears. This scene
 * newly distributes nothing.
 *
 * No reflection content in the MVP (review 28, Q2): HYG stars and motion
 * only. The §2.2 reflection allowance stays a future option, not built
 * here.
 *
 * Draw-call sketch (ceiling 40): sky 1 · ship 4 · gates 6 · streaks 1 =
 * 12. Tris: ship ~500 · gates ~7k · streaks ~1.4k — far inside the
 * 150k ceiling. Runtime measurement belongs to the device check (C4's
 * measured half); these constants are the static half.
 */

export const TRANSIT_BUDGET = { maxDrawCalls: 40, maxTris: 150_000 };
export const TRANSIT_LENGTH = 1100;
export const TRANSIT_STREAK_COUNT = 120;

export type TransitKind = "warp" | "drift";

export interface TransitScene {
  group: THREE.Group;
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

/** The procedural ship: fuselage + wings + engine glow, her colors. */
function buildProceduralShip(): THREE.Group {
  const ship = new THREE.Group();
  ship.name = "transit-ship";
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

export function createTransitScene(opts: {
  kind: TransitKind;
  totalMs: number;
  origin: string;
  destination: string;
}): TransitScene {
  const { kind, totalMs, origin, destination } = opts;
  const group = new THREE.Group();
  group.name = `transit-${kind}`;

  group.add(buildHygStarfield());

  const ambient = new THREE.AmbientLight(0x8899bb, 0.7);
  group.add(ambient);
  const key = new THREE.DirectionalLight(0xdfe8ff, 1.1);
  key.position.set(60, 120, 80);
  group.add(key);

  const ship = buildProceduralShip();
  group.add(ship);

  const departureGate = buildGate(origin);
  departureGate.group.position.set(0, 0, 40);
  group.add(departureGate.group);
  const arrivalGate = buildGate(destination);
  arrivalGate.group.position.set(0, 0, -TRANSIT_LENGTH);
  group.add(arrivalGate.group);

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
  const placeStreaks = (elapsedMs: number) => {
    for (let i = 0; i < TRANSIT_STREAK_COUNT; i++) {
      const s = streakBase[i];
      if (!s) continue;
      // Stream +z past the ship; recycle to the far end (deterministic:
      // position is a pure function of elapsed time).
      const span = TRANSIT_LENGTH + 300;
      const z = (((s.z + elapsedMs * 0.55 * s.speed + 100) % span) + span) % span - 100;
      dummy.position.set(s.x, s.y, -z);
      dummy.updateMatrix();
      streaks.setMatrixAt(i, dummy.matrix);
    }
    streaks.instanceMatrix.needsUpdate = true;
  };
  placeStreaks(0);
  streaks.visible = kind === "warp";
  group.add(streaks);

  let disposed = false;
  return {
    group,
    update: (elapsedMs: number, opts?: { reducedMotion?: boolean }) => {
      if (disposed) return;
      const reducedMotion = opts?.reducedMotion ?? false;
      const p = Math.min(1, Math.max(0, elapsedMs / Math.max(1, totalMs)));
      // The ship holds station; the gates travel. Departure recedes
      // behind, arrival approaches from the far end.
      departureGate.group.position.z = 40 + p * 260;
      arrivalGate.group.position.z = -TRANSIT_LENGTH + p * (TRANSIT_LENGTH - 20);
      if (kind === "warp" && !reducedMotion) {
        placeStreaks(elapsedMs);
        ship.position.y = Math.sin(elapsedMs * 0.0012) * 0.8;
        ship.rotation.z = Math.sin(elapsedMs * 0.0006) * 0.02;
      } else {
        ship.position.y = 0;
        ship.rotation.z = 0;
      }
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      // disposeObject3D traverses the whole group, gates included.
      disposeObject3D(group);
    },
  };
}
