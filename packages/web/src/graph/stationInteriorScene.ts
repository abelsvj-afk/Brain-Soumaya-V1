import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import { buildHygStarfield } from "./hygStars.js";
import { STATION_PALETTE } from "./stationLayout.js";
import {
  INTERIOR_BAY_LANE,
  INTERIOR_BAY_DOOR,
  INTERIOR_DECK_VIEWPORT,
  INTERIOR_GATE,
  INTERIOR_LIGHT_STRIPS,
  INTERIOR_NAV_MARKERS,
  INTERIOR_RIM_ARC,
  INTERIOR_WORK_COLOR,
  INTERIOR_WORK_LIGHTS,
  buildStationInteriorLayout,
  type InteriorRoom,
  type StationInteriorLayout,
} from "./stationInteriorLayout.js";
import {
  INTERIOR_BAY_SHIP,
  INTERIOR_MODELS,
  interiorShipUrlForSkin,
  loadInteriorAsset,
} from "./stationInteriorAssets.js";
import {
  mergeToSingleMaterial,
  singleMeshGeometry,
} from "./stationAssets.js";

/**
 * Station Interior scene (Wave 2, settled design 2026-10-28) — renders
 * exactly what stationInteriorLayout returns, nothing more. The host
 * owns the renderer, camera, and fog (indigo, per the Station's
 * palette); this module owns the interior group and its per-frame
 * motion.
 *
 * The interior is the Great Station's inside: a covered harbor hall
 * in four rooms (hangar bay, commission board, fleet deck,
 * observation deck), built from the Kenney Station Kit already in
 * the app. The camera is the surface's — a slow orbit per room; this
 * module owns only the life inside the hall: the work lights breathe
 * and the bay ship passes the door.
 *
 * The hangar bay is the arrival room and the ship room: YOUR ship
 * floats in its center (EVE-style dock-in), skin-aware — her ship
 * GLB by default, the organic hull for the organic skin. Fusion_core
 * and holographic have no GLB anywhere in the app, so for those
 * skins her ship hull carries the galaxy's own procedural styling
 * (fusion orange emissive; holographic wireframe cyan, translucent)
 * — the same styling graph/soumaya.ts applies to its procedural
 * hull. The picker remains the truth about which skin is picked.
 *
 * Honesty about the loads (the Profondo pattern): every kit piece
 * loads asynchronously through the shared loader. A piece whose GLB
 * has not landed is simply absent — no stand-in — and its failure is
 * registered for the diagnostics note. The hall still renders: floors,
 * ceilings, light strips, nav markers, and the rim arc are structure,
 * not stand-ins for a missing model, so a hall with every GLB missing
 * is still a hall with floors, light, and a way out — never a blank
 * room. The docked ship and the passing ship are the same way: a
 * missing hull leaves an empty berth, never a faked ship.
 *
 * Budget (measured in tests, static half — before any GLB lands): the
 * hall's structure is a few thousand triangles and ~20 draw calls
 * against the Station's own internal targets (≤64 / ≤500k). The kit
 * pieces add ~2,500 tris when they land. Runtime measurement belongs
 * to the device check; these constants are the static half.
 *
 * Reduced motion holds the hall: no light breathing, no passing ship
 * (it sits parked at the door, mid-pass — same information, no
 * motion). The docked ship never moves — the orbit camera moves
 * around it.
 */

export interface StationInteriorScene {
  group: THREE.Group;
  update: (elapsedMs: number, opts?: { reducedMotion?: boolean }) => void;
  dispose: () => void;
}

/** The empty layout, for the surface's loading state (the world builds nothing until the layout exists). */
export const EMPTY_STATION_INTERIOR_LAYOUT: StationInteriorLayout = {
  spaces: [],
};

function basaltMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: STATION_PALETTE.hullBasalt,
    roughness: 0.85,
    metalness: 0.35,
    side: THREE.DoubleSide,
  });
}

function gunmetalMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: STATION_PALETTE.hullGunmetal,
    roughness: 0.6,
    metalness: 0.55,
    side: THREE.DoubleSide,
  });
}

/** The passing ship's pose on its lane at an elapsed time — a pure function of elapsed time (deterministic, like the warp streaks). */
export function bayShipPose(elapsedMs: number): { x: number; y: number; z: number; heading: number } {
  const t = ((elapsedMs % INTERIOR_BAY_LANE.cycleMs) + INTERIOR_BAY_LANE.cycleMs) % INTERIOR_BAY_LANE.cycleMs;
  const half = INTERIOR_BAY_LANE.cycleMs / 2;
  const span = INTERIOR_BAY_LANE.toX - INTERIOR_BAY_LANE.fromX;
  if (t < half) {
    const f = t / half;
    return {
      x: INTERIOR_BAY_LANE.fromX + span * f,
      y: INTERIOR_BAY_LANE.y,
      z: INTERIOR_BAY_LANE.z,
      heading: -Math.PI / 2,
    };
  }
  const f = (t - half) / half;
  return {
    x: INTERIOR_BAY_LANE.toX - span * f,
    y: INTERIOR_BAY_LANE.y,
    z: INTERIOR_BAY_LANE.z,
    heading: Math.PI / 2,
  };
}

/**
 * Style a loaded hull the way the galaxy styles its procedural hull
 * for the skins that have no GLB — the same colors, the same
 * wireframe/translucency. Default and organic skins load their own
 * GLB and need no styling. Materials are CLONED before styling, so
 * a hull the loader shares with the galaxy is never re-tinted there.
 */
export function styleShipHullForSkin(loaded: THREE.Object3D, skin: string): void {
  if (skin !== "holographic" && skin !== "fusion_core") return;
  loaded.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const styled = materials.map((mat) => {
      const std = mat.clone() as THREE.MeshStandardMaterial;
      if (skin === "holographic") {
        std.wireframe = true;
        if (std.color) std.color.set("#00f5ff");
        if (std.emissive) std.emissive.set("#00aeff");
        std.transparent = true;
        std.opacity = 0.6;
      } else {
        std.wireframe = false;
        if (std.color) std.color.set("#ff4500");
        if (std.emissive) std.emissive.set("#ff8c00");
        std.transparent = false;
        std.opacity = 1;
      }
      return std;
    });
    mesh.material = Array.isArray(mesh.material) ? styled : (styled[0] ?? mesh.material);
  });
}

