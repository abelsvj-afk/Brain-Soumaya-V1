import * as THREE from "three";
import { gltfLoader } from "./gltf.js";

/**
 * Module-scope helpers extracted from the large Graph3D.tsx (Post-MVP D4 refactor):
 * link level-of-detail thresholds + key helpers, procedural/GLB figurine building,
 * and Three.js GPU-resource disposal. No component state — pure functions.
 */

// Link level-of-detail thresholds (perf on dense brains). Below LINK_LOD_MIN links,
// everything always draws. At/above it, when the camera sits farther than LINK_LOD_ZOOM,
// only connections whose weight+activity clears LINK_LOD_CUTOFF render — the weak faint
// filaments (the bulk of a dense graph) are skipped until you zoom in.
export const LINK_LOD_MIN = 350;
export const LINK_LOD_ZOOM = 650;
export const LINK_LOD_CUTOFF = 0.6;
/**
 * Galaxy line-latch Fix A (2026-10-21): the width a link gets when the render
 * gate (Graph3D's `shouldRenderLink`) says "don't draw". It must NEVER be
 * exactly 0: three-forcegraph picks a link's Object3D type ONCE, at creation,
 * by `!!widthAccessor(link)` (truthy -> tube Mesh, falsy -> THREE.Line
 * hairline), and its per-frame layoutTick branches on that baked-in type
 * (`line.type === 'Line'`) for the object's whole life — so a link born at
 * width 0 is a 1-px hairline forever and can never swell into a tube when
 * conditions later change. That was the S3 latch ("lines too thin until a
 * planet click"): only a selection change, which recreates every link object,
 * cured it. Hiding never needed width 0 — `linkColor` returns fully
 * transparent for the exact same gate outcome, so invisibility is carried by
 * color alone and width's only job in the hidden case is staying truthy.
 * 0.001 also survives three-forcegraph's digest width rounding
 * (Math.ceil(w * 10) / 10 -> 0.1, still truthy) on both the create
 * (onCreateObj) and update (onUpdateObj) paths — pinned by
 * linkDrawWidth.test.ts so a future epsilon edit can't silently re-arm the
 * latch by rounding down to 0.
 */
export const LINK_HIDDEN_WIDTH = 0.001;

/**
 * The link-width accessor's whole decision, extracted pure (same pattern as
 * computeGlowFar below) so the never-zero contract is unit-testable without a
 * WebGL context. `render` is Graph3D's `shouldRenderLink` outcome for the
 * link; the SAME boolean drives `linkColor`'s transparent return, so width
 * and color can never disagree about draw/don't-draw within a digest. Drawn
 * links keep the long-standing resting formula: the line itself is the glow —
 * a tended connection swells quadratically in activity, cold links stay slim
 * but visible.
 */
export function linkDrawWidth(render: boolean, weight: number | undefined, activity: number): number {
  if (!render) return LINK_HIDDEN_WIDTH;
  return 0.7 + (weight ?? 0.4) * 0.9 + activity * activity * 5;
}

/**
 * Galaxy fluidity (2026-10-21): the selection-lighting predicate, extracted
 * pure from Graph3D's `isLit` closure so the `[]`-stable `linkWidthCb` can
 * evaluate it against ref-mirrored (activeId, adjacency) inputs instead of a
 * render closure — see Graph3D.tsx's perf comment at `linkWidthCb`. A node is
 * lit when nothing is active, when it IS the active node, or when it is a
 * direct neighbor of the active node. Byte-identical to the closure it
 * replaces; pinned by graph3dHelpers.test.ts.
 */
export function isNodeLit(
  id: number,
  activeId: number | null,
  adjacency: Map<number, Set<number>>,
): boolean {
  return activeId === null || id === activeId || (adjacency.get(activeId)?.has(id) ?? false);
}

