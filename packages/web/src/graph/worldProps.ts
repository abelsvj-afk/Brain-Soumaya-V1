import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";

/**
 * Story props (docs/specs/world-props-2026-10-31.md; Draft 9 §5): small wordless things that carry the story — placed beside scene holders that already exist, in the holder's
 * own box coordinates, sized to the holder, so they read at the scale of what they stand beside. Presentation only: nothing here finds, scores or explains. No text anywhere.
 */
export type PropKind =
  | "berth-board"
  | "chalk-tally"
  | "stair-ribbon"
  | "paper-boats"
  | "torn-hymnal"
  | "table-one-more"
  | "button-jar"
  | "seed-stone"
  | "untied-cord"
  | "probe-notebook"
  | "sixteen-lamps";

export interface PropSpec {
  kind: PropKind;
  /** Regex source of the holder it stands beside. */
  anchor: string;
  /** Position in the holder's box coordinates: −1..1 of its half-extents on each axis; y = 1 is its top. */
  at: readonly [number, number, number];
  /** Prop size as a fraction of the holder's bounding radius. */
  size: number;
}

export const WORLD_PROPS: Readonly<Record<string, readonly PropSpec[]>> = {
  "great-station": [{ kind: "berth-board", anchor: "^witness-drydock-gantry$", at: [1.3, -0.2, 0], size: 0.45 }],
  "deep-past": [
    { kind: "chalk-tally", anchor: "^place-rim$", at: [0, -0.2, 1], size: 0.05 },
    { kind: "stair-ribbon", anchor: "^stair$", at: [0, 1, 0], size: 0.12 },
  ],
  "quiet-archive": [
    { kind: "paper-boats", anchor: "^still-threshold$", at: [0, 1, 0], size: 0.35 },
    { kind: "torn-hymnal", anchor: "^still-threshold$", at: [1.2, 0, 0.4], size: 0.18 },
  ],
  people: [
    { kind: "table-one-more", anchor: "^field-ground$", at: [0.28, 1, 0.22], size: 0.05 },
    { kind: "button-jar", anchor: "^field-ground$", at: [-0.25, 1, 0.3], size: 0.02 },
  ],
  "growing-place": [{ kind: "seed-stone", anchor: "^witness-tree$", at: [1.4, -1, 0.2], size: 0.12 }],
  scale: [
    { kind: "untied-cord", anchor: "^iss-holder$", at: [1.3, 0, 0], size: 0.6 },
    { kind: "probe-notebook", anchor: "^probe-(?!model)", at: [0, 1.1, 0], size: 0.35 },
  ],
  eternity: [{ kind: "sixteen-lamps", anchor: "^eternity-figure$", at: [0, -1, 0], size: 0.9 }],
};

/** Where a prop stands and how big it is, from its holder's world-space box. Pure — unit-tested. Null when the box is empty (the model has not loaded). */
export function placeProp(box: { min: readonly number[]; max: readonly number[] }, spec: Pick<PropSpec, "at" | "size">): { pos: [number, number, number]; scale: number } | null {
  const half = [0, 1, 2].map((i) => (box.max[i]! - box.min[i]!) / 2);
  if (half.some((h) => !(h > 0) || !Number.isFinite(h))) {
    // A flat holder (a ground plane) has no height: allow y to be zero, but never all-zero or infinite boxes.
    if (!(half[0]! > 0 && half[2]! > 0 && half[1]! >= 0 && half.every(Number.isFinite))) return null;
  }
  const center = [0, 1, 2].map((i) => (box.max[i]! + box.min[i]!) / 2);
  const radius = Math.hypot(half[0]!, half[1]!, half[2]!);
  if (!(radius > 0)) return null;
  return { pos: [center[0]! + spec.at[0] * half[0]!, center[1]! + spec.at[1] * half[1]!, center[2]! + spec.at[2] * half[2]!], scale: radius * spec.size };
}

