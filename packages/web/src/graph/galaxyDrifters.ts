import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import { gltfLoader, noteModelFallback } from "./gltf.js";
import {
  mergeToSingleMaterial,
  recenterGeometry,
  scaleGeometryToSize,
} from "./stationAssets.js";

/**
 * Galaxy drifters (population increment refinement, owner 2026-10-27) —
 * six benign visitors drifting through the brain galaxy. Space is
 * space: things CAN float through someone's individual galaxy too.
 * But bounded, so they can actually be seen: in a populated mind full
 * of memories, something passing through fast would go unnoticed.
 *
 * The rules, as designed:
 * - SLOW: a crossing takes minutes, not seconds; a loop takes 10–14
 *   minutes. At galaxy scale that reads as a slow passing thing.
 * - BOUNDED: loops and crossings stay inside the camera's reachable
 *   view volume (radius ≤ 2,200 — inside the visitors' 2,400 despawn
 *   shell), never a fly-by that leaves. The crossing chords are routed
 *   clear of the Sun (closest approach ~950–1,000 units; the Sun's
 *   solid body reaches 600) — a drifter never flies through the Sun.
 *   The chords do cross the node-orbit shells — any bounded path
 *   through the galaxy must — but they never ride an orbit, never stop
 *   at a node, and carry no interaction, so they cannot read as nodes.
 * - SPARSE: six total, spread on different radii, planes, and phases
 *   — at most one or two in view at once, never crowding the memories.
 * - Never memories: no labels, no click-to-open, no lore panels, no
 *   scores, no visits. They carry no interaction at all, and they ride
 *   their own slow paths — NOT the orbit system (orbits.ts is Red Zone
 *   load-bearing; untouched). Reduced motion holds them still.
 * - All six but one merge to one material (1 call each = 6 calls,
 *   5,082 tris). The exception is the nebula traveller: a translucent
 *   morphing cloud, loaded as-is so its glass and its morph clip
 *   survive — merging it to grey would kill the sight, and the merge
 *   would destroy the morph targets.
 *
 * Naming, kept distinct on purpose:
 * - These are "galaxy drifters" / "visitors" — benign passers-through.
 * - `visitors.ts` is a DIFFERENT system: roaming craft that visit
 *   memories (onVisit callbacks, the FAB, jump-to-visitor). These
 *   drifters never visit a memory and never appear in that system.
 * - `fleet.ts` has hostile "drifters" the Defender intercepts. These
 *   are not those either — nothing here is intercepted, feared, or
 *   fled from. The three concepts share a word and nothing else.
 *
 * Budget: the galaxy has no fixed draw-call ceiling like the worlds
 * do — its cost scales with the brain's node/link counts through
 * instanced meshes. Six extra meshes is within noise; there is no
 * ceiling to blow. If a ceiling ever lands, these six are the first
 * cut, in this priority order: alien, astronaut, ufo, asteroid_small,
 * comet, nebula-traveller — the cloud is cut last, because it is the
 * only living cloud in the galaxy.
 *
 * Loads resolve null + diagnostics note until the GLBs land (the
 * browser upload, after the code push) — never a procedural stand-in,
 * never a crash.
 */

export const GALAXY_DRIFTER_SEED = "galaxy / drifters-1";

/** Pale grey — the Kenney treatment: form reads in a busy galaxy, per-material accents would be noise. */
export const GALAXY_DRIFTER_COLOR = 0xd5d8e0;

export type GalaxyDrifterSpec =
  | {
      kind: "loop";
      key: string;
      name: string;
      url: string;
      tris: number;
      /** Longest side once placed, in galaxy units — small, clearly a visitor. */
      size: number;
      /** Center of the loop. */
      center: readonly [number, number, number];
      /** Loop radius — bounded inside the reachable view volume. */
      radius: number;
      /** Vertical bob amplitude (the loop is a tilted circle, not a flat ring). */
      bob: number;
      /** Full loop, in ms — minutes, never seconds. */
      periodMs: number;
      /** +1 counter-clockwise, −1 clockwise. */
      direction: 1 | -1;
      /** Phase offset in radians — staggers the drifters around their paths. */
      phase: number;
      /** Start offset in ms — staggers the drifters along their paths. */
      offsetMs: number;
      /** Load as-is instead of merging to one material — only the
       * nebula traveller, whose glass and morph clip the merge would
       * destroy. Absent means "merge". */
      asIs?: boolean;
    }
  | {
      kind: "crossing";
      key: string;
      name: string;
      url: string;
      tris: number;
      /** Longest side once placed, in galaxy units — small, clearly a visitor. */
      size: number;
      /** The chord's start. */
      from: readonly [number, number, number];
      /** The chord's end. */
      to: readonly [number, number, number];
      /** Full round trip, in ms — one crossing takes half of this, in minutes. */
      periodMs: number;
      /** Start offset in ms — staggers the drifters along their paths. */
      offsetMs: number;
      /** Load as-is instead of merging to one material. Absent means "merge". */
      asIs?: boolean;
    };

