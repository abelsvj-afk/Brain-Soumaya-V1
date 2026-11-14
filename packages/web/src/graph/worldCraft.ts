import * as THREE from "three";
import { glowTexture } from "./softGlow.js";

/**
 * World craft — the shared kit the travel worlds are built from (docs/specs/worlds-redesign-2026-11-14.md).
 *
 * The first versions of the story worlds were flat-colour boxes and planes: correct in content, lifeless to look at. This kit is what gives every one of them the same four things a
 * place needs, with no downloads and no post-processing pass:
 *
 *   1. SURFACE  — tileable stone / rock / plaster / wood / metal / soil made in plain JS (colour + normal map), so nothing is ever one flat colour.
 *   2. FORM     — walls and ground that are displaced and shaded darker where they meet (a baked contact shadow), turned shapes instead of boxes.
 *   3. LIGHT    — pools of light on the floor under every lamp, shafts where light falls through an opening, a graded sky instead of a flat background.
 *   4. AIR      — drifting dust and low mist, so depth reads and the place feels inhabited by weather even when nobody is shown.
 *
 * Everything is generated from DataTextures (no canvas), so it also runs under the unit tests. Textures are cached per kind and shared; they are small (256 px) and built once.
 * Anything that moves takes `reducedMotion` and holds still under it.
 */

// ---------- deterministic, tileable noise ----------

