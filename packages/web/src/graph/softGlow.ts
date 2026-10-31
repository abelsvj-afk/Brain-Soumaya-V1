import * as THREE from "three";

/**
 * A soft round glow for lanterns and lamps: additive Points that use a small radial-falloff texture built in plain JS (no canvas, so it works under tests too). A low-poly additive sphere
 * rendered as a hard-edged disc in a real browser; this fades to nothing at the edge. One draw call for any number of lights.
 */
let cached: THREE.DataTexture | null = null;
export function glowTexture(): THREE.DataTexture {
  if (cached) return cached;
  const N = 64;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const d = Math.hypot(x - (N - 1) / 2, y - (N - 1) / 2) / (N / 2);
      const a = Math.max(0, 1 - d);
      const v = Math.round(255 * a * a * a); // a soft, quickly fading core
      const i = (y * N + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = v;
    }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.needsUpdate = true;
  cached = t;
  return t;
}

export function softGlowPoints(positions: readonly { x: number; y: number; z: number }[], color: number, size: number, opacity: number, name: string): THREE.Points {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions.flatMap((p) => [p.x, p.y, p.z]), 3));
  const mat = new THREE.PointsMaterial({ color, size, sizeAttenuation: true, map: glowTexture(), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const pts = new THREE.Points(geo, mat);
  pts.name = name;
  pts.frustumCulled = false; // the points span the whole hall; never cull the lot on a bounding-sphere edge case
  return pts;
}
