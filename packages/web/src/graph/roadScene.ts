import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import {
  ROAD,
  ROAD_CHALK_END_Z,
  ROAD_DOORFRAME_Z,
  ROAD_POST_Z,
  ROAD_VIEW_Z,
  roadChalk,
  roadLamps,
  roadNails,
} from "./roadLayout.js";

/**
 * The Road to the Seam (docs/specs/seam-road-to-the-seam-2026-10-31.md): one long road under the Station — a flat lane between two rock walls under an open dark, lamps hung at even
 * spacing, a nail set in the right wall every stride (each faintly warm), chalk strokes low on the left wall at a child's height that stop partway, an empty door-frame, an empty
 * Wardens' post with a worn bench, and the road going on into fog. Procedural, no downloads. No text anywhere (chalk is strokes), no figure, and nothing ever shows where the road ends or
 * where anyone went. Named holders anchor the places, spots and passages; invisible proxy boxes give instanced things a bounding box. Reduced motion holds the lamps still.
 *
 * Draw-call sketch (host budget ≤ 95): floor 1 · walls 2 · lamp cores 1 · lamp glows 1 · nails 1 · chalk 1 · door-frame 3 · post+bench 3 · mouth 2 · far 1 ≈ 16.
 */
export interface RoadScene {
  group: THREE.Group;
  update: (elapsedMs: number, opts?: { reducedMotion?: boolean }) => void;
  dispose: () => void;
}

const C = { floor: 0x3c4049, wall: 0x4a505c, lamp: 0xffc86a, nail: 0xffb070, chalk: 0xf2efe6, frame: 0x6a5c4a, post: 0x4a4f58, bench: 0x5e4a38 };

const proxy = (name: string, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
  m.name = name;
  m.position.set(x, y, z);
  m.visible = false; // never drawn; only gives the holder a bounding box for places and spots
  return m;
};