export function createStationInteriorScene(
  layout: StationInteriorLayout = buildStationInteriorLayout(),
  opts?: { shipSkin?: string },
): StationInteriorScene {
  const group = new THREE.Group();
  group.name = "station-interior";
  let disposed = false;

  // The true sky: the same real HYG data as the exterior's — seen
  // through the bay door and the deck viewport, never painted on.
  group.add(buildHygStarfield());

  // Warm inhabited light + a low ambient so the dark side of the hall
  // still reads. The key light is amber, like the exterior's hub light.
  const ambient = new THREE.AmbientLight(STATION_PALETTE.indigo, 1.4);
  group.add(ambient);
  const hallLight = new THREE.PointLight(STATION_PALETTE.amber, 600, 300, 1.6);
  hallLight.position.set(-32, 12, 0);
  group.add(hallLight);

  const spaces: InteriorRoom[] = layout.spaces;
  const basalt = basaltMaterial();
  const gunmetal = gunmetalMaterial();

  // Floors + ceilings: the hall's structure. A floor plane under each
  // room (the kit plates are daises, not the floor) and a ceiling
  // plane over each — the hall is roofed; the sky is not the ceiling.
  for (const space of spaces) {
    const [cx, , cz] = space.center;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(space.floor.width, space.floor.depth),
      basalt,
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0, cz);
    floor.name = `interior-floor-${space.id}`;
    group.add(floor);
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(space.floor.width, space.floor.depth),
      basalt,
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(cx, space.ceilingY, cz);
    ceiling.name = `interior-ceiling-${space.id}`;
    group.add(ceiling);
  }

  // Light strips on the ceilings — thin amber bars, the hall's working light.
  {
    const stripGeo = new THREE.BoxGeometry(6, 0.3, 0.8);
    const stripMat = new THREE.MeshBasicMaterial({ color: INTERIOR_WORK_COLOR });
    const strips = new THREE.InstancedMesh(stripGeo, stripMat, INTERIOR_LIGHT_STRIPS.length);
    strips.name = "interior-light-strips";
    const dummy = new THREE.Object3D();
    INTERIOR_LIGHT_STRIPS.forEach((strip, i) => {
      dummy.position.set(strip.position[0], strip.position[1], strip.position[2]);
      dummy.rotation.set(0, strip.rotationY, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      strips.setMatrixAt(i, dummy.matrix);
    });
    strips.instanceMatrix.needsUpdate = true;
    group.add(strips);
  }

  // Wayfinding: cyan nav markers along the hall's centerline — navigation truth, never decoration.
  {
    const markerGeo = new THREE.SphereGeometry(0.35, 8, 6);
    const markerMat = new THREE.MeshBasicMaterial({ color: STATION_PALETTE.cyan, transparent: true });
    const markers = new THREE.InstancedMesh(markerGeo, markerMat, INTERIOR_NAV_MARKERS.length);
    markers.name = "interior-nav-markers";
    const dummy = new THREE.Object3D();
    INTERIOR_NAV_MARKERS.forEach((pos, i) => {
      dummy.position.set(pos[0], pos[1], pos[2]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      markers.setMatrixAt(i, dummy.matrix);
    });
    markers.instanceMatrix.needsUpdate = true;
    group.add(markers);
  }

  // Work lights: small amber points along the ceilings, slow blink rhythm. Reduced motion holds them steady lit.
  const workLightMat = new THREE.MeshBasicMaterial({ color: INTERIOR_WORK_COLOR, transparent: true });
  {
    const lightGeo = new THREE.SphereGeometry(0.5, 6, 4);
    const lights = new THREE.InstancedMesh(lightGeo, workLightMat, INTERIOR_WORK_LIGHTS.length);
    lights.name = "interior-work-lights";
    const dummy = new THREE.Object3D();
    INTERIOR_WORK_LIGHTS.forEach((pos, i) => {
      dummy.position.set(pos[0], pos[1], pos[2]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      lights.setMatrixAt(i, dummy.matrix);
    });
    lights.instanceMatrix.needsUpdate = true;
    group.add(lights);
  }

  // The Station's own gate, industrial and lit, at the main hall's far
  // end: the lintel across the two kit columns the layout places, with
  // cyan nav lights on it — the gate you step through to enter the
  // interior IS the Station's gate.
  {
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(INTERIOR_GATE.halfWidth * 2 + 2, 1, 1), gunmetal);
    lintel.position.set(
      INTERIOR_GATE.center[0],
      INTERIOR_GATE.height,
      INTERIOR_GATE.center[2],
    );
    lintel.name = "interior-gate-lintel";
    group.add(lintel);
    const gateLightGeo = new THREE.SphereGeometry(0.4, 8, 6);
    const gateLightMat = new THREE.MeshBasicMaterial({ color: STATION_PALETTE.cyan, transparent: true });
    const gateLights = new THREE.InstancedMesh(gateLightGeo, gateLightMat, 3);
    gateLights.name = "interior-gate-lights";
    const dummy = new THREE.Object3D();
    [-INTERIOR_GATE.halfWidth, 0, INTERIOR_GATE.halfWidth].forEach((dx, i) => {
      dummy.position.set(INTERIOR_GATE.center[0] + dx, INTERIOR_GATE.height, INTERIOR_GATE.center[2]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      gateLights.setMatrixAt(i, dummy.matrix);
    });
    gateLights.instanceMatrix.needsUpdate = true;
    group.add(gateLights);
  }

  // The bay door's frame and the deck viewport's frame: lintels across
  // the kit columns the layout places, marking the openings in the
  // colonnade — the door you watch ships through, the viewport you
  // watch the rim through.
  {
    const bayLintel = new THREE.Mesh(
      new THREE.BoxGeometry(INTERIOR_BAY_DOOR.halfWidth * 2 + 2, 1, 1),
      gunmetal,
    );
    bayLintel.position.set(
      INTERIOR_BAY_DOOR.center[0],
      INTERIOR_BAY_DOOR.height,
      INTERIOR_BAY_DOOR.center[2],
    );
    bayLintel.name = "interior-bay-door-lintel";
    group.add(bayLintel);
    const deckLintel = new THREE.Mesh(
      new THREE.BoxGeometry(INTERIOR_DECK_VIEWPORT.halfWidth * 2 + 2, 1, 1),
      gunmetal,
    );
    deckLintel.position.set(
      INTERIOR_DECK_VIEWPORT.center[0],
      INTERIOR_DECK_VIEWPORT.height,
      INTERIOR_DECK_VIEWPORT.center[2],
    );
    deckLintel.name = "interior-deck-viewport-lintel";
    group.add(deckLintel);
  }

  // The wheel rim, seen from inside: the Station's own wheel at its
  // real 210-unit radius, a vertical half-arc across the deck's
  // viewport. Gunmetal, like the hull outside.
  {
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(INTERIOR_RIM_ARC.radius, INTERIOR_RIM_ARC.tube, 10, 64, Math.PI),
      gunmetal,
    );
    arc.position.set(
      INTERIOR_RIM_ARC.center[0],
      INTERIOR_RIM_ARC.center[1],
      INTERIOR_RIM_ARC.center[2],
    );
    arc.name = "interior-rim-arc";
    group.add(arc);
  }

  // --- Kit pieces: one InstancedMesh per model, placed from the layout.
  // A model whose GLB has not landed leaves its placements empty — the
  // hall stands without it, honestly. (The load is async; the static
  // half of the budget is measured before any GLB lands.)
  const dummy = new THREE.Object3D();
  {
    const byModel = new Map<string, { position: readonly [number, number, number]; rotationY: number; scale: number }[]>();
    for (const space of spaces) {
      for (const piece of space.pieces) {
        const list = byModel.get(piece.model) ?? [];
        list.push(piece);
        byModel.set(piece.model, list);
      }
    }
    for (const model of INTERIOR_MODELS) {
      const placements = byModel.get(model.key);
      if (!placements || placements.length === 0) continue;
      void loadInteriorAsset(model.url).then((loaded) => {
        if (!loaded || disposed) {
          if (loaded) disposeObject3D(loaded);
          return;
        }
        let single: { geometry: THREE.BufferGeometry; material: THREE.Material } | null = null;
        if (model.treatment === "merge") {
          const merged = mergeToSingleMaterial(loaded, STATION_PALETTE.hullGunmetal);
          // mergeToSingleMaterial builds one MeshStandardMaterial, but
          // Mesh.material is typed as Material | Material[] — take the
          // single material (the merge guarantees exactly one).
          const mergedMat = merged ? merged.material : null;
          single =
            merged && !Array.isArray(mergedMat) && mergedMat
              ? { geometry: merged.geometry, material: mergedMat }
              : null;
        } else {
          single = singleMeshGeometry(loaded);
        }
        if (!single) return;
        const mat = Array.isArray(single.material) ? single.material[0] : single.material;
        if (!mat) return;
        const instanced = new THREE.InstancedMesh(single.geometry, mat, placements.length);
        instanced.name = `interior-${model.key}`;
        group.add(instanced);
        placements.forEach((piece, k) => {
          dummy.position.set(piece.position[0], piece.position[1], piece.position[2]);
          dummy.rotation.set(0, piece.rotationY, 0);
          dummy.scale.setScalar(piece.scale);
          dummy.updateMatrix();
          instanced.setMatrixAt(k, dummy.matrix);
        });
        instanced.instanceMatrix.needsUpdate = true;
      });
    }
  }

  // --- Your ship, floating in the center of the hangar bay (the
  // EVE-style dock-in). The bay's center comes from the layout, so
  // the ship is never placed by a hardcoded number the layout could
  // contradict. A failed load leaves an empty berth — never a faked
  // hull. The ship never moves: the orbit camera moves around it.
  const hangarBay = spaces.find((s) => s.id === "hangar-bay");
  const shipSkin = opts?.shipSkin ?? "default";
  if (hangarBay) {
    void loadInteriorAsset(interiorShipUrlForSkin(shipSkin)).then((loaded) => {
      if (!loaded || disposed) {
        if (loaded) disposeObject3D(loaded);
        return;
      }
      // Her ship loads whole (it is not a single-mesh traffic hull),
      // scaled to bay size and floated so its center sits at the bay's
      // center, 2 units up. A failed load leaves an empty berth.
      styleShipHullForSkin(loaded, shipSkin);
      const box = new THREE.Box3().setFromObject(loaded);
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);
      const scale = 12 / Math.max(0.001, size.x, size.y, size.z);
      loaded.scale.setScalar(scale);
      loaded.position.set(
        hangarBay.center[0] - center.x * scale,
        2 - center.y * scale,
        hangarBay.center[2] - center.z * scale,
      );
      loaded.name = "interior-user-ship";
      group.add(loaded);
    });
  }

  // --- The passing ship outside the bay door: the dispatcher, on its
  // slow lane past the opening. One load, the same geometry as the
  // exterior's docking shuttle. A failed load leaves the lane empty —
  // the door still shows the stars.
  let bayShip: THREE.Mesh | null = null;
  void loadInteriorAsset(INTERIOR_BAY_SHIP.url).then((loaded) => {
    if (!loaded || disposed) {
      if (loaded) disposeObject3D(loaded);
      return;
    }
    const single = singleMeshGeometry(loaded);
    if (!single) return;
    const scale = (() => {
      single.geometry.computeBoundingBox();
      const box = single.geometry.boundingBox;
      if (!box) return 1;
      return 12 / Math.max(0.001, box.max.z - box.min.z);
    })();
    const ship = new THREE.Mesh(single.geometry, single.material);
    ship.name = "interior-bay-ship";
    ship.scale.setScalar(scale);
    const pose = bayShipPose(0);
    ship.position.set(pose.x, pose.y, pose.z);
    ship.rotation.y = pose.heading;
    group.add(ship);
    bayShip = ship;
  });

  const update = (elapsedMs: number, uopts?: { reducedMotion?: boolean }) => {
    const t = uopts?.reducedMotion ? 0 : elapsedMs / 1000;
    // Work lights breathe slowly; reduced motion holds them steady lit.
    workLightMat.opacity = uopts?.reducedMotion ? 0.85 : 0.65 + 0.35 * Math.sin(t * 0.8);
    // The passing ship rides its lane; reduced motion parks it at the
    // door, mid-pass — the same ship, the same information, no motion.
    // The park point is the hangar bay's center X (the door's room).
    if (bayShip) {
      const pose = uopts?.reducedMotion
        ? { x: 64, y: INTERIOR_BAY_LANE.y, z: INTERIOR_BAY_LANE.z, heading: -Math.PI / 2 }
        : bayShipPose(elapsedMs);
      bayShip.position.set(pose.x, pose.y, pose.z);
      bayShip.rotation.y = pose.heading;
    }
  };
  update(0);

  return {
    group,
    update,
    dispose: () => {
      disposed = true;
      disposeObject3D(group);
    },
  };
}
