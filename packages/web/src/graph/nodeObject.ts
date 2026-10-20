import * as THREE from "three";
import { type GraphNode, classify, deriveMass, SECTOR_MASS } from "@brain/shared";
import { bodyColor } from "./theme.js";
import { makeStarMaterial, makePlanetMaterial, type ShaderTier } from "./shaders.js";

// --- Sector-title threshold (far-zoom labels) ---
// Effective mass threshold for awarding a far-zoom sector title. Defaults to
// SECTOR_MASS; Graph3D may lower it (never raise it) via
// Pick the sector-hub ids: the most massive hubs, spatially separated so each
// "owns" a region of the galaxy. At most maxSectors (default 5) — a galaxy
// should show a handful of region names, not a crowd. Replaces the old
// threshold-lowering approach (which guaranteed 8 hubs with no separation,
// causing unreadable title pile-ups).
let sectorTitleIds: Set<string | number> = new Set();
export function setSectorTitleIds(ids: Set<string | number>): void {
  sectorTitleIds = ids;
}
/** react-force-graph writes layout positions onto nodes at runtime; the
 * shared GraphNode type models the server payload, so positions are a
 * web-runtime extension of it. */
type GraphNodeWithPosition = GraphNode & { x?: number; y?: number; z?: number };

/** Mass signal for a node (server-precomputed or derived): single source of truth. */
export function nodeMass(node: GraphNode): number {
  return (
    node.mass ??
    deriveMass({
      importance: node.importance,
      degree: node.degree,
      emotionalWeight: node.emotionalWeight,
    })
  );
}
/** Effective sector-title threshold for a node set: SECTOR_MASS, lowered just
 * enough to guarantee at least minHubs titled hubs (never raised). */
export function pickSectorHubIds(nodes: GraphNodeWithPosition[], maxSectors = 5): Set<string | number> {
  // Sort by mass descending; greedily take the most massive hub that is far
  // enough from every already-picked hub. Separation is relative to galaxy
  // scale (1/4 of the max node radius) so it adapts to small and large brains.
  // Nodes without positions can't be separated — they sort by mass only and
  // are taken in order if we still have slots.
  const sorted = [...nodes].sort((a, b) => nodeMass(b) - nodeMass(a));
  let maxR = 1;
  for (const n of nodes) {
    if (n.x != null && n.y != null && !isNaN(n.x) && !isNaN(n.y)) {
      const r = Math.sqrt(n.x * n.x + n.y * n.y + (n.z ?? 0) * (n.z ?? 0));
      if (r > maxR) maxR = r;
    }
  }
  const minSep = maxR / 4;
  const minSep2 = minSep * minSep;
  const picked: GraphNodeWithPosition[] = [];
  const noPos: GraphNodeWithPosition[] = [];
  for (const n of sorted) {
    if (picked.length >= maxSectors) break;
    if (n.x == null || n.y == null || isNaN(n.x) || isNaN(n.y)) {
      noPos.push(n);
      continue;
    }
    const nx = n.x, ny = n.y, nz = n.z ?? 0;
    let tooClose = false;
    for (const p of picked) {
      const dx = nx - (p.x as number), dy = ny - (p.y as number), dz = nz - ((p.z as number) ?? 0);
      if (dx * dx + dy * dy + dz * dz < minSep2) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) picked.push(n);
  }
  // Fill remaining slots with position-less hubs by mass (rare; keeps the
  // guarantee that young galaxies still get some titles).
  for (const n of noPos) {
    if (picked.length >= maxSectors) break;
    picked.push(n);
  }
  return new Set(picked.map((n) => n.id));
}

const FONT_SIZE = 44;
const PADDING = 14;
const WORLD_SCALE = 0.11; // canvas px -> world units
const WINDOW_PX = 470; // max on-screen label width before it scrolls (marquee)
const MAX_CHARS = 80; // cap canvas width for very long entries

const labelTexCache = new Map<string, { map: THREE.CanvasTexture; width: number; height: number }>();
const glowTexCache = new Map<string, THREE.CanvasTexture>();
const geometryCache = new Map<string, THREE.BufferGeometry>();
// Performance Program Stage 7: labelTexCache/glowTexCache never evicted anything — one
// canvas texture per unique label string (or glow color+size) forever, ~150KB each,
// 40-75MB VRAM at 500 nodes. A blind size-capped LRU risks disposing a texture a still-
// LIVE sprite's material.map is actively pointing at (the exact risk called out when
// this cache's `userData.shared` disposal guard was added) — so this is reference-
// counted instead: every `makeLabel`/`makeGlow` call increments the count for its cache
// key, and `releaseNodeTextures` (called by Graph3D wherever it permanently discards a
// node's cached Object3D — real deletion, a cache-key rebuild, or full teardown)
// decrements it, disposing + evicting only once nothing live references it anymore.
const labelRefCount = new Map<string, number>();
const glowRefCount = new Map<string, number>();

