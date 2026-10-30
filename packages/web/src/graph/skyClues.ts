import * as THREE from "three";

/**
 * Sky clues (Draft 9 §6; docs/specs/world-props-2026-10-31.md): one constellation in the shared sky that every world draws — sixteen stars in a loose arc, fifteen lit and
 * the sixteenth only a dark ring where a star should be, joined by faint unfinished "pencil" lines that stop short of it. No label, no text: it is simply there to be noticed.
 * It rides the sky group (which follows the camera), so it sits at the edge of the heavens in every world. Static under reduced motion (there is no motion to calm).
 */
export const SIXTEEN_STARS = 16;

/** Directions of the sixteen, as unit vectors: a loose arc high in one quarter of the sky. Pure and fixed (the same sky everywhere). */
export function sixteenDirections(): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < SIXTEEN_STARS; i++) {
    const t = i / (SIXTEEN_STARS - 1);
    const az = 0.6 + t * 0.95 + Math.sin(i * 1.7) * 0.05; // radians round the vertical
    const el = 0.42 + Math.sin(t * Math.PI) * 0.22 + Math.cos(i * 2.3) * 0.03; // above the horizon
    const c = Math.cos(el);
    out.push([Math.sin(az) * c, Math.sin(el), Math.cos(az) * c]);
  }
  return out;
}

export interface SkyClues {
  group: THREE.Group;
  dispose: () => void;
}

export function buildSkyClues(radius: number): SkyClues {
  const group = new THREE.Group();
  group.name = "sky-clue-sixteen";
  const dirs = sixteenDirections();
  const pts = dirs.map(([x, y, z]) => new THREE.Vector3(x * radius, y * radius, z * radius));
  // Fifteen lit stars.
  const starGeo = new THREE.BufferGeometry().setFromPoints(pts.slice(0, SIXTEEN_STARS - 1));
  const starMat = new THREE.PointsMaterial({ color: 0xfff2d0, size: 3.2, sizeAttenuation: false, transparent: true, opacity: 0.95, depthWrite: false, fog: false });
  const stars = new THREE.Points(starGeo, starMat);
  stars.name = "sky-clue-lit";
  group.add(stars);
  // The sixteenth: a thin dark ring where a star should be.
  const ringGeo = new THREE.RingGeometry(radius * 0.0026, radius * 0.0034, 24);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x8a96b8, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false, fog: false });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.copy(pts[SIXTEEN_STARS - 1]!);
  ring.lookAt(0, 0, 0);
  ring.name = "sky-clue-dark";
  group.add(ring);
  // Pencil lines: faint, joining each lit star to the next — and stopping one short of the sixteenth.
  const lineGeo = new THREE.BufferGeometry().setFromPoints(pts.slice(0, SIXTEEN_STARS - 1));
  const lineMat = new THREE.LineDashedMaterial({ color: 0xc8d0e0, dashSize: radius * 0.006, gapSize: radius * 0.004, transparent: true, opacity: 0.22, depthWrite: false, fog: false });
  const lines = new THREE.Line(lineGeo, lineMat);
  lines.computeLineDistances();
  lines.name = "sky-clue-pencil";
  group.add(lines);
  group.renderOrder = -1;
  return {
    group,
    dispose: () => {
      starGeo.dispose();
      starMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      lineGeo.dispose();
      lineMat.dispose();
    },
  };
}