const mat = (color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...opts });
const glow = (color: number, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, toneMapped: false });

/** Build one prop at unit size (about 1 across), its base at y = 0. */
export function buildProp(kind: PropKind): THREE.Group {
  const g = new THREE.Group();
  g.name = `prop-${kind}`;
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, ry = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    g.add(mesh);
    return mesh;
  };
  switch (kind) {
    case "berth-board": {
      // A board of berth slots on a post: every slot lit but one, swept clean.
      add(new THREE.BoxGeometry(0.06, 1, 0.06), mat(0x4a4f58), 0, 0.5, 0);
      add(new THREE.BoxGeometry(0.04, 0.5, 0.7), mat(0x2a2f38), 0, 0.85, 0);
      const slots = new THREE.InstancedMesh(new THREE.BoxGeometry(0.02, 0.07, 0.12), glow(0xffd27a), 11);
      const d = new THREE.Object3D();
      let n = 0;
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 4; c++) {
          if (r === 1 && c === 2) continue; // the one that is not there
          d.position.set(0.03, 0.72 + r * 0.13, -0.24 + c * 0.16);
          d.updateMatrix();
          slots.setMatrixAt(n++, d.matrix);
        }
      g.add(slots);
      break;
    }
    case "chalk-tally": {
      // Seven chalk strokes on the rock; the last one smudged.
      const m = glow(0xf2efe6, 0.85);
      for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(0.03, 0.5, 0.01), m, -0.45 + i * 0.14, 0.4, 0);
      add(new THREE.BoxGeometry(0.12, 0.35, 0.01), glow(0xf2efe6, 0.3), -0.45 + 6 * 0.14, 0.38, 0);
      break;
    }
    case "stair-ribbon": {
      add(new THREE.CylinderGeometry(0.04, 0.05, 1, 8), mat(0x5a4a3a), 0, 0.5, 0);
      add(new THREE.BoxGeometry(0.5, 0.06, 0.01), glow(0xbfe8f0), 0.25, 0.85, 0, 0.3);
      break;
    }
    case "paper-boats": {
      // Five paper boats in a row on a ledge, all pointing the same way.
      add(new THREE.BoxGeometry(1.2, 0.05, 0.3), mat(0x3a4250), 0, 0.025, 0);
      for (let i = 0; i < 5; i++) {
        const b = add(new THREE.ConeGeometry(0.08, 0.22, 3), mat(0xf4f1e8), -0.48 + i * 0.24, 0.1, 0);
        b.rotation.z = -Math.PI / 2; // every bow points the same way
      }
      break;
    }
    case "torn-hymnal": {
      add(new THREE.BoxGeometry(0.5, 0.6, 0.3), mat(0x3a2e24), 0, 0.3, 0);
      add(new THREE.BoxGeometry(0.5, 0.08, 0.36), mat(0xe8dfc8), 0, 0.64, 0, 0.1);
      add(new THREE.BoxGeometry(0.02, 0.06, 0.36), mat(0x3a2e24), 0.18, 0.66, 0); // the clean gap where a page was
      break;
    }
    case "table-one-more": {
      // A small table laid for more than sit at it: one place too many.
      add(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 16), mat(0x6a4a30), 0, 0.5, 0);
      add(new THREE.CylinderGeometry(0.05, 0.07, 0.5, 8), mat(0x6a4a30), 0, 0.25, 0);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        add(new THREE.CylinderGeometry(0.07, 0.07, 0.015, 12), mat(0xf2ede0), Math.cos(a) * 0.34, 0.535, Math.sin(a) * 0.34);
      }
      break;
    }
    case "button-jar": {
      add(new THREE.CylinderGeometry(0.3, 0.3, 0.6, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0xcfe0e8, transparent: true, opacity: 0.35, roughness: 0.2 }), 0, 0.3, 0);
      add(new THREE.CylinderGeometry(0.28, 0.28, 0.3, 14), mat(0xb08a5a, { metalness: 0.4 }), 0, 0.15, 0);
      break;
    }
    case "seed-stone": {
      // A seed in an empty plot with a small stone laid on top of it.
      add(new THREE.CylinderGeometry(0.5, 0.5, 0.04, 16), mat(0x4a3424), 0, 0.02, 0);
      add(new THREE.SphereGeometry(0.06, 8, 6), mat(0xc8a060), 0, 0.07, 0);
      add(new THREE.DodecahedronGeometry(0.1), mat(0x8a8a88), 0.02, 0.15, 0);
      break;
    }
    case "untied-cord": {
      // A pale-gold cord with knots along it; the last end open.
      const pts = [0, 1, 2, 3, 4, 5, 6].map((i) => new THREE.Vector3(i * 0.16 - 0.48, 0.5 + Math.sin(i) * 0.05, Math.cos(i * 0.7) * 0.05));
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.012, 6), glow(0xffe0a0));
      for (let i = 1; i < 5; i++) add(new THREE.SphereGeometry(0.03, 8, 6), glow(0xffe0a0), pts[i]!.x, pts[i]!.y, pts[i]!.z);
      break;
    }
    case "probe-notebook": {
      add(new THREE.BoxGeometry(0.4, 0.04, 0.55), mat(0x6a5440), 0, 0.02, 0);
      add(new THREE.BoxGeometry(0.36, 0.01, 0.5), mat(0xf0ead8), 0, 0.045, 0);
      break;
    }
    case "sixteen-lamps": {
      // Fifteen small lamps in a ring, and a sixteenth with a wick but no flame.
      const lit = new THREE.InstancedMesh(new THREE.SphereGeometry(0.025, 8, 6), glow(0xffd98a), 15);
      const d = new THREE.Object3D();
      for (let i = 0; i < 15; i++) {
        const a = (i / 16) * Math.PI * 2;
        d.position.set(Math.cos(a) * 0.5, 0.03, Math.sin(a) * 0.5);
        d.updateMatrix();
        lit.setMatrixAt(i, d.matrix);
      }
      g.add(lit);
      const a = (15 / 16) * Math.PI * 2;
      add(new THREE.CylinderGeometry(0.004, 0.004, 0.04, 6), mat(0x222222), Math.cos(a) * 0.5, 0.03, Math.sin(a) * 0.5);
      break;
    }
  }
  return g;
}

