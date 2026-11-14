import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import { glowTexture, softGlowPoints } from "./softGlow.js";
import { dustMotes, groundMist, lanternGeometry, lightPools, postGeometry, rockWall, rolledGround, surfaceMaterial } from "./worldCraft.js";
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
 * The Road to the Seam (docs/specs/seam-road-to-the-seam-2026-10-31.md; look: docs/specs/worlds-redesign-2026-11-14.md §Road): one long road under the Station — a cut between two
 * walls of broken rock, a paved lane worn pale down its middle, iron lanterns on brackets at even spacing each throwing a pool of warm light on the stone, a nail set in the right wall
 * every stride (each faintly warm), chalk strokes low on the left wall at a child's height that stop partway, an empty door-frame, an empty Wardens' post with a worn bench, and the
 * road going on into mist. High overhead the Station's underside hangs as a dark shape with a few far lights — the road is UNDER something. Procedural, no downloads. No text anywhere
 * (chalk is strokes), no figure, and nothing ever shows where the road ends or where anyone went. Named holders anchor the places, spots and passages; invisible proxy boxes give
 * instanced things a bounding box. Reduced motion holds the lamps, the dust and the mist still.
 *
 * Draw-call sketch (host budget ≤ 95; this scene's own test pins ≤ 30 meshes): floor 1 · walls 2 · scree 1 · brackets 1 · lanterns 1 · cores 1 · pools 1 · wall-wash 1 · nails 1 ·
 * chalk 1 · mouth 3 · door-frame 4 · post+bench 4 · far 1 · station underside 1 ≈ 25 meshes, plus 5 point sets (glows, nail glints, dust, mist, far lights).
 */
export interface RoadScene {
  group: THREE.Group;
  update: (elapsedMs: number, opts?: { reducedMotion?: boolean }) => void;
  dispose: () => void;
}

const C = { lamp: 0xffc070, lampDeep: 0xff9440, nail: 0xffb070, chalk: 0xf2efe6, iron: 0x1c1d22, mist: 0x8a94a8, far: 0xdfe8f0 };

const proxy = (name: string, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
  m.name = name;
  m.position.set(x, y, z);
  m.visible = false; // never drawn; only gives the holder a bounding box for places and spots
  return m;
};

/** Small deterministic generator for scatter (scree, voussoirs) — fixed, so the road is the same road every visit. */
const rng = (seed: number) => {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
};

export function createRoadScene(): RoadScene {
  const raw = new THREE.Group();
  const length = ROAD.zEnd - ROAD.zStart;
  const midZ = (ROAD.zEnd + ROAD.zStart) / 2;
  const dummy = new THREE.Object3D();
  const W = ROAD.halfWidth;

  // The lane: laid stone, dead flat where anyone walks, lifting a little into the wall foot. A paler worn track runs down the middle (vertex colour) — the road has been used.
  const floorGeo = rolledGround(W * 2 + 60, length, { amp: 5, seed: 3, texScale: 38, segments: 14, flat: (x) => Math.min(1, Math.max(0, (Math.abs(x) - W * 0.9) / (W * 0.25))) });
  {
    const pos = floorGeo.getAttribute("position");
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const ax = Math.abs(pos.getX(i)) / W;
      const worn = Math.max(0, 1 - ax / 0.4); // the middle of the lane
      const edge = Math.min(1, Math.max(0, (ax - 0.7) / 0.3)); // dark under the walls
      const v = 0.62 + worn * 0.38 - edge * 0.34;
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
    }
    floorGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  }
  const floor = new THREE.Mesh(floorGeo, surfaceMaterial("flagstone", { vertexColors: true, tint: 0x6e6c70, roughness: 0.9 }));
  floor.position.set(0, 0, midZ);
  floor.name = "road-floor";
  raw.add(floor);

  // The walls: broken rock, leaning back as they rise, with an uneven crest against the sky. Two different seeds, so the cut is not a mirror.
  const wallMat = surfaceMaterial("rock", { vertexColors: true, tint: 0xc4c6d2, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(rockWall(length, ROAD.wallHeight, { depth: 13, seed: side < 0 ? 21 : 57, lean: 0.14 }), wallMat);
    wall.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2; // face the lane
    wall.position.set(side * (W + 16), 0, midZ);
    wall.name = `road-wall-${side < 0 ? "left" : "right"}`;
    raw.add(wall);
  }

  // Scree along both wall feet: fallen stone hides the line where wall meets floor and breaks the lane's edge.
  const next = rng(40127);
  const screeCount = 260;
  const scree = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), surfaceMaterial("rock", { tint: 0x8e9098 }), screeCount);
  for (let i = 0; i < screeCount; i++) {
    const side = i % 2 ? 1 : -1;
    const s = 2.5 + next() * next() * 11;
    dummy.position.set(side * (W - 2 - next() * 16), s * 0.3, ROAD.zStart + 40 + next() * (length - 200));
    dummy.rotation.set(next() * 3, next() * 3, next() * 3);
    dummy.scale.set(s * (0.8 + next() * 0.6), s * (0.5 + next() * 0.4), s * (0.8 + next() * 0.6));
    dummy.updateMatrix();
    scree.setMatrixAt(i, dummy.matrix);
  }
  dummy.rotation.set(0, 0, 0);
  dummy.scale.set(1, 1, 1);
  scree.name = "road-scree";
  raw.add(scree);

  // Lamps: an iron bracket out of the wall, a lantern hanging from it, a warm core inside, a soft glow round it, a pool of light on the stone below and a wash up the wall behind.
  const lamps = roadLamps();
  const iron = new THREE.MeshStandardMaterial({ color: C.iron, roughness: 0.6, metalness: 0.7 });
  const arm = 18; // how far the bracket carries the lantern off the wall
  const brackets = new THREE.InstancedMesh(new THREE.BoxGeometry(arm + 8, 1.6, 1.6), iron, lamps.length);
  const lanterns = new THREE.InstancedMesh(lanternGeometry(15), iron, lamps.length);
  const cores = new THREE.InstancedMesh(new THREE.SphereGeometry(2.6, 8, 6), new THREE.MeshBasicMaterial({ color: C.lamp, toneMapped: false }), lamps.length);
  const hang: { x: number; y: number; z: number }[] = [];
  lamps.forEach((l, i) => {
    const inward = l.x < 0 ? 1 : -1;
    const hx = l.x + inward * arm;
    dummy.position.set(l.x + inward * (arm / 2 - 4), l.y + 10, l.z);
    dummy.updateMatrix();
    brackets.setMatrixAt(i, dummy.matrix);
    dummy.position.set(hx, l.y + 9.5, l.z);
    dummy.updateMatrix();
    lanterns.setMatrixAt(i, dummy.matrix);
    dummy.position.set(hx, l.y, l.z);
    dummy.updateMatrix();
    cores.setMatrixAt(i, dummy.matrix);
    hang.push({ x: hx, y: l.y, z: l.z });
  });
  brackets.name = "road-lamp-brackets";
  lanterns.name = "road-lamp-lanterns";
  cores.name = "road-lamp-cores";
  const glows = softGlowPoints(hang, C.lamp, 46, 0.6, "road-lamp-glows");
  const lampGlowMat = glows.material as THREE.PointsMaterial;
  // The pool lies a little toward the middle of the lane, clear of the scree, so it is seen on the paving.
  const pools = lightPools(hang.map((p) => ({ x: p.x * 0.72, z: p.z })), C.lampDeep, 120, 0.5, "road-lamp-pools");
  // The wash on the wall behind each lamp: the same soft disc, stood up against the rock.
  const wash = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), (pools.material as THREE.Material).clone(), lamps.length);
  (wash.material as THREE.MeshBasicMaterial).opacity = 0.34;
  (wash.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
  lamps.forEach((l, i) => {
    const inward = l.x < 0 ? 1 : -1;
    dummy.position.set(l.x + inward * 5, l.y + 4, l.z);
    dummy.rotation.set(0, (inward * Math.PI) / 2, 0);
    dummy.scale.set(62, 74, 1);
    dummy.updateMatrix();
    wash.setMatrixAt(i, dummy.matrix);
  });
  dummy.rotation.set(0, 0, 0);
  dummy.scale.set(1, 1, 1);
  wash.name = "road-lamp-wash";
  wash.frustumCulled = false;
  wash.renderOrder = 2;
  raw.add(brackets, lanterns, cores, glows, pools, wash);
  raw.add(proxy("road-lamps", W * 2, 8, 360, 0, 64, 60 + 180));

  // Real light for the stretch the visitor stands in (the rest is carried by pools and wash): the four lamps nearest the view, so the rock and paving take true, normal-mapped light.
  const nearest = [...hang].sort((a, b) => Math.abs(a.z - ROAD_VIEW_Z) - Math.abs(b.z - ROAD_VIEW_Z)).slice(0, 4);
  for (const n of nearest) {
    const p = new THREE.PointLight(C.lamp, 1500, 420, 1.6);
    p.position.set(n.x, n.y, n.z);
    raw.add(p);
  }

  // Nails: one every stride on the right wall — a dark iron head with a faint warm point on it.
  const nails = roadNails();
  const nailMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.1, 0.7, 3.2, 6), new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 0.5, metalness: 0.8, emissive: C.nail, emissiveIntensity: 0.12 }), nails.length);
  const nailTips: { x: number; y: number; z: number }[] = [];
  nails.forEach((n, i) => {
    dummy.position.set(n.x - 3, n.y, n.z);
    dummy.rotation.set(0, 0, Math.PI / 2);
    dummy.updateMatrix();
    nailMesh.setMatrixAt(i, dummy.matrix);
    nailTips.push({ x: n.x - 5, y: n.y, z: n.z });
  });
  dummy.rotation.set(0, 0, 0);
  nailMesh.name = "road-nail-heads";
  raw.add(nailMesh, softGlowPoints(nailTips, C.nail, 7, 0.5, "road-nail-glints"));
  raw.add(proxy("road-nails", 6, 30, 240, W - 3, 50, 40 + 120));

  // Chalk: short strokes low on the left wall, in groups; they stop at the chalk end.
  const chalk = roadChalk();
  const strokes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 4.2, 0.55), new THREE.MeshBasicMaterial({ color: C.chalk, transparent: true, opacity: 0.5, toneMapped: false }), chalk.length);
  chalk.forEach((m, i) => {
    dummy.position.set(-W + 1.5, m.y, m.z);
    dummy.rotation.set(m.tilt * 2.2, 0, 0);
    dummy.updateMatrix();
    strokes.setMatrixAt(i, dummy.matrix);
  });
  dummy.rotation.set(0, 0, 0);
  strokes.name = "road-chalk-strokes";
  raw.add(strokes);
  raw.add(proxy("road-chalk", 3, 30, 200, -W, 16, 240));
  raw.add(proxy("road-chalk-end", 3, 30, 30, -W, 16, ROAD_CHALK_END_Z));

  // The mouth: an arch of cut stones (voussoirs) where the road leaves the Station, with the Station's pale light standing in it.
  const mouth = new THREE.Group();
  mouth.name = "road-mouth";
  const stones = 17;
  const voussoirs = new THREE.InstancedMesh(new THREE.BoxGeometry(24, 22, 26), surfaceMaterial("flagstone", { tint: 0xa8a39a, repeat: [0.4, 0.4] }), stones + 6);
  for (let i = 0; i < stones; i++) {
    const a = (i / (stones - 1)) * Math.PI;
    dummy.position.set(Math.cos(a) * (W + 6), Math.sin(a) * (W + 6), -110);
    dummy.rotation.set(0, 0, a + Math.PI / 2);
    dummy.scale.setScalar(i === (stones - 1) / 2 ? 1.25 : 0.94 + (i % 3) * 0.05); // a heavier keystone
    dummy.updateMatrix();
    voussoirs.setMatrixAt(i, dummy.matrix);
  }
  for (let i = 0; i < 6; i++) {
    // Footing blocks either side, so the arch stands on something.
    dummy.position.set((i % 2 ? 1 : -1) * (W + 8 + Math.floor(i / 2) * 3), -6 + Math.floor(i / 2) * 2, -110 - Math.floor(i / 2) * 4);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1.5 - Math.floor(i / 2) * 0.12, 0.9, 1.3);
    dummy.updateMatrix();
    voussoirs.setMatrixAt(stones + i, dummy.matrix);
  }
  dummy.rotation.set(0, 0, 0);
  dummy.scale.set(1, 1, 1);
  mouth.add(voussoirs);
  // The Station's light standing in the mouth: a soft pale bloom (no hard edge) and its spill on the paving just inside.
  const glowDisc = new THREE.Mesh(new THREE.PlaneGeometry(W * 3.2, W * 2.6), new THREE.MeshBasicMaterial({ color: 0xbfd4ee, map: glowTexture(), transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  glowDisc.position.set(0, W * 0.35, -118);
  mouth.add(glowDisc);
  mouth.add(lightPools([{ x: 0, z: -70 }], 0xbfd4ee, 150, 0.3, "road-mouth-spill"));
  raw.add(mouth);

  // An empty door-frame standing by the right wall: weathered timber on a stone sill — nothing in it, nothing through it.
  const frame = new THREE.Group();
  frame.name = "road-doorframe";
  const timber = surfaceMaterial("wood", { tint: 0xb8a48c, repeat: [1, 0.25] });
  const jamb = new THREE.InstancedMesh(new THREE.BoxGeometry(4, 64, 4.5), timber, 2);
  [-17, 17].forEach((x, i) => {
    dummy.position.set(x, 32, 0);
    dummy.rotation.set(0, 0, i ? 0.012 : -0.02); // it has stood a long time; nothing is quite plumb
    dummy.updateMatrix();
    jamb.setMatrixAt(i, dummy.matrix);
  });
  dummy.rotation.set(0, 0, 0);
  frame.add(jamb);
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(46, 5.5, 6), timber);
  lintel.position.set(0, 66, 0);
  lintel.rotation.z = 0.01;
  frame.add(lintel);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(48, 3, 14), surfaceMaterial("flagstone", { tint: 0xb0aca6, repeat: [0.5, 0.2] }));
  sill.position.set(0, 1.5, 0);
  frame.add(sill);
  frame.scale.setScalar(1.8);
  frame.position.set(W - 50, 0, ROAD_DOORFRAME_Z);
  raw.add(frame);

  // The Wardens' post: a turned iron post with an empty lantern hook, and a worn bench beside it.
  const post = new THREE.Group();
  post.name = "road-post";
  const pillar = new THREE.Mesh(postGeometry(2.4, 58), new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.55, metalness: 0.75 }));
  post.add(pillar);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(4, 0.6, 5, 12, Math.PI * 1.4), iron);
  hook.position.set(4, 55, 0);
  post.add(hook);
  const benchWood = surfaceMaterial("wood", { tint: 0xa48a70, repeat: [1, 0.4] });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(36, 2.6, 12), benchWood);
  seat.position.set(14, 14, 0);
  seat.rotation.z = -0.012; // sat on at one end for years
  post.add(seat);
  const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 13, 10), benchWood, 2);
  [0, 28].forEach((x, i) => {
    dummy.position.set(x, 6.5, 0);
    dummy.updateMatrix();
    legs.setMatrixAt(i, dummy.matrix);
  });
  post.add(legs);
  post.scale.setScalar(1.8);
  post.position.set(-W + 50, 0, ROAD_POST_Z);
  raw.add(post);

  // The far end: a faint pale light the road leads toward and never reaches.
  const far = new THREE.Mesh(new THREE.SphereGeometry(24, 12, 10), new THREE.MeshBasicMaterial({ color: C.far, transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  far.name = "road-far";
  far.position.set(0, 50, ROAD.zEnd - 140);
  raw.add(far);

  // Overhead: the Station's underside, a vast dark shape across part of the sky with a few far lights on it. The road runs UNDER something; this is what says so.
  const under = new THREE.Mesh(new THREE.CylinderGeometry(2600, 2300, 160, 40, 1, false), new THREE.MeshBasicMaterial({ color: 0x06070b, fog: false }));
  under.name = "road-station-underside";
  under.position.set(-1500, 1750, 300);
  under.rotation.z = 0.06;
  raw.add(under);
  const farLights: { x: number; y: number; z: number }[] = [];
  const nl = rng(9917);
  for (let i = 0; i < 46; i++) {
    const a = nl() * Math.PI * 2;
    const r = 500 + nl() * 1700;
    farLights.push({ x: -1500 + Math.cos(a) * r, y: 1660, z: 300 + Math.sin(a) * r });
  }
  const stationLights = softGlowPoints(farLights, 0xffd9a8, 34, 0.75, "road-station-lights");
  (stationLights.material as THREE.PointsMaterial).fog = false;
  raw.add(stationLights);

  // Air: dust in the lamplight where the visitor stands, and low mist lying along the lane.
  const dust = dustMotes({ min: [-W + 10, 4, ROAD_VIEW_Z - 260], max: [W - 10, 120, ROAD_VIEW_Z + 420] }, 180, 0xffe0b0, 2.2, 0.5, "road-dust");
  const mistAt: { x: number; y: number; z: number }[] = [];
  for (let z = 120; z < ROAD.zEnd; z += 150) mistAt.push({ x: ((z / 150) % 2 ? 1 : -1) * 34, y: 10, z });
  const mist = groundMist(mistAt, C.mist, 300, 0.07, "road-mist");
  raw.add(dust.object, mist.object);

  // Centre the host's orbit (the world origin) on the road a little way in, between the walls.
  const group = new THREE.Group();
  group.name = "road-to-the-seam";
  raw.name = "road-hall";
  raw.position.z = -ROAD_VIEW_Z;
  group.add(raw);

  const update = (ms: number, opts?: { reducedMotion?: boolean }) => {
    lampGlowMat.opacity = opts?.reducedMotion ? 0.6 : 0.6 + Math.sin((ms / 1000) * 0.8) * 0.08;
    dust.update(ms, opts?.reducedMotion);
    mist.update(ms, opts?.reducedMotion);
  };
  return { group, update, dispose: () => disposeObject3D(group) };
}
