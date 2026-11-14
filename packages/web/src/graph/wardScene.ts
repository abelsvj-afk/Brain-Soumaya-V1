import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { disposeObject3D } from "./graph3dHelpers.js";
import { glowTexture, softGlowPoints } from "./softGlow.js";
import { cupGeometry, dustMotes, groundMist, lanternGeometry, lightPools, lightShaft, shadeByHeight, surfaceMaterial } from "./worldCraft.js";
import { WARD_COT_WALL_X, WARD_HALL, WARD_VIEW_Z, specialCot, wardCots, wardLanternPositions, wardOccupied } from "./wardLayout.js";

/**
 * The Faded Ward (docs/specs/seam-faded-ward-2026-10-31.md; look: docs/specs/worlds-redesign-2026-11-14.md §Ward): one long hall of narrow iron cots under an open timber roof —
 * worn boards underfoot, limewashed walls above a dark dado, a pilaster and a roof rib at every bay, lanterns hung on chains down both sides each laying a pool of ember light on the
 * boards, one tall window letting a shaft of cold starlight fall across the aisle, and the far end lost in mist. Every cot is made up: a blanket (no two quite the same faded colour),
 * a pillow. Built procedurally from the layout's numbers — no downloads. Nothing in it is counted, labelled or ranked. The Faded are in their beds as the lore paintings show them
 * (docs/lore/art/23-tamsin-tends-the-faded, 42-hesks-room-and-tamsins-ward): pale, see-through people at rest, some lying and some sitting up — whole figures, never a face;
 * the ward is a place of rest, not a morgue. The named holders (door, Ruel's cot, the made-up cot, the small bed's soldier, the bowl, the window, the coat hook,
 * the far end) are what the Fly-to places, spots and passages anchor to. Reduced motion holds every lantern, every breath, the dust and the mist still.
 *
 * Mesh count (this scene's test pins ≤ 40): floor 1 · walls 2 · dado 1 · pilasters 1 · ribs 1 · roof beams 1 · cot frames 1 · mattresses 1 · blankets 1 · pillows 1 · the Faded 2 ·
 * sleepers 1 · lantern bodies 1 · chains 1 · cores 1 · pools 1 · door 3 · Ruel 2 · made-up cot 1 · hook 2 · soldier 1 · bowl 4 · window 4 · far 1 ≈ 36, plus point sets.
 */
export interface WardScene {
  group: THREE.Group;
  update: (elapsedMs: number, opts?: { reducedMotion?: boolean }) => void;
  dispose: () => void;
}

const C = {
  iron: 0x4a524e,
  mattress: 0xd9ddd2,
  pillow: 0xf0f0e8,
  sleeper: 0xcfe6e0,
  lantern: 0xffc070,
  ember: 0xff9648,
  gold: 0xffd98a,
  coat: 0x5e6b5a,
  soldier: 0xb04a3c,
  bowl: 0xe6e2d4,
  star: 0x9db8ee,
};
/** Faded blanket colours — washed many times, none bright. Each cot takes one by its index, so the rows are not a printed pattern. */
const BLANKETS = [0xa9b79c, 0xb8bca6, 0x9cab94, 0xc2c4b0, 0xa3b0a0, 0xb4b89a, 0x98a890];

const named = <T extends THREE.Object3D>(o: T, name: string): T => {
  o.name = name;
  return o;
};

/** One iron cot frame, head at x = 0 running to x = +40 (toward the aisle), feet on y = 0: four legs, two side rails, a tall arched head-rail and a low foot-rail. */
function cotFrameGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const bar = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    parts.push(g);
  };
  for (const z of [-9.5, 9.5]) {
    bar(1.3, 30, 1.3, 0.6, 15, z); // head posts
    bar(1.3, 20, 1.3, 39.4, 10, z); // foot posts
    bar(40, 1.6, 1.2, 20, 12.5, z); // side rails
  }
  bar(1.1, 1.3, 19, 0.6, 29.4, 0); // head top rail
  bar(1.1, 1.1, 19, 0.6, 21, 0);
  bar(1.1, 1.3, 19, 39.4, 19.4, 0); // foot top rail
  for (const z of [-5, 0, 5]) bar(0.8, 9, 0.8, 0.6, 25, z); // head spindles
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged;
}

