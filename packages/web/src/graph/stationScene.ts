import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import {
  STATION_PALETTE,
  STATION_SEED,
  STATION_WHEEL_RADIUS,
  beaconRing,
  rngFromSeed,
  trafficLanes,
} from "./stationLayout.js";
import { loadProfondoHull } from "./profondoHull.js";

/**
 * The Great Station scene (Phase 2, P2-3): three.js wiring over the
 * pure layout in stationLayout.ts. The hull is a SEAM — Gate 0 swaps
 * the procedural proxy for the converted Profondo model through the
 * `hull` option without touching anything else here. Everything else
 * is the accessory layer the owner directed (D-37): beacon ring,
 * docking lights, ambient traffic, starfield — designed to bring the
 * hull to life under the recipe's palette grammar.
 *
 * The host owns the renderer, camera, and fog (palette-matched
 * FogExp2 in indigo, per the adopted technique stack); this module
 * owns the station group and its per-frame motion. Traffic and pulses
 * freeze under reduced motion.
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

function starfield(seed: string, count = 1500): THREE.Points {
  const rnd = rngFromSeed(`${seed}:stars`);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const warm = new THREE.Color(STATION_PALETTE.starWarm);
  const cold = new THREE.Color(STATION_PALETTE.starCold);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // Seeded scaffold distribution — the measured HYG subset replaces
    // this at Gate 0 without changing the scene's shape.
    const r = 3800 + rnd() * 600;
    const theta = rnd() * Math.PI * 2;
    const y = (rnd() * 2 - 1) * 0.6;
    const rxz = Math.sqrt(Math.max(0, 1 - y * y));
    pos.set([Math.cos(theta) * rxz * r, y * r, Math.sin(theta) * rxz * r], i * 3);
    c.copy(rnd() > 0.5 ? warm : cold).multiplyScalar(0.55 + rnd() * 0.45);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true });
  return new THREE.Points(geo, mat);
}

export function createStationScene(opts: { hull?: THREE.Object3D } = {}): StationScene {
  const group = new THREE.Group();
  // The proxy form is the standing backup (D-37): it renders
  // immediately, and the real Profondo hull swaps in when it loads —
  // the app's model pattern. A failed load keeps the proxy and is
  // registered as a model fallback (see profondoHull.ts).
  const proxy = proxyHull();
  group.add(opts.hull ?? proxy);
  let disposed = false;
  if (!opts.hull) {
    void loadProfondoHull().then((hull) => {
      if (!hull) return;
      if (disposed) {
        disposeObject3D(hull);
        return;
      }
      group.remove(proxy);
      disposeObject3D(proxy);
      group.add(hull);
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
  const makeBeaconMesh = (role: "nav" | "work", color: number) => {
    const items = ring.filter((b) => b.role === role);
    const mesh = new THREE.InstancedMesh(
      beaconGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true }),
      items.length,
    );
    const m = new THREE.Matrix4();
    items.forEach((b, i) => {
      m.setPosition(b.x, b.y, b.z);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    return mesh;
  };
  const navBeacons = makeBeaconMesh("nav", STATION_PALETTE.cyan);
  const workBeacons = makeBeaconMesh("work", STATION_PALETTE.amber);

  // Traffic: small craft on the layout's lanes, instanced as one mesh.
  const lanes = trafficLanes(STATION_SEED);
  const CRAFT_PER_LANE = 3;
  const traffic = new THREE.InstancedMesh(
    new THREE.BoxGeometry(7, 2, 3),
    new THREE.MeshBasicMaterial({ color: STATION_PALETTE.amberDim }),
    lanes.length * CRAFT_PER_LANE,
  );
  group.add(traffic);
  group.add(starfield(STATION_SEED));

  const dummy = new THREE.Object3D();
  const update = (elapsedMs: number, uopts?: { reducedMotion?: boolean }) => {
    const t = uopts?.reducedMotion ? 0 : elapsedMs / 1000;
    // Gentle beacon breathing; nav and work offset by half a cycle.
    (navBeacons.material as THREE.MeshBasicMaterial).opacity = 0.75 + 0.25 * Math.sin(t * 1.4);
    (workBeacons.material as THREE.MeshBasicMaterial).opacity = 0.7 + 0.3 * Math.sin(t * 1.4 + Math.PI);
    let idx = 0;
    for (const lane of lanes) {
      for (let k = 0; k < CRAFT_PER_LANE; k++) {
        const angle = lane.phase + (k * Math.PI * 2) / CRAFT_PER_LANE + t * lane.speed;
        dummy.position.set(Math.cos(angle) * lane.radius, lane.y, Math.sin(angle) * lane.radius);
        dummy.rotation.set(0, -angle + (lane.speed >= 0 ? 0 : Math.PI), 0);
        dummy.updateMatrix();
        traffic.setMatrixAt(idx++, dummy.matrix);
      }
    }
    traffic.instanceMatrix.needsUpdate = true;
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
