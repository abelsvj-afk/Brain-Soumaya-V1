import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import { softGlowPoints } from "./softGlow.js";
import { LONG, LONG_FLAKE_AT, LONG_FRAY_AT, LONG_HOME_AT, LONG_LEAF_HEIGHT, LONG_POOL_AT, LONG_STROKE_X, longLeaves, longPeople } from "./longLayout.js";

/**
 * The Long Morning (docs/specs/seam-the-long-morning-2026-10-31.md): a world of warm light with no horizon (the floor, the fog and the sky are one colour, so the ground simply ends in light). A whole ring of tall
 * ruled leaves; one blank leaf the size of a table at the middle; a flake of the first light on a stand; a basin of still light; tall faceless columns of soft light that lean a little toward you; a home of four
 * posts with a lamp trimmed for company; a groove with no beginning; a curve of light that stops. Procedural, no downloads. Nobody is shown, no text, and nothing says whether the Uncounted is Eternity. Named
 * holders anchor places, spots and passages (invisible proxy boxes give instanced things a box). Reduced motion holds the columns still.
 *
 * Draw-call sketch (host budget ≤ 95): floor 1 · leaves 1 · rules 1 · blank leaf 1 · flake 2 · stand 1 · basin 2 · columns 2 · home 4 · lamp 1 · groove 1 · curve 1 ≈ 19.
 */
export interface LongScene {
  group: THREE.Group;
  update: (elapsedMs: number, opts?: { reducedMotion?: boolean }) => void;
  dispose: () => void;
}

/** The host uses this for the background and the fog so the floor meets the sky with no horizon. */
export const LONG_SKY = 0xefd9a8;
const C = { leaf: 0xfffaf0, rule: 0xb48a3c, flake: 0xffffff, stand: 0xcdb480, basin: 0xfff3d0, column: 0xffffff, post: 0xa88a58, lamp: 0xffd890, groove: 0xc29a50, curve: 0xffffff };

const proxy = (name: string, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
  m.name = name;
  m.position.set(x, y, z);
  m.visible = false;
  return m;
};

