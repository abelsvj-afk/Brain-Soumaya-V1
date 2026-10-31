import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import { YARD, YARD_BLANK_AT, YARD_CRANE_AT, YARD_DESK_AT, YARD_HULL_LENGTH, YARD_PLATES_AT, YARD_SEVENTH_AT, YARD_TOOLS_AT, yardHulls, yardLamps, yardPlateStrokes, yardRibs } from "./yardLayout.js";

/**
 * The Unlit Hulls (docs/specs/seam-the-unlit-hulls-2026-10-31.md): a vast, dim shipyard. Six long hulls lie on slips, each finished in one part only (dawn-prow, plumb keel, latch fin, bloom wing, ember engine,
 * lullaby flank), none lit; a seventh slip stands apart with only a frame on it; six nameplates cut with a slow even stroke on a rail and a seventh plate smooth on a bench; a ledger desk with no ledger; tools laid
 * down square; lanterns trimmed and unlit; a crane whose hook hangs at the height of a flank. Procedural, no downloads. Nobody is shown, no text, and nothing says the name that goes on the seventh plate.
 * Named holders anchor places, spots and passages (invisible proxy boxes give instanced things a box). Nothing here moves, so reduced motion needs no change.
 *
 * Draw-call sketch (host budget ≤ 95): floor 1 · slips 1 · hull bodies 1 · hull parts 6 · plates 2 · rail 1 · bench+plate 2 · graver 1 · desk 3 · tools 1 · lanterns 2 · crane 4 · ribs 1 · keel beam 1 ≈ 27.
 */
export interface YardScene {
  group: THREE.Group;
  update: (elapsedMs: number, opts?: { reducedMotion?: boolean }) => void;
  dispose: () => void;
}

const C = { floor: 0x4e463c, hull: 0x4a505c, part: 0x8a92a4, wood: 0x6a5238, brass: 0xc8a860, rib: 0x6a7080, desk: 0x7a6044, glass: 0x2a2c36, crane: 0x5a5e68, tool: 0x9a9488 };

const proxy = (name: string, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
  m.name = name;
  m.position.set(x, y, z);
  m.visible = false;
  return m;
};

