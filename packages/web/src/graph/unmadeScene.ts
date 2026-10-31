import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import { softGlowPoints } from "./softGlow.js";
import { UNMADE, UNMADE_FRAME_Z, UNMADE_NOTE_AT, UNMADE_RING_RADIUS, UNMADE_SEAM_Z, UNMADE_STEP_HEIGHT, UNMADE_TALLY, unmadeHands, unmadeHollows } from "./unmadeLayout.js";

/**
 * The Unmade Hour (docs/specs/seam-the-unmade-hour-2026-10-31.md): a wide pale floor that remembers nothing. Shallow hollows come to a ring from every side and stop; at its centre one place is worn smooth
 * by standing, with an unlit lamp; seven stone hands, six holding a small light; a frame with no glass; a wall of finger-wide marks, the last group open; a step exactly one hand thick; a held note
 * of faint light. Procedural, no downloads. No figure, no text; nothing says why the hour was made twice. Named holders anchor places, spots and passages (invisible proxy boxes give instanced things a box).
 * Reduced motion holds the note still.
 *
 * Draw-call sketch (host budget ≤ 95): floor 1 · step 1 · step line 1 · ring 1 · hollows 1 · standing 3 · hands 3 · frame 6 · tally 3 · note 2 ≈ 22.
 */
export interface UnmadeScene {
  group: THREE.Group;
  update: (elapsedMs: number, opts?: { reducedMotion?: boolean }) => void;
  dispose: () => void;
}

const C = { floor: 0x7a768c, step: 0x86829c, dent: 0x5a566c, ring: 0xe4e0f2, patch: 0xa8a4bc, stone: 0x8e8ba0, light: 0xffe0a8, frame: 0x6a6678, void: 0x0a0912, wall: 0x6c687e, mark: 0xdcd8ea, note: 0xdcd0ff };

const proxy = (name: string, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
  m.name = name;
  m.position.set(x, y, z);
  m.visible = false;
  return m;
};