export function createLongScene(): LongScene {
  const group = new THREE.Group();
  group.name = "the-long-morning";
  const dummy = new THREE.Object3D();

  // The floor is the sky's own colour, so with the matching fog there is no horizon line anywhere.
  const floor = new THREE.Mesh(new THREE.CircleGeometry(LONG.radius, 72), new THREE.MeshBasicMaterial({ color: LONG_SKY }));
  floor.rotation.x = -Math.PI / 2;
  floor.name = "long-floor";
  group.add(floor);

  // The ring: tall pale leaves ruled with fine lines of light, a whole circle.
  const leaves = longLeaves();
  const leafMat = new THREE.MeshBasicMaterial({ color: C.leaf, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
  const leafMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(74, LONG_LEAF_HEIGHT), leafMat, leaves.length);
  const rulesPer = 9;
  const ruleMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(60, 0.5, 0.4), new THREE.MeshBasicMaterial({ color: C.rule, toneMapped: false }), leaves.length * rulesPer);
  leaves.forEach((l, i) => {
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, l.yaw, 0);
    dummy.position.set(l.x, LONG_LEAF_HEIGHT / 2 + 3, l.z);
    dummy.updateMatrix();
    leafMesh.setMatrixAt(i, dummy.matrix);
    for (let r = 0; r < rulesPer; r++) {
      dummy.position.set(l.x, 10 + r * 9.2, l.z);
      dummy.updateMatrix();
      ruleMesh.setMatrixAt(i * rulesPer + r, dummy.matrix);
    }
  });
  leafMesh.frustumCulled = false;
  ruleMesh.frustumCulled = false;
  group.add(leafMesh, ruleMesh);
  group.add(proxy("long-record", 640, 100, 640, 0, 50, 0));

  // The blank leaf at the middle: the only one left blank, the size of a table.
  const blank = new THREE.Mesh(new THREE.BoxGeometry(60, 0.8, 40), new THREE.MeshBasicMaterial({ color: C.leaf, toneMapped: false }));
  blank.position.y = 0.6;
  blank.name = "long-leaf";
  group.add(blank);
  const blankRule = new THREE.InstancedMesh(new THREE.BoxGeometry(52, 0.2, 0.3), new THREE.MeshBasicMaterial({ color: C.rule, toneMapped: false }), 6);
  for (let i = 0; i < 6; i++) {
    dummy.position.set(0, 1.1, -15 + i * 6);
    dummy.updateMatrix();
    blankRule.setMatrixAt(i, dummy.matrix);
  }
  group.add(blankRule);

  // The flake of the first light on a plain stand.
  const flake = new THREE.Group();
  flake.name = "long-flake";
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(3, 4, 12, 10), new THREE.MeshBasicMaterial({ color: C.stand, toneMapped: false }));
  stand.position.y = 6;
  flake.add(stand);
  const flakeMesh = new THREE.Mesh(new THREE.OctahedronGeometry(2.2, 0), new THREE.MeshBasicMaterial({ color: C.flake, toneMapped: false }));
  flakeMesh.scale.set(1, 0.6, 0.35);
  flakeMesh.position.y = 15;
  flake.add(flakeMesh);
  flake.add(softGlowPoints([{ x: 0, y: 15, z: 0 }], 0xfff8e0, 60, 0.9, "long-flake-glow"));
  flake.position.set(LONG_FLAKE_AT.x, 0, LONG_FLAKE_AT.z);
  group.add(flake);

  // The basin of still light.
  const pool = new THREE.Group();
  pool.name = "long-pool";
  const rim = new THREE.Mesh(new THREE.TorusGeometry(20, 1.6, 6, 28), new THREE.MeshBasicMaterial({ color: C.stand, toneMapped: false }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 1.4;
  pool.add(rim);
  const surface = new THREE.Mesh(new THREE.CircleGeometry(19, 28), new THREE.MeshBasicMaterial({ color: C.basin, toneMapped: false }));
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = 1.2;
  pool.add(surface);
  pool.position.set(LONG_POOL_AT.x, 0, LONG_POOL_AT.z);
  group.add(pool);

  // The people: tall faceless columns of soft light, in loose groups, each a different height.
  const people = longPeople();
  const colMat = new THREE.MeshBasicMaterial({ color: C.column, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
  const cols = new THREE.InstancedMesh(new THREE.CylinderGeometry(3.4, 5.6, 1, 10, 1, true), colMat, people.length);
  const cores = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.4, 2.2, 1, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }), people.length);
  const placeCol = (t: number) =>
    people.forEach((p, i) => {
      const lean = Math.sin(t * 0.0004 + i) * 0.04;
      dummy.position.set(p.x, p.h / 2, p.z);
      dummy.rotation.set(lean, 0, -lean);
      dummy.scale.set(1, p.h * (1 + lean * 0.5), 1);
      dummy.updateMatrix();
      cols.setMatrixAt(i, dummy.matrix);
      cores.setMatrixAt(i, dummy.matrix);
    });
  placeCol(0);
  cols.frustumCulled = false;
  cores.frustumCulled = false;
  const peopleGroup = new THREE.Group();
  peopleGroup.name = "long-people-columns";
  peopleGroup.add(cols, cores);
  group.add(peopleGroup);
  group.add(proxy("long-people", 150, 130, 120, 0, 65, 0));
  group.children[group.children.length - 1]!.position.set(people.reduce((a, p) => a + p.x, 0) / people.length, 65, people.reduce((a, p) => a + p.z, 0) / people.length);

  // The home: four plain posts, a roof beam, a lamp trimmed for company, a swept threshold.
  const home = new THREE.Group();
  home.name = "long-home";
  const postMat = new THREE.MeshBasicMaterial({ color: C.post, toneMapped: false });
  for (const [px, pz] of [[-22, -16], [22, -16], [-22, 16], [22, 16]] as const) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(3, 46, 3), postMat);
    post.position.set(px, 23, pz);
    home.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(52, 3, 36), postMat);
  beam.position.y = 47;
  home.add(beam);
  const lampGlow = softGlowPoints([{ x: 0, y: 30, z: 0 }], C.lamp, 80, 0.95, "long-home-lamp");
  home.add(lampGlow);
  const lampBody = new THREE.Mesh(new THREE.SphereGeometry(2.4, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff2c8, toneMapped: false }));
  lampBody.position.y = 30;
  home.add(lampBody);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(24, 0.8, 8), new THREE.MeshBasicMaterial({ color: 0xf8ecd0, toneMapped: false }));
  sill.position.set(0, 0.5, 24);
  home.add(sill);
  home.position.set(LONG_HOME_AT.x, 0, LONG_HOME_AT.z);
  group.add(home);

  // The first stroke: one straight groove with no beginning, out of sight both ways.
  const stroke = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, LONG.radius * 2), new THREE.MeshBasicMaterial({ color: C.groove, toneMapped: false }));
  stroke.position.set(LONG_STROKE_X, 0.35, 0);
  stroke.name = "long-stroke-line";
  group.add(stroke);
  group.add(proxy("long-stroke", 10, 4, 220, LONG_STROKE_X, 2, -300));

  // The line that stops: a curve of light hung at the height of a hand, ending mid-air.
  const fray = new THREE.Mesh(new THREE.TorusGeometry(26, 0.9, 5, 24, Math.PI * 1.15), new THREE.MeshBasicMaterial({ color: C.curve, transparent: true, opacity: 0.95, toneMapped: false }));
  fray.name = "long-fray";
  fray.position.set(LONG_FRAY_AT.x, 40, LONG_FRAY_AT.z);
  group.add(fray);

  const update = (ms: number, opts?: { reducedMotion?: boolean }) => {
    if (!opts?.reducedMotion) placeCol(ms);
    cols.instanceMatrix.needsUpdate = true;
    cores.instanceMatrix.needsUpdate = true;
  };
  return { group, update, dispose: () => disposeObject3D(group) };
}