export function createYardScene(): YardScene {
  const group = new THREE.Group();
  group.name = "the-yard";
  const dummy = new THREE.Object3D();
  const wood = new THREE.MeshStandardMaterial({ color: C.wood, roughness: 1 });
  const steel = new THREE.MeshStandardMaterial({ color: C.hull, roughness: 0.55, metalness: 0.4 });
  const part = new THREE.MeshStandardMaterial({ color: C.part, roughness: 0.4, metalness: 0.5 });
  const brass = new THREE.MeshStandardMaterial({ color: C.brass, roughness: 0.35, metalness: 0.6 });

  const floor = new THREE.Mesh(new THREE.CircleGeometry(YARD.radius, 72), new THREE.MeshStandardMaterial({ color: C.floor, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.name = "yard-floor";
  group.add(floor);

  // The six hulls, each on a pair of wooden cradles, each finished in one part only.
  const hulls = yardHulls();
  const bodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(14, YARD_HULL_LENGTH - 28, 6, 12), steel, hulls.length);
  const cradles = new THREE.InstancedMesh(new THREE.BoxGeometry(46, 8, 6), wood, hulls.length * 2);
  hulls.forEach((h, i) => {
    dummy.rotation.set(Math.PI / 2, 0, 0);
    dummy.scale.set(1, 1, 0.8);
    dummy.position.set(h.x, 22, h.z);
    dummy.updateMatrix();
    bodies.setMatrixAt(i, dummy.matrix);
    for (const k of [0, 1]) {
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.position.set(h.x, 4, h.z + (k ? 48 : -48));
      dummy.updateMatrix();
      cradles.setMatrixAt(i * 2 + k, dummy.matrix);
    }
  });
  bodies.frustumCulled = false;
  cradles.frustumCulled = false;
  group.add(bodies, cradles);
  const sixBox = proxy("yard-six", 6 * 108, 60, YARD_HULL_LENGTH, -40, 30, hulls[0]!.z);
  const six = new THREE.Group();
  six.name = "yard-six-parts";
  const partAt = (i: number, mesh: THREE.Mesh) => {
    const h = hulls[i]!;
    mesh.position.add(new THREE.Vector3(h.x, 0, h.z));
    six.add(mesh);
  };
  // dawn-prow: a pale cone at the bow
  const prow = new THREE.Mesh(new THREE.ConeGeometry(10, 36, 10), part);
  prow.rotation.x = -Math.PI / 2;
  prow.position.set(0, 22, YARD_HULL_LENGTH / 2 + 10);
  partAt(0, prow);
  // plumb keel: a straight thin plate below
  const keel = new THREE.Mesh(new THREE.BoxGeometry(2.4, 18, YARD_HULL_LENGTH * 0.8), part);
  keel.position.set(0, 6, 0);
  partAt(1, keel);
  // latch fin: a square fin on the back
  const fin = new THREE.Mesh(new THREE.BoxGeometry(2.4, 24, 22), part);
  fin.position.set(0, 46, -30);
  partAt(2, fin);
  // bloom wing: a flat leaf-shaped wing
  const wing = new THREE.Mesh(new THREE.CylinderGeometry(26, 26, 1.6, 4, 1), part);
  wing.scale.set(1.8, 1, 0.8);
  wing.position.set(0, 36, 0);
  partAt(3, wing);
  // ember engine: a short cylinder at the stern, unlit
  const engine = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, 22, 12), part);
  engine.rotation.x = Math.PI / 2;
  engine.position.set(0, 22, -YARD_HULL_LENGTH / 2 - 8);
  partAt(4, engine);
  // lullaby flank: one smooth shallow strip along the side, a hollow the length of the hull
  const flank = new THREE.Mesh(new THREE.BoxGeometry(1.2, 9, YARD_HULL_LENGTH * 0.7), part);
  flank.position.set(11, 22, 0);
  partAt(5, flank);
  group.add(six, sixBox);

  // The seventh slip: a frame of ribs on a keel beam, no plating.
  const ribs = yardRibs();
  const ribMesh = new THREE.InstancedMesh(new THREE.TorusGeometry(15, 1.1, 5, 14, Math.PI), new THREE.MeshStandardMaterial({ color: C.rib, roughness: 0.6, metalness: 0.4 }), ribs.length);
  ribs.forEach((r, i) => {
    dummy.position.set(YARD_SEVENTH_AT.x, 12, r.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(r.scale, r.scale, 1);
    dummy.updateMatrix();
    ribMesh.setMatrixAt(i, dummy.matrix);
  });
  ribMesh.frustumCulled = false;
  group.add(ribMesh);
  const keelBeam = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 150), wood);
  keelBeam.position.set(YARD_SEVENTH_AT.x, 2, YARD_SEVENTH_AT.z);
  group.add(keelBeam);
  group.add(proxy("yard-seventh", 50, 34, 150, YARD_SEVENTH_AT.x, 17, YARD_SEVENTH_AT.z));

  // The six plates on a rail, cut with one slow pace; the strokes are the only "writing", and they are not letters.
  const rail = new THREE.Group();
  rail.name = "yard-plates";
  const bar = new THREE.Mesh(new THREE.BoxGeometry(150, 2, 2), wood);
  bar.position.y = 30;
  rail.add(bar);
  const plateMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(18, 11, 0.8), brass, 6);
  const strokes = yardPlateStrokes();
  const strokeCount = strokes.reduce((n, p) => n + p.length, 0);
  const strokeMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 0.5), new THREE.MeshStandardMaterial({ color: 0x3a2e1a, roughness: 1 }), strokeCount);
  let si = 0;
  strokes.forEach((plate, p) => {
    const px = (p - 2.5) * 24;
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.position.set(px, 22, 0);
    dummy.updateMatrix();
    plateMesh.setMatrixAt(p, dummy.matrix);
    let cx = px - 7;
    plate.forEach((len) => {
      const w = len * 1.6;
      dummy.position.set(cx + w / 2, 22, 0.5);
      dummy.scale.set(w, 1.3, 1);
      dummy.updateMatrix();
      strokeMesh.setMatrixAt(si++, dummy.matrix);
      cx += w + 1.2;
    });
  });
  rail.add(plateMesh, strokeMesh);
  rail.position.set(YARD_PLATES_AT.x, 0, YARD_PLATES_AT.z);
  group.add(rail);

  // The seventh plate: smooth on a bench, a graver laid down square beside it.
  const bench = new THREE.Group();
  bench.name = "yard-blank";
  const top = new THREE.Mesh(new THREE.BoxGeometry(44, 3, 20), wood);
  top.position.y = 10;
  bench.add(top);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(18, 0.8, 11), brass);
  plate.position.y = 12.2;
  bench.add(plate);
  const graver = new THREE.Mesh(new THREE.BoxGeometry(11, 0.9, 1.1), new THREE.MeshStandardMaterial({ color: C.tool, roughness: 0.4, metalness: 0.6 }));
  graver.position.set(14, 11.8, 5);
  bench.add(graver);
  bench.position.set(YARD_BLANK_AT.x, 0, YARD_BLANK_AT.z);
  group.add(bench);

  // The ledger desk: a ring on the wood, a pen, nothing written.
  const desk = new THREE.Group();
  desk.name = "yard-desk";
  const deskTop = new THREE.Mesh(new THREE.BoxGeometry(34, 3, 20), new THREE.MeshStandardMaterial({ color: C.desk, roughness: 1 }));
  deskTop.position.y = 12;
  desk.add(deskTop);
  const ring = new THREE.Mesh(new THREE.RingGeometry(5.5, 6.4, 20), new THREE.MeshBasicMaterial({ color: 0x4a3a28, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(-4, 13.6, 0);
  desk.add(ring);
  const pen = new THREE.Mesh(new THREE.BoxGeometry(8, 0.7, 0.7), brass);
  pen.position.set(8, 13.2, 3);
  desk.add(pen);
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(2.4, 11, 2.4), wood);
    leg.position.set(sx * 14, 5.5, 0);
    desk.add(leg);
  }
  desk.position.set(YARD_DESK_AT.x, 0, YARD_DESK_AT.z);
  desk.rotation.y = 0.6;
  group.add(desk);

  // Tools laid down square, no two grips alike.
  const toolMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: C.tool, roughness: 0.5, metalness: 0.5 }), 14);
  for (let i = 0; i < 14; i++) {
    const row = Math.floor(i / 7);
    const col = i % 7;
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(YARD_TOOLS_AT.x + (col - 3) * 12, 1.2, YARD_TOOLS_AT.z + row * 14);
    dummy.scale.set(1.4 + ((i * 37) % 5) * 0.3, 1.2, 8 + ((i * 53) % 4) * 1.5);
    dummy.updateMatrix();
    toolMesh.setMatrixAt(i, dummy.matrix);
  }
  toolMesh.frustumCulled = false;
  group.add(toolMesh);
  group.add(proxy("yard-tools", 90, 4, 30, YARD_TOOLS_AT.x, 2, YARD_TOOLS_AT.z + 7));

  // Lanterns on a rail: trimmed, filled, never lit.
  const lamps = yardLamps();
  const lampBodies = new THREE.InstancedMesh(new THREE.CylinderGeometry(3.2, 3.2, 8, 8), new THREE.MeshStandardMaterial({ color: C.glass, roughness: 0.2, metalness: 0.2, transparent: true, opacity: 0.85 }), lamps.length);
  const lampCaps = new THREE.InstancedMesh(new THREE.ConeGeometry(4.2, 3.2, 8), brass, lamps.length);
  lamps.forEach((l, i) => {
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.position.set(l.x, 36, l.z);
    dummy.updateMatrix();
    lampBodies.setMatrixAt(i, dummy.matrix);
    dummy.position.set(l.x, 41.4, l.z);
    dummy.updateMatrix();
    lampCaps.setMatrixAt(i, dummy.matrix);
  });
  lampBodies.frustumCulled = false;
  lampCaps.frustumCulled = false;
  group.add(lampBodies, lampCaps);
  // A rail and two posts so the lanterns hang from something.
  const lampRail = new THREE.Mesh(new THREE.BoxGeometry(lamps[lamps.length - 1]!.x - lamps[0]!.x + 30, 1.6, 1.6), wood);
  lampRail.position.set((lamps[0]!.x + lamps[lamps.length - 1]!.x) / 2, 45, lamps[0]!.z);
  group.add(lampRail);
  for (const l of [lamps[0]!, lamps[lamps.length - 1]!]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(2.4, 46, 2.4), wood);
    post.position.set(l.x + (l === lamps[0] ? -12 : 12), 23, l.z);
    group.add(post);
  }
  group.add(proxy("yard-lamps", 390, 14, 12, (lamps[0]!.x + lamps[lamps.length - 1]!.x) / 2, 38, YARD_LAMPS_Z(lamps)));

  // The crane over the seventh slip: its hook empty at the height of a flank.
  const crane = new THREE.Group();
  crane.name = "yard-crane";
  const craneMat = new THREE.MeshStandardMaterial({ color: C.crane, roughness: 0.6, metalness: 0.4 });
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(4, 120, 4), craneMat);
    leg.position.set(sx * 46, 60, 0);
    crane.add(leg);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(100, 5, 5), craneMat);
  beam.position.set(0, 122, 0);
  crane.add(beam);
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 98, 5), new THREE.MeshStandardMaterial({ color: 0xb8a070, roughness: 1 }));
  rope.position.set(0, 72, 0);
  crane.add(rope);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.9, 6, 12, Math.PI * 1.4), craneMat);
  hook.position.set(0, 20, 0);
  crane.add(hook);
  crane.position.set(YARD_CRANE_AT.x, 0, YARD_CRANE_AT.z);
  group.add(crane);

  return { group, update: () => {}, dispose: () => disposeObject3D(group) };
}

function YARD_LAMPS_Z(lamps: { z: number }[]): number {
  return lamps[0]!.z;
}