export function createUnmadeScene(): UnmadeScene {
  const group = new THREE.Group();
  group.name = "the-unmade-hour";
  const dummy = new THREE.Object3D();
  const stone = new THREE.MeshStandardMaterial({ color: C.stone, roughness: 1 });

  // The floor: one wide pale disc.
  const floor = new THREE.Mesh(new THREE.CircleGeometry(UNMADE.radius, 72), new THREE.MeshStandardMaterial({ color: C.floor, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.name = "unmade-floor";
  group.add(floor);

  // The step: the far part of the floor stands exactly one hand thick above the near part, its grain (here, its tone) the other way.
  const zSin = -UNMADE_SEAM_Z / UNMADE.radius;
  const a0 = Math.PI - Math.asin(zSin);
  const a1 = 2 * Math.PI + Math.asin(zSin);
  const shape = new THREE.Shape();
  shape.absarc(0, 0, UNMADE.radius - 1, a0, a1, false);
  shape.closePath();
  const step = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: UNMADE_STEP_HEIGHT, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: C.step, roughness: 1 }));
  step.rotation.x = -Math.PI / 2;
  step.name = "unmade-step";
  group.add(step);
  const chord = Math.sqrt(UNMADE.radius * UNMADE.radius - UNMADE_SEAM_Z * UNMADE_SEAM_Z) * 2;
  const edge = new THREE.Mesh(new THREE.BoxGeometry(chord, 0.6, 1.4), new THREE.MeshBasicMaterial({ color: C.ring, toneMapped: false }));
  edge.position.set(0, UNMADE_STEP_HEIGHT + 0.3, UNMADE_SEAM_Z);
  edge.name = "unmade-step-line";
  group.add(edge);
  group.add(proxy("unmade-seam", 170, 8, 24, 0, 4, UNMADE_SEAM_Z));

  // The hollows: shallow ovals leaning toward the ring, all of them where something was.
  const hollows = unmadeHollows();
  const dents = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 14), new THREE.MeshBasicMaterial({ color: C.dent, transparent: true, opacity: 0.85, depthWrite: false }), hollows.length);
  hollows.forEach((h, i) => {
    dummy.position.set(h.x, 0.5, h.z);
    dummy.rotation.set(-Math.PI / 2, 0, h.yaw);
    dummy.scale.set(6, 11, 1);
    dummy.updateMatrix();
    dents.setMatrixAt(i, dummy.matrix);
  });
  dents.name = "unmade-hollow-marks";
  dents.frustumCulled = false;
  group.add(dents);
  group.add(proxy("unmade-hollows", 320, 6, 240, 0, 3, -300));

  // The ring the steps stop at.
  const ring = new THREE.Mesh(new THREE.RingGeometry(UNMADE_RING_RADIUS - 2, UNMADE_RING_RADIUS + 2, 96), new THREE.MeshBasicMaterial({ color: C.ring, toneMapped: false, transparent: true, opacity: 0.8 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.7;
  ring.name = "unmade-ring";
  group.add(ring);

  // The standing place: a patch worn pale and a small lamp, unlit and wiped clean.
  const standing = new THREE.Group();
  standing.name = "unmade-standing";
  const patch = new THREE.Mesh(new THREE.CircleGeometry(12, 20), new THREE.MeshStandardMaterial({ color: C.patch, roughness: 0.6 }));
  patch.rotation.x = -Math.PI / 2;
  patch.position.y = 0.8;
  standing.add(patch);
  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.8, 2, 10), stone);
  lampBase.position.set(11, 1, 6);
  standing.add(lampBase);
  const lampGlass = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 5, 10), new THREE.MeshStandardMaterial({ color: 0x3a3848, roughness: 0.3, transparent: true, opacity: 0.8 }));
  lampGlass.position.set(11, 4.5, 6);
  standing.add(lampGlass);
  group.add(standing);

  // Seven open hands, palms up: six hold a small light, the seventh the same hollow and nothing in it.
  const hands = unmadeHands();
  const pillars = new THREE.InstancedMesh(new THREE.BoxGeometry(7, 13, 7), stone, hands.length);
  const palms = new THREE.InstancedMesh(new THREE.BoxGeometry(13, 2.4, 15), stone, hands.length);
  const lights: { x: number; y: number; z: number }[] = [];
  hands.forEach((h, i) => {
    dummy.rotation.set(0, Math.atan2(h.x, h.z), 0);
    dummy.scale.set(1, 1, 1);
    dummy.position.set(h.x, 6.5, h.z);
    dummy.updateMatrix();
    pillars.setMatrixAt(i, dummy.matrix);
    dummy.position.set(h.x, 14.2, h.z);
    dummy.rotation.set(0.18, Math.atan2(h.x, h.z), 0);
    dummy.updateMatrix();
    palms.setMatrixAt(i, dummy.matrix);
    if (h.lit) lights.push({ x: h.x, y: 20, z: h.z });
  });
  const handsGroup = new THREE.Group();
  handsGroup.name = "unmade-hands";
  handsGroup.add(pillars, palms, softGlowPoints(lights, C.light, 34, 0.95, "unmade-hand-lights"));
  group.add(handsGroup);

  // The frame with nothing in it, on the far, raised part of the floor.
  const frame = new THREE.Group();
  frame.name = "unmade-frame";
  const frameMat = new THREE.MeshStandardMaterial({ color: C.frame, roughness: 0.9 });
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(6, 150, 6), frameMat);
    post.position.set(sx * 44, 75, 0);
    frame.add(post);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(94, 6, 6), frameMat);
  lintel.position.set(0, 150, 0);
  frame.add(lintel);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(94, 6, 8), frameMat);
  sill.position.set(0, 3, 0);
  frame.add(sill);
  const dark = new THREE.Mesh(new THREE.PlaneGeometry(82, 144), new THREE.MeshBasicMaterial({ color: C.void, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
  dark.position.set(0, 75, 0);
  frame.add(dark);
  frame.position.set(0, UNMADE_STEP_HEIGHT, UNMADE_FRAME_Z);
  group.add(frame);

  // The wall of marks: a low curved wall of finger-wide strokes cut in groups, each closed by a short line across — the last group left open.
  const tally = new THREE.Group();
  tally.name = "unmade-tally";
  const { radius: tr, centre, span } = UNMADE_TALLY;
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(tr, tr, 34, 40, 1, true, centre - span / 2, span), new THREE.MeshStandardMaterial({ color: C.wall, roughness: 1, side: THREE.DoubleSide }));
  wall.position.y = 17;
  tally.add(wall);
  const strokes: { th: number; y: number; cross: boolean }[] = [];
  const perRow = 60;
  for (let row = 0; row < 3; row++)
    for (let i = 0; i < perRow; i++) {
      const th = centre - span / 2 + ((i + 1) / (perRow + 1)) * span;
      const inGroup = i % 6;
      if (inGroup < 5) strokes.push({ th, y: 8 + row * 9.5, cross: false });
      else if (!(row === 2 && i >= perRow - 6)) strokes.push({ th, y: 8 + row * 9.5, cross: true }); // the last group of the last row is left open
    }
  const bars = strokes.filter((s) => !s.cross);
  const crosses = strokes.filter((s) => s.cross);
  const barMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 7, 0.8), new THREE.MeshBasicMaterial({ color: C.mark, toneMapped: false }), bars.length);
  const crossMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(9, 1.2, 0.8), new THREE.MeshBasicMaterial({ color: C.mark, toneMapped: false }), crosses.length);
  const place = (mesh: THREE.InstancedMesh, list: typeof strokes, yOff: number) =>
    list.forEach((s, i) => {
      dummy.position.set(Math.sin(s.th) * (tr - 1), s.y + yOff, Math.cos(s.th) * (tr - 1));
      dummy.rotation.set(0, s.th + Math.PI, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
  place(barMesh, bars, 0);
  place(crossMesh, crosses, 0);
  barMesh.frustumCulled = false;
  crossMesh.frustumCulled = false;
  tally.add(barMesh, crossMesh);
  group.add(tally);

  // The held note: a column of faint light with no source, thinnest at the top.
  const note = new THREE.Group();
  note.name = "unmade-note";
  const col = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 3, 210, 10, 1, true), new THREE.MeshBasicMaterial({ color: C.note, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  col.position.y = 105;
  note.add(col);
  const noteGlow = softGlowPoints([{ x: 0, y: 14, z: 0 }, { x: 0, y: 70, z: 0 }, { x: 0, y: 140, z: 0 }], C.note, 70, 0.55, "unmade-note-glow");
  note.add(noteGlow);
  note.position.set(UNMADE_NOTE_AT.x, 0, UNMADE_NOTE_AT.z);
  group.add(note);

  const colMat = col.material as THREE.MeshBasicMaterial;
  const glowMat = noteGlow.material as THREE.PointsMaterial;
  const update = (ms: number, opts?: { reducedMotion?: boolean }) => {
    const breath = opts?.reducedMotion ? 0 : Math.sin((ms / 1000) * 0.5);
    colMat.opacity = 0.22 + breath * 0.07;
    glowMat.opacity = 0.55 + breath * 0.12;
  };
  return { group, update, dispose: () => disposeObject3D(group) };
}