export function createRoadScene(): RoadScene {
  const raw = new THREE.Group();
  const length = ROAD.zEnd - ROAD.zStart;
  const midZ = (ROAD.zEnd + ROAD.zStart) / 2;
  const dummy = new THREE.Object3D();

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROAD.halfWidth * 2, length), new THREE.MeshStandardMaterial({ color: C.floor, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, midZ);
  floor.name = "road-floor";
  raw.add(floor);
  const wallMat = new THREE.MeshStandardMaterial({ color: C.wall, roughness: 1, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(length, ROAD.wallHeight), wallMat);
    wall.rotation.y = Math.PI / 2;
    wall.position.set(side * (ROAD.halfWidth + 2), ROAD.wallHeight / 2, midZ);
    wall.name = `road-wall-${side < 0 ? "left" : "right"}`;
    raw.add(wall);
  }

  // Lamps: a warm core and a soft glow, instanced.
  const lamps = roadLamps();
  const lampGlowMat = new THREE.MeshBasicMaterial({ color: C.lamp, transparent: true, opacity: 0.17, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const cores = new THREE.InstancedMesh(new THREE.SphereGeometry(3.4, 8, 6), new THREE.MeshBasicMaterial({ color: C.lamp, toneMapped: false }), lamps.length);
  const glows = new THREE.InstancedMesh(new THREE.SphereGeometry(18, 10, 8), lampGlowMat, lamps.length);
  lamps.forEach((l, i) => {
    dummy.position.set(l.x, l.y, l.z);
    dummy.updateMatrix();
    cores.setMatrixAt(i, dummy.matrix);
    glows.setMatrixAt(i, dummy.matrix);
  });
  cores.name = "road-lamp-cores";
  glows.name = "road-lamp-glows";
  raw.add(cores, glows);
  raw.add(proxy("road-lamps", ROAD.halfWidth * 2, 8, 360, 0, 56, 60 + 180));

  // Nails: one every stride on the right wall, each faintly warm.
  const nails = roadNails();
  const nailMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.1, 1.1, 6, 6), new THREE.MeshBasicMaterial({ color: C.nail, toneMapped: false }), nails.length);
  nails.forEach((n, i) => {
    dummy.position.set(n.x - 2, n.y, n.z);
    dummy.rotation.set(0, 0, Math.PI / 2);
    dummy.updateMatrix();
    nailMesh.setMatrixAt(i, dummy.matrix);
  });
  dummy.rotation.set(0, 0, 0);
  nailMesh.name = "road-nail-heads";
  raw.add(nailMesh);
  raw.add(proxy("road-nails", 6, 30, 240, ROAD.halfWidth - 3, 44, 40 + 120));

  // Chalk: short strokes low on the left wall, in groups; they stop at the chalk end.
  const chalk = roadChalk();
  const strokes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 5, 0.5), new THREE.MeshBasicMaterial({ color: C.chalk, transparent: true, opacity: 0.8, toneMapped: false }), chalk.length);
  chalk.forEach((m, i) => {
    dummy.position.set(-ROAD.halfWidth - 0.3, m.y, m.z);
    dummy.rotation.set(m.tilt, 0, 0);
    dummy.updateMatrix();
    strokes.setMatrixAt(i, dummy.matrix);
  });
  dummy.rotation.set(0, 0, 0);
  strokes.name = "road-chalk-strokes";
  raw.add(strokes);
  raw.add(proxy("road-chalk", 3, 30, 200, -ROAD.halfWidth, 16, 240));
  raw.add(proxy("road-chalk-end", 3, 30, 30, -ROAD.halfWidth, 16, ROAD_CHALK_END_Z));

  // The mouth: a plain arch of stone where the road leaves the Station.
  const mouth = new THREE.Group();
  mouth.name = "road-mouth";
  const arch = new THREE.Mesh(new THREE.TorusGeometry(ROAD.halfWidth, 3, 6, 22, Math.PI), new THREE.MeshStandardMaterial({ color: C.frame, roughness: 0.9 }));
  arch.position.set(0, 0, -110);
  mouth.add(arch);
  const glowDisc = new THREE.Mesh(new THREE.CircleGeometry(ROAD.halfWidth - 2, 22, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0xcfe0f0, transparent: true, opacity: 0.25, side: THREE.DoubleSide, toneMapped: false }));
  glowDisc.position.set(0, 0, -109);
  mouth.add(glowDisc);
  raw.add(mouth);

  // An empty door-frame standing by the right wall: nothing in it, nothing through it.
  const frame = new THREE.Group();
  frame.name = "road-doorframe";
  const fm = new THREE.MeshStandardMaterial({ color: C.frame, roughness: 0.85 });
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(4, 62, 4), fm);
    post.position.set(sx * 17, 31, 0);
    frame.add(post);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(38, 4, 4), fm);
  lintel.position.set(0, 64, 0);
  frame.add(lintel);
  frame.position.set(ROAD.halfWidth - 24, 0, ROAD_DOORFRAME_Z);
  raw.add(frame);

  // The Wardens' post: an empty post and a worn bench.
  const post = new THREE.Group();
  post.name = "road-post";
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 56, 8), new THREE.MeshStandardMaterial({ color: C.post, roughness: 0.7, metalness: 0.3 }));
  pillar.position.set(0, 28, 0);
  post.add(pillar);
  const bench = new THREE.Mesh(new THREE.BoxGeometry(34, 4, 12), new THREE.MeshStandardMaterial({ color: C.bench, roughness: 1 }));
  bench.position.set(12, 14, 0);
  post.add(bench);
  const benchLeg = new THREE.Mesh(new THREE.BoxGeometry(30, 12, 3), new THREE.MeshStandardMaterial({ color: C.bench, roughness: 1 }));
  benchLeg.position.set(12, 7, -4);
  post.add(benchLeg);
  post.position.set(-ROAD.halfWidth + 22, 0, ROAD_POST_Z);
  raw.add(post);

  // The far end: a faint pale light the road leads toward and never reaches.
  const far = new THREE.Mesh(new THREE.SphereGeometry(24, 12, 10), new THREE.MeshBasicMaterial({ color: 0xdfe8f0, transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  far.name = "road-far";
  far.position.set(0, 50, ROAD.zEnd - 140);
  raw.add(far);

  // Centre the host's orbit (the world origin) on the road a little way in, between the walls.
  const group = new THREE.Group();
  group.name = "road-to-the-seam";
  raw.name = "road-hall";
  raw.position.z = -ROAD_VIEW_Z;
  group.add(raw);

  const update = (ms: number, opts?: { reducedMotion?: boolean }) => {
    lampGlowMat.opacity = opts?.reducedMotion ? 0.17 : 0.17 + Math.sin(ms / 1000 * 0.8) * 0.03;
  };
  return { group, update, dispose: () => disposeObject3D(group) };
}