/**
 * One of the Faded, as a shape and never a portrait: a head, shoulders, a body and legs under a sheet — enough to be unmistakably a person at rest, with no face and no features
 * (the lore paintings show them exactly so: pale, see-through, whole). Authored with the head at the origin and the body running +x. `sitting` props the body upright from the hips.
 */
function fadedFigureGeometry(sitting: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const blob = (rx: number, ry: number, rz: number, x: number, y: number, z: number) => {
    const g = new THREE.SphereGeometry(1, 12, 8);
    g.scale(rx, ry, rz);
    g.translate(x, y, z);
    parts.push(g);
  };
  if (sitting) {
    blob(2.3, 2.8, 2.4, 10, 20.4, 0); // head, a little bowed
    blob(1.2, 1.8, 1.3, 9.2, 17.4, 0); // neck
    blob(2.5, 2.3, 6.2, 8.4, 14.6, 0); // shoulders
    blob(2.9, 6.8, 4.4, 8, 9.4, 0); // back and chest, upright, narrower at the waist
    blob(1.2, 5.6, 1.3, 9.6, 9.6, 6); // arms resting down
    blob(1.2, 5.6, 1.3, 9.6, 9.6, -6);
    blob(4.4, 2.6, 5.2, 9, 2.6, 0); // hips
    blob(9.5, 2.1, 2.3, 20, 2.2, 2.5); // legs under the sheet
    blob(9.5, 2.1, 2.3, 20, 2.2, -2.5);
    blob(1.6, 2.4, 1.6, 30, 2.8, 2.5); // feet tenting the sheet
    blob(1.6, 2.4, 1.6, 30, 2.8, -2.5);
  } else {
    blob(2.6, 2.4, 2.5, 0, 2.6, 0); // head on the pillow
    blob(1.5, 1.2, 1.4, 3, 1.8, 0);
    blob(7.2, 2.5, 5.4, 10.5, 2.4, 0); // chest and belly
    blob(6, 1.2, 1.3, 11, 1.8, 6); // arms along the sides
    blob(6, 1.2, 1.3, 11, 1.8, -6);
    blob(4.4, 2.3, 5, 17.5, 2.2, 0); // hips
    blob(9.5, 1.9, 2.2, 26, 2, 2.5);
    blob(9.5, 1.9, 2.2, 26, 2, -2.5);
    blob(1.5, 2.3, 1.5, 35, 2.6, 2.5);
    blob(1.5, 2.3, 1.5, 35, 2.6, -2.5);
  }
  const merged = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  // Two passes over the same triangles (see fadedMaterials): depth first, then colour — so only the figure's outer surface is drawn and it reads as one body, not a pile of bubbles.
  merged.addGroup(0, Infinity, 0);
  merged.addGroup(0, Infinity, 1);
  return merged;
}

/** The depth-only first pass for a Faded figure: writes no colour. */
const fadedDepthMaterial = (): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ colorWrite: false });