const hash = (x: number, y: number, seed: number): number => {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
};
const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Value noise that repeats every `period` cells, so a texture built from it tiles with no seam. */
function periodicNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const w = (a: number) => ((a % period) + period) % period;
  const a = hash(w(xi), w(yi), seed);
  const b = hash(w(xi + 1), w(yi), seed);
  const c = hash(w(xi), w(yi + 1), seed);
  const d = hash(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

/** Fractal noise in 0..1, tileable over the unit square (u, v in 0..1). */
export function tileFbm(u: number, v: number, baseCells: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let cells = baseCells;
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicNoise(u * cells, v * cells, cells, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    cells *= 2;
  }
  return sum / norm;
}

/** Plain (non-tiling) fractal noise in 0..1 for geometry. */
export function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicNoise(x * f, y * f, 1 << 20, seed + o * 31);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

// ---------- surfaces ----------

export type SurfaceKind = "rock" | "flagstone" | "plaster" | "wood" | "metal" | "soil" | "pale" | "brass";

interface SurfaceDef {
  /** Height 0..1 at (u, v) — drives the normal map and the shading of the colour. */
  height: (u: number, v: number) => number;
  /** Two colours the albedo runs between (low → high), plus how much a second, slower noise tints it. */
  low: number;
  high: number;
  tint: number;
  /** Normal strength. */
  bump: number;
}

const groove = (t: number, width: number): number => {
  // 0 in the groove, 1 on the face; `t` is the 0..1 position inside one cell.
  const d = Math.min(t, 1 - t);
  return Math.min(1, d / width);
};

const SURFACES: Record<SurfaceKind, SurfaceDef> = {
  // Broken natural rock: ridged noise so it reads as fractured faces, not cloud.
  rock: {
    height: (u, v) => {
      const n = tileFbm(u, v, 4, 5, 11);
      const ridged = 1 - Math.abs(tileFbm(u, v, 3, 4, 53) * 2 - 1);
      return n * 0.55 + ridged * ridged * 0.45;
    },
    low: 0x2a2c33,
    high: 0x7c7f88,
    tint: 0.25,
    bump: 2.6,
  },
  // Laid stone: offset courses with mortar lines, each stone a little different.
  flagstone: {
    height: (u, v) => {
      const rows = 4;
      const row = Math.floor(v * rows);
      const cols = 3;
      const uu = u * cols + (row % 2) * 0.5;
      const col = Math.floor(uu);
      const g = Math.min(groove(uu - col, 0.035), groove(v * rows - row, 0.045));
      const stone = hash(((col % cols) + cols) % cols, row, 7) * 0.35;
      return g * (0.55 + stone + tileFbm(u, v, 8, 3, 23) * 0.2);
    },
    low: 0x35363c,
    high: 0x8a8880,
    tint: 0.3,
    bump: 2.2,
  },
  // Old limewash: broad soft mottling and the faintest hairline cracks (strong ones read as doodles on the wall).
  plaster: {
    height: (u, v) => {
      const n = tileFbm(u, v, 3, 4, 91);
      const crack = Math.abs(tileFbm(u, v, 5, 3, 133) * 2 - 1);
      return n * 0.94 + Math.min(1, crack * 14) * 0.06;
    },
    low: 0x8a8274,
    high: 0xd8d0c0,
    tint: 0.2,
    bump: 1.0,
  },
  // Planks along u: boards with gaps, grain running the length.
  wood: {
    height: (u, v) => {
      const boards = 5;
      const b = Math.floor(v * boards);
      const gap = groove(v * boards - b, 0.05);
      const grain = tileFbm(u * 0.25 + hash(b, 0, 3), v * 6, 8, 3, 41 + b);
      return gap * (0.5 + grain * 0.5);
    },
    low: 0x2e2118,
    high: 0x7a5a3c,
    tint: 0.2,
    bump: 1.6,
  },
  // Plated hull metal: panels with seams, fine brushing, a few rivets along the seams.
  metal: {
    height: (u, v) => {
      const pu = u * 2;
      const pv = v * 4;
      const seam = Math.min(groove(pu - Math.floor(pu), 0.02), groove(pv - Math.floor(pv), 0.04));
      const brush = tileFbm(u * 0.1, v, 32, 2, 77);
      const ru = pu * 8 - Math.floor(pu * 8) - 0.5;
      const rv = pv - Math.floor(pv) - 0.12;
      const rivet = Math.max(0, 1 - Math.hypot(ru * 0.25, rv) * 14);
      return seam * (0.7 + brush * 0.12) + rivet * 0.3;
    },
    low: 0x23262d,
    high: 0x6c727e,
    tint: 0.15,
    bump: 1.4,
  },
  // Packed earth: soft lumps and small pebbles.
  soil: {
    height: (u, v) => tileFbm(u, v, 5, 5, 201) * 0.8 + Math.pow(tileFbm(u, v, 24, 2, 211), 3) * 0.6,
    low: 0x1e1a14,
    high: 0x5a4c38,
    tint: 0.3,
    bump: 1.8,
  },
  // Pale mineral floor (salt, chalk, bone-white stone): very quiet, long soft veins.
  pale: {
    height: (u, v) => {
      const vein = 1 - Math.abs(tileFbm(u, v, 2, 4, 301) * 2 - 1);
      return tileFbm(u, v, 6, 3, 311) * 0.6 + Math.pow(vein, 6) * 0.4;
    },
    low: 0xa8a2b0,
    high: 0xf0ece6,
    tint: 0.12,
    bump: 0.7,
  },
  // Worked brass: hammered dimples.
  brass: {
    height: (u, v) => tileFbm(u, v, 14, 2, 401) * 0.7 + tileFbm(u, v, 3, 3, 409) * 0.3,
    low: 0x5a4018,
    high: 0xd8a850,
    tint: 0.2,
    bump: 1.2,
  },
};

export interface SurfaceTextures {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
}

const SIZE = 256;
const surfaceCache = new Map<SurfaceKind, SurfaceTextures>();

function dataTexture(data: Uint8Array, srgb: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** The colour + normal textures for a surface kind. Built once, shared by every material that asks. Never dispose them from a scene (materials are disposed; these are the kit's). */
export function surfaceTextures(kind: SurfaceKind): SurfaceTextures {
  const hit = surfaceCache.get(kind);
  if (hit) return hit;
  const def = SURFACES[kind];
  const h = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) h[y * SIZE + x] = Math.min(1, Math.max(0, def.height(x / SIZE, y / SIZE)));
  const lo = new THREE.Color(def.low);
  const hi = new THREE.Color(def.high);
  const col = new Uint8Array(SIZE * SIZE * 4);
  const nrm = new Uint8Array(SIZE * SIZE * 4);
  const at = (x: number, y: number) => h[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)]!;
  const c = new THREE.Color();
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const v = h[y * SIZE + x]!;
      // Colour follows height, with a slow second noise so large areas drift in tone (the thing a flat colour never does).
      const drift = (tileFbm(x / SIZE, y / SIZE, 2, 3, 977) - 0.5) * 2 * def.tint;
      c.copy(lo).lerp(hi, Math.min(1, Math.max(0, v * 0.85 + 0.1 + drift)));
      // DataTexture colour bytes are stored as sRGB.
      col[i] = Math.round(Math.pow(c.r, 1 / 2.2) * 255);
      col[i + 1] = Math.round(Math.pow(c.g, 1 / 2.2) * 255);
      col[i + 2] = Math.round(Math.pow(c.b, 1 / 2.2) * 255);
      col[i + 3] = 255;
      const dx = (at(x + 1, y) - at(x - 1, y)) * def.bump;
      const dy = (at(x, y + 1) - at(x, y - 1)) * def.bump;
      const inv = 1 / Math.hypot(dx, dy, 1);
      nrm[i] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      nrm[i + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
      nrm[i + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      nrm[i + 3] = 255;
    }
  const made = { map: dataTexture(col, true), normalMap: dataTexture(nrm, false) };
  surfaceCache.set(kind, made);
  return made;
}

export interface SurfaceOpts {
  /** Multiplies the surface's own colour (white = as authored). */
  tint?: number;
  /** How many times the texture repeats across the mesh's UV square. */
  repeat?: readonly [number, number];
  roughness?: number;
  metalness?: number;
  /** Use baked vertex colours (contact shadow) — see `shadeByHeight`. */
  vertexColors?: boolean;
  side?: THREE.Side;
  emissive?: number;
  emissiveIntensity?: number;
}

/**
 * A lit material wearing one of the kit's surfaces. The textures are shared, so each call clones the texture OBJECT (cheap — it shares the pixel data) only to carry its own repeat.
 */
export function surfaceMaterial(kind: SurfaceKind, opts: SurfaceOpts = {}): THREE.MeshStandardMaterial {
  const src = surfaceTextures(kind);
  const rep = opts.repeat ?? [1, 1];
  const own = (t: THREE.DataTexture): THREE.Texture => {
    const c = t.clone();
    c.repeat.set(rep[0], rep[1]);
    c.needsUpdate = true;
    return c;
  };
  return new THREE.MeshStandardMaterial({
    map: own(src.map),
    normalMap: own(src.normalMap),
    color: opts.tint ?? 0xffffff,
    roughness: opts.roughness ?? (kind === "metal" || kind === "brass" ? 0.5 : 0.95),
    metalness: opts.metalness ?? (kind === "metal" ? 0.7 : kind === "brass" ? 0.85 : 0),
    vertexColors: opts.vertexColors ?? false,
    side: opts.side ?? THREE.FrontSide,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
  });
}

// ---------- form ----------

/**
 * Bake a contact shadow into vertex colours: darker toward `y0` (where a wall meets the floor) and, optionally, toward the top — the cheapest thing that stops a wall from looking
 * like a sheet of paper standing on another sheet of paper. Use with `vertexColors: true`.
 */
export function shadeByHeight(geo: THREE.BufferGeometry, y0: number, y1: number, floorDark = 0.35, topDark = 0.8): void {
  const pos = geo.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getY(i) - y0) / (y1 - y0)));
    const rise = smooth(Math.min(1, t * 3.2)); // climbs out of the contact shadow in the bottom third
    const fall = 1 - smooth(Math.max(0, (t - 0.55) / 0.45)) * (1 - topDark);
    const v = (floorDark + (1 - floorDark) * rise) * fall;
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = v;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