export const linkEnd = (v: any): number => (typeof v === "object" && v !== null ? v.id : v);
/** Stable key for a connection (undirected) so we can track which are already drawn. */
export const linkKey = (l: any): string => {
  const a = linkEnd(l.source);
  const b = linkEnd(l.target);
  return a < b ? `${a}-${b}` : `${b}-${a}`;
};

/**
 * Whether a cached node Object3D is still safe to reuse from Graph3D's own
 * `nodeThreeObjCacheRef` (docs/specs/soumaya-galaxy-cache-disposal-audit.md). That cache is a
 * completely separate structure from three-forcegraph's OWN internal node cache, which can be
 * cleared independently of any change to the node data itself — e.g. an unmemoized
 * `nodeThreeObject`/`nodeThreeObjectExtend` prop reference on a React re-render, or one of the
 * `fg.refresh()` calls already elsewhere in Graph3D.tsx. When that happens, three-forcegraph
 * disposes (geometry/material/texture) every currently-tracked node's Object3D via its own
 * `onRemoveObj` wrapper — which always calls `scene.remove(obj)` immediately before disposing
 * it — and then, in the same synchronous pass, re-requests an object for the very same (data-
 * unchanged) node id. Without this check, a still-matching cache key would hand back the exact
 * Object3D whose GPU resources were just freed a moment earlier, and three-forcegraph would
 * re-add it to the live scene.
 *
 * Three.js's own `dispose()` never sets a detectable flag (it only ever dispatches an event —
 * confirmed against the installed version), so there's no "is this disposed?" property to read.
 * `obj.parent === null` is the reliable, always-public substitute: three-forcegraph's removal
 * path is guaranteed (by the exact wrapper that calls it) to detach the object from the scene
 * before disposing it, so a still-cached entry with no parent is proof it was already torn down.
 */
export function isNodeCacheEntryValid(
  cached: { obj: THREE.Object3D; key: string } | undefined,
  cacheKey: string,
): boolean {
  return !!cached && cached.key === cacheKey && cached.obj.parent !== null;
}

/**
 * The target `{transparent, opacity}` for one node-child material during hover
 * highlighting. `isBodyMaterial` marks a body opaque-by-construction (mesh.userData.isBody —
 * stars/planets/moons/asteroids/action cores/macro spheres): none of their materials set
 * `transparent: true` themselves, so a LIT one is restored to its natural opaque state
 * instead of being left in three.js's transparent render queue (which has no early-Z
 * rejection) for no visual reason. A DIMMED body still needs real alpha blending to fade,
 * so that case is transparent exactly as before. Everything else (labels, glow/corona
 * sprites, rings, asteroid-belt points) is already `transparent: true` by its own
 * construction with its own tuned base opacity — unchanged in either state.
 * See docs/specs/soumaya-galaxy-large-render-forensic-audit.md §8.2/§22.
 */
export function highlightMaterialState(
  isBodyMaterial: boolean,
  lit: boolean,
): { transparent: boolean; opacity: number } {
  return {
    transparent: isBodyMaterial ? !lit : true,
    opacity: lit ? 1 : 0.12,
  };
}

/**
 * Node-glow render-stall fix (2026-09-10 sub-isolation sweep): whether a body's glow/
 * corona sprite should be treated as "too far to show" — a TIGHTER distance than
 * `isMacroView`'s own `MACRO_DIST` cutoff, because the render-isolation sweep measured
 * glow/corona sprites alone costing MORE render time than the full-detail body mesh
 * itself (a real device: 177.7ms baseline -> 10.5ms with glow off, vs. 96.6ms with the
 * core mesh off) — a glow sprite's world-space radius is disproportionately larger than
 * the body it decorates, so it stays expensive well past the distance the body mesh
 * itself is still cheap to keep at full detail.
 *
 * Extracted as a pure function (same shape as `isMacroView`'s own inline hysteresis
 * computation in Graph3D.tsx) purely so it's directly unit-testable — the hysteresis
 * logic itself is identical: descend needs to clear `dist - hyst`, re-ascend needs to
 * clear `dist + hyst`, so a body oscillating near the boundary doesn't flicker every
 * frame. The selected/followed body is exempt at any distance, matching every other
 * LOD exemption in this file.
 */