/**
 * Build a floating text label as a lightweight sprite (no polygons).
 */
function makeLabel(rawText: string): THREE.Sprite {
  const cacheKey = rawText;
  let cached = labelTexCache.get(cacheKey);
  
  if (!cached) {
    const text = rawText.length > MAX_CHARS ? `${rawText.slice(0, MAX_CHARS)}…` : rawText;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const font = `600 ${FONT_SIZE}px Inter, system-ui, sans-serif`;
    ctx.font = font;
    const textWidth = Math.ceil(ctx.measureText(text).width);
    canvas.width = textWidth + PADDING * 2;
    canvas.height = FONT_SIZE + PADDING * 2;

    ctx.font = font;
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = 8;
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(text, PADDING, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    // Shared across every sprite built from this same text — see disposeObject3D
    // (graph3dHelpers.ts), which must skip textures flagged `shared` rather than
    // destroying them the moment any ONE sprite using them is evicted/replaced.
    texture.userData.shared = true;
    cached = { map: texture, width: canvas.width, height: canvas.height };
    labelTexCache.set(cacheKey, cached);
  }
  labelRefCount.set(cacheKey, (labelRefCount.get(cacheKey) ?? 0) + 1);

  const { map, width, height } = cached;
  const material = new THREE.SpriteMaterial({
    map,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 999;

  const tooWide = width > WINDOW_PX;
  const displayPx = tooWide ? WINDOW_PX : width;
  sprite.scale.set(displayPx * WORLD_SCALE, height * WORLD_SCALE, 1);
  sprite.position.set(0, 9, 0);

  sprite.userData.isLabel = true;
  // Tags which cache entry this sprite holds a reference against, so
  // `releaseNodeTextures` can decrement it correctly when this sprite is discarded —
  // regardless of whether the sprite ends up rendering the shared `map` directly or its
  // own exclusive marquee clone below (the clone is a SEPARATE, already-disposable
  // resource; this tag is about the underlying cache entry, not which texture object
  // the material currently points at).
  sprite.userData.labelCacheKey = cacheKey;
  if (tooWide) {
    // `map` is the CACHED texture (labelTexCache), shared by every sprite built from the
    // same text — e.g. two different bodies that happen to share a name, or a sector title
    // vs. its regular label. The marquee below scrolls by mutating the texture's own
    // `offset`/`repeat`, which are texture-level (not per-material) state; sharing that
    // texture across sprites meant multiple marquees fought over the same offset, each
    // frame jumping between scroll positions and rendering a corrupted, overlapping slice
    // of text — the reported "smudged / only half the name" look. Give this sprite its own
    // texture instance (cheap: shares the underlying canvas image, no re-render) so its
    // scroll state is exclusively its own.
    const marqueeMap = map.clone();
    marqueeMap.needsUpdate = true;
    // Texture.clone() deep-copies userData, so this clone would otherwise inherit
    // `shared: true` from the cached source above — it must NOT, since this clone
    // belongs exclusively to this one sprite and has to be individually disposable.
    marqueeMap.userData.shared = false;
    marqueeMap.wrapS = THREE.ClampToEdgeWrapping;
    marqueeMap.repeat.x = WINDOW_PX / width;
    material.map = marqueeMap;
    sprite.userData.marquee = { range: 1 - WINDOW_PX / width, t: 0 };
  }
  return sprite;
}

const rgbOf = (hex: string): string => {
  const c = new THREE.Color(hex);
  return `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
};

/** Soft radial-gradient sprite used as a star's corona / planet's atmosphere. */
function makeGlow(color: string, size: number): THREE.Sprite {
  const cacheKey = `${color}-${size}`;
  let texture = glowTexCache.get(cacheKey);

  if (!texture) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    const rgb = rgbOf(color);
    g.addColorStop(0, `rgba(${rgb},0.9)`);
    g.addColorStop(0.35, `rgba(${rgb},0.35)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    texture = new THREE.CanvasTexture(c);
    texture.userData.shared = true; // shared across every glow sprite of this color+size
    glowTexCache.set(cacheKey, texture);
  }
  glowRefCount.set(cacheKey, (glowRefCount.get(cacheKey) ?? 0) + 1);

  const mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(size, size, 1);
  sprite.userData.glowCacheKey = cacheKey; // see releaseNodeTextures
  return sprite;
}

/**
 * Performance Program Stage 7: release this (now-discarded) node object's claim on
 * any shared label/glow textures — call this for every `makeNodeObject()` result
 * Graph3D is about to permanently drop (a real node deletion, a cache-key-triggered
 * rebuild replacing the old object, or full unmount teardown). Decrements the
 * reference count for each `labelCacheKey`/`glowCacheKey` tag found among `obj`'s
 * descendants, and only once a cache entry's count reaches zero — meaning nothing
 * live references it anymore — disposes its texture and removes it from the cache.
 * Safe to call on an object with no tagged children (a no-op).
 */
export function releaseNodeTextures(obj: THREE.Object3D): void {
  obj.traverse((child: any) => {
    const labelKey = child.userData?.labelCacheKey;
    if (labelKey != null) {
      const next = (labelRefCount.get(labelKey) ?? 1) - 1;
      if (next <= 0) {
        labelRefCount.delete(labelKey);
        const entry = labelTexCache.get(labelKey);
        entry?.map.dispose();
        labelTexCache.delete(labelKey);
      } else {
        labelRefCount.set(labelKey, next);
      }
    }
    const glowKey = child.userData?.glowCacheKey;
    if (glowKey != null) {
      const next = (glowRefCount.get(glowKey) ?? 1) - 1;
      if (next <= 0) {
        glowRefCount.delete(glowKey);
        glowTexCache.get(glowKey)?.dispose();
        glowTexCache.delete(glowKey);
      } else {
        glowRefCount.set(glowKey, next);
      }
    }
  });
}

function getGeometry(
  type: "sphere" | "icosahedron" | "octahedron",
  size: number,
  widthSegments: number,
  heightSegments: number = widthSegments,
): THREE.BufferGeometry {
  const cacheKey = `${type}-${size}-${widthSegments}-${heightSegments}`;
  let geom = geometryCache.get(cacheKey);
  if (!geom) {
    if (type === "sphere") geom = new THREE.SphereGeometry(size, widthSegments, heightSegments);
    else if (type === "icosahedron") geom = new THREE.IcosahedronGeometry(size, widthSegments);
    else geom = new THREE.OctahedronGeometry(size, widthSegments);
    // Shared across every body with this exact type/size/segment combination.
    geom.userData.shared = true;
    geometryCache.set(cacheKey, geom);
  }
  return geom;
}

const ringGeometryCache = new Map<string, THREE.BufferGeometry>();
/**
 * Shared ring geometries, keyed by inner/outer radius + segment count — same "cache
 * the shape, apply per-node size via mesh.scale" pattern as `getGeometry` above. Every
 * ringed gas giant (and the action-item alert ring) uses a constant inner/outer RATIO
 * (or, for the action ring, constant absolute values), so this cache converges to one
 * shared geometry per distinct (inner, outer, segments) triple actually used in this
 * file, however many ringed bodies exist.
 */
function getRingGeometry(innerRadius: number, outerRadius: number, segments: number): THREE.BufferGeometry {
  const cacheKey = `${innerRadius}-${outerRadius}-${segments}`;
  let geom = ringGeometryCache.get(cacheKey);
  if (!geom) {
    geom = new THREE.RingGeometry(innerRadius, outerRadius, segments);
    geom.userData.shared = true;
    ringGeometryCache.set(cacheKey, geom);
  }
  return geom;
}


/** A ring of drifting rock particles (asteroid belt) around a big body. */
function makeAsteroidBelt(inner: number, outer: number, count = 360): THREE.Points {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = inner + Math.random() * (outer - inner);
    const a = Math.random() * Math.PI * 2;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = (Math.random() - 0.5) * (outer - inner) * 0.12; // thin disk
    positions[i * 3 + 2] = Math.sin(a) * r;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const belt = new THREE.Points(
    geom,
    new THREE.PointsMaterial({
      color: "#b9b2a0",
      size: 1.1,
      // Fixed point size: with sizeAttenuation:true, three.js computes
      // gl_PointSize = size*(scale/-mvPosition.z) with NO upper bound, so
      // points near the camera balloon into huge alpha-blended quads
      // (overdraw hazard on mobile GPUs). Attenuation off = small fixed px.
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  );
  belt.userData.spin = true; // tick rotates it slowly around the body
  return belt;
}

function surfaceCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  return [c, c.getContext("2d")!];
}

function toMap(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  // Both current callers (macroTexture, makeMoonSurface) cache the result and share it
  // across every body of the same colour/type — must survive any single consumer's disposal.
  t.userData.shared = true;
  return t;
}

/**
 * A cheap, cached surface texture (a few tonal blotches over the body colour) so
 * that a spinning macro body actually READS as spinning — a flat-shaded sphere
 * looks identical every frame. Cached per colour so density stays performant.
 */
const macroTexCache = new Map<string, THREE.CanvasTexture>();
function macroTexture(color: string): THREE.CanvasTexture {
  const cached = macroTexCache.get(color);
  if (cached) return cached;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  const base = new THREE.Color(color);
  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, 128, 64);
  const dark = `${rgbOf(`#${base.clone().multiplyScalar(0.5).getHexString()}`)}`;
  const lite = `${rgbOf(`#${base.clone().lerp(new THREE.Color("#ffffff"), 0.45).getHexString()}`)}`;
  // Deterministic-ish blotches (seeded by colour) so each tier looks distinct but
  // the cache stays stable. A handful is enough to perceive rotation.
  let seed = 0;
  for (let i = 0; i < color.length; i++) seed = (seed * 31 + color.charCodeAt(i)) >>> 0;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < 11; i++) {
    ctx.fillStyle = i % 2 ? `rgba(${dark},0.55)` : `rgba(${lite},0.45)`;
    const x = rnd() * 128;
    const y = rnd() * 64;
    const r = 5 + rnd() * 16;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = toMap(c);
  macroTexCache.set(color, t);
  return t;
}

/**
 * The "Macro View" level-of-detail body: a low-poly, self-lit sphere shown when
 * the camera is far enough that the full GLSL body (with its point light, glow,
 * rings and asteroid belt) isn't worth the cost. It still SPINS on its axis so
 * bodies never look frozen when the whole galaxy is in view — the whole point of
 * the LOD before was a flat sprite that couldn't rotate.
 */
function makeMacroBody(color: string, size: number, starLike: boolean): THREE.Mesh {
  const tex = macroTexture(color);
  // Canonical unit sphere, scaled by `size` — every macro body in the galaxy now
  // shares ONE geometry instead of each allocating its own (this call bypassed
  // getGeometry's cache entirely before; see the main-body geometry comment in
  // makeNodeObject for why uniform scaling is exactly, not approximately, identical
  // to baking `size` into the geometry directly).
  const mesh = new THREE.Mesh(
    getGeometry("sphere", 1, 14, 14),
    // emissiveMap = the surface texture so it's visible (and its spin is visible)
    // even far from the sun's light, without paying for a per-body point light.
    new THREE.MeshStandardMaterial({
      map: tex,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: tex,
      emissiveIntensity: starLike ? 0.95 : 0.5,
      roughness: 0.9,
      metalness: 0.0,
    }),
  );
  mesh.scale.setScalar(size);
  mesh.userData.isMacro = true;
  mesh.userData.isBody = true; // opaque by construction — see makeNodeObject's isBody comment
  // Self-rotation at macro distance too (the tick rotates any child with .spin).
  mesh.userData.spin = true;
  mesh.userData.spinSpeed = 0.003 + 0.02 / (size + 4);
  mesh.visible = false; // Hidden by default; toggled by Graph3D tick based on distance
  return mesh;
}

/** Pale grey, cratered moon. */
function makeMoonSurface(): THREE.CanvasTexture {
  const [c, ctx] = surfaceCanvas();
  ctx.fillStyle = "#9aa0b4";
  ctx.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 128;
    const r = 2 + Math.random() * 9;
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#6b7080";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = "#cfd5e6";
    ctx.beginPath();
    ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return toMap(c);
}

let cachedMoonTexture: THREE.CanvasTexture | null = null;
function getMoonTexture(): THREE.CanvasTexture {
  if (!cachedMoonTexture) {
    cachedMoonTexture = makeMoonSurface();
  }
  return cachedMoonTexture;
}

// Performance Program Round 3 (memory scaling audit): the cache-key granularity for
// `entropy`. Entropy genuinely affects this file's output (see the "Cooling tint" and
// `vitality` code below — it drifts the body's color and pulse brightness), so it can't
// be dropped from node-object cache identity outright. But it's a continuously-drifting
// float (days-since-last-tended over a multi-week window), so including its raw value in
// a cache key means the key differs on almost every `refresh()` even though the visible
// difference is imperceptible — a typical refresh-to-refresh drift is ~0.002, two orders
// of magnitude smaller than one bucket here. Bucketing collapses that noise while still
// forcing a rebuild once entropy has moved far enough to matter (including the moment it
// resets to 0 when a memory is "tended" — a real, meaningful, deliberately-visible event).
const ENTROPY_CACHE_BUCKET = 0.05;

function bucketEntropy(raw: number | null | undefined): number {
  const clamped = Math.max(0, Math.min(1, raw ?? 0));
  return Math.round(clamped / ENTROPY_CACHE_BUCKET) * ENTROPY_CACHE_BUCKET;
}

/**
 * Cache-key identity for a node's Three.js object (consumed by Graph3D's
 * `nodeThreeObjCacheRef`): every field below is read by `makeNodeObject` in a way that
 * changes its constructed geometry/material/color/label or which branch (action vs.
 * celestial body) it takes — so a change in any of them SHOULD invalidate the cache.
 * `entropy` is the one exception, bucketed via `bucketEntropy` rather than included raw
 * or dropped entirely (see the comment above) — every other field is unchanged from
 * before this fix.
 */
export function nodeVisualCacheKey(node: GraphNode): string {
  // The sector-title decision changes the built label set, so it belongs in
  // the key per the contract above (a threshold change rebuilds affected nodes).
  const titled = sectorTitleIds.has(node.id) ? 1 : 0;
  return `${node.label}_${node.importance}_${node.degree}_${bucketEntropy(node.entropy)}_${node.color || ""}_${node.kind}_${titled}`;
}

/**
 * Build a node as a celestial body. Mass (derived server-side from importance +
 * connections + emotion) sets size and class. Bodies are textured spheres so a
 * star reads as a sun, a planet as a world (sometimes ringed), a moon as a pale
 * cratered rock. Animation flags (spin / pulse / corona) and the base emissive
 * are stashed in userData for the Graph3D tick loop (which also dims emissive up
 * close so labels stay readable and surface detail shows).
 */
export function makeNodeObject(node: GraphNode, tier: ShaderTier = "quality"): THREE.Object3D {
  // Action items are urgent little satellites (amber/red), not celestial bodies:
  // small jagged core, a fast-pulsing alert glow, and a warning ring.
  if (node.kind === "action") {
    const g = new THREE.Group();
    const col = "#ffb340";
    const core = new THREE.Mesh(
      getGeometry("octahedron", 2.4, 0),
      new THREE.MeshStandardMaterial({
        color: col,
        emissive: new THREE.Color(col),
        emissiveIntensity: 1.1,
        roughness: 0.4,
        metalness: 0.3,
      }),
    );
    core.userData.spin = true;
    core.userData.isBody = true; // opaque by construction — see makeNodeObject's isBody comment
    core.userData.pulse = { base: 1.0, amp: 0.8, speed: 3.2, phase: (node.id % 7) * 0.6 }; // fast, urgent
    g.add(core);
    const ring = new THREE.Mesh(
      getRingGeometry(3.4, 4.1, 28),
      new THREE.MeshBasicMaterial({
        color: "#ff7a3c",
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      }),
    );
    ring.rotation.x = Math.PI / 2.3;
    // Unlike a celestial body, an action item has no separate macro-LOD sphere to swap
    // to at distance — it would otherwise always submit ring+glow+core (3 draw calls)
    // regardless of camera distance, uncapped by any LOD (Galaxy render recovery pass,
    // 2026-09-10). Tagging the decorative ring+glow isFidelity reuses Graph3D's EXISTING
    // isMacroView distance swap (the same flag every celestial body's ring/glow already
    // uses) for free — no new code path, no new distance check. The core octahedron is
    // deliberately NOT tagged isFidelity: an urgent action item must stay visible at any
    // distance (that's the point of it), just cheaper — one draw call instead of three
    // once far enough away, not zero.
    ring.userData.isFidelity = true;
    g.add(ring);
    const glow = makeGlow(col, 12);
    glow.userData.isFidelity = true;
    g.add(glow);
    g.add(makeLabel(`⏰ ${node.label}`));
    g.userData.nodeId = node.id;
    return g;
  }

  const mass = nodeMass(node);
  const cls = node.celestial ?? classify(mass);
  const group = new THREE.Group();

  // Time-based progression — but SIZE/growth comes only from mass (significance +
  // connections), never age. Age only affects vitality (glow):
  //  - a just-added/edited memory is "active" and glows brighter for ~48h, then
  //  - if it stays UNCONNECTED it slowly fades/cools (a forgotten thought), while
  //    connected/significant memories never fade (they're held alive by the web).
  const rawDate = node.createdAt ?? "";
  const isoDate = rawDate.includes("Z") ? rawDate : rawDate.replace(" ", "T") + "Z";
  const created = Date.parse(isoDate);
  const ageH = Number.isFinite(created) ? (Date.now() - created) / 3.6e6 : 9999;
  const fresh = Math.max(0, 1 - ageH / 48);
  const connected = (node.degree ?? 0) >= 1;
  const fade = connected ? 0 : Math.min(0.6, Math.max(0, ageH - 48) / 240); // ~10d -> -60%
  // Entropy (server-computed: days since last tended, resisted by connections).
  // A neglected memory cools — it dims here and shifts cold below. Tending it
  // resets entropy server-side, so it warms back up on the next graph refresh.
  const entropy = Math.max(0, Math.min(1, node.entropy ?? 0));
  // Spaced-repetition memory strength (NEURO_ALIGNMENT #1): a memory decayed toward its
  // review point dims — the "come review me" cue. Full strength (or unscheduled) = no
  // change; low strength gently darkens (never below ~55%, so it stays legible).
  const reviewDim = node.reviewStrength != null ? 0.55 + 0.45 * Math.max(0, Math.min(1, node.reviewStrength)) : 1;
  const vitality = (1 + 0.5 * fresh) * (1 - fade) * (1 - 0.55 * entropy) * reviewDim;

  // Age-based Evolution Logic (Green Lane Gamification)
  const isHot = ageH < 24; // Created in the last 24h
  const isAncient = ageH > 720 && !connected; // Older than a month and lonely

  // Tweak color based on age
  let evolvedColor = new THREE.Color(bodyColor(node));
  if (isHot) {
    evolvedColor.lerp(new THREE.Color("#ffffff"), 0.15); // Hot white glow
  } else if (isAncient) {
    evolvedColor.lerp(new THREE.Color("#ff6b6b"), 0.15).multiplyScalar(0.85); // Redshift + Weathered dim
  }
  // Cooling tint: as entropy climbs, drift toward cold slate-blue and darken —
  // a memory visibly going cold. Layers on top of the age tint above.
  if (entropy > 0.05) {
    evolvedColor.lerp(new THREE.Color("#4a5a7a"), 0.45 * entropy).multiplyScalar(1 - 0.2 * entropy);
  }
  const color = `#${evolvedColor.getHexString()}`;

  const isStarLike = cls === "star" || cls === "supergiant";
  const isPlanetLike = cls === "planet" || cls === "gas_giant" || cls === "giant";
  const isRocky = cls === "moon" || cls === "asteroid";

  // Size grows with class then mass within the class.
  const SIZE: Record<string, number> = {
    asteroid: 2.2 + mass * 2,
    moon: 3 + mass * 2.5,
    planet: 4 + mass * 4,
    gas_giant: 5.5 + mass * 4.5,
    giant: 6.5 + mass * 5,
    star: 6 + mass * 6,
    supergiant: 9 + mass * 7,
  };
  const size = SIZE[cls] ?? 4;

  // Stars/supergiants = blackbody GLSL; planets/giants = terrain+atmosphere GLSL;
  // moons/asteroids = cheap cratered rock. Any failure falls back to a solid body.
  let material: THREE.Material;
  let baseBrightness: number;
  try {
    if (isStarLike) {
      material = makeStarMaterial(color, tier);
      baseBrightness = cls === "supergiant" ? 1.65 : 1.45; // suns read a touch brighter
    } else if (isPlanetLike) {
      material = makePlanetMaterial(color, tier);
      baseBrightness = 1.0;
    } else {
      const m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(cls === "moon" ? "#c2c8da" : color),
        emissive: new THREE.Color(color),
        emissiveIntensity: 0.16,
        roughness: 1,
        metalness: 0.05,
      });
      try {
        m.map = getMoonTexture();
      } catch {
        /* solid rock */
      }
      material = m;
      baseBrightness = 0.16;
    }
  } catch {
    material = new THREE.MeshStandardMaterial({
      color,
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.8,
    });
    baseBrightness = 0.8;
  }

  // Asteroids are jagged rocks; everything else is a sphere. Segment counts follow the
  // same material split above — a star's granule shader reads at a glance and is usually
  // the biggest/closest body (worth 32x24), a planet's terrain rarely needs more than
  // 24x16, and moons/asteroids were already conservative at 24. Down from a flat 48x48
  // for every star/planet (~4600 tris) regardless of how many screen pixels it covers.
  //
  // Canonical UNIT geometry (radius 1), scaled per-node via mesh.scale below — not the
  // node's own continuous, mass-derived `size` baked directly in. getGeometry's cache
  // key includes whatever size it's given, so with the real value (a continuous float,
  // effectively never bit-identical between two different nodes) the cache almost never
  // actually hit: every node still allocated its own fresh, uncached geometry despite
  // going through a function that looks like it shares them. Every node of the same
  // class+segment config now shares exactly ONE geometry object for the whole galaxy.
  // Provably zero visual difference, not just measured-close: uniform scaling of a
  // sphere/icosahedron reproduces the exact same vertex positions and normals as
  // constructing it at that radius directly (uniform scale never distorts a normal —
  // only non-uniform scale would), and both procedural body shaders (shaders.ts)
  // already normalize the vertex position before sampling their noise functions
  // (`vec3 p = normalize(vPos)`), so the granule/terrain pattern is already scale-
  // invariant — confirmed by reading the shader source directly, not assumed. A moon's
  // texture UV mapping (SphereGeometry's built-in theta/phi parameterization) is
  // likewise independent of the radius parameter.
  const geom =
    cls === "asteroid"
      ? getGeometry("icosahedron", 1, 0)
      : isRocky
        ? getGeometry("sphere", 1, 24)
        : isStarLike
          ? getGeometry("sphere", 1, 32, 24)
          : getGeometry("sphere", 1, 24, 16);
  const mesh = new THREE.Mesh(geom, material);
  mesh.scale.setScalar(size);
  // Opaque by construction (none of the material branches above set `transparent: true`) —
  // tagged explicitly so Graph3D's hover-highlight effect knows this material is safe to
  // keep opaque while lit, instead of the previous unconditional `transparent = true` on
  // every node child (which pushed every body into three.js's back-to-front transparent
  // queue, defeating early-Z for all of them, all the time — see
  // docs/specs/soumaya-galaxy-large-render-forensic-audit.md §8.2).
  mesh.userData.isBody = true;
  mesh.userData.pulse = {
    base: baseBrightness,
    amp: isStarLike ? 0.25 : isPlanetLike ? 0.12 : 0.06,
    speed: (0.6 + mass * 0.9) * (1 + fresh), // fresh memories pulse a touch faster
    phase: (node.id % 12) * 0.5,
    vitality, // age-driven glow: brighter when fresh, dimmer when stale + unconnected
  };

  // Self-rotation: the body (+ its rings) spins on its own axis while the orbit
  // system carries it around its heaviest neighbor. Smaller bodies spin faster.
  mesh.userData.spin = true;
  mesh.userData.spinSpeed = 0.0015 + 0.05 / (size + 4);

  // Rings are a SIGNATURE of a RARE, special body — not every gas giant. On an
  // established brain many memories land in the gas-giant band, so gate rings to a
  // stable ~1/5 of them (hashed on id) so a ringed world reads as a standout.
  const nodeGroup = new THREE.Group();
  nodeGroup.add(mesh);
  
  if (cls === "gas_giant" && ((node.id * 2654435761) >>> 0) % 5 === 0) {
    // Canonical unit-ratio ring (inner 1.6, outer 2.4 — the same ratio every ringed
    // gas giant already used), scaled by `size` below. A RingGeometry is flat (no
    // Z-extent), so a uniform scale reproduces the exact same inner/outer radii the
    // old size*1.6/size*2.4 construction did — every ringed gas giant now shares one
    // geometry instead of each allocating its own.
    const ring = new THREE.Mesh(
      getRingGeometry(1.6, 2.4, 48),
      new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
    );
    ring.scale.setScalar(size);
    ring.rotation.x = Math.PI / 2.4;
    nodeGroup.add(ring);
  }

  // Brighter bodies give off more light. Star-like bodies get a corona + a real
  // point light that illuminates nearby worlds; giants/planets get a faint glow.
  if (isStarLike) {
    const glow = makeGlow(color, size * (cls === "supergiant" ? 3.0 : 2.4));
    glow.userData.corona = {
      base: glow.scale.x,
      baseOpacity: cls === "supergiant" ? 0.5 : 0.4,
      speed: 0.5 + mass * 0.7,
      phase: (node.id % 7) * 0.7,
    };
    nodeGroup.add(glow);
    // Performance Program Stage 4: stars used to each carry their own THREE.PointLight,
    // toggled `.visible` by distance in Graph3D's tick loop. An invisible Light is STILL
    // counted toward NUM_POINT_LIGHTS unless removed from the scene graph, so a galaxy
    // with many stars kept changing that count as stars crossed the visibility distance
    // — a real shader-recompile stall on every lit material, not just wasted per-pixel
    // light math. Replaced with a fixed small pool of shared lights (Graph3D.tsx) that
    // gets repositioned/recoloured onto the nearest few stars on a throttle — the number
    // of lights in the scene never changes, so nothing ever recompiles. This nodeGroup
    // just publishes what its light SHOULD look like; it no longer creates one itself.
    nodeGroup.userData.starLight = {
      color: new THREE.Color(color),
      intensity: cls === "supergiant" ? 3.0 + mass * 3.5 : 1.6 + mass * 3,
      distance: size * (cls === "supergiant" ? 60 : 45),
    };
    // A faint asteroid belt orbiting the sun.
    nodeGroup.add(makeAsteroidBelt(size * 2.6, size * 3.8));
  } else if (isPlanetLike) {
    const glow = makeGlow(color, size * (cls === "giant" ? 1.5 : 1.35));
    glow.userData.corona = {
      base: glow.scale.x,
      baseOpacity: cls === "giant" ? 0.14 : 0.12,
      speed: 0.4 + mass * 0.6,
      phase: (node.id % 7) * 0.7,
    };
    nodeGroup.add(glow);
  }

  // Tag every full-detail child added so far (mesh, rings, glow/corona, asteroid belt) as
  // "isFidelity" so Graph3D's tick loop can hide them all at macro distance (see
  // makeMacroBody's comment below — that was the whole point of the macro LOD swap). This
  // must be set on the CHILDREN, not on nodeGroup itself: the tick loop's LOD check reads
  // `child.userData.isFidelity` while iterating `o.children` where `o` IS nodeGroup, so a
  // flag on nodeGroup itself is never seen — that mismatch previously left the full-detail
  // body always rendered even at macro range, double-drawing on top of the cheap macro
  // body. Must run BEFORE the sector title / label / macro body are added below — those
  // toggle visibility by their own LOD tags and must not inherit this one. (No longer
  // needs to exclude a point-light child — stars don't carry one anymore, see
  // `starLight` above.)
  for (const c of nodeGroup.children) c.userData.isFidelity = true;

  // 2. The Macro Body (low-poly self-lit sphere; spins so it never looks frozen)
  const macro = makeMacroBody(color, size, isStarLike);

  // 3. Sector Title — a few well-separated massive hubs get a name at macro/zoomed-out view
  const hasSectorTitle = sectorTitleIds.has(node.id);
  if (hasSectorTitle) {
    const sectorLabel = makeLabel((node.celestialTitle ?? node.label).toUpperCase());
    sectorLabel.scale.multiplyScalar(2.5); // Giant sector name
    sectorLabel.userData.baseScale = { x: sectorLabel.scale.x, y: sectorLabel.scale.y };
    sectorLabel.position.set(0, size * 4 + 10, 0);
    sectorLabel.userData.isSectorTitle = true;
    sectorLabel.visible = false; // Toggled by LOD logic
    nodeGroup.add(sectorLabel);
  }

  nodeGroup.add(makeLabel(node.label));
  nodeGroup.add(macro);
  nodeGroup.userData.nodeId = node.id;
  // Performance Program Stage 5: lets Graph3D's tick loop skip the ENTIRE per-child
  // update (spin/label/pulse/corona) for a frustum-culled body in one early return —
  // except a sector-title body, whose big, distance-boosted title sprite can still be
  // on screen even when the body's own (small, fixed-radius) culling sphere isn't
  // intersecting the frustum. Read directly off the group rather than traversing
  // children every frame to check for one.
  nodeGroup.userData.hasSectorTitle = hasSectorTitle;
  return nodeGroup;
}