/**
 * A wall of rough rock: `length` along x, `height` up y, facing +z, pushed in and out by noise (never a flat sheet) and leaning back a little as it rises. UVs repeat by world size so
 * a surface texture keeps its scale on any wall. Vertex colours carry the contact shadow.
 */
export function rockWall(length: number, height: number, opts: { depth?: number; seed?: number; lean?: number; texScale?: number } = {}): THREE.BufferGeometry {
  const depth = opts.depth ?? 14;
  const seed = opts.seed ?? 1;
  const lean = opts.lean ?? 0.12;
  const texScale = opts.texScale ?? 90;
  const sx = Math.max(8, Math.min(160, Math.round(length / 22)));
  const sy = Math.max(4, Math.min(24, Math.round(height / 14)));
  const geo = new THREE.PlaneGeometry(length, height, sx, sy);
  geo.translate(0, height / 2, 0);
  const pos = geo.getAttribute("position");
  const uv = geo.getAttribute("uv");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const t = y / height;
    const big = fbm(x / 160, y / 90, seed, 3) - 0.5; // buttresses and hollows
    const small = fbm(x / 34, y / 30, seed + 7, 3) - 0.5; // broken faces
    const top = fbm(x / 70, 0, seed + 13, 2); // an uneven crest, so the skyline is not a ruled line
    pos.setZ(i, big * depth * 2 + small * depth * 0.7 - t * height * lean);
    if (t > 0.999) pos.setY(i, y + (top - 0.5) * height * 0.22);
    uv.setXY(i, x / texScale, y / texScale);
  }
  geo.computeVertexNormals();
  shadeByHeight(geo, 0, height, 0.3, 0.75);
  return geo;
}