export function computeGlowFar(
  dist: number,
  wasGlowFar: boolean,
  isSelected: boolean,
  glowDist: number,
  glowHyst: number,
): boolean {
  return !isSelected && (wasGlowFar ? dist > glowDist - glowHyst : dist > glowDist + glowHyst);
}

/**
 * Nearest-N selection with stickiness — the shared primitive behind the Galaxy's
 * "only N of these at once" caps.
 *
 * Full-fidelity node bodies are the single most expensive thing this scene renders:
 * every automated in-session diagnostic run this investigation produced agrees that a
 * mostly-macro galaxy costs ~9-15ms/frame while a mostly-full-fidelity one costs
 * ~1400-2900ms/frame, regardless of which individual decoration (rings, glow, belt,
 * composer) was being isolated at the time. It also matches the owner's own long-
 * standing observation that opening a Lens/View — which simply puts fewer bodies on
 * screen — makes the Galaxy instantly usable. So the population has to be BOUNDED,
 * not merely distance-thresholded: a distance threshold's cost still scales with
 * however many bodies happen to sit inside it, which is exactly how MACRO_DIST kept
 * being retuned without ever fixing the collapse.
 *
 * `sticky` mirrors the label cap's own long-standing behaviour: a body that already
 * holds a slot reads as ~15% nearer than it is, so a rival has to CLEARLY overtake it
 * rather than marginally, which stops two bodies either side of the Nth-nearest
 * boundary from swapping every throttle window on ordinary camera drift.
 */
export function pickNearestIds(
  candidates: { id: number; d: number }[],
  max: number,
  alreadyVisible: Set<number>,
  sticky = 0.85,
): Set<number> {
  const ranked = [...candidates].sort((a, b) => {
    const da = alreadyVisible.has(a.id) ? a.d * sticky : a.d;
    const db = alreadyVisible.has(b.id) ? b.d * sticky : b.d;
    return da - db;
  });
  const out = new Set<number>();
  for (let i = 0; i < Math.min(max, ranked.length); i++) out.add(ranked[i]!.id);
  return out;
}

/**
 * Whether the adaptive-graphics path should actually call `renderer.setPixelRatio()`.
 * `WebGLRenderer.setPixelRatio()` has no internal early-out — it unconditionally calls
 * `setSize()`, which resizes the WebGL drawing buffer (a real GPU-pipeline stall on some
 * devices/drivers), regardless of whether the new value differs from the current one.
 * The Stage 6 adaptive controller can re-resolve graphics settings on every rung change
 * (including a rung whose resolved `pixelRatio` happens to equal the previous one, e.g.
 * adjacent rungs sharing a `pixelRatioCap`, or a descend-then-ascend flap), so the call
 * site must gate on the EFFECTIVE value actually changing, not just on "a rung changed."
 */
export function shouldApplyPixelRatio(lastApplied: number | null, next: number): boolean {
  return lastApplied !== next;
}

