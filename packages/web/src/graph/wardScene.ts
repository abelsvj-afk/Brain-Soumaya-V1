import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import { softGlowPoints } from "./softGlow.js";
import { WARD_COT_WALL_X, WARD_HALL, WARD_VIEW_Z, specialCot, wardCots, wardLanternPositions, wardOccupied } from "./wardLayout.js";

/**
 * The Faded Ward (docs/specs/seam-faded-ward-2026-10-31.md): one long hall of narrow cots under a ribbed, open roof, ember lanterns hung down its length, the far end lost in fog.
 * Built procedurally from the layout's numbers — no downloads. Nothing in it is counted, labelled or ranked: the sleepers are faint pale shapes, never faces, never a body; the
 * ward is a place of rest, not a morgue. The named holders (door, Ruel's cot, the made-up cot, the small bed's soldier, the bowl, the window, the coat hook, the far end) are what the
 * Fly-to places, spots and passages anchor to. Reduced motion holds every lantern and every breath still.
 *
 * Draw-call sketch (host budget ≤ 95): floor 1 · walls 2 · roof ribs 1 · cot frames 1 · mattresses 1 · pillows 1 · sleepers 1 · lantern cores 1 · lantern glows 1 · special props ~8 · window 2
 * · door 2 · far light 1 ≈ 23.
 */
export interface WardScene {
  group: THREE.Group;
  update: (elapsedMs: number, opts?: { reducedMotion?: boolean }) => void;
  dispose: () => void;
}

const C = {
  floor: 0x1c2a28,
  wall: 0x25362f,
  rib: 0x2f3f3a,
  frame: 0x6d7a72,
  mattress: 0xd8e0d8,
  pillow: 0xf2f4ee,
  sleeper: 0xcfe6e0,
  lantern: 0xffc86a,
  gold: 0xffd98a,
  coat: 0x5e6b5a,
  soldier: 0xb04a3c,
  bowl: 0xe6e2d4,
  window: 0x6a86c8,
};

const named = <T extends THREE.Object3D>(o: T, name: string): T => {
  o.name = name;
  return o;
};

