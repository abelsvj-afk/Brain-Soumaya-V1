import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import { glowTexture, softGlowPoints } from "./softGlow.js";
import { dustMotes, groundMist, horizonGlow, lightPools, rolledGround, surfaceMaterial } from "./worldCraft.js";
import { VILLAGE, VILLAGE_CHAIR_Z, VILLAGE_DOOR_Z, VILLAGE_GATE_Z, VILLAGE_SQUARE_Z, VILLAGE_VIEW_Z, VILLAGE_WELL_Z, villageHooks, villageHouses } from "./villageLayout.js";

/**
 * The Village (docs/specs/seam-the-forty-second-2026-10-31.md): a small hillside village at night — dark houses with every window lit, a gate where a count was kept, a hearth in the square,
 * a well with two ropes, a chair set outside one door, bread cooling on a sill, and a path of small gold hooks climbing to a tall luminous doorway. Procedural, no downloads. No figure, no text; nothing
 * beyond the doorway is shown and nothing says whether anyone was right. Named holders anchor places, spots and passages (invisible proxy boxes give instanced things a box). Reduced motion holds the windows still.
 *
 * Draw-call sketch (host budget ≤ 95): ground 1 · houses 1 · roofs 1 · windows 1 · hooks 1 · gate 3 · well 3 · chair 2 · hearth 2 · door 2 · bread 1 ≈ 18.
 */
export interface VillageScene {
  group: THREE.Group;
  update: (elapsedMs: number, opts?: { reducedMotion?: boolean }) => void;
  dispose: () => void;
}

const C = { ground: 0x1c2a22, house: 0x3a3f4a, roof: 0x4a3a34, window: 0xffc86a, hook: 0xffd98a, stone: 0x6a6e76, wood: 0x6a4a30, door: 0xcfe6ff, doorLight: 0xffeec0, ember: 0xff9a4a };

const proxy = (name: string, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
  m.name = name;
  m.position.set(x, y, z);
  m.visible = false;
  return m;
};

