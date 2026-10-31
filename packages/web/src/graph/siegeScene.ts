import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import { softGlowPoints } from "./softGlow.js";
import { SIEGE, SIEGE_BLUR_AT, SIEGE_CORD_AT, SIEGE_EDGE_HEIGHT, SIEGE_PLINTH, SIEGE_SMILE_AT, SIEGE_TABLE_AT, siegeCups, siegeEdges, siegeGhostEdges, siegeMiniature } from "./siegeLayout.js";

/**
 * The Siege of the First Light (docs/specs/seam-the-siege-2026-10-31.md): a broad pale field of crescent edges standing in ranks and leaning toward a small bead of light; one edge standing apart that smiles;
 * a line of small cups; the whole field on a table in miniature; far ranks that keep their distance; a smear of pale light; a cord with its last knot untied. Procedural, no downloads. Nobody is shown and
 * nothing says what the First Morning was defended from. Named holders anchor places, spots and passages (invisible proxy boxes give instanced things a box). Reduced motion holds the bead still.
 *
 * Draw-call sketch (host budget ≤ 95): ground 1 · edges 1 · far edges 1 · smile 1 · cup stones 1 · cups 1 · cup light 1 · plinth 2 · bead 1 · table 3 · miniature 1 · blur 1 · cord 4 ≈ 20.
 */
export interface SiegeScene {
  group: THREE.Group;
  update: (elapsedMs: number, opts?: { reducedMotion?: boolean }) => void;
  dispose: () => void;
}

const C = { ground: 0x6c685c, edge: 0xe6e0d0, ghost: 0xcfd2e0, smile: 0xf4ecd8, stone: 0x8e8a7e, cup: 0xd8d0bc, light: 0xffeab8, wood: 0x6a5238, cord: 0xc8b890 };

const proxy = (name: string, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
  m.name = name;
  m.position.set(x, y, z);
  m.visible = false;
  return m;
};

/** An upright crescent, open at the top like a half-closed smile turned toward the sky, standing with its lowest point on y = 0. */
function crescent(radius: number, tube: number): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(radius, tube, 6, 18, Math.PI * 1.2);
  g.rotateZ(Math.PI * 0.9);
  g.translate(0, radius, 0);
  return g;
}

