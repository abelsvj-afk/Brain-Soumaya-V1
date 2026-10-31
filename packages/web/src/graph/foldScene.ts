import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import { softGlowPoints } from "./softGlow.js";
import { FOLD, FOLD_CHAIR_AT, FOLD_DOOR_AJAR, FOLD_DOOR_AT, FOLD_DOOR_WIDTH, FOLD_LAMP_AT, FOLD_READER_AT, FOLD_SEAT_AT, FOLD_SHELF, FOLD_WINDOW_AT, foldShelfLetters } from "./foldLayout.js";

/**
 * The Folded Letter (docs/specs/seam-the-folded-letter-2026-10-31.md): the last room. A small bare room open to the night, one letter folded in thirds in the middle of its floor, a place set for the reader, a lamp left
 * lit, a chair drawn back, a long shelf of kept letters, a window onto more stars than the room has walls, a door ajar one hand's breadth, a seat by the door worn by long sitting. Procedural, no downloads. No figure, no
 * text and nothing legible on any paper; nothing says whether the sentence is kind, and nothing here records whether it is opened (there is no way to open it). Named holders anchor places, spots and passages (invisible
 * proxy boxes give instanced things a box). Reduced motion holds the lamp still.
 *
 * Draw-call sketch (host budget ≤ 95): floor 1 · walls 6 · letter 2 · cushion 1 · pool 1 · lamp 2 · table+chair 6 · shelf 2 · door 2 · seat 2 · window 3 ≈ 28.
 */
export interface FoldScene {
  group: THREE.Group;
  update: (elapsedMs: number, opts?: { reducedMotion?: boolean }) => void;
  dispose: () => void;
}

const C = { floor: 0x4a3f34, wall: 0x6a5e50, wood: 0x7a6248, paper: 0xf4ecd8, fold: 0xd8cdb4, lamp: 0xffcf86, cushion: 0x8a6a58, thumb: 0x9a7a52 };

const proxy = (name: string, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
  m.name = name;
  m.position.set(x, y, z);
  m.visible = false;
  return m;
};