export function updateFigurine(
  group: THREE.Group,
  type: string,
  position: THREE.Vector3,
  getEnv: () => THREE.Texture | null
) {
  // Clear previous children (and free their GPU resources so re-equipping a figurine
  // doesn't leak geometries/materials/textures).
  while (group.children.length > 0) {
    const child = group.children[0]!;
    group.remove(child);
    disposeObject3D(child);
  }

  if (type === "none") {
    group.visible = false;
    return;
  }

  group.visible = true;
  group.position.copy(position);
  group.userData.focusDist = 4000; // default camera framing distance; big figurines override

  let fallbackMesh: THREE.Object3D;
  let modelPath = "";
  let targetSize = 1000; // desired scale size in world units

  if (type === "station") {
    modelPath = "/space_station_3.glb";
    targetSize = 1300;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x7af9ff,
      roughness: 0.2,
      metalness: 0.8,
      emissive: 0x003355,
      emissiveIntensity: 0.5
    });
    fallbackMesh = new THREE.Mesh(new THREE.TorusGeometry(600, 100, 16, 48), mat);
  } else if (type === "blackhole") {
    // The Singularity — prestige unlock. Real glTF (converted to metallic-roughness +
    // Draco; see docs/specs/blackhole-singularity.md). A black hole is the most massive
    // object in any galaxy — it must DWARF the sun (~600) and every other figurine
    // (Dyson ~1800), so it gets a colossal targetSize, is pushed deep into the back so
    // it doesn't engulf the galaxy, and records its own (large) camera focus distance.
    modelPath = "/blackhole.glb";
    targetSize = 10000; // ~5x the sun's visual extent — unmistakably the biggest thing
    group.position.copy(position).multiplyScalar(1.6); // pushed far behind the galaxy
    group.userData.focusDist = 13000; // camera frames it from this far so it fills the sky
    const voidMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      roughness: 1.0,
      metalness: 0.0
    });
    const diskMat = new THREE.MeshStandardMaterial({
      color: 0xffa040,
      emissive: 0xff7722,
      emissiveIntensity: 2.4
    });
    // Fallback void+disk sized to roughly match the loaded model so there's no pop.
    const subGroup = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(2100, 48, 48), voidMat);
    const disk = new THREE.Mesh(new THREE.TorusGeometry(4100, 420, 16, 96), diskMat);
    disk.rotation.x = Math.PI / 2.4;
    subGroup.add(core);
    subGroup.add(disk);
    fallbackMesh = subGroup;
  } else if (type === "satellite") {
    modelPath = "/aura-satellite.glb";
    targetSize = 1000;
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      roughness: 0.3,
      metalness: 0.9,
      emissive: 0x443300,
      emissiveIntensity: 0.3
    });
    fallbackMesh = new THREE.Mesh(new THREE.CylinderGeometry(150, 150, 800, 16), mat);
  } else if (type === "star_center") {
    modelPath = "/star-center.glb";
    targetSize = 1500;
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffbb44,
      emissive: 0xff8800,
      emissiveIntensity: 2.0,
      roughness: 0.1,
      metalness: 0.9
    });
    fallbackMesh = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 32), mat);
  } else if (type === "dyson_sphere") {
    modelPath = "/dyson-sphere.glb";
    targetSize = 1800;
    const innerMat = new THREE.MeshStandardMaterial({
      color: 0xff3300,
      emissive: 0xff0000,
      emissiveIntensity: 1.8
    });
    const outerMat = new THREE.MeshStandardMaterial({
      color: 0x334466,
      roughness: 0.4,
      metalness: 0.8
    });
    const subGroup = new THREE.Group();
    const inner = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 32), innerMat);
    const outer = new THREE.Mesh(new THREE.TorusGeometry(750, 50, 8, 48), outerMat);
    outer.rotation.x = Math.PI / 4;
    subGroup.add(inner);
    subGroup.add(outer);
    fallbackMesh = subGroup;
  } else if (type === "quantum_core") {
    modelPath = "/space_station_3.glb";
    targetSize = 1100;
    const innerMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      roughness: 0.9,
      metalness: 0.1
    });
    const outerMat = new THREE.MeshStandardMaterial({
      color: 0x00ffff,
      emissive: 0x00ffff,
      emissiveIntensity: 2.0
    });
    const subGroup = new THREE.Group();
    const inner = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 32), innerMat);
    const outer = new THREE.Mesh(new THREE.TorusGeometry(800, 40, 8, 48), outerMat);
    outer.rotation.x = Math.PI / 2;
    subGroup.add(inner);
    subGroup.add(outer);
    fallbackMesh = subGroup;
  } else if (type === "hyper_array") {
    modelPath = "/aura-satellite.glb";
    targetSize = 1200;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x00ff88,
      emissive: 0x008844,
      emissiveIntensity: 1.2,
      roughness: 0.3,
      metalness: 0.8
    });
    const subGroup = new THREE.Group();
    const torus1 = new THREE.Mesh(new THREE.TorusGeometry(600, 40, 8, 48), mat);
    const torus2 = new THREE.Mesh(new THREE.TorusGeometry(600, 40, 8, 48), mat);
    torus2.rotation.y = Math.PI / 2;
    subGroup.add(torus1);
    subGroup.add(torus2);
    fallbackMesh = subGroup;
  } else if (type === "shield_spire") {
    modelPath = "/space_station_3.glb";
    targetSize = 1400;
    const matBase = new THREE.MeshStandardMaterial({
      color: 0x557799,
      roughness: 0.4,
      metalness: 0.7
    });
    const matOrb = new THREE.MeshStandardMaterial({
      color: 0x7af9ff,
      emissive: 0x7af9ff,
      emissiveIntensity: 1.5,
      transparent: true,
      opacity: 0.65
    });
    const subGroup = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(50, 150, 900, 16), matBase);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(250, 16, 16), matOrb);
    orb.position.y = 450;
    subGroup.add(base);
    subGroup.add(orb);
    fallbackMesh = subGroup;
  } else {
    return;
  }

  // Add procedural fallback first
  group.add(fallbackMesh);

  // Load GLB
  gltfLoader().load(
    modelPath,
    (gltf) => {
      // Remove fallback and free its GPU resources — it's no longer a child of `group`
      // once removed, so the generic disposal pass on a later re-equip would never reach
      // it otherwise, leaking one geometry+material per successful figurine load.
      group.remove(fallbackMesh);
      disposeObject3D(fallbackMesh);
      const model = gltf.scene;

      // Compute bounding box to normalize scale
      const box = new THREE.Box3().setFromObject(model);
      const dim = new THREE.Vector3();
      box.getSize(dim);
      const maxDim = Math.max(dim.x, dim.y, dim.z) || 1;
      const k = targetSize / maxDim;
      model.scale.setScalar(k);

      // Recenter model
      const center = new THREE.Vector3();
      box.getCenter(center);
      model.position.copy(center.multiplyScalar(-k));

      // Enable environment maps on loaded model if available
      const env = getEnv();
      if (env) {
        model.traverse((o: any) => {
          if (o.isMesh) {
            o.material.envMap = env;
            o.material.needsUpdate = true;
          }
        });
      }

      group.add(model);
    },
    undefined,
    (err) => {
      console.warn(`[figurine] failed to load '${modelPath}'; using procedural fallback`, err);
    }
  );
}

/**
 * Free the GPU resources held by a node/figurine object before we drop our last
 * reference to it. react-force-graph swaps the scene object when nodeThreeObject
 * returns a new instance, but it never disposes the old one's geometry/materials/
 * textures — so without this, every content change (degree/entropy/label) on a busy
 * brain leaks VRAM until the context is lost. Lights need no disposal.
 */
export function disposeObject3D(obj: THREE.Object3D): void {
  obj.traverse((o: any) => {
    // Several node builders (nodeObject.ts) intentionally cache + share geometries/textures
    // across MANY bodies (moon surface, glow/corona sprites, macro-body surface, label text,
    // asteroid geometry) — those are tagged `userData.shared = true` at creation. Disposing
    // one node's object must never destroy a resource every other node is still using; only
    // per-object-unique resources (unmarked) get disposed here. The MATERIAL instance itself
    // is always unique per object even when it references a shared texture, so it's always
    // safe to dispose.
    if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const k in m) {
        const v = (m as any)[k];
        if (v && v.isTexture && !v.userData?.shared) v.dispose?.();
      }
      m.dispose?.();
    }
  });
}