export interface WorldPropsHandle {
  /** Try to place any prop not yet placed (call while models load); true once every prop is placed. */
  place: () => boolean;
  dispose: () => void;
}

/** Attach this world's props beside their holders inside `root`. Placement waits for each holder to have a real box. */
export function attachWorldProps(world: string | null | undefined, root: THREE.Object3D): WorldPropsHandle {
  const specs = (world && WORLD_PROPS[world]) || [];
  const group = new THREE.Group();
  group.name = "world-props";
  root.add(group);
  const placed = new Set<number>();
  const box = new THREE.Box3();
  const place = () => {
    root.updateMatrixWorld(true);
    specs.forEach((spec, i) => {
      if (placed.has(i)) return;
      const re = new RegExp(spec.anchor);
      let holder: THREE.Object3D | null = null;
      root.traverse((o) => {
        if (!holder && o !== group && re.test(o.name)) holder = o;
      });
      if (!holder) return;
      box.setFromObject(holder);
      if (box.isEmpty()) return;
      const p = placeProp({ min: box.min.toArray(), max: box.max.toArray() }, spec);
      if (!p) return;
      const prop = buildProp(spec.kind);
      prop.position.set(...p.pos);
      prop.scale.setScalar(p.scale);
      group.add(prop);
      placed.add(i);
    });
    return placed.size === specs.length;
  };
  place();
  return {
    place,
    dispose: () => {
      root.remove(group);
      disposeObject3D(group);
    },
  };
}