export function createFoldScene(): FoldScene {
  const group = new THREE.Group();
  group.name = "the-folded-letter";
  const dummy = new THREE.Object3D();
  const wood = new THREE.MeshStandardMaterial({ color: C.wood, roughness: 1 });
  const wall = new THREE.MeshStandardMaterial({ color: C.wall, roughness: 1 });
  const paper = new THREE.MeshStandardMaterial({ color: C.paper, roughness: 0.9 });
  const H = FOLD.half;
  const WH = FOLD.wallHeight;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), new THREE.MeshStandardMaterial({ color: C.floor, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.name = "fold-floor";
  group.add(floor);

  // Four low walls, open to the night; the +x wall is split to leave the door's gap, and the −x wall carries the window.
  const wallBox = (w: number, d: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, WH, d), wall);
    m.position.set(x, WH / 2, z);
    group.add(m);
  };
  wallBox(H * 2, 6, 0, -H); // back (shelf side)
  wallBox(H * 2, 6, 0, H); // front
  const gapA = FOLD_DOOR_AT.z - FOLD_DOOR_WIDTH / 2;
  const gapB = FOLD_DOOR_AT.z + FOLD_DOOR_WIDTH / 2;
  wallBox(6, gapA + H, FOLD_DOOR_AT.x, (gapA - H) / 2); // +x wall, below the door
  wallBox(6, H - gapB, FOLD_DOOR_AT.x, (H + gapB) / 2); // +x wall, above the door
  // −x wall in three pieces round the window opening
  const wy0 = 28;
  const wy1 = 78;
  const wz0 = FOLD_WINDOW_AT.z - 30;
  const wz1 = FOLD_WINDOW_AT.z + 30;
  const left = new THREE.Mesh(new THREE.BoxGeometry(6, WH, wz0 + H), wall);
  left.position.set(-H, WH / 2, (wz0 - H) / 2);
  const right = new THREE.Mesh(new THREE.BoxGeometry(6, WH, H - wz1), wall);
  right.position.set(-H, WH / 2, (H + wz1) / 2);
  const below = new THREE.Mesh(new THREE.BoxGeometry(6, wy0, 60), wall);
  below.position.set(-H, wy0 / 2, FOLD_WINDOW_AT.z);
  const above = new THREE.Mesh(new THREE.BoxGeometry(6, WH - wy1, 60), wall);
  above.position.set(-H, wy1 + (WH - wy1) / 2, FOLD_WINDOW_AT.z);
  group.add(left, right, below, above);

  // The window: a thin frame and a dark pane with a handful of stars in it.
  const win = new THREE.Group();
  win.name = "fold-window";
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(56, wy1 - wy0), new THREE.MeshBasicMaterial({ color: 0x080a14, side: THREE.DoubleSide }));
  pane.rotation.y = Math.PI / 2;
  pane.position.set(-H + 0.5, (wy0 + wy1) / 2, FOLD_WINDOW_AT.z);
  win.add(pane);
  const stars: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < 18; i++) stars.push({ x: -H + 1.5, y: wy0 + 6 + ((i * 37) % 38), z: FOLD_WINDOW_AT.z - 24 + ((i * 53) % 48) });
  win.add(softGlowPoints(stars, 0xdfe8ff, 5, 0.9, "fold-window-stars"));
  const frameMat = new THREE.MeshStandardMaterial({ color: C.wood, roughness: 1 });
  for (const dz of [-29, 29]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(3, wy1 - wy0 + 4, 3), frameMat);
    f.position.set(-H + 2, (wy0 + wy1) / 2, FOLD_WINDOW_AT.z + dz);
    win.add(f);
  }
  group.add(win);

  // The letter: folded in thirds, on the bare floor. The fold is a soft seam; nothing is written on it.
  const letter = new THREE.Group();
  letter.name = "fold-letter";
  const body = new THREE.Mesh(new THREE.BoxGeometry(15, 1.4, 9.5), paper);
  body.position.y = 0.8;
  letter.add(body);
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.5, 9.4), new THREE.MeshStandardMaterial({ color: C.fold, roughness: 1 }));
  for (const sx of [-2.5, 2.5]) {
    const s = seam.clone();
    s.position.set(sx, 1.1, 0);
    letter.add(s);
  }
  letter.rotation.y = 0.12;
  group.add(letter);
  group.add(proxy("fold-letter-box", 18, 4, 12, 0, 2, 0));

  // The place for the reader: an empty cushion in a pool of lamplight, facing the letter, the size of whoever comes.
  const reader = new THREE.Group();
  reader.name = "fold-reader";
  const cushion = new THREE.Mesh(new THREE.CylinderGeometry(13, 14, 4, 18), new THREE.MeshStandardMaterial({ color: C.cushion, roughness: 1 }));
  cushion.position.y = 2;
  reader.add(cushion);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(30, 28), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.4;
  reader.add(pool);
  reader.position.set(FOLD_READER_AT.x, 0, FOLD_READER_AT.z);
  group.add(reader);

  // The lamp left lit beside the letter.
  const lamp = new THREE.Group();
  lamp.name = "fold-lamp";
  const base = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, 4, 10), wood);
  base.position.y = 2;
  lamp.add(base);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(2.6, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe2a0, toneMapped: false }));
  flame.position.y = 8;
  lamp.add(flame);
  const lampGlow = softGlowPoints([{ x: 0, y: 8, z: 0 }], C.lamp, 120, 0.9, "fold-lamp-glow");
  lamp.add(lampGlow);
  lamp.position.set(FOLD_LAMP_AT.x, 0, FOLD_LAMP_AT.z);
  group.add(lamp);

  // A plain chair at a small table, drawn back a little; a pen with its cap on, no paper.
  const chair = new THREE.Group();
  chair.name = "fold-chair";
  const top = new THREE.Mesh(new THREE.BoxGeometry(40, 3, 26), wood);
  top.position.y = 24;
  chair.add(top);
  for (const [lx, lz] of [[-17, -10], [17, -10], [-17, 10], [17, 10]] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(2.4, 23, 2.4), wood);
    leg.position.set(lx, 11.5, lz);
    chair.add(leg);
  }
  const seat = new THREE.Mesh(new THREE.BoxGeometry(18, 2.4, 18), wood);
  seat.position.set(4, 14, 34);
  chair.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(18, 20, 2), wood);
  back.position.set(4, 25, 42);
  chair.add(back);
  for (const [lx, lz] of [[-3, 27], [11, 27], [-3, 41], [11, 41]] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(2, 13, 2), wood);
    leg.position.set(lx, 6.5, lz);
    chair.add(leg);
  }
  const pen = new THREE.Mesh(new THREE.BoxGeometry(9, 0.9, 0.9), new THREE.MeshStandardMaterial({ color: 0x2a2a34, roughness: 0.5 }));
  pen.position.set(-4, 26, 2);
  chair.add(pen);
  chair.position.set(FOLD_CHAIR_AT.x, 0, FOLD_CHAIR_AT.z);
  group.add(chair);

  // The long shelf of kept letters, none opened; each carries the small press of one thumb (a dot, not a mark that could be read).
  const shelf = new THREE.Group();
  shelf.name = "fold-shelf";
  const board = new THREE.Mesh(new THREE.BoxGeometry(FOLD_SHELF.x1 - FOLD_SHELF.x0 + 30, 3, 16), wood);
  board.position.set((FOLD_SHELF.x0 + FOLD_SHELF.x1) / 2, 40, FOLD_SHELF.z + 4);
  shelf.add(board);
  const letters = foldShelfLetters();
  const kept = new THREE.InstancedMesh(new THREE.BoxGeometry(6, 1, 12), paper, letters.length);
  const thumbs = new THREE.InstancedMesh(new THREE.CircleGeometry(0.9, 8), new THREE.MeshBasicMaterial({ color: C.thumb, side: THREE.DoubleSide }), letters.length);
  letters.forEach((l, i) => {
    dummy.position.set(l.x, 41.5 + l.h / 2, FOLD_SHELF.z + 4);
    dummy.rotation.set(Math.PI / 2, 0, l.lean);
    dummy.scale.set(1, 1, l.h / 12);
    dummy.updateMatrix();
    kept.setMatrixAt(i, dummy.matrix);
    dummy.position.set(l.x + l.thumb * 0.3, 41.5 + l.h / 2, FOLD_SHELF.z + 4 + 0.6);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    thumbs.setMatrixAt(i, dummy.matrix);
  });
  kept.frustumCulled = false;
  thumbs.frustumCulled = false;
  shelf.add(kept, thumbs);
  group.add(shelf);

  // The door: a frame in the gap, the slab swung ajar by a hand's breadth and never shut.
  const door = new THREE.Group();
  door.name = "fold-door";
  for (const dz of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(6, 96, 4), wood);
    post.position.set(0, 48, dz * (FOLD_DOOR_WIDTH / 2));
    door.add(post);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(6, 4, FOLD_DOOR_WIDTH + 4), wood);
  lintel.position.set(0, 98, 0);
  door.add(lintel);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 94, FOLD_DOOR_WIDTH - 4), new THREE.MeshStandardMaterial({ color: 0x8a7050, roughness: 1 }));
  slab.position.set(0, 47, 0);
  slab.geometry.translate(0, 0, (FOLD_DOOR_WIDTH - 4) / 2);
  slab.position.z = -FOLD_DOOR_WIDTH / 2 + 2;
  slab.rotation.y = Math.asin((FOLD_DOOR_AJAR * 3) / (FOLD_DOOR_WIDTH - 4)); // the free edge stands about a hand's breadth (≈10 units) off the post
  door.add(slab);
  door.position.set(FOLD_DOOR_AT.x, 0, FOLD_DOOR_AT.z);
  group.add(door);

  // The seat by the door, worn by long sitting.
  const seatG = new THREE.Group();
  seatG.name = "fold-seat";
  const stool = new THREE.Mesh(new THREE.CylinderGeometry(9, 10, 12, 12), wood);
  stool.position.y = 6;
  seatG.add(stool);
  const worn = new THREE.Mesh(new THREE.CircleGeometry(7, 14), new THREE.MeshStandardMaterial({ color: 0x9a8260, roughness: 0.5 }));
  worn.rotation.x = -Math.PI / 2;
  worn.position.y = 12.1;
  seatG.add(worn);
  seatG.position.set(FOLD_SEAT_AT.x, 0, FOLD_SEAT_AT.z);
  group.add(seatG);

  const glowMat = lampGlow.material as THREE.PointsMaterial;
  const update = (ms: number, opts?: { reducedMotion?: boolean }) => {
    glowMat.opacity = 0.9 + (opts?.reducedMotion ? 0 : Math.sin((ms / 1000) * 1.3) * 0.05);
  };
  return { group, update, dispose: () => disposeObject3D(group) };
}