/** The six drifters, in drop priority order (alien, astronaut, ufo, asteroid_small, comet, nebula-traveller). */
export const GALAXY_DRIFTER_SPECS: readonly GalaxyDrifterSpec[] = [
  {
    kind: "loop",
    key: "alien",
    name: "Alien",
    url: "/lowpoly-alien.glb",
    tris: 144,
    size: 8,
    center: [0, 80, 0],
    radius: 1500,
    bob: 120,
    periodMs: 600_000, // one slow loop every 10 minutes
    direction: 1,
    phase: 0.7,
    offsetMs: 0,
  },
  {
    kind: "crossing",
    key: "astronaut",
    name: "Astronaut",
    url: "/lowpoly-astronaut.glb",
    tris: 128,
    size: 8,
    // A high crossing, routed clear of the Sun: closest approach to
    // the center is ~1,000 units (the Sun's solid body reaches 600).
    from: [1500, 900, 1000],
    to: [-1500, 1100, -1000],
    periodMs: 840_000, // one crossing every 7 minutes
    offsetMs: 210_000,
  },
  {
    kind: "loop",
    key: "ufo",
    name: "UFO",
    url: "/lowpoly-ufo.glb",
    tris: 304,
    size: 12,
    center: [0, -100, 0],
    radius: 1800,
    bob: 150,
    periodMs: 720_000, // one slow loop every 12 minutes
    direction: -1,
    phase: 2.4,
    offsetMs: 0,
  },
  {
    kind: "crossing",
    key: "asteroid_small",
    name: "Small asteroid",
    url: "/lowpoly-asteroid_small.glb",
    tris: 20,
    size: 10,
    // A low crossing, routed clear of the Sun: closest approach to
    // the center is ~950 units (the Sun's solid body reaches 600).
    from: [-1600, -1000, -500],
    to: [1600, -900, 500],
    periodMs: 720_000, // one crossing every 6 minutes
    offsetMs: 360_000,
  },
  {
    kind: "crossing",
    key: "comet",
    name: "Comet",
    url: "/pp-comet.glb",
    tris: 518,
    size: 10,
    // A high crossing, routed clear of the astronaut's chord (326
    // units apart at their closest) and of the Sun (closest approach
    // to the center ~1,325 units). One crossing every 7.5 minutes.
    from: [1500, 1250, 700],
    to: [-1450, 1400, -650],
    periodMs: 900_000, // one crossing every 7.5 minutes
    offsetMs: 450_000,
  },
  {
    kind: "loop",
    key: "nebula-traveller",
    name: "Nebula traveller",
    url: "/sf-nebula-traveller.glb",
    tris: 3968,
    size: 10,
    // A high slow loop, above the alien's and UFO's loops and clear of
    // every crossing chord (verified numerically: across a full
    // 12-minute sample every pair of drifters stays 338+ units apart,
    // and the traveller's own loop peaks at 1,268 units — inside the
    // 2,200 bound). One loop every 14 minutes; 10 seconds of travel
    // ≈ 75 units. Loaded as-is: its translucent glass and its
    // "MorphBake" morph clip are the sight, and the merge would
    // destroy both.
    center: [0, 700, 0],
    radius: 1000,
    bob: 80,
    periodMs: 840_000, // one slow loop every 14 minutes
    direction: -1,
    phase: 4.0,
    offsetMs: 0,
    asIs: true,
  },
];

/** Draw calls the drifters add once loaded: one merged mesh each. */
export const GALAXY_DRIFTER_DRAW_CALLS = GALAXY_DRIFTER_SPECS.length;
/** Measured triangles across the five drifters. */
export const GALAXY_DRIFTER_TRIS_TOTAL = GALAXY_DRIFTER_SPECS.reduce((n, s) => n + s.tris, 0);

/**
 * A drifter's pose at an elapsed time — a pure function of elapsed
 * time (deterministic, like the docking shuttle). Loops run their
 * tilted circle; crossings ping-pong along their chord, so they stay
 * bounded instead of flying out of the galaxy.
 */
export function galaxyDrifterPose(
  spec: GalaxyDrifterSpec,
  elapsedMs: number,
): { position: [number, number, number]; rotationY: number } {
  const t = elapsedMs + spec.offsetMs;
  if (spec.kind === "loop") {
    const angle = spec.phase + (t / spec.periodMs) * Math.PI * 2 * spec.direction;
    const [cx, cy, cz] = spec.center;
    // Facing along the loop's tangent: rotationY turns the model's −Z
    // forward onto the travel direction.
    return {
      position: [
        cx + Math.cos(angle) * spec.radius,
        cy + Math.sin(angle) * spec.bob,
        cz + Math.sin(angle) * spec.radius,
      ],
      rotationY: Math.atan2(
        Math.sin(angle) * spec.direction,
        -Math.cos(angle) * spec.direction,
      ),
    };
  }
  const cycle = (((t / spec.periodMs) % 1) + 1) % 1;
  const f = cycle < 0.5 ? cycle * 2 : 2 - cycle * 2;
  const [fx, fy, fz] = spec.from;
  const [tx, ty, tz] = spec.to;
  const dir = cycle < 0.5 ? 1 : -1;
  const dx = (tx - fx) * dir;
  const dz = (tz - fz) * dir;
  const len = Math.hypot(dx, dz) || 1;
  return {
    position: [fx + (tx - fx) * f, fy + (ty - fy) * f, fz + (tz - fz) * f],
    rotationY: Math.atan2(-dx / len, -dz / len),
  };
}