/**
 * Ground that is not a billiard table: a disc or strip gently rolled by noise, flat (to `flatRadius`) where people walk so props still sit true. UVs repeat by world size.
 */
export function rolledGround(width: number, depth: number, opts: { amp?: number; seed?: number; texScale?: number; flat?: (x: number, z: number) => number; segments?: number } = {}): THREE.BufferGeometry {
  const amp = opts.amp ?? 3;
  const seed = opts.seed ?? 5;
  const texScale = opts.texScale ?? 80;
  const seg = opts.segments ?? 48;
  const geo = new THREE.PlaneGeometry(width, depth, seg, Math.max(4, Math.round((seg * depth) / width)));
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute("position");
  const uv = geo.getAttribute("uv");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const keep = opts.flat ? opts.flat(x, z) : 1; // 0 = dead flat, 1 = full relief
    pos.setY(i, (fbm(x / 120, z / 120, seed, 4) - 0.5) * 2 * amp * keep);
    uv.setXY(i, x / texScale, z / texScale);
  }
  geo.computeVertexNormals();
  return geo;
}

// ---------- light ----------

/**
 * Pools of light on the ground under lamps: flat additive discs, one draw call for any number. This is what makes a lamp look like it lights something — a glowing dot above an
 * evenly lit floor reads as a sticker.
 */
export function lightPools(points: readonly { x: number; y?: number; z: number }[], color: number, radius: number, opacity: number, name: string): THREE.InstancedMesh {
  const geo = new THREE.PlaneGeometry(2, 2);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color, map: glowTexture(), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: true });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, points.length));
  const d = new THREE.Object3D();
  points.forEach((p, i) => {
    d.position.set(p.x, (p.y ?? 0) + 0.6, p.z);
    d.scale.set(radius, 1, radius);
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
  });
  mesh.count = points.length;
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return mesh;
}

const SHAFT_VERT = /* glsl */ `
varying float vT;
varying vec3 vN;
varying vec3 vV;
void main() {
  vT = uv.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const SHAFT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vT;
varying vec3 vN;
varying vec3 vV;
void main() {
  // Bright where it enters, gone by the floor; soft at the silhouette so the cone has no hard edge.
  float along = pow(vT, 1.6);
  float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.5);
  gl_FragColor = vec4(uColor, uOpacity * along * edge);
}`;