/** How the Faded are drawn: clear through the middle and brighter at the edges, so each one reads as a soft outline of light with the bed showing through. */
function fadedMaterial(color: number, opacity: number): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 p = vec4(position, 1.0);
        vec3 n = normal;
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
          n = mat3(instanceMatrix) * n;
        #endif
        vec4 mv = modelViewMatrix * p;
        vN = normalize(normalMatrix * n);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.4);
        gl_FragColor = vec4(mix(uColor, vec3(1.0), rim * 0.55), uOpacity * (0.85 + rim * 1.3));
      }`,
    transparent: true,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
    toneMapped: false,
  });
  m.opacity = opacity; // kept in step with the uniform (tests and the breathing read this)
  return m;
}

export function createWardScene(): WardScene {
  const group = new THREE.Group();
  group.name = "faded-ward";
  const length = WARD_HALL.zEnd - WARD_HALL.zStart;
  const midZ = (WARD_HALL.zEnd + WARD_HALL.zStart) / 2;
  const HW = WARD_HALL.halfWidth;
  const H = WARD_HALL.height;
  const dummy = new THREE.Object3D();
  const reset = () => {
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
  };

  // --- The hall. Boards run the length of it, darker under the cots and paler where the aisle has been walked. ---
  const floorGeo = new THREE.PlaneGeometry(HW * 2 + 12, length, 12, 2);
  floorGeo.rotateX(-Math.PI / 2);
  {
    const pos = floorGeo.getAttribute("position");
    const uv = floorGeo.getAttribute("uv");
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const ax = Math.abs(pos.getX(i)) / HW;
      const v = 0.5 + Math.max(0, 1 - ax / 0.35) * 0.5 - Math.max(0, (ax - 0.75) / 0.25) * 0.28;
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
      uv.setXY(i, pos.getZ(i) / 90, pos.getX(i) / 60); // grain along the hall
    }
    floorGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  }
  const floor = new THREE.Mesh(floorGeo, surfaceMaterial("wood", { vertexColors: true, tint: 0x9c8e80, roughness: 0.82 }));
  floor.position.set(0, 0, midZ);
  floor.name = "ward-floor";
  group.add(floor);

  // Limewashed walls, darker where they meet the floor and up under the roof.
  const wallGeo = new THREE.PlaneGeometry(length, H, 2, 10);
  wallGeo.translate(0, H / 2, 0);
  shadeByHeight(wallGeo, 0, H, 0.42, 0.62);
  {
    const pos = wallGeo.getAttribute("position");
    const uv = wallGeo.getAttribute("uv");
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 150, pos.getY(i) / 150);
  }
  const wallMat = surfaceMaterial("plaster", { vertexColors: true, tint: 0xb9bfa4, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    wall.position.set(side * (HW + 6), 0, midZ);
    wall.name = `ward-wall-${side < 0 ? "left" : "right"}`;
    group.add(wall);
  }
  // A dark boarded dado along both walls at the height of a cot's head-rail (two instances of one long board).
  const timber = surfaceMaterial("wood", { tint: 0x6a5a4c, repeat: [length / 120, 1] });
  const dado = new THREE.InstancedMesh(new THREE.BoxGeometry(3, 36, length), timber, 2);
  [-1, 1].forEach((side, i) => {
    dummy.position.set(side * (HW + 4.5), 18, midZ);
    dummy.updateMatrix();
    dado.setMatrixAt(i, dummy.matrix);
  });
  dado.name = "ward-dado";
  group.add(dado);

  // Bays: a pilaster on each wall and a timber rib overhead every 120 units; a ridge beam and two purlins tie the ribs together. The roof is open between them — the sky shows.
  const bays: number[] = [];
  for (let z = WARD_HALL.zStart + 60; z <= WARD_HALL.zEnd; z += 120) bays.push(z);
  const pilasters = new THREE.InstancedMesh(new THREE.BoxGeometry(7, H * 0.62, 9), surfaceMaterial("plaster", { tint: 0xa9ad94, repeat: [0.2, 1] }), bays.length * 2);
  const ribs = new THREE.InstancedMesh(new THREE.TorusGeometry(HW + 6, 3.2, 6, 22, Math.PI), surfaceMaterial("wood", { tint: 0x54483e, repeat: [6, 0.3] }), bays.length);
  bays.forEach((z, i) => {
    reset();
    dummy.position.set(0, H * 0.58, z);
    dummy.scale.set(1, 0.9, 1);
    dummy.updateMatrix();
    ribs.setMatrixAt(i, dummy.matrix);
    reset();
    [-1, 1].forEach((side, k) => {
      dummy.position.set(side * (HW + 3), H * 0.31, z);
      dummy.updateMatrix();
      pilasters.setMatrixAt(i * 2 + k, dummy.matrix);
    });
  });
  ribs.name = "ward-roof-ribs";
  pilasters.name = "ward-pilasters";
  const beams = new THREE.InstancedMesh(new THREE.BoxGeometry(4.5, 5, length), timber, 3);
  const crown = H * 0.58 + (HW + 6) * 0.9;
  [
    [0, crown - 2],
    [-(HW + 6) * 0.72, H * 0.58 + (HW + 6) * 0.9 * 0.69],
    [(HW + 6) * 0.72, H * 0.58 + (HW + 6) * 0.9 * 0.69],
  ].forEach(([x, y], i) => {
    dummy.position.set(x!, y!, midZ);
    dummy.updateMatrix();
    beams.setMatrixAt(i, dummy.matrix);
  });
  beams.name = "ward-roof-beams";
  group.add(ribs, pilasters, beams);

  // --- Cots: an iron frame, a mattress, a blanket turned down below the pillow, a pillow, and a stool at the aisle side. Faint sleepers in about two in three. ---
  const cots = wardCots();
  const occupied = wardOccupied(cots);
  const frames = new THREE.InstancedMesh(cotFrameGeometry(), new THREE.MeshStandardMaterial({ color: C.iron, roughness: 0.55, metalness: 0.75 }), cots.length);
  const mattresses = new THREE.InstancedMesh(new THREE.BoxGeometry(38, 4, 18), new THREE.MeshStandardMaterial({ color: C.mattress, roughness: 1 }), cots.length);
  const blanketGeo = new THREE.BoxGeometry(27, 4.8, 19.4, 3, 1, 1);
  {
    // Let the blanket's long edges sag a little over the mattress sides.
    const pos = blanketGeo.getAttribute("position");
    for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getZ(i)) > 9 && pos.getY(i) < 0) pos.setY(i, pos.getY(i) - 2.2);
    blanketGeo.computeVertexNormals();
  }
  const blankets = new THREE.InstancedMesh(blanketGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), cots.length);
  const pillowGeo = new THREE.SphereGeometry(1, 10, 6);
  pillowGeo.scale(4.6, 1.7, 6.8);
  const pillows = new THREE.InstancedMesh(pillowGeo, new THREE.MeshStandardMaterial({ color: C.pillow, roughness: 1 }), cots.length);
  // The Faded: about two cots in three hold one — most lying, some sitting up — pale and see-through. A person at rest in each bed, never a face.
  const sitsUp = (i: number) => cots[i]!.index % 4 === 1;
  const lyingCount = occupied.filter((o, i) => o && !sitsUp(i)).length;
  const sleeperMat = fadedMaterial(C.sleeper, 0.32);
  const fadedDepth = fadedDepthMaterial();
  const sleepers = new THREE.InstancedMesh(fadedFigureGeometry(false), [fadedDepth, sleeperMat], Math.max(1, lyingCount));
  const sitters = new THREE.InstancedMesh(fadedFigureGeometry(true), [fadedDepth, sleeperMat], Math.max(1, occupied.filter(Boolean).length - lyingCount));
  const fadedGlow: { x: number; y: number; z: number }[] = [];
  let sitI = 0;
  const tint = new THREE.Color();
  let si = 0;
  cots.forEach((c, i) => {
    const dir = -c.side; // from the wall toward the aisle
    const cx = c.x + dir * 20;
    reset();
    dummy.position.set(c.x, 0, c.z);
    dummy.rotation.y = dir > 0 ? 0 : Math.PI; // the frame is authored head-at-origin running +x
    dummy.updateMatrix();
    frames.setMatrixAt(i, dummy.matrix);
    reset();
    dummy.position.set(cx, 15.2, c.z);
    dummy.updateMatrix();
    mattresses.setMatrixAt(i, dummy.matrix);
    dummy.position.set(cx + dir * 6, 16.6, c.z);
    dummy.updateMatrix();
    blankets.setMatrixAt(i, dummy.matrix);
    blankets.setColorAt(i, tint.setHex(BLANKETS[(c.index * 3 + (c.side > 0 ? 2 : 0)) % BLANKETS.length]!));
    dummy.position.set(c.x + dir * 6.5, 18.6, c.z);
    dummy.updateMatrix();
    pillows.setMatrixAt(i, dummy.matrix);
    if (occupied[i]) {
      reset();
      dummy.position.set(c.x + dir * 6.5, 17.6, c.z);
      dummy.rotation.y = dir > 0 ? 0 : Math.PI; // head at the pillow, body toward the aisle
      dummy.updateMatrix();
      if (sitsUp(i)) sitters.setMatrixAt(sitI++, dummy.matrix);
      else sleepers.setMatrixAt(si++, dummy.matrix);
      fadedGlow.push({ x: c.x + dir * 16, y: sitsUp(i) ? 30 : 22, z: c.z });
    }
  });
  sleepers.count = si;
  sitters.count = sitI;
  reset();
  frames.name = "ward-cot-frames";
  mattresses.name = "ward-cot-mattresses";
  blankets.name = "ward-cot-blankets";
  pillows.name = "ward-cot-pillows";
  sleepers.name = "ward-sleepers";
  sitters.name = "ward-sitters";
  sleepers.renderOrder = sitters.renderOrder = 4;
  // Each of them gives off a little light of their own.
  const fadedLight = softGlowPoints(fadedGlow, 0xbfe6ee, 44, 0.2, "ward-faded-light");
  group.add(frames, mattresses, blankets, pillows, sleepers, sitters, fadedLight);

  // --- Lanterns: an iron lantern on a chain from the roof, an ember core, a soft glow, and a pool of light on the boards below. ---
  const lanterns = wardLanternPositions();
  const iron = new THREE.MeshStandardMaterial({ color: 0x1e2022, roughness: 0.6, metalness: 0.7 });
  const bodies = new THREE.InstancedMesh(lanternGeometry(13), iron, lanterns.length);
  const chains = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.35, 1, 4), iron, lanterns.length);
  const cores = new THREE.InstancedMesh(new THREE.SphereGeometry(2.2, 8, 6), new THREE.MeshBasicMaterial({ color: C.lantern, toneMapped: false }), lanterns.length);
  lanterns.forEach((l, i) => {
    reset();
    dummy.position.set(l.x, l.y + 8, l.z);
    dummy.updateMatrix();
    bodies.setMatrixAt(i, dummy.matrix);
    dummy.position.set(l.x, l.y, l.z);
    dummy.updateMatrix();
    cores.setMatrixAt(i, dummy.matrix);
    const chainLen = H * 0.58 + (HW + 6) * 0.9 * 0.69 - (l.y + 8);
    dummy.position.set(l.x, l.y + 8 + chainLen / 2, l.z);
    dummy.scale.set(1, chainLen, 1);
    dummy.updateMatrix();
    chains.setMatrixAt(i, dummy.matrix);
  });
  reset();
  bodies.name = "ward-lantern-bodies";
  chains.name = "ward-lantern-chains";
  cores.name = "ward-lantern-cores";
  const glows = softGlowPoints(lanterns, C.lantern, 40, 0.55, "ward-lantern-glows");
  const glowMat = glows.material as THREE.PointsMaterial;
  // The pool falls toward the aisle (the cots stand under the lanterns themselves), so the light is seen on the boards.
  const pools = lightPools(lanterns.map((l) => ({ x: l.x * 0.55, z: l.z })), C.ember, 120, 0.42, "ward-lantern-pools");
  group.add(bodies, chains, cores, glows, pools);
  // True light on the cots nearest the visitor; the pools carry the rest of the hall.
  for (const l of [...lanterns].sort((a, b) => Math.abs(a.z - WARD_VIEW_Z) - Math.abs(b.z - WARD_VIEW_Z)).slice(0, 4)) {
    const p = new THREE.PointLight(C.lantern, 1300, 420, 1.6);
    p.position.set(l.x, l.y, l.z);
    group.add(p);
  }

  // --- Named holders: the places the lore and the Fly-to tiles anchor to. ---
  // The door: a plain timber arch at the near end, with pale light standing in it.
  const door = named(new THREE.Group(), "ward-door");
  const doorFrame = new THREE.Mesh(new THREE.TorusGeometry(34, 3.4, 6, 20, Math.PI), timber);
  doorFrame.position.set(0, 0, -150);
  door.add(doorFrame);
  const doorLight = new THREE.Mesh(new THREE.PlaneGeometry(110, 110), new THREE.MeshBasicMaterial({ color: 0xcfe0f0, map: glowTexture(), transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  doorLight.position.set(0, 18, -152);
  door.add(doorLight);
  door.add(lightPools([{ x: 0, z: -110 }], 0xcfe0f0, 80, 0.35, "ward-door-spill"));
  door.position.set(0, 4, 0);
  group.add(door);

  // Ruel's cot: a warm ring of gold light above it (a laugh kept, never a body).
  const ruelCot = specialCot("ruel");
  const ruel = named(new THREE.Group(), "ward-cot-ruel");
  const ruelRing = new THREE.Mesh(new THREE.TorusGeometry(9, 0.7, 8, 32), new THREE.MeshBasicMaterial({ color: C.gold, transparent: true, opacity: 0.85, toneMapped: false }));
  ruelRing.rotation.y = Math.PI / 2;
  ruelRing.position.set(-ruelCot.side * 20, 40, 0);
  ruel.add(ruelRing);
  const ruelShape = new THREE.Mesh(fadedFigureGeometry(true), [fadedDepth, fadedMaterial(C.gold, 0.26)]);
  ruelShape.rotation.y = ruelCot.side < 0 ? 0 : Math.PI;
  ruelShape.position.set(-ruelCot.side * 6.5, 17.6, 0);
  ruelShape.renderOrder = 4;
  ruel.add(ruelShape);
  ruel.add(softGlowPoints([{ x: -ruelCot.side * 20, y: 40, z: 0 }], C.gold, 52, 0.4, "ward-ruel-glow"));
  ruel.position.set(ruelCot.x, 0, ruelCot.z);
  group.add(ruel);

  // The made-up cot for whoever wore the coat on the hook: a second blanket folded square at its foot and nobody in it; the coat hangs on the wall above.
  const linnetCot = specialCot("linnet");
  const linnet = named(new THREE.Group(), "ward-cot-linnet");
  const folded = new THREE.Mesh(new THREE.BoxGeometry(11, 4.5, 15), new THREE.MeshStandardMaterial({ color: 0xa9c2b4, roughness: 1 }));
  folded.position.set(-linnetCot.side * 33, 21, 0);
  linnet.add(folded);
  linnet.position.set(linnetCot.x, 0, linnetCot.z);
  group.add(linnet);
  const hook = named(new THREE.Group(), "ward-hook");
  // The coat: a long hanging shape narrower at the shoulders, with a little thickness — not a plank.
  const coatGeo = new THREE.CylinderGeometry(5.5, 8.5, 34, 8, 3);
  coatGeo.scale(0.42, 1, 1);
  const coat = new THREE.Mesh(coatGeo, new THREE.MeshStandardMaterial({ color: C.coat, roughness: 1 }));
  coat.position.set(-linnetCot.side * 3, -2, 0);
  hook.add(coat);
  const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 6, 6), iron);
  peg.rotation.z = Math.PI / 2;
  peg.position.set(-linnetCot.side * 2, 16, 0);
  hook.add(peg);
  hook.position.set(linnetCot.x + linnetCot.side * 2, 68, linnetCot.z - 44);
  group.add(hook);

  // The small bed with a tin soldier on the floor beside it.
  const smallCot = specialCot("small");
  const small = named(new THREE.Group(), "ward-small-bed");
  const soldierGeo = mergeGeometries([new THREE.CylinderGeometry(1.2, 1.5, 5.4, 8).translate(0, 2.7, 0), new THREE.SphereGeometry(1.15, 8, 6).translate(0, 6.3, 0), new THREE.CylinderGeometry(1.3, 1.1, 1.8, 8).translate(0, 7.9, 0)]);
  const soldier = new THREE.Mesh(soldierGeo, new THREE.MeshStandardMaterial({ color: C.soldier, roughness: 0.45, metalness: 0.5 }));
  soldier.position.set(-smallCot.side * 46, 0, 0);
  small.add(soldier);
  small.position.set(smallCot.x, 0, smallCot.z);
  group.add(small);

  // The bowl: a small table in the aisle with one bowl of soup, steaming.
  const bowl = named(new THREE.Group(), "ward-bowl");
  const tableWood = surfaceMaterial("wood", { tint: 0x8a7462, repeat: [0.4, 0.4] });
  const table = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 1.8, 18), tableWood);
  table.position.set(0, 24, 0);
  bowl.add(table);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 4.5, 23, 8), tableWood);
  leg.position.set(0, 11.5, 0);
  bowl.add(leg);
  const bowlMesh = new THREE.Mesh(cupGeometry(5, 3.6), new THREE.MeshStandardMaterial({ color: C.bowl, roughness: 0.4, side: THREE.DoubleSide }));
  bowlMesh.position.set(0, 24.9, 0);
  bowl.add(bowlMesh);
  const steam = new THREE.Mesh(new THREE.PlaneGeometry(9, 14), new THREE.MeshBasicMaterial({ color: 0xffffff, map: glowTexture(), transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  steam.name = "ward-steam";
  steam.position.set(0, 36, 0);
  bowl.add(steam);
  bowl.position.set(0, 0, 720); // well down the aisle, so the orbit sees the rows first and the bowl ahead
  group.add(bowl);

  // The window: a tall opening of starlight on the left wall, barred by one mullion and one transom, with its light falling in a long shaft across the aisle onto the boards.
  const win = named(new THREE.Group(), "ward-window");
  const winGlass = new THREE.Mesh(new THREE.PlaneGeometry(46, 86), new THREE.MeshBasicMaterial({ color: C.star, transparent: true, opacity: 0.5, side: THREE.DoubleSide, toneMapped: false }));
  winGlass.rotation.y = Math.PI / 2;
  win.add(winGlass);
  const bars = mergeGeometries([new THREE.BoxGeometry(3, 92, 3).translate(0, 0, -24.5), new THREE.BoxGeometry(3, 92, 3).translate(0, 0, 24.5), new THREE.BoxGeometry(3, 3, 52).translate(0, 44.5, 0), new THREE.BoxGeometry(3, 4, 56).translate(0, -44.5, 0), new THREE.BoxGeometry(2, 88, 1.6), new THREE.BoxGeometry(2, 1.6, 48).translate(0, 12, 0)]);
  const winFrame = new THREE.Mesh(bars, timber);
  winFrame.position.set(1.5, 0, 0);
  win.add(winFrame);
  const shaft = lightShaft(190, 26, 64, C.star, 0.2, "ward-window-shaft");
  shaft.rotation.z = Math.PI / 2 + 0.52; // from the window down across the aisle
  shaft.position.set(150, -78, 0);
  win.add(shaft);
  const winPool = lightPools([{ x: 150, y: -84, z: 0 }], C.star, 70, 0.4, "ward-window-pool");
  win.add(winPool);
  win.position.set(-(HW + 3), 84, 760);
  group.add(win);

  // More windows down both walls, one every third bay: the same opening onto the stars, so the hall has a rhythm of cold light against the lanterns' warm one.
  const others: { side: number; z: number }[] = [];
  bays.forEach((z, i) => {
    if (i % 3 !== 1) return;
    for (const side of [-1, 1]) if (!(side < 0 && Math.abs(z + 60 - 760) < 100)) others.push({ side, z: z + 60 });
  });
  const panes = new THREE.InstancedMesh(new THREE.PlaneGeometry(46, 86), new THREE.MeshBasicMaterial({ color: C.star, transparent: true, opacity: 0.42, side: THREE.DoubleSide, toneMapped: false }), others.length);
  const sashes = new THREE.InstancedMesh(bars.clone(), timber, others.length);
  others.forEach((o, i) => {
    reset();
    dummy.position.set(o.side * (HW + 3), 84, o.z);
    dummy.rotation.y = Math.PI / 2;
    dummy.updateMatrix();
    panes.setMatrixAt(i, dummy.matrix);
    reset();
    dummy.position.set(o.side * (HW + 1.5), 84, o.z);
    dummy.updateMatrix();
    sashes.setMatrixAt(i, dummy.matrix);
  });
  reset();
  panes.name = "ward-windows-glass";
  sashes.name = "ward-windows-sashes";
  group.add(panes, sashes, lightPools(others.map((o) => ({ x: o.side * 40, z: o.z })), C.star, 70, 0.22, "ward-windows-pools"));

  // The far end: a faint pale light the hall seems to lead to and never reaches.
  const far = named(new THREE.Mesh(new THREE.SphereGeometry(26, 12, 10), new THREE.MeshBasicMaterial({ color: 0xdfe8f0, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })), "ward-far");
  far.position.set(0, 60, WARD_HALL.zEnd - 120);
  group.add(far);

  // Air: dust turning in the lantern light round the visitor, and a low mist that thickens down the hall.
  const dust = dustMotes({ min: [-HW + 10, 6, WARD_VIEW_Z - 240], max: [HW - 10, 130, WARD_VIEW_Z + 520] }, 170, 0xffe2b8, 2, 0.45, "ward-dust");
  const mistAt: { x: number; y: number; z: number }[] = [];
  for (let z = 120; z < WARD_HALL.zEnd; z += 130) mistAt.push({ x: ((z / 170) % 2 ? 1 : -1) * 30, y: 14, z });
  const mist = groundMist(mistAt, 0xc8d6cc, 380, 0.1, "ward-mist");
  group.add(dust.object, mist.object);

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
      sleeperMat.opacity = sleeperMat.uniforms.uOpacity!.value = 0.32;
      steam.position.y = 36;
      return;
    }
    const t = ms / 1000;
    glowMat.opacity = 0.55 + Math.sin(t * 0.9) * 0.08; // the lanterns breathe, slowly, all together
    sleeperMat.opacity = sleeperMat.uniforms.uOpacity!.value = 0.32 + Math.sin(t * 0.55) * 0.04; // the Faded breathe
    steam.position.y = 36 + ((t * 5) % 8);
    dust.update(ms, false);
    mist.update(ms, false);
  };

  const dispose = () => {
    disposeObject3D(group);
  };
  return { group, update, dispose };
}
