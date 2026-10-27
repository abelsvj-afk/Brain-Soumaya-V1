import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import {
  STATION_PALETTE,
  STATION_ROTATION_RATE_RAD_PER_MS,
  STATION_SEED,
  STATION_WHEEL_RADIUS,
  WITNESS_DRYDOCK_POSITION,
  WITNESS_HAULER_POSITION,
  beaconRing,
  dockingMooringPose,
  heroMooringPose,
  mooringPose,
  rngFromSeed,
  trafficLanes,
  type TrafficLane,
} from "./stationLayout.js";
import { loadProfondoHull } from "./profondoHull.js";
import { buildHygStarfield } from "./hygStars.js";
import { loadSoumayaShip } from "./soumayaShip.js";
import {
  DOCKED_MODELS,
  DOCKING_MODEL_INDEX,
  DRESSING_MODELS,
  DRYDOCK_PIECES,
  TRAFFIC_MODELS,
  WITNESS_HAULER,
  loadStationAsset,
  mergeByMaterial,
  mergeToSingleMaterial,
  singleMeshGeometry,
} from "./stationAssets.js";
import { placeWorldRelics } from "./relicAssets.js";

/**
 * The Great Station scene (Phase 2, P2-3; scaled up P2-6): three.js
 * wiring over the pure layout in stationLayout.ts. The hull is a SEAM
 * — Gate 0 swaps the procedural proxy for the converted Profondo model
 * through the `hull` option without touching anything else here.
 *
 * P2-6 (owner's direction 2026-10-25): the Station is gigantic and
 * game-alive. The D-37 accessory layer is built out — beacon ring,
 * work lights, real-ship traffic (Quaternius fleet + WATO regular),
 * docked ships, dressing, witnesses — and the whole station turns
 * slowly (R-S4) while the traffic flies its lanes (A17). Her own ship
 * is moored at the primary arm (Q2: the hero is `soumaya-ship.glb`).
 *
 * Every real asset loads asynchronously through the shared loader
 * with the honest fallback: a load that fails leaves the previous
 * level in place (proxy hull, procedural traffic boxes, an empty
 * mooring) and registers a diagnostics note — never a crash, never a
 * blank Station, never a silent missing piece presented as complete.
 * The procedural traffic boxes are the LOAD fallback only (the proxy
 * pattern): they leave the moment the first real traffic model lands.
 * No placeholder procedural ship remains in the shipped scene (C2).
 *
 * The host owns the renderer, camera, and fog (palette-matched
 * FogExp2 in indigo, per the adopted technique stack); this module
 * owns the station group and its per-frame motion. Traffic, docking,
 * and rotation freeze under reduced motion (same scene, same
 * information, no motion).
 *
 * Budget (measured, see stationLayout.ts STATION_TRI_PLAN): 53 draw
 * calls / 246,056 visible tris worst case — inside the internal
 * targets (≤64 / ≤500k). If an asset's merge fails, the asset is
 * OMITTED rather than shipped unmerged over budget.
 */
export interface StationScene {
  group: THREE.Group;
  update: (elapsedMs: number, opts?: { reducedMotion?: boolean }) => void;
  dispose: () => void;
}

function proxyHull(): THREE.Group {
  const g = new THREE.Group();
  const basalt = new THREE.MeshStandardMaterial({
    color: STATION_PALETTE.hullBasalt,
    roughness: 0.85,
    metalness: 0.35,
  });
  const gunmetal = new THREE.MeshStandardMaterial({
    color: STATION_PALETTE.hullGunmetal,
    roughness: 0.6,
    metalness: 0.55,
  });
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(STATION_WHEEL_RADIUS, 26, 12, 72), basalt);
  wheel.rotation.x = Math.PI / 2;
  g.add(wheel);
  const spindle = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 190, 16), gunmetal);
  g.add(spindle);
  const hub = new THREE.Mesh(new THREE.SphereGeometry(24, 20, 14), gunmetal);
  g.add(hub);
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(70, 5, 8), gunmetal);
    const a = (i / 4) * Math.PI * 2;
    arm.position.set(Math.cos(a) * (STATION_WHEEL_RADIUS - 38), 0, Math.sin(a) * (STATION_WHEEL_RADIUS - 38));
    arm.rotation.y = -a;
    g.add(arm);
  }
  return g;
}

/** Traffic forward lengths (units): the scale ladder — ships read
 *  8–14 long beside the 420-unit wheel, varied so the size ladder is
 *  visible in one look. Indexed by traffic-model order. */