export function createVillageScene(): VillageScene {
  const raw = new THREE.Group();
  const dummy = new THREE.Object3D();
  const length = VILLAGE.zEnd - VILLAGE.zStart;

  // The hill: rolling night turf reaching well past the houses (no edge in sight), dead flat down the way and in the square so everything sits true (look: docs/specs/worlds-redesign-2026-11-14.md).
  const ground = new THREE.Mesh(
    rolledGround(VILLAGE.halfWidth * 6, length * 2.4, { amp: 16, seed: 23, texScale: 120, segments: 56, flat: (x) => Math.min(1, Math.max(0, (Math.abs(x) - 380) / 500)) }),
    surfaceMaterial("grass", { tint: 0x5c7a66 }),
  );
  ground.position.set(0, 0, (VILLAGE.zEnd + VILLAGE.zStart) / 2);
  ground.name = "village-ground";
  raw.add(ground);

  // The way through the village: trodden earth, paler than the turf, from the gate through the square and on up toward the doorway.
  const way = new THREE.Mesh(new THREE.PlaneGeometry(24, length), surfaceMaterial("soil", { tint: 0x9a9a84, repeat: [0.3, length / 80] }));
  way.rotation.x = -Math.PI / 2;
  way.position.set(0, 0.5, (VILLAGE.zEnd + VILLAGE.zStart) / 2);
  way.name = "village-way";
  raw.add(way);

  // Houses: limewashed walls under pitched roofs, instanced; every window lit, each throwing its light on the ground outside.
  const houses = villageHouses();
  const bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), surfaceMaterial("plaster", { tint: 0x9aa0b0, repeat: [0.7, 0.5] }), houses.length);
  // A true pitched roof (a ridge along the house) with eaves — the four-sided cone read as a tent.
  const gable = new THREE.Shape();
  gable.moveTo(-0.5, 0);
  gable.lineTo(0.5, 0);
  gable.lineTo(0, 1);
  gable.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(gable, { depth: 1, bevelEnabled: false });
  roofGeo.translate(0, 0, -0.5);
  const roofs = new THREE.InstancedMesh(roofGeo, surfaceMaterial("wood", { tint: 0x8a6a58, repeat: [1.5, 1.5] }), houses.length);
  const panes = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: C.window, side: THREE.DoubleSide, toneMapped: false }), houses.length * 2);
  const spill: { x: number; z: number }[] = [];
  const wall = new THREE.Color();
  const WALLS = [0xffffff, 0xe6e0d4, 0xd8dce6, 0xf0e6d6];
  const windowPts: { x: number; y: number; z: number }[] = [];
  houses.forEach((h, i) => {
    dummy.position.set(h.x, h.h / 2, h.z);
    dummy.rotation.set(0, h.yaw, 0);
    dummy.scale.set(h.w, h.h, h.d);
    dummy.updateMatrix();
    bodies.setMatrixAt(i, dummy.matrix);
    bodies.setColorAt(i, wall.setHex(WALLS[i % WALLS.length]!));
    dummy.position.set(h.x, h.h, h.z);
    dummy.rotation.set(0, h.yaw, 0);
    dummy.scale.set(h.w * 1.14, h.h * 0.6, h.d * 1.12);
    dummy.updateMatrix();
    roofs.setMatrixAt(i, dummy.matrix);
    // Two lit windows on the face toward the way.
    const face = h.x < 0 ? 1 : -1;
    [-0.22, 0.22].forEach((dz, k) => {
      const wx = h.x + face * (h.w / 2 + 0.6);
      windowPts.push({ x: wx, y: h.h * 0.55, z: h.z + dz * h.d });
      dummy.position.set(wx, h.h * 0.55, h.z + dz * h.d);
      dummy.rotation.set(0, Math.PI / 2, 0);
      dummy.scale.set(h.d * 0.16, h.h * 0.24, 1);
      dummy.updateMatrix();
      panes.setMatrixAt(i * 2 + k, dummy.matrix);
    });
    spill.push({ x: h.x + face * (h.w / 2 + 34), z: h.z });
  });
  panes.name = "village-window-panes";
  raw.add(panes, lightPools(spill, 0xffb060, 62, 0.42, "village-window-spill"));
  dummy.rotation.set(0, 0, 0);
  dummy.scale.set(1, 1, 1);
  bodies.name = "village-houses";
  roofs.name = "village-roofs";
  raw.add(bodies, roofs);
  const windows = softGlowPoints(windowPts, C.window, 30, 0.8, "village-window-glows");
  const windowMat = windows.material as THREE.PointsMaterial;
  raw.add(windows);
  raw.add(proxy("village-windows", 400, 30, 1100, 0, 18, 650));

  // The gate: two stone posts and a bar, where a count was kept.
  const gate = new THREE.Group();
  gate.name = "village-gate";
  const stone = surfaceMaterial("flagstone", { tint: 0xb0b2ba, repeat: [0.5, 0.5] });
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(10, 60, 10), stone);
    p.position.set(sx * 46, 30, 0);
    gate.add(p);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(100, 6, 8), new THREE.MeshStandardMaterial({ color: C.wood, roughness: 1 }));
  bar.position.set(0, 60, 0);
  gate.add(bar);
  gate.position.set(0, 0, VILLAGE_GATE_Z);
  raw.add(gate);

  // The well: a low stone ring and a frame with two ropes.
  const well = new THREE.Group();
  well.name = "village-well";
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(16, 18, 14, 14, 1, true), stone);
  ring.position.y = 7;
  well.add(ring);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(3, 44, 3), new THREE.MeshStandardMaterial({ color: C.wood, roughness: 1 }));
  for (const sx of [-1, 1]) {
    const f = frame.clone();
    f.position.set(sx * 17, 22, 0);
    well.add(f);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(40, 3, 3), new THREE.MeshStandardMaterial({ color: C.wood, roughness: 1 }));
  beam.position.set(0, 44, 0);
  well.add(beam);
  for (const dx of [-4, 4]) {
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 28, 5), new THREE.MeshStandardMaterial({ color: 0xb8a070, roughness: 1 }));
    rope.position.set(dx, 30, 0);
    well.add(rope);
  }
  well.position.set(-90, 0, VILLAGE_WELL_Z);
  raw.add(well);

  // A chair set outside one door, empty, facing the path.
  const chair = new THREE.Group();
  chair.name = "village-chair";
  const seat = new THREE.Mesh(new THREE.BoxGeometry(9, 2, 9), new THREE.MeshStandardMaterial({ color: C.wood, roughness: 1 }));
  seat.position.y = 10;
  chair.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(9, 12, 1.5), new THREE.MeshStandardMaterial({ color: C.wood, roughness: 1 }));
  back.position.set(0, 16, -4);
  chair.add(back);
  for (const [lx, lz] of [[-3.5, -3.5], [3.5, -3.5], [-3.5, 3.5], [3.5, 3.5]] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 10, 1.2), new THREE.MeshStandardMaterial({ color: C.wood, roughness: 1 }));
    leg.position.set(lx, 5, lz);
    chair.add(leg);
  }
  chair.position.set(60, 0, VILLAGE_CHAIR_Z);
  chair.rotation.y = -0.5;
  raw.add(chair);

  // The hearth in the square: a ring of stones and a low ember glow, laid for more than sit at it.
  const hearth = new THREE.Group();
  hearth.name = "village-hearth";
  const hearthRing = new THREE.Mesh(new THREE.TorusGeometry(14, 2.6, 6, 14), stone);
  hearthRing.rotation.x = Math.PI / 2;
  hearthRing.position.y = 2.6;
  hearth.add(hearthRing);
  const ember = new THREE.Mesh(new THREE.CircleGeometry(11, 14), new THREE.MeshBasicMaterial({ color: C.ember, transparent: true, opacity: 0.8, toneMapped: false }));
  ember.rotation.x = -Math.PI / 2;
  ember.position.y = 3;
  ember.name = "village-ember";
  hearth.add(ember);
  hearth.add(lightPools([{ x: 0, z: 0 }], C.ember, 110, 0.3, "village-hearth-pool"));
  const fire = new THREE.PointLight(C.ember, 900, 420, 1.6);
  fire.position.set(0, 16, 0);
  hearth.add(fire);
  hearth.position.set(0, 0, VILLAGE_SQUARE_Z);
  raw.add(hearth);

  // Bread cooling on a sill: a low loaf on a small block, near the first lit house.
  const bread = new THREE.Group();
  bread.name = "village-bread";
  const sill = new THREE.Mesh(new THREE.BoxGeometry(14, 3, 8), stone);
  sill.position.y = 22;
  bread.add(sill);
  const loaf = new THREE.Mesh(new THREE.CapsuleGeometry(2.2, 6, 4, 8), new THREE.MeshStandardMaterial({ color: 0xc8924a, roughness: 0.9 }));
  loaf.rotation.z = Math.PI / 2;
  loaf.position.y = 26;
  bread.add(loaf);
  bread.position.set(-150, 0, 560);
  raw.add(bread);

  // The path of hooks: small gold hooks climbing toward the doorway.
  const hooks = villageHooks();
  const hookMesh = new THREE.InstancedMesh(new THREE.TorusGeometry(2.2, 0.5, 5, 8, Math.PI * 1.5), new THREE.MeshBasicMaterial({ color: C.hook, toneMapped: false }), hooks.length);
  hooks.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.updateMatrix();
    hookMesh.setMatrixAt(i, dummy.matrix);
  });
  hookMesh.name = "village-hook-heads";
  raw.add(hookMesh);
  raw.add(proxy("village-hooks", 40, 100, 880, 0, 55, 880));

  // The doorway: tall, luminous, with nothing shown inside it.
  const door = new THREE.Group();
  door.name = "village-door";
  const arch = new THREE.Mesh(new THREE.TorusGeometry(34, 3.2, 6, 22, Math.PI), new THREE.MeshStandardMaterial({ color: C.stone, roughness: 0.8 }));
  arch.position.set(0, 80, 0);
  door.add(arch);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(6, 80, 6), stone);
    post.position.set(sx * 34, 40, 0);
    door.add(post);
  }
  // The light in the doorway: an additive warm-white pane that fades to nothing at its edge (a flat, translucent grey slab read as a wall in a real browser), with a wide soft halo behind it.
  const light = new THREE.Mesh(new THREE.PlaneGeometry(64, 80), new THREE.MeshBasicMaterial({ color: C.doorLight, map: glowTexture(), transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  light.position.set(0, 40, 0);
  door.add(light);
  door.add(softGlowPoints([{ x: 0, y: 40, z: -4 }], C.doorLight, 260, 0.7, "village-door-halo"));
  door.position.set(0, 90, VILLAGE_DOOR_Z);
  raw.add(door);

  // The night round it: a deep-blue band where the hills meet the sky, mist in the low ground, and small warm motes over the square (they hang still under reduced motion).
  raw.add(horizonGlow(5200, 0x0a0e14, 0x33486e, 0x0a0e14, 0.6, "village-horizon"));
  const low: { x: number; y: number; z: number }[] = [];
  for (let z = -100; z < VILLAGE.zEnd; z += 190) low.push({ x: ((z / 190) % 2 ? 1 : -1) * 300, y: 14, z });
  raw.add(groundMist(low, 0x8a9ab8, 520, 0.07, "village-mist").object);
  const motes = dustMotes({ min: [-180, 6, VILLAGE_SQUARE_Z - 200], max: [180, 90, VILLAGE_SQUARE_Z + 260] }, 90, 0xffd890, 3, 0.7, "village-motes");
  raw.add(motes.object);

  // Centre the host's orbit on the square.
  const group = new THREE.Group();
  group.name = "the-village";
  raw.name = "village-hill";
  raw.position.z = -VILLAGE_VIEW_Z;
  group.add(raw);

  const update = (ms: number, opts?: { reducedMotion?: boolean }) => {
    windowMat.opacity = opts?.reducedMotion ? 0.9 : 0.9 + Math.sin((ms / 1000) * 0.6) * 0.06;
    motes.update(ms, opts?.reducedMotion);
  };
  return { group, update, dispose: () => disposeObject3D(group) };
}
