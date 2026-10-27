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
 * four benign visitors drifting through the brain galaxy. Space is
 * space: things CAN float through someone's individual galaxy too.
 * But bounded, so they can actually be seen: in a populated mind full
 * of memories, something passing through fast would go unnoticed.
 *
 * The rules, as designed:
 * - SLOW: a crossing takes minutes, not seconds; a loop takes 10–12
 *   minutes. At galaxy scale that reads as a slow passing thing.
 * - BOUNDED: loops and crossings stay inside the camera's reachable
 *   view volume (radius ≤ 2,200 — inside the visitors' 2,400 despawn
 *   shell), never a fly-by that leaves. The crossing chords are routed
 *   clear of the Sun (closest approach ~950–1,000 units; the Sun's
 *   solid body reaches 600) — a drifter never flies through the Sun.
 *   The chords do cross the node-orbit shells — any bounded path
 *   through the galaxy must — but they never ride an orbit, never stop
 *   at a node, and carry no interaction, so they cannot read as nodes.
 * - SPARSE: four total, spread on different radii, planes, and phases
 *   — at most one or two in view at once, never crowding the memories.
 * - Never memories: no labels, no click-to-open, no lore panels, no
 *   scores, no visits. They carry no interaction at all, and they ride
 *   their own slow paths — NOT the orbit system (orbits.ts is Red Zone
 *   load-bearing; untouched). Reduced motion holds them still.
 * - All four merge to one material (1 call each = 4 calls, 596 tris).
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
 * instanced meshes. Four extra single-material meshes is within noise;
 * there is no ceiling to blow. If a ceiling ever lands, these four are
 * the first cut, in this priority order: alien, astronaut, ufo,
 * asteroid_small.
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
    };

/** The four drifters, in drop priority order (alien, astronaut, ufo, asteroid_small). */
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
];

/** Draw calls the drifters add once loaded: one merged mesh each. */
export const GALAXY_DRIFTER_DRAW_CALLS = GALAXY_DRIFTER_SPECS.length;
/** Measured triangles across the four drifters. */
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
 * to a single material. Resolves to the merged mesh, or null when the
 * load fails or cannot merge — the caller keeps the holder empty and
 * the failure is registered for the diagnostics note.
 */
function loadGalaxyDrifter(spec: GalaxyDrifterSpec): Promise<THREE.Mesh | null> {
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
          const merged = mergeToSingleMaterial(gltf.scene, GALAXY_DRIFTER_COLOR);
          if (!merged) {
            resolve(null);
            return;
          }
          recenterGeometry(merged.geometry);
          scaleGeometryToSize(merged.geometry, spec.size);
          resolve(merged);
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
  for (const spec of GALAXY_DRIFTER_SPECS) {
    const holder = new THREE.Group();
    holder.name = `galaxy-drifter-${spec.key}`;
    const pose = galaxyDrifterPose(spec, 0);
    holder.position.set(pose.position[0], pose.position[1], pose.position[2]);
    holder.rotation.y = pose.rotationY;
    group.add(holder);
    holders.set(spec.key, holder);
    void loadGalaxyDrifter(spec).then((merged) => {
      if (!merged || disposed) {
        if (merged) disposeObject3D(merged);
        return;
      }
      merged.name = `galaxy-drifter-model-${spec.key}`;
      holders.get(spec.key)?.add(merged);
    });
  }

  return {
    group,
    update(elapsedMs: number, opts?: { reducedMotion?: boolean }) {
      if (disposed || opts?.reducedMotion) return;
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