/** A shaft of light falling from an opening: a soft additive cone, bright at the top (`y = height`) and faded by the ground. One draw call. */
export function lightShaft(height: number, radiusTop: number, radiusBottom: number, color: number, opacity: number, name: string): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 20, 1, true);
  geo.translate(0, height / 2, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
    vertexShader: SHAFT_VERT,
    fragmentShader: SHAFT_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.renderOrder = 3;
  return mesh;
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform float uOpacity;
varying vec3 vDir;
void main() {
  float h = normalize(vDir).y;
  vec3 c = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.55)) : mix(uHorizon, uBottom, pow(-h, 0.4));
  // The band of glow sits on the horizon and thins upward, so stars drawn behind it still show overhead.
  float a = uOpacity * (h > 0.0 ? exp(-h * 7.0) : 1.0);
  gl_FragColor = vec4(c, a);
}`;

/**
 * A graded horizon: a big inward-facing sphere that glows at the horizon and clears toward the zenith, so the shared starfield still shows overhead while the world gets a sense of
 * distance and time of day. One draw call. `opacity` 1 = a solid horizon band.
 */
export function horizonGlow(radius: number, top: number, horizon: number, bottom: number, opacity: number, name: string): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTop: { value: new THREE.Color(top) }, uHorizon: { value: new THREE.Color(horizon) }, uBottom: { value: new THREE.Color(bottom) }, uOpacity: { value: opacity } },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), mat);
  mesh.name = name;
  mesh.renderOrder = -5;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------- air ----------

export interface Drifting {
  object: THREE.Object3D;
  update: (elapsedMs: number, reducedMotion?: boolean) => void;
}

/**
 * Dust in the air: small soft points that drift slowly through a box and wrap. Under reduced motion they hang still (the air is still there; it does not move). One draw call.
 */
export function dustMotes(box: { min: readonly [number, number, number]; max: readonly [number, number, number] }, count: number, color: number, size: number, opacity: number, name: string, seed = 9): Drifting {
  const base = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const span = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]] as const;
  for (let i = 0; i < count; i++) {
    base[i * 3] = box.min[0] + hash(i, 1, seed) * span[0];
    base[i * 3 + 1] = box.min[1] + hash(i, 2, seed) * span[1];
    base[i * 3 + 2] = box.min[2] + hash(i, 3, seed) * span[2];
    phase[i] = hash(i, 4, seed) * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  const live = new Float32Array(base);
  geo.setAttribute("position", new THREE.BufferAttribute(live, 3));
  const mat = new THREE.PointsMaterial({ color, size, sizeAttenuation: true, map: glowTexture(), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const pts = new THREE.Points(geo, mat);
  pts.name = name;
  pts.frustumCulled = false;
  const update = (ms: number, reducedMotion?: boolean) => {
    if (reducedMotion) return;
    const t = ms / 1000;
    for (let i = 0; i < count; i++) {
      const p = phase[i]!;
      live[i * 3] = base[i * 3]! + Math.sin(t * 0.11 + p) * 9;
      // A slow rise that wraps inside the box.
      const rise = (base[i * 3 + 1]! - box.min[1] + t * (1.2 + (p % 1) * 1.6)) % span[1];
      live[i * 3 + 1] = box.min[1] + rise;
      live[i * 3 + 2] = base[i * 3 + 2]! + Math.cos(t * 0.09 + p * 1.7) * 9;
    }
    (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  };
  return { object: pts, update };
}

/**
 * Low mist: a handful of very large, very faint soft sprites lying near the ground that slide slowly. It hides where the floor meets the dark and gives lamps something to light.
 * Not additive (it must be able to dim what is behind it a little). One draw call.
 */
export function groundMist(points: readonly { x: number; y: number; z: number }[], color: number, size: number, opacity: number, name: string): Drifting {
  const base = new Float32Array(points.flatMap((p) => [p.x, p.y, p.z]));
  const live = new Float32Array(base);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(live, 3));
  const mat = new THREE.PointsMaterial({ color, size, sizeAttenuation: true, map: glowTexture(), transparent: true, opacity, depthWrite: false, toneMapped: false });
  const pts = new THREE.Points(geo, mat);
  pts.name = name;
  pts.frustumCulled = false;
  pts.renderOrder = 1;
  const update = (ms: number, reducedMotion?: boolean) => {
    if (reducedMotion) return;
    const t = ms / 1000;
    for (let i = 0; i < points.length; i++) {
      live[i * 3] = base[i * 3]! + Math.sin(t * 0.05 + i * 1.3) * size * 0.12;
      live[i * 3 + 2] = base[i * 3 + 2]! + Math.cos(t * 0.04 + i * 2.1) * size * 0.12;
    }
    (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  };
  return { object: pts, update };
}

// ---------- small turned shapes ----------

const profile = (pts: readonly (readonly [number, number])[]): THREE.Vector2[] => pts.map(([r, y]) => new THREE.Vector2(r, y));

/** A hanging lantern body (cage + cap), about `h` tall, origin at its top where it hangs. Unlit; add a core and a glow for a lit one. */
export function lanternGeometry(h: number): THREE.BufferGeometry {
  const r = h * 0.32;
  const g = new THREE.LatheGeometry(profile([[0.02 * r, 0], [0.5 * r, -0.08 * h], [0.62 * r, -0.16 * h], [0.34 * r, -0.2 * h], [r, -0.34 * h], [r * 0.94, -0.84 * h], [0.5 * r, -0.94 * h], [0.02 * r, -h]]), 10);
  return g;
}

/** A cup / bowl standing on y = 0, rim radius `r`, height `h`. */
export function cupGeometry(r: number, h: number): THREE.BufferGeometry {
  return new THREE.LatheGeometry(profile([[0.01, 0], [r * 0.5, 0], [r * 0.56, h * 0.08], [r * 0.3, h * 0.2], [r * 0.82, h * 0.62], [r, h], [r * 0.9, h], [r * 0.72, h * 0.64], [0.01, h * 0.3]]), 14);
}

/** A turned post standing on y = 0 (a newel, a bollard, a lamp-post): swelling foot, slim shaft, capped head. */
export function postGeometry(r: number, h: number): THREE.BufferGeometry {
  return new THREE.LatheGeometry(profile([[0.01, 0], [r * 1.7, 0], [r * 1.7, h * 0.03], [r * 1.15, h * 0.07], [r, h * 0.12], [r * 0.82, h * 0.9], [r * 1.3, h * 0.93], [r * 1.3, h * 0.97], [0.01, h]]), 10);
}