export function createSiegeScene(): SiegeScene {
  const group = new THREE.Group();
  group.name = "the-siege";
  // The host's orbit camera opens facing −z; the layout is written with the ranks toward +z, so turn the field to meet it.
  group.rotation.y = Math.PI;
  const dummy = new THREE.Object3D();
  const stone = new THREE.MeshStandardMaterial({ color: C.stone, roughness: 1 });

  const ground = new THREE.Mesh(new THREE.CircleGeometry(SIEGE.radius, 72), new THREE.MeshStandardMaterial({ color: C.ground, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.name = "siege-ground";
  group.add(ground);

  // The ranks: pale crescent edges leaning toward the bead.
  const edges = siegeEdges();
  const marks = new THREE.InstancedMesh(crescent(SIEGE_EDGE_HEIGHT / 2, 1.5), new THREE.MeshStandardMaterial({ color: C.edge, roughness: 0.5, metalness: 0.1 }), edges.length);
  edges.forEach((e, i) => {
    dummy.position.set(e.x, 0, e.z);
    dummy.rotation.set(0.1, e.yaw, 0);
    dummy.scale.setScalar(e.scale);
    dummy.updateMatrix();
    marks.setMatrixAt(i, dummy.matrix);
  });
  marks.name = "siege-edge-marks";
  marks.frustumCulled = false;
  group.add(marks);
  group.add(proxy("siege-edges", 320, 36, 160, 0, 18, 430));

  // The far ranks beyond the haze: faint and a little too large.
  const ghosts = siegeGhostEdges();
  const ghostMesh = new THREE.InstancedMesh(crescent(SIEGE_EDGE_HEIGHT / 2, 1.5), new THREE.MeshBasicMaterial({ color: C.ghost, transparent: true, opacity: 0.28, depthWrite: false, toneMapped: false }), ghosts.length);
  ghosts.forEach((e, i) => {
    dummy.position.set(e.x, 0, e.z);
    dummy.rotation.set(0.1, e.yaw, 0);
    dummy.scale.setScalar(e.scale);
    dummy.updateMatrix();
    ghostMesh.setMatrixAt(i, dummy.matrix);
  });
  ghostMesh.name = "siege-ghost-marks";
  ghostMesh.frustumCulled = false;
  group.add(ghostMesh);
  group.add(proxy("siege-vast", 700, 50, 40, 0, 25, 980));

  // The one that smiles: apart from the ranks, taller, warm.
  const smile = new THREE.Mesh(crescent(21, 2.6), new THREE.MeshStandardMaterial({ color: C.smile, roughness: 0.4, emissive: 0x3a3020, emissiveIntensity: 0.6 }));
  smile.position.set(SIEGE_SMILE_AT.x, 0, SIEGE_SMILE_AT.z);
  smile.rotation.y = Math.atan2(-SIEGE_SMILE_AT.x, -SIEGE_SMILE_AT.z);
  smile.name = "siege-smile";
  group.add(smile);

  // The line of cups on low stones, each a different size, each full of a thin morning light.
  const cups = siegeCups();
  const stones = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1.15, 1, 10), stone, cups.length);
  const cupMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 0.7, 1, 12), new THREE.MeshStandardMaterial({ color: C.cup, roughness: 0.6 }), cups.length);
  const cupLights: { x: number; y: number; z: number }[] = [];
  cups.forEach((c, i) => {
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(c.x, 2, c.z);
    dummy.scale.set(c.r + 3, 4, c.r + 3);
    dummy.updateMatrix();
    stones.setMatrixAt(i, dummy.matrix);
    dummy.position.set(c.x, 4 + c.r * 0.6, c.z);
    dummy.scale.set(c.r, c.r * 1.2, c.r);
    dummy.updateMatrix();
    cupMesh.setMatrixAt(i, dummy.matrix);
    cupLights.push({ x: c.x, y: 4 + c.r * 1.3, z: c.z });
  });
  stones.frustumCulled = false;
  cupMesh.frustumCulled = false;
  group.add(stones, cupMesh, softGlowPoints(cupLights, C.light, 22, 0.8, "siege-cup-lights"));
  group.add(proxy("siege-line", 280, 16, 20, 0, 8, 105));

  // The bead at the back: a held breath of light on a plain plinth that none of the ranks touch.
  const first = new THREE.Group();
  first.name = "siege-first-light";
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(6, 8, 8, 12), stone);
  plinth.position.y = 4;
  first.add(plinth);
  const bead = new THREE.Mesh(new THREE.SphereGeometry(2.4, 14, 10), new THREE.MeshBasicMaterial({ color: 0xfff6dc, toneMapped: false }));
  bead.position.y = 12;
  first.add(bead);
  const beadGlow = softGlowPoints([{ x: 0, y: 12, z: 0 }], C.light, 70, 0.9, "siege-bead-glow");
  first.add(beadGlow);
  first.position.set(SIEGE_PLINTH.x, 0, SIEGE_PLINTH.z);
  group.add(first);

  // The whole field on a small table, every rank exact.
  const table = new THREE.Group();
  table.name = "siege-small";
  const wood = new THREE.MeshStandardMaterial({ color: C.wood, roughness: 1 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(60, 3, 40), wood);
  top.position.y = 14;
  table.add(top);
  for (const [lx, lz] of [[-26, -16], [26, -16], [-26, 16], [26, 16]] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(3, 13, 3), wood);
    leg.position.set(lx, 6.5, lz);
    table.add(leg);
  }
  const mini = siegeMiniature();
  const tiny = new THREE.InstancedMesh(crescent(1.5, 0.22), new THREE.MeshStandardMaterial({ color: C.edge, roughness: 0.5 }), mini.length);
  mini.forEach((m, i) => {
    dummy.position.set(m.x, 15.5, m.z);
    dummy.rotation.set(0, Math.PI, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    tiny.setMatrixAt(i, dummy.matrix);
  });
  tiny.frustumCulled = false;
  table.add(tiny);
  table.position.set(SIEGE_TABLE_AT.x, 0, SIEGE_TABLE_AT.z);
  group.add(table);

  // The blur: a smear of pale light with no edge.
  const blur = softGlowPoints(
    [{ x: SIEGE_BLUR_AT.x - 26, y: 6, z: SIEGE_BLUR_AT.z }, { x: SIEGE_BLUR_AT.x, y: 8, z: SIEGE_BLUR_AT.z + 4 }, { x: SIEGE_BLUR_AT.x + 30, y: 6, z: SIEGE_BLUR_AT.z - 3 }],
    0xfff0c8,
    120,
    0.42,
    "siege-blur",
  );
  group.add(blur);

  // The cord: laid straight, staked at both ends, knotted at even stretches, the last knot untied.
  const cord = new THREE.Group();
  cord.name = "siege-cord";
  const line = new THREE.Mesh(new THREE.BoxGeometry(120, 0.7, 0.7), new THREE.MeshStandardMaterial({ color: C.cord, roughness: 1 }));
  line.position.y = 1;
  cord.add(line);
  const knots = new THREE.InstancedMesh(new THREE.SphereGeometry(1.3, 8, 6), new THREE.MeshStandardMaterial({ color: C.cord, roughness: 1 }), 5);
  for (let i = 0; i < 5; i++) {
    dummy.position.set(-48 + i * 24, 1.2, 0);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    knots.setMatrixAt(i, dummy.matrix);
  }
  cord.add(knots);
  for (const sx of [-1, 1]) {
    const stake = new THREE.Mesh(new THREE.BoxGeometry(1.6, 9, 1.6), wood);
    stake.position.set(sx * 62, 4.5, 0);
    cord.add(stake);
  }
  cord.position.set(SIEGE_CORD_AT.x, 0, SIEGE_CORD_AT.z);
  cord.rotation.y = 0.2;
  group.add(cord);

  const glowMat = beadGlow.material as THREE.PointsMaterial;
  const update = (ms: number, opts?: { reducedMotion?: boolean }) => {
    glowMat.opacity = 0.9 + (opts?.reducedMotion ? 0 : Math.sin((ms / 1000) * 0.7) * 0.08);
  };
  return { group, update, dispose: () => disposeObject3D(group) };
}
