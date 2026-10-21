/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from "three";

/**
 * Living Galaxy (IM-140a): "completed tasks become satellites before merging
 * into planets." When the user completes a task (an action node), a small
 * satellite appears at the task's last position, orbits the nearest surviving
 * memory (its new planet), and after a short orbit spirals IN and merges
 * into that planet with a shrink — the task's work literally joins the body
 * of knowledge it served. Ephemeral visual only (the durable record of the
 * completion is the server's journey_mission_completions row, IM-140c).
 *
 * Orbit math is pure and unit-tested; the THREE shell is a thin shell over it.
 */

export const TASK_SATELLITE_ORBIT_SECONDS = 9;
export const TASK_SATELLITE_MERGE_SECONDS = 2.5;

export interface OrbitAnchor {
  x: number;
  y: number;
  z: number;
}

/** Position on the satellite's orbit around `anchor` at phase `angle` (rad). */
export function taskSatelliteOrbitPos(
  anchor: OrbitAnchor,
  radius: number,
  angle: number,
  tilt = 0.6,
): { x: number; y: number; z: number } {
  return {
    x: anchor.x + Math.cos(angle) * radius,
    y: anchor.y + Math.sin(angle * 0.9) * radius * Math.sin(tilt) * 0.4,
    z: anchor.z + Math.sin(angle) * radius,
  };
}

/** Lifecycle phase at age `t` seconds: orbiting, then merging, then gone. */
export function taskSatellitePhase(t: number): "orbit" | "merge" | "gone" {
  if (t < TASK_SATELLITE_ORBIT_SECONDS) return "orbit";
  if (t < TASK_SATELLITE_ORBIT_SECONDS + TASK_SATELLITE_MERGE_SECONDS) return "merge";
  return "gone";
}

/** Orbit radius shrinks during the merge phase (1 → 0 of the start radius). */
export function taskSatelliteRadiusFactor(t: number, startRadius: number): number {
  const phase = taskSatellitePhase(t);
  if (phase === "orbit") return startRadius;
  if (phase === "gone") return 0;
  const k = (t - TASK_SATELLITE_ORBIT_SECONDS) / TASK_SATELLITE_MERGE_SECONDS;
  return startRadius * (1 - k);
}

interface LiveSatellite {
  mesh: THREE.Mesh;
  anchor: OrbitAnchor; // live reference — planet objects move with the force graph
  angle: number;
  speed: number;
  radius: number;
  age: number;
  seed: number;
}

export interface TaskSatellites {
  group: THREE.Group;
  /** Spawn a satellite at `from`, orbiting `anchor` (a live node object). */
  spawn: (from: OrbitAnchor, anchor: OrbitAnchor) => void;
  update: (dt: number) => void;
  readonly count: number;
  dispose: () => void;
}

export function makeTaskSatellites(): TaskSatellites {
  const group = new THREE.Group();
  const live: LiveSatellite[] = [];
  const geo = new THREE.OctahedronGeometry(1.1);
  const mat = new THREE.MeshStandardMaterial({
    color: "#ffe9b0",
    emissive: new THREE.Color("#ffb347"),
    emissiveIntensity: 1.4,
    metalness: 0.4,
    roughness: 0.3,
  });

  const spawn = (from: OrbitAnchor, anchor: OrbitAnchor) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(from.x, from.y, from.z);
    group.add(mesh);
    const dx = from.x - anchor.x;
    const dz = from.z - anchor.z;
    const radius = Math.max(9, Math.min(26, Math.hypot(dx, dz) || 14));
    live.push({
      mesh,
      anchor,
      angle: Math.atan2(dz, dx) || 0,
      speed: 0.55 + (live.length % 5) * 0.07,
      radius,
      age: 0,
      seed: live.length * 1.7,
    });
  };

  const update = (dt: number) => {
    for (let i = live.length - 1; i >= 0; i--) {
      const s = live[i]!;
      s.age += dt;
      const phase = taskSatellitePhase(s.age);
      if (phase === "gone") {
        group.remove(s.mesh);
        live.splice(i, 1);
        continue;
      }
      s.angle += dt * s.speed;
      const r = taskSatelliteRadiusFactor(s.age, s.radius);
      const p = taskSatelliteOrbitPos(s.anchor, r, s.angle + s.seed);
      s.mesh.position.set(p.x, p.y, p.z);
      s.mesh.rotation.y += dt * 1.8;
      const shrink = phase === "merge" ? Math.max(0.15, r / s.radius) : 1;
      s.mesh.scale.setScalar(shrink);
    }
  };

  return {
    group,
    spawn,
    update,
    get count() {
      return live.length;
    },
    dispose: () => {
      for (const s of live) group.remove(s.mesh);
      live.length = 0;
      geo.dispose();
      mat.dispose();
    },
  };
}