export function createWardScene(): WardScene {
  const group = new THREE.Group();
  group.name = "faded-ward";
  const length = WARD_HALL.zEnd - WARD_HALL.zStart;
  const midZ = (WARD_HALL.zEnd + WARD_HALL.zStart) / 2;

  // --- Hall: floor and two long walls (the open roof is ribs only, so the sky shows through). ---
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(WARD_HALL.halfWidth * 2, length), new THREE.MeshStandardMaterial({ color: C.floor, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, midZ);
  floor.name = "ward-floor";
  group.add(floor);
  const wallGeo = new THREE.PlaneGeometry(length, WARD_HALL.height);
  const wallMat = new THREE.MeshStandardMaterial({ color: C.wall, roughness: 0.9, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.rotation.y = Math.PI / 2;
    wall.position.set(side * (WARD_HALL.halfWidth + 6), WARD_HALL.height / 2, midZ);
    wall.name = `ward-wall-${side < 0 ? "left" : "right"}`;
    group.add(wall);
  }
  // Roof ribs: thin arches every 120 units.
  const ribPositions: number[] = [];
  for (let z = WARD_HALL.zStart + 60; z <= WARD_HALL.zEnd; z += 120) ribPositions.push(z);
  const ribGeo = new THREE.TorusGeometry(WARD_HALL.halfWidth + 6, 2.2, 6, 18, Math.PI);
  const ribs = new THREE.InstancedMesh(ribGeo, new THREE.MeshStandardMaterial({ color: C.rib, roughness: 0.8 }), ribPositions.length);
  const dummy = new THREE.Object3D();
  ribPositions.forEach((z, i) => {
    dummy.position.set(0, WARD_HALL.height * 0.55, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 0.9, 1);
    dummy.updateMatrix();
    ribs.setMatrixAt(i, dummy.matrix);
  });
  ribs.name = "ward-roof-ribs";
  group.add(ribs);

  // --- Cots: frames, mattresses, pillows as three instanced meshes; faint sleepers in about two in three. ---
  const cots = wardCots();
  const occupied = wardOccupied(cots);
  const frames = new THREE.InstancedMesh(new THREE.BoxGeometry(40, 6, 20), new THREE.MeshStandardMaterial({ color: C.frame, roughness: 0.7, metalness: 0.3 }), cots.length);
  const mattresses = new THREE.InstancedMesh(new THREE.BoxGeometry(38, 5, 18), new THREE.MeshStandardMaterial({ color: C.mattress, roughness: 0.95 }), cots.length);
  const pillows = new THREE.InstancedMesh(new THREE.BoxGeometry(9, 3, 13), new THREE.MeshStandardMaterial({ color: C.pillow, roughness: 0.95 }), cots.length);
  const sleeperMat = new THREE.MeshBasicMaterial({ color: C.sleeper, transparent: true, opacity: 0.32, depthWrite: false, toneMapped: false });
  const sleepers = new THREE.InstancedMesh(new THREE.CapsuleGeometry(5.5, 24, 4, 8), sleeperMat, occupied.filter(Boolean).length);
  let si = 0;
  cots.forEach((c, i) => {
    const dir = -c.side; // from the wall toward the aisle
    const cx = c.x + dir * 20;
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.position.set(cx, 12, c.z);
    dummy.updateMatrix();
    frames.setMatrixAt(i, dummy.matrix);
    dummy.position.set(cx, 17, c.z);
    dummy.updateMatrix();
    mattresses.setMatrixAt(i, dummy.matrix);
    dummy.position.set(c.x + dir * 6, 21, c.z);
    dummy.updateMatrix();
    pillows.setMatrixAt(i, dummy.matrix);
    if (occupied[i]) {
      dummy.position.set(cx + dir * 2, 24, c.z);
      dummy.rotation.set(0, 0, Math.PI / 2);
      dummy.updateMatrix();
      sleepers.setMatrixAt(si++, dummy.matrix);
    }
  });
  frames.name = "ward-cot-frames";
  mattresses.name = "ward-cot-mattresses";
  pillows.name = "ward-cot-pillows";
  sleepers.name = "ward-sleepers";
  group.add(frames, mattresses, pillows, sleepers);

  // --- Lanterns: a warm core and a soft additive glow each, instanced. ---
  const lanterns = wardLanternPositions();
  const coreMat = new THREE.MeshBasicMaterial({ color: C.lantern, toneMapped: false });
  const glows = softGlowPoints(lanterns, C.lantern, 48, 0.55, "ward-lantern-glows");
  const glowMat = glows.material as THREE.PointsMaterial;
  const cores = new THREE.InstancedMesh(new THREE.SphereGeometry(2.6, 8, 6), coreMat, lanterns.length);
  lanterns.forEach((l, i) => {
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.position.set(l.x, l.y, l.z);
    dummy.updateMatrix();
    cores.setMatrixAt(i, dummy.matrix);
  });
  cores.name = "ward-lantern-cores";
  group.add(cores, glows);

  // --- Named holders: the places the lore and the Fly-to tiles anchor to. ---
  // The door: a plain arch at the near end, a doorway of pale light.
  const door = named(new THREE.Group(), "ward-door");
  const doorFrame = new THREE.Mesh(new THREE.TorusGeometry(34, 2.4, 6, 20, Math.PI), new THREE.MeshStandardMaterial({ color: C.rib, roughness: 0.7 }));
  doorFrame.position.set(0, 0, -150);
  door.add(doorFrame);
  const doorLight = new THREE.Mesh(new THREE.CircleGeometry(33, 20, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0xcfe0f0, transparent: true, opacity: 0.35, side: THREE.DoubleSide, toneMapped: false }));
  doorLight.position.set(0, 0, -149);
  door.add(doorLight);
  door.position.set(0, 4, 0);
  group.add(door);

  // Ruel's cot: the cot, a warm ring of gold light above it (a laugh kept, never a body).
  const ruelCot = specialCot("ruel");
  const ruel = named(new THREE.Group(), "ward-cot-ruel");
  const ruelRing = new THREE.Mesh(new THREE.TorusGeometry(9, 0.9, 6, 24), new THREE.MeshBasicMaterial({ color: C.gold, transparent: true, opacity: 0.8, toneMapped: false }));
  ruelRing.rotation.y = Math.PI / 2;
  ruelRing.position.set(0, 38, 0);
  ruel.add(ruelRing);
  const ruelShape = new THREE.Mesh(new THREE.CapsuleGeometry(5.5, 24, 4, 8), new THREE.MeshBasicMaterial({ color: C.sleeper, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false }));
  ruelShape.rotation.z = Math.PI / 2;
  ruelShape.position.set(-ruelCot.side * 22, 24, 0);
  ruel.add(ruelShape);
  ruel.position.set(ruelCot.x, 0, ruelCot.z);
  group.add(ruel);

  // The made-up cot for whoever wore the coat on the hook: a folded blanket and nothing else, and the coat on its hook on the wall above.
  const linnetCot = specialCot("linnet");
  const linnet = named(new THREE.Group(), "ward-cot-linnet");
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(24, 3, 17), new THREE.MeshStandardMaterial({ color: 0xa9c2b4, roughness: 1 }));
  blanket.position.set(-linnetCot.side * 24, 22, 0);
  linnet.add(blanket);
  linnet.position.set(linnetCot.x, 0, linnetCot.z);
  group.add(linnet);
  const hook = named(new THREE.Group(), "ward-hook");
  const coat = new THREE.Mesh(new THREE.BoxGeometry(5, 30, 14), new THREE.MeshStandardMaterial({ color: C.coat, roughness: 1 }));
  coat.position.set(0, 0, 0);
  hook.add(coat);
  const hookLamp = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 6), new THREE.MeshBasicMaterial({ color: C.lantern, toneMapped: false }));
  hookLamp.position.set(-linnetCot.side * 6, 20, 0);
  hook.add(hookLamp);
  hook.position.set(linnetCot.x + linnetCot.side * 2, 68, linnetCot.z - 44);
  group.add(hook);

  // The small bed with a tin soldier on the floor beside it.
  const smallCot = specialCot("small");
  const small = named(new THREE.Group(), "ward-small-bed");
  const soldier = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 7, 8), new THREE.MeshStandardMaterial({ color: C.soldier, roughness: 0.6, metalness: 0.4 }));
  soldier.position.set(-smallCot.side * 46, 3.5, 0);
  small.add(soldier);
  small.position.set(smallCot.x, 0, smallCot.z);
  group.add(small);

  // The bowl: a small table in the aisle with one bowl of soup, steaming.
  const bowl = named(new THREE.Group(), "ward-bowl");
  const table = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 3, 14), new THREE.MeshStandardMaterial({ color: C.frame, roughness: 0.8 }));
  table.position.set(0, 24, 0);
  bowl.add(table);
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 24, 6), new THREE.MeshStandardMaterial({ color: C.frame, roughness: 0.8 }));
  legs.position.set(0, 12, 0);
  bowl.add(legs);
  const bowlMesh = new THREE.Mesh(new THREE.SphereGeometry(4.5, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: C.bowl, roughness: 0.6, side: THREE.DoubleSide }));
  bowlMesh.rotation.x = Math.PI;
  bowlMesh.position.set(0, 30, 0);
  bowl.add(bowlMesh);
  const steam = new THREE.Mesh(new THREE.SphereGeometry(3.2, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false, toneMapped: false }));
  steam.name = "ward-steam";
  steam.position.set(0, 36, 0);
  bowl.add(steam);
  bowl.position.set(0, 0, 720); // well down the aisle, so the orbit sees the rows first and the bowl ahead
  group.add(bowl);

  // The window: a tall arch of starlight on the left wall.
  const win = named(new THREE.Group(), "ward-window");
  const winGlass = new THREE.Mesh(new THREE.PlaneGeometry(46, 78), new THREE.MeshBasicMaterial({ color: C.window, transparent: true, opacity: 0.55, side: THREE.DoubleSide, toneMapped: false }));
  winGlass.rotation.y = Math.PI / 2;
  win.add(winGlass);
  const winFrame = new THREE.Mesh(new THREE.BoxGeometry(2, 82, 50), new THREE.MeshStandardMaterial({ color: C.rib, roughness: 0.7 }));
  winFrame.position.set(-1, 0, 0);
  win.add(winFrame);
  win.position.set(-(WARD_HALL.halfWidth + 3), 84, 760);
  group.add(win);

  // The far end: a faint pale light the hall seems to lead to and never reaches.
  const far = named(new THREE.Mesh(new THREE.SphereGeometry(26, 12, 10), new THREE.MeshBasicMaterial({ color: 0xdfe8f0, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })), "ward-far");
  far.position.set(0, 60, WARD_HALL.zEnd - 120);
  group.add(far);

  group.userData.wallX = WARD_COT_WALL_X;
  // The host orbits the world's origin. Measured in a real browser: with the origin at the door, the orbit sat OUTSIDE the hall and the walls hid
  // every cot. Shift the whole hall so the origin stands in the aisle a little way in, between the rows; the host's orbit stays inside the walls.
  const hall = new THREE.Group();
  hall.name = "ward-hall";
  for (const child of [...group.children]) hall.add(child);
  hall.position.z = -WARD_VIEW_Z;
  group.add(hall);

  const update = (ms: number, opts?: { reducedMotion?: boolean }) => {
    if (opts?.reducedMotion) {
      glowMat.opacity = 0.55;
      sleeperMat.opacity = 0.32;
      steam.position.y = 36;
      return;
    }
    const t = ms / 1000;
    glowMat.opacity = 0.55 + Math.sin(t * 0.9) * 0.08; // the lanterns breathe, slowly, all together
    sleeperMat.opacity = 0.32 + Math.sin(t * 0.55) * 0.04; // the sleepers breathe
    steam.position.y = 36 + ((t * 5) % 8);
  };

  const dispose = () => {
    disposeObject3D(group);
  };
  return { group, update, dispose };
}
