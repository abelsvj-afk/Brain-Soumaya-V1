import * as THREE from "three";

/** Soft radial glow (computed into a DataTexture, so it builds where there is no DOM). Shared by the
 *  travel corridor and the in-world ship. */
export function glowTexture(): THREE.Texture {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.min(1, Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2));
      const a = Math.pow(1 - d, 2.2);
      const o = (y * n + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = 255;
      data[o + 3] = Math.round(255 * a);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const COOL = new THREE.Color(0x9fe8ff);
const WARM = new THREE.Color(0xffb040);
const HOT = new THREE.Color(0xff1a0a);

/** Engine heat 0..1 as a colour: white-cyan → amber → deep red. Writes into `out`. */
export function heatColor(h: number, out: THREE.Color): THREE.Color {
  const t = Math.min(1, Math.max(0, h));
  return t < 0.5 ? out.copy(COOL).lerp(WARM, t / 0.5) : out.copy(WARM).lerp(HOT, (t - 0.5) / 0.5);
}

/** The glow sprite's size and brightness for an engine heat (a halo at the tail, never a screen wash). */
export function heatGlow(h: number): { scale: number; opacity: number } {
  const t = Math.min(1, Math.max(0, h));
  return { scale: 5 + 6 * t, opacity: 0.55 + 0.35 * t };
}