const TRAFFIC_FORWARD_LENGTHS = [10, 12, 9, 14, 11, 10, 12, 9, 14, 11, 10, 12];

/** Docked ships moor parallel to the arm, long axis along it (the
 *  Kenney forward axis is unverified — moored, the nose direction
 *  does not affect the read). */
const DOCKED_FORWARD_LENGTHS: Record<string, number> = {
  craft_cargoA: 9,
  craft_cargoB: 11,
  craft_miner: 10,
  craft_racer: 8,
};

/** Docking cycle (Q3, B-4): a presentation-only ambient animation.
 *  One shuttle eases from its lane onto arm 2, holds, eases back,
 *  and waits — no persistent state, no schedules, no simulated users.
 *  Reduced motion: the shuttle simply sits docked. */
export const DOCKING_CYCLE_MS = 90_000;
export const DOCKING_EASE_MS = 24_000;
export const DOCKING_HOLD_MS = 12_000;
export const DOCKING_PAUSE_MS = 30_000;

const smoothstep = (t: number) => t * t * (3 - 2 * t);
const lerpAngle = (a: number, b: number, t: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};
const lerp3 = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  f: number,
): [number, number, number] => [
  a[0] + (b[0] - a[0]) * f,
  a[1] + (b[1] - a[1]) * f,
  a[2] + (b[2] - a[2]) * f,
];

export interface DockingPose {
  position: [number, number, number];
  rotationY: number;
  docked: boolean;
}

/** The docking shuttle's pose at an elapsed time — a pure function
 *  of elapsed time (deterministic, like the warp streaks). */
export function dockingPose(
  elapsedMs: number,
  lane: TrafficLane,
  opts?: { reducedMotion?: boolean },
): DockingPose {
  const mooring = dockingMooringPose();
  const lanePoint: [number, number, number] = [
    Math.cos(lane.phase) * lane.radius,
    lane.y,
    Math.sin(lane.phase) * lane.radius,
  ];
  // Facing along the lane (the lane-traffic rule) vs facing outward
  // at the arm.
  const laneFacing = -lane.phase + (lane.speed >= 0 ? 0 : Math.PI);
  if (opts?.reducedMotion) {
    return { position: mooring.position, rotationY: mooring.rotationY, docked: true };
  }
  const t = ((elapsedMs % DOCKING_CYCLE_MS) + DOCKING_CYCLE_MS) % DOCKING_CYCLE_MS;
  if (t < DOCKING_EASE_MS) {
    const f = smoothstep(t / DOCKING_EASE_MS);
    return {
      position: lerp3(lanePoint, mooring.position, f),
      rotationY: lerpAngle(laneFacing, mooring.rotationY, f),
      docked: false,
    };
  }
  if (t < DOCKING_EASE_MS + DOCKING_HOLD_MS) {
    return { position: mooring.position, rotationY: mooring.rotationY, docked: true };
  }
  if (t < DOCKING_EASE_MS + DOCKING_HOLD_MS + DOCKING_EASE_MS) {
    const f = smoothstep((t - DOCKING_EASE_MS - DOCKING_HOLD_MS) / DOCKING_EASE_MS);
    return {
      position: lerp3(mooring.position, lanePoint, f),
      rotationY: lerpAngle(mooring.rotationY, laneFacing, f),
      docked: false,
    };
  }
  return { position: lanePoint, rotationY: laneFacing, docked: false };
}

