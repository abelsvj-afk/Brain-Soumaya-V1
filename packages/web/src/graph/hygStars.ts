import * as THREE from "three";
import { HYG_COLORS_B64, HYG_POSITIONS_B64, HYG_STAR_COUNT } from "./hygData.js";

/**
 * The worlds starfield — REAL star data (F-02 fix, review 25; the
 * owner chose integration over removing the credit).
 *
 * Source: the HYG database (Astronexus), CC BY-SA 4.0 — the 5,000
 * brightest stars by apparent magnitude. Positions are the database's
 * own equatorial Cartesian values normalized to directions; colors
 * derive from each star's B-V color index. The data ships as a
 * generated module (`hygData.ts`, provenance header inside) so the
 * scene builds it synchronously — no fetch, no placeholder. This is
 * the WORLDS layer's sky (the spaces a ship warps to); the home
 * galaxy's rendering is a separate, settled design and is untouched.
 */
function decodeFloats(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // A regenerated or truncated data module must fail HERE with a named
  // error, not as a bare RangeError from the typed-array constructor.
  if (bytes.length % 4 !== 0 || bytes.length / 4 !== HYG_STAR_COUNT * 3) {
    throw new Error("HYG star data is malformed (hygData.ts) — regenerate it; do not hand-edit.");
  }
  return new Float32Array(bytes.buffer);
}

let positionsCache: Float32Array | null = null;
let colorsCache: Float32Array | null = null;

export function hygStarPositions(): Float32Array {
  positionsCache ??= decodeFloats(HYG_POSITIONS_B64);
  return positionsCache;
}

export function hygStarColors(): Float32Array {
  colorsCache ??= decodeFloats(HYG_COLORS_B64);
  return colorsCache;
}

export function buildHygStarfield(): THREE.Points {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(hygStarPositions(), 3));
  geo.setAttribute("color", new THREE.BufferAttribute(hygStarColors(), 3));
  const mat = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true });
  const points = new THREE.Points(geo, mat);
  points.name = `hyg-starfield-${HYG_STAR_COUNT}`;
  return points;
}