/**
 * Load one drifter through the app's shared glTF loader and merge it
 * to a single material — unless the spec says as-is, in which case the
 * scene loads untouched (the nebula traveller: its glass and morph
 * clip survive only unmerged). Resolves to the root plus its animation
 * clips, or null when the load fails or cannot merge — the caller keeps
 * the holder empty and the failure is registered for the diagnostics
 * note.
 */
function loadGalaxyDrifter(
  spec: GalaxyDrifterSpec,
): Promise<{ root: THREE.Object3D; animations: THREE.AnimationClip[] } | null> {
  const name = spec.url.split("/").pop() ?? spec.url;
  return new Promise((resolve) => {
    const fail = () => {
      noteModelFallback(name);
      resolve(null);
    };
    try {
      gltfLoader().load(
        spec.url,
        (gltf) => {
          if (spec.asIs) {
            const meshes: THREE.Mesh[] = [];
            gltf.scene.traverse((o) => {
              if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
            });
            if (meshes.length === 0) {
              resolve(null);
              return;
            }
            for (const mesh of meshes) {
              recenterGeometry(mesh.geometry);
              scaleGeometryToSize(mesh.geometry, spec.size);
            }
            resolve({ root: gltf.scene, animations: gltf.animations ?? [] });
            return;
          }
          const merged = mergeToSingleMaterial(gltf.scene, GALAXY_DRIFTER_COLOR);
          if (!merged) {
            resolve(null);
            return;
          }
          recenterGeometry(merged.geometry);
          scaleGeometryToSize(merged.geometry, spec.size);
          resolve({ root: merged, animations: [] });
        },
        undefined,
        fail,
      );
    } catch {
      // three's loader can throw synchronously (e.g. an unresolvable URL
      // where there is no page to resolve it against, as in tests) — a
      // failed load degrades to the empty holder, never to a crash.
      fail();
    }
  });
}

export interface GalaxyDrifters {
  group: THREE.Group;
  update: (elapsedMs: number, opts?: { reducedMotion?: boolean }) => void;
  dispose: () => void;
}

export function createGalaxyDrifters(): GalaxyDrifters {
  const group = new THREE.Group();
  group.name = "galaxy-drifters";
  let disposed = false;
  const holders = new Map<string, THREE.Group>();
  const mixers: THREE.AnimationMixer[] = [];
  let lastElapsedMs: number | null = null;
  for (const spec of GALAXY_DRIFTER_SPECS) {
    const holder = new THREE.Group();
    holder.name = `galaxy-drifter-${spec.key}`;
    const pose = galaxyDrifterPose(spec, 0);
    holder.position.set(pose.position[0], pose.position[1], pose.position[2]);
    holder.rotation.y = pose.rotationY;
    group.add(holder);
    holders.set(spec.key, holder);
    void loadGalaxyDrifter(spec).then((loaded) => {
      if (!loaded || disposed) {
        if (loaded) disposeObject3D(loaded.root);
        return;
      }
      loaded.root.name = `galaxy-drifter-model-${spec.key}`;
      holders.get(spec.key)?.add(loaded.root);
      if (loaded.animations.length > 0) {
        const mixer = new THREE.AnimationMixer(loaded.root);
        for (const clip of loaded.animations) mixer.clipAction(clip).play();
        mixers.push(mixer);
      }
    });
  }

  return {
    group,
    update(elapsedMs: number, opts?: { reducedMotion?: boolean }) {
      if (disposed || opts?.reducedMotion) return;
      // The traveller's morph clip ticks on the same clock as the
      // paths: delta from successive elapsed times, clamped so a
      // tab-switch can never jump a clip forward by minutes.
      const deltaMs = lastElapsedMs === null ? 0 : elapsedMs - lastElapsedMs;
      lastElapsedMs = elapsedMs;
      const deltaS = Math.min(0.1, Math.max(0, deltaMs / 1000));
      for (const mixer of mixers) mixer.update(deltaS);
      for (const spec of GALAXY_DRIFTER_SPECS) {
        const holder = holders.get(spec.key);
        if (!holder) continue;
        const pose = galaxyDrifterPose(spec, elapsedMs);
        holder.position.set(pose.position[0], pose.position[1], pose.position[2]);
        holder.rotation.y = pose.rotationY;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeObject3D(group);
    },
  };
}