export function createStationScene(opts: { hull?: THREE.Object3D; onRelicVisible?: (slug: string) => void } = {}): StationScene {
  const group = new THREE.Group();
  // The rotating frame (R-S4): the hull, beacons, work lights, hero,
  // docked ships, and dressing are ATTACHED to the Station, so they
  // turn with it. Traffic lanes, the docking shuttle, and the
  // witnesses are free bodies in the fixed frame.
  const station = new THREE.Group();
  station.name = "station-rotating";
  group.add(station);

  // Relics (relics increment): the Station's two relics rest on the
  // harbor, attached to the rotating frame so they turn with it. A
  // relic whose GLB has not landed is simply absent — no stand-in, and
  // its find is never offered (the host learns of it via onRelicVisible).
  const cancelRelics = placeWorldRelics(station, "great-station", opts.onRelicVisible);

  // The proxy form is the standing backup (D-37): it renders
  // immediately, and the real Profondo hull swaps in when it loads —
  // the app's model pattern. A failed load keeps the proxy and is
  // registered as a model fallback (see profondoHull.ts).
  const proxy = proxyHull();
  station.add(opts.hull ?? proxy);
  let disposed = false;
  if (!opts.hull) {
    void loadProfondoHull().then((hull) => {
      if (!hull) return;
      if (disposed) {
        disposeObject3D(hull);
        return;
      }
      station.remove(proxy);
      disposeObject3D(proxy);
      station.add(hull);
    });
  }

  const ambient = new THREE.AmbientLight(STATION_PALETTE.indigo, 1.4);
  group.add(ambient);
  const hubLight = new THREE.PointLight(STATION_PALETTE.amber, 900, 900, 1.6);
  group.add(hubLight);
  const rimLight = new THREE.DirectionalLight(STATION_PALETTE.starCold, 0.7);
  rimLight.position.set(-600, 300, -800);
  group.add(rimLight);

  // Beacons: two instanced meshes so nav (cyan) and work (amber) can
  // pulse on different phases — color discipline is in the layout.
  const ring = beaconRing(STATION_SEED, 48, STATION_WHEEL_RADIUS);
  const beaconGeo = new THREE.SphereGeometry(2.4, 8, 6);
  const navBeaconMat = new THREE.MeshBasicMaterial({ color: STATION_PALETTE.cyan, transparent: true });
  const workBeaconMat = new THREE.MeshBasicMaterial({ color: STATION_PALETTE.amber, transparent: true });
  const makeBeaconMesh = (role: "nav" | "work", material: THREE.MeshBasicMaterial) => {
    const items = ring.filter((b) => b.role === role);
    const mesh = new THREE.InstancedMesh(beaconGeo, material, items.length);
    const m = new THREE.Matrix4();
    items.forEach((b, i) => {
      m.setPosition(b.x, b.y, b.z);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    station.add(mesh);
    return mesh;
  };
  makeBeaconMesh("nav", navBeaconMat);
  makeBeaconMesh("work", workBeaconMat);

  // Work lights (Q3): small amber lights along the four arms, slow
  // blink rhythm. Reduced motion: steady lit, no blink — same
  // information, no motion.
  const workLightPositions: { x: number; y: number; z: number; phase: number }[] = [];
  {
    const rnd = rngFromSeed(`${STATION_SEED}:work-lights`);
    for (let arm = 0; arm < 4; arm++) {
      const a = (arm / 4) * Math.PI * 2;
      for (let k = 0; k < 8; k++) {
        const r = 150 + k * 7 + rnd() * 4;
        workLightPositions.push({
          x: Math.cos(a) * r,
          y: (rnd() - 0.5) * 6,
          z: Math.sin(a) * r,
          phase: rnd() * Math.PI * 2,
        });
      }
    }
  }
  const workLightMat = new THREE.MeshBasicMaterial({ color: STATION_PALETTE.amber, transparent: true });
  const workLights = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.8, 6, 4),
    workLightMat,
    workLightPositions.length,
  );
  workLights.name = "station-work-lights";
  {
    const m = new THREE.Matrix4();
    workLightPositions.forEach((p, i) => {
      m.setPosition(p.x, p.y, p.z);
      workLights.setMatrixAt(i, m);
    });
    workLights.instanceMatrix.needsUpdate = true;
  }
  station.add(workLights);

  group.add(buildHygStarfield());

  // --- Real traffic (P2-6): one InstancedMesh per model, two ships
  // per lane. The procedural boxes below are the LOAD fallback only.
  const lanes = trafficLanes(STATION_SEED);
  const CRAFT_PER_LANE = 2;
  const laneMeshes: { mesh: THREE.InstancedMesh; lane: TrafficLane; scale: number }[] = [];
  let fallbackTraffic: THREE.InstancedMesh | null = null;
  let realTrafficLanded = false;
  const removeFallbackTraffic = () => {
    if (!fallbackTraffic || realTrafficLanded) return;
    realTrafficLanded = true;
    group.remove(fallbackTraffic);
    disposeObject3D(fallbackTraffic);
    fallbackTraffic = null;
  };
  {
    const boxes = new THREE.InstancedMesh(
      new THREE.BoxGeometry(7, 2, 3),
      new THREE.MeshBasicMaterial({ color: STATION_PALETTE.amberDim }),
      lanes.length * CRAFT_PER_LANE,
    );
    boxes.name = "station-traffic-fallback";
    group.add(boxes);
    fallbackTraffic = boxes;
  }

  const dummy = new THREE.Object3D();
  const placeLaneInstances = (
    mesh: THREE.InstancedMesh,
    lane: TrafficLane,
    t: number,
    scale: number,
  ) => {
    for (let k = 0; k < CRAFT_PER_LANE; k++) {
      const angle = lane.phase + (k * Math.PI * 2) / CRAFT_PER_LANE + t * lane.speed;
      dummy.position.set(Math.cos(angle) * lane.radius, lane.y, Math.sin(angle) * lane.radius);
      dummy.rotation.set(0, -angle + (lane.speed >= 0 ? 0 : Math.PI), 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };

  // The docking shuttle shares the dispatcher's geometry (one load,
  // no second fetch). It is built inside the dispatcher lane's load.
  let dockingMesh: THREE.Mesh | null = null;
  const dockingLane = lanes[DOCKING_MODEL_INDEX];

  const scaleToForward = (geometry: THREE.BufferGeometry, target: number): number => {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) return 1;
    const forward = Math.max(0.001, box.max.z - box.min.z);
    return target / forward;
  };

  TRAFFIC_MODELS.forEach((model, index) => {
    const lane = lanes[index];
    if (!lane) return;
    const target = TRAFFIC_FORWARD_LENGTHS[index] ?? 10;
    void loadStationAsset(model.url).then((loaded) => {
      if (!loaded || disposed) {
        if (loaded) disposeObject3D(loaded);
        return;
      }
      if (model.key === "wato") {
        // The regular is seven materials — merge by material (7 calls).
        // An unmergeable WATO is omitted, not shipped at 18 calls.
        // (The merged meshes reuse the loaded materials, so the loaded
        // root is left for GC — disposing it would dispose materials
        // the scene now uses.)
        const merged = mergeByMaterial(loaded);
        if (merged === loaded) return;
        const box = new THREE.Box3().setFromObject(merged);
        const size = box.getSize(new THREE.Vector3());
        const scale = target / Math.max(0.001, size.z);
        const meshes: THREE.Mesh[] = [];
        merged.traverse((o) => {
          if (o instanceof THREE.Mesh) meshes.push(o);
        });
        for (const mesh of meshes) {
          const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
          if (!mat) continue;
          const instanced = new THREE.InstancedMesh(mesh.geometry, mat, CRAFT_PER_LANE);
          instanced.name = "traffic-wato";
          group.add(instanced);
          laneMeshes.push({ mesh: instanced, lane, scale });
        }
        removeFallbackTraffic();
        return;
      }
      const single = singleMeshGeometry(loaded);
      if (!single) return;
      const scale = scaleToForward(single.geometry, target);
      const instanced = new THREE.InstancedMesh(single.geometry, single.material, CRAFT_PER_LANE);
      instanced.name = `traffic-${model.key}`;
      group.add(instanced);
      laneMeshes.push({ mesh: instanced, lane, scale });
      // The docking shuttle rides the dispatcher's geometry.
      if (index === DOCKING_MODEL_INDEX) {
        const shuttle = new THREE.Mesh(single.geometry, single.material);
        shuttle.name = "docking-shuttle";
        group.add(shuttle);
        dockingMesh = shuttle;
      }
      removeFallbackTraffic();
    });
  });

  // --- Her ship, moored at the primary arm (Q2). The mooring stays
  // empty until the GLB lands — no faked hero.
  void loadSoumayaShip().then((hero) => {
    if (!hero || disposed) {
      if (hero) disposeObject3D(hero);
      return;
    }
    const pose = heroMooringPose();
    const holder = new THREE.Group();
    holder.name = "hero-ship";
    holder.position.set(pose.position[0], pose.position[1], pose.position[2]);
    holder.rotation.y = pose.rotationY;
    holder.add(hero);
    station.add(holder);
  });

  // --- Docked ships: Kenney craft moored at arms 1–3 (arm 0 is the
  // hero's). One InstancedMesh per model, merged to one material.
  {
    const placements: { arm: number; lateral: number }[] = [
      { arm: 1, lateral: 8 },
      { arm: 1, lateral: -8 },
      { arm: 2, lateral: 8 },
      { arm: 2, lateral: -8 },
      { arm: 3, lateral: 8 },
      { arm: 3, lateral: -8 },
    ];
    let placed = 0;
    DOCKED_MODELS.forEach((model) => {
      void loadStationAsset(model.url).then((loaded) => {
        if (!loaded || disposed) {
          if (loaded) disposeObject3D(loaded);
          return;
        }
        const merged = mergeToSingleMaterial(loaded, STATION_PALETTE.hullGunmetal);
        if (!merged) return;
        const target = DOCKED_FORWARD_LENGTHS[model.key] ?? 10;
        const scale = scaleToForward(merged.geometry, target);
        const instanced = new THREE.InstancedMesh(merged.geometry, merged.material, model.instances);
        instanced.name = `docked-${model.key}`;
        station.add(instanced);
        for (let k = 0; k < model.instances; k++) {
          const spot = placements[placed % placements.length];
          placed++;
          if (!spot) continue;
          const angle = (spot.arm / 4) * Math.PI * 2;
          const px = Math.cos(angle) * 222 + -Math.sin(angle) * spot.lateral;
          const pz = Math.sin(angle) * 222 + Math.cos(angle) * spot.lateral;
          dummy.position.set(px, 0, pz);
          dummy.rotation.set(0, mooringPose(222, angle).rotationY, 0);
          dummy.scale.setScalar(scale);
          dummy.updateMatrix();
          instanced.setMatrixAt(k, dummy.matrix);
        }
        instanced.instanceMatrix.needsUpdate = true;
      });
    });
  }

  // --- Dressing: six models × two instances, tucked between the arms
  // (never on a mooring), attached to the Station so they turn with it.
  {
    const rnd = rngFromSeed(`${STATION_SEED}:dressing`);
    DRESSING_MODELS.forEach((model, modelIndex) => {
      void loadStationAsset(model.url).then((loaded) => {
        if (!loaded || disposed) {
          if (loaded) disposeObject3D(loaded);
          return;
        }
        let single: { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] } | null;
        if (model.merge) {
          const merged = mergeToSingleMaterial(loaded, STATION_PALETTE.hullGunmetal);
          single = merged ? { geometry: merged.geometry, material: merged.material } : null;
        } else {
          single = singleMeshGeometry(loaded);
        }
        if (!single) return;
        // A multi-material mesh can't instance as one draw call — take
        // the first material (the dressing models are single-material
        // in practice; a multi-material one still renders, just flat).
        const mat = Array.isArray(single.material) ? single.material[0] : single.material;
        if (!mat) return;
        const instanced = new THREE.InstancedMesh(single.geometry, mat, model.instances);
        instanced.name = `dressing-${model.key}`;
        station.add(instanced);
        for (let k = 0; k < model.instances; k++) {
          const sector = (k + modelIndex) % 4;
          const angle = sector * (Math.PI / 2) + Math.PI / 4 + (rnd() - 0.5) * 0.5;
          const radius = 232 + rnd() * 16;
          dummy.position.set(Math.cos(angle) * radius, (rnd() - 0.5) * 40, Math.sin(angle) * radius);
          dummy.rotation.set(0, rnd() * Math.PI * 2, 0);
          dummy.scale.setScalar(1);
          dummy.updateMatrix();
          instanced.setMatrixAt(k, dummy.matrix);
        }
        instanced.instanceMatrix.needsUpdate = true;
      });
    });
  }

  // --- Witnesses (C1): the hauler and the drydock frame sit just off
  // the approach corridor, in the handoff frame beside the Station.
  {
    void loadStationAsset(WITNESS_HAULER.url).then((loaded) => {
      if (!loaded || disposed) {
        if (loaded) disposeObject3D(loaded);
        return;
      }
      const merged = mergeToSingleMaterial(loaded, STATION_PALETTE.amberDim);
      if (!merged) return;
      const scale = scaleToForward(merged.geometry, 14);
      const hauler = new THREE.Mesh(merged.geometry, merged.material);
      hauler.name = "witness-hauler";
      const angle = Math.atan2(WITNESS_HAULER_POSITION[2], WITNESS_HAULER_POSITION[0]);
      const pose = mooringPose(Math.hypot(WITNESS_HAULER_POSITION[0], WITNESS_HAULER_POSITION[2]), angle);
      hauler.position.set(WITNESS_HAULER_POSITION[0], WITNESS_HAULER_POSITION[1], WITNESS_HAULER_POSITION[2]);
      hauler.rotation.y = pose.rotationY;
      hauler.scale.setScalar(scale);
      group.add(hauler);
    });

    const frameOffsets: { key: string; offset: [number, number, number]; rotationY: number }[] = [
      { key: "hangar_largeA", offset: [0, 0, 0], rotationY: 0.6 },
      { key: "platform_large", offset: [-14, -2, -8], rotationY: 0 },
      { key: "platform_large", offset: [14, -2, 8], rotationY: 0 },
      { key: "platform_large", offset: [-14, -2, 8], rotationY: 0 },
      { key: "platform_large", offset: [14, -2, -8], rotationY: 0 },
      { key: "structure_detailed", offset: [-8, 6, 12], rotationY: 0.4 },
      { key: "structure_detailed", offset: [10, -4, -10], rotationY: 1.2 },
      { key: "structure", offset: [-12, -6, -6], rotationY: 0.9 },
      { key: "structure", offset: [12, 8, 8], rotationY: 2.1 },
    ];
    DRYDOCK_PIECES.forEach((piece) => {
      void loadStationAsset(piece.url).then((loaded) => {
        if (!loaded || disposed) {
          if (loaded) disposeObject3D(loaded);
          return;
        }
        const merged = mergeToSingleMaterial(loaded, STATION_PALETTE.hullGunmetal);
        if (!merged) return;
        const mine = frameOffsets.filter((f) => f.key === piece.key);
        const instanced = new THREE.InstancedMesh(merged.geometry, merged.material, mine.length);
        instanced.name = `drydock-${piece.key}`;
        group.add(instanced);
        mine.forEach((spot, k) => {
          dummy.position.set(
            WITNESS_DRYDOCK_POSITION[0] + spot.offset[0],
            WITNESS_DRYDOCK_POSITION[1] + spot.offset[1],
            WITNESS_DRYDOCK_POSITION[2] + spot.offset[2],
          );
          dummy.rotation.set(0, spot.rotationY, 0);
          dummy.scale.setScalar(1);
          dummy.updateMatrix();
          instanced.setMatrixAt(k, dummy.matrix);
        });
        instanced.instanceMatrix.needsUpdate = true;
      });
    });
  }

  const update = (elapsedMs: number, uopts?: { reducedMotion?: boolean }) => {
    const t = uopts?.reducedMotion ? 0 : elapsedMs / 1000;
    // R-S4: the whole Station turns, stately. Frozen under reduced
    // motion — the form is identical, just not turning.
    station.rotation.y = uopts?.reducedMotion ? 0 : elapsedMs * STATION_ROTATION_RATE_RAD_PER_MS;
    // Gentle beacon breathing; nav and work offset by half a cycle.
    navBeaconMat.opacity = 0.75 + 0.25 * Math.sin(t * 1.4);
    workBeaconMat.opacity = 0.7 + 0.3 * Math.sin(t * 1.4 + Math.PI);
    // Work lights blink slowly; reduced motion holds them steady lit.
    workLightMat.opacity = uopts?.reducedMotion ? 0.85 : 0.65 + 0.35 * Math.sin(t * 0.8);
    // Traffic on its lanes (A17) — real models where they loaded, the
    // fallback boxes where none did yet.
    for (const entry of laneMeshes) {
      placeLaneInstances(entry.mesh, entry.lane, t, entry.scale);
    }
    if (fallbackTraffic) {
      for (let i = 0; i < lanes.length; i++) {
        const lane = lanes[i];
        if (!lane) continue;
        for (let k = 0; k < CRAFT_PER_LANE; k++) {
          const angle = lane.phase + (k * Math.PI * 2) / CRAFT_PER_LANE + t * lane.speed;
          dummy.position.set(Math.cos(angle) * lane.radius, lane.y, Math.sin(angle) * lane.radius);
          dummy.rotation.set(0, -angle + (lane.speed >= 0 ? 0 : Math.PI), 0);
          dummy.scale.setScalar(1);
          dummy.updateMatrix();
          fallbackTraffic.setMatrixAt(i * CRAFT_PER_LANE + k, dummy.matrix);
        }
      }
      fallbackTraffic.instanceMatrix.needsUpdate = true;
    }
    // The docking shuttle eases onto arm 2 (Q3); reduced motion parks
    // it docked. The station's own turn is ~0.00001 rad/ms — over a
    // 90 s cycle the arm moves < 0.3 units, so the fixed-frame target
    // is exact for every practical purpose.
    if (dockingMesh && dockingLane) {
      const pose = dockingPose(elapsedMs, dockingLane, { reducedMotion: uopts?.reducedMotion });
      dockingMesh.position.set(pose.position[0], pose.position[1], pose.position[2]);
      dockingMesh.rotation.y = pose.rotationY;
    }
  };
  update(0);

  return {
    group,
    update,
    dispose: () => {
      disposed = true;
      cancelRelics();
      disposeObject3D(group);
    },
  };
}
